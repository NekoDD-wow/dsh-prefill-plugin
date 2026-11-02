// 公开 issue #45 PR C（第三节 12–16 条）：左侧栏「预填装」页的操作与反馈 —— 用 tests/settings-harness.mjs 真渲染。
//   12 每轮注入默认的「未保存」标记 + 放弃修改
//   13 就地反馈：每节标题旁的「✓ 已保存」/ 错误 pill（op 写到具体哪一项），页顶不再常驻「已保存」
//   14 「把全局开关恢复默认」挪进开发者折叠区
//   15 思考前缀并入 busy(key) + 错误 pill；STATE_EVENT 时刷新状态；「保存并启用」两步确认、已启用时改「保存前缀」
//   16 总览按「在册 → 最近更新 → 标题」排序、多于 8 个会话给过滤框；库的工作区下拉显示标题并按 cwd 去重；导入按钮键盘可达
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeSettingsHarness } from './settings-harness.mjs'

const baseEnvelope = () => ({
  ok: true,
  state: {
    version: 2,
    armed: [],
    levers: { probeSection: false, probeContext: false, blockSections: false, blockContexts: false, blockTools: false, blockMessages: false },
    allowKinds: ['user'],
    tools: null,
    ui: { motion: 'full' },
    everyTurn: {
      '*': { enabled: true, text: '默认提醒', firstText: '', mode: 'always', checks: [], auto: { warmup: 3, streak: 3, probation: 2 } },
    },
    sandbox: { '*': { level: 'controlled' } },
  },
  tools: { catalog: [], sessions: { s1: [] } },
  sandboxView: {
    '*': { level: 'controlled', packs: [{ id: 'agent-teams', label: 'Agent Teams', locked: false, setting: {} }] },
  },
  injections: { catalog: { messages: [] } },
})

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
  if (typeof node === 'object') for (const child of node.children ?? []) flattenText(child, out)
  return out
}

const boot = async (envelope, options) => {
  const h = makeSettingsHarness(envelope ?? baseEnvelope(), options)
  h.render()
  await h.settle()
  h.render()
  await h.settle()
  return h
}
const one = (h, tree, attr, value) => {
  const nodes = h.find(tree, (props) => (value === undefined ? props[attr] !== undefined : props[attr] === value))
  assert.ok(nodes.length > 0, '找不到 ' + attr + (value === undefined ? '' : '=' + value))
  return nodes[0]
}
const savedIn = (h, node) => h.find(node, (props) => props['data-prefill-section-saved'] !== undefined)
const pillsIn = (h, node) => h.find(node, (props) => typeof props['data-prefill-error-pill'] === 'string')
const head = (h, tree, section) => one(h, tree, 'data-prefill-section-head', section)

// ── 12 ───────────────────────────────────────────────────────────────────────

test('12：每轮注入默认改了没存 ⇒ 标题旁「未保存」+「放弃修改」；放弃回到服务端值', async () => {
  const h = await boot()
  let tree = h.render()
  assert.equal(h.find(tree, (props) => props['data-prefill-default-turn-unsaved'] !== undefined).length, 0, '没改不显示')
  assert.equal(h.find(tree, (props) => props['data-prefill-default-turn-discard'] !== undefined).length, 0)
  one(h, tree, 'data-prefill-default-turn-text').props.onChange({ target: { value: '改了一半' } })
  tree = h.render()
  const marker = one(h, tree, 'data-prefill-default-turn-unsaved')
  assert.deepEqual(flattenText(marker), ['unsaved'])
  assert.equal(h.find(head(h, tree, 'default-everyturn'), (props) => props['data-prefill-default-turn-unsaved'] !== undefined).length, 1, '标记在这一节标题旁')
  one(h, tree, 'data-prefill-default-turn-discard').props.onClick()
  tree = h.render()
  assert.equal(one(h, tree, 'data-prefill-default-turn-text').props.value, '默认提醒', '放弃 ⇒ 回到服务端值')
  assert.equal(h.find(tree, (props) => props['data-prefill-default-turn-unsaved'] !== undefined).length, 0)
})

test('12：改回和服务端一样 ⇒ 不算未保存；保存成功 ⇒ 标记消失、这一节出现「已保存」', async () => {
  const h = await boot()
  let tree = h.render()
  one(h, tree, 'data-prefill-default-turn-text').props.onChange({ target: { value: '别的' } })
  tree = h.render()
  one(h, tree, 'data-prefill-default-turn-text').props.onChange({ target: { value: '默认提醒' } })
  tree = h.render()
  assert.equal(h.find(tree, (props) => props['data-prefill-default-turn-unsaved'] !== undefined).length, 0, '和服务端一致就不标')
  one(h, tree, 'data-prefill-default-turn-mode', 'until').props.onClick()
  tree = h.render()
  one(h, tree, 'data-prefill-default-turn-unsaved')
  one(h, tree, 'data-prefill-default-turn-until').props.onChange({ target: { value: '3' } })
  tree = h.render()
  one(h, tree, 'data-prefill-default-turn-save').props.onClick()
  await h.settle()
  tree = h.render()
  assert.equal(h.find(tree, (props) => props['data-prefill-default-turn-unsaved'] !== undefined).length, 0, '存完不再标')
  assert.equal(savedIn(h, head(h, tree, 'default-everyturn')).length, 1)
})

// ── 13 ───────────────────────────────────────────────────────────────────────

test('13：写入成功 ⇒ 只在那一节标题旁出现「已保存」，页顶没有常驻状态行', async () => {
  const h = await boot()
  let tree = h.render()
  one(h, tree, 'data-prefill-default-sbx-level', 'observe').props.onClick()
  await h.settle()
  tree = h.render()
  const all = savedIn(h, tree)
  assert.equal(all.length, 1, '整页只有一处「已保存」')
  assert.equal(savedIn(h, head(h, tree, 'default-sandbox')).length, 1, '就在沙盒默认这一节')
  assert.deepEqual(flattenText(all[0]), ['saved'])
  // 再存一次：计数 +1（真组件据此重新冒一次再淡出）。
  one(h, tree, 'data-prefill-default-pack-allow', 'agent-teams').props.onClick()
  await h.settle()
  tree = h.render()
  assert.equal(savedIn(h, head(h, tree, 'default-sandbox'))[0].props['data-prefill-section-saved'], '2')
})

test('13：写入失败 ⇒ 错误 pill 在那一节标题旁，op 写具体哪一项（不是笼统「全局设置」）', async () => {
  const h = await boot()
  let tree = h.render()
  h.setFailNext()
  one(h, tree, 'data-prefill-default-sbx-level', 'observe').props.onClick()
  await h.settle()
  tree = h.render()
  const pills = pillsIn(h, tree)
  assert.equal(pills.length, 1)
  assert.equal(pillsIn(h, head(h, tree, 'default-sandbox')).length, 1, 'pill 在沙盒默认这一节')
  assert.deepEqual(flattenText(pills[0]), ['secDefault · opSbxLevel'])
  assert.deepEqual(h.failDetails().map((detail) => detail.op), ['secDefault · opSbxLevel'])
  assert.equal(savedIn(h, tree).length, 0, '失败不显示已保存')

  h.setFailNext()
  one(h, tree, 'data-prefill-pref-motion', 'off').props.onClick()
  await h.settle()
  tree = h.render()
  assert.deepEqual(flattenText(pillsIn(h, head(h, tree, 'prefs'))[0]), ['prefsTitle · opMotion'])
  assert.equal(pillsIn(h, head(h, tree, 'default-sandbox')).length, 1, '别的节的错误各管各的')

  h.setFailNext()
  one(h, tree, 'data-prefill-default-turn-save').props.onClick()
  await h.settle()
  tree = h.render()
  assert.deepEqual(flattenText(pillsIn(h, head(h, tree, 'default-everyturn'))[0]), ['defaultTurnTitle'])
})

test('13：同一项后来成功 ⇒ 这一节的 pill 收起；点 pill 才展开详情', async () => {
  const h = await boot()
  let tree = h.render()
  h.setFailNext()
  one(h, tree, 'data-prefill-default-sbx-level', 'observe').props.onClick()
  await h.settle()
  tree = h.render()
  assert.equal(h.find(tree, (props) => props['data-prefill-error-detail'] !== undefined).length, 0, '详情默认收起')
  // harness 的 ErrorPill 桩把 onToggle 挂在 pill 上（真组件里是点 pill 的主体）。
  pillsIn(h, head(h, tree, 'default-sandbox'))[0].props.onClick()
  tree = h.render()
  const card = one(h, tree, 'data-prefill-anchor', 'default-sandbox')
  assert.equal(h.find(card, (props) => props['data-prefill-error-detail'] !== undefined).length, 1, '点开后详情在这一节里')
  one(h, tree, 'data-prefill-default-sbx-level', 'observe').props.onClick()
  await h.settle()
  tree = h.render()
  assert.equal(pillsIn(h, tree).length, 0)
  assert.equal(savedIn(h, head(h, tree, 'default-sandbox')).length, 1)
})

test('13：库操作失败 op 写「库 · 删除预设」这一级', async () => {
  const routes = {
    '/api/dsh-prefill/packs': (body) => (body?.op === 'list' ? { ok: true, packs: [{ name: 'P', count: 1 }], blocks: [], towers: [], hiddenBuiltins: [] } : { ok: true }),
    '/api/dsh-prefill/cards': () => ({ ok: true, cards: [] }),
  }
  const h = await boot(undefined, { routes })
  let tree = h.render()
  one(h, tree, 'data-prefill-lib-pack-delete', 'P').props.onClick()
  tree = h.render()
  h.setFailNext()
  one(h, tree, 'data-prefill-lib-pack-delete', 'P').props.onClick()
  await h.settle()
  tree = h.render()
  assert.deepEqual(flattenText(pillsIn(h, head(h, tree, 'library'))[0]), ['libraryTitle · opPackDelete'])
})

// ── 14 ───────────────────────────────────────────────────────────────────────

test('14：「把全局开关恢复默认」在开发者折叠区里，折叠时看不到', async () => {
  const h = await boot()
  let tree = h.render()
  assert.equal(h.find(tree, (props) => props['data-prefill-reset'] !== undefined).length, 0, '折叠时页上没有重置按钮')
  one(h, tree, 'data-prefill-dev-toggle').props.onClick()
  tree = h.render()
  const dev = one(h, tree, 'data-prefill-dev')
  assert.equal(h.find(dev, (props) => props['data-prefill-reset'] !== undefined).length, 1, '展开后在开发者区里')
  assert.deepEqual(flattenText(one(h, tree, 'data-prefill-reset')), ['resetGlobal'])
})

// ── 15 ───────────────────────────────────────────────────────────────────────

const reasoningStatus = (over = {}) => ({
  ok: true,
  enabled: false,
  proxyRunning: false,
  port: 46321,
  config: { prefix: '前缀', providerId: 'prefill-think', modelId: 'deepseek-flash' },
  catalog: { tools: 15, bytes: 6622 },
  hasApiKey: true,
  failures: 0,
  audit: [],
  ...over,
})

test('15：「保存并启用」两步确认；第一下不发请求', async () => {
  const h = await boot(undefined, {
    routes: {
      '/api/dsh-prefill/reasoning/status': () => reasoningStatus(),
      '/api/dsh-prefill/reasoning/enable': () => reasoningStatus({ enabled: true, proxyRunning: true }),
    },
  })
  let tree = h.render()
  const enable = () => one(h, tree, 'data-prefill-reasoning-enable')
  enable().props.onClick()
  await h.settle()
  tree = h.render()
  assert.equal(h.posts.filter((entry) => entry.path === '/api/dsh-prefill/reasoning/enable').length, 0, '第一下只进入待确认')
  assert.equal(enable().props['data-prefill-confirm'], 'true')
  assert.deepEqual(flattenText(enable()), ['confirmYes'])
  enable().props.onClick()
  await h.settle()
  tree = h.render()
  assert.equal(h.posts.filter((entry) => entry.path === '/api/dsh-prefill/reasoning/enable').length, 1)
  assert.equal(savedIn(h, head(h, tree, 'reasoning')).length, 1, '成功在这一节标题旁提示')
  assert.ok(h.stateEvents.length > 0, '写完广播')
})

test('15：已启用时按钮改成「保存前缀」，一下就存', async () => {
  const h = await boot(undefined, {
    routes: {
      '/api/dsh-prefill/reasoning/status': () => reasoningStatus({ enabled: true, proxyRunning: true }),
      '/api/dsh-prefill/reasoning/enable': () => reasoningStatus({ enabled: true, proxyRunning: true }),
    },
  })
  let tree = h.render()
  const button = one(h, tree, 'data-prefill-reasoning-enable')
  assert.deepEqual(flattenText(button), ['reasoningSavePrefix'])
  button.props.onClick()
  await h.settle()
  assert.equal(h.posts.filter((entry) => entry.path === '/api/dsh-prefill/reasoning/enable').length, 1)
})

test('15：失败走 busy(key) + 这一节的错误 pill（op 写具体哪一步），不再有自带的错误行', async () => {
  const h = await boot(undefined, {
    routes: {
      '/api/dsh-prefill/reasoning/status': () => reasoningStatus({ enabled: true }),
      '/api/dsh-prefill/reasoning/disable': () => {
        throw new Error('HTTP 500')
      },
    },
  })
  let tree = h.render()
  const disable = one(h, tree, 'data-prefill-reasoning-disable')
  assert.equal(disable.props.disabled, undefined, '不再用 reasoningBusy 整排禁用')
  disable.props.onClick()
  disable.props.onClick() // 进行中再点被 busy 忽略
  await h.settle()
  tree = h.render()
  assert.equal(h.posts.filter((entry) => entry.path === '/api/dsh-prefill/reasoning/disable').length, 1, '进行中重复点击被忽略')
  const pills = pillsIn(h, head(h, tree, 'reasoning'))
  assert.equal(pills.length, 1)
  assert.deepEqual(flattenText(pills[0]), ['secReasoning · reasoningDisable'])
  assert.equal(flattenText(tree).some((text) => text.startsWith('reasoningFailed')), false, '旧的自带错误行不再出现')
})

test('15：状态随 STATE_EVENT 刷新（连续失败数不过时）；「刷新状态」有就地反馈', async () => {
  let failures = 0
  const h = await boot(undefined, { routes: { '/api/dsh-prefill/reasoning/status': () => reasoningStatus({ failures }) } })
  const statusCalls = () => h.posts.filter((entry) => entry.path === '/api/dsh-prefill/reasoning/status').length
  const before = statusCalls()
  failures = 2
  h.emitStateEvent()
  await h.settle()
  await h.settle()
  let tree = h.render()
  assert.ok(statusCalls() > before, 'STATE_EVENT 触发重拉思考前缀状态')
  assert.match(flattenText(one(h, tree, 'data-prefill-reasoning')).join(' '), /reasoningFailures：2/)
  one(h, tree, 'data-prefill-reasoning-refresh').props.onClick()
  await h.settle()
  tree = h.render()
  assert.deepEqual(flattenText(savedIn(h, head(h, tree, 'reasoning'))[0]), ['reasoningRefreshed'])
})

// ── 16 ───────────────────────────────────────────────────────────────────────

const manyEnvelope = (n) => {
  const base = baseEnvelope()
  const sessions = {}
  for (let at = 0; at < n; at += 1) sessions['s' + at] = []
  return { ...base, tools: { catalog: [], sessions }, sandboxView: { ...base.sandboxView, x1: {}, x2: {} } }
}

test('16：总览先在册、再按会话最近更新时间排；没有时间按标题', async () => {
  const meta = {
    s0: { updatedAt: 100, title: 'B 旧' },
    s1: { updatedAt: 300, title: 'A 新' },
    s2: { updatedAt: 200, title: 'C 中' },
    x1: { title: 'z 不在册' },
    x2: { title: 'a 不在册' },
  }
  const h = await boot(manyEnvelope(3), { titleOf: (id) => meta[id]?.title ?? '', summaryOf: (id) => meta[id] })
  const tree = h.render()
  const rows = h.find(tree, (props) => typeof props['data-prefill-overview-row'] === 'string').map((node) => node.props['data-prefill-overview-row'])
  assert.deepEqual(rows, ['s1', 's2', 's0', 'x2', 'x1'])
  assert.equal(h.find(tree, (props) => props['data-prefill-overview-filter'] !== undefined).length, 0, '不多于 8 个不给过滤框')
})

test('16：会话多于 8 个 ⇒ 给过滤框，按标题或 id 过滤', async () => {
  const h = await boot(manyEnvelope(9), { titleOf: (id) => (id === 's4' ? '写小说' : '') })
  let tree = h.render()
  const filter = one(h, tree, 'data-prefill-overview-filter')
  filter.props.onChange({ target: { value: '小说' } })
  tree = h.render()
  assert.deepEqual(h.find(tree, (props) => typeof props['data-prefill-overview-row'] === 'string').map((node) => node.props['data-prefill-overview-row']), ['s4'])
  one(h, tree, 'data-prefill-overview-filter').props.onChange({ target: { value: 'X1' } })
  tree = h.render()
  assert.deepEqual(h.find(tree, (props) => typeof props['data-prefill-overview-row'] === 'string').map((node) => node.props['data-prefill-overview-row']), ['x1'])
  one(h, tree, 'data-prefill-overview-filter').props.onChange({ target: { value: '没有这个' } })
  tree = h.render()
  assert.equal(h.find(tree, (props) => typeof props['data-prefill-overview-row'] === 'string').length, 0)
  assert.ok(flattenText(tree).includes('overviewFilterEmpty'))
})

test('16：库的工作区下拉显示会话标题，同一 cwd 只列一次（当前选中的那个留下）', async () => {
  const meta = {
    s0: { title: '甲', cwd: '/w/a', updatedAt: 3 },
    s1: { title: '乙', cwd: '/w/a', updatedAt: 2 },
    s2: { title: '', cwd: '/w/b', updatedAt: 1 },
  }
  const h = await boot(manyEnvelope(3), { titleOf: (id) => meta[id]?.title ?? '', summaryOf: (id) => meta[id] })
  let tree = h.render()
  const select = one(h, tree, 'data-prefill-lib-session')
  const options = h.find(select, (props, node) => node.type === 'option')
  assert.deepEqual(options.map((node) => node.props.value), ['s0', 's2', 'x1', 'x2'], '/w/a 只留一个')
  assert.deepEqual(flattenText(options[0]), ['甲 · /w/a'])
  assert.deepEqual(flattenText(options[1]), ['s2 · /w/b'], '没标题退回 id')
  select.props.onChange({ target: { value: 's1' } })
  tree = h.render()
  const after = h.find(one(h, tree, 'data-prefill-lib-session'), (props, node) => node.type === 'option').map((node) => node.props.value)
  assert.ok(after.includes('s1') && !after.includes('s0'), '选中的那个留在下拉里')
})

test('16：「导入…」是 button（Tab 得到），点它触发隐藏的 file input', async () => {
  const h = await boot()
  const tree = h.render()
  for (const [open, input] of [['data-prefill-lib-pack-import-open', 'data-prefill-lib-pack-import'], ['data-prefill-lib-card-import-open', 'data-prefill-lib-card-import']]) {
    const button = one(h, tree, open)
    assert.equal(button.type, 'button')
    assert.equal(button.props.type, 'button')
    const field = one(h, tree, input)
    assert.equal(field.props.tabIndex, -1, '隐藏 input 不进 Tab 序')
    let clicked = 0
    field.props.ref.current = { click: () => (clicked += 1) }
    button.props.onClick()
    assert.equal(clicked, 1, input + ' 被触发')
  }
})
