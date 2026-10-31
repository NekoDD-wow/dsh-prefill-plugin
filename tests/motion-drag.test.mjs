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
test('[P1-11] 拔出：完整档 scale 1→1.04 + 晃一次（rotate 一正一负），保持在 1.04（fill forwards）', () => {
  const M = load()
  assert.equal(typeof M.DRAG_FX?.lift, 'function')
  const ghost = fakeEl()
  M.setMotionPref('full')
  M.DRAG_FX.lift(ghost)
  assert.equal(ghost.calls.length, 1)
  const { frames, timing } = ghost.calls[0]
  const tf = frames.map((f) => f.transform ?? '').join(' | ')
  assert.match(tf, /scale\(1\.04\)/)
  assert.match(tf, /rotate\(-[\d.]+deg\)/)
  assert.match(tf, /rotate\([\d.]+deg\)/)
  assert.match(frames.at(-1).transform, /translate\(-50%,-50%\) scale\(1\.04\)$/, '最后一帧要回正、留在 1.04')
  assert.equal(timing.fill, 'forwards')
  assert.deepEqual([...props(frames)].sort(), ['opacity', 'transform'])
})

test('[P1-11] 拔出：简洁只淡入（不缩放不晃）；off 不调 animate', () => {
  const M = load()
  const ghost = fakeEl()
  M.setMotionPref('lite')
  M.DRAG_FX.lift(ghost)
  assert.equal(ghost.calls.length, 1)
  assert.deepEqual([...props(ghost.calls[0].frames)], ['opacity'])
  M.setMotionPref('off')
  const g2 = fakeEl()
  assert.equal(M.DRAG_FX.lift(g2), null)
  assert.equal(g2.calls.length, 0)
})

test('[P1-11] 拖动是直接反馈：卡片在流式输出（data-prefill-busy="stream"）时拔出照样播，不进队列', () => {
  const M = load()
  M.setMotionPref('full')
  const root = { isConnected: true, getAttribute: (n) => (n === 'data-prefill-busy' ? 'stream' : null) }
  const el = fakeEl(root)
  M.DRAG_FX.lift(el)
  M.DRAG_FX.settle(el)
  assert.equal(el.calls.length, 2)
})

// ── P1-11 松手 / 取消 ─────────────────────────────────────────────────
test('[P1-11] 松手：完整档影子飞 (dx, dy) 到落点（spring、位移类），动画落定后才移除影子', async () => {
  const M = load()
  M.setMotionPref('full')
  const ghost = fakeEl()
  M.DRAG_FX.land(ghost, 40, -120)
  assert.equal(ghost.calls.length, 1)
  const { frames, timing } = ghost.calls[0]
  assert.equal(timing.easing, M.MOTION.spring)
  assert.match(frames.at(-1).transform, /calc\(-50% \+ 40px\),calc\(-50% \+ -120px\)/)
  assert.equal(frames.at(-1).opacity, 0, '飞到之后淡掉')
  assert.equal(ghost.removed, 0, '动画还没完就把影子删了')
  ghost.calls[0].finish()
  await tick()
  assert.equal(ghost.removed, 1)
})

test('[P1-11] 取消（back = true）：飞回原位用 ease、更短；距离太近（≤2px）不飞、只淡出', () => {
  const M = load()
  M.setMotionPref('full')
  const ghost = fakeEl()
  M.DRAG_FX.land(ghost, -300, 10, true)
  assert.equal(ghost.calls[0].timing.easing, M.MOTION.ease)
  assert.equal(ghost.calls[0].timing.duration, M.MOTION.base)
  const g2 = fakeEl()
  M.DRAG_FX.land(g2, 1, 1)
  assert.deepEqual([...props(g2.calls[0].frames)], ['opacity'])
})

test('[P1-11] 松手：简洁原地淡出（没有位移）；off 当场移除、不调 animate；没有落点坐标（NaN）也只淡出', async () => {
  const M = load()
  M.setMotionPref('lite')
  const ghost = fakeEl()
  M.DRAG_FX.land(ghost, 40, 80)
  assert.equal(ghost.calls.length, 1)
  assert.deepEqual([...props(ghost.calls[0].frames)], ['opacity'])
  ghost.calls[0].finish()
  await tick()
  assert.equal(ghost.removed, 1)
  M.setMotionPref('off')
  const g2 = fakeEl()
  M.DRAG_FX.land(g2, 40, 80)
  assert.equal(g2.calls.length, 0)
  assert.equal(g2.removed, 1, 'off 档影子要当场移除')
  M.setMotionPref('full')
  const g3 = fakeEl()
  M.DRAG_FX.land(g3, NaN, NaN)
  assert.deepEqual([...props(g3.calls[0].frames)], ['opacity'])
})

test('[P1-11] 落地：占位内容从 30% 淡回 1，只动 opacity（简洁也播，off 不播）', () => {
  const M = load()
  for (const level of ['full', 'lite']) {
    M.setMotionPref(level)
    const el = fakeEl()
    M.DRAG_FX.settle(el)
    assert.equal(el.calls.length, 1, level)
    assert.deepEqual(el.calls[0].frames.map((f) => f.opacity), [0.3, 1])
  }
  M.setMotionPref('off')
  const el = fakeEl()
  M.DRAG_FX.settle(el)
  assert.equal(el.calls.length, 0)
})

// ── P0-5 边缘自动滚动 ─────────────────────────────────────────────────
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
test('[P1-5] 拿走：完整档先淡出 + scale .97（easeOut、fast），结束后才 unmount；简洁只淡出；off 当场 unmount', async () => {
  const M = load()
  M.setMotionPref('full')
  const el = fakeEl()
  let gone = 0
  M.DRAG_FX.exit(el, () => { gone += 1 })
  assert.equal(el.calls.length, 1)
  assert.match(el.calls[0].frames.at(-1).transform, /scale\(\.97\)/)
  assert.equal(el.calls[0].frames.at(-1).opacity, 0)
  assert.equal(el.calls[0].timing.easing, M.MOTION.easeOut)
  assert.equal(gone, 0)
  el.calls[0].finish()
  await tick()
  assert.equal(gone, 1)
  M.setMotionPref('lite')
  const e2 = fakeEl()
  M.DRAG_FX.exit(e2, () => {})
  assert.deepEqual([...props(e2.calls[0].frames)], ['opacity'])
  M.setMotionPref('off')
  const e3 = fakeEl()
  let g3 = 0
  M.DRAG_FX.exit(e3, () => { g3 += 1 })
  assert.equal(e3.calls.length, 0)
  assert.equal(g3, 1)
})

// ── P2-5 ⇄ 徽章 pop ───────────────────────────────────────────────────
test('[P2-5] ⇄ 徽章 pop：完整档 scale .4→1 + 淡入；简洁只淡入', () => {
  const M = load()
  assert.ok(Array.isArray(M.BADGE_POP), '没有 BADGE_POP')
  M.setMotionPref('full')
  const el = fakeEl()
  M.play(el, M.BADGE_POP, { duration: M.MOTION.base, easing: M.MOTION.spring })
  assert.deepEqual([...props(el.calls[0].frames)].sort(), ['opacity', 'transform'])
  M.setMotionPref('lite')
  const e2 = fakeEl()
  M.play(e2, M.BADGE_POP, { duration: M.MOTION.base, easing: M.MOTION.spring })
  assert.deepEqual([...props(e2.calls[0].frames)], ['opacity'])
  assert.equal(e2.calls[0].timing.easing, M.MOTION.ease)
})

test('[P2-5] PopBadge：只在 pop = true 时挂上播一次（经 play）', () => {
  assert.ok(popSrc.length > 100, '没切到 PopBadge')
  assert.match(popSrc, /if \(pop !== true\) return/)
  assert.match(popSrc, /play\(ref\.current, BADGE_POP/)
  // 三处 ⇄ 徽章（块头标签、塔按钮角标、积木按钮角标）都换成 PopBadge，按「这次新出现」判定。
  assert.equal((dockSrc.match(/h\(PopBadge, \{ pop: popIf\(/g) ?? []).length, 3)
  assert.match(dockSrc, /overlapSeen\.current = list === null \? null : overlapNow\.current/)
})


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

test('[P1-11] startDrag：越过 4px 拔出影子（lift）；列表内松手 ⇒ 影子飞到落点占位的把手旁（spring），落定后移除', async () => {
  const { drag, order, dom } = loadDrag({ bench: ABC, rows: [['A', 100], ['B', 148], ['C', 196]] })
  drag('A', [120, 120], [[120, 140], [120, 230]])
  assert.equal(order(), 'B,C,A')
  const ghost = dom.ghosts[0]
  assert.equal(ghost.calls.length, 2, '应有拔出 + 收场两段动画')
  assert.match(ghost.calls[0].frames.map((f) => f.transform).join(), /scale\(1\.04\)/)
  const land = ghost.calls[1]
  assert.equal(land.timing.easing, load().MOTION.spring)
  // 落点：A 的把手（假 DOM 里在 A 那行 x 140..152，y 105..121）右侧 8px + 影子半宽 40 ⇒ x = 200；y = 113。指针在 (120, 230)。
  assert.match(land.frames.at(-1).transform, /calc\(-50% \+ 80px\),calc\(-50% \+ -117px\)/)
  assert.equal(ghost.removed, 0)
  land.finish()
  await tick()
  assert.equal(ghost.removed, 1)
})

test('[P1-11] startDrag：拖出列表松手 / Esc ⇒ 不落位，影子飞回按下时的把手（ease）；没过 4px 不出影子动画', () => {
  const a = loadDrag({ bench: ABC, rows: [['A', 100], ['B', 148], ['C', 196]] })
  a.drag('A', [120, 120], [[120, 140], [900, 240]])
  assert.equal(a.order(), 'A,B,C')
  const back = a.dom.ghosts[0].calls[1]
  assert.equal(back.timing.easing, load().MOTION.ease)
  // 原位把手：x 152 + 8 + 40 = 200，y 113；指针在 (900, 240)。
  assert.match(back.frames.at(-1).transform, /calc\(-50% \+ -700px\),calc\(-50% \+ -127px\)/)
  const e = loadDrag({ bench: ABC, rows: [['A', 100], ['B', 148], ['C', 196]] })
  e.drag('A', [120, 120], [[120, 140], [120, 230]], (dom) => dom.fire('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} }))
  assert.equal(e.order(), 'A,B,C')
  assert.equal(e.dom.ghosts[0].calls.length, 2)
  const s = loadDrag({ bench: ABC, rows: [['A', 100], ['B', 148], ['C', 196]] })
  s.drag('A', [120, 120], [[300, 122]])
  assert.equal(s.dom.ghosts[0].calls.length, 0)
  assert.equal(s.dom.ghosts[0].removed, 1)
})

test('[P1-11] startDrag：off 档拔出 / 收场都不调 animate，影子当场移除；落位不受影响', () => {
  const { drag, order, dom } = loadDrag({ bench: ABC, rows: [['A', 100], ['B', 148], ['C', 196]], level: 'off' })
  drag('A', [120, 120], [[120, 140], [120, 230]])
  assert.equal(order(), 'B,C,A')
  assert.equal(dom.ghosts[0].calls.length, 0)
  assert.equal(dom.ghosts[0].removed, 1)
})

test('[P1-11] ↑↓ 挪过的块短暂描边：↑↓ 走 nudgeBenchBlock，按递增 n 重挂 BlockGlow', () => {
  assert.match(dockSrc, /'data-prefill-bench-up': block\.key, onClick: \(\) => nudgeBenchBlock\(block\.key, -1\)/)
  assert.match(dockSrc, /'data-prefill-bench-down': block\.key, onClick: \(\) => nudgeBenchBlock\(block\.key, 1\)/)
  assert.match(dockSrc, /benchNudged\.key === block\.key \? h\(BlockGlow, \{ key: 'nudge-' \+ benchNudged\.n \}\)/)
})

test('[P1-5] 拿走接线：×、菜单「从工作台拿走」、积木按钮再点、塔按钮 / 塔框「拿走」都先退场（exitFromBench）；长块展开收起触发 FLIP', () => {
  assert.match(dockSrc, /'data-prefill-bench-drop': block\.key, onClick: \(\) => dropBlockAnimated\(block\)/)
  assert.match(dockSrc, /row\('drop', t\('benchMenuDrop'\), \(\) => exitFromBench\(/)
  assert.match(dockSrc, /on \? exitFromBench\('ref:' \+ block\.id/)
  assert.match(dockSrc, /removeTowerAnimated\(tower\.id/)
  assert.match(rowsSrc, /'data-prefill-tower-remove': towerKey, onClick: \(\) => removeTowerAnimated\(/)
  assert.match(dockSrc, /DRAG_FX\.exit\(node, /)
  assert.match(dockSrc, /if \(benchExiting\.current\.has\(id\)\) return/)
  // 展开 / 收起：顺序没变也让这一次 FLIP 生效（下面的块滑过去）。
  assert.match(dockSrc, /if \(current\.has\(key\) === open\) return current\n\s+benchFlipNext\.current = true/)
  assert.match(dockSrc, /benchSig\.current !== sig \|\| folded/)
})
