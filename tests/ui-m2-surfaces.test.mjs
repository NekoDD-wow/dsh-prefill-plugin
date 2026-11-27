// M2 三大入口视觉与动效升级回归测试（先红后绿）：
// 1. PrefillToggle：桌面 28px / 触屏 30px、三态去双层黑框、已配置 N/8 tabular-nums、481-959px 窄屏收短与限宽 88px、手机 ≤480 精简、按压 scale(0.97)、routeOff 12px 且禁 data-prefill-chip-warn、流式 full 档语义点低频轻呼吸
// 2. GateToggle：暖琥珀开启态、data-prefill-gate="1"、useBusy + 乐观切换 + 失败 reportError + 写前读 /state、首次确认条 Portal 锚定上方 8px 轻气泡（Esc / 外点可关，无 react-dom 回退原位）
// 3. collapse.marker：高 30px、中性灰图钉、右加 chevron-up、双层轻影、160ms 悬停防误触（onMouseLeave 清除，点击/聚焦立即展开）、收起 130ms easeOut + 40ms 错峰 springSnappy 弹入、<style key="marker-keyframes"> 仍在 <button> 外部
// 4. SessionModeBadge：24px 按钮胶囊（data-prefill-header-badge / aria-haspopup / aria-expanded）、全默认静默 return null、7 态 + 叠加下轮生效、点击展开 Portal 右对齐 268px 三段式 Popover（观察档绝不显示拦 N，含快跳）、源码切片红线与过时注释清理
// 5. 弹出卡片外壳与动效升级：外圆角 T.radius.lg (14px)、5 个头部弹层统一 usePresence 进退场过渡、切节右栏 scrollTop=0 + 120ms 轻淡入、空会话左栏开关 mix(brand, 42, ...) 降权、左栏 roving tabIndex + ArrowUp/Down（窄屏 ArrowLeft/Right）键盘导航、780px 窄屏激活柔底+细框、统一 SegmentedControl 收口、沙盒 🔒 换 <Icon name="lock" />、头部可点控件 === 7
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import { loadClient, findAll, textOf, makeReact, makeRenderer } from './client-render-harness.mjs'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const cut = (from, to) => {
  const a = src.indexOf(from)
  const b = a < 0 ? -1 : src.indexOf(to, a)
  return a >= 0 && b > a ? src.slice(a, b) : ''
}

/** 带可选假 react-dom createPortal 与自定义视口宽度的整模块渲染器。 */
function loadClientWithPortal({ routes = {}, width = 1440, height = 900, coarse = false, withPortal = true, onAnimate = null } = {}) {
  const React = makeReact()
  const root = { dirty: false }
  const listeners = new Map()
  const timers = new Map()
  let timerSeq = 0
  let now = 1_000_000
  const fetches = []
  const portals = []
  const errors = []
  const animations = []
  const panelOpens = []

  class FakeElement {
    constructor(attrs = {}) {
      this.attrs = attrs
      this.style = { willChange: '' }
      this.scrollTop = 0
      this.isConnected = true
      this.focused = 0
    }
    getAttribute(k) {
      return this.attrs[k] ?? null
    }
    hasAttribute(k) {
      return Object.prototype.hasOwnProperty.call(this.attrs, k)
    }
    closest() {
      return null
    }
    contains(other) {
      return other === this
    }
    querySelector() {
      return null
    }
    querySelectorAll() {
      return []
    }
    focus() {
      this.focused += 1
    }
    getBoundingClientRect() {
      return { left: 1000, top: 48, right: 1180, bottom: 72, width: 180, height: 24 }
    }
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
      animations.push(anim)
      onAnimate?.(anim)
      return anim
    }
  }
  class FakeEvent {
    constructor(type, init) {
      this.type = type
      this.detail = init?.detail
    }
  }
  const docListeners = new Map()
  const document = {
    hidden: false,
    activeElement: null,
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, new Set())
      docListeners.get(type).add(fn)
    },
    removeEventListener(type, fn) {
      docListeners.get(type)?.delete(fn)
    },
    dispatch(type, ev = {}) {
      for (const fn of [...(docListeners.get(type) ?? [])]) fn(ev)
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => new FakeElement(),
    documentElement: { style: {} },
    body: { tagName: 'BODY', appendChild() {}, removeChild() {} },
  }
  const respond = (value, ok = true, status = 200) => ({
    ok,
    status,
    json: async () => JSON.parse(JSON.stringify(value ?? {})),
    text: async () => JSON.stringify(value ?? {}),
  })
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
    if (value && value.$fail === true) return Promise.resolve(respond({ error: value.message || 'boom' }, false, value.status || 500))
    if (value && value.$defer === true) {
      return new Promise((resolve, reject) => {
        value.resolve = (reply) => resolve(respond(reply))
        value.reject = (err) => reject(err)
      })
    }
    return Promise.resolve(respond(value))
  }
  const setTimeoutFake = (fn, delay) => {
    timerSeq += 1
    timers.set(timerSeq, { fn, at: now + (Number(delay) || 0), every: 0 })
    return timerSeq
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
    CSS: { supports: (prop, val) => prop === 'animation-timing-function' && typeof val === 'string' && val.startsWith('linear(') },
    fetch,
    matchMedia: (q) => ({ matches: q === '(pointer: coarse)' ? coarse : false, addEventListener() {}, removeEventListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    requestAnimationFrame: (fn) => setTimeoutFake(fn, 16),
    cancelAnimationFrame: (id) => timers.delete(id),
    setTimeout: setTimeoutFake,
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
      if (event?.type === 'dsh-prefill:error') errors.push(event.detail)
      for (const fn of [...(listeners.get(event.type) ?? [])]) fn(event)
      return true
    },
    innerWidth: width,
    innerHeight: height,
  }
  sandbox.window = sandbox
  sandbox.globalThis = sandbox

  let plugin = null
  const ReactDOM = {
    createPortal(node, target) {
      portals.push({ node, target })
      return node
    },
  }
  sandbox.__ModuleLoader__ = {
    load(def) {
      plugin = def.factory((name) => {
        if (name === 'react') return React
        if (name === 'react-dom' && withPortal) return ReactDOM
        throw new Error('unexpected require ' + name)
      })
    },
  }
  vm.createContext(sandbox)
  vm.runInContext(src, sandbox, { filename: 'client.js' })
  const components = {}
  const ctx = {
    effect(fn) {
      try {
        fn()
      } catch {}
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
    get: (name) => (name === 'layout' ? { selectPanel: (id) => panelOpens.push(id) } : null),
  }
  plugin.apply(ctx)
  const renderer = makeRenderer(React, root)
  const settle = async () => {
    for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve))
  }
  const attachRefs = (tree, map = new Map()) => {
    const walk = (node) => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) {
        for (const c of node) walk(c)
        return
      }
      if (node.props?.ref && typeof node.props.ref === 'object') {
        const key = Object.keys(node.props).find((k) => k.startsWith('data-prefill-')) ?? String(node.type)
        if (!map.has(key)) map.set(key, new FakeElement(node.props))
        node.props.ref.current = map.get(key)
      }
      for (const child of node.children ?? []) walk(child)
    }
    walk(tree)
    return map
  }
  return {
    React,
    components,
    fetches,
    portals,
    errors,
    animations,
    panelOpens,
    sandbox,
    document,
    renderer,
    attachRefs,
    FakeElement,
    dispatch(type, detail) {
      sandbox.dispatchEvent(new FakeEvent(type, { detail }))
    },
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
  }
}

async function pumpDock(env, sid = 's1', extra = []) {
  const h = env.React.createElement
  const el = () => h('div', null, h(env.components.PrefillToggle, { sessionId: sid }), h(env.components.PrefillDock, { sessionId: sid }), ...extra)
  let tree = env.renderer.render(el())
  for (let i = 0; i < 4; i += 1) {
    await env.settle()
    tree = env.renderer.render(el())
  }
  return { tree, rerender: () => env.renderer.render(el()), pump: async () => { for (let i = 0; i < 4; i += 1) { await env.settle(); tree = env.renderer.render(el()) } return tree } }
}

// ── 1. PrefillToggle 输入槽胶囊 ────────────────────────────────────────────

test('[M2-1] PrefillToggle：桌面 28px 去双黑框三态、tabular-nums、481–959px 窄屏收短与限宽 88px、手机 ≤480 精简', async () => {
  const makeRoutes = (activePreset = {}, prefill = { s1: 'default' }) => ({
    '/api/dsh-prefill/summary': () => ({ ok: true, rev: '1', sessionId: 's1', prefill, activePreset, gate: {}, turns: {}, materialized: {} }),
    '/api/dsh-prefill/state': () => ({ ok: true, state: { prefill, activePreset, gate: {}, everyTurn: {}, ui: {} }, turns: {}, materialized: {} }),
    '/api/dsh-prefill/draft': () => ({ ok: true, draft: [] }),
    '/api/dsh-prefill/packs': () => ({ ok: true, packs: [{ name: '我的超长预设名字测试', count: 1 }], builtins: [], status: { enabled: false } }),
    '/api/dsh-prefill/cards': () => ({ ok: true, cards: [] }),
    '/api/dsh-prefill/usage': () => ({ ok: true }),
  })

  // ① 桌面 1440px 未开态：透明底 + border-l1 + 高 28px + 淡箭头
  const offEnv = loadClientWithPortal({ width: 1440, routes: makeRoutes({}, {}) })
  const offRender = await pumpDock(offEnv)
  const offChip = findAll(offRender.tree, (p) => p['data-prefill-chip'] === '1')[0]
  assert.ok(offChip, '找到芯片')
  assert.equal(offChip.props.style.height, 28, '桌面高 28px')
  assert.equal(offChip.props.style.background, 'transparent', '未开态透明底')
  assert.match(String(offChip.props.style.border ?? ''), /border-l1/, '未开态 border-l1')
  assert.ok(findAll(offChip, (_p, node) => node.type === 'svg').length >= 1, '未开态带淡箭头')

  // ② 桌面 1440px 已开态 & 展开态：柔和色阶底与单层外光环，无双层黑框；已配置 N/8 带 tabular-nums 与 flex: 0 0 auto
  const deskEnv = loadClientWithPortal({ width: 1440, routes: makeRoutes({}, { s1: 'default' }) })
  const desk = await pumpDock(deskEnv)
  const openChipBtn = findAll(desk.tree, (p) => p['data-prefill-chip'] === '1')[0]
  assert.equal(openChipBtn.props.style.height, 28)
  assert.match(String(openChipBtn.props.style.background ?? ''), /color-mix\(in srgb, var\(--dsw-alias-brand-primary\) 7%, var\(--dsw-alias-bg-layer-1\)\)/, '已开态柔和浅底')
  assert.match(String(openChipBtn.props.style.border ?? ''), /color-mix\(in srgb, var\(--dsw-alias-brand-primary\) 24%, var\(--dsw-alias-border-l1\)\)/, '已开态柔和细框')
  assert.doesNotMatch(String(openChipBtn.props.style.border ?? ''), /^1px solid var\(--dsw-alias-brand-primary\)$/, '禁用厚重实心黑框')

  // 点击展开卡片：展开态单层柔和外光环（brand 12%），不再出现 label-primary 22% 重黑圈
  openChipBtn.props.onClick()
  const openedTree = await desk.pump()
  const expandedChip = findAll(openedTree, (p) => p['data-prefill-chip'] === '1')[0]
  assert.match(String(expandedChip.props.style.boxShadow ?? ''), /0 0 0 2px color-mix\(in srgb, var\(--dsw-alias-brand-primary\) 12%, transparent\)/, '展开态单层柔和外光环')
  assert.doesNotMatch(String(expandedChip.props.style.boxShadow ?? ''), /label-primary/, '彻底去除旧重黑外圈')
  const statusWrap = findAll(expandedChip, (p) => p['data-prefill-chip-configured'] !== undefined)[0]
  assert.ok(statusWrap, '找到已配置状态组')
  assert.equal(statusWrap.props.style.flex, '0 0 auto', '状态组 flex: 0 0 auto')
  const configuredSpan = findAll(statusWrap, (p, node) => node.type === 'span' && p['data-prefill-chip-configured'] === undefined && /chipConfigured/.test(textOf(node)))[0]
  assert.ok(configuredSpan, '找到已配置 N/8 文本节点')
  assert.equal(configuredSpan.props.style.fontVariantNumeric, 'tabular-nums', '已配置 N/8 强制 tabular-nums')
  assert.equal(configuredSpan.props.style.flex, '0 0 auto', '已配置 N/8 强制 flex: 0 0 auto')

  // ③ 窄屏 780px（481–959px）：未套预设省略 `· 未套用预设`；有预设名限宽 88px
  const narrowNoPresetEnv = loadClientWithPortal({ width: 780, routes: makeRoutes({}, { s1: 'default' }) })
  const narrowNoPreset = await pumpDock(narrowNoPresetEnv)
  findAll(narrowNoPreset.tree, (p) => p['data-prefill-chip'] === '1')[0].props.onClick()
  const narrowNoPresetTree = await narrowNoPreset.pump()
  const narrowChipA = findAll(narrowNoPresetTree, (p) => p['data-prefill-chip'] === '1')[0]
  assert.doesNotMatch(textOf(narrowChipA), /chipNoPreset/, '780px 未套预设省略「· 未套用预设」')
  assert.match(textOf(narrowChipA), /chipConfigured/, '780px 保留「已配置 N/8」')

  const narrowPresetEnv = loadClientWithPortal({ width: 780, routes: makeRoutes({ s1: 'pack:我的超长预设名字测试' }, { s1: 'default' }) })
  const narrowPreset = await pumpDock(narrowPresetEnv)
  findAll(narrowPreset.tree, (p) => p['data-prefill-chip'] === '1')[0].props.onClick()
  const narrowPresetTree = await narrowPreset.pump()
  const narrowChipB = findAll(narrowPresetTree, (p) => p['data-prefill-chip'] === '1')[0]
  assert.match(textOf(narrowChipB), /我的超长预设名字测试/, '780px 有预设名仍展示')
  const presetSpan = findAll(narrowChipB, (_p, node) => node.type === 'span' && textOf(node) === '我的超长预设名字测试')[0]
  assert.ok(presetSpan, '找到预设名节点')
  assert.equal(presetSpan.props.style.maxWidth, 88, '780px 窄屏有预设名限宽 88px')

  // ④ 手机 ≤480px：320px 首屏未开卡态（summary === undefined）省略多余箭头并收紧 padding/gap，防止与官方按钮重叠；开卡后精简不溢出
  const phone320Env = loadClientWithPortal({
    width: 320,
    height: 658,
    coarse: true,
    routes: {
      '/api/dsh-prefill/summary': () => ({ ok: true, rev: '1', sessionId: 's1', prefill: { s1: 'default' }, gate: { s1: 'pure' } }),
      '/api/dsh-prefill/state': () => ({ ok: true, state: { prefill: { s1: 'default' }, gate: { s1: 'pure' } }, turns: {}, materialized: {} }),
    },
  })
  const h320 = phone320Env.React.createElement
  const el320 = () => h320('div', null, h320(phone320Env.components.PrefillToggle, { sessionId: 's1' }), h320(phone320Env.components.GateToggle, { sessionId: 's1' }))
  phone320Env.renderer.render(el320())
  await phone320Env.settle()
  const tree320 = phone320Env.renderer.render(el320())
  const chip320 = findAll(tree320, (p) => p['data-prefill-chip'] === '1')[0]
  const gate320 = findAll(tree320, (p) => p['data-prefill-gate'] === '1')[0]
  assert.ok(chip320 && gate320, '320px 手机首屏渲染芯片与纯净开关')
  assert.equal(findAll(chip320, (_p, node) => node.type === 'svg').length, 0, '320px 手机 summary===undefined 分支不画多余 chevron 防止超宽')
  assert.equal(chip320.props.style.height, 30)
  assert.equal(chip320.props.style.padding, '0 8px')
  assert.equal(chip320.props.style.gap, 4)
  assert.equal(gate320.props.style.height, 30)
  assert.equal(gate320.props.style.padding, '0 8px')
  assert.equal(gate320.props.style.gap, 5)

  const phoneEnv = loadClientWithPortal({ width: 390, coarse: true, routes: makeRoutes({ s1: 'pack:我的超长预设名字测试' }, { s1: 'default' }) })
  const phone = await pumpDock(phoneEnv)
  findAll(phone.tree, (p) => p['data-prefill-chip'] === '1')[0].props.onClick()
  const phoneTree = await phone.pump()
  const phoneChip = findAll(phoneTree, (p) => p['data-prefill-chip'] === '1')[0]
  assert.ok(phoneChip.props.style.height >= 30 && phoneChip.props.style.height <= 32, '手机胶囊高 30–32px')
  assert.doesNotMatch(textOf(phoneChip), /chipConfigured|我的超长预设名字测试/, '手机精简不溢出')
})

test('[M2-1] PrefillToggle：按压 scale(0.97)、routeOff 12px 且无 data-prefill-chip-warn、流式 full 档语义点低频轻呼吸', async () => {
  const chipSrc = cut('    function PrefillToggle(props) {', '    function fallbackName(')
  assert.doesNotMatch(chipSrc, /data-prefill-chip-warn/, '仍禁新增 data-prefill-chip-warn')

  const env = loadClientWithPortal({
    width: 1440,
    routes: {
      '/api/dsh-prefill/summary': () => ({
        ok: true,
        rev: '1',
        sessionId: 's1',
        prefill: { s1: 'default' },
        gate: {},
        running: ['s1'],
        ui: { experimental: true, motion: 'full' },
        sessionRoute: { provider: 'openai', model: 'm', matchesPrefix: false, at: 1 },
      }),
      '/api/dsh-prefill/state': () => ({
        ok: true,
        state: { prefill: { s1: 'default' }, gate: {}, everyTurn: {}, ui: { experimental: true, motion: 'full' } },
        turns: {},
        materialized: {},
        running: ['s1'],
        sessionRoute: { provider: 'openai', model: 'm', matchesPrefix: false, at: 1 },
      }),
      '/api/dsh-prefill/draft': () => ({ ok: true, draft: [] }),
      '/api/dsh-prefill/packs': () => ({ ok: true, packs: [], builtins: [], status: { enabled: false } }),
      '/api/dsh-prefill/cards': () => ({ ok: true, cards: [] }),
      '/api/dsh-prefill/usage': () => ({ ok: true }),
    },
  })
  const dock = await pumpDock(env)
  findAll(dock.tree, (p) => p['data-prefill-chip'] === '1')[0].props.onClick()
  const tree = await dock.pump()
  const chip = findAll(tree, (p) => p['data-prefill-chip'] === '1')[0]
  // routeOff 告警圆点放大至 12px
  const routeBadge = findAll(chip, (p) => p['data-prefill-chip-route'] === 'off')[0]
  assert.ok(routeBadge, '找到 routeOff 告警圆点')
  assert.equal(routeBadge.props.style.width, 12, 'routeOff 圆点宽 12px')
  assert.equal(routeBadge.props.style.height, 12, 'routeOff 圆点高 12px')

  // 按压 scale(0.97) 微反馈
  assert.equal(typeof chip.props.onPointerDown, 'function', 'PrefillToggle 绑定 onPointerDown 按压微反馈')
  const refs = env.attachRefs(tree)
  const chipEl = refs.get('data-prefill-chip')
  assert.ok(chipEl, '芯片 ref 存在')
  env.animations.length = 0
  chip.props.onPointerDown()
  assert.ok(env.animations.some((a) => a.frames.some((f) => String(f.transform ?? '').includes('scale(0.97)'))), '按下播放 scale(0.97) 微反馈')

  // 流式期 full 档语义点低频轻呼吸（源码与效果核验）
  assert.match(chipSrc, /chipStreaming/, 'PrefillToggle 识别流式态')
  assert.match(chipSrc, /iterations:\s*Infinity/, '流式期 full 档语义点循环低频轻呼吸')
})

// ── 2. GateToggle 暖琥珀 / useBusy / 乐观态 / Portal 确认气泡 ──────────────

test('[M2-2] GateToggle：暖琥珀开启态、data-prefill-gate="1"、useBusy + 乐观切换 + 失败 reportError + Portal 上方 8px 轻气泡', async () => {
  // ① 首次开启：点击后弹出 Portal 锚定上方 8px 的轻气泡，原按钮留在输入行；Esc 可关；无 react-dom 回退原位
  for (const withPortal of [true, false]) {
    const env = loadClientWithPortal({
      withPortal,
      routes: {
        '/api/dsh-prefill/summary': () => ({ ok: true, rev: '1', sessionId: 's1', prefill: {}, gate: {}, noticeSeen: false }),
        '/api/dsh-prefill/state': () => ({ ok: true, state: { prefill: {}, gate: {}, noticeSeen: false }, turns: {}, materialized: {} }),
      },
    })
    const h = env.React.createElement
    const el = () => h('div', null, h(env.components.GateToggle, { sessionId: 's1' }))
    let tree = env.renderer.render(el())
    await env.settle()
    tree = env.renderer.render(el())

    const btn = findAll(tree, (p) => p['data-prefill-gate'] === '1')[0]
    assert.ok(btn, `withPortal=${withPortal}: GateToggle 必须带 data-prefill-gate="1"`)
    assert.equal(btn.props['aria-pressed'], 'false')
    assert.equal(btn.props.style.height, 28, '桌面 GateToggle 高 28px')

    env.attachRefs(tree)
    btn.props.onClick()
    await env.settle()
    tree = env.renderer.render(el())

    // 原按钮仍留在输入行，不被确认条替换掉
    assert.equal(findAll(tree, (p) => p['data-prefill-gate'] === '1').length, 1, '首次确认时原按钮留在输入行')
    const notice = findAll(tree, (p) => p['data-prefill-gate-notice'] === '1')[0]
    assert.ok(notice, `withPortal=${withPortal}: 渲染首次确认轻气泡`)
    if (withPortal) {
      assert.ok(env.portals.some((p) => p.target === env.document.body), '有 react-dom 时通过 createPortal 挂到 document.body')
      assert.equal(notice.props.style.position, 'fixed', 'Portal 轻气泡使用 fixed 定位锚定按钮上方 8px')
    } else {
      assert.equal(env.portals.length, 0, '无 react-dom 时优雅回退原位渲染')
    }

    // Esc 关闭气泡
    env.sandbox.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} })
    await env.settle()
    tree = env.renderer.render(el())
    assert.equal(findAll(tree, (p) => p['data-prefill-gate-notice'] === '1' && p['data-closing'] !== 'true').length, 0, 'Esc 可关闭首次确认轻气泡')
  }

  // ② 暖琥珀开启态 + 乐观切换 + 失败回滚 & reportError()
  let failWrite = false
  let deferWrite = null
  const state = { prefill: {}, gate: {}, noticeSeen: true }
  const env2 = loadClientWithPortal({
    routes: {
      '/api/dsh-prefill/summary': () => ({ ok: true, rev: '1', sessionId: 's1', prefill: {}, gate: state.gate, noticeSeen: true }),
      '/api/dsh-prefill/state': (body) => {
        if (body === undefined) return { ok: true, state }
        if (failWrite) return { $fail: true, status: 500, message: 'write failed' }
        if (deferWrite) return deferWrite
        state.gate = { ...body.gate }
        return { ok: true, state, summary: { ok: true, rev: '2', sessionId: 's1', prefill: {}, gate: state.gate, noticeSeen: true } }
      },
    },
  })
  const h2 = env2.React.createElement
  const el2 = () => h2('div', null, h2(env2.components.GateToggle, { sessionId: 's1' }))
  let t2 = env2.renderer.render(el2())
  await env2.settle()
  t2 = env2.renderer.render(el2())

  // 延迟写回：点击瞬间乐观置 aria-pressed="true"，且立刻呈现暖琥珀语义色
  deferWrite = { $defer: true }
  findAll(t2, (p) => p['data-prefill-gate'] === '1')[0].props.onClick()
  await env2.settle()
  t2 = env2.renderer.render(el2())
  const optimisticBtn = findAll(t2, (p) => p['data-prefill-gate'] === '1')[0]
  assert.equal(optimisticBtn.props['aria-pressed'], 'true', '写未落盘前乐观切换为 true')
  assert.match(String(optimisticBtn.props.style.background ?? ''), /state-warn-primary\) 12%/, '开启态暖琥珀 12% 柔底')
  assert.match(String(optimisticBtn.props.style.border ?? ''), /state-warn-primary\) 38%/, '开启态暖琥珀 38% 细框')
  // 完成写入
  state.gate = { s1: 'pure' }
  deferWrite.resolve({ ok: true, state, summary: { ok: true, rev: '2', sessionId: 's1', prefill: {}, gate: state.gate, noticeSeen: true } })
  deferWrite = null
  await env2.settle()
  t2 = env2.renderer.render(el2())
  assert.equal(findAll(t2, (p) => p['data-prefill-gate'] === '1')[0].props['aria-pressed'], 'true')

  // 再次点击（关闭）但后端失败：乐观回滚并调用 reportError()
  failWrite = true
  findAll(t2, (p) => p['data-prefill-gate'] === '1')[0].props.onClick()
  await env2.settle()
  t2 = env2.renderer.render(el2())
  assert.equal(findAll(t2, (p) => p['data-prefill-gate'] === '1')[0].props['aria-pressed'], 'true', '写失败后乐观态回滚')
  assert.ok(env2.errors.some((e) => e?.key === 'gate'), '写失败触发 reportError(sessionId, "gate", ...)')
})

// ── 3. collapse.marker 防误触 / 错峰弹入 / 视觉细节 ────────────────────────

test('[M2-3] collapse.marker：30px、中性灰图钉、chevron-up、双层轻影、160ms 悬停防误触、40ms 错峰 springSnappy 与外置 keyframes', async () => {
  const dockSrc = cut('    function PrefillDock(props) {', '    function UsagePanel(props) {')
  assert.match(dockSrc, /opacity 130ms/, '卡片收起动画切至 130ms')
  assert.match(dockSrc, /40ms both/, 'marker 滞后 40ms 错峰弹入')
  assert.match(dockSrc, /MOTION\.springSnappy/, 'marker 完整档用 springSnappy')
  assert.match(dockSrc, /shrunk && motion !== 'off'\n\s+\? h\('style', \{ key: 'marker-keyframes' \}, '@keyframes dsh-prefill-pop/, '保留 <style key="marker-keyframes"> 在 <button> 外部')

  const env = loadClientWithPortal({
    width: 1440,
    routes: {
      '/api/dsh-prefill/summary': () => ({ ok: true, rev: '1', sessionId: 's1', prefill: { s1: 'default' } }),
      '/api/dsh-prefill/state': () => ({ ok: true, state: { prefill: { s1: 'default' }, gate: {}, everyTurn: {}, ui: { motion: 'full' } }, turns: {}, materialized: {} }),
      '/api/dsh-prefill/draft': () => ({ ok: true, draft: [] }),
      '/api/dsh-prefill/packs': () => ({ ok: true, packs: [], builtins: [], status: { enabled: false } }),
      '/api/dsh-prefill/cards': () => ({ ok: true, cards: [] }),
      '/api/dsh-prefill/usage': () => ({ ok: true }),
    },
  })
  const dock = await pumpDock(env)
  findAll(dock.tree, (p) => p['data-prefill-chip'] === '1')[0].props.onClick()
  let tree = await dock.pump()
  findAll(tree, (p) => p['data-prefill-collapse'] === '')[0].props.onClick()
  tree = await dock.pump()

  const marker = findAll(tree, (p) => p['data-prefill-marker'] === '1')[0]
  assert.ok(marker, '收起后出现 marker')
  assert.equal(marker.props.style.height, 30, 'marker 高 30px')
  assert.match(String(marker.props.style.boxShadow ?? ''), /,/, 'marker 双层轻影')
  assert.equal(findAll(marker, (_p, node) => node.type === 'style').length, 0, '<button> 内部不得含 <style>')
  assert.ok(findAll(marker, (p) => p['data-prefill-marker-chev'] !== undefined).length === 1, 'marker 右侧含微弱 chevron-up')
  const pinWrap = findAll(marker, (p, node) => node.type === 'span' && p.style?.color === 'var(--dsw-alias-label-secondary)')[0]
  assert.ok(pinWrap, '图钉改为中性灰 label-secondary')

  // 悬停防误触：onMouseEnter 后 100ms 尚未展开；onMouseLeave 取消后过 300ms 仍保持收起
  marker.props.onMouseEnter()
  await env.advance(100)
  tree = dock.rerender()
  assert.equal(findAll(tree, (p) => p['data-prefill-card-panel'] === '1')[0].props['data-shrunk'], 'true', '100ms < 160ms 不误展开')
  marker.props.onMouseLeave()
  await env.advance(300)
  tree = dock.rerender()
  assert.equal(findAll(tree, (p) => p['data-prefill-card-panel'] === '1')[0].props['data-shrunk'], 'true', '离开清除定时器不展开')

  // 悬停满 160ms 自动展开
  marker.props.onMouseEnter()
  await env.advance(170)
  tree = dock.rerender()
  assert.equal(findAll(tree, (p) => p['data-prefill-card-panel'] === '1')[0].props['data-shrunk'], 'false', '悬停满 160ms 展开')

  // 再次收起：点击立即展开（无需等 160ms）
  findAll(tree, (p) => p['data-prefill-collapse'] === '')[0].props.onClick()
  tree = await dock.pump()
  findAll(tree, (p) => p['data-prefill-marker'] === '1')[0].props.onClick()
  tree = dock.rerender()
  assert.equal(findAll(tree, (p) => p['data-prefill-card-panel'] === '1')[0].props['data-shrunk'], 'false', '点击立即展开')

  // 再次收起：键盘聚焦立即展开
  findAll(tree, (p) => p['data-prefill-collapse'] === '')[0].props.onClick()
  tree = await dock.pump()
  findAll(tree, (p) => p['data-prefill-marker'] === '1')[0].props.onFocus()
  tree = dock.rerender()
  assert.equal(findAll(tree, (p) => p['data-prefill-card-panel'] === '1')[0].props['data-shrunk'], 'false', '键盘聚焦立即展开')
})

// ── 4. SessionModeBadge 顶栏 7 态 + 静默 + 下轮生效 + 点击 Popover ─────────

test('[M2-4] SessionModeBadge：全默认静默、7 态 + 下轮生效、24px 按钮胶囊、点击展开 Portal 268px 三段式 Popover 与观察档禁拦 N', async () => {
  const renderBadge = async (summary, opts = {}) => {
    const env = loadClientWithPortal({
      routes: {
        '/api/dsh-prefill/summary': (body) => ({ ok: true, rev: '1', sessionId: body.sessionId, ...summary }),
        '/api/dsh-prefill/state': () => ({ ok: true, state: { prefill: summary.prefill ?? {} } }),
      },
      ...opts,
    })
    const h = env.React.createElement
    const el = () => h('div', null, h(env.components.SessionModeBadge, { sessionId: 's1' }))
    env.renderer.render(el())
    await env.settle()
    const tree = env.renderer.render(el())
    return { env, tree, rerender: () => env.renderer.render(el()) }
  }

  // ① 全默认未开态：静默返回 null
  const silent = await renderBadge({ prefill: {}, gate: {}, armed: [], levers: {}, sandbox: { s1: { level: 'observe', blocked: 5 } }, turns: {}, materialized: {}, pendingReprime: [] })
  assert.equal(findAll(silent.tree, (p) => p['data-prefill-header-badge'] !== undefined).length, 0, '全默认态静默返回 null')

  // ② 6 种可见态（加静默共 7 态）
  const cases = [
    ['ready', { prefill: { s1: 'default' }, gate: {}, turns: {}, materialized: {}, locked: {} }],
    ['locked', { prefill: { s1: 'default' }, gate: {}, turns: { s1: 3 }, materialized: { s1: 1 } }],
    ['append', { prefill: { s1: 'default' }, gate: { s1: 'pass' }, persona: { s1: true }, turns: { s1: 2 } }],
    ['replace', { prefill: { s1: 'default' }, gate: { s1: 'replace' }, persona: { s1: true }, turns: { s1: 2 } }],
    ['pure', { prefill: { s1: 'default' }, gate: { s1: 'pure' }, turns: { s1: 1 } }],
    ['takeover', { prefill: { s1: 'default' }, gate: { s1: 'pure' }, persona: { s1: true }, turns: { s1: 1 } }],
  ]
  for (const [expectedKey, payload] of cases) {
    const res = await renderBadge(payload)
    const btn = findAll(res.tree, (p) => p['data-prefill-header-badge'] !== undefined)[0]
    assert.ok(btn, `状态 ${expectedKey} 渲染胶囊按钮`)
    assert.equal(btn.type, 'button', '升级为按钮胶囊')
    assert.equal(btn.props['data-prefill-header-badge'], expectedKey)
    assert.equal(btn.props['aria-haspopup'], 'dialog')
    assert.equal(btn.props['aria-expanded'], 'false')
    assert.equal(btn.props.style.height, 24, '顶栏胶囊高 24px')
  }

  // ③ 叠加「下轮生效」+ 点击展开 Portal 268px 三段式 Popover + 观察档绝不显示拦 N + 快跳按钮
  const active = await renderBadge({
    prefill: { s1: 'default' },
    activePreset: { s1: 'pack:写作搭档' },
    gate: { s1: 'pure' },
    persona: { s1: true },
    turns: { s1: 4 },
    pendingReprime: ['s1'],
    sandbox: { s1: { level: 'observe', blocked: 9 } },
    tools: { s1: 0 },
  })
  const badgeBtn = findAll(active.tree, (p) => p['data-prefill-header-badge'] === 'takeover')[0]
  assert.ok(badgeBtn)
  assert.ok(findAll(badgeBtn, (p) => p['data-prefill-header-pending'] === '1').length === 1, 'pendingReprime 时尾附下轮生效微标')

  active.env.attachRefs(active.tree)
  badgeBtn.props.onClick()
  await active.env.settle()
  let popTree = active.rerender()
  assert.equal(findAll(popTree, (p) => p['data-prefill-header-badge'] === 'takeover')[0].props['aria-expanded'], 'true')
  const pop = findAll(popTree, (p) => p['data-prefill-header-popover'] === '1')[0]
  assert.ok(pop, '点击展开顶栏 Popover')
  assert.equal(pop.props.style.width, 268, 'Popover 宽 268px')
  assert.ok(active.env.portals.some((p) => p.target === active.env.document.body), 'Popover 通过 Portal 挂到 document.body')
  assert.ok(findAll(pop, (p) => p['data-prefill-header-popover-pending'] === '1').length === 1, 'Popover 含下轮生效暖条')
  assert.match(textOf(pop), /写作搭档/, '遥测表显示当前预设')
  assert.doesNotMatch(textOf(pop), /sbxBlockedN|拦\s*9/, '观察档绝不显示拦 N')
  const openCardBtn = findAll(pop, (p) => p['data-prefill-header-open-card'] === '1')[0]
  const openSettingsBtn = findAll(pop, (p) => p['data-prefill-header-open-settings'] === '1')[0]
  assert.ok(openCardBtn && openSettingsBtn, '含快跳「打开预填装卡片 / 设置 ↗」')

  // 点击设置快跳：关闭 Popover 并调用 layout.selectPanel
  openSettingsBtn.props.onClick()
  await active.env.settle()
  assert.ok(active.env.panelOpens.length >= 1, '点击设置快跳切到预填装设置页')

  // 源码红线 & 过时注释清理
  const regSrc = src.slice(src.indexOf('    function SessionModeBadge(props) {'))
  assert.doesNotMatch(regSrc, /实测里它没生效/, '已清理过时的「实测里它没生效」注释')
  assert.match(regSrc, /0\.2\.2-rc\.5/, '注明 0.2.2-rc.5 非空白会话可见、空白 hero 屏按 hideChrome 隐藏')
})

// ── 5. 弹出卡片外壳：圆角、5 弹层退场、切节复位、左栏降权与键盘导航、SegmentedControl、去 🔒 ──

test('[M2-5] 弹出卡片外壳：圆角 14px、5 个头部弹层 usePresence 退场、切节 scrollTop=0 + 120ms 轻淡入、空会话左栏开关降权、左栏键盘导航、780px 激活边框、SegmentedControl 与 <Icon name="lock" />', async () => {
  const dockSrc = cut('    function PrefillDock(props) {', '    function UsagePanel(props) {')
  const sandboxSrc = cut('    function SandboxSection(props) {', '    function InjectionSection(props) {')

  // ① 外圆角统一 T.radius.lg (14px)
  assert.match(dockSrc, /borderRadius:\s*T\.radius\.lg/, '卡片外圆角统一 T.radius.lg (14px)')

  // ② 统一 SegmentedControl 收口系统提示 / 工作区 / 沙盒，且沙盒 🔒 换 <Icon name="lock" />
  assert.match(src, /function SegmentedControl\(props\) \{/, '抽提统一 SegmentedControl 组件')
  assert.match(dockSrc, /h\(SegmentedControl,[\s\S]{0,400}data-prefill-mode/, '系统提示使用 SegmentedControl')
  assert.match(dockSrc, /h\(SegmentedControl,[\s\S]{0,400}data-prefill-ws-mode/, '工作区说明使用 SegmentedControl')
  assert.match(src.slice(src.indexOf('    function SbxSegment(props) {'), src.indexOf('    function SandboxSection(props) {')), /SegmentedControl/, 'SbxSegment 收口到 SegmentedControl')
  assert.doesNotMatch(sandboxSrc, /🔒/, '沙盒不再使用 🔒 Emoji')
  assert.match(sandboxSrc, /name: 'lock'/, '沙盒锁图标使用 <Icon name="lock" />')

  // ③ 5 个头部弹层统一接入 usePresence 退场过渡（点击打开再关：退场中保留节点带 data-closing="true" 并播 exit 动画）
  const env = loadClientWithPortal({
    width: 1440,
    routes: {
      '/api/dsh-prefill/summary': () => ({ ok: true, rev: '1', sessionId: 's1', prefill: { s1: 'default' } }),
      '/api/dsh-prefill/state': () => ({ ok: true, state: { prefill: { s1: 'default' }, gate: {}, everyTurn: {}, ui: { motion: 'full' } }, turns: {}, materialized: {} }),
      '/api/dsh-prefill/draft': () => ({ ok: true, draft: [] }),
      '/api/dsh-prefill/packs': () => ({ ok: true, packs: [], builtins: [], status: { enabled: false } }),
      '/api/dsh-prefill/cards': () => ({ ok: true, cards: [] }),
      '/api/dsh-prefill/usage': () => ({ ok: true }),
    },
  })
  const dock = await pumpDock(env)
  findAll(dock.tree, (p) => p['data-prefill-chip'] === '1')[0].props.onClick()
  let tree = await dock.pump()

  // 头部无错可点控件严格 === 8（预设 / 保存 / 清空预设 / 状态胶囊 / ⋯ / pin / 收起 / 关闭）
  const header = findAll(tree, (p) => p['data-prefill-header'] === '1')[0]
  assert.equal(findAll(header, (_p, node) => node.type === 'button').length, 8, '头部无错可点控件严格 === 8')
  const headerLeft = findAll(header, (p) => p['data-prefill-header-zone'] === 'left')[0]
  const leftButtons = findAll(headerLeft, (_p, node) => node.type === 'button')
  assert.equal(leftButtons.length, 3, '头部左区：预设选择 + 保存 + 清空预设')
  assert.equal(leftButtons[1].props['data-prefill-save'], '')
  assert.equal(leftButtons[2].props['data-prefill-preset-clear-header'], '')
  assert.equal(leftButtons[2].props.disabled, true, '空会话下头部清空预设按钮保持可见但禁用')

  // 空会话左栏开关（on && !filled）柔化降权 mix(brand, 42, ...)
  const emptySwitch = findAll(tree, (p) => p['data-prefill-enable'] === 'system')[0]
  assert.ok(emptySwitch, '找到系统提示开关')
  assert.equal(emptySwitch.props['aria-checked'], 'true')
  assert.match(String(emptySwitch.props.style.background ?? ''), /color-mix\(in srgb, var\(--dsw-alias-brand-primary\) 42%/, '空会话已开开关柔化降权')

  // 打开「更多」菜单 → 挂 ref → 关闭：应进入 closing 退场态并调用 animate，动画结束后才卸载
  findAll(tree, (p) => p['data-prefill-more'] === '')[0].props.onClick()
  await env.settle()
  tree = dock.rerender()
  assert.equal(findAll(tree, (p) => p['data-prefill-menu'] === 'more').length, 1)
  env.attachRefs(tree)
  tree = dock.rerender()
  env.animations.length = 0
  findAll(tree, (p) => p['data-prefill-more'] === '')[0].props.onClick()
  await env.settle()
  tree = dock.rerender()
  const closingMore = findAll(tree, (p) => p['data-prefill-menu'] === 'more')[0]
  assert.ok(closingMore, '关闭头部弹层时先播退场过渡，不瞬间卸载')
  assert.equal(closingMore.props['data-closing'], 'true')
  const exitAnim = env.animations.find((a) => a.timing?.fill === 'forwards' && a.timing?.duration === 110)
  assert.ok(exitAnim, '已播放 110ms easeOut 退场动画')
  exitAnim.finish()
  await env.settle()
  tree = dock.rerender()
  assert.equal(findAll(tree, (p) => p['data-prefill-menu'] === 'more').length, 0, '退场动画落定后卸载')

  // 左栏 roving tabIndex + ArrowDown / ArrowUp 键盘导航 + 切节右栏 scrollTop = 0 + 120ms 淡入
  const navTabs = findAll(tree, (p) => p['data-prefill-nav'] !== undefined)
  const selectedTabs = navTabs.filter((n) => n.props['aria-selected'] === 'true')
  const unselectedTabs = navTabs.filter((n) => n.props['aria-selected'] === 'false')
  assert.equal(selectedTabs.length, 1)
  assert.equal(selectedTabs[0].props.tabIndex, 0, '选中左栏项 tabIndex=0')
  assert.ok(unselectedTabs.every((n) => n.props.tabIndex === -1), '未选中左栏项 tabIndex=-1（roving tabIndex）')

  const refs = env.attachRefs(tree)
  const mainEl = refs.get('data-prefill-main')
  assert.ok(mainEl, '找到右栏 main ref')
  mainEl.scrollTop = 240
  env.animations.length = 0
  const curPane = selectedTabs[0].props['data-prefill-nav']
  let prevented = 0
  selectedTabs[0].props.onKeyDown({ key: 'ArrowDown', target: null, currentTarget: null, preventDefault: () => (prevented += 1) })
  await env.settle()
  tree = dock.rerender()
  const nextSelected = findAll(tree, (p) => p['data-prefill-nav'] !== undefined && p['aria-selected'] === 'true')[0]
  assert.equal(prevented, 1, 'ArrowDown 被拦截处理')
  assert.notEqual(nextSelected.props['data-prefill-nav'], curPane, 'ArrowDown 切换到下一节')
  assert.equal(mainEl.scrollTop, 0, '切节时右栏 scrollTop 重置为 0')
  assert.ok(env.animations.some((a) => a.timing?.duration === 120 && a.frames.some((f) => f.opacity === 0.4)), '切节播放 120ms 轻淡入')

  // ④ 780px 窄屏标签：明确激活柔底+细框，且支持 ArrowRight 键盘导航
  const narrowEnv = loadClientWithPortal({
    width: 780,
    routes: {
      '/api/dsh-prefill/summary': () => ({ ok: true, rev: '1', sessionId: 's1', prefill: { s1: 'default' } }),
      '/api/dsh-prefill/state': () => ({ ok: true, state: { prefill: { s1: 'default' }, gate: {}, everyTurn: {}, ui: { motion: 'full' } }, turns: {}, materialized: {} }),
      '/api/dsh-prefill/draft': () => ({ ok: true, draft: [] }),
      '/api/dsh-prefill/packs': () => ({ ok: true, packs: [], builtins: [], status: { enabled: false } }),
      '/api/dsh-prefill/cards': () => ({ ok: true, cards: [] }),
      '/api/dsh-prefill/usage': () => ({ ok: true }),
    },
  })
  const narrowDock = await pumpDock(narrowEnv)
  findAll(narrowDock.tree, (p) => p['data-prefill-chip'] === '1')[0].props.onClick()
  let nTree = await narrowDock.pump()
  const hl = findAll(nTree, (p) => p['data-prefill-nav-hl'] !== undefined)[0]
  assert.ok(hl, '780px 窄屏存在激活高亮层')
  assert.match(String(hl.props.style.background ?? ''), /color-mix/, '780px 窄屏激活标签带明确柔底')
  assert.match(String(hl.props.style.border ?? ''), /1px solid/, '780px 窄屏激活标签带细框')
  const activeTab = findAll(nTree, (p) => p['data-prefill-nav'] !== undefined && p['aria-selected'] === 'true')[0]
  const beforeNarrowPane = activeTab.props['data-prefill-nav']
  activeTab.props.onKeyDown({ key: 'ArrowRight', target: null, currentTarget: null, preventDefault() {} })
  await narrowEnv.settle()
  nTree = narrowDock.rerender()
  const afterNarrowPane = findAll(nTree, (p) => p['data-prefill-nav'] !== undefined && p['aria-selected'] === 'true')[0].props['data-prefill-nav']
  assert.notEqual(afterNarrowPane, beforeNarrowPane, '780px 窄屏 ArrowRight 切换下一标签')

  // ⑤ 已套用预设时：头部「保存」旁的清空预设按钮可用、点击清空并出撤销条，且预设菜单底部的原取消预设按钮仍保留
  const presetState = {
    prefill: { s1: 'default' },
    activePreset: { s1: 'pack:demo' },
    gate: { s1: 'pass' },
    everyTurn: {},
    ui: { motion: 'full' },
  }
  let clearedStateCalled = false
  let clearedDraftCalled = false
  const presetEnv = loadClientWithPortal({
    width: 1440,
    routes: {
      '/api/dsh-prefill/summary': () => ({ ok: true, rev: '1', sessionId: 's1', prefill: { s1: 'default' }, activePreset: { s1: 'pack:demo' } }),
      '/api/dsh-prefill/state': (body) => {
        if (body?.sessionPatch?.unset?.includes('activePreset')) {
          clearedStateCalled = true
          delete presetState.activePreset.s1
        }
        return { ok: true, state: presetState, turns: {}, materialized: {} }
      },
      '/api/dsh-prefill/draft': (body) => {
        if (Array.isArray(body?.items) && body.items.length === 0) clearedDraftCalled = true
        return { ok: true, draft: [] }
      },
      '/api/dsh-prefill/packs': () => ({ ok: true, packs: [{ name: 'demo', items: [] }], builtins: [], status: { enabled: false } }),
      '/api/dsh-prefill/cards': () => ({ ok: true, cards: [] }),
      '/api/dsh-prefill/usage': () => ({ ok: true }),
    },
  })
  const presetDock = await pumpDock(presetEnv)
  findAll(presetDock.tree, (p) => p['data-prefill-chip'] === '1')[0].props.onClick()
  let pTree = await presetDock.pump()
  // 打开预设菜单：原底部取消预设按钮仍在
  findAll(pTree, (p) => p['data-prefill-preset-select'] === '')[0].props.onClick()
  await presetEnv.settle()
  pTree = presetDock.rerender()
  assert.equal(findAll(pTree, (p) => p['data-prefill-preset-clear'] === '').length, 1, '预设菜单底部的原取消预设按钮仍保留')
  // 头部清空预设按钮已启用：点击清空并收起菜单、出现撤销条
  const headerClear = findAll(pTree, (p) => p['data-prefill-preset-clear-header'] === '')[0]
  assert.ok(headerClear, '头部存在清空预设按钮')
  assert.equal(headerClear.props.disabled, false, '有预设时头部清空预设按钮可用')
  headerClear.props.onClick()
  await presetEnv.settle()
  await presetEnv.settle()
  pTree = presetDock.rerender()
  assert.equal(clearedStateCalled, true, '点击头部清空预设按钮触发状态清空')
  assert.equal(clearedDraftCalled, true, '点击头部清空预设按钮同步清空草稿')
  assert.equal(findAll(pTree, (p) => p['data-prefill-preset-undo-bar'] === '').length, 1, '清空后出现撤销条')
})
