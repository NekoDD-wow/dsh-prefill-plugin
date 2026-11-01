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

// ── P1-7 弹窗：遮罩和面板入场 / 退场 ─────────────────────────────────

test('[P1-7] DIALOG_FX：完整档遮罩淡入 + 面板 translateY/scale 入场；减少动效两层都只剩 opacity；off 不调 animate', () => {
  const { DIALOG_FX, MOTION, setMotionPref } = load()
  const scrim = fakeEl()
  const panel = fakeEl()
  DIALOG_FX.enter(scrim, panel)
  assert.deepEqual([...props(scrim.calls[0].frames)], ['opacity'])
  assert.match(panel.calls[0].frames[0].transform, /translateY\(8px\) scale\(\.98\)/)
  assert.equal(panel.calls[0].timing.duration, MOTION.base)
  setMotionPref('lite')
  const s2 = fakeEl()
  const p2 = fakeEl()
  DIALOG_FX.enter(s2, p2)
  DIALOG_FX.exit(s2, p2, () => {})
  for (const call of [...s2.calls, ...p2.calls]) assert.deepEqual([...props(call.frames)], ['opacity'])
  assert.equal(p2.calls.length, 2)
  setMotionPref('off')
  const s3 = fakeEl()
  const p3 = fakeEl()
  let gone = 0
  DIALOG_FX.enter(s3, p3)
  DIALOG_FX.exit(s3, p3, () => (gone += 1))
  assert.equal(s3.calls.length + p3.calls.length, 0)
  assert.equal(gone, 1, 'off：当场卸载')
})

test('[P1-7] DIALOG_FX.exit：两层都落定才卸载、出场比入场快；被 cancel 也卸载；abort 取消两段动画且不卸载', async () => {
  const { DIALOG_FX, MOTION } = load()
  const scrim = fakeEl()
  const panel = fakeEl()
  let gone = 0
  DIALOG_FX.exit(scrim, panel, () => (gone += 1))
  assert.equal(panel.calls[0].timing.duration, MOTION.fast)
  assert.ok(MOTION.fast < MOTION.base)
  assert.equal(panel.calls[0].timing.fill, 'forwards')
  scrim.calls[0].finish()
  await tick()
  assert.equal(gone, 0, '只落定了一层')
  panel.calls[0].finish()
  await tick()
  assert.equal(gone, 1)
  const s2 = fakeEl()
  const p2 = fakeEl()
  let gone2 = 0
  DIALOG_FX.exit(s2, p2, () => (gone2 += 1))
  p2.calls[0].cancel()
  await tick()
  assert.equal(gone2, 1, '被打断（cancel）也要卸载，不留透明残影')
  const s3 = fakeEl()
  const p3 = fakeEl()
  let gone3 = 0
  const ctl = DIALOG_FX.exit(s3, p3, () => (gone3 += 1))
  ctl.abort()
  await tick()
  assert.equal(gone3, 0)
  assert.equal(s3.calls[0].cancelled, 1)
  assert.equal(p3.calls[0].cancelled, 1, 'fill forwards 一并撤掉')
})

const modalProps = (open, extra = {}) => ({ open, onClose: () => {}, label: '溯源', panelProps: { 'data-prefill-test-panel': '' }, children: open ? ['内容'] : null, ...extra })

test('[P1-7] Modal：打开播入场（遮罩 + 面板）；关闭先播退场，期间 pointer-events: none、aria-hidden、保留最后一份内容、重复关闭被忽略；落定后卸载', async () => {
  const els = {}
  let closes = 0
  const m = mount('Modal', modalProps(false), { els })
  assert.equal(typeof m.made.Modal, 'function', '没有 Modal')
  assert.equal(m.tree, null)
  let tree = m.render(modalProps(true, { onClose: () => (closes += 1) }))
  assert.equal(tree.props['data-prefill-dialog-layer'], 'open')
  const panel = find(tree, (p) => p.role === 'dialog')[0]
  assert.equal(panel.props['aria-modal'], 'true')
  assert.equal(panel.props['aria-label'], '溯源')
  assert.equal(els['data-prefill-dialog-scrim'].calls.length, 1, '遮罩淡入')
  assert.equal(els['data-prefill-test-panel'].calls.length, 1, '面板入场')
  // 点遮罩（外层）= onClose；点面板不冒泡
  tree.props.onClick()
  assert.equal(closes, 1)
  let stopped = 0
  panel.props.onClick({ stopPropagation: () => (stopped += 1) })
  assert.equal(stopped, 1)
  // 调用方清空状态 ⇒ open: false、没有内容
  tree = m.render(modalProps(false, { onClose: () => (closes += 1), label: undefined, panelProps: undefined }))
  assert.equal(tree.props['data-prefill-dialog-layer'], 'closing')
  assert.equal(tree.props.style.pointerEvents, 'none')
  assert.equal(tree.props['aria-hidden'], 'true')
  assert.match(JSON.stringify(tree), /内容/, '退场中还显示关闭前的内容')
  assert.equal(find(tree, (p) => 'data-prefill-test-panel' in p).length, 1, '面板属性也保留')
  tree.props.onClick()
  assert.equal(closes, 1, '退场中再点遮罩被忽略')
  const exitPanel = els['data-prefill-test-panel'].calls[1]
  assert.equal(els['data-prefill-test-panel'].calls[0].cancelled, 1, '入场被退场打断：先取消入场')
  els['data-prefill-dialog-scrim'].calls[1].finish()
  exitPanel.finish()
  await tick()
  assert.equal(m.rerender(), null, '退场落定后卸载')
})

test('[P1-7] Modal：退场中又打开 ⇒ 取消退场（不留透明）、重播入场、不卸载；off 档关闭当场卸载', async () => {
  const els = {}
  const m = mount('Modal', modalProps(true), { els })
  m.render(modalProps(false))
  const exit = els['data-prefill-test-panel'].calls.at(-1)
  const tree = m.render(modalProps(true))
  assert.equal(tree.props['data-prefill-dialog-layer'], 'open')
  assert.equal(exit.cancelled, 1)
  assert.equal(els['data-prefill-dialog-scrim'].calls.at(-2).cancelled, 1)
  assert.deepEqual(els['data-prefill-test-panel'].calls.at(-1).frames, m.mod.DIALOG_ENTER)
  await tick()
  assert.notEqual(m.rerender(), null, '被取消的退场不能把它卸掉')
  const offEls = {}
  const o = mount('Modal', modalProps(true), { els: offEls })
  o.made.setMotionPref('off')
  assert.equal(o.render(modalProps(false)), null)
})

test('[P1-7] 接线：溯源 / 事后改写弹窗走 Modal；关掉时同一位置留 open: false 的 Modal 播退场；不再自己画 fixed 遮罩', () => {
  assert.match(sandboxSrc, /h\(\s*Modal,\s*\{ open: true, onClose: \(\) => setTrace\(null\), label: title, panelProps: \{ 'data-prefill-sbx-trace-dialog'/)
  assert.match(sandboxSrc, /h\(\s*Modal,\s*\{ open: true, onClose: \(\) => setSurface\(null\), label: title, panelProps: \{ 'data-prefill-sbx-surface-dialog'/)
  assert.match(sandboxSrc, /trace !== null \? sbxTraceDialog\(\) : h\(Modal, \{ open: false \}\)/)
  assert.match(sandboxSrc, /surface !== null \? sbxSurfaceDialog\(\) : h\(Modal, \{ open: false \}\)/)
  assert.ok(!/position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba\(0,0,0,0\.28\)'/.test(sandboxSrc), '还有旧的遮罩')
})

// ── P1-7 Esc 与焦点 ─────────────────────────────────────────────

const keyEvent = (key, extra = {}) => {
  const ev = { key, prevented: 0, stopped: 0, preventDefault() { ev.prevented += 1 }, stopPropagation() { ev.stopped += 1 }, ...extra }
  return ev
}

test('[P1-7] createLayerStack：window 捕获阶段一个监听；Esc 只关最上层并 stopPropagation（卡片 document 上的 Esc 收不到）；空了就摘监听', () => {
  const win = fakeWindow()
  const { createLayerStack, dialogLayers } = load(win)
  assert.equal(typeof createLayerStack, 'function', '没有 createLayerStack')
  assert.equal(typeof dialogLayers?.push, 'function', '没有模块级 dialogLayers')
  const stack = createLayerStack(win)
  assert.equal((win.handlers.keydown ?? []).length, 0, '没层不挂监听')
  const closed = []
  const popA = stack.push(() => closed.push('a'))
  const popB = stack.push(() => closed.push('b'))
  assert.equal(win.handlers.keydown.length, 1, '只挂一个')
  assert.equal(win.handlers.keydown[0].capture, true, '捕获阶段')
  const fire = (ev) => win.handlers.keydown[0].fn(ev)
  const other = keyEvent('a')
  fire(other)
  assert.equal(other.stopped + other.prevented, 0, '别的键不碰')
  const esc = keyEvent('Escape')
  fire(esc)
  assert.deepEqual(closed, ['b'], '只关最上层')
  assert.equal(esc.stopped, 1)
  assert.equal(esc.prevented, 1)
  const ime = keyEvent('Escape', { isComposing: true })
  fire(ime)
  assert.deepEqual(closed, ['b'], '输入法组字中的 Esc 不关')
  popA() // 乱序出栈：按身份删
  fire(keyEvent('Escape'))
  assert.deepEqual(closed, ['b', 'b'])
  popB()
  popB()
  assert.equal(stack.size(), 0)
  assert.equal((win.handlers.keydown ?? []).length, 0, '空了就摘')
})

/** 假的面板根：querySelectorAll 返回 items；contains 认 items 和自己。 */
function fakeRoot(items) {
  const root = fakeEl()
  root.querySelectorAll = () => items
  root.contains = (el) => el === root || items.includes(el)
  return root
}
const item = (extra = {}) => fakeEl(null, { getAttribute: () => null, getClientRects: () => [1], ...extra })

test('[P1-7] focusablesIn / trapTab：去掉 disabled / tabindex=-1 / 不占版面的；Tab 在面板里循环，焦点在外面拉回来，空面板留在面板上', () => {
  const { focusablesIn, trapTab } = load()
  assert.equal(typeof focusablesIn, 'function', '没有 focusablesIn')
  assert.equal(typeof trapTab, 'function', '没有 trapTab')
  const a = item()
  const off = item({ disabled: true })
  const neg = item({ getAttribute: (n) => (n === 'tabindex' ? '-1' : null) })
  const gone = item({ getClientRects: () => [] })
  const b = item()
  const root = fakeRoot([a, off, neg, gone, b])
  assert.deepEqual(focusablesIn(root), [a, b])
  // 最后一个 Tab ⇒ 第一个
  let ev = keyEvent('Tab')
  assert.equal(trapTab(ev, root, b), true)
  assert.equal(ev.prevented, 1)
  assert.equal(a.focused, 1)
  // 中间的 Tab 照常（不拦）
  ev = keyEvent('Tab')
  assert.equal(trapTab(ev, root, a), false)
  assert.equal(ev.prevented, 0)
  // 第一个 / 面板本身 Shift+Tab ⇒ 最后一个
  assert.equal(trapTab(keyEvent('Tab', { shiftKey: true }), root, a), true)
  assert.equal(trapTab(keyEvent('Tab', { shiftKey: true }), root, root), true)
  assert.equal(b.focused, 2)
  // 焦点在面板外 ⇒ 拉回第一个
  assert.equal(trapTab(keyEvent('Tab'), root, fakeEl()), true)
  assert.equal(a.focused, 2)
  // 别的键不管；空面板 ⇒ 焦点留在面板
  assert.equal(trapTab(keyEvent('Enter'), root, a), false)
  const empty = fakeRoot([])
  assert.equal(trapTab(keyEvent('Tab'), empty, empty), true)
  assert.equal(empty.focused, 1)
})

test('[P1-7] restoreFocus：触发按钮还在 ⇒ 回它；不在了（isConnected false）⇒ 回锚点；都不行 ⇒ null', () => {
  const { restoreFocus } = load()
  assert.equal(typeof restoreFocus, 'function', '没有 restoreFocus')
  const btn = fakeEl()
  const anchor = fakeEl()
  assert.equal(restoreFocus(btn, anchor), btn)
  assert.equal(btn.focused, 1)
  btn.isConnected = false
  assert.equal(restoreFocus(btn, anchor), anchor)
  assert.equal(anchor.focused, 1)
  assert.equal(restoreFocus(null, null), null)
})

test('[P1-7] Modal 焦点与 Esc：打开 ⇒ 进层栈、焦点给面板（tabIndex -1）、Tab 被 trapTab 接管；Esc ⇒ onClose；关闭 ⇒ 出栈、焦点回触发按钮；按钮不在了 ⇒ 回锚点', () => {
  const win = fakeWindow()
  const doc = { activeElement: null, body: { isBody: true } }
  const trigger = fakeEl(null, { focus() { trigger.focused += 1; doc.activeElement = trigger } })
  doc.activeElement = trigger
  const els = {}
  const panel = fakeEl(null, { focus() { panel.focused += 1; doc.activeElement = panel } })
  els['data-prefill-test-panel'] = panel
  const anchorEl = fakeEl()
  let closes = 0
  const p = (open) => modalProps(open, { onClose: () => (closes += 1), anchor: { current: anchorEl } })
  const m = mount('Modal', p(false), { els, win, doc })
  let tree = m.render(p(true))
  const node = find(tree, (q) => q.role === 'dialog')[0]
  assert.equal(node.props.tabIndex, -1)
  assert.equal(panel.focused, 1, '焦点给面板')
  assert.equal(m.mod.dialogLayers.size(), 1, '进层栈')
  assert.equal(win.handlers.keydown.length, 1)
  win.handlers.keydown[0].fn(keyEvent('Escape'))
  assert.equal(closes, 1, 'Esc ⇒ onClose')
  // 关闭 ⇒ 出栈、焦点回触发按钮
  m.render(modalProps(false))
  assert.equal(m.mod.dialogLayers.size(), 0, '出栈')
  assert.equal((win.handlers.keydown ?? []).length, 0)
  assert.equal(trigger.focused, 1, '焦点回触发按钮')
  // 再开一次（触发按钮仍是焦点），这回按钮在关闭前被移走 ⇒ 回锚点
  tree = m.render(p(true))
  assert.equal(panel.focused, 2)
  trigger.isConnected = false
  m.render(modalProps(false))
  assert.equal(anchorEl.focused, 1, '按钮不在了回锚点（关闭时没带 anchor 也沿用打开时的）')
})

test('[P1-7] Modal：退场中按 Esc 不再归它管（开始关闭就出栈，Esc 落回卡片）', () => {
  const win = fakeWindow()
  const m = mount('Modal', modalProps(true), { win })
  assert.equal(m.mod.dialogLayers.size(), 1)
  m.render(modalProps(false))
  assert.equal(m.mod.dialogLayers.size(), 0)
  assert.equal(m.rerender().props['data-prefill-dialog-layer'], 'closing')
})

test('[P1-7] 接线：沙盒页给两个弹窗同一个锚点（Modal 旁、tabIndex -1）', () => {
  assert.match(sandboxSrc, /'data-prefill-sbx-trace-dialog'[^\n]*anchor: dialogAnchor/)
  assert.match(sandboxSrc, /'data-prefill-sbx-surface-dialog'[^\n]*anchor: dialogAnchor/)
  assert.match(sandboxSrc, /h\('span', \{ ref: dialogAnchor, tabIndex: -1, 'data-prefill-dialog-anchor'/)
})
