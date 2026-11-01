// 动效第 7 步「其余 P2」（docs/规划-动效.md §4.5）：P2-1 「当前」高亮层 FLIP、P2-2 开关圆点 spring、P2-5 「已改」小点 pop、
// P2-6 保存按钮对勾、P2-7 右键菜单从指针处长出、P2-8 实际发送预览展开与删除线、P2-9 钉住标记与芯片信息重复、
// P2-10 沙盒徽章颜色过渡与「拦 N」pop、P2-11 角色卡导入后新卡入场、P2-12 手动注入新行入场 / 发出后淡出。
// 照 tests/motion-dialog.test.mjs 的做法：把 client.js 的 <motion> + <feedback> + <rest> 段切出来配假 window 直接跑；
// 组件用一个只认 useState / useRef / useLayoutEffect / useEffect 的迷你 React 跑。改前（没有 <rest> 段）每一项各自失败。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
// 找不到就给空串：改前每一项各自失败，而不是整个文件加载失败。
const cut = (from, to) => {
  const a = src.indexOf(from)
  const b = src.indexOf(to, a)
  return a >= 0 && b > a ? src.slice(a, b) : ''
}
const motionSrc = cut('// <motion>', '// </motion>')
const feedbackSrc = cut('// <feedback>', '// </feedback>')
const restSrc = cut('// <rest>', '// </rest>')
const compSrc = (name) => cut(`    function ${name}(props) {`, '\n    }\n')
const COMPONENTS = ['SaveCheck', 'GrowMenu', 'Reveal', 'StrikeSeg', 'SandboxBadge']
const dockSrc = cut('    function PrefillDock(props) {', '    function UsagePanel(props) {')
const chipSrc = cut('    function PrefillToggle(props) {', '    function GateToggle(props) {')
const manualSrc = cut('    function ManualInject(props) {', '    function PrefillDock(props) {')

class FakeEvent {
  constructor(type, init) {
    this.type = type
    this.detail = init?.detail
  }
}
function fakeWindow(extra = {}) {
  const handlers = {}
  return {
    handlers,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    dispatchEvent: () => true,
    addEventListener(type, fn, capture) {
      ;(handlers[type] ??= []).push({ fn, capture })
    },
    removeEventListener(type, fn) {
      handlers[type] = (handlers[type] ?? []).filter((entry) => entry.fn !== fn)
    },
    ...extra,
  }
}
const NAMES = [
  'MOTION', 'setMotionPref', 'play', 'motionLevel', 'revealBlock', 'BLOCK_ENTER', 'BLOCK_GLOW', 'BADGE_POP',
  'glideFrames', 'boxIn', 'NAV_FX', 'NAV_HL_FADE',
  'SAVED_MS', 'CHECK_POP', 'CHECK_OUT', 'SAVE_FX',
  'MENU_GROW', 'menuOrigin', 'MENU_FX',
  'REVEAL_ENTER', 'REVEAL_EXIT', 'STRIKE_DRAW', 'STRIKE_DIM', 'REVEAL_FX',
  'CHIP_SWAP', 'chipCompact',
  'TONE_FADE', 'COUNT_POP', 'SBX_FX', 'flushCues', 'pendingCues',
  'cardArrival', 'ARRIVE_FX', 'BLOCK_GLOW_MS',
]
function load(win = fakeWindow(), doc = undefined) {
  const body = `${motionSrc}\n${feedbackSrc}\n${restSrc}\nreturn { ${NAMES.map((n) => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ')} }`
  // eslint-disable-next-line no-new-func
  return new Function('window', 'CustomEvent', 'document', body)(win, FakeEvent, doc)
}
/** 只取 <rest> 里的一个常量（不是函数 / 对象时 NAMES 里放不下）。 */
load.knob = () => {
  // eslint-disable-next-line no-new-func
  return new Function('window', 'CustomEvent', 'document', `${motionSrc}\n${restSrc}\nreturn typeof KNOB_TRANSITION === 'undefined' ? undefined : KNOB_TRANSITION`)(fakeWindow(), FakeEvent, undefined)
}
/** 假元素：记下每次 animate；finish() 让最近一次动画落定。root = 流式中的卡片根节点（可选）。 */
function fakeEl(root = null, extra = {}) {
  const calls = []
  const el = {
    calls,
    isConnected: true,
    focused: 0,
    offsetWidth: 64,
    style: { willChange: '' },
    closest(selector) {
      if (root === null) return null
      const want = /data-prefill-busy="([^"]+)"/.exec(selector)?.[1]
      return want !== undefined && root.getAttribute('data-prefill-busy') === want ? root : null
    },
    focus() {
      el.focused += 1
    },
    animate(frames, timing) {
      let resolve
      let reject
      const anim = {
        frames,
        timing,
        cancelled: 0,
        finished: new Promise((res, rej) => {
          resolve = res
          reject = rej
        }),
        cancel() {
          anim.cancelled += 1
          reject(new Error('cancel'))
        },
        finish: () => resolve(),
      }
      anim.finished.catch(() => {})
      calls.push(anim)
      return anim
    },
    ...extra,
  }
  return el
}
const props = (frames) => new Set(frames.flatMap((frame) => Object.keys(frame).filter((key) => !['offset', 'easing', 'composite', 'transformOrigin'].includes(key))))
const tick = () => new Promise((r) => setTimeout(r, 0))
const streamRoot = { getAttribute: (name) => (name === 'data-prefill-busy' ? 'stream' : null) }

/**
 * 迷你 React：只跑一个组件（子组件当普通节点留着），hooks 按调用顺序存槽位；layout effect / effect 依赖变了才重跑，先跑上一次的清理。
 * 渲染后按节点上的 data-prefill-* 属性把 ref 指到稳定的假元素（els[那个属性名]）。
 */
function mount(Component, initialProps, { els = {}, extraGlobals = {}, win = fakeWindow(), doc = undefined } = {}) {
  const slots = []
  const effects = []
  let cursor = 0
  let pending = []
  let dirty = false
  const React = {
    useState(init) {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof init === 'function' ? init() : init
      return [slots[index], (value) => {
        const next = typeof value === 'function' ? value(slots[index]) : value
        if (next !== slots[index]) {
          slots[index] = next
          dirty = true
        }
      }]
    },
    useRef(value) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { current: value }
      return slots[index]
    },
    useLayoutEffect(fn, deps) {
      const index = cursor++
      const prev = effects[index]
      const changed = deps === undefined || prev === undefined || deps.length !== prev.deps.length || deps.some((d, i) => !Object.is(d, prev.deps[i]))
      if (changed) pending.push({ index, fn, deps })
    },
    useCallback: (fn) => fn,
  }
  React.useEffect = React.useLayoutEffect
  const h = (type, p, ...children) => ({ type, props: p ?? {}, children: children.flat(Infinity) })
  const tint = () => 'tint'
  const g = { React, h, tint, V: new Proxy({}, { get: () => ({}) }), useMotionLevel: () => 'full', Spinner: () => null, ...extraGlobals }
  const names = Object.keys(g)
  const fn = (part) => (part === '' ? '' : `${part}\n    }\n`)
  const body = `${motionSrc}\n${feedbackSrc}\n${restSrc}\n${COMPONENTS.map((name) => fn(compSrc(name))).join('')}return { ${Component}: typeof ${Component} === 'undefined' ? undefined : ${Component}, setMotionPref, mod: { ${NAMES.map((n) => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ')} } }`
  // eslint-disable-next-line no-new-func
  const made = new Function('window', 'CustomEvent', 'document', ...names, body)(win, FakeEvent, doc, ...names.map((n) => g[n]))
  const Comp = made[Component]
  let currentProps = initialProps
  let tree = null
  const attach = (node) => {
    if (node === null || typeof node !== 'object') return
    if (node.props?.ref) {
      const key = Object.keys(node.props).find((k) => k.startsWith('data-prefill-')) ?? node.type
      els[key] ??= fakeEl()
      node.props.ref.current = els[key]
    }
    for (const child of node.children ?? []) attach(child)
  }
  const render = (nextProps = currentProps) => {
    currentProps = nextProps
    for (let round = 0; round < 10; round += 1) {
      cursor = 0
      pending = []
      dirty = false
      tree = Comp(currentProps)
      attach(tree)
      for (const { index, fn, deps } of pending) {
        effects[index]?.cleanup?.()
        const cleanup = fn()
        effects[index] = { deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined }
      }
      if (!dirty) break
    }
    return tree
  }
  render()
  return { render, get tree() { return tree }, els, made, mod: made.mod, rerender: () => render() }
}
const find = (tree, pred) => {
  const out = []
  const walk = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (pred(node.props ?? {}, node)) out.push(node)
    for (const child of node.children ?? []) walk(child)
  }
  walk(tree)
  return out
}


/** 假的导航容器 / 项：getBoundingClientRect 按给定框，容器带滚动量。 */
const rectEl = (box, extra = {}) => ({ ...fakeEl(), getBoundingClientRect: () => ({ ...box, right: box.left + box.width, bottom: box.top + box.height }), ...extra })

// ── P2-1 「当前」高亮层 FLIP ─────────────────────────────────────

test('[P2-1] glideFrames：从旧框 translate + scale 回到 none（origin 左上）；量不到 / 没变 ⇒ null；boxIn 加上容器滚动', () => {
  const { glideFrames, boxIn } = load()
  assert.equal(typeof glideFrames, 'function', '没有 glideFrames')
  const frames = glideFrames({ left: 0, top: 10, width: 200, height: 40 }, { left: 0, top: 90, width: 200, height: 20 })
  assert.deepEqual(frames, [
    { transform: 'translate(0px, -80px) scale(1, 2)', transformOrigin: '0 0' },
    { transform: 'none', transformOrigin: '0 0' },
  ])
  assert.equal(glideFrames(null, { left: 0, top: 0, width: 1, height: 1 }), null)
  assert.equal(glideFrames({ left: 0, top: 0, width: 0, height: 10 }, { left: 0, top: 0, width: 10, height: 10 }), null, '宽 0 量不到')
  assert.equal(glideFrames({ left: 5, top: 5, width: 10, height: 10 }, { left: 5, top: 5, width: 10, height: 10 }), null, '没变')
  const host = rectEl({ left: 100, top: 50, width: 214, height: 400 }, { scrollTop: 30, scrollLeft: 0 })
  const item = rectEl({ left: 108, top: 70, width: 198, height: 44 })
  assert.deepEqual(boxIn(item, host), { left: 8, top: 50, width: 198, height: 44 })
  assert.equal(boxIn(null, host), null)
})

test('[P2-1] NAV_FX.glide：完整档位移类滑过去（base / ease）；减少动效 = 新高亮淡入（只 opacity）；off 不调 animate；量不到退回淡入', () => {
  const { NAV_FX, MOTION, setMotionPref } = load()
  assert.equal(typeof NAV_FX?.glide, 'function', '没有 NAV_FX.glide')
  const from = { left: 8, top: 8, width: 198, height: 44 }
  const to = { left: 8, top: 100, width: 198, height: 44 }
  const layer = fakeEl()
  NAV_FX.glide(layer, from, to)
  assert.equal(layer.calls.length, 1)
  assert.match(layer.calls[0].frames[0].transform, /^translate\(0px, -92px\) scale\(1, 1\)$/)
  assert.equal(layer.calls[0].timing.duration, MOTION.base)
  assert.equal(layer.calls[0].timing.easing, MOTION.ease)
  const unmeasured = fakeEl()
  NAV_FX.glide(unmeasured, null, to)
  assert.deepEqual([...props(unmeasured.calls[0].frames)], ['opacity'], '量不到：淡入')
  setMotionPref('lite')
  const lite = fakeEl()
  NAV_FX.glide(lite, from, to)
  assert.equal(lite.calls.length, 1)
  assert.deepEqual([...props(lite.calls[0].frames)], ['opacity'], '减少动效：没有位移')
  setMotionPref('off')
  const off = fakeEl()
  assert.equal(NAV_FX.glide(off, from, to), null)
  assert.equal(off.calls.length, 0)
})

test('[P2-1] 接线：选中项的底色挪进一层 data-prefill-nav-hl（z-index -1，导航容器 isolation）；宽屏左栏和窄屏标签都有；换节后 layout effect 从上一项的框滑过来', () => {
  assert.match(dockSrc, /const navHighlight = \(radius\) =>/)
  assert.match(dockSrc, /'data-prefill-nav-hl': '', style: \{ position: 'absolute', inset: 0, zIndex: -1/)
  assert.equal((dockSrc.match(/selected \? navHighlight\(/g) ?? []).length, 2, '左栏项和窄屏标签各一处')
  assert.equal((dockSrc.match(/ref: navRef, role: 'tablist', (?:'aria-orientation': 'vertical', )?style: \{ position: 'relative', isolation: 'isolate'/g) ?? []).length, 2)
  assert.doesNotMatch(dockSrc, /background: selected \? 'var\(--dsw-alias-bg-base\)' : 'transparent'/, '项自己不再画选中底色')
  assert.match(dockSrc, /navNow\.current = \{ pane: shownPane, narrow \}/)
  assert.match(dockSrc, /host\.querySelector\(`\[data-prefill-nav-box="\$\{was\.pane\}"\]`\)/)
  assert.match(dockSrc, /NAV_FX\.glide\(layer, boxIn\(from, host\), boxIn\(layer, host\)\)/)
  assert.match(dockSrc, /was\.narrow !== now\.narrow\) return/, '宽窄屏切换时不滑')
})

// ── P2-2 开关圆点 spring ─────────────────────────────────────────

test('[P2-2] KNOB_TRANSITION：transform、base、spring；卡片左栏开关和设置页开关都只在完整档用它，其余档不过渡', () => {
  const { MOTION } = load()
  const knob = load.knob()
  assert.equal(knob, `transform ${MOTION.base}ms ${MOTION.spring}`)
  assert.match(dockSrc, /transform: on \? 'translateX\(12px\)' : 'none', transition: motion === 'full' \? KNOB_TRANSITION : 'none'/)
  assert.match(src, /transform: on \? 'translateX\(16px\)' : 'none',\n\s+transition: motionLevel\(\) === 'full' \? KNOB_TRANSITION : 'none'/)
  assert.doesNotMatch(src, /translateX\(1[26]px\)' : 'none',?\s+transition: [^\n]*MOTION\.fast\}ms \$\{MOTION\.ease\}/, '圆点不再是 fast / ease')
})

// ── P2-5 「已改」小点 pop ─────────────────────────────────────────

test('[P2-5] 接线：「已改」小点（塔按钮角标、积木按钮角标、工作台块头）都走 PopBadge，pop 用同一套 popIf（新出现才播）', () => {
  const dots = dockSrc.match(/h\(PopBadge, \{ pop: popEdited\([^)]*\), 'data-prefill-edited-dot'/g) ?? []
  assert.equal(dots.length, 3, '三处「已改」小点')
  assert.match(dockSrc, /const popEdited = \(id\) => popIf\('edited:' \+ id\)/)
  assert.match(dockSrc, /popEdited\('tower:' \+ tower\.id\)/)
  assert.match(dockSrc, /popEdited\('block:' \+ block\.id\)/)
  assert.match(dockSrc, /popEdited\(block\.key\)/)
  assert.doesNotMatch(dockSrc, /h\('span', \{ style: \{ position: 'absolute', top: -3, right: -3, width: 8, height: 8, borderRadius: 4, background: 'var\(--pf-turn\)' \} \}\)/, '不再是静态小点')
})

// ── P2-6 保存按钮对勾 ─────────────────────────────────────────────

/** 手动计时器：run() 跑掉到期的。 */
function fakeTimers() {
  let id = 0
  const list = new Map()
  return {
    setTimeout: (fn, ms) => {
      id += 1
      list.set(id, { fn, ms })
      return id
    },
    clearTimeout: (key) => list.delete(key),
    run() {
      const due = [...list.entries()]
      list.clear()
      for (const [, entry] of due) entry.fn()
      return due.length
    },
    get size() {
      return list.size
    },
    get delays() {
      return [...list.values()].map((entry) => entry.ms)
    },
  }
}

test('[P2-6] SAVE_FX：完整档 ✓ pop（scale .4→1、spring、base）；淡出后卸载；减少动效只剩 opacity；off 当场卸载、不调 animate；流式中照常', async () => {
  const { SAVE_FX, MOTION, SAVED_MS, setMotionPref } = load()
  assert.equal(typeof SAVE_FX?.pop, 'function', '没有 SAVE_FX')
  assert.ok(SAVED_MS >= 1000 && SAVED_MS <= 2000)
  const el = fakeEl(streamRoot)
  SAVE_FX.pop(el)
  assert.equal(el.calls.length, 1, '流式中照常（直接反馈）')
  assert.deepEqual(el.calls[0].frames.map((f) => f.transform), ['scale(.4)', 'scale(1)'])
  assert.equal(el.calls[0].timing.easing, MOTION.spring)
  let gone = 0
  SAVE_FX.out(el, () => (gone += 1))
  assert.deepEqual([...props(el.calls[1].frames)], ['opacity'])
  assert.equal(el.calls[1].timing.duration, MOTION.fast, '出场比入场快')
  assert.equal(gone, 0)
  el.calls[1].finish()
  await tick()
  assert.equal(gone, 1)
  setMotionPref('lite')
  const lite = fakeEl()
  SAVE_FX.pop(lite)
  assert.deepEqual([...props(lite.calls[0].frames)], ['opacity'])
  assert.equal(lite.calls[0].timing.easing, MOTION.ease, '减少动效：spring 换 ease')
  setMotionPref('off')
  const off = fakeEl()
  let offGone = 0
  assert.equal(SAVE_FX.pop(off), null)
  SAVE_FX.out(off, () => (offGone += 1))
  assert.equal(off.calls.length, 0)
  assert.equal(offGone, 1, 'off：当场卸载')
})

test('[P2-6] SaveCheck：挂上时已有的 tick 不播；tick 变了 ⇒ ✓ 角标 pop，SAVED_MS 后淡出卸载；显示中又保存 ⇒ 打断淡出重新 pop', async () => {
  const timers = fakeTimers()
  const els = {}
  const m = mount('SaveCheck', { tick: 3 }, { els, extraGlobals: { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout } })
  assert.equal(typeof m.made.SaveCheck, 'function', '没有 SaveCheck')
  assert.equal(m.tree, null, '挂上时的 tick 不播')
  m.render({ tick: 4 })
  assert.equal(m.tree?.props['data-prefill-saved-check'], '4')
  assert.equal(m.tree.props['aria-hidden'], 'true')
  assert.equal(m.tree.props.style.position, 'absolute', '角标：不改按钮宽度')
  assert.equal(m.tree.props.style.pointerEvents, 'none')
  const el = els['data-prefill-saved-check']
  assert.equal(el.calls.length, 1)
  assert.deepEqual(timers.delays, [m.mod.SAVED_MS], '停 SAVED_MS')
  timers.run()
  assert.equal(el.calls.length, 2, '到时淡出')
  m.render({ tick: 5 })
  assert.equal(el.calls[1].cancelled, 1, '又保存：打断淡出')
  assert.equal(el.calls.length, 3, '重新 pop')
  assert.equal(m.tree?.props['data-prefill-saved-check'], '5')
  timers.run()
  el.calls[3].finish()
  await tick()
  m.rerender()
  assert.equal(m.tree, null, '淡出后卸载')
})

test('[P2-6] 接线：保存 / 另存为成功（savePack 落定后）savedTick +1；「保存」按钮 position: relative 并挂 SaveCheck', () => {
  assert.match(dockSrc, /const \[savedTick, setSavedTick\] = React\.useState\(0\)/)
  assert.match(dockSrc, /setPackName\(name\)\n\s+setMenu\(''\)\n\s+setSavedTick\(\(value\) => value \+ 1\)/)
  assert.match(dockSrc, /style: \{ \.\.\.V\.btn, position: 'relative', \.\.\.\(busyCtl\.shown\('save'\) \? BUSY_LOOK : \{\}\) \},\n\s+'data-prefill-save': ''/)
  assert.match(dockSrc, /t\('saveShort'\),\n\s+h\(SaveCheck, \{ key: 'saved', tick: savedTick \}\)/)
})

// ── P2-7 右键菜单从指针处长出 ─────────────────────────────────────

test('[P2-7] menuOrigin：指针相对菜单左上角，夹在菜单框里；没有指针 / 量不到 ⇒ 左上角', () => {
  const { menuOrigin } = load()
  assert.equal(typeof menuOrigin, 'function', '没有 menuOrigin')
  const box = { left: 100, top: 200, width: 280, height: 150 }
  assert.equal(menuOrigin(box, { x: 160, y: 190 }), '60px 0px', '指针在菜单上方（按钮上）⇒ 顶边')
  assert.equal(menuOrigin(box, { x: 500, y: 260 }), '280px 60px', '夹到右边')
  assert.equal(menuOrigin(box, { x: 40, y: 400 }), '0px 150px')
  assert.equal(menuOrigin(box, { x: NaN, y: 1 }), '0px 0px')
  assert.equal(menuOrigin(null, { x: 1, y: 1 }), '0px 0px')
})

test('[P2-7] MENU_FX.grow：完整档 opacity + scale(.92)→none，origin 对准指针（fast / ease）；减少动效只淡入；off 不调 animate；流式中照常', () => {
  const { MENU_FX, MOTION, setMotionPref } = load()
  assert.equal(typeof MENU_FX?.grow, 'function', '没有 MENU_FX')
  const menu = rectEl({ left: 100, top: 200, width: 280, height: 150 }, { closest: (sel) => (/stream/.test(sel) ? streamRoot : null) })
  MENU_FX.grow(menu, { x: 130, y: 190 })
  assert.equal(menu.calls.length, 1, '流式中照常')
  assert.deepEqual(menu.calls[0].frames, [
    { opacity: 0, transform: 'scale(.92)', transformOrigin: '30px 0px' },
    { opacity: 1, transform: 'none', transformOrigin: '30px 0px' },
  ])
  assert.equal(menu.calls[0].timing.duration, MOTION.fast)
  setMotionPref('lite')
  const lite = rectEl({ left: 0, top: 0, width: 10, height: 10 })
  MENU_FX.grow(lite, { x: 1, y: 1 })
  assert.deepEqual([...props(lite.calls[0].frames)], ['opacity'])
  setMotionPref('off')
  const off = rectEl({ left: 0, top: 0, width: 10, height: 10 })
  assert.equal(MENU_FX.grow(off, { x: 1, y: 1 }), null)
  assert.equal(off.calls.length, 0)
})

test('[P2-7] GrowMenu：at 变了（新打开一次）才长出来；同一份菜单重渲染不重播；换一份时上一段被取消', () => {
  const els = {}
  const at1 = { kind: 'block' }
  const p = (at) => ({ at, pointer: { x: 0, y: 0 }, 'data-prefill-block-menu': '', children: ['行'] })
  const m = mount('GrowMenu', p(at1), { els })
  assert.equal(typeof m.made.GrowMenu, 'function', '没有 GrowMenu')
  const el = els['data-prefill-block-menu']
  assert.equal(m.tree.type, 'div')
  assert.equal(el.calls.length, 1)
  m.render(p(at1))
  assert.equal(el.calls.length, 1, '同一份不重播')
  m.render(p({ kind: 'tower' }))
  assert.equal(el.calls.length, 2)
  assert.equal(el.calls[0].cancelled, 1)
})

test('[P2-7] 接线：右键 / ⋯ 打开菜单时记下指针（px / py）；积木菜单走 GrowMenu（at = 这份菜单状态，pointer = 指针）', () => {
  assert.equal((dockSrc.match(/px: Math\.round\(event\.clientX\),?\s*py: Math\.round\(event\.clientY\)/g) ?? []).length, 2, '积木菜单 / 塔菜单')
  assert.match(dockSrc, /h\(\n\s+GrowMenu,\n\s+\{\n\s+key: 'menu',\n\s+at: menu,\n\s+pointer: \{ x: menu\.px, y: menu\.py \},\n\s+'data-prefill-block-menu': ''/)
})

// ── P2-8 实际发送预览展开与删除线 ─────────────────────────────────

test('[P2-8] REVEAL_FX：入场 opacity + translateY(-4px)（base）、退场更快且落定才卸载；follow 位移类（减少动效 / 关直接到位）；删除线装饰类 + 整段变淡', async () => {
  const { REVEAL_FX, MOTION, setMotionPref } = load()
  assert.equal(typeof REVEAL_FX?.enter, 'function', '没有 REVEAL_FX')
  const el = fakeEl()
  REVEAL_FX.enter(el)
  assert.deepEqual(el.calls[0].frames[0], { opacity: 0, transform: 'translateY(-4px)' })
  assert.equal(el.calls[0].timing.duration, MOTION.base)
  let gone = 0
  REVEAL_FX.exit(el, () => (gone += 1))
  assert.equal(el.calls[1].timing.duration, MOTION.fast)
  assert.equal(el.calls[1].timing.fill, 'forwards')
  el.calls[1].finish()
  await tick()
  assert.equal(gone, 1)
  const list = fakeEl()
  REVEAL_FX.follow(list, -120.4)
  assert.deepEqual(list.calls[0].frames, [{ transform: 'translateY(-120px)' }, { transform: 'none' }])
  assert.equal(REVEAL_FX.follow(list, 0.5), null, '不到 1px 不动')
  const seg = fakeEl()
  const line = fakeEl(streamRoot)
  REVEAL_FX.strike(seg, line, MOTION.base)
  assert.deepEqual(seg.calls[0].frames, [{ opacity: 1 }, { opacity: 0.35 }])
  assert.equal(seg.calls[0].timing.delay, MOTION.base)
  assert.equal(seg.calls[0].timing.fill, 'backwards', '等待入场时保持不淡')
  assert.deepEqual(line.calls[0].frames.map((f) => f.transform), ['scaleX(0)', 'scaleX(1)', 'scaleX(1)'])
  assert.equal(line.calls.length, 1, '流式中照常（用户点出来的）')
  setMotionPref('lite')
  const l2 = fakeEl()
  const s2 = fakeEl()
  const line2 = fakeEl()
  assert.equal(REVEAL_FX.follow(l2, -100), null, '减少动效：列表直接到位')
  REVEAL_FX.strike(s2, line2)
  assert.equal(line2.calls.length, 0, '减少动效：没有划线')
  assert.equal(s2.calls.length, 1, '减少动效：仍然淡到 0.35')
  const e2 = fakeEl()
  REVEAL_FX.enter(e2)
  assert.deepEqual([...props(e2.calls[0].frames)], ['opacity'])
  setMotionPref('off')
  const e3 = fakeEl()
  let offGone = 0
  assert.equal(REVEAL_FX.enter(e3), null)
  REVEAL_FX.exit(e3, () => (offGone += 1))
  assert.equal(offGone, 1)
  assert.equal(e3.calls.length, 0)
})

test('[P2-8] Reveal：打开 ⇒ 挂上、入场、follow 从上面滑下来（-(高 + gap)）；关闭 ⇒ 淡出，落定才卸载、follow 从下面滑上来；退场中又打开 ⇒ 取消退场重播入场', async () => {
  const els = {}
  const list = fakeEl()
  const p = (open) => ({ open, follow: () => list, gap: 10, 'data-prefill-everyturn-preview': '', children: ['预览'] })
  const m = mount('Reveal', p(false), { els })
  assert.equal(typeof m.made.Reveal, 'function', '没有 Reveal')
  assert.equal(m.tree, null)
  els['data-prefill-everyturn-preview'] = { ...fakeEl(), getBoundingClientRect: () => ({ height: 110 }) }
  const el = els['data-prefill-everyturn-preview']
  m.render(p(true))
  assert.equal(m.tree?.props['data-prefill-everyturn-preview'], '')
  assert.equal(el.calls.length, 1, '入场')
  assert.deepEqual(list.calls[0].frames[0], { transform: 'translateY(-120px)' })
  m.render(p(false))
  assert.notEqual(m.tree, null, '退场中还在')
  assert.equal(el.calls.length, 2)
  m.render(p(true))
  assert.equal(el.calls[1].cancelled, 1, '又打开：取消退场')
  assert.equal(el.calls.length, 3, '重播入场')
  m.render(p(false))
  el.calls[3].finish()
  await tick()
  m.rerender()
  assert.equal(m.tree, null, '落定后卸载')
  assert.deepEqual(list.calls.at(-1).frames[0], { transform: 'translateY(120px)' }, '收拢：从下面滑上来')
})

test('[P2-8] StrikeSeg：挂上时就是 gone ⇒ 等 delay 划线 + 变淡；gone 变真再划（不等）；本来就 gone 的重渲染不重播；静止样子 opacity .35 + line-through', () => {
  const els = {}
  const p = (gone) => ({ gone, delay: 180, 'data-prefill-preview-seg': 'a', style: { margin: 1 }, children: ['文字'] })
  const m = mount('StrikeSeg', p(true), { els })
  assert.equal(typeof m.made.StrikeSeg, 'function', '没有 StrikeSeg')
  assert.equal(m.tree.props.style.opacity, 0.35)
  assert.equal(m.tree.props.style.textDecoration, 'line-through')
  const seg = els['data-prefill-preview-seg']
  const line = els['data-prefill-strike']
  assert.equal(seg.calls.length, 1)
  assert.equal(seg.calls[0].timing.delay, 180)
  assert.equal(line.calls.length, 1)
  m.render(p(true))
  assert.equal(seg.calls.length, 1, '重渲染不重播')
  m.render(p(false))
  assert.equal(m.tree.props.style.opacity, undefined)
  m.render(p(true))
  assert.equal(seg.calls.length, 2)
  assert.equal(seg.calls[1].timing.delay, 0, '中途变 gone 不等')
})

test('[P2-8] 接线：实际发送预览走 Reveal（follow = 工作台列表、gap 10）；每段走 StrikeSeg（delay base），不再自己写 line-through', () => {
  assert.match(dockSrc, /Reveal,\n\s+\{ key: 'preview', open: benchPreview, follow: \(\) => benchListRef\.current, gap: 10,/)
  assert.match(dockSrc, /StrikeSeg,\n\s+\{\n\s+key: seg\.key,\n\s+gone: seg\.gone,\n\s+delay: MOTION\.base,/)
  assert.doesNotMatch(dockSrc, /seg\.gone \? \{ opacity: 0\.35, textDecoration: 'line-through' \}/)
  assert.doesNotMatch(dockSrc, /benchPreview\n\s+\? h\(/, '不再是条件挂载（收起时要播退场）')
})

// ── P2-9 钉住标记与芯片信息重复 ───────────────────────────────────

test('[P2-9] chipCompact：只有摘要里 marker = true（卡片开着且缩成标记）才紧凑；CHIP_SWAP 只动 opacity（减少动效也播，off 不播）', () => {
  const { chipCompact, CHIP_SWAP, play, setMotionPref } = load()
  assert.equal(typeof chipCompact, 'function', '没有 chipCompact')
  assert.equal(chipCompact({ name: 'x', dots: [], marker: true }), true)
  assert.equal(chipCompact({ name: 'x', dots: [], marker: false }), false)
  assert.equal(chipCompact({ name: 'x', dots: [] }), false, '旧摘要（没有 marker）照旧')
  assert.equal(chipCompact(undefined), false)
  assert.deepEqual([...props(CHIP_SWAP)], ['opacity'])
  setMotionPref('lite')
  const el = fakeEl()
  play(el, CHIP_SWAP, { duration: 120 })
  assert.equal(el.calls.length, 1)
  setMotionPref('off')
  assert.equal(play(fakeEl(), CHIP_SWAP, { duration: 120 }), null)
})

test('[P2-9] 接线：卡片摘要带 marker（cardOpen && shrunk）；芯片紧凑时只写「预填装 · 📌 已钉住」，不画预设名和小点；切换时芯片淡入；中英文案', () => {
  assert.match(dockSrc, /dots: summaryDots,\n[^\n]*\n\s+marker: cardOpen && shrunk,/)
  assert.match(chipSrc, /const compact = chipCompact\(chipSummary\.get\(sessionId\)\)/)
  assert.ok(chipSrc.indexOf('const compact = chipCompact(') < chipSrc.indexOf("if (sessionId === '') return null"), 'hook 在提前返回之前')
  assert.match(chipSrc, /play\(chipRef\.current, CHIP_SWAP, \{ duration: MOTION\.fast, easing: MOTION\.ease, cue: 'press' \}\)/)
  const compactBranch = chipSrc.slice(chipSrc.indexOf('summary !== undefined && compact'), chipSrc.indexOf(': summary === undefined'))
  assert.match(compactBranch, /'data-prefill-chip-pinned': ''/)
  assert.match(compactBranch, /t\('chipPinned'\)/)
  assert.doesNotMatch(compactBranch, /data-prefill-chip-dot|summary\.name/, '紧凑时不画小点和预设名')
  assert.match(src, /chipPinned: '已钉住'/)
  assert.match(src, /chipPinned: 'pinned'/)
})

// ── P2-10 沙盒徽章颜色过渡、「拦 N」pop ───────────────────────────

test('[P2-10] SBX_FX：旧颜色层 opacity 1→0（slow，减少动效也播）；「拦 N」pop scale 1.35→1（spring），减少动效只淡入；流式中 pop 攒到回合结束；off 都不播', () => {
  const { SBX_FX, MOTION, setMotionPref, pendingCues } = load()
  assert.equal(typeof SBX_FX?.tone, 'function', '没有 SBX_FX')
  const layer = fakeEl()
  SBX_FX.tone(layer)
  assert.deepEqual(layer.calls[0].frames, [{ opacity: 1 }, { opacity: 0 }])
  assert.equal(layer.calls[0].timing.duration, MOTION.slow)
  const count = fakeEl()
  SBX_FX.count(count)
  assert.deepEqual(count.calls[0].frames.map((f) => f.transform), ['scale(1.35)', 'none'])
  assert.equal(count.calls[0].timing.easing, MOTION.spring)
  const streaming = fakeEl(streamRoot)
  assert.equal(SBX_FX.count(streaming), null, '流式中排队')
  assert.equal(streaming.calls.length, 0)
  assert.equal(pendingCues(), 1)
  setMotionPref('lite')
  const lite = fakeEl()
  SBX_FX.count(lite)
  assert.deepEqual([...props(lite.calls[0].frames)], ['opacity'])
  const liteTone = fakeEl()
  SBX_FX.tone(liteTone)
  assert.equal(liteTone.calls.length, 1)
  setMotionPref('off')
  const off = fakeEl()
  assert.equal(SBX_FX.tone(off), null)
  assert.equal(SBX_FX.count(off), null)
  assert.equal(off.calls.length, 0)
})

test('[P2-10] SandboxBadge：挂上不播；tone 变了 ⇒ 盖一层旧颜色淡掉、落定后撤掉；拦截数变多（含 0→1）才 pop，变少不播', async () => {
  const els = {}
  const PURPLE = 'var(--pf-system)'
  const RED = 'var(--red)'
  const p = (tone, blocked) => ({ tone, blocked, label: '沙盒 · 受控', countText: blocked > 0 ? `拦 ${blocked}` : '', 'data-prefill-badge': 'sandbox', style: { padding: 1 } })
  const m = mount('SandboxBadge', p(PURPLE, 2), { els })
  assert.equal(typeof m.made.SandboxBadge, 'function', '没有 SandboxBadge')
  assert.equal(m.tree.type, 'button')
  assert.equal(m.tree.props.style.isolation, 'isolate')
  assert.equal(m.tree.props.style.color, PURPLE)
  assert.equal(els['data-prefill-sbx-blocked'].calls.length, 0, '挂上不 pop')
  m.render(p(RED, 2))
  assert.equal(m.tree.props.style.color, RED, '新颜色直接画好')
  const was = find(m.tree, (q) => q['data-prefill-sbx-tone-was'] === '')
  assert.equal(was.length, 1, '盖一层旧颜色')
  assert.match(was[0].props.style.background, /tint/)
  assert.equal(was[0].props.style.zIndex, -1)
  const layer = els['data-prefill-sbx-tone-was']
  assert.equal(layer.calls.length, 1)
  layer.calls[0].finish()
  await tick()
  m.rerender()
  assert.equal(find(m.tree, (q) => q['data-prefill-sbx-tone-was'] === '').length, 0, '淡完撤掉')
  m.render(p(RED, 3))
  const count = els['data-prefill-sbx-blocked']
  assert.equal(count.calls.length, 1, '变多 pop')
  m.render(p(RED, 1))
  assert.equal(count.calls.length, 1, '变少不播')
  m.render(p(RED, 0))
  assert.equal(find(m.tree, (q) => q['data-prefill-sbx-blocked'] !== undefined).length, 0)
  m.render(p(RED, 1))
  assert.equal(count.calls.length, 2, '0 → 1 出现时 pop')
})

test('[P2-10] 接线：头部沙盒徽章走 SandboxBadge（tone 按档位：严格红、其余紫；blocked = 拦截数）', () => {
  assert.match(dockSrc, /h\(SandboxBadge, \{\n\s+key: 'sandbox',\n\s+'data-prefill-badge': 'sandbox',/)
  assert.match(dockSrc, /tone: sbxSummary\.level === 'strict' \? 'var\(--dsw-alias-state-error-primary, #e5484d\)' : 'var\(--pf-system\)',\n\s+blocked: sbxSummary\.blocked,/)
  assert.match(dockSrc, /countText: sbxSummary\.blocked > 0 \? t\('sbxBlockedN'\)/)
})

// ── P2-11 角色卡导入后新卡入场 ───────────────────────────────────

test('[P2-11] cardArrival：导入前没有这张 ⇒ fresh；已有（同 id 重新导入）⇒ 不 fresh；没有 id ⇒ null', () => {
  const { cardArrival } = load()
  assert.equal(typeof cardArrival, 'function', '没有 cardArrival')
  assert.deepEqual(cardArrival(['a', 'b'], 'c'), { id: 'c', fresh: true })
  assert.deepEqual(cardArrival(['a', 'b'], 'a'), { id: 'a', fresh: false })
  assert.deepEqual(cardArrival(undefined, 'a'), { id: 'a', fresh: true })
  assert.equal(cardArrival(['a'], ''), null)
})

test('[P2-11] ARRIVE_FX.card：找到那张卡 ⇒ 只滚内容区到看得见并入场（完整档带位移，减少动效只淡入，off 不动画但照样滚到位）；不是新卡 / 找不到 ⇒ null', () => {
  const { ARRIVE_FX, setMotionPref } = load()
  assert.equal(typeof ARRIVE_FX?.card, 'function', '没有 ARRIVE_FX')
  const make = () => {
    const pill = { ...rectEl({ left: 0, top: 900, width: 80, height: 28 }), getAttribute: () => 'new-card' }
    const other = { ...fakeEl(), getAttribute: () => 'old' }
    const main = { ...rectEl({ left: 0, top: 100, width: 600, height: 400 }), scrollTop: 0, scrollTo() {} }
    const root = { querySelectorAll: () => [other, pill], querySelector: (sel) => (sel === '[data-prefill-main]' ? main : null) }
    return { pill, other, main, root }
  }
  const a = make()
  ARRIVE_FX.card(a.root, { id: 'new-card', fresh: true })
  assert.equal(a.pill.calls.length, 1)
  assert.ok(props(a.pill.calls[0].frames).has('transform'))
  assert.equal(a.other.calls.length, 0)
  const b = make()
  assert.equal(ARRIVE_FX.card(b.root, { id: 'new-card', fresh: false }), null, '已有的卡：不入场（只高亮）')
  assert.equal(ARRIVE_FX.card(b.root, { id: 'missing', fresh: true }), null)
  setMotionPref('lite')
  const c = make()
  ARRIVE_FX.card(c.root, { id: 'new-card', fresh: true })
  assert.deepEqual([...props(c.pill.calls[0].frames)], ['opacity'])
  setMotionPref('off')
  const d = make()
  assert.equal(ARRIVE_FX.card(d.root, { id: 'new-card', fresh: true }), null)
  assert.equal(d.pill.calls.length, 0)
  assert.ok(d.main.scrollTop > 0, 'off：照样滚到位')
})

test('[P2-11] 接线：导入前记下已有的卡，导入成功后 setCardArrive(cardArrival(...))；layout effect 走 ARRIVE_FX.card，BLOCK_GLOW_MS 后清掉；那张卡挂 BlockGlow（radius 14）', () => {
  assert.match(dockSrc, /const beforeIds = cards\.map\(\(card\) => card\.id\)/)
  assert.match(dockSrc, /pickCard\(added\)\n\s+setCardArrive\(cardArrival\(beforeIds, added\.id\)\)/)
  assert.match(dockSrc, /const animation = ARRIVE_FX\.card\(cardRef\.current, cardArrive\)/)
  assert.match(dockSrc, /setTimeout\(\(\) => setCardArrive\(\(current\) => \(current === cardArrive \? null : current\)\), BLOCK_GLOW_MS\)/)
  assert.match(dockSrc, /cardArrive !== null && cardArrive\.id === card\.id \? h\(BlockGlow, \{ key: 'glow', radius: 14 \}\) : null/)
  assert.ok(dockSrc.indexOf('ARRIVE_FX.card(') < dockSrc.indexOf("if (sessionId === '' || !enabled || items === null) return null"), 'hook 在提前返回之前')
  assert.match(src, /function BlockGlow\(props\) \{\n\s+const radius = props\?\.radius \?\? 10/)
})
