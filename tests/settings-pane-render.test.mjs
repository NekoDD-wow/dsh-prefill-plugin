// PR1（公开 issue #44）：左侧栏设置页的行为测试 —— 用 tests/settings-harness.mjs 真渲染。
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeSettingsHarness } from './settings-harness.mjs'

const envelope = (ui = {}) => ({
  ok: true,
  state: {
    version: 2,
    armed: ['s2', 'gone'],
    levers: { probeSection: false, probeContext: false, blockSections: false, blockContexts: false, blockTools: false, blockMessages: false },
    allowKinds: ['user'],
    tools: null,
    ui: { motion: 'lite', ...ui },
    activePreset: { s1: 'builtin:pure' },
  },
  tools: { catalog: ['read', 'bash'], sessions: { s1: ['read'], s2: [] } },
  turns: { s1: 3 },
  sandboxView: { s1: {}, s3: {} },
  snapshots: {},
  injections: { catalog: { messages: ['runtime-context'] } },
})

const bySession = (tree, h, id) => h.find(tree, (props) => props['data-prefill-armed-session'] === id)[0]

test('渲染：开发者区默认折叠；展开后生效会话勾选框 = 在册会话 + 已 armed 的离线会话 + 通配行', async () => {
  const h = makeSettingsHarness(envelope())
  h.render()
  await h.settle()
  let tree = h.render()
  assert.equal(h.find(tree, (props) => typeof props['data-prefill-armed-session'] === 'string').length, 0, '折叠时不渲染生效会话')
  h.find(tree, (props) => props['data-prefill-dev-toggle'] !== undefined)[0].props.onClick()
  tree = h.render()
  const boxes = h.find(tree, (props) => typeof props['data-prefill-armed-session'] === 'string')
  assert.deepEqual(boxes.map((node) => node.props['data-prefill-armed-session']), ['gone', 's1', 's2', 's3', '*'])
  assert.deepEqual(boxes.filter((node) => node.props.checked === true).map((node) => node.props['data-prefill-armed-session']).sort(), ['gone', 's2'])
  assert.equal(h.find(tree, (props) => props['data-prefill-dev-toggle'] !== undefined)[0].props['data-prefill-dev-toggle'], 'open')
  assert.equal(h.find(tree, (props) => props['data-prefill-toggle'] !== undefined).length, 6, '展开后渲染 6 个探针开关')
  assert.equal(h.find(tree, (props, node) => node.type === 'pre').length, 0, '状态 JSON 默认收起（#45 PR D）')
  assert.equal(h.find(tree, (props) => props['data-prefill-state-json-toggle'] !== undefined).length, 1, '展开后有「展开状态 JSON」按钮')
})

test('展开开发者区：6 个探针开关 + 运行状态出现', async () => {
  const h = makeSettingsHarness(envelope())
  h.render()
  await h.settle()
  let tree = h.render()
  h.find(tree, (props) => props['data-prefill-dev-toggle'] !== undefined)[0].props.onClick()
  tree = h.render()
  assert.equal(h.find(tree, (props) => props['data-prefill-dev-toggle'] !== undefined)[0].props['data-prefill-dev-toggle'], 'open')
  assert.equal(h.find(tree, (props) => props['data-prefill-toggle'] !== undefined).length, 6)
  assert.equal(h.find(tree, (props) => props['data-prefill-state-json-copy'] !== undefined).length, 1, '运行状态卡有「复制 JSON」')
})

test('勾选生效会话：写入 armed + 广播 STATE_EVENT + 报 ok', async () => {
  const h = makeSettingsHarness(envelope())
  h.render()
  await h.settle()
  let tree = h.render()
  h.find(tree, (props) => props['data-prefill-dev-toggle'] !== undefined)[0].props.onClick()
  tree = h.render()
  bySession(tree, h, 's1').props.onChange({ target: { checked: true } })
  await h.settle()
  const last = h.fetches.at(-1)
  assert.deepEqual([...last.body.armed].sort(), ['gone', 's1', 's2'])
  assert.equal(h.stateEvents.length, 1, '写完要广播，卡片才会刷新')
  assert.deepEqual(h.okDetails().map((detail) => detail.key), ['armed:s1'])
})

test('监听 STATE_EVENT：外部变化会重拉状态并刷新草稿', async () => {
  const h = makeSettingsHarness(envelope())
  h.render()
  await h.settle()
  const before = h.fetches.length
  h.emitStateEvent()
  await h.settle()
  assert.ok(h.fetches.length > before, 'STATE_EVENT 触发重拉')
  assert.ok(h.motionPrefs.includes('lite'), '重拉时同步动效偏好')
})

test('写入失败：错误 pill 带 key；同一操作后来成功 ⇒ 收起', async () => {
  const h = makeSettingsHarness(envelope())
  h.render()
  await h.settle()
  let tree = h.render()
  h.find(tree, (props) => props['data-prefill-dev-toggle'] !== undefined)[0].props.onClick()
  tree = h.render()
  h.setFailNext()
  bySession(tree, h, 's3').props.onChange({ target: { checked: true } })
  await h.settle()
  tree = h.render()
  assert.deepEqual(h.find(tree, (props) => typeof props['data-prefill-error-pill'] === 'string').map((node) => node.props['data-prefill-error-pill']), ['armed:s3'])
  assert.deepEqual(h.failDetails().map((detail) => detail.key), ['armed:s3'])
  bySession(tree, h, 's3').props.onChange({ target: { checked: true } })
  await h.settle()
  tree = h.render()
  assert.equal(h.find(tree, (props) => typeof props['data-prefill-error-pill'] === 'string').length, 0, '成功收起同一 key 的错误')
})

test('恢复默认：在开发者区里，两步确认后才写入（armed 清空、探针全关、工具全放行）', async () => {
  const h = makeSettingsHarness(envelope())
  h.render()
  await h.settle()
  let tree = h.render()
  // issue #45 第 14 条：它只重置开发者区的东西，收进开发者折叠区。
  assert.equal(h.find(tree, (props) => props['data-prefill-reset'] !== undefined).length, 0, '折叠时不显示')
  h.find(tree, (props) => props['data-prefill-dev-toggle'] !== undefined)[0].props.onClick()
  tree = h.render()
  const resetNode = () => h.find(tree, (props) => props['data-prefill-reset'] !== undefined)[0]
  resetNode().props.onClick()
  await h.settle()
  tree = h.render()
  assert.equal(resetNode().props['data-prefill-confirm'], 'true', '第一次点只进入待确认')
  assert.equal(h.fetches.some((entry) => Array.isArray(entry.body?.armed) && entry.body.armed.length === 0), false, '待确认时不写')
  resetNode().props.onClick()
  await h.settle()
  const body = h.fetches.at(-1).body
  assert.deepEqual(body.armed, [])
  assert.equal(body.levers.blockMessages, false)
  assert.deepEqual(body.allowKinds, ['user'])
  assert.equal(body.tools, null)
})

// ── PR2：新会话默认 / 偏好搬到左侧页 ─────────────────────────────────────────

const pr2Envelope = () => ({
  ok: true,
  state: {
    version: 2,
    armed: [],
    levers: { probeSection: false, probeContext: false, blockSections: false, blockContexts: false, blockTools: false, blockMessages: false },
    allowKinds: ['user'],
    tools: null,
    ui: { motion: 'full' },
    everyTurn: {
      s1: { enabled: true, text: '会话提醒', firstText: '', mode: 'always', checks: ['zh'] },
      '*': { enabled: true, text: '默认提醒', firstText: '默认首轮', mode: 'until', untilTurn: 5, checks: ['zh'], auto: { warmup: 3, streak: 3, probation: 2 } },
    },
    sandbox: { '*': { level: 'controlled', packs: { 'agent-teams': 'deny' } } },
  },
  tools: { catalog: [], sessions: {} },
  sandboxView: {
    '*': {
      level: 'controlled',
      levelFrom: 'global',
      packs: [
        { id: 'agent-teams', label: 'Agent Teams', locked: false, setting: { global: 'deny' } },
        { id: 'prefill', label: '本插件', locked: true, setting: {} },
      ],
    },
  },
  injections: { catalog: { messages: [] } },
})

test('PR2：新会话默认（每轮注入）渲染 + 保存写 everyTurn[*]，别的会话原样带上', async () => {
  const h = makeSettingsHarness(pr2Envelope())
  h.render()
  await h.settle()
  let tree = h.render()
  assert.equal(h.find(tree, (props) => props['data-prefill-default-turn-enabled'] !== undefined)[0].props.checked, true)
  assert.equal(h.find(tree, (props) => props['data-prefill-default-turn-text'] !== undefined)[0].props.value, '默认提醒')
  assert.equal(h.find(tree, (props) => props['data-prefill-default-turn-first'] !== undefined)[0].props.value, '默认首轮')
  assert.equal(h.find(tree, (props) => props['data-prefill-default-turn-until'] !== undefined)[0].props.value, '5')
  h.find(tree, (props) => props['data-prefill-default-turn-text'] !== undefined)[0].props.onChange({ target: { value: '新的默认' } })
  tree = h.render()
  h.find(tree, (props) => props['data-prefill-default-turn-mode'] === 'always')[0].props.onClick()
  tree = h.render()
  assert.equal(h.find(tree, (props) => props['data-prefill-default-turn-until'] !== undefined).length, 0, '切 always 后不再显示轮数')
  h.find(tree, (props) => props['data-prefill-default-turn-save'] !== undefined)[0].props.onClick()
  await h.settle()
  const body = h.fetches.at(-1).body
  assert.equal(body.everyTurn['*'].text, '新的默认')
  assert.equal(body.everyTurn['*'].mode, 'always')
  assert.equal(body.everyTurn['*'].untilTurn, 0)
  assert.equal(body.everyTurn.s1.text, '会话提醒', '别的会话原样带上，不被清掉')
})

test('PR2：新会话默认（沙盒）写 sandbox[*] 的档位与包开关', async () => {
  const h = makeSettingsHarness(pr2Envelope())
  h.render()
  await h.settle()
  let tree = h.render()
  h.find(tree, (props) => props['data-prefill-default-sbx-level'] === 'observe')[0].props.onClick()
  await h.settle()
  assert.equal(h.fetches.at(-1).body.sandbox['*'].level, 'observe')
  tree = h.render()
  h.find(tree, (props) => props['data-prefill-default-pack-allow'] === 'agent-teams')[0].props.onClick()
  await h.settle()
  assert.deepEqual(h.fetches.at(-1).body.sandbox['*'].packs, { 'agent-teams': 'allow' })
  tree = h.render()
  h.find(tree, (props) => props['data-prefill-default-pack-clear'] === 'agent-teams')[0].props.onClick()
  await h.settle()
  assert.equal(h.fetches.at(-1).body.sandbox['*'].packs, undefined)
})

test('PR2：偏好（动效 + 重置「不再提示」）写 state.ui', async () => {
  const h = makeSettingsHarness(pr2Envelope())
  h.render()
  await h.settle()
  let tree = h.render()
  h.find(tree, (props) => props['data-prefill-pref-motion'] === 'lite')[0].props.onClick()
  await h.settle()
  assert.deepEqual(h.fetches.at(-1).body.ui, { motion: 'lite' })
  tree = h.render()
  h.find(tree, (props) => props['data-prefill-pref-motion'] === 'auto')[0].props.onClick()
  await h.settle()
  assert.deepEqual(h.fetches.at(-1).body.ui, { motion: null })
  tree = h.render()
  h.find(tree, (props) => props['data-prefill-pref-reset-noask'] !== undefined)[0].props.onClick()
  await h.settle()
  assert.equal(h.fetches.at(-1).body.ui.loreConstWarn, false)
})

// ── PR3：跨会话总览 + 双向跳转 ───────────────────────────────────────────────

const pr3Envelope = () => {
  const base = pr2Envelope()
  return {
    ...base,
    state: { ...base.state, activePreset: { s1: 'pack:我的预设' } },
    tools: { catalog: [], sessions: { s1: ['read'], s2: [] } },
    turns: { s1: 4 },
    manualQueued: { s1: 2 },
    sandboxView: { ...base.sandboxView, s1: { level: 'controlled', blocked: 3 } },
  }
}

test('PR3：总览列出在册会话 + 当前配置；「打开」走 openSessionAndCard', async () => {
  const h = makeSettingsHarness(pr3Envelope())
  h.render()
  await h.settle()
  const tree = h.render()
  const rows = h.find(tree, (props) => typeof props['data-prefill-overview-row'] === 'string')
  assert.deepEqual(rows.map((node) => node.props['data-prefill-overview-row']), ['s1', 's2'])
  const text = JSON.stringify(rows[0].children)
  assert.match(text, /pack:我的预设/)
  assert.match(text, /sbxLevelControlled/, '沙盒档位按 key 渲染（harness 的 t 返回 key）')
  assert.match(text, /overviewManual/)
  h.find(tree, (props) => props['data-prefill-overview-open'] === 's1')[0].props.onClick()
  assert.deepEqual(h.sessionOpens, ['s1'], '「打开」= 切会话 + 弹卡片（openSessionAndCard）')
})

test('PR3：左侧页的可定位锚点（#45 PR D 加了实验 / 开发者）；卡片「改默认 ↗」走 openPrefillPanel', async () => {
  const h = makeSettingsHarness(pr3Envelope())
  h.render()
  await h.settle()
  const tree = h.render()
  const anchors = h.find(tree, (props) => typeof props['data-prefill-anchor'] === 'string').map((node) => node.props['data-prefill-anchor'])
  assert.deepEqual(anchors.sort(), ['default-everyturn', 'default-sandbox', 'dev', 'experimental', 'library', 'overview', 'prefs', 'reasoning'])
  assert.equal(h.panelOpens.length, 0, '卡片侧按钮不在左侧页里，这里不触发')
})

// ── PR4：库管理搬到左侧页 ───────────────────────────────────────────────────

const pr4Routes = {
  '/api/dsh-prefill/packs': (body) => {
    if (body?.op === 'list') {
      return { ok: true, packs: [{ name: '我的预设', count: 2 }], blocks: [{ id: 'b1', name: '我的块' }], towers: [{ id: 't1', name: '我的塔' }], hiddenBuiltins: ['builtin-x'] }
    }
    if (body?.op === 'get') return { ok: true, pack: { name: body.name, items: [] } }
    return { ok: true }
  },
  '/api/dsh-prefill/cards': (body) => {
    if (body?.op === 'list') return { ok: true, cards: [{ id: 'c1', name: '小卡', hasAvatar: true }] }
    return { ok: true }
  },
}

test('PR4：库列出预设 / 角色卡 / 积木 / 塔 / 隐藏内置（按会话定位工作区）', async () => {
  const h = makeSettingsHarness(pr3Envelope(), { routes: pr4Routes })
  h.render()
  await h.settle()
  h.render() // envelope 到了以后 effect 才会带着会话重新加载库
  await h.settle()
  const tree = h.render()
  const ids = (attr) => h.find(tree, (props) => typeof props[attr] === 'string').map((node) => node.props[attr])
  assert.deepEqual(ids('data-prefill-lib-pack'), ['我的预设'])
  assert.deepEqual(ids('data-prefill-lib-card'), ['c1'])
  assert.deepEqual(ids('data-prefill-lib-block'), ['b1'])
  assert.deepEqual(ids('data-prefill-lib-tower'), ['t1'])
  assert.deepEqual(ids('data-prefill-lib-hidden'), ['builtin-x'])
  assert.equal(h.find(tree, (props) => props['data-prefill-lib-session'] !== undefined)[0].props.value, 's1')
})

test('PR4：删除预设 / 找回内置都写回对应路由（删除两步确认）', async () => {
  const h = makeSettingsHarness(pr3Envelope(), { routes: pr4Routes })
  h.render()
  await h.settle()
  h.render()
  await h.settle()
  let tree = h.render()
  h.find(tree, (props) => props['data-prefill-lib-pack-delete'] === '我的预设')[0].props.onClick()
  tree = h.render()
  assert.equal(h.fetches.filter((entry) => entry.body?.op === 'delete').length, 0, '第一次点只进入待确认')
  h.find(tree, (props) => props['data-prefill-lib-pack-delete'] === '我的预设')[0].props.onClick()
  await h.settle()
  const del = h.fetches.filter((entry) => entry.path === '/api/dsh-prefill/packs' && entry.body?.op === 'delete').at(-1)
  assert.equal(del.body.name, '我的预设')
  assert.equal(del.body.sessionId, 's1')
  tree = h.render()
  h.find(tree, (props) => props['data-prefill-lib-unhide'] === 'builtin-x')[0].props.onClick()
  await h.settle()
  const unhide = h.fetches.filter((entry) => entry.body?.op === 'hidden-set').at(-1)
  assert.deepEqual(unhide.body.ids, [])
})

// ── 美化：会话标题优先，id 退为副行 ──────────────────────────────────────────

const flattenText = (node, out = []) => {
  if (node === null || node === undefined) return out
  if (typeof node === 'string') {
    out.push(node)
    return out
  }
  if (Array.isArray(node)) {
    for (const entry of node) flattenText(entry, out)
    return out
  }
  if (typeof node === 'object') {
    for (const child of node.children ?? []) flattenText(child, out)
  }
  return out
}

test('总览与生效会话优先显示会话标题；拿不到标题时退回 id', async () => {
  const h = makeSettingsHarness(envelope(), { titleOf: (id) => (id === 's1' ? '研究 RikkaHub 提示词' : '') })
  h.render()
  await h.settle()
  let tree = h.render()
  const texts = flattenText(tree)
  assert.ok(texts.includes('研究 RikkaHub 提示词'), '总览里应出现标题')
  const overviewRow = h.find(tree, (props) => props['data-prefill-overview-row'] === 's1')[0]
  assert.ok(overviewRow, '总览行存在')
  assert.deepEqual(flattenText(overviewRow).filter((text) => text === 's1'), ['s1'], 'id 仍作为副行显示')
  h.find(tree, (props) => props['data-prefill-dev-toggle'] !== undefined)[0].props.onClick()
  tree = h.render()
  const armedRow = h.find(tree, (props) => props['data-prefill-armed-row'] === 's1')[0]
  assert.ok(flattenText(armedRow).includes('研究 RikkaHub 提示词'), '生效会话里也应显示标题')
  // 没有标题的会话退回 id（s2 的 titleOf 返回空）
  const armedS2 = h.find(tree, (props) => props['data-prefill-armed-row'] === 's2')[0]
  assert.ok(flattenText(armedS2).includes('s2'))
})

// ── 实验：思考前缀（DeepSeek Beta）UI ───────────────────────────────────────

const reasoningStatus = () => ({
  ok: true,
  enabled: false,
  proxyRunning: false,
  port: 46321,
  config: { prefix: '他喵测试前缀', contentPrefix: '内容前缀测试', providerId: 'prefill-think', modelId: 'deepseek-flash' },
  catalog: { tools: 15, bytes: 6622 },
  hasApiKey: true,
  failures: 0,
  proxyError: null,
  route: {
    ok: true,
    error: null,
    at: 0,
    providerId: 'prefill-think',
    modelId: 'deepseek-flash',
    displayName: 'DeepSeek（思考前缀）',
    modelName: 'DeepSeek Flash（思考前缀）',
    port: 46321,
    baseURL: 'http://127.0.0.1:46321/beta/v1',
    inConfig: true,
  },
  audit: [],
})

test('实验区：显示状态（工具清单 / 密钥）并可保存前缀启用', async () => {
  const h = makeSettingsHarness(envelope({ experimental: true }), {
    routes: {
      '/api/dsh-prefill/reasoning/status': reasoningStatus,
      '/api/dsh-prefill/reasoning/enable': () => ({ ...reasoningStatus(), enabled: true, proxyRunning: true }),
    },
  })
  h.render()
  await h.settle()
  let tree = h.render()
  const card = h.find(tree, (props) => props['data-prefill-reasoning'] !== undefined)[0]
  assert.ok(card, '实验卡片存在')
  const text = flattenText(card).join(' ')
  assert.match(text, /reasoningCatalogValue/)
  assert.match(text, /reasoningKeyReady/)
  assert.match(text, /reasoningOff/)
  const input = h.find(tree, (props) => props['data-prefill-reasoning-prefix'] !== undefined)[0]
  assert.equal(input.props.value, '他喵测试前缀', '状态里的前缀回填到输入框')
  const contentInput = h.find(tree, (props) => props['data-prefill-reasoning-content-prefix'] !== undefined)[0]
  assert.equal(contentInput.props.value, '内容前缀测试', '状态里的内容前缀回填到输入框')
  assert.match(text, /reasoningContentPrefixHint/, '内容前缀旁说明「只返回续写部分」')
  // issue #45 第 15 条：会起代理、写模型路由 ⇒ 两步确认。
  h.find(tree, (props) => props['data-prefill-reasoning-enable'] !== undefined)[0].props.onClick()
  tree = h.render()
  assert.equal(h.posts.filter((entry) => entry.path === '/api/dsh-prefill/reasoning/enable').length, 0, '第一下只进入待确认')
  h.find(tree, (props) => props['data-prefill-reasoning-enable'] !== undefined)[0].props.onClick()
  await h.settle()
  const enabled = h.posts.filter((entry) => entry.path === '/api/dsh-prefill/reasoning/enable')
  assert.equal(enabled.length, 1)
  assert.deepEqual(enabled[0].body, { prefix: '他喵测试前缀', contentPrefix: '内容前缀测试' })
  tree = h.render()
  const after = flattenText(h.find(tree, (props) => props['data-prefill-reasoning'] !== undefined)[0]).join(' ')
  assert.match(after, /reasoningOn/)
  assert.ok(h.find(tree, (props) => props['data-prefill-reasoning-disable'] !== undefined).length > 0, '启用后出现停用按钮')
})


test('实验性功能总开关：关着时实验区只留开关，思考前缀被门禁（v0.20.2）', async () => {
  const h = makeSettingsHarness(envelope())
  h.render()
  await h.settle()
  let tree = h.render()
  const toggle = () => h.find(tree, (props) => props['data-prefill-experimental-toggle'] !== undefined)[0]
  assert.ok(toggle(), '总开关存在')
  assert.equal(toggle().props['data-prefill-experimental-toggle'], 'off')
  const reasoningCard = h.find(tree, (props) => props['data-prefill-reasoning'] !== undefined)[0]
  const cardText = flattenText(reasoningCard).join(' ')
  assert.match(cardText, /expOffNote/, '关闭时思考前缀卡片给门禁提示')
  assert.equal(h.find(tree, (props) => props['data-prefill-reasoning-enable'] !== undefined).length, 0, '关闭时没有启用按钮')
  // 打开总开关：打 toggle 路由，随后重拉整封信
  h.find(tree, (props) => props['data-prefill-experimental-toggle'] !== undefined)[0].props.onClick()
  await h.settle()
  const posts = h.posts.filter((entry) => entry.path === '/api/dsh-prefill/experimental/toggle')
  assert.equal(posts.length, 1)
  assert.deepEqual(posts[0].body, { on: true })
})

test('实验性功能总开关：开着时实验区可用、思考前缀卡片完整渲染', async () => {
  const h = makeSettingsHarness(envelope({ experimental: true }), {
    routes: { '/api/dsh-prefill/reasoning/status': () => ({ ...reasoningStatus(), enabled: false }) },
  })
  h.render()
  await h.settle()
  const tree = h.render()
  const toggle = h.find(tree, (props) => props['data-prefill-experimental-toggle'] !== undefined)[0]
  assert.equal(toggle.props['data-prefill-experimental-toggle'], 'on')
  assert.ok(h.find(tree, (props) => props['data-prefill-reasoning-enable'] !== undefined).length > 0, '开着时出现启用按钮')
  assert.equal(h.find(tree, (props) => props['data-prefill-reasoning-gated'] !== undefined).length, 0, '不渲染门禁提示')
})

test('实验区：缺 DEEPSEEK_API_KEY 时给提示', async () => {
  const h = makeSettingsHarness(envelope({ experimental: true }), {
    routes: { '/api/dsh-prefill/reasoning/status': () => ({ ...reasoningStatus(), hasApiKey: false }) },
  })
  h.render()
  await h.settle()
  const tree = h.render()
  const card = h.find(tree, (props) => props['data-prefill-reasoning'] !== undefined)[0]
  const text = flattenText(card).join(' ')
  assert.match(text, /reasoningKeyMissing/)
  const warns = h.find(tree, () => true).filter((node) => flattenText(node).join(' ').includes('reasoningNoKey'))
  assert.ok(warns.length > 0, '缺 key 时给出提示')
})

test('实验区：模型路由写没写、在不在配置里、代理在不在跑都要摆在台面上（v0.20.1）', async () => {
  const enabled = () => ({ ...reasoningStatus(), enabled: true, proxyRunning: true })
  const h = makeSettingsHarness(envelope({ experimental: true }), {
    routes: {
      '/api/dsh-prefill/reasoning/status': enabled,
      '/api/dsh-prefill/reasoning/repair': () => ({ ...enabled(), applied: { ok: true } }),
    },
  })
  h.render()
  await h.settle()
  let tree = h.render()
  const card = () => h.find(tree, (props) => props['data-prefill-reasoning'] !== undefined)[0]
  const text = flattenText(card()).join(' ')
  assert.match(text, /reasoningRouteLabel/, '显示模型路由一行')
  assert.match(text, /reasoningRouteOk/, '路由已写入')
  assert.match(text, /deepseek-flash/, '显示实际模型 id')
  assert.ok(h.find(tree, (props) => props['data-prefill-reasoning-repair'] !== undefined).length > 0, '启用后有「修复路由」按钮')
  // 点修复 ⇒ 打 repair 路由
  h.find(tree, (props) => props['data-prefill-reasoning-repair'] !== undefined)[0].props.onClick()
  await h.settle()
  assert.equal(h.posts.filter((entry) => entry.path === '/api/dsh-prefill/reasoning/repair').length, 1)
  // 路由从配置里消失 ⇒ 明确警告 + 修复提示
  const missing = makeSettingsHarness(envelope({ experimental: true }), {
    routes: { '/api/dsh-prefill/reasoning/status': () => ({ ...enabled(), route: { ...reasoningStatus().route, ok: false, error: 'nope', inConfig: false } }) },
  })
  missing.render()
  await missing.settle()
  tree = missing.render()
  const missingText = flattenText(tree).join(' ')
  assert.match(missingText, /reasoningRouteBroken/)
  assert.match(missingText, /reasoningRouteNotInConfig/)
})

test('实验区：代理没起来 / applied.ok=false ⇒ 警告与错误 pill，不再假装成功', async () => {
  const down = () => ({
    ...reasoningStatus(),
    enabled: true,
    proxyRunning: false,
    proxyError: 'listen EADDRINUSE 127.0.0.1:46321',
    applied: { ok: false, enabled: true, proxyRunning: false, error: 'listen EADDRINUSE' },
  })
  const h = makeSettingsHarness(envelope({ experimental: true }), {
    routes: {
      '/api/dsh-prefill/reasoning/status': down,
      '/api/dsh-prefill/reasoning/enable': down,
    },
  })
  h.render()
  await h.settle()
  let tree = h.render()
  const text = flattenText(tree).join(' ')
  assert.match(text, /reasoningProxyDown/, '代理没跑要警告')
  assert.ok(h.find(tree, (props) => props['data-prefill-reasoning-proxy-down'] !== undefined).length > 0)
  // 点「停用」失败时同理：错误进这一节的 pill
  h.find(tree, (props) => props['data-prefill-reasoning-enable'] !== undefined)[0].props.onClick()
  await h.settle()
  tree = h.render()
  assert.ok(
    h.find(tree, (props) => typeof props['data-prefill-error-pill'] === 'string' && props['data-prefill-error-pill'].startsWith('reasoning:')).length > 0,
    'applied.ok=false 要出现错误 pill',
  )
  const details = h.failDetails().map((detail) => detail.detail ?? '')
  assert.ok(details.some((detail) => String(detail).includes('EADDRINUSE')), '错误详情带上服务端原因')
})

