// 动效第 6 步「弹窗与确认」（docs/规划-动效.md §4.4）：P1-6 二次确认按钮（警告色 + 锁宽 + 倒计时线），
// P1-7 溯源 / 事后改写弹窗（遮罩和面板入场 / 退场、Esc 只关最上层、焦点进出、禁用原因、提交忙碌态和结果入场）。
// 照 tests/motion-refresh.test.mjs / motion-drag.test.mjs 的做法：把 client.js 的 <motion> + <feedback> + <dialog> 段切出来配假 window 直接跑；
// 组件（ConfirmButton / Modal / DialogResult）用一个只认 useState / useRef / useLayoutEffect / useEffect 的迷你 React 跑。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
// 找不到就给空串：改前（没有 <dialog> 段）每一项各自失败，而不是整个文件加载失败。
const cut = (from, to) => {
  const a = src.indexOf(from)
  const b = src.indexOf(to, a)
  return a >= 0 && b > a ? src.slice(a, b) : ''
}
const motionSrc = cut('// <motion>', '// </motion>')
const feedbackSrc = cut('// <feedback>', '// </feedback>')
const dialogSrc = cut('// <dialog>', '// </dialog>')
const confirmSrc = cut('    function ConfirmButton(props) {', '\n    }\n')
const modalSrc = cut('    function Modal(props) {', '\n    }\n')
const resultSrc = cut('    function DialogResult(props) {', '\n    }\n')
const dockSrc = cut('    function PrefillDock(props) {', '    function UsagePanel(props) {')
const sandboxSrc = cut('    function SandboxSection(props) {', '    function InjectionSection(props) {')
const injectSrc = cut('    function InjectionSection(props) {', '    function SessionModeBadge(props) {')

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
  'MOTION', 'setMotionPref', 'play', 'CONFIRM_MS', 'CONFIRM_COUNTDOWN', 'CONFIRM_SWAP', 'CONFIRM_FX', 'confirmMinWidth',
  'DIALOG_FX', 'SCRIM_ENTER', 'SCRIM_EXIT', 'DIALOG_ENTER', 'DIALOG_EXIT', 'createLayerStack', 'dialogLayers', 'focusablesIn', 'trapTab', 'restoreFocus',
  'surfaceBlocker', 'revealBlock',
]
function load(win = fakeWindow(), doc = undefined) {
  const body = `${motionSrc}\n${feedbackSrc}\n${dialogSrc}\nreturn { ${NAMES.map((n) => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ')} }`
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
  const body = `${motionSrc}\n${feedbackSrc}\n${dialogSrc}\n${fn(confirmSrc)}${fn(modalSrc)}${fn(resultSrc)}return { ${Component}: typeof ${Component} === 'undefined' ? undefined : ${Component}, setMotionPref, mod: { ${NAMES.map((n) => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ')} } }`
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

// ── P1-6 二次确认按钮 ─────────────────────────────────────────────

test('[P1-6] CONFIRM_FX：完整档倒计时线 scaleX 1→0、CONFIRM_MS、linear、fill forwards；文字淡入；减少动效只剩文字淡入；off 都不调 animate', () => {
  const { CONFIRM_FX, CONFIRM_MS, setMotionPref } = load()
  assert.equal(CONFIRM_MS, 4000)
  const line = fakeEl()
  const label = fakeEl()
  CONFIRM_FX.countdown(line)
  CONFIRM_FX.swap(label)
  assert.equal(line.calls.length, 1)
  assert.deepEqual(line.calls[0].frames.map((f) => f.transform), ['scaleX(1)', 'scaleX(0)'])
  assert.equal(line.calls[0].timing.duration, CONFIRM_MS)
  assert.equal(line.calls[0].timing.easing, 'linear')
  assert.equal(line.calls[0].timing.fill, 'forwards')
  assert.deepEqual([...props(label.calls[0].frames)], ['opacity'])
  setMotionPref('lite')
  const l2 = fakeEl()
  const b2 = fakeEl()
  assert.equal(CONFIRM_FX.countdown(l2), null)
  CONFIRM_FX.swap(b2)
  assert.equal(l2.calls.length, 0, '减少动效：倒计时线（装饰类）不走')
  assert.equal(b2.calls.length, 1)
  assert.deepEqual([...props(b2.calls[0].frames)], ['opacity'])
  setMotionPref('off')
  const l3 = fakeEl()
  const b3 = fakeEl()
  assert.equal(CONFIRM_FX.countdown(l3), null)
  assert.equal(CONFIRM_FX.swap(b3), null)
  assert.equal(l3.calls.length + b3.calls.length, 0)
})

test('[P1-6] 流式输出中：倒计时线是用户点出来的直接反馈 ⇒ 照常播，不进 busy 队列', () => {
  const { CONFIRM_FX } = load()
  const line = fakeEl(streamRoot)
  const label = fakeEl(streamRoot)
  assert.notEqual(CONFIRM_FX.countdown(line), null)
  assert.notEqual(CONFIRM_FX.swap(label), null)
  assert.equal(line.calls.length, 1)
  assert.equal(label.calls.length, 1)
})

test('[P1-6] ConfirmButton：待确认 = 警告色 + min-width 锁住原宽 + 倒计时线；复原时文字淡入、线撤掉', () => {
  const els = {}
  const m = mount('ConfirmButton', { armed: false, style: { color: 'grey', border: '1px solid x' }, children: ['删除'] }, { els })
  assert.equal(typeof m.made.ConfirmButton, 'function', '没有 ConfirmButton')
  let btn = m.tree
  assert.equal(btn.type, 'button')
  assert.equal(btn.props['data-prefill-armed'], undefined)
  assert.equal(find(btn, (p) => 'data-prefill-confirm-countdown' in p).length, 0)
  // 量到原宽 64（假元素 offsetWidth）后进入待确认
  btn = m.render({ armed: true, style: { color: 'grey', border: '1px solid x' }, children: ['确认？'] })
  assert.equal(btn.props['data-prefill-armed'], 'true')
  assert.equal(btn.props.style.minWidth, 64)
  assert.match(btn.props.style.color, /warn/)
  assert.match(btn.props.style.borderColor, /warn/)
  const line = find(btn, (p) => 'data-prefill-confirm-countdown' in p)
  assert.equal(line.length, 1)
  assert.equal(els['data-prefill-confirm-countdown'].calls.length, 1, '倒计时线开始走')
  assert.equal(els['data-prefill-confirm-label'].calls.length, 1, '文字淡入')
  // 复原（调用方 CONFIRM_MS 到时 setConfirming('')）：线撤掉、上一段动画取消、文字再淡入一次
  btn = m.render({ armed: false, style: { color: 'grey', border: '1px solid x' }, children: ['删除'] })
  assert.equal(btn.props['data-prefill-armed'], undefined)
  assert.equal(btn.props.style.minWidth, undefined)
  assert.equal(find(btn, (p) => 'data-prefill-confirm-countdown' in p).length, 0)
  assert.equal(els['data-prefill-confirm-countdown'].calls[0].cancelled, 1)
  assert.equal(els['data-prefill-confirm-label'].calls.length, 2)
  // 没边框的幽灵按钮不加边色
  const g = mount('ConfirmButton', { armed: false, style: { border: 'none' }, children: ['x'] })
  assert.equal(g.render({ armed: true, style: { border: 'none' }, children: ['y'] }).props.style.borderColor, undefined)
})

test('[P1-6] 接线：七处二次确认都换成 ConfirmButton；复原计时统一 CONFIRM_MS；不再只换文字颜色', () => {
  assert.match(dockSrc, /setTimeout\(\(\) => setConfirming\(\(current\) => \(current === key \? '' : current\)\), CONFIRM_MS\)/)
  const armed = [...dockSrc.matchAll(/ConfirmButton,\s*\{\s*armed: confirming === ([^,\n]+),/g)].map((m) => m[1])
  assert.deepEqual(armed.sort(), ["'clear'", "'restore-opening'", "'restore-opening'", '`card:${cardPick}`', '`del:${hoveredPack.name}`'].sort())
  assert.match(sandboxSrc, /h\(ConfirmButton, \{ armed: confirmClear, [\s\S]{0,120}'data-prefill-sbx-clear': ''/)
  assert.match(sandboxSrc, /setTimeout\(\(\) => setConfirmClear\(false\), CONFIRM_MS\)/)
  assert.match(injectSrc, /ConfirmButton,\s*\{ armed: confirmClear, style: S\.gateBtn/)
  assert.match(injectSrc, /setTimeout\(\(\) => setConfirmClear\(false\), CONFIRM_MS\)/)
  assert.ok(!/confirming === [^?]+\? 'var\(--dsw-alias-state-warn-primary\)'/.test(dockSrc), '还有只换颜色的确认按钮')
})
