// 左侧栏「预填装 · 注入控制」页（PrefillSection）单测用：把 client.js 里那一段切出来，
// 用假的 React / fetch / window 真跑一遍渲染与交互（与 tests/sandbox-harness.mjs 同一思路）。
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const sectionSrc = src.slice(src.indexOf('    function PrefillSection(props) {'), src.indexOf('    /** DSH 左侧栏那一行 + 主区设置页共用的 panel id'))
if (sectionSrc.length === 0) throw new Error('找不到 PrefillSection 段')
/** 切一个「4 空格缩进的函数」到它的收尾 }。 */
const fnSrc = (head) => {
  const at = src.indexOf(head)
  if (at < 0) throw new Error('找不到：' + head)
  return src.slice(at, src.indexOf('\n    }\n', at) + 7)
}
const feedbackSrc = src.slice(src.indexOf('    // <feedback>'), src.indexOf('    // </feedback>'))
const busyAttrsSrc = fnSrc('    function busyAttrs(')
const normalizeMotionSrc = fnSrc('    function normalizeMotion(')

const LEVERS = [
  { key: 'probeSection', tone: 'write' },
  { key: 'probeContext', tone: 'write' },
  { key: 'blockSections', tone: 'block' },
  { key: 'blockContexts', tone: 'block' },
  { key: 'blockTools', tone: 'block' },
  { key: 'blockMessages', tone: 'block' },
]

export function makeSettingsHarness(envelope, { routes = {}, titleOf } = {}) {
  const slots = []
  const effects = []
  const callbacks = []
  let cursor = 0
  let effectCursor = 0
  let callbackCursor = 0
  const fetches = []
  const dispatched = []
  const stateEvents = []
  const motionPrefs = []
  const listeners = []
  const panelOpens = []
  const sessionOpens = []
  const posts = []
  const postJson = async (path, body) => {
    posts.push({ path, body })
    const reply = routes[path]
    const value = typeof reply === 'function' ? reply(body) : reply
    return value === undefined ? {} : JSON.parse(JSON.stringify(value))
  }
  let current = JSON.parse(JSON.stringify(envelope ?? {}))
  let failNext = false

  const React = {
    useState(init) {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof init === 'function' ? init() : init
      return [slots[index], (value) => (slots[index] = typeof value === 'function' ? value(slots[index]) : value)]
    },
    useEffect(fn, deps) {
      const index = effectCursor++
      const prev = effects[index]
      // 依赖变了才重跑（和真 React 一致；否则 envelope 到了以后库不会加载）。
      const changed =
        prev === undefined ||
        deps === undefined ||
        prev.deps === undefined ||
        deps.length !== prev.deps.length ||
        deps.some((value, at) => value !== prev.deps[at])
      if (!changed) return
      effects[index] = { deps }
      fn()
    },
    useCallback(fn, deps) {
      const index = callbackCursor++
      const prev = callbacks[index]
      if (
        prev !== undefined &&
        deps !== undefined &&
        prev.deps !== undefined &&
        deps.length === prev.deps.length &&
        deps.every((value, at) => value === prev.deps[at])
      ) {
        return prev.fn
      }
      callbacks[index] = { deps, fn }
      return fn
    },
    useRef: (value) => ({ current: value }),
    useLayoutEffect() {},
  }
  const h = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) })
  const anything = new Proxy(() => ({}), { get: () => anything, apply: () => ({}) })
  const window = {
    addEventListener(type, fn) { listeners.push({ type, fn }) },
    removeEventListener() {},
    dispatchEvent(event) { dispatched.push(event?.detail ?? event) },
  }
  const fetch = async (path, init) => {
    const body = init?.body === undefined ? undefined : JSON.parse(init.body)
    fetches.push({ path, body })
    if (failNext) {
      failNext = false
      return { ok: false, status: 500, json: async () => ({ ok: false, reason: 'boom' }) }
    }
    if (path !== '/api/dsh-prefill/state') {
      const reply = routes[path]
      const value = typeof reply === 'function' ? reply(body) : reply
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(value ?? { ok: true })) }
    }
    if (body !== undefined) current = { ...current, state: { ...(current.state ?? {}), ...body } }
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(current)) }
  }

  const make = new Function(
    'React', 'h', 'S', 'LEVERS', 'notifyStateChanged', 'setMotionPref', 'tint', 'ERROR_TONE', 'CONFIRM_MS',
    'STATE_ROUTE', 'STATE_EVENT', 'ANCHOR_EVENT', 'openPrefillPanel', 'openSessionAndCard', 'PACKS_ROUTE', 'CARDS_ROUTE', 'window', 'fetch', 'postJson', 'REASONING_STATUS_ROUTE', 'REASONING_ENABLE_ROUTE', 'REASONING_DISABLE_ROUTE',
    feedbackSrc + '\n' +
      'const MOTION_LEVELS = ["full", "lite", "off"]\n' +
      normalizeMotionSrc + '\n' +
      'const useBusy = () => createBusy()\n' +
      'const Toggle = (props) => h("button", { "data-prefill-toggle": props.label, "data-on": props.on ? "true" : "false", onClick: props.onToggle }, props.label)\n' +
      'const ErrorPill = (props) => (props.error ? h("span", { "data-prefill-error-pill": props.error.key }, props.error.op) : (props.fallback ?? null))\n' +
      'const ConfirmButton = ({ armed, children, ...rest }) => h("button", { ...rest, "data-prefill-confirm": armed ? "true" : "false" }, ...[children].flat())\n' +
      busyAttrsSrc + '\n' +
      sectionSrc + '\n' +
      'return { PrefillSection }',
  )

  const mod = make(
    React, h, anything, LEVERS,
    () => stateEvents.push(Date.now()),
    (value) => motionPrefs.push(value),
    (color) => color,
    'red',
    4000,
    '/api/dsh-prefill/state',
    'dsh-prefill:state-changed',
    'dsh-prefill:anchor',
    (anchor) => panelOpens.push(anchor ?? ''),
    (sessionId) => sessionOpens.push(sessionId),
    '/api/dsh-prefill/packs',
    '/api/dsh-prefill/cards',
    window,
    fetch,
    postJson,
    '/api/dsh-prefill/reasoning/status',
    '/api/dsh-prefill/reasoning/enable',
    '/api/dsh-prefill/reasoning/disable',
  )

  const t = (key) => key
  const expand = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return node
    if (typeof node.type === 'function') return expand(node.type({ ...node.props, children: node.children }))
    return { ...node, children: (node.children ?? []).map(expand) }
  }
  const render = () => {
    cursor = 0
    effectCursor = 0
    callbackCursor = 0
    return expand(mod.PrefillSection({ t, titleOf }))
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
  const setFailNext = () => { failNext = true }
  const emitStateEvent = () => {
    for (const entry of listeners) if (entry.type === 'dsh-prefill:state-changed') entry.fn()
  }
  const failDetails = () => dispatched.filter((detail) => detail?.type === 'fail')
  const okDetails = () => dispatched.filter((detail) => detail?.type === 'ok')
  return { render, find, fetches, posts, dispatched, failDetails, okDetails, stateEvents, motionPrefs, panelOpens, sessionOpens, slots, settle, setFailNext, emitStateEvent, mod }
}
