// 审计用整模块 harness：在 vm 沙箱里真跑 client.js 的 factory，拿 apply(ctx) 注册的真组件，
// 用一个极简的假 React（hooks + 递归渲染 + effect/cleanup）渲染。fetch / 定时器 / window 事件全部可控。
// 只给 audit-*.test.mjs 用；不改 client.js。
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const SRC = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const FRAGMENT = Symbol.for('react.fragment')

function makeReact() {
  let current = null // 正在渲染的实例
  const R = {
    Fragment: FRAGMENT,
    createElement(type, props, ...children) {
      const flat = children.flat(Infinity)
      return { $el: true, type, key: props?.key, props: { ...(props ?? {}), children: flat } }
    },
    useState(init) {
      const inst = current
      const index = inst.cursor++
      if (!(index in inst.slots)) inst.slots[index] = typeof init === 'function' ? init() : init
      const set = (value) => {
        const next = typeof value === 'function' ? value(inst.slots[index]) : value
        if (Object.is(next, inst.slots[index])) return
        inst.slots[index] = next
        inst.root.dirty = true
      }
      return [inst.slots[index], set]
    },
    useRef(init) {
      const inst = current
      const index = inst.cursor++
      if (!(index in inst.slots)) inst.slots[index] = { current: init }
      return inst.slots[index]
    },
    useCallback(fn, deps) {
      const inst = current
      const index = inst.cursor++
      const prev = inst.slots[index]
      if (prev && deps && prev.deps && deps.length === prev.deps.length && deps.every((d, i) => Object.is(d, prev.deps[i]))) return prev.fn
      inst.slots[index] = { fn, deps }
      return fn
    },
    useEffect(fn, deps) {
      R._effect(fn, deps, 'effects')
    },
    useLayoutEffect(fn, deps) {
      R._effect(fn, deps, 'layouts')
    },
    _effect(fn, deps, bucket) {
      const inst = current
      const index = inst.cursor++
      const prev = inst.slots[index]
      const changed = !prev || !deps || !prev.deps || deps.length !== prev.deps.length || deps.some((d, i) => !Object.is(d, prev.deps[i]))
      if (!prev) inst.slots[index] = { deps, cleanup: undefined }
      if (changed) {
        const slot = inst.slots[index]
        slot.deps = deps
        inst[bucket].push(() => {
          if (typeof slot.cleanup === 'function') slot.cleanup()
          const out = fn()
          slot.cleanup = typeof out === 'function' ? out : undefined
        })
      }
    },
  }
  R._setCurrent = (inst) => {
    current = inst
  }
  return R
}

/** 渲染器：按「路径 + type」复用实例，没再出现的实例卸载（跑 cleanup）。 */
function makeRenderer(React, root) {
  const instances = new Map()
  let seen = new Set()
  function renderNode(node, path, out) {
    if (node === null || node === undefined || node === false || node === true) return null
    if (Array.isArray(node)) return node.map((child, i) => renderNode(child, `${path}.${child?.key ?? i}`, out))
    if (typeof node !== 'object' || node.$el !== true) return node
    if (typeof node.type === 'function') {
      const id = `${path}:${node.type.name}`
      let inst = instances.get(id)
      if (!inst) {
        inst = { slots: [], cursor: 0, effects: [], layouts: [], root, type: node.type }
        instances.set(id, inst)
      }
      seen.add(id)
      inst.cursor = 0
      React._setCurrent(inst)
      const result = node.type(node.props)
      React._setCurrent(null)
      out.push(inst)
      return renderNode(result, id, out)
    }
    const children = (node.props.children ?? []).map((child, i) => renderNode(child, `${path}/${node.type === FRAGMENT ? 'f' : String(node.type)}.${child?.key ?? i}`, out))
    return { type: node.type, props: node.props, children }
  }
  return {
    render(element) {
      seen = new Set()
      const out = []
      const tree = renderNode(element, 'root', out)
      // 卸载没再出现的实例
      for (const [id, inst] of instances) {
        if (seen.has(id)) continue
        for (const slot of inst.slots) if (slot && typeof slot.cleanup === 'function') slot.cleanup()
        instances.delete(id)
      }
      for (const inst of out) for (const run of inst.layouts.splice(0)) run()
      for (const inst of out) for (const run of inst.effects.splice(0)) run()
      return tree
    },
    unmountAll() {
      for (const [, inst] of instances) for (const slot of inst.slots) if (slot && typeof slot.cleanup === 'function') slot.cleanup()
      instances.clear()
    },
  }
}

export function loadClient({ routes = {}, hidden = false } = {}) {
  const React = makeReact()
  const root = { dirty: false }
  const listeners = new Map()
  const timers = new Map()
  let timerSeq = 0
  let now = 1_000_000
  const fetches = []
  const pending = []
  class FakeElement {}
  class FakeEvent {
    constructor(type, init) {
      this.type = type
      this.detail = init?.detail
    }
  }
  const document = {
    hidden,
    listeners: new Map(),
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set())
      this.listeners.get(type).add(fn)
    },
    removeEventListener(type, fn) {
      this.listeners.get(type)?.delete(fn)
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, addEventListener() {}, click() {} }),
    documentElement: { style: {} },
    body: { appendChild() {}, removeChild() {} },
  }
  const respond = (value) => ({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(value ?? {})), text: async () => JSON.stringify(value ?? {}) })
  const fetch = (path, init) => {
    let body
    try {
      body = init?.body === undefined ? undefined : JSON.parse(init.body)
    } catch {
      body = init?.body
    }
    const entry = { path, body }
    fetches.push(entry)
    const handler = routes[path]
    const value = typeof handler === 'function' ? handler(body, entry) : handler
    if (value && value.$defer === true) {
      // 延迟回包：测试里手动 resolve
      return new Promise((resolve) => {
        value.resolve = (reply) => resolve(respond(reply))
        pending.push(value)
      })
    }
    return Promise.resolve(respond(value))
  }
  const sandbox = {
    console,
    JSON,
    Math,
    Date: Object.assign(function FakeDate(...args) { return args.length === 0 ? new Date(now) : new Date(...args) }, { now: () => now }),
    Promise,
    Map,
    Set,
    WeakMap,
    Symbol,
    Object,
    Array,
    Number,
    String,
    Boolean,
    Error,
    RegExp,
    Intl,
    isFinite,
    parseInt,
    parseFloat,
    encodeURIComponent,
    decodeURIComponent,
    structuredClone,
    queueMicrotask,
    document,
    navigator: { clipboard: { writeText: async () => {} } },
    Element: FakeElement,
    HTMLElement: FakeElement,
    Node: FakeElement,
    CustomEvent: FakeEvent,
    Event: FakeEvent,
    Blob: class {},
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    AbortSignal: { timeout: () => ({ aborted: false }) },
    AbortController: class { constructor() { this.signal = { aborted: false } } abort() { this.signal.aborted = true } },
    fetch,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    requestAnimationFrame: (fn) => setTimeoutFake(fn, 16),
    cancelAnimationFrame: (id) => timers.delete(id),
    setTimeout: (fn, delay) => setTimeoutFake(fn, delay),
    clearTimeout: (id) => timers.delete(id),
    setInterval: (fn, delay) => {
      timerSeq += 1
      timers.set(timerSeq, { fn, at: now + (delay ?? 0), every: delay ?? 0 })
      return timerSeq
    },
    clearInterval: (id) => timers.delete(id),
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(fn)
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn)
    },
    dispatchEvent(event) {
      for (const fn of [...(listeners.get(event.type) ?? [])]) fn(event)
      return true
    },
    innerWidth: 1440,
    innerHeight: 900,
  }
  function setTimeoutFake(fn, delay) {
    timerSeq += 1
    timers.set(timerSeq, { fn, at: now + (Number(delay) || 0), every: 0 })
    return timerSeq
  }
  sandbox.window = sandbox
  sandbox.globalThis = sandbox
  let plugin = null
  sandbox.__ModuleLoader__ = {
    load(def) {
      plugin = def.factory((name) => {
        if (name === 'react') return React
        throw new Error('unexpected require ' + name)
      })
    },
  }
  vm.createContext(sandbox)
  vm.runInContext(SRC, sandbox, { filename: 'client.js' })
  // apply(ctx)：收集注册的组件
  const components = {}
  const ctx = {
    effect(fn) {
      try {
        fn()
      } catch {
        // ignore
      }
    },
    locale: { register() {}, bind: () => (key) => key },
    slots: {
      inject(_name, fn) {
        fn()
      },
      register(meta, Component) {
        components[meta.id ?? meta.key ?? meta.name] = Component
        components[Component.name] = Component
      },
    },
    get: () => null,
  }
  plugin.apply(ctx)
  const renderer = makeRenderer(React, root)
  const settle = async () => {
    for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve))
  }
  return {
    React,
    components,
    fetches,
    pending,
    sandbox,
    document,
    timers,
    renderer,
    root,
    dispatch(type, detail) {
      sandbox.dispatchEvent(new FakeEvent(type, { detail }))
    },
    /** 时间前进 ms：到点的定时器按时间序执行（interval 重新排）。 */
    async advance(ms) {
      const target = now + ms
      for (;;) {
        let next = null
        for (const [id, timer] of timers) if (timer.at <= target && (next === null || timer.at < next[1].at)) next = [id, timer]
        if (next === null) break
        const [id, timer] = next
        now = timer.at
        if (timer.every > 0) timer.at = now + timer.every
        else timers.delete(id)
        timer.fn()
        await settle()
      }
      now = target
    },
    settle,
    now: () => now,
  }
}

/** 树工具 */
export function walk(node, out = []) {
  if (node === null || node === undefined) return out
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out)
    return out
  }
  if (typeof node !== 'object') return out
  out.push(node)
  for (const child of node.children ?? []) walk(child, out)
  return out
}
export function textOf(node) {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  return (node.children ?? []).map(textOf).join('')
}
export function findAll(tree, pred) {
  return walk(tree).filter((node) => pred(node.props ?? {}, node))
}

export { makeReact, makeRenderer }

/**
 * 切片渲染：把 client.js 里一段源码（如 ExperimentalPanel）配假 React + 指定的自由变量跑起来。
 * free = { 名字: 值 }（React / h 自动给）。返回 { exports, render(element), React, flush }。
 */
export function loadSlice(fromMarker, toMarker, exportNames, free = {}) {
  const from = SRC.indexOf(fromMarker)
  const to = SRC.indexOf(toMarker, from)
  if (from < 0 || to <= from) throw new Error('找不到切片：' + fromMarker)
  const body = SRC.slice(from, to)
  const React = makeReact()
  const root = { dirty: false }
  const names = ['React', 'h', ...Object.keys(free)]
  // eslint-disable-next-line no-new-func
  const exportsObj = new Function(...names, `${body}\nreturn { ${exportNames.join(', ')} }`)(React, React.createElement, ...Object.values(free))
  const renderer = makeRenderer(React, root)
  return { exports: exportsObj, React, renderer, root }
}
