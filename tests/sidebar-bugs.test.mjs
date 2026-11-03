// 公开 issue #45 第一节（PR A）：左侧栏「预填装」页 8 处确定的 bug —— 用 tests/settings-harness.mjs 真渲染。
// 每条都在改动前的 client.js 上失败过（见 PR 正文）。
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { makeSettingsHarness } from './settings-harness.mjs'

const envelope = (patch = {}) => ({
  ok: true,
  state: {
    version: 2,
    armed: [],
    levers: { probeSection: false, probeContext: false, blockSections: false, blockContexts: false, blockTools: false, blockMessages: false },
    allowKinds: ['user'],
    tools: null,
    ui: { motion: 'lite' },
    activePreset: {},
    everyTurn: { '*': { enabled: true, mode: 'always', untilTurn: 0, text: '服务端默认', firstText: '' } },
    sandbox: {},
    ...(patch.state ?? {}),
  },
  tools: { catalog: ['read'], sessions: { s1: ['read'] } },
  turns: { s1: 2 },
  sandboxView: { s1: {} },
  snapshots: {},
  injections: { catalog: { messages: [] } },
  ...(patch.top ?? {}),
})

const one = (h, tree, attr, value) => {
  const found = h.find(tree, (props) => (value === undefined ? props[attr] !== undefined : props[attr] === value))
  assert.ok(found.length > 0, '找不到 ' + attr + (value === undefined ? '' : '=' + value))
  return found[0]
}
const textOf = (node, out = []) => {
  if (node === null || node === undefined) return out
  if (typeof node === 'string') out.push(node)
  else if (typeof node === 'object') for (const child of node.children ?? []) textOf(child, out)
  return out
}
const mounted = async (env, options) => {
  const h = makeSettingsHarness(env, options)
  h.render()
  await h.settle()
  h.render()
  await h.settle()
  return h
}

// ── 1 ───────────────────────────────────────────────────────────────────────
test('#45-1「改默认 ↗」：左侧页挂载时读 panelAnchor（读完清空）并滚到小节；已挂载时照旧接 ANCHOR_EVENT', async () => {
  const scrolled = []
  const saved = globalThis.document
  globalThis.document = { querySelector: (selector) => ({ scrollIntoView: (opts) => scrolled.push({ selector, opts }) }) }
  try {
    const h = makeSettingsHarness(envelope(), { initialAnchor: 'default-sandbox' })
    h.render()
    assert.equal(h.peekPanelAnchor(), '', '挂载即读走 panelAnchor')
    await h.settle()
    h.render()
    await h.settle()
    h.render()
    assert.deepEqual(scrolled.map((entry) => entry.selector), ['[data-prefill-anchor="default-sandbox"]'], '拉到状态后滚一次，之后重渲染不再滚')
    // 已挂载：走事件；同时把 openPrefillPanel 写下的 panelAnchor 读走。
    h.setPanelAnchor('library')
    h.emitAnchor('library')
    assert.equal(scrolled.at(-1).selector, '[data-prefill-anchor="library"]')
    assert.equal(h.peekPanelAnchor(), '', '事件处理后 panelAnchor 也清空，下次挂载不会再滚')
  } finally {
    if (saved === undefined) delete globalThis.document
    else globalThis.document = saved
  }
})

// ── 2 ───────────────────────────────────────────────────────────────────────
test('#45-2 默认每轮注入的草稿：外部广播 / 同页别的写入不冲掉；自己保存成功才清；可放弃', async () => {
  const h = await mounted(envelope())
  let tree = h.render()
  one(h, tree, 'data-prefill-default-turn-text').props.onChange({ target: { value: '写到一半' } })
  tree = h.render()
  assert.equal(one(h, tree, 'data-prefill-default-turn-text').props.value, '写到一半')

  h.emitStateEvent() // 卡片里任何一次保存都会广播
  await h.settle()
  tree = h.render()
  assert.equal(one(h, tree, 'data-prefill-default-turn-text').props.value, '写到一半', '外部广播后草稿还在')

  one(h, tree, 'data-prefill-default-sbx-level', 'observe').props.onClick() // 同页沙盒默认
  await h.settle()
  tree = h.render()
  assert.equal(one(h, tree, 'data-prefill-default-turn-text').props.value, '写到一半', '同页别的写入后草稿还在')

  // 放弃 ⇒ 回到服务端值
  one(h, tree, 'data-prefill-default-turn-discard').props.onClick()
  tree = h.render()
  assert.equal(one(h, tree, 'data-prefill-default-turn-text').props.value, '服务端默认')
  assert.equal(h.find(tree, (props) => props['data-prefill-default-turn-discard'] !== undefined).length, 0, '没有草稿时不显示「放弃修改」')

  // 保存成功 ⇒ 草稿清掉，显示服务端回来的值
  one(h, tree, 'data-prefill-default-turn-text').props.onChange({ target: { value: '新默认' } })
  tree = h.render()
  one(h, tree, 'data-prefill-default-turn-save').props.onClick()
  await h.settle()
  tree = h.render()
  assert.equal(h.find(tree, (props) => props['data-prefill-default-turn-discard'] !== undefined).length, 0, '保存成功后草稿清掉')
  assert.equal(one(h, tree, 'data-prefill-default-turn-text').props.value, '新默认')
})

test('#45-2 保存失败时草稿保留', async () => {
  const h = await mounted(envelope())
  let tree = h.render()
  one(h, tree, 'data-prefill-default-turn-text').props.onChange({ target: { value: '别丢' } })
  tree = h.render()
  h.setFailNext()
  one(h, tree, 'data-prefill-default-turn-save').props.onClick()
  await h.settle()
  await h.settle()
  tree = h.render()
  assert.equal(one(h, tree, 'data-prefill-default-turn-text').props.value, '别丢')
})

// ── 3 ───────────────────────────────────────────────────────────────────────
test('#45-3 动效档位连点：忙碌中第二次点击被忽略，不抛 TypeError，也不先套用', async () => {
  const h = await mounted(envelope())
  const tree = h.render()
  one(h, tree, 'data-prefill-pref-motion', 'off').props.onClick()
  assert.doesNotThrow(() => one(h, tree, 'data-prefill-pref-motion', 'full').props.onClick())
  assert.ok(h.motionPrefs.includes('off'))
  assert.ok(!h.motionPrefs.includes('full'), '被忽略的那次不该先套用到页面')
  await h.settle()
  assert.equal(h.fetches.filter((entry) => entry.body?.ui?.motion !== undefined).length, 1, '只写了一次')
})

// ── 4 ───────────────────────────────────────────────────────────────────────
const twoPacks = {
  '/api/dsh-prefill/packs': (body) => (body?.op === 'list' ? { ok: true, packs: [{ name: 'A', count: 1 }, { name: 'B', count: 1 }] } : { ok: true }),
  '/api/dsh-prefill/cards': () => ({ ok: true, cards: [] }),
}

test('#45-4 库删除确认：先点 A 再点 B，A 的旧定时器不会提前解除 B 的确认态', async () => {
  const h = await mounted(envelope(), { routes: twoPacks })
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    let tree = h.render()
    one(h, tree, 'data-prefill-lib-pack-delete', 'A').props.onClick()
    mock.timers.tick(3000)
    tree = h.render()
    one(h, tree, 'data-prefill-lib-pack-delete', 'B').props.onClick()
    mock.timers.tick(1500) // A 的定时器本该在 4000 触发
    tree = h.render()
    assert.equal(one(h, tree, 'data-prefill-lib-pack-delete', 'B').props['data-prefill-confirm'], 'true', 'B 仍在待确认')
    mock.timers.tick(3000) // B 自己的 4000 到了
    tree = h.render()
    assert.equal(one(h, tree, 'data-prefill-lib-pack-delete', 'B').props['data-prefill-confirm'], 'false')
  } finally {
    mock.timers.reset()
  }
})

test('#45-4 恢复默认确认：确认后再 arm，上一次的旧定时器不会提前解除', async () => {
  const h = await mounted(envelope())
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    let tree = h.render()
    // C（#45 第 14 条）把「恢复默认」收进开发者折叠：先展开再找按钮（行为不变，位置变了）。
    one(h, tree, 'data-prefill-dev-toggle').props.onClick()
    tree = h.render()
    one(h, tree, 'data-prefill-reset').props.onClick() // arm @0
    mock.timers.tick(3000)
    tree = h.render()
    one(h, tree, 'data-prefill-reset').props.onClick() // 确认 @3000
    tree = h.render()
    one(h, tree, 'data-prefill-reset').props.onClick() // 再 arm @3000
    mock.timers.tick(1500) // 旧定时器本该在 4000 触发
    tree = h.render()
    assert.equal(one(h, tree, 'data-prefill-reset').props['data-prefill-confirm'], 'true')
  } finally {
    mock.timers.reset()
  }
})

// ── 5 ───────────────────────────────────────────────────────────────────────
test('#45-5 没有在册会话时：库用下拉框显示的第一个会话加载，下拉 value 与加载会话一致', async () => {
  const env = envelope({ top: { tools: { catalog: [], sessions: {} }, turns: {}, sandboxView: {}, snapshots: { x2: {}, x1: {} } } })
  const h = await mounted(env, { routes: twoPacks })
  const tree = h.render()
  const select = one(h, tree, 'data-prefill-lib-session')
  const options = select.children.filter((node) => node?.type === 'option').map((node) => node.props.value)
  assert.deepEqual(options, ['x1', 'x2'])
  assert.equal(select.props.value, 'x1')
  const list = h.fetches.filter((entry) => entry.path === '/api/dsh-prefill/packs' && entry.body?.op === 'list')
  assert.ok(list.length > 0, '确实加载了')
  assert.equal(list.at(-1).body.sessionId, 'x1')
  assert.deepEqual(h.find(tree, (props) => typeof props['data-prefill-lib-pack'] === 'string').map((node) => node.props['data-prefill-lib-pack']), ['A', 'B'])
  assert.ok(!textOf(tree).includes('libraryNoSession'))
})

test('#45-5 一个会话都没有：显示 libraryNoSession，不加载', async () => {
  const env = envelope({ top: { tools: { catalog: [], sessions: {} }, turns: {}, sandboxView: {}, snapshots: {} } })
  const h = await mounted(env, { routes: twoPacks })
  const tree = h.render()
  assert.ok(textOf(tree).includes('libraryNoSession'))
  assert.equal(h.fetches.filter((entry) => entry.path === '/api/dsh-prefill/packs').length, 0)
})

// ── 6 ───────────────────────────────────────────────────────────────────────
test('#45-6「生效会话」不把 sandboxView 的 * 当会话（只剩专门那一行）', async () => {
  const h = await mounted(envelope({ top: { sandboxView: { s1: {}, '*': { packs: [] } } } }))
  let tree = h.render()
  one(h, tree, 'data-prefill-dev-toggle').props.onClick()
  tree = h.render()
  const rows = h.find(tree, (props) => typeof props['data-prefill-armed-row'] === 'string').map((node) => node.props['data-prefill-armed-row'])
  assert.deepEqual(rows, ['s1', '*'])
})

// ── 7 ───────────────────────────────────────────────────────────────────────
test('#45-7「只注入前 N 轮」N 没填 / < 1：保存按钮禁用并给提示，不写 untilTurn: 0', async () => {
  const h = await mounted(envelope())
  let tree = h.render()
  one(h, tree, 'data-prefill-default-turn-mode', 'until').props.onClick()
  tree = h.render()
  const save = one(h, tree, 'data-prefill-default-turn-save')
  assert.equal(save.props.disabled, true)
  assert.equal(h.find(tree, (props) => props['data-prefill-default-turn-until-warn'] !== undefined).length, 1)
  const before = h.fetches.length
  save.props.onClick()
  await h.settle()
  assert.equal(h.fetches.length, before, '禁用时点了也不写')
  one(h, tree, 'data-prefill-default-turn-until').props.onChange({ target: { value: '3' } })
  tree = h.render()
  assert.notEqual(one(h, tree, 'data-prefill-default-turn-save').props.disabled, true)
  one(h, tree, 'data-prefill-default-turn-save').props.onClick()
  await h.settle()
  assert.equal(h.fetches.at(-1).body.everyTurn['*'].untilTurn, 3)
})

// ── 8 ───────────────────────────────────────────────────────────────────────
const withNavigator = async (value, fn) => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true })
  try {
    await fn()
  } finally {
    if (saved === undefined) delete globalThis.navigator
    else Object.defineProperty(globalThis, 'navigator', saved)
  }
}

test('#45-8 复制 id：等剪贴板结果；失败不说「已复制」而是把 id 显示出来', async () => {
  await withNavigator({ clipboard: { writeText: () => Promise.reject(new Error('denied')) } }, async () => {
    const h = await mounted(envelope())
    let tree = h.render()
    one(h, tree, 'data-prefill-overview-copy', 's1').props.onClick()
    await h.settle()
    tree = h.render()
    const text = textOf(tree)
    assert.ok(!text.includes('copied'), '失败时不该显示「已复制」')
    assert.ok(text.includes('s1'))
  })
  await withNavigator({ clipboard: { writeText: () => Promise.resolve() } }, async () => {
    const h = await mounted(envelope())
    let tree = h.render()
    one(h, tree, 'data-prefill-overview-copy', 's1').props.onClick()
    await h.settle()
    tree = h.render()
    assert.ok(textOf(tree).includes('copied'))
  })
})

test('#45-8 库加载失败：走 fail() / 错误 pill，不再静默', async () => {
  const routes = {
    '/api/dsh-prefill/packs': () => { throw new Error('packs down') },
    '/api/dsh-prefill/cards': () => ({ ok: true, cards: [] }),
  }
  const h = await mounted(envelope(), { routes })
  await h.settle()
  const tree = h.render()
  assert.ok(h.failDetails().some((detail) => detail.key === 'lib:load'), '报了 lib:load 失败')
  assert.equal(h.find(tree, (props) => props['data-prefill-error-pill'] === 'lib:load').length, 1)
})

test('#45-8 思考前缀「刷新状态」：点了有 busy 态，完成后给出「已刷新」提示', async () => {
  let calls = 0
  const routes = {
    '/api/dsh-prefill/reasoning/status': () => {
      calls += 1
      return { enabled: false, proxyRunning: false, failures: 0 }
    },
  }
  const h = await mounted(envelope({ state: { ui: { motion: 'lite', experimental: true } } }), { routes })
  let tree = h.render()
  // C（#45 第 15 条）：刷新并入全页同一套 busy(key) + SectionSaved，不再自带 busy / 已刷新标记。
  assert.equal(h.find(tree, (props) => props['data-prefill-section-saved'] !== undefined).length, 0, '挂载时那次自动拉取不算')
  const before = calls
  const refresh = one(h, tree, 'data-prefill-reasoning-refresh')
  refresh.props.onClick()
  // busy 语义：进行中再点被忽略（同一 key 还在 pending）。
  refresh.props.onClick()
  await h.settle()
  await h.settle()
  tree = h.render()
  assert.equal(calls, before + 1, '进行中重复点击被忽略，只刷新一次')
  const saved = h.find(one(h, tree, 'data-prefill-section-head', 'reasoning'), (props) => props['data-prefill-section-saved'] !== undefined)
  assert.equal(saved.length, 1, '完成后这一节标题旁冒「已刷新」')
  assert.deepEqual(textOf(saved[0]), ['reasoningRefreshed'])
})
