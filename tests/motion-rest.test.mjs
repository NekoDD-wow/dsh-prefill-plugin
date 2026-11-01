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
const COMPONENTS = []
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
]
function load(win = fakeWindow(), doc = undefined) {
  const body = `${motionSrc}\n${feedbackSrc}\n${restSrc}\nreturn { ${NAMES.map((n) => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ')} }`
  // eslint-disable-next-line no-new-func
  return new Function('window', 'CustomEvent', 'document', body)(win, FakeEvent, doc)
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
