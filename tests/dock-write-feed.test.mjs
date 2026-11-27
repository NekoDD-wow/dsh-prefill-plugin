// 0.21「写响应直接喂 store，免二次拉取」对卡片（PrefillDock）的 /state 读写要生效：卡片的请求不带 sessionId ⇒
// 服务端附的是全局摘要（summary.sessionId === ''）。卡片手里是整封 envelope，应按本会话切一刀喂进 store，
// 而不是连同整封 state 一起被拒收（否则输入框旁的芯片、顶栏徽标只能等 STATE_EVENT 触发的那次 summary）。
// 整模块真渲染：summary 路由首包之后挂起不回，只看卡片的 envelope 能不能喂进 store。
import assert from 'node:assert/strict'
import test from 'node:test'
import { loadClient, findAll } from './client-render-harness.mjs'

test('卡片 /state 拿到的整封 envelope（附全局摘要）也能喂进 summary store ⇒ 纯净芯片跟着变', async () => {
  const state = { prefill: { s1: 'default' }, gate: {}, everyTurn: {}, ui: {} }
  let summaryCalls = 0
  const env = loadClient({
    routes: {
      '/api/dsh-prefill/summary': (body) => (++summaryCalls === 1 ? { ok: true, rev: '1', sessionId: body.sessionId, prefill: { s1: 'default' }, gate: {} } : { $defer: true }),
      // 真服务端：/state 永远附 summary = summaryOf(请求体 sessionId)；卡片不带 ⇒ 全局摘要
      '/api/dsh-prefill/state': () => ({ ok: true, state, turns: {}, materialized: {}, summary: { ok: true, rev: '2', sessionId: '', prefill: {}, gate: {} } }),
      '/api/dsh-prefill/draft': () => ({ ok: true, draft: [] }),
      '/api/dsh-prefill/packs': () => ({ ok: true, packs: [], status: { enabled: false } }),
    },
  })
  const h = env.React.createElement
  const el = () => h('div', null, h(env.components.PrefillToggle, { sessionId: 's1' }), h(env.components.GateToggle, { sessionId: 's1' }), h(env.components.PrefillDock, { sessionId: 's1' }))
  let tree = env.renderer.render(el())
  await env.settle()
  tree = env.renderer.render(el())
  findAll(tree, (p) => p['data-prefill-chip'] === '1')[0].props.onClick()
  for (let i = 0; i < 3; i += 1) { await env.settle(); tree = env.renderer.render(el()) }
  // 别处（例如卡片「系统提示 → 纯净」）写成了 pure；卡片下一次 /state 拿到的整封 state 已经是新值
  state.gate = { s1: 'pure' }
  await env.advance(5000)
  for (let i = 0; i < 3; i += 1) { await env.settle(); tree = env.renderer.render(el()) }
  const gatePill = findAll(tree, (p) => p['aria-pressed'] !== undefined && p['data-prefill-chip'] === undefined && p.title !== undefined && /gateTitle/.test(p.title))[0]
  assert.ok(gatePill, '找到纯净芯片')
  assert.equal(gatePill.props['aria-pressed'], 'true', '卡片手里的整封 state 已是 pure，应能喂进 store（或卡片的 /state 请求带上 sessionId）')
})

test('卡片 /state 轮询在飞时点了「纯净」：写响应先进 store，晚回来的旧整封 state 不许把芯片冲回「关」', async () => {
  let state = { prefill: { s1: 'default' }, gate: {}, everyTurn: {}, ui: {}, noticeSeen: true }
  const summaryOf = (sid) => ({ ok: true, rev: String(Math.random()), sessionId: sid, prefill: { ...state.prefill }, gate: { ...state.gate }, noticeSeen: true })
  let deferNextRead = false
  let summaryCalls = 0
  const env = loadClient({
    routes: {
      // summary 首包之后挂起：只看卡片 envelope 与写响应谁说了算
      '/api/dsh-prefill/summary': (body) => (++summaryCalls === 1 ? summaryOf(body.sessionId) : { $defer: true }),
      '/api/dsh-prefill/state': (body) => {
        const isRead = body === undefined || body === null || Object.keys(body).every((k) => k === 'slim' || k === 'sessionId')
        if (isRead) {
          if (deferNextRead) {
            deferNextRead = false
            return { $defer: true, stale: JSON.parse(JSON.stringify(state)) }
          }
          return { ok: true, state, turns: {}, materialized: {}, summary: { ...summaryOf(''), prefill: {}, gate: {} } }
        }
        const { sessionId, ...patch } = body
        state = { ...state, ...patch }
        return { ok: true, state, turns: {}, materialized: {}, summary: summaryOf(sessionId ?? '') }
      },
      '/api/dsh-prefill/draft': () => ({ ok: true, draft: [] }),
      '/api/dsh-prefill/packs': () => ({ ok: true, packs: [], status: { enabled: false } }),
    },
  })
  const h = env.React.createElement
  const el = () => h('div', null, h(env.components.PrefillToggle, { sessionId: 's1' }), h(env.components.GateToggle, { sessionId: 's1' }), h(env.components.PrefillDock, { sessionId: 's1' }))
  const pump = async () => { for (let i = 0; i < 3; i += 1) { await env.settle(); tree = env.renderer.render(el()) } }
  let tree = env.renderer.render(el())
  await pump()
  findAll(tree, (p) => p['data-prefill-chip'] === '1')[0].props.onClick() // 打开卡片
  await pump()
  const gatePill = () => findAll(tree, (p) => p['aria-pressed'] !== undefined && p['data-prefill-chip'] === undefined && p.title !== undefined && /gateTitle/.test(p.title))[0]
  assert.equal(gatePill().props['aria-pressed'], 'false')
  // 卡片 5s 轮询发出，读到的是写入之前的 state（gate 空），先挂着
  deferNextRead = true
  await env.advance(5000)
  const staleRead = env.pending.find((p) => p.stale !== undefined)
  assert.ok(staleRead, '卡片轮询在飞')
  // 用户点「纯净」：写响应（带本会话 summary）进 store
  gatePill().props.onClick()
  await pump()
  assert.equal(gatePill().props['aria-pressed'], 'true', '写响应已采纳')
  // 旧整封 state 这才回来
  staleRead.resolve({ ok: true, state: staleRead.stale, turns: {}, materialized: {}, summary: { ok: true, rev: 'old', sessionId: '', prefill: {}, gate: {} } })
  await pump()
  assert.equal(gatePill().props['aria-pressed'], 'true', '写入之前发出的卡片轮询不应把芯片冲回「关」（再点一次就成了反向操作）')
})
