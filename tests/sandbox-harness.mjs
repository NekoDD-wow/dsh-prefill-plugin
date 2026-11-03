// 会话沙盒面板单测用：把 client.js 里的 SandboxSection 切出来，用假的 React（hooks 按调用顺序存槽位）跑一遍。
import { readFileSync } from 'node:fs'
import { sandboxView } from '../sandbox-view.js'
import { migrateSandbox } from '../sandbox.js'

const clone = (value) => JSON.parse(JSON.stringify(value))
const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const panelSrc = src.slice(src.indexOf('    // ── 会话沙盒（issue #15 第 3 步）'), src.indexOf('    function InjectionSection(props) {'))
// 动效第 3 步：面板用到 <feedback> 段的 createBusy（忙碌态）和错误上报；切出来一起跑（play 用不到，给个空的）。
const feedbackSrc = src.slice(src.indexOf('    // <feedback>'), src.indexOf('    // </feedback>'))
// 动效第 6 步：事后改写的禁用原因（surfaceBlocker）和忙碌按钮属性（busyAttrs）是纯函数，切真的来跑。
const fnSrc = (head) => {
  const at = src.indexOf(head)
  return at < 0 ? '' : src.slice(at, src.indexOf('\n    }\n', at) + 7)
}
const blockerSrc = fnSrc('    function surfaceBlocker(')
const busyAttrsSrc = fnSrc('    function busyAttrs(')


export function makeHarness(envelope, { sid: SID, sources, routes = {} }) {
  const slots = []
  let cursor = 0
  const posts = []
  const React = {
    useState(init) {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof init === 'function' ? init() : init
      return [slots[index], (value) => (slots[index] = typeof value === 'function' ? value(slots[index]) : value)]
    },
    useEffect() {},
    useCallback: (fn) => fn,
    useRef: (value) => ({ current: value }),
  }
  const h = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) })
  const anything = new Proxy(() => ({}), { get: () => anything, apply: () => ({}) })
  let current = clone(envelope)
  const postJson = async (path, body) => {
    if (path !== '/api/dsh-prefill/state') {
      posts.push({ path, ...clone(body) })
      const reply = routes[body?.op]
      return clone(typeof reply === 'function' ? reply(body) : reply ?? { ok: false })
    }
    if (body !== undefined) {
      posts.push(clone(body))
      const state = { ...current.state, ...clone(body) }
      current = { ...current, state, sandboxView: { [SID]: sandboxView(migrateSandbox(state), SID, sources()) } }
    }
    return clone(current)
  }
  const errors = []
  const window = { dispatchEvent(event) { if (event?.detail?.type) errors.push(event.detail) }, addEventListener() {}, removeEventListener() {} }
  // eslint-disable-next-line no-new-func
  const make = new Function(
    'React',
    'h',
    'V',
    'S',
    'tint',
    'postJson',
    'postJsonWithTimeout',
    'STATE_ROUTE',
    'STATE_EVENT',
    'InjectionSection',
    'window',
    'CustomEvent',
    'play',
    'motionLevel',
    'MOTION',
    `${feedbackSrc}\nconst busyCtl = createBusy()\nconst useBusy = () => busyCtl\nconst Spinner = () => null\nconst BUSY_LOOK = {}\n// 动效第 6 步：二次确认按钮的替身（动效件不在这一段里；只关心属性和点击）。\nconst ConfirmButton = ({ armed, children, ...rest }) => h('button', { ...rest, 'data-prefill-armed': armed ? 'true' : undefined }, ...[children].flat())\nconst CONFIRM_MS = 4000\n// 弹窗的替身：open 才渲染面板（带上调用方给的 data-* 属性），入退场 / 焦点 / Esc 不在这里测（tests/motion-dialog.test.mjs）。\nconst Modal = ({ open, label, panelProps, children }) => (open ? h('div', { 'data-prefill-dialog-layer': 'open' }, h('div', { ...panelProps, role: 'dialog', 'aria-label': label }, ...[children].flat())) : null)\n${blockerSrc}\n${busyAttrsSrc}\n// 结果条的替身：入场 / 滚进视野不在这里测（tests/motion-dialog.test.mjs）。\nconst DialogResult = ({ reveal, children, ...rest }) => h('div', rest, ...[children].flat())\n${panelSrc}\nreturn { SandboxSection, sandboxSummary, SBX_TEXT, busyCtl, createBusy }`,
  )
  class FakeCustomEvent {
    constructor(type, init) {
      this.type = type
      this.detail = init?.detail
    }
  }
  // postJsonWithTimeout = 轮询用的 postJson（假件里两者等价，这里只喂同一个假 IO）。
  const mod = make(React, h, anything, anything, () => '', postJson, postJson, '/api/dsh-prefill/state', 'evt', () => null, window, FakeCustomEvent, () => null, () => 'full', { fast: 120, base: 180, ease: '' })
  const t = (key) => mod.SBX_TEXT.zh[key] ?? key
  const render = () => {
    cursor = 0
    slots[0] = clone(current)
    const expand = (node) => {
      if (node === null || node === undefined || typeof node !== 'object') return node
      if (typeof node.type === 'function') return expand(node.type({ ...node.props, children: node.children }))
      return { ...node, children: node.children.map(expand) }
    }
    return expand(mod.SandboxSection({ t, sessionId: SID }))
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
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
  return { render, find, posts, settle, mod, t, errors }
}

