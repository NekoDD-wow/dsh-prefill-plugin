// 卡片（PrefillDock）开着时的 /state（整封 ~1MB）与 /usage 轮询，在页面切到后台时应与 summary store 一样暂停。
// 整模块真渲染（tests/client-render-harness.mjs）。
import assert from 'node:assert/strict'
import test from 'node:test'
import { loadClient, findAll } from './client-render-harness.mjs'

function setup() {
  const state = { prefill: { s1: 'default' }, gate: {}, everyTurn: {}, ui: {} }
  const env = loadClient({
    routes: {
      '/api/dsh-prefill/summary': (body) => ({ ok: true, rev: '1', sessionId: body.sessionId, prefill: { s1: 'default' } }),
      '/api/dsh-prefill/state': () => ({ ok: true, state, turns: {}, materialized: {} }),
      '/api/dsh-prefill/draft': () => ({ ok: true, draft: [] }),
      '/api/dsh-prefill/packs': () => ({ ok: true, packs: [], status: { enabled: false } }),
      '/api/dsh-prefill/usage': () => ({ ok: true }),
    },
  })
  const h = env.React.createElement
  const el = () => h('div', null, h(env.components.PrefillToggle, { sessionId: 's1' }), h(env.components.PrefillDock, { sessionId: 's1' }))
  const setHidden = (hidden) => {
    env.document.hidden = hidden
    for (const fn of env.document.listeners.get('visibilitychange') ?? []) fn()
  }
  const openCard = async () => {
    let tree = env.renderer.render(el())
    await env.settle()
    tree = env.renderer.render(el())
    findAll(tree, (p) => p['data-prefill-chip'] === '1')[0].props.onClick()
    for (let i = 0; i < 4; i += 1) {
      await env.settle()
      tree = env.renderer.render(el())
    }
  }
  const countSince = (from, path) => env.fetches.slice(from).filter((f) => f.path === path).length
  return { env, setHidden, openCard, countSince }
}

test('卡片开着、页面切到后台 ⇒ /state 整封与 /usage 轮询暂停（与 summary 一致）', async () => {
  const t = setup()
  await t.openCard()
  t.setHidden(true)
  const before = t.env.fetches.length
  await t.env.advance(30000)
  assert.equal(t.countSince(before, '/api/dsh-prefill/summary'), 0, 'summary 已暂停')
  assert.equal(t.countSince(before, '/api/dsh-prefill/state'), 0, '后台 30s 内不拉整封 /state')
  assert.equal(t.countSince(before, '/api/dsh-prefill/usage'), 0, '后台 30s 内不拉 /usage')
})

test('回到前台 ⇒ 卡片的 /state 轮询恢复', async () => {
  const t = setup()
  await t.openCard()
  t.setHidden(true)
  await t.env.advance(30000)
  t.setHidden(false)
  const before = t.env.fetches.length
  await t.env.advance(12000)
  assert.ok(t.countSince(before, '/api/dsh-prefill/state') > 0, '回前台后 /state 照常拉')
})
