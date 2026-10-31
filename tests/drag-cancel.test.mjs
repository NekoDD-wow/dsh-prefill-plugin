// issue #27：工作台积木拖动没法放弃（拖出列表 / Esc 松手照样落位；拖动中滚动按旧位置落）。
// issue #28：benchRows 按塔全局分组 ⇒ 塔后面跟散块时屏幕顺序 ≠ bench（注入）顺序；startDrag 把屏幕行号当 bench 下标。
// 做法：把 client.js 里的 startDrag、moveBlockTo、benchRows 切出来，配假的 document / 列表 DOM 直接跑，
// 只看松手之后 bench 变成什么（不绑 moveBlockTo 的参数形式）。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const cut = (from, to) => {
  const a = src.indexOf(from)
  const b = src.indexOf(to, a)
  return a >= 0 && b > a ? src.slice(a, b) : ''
}
const dragSrc = cut('      const startDrag = (event, block) => {', '      // 长块默认收起')
const moveSrc = cut('      const moveBlockTo = (', '      const addTowerToBenchNow')
const rowsSrc = cut('      const benchRows = () => {', '      // ── v0.15：工作台的渲染件')

// ── 假 DOM ───────────────────────────────────────────────────────────────
// 默认版面（视口坐标，和真实页面同构）：列表 x 100..500，y 90..410；
//   A 100-140 · B 148-188 · C 196-236 · 塔框 rp-pack 250-366 { T1 270-310 · T2 318-358 } · ＋自定义 372-404
// 聊天区在列表左边 / 右边（x = 900 视为聊天区）。bench = [A, B, C, T1@rp-pack, T2@rp-pack]。
const LIST = { left: 100, right: 500, top: 90, bottom: 410 }
const BENCH = [
  { key: 'A', tower: null }, { key: 'B', tower: null }, { key: 'C', tower: null },
  { key: 'T1', tower: 'rp-pack' }, { key: 'T2', tower: 'rp-pack' },
]
const ROWS = [['A', 100], ['B', 148], ['C', 196], ['T1', 270], ['T2', 318]]
const FRAMES = [{ key: 'rp-pack', top: 250, bottom: 366 }]

function makeDom(rows, frames) {
  let scroll = 0 // 列表（或外层面板）滚了多少像素：所有元素的 top 一起减
  const handlers = { document: {}, window: {} }
  const on = (where) => (type, fn) => { (handlers[where][type] ??= []).push(fn) }
  const off = (where) => (type, fn) => { handlers[where][type] = (handlers[where][type] ?? []).filter((f) => f !== fn) }
  const rect = (top, height, left = LIST.left + 34, right = LIST.right) => ({ top: top - scroll, bottom: top + height - scroll, height, left, right, width: right - left, x: left, y: top - scroll })
  const rowNode = ([key, top]) => ({
    getAttribute: (name) => (name === 'data-prefill-bench-block' ? key : null),
    getBoundingClientRect: () => rect(top, 40),
  })
  const frameNode = (frame) => ({
    getAttribute: (name) => (name === 'data-prefill-bench-tower' ? frame.key : null),
    getBoundingClientRect: () => rect(frame.top, frame.bottom - frame.top),
  })
  const list = {
    scrollTop: 0,
    querySelectorAll(sel) {
      if (sel.includes('data-prefill-bench-block')) return rows.map(rowNode)
      if (sel.includes('data-prefill-bench-tower')) return frames.map(frameNode)
      return []
    },
    getBoundingClientRect: () => rect(LIST.top, LIST.bottom - LIST.top, LIST.left, LIST.right),
    contains: () => true,
  }
  const document = {
    body: { style: { userSelect: '' }, appendChild() {} },
    createElement: () => ({ style: {}, remove() {} }),
    addEventListener: on('document'),
    removeEventListener: off('document'),
  }
  const window = {
    getSelection: () => ({ removeAllRanges() {} }),
    addEventListener: on('window'),
    removeEventListener: off('window'),
  }
  const fire = (type, ev) => {
    for (const where of ['window', 'document']) for (const fn of [...(handlers[where][type] ?? [])]) fn(ev)
  }
  const live = () => Object.values(handlers).reduce((n, byType) => n + Object.values(byType).reduce((m, fns) => m + fns.length, 0), 0)
  return {
    list, document, window, fire, live,
    scrollBy(dy) { scroll += dy; list.scrollTop += dy; fire('scroll', { type: 'scroll', target: list }) },
  }
}

function load({ bench = BENCH, rows = ROWS, frames = FRAMES } = {}) {
  const dom = makeDom(rows, frames)
  const state = { bench, setBenchCalls: 0, drop: [] }
  const ref = (v) => ({ current: v })
  // eslint-disable-next-line no-new-func
  const moveBlockTo = new Function('bench', 'setBench', `${moveSrc}\nreturn moveBlockTo`)(bench, (next) => {
    state.setBenchCalls += 1
    state.bench = next
  })
  const setDropIndex = (fn) => state.drop.push(typeof fn === 'function' ? fn(state.drop.at(-1) ?? -1) : fn)
  // eslint-disable-next-line no-new-func
  const startDrag = new Function(
    'bench', 'benchListRef', 'dragInfo', 'setDragKey', 'setDropIndex', 'moveBlockTo', 'document', 'window',
    `${dragSrc}\nreturn startDrag`,
  )(bench, ref(dom.list), ref(null), () => {}, setDropIndex, moveBlockTo, dom.document, dom.window)
  const ev = (x, y, extra = {}) => ({ type: 'pointer', button: 0, clientX: x, clientY: y, preventDefault() {}, ...extra })
  /** 按下 → 依次经过 path 里的点 → 在最后一个点松手（和 Playwright page.mouse down/move/up 同序）。 */
  const drag = (block, from, path, beforeUp) => {
    startDrag(ev(...from), { key: block, name: block })
    for (const p of path) dom.fire('pointermove', ev(...p))
    const upAt = beforeUp?.(dom)
    const last = upAt ?? path.at(-1) ?? from
    dom.fire('pointerup', ev(...last))
  }
  const order = () => state.bench.map((b) => (b.tower ? b.key + '@' + b.tower : b.key)).join(',')
  return { dom, state, drag, order }
}
const UNCHANGED = 'A,B,C,T1@rp-pack,T2@rp-pack'

test('切片存在：client.js 里找得到 startDrag / moveBlockTo / benchRows', () => {
  assert.ok(dragSrc.length > 200, '没切到 startDrag（函数名或下一段注释改了？）')
  assert.ok(moveSrc.length > 100, '没切到 moveBlockTo')
  assert.ok(rowsSrc.length > 100, '没切到 benchRows')
})

// ── 对照：正常拖动，改前改后都该通过 ─────────────────────────────────────
test('[对照] 列表内竖拖：A 拖到 C 与塔之间 ⇒ A 落在 C 后、塔前，不进塔', () => {
  const { drag, order } = load()
  drag('A', [120, 120], [[120, 140], [120, 200], [120, 244]])
  assert.equal(order(), 'B,C,A,T1@rp-pack,T2@rp-pack')
})

test('[对照] 列表内把塔里的 T1 拖到 A、B 之间（塔框外）⇒ 移出塔', () => {
  const { drag, order } = load()
  drag('T1', [120, 290], [[120, 280], [120, 200], [120, 145]])
  assert.equal(order(), 'A,T1,B,C,T2@rp-pack')
})

test('[对照] 列表内把 C 拖进塔框（T1、T2 之间）⇒ 进塔', () => {
  const { drag, order } = load()
  drag('C', [120, 216], [[120, 230], [120, 300], [120, 320]])
  assert.equal(order(), 'A,B,T1@rp-pack,C@rp-pack,T2@rp-pack')
})

test('[对照] 只动了不到 4px ⇒ 不算拖动，不落位', () => {
  const { drag, state, order } = load()
  drag('A', [120, 120], [[400, 122]])
  assert.equal(order(), UNCHANGED)
  assert.equal(state.setBenchCalls, 0)
})

// ── #27：拖动没法放弃 ───────────────────────────────────────────────────
test('[#27 a] 横向拖出列表、在聊天区（x=900）松手 ⇒ 取消，不移动', () => {
  const { drag, state, order } = load()
  drag('A', [120, 120], [[120, 140], [600, 200], [900, 244]])
  assert.equal(order(), UNCHANGED, '松手点在列表矩形外 400px，仍然落位')
  assert.equal(state.setBenchCalls, 0)
})

test('[#27 b] 拖到列表下方很远（y=900，x 仍在列表范围）松手 ⇒ 取消，不会被移到末尾', () => {
  const { drag, order } = load()
  drag('B', [120, 168], [[120, 200], [120, 600], [120, 900]])
  assert.equal(order(), UNCHANGED)
})

test('[#27 b′] 拖到列表上方很远（y=-200）松手 ⇒ 取消，不会被移到开头', () => {
  const { drag, order } = load()
  drag('C', [120, 216], [[120, 200], [120, 20], [120, -200]])
  assert.equal(order(), UNCHANGED)
})

test('[#27 c] 塔里的 T1 拖到列表外（聊天区）松手 ⇒ 取消：既不挪位置，也不被移出塔', () => {
  const { drag, order } = load()
  drag('T1', [120, 290], [[120, 300], [700, 500], [900, 600]])
  assert.equal(order(), UNCHANGED)
})

test('[#27 c′] 塔里的 T1 横拖到列表外但 y 仍在塔框高度内松手 ⇒ 取消', () => {
  const { drag, order } = load()
  drag('T1', [120, 290], [[120, 300], [900, 340]])
  assert.equal(order(), UNCHANGED)
})

test('[#27] 拖出列表时插入线隐藏（dropIndex = -1），拖回列表内又出现', () => {
  const { drag, state } = load()
  drag('A', [120, 120], [[120, 140], [120, 244], [900, 244], [120, 244]])
  // 140 ⇒ B 前（下标 1）· 244 ⇒ T1 前（下标 3）· 出列表 ⇒ -1 · 回来 ⇒ 3；收尾 -1
  assert.deepEqual(state.drop, [1, 3, -1, 3, -1])
})

test('[#27 d] 拖动中列表被滚动 100px ⇒ 落点按滚动后的实时位置算（A 落到 T2 前、在塔内）', () => {
  const { drag, order } = load()
  // 滚动后：A 0-40 · B 48-88 · C 96-136 · 塔框 150-266 { T1 170-210 · T2 218-258 }
  // 指针停在 y=230（滚动后 T2 上半部）⇒ 插到 T2 之前，并归入塔 rp-pack。
  drag('A', [120, 120], [[120, 140], [120, 200]], (dom) => {
    dom.scrollBy(100)
    dom.fire('pointermove', { type: 'pointer', button: 0, clientX: 120, clientY: 230, preventDefault() {} })
    return [120, 230]
  })
  assert.equal(order(), 'B,C,T1@rp-pack,A@rp-pack,T2@rp-pack')
})

test('[#27 d′] 只滚动、不再动鼠标 ⇒ 插入线按最后的指针位置实时重算', () => {
  const { drag, state, order } = load()
  // 停在 y=244（C 与塔之间 ⇒ T1 前，下标 3）；滚动 100px 后同一点落在 T2 下半部、塔框内 ⇒ 塔末尾（下标 5）。
  drag('A', [120, 120], [[120, 140], [120, 244]], (dom) => {
    dom.scrollBy(100)
    return [120, 244]
  })
  assert.deepEqual(state.drop.slice(0, 3), [1, 3, 5], '滚动后插入线没跟着变: ' + JSON.stringify(state.drop))
  assert.equal(order(), 'B,C,T1@rp-pack,T2@rp-pack,A@rp-pack')
})

test('[#27 e] 拖动中按 Esc ⇒ 取消，松手不落位；Esc 被拦下（面板不会跟着关），监听全部撤掉', () => {
  const { drag, order, dom } = load()
  let stopped = 0
  drag('A', [120, 120], [[120, 140], [120, 244]], (d) => {
    d.fire('keydown', { type: 'keydown', key: 'Escape', preventDefault() {}, stopPropagation() { stopped += 1 } })
  })
  assert.equal(order(), UNCHANGED, '按了 Esc 仍然落位')
  assert.equal(stopped, 1, 'Esc 没有 stopPropagation，会被面板的 Esc 当成「关面板」')
  assert.equal(dom.live(), 0, '拖动结束后还有监听没撤')
})

test('[#27] 正常松手后监听全部撤掉', () => {
  const { drag, dom } = load()
  drag('A', [120, 120], [[120, 140], [120, 244]])
  assert.equal(dom.live(), 0)
})

// ── #28：屏幕顺序 ≠ bench 顺序 ──────────────────────────────────────────
const renderRows = (bench, towers) => {
  const h = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) })
  // eslint-disable-next-line no-new-func
  const benchRows = new Function(
    'bench', 'benchTowers', 'benchCard', 'benchColor', 'h', 'V', 't', 'toggleTowerCollapsed', 'removeTowerFromBench',
    `${rowsSrc}\nreturn benchRows`,
  )(bench, towers, (block) => ({ type: 'card', key: block.key, props: {}, children: [] }), () => 'x', h, { row: {}, btnGhost: {} }, (k) => k, () => {}, () => {})
  return benchRows()
}
const RP = { 'rp-pack': { ref: 'rp-pack', name: '角色扮演套餐', collapsed: false } }

test('[#28 a] 渲染顺序与 bench 顺序一致：bench = [A, B, T1@塔, T2@塔, C] ⇒ 屏幕上 C 在塔之后', () => {
  const bench = [
    { key: 'A', tower: null }, { key: 'B', tower: null },
    { key: 'T1', tower: 'rp-pack' }, { key: 'T2', tower: 'rp-pack' },
    { key: 'C', tower: null },
  ]
  const flat = []
  const walk = (node) => {
    if (node === null || typeof node !== 'object') return
    if (node.type === 'card') flat.push(node.key)
    for (const child of node.children ?? []) walk(child)
  }
  for (const row of renderRows(bench, RP)) walk(row)
  assert.deepEqual(flat, bench.map((b) => b.key), '屏幕顺序 ' + flat.join(',') + ' ≠ bench（注入）顺序')
})

test('[#28 b] 同一个塔被散块隔开 ⇒ 画两个框，React key 互不相同', () => {
  const bench = [{ key: 'T1', tower: 'rp-pack' }, { key: 'A', tower: null }, { key: 'T2', tower: 'rp-pack' }]
  const rows = renderRows(bench, RP)
  const frames = rows.filter((row) => row.props['data-prefill-bench-tower'] === 'rp-pack')
  assert.equal(frames.length, 2, '应画两个塔框')
  assert.ok(frames[0].props.key && frames[1].props.key && frames[0].props.key !== frames[1].props.key, '两个塔框 React key 重复: ' + frames.map((f) => f.props.key).join(' / '))
  assert.deepEqual(rows.map((row) => (row.type === 'card' ? row.key : 'frame')), ['frame', 'A', 'frame'])
})

test('[#28 c] 塔收起时（块不画在屏幕上）把 A 拖到塔下方的 C 前 ⇒ 落在 C 前，而不是按屏幕行号插进塔前', () => {
  // bench = [A, B, T1@塔, T2@塔, C]，塔收起：屏幕只有 A 100-140 · B 148-188 · 塔框（只有标题）196-226 · C 240-280
  const { drag, order } = load({
    bench: [
      { key: 'A', tower: null }, { key: 'B', tower: null },
      { key: 'T1', tower: 'rp-pack' }, { key: 'T2', tower: 'rp-pack' },
      { key: 'C', tower: null },
    ],
    rows: [['A', 100], ['B', 148], ['C', 240]],
    frames: [{ key: 'rp-pack', top: 196, bottom: 226 }],
  })
  drag('A', [120, 120], [[120, 140], [120, 200], [120, 234]]) // 234：塔框下方、C 上半部之上
  assert.equal(order(), 'B,T1@rp-pack,T2@rp-pack,A,C')
})

test('[#28 d] 原地松手（落点就是自己原来的位置）⇒ 不写 bench', () => {
  const { drag, state, order } = load()
  // B 拖到自己下半部（C 前）松手。
  drag('B', [120, 160], [[120, 166], [120, 180]])
  assert.equal(order(), UNCHANGED)
  assert.equal(state.setBenchCalls, 0)
})
