// 会话沙盒第 2 步（issue #15）：档位（受控档）+ 来源包。
// 重点：受控档「DSH 核心 / 本插件放行、第三方默认拦、未归属拦」，来源包整包放行 / 拦截，
// shared 成员（agent-message、send_message 等和 DSH 子代理同名的）不被档位默认连带，
// 显式规则仍盖过包，严格档放行包 ⇒ 队友消息进白名单；包开关在迁移 / 写盘 / 旧面板写回时都不丢。
import test from 'node:test'
import assert from 'node:assert/strict'
import { decide, migrateSandbox, policyActive, resolveSandbox, withLegacyMirror, withLegacyView } from '../sandbox.js'
import { BUILTIN_PACKS, CORE_KINDS, forbiddenMember, packCatalog, packsOf, sanitizePacks } from '../sandbox-packs.js'
import { blocksFor } from '../injection-audit.js'
import { applyMessageBlocks, step, snapshots } from '../gate.js'

const clone = (value) => JSON.parse(JSON.stringify(value))
const base = (extra = {}) => ({
  version: 2,
  armed: [],
  levers: { probeSection: false, probeContext: false, blockSections: false, blockContexts: false, blockTools: false, blockMessages: false, prefillProbe: false },
  allowKinds: ['user'],
  ...extra,
})
const known = { messages: new Set(), sections: new Set(['harness:identity', 'acme:global']), contexts: new Set(['working-directory:current', 'acme:global-ctx']) }

test('内置包：Agent Teams 的真实名字（DSH 0.2.1-rc.3 源码）+ shared 成员', () => {
  const teams = BUILTIN_PACKS.find((pack) => pack.id === 'agent-teams')
  const names = teams.members.map((member) => member.section ?? member.context ?? member.kind ?? member.tool)
  for (const name of ['team:policy', 'team:identity', 'agent-message', 'spawn_teammate', 'send_message', 'list_agents', 'wait_agent', 'interrupt_agent', 'team_task_create', 'team_task_list', 'team_task_get', 'team_task_update']) {
    assert.ok(names.includes(name), name)
  }
  const shared = teams.members.filter((member) => Array.isArray(member.shared)).map((member) => member.kind ?? member.tool)
  assert.deepEqual(shared.sort(), ['agent-message', 'interrupt_agent', 'list_agents', 'send_message'])
  for (const kind of ['runtime-context', 'time-context', 'skill-catalog', 'agent-instructions', 'goal', 'schedule', 'subagent-settled']) assert.ok(CORE_KINDS.includes(kind), kind)
  // 同一目标命中多个包：具体的在前，同样具体时第三方在前。
  assert.deepEqual(packsOf({}, { kind: 'agent-message' }).map(({ pack }) => pack.id), ['agent-teams', 'dsh-core-context'])
  assert.deepEqual(packsOf({}, { section: 'team:policy' }).map(({ pack }) => pack.id), ['agent-teams'])
  assert.deepEqual(packsOf({}, { section: 'prefill:persona' }), [], '本插件不走包裁决（恒放行）')
})

test('受控档：DSH 核心放行、第三方包默认拦、未归属拦、已登记放行、工具默认放行', () => {
  const state = { sandbox: { s: { level: 'controlled', rules: [] } } }
  const verdict = (target) => decide(state, 's', target, { known })
  assert.deepEqual(verdict({ section: 'team:policy' }), { action: 'deny', by: 'pack', pack: 'agent-teams', scope: 'level' })
  assert.equal(verdict({ context: 'team:identity' }).action, 'deny')
  assert.equal(verdict({ tool: 'spawn_teammate' }).action, 'deny')
  assert.equal(verdict({ tool: 'team_task_list' }).action, 'deny')
  // shared：档位默认不连带（DSH 子代理也用这些名字）。
  assert.deepEqual(verdict({ kind: 'agent-message' }), { action: 'allow', by: 'pack', pack: 'dsh-core-context', scope: 'level' })
  assert.equal(verdict({ tool: 'send_message' }).action, 'allow')
  // DSH 核心。
  assert.equal(verdict({ section: 'harness:identity' }).action, 'allow')
  assert.equal(verdict({ section: 'tool:bash' }).action, 'allow')
  assert.equal(verdict({ context: 'working-directory:current' }).action, 'allow')
  assert.equal(verdict({ kind: 'runtime-context' }).action, 'allow')
  assert.equal(verdict({ kind: 'time-context' }).action, 'allow')
  // 未归属：作用域内注册 / 不认识的来源 ⇒ 拦；全局层登记过的 ⇒ 放行。
  assert.deepEqual(verdict({ context: 'mem:recall' }), { action: 'deny', by: 'level' })
  assert.equal(verdict({ kind: 'acme-note' }).action, 'deny')
  assert.equal(verdict({ section: 'acme:global' }).action, 'allow')
  assert.equal(verdict({ context: 'acme:global-ctx' }).action, 'allow')
  // 工具是「能力」：没进第三方包的不拦。
  assert.equal(verdict({ tool: 'read' }).action, 'allow')
  assert.equal(verdict({ tool: 'memory_search' }).action, 'allow')
  // 恒放行照旧。
  assert.equal(verdict({ kind: 'user' }).action, 'allow')
  assert.equal(verdict({ section: 'prefill:persona' }).action, 'allow')
  assert.equal(verdict({ kind: 'compact-checkpoint' }).by, 'protocol')
  assert.equal(policyActive(state, 's'), true)
  assert.equal(policyActive(state, 'other'), false)
})

test('包开关：整包放行 / 拦截；会话开关盖过全局；显式规则盖过包；shared 成员跟显式开关走', () => {
  const allow = { sandbox: { s: { level: 'controlled', packs: { 'agent-teams': 'allow' }, rules: [] } } }
  for (const target of [{ section: 'team:policy' }, { context: 'team:identity' }, { kind: 'agent-message' }, { tool: 'spawn_teammate' }, { tool: 'send_message' }]) {
    assert.deepEqual(decide(allow, 's', target, { known }), { action: 'allow', by: 'pack', pack: 'agent-teams', scope: 'session' }, JSON.stringify(target))
  }
  // 观察档 + 全局拦 Agent Teams：shared 的 agent-message / send_message 跟着拦（用户显式点的）。
  const deny = { sandbox: { '*': { packs: { 'agent-teams': 'deny' }, rules: [] } } }
  for (const target of [{ section: 'team:policy' }, { kind: 'agent-message' }, { tool: 'send_message' }, { tool: 'wait_agent' }]) {
    assert.deepEqual(decide(deny, 'x', target, { known }), { action: 'deny', by: 'pack', pack: 'agent-teams', scope: 'global' }, JSON.stringify(target))
  }
  assert.equal(decide(deny, 'x', { section: 'harness:identity' }, { known }).action, 'allow')
  assert.equal(decide(deny, 'x', { context: 'mem:recall' }, { known }).action, 'allow', '观察档：未归属只记录')
  // 会话放行盖过全局拦截。
  const both = { sandbox: { '*': { packs: { 'agent-teams': 'deny' }, rules: [] }, s: { packs: { 'agent-teams': 'allow' }, rules: [] } } }
  assert.equal(decide(both, 's', { kind: 'agent-message' }).action, 'allow')
  assert.equal(decide(both, 'other', { kind: 'agent-message' }).action, 'deny')
  // 单条另设（显式规则）盖过包：包拦着，但 team:identity 单独放行；包放行，但 wait_agent 单独拦。
  const item = {
    sandbox: {
      s: {
        level: 'controlled',
        packs: { 'agent-teams': 'deny' },
        rules: [
          { match: { context: 'team:identity', exact: true }, action: 'allow' },
          { match: { tool: 'spawn_teammate', exact: true }, action: 'allow' },
        ],
      },
      t: { packs: { 'agent-teams': 'allow' }, rules: [{ match: { tool: 'wait_agent', exact: true }, action: 'deny' }] },
    },
  }
  assert.equal(decide(item, 's', { context: 'team:identity' }, { known }).action, 'allow')
  assert.equal(decide(item, 's', { section: 'team:policy' }, { known }).action, 'deny')
  assert.equal(decide(item, 's', { tool: 'spawn_teammate' }, { known }).action, 'allow')
  assert.equal(decide(item, 't', { tool: 'wait_agent' }).action, 'deny')
  assert.equal(decide(item, 't', { tool: 'team_task_get' }).action, 'allow')
})

test('闸门阻断名单（blocksFor）：受控档逐条裁决，含 tools；观察档没开关的会话照旧是 BlockSet', () => {
  const state = { sandbox: { s: { level: 'controlled', rules: [{ match: { kind: 'goal', exact: true }, action: 'deny' }] } } }
  const blocks = blocksFor(state, 's', known)
  assert.equal(blocks.sections.has('team:policy'), true)
  assert.equal(blocks.contexts.has('team:identity'), true)
  assert.equal(blocks.contexts.has('mem:recall'), true)
  assert.equal(blocks.contexts.has('working-directory:current'), false)
  assert.equal(blocks.sections.has('harness:identity'), false)
  assert.equal(blocks.sections.has('prefill:persona'), false)
  assert.equal(blocks.messages.has('goal'), true, '显式 deny 照拦')
  assert.equal(blocks.messages.has('agent-message'), false)
  assert.equal(blocks.messages.has('acme-note'), true)
  assert.equal(blocks.tools.has('spawn_teammate'), true)
  assert.equal(blocks.tools.has('read'), false)
  assert.ok(blocks.sections.size > 0 && blocks.contexts.size > 0)
  // 签名随档位变：闸门据此重挂。
  const sig = (value) => JSON.stringify([...value.sections])
  const loose = blocksFor({ sandbox: { s: { level: 'controlled', packs: { 'agent-teams': 'allow' }, rules: [] } } }, 's', known)
  assert.notEqual(sig(blocks), sig(loose))
  assert.equal(loose.sections.has('team:policy'), false)
  // 第 1 步的会话：照旧是名单（tools 为 undefined）。
  const plain = blocksFor({ sandbox: { s: { rules: [{ match: { context: 'team:*' }, action: 'deny' }] } } }, 's', known)
  assert.equal(plain.tools, undefined)
  assert.deepEqual([...plain.contexts], ['team:*'])
  // 严格档的「档位默认拦」不进名单（那部分由 levers 整份接管，和旧纯净模式一致）。
  const strict = blocksFor({ sandbox: { s: { level: 'strict', packs: { 'agent-teams': 'deny' }, rules: [] } } }, 's', known)
  assert.equal(strict.contexts.has('mem:recall'), false)
  assert.equal(strict.contexts.has('team:identity'), true)
})

test('pre-step：受控档丢掉第三方 / 未归属消息，DSH 核心、队友消息、用户原话、本插件照发', () => {
  const state = base({ sandbox: { s: { level: 'controlled', rules: [] } } })
  const api = { readState: () => state, note() {}, rootCtx: undefined }
  const decision = {
    kind: 'enter',
    messages: ['user', 'runtime-context', 'time-context', 'agent-message', 'acme-note', 'prefill', 'goal'].map((kind, index) => ({ id: `m${index}`, source: { kind } })),
  }
  const next = applyMessageBlocks(api, { agent: { id: 's' } }, decision, decision)
  assert.deepEqual(next.messages.map((message) => message.source.kind), ['user', 'runtime-context', 'time-context', 'agent-message', 'prefill', 'goal'])
  // 显式拦 Agent Teams：队友消息也丢。
  const denied = base({ sandbox: { s: { level: 'controlled', packs: { 'agent-teams': 'deny' }, rules: [] } } })
  const out = applyMessageBlocks({ ...api, readState: () => denied }, { agent: { id: 's' } }, decision, decision)
  assert.equal(out.messages.some((message) => message.source.kind === 'agent-message'), false)
})

function fakeRoot(globalSections, globalContexts) {
  const listeners = []
  const entries = (names) => new Map(names.map((name, index) => [name, { order: index }]))
  const layer = { sections: entries(globalSections), contexts: entries(globalContexts) }
  const merged = { sections: new Map([...layer.sections]), contexts: new Map([...layer.contexts]) }
  const sp = {
    layers: { global: layer, merge: (_scope, pick) => pick(merged), peek: () => ({ sections: new Map(), contexts: new Map() }) },
    section: () => () => {},
    context: () => () => {},
  }
  return {
    listeners,
    rootCtx: {
      on(name, fn) {
        listeners.push([name, fn])
        return () => {}
      },
      get: (key) => (key === 'systemPrompt' ? sp : undefined),
    },
  }
}

test('装配：受控档滤掉 Agent Teams 的段 / 上下文 / 工具和未归属的上下文，DSH 核心和本插件照留', async () => {
  const { rootCtx, listeners } = fakeRoot(['harness:identity', 'tool:bash'], ['working-directory:current'])
  const id = 'assemble-controlled'
  let state = base({ sandbox: { [id]: { level: 'controlled', rules: [] } } })
  const api = { readState: () => state, note() {}, latches: new Map(), unlatch() {}, rootCtx }
  await step(api, { agent: { id, ctx: undefined, session: { snapshotEvents: () => [] } }, turn: 1, step: 1 }, { kind: 'enter', messages: [] })
  const [, handler] = listeners.find(([name]) => name === 'system-prompt/assemble')
  const result = {
    sections: ['harness:identity', 'team:policy', 'tool:bash', 'prefill:persona'].map((name) => ({ name, text: name })),
    contexts: ['working-directory:current', 'team:identity', 'mem:recall'].map((name) => ({ name, text: name })),
    tools: ['read', 'bash', 'spawn_teammate', 'send_message', 'team_task_create'].map((name) => ({ name })),
  }
  const run = () => handler({}, { scope: { id } }, async () => clone(result))
  let out = await run()
  assert.deepEqual(out.sections.map((entry) => entry.name), ['harness:identity', 'tool:bash', 'prefill:persona'])
  assert.deepEqual(out.contexts.map((entry) => entry.name), ['working-directory:current'])
  assert.deepEqual(out.tools.map((tool) => tool.name), ['read', 'bash', 'send_message'])
  // 放行整包：全回来（未归属的 mem:recall 仍拦）。
  state = base({ sandbox: { [id]: { level: 'controlled', packs: { 'agent-teams': 'allow' }, rules: [] } } })
  out = await run()
  assert.deepEqual(out.sections.map((entry) => entry.name), ['harness:identity', 'team:policy', 'tool:bash', 'prefill:persona'])
  assert.deepEqual(out.contexts.map((entry) => entry.name), ['working-directory:current', 'team:identity'])
  assert.deepEqual(out.tools.map((tool) => tool.name), ['read', 'bash', 'spawn_teammate', 'send_message', 'team_task_create'])
  // 观察档没开关：什么都不滤（和第 1 步一样）。
  state = base({ sandbox: { [id]: { level: 'observe', rules: [] } } })
  out = await run()
  assert.equal(out.tools.length, 5)
  assert.equal(out.contexts.length, 3)
})

test('严格档 + 放行 Agent Teams：队友消息进白名单（不放行就被纯净模式丢）', async () => {
  const run = async (packs) => {
    const id = `strict-${packs ? 'allow' : 'none'}`
    const state = base({ sandbox: { [id]: { level: 'strict', ...(packs ? { packs } : {}), rules: [] } } })
    const api = { readState: () => state, note() {}, latches: new Map(), unlatch() {}, rootCtx: undefined }
    const agent = { id, ctx: { get: () => undefined }, session: { snapshotEvents: () => [] } }
    const decision = { kind: 'enter', messages: ['agent-message', 'goal', 'user'].map((kind, index) => ({ id: `k${index}`, role: 'user', source: { kind }, content: [] })) }
    const out = await step(api, { agent, turn: 1, step: 1 }, applyMessageBlocks(api, { agent }, decision, decision))
    return { kinds: out.messages.map((message) => message.source.kind), snap: snapshots()[id] }
  }
  assert.deepEqual((await run()).kinds, ['user'])
  const allowed = await run({ 'agent-teams': 'allow' })
  assert.deepEqual(allowed.kinds, ['agent-message', 'user'])
  assert.ok(allowed.snap.allowed.includes('agent-message'))
  assert.ok(resolveSandbox(base({ sandbox: { s: { level: 'strict', packs: { 'agent-teams': 'allow' }, rules: [] } } }), 's').messageAllow.has('agent-message'))
})

test('包开关不丢：迁移 / 写盘镜像往返 / 旧面板写回别的旧字段 都保留；不镜像进旧字段', () => {
  const state = base({ sandbox: { s: { level: 'controlled', packs: { 'agent-teams': 'allow', bogus: 'maybe' }, rules: [] }, '*': { packs: { 'dsh-core-prompt': 'deny' }, rules: [] } } })
  const mem = clone(migrateSandbox(state))
  assert.deepEqual(mem.sandbox.s.packs, { 'agent-teams': 'allow' })
  assert.deepEqual(mem.sandbox['*'], { rules: [], packs: { 'dsh-core-prompt': 'deny' } })
  const disk = clone(withLegacyMirror(mem))
  assert.equal(disk.injectionBlocks, undefined, '包不镜像进旧字段（0.15.2 没有包的概念）')
  assert.deepEqual(clone(migrateSandbox(disk)).sandbox, mem.sandbox)
  // 旧面板写回 sessionAllowKinds / injectionBlocks（不带指纹）：整族吸收，包开关不动。
  const view = withLegacyView(mem)
  const panel = clone(migrateSandbox({ ...mem, sessionAllowKinds: { ...view.sessionAllowKinds, s: ['goal'] }, injectionBlocks: { s: { messages: ['acme-note'] } } }))
  assert.deepEqual(panel.sandbox.s.packs, { 'agent-teams': 'allow' })
  assert.equal(panel.sandbox.s.level, 'controlled')
  // 只有包开关的作用域也算配置（不会被当成空作用域删掉）。
  assert.deepEqual(clone(migrateSandbox({ sandbox: { x: { packs: { 'agent-teams': 'deny' } } } })).sandbox, { x: { rules: [], packs: { 'agent-teams': 'deny' } } })
})

test('用户挂上的包（state.sandboxPacks）：冒充本插件 / DSH 核心的成员剔掉；内置核心包可手动加成员', () => {
  assert.equal(forbiddenMember({ section: 'prefill:persona' }), 'self')
  assert.equal(forbiddenMember({ section: 'harness:identity', exact: true }), 'core')
  assert.equal(forbiddenMember({ section: 'harness:*' }), 'core')
  assert.equal(forbiddenMember({ kind: 'runtime-context' }), 'core')
  assert.equal(forbiddenMember({ context: '*' }), 'too-broad')
  assert.equal(forbiddenMember({ context: 'mem:recall' }), undefined)
  const packs = sanitizePacks({
    '@acme/dsh-memory': {
      label: '记忆召回',
      plugin: '@acme/dsh-memory',
      members: [{ context: 'mem:recall' }, { section: 'mem:policy' }, { tool: 'memory_search' }, { section: 'prefill:persona' }, { kind: 'runtime-context' }, { section: 'harness:*' }],
      source: { via: 'trace', confirmed: false },
    },
    'dsh-core-context': { members: [{ context: 'acme:core-ish' }] },
    prefill: { members: [{ section: 'x' }] },
    empty: { members: [{ section: 'prefill:x' }] },
  })
  assert.deepEqual(Object.keys(packs).sort(), ['@acme/dsh-memory', 'dsh-core-context'])
  assert.deepEqual(packs['@acme/dsh-memory'].members, [{ context: 'mem:recall', exact: true }, { section: 'mem:policy', exact: true }, { tool: 'memory_search', exact: true }])
  assert.equal(packs['@acme/dsh-memory'].source.confirmed, true, '挂进表里的都是用户确认过的')
  const state = { sandboxPacks: packs, sandbox: { s: { level: 'controlled', rules: [] }, t: { level: 'controlled', packs: { '@acme/dsh-memory': 'allow' }, rules: [] } } }
  assert.equal(packCatalog(state).find((pack) => pack.id === 'dsh-core-context').members.some((member) => member.context === 'acme:core-ish'), true)
  assert.deepEqual(decide(state, 's', { context: 'mem:recall' }, { known }), { action: 'deny', by: 'pack', pack: '@acme/dsh-memory', scope: 'level' })
  assert.equal(decide(state, 't', { tool: 'memory_search' }, { known }).action, 'allow')
  assert.equal(decide(state, 's', { context: 'acme:core-ish' }, { known }).action, 'allow', '手动挂到 DSH 核心包 ⇒ 受控档放行')
})
