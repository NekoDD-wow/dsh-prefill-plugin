// summaryStore 的新旧次序：单飞轮询 + 写响应直喂 store 之间的竞态。照 tests/summary-store.test.mjs 切 <summary-store> 段，
// 但 fetch 可以「挂起、稍后手动回包」，用来钉住：
//   · 写入之前发出的 summary 轮询晚于写响应回来，不许把写响应冲掉（芯片 / 纯净开关闪回旧状态）；
//   · 轮询在飞时广播的 STATE_EVENT 不许被单飞吞掉，回来后要补拉一次；
//   · 卡片的后台 /state 读（写入之前发出）同样不许冲掉写响应。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const storeSrc = src.slice(src.indexOf('    // <summary-store>'), src.indexOf('    // </summary-store>'))
const STATE_EVENT = 'dsh-prefill:state-changed'

function makeEnv() {
  const timers = new Map()
  let seq = 0
  const requests = []
  const winListeners = []
  const fetch = (path, init) =>
    new Promise((resolve) => {
      requests.push({ path, body: JSON.parse(init.body), reply: (value) => resolve({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(value)) }) })
    })
  const window = { addEventListener: (type, fn) => winListeners.push({ type, fn }), removeEventListener() {} }
  const document = { hidden: false, addEventListener() {} }
  const React = { useState: (v) => [v, () => {}], useEffect() {}, useCallback: (fn) => fn }
  const mod = new Function(
    'React', 'fetch', 'window', 'document', 'setTimeout', 'clearTimeout', 'AbortSignal', 'STATE_EVENT',
    `${storeSrc}\nreturn { summaryStore, summarySubscribe, refreshSummary, applyEnvelope }`,
  )(React, fetch, window, document, (fn, d) => (timers.set(++seq, { fn, d }), seq), (id) => timers.delete(id), { timeout: () => ({}) }, STATE_EVENT)
  const settle = () => new Promise((r) => setTimeout(r, 0))
  return { mod, requests, timers, winListeners, settle }
}

test('写入之前发出的 summary 轮询晚于写响应回来 ⇒ 丢弃并补拉一次，不把刚写入的状态冲回去', async () => {
  const env = makeEnv()
  const { mod } = env
  mod.summarySubscribe('s1')(() => {})
  // 首次拉取：闸门没开
  env.requests[0].reply({ ok: true, rev: 'r1', sessionId: 's1', gate: {} })
  await env.settle()
  assert.equal(mod.summaryStore.data.state.gate.s1, undefined)
  // 轮询发出（读到的是写入之前的 state）……
  void mod.refreshSummary('poll')
  assert.equal(env.requests.length, 2)
  // ……与此同时用户点了「纯净」：GateToggle 写 /state（带 sessionId），写响应里的 summary 直接喂 store
  assert.equal(mod.applyEnvelope({ ok: true, state: {}, summary: { ok: true, rev: 'r2', sessionId: 's1', gate: { s1: 'pure' } } }), true)
  assert.equal(mod.summaryStore.data.state.gate.s1, 'pure', '写响应已采纳')
  // 旧轮询这时才回来（写入前读的，gate 还是空）
  env.requests[1].reply({ ok: true, rev: 'r1', sessionId: 's1', gate: {} })
  await env.settle()
  assert.equal(mod.summaryStore.data.state.gate.s1, 'pure', '旧轮询（写入前发出）不应把刚写入的状态冲回去')
  // 丢弃之后立即补拉一次（不等下一轮 3–5s），补拉回来的是写入之后的状态
  assert.equal(env.requests.length, 3, '丢弃旧轮询后应立即补拉')
  env.requests[2].reply({ ok: true, rev: 'r2', sessionId: 's1', gate: { s1: 'pure' } })
  await env.settle()
  assert.equal(mod.summaryStore.data.state.gate.s1, 'pure')
})

test('轮询在飞时广播的 STATE_EVENT 不被单飞吞掉：回来后立即补拉一次', async () => {
  const env = makeEnv()
  const { mod } = env
  mod.summarySubscribe('s1')(() => {})
  env.requests[0].reply({ ok: true, rev: 'r1', sessionId: 's1', prefill: {} })
  await env.settle()
  void mod.refreshSummary('poll') // 在飞
  // 卡片里的写入（不带 sessionId ⇒ 写响应不进 store）完成后 notifyStateChanged()
  for (const { type, fn } of env.winListeners) if (type === STATE_EVENT) fn()
  assert.equal(env.requests.length, 2, '在飞时不叠请求（单飞，符合预期）')
  // 在飞那次是写入前发出的，回来的是旧数据
  env.requests[1].reply({ ok: true, rev: 'r1', sessionId: 's1', prefill: {} })
  await env.settle()
  // 期望：被吞掉的 state-event 在本次回来后补一次（像换会话时的 restart 那样）；实际：只排了下一轮 5s 轮询
  assert.equal(env.requests.length, 3, 'STATE_EVENT 在飞期间到达 ⇒ 回来后应立即补拉一次，而不是等下一轮（3–5s，退避时最长 30s）')
})

test('卡片的后台 /state 读（写入之前发出）晚于写响应回来 ⇒ 不喂 store；没有写入插队时照常喂，且读本身不加写代号', async () => {
  const env = makeEnv()
  const { mod } = env
  mod.summarySubscribe('s1')(() => {})
  env.requests[0].reply({ ok: true, rev: 'r1', sessionId: 's1', gate: {} })
  await env.settle()
  // 卡片发出 /state 轮询（记下当时的写代号）……
  const staleGen = mod.summaryStore.writeGen
  // ……期间用户点了「纯净」，写响应进 store
  assert.equal(mod.applyEnvelope({ ok: true, state: {}, summary: { ok: true, rev: 'r2', sessionId: 's1', gate: { s1: 'pure' } } }), true)
  // 旧的整封 state 这时才回来（gate 还是空）
  assert.equal(mod.applyEnvelope({ ok: true, state: { gate: {} } }, staleGen), false)
  assert.equal(mod.summaryStore.data.state.gate.s1, 'pure', '写入之前读的整封 state 不应冲掉写响应')
  // 没有写入插队的后台读：照常采纳，且不推进写代号（否则会让在飞的 summary 轮询白白作废）
  const gen = mod.summaryStore.writeGen
  assert.equal(mod.applyEnvelope({ ok: true, state: { gate: { s1: 'replace' } } }, gen), true)
  assert.equal(mod.summaryStore.data.state.gate.s1, 'replace')
  assert.equal(mod.summaryStore.writeGen, gen)
})
