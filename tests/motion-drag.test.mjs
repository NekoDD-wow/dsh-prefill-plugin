// 动效第 5 步「拖动」（docs/规划-动效.md §4.3）：P0-5 静止落点占位（含末尾）/ 边缘自动滚动，
// P1-11 影子拔出 + 晃一次 / 松手飞到落点 / 取消飞回 / ↑↓ 描边，P1-5 拿走先淡出缩小再收拢 / 长块展开收起滑动，P2-5 ⇄ 徽章 pop。
// 照 tests/motion-visibility.test.mjs / motion-refresh.test.mjs 的做法：把 client.js 的 <motion> + <drag> 段切出来配假 window 直接跑；
// startDrag / moveBlockTo / benchRows 照 tests/drag-cancel.test.mjs 切出来，这次带上 DRAG_FX。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
// 找不到就给空串：改前（没有 <drag> 段）每一项各自失败，而不是整个文件加载失败。
const cut = (from, to) => {
  const a = src.indexOf(from)
  const b = src.indexOf(to, a)
  return a >= 0 && b > a ? src.slice(a, b) : ''
}
const motionSrc = cut('// <motion>', '// </motion>')
const dragFxSrc = cut('// <drag>', '// </drag>')
const dockSrc = cut('    function PrefillDock(props) {', '    function UsagePanel(props) {')
const dragSrc = cut('      const startDrag = (event, block) => {', '      // 长块默认收起')
const moveSrc = cut('      const moveBlockTo = (', '      const addTowerToBenchNow')
const displaySrc = cut('      const benchDisplayRows = () => {', '      const moveBenchBlock')
const rowsSrc = cut('      const benchRows = () => {', '      // ── v0.15：工作台的渲染件')
const popSrc = cut('    function PopBadge(props) {', '    /** 新积木的高亮描边层')

class FakeEvent {
  constructor(type, init) {
    this.type = type
    this.detail = init?.detail
  }
}
function fakeWindow(extra = {}) {
  return { matchMedia: () => ({ matches: false, addEventListener() {} }), dispatchEvent: () => true, ...extra }
}
const NAMES = ['MOTION', 'setMotionPref', 'play', 'DRAG_FX', 'DRAG_LIFT', 'dragLandFrames', 'DRAG_SETTLE', 'BLOCK_EXIT', 'BADGE_POP', 'BENCH_SLOT_CSS', 'edgeScrollSpeed', 'DRAG_EDGE', 'DRAG_SCROLL_MAX']
function load(win = fakeWindow()) {
  const body = `${motionSrc}\n${dragFxSrc}\nreturn { ${NAMES.map((n) => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ')} }`
  // eslint-disable-next-line no-new-func
  return new Function('window', 'CustomEvent', body)(win, FakeEvent)
}
/** 假元素：记下每次 animate；finish() 让最近一次动画落定。root = 流式中的卡片根节点（可选）。 */
function fakeEl(root = null) {
  const calls = []
  const el = {
    calls,
    removed: 0,
    isConnected: true,
    style: { willChange: '' },
    remove() {
      el.removed += 1
      el.isConnected = false
    },
    closest(selector) {
      if (root === null) return null
      const want = /data-prefill-busy="([^"]+)"/.exec(selector)?.[1]
      return want !== undefined && root.getAttribute('data-prefill-busy') === want ? root : null
    },
    animate(frames, timing) {
      let resolve
      const anim = { frames, timing, cancelled: 0, finished: new Promise((r) => { resolve = r }), cancel() { anim.cancelled += 1 }, finish: () => resolve() }
      calls.push(anim)
      return anim
    },
  }
  return el
}
const props = (frames) => new Set(frames.flatMap((frame) => Object.keys(frame).filter((key) => !['offset', 'easing', 'composite', 'transformOrigin'].includes(key))))
const tick = () => new Promise((r) => setTimeout(r, 0))

// ── startDrag 带 DRAG_FX：落点占位 / 飞到落点 / 飞回 ─────────────────────
// 假 DOM 同 drag-cancel：列表 x 100..500，y 90..410；块高 40。
const LIST = { left: 100, right: 500, top: 90, bottom: 410 }
function makeDom(rows, frames = []) {
  const handlers = { document: {}, window: {} }
  const on = (where) => (type, fn) => { (handlers[where][type] ??= []).push(fn) }
  const off = (where) => (type, fn) => { handlers[where][type] = (handlers[where][type] ?? []).filter((f) => f !== fn) }
  const rect = (top, height, left = LIST.left + 34, right = LIST.right) => ({ top, bottom: top + height, height, left, right, width: right - left })
  const rowNode = ([key, top]) => ({
    getAttribute: (name) => (name === 'data-prefill-bench-block' ? key : null),
    getBoundingClientRect: () => rect(top, 40),
    querySelector: () => ({ getBoundingClientRect: () => rect(top + 5, 16, LIST.left + 40, LIST.left + 52) }),
  })
  const frameNode = (frame) => ({ getAttribute: (name) => (name === 'data-prefill-bench-tower' ? frame.key : null), getBoundingClientRect: () => rect(frame.top, frame.bottom - frame.top) })
  const list = {
    querySelectorAll(sel) {
      if (sel.includes('data-prefill-bench-block')) return rows.map(rowNode)
      if (sel.includes('data-prefill-bench-tower')) return frames.map(frameNode)
      return []
    },
    getBoundingClientRect: () => rect(LIST.top, LIST.bottom - LIST.top, LIST.left, LIST.right),
    closest: () => null,
    parentElement: null,
  }
  const ghosts = []
  const document = {
    body: { style: { userSelect: '' }, appendChild() {} },
    createElement: () => { const g = fakeEl(); g.getBoundingClientRect = () => ({ width: 80 }); ghosts.push(g); return g },
    addEventListener: on('document'),
    removeEventListener: off('document'),
  }
  const window = fakeWindow({ getSelection: () => ({ removeAllRanges() {} }), addEventListener: on('window'), removeEventListener: off('window') })
  const fire = (type, ev) => { for (const where of ['window', 'document']) for (const fn of [...(handlers[where][type] ?? [])]) fn(ev) }
  return { list, document, window, fire, ghosts }
}
function loadDrag({ bench, rows, frames = [], level = 'full' }) {
  const dom = makeDom(rows, frames)
  const state = { bench, drop: [] }
  const body = `${motionSrc}\n${dragFxSrc}\nsetMotionPref(${JSON.stringify(level)})\n${moveSrc}\n${dragSrc}\nreturn { startDrag, benchMoved: typeof benchMoved === 'undefined' ? undefined : benchMoved }`
  // eslint-disable-next-line no-new-func
  const out = new Function('bench', 'setBench', 'benchListRef', 'dragInfo', 'setDragKey', 'setDropIndex', 'document', 'window', 'CustomEvent', body)(
    bench, (next) => { state.bench = next }, { current: dom.list }, { current: null }, () => {}, (v) => state.drop.push(typeof v === 'function' ? v(state.drop.at(-1) ?? -1) : v), dom.document, dom.window, FakeEvent,
  )
  const ev = (x, y) => ({ button: 0, clientX: x, clientY: y, preventDefault() {}, stopPropagation() {} })
  const drag = (key, from, path, mid) => {
    out.startDrag(ev(...from), { key, name: key })
    for (const pt of path) dom.fire('pointermove', ev(...pt))
    mid?.(dom)
    dom.fire('pointerup', ev(...(path.at(-1) ?? from)))
  }
  return { ...out, dom, state, drag, order: () => state.bench.map((b) => b.key + (b.tower ? '@' + b.tower : '')).join(',') }
}
const ABC = [{ key: 'A', tower: null }, { key: 'B', tower: null }, { key: 'C', tower: null }]

function scrollRig({ top = 100, bottom = 600, max = 1000 } = {}) {
  const frames = []
  const win = fakeWindow({ requestAnimationFrame: (fn) => { frames.push(fn); return frames.length }, cancelAnimationFrame: (id) => { frames[id - 1] = null } })
  const M = load(win)
  const scroller = { _t: 0, get scrollTop() { return this._t }, set scrollTop(v) { this._t = Math.max(0, Math.min(max, v)) }, getBoundingClientRect: () => ({ top, bottom, left: 0, right: 800 }) }
  const list = { closest: (sel) => (sel === '[data-prefill-main]' ? scroller : null), getBoundingClientRect: () => ({ left: 100, right: 500, top: 0, bottom: 2000 }) }
  const run = (n = 1) => { for (let i = 0; i < n; i++) { const fn = frames.shift(); if (fn) fn() } }
  return { M, scroller, list, run, frames }
}

test('切片存在：<drag> 段、startDrag / moveBlockTo / benchRows', () => {
  assert.ok(dragFxSrc.length > 200, '没切到 <drag> … </drag> 段')
  for (const [name, part] of [['startDrag', dragSrc], ['moveBlockTo', moveSrc], ['benchDisplayRows', displaySrc], ['benchRows', rowsSrc]]) assert.ok(part.length > 100, '没切到 ' + name)
})

// ── P1-11 影子拔出 ─────────────────────────────────────────────────────
test('[P0-5] edgeScrollSpeed：中间 0；上边缘带负、下边缘带正，越靠边越快（封顶）；出了滚动区 0', () => {
  const M = load()
  assert.equal(typeof M.edgeScrollSpeed, 'function')
  const E = M.DRAG_EDGE, MAX = M.DRAG_SCROLL_MAX
  assert.equal(M.edgeScrollSpeed(300, 100, 600), 0)
  assert.ok(M.edgeScrollSpeed(100 + E - 1, 100, 600) < 0)
  assert.equal(M.edgeScrollSpeed(100, 100, 600), -MAX)
  assert.ok(M.edgeScrollSpeed(600 - E + 1, 100, 600) > 0)
  assert.equal(M.edgeScrollSpeed(600, 100, 600), MAX)
  assert.ok(M.edgeScrollSpeed(600 - 2, 100, 600) > M.edgeScrollSpeed(600 - E + 4, 100, 600))
  assert.equal(M.edgeScrollSpeed(50, 100, 600), 0, '拖出滚动区上方（取消区）不该滚')
  assert.equal(M.edgeScrollSpeed(900, 100, 600), 0, '拖出滚动区下方（取消区）不该滚')
})


test('[P0-5] 自动滚动：指针进下边缘带就按帧往下滚，离开边缘带停；stop 撤掉 rAF', () => {
  const { M, scroller, list, run, frames } = scrollRig()
  const auto = M.DRAG_FX.autoScroll(list)
  auto.update(300, 300) // 中间：离开过边缘带 ⇒ 上膛
  assert.equal(frames.length, 0)
  auto.update(300, 595)
  run(3)
  assert.ok(scroller.scrollTop > 0, '在下边缘带里没滚')
  const at = scroller.scrollTop
  auto.update(300, 300)
  run(3)
  assert.equal(scroller.scrollTop, at, '离开边缘带还在滚')
  auto.update(300, 105)
  run(2)
  assert.ok(scroller.scrollTop < at, '上边缘带没往上滚')
  auto.stop()
  const after = scroller.scrollTop
  run(5)
  assert.equal(scroller.scrollTop, after)
})

test('[P0-5] 自动滚动：按下时就在边缘带里（顶上那块）先不滚，离开边缘带一次之后才滚；横向出列表不滚', () => {
  const { M, scroller, list, run } = scrollRig()
  scroller.scrollTop = 200
  const auto = M.DRAG_FX.autoScroll(list)
  auto.update(300, 110)
  run(3)
  assert.equal(scroller.scrollTop, 200, '一拿起来列表就跑了')
  auto.update(300, 300)
  auto.update(300, 110)
  run(2)
  assert.ok(scroller.scrollTop < 200)
  const at = scroller.scrollTop
  auto.update(900, 110) // 横向离列表很远
  run(3)
  assert.equal(scroller.scrollTop, at)
})

// ── P1-5 拿走 ──────────────────────────────────────────────────────────
test('[P0-5] 被拖的块就是落点占位：算落点时不拿它自己的中线比（占位已挪到末尾，指针在占位上 ⇒ 落到末尾）', () => {
  // 拖动中 A 的占位已经渲染在末尾（DOM：B 100 · C 148 · A 196）；指针停在 A 占位的上半部 y=205。
  const { drag, order } = loadDrag({ bench: ABC, rows: [['B', 100], ['C', 148], ['A', 196]] })
  drag('A', [120, 120], [[120, 140], [120, 205]])
  assert.equal(order(), 'B,C,A', '拿占位自己的中线比 ⇒ before = A 自己 ⇒ 原地不动')
})

test('[P0-5] benchMoved：拖动中的预览和松手落位同一个纯函数（末尾 / 进塔 / 原地 = null）', () => {
  const { benchMoved } = loadDrag({ bench: ABC, rows: [] })
  assert.equal(typeof benchMoved, 'function', '没有 benchMoved')
  assert.deepEqual(benchMoved(ABC, 'A', null, null).map((b) => b.key), ['B', 'C', 'A'])
  assert.deepEqual(benchMoved(ABC, 'C', 'A', 'rp').map((b) => b.key + (b.tower ? '@' + b.tower : '')), ['C@rp', 'A', 'B'])
  assert.equal(benchMoved(ABC, 'B', 'C', null), null, '原地')
  assert.equal(benchMoved(ABC, 'B', 'gone', null), null, 'before 已不在台上')
})

test('[P0-5] 末尾占位：落点 = 末尾（dropIndex === bench.length）时按预览顺序渲染，被拖的块画在最后一行', () => {
  const h = (type, p, ...children) => ({ type, props: p ?? {}, children: children.flat(Infinity) })
  // eslint-disable-next-line no-new-func
  const make = new Function('bench', 'benchTowers', 'benchCard', 'benchColor', 'h', 'V', 't', 'toggleTowerCollapsed', 'removeTowerFromBench', 'benchMoved',
    `${displaySrc}\n${rowsSrc}\nreturn typeof benchRowsOf === 'undefined' ? null : benchRowsOf`)
  const bench = [{ key: 'A', tower: null }, { key: 'T1', tower: 'rp' }, { key: 'T2', tower: 'rp' }]
  const rp = { rp: { ref: 'rp', name: 'rp', collapsed: false } }
  const benchRowsOf = make(bench, rp, (b) => ({ type: 'card', key: b.key, props: {}, children: [] }), () => 'x', h, { row: {}, btnGhost: {} }, (k) => k, () => {}, () => {})
  assert.equal(typeof benchRowsOf, 'function', '没有 benchRowsOf（按预览顺序画）')
  const keysOf = (rows) => { const out = []; const walk = (n) => { if (!n || typeof n !== 'object') return; if (n.type === 'card') out.push(n.key + (n.inTower ? '' : '')); for (const c of n.children ?? []) walk(c) }; rows.forEach(walk); return out }
  const preview = [{ key: 'T1', tower: 'rp' }, { key: 'T2', tower: 'rp' }, { key: 'A', tower: null }]
  const rows = benchRowsOf(preview)
  assert.deepEqual(keysOf(rows), ['T1', 'T2', 'A'])
  assert.equal(rows.at(-1).type, 'card', '末尾占位应在塔框外单独一行')
  // 面板接线：拖动中按 benchDragView 渲染，占位样式 + 内容 30% 的样式表。
  assert.match(dockSrc, /\.\.\.benchRowsOf\(benchDragView\)/)
  assert.match(dockSrc, /const benchDragView = dragKey !== '' && dropAt !== null \? benchMoved\(bench, dragKey, dropAt\.before, dropAt\.tower\) \?\? bench : bench/)
  assert.match(dockSrc, /'data-prefill-drop-slot': dragKey === block\.key/)
  assert.match(dockSrc, /dragKey !== '' \? h\('style', \{ key: 'slot-css' \}, BENCH_SLOT_CSS\)/)
  assert.ok(!/inset 0 3px 0 var\(--pf-turn\)/.test(dockSrc), '旧的插入线还在')
})

test('[P0-5] 落点状态：setDropIndex 同步出 dropAt（before + tower），出了列表 = null；FLIP 不再排除拖动中', () => {
  assert.match(dockSrc, /const \[dropAt, setDropAt\] = React\.useState\(null\)/)
  assert.match(dockSrc, /const setDropIndex = \(value\) => \{[\s\S]{0,400}setDropAt\(/)
  const flip = cut('      React.useLayoutEffect(() => {\n        const list = benchListRef.current', '      const everyTurnTimer')
  assert.ok(flip.length > 100, '没切到工作台 FLIP')
  assert.ok(!/dragInfo\.current === null/.test(flip), 'FLIP 仍然排除拖动中 ⇒ 其余块让位不会滑')
  assert.match(flip, /kind: 'move'/)
})

