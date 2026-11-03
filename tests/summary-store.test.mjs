// 客户端轻量数据层（docs/规划-界面重构-v1.md §2.2）：把 client.js 的 <summary-store> 段切出来，
// 配假 React / window / document / fetch / 定时器真跑一遍。
// 覆盖：单飞、rev 未变不 emit、applyEnvelope 提取（整封 envelope → 迷你 envelope）、
//       后台暂停 / 回前台补一次、无订阅者清定时器、退避、卡片开合 3s / 5s、useSummary 垫片。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const start = src.indexOf('    // <summary-store>')
const end = src.indexOf('    // </summary-store>')
assert.ok(start > 0 && end > start, '找不到 // <summary-store> 段')
const storeSrc = src.slice(start, end)
const STATE_EVENT = 'dsh-prefill:state-changed'

/** 假的 React：hooks 按调用顺序存槽位（和 tests/settings-harness.mjs 同一思路）。 */
function makeReact() {
  const slots = []
  const effects = []
  let cursor = 0
  const React = {
    useState(init) {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof init === 'function' ? init() : init
      return [
        slots[index],
        (value) => {
          slots[index] = typeof value === 'function' ? value(slots[index]) : value
        },
      ]
    },
    useEffect(fn) {
      effects.push(fn())
    },
    // eslint-disable-next-line no-unused-vars
    useCallback(fn) {
      return fn
    },
  }
  return {
    React,
    slots,
    rewind() {
      cursor = 0
    },
    unmount() {
      for (const fn of effects.splice(0)) if (typeof fn === 'function') fn()
    },
  }
}

/**
 * 假环境：定时器手动 tick（不真等）、fetch 按队列回放、document.hidden 可切。
 * push(reply) 压一次响应：普通对象 / 'fail'（HTTP 500）/ Error（网络错误）。
 */
function makeEnv() {
  const react = makeReact()
  const timers = new Map()
  let timerSeq = 0
  const requests = []
  const replies = []
  const windowListeners = []
  const documentListeners = []

  const fetch = async (path, init) => {
    const body = init?.body === undefined ? undefined : JSON.parse(init.body)
    requests.push({ path, body, signal: init?.signal })
    const reply = replies.length > 0 ? replies.shift() : { ok: true }
    if (reply === 'fail') return { ok: false, status: 500, json: async () => ({ ok: false, reason: 'boom' }) }
    if (reply instanceof Error) throw reply
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(reply)) }
  }
  const window = {
    addEventListener(type, fn) {
      windowListeners.push({ type, fn })
    },
    removeEventListener() {},
  }
  const document = {
    hidden: false,
    addEventListener(type, fn) {
      documentListeners.push({ type, fn })
    },
  }
  const setTimeout = (fn, delay) => {
    timerSeq += 1
    timers.set(timerSeq, { fn, delay })
    return timerSeq
  }
  const clearTimeout = (id) => timers.delete(id)
  // 只做「有 timeout 方法」的假件：真 AbortSignal 会在测试进程里排一个 15s 的真定时器。
  const AbortSignal = { timeout: () => ({ aborted: false }) }

  const make = new Function(
    'React',
    'fetch',
    'window',
    'document',
    'setTimeout',
    'clearTimeout',
    'AbortSignal',
    'STATE_EVENT',
    `${storeSrc}\nreturn { summaryStore, summaryExtras, useSummary, setSummaryCardOpen, refreshSummary, applyEnvelope, pauseSummary, resumeSummary, summaryDelay, summarySubscribe, summaryUnsubscribe, normalizeSummary, extractSummary, summarySignature }`,
  )

  const settle = () => new Promise((resolve) => globalThis.setTimeout(resolve, 0))

  const env = {
    react,
    requests,
    timers,
    document,
    windowListeners,
    documentListeners,
    push(reply) {
      replies.push(reply)
    },
    failNext(count = 1) {
      for (let at = 0; at < count; at += 1) replies.push('fail')
    },
    /** 手动 tick：把所有排着的定时器都跑一遍（回执里带各自的 delay 方便断言）。 */
    tickAll() {
      const entries = [...timers.entries()]
      timers.clear()
      for (const [, entry] of entries) entry.fn()
      return entries.map(([, entry]) => entry.delay)
    },
    delays() {
      return [...timers.values()].map((entry) => entry.delay)
    },
    settle,
    load() {
      react.rewind()
      return make(react.React, fetch, window, document, setTimeout, clearTimeout, AbortSignal, STATE_EVENT)
    },
  }
  return env
}

/** 整封 envelope（/state 的响应形状）的样本。 */
const FULL_ENVELOPE = {
  ok: true,
  state: {
    prefill: { s1: 'p1', other: 'p2' },
    gate: { s1: 'pure', other: 'pass' },
    activePreset: { s1: 'builtin:persona', other: 'builtin:x' },
    armed: ['s1'],
    levers: { blockSections: true, blockContexts: false, blockTools: true, blockMessages: true },
    ui: { motion: 'lite', experimental: true },
    locked: { s1: { at: '2026-11-01T00:00:00Z', turn: 2, items: [{ role: 'user', text: '开局' }] }, other: { at: 'x' } },
    noticeSeen: true,
    overrides: { s1: { sections: { 'prefill:persona': '你是一个角色' } } },
    sessionTools: { s1: ['read', 'write'] },
  },
  turns: { s1: 3, other: 1 },
  materialized: { s1: 2 },
  pendingReprime: ['s1'],
  running: ['s1'],
  sandboxView: { s1: { level: 'controlled', levelFrom: 'session', blocked: 2 }, other: { level: 'observe', levelFrom: 'default', blocked: 0 } },
  tools: { catalog: [], sessions: { s1: ['read', 'write', 'bash'] } },
  snapshots: { s1: { state: 'pure', turn: 3, step: 1, droppedKinds: ['tools'] } },
}

/** 订阅一个会话，返回 { emit 计数, unsubscribe }。 */
function subscribe(mod, sessionId = 's1') {
  const state = { emits: 0 }
  state.unsubscribe = mod.summarySubscribe(sessionId)(() => {
    state.emits += 1
  })
  return state
}

test('单飞：并发两次 summary 只发一个请求', async () => {
  const env = makeEnv()
  const mod = env.load()
  env.push({ ok: true, rev: 'r1', sessionId: 's1', prefill: { s1: 'p' } })
  subscribe(mod)
  await env.settle()
  assert.equal(env.requests.length, 1, '第一个订阅者立刻拉一次')
  assert.equal(env.requests[0].path, '/api/dsh-prefill/summary')
  assert.deepEqual(env.requests[0].body, { sessionId: 's1' }, '只带 sessionId（轻量请求）')
  assert.ok(env.requests[0].signal !== undefined, '必须带 AbortSignal（15s 超时）')
  env.push({ ok: true, rev: 'r2', sessionId: 's1' })
  env.push({ ok: true, rev: 'r3', sessionId: 's1' })
  const first = mod.refreshSummary('a')
  const second = mod.refreshSummary('b')
  await Promise.all([first, second])
  assert.equal(env.requests.length, 2, '并发两次只发一个请求（第二次在飞，直接返回）')
  await env.settle()
  assert.equal(env.requests.length, 2)
})

test('rev 未变：复用旧对象、不 emit；rev 变了才 emit', async () => {
  const env = makeEnv()
  const mod = env.load()
  env.push({ ok: true, rev: 'r1', sessionId: 's1', prefill: { s1: 'A' } })
  const sub = subscribe(mod)
  await env.settle()
  assert.equal(sub.emits, 1)
  const before = mod.summaryStore.data
  // 同一个 rev：服务端说状态文件没动过 ⇒ 内容就算不一样也不采纳（省一次重渲染）。
  env.push({ ok: true, rev: 'r1', sessionId: 's1', prefill: { s1: 'B' } })
  await mod.refreshSummary('same')
  assert.equal(sub.emits, 1, 'rev 相同不 emit')
  assert.equal(mod.summaryStore.data, before, '直接复用旧对象')
  assert.equal(mod.summaryStore.data.state.prefill.s1, 'A')
  // rev 变了 ⇒ 采纳并 emit
  env.push({ ok: true, rev: 'r2', sessionId: 's1', prefill: { s1: 'B' } })
  await mod.refreshSummary('changed')
  assert.equal(sub.emits, 2)
  assert.equal(mod.summaryStore.data.state.prefill.s1, 'B')
})

test('applyEnvelope：整封 envelope → 迷你 envelope（字段映射 + 只留本会话）', async () => {
  const env = makeEnv()
  const mod = env.load()
  env.push({ ok: true, rev: 'r1', sessionId: 's1' })
  const sub = subscribe(mod)
  await env.settle()
  const emitted = mod.applyEnvelope(FULL_ENVELOPE)
  assert.equal(emitted, true)
  assert.equal(sub.emits, 2)
  const data = mod.summaryStore.data
  assert.equal(data.rev, '', '写接口来的切片没有 rev（用内容指纹对账）')
  assert.equal(data.sessionId, 's1')
  // state.*：按会话的表只留本会话那格（写接口整表替换，不能把别会话的当成自己的）
  assert.deepEqual(data.state.prefill, { s1: 'p1' })
  assert.deepEqual(data.state.gate, { s1: 'pure' })
  assert.deepEqual(data.state.activePreset, { s1: 'builtin:persona' })
  assert.deepEqual(data.state.armed, ['s1'])
  assert.deepEqual(data.state.levers, FULL_ENVELOPE.state.levers)
  assert.deepEqual(data.state.ui, { motion: 'lite', experimental: true })
  // 可选扩展：锁定保持原记录（组件读 lockRec.items，不能换成条数）
  assert.equal(data.state.locked.s1.items.length, 1)
  assert.equal(data.state.locked.other, undefined)
  assert.equal(data.state.noticeSeen, true)
  // envelope 顶层
  assert.deepEqual(data.turns, { s1: 3 })
  assert.deepEqual(data.materialized, { s1: 2 })
  assert.deepEqual(data.pendingReprime, ['s1'])
  assert.deepEqual(data.running, ['s1'])
  assert.deepEqual(data.sandbox, { s1: { level: 'controlled', levelFrom: 'session', blocked: 2 } })
  assert.deepEqual(data.tools, { s1: 3 }, '工具清单 → 个数（契约是数字）')
  assert.deepEqual(data.snapshots, { s1: FULL_ENVELOPE.snapshots.s1 })
  assert.equal(data.persona, true, '人格段非空 ⇒ 布尔')
  // 同一份 envelope 再来一次：内容指纹相同 ⇒ 不 emit
  assert.equal(mod.applyEnvelope(FULL_ENVELOPE), false)
  assert.equal(sub.emits, 2)
  // 写接口来的扩展项不能被下一轮 summary 冲掉
  env.push({ ok: true, rev: 'r9', sessionId: 's1', prefill: { s1: 'p1' } })
  await mod.refreshSummary('after-write')
  assert.equal(mod.summaryStore.data.state.locked.s1.items.length, 1, 'locked 保留')
  assert.equal(mod.summaryStore.data.state.noticeSeen, true, 'noticeSeen 保留')
  assert.equal(mod.summaryStore.data.persona, true, 'persona 保留')
  assert.deepEqual(mod.summaryStore.data.snapshots.s1, FULL_ENVELOPE.snapshots.s1, 'snapshots 保留')
})

test('applyEnvelope：换会话时按会话过滤的扩展项作废（别把旧会话的快照给新会话）', async () => {
  const env = makeEnv()
  const mod = env.load()
  env.push({ ok: true, rev: 'r1', sessionId: 's1' })
  subscribe(mod)
  await env.settle()
  mod.applyEnvelope(FULL_ENVELOPE)
  assert.equal(mod.summaryStore.data.state.locked.s1.items.length, 1)
  // 服务端扁平表形态：persona 是 { 会话: true }（整封 envelope 那边是布尔），两种都归一成布尔。
  env.push({ ok: true, rev: 'r1', sessionId: 's2', persona: { s2: true }, locked: { s2: { at: 'x', items: [] } } })
  const other = subscribe(mod, 's2')
  await env.settle()
  assert.equal(other.emits, 1)
  assert.equal(mod.summaryStore.data.persona, true, 'persona 扁平表 → 布尔')
  assert.equal(mod.summaryStore.data.state.locked.s2.items.length, 0, 'locked 原记录（items 空数组也在）')
  assert.equal(mod.summaryStore.data.state.locked.s1, undefined, '换会话后不留旧会话的锁定记录')
  assert.equal(mod.summaryStore.data.snapshots.s1, undefined)
  assert.equal(mod.summaryStore.data.state.noticeSeen, true, 'noticeSeen 是全局的，留着')
})

test('applyEnvelope：没有 state、也没有 summary 的响应不碰 store（瘦身后的小接口）', async () => {
  const env = makeEnv()
  const mod = env.load()
  env.push({ ok: true, rev: 'r1', sessionId: 's1', prefill: { s1: 'p1' }, turns: { s1: 3 } })
  const sub = subscribe(mod)
  await env.settle()
  const before = mod.summaryStore.data
  assert.equal(mod.applyEnvelope({ ok: true, op: 'every-turn-status', status: { on: true } }), false)
  assert.equal(mod.summaryStore.data, before, '不能把 store 清空')
  assert.equal(sub.emits, 1)
})

test('applyEnvelope：写响应里直接带 summary（契约 §2.2 的扁平字段）优先用它', async () => {
  const env = makeEnv()
  const mod = env.load()
  env.push({ ok: true, rev: 'r1', sessionId: 's1' })
  const sub = subscribe(mod)
  await env.settle()
  const emitted = mod.applyEnvelope({
    ok: true,
    packs: [],
    summary: { ok: true, rev: 'r5', sessionId: 's1', prefill: { s1: 'p1' }, turns: { s1: 4 }, locked: { s1: { items: [{ role: 'user', text: 'x' }] } } },
  })
  assert.equal(emitted, true)
  assert.equal(sub.emits, 2)
  assert.equal(mod.summaryStore.data.rev, 'r5')
  assert.equal(mod.summaryStore.data.turns.s1, 4)
  assert.equal(mod.summaryStore.data.state.locked.s1.items.length, 1)
})

test('ok:false（state.json 坏了）= 状态不可用：保留旧数据 + 记一次失败，不冲成空状态', async () => {
  const env = makeEnv()
  const mod = env.load()
  env.push({ ok: true, rev: 'r1', sessionId: 's1', prefill: { s1: 'p1' } })
  const sub = subscribe(mod)
  await env.settle()
  const before = mod.summaryStore.data
  env.push({ ok: false, reason: 'state unreadable: boom', rev: 'r2', sessionId: 's1' })
  await mod.refreshSummary('broken')
  assert.equal(sub.emits, 1, '不 emit（旧数据继续显示）')
  assert.equal(mod.summaryStore.data, before)
  assert.equal(mod.summaryStore.failures, 1, '按失败退避，而不是当空状态接受')
  // 写响应里带 summary.ok:false 也不采纳
  assert.equal(mod.applyEnvelope({ ok: true, summary: { ok: false, sessionId: 's1' } }), false)
  assert.equal(mod.applyEnvelope({ ok: false, reason: 'boom' }), false)
  assert.equal(mod.summaryStore.data, before)
})

test('两条来源同形：整封 envelope 切出来的 == summary 路由的扁平响应（不会来回 emit）', async () => {
  const env = makeEnv()
  const mod = env.load()
  env.push({ ok: true, rev: 'r1', sessionId: 's1' })
  subscribe(mod)
  await env.settle()
  assert.equal(mod.applyEnvelope(FULL_ENVELOPE), true)
  const fromEnvelope = mod.summaryStore.data
  // 服务端 summaryOf 的响应形状（srv 的契约）：同形数据应该切出完全一样的内容指纹。
  const fromRoute = mod.normalizeSummary({
    ok: true,
    rev: 'r99',
    sessionId: 's1',
    prefill: { s1: 'p1' },
    gate: { s1: 'pure' },
    activePreset: { s1: 'builtin:persona' },
    armed: ['s1'],
    levers: FULL_ENVELOPE.state.levers,
    locked: { s1: FULL_ENVELOPE.state.locked.s1 },
    turns: { s1: 3 },
    materialized: { s1: 2 },
    pendingReprime: ['s1'],
    running: ['s1'],
    sandbox: { s1: { level: 'controlled', levelFrom: 'session', blocked: 2 } },
    tools: { s1: 3 },
    persona: { s1: true },
    snapshots: { s1: { state: 'pure', turn: 3, step: 1, droppedKinds: ['tools'] } },
    noticeSeen: true,
    ui: { experimental: true, motion: 'lite' },
  })
  assert.equal(mod.summarySignature(fromRoute), mod.summarySignature(fromEnvelope), '两种来源内容指纹一致')
})

test('applyEnvelope：写响应里的 summary 空会话 / 别的会话 ⇒ 不采纳（全局摘要的按会话格是空的）', async () => {
  const env = makeEnv()
  const mod = env.load()
  env.push({ ok: true, rev: 'r1', sessionId: 's1', prefill: { s1: 'p1' } })
  const sub = subscribe(mod)
  await env.settle()
  const before = mod.summaryStore.data
  // /state 的写请求没带 sessionId 时，服务端算的是全局摘要：prefill/gate/turns 都是空表。
  assert.equal(mod.applyEnvelope({ ok: true, state: {}, summary: { ok: true, sessionId: '', prefill: {}, gate: {}, turns: {} } }), false)
  assert.equal(mod.applyEnvelope({ ok: true, summary: { ok: true, sessionId: 's2', prefill: { s2: 'x' } } }), false)
  assert.equal(mod.summaryStore.data, before, '不能把当前会话的状态冲成空')
  assert.equal(sub.emits, 1)
})

test('后台暂停：hidden 不发请求，回前台补一次', async () => {
  const env = makeEnv()
  const mod = env.load()
  env.push({ ok: true, rev: 'r1', sessionId: 's1' })
  subscribe(mod)
  await env.settle()
  assert.equal(env.requests.length, 1)
  env.document.hidden = true
  assert.equal(await mod.refreshSummary('hidden'), null)
  assert.equal(env.requests.length, 1, '后台不发请求')
  mod.pauseSummary()
  assert.equal(mod.summaryStore.timer, null, '暂停时清定时器')
  env.document.hidden = false
  env.push({ ok: true, rev: 'r2', sessionId: 's1' })
  mod.resumeSummary()
  await env.settle()
  assert.equal(env.requests.length, 2, '回前台立刻补一次')
  assert.ok(mod.summaryStore.timer !== null, '恢复轮询')
})

test('无订阅者：定时器清掉，tick 也不再发请求', async () => {
  const env = makeEnv()
  const mod = env.load()
  env.push({ ok: true, rev: 'r1', sessionId: 's1' })
  const sub = subscribe(mod)
  await env.settle()
  assert.ok(mod.summaryStore.timer !== null)
  sub.unsubscribe()
  assert.equal(mod.summaryStore.listeners.size, 0)
  assert.equal(mod.summaryStore.timer, null, '没有订阅者 ⇒ 清定时器')
  const before = env.requests.length
  env.tickAll()
  await env.settle()
  assert.equal(env.requests.length, before, '没有订阅者 ⇒ 不请求')
})

test('失败退避 2.5→5→10→20→30s，成功后清零', async () => {
  const env = makeEnv()
  const mod = env.load()
  env.push({ ok: true, rev: 'r1', sessionId: 's1' })
  subscribe(mod)
  await env.settle()
  assert.equal(mod.summaryStore.failures, 0)
  const expected = [2500, 5000, 10000, 20000, 30000, 30000]
  for (const delay of expected) {
    env.failNext(1)
    await mod.refreshSummary('fail')
    assert.ok(mod.summaryStore.failures > 0)
    assert.equal(mod.summaryDelay(), delay, `第 ${mod.summaryStore.failures} 次失败退避 ${delay}`)
    assert.deepEqual(env.delays(), [delay], '下一次轮询按退避排期')
  }
  env.push({ ok: true, rev: 'r2', sessionId: 's1' })
  await mod.refreshSummary('ok')
  assert.equal(mod.summaryStore.failures, 0, '成功一次清零')
  assert.equal(mod.summaryDelay(), 5000, '卡片关着 = 5s')
})

test('卡片开合：开 3s / 关 5s；打开时立刻补一次', async () => {
  const env = makeEnv()
  const mod = env.load()
  env.push({ ok: true, rev: 'r1', sessionId: 's1' })
  subscribe(mod)
  await env.settle()
  assert.deepEqual(env.delays(), [5000], '默认（卡片关着）5s')
  env.push({ ok: true, rev: 'r2', sessionId: 's1' })
  mod.setSummaryCardOpen(true)
  await env.settle()
  assert.equal(env.requests.length, 2, '打开卡片立刻补一次')
  assert.deepEqual(env.delays(), [3000], '开着 3s')
  mod.setSummaryCardOpen(false)
  assert.deepEqual(env.delays(), [5000], '关着 5s')
})

test('useSummary：先给 null，数据到了重渲染能拿到；卸载后停止轮询（React 无 useSyncExternalStore 的垫片）', async () => {
  const env = makeEnv()
  const mod = env.load()
  env.push({ ok: true, rev: 'r1', sessionId: 's1', prefill: { s1: 'P' } })
  const react = makeReact()
  // 用带假 React 的 load 覆盖：这里重新造一个不挂 useSyncExternalStore 的 React 环境。
  const make = new Function(
    'React',
    'fetch',
    'window',
    'document',
    'setTimeout',
    'clearTimeout',
    'AbortSignal',
    'STATE_EVENT',
    `${storeSrc}\nreturn { summaryStore, useSummary }`,
  )
  const fakeFetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, rev: 'r1', sessionId: 's1', prefill: { s1: 'P' } }) })
  const fakeWindow = { addEventListener() {}, removeEventListener() {} }
  const fakeDocument = { hidden: false, addEventListener() {} }
  const fakeTimers = { setTimeout: () => 1, clearTimeout: () => {} }
  const wrapped = make(
    react.React,
    fakeFetch,
    fakeWindow,
    fakeDocument,
    fakeTimers.setTimeout,
    fakeTimers.clearTimeout,
    { timeout: () => ({}) },
    STATE_EVENT,
  )
  react.rewind()
  const first = wrapped.useSummary('s1')
  assert.equal(first, null, '第一次渲染还没有数据')
  await env.settle()
  await env.settle()
  assert.equal(react.slots[0]?.rev, 'r1', 'setValue 把新数据写进槽位（重渲染拿到的就是它）')
  assert.equal(wrapped.summaryStore.listeners.size, 1)
  react.unmount()
  assert.equal(wrapped.summaryStore.listeners.size, 0, '卸载后取消订阅')
})
