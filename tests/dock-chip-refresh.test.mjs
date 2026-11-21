// 卡片（PrefillDock）关着时，芯片的「预设名 + 已配置 N/8」仍来自卡片的 envelope（chipSummary）。
// 0.21 起卡片关着不再轮询 /state ⇒ 别处换了预设，芯片停在关卡片那一刻。整模块真渲染（tests/client-render-harness.mjs）。
import assert from 'node:assert/strict'
import test from 'node:test'
import { loadClient, findAll, textOf } from './client-render-harness.mjs'

function setup() {
  const state = { prefill: { s1: 'default' }, gate: {}, everyTurn: {}, activePreset: { s1: 'pack:旧预设' }, ui: {} }
  const env = loadClient({
    routes: {
      '/api/dsh-prefill/summary': (body) => ({ ok: true, rev: String(Math.random()), sessionId: body.sessionId, prefill: { s1: 'default' }, activePreset: { s1: state.activePreset.s1 } }),
      '/api/dsh-prefill/state': () => ({ ok: true, state, turns: {}, materialized: {} }),
      '/api/dsh-prefill/draft': () => ({ ok: true, draft: [] }),
      '/api/dsh-prefill/packs': () => ({ ok: true, packs: [{ name: '旧预设' }, { name: '新预设' }] }),
    },
  })
  const h = env.React.createElement
  const el = () => h('div', null, h(env.components.PrefillToggle, { sessionId: 's1' }), h(env.components.PrefillDock, { sessionId: 's1' }))
  let tree = env.renderer.render(el())
  const pump = async (n) => {
    for (let i = 0; i < n; i += 1) {
      await env.settle()
      tree = env.renderer.render(el())
    }
  }
  const chip = () => findAll(tree, (p) => p['data-prefill-chip'] === '1')[0]
  const stateReads = () => env.fetches.filter((f) => f.path === '/api/dsh-prefill/state').length
  return { env, state, pump, chip, stateReads }
}

test('卡片关着时本会话预设在别处被换掉 ⇒ 芯片上的预设名跟上新预设', async () => {
  const t = setup()
  await t.pump(1)
  t.chip().props.onClick() // 打开卡片
  await t.pump(4)
  assert.match(textOf(t.chip()), /旧预设/)
  t.chip().props.onClick() // 关卡片
  await t.pump(2)
  // 别处把本会话换成「新预设」，并广播了状态事件
  t.state.activePreset = { s1: 'pack:新预设' }
  t.env.dispatch('dsh-prefill:state-changed')
  await t.env.advance(12000)
  await t.pump(5)
  assert.ok(t.env.fetches.filter((f) => f.path === '/api/dsh-prefill/summary').length > 2, 'summary 轮询照常在跑')
  assert.match(textOf(t.chip()), /新预设/, '芯片应跟上 summary 里已经变了的预设')
})

test('卡片关着、摘要没变化 ⇒ 不定时拉整封 /state', async () => {
  const t = setup()
  await t.pump(1)
  t.chip().props.onClick()
  await t.pump(4)
  t.chip().props.onClick()
  await t.pump(2)
  const before = t.stateReads()
  await t.env.advance(30000)
  await t.pump(2)
  assert.equal(t.stateReads() - before, 0, '卡片关着只在摘要变化时补拉，不轮询')
})

test('页面加载后从没打开过卡片 ⇒ 摘要变化也不拉整封 /state', async () => {
  const t = setup()
  await t.pump(2)
  const before = t.stateReads()
  t.state.activePreset = { s1: 'pack:新预设' }
  t.env.dispatch('dsh-prefill:state-changed')
  await t.env.advance(12000)
  await t.pump(3)
  assert.equal(t.stateReads() - before, 0)
})
