// 会话沙盒第 3 步（issue #15）：面板「会话沙盒」页 + 头部档位徽章。
// 宿主算视图（sandbox-view.js）、面板直接写规则表（不再写旧 sessionAllowKinds / injectionBlocks / gate 'pure'），
// 左栏开关关掉时本会话的受控档 / 包开关 / 单条规则不生效；写盘仍带旧字段镜像（防降级）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { sandboxView, observedFor } from '../sandbox-view.js'
import { applyEnabled } from '../enabled.js'
import { migrateSandbox, resolveSandbox, withLegacyMirror } from '../sandbox.js'
import { makeHarness } from './sandbox-harness.mjs'

const clone = (value) => JSON.parse(JSON.stringify(value))
const SID = 'session-sbx'

// ── 宿主侧视图 ───────────────────────────────────────────────────────────────

const sources = () => ({
  injections: {
    catalog: { messages: [], sections: ['harness:identity', 'tool:bash'], contexts: ['working-directory:current'] },
    sessions: {
      [SID]: {
        messages: ['user', 'runtime-context', 'agent-message', 'prefill', 'time-context'],
        sections: ['harness:identity', 'tool:bash', 'team:policy', 'prefill:persona'],
        contexts: ['working-directory:current', 'team:identity', 'mem:recall'],
        texts: { messages: {}, sections: {}, contexts: {} },
      },
    },
  },
  tools: { sessions: { [SID]: ['read', 'bash', 'spawn_teammate', 'send_message'] } },
  audit: {
    [SID]: [
      { group: 'contexts', name: 'team:identity', count: 3, blockable: true, preview: 'You are the Team Lead' },
      { group: 'contexts', name: 'mem:recall', count: 2, blockable: true, preview: '召回' },
      { group: 'messages', name: 'developer:tool-registry', count: 1, blockable: false, preview: 'tool-addition:spawn_teammate', lastSeq: 41 },
      { group: 'messages', name: 'compact-checkpoint', count: 1, blockable: false },
      { group: 'messages', name: 'agent-message', count: 4, blockable: true },
    ],
  },
})

test('视图：受控档下各来源包的生效值、单条裁决、未归属、审计「处理」、拦截计数', () => {
  const state = { sandbox: { [SID]: { level: 'controlled', rules: [] } } }
  const view = sandboxView(state, SID, sources())
  assert.equal(view.level, 'controlled')
  assert.equal(view.levelFrom, 'session')
  const pack = (id) => view.packs.find((entry) => entry.id === id)
  assert.deepEqual(view.packs.map((entry) => entry.id), ['prefill', 'dsh-core-prompt', 'dsh-core-context', 'agent-teams'])
  assert.equal(pack('prefill').effective, 'allow')
  assert.equal(pack('prefill').locked, true)
  assert.equal(pack('dsh-core-prompt').effective, 'allow')
  assert.equal(pack('agent-teams').effective, 'deny')
  assert.deepEqual(pack('agent-teams').setting, { session: undefined, global: undefined })
  const teamItems = Object.fromEntries(pack('agent-teams').items.map((entry) => [`${entry.group}:${entry.name}`, entry.action]))
  assert.deepEqual(teamItems, { 'sections:team:policy': 'deny', 'contexts:team:identity': 'deny', 'messages:agent-message': 'allow', 'tools:spawn_teammate': 'deny', 'tools:send_message': 'allow' })
  assert.ok(pack('agent-teams').items.find((entry) => entry.name === 'agent-message').shared)
  assert.ok(pack('agent-teams').members.some((member) => member.name === 'team:identity' && member.at?.includes('dsh-experimental-tool-agent-team')))
  assert.deepEqual(view.unassigned.map((entry) => `${entry.group}:${entry.name}:${entry.action}`), ['contexts:mem:recall:deny'])
  assert.equal(view.unassigned[0].preview, '召回')
  const handling = Object.fromEntries(view.audit.map((row) => [row.name, row.handling]))
  assert.deepEqual(handling, { 'team:identity': 'registry', 'mem:recall': 'registry', 'developer:tool-registry': 'direct', 'compact-checkpoint': 'protocol', 'agent-message': 'allowed' })
  assert.equal(view.audit.find((row) => row.name === 'team:identity').packLabel, 'Agent Teams')
  assert.equal(view.audit.find((row) => row.name === 'developer:tool-registry').lastSeq, 41)
  // 拦：team:policy、team:identity、mem:recall、spawn_teammate（直写的 developer:tool-registry 不算）。
  assert.equal(view.blocked, 4)
  // 观察档：全放行，只记录。
  const observe = sandboxView({}, SID, sources())
  assert.equal(observe.level, 'observe')
  assert.equal(observe.levelFrom, 'default')
  assert.equal(observe.blocked, 0)
  assert.equal(observe.packs.find((entry) => entry.id === 'agent-teams').effective, 'allow')
  // 严格档放行 Agent Teams：只有队友消息真的放行，段 / 上下文 / 工具照实显示成被纯净模式拦。
  const strict = sandboxView({ sandbox: { [SID]: { level: 'strict', packs: { 'agent-teams': 'allow' }, rules: [] } } }, SID, sources())
  const strictItems = Object.fromEntries(strict.packs.find((entry) => entry.id === 'agent-teams').items.map((entry) => [entry.name, entry.action]))
  assert.equal(strictItems['agent-message'], 'allow')
  assert.equal(strictItems['team:policy'], 'deny')
  assert.equal(strictItems.spawn_teammate, 'deny')
  assert.equal(strict.audit.find((row) => row.name === 'team:identity').handling, 'strict')
  // 观察到的名字不含用户原话 / 本插件。
  assert.deepEqual(observedFor(SID, sources()).messages, ['agent-message', 'compact-checkpoint', 'developer:tool-registry', 'runtime-context', 'time-context'])
})

test('视图：显式包开关 / 单条另设 / 全局记住都反映出来', () => {
  const state = {
    sandbox: {
      '*': { level: 'controlled', packs: { 'agent-teams': 'allow' }, rules: [] },
      [SID]: { rules: [{ match: { context: 'team:identity', exact: true }, action: 'deny' }, { match: { context: 'mem:recall', exact: true }, action: 'allow' }] },
    },
  }
  const view = sandboxView(state, SID, sources())
  assert.equal(view.levelFrom, 'global')
  const teams = view.packs.find((entry) => entry.id === 'agent-teams')
  assert.deepEqual(teams.setting, { session: undefined, global: 'allow' })
  assert.equal(teams.effective, 'mixed', '包放行但 team:identity 单独拦 ⇒ 混合')
  assert.deepEqual(view.unassigned.map((entry) => entry.action), ['allow'])
  assert.deepEqual(view.rules.session, [{ group: 'contexts', name: 'team:identity', action: 'deny', exact: true }, { group: 'contexts', name: 'mem:recall', action: 'allow', exact: true }])
})

test('左栏「会话沙盒」开关关掉：本会话受控档 / 包开关 / 单条规则不生效，改写 / 严格档 / 旧白名单不动（只改视图）', () => {
  const state = clone(
    migrateSandbox({
      sandbox: {
        [SID]: {
          level: 'controlled',
          own: ['rewrite', 'allow'],
          packs: { 'agent-teams': 'deny' },
          rules: [
            { match: { section: 'prefill:persona', exact: true }, action: 'rewrite', text: '你是宋知夏。' },
            { match: { kind: 'goal', exact: true }, action: 'allow', soft: true },
            { match: { context: 'mem:recall', exact: true }, action: 'deny' },
            { match: { context: 'team:identity', exact: true }, action: 'allow' },
          ],
        },
        strict: { level: 'strict', rules: [{ match: { context: 'x:y', exact: true }, action: 'deny' }] },
      },
      enabled: { [SID]: { inject: false }, strict: { inject: false } },
    }),
  )
  const view = applyEnabled(state)
  const resolved = resolveSandbox(view, SID)
  assert.equal(resolved.level, 'observe')
  assert.deepEqual(resolved.packs, {})
  assert.equal(resolved.blocks.contexts.has('mem:recall'), false)
  assert.equal(resolved.rewrite.sections['prefill:persona'], '你是宋知夏。')
  assert.ok(resolved.messageAllow.has('goal'), '旧白名单（软放行）留着')
  assert.equal(resolveSandbox(view, 'strict').level, 'strict', '严格档归系统提示的接管管')
  // 存储原样。
  assert.equal(resolveSandbox(state, SID).level, 'controlled')
  assert.equal(resolveSandbox(state, SID).blocks.contexts.has('mem:recall'), true)
})

// ── 面板（client.js 的 SandboxSection，切出来用假的 React 跑）──────────────────────

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const harness = (envelope) => makeHarness(envelope, { sid: SID, sources })

const envelopeFor = (state) => ({ state, sandboxView: { [SID]: sandboxView(migrateSandbox(state), SID, sources()) }, injections: sources().injections })

test('面板：点档位 = 写 sandbox[会话].level（严格档不再写 gate pure，gate 里本会话那格摘掉）', async () => {
  const ui = harness(envelopeFor({ gate: { [SID]: 'pass', other: 'replace' }, sandbox: {} }))
  const tree = ui.render()
  const [controlled] = ui.find(tree, (props) => props['data-prefill-sbx-option'] === 'controlled')
  controlled.props.onClick()
  await ui.settle()
  assert.equal(ui.posts.length, 1)
  assert.deepEqual(ui.posts[0].sandbox[SID], { rules: [], level: 'controlled' })
  assert.deepEqual(ui.posts[0].gate, { other: 'replace' }, 'gate 里本会话那格摘掉，别的会话不动')
  assert.equal('sessionAllowKinds' in ui.posts[0] || 'injectionBlocks' in ui.posts[0], false, '不再写旧字段')
  // 写进去的形状读回来生效（normalizeState → migrateSandbox）。
  const after = migrateSandbox({ gate: { [SID]: 'pass', other: 'replace' }, ...ui.posts[0] })
  assert.equal(resolveSandbox(after, SID).level, 'controlled')
  // 严格档 + 写盘镜像：旧字段 gate[会话] = 'pure' 照样镜像出来（退回 0.15.2 还是纯净模式）。
  const strict = harness(envelopeFor({ sandbox: {} }))
  strict.find(strict.render(), (props) => props['data-prefill-sbx-option'] === 'strict')[0].props.onClick()
  await strict.settle()
  const disk = withLegacyMirror(migrateSandbox(strict.posts[0]))
  assert.equal(disk.gate[SID], 'pure')
})

test('面板：来源包 放行 / 拦截 / ⭐ 全局记住 写包开关；单条另设写精确规则；未归属可本会话放行', async () => {
  const ui = harness(envelopeFor({ sandbox: { [SID]: { level: 'controlled', rules: [] } } }))
  let tree = ui.render()
  const [teams] = ui.find(tree, (props) => props['data-prefill-sbx-pack'] === 'agent-teams')
  ui.find(teams, (props) => props['data-prefill-sbx-option'] === 'allow')[0].props.onClick()
  await ui.settle()
  assert.deepEqual(ui.posts.at(-1).sandbox[SID].packs, { 'agent-teams': 'allow' })
  tree = ui.render()
  ui.find(tree, (props) => props['data-prefill-sbx-remember'] === 'agent-teams')[0].props.onClick()
  await ui.settle()
  assert.deepEqual(ui.posts.at(-1).sandbox['*'], { rules: [], packs: { 'agent-teams': 'allow' } })
  // 未归属：本会话放行 = 一条精确 allow（硬放行，盖得过全局 deny）。
  tree = ui.render()
  const [button] = ui.find(tree, (props) => props['data-prefill-sbx-here'] === 'contexts:mem:recall')
  button.props.onClick()
  await ui.settle()
  assert.deepEqual(ui.posts.at(-1).sandbox[SID].rules, [{ match: { context: 'mem:recall', exact: true }, action: 'allow' }])
  // 展开包 → 点单条 → 拦截。
  tree = ui.render()
  const [caret] = ui.find(ui.find(tree, (props) => props['data-prefill-sbx-pack'] === 'agent-teams')[0], (props) => props['aria-expanded'] !== undefined)
  caret.props.onClick()
  tree = ui.render()
  ui.find(tree, (props) => props['data-prefill-sbx-item'] === 'messages:agent-message')[0].props.onClick()
  tree = ui.render()
  const [editor] = ui.find(tree, (props) => props['data-prefill-sbx-item-editor'] === 'messages:agent-message')
  ui.find(editor, (props) => props['data-prefill-sbx-option'] === 'deny')[0].props.onClick()
  await ui.settle()
  assert.deepEqual(ui.posts.at(-1).sandbox[SID].rules.at(-1), { match: { kind: 'agent-message', exact: true }, action: 'deny' })
  // 审计表：直写会话 / 功能通道 两种处理都显示。
  tree = ui.render()
  const audit = ui.find(tree, (props) => typeof props['data-prefill-sbx-audit-row'] === 'string').map((node) => node.props['data-prefill-sbx-audit-row'])
  assert.ok(audit.includes('messages:developer:tool-registry') && audit.includes('messages:compact-checkpoint'))
})

test('审计与闸门同源：DSH 已知消息来源显示 allowed，不算「未归属 / 拦 N」（#29）', () => {
  const input = sources()
  input.audit[SID] = [{ group: 'messages', name: 'model-notice', count: 2, blockable: true, preview: '模型提示' }]
  const view = sandboxView({ sandbox: { [SID]: { level: 'controlled', rules: [] } } }, SID, input)
  const row = view.audit.find((entry) => entry.name === 'model-notice')
  assert.equal(row.action, 'allow')
  assert.equal(row.handling, 'allowed')
  assert.equal(view.unassigned.some((entry) => entry.name === 'model-notice'), false, '已知来源不该出现在未归属')
  assert.equal(view.blocked, 4, '原来的 4 条拦截不变，不把已知来源算进去')
})

test('头部徽章 / 左栏状态：「沙盒 · 受控 拦 N」；文案并进 zh / en；页名改成「会话沙盒」', () => {
  const ui = harness(envelopeFor({ sandbox: { [SID]: { level: 'controlled', rules: [] } } }))
  const summary = ui.mod.sandboxSummary(ui.t, sandboxView({ sandbox: { [SID]: { level: 'controlled', rules: [] } } }, SID, sources()))
  assert.deepEqual(summary, { level: 'controlled', blocked: 4, pending: 1, text: '受控 · 拦 4 · 待归属 1' })
  assert.equal(ui.mod.SBX_TEXT.zh.injectTitle, '会话沙盒')
  assert.ok(src.includes("'data-prefill-badge': 'sandbox'"))
  assert.ok(src.includes('zh: { ...zh, ...SBX_TEXT.zh }, en: { ...en, ...SBX_TEXT.en }'))
  assert.ok(src.includes('h(SandboxSection, { t, sessionId })'))
  for (const key of Object.keys(ui.mod.SBX_TEXT.zh)) assert.ok(key in ui.mod.SBX_TEXT.en, `en 缺 ${key}`)
})
