// 界面重构 v1（UI 工作流 C）· 设置页：TOC 补 anchored/sticky/scroll-spy/aria-current + 顶部 4 个 KPI。
// 用 tests/settings-harness.mjs 真渲染（与 settings-pane-render.test.mjs 同一思路）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { makeSettingsHarness } from './settings-harness.mjs'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const cut = (from, to) => {
  const a = src.indexOf(from)
  const b = a < 0 ? -1 : src.indexOf(to, a)
  return a >= 0 && b > a ? src.slice(a, b) : ''
}

const envelope = () => ({
  ok: true,
  state: {
    version: 2,
    armed: ['s2'],
    levers: { probeSection: false, probeContext: false, blockSections: false, blockContexts: false, blockTools: false, blockMessages: false },
    allowKinds: ['user'],
    tools: null,
    ui: { motion: 'lite' },
    activePreset: { s1: 'builtin:pure' },
  },
  tools: { catalog: ['read'], sessions: { s1: ['read'], s2: [] } },
  turns: { s1: 3 },
  sandboxView: { s1: {}, s3: {} },
  snapshots: {},
  injections: { catalog: { messages: ['runtime-context'] } },
})

const ready = async () => {
  const h = makeSettingsHarness(envelope())
  h.render()
  await h.settle()
  return h
}

test('TOC：8 项（补 default-sandbox）+ 每项都有锚点', async () => {
  const h = await ready()
  const tree = h.render()
  const links = h.find(tree, (props) => typeof props['data-prefill-toc-link'] === 'string')
  assert.equal(links.length, 8)
  assert.deepEqual(links.map((node) => node.props['data-prefill-toc-link']), ['overview', 'default-everyturn', 'default-sandbox', 'library', 'prefs', 'experimental', 'reasoning', 'dev'])
  const anchors = new Set(h.find(tree, (props) => typeof props['data-prefill-anchor'] === 'string').map((node) => node.props['data-prefill-anchor']))
  for (const link of links) assert.ok(anchors.has(link.props['data-prefill-toc-link']), '缺锚点：' + link.props['data-prefill-toc-link'])
  assert.ok(src.includes("tocDefaultSandbox: '新会话默认 · 沙盒'"))
})

test('aria-current：默认第一项 location；点目录后立刻切到目标', async () => {
  const h = await ready()
  let tree = h.render()
  const current = () => h.find(tree, (props) => typeof props['data-prefill-toc-link'] === 'string').filter((node) => node.props['aria-current'] === 'location').map((node) => node.props['data-prefill-toc-link'])
  assert.deepEqual(current(), ['overview'])
  const library = h.find(tree, (props) => props['data-prefill-toc-link'] === 'library')[0]
  const hadDocument = 'document' in globalThis
  globalThis.document = { querySelector: () => ({ scrollIntoView() {} }) }
  try {
    library.props.onClick()
  } finally {
    if (!hadDocument) delete globalThis.document
  }
  tree = h.render()
  assert.deepEqual(current(), ['library'])
})

test('scroll-spy：onScroll 按锚点位置更新 aria-current（滚到底 ⇒ 最后一项）', async () => {
  const h = await ready()
  let tree = h.render()
  const page = h.find(tree, (props) => props['data-prefill-page'] === 'prefill')[0]
  assert.ok(page, '找不到设置页根节点')
  assert.equal(typeof page.props.onScroll, 'function', '根节点要挂 onScroll')
  const node = (anchor, top) => ({ getAttribute: () => anchor, getBoundingClientRect: () => ({ top }) })
  const activeOf = () => h.find(tree, (props) => typeof props['data-prefill-toc-link'] === 'string').filter((entry) => entry.props['aria-current'] === 'location').map((entry) => entry.props['data-prefill-toc-link'])
  // 容器 top=0，滚到 900：library 的内容坐标 910 <= 900+32 ⇒ 高亮 library；prefs(1800) 还没到。
  page.props.onScroll({
    currentTarget: {
      scrollTop: 900,
      clientHeight: 800,
      scrollHeight: 6000,
      getBoundingClientRect: () => ({ top: 0 }),
      querySelectorAll: () => [node('overview', -1200), node('default-everyturn', -300), node('library', 10), node('prefs', 900)],
    },
  })
  tree = h.render()
  assert.deepEqual(activeOf(), ['library'])
  // 滚到底 ⇒ 高亮最后一项（锚点贴底时永远到不了 lead）
  page.props.onScroll({
    currentTarget: {
      scrollTop: 5200,
      clientHeight: 800,
      scrollHeight: 6000,
      getBoundingClientRect: () => ({ top: 0 }),
      querySelectorAll: () => [node('overview', -9000), node('prefs', -1200), node('dev', -100)],
    },
  })
  tree = h.render()
  assert.deepEqual(activeOf(), ['dev'])
})

test('tocActiveAt 纯函数：最后一个 top <= scrollTop+lead', () => {
  const fnSrc = cut('    function tocActiveAt(', '    /** 从滚动容器现算一遍')
  assert.ok(fnSrc.length > 0, '找不到 tocActiveAt')
  const tocActiveAt = new Function(fnSrc + '; return tocActiveAt')()
  const anchors = [{ anchor: 'a', top: 0 }, { anchor: 'b', top: 100 }, { anchor: 'c', top: 500 }]
  assert.equal(tocActiveAt(anchors, 120), 'b')
  assert.equal(tocActiveAt(anchors, 0), 'a')
  assert.equal(tocActiveAt(anchors, 900), 'c')
  assert.equal(tocActiveAt([], 0), '')
  assert.equal(tocActiveAt(null, 0), '')
})

test('sticky：目录吸顶 + 锚点 scroll-margin 闪开目录', () => {
  assert.match(src, /toc: \{\n\s+position: 'sticky',/)
  assert.match(src, /scrollMarginTop: 44/)
  assert.match(src, /'aria-current': tocActive === item\.anchor \? 'location' : undefined/)
})

test('KPI 条：4 个（运行中 / 已套预设 / 每轮注入开 / 拦截中），值来自 overviewRows', async () => {
  const h = await ready()
  const tree = h.render()
  const tiles = h.find(tree, (props) => typeof props['data-prefill-kpi'] === 'string')
  assert.deepEqual(tiles.map((node) => node.props['data-prefill-kpi']), ['live', 'preset', 'everyTurn', 'blocked'])
  assert.deepEqual(tiles.map((node) => node.props['data-prefill-kpi-value']), ['2', '1', '0', '0'])
  assert.equal(h.find(tree, (props) => props['data-prefill-kpi-bar'] !== undefined).length, 1)
  assert.ok(src.includes('kpiBlocked: \'拦截中\''), '第 4 格叫「拦截中」')
})

test('KPI 拦截中：观察档不计（与 sandboxSummary 同口径）', async () => {
  const env = envelope()
  env.sandboxView = { s1: { level: 'observe', blocked: 5 }, s2: { level: 'controlled', blocked: 2 } }
  const h = makeSettingsHarness(env)
  h.render()
  await h.settle()
  const tree = h.render()
  const blocked = h.find(tree, (props) => props['data-prefill-kpi'] === 'blocked')[0]
  assert.equal(blocked.props['data-prefill-kpi-value'], '2', '观察档的 5 条不算，受控档 2 条算')
})
