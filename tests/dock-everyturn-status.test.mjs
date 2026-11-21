// 卡片（PrefillDock）的 every-turn-status：它的 `lock` 是「本版之前开跑、没有 state.locked 的旧会话」认首轮锁定的唯一来源
// （lockView 第二档），不只给每轮注入用。整模块真渲染（tests/client-render-harness.mjs）。
import assert from 'node:assert/strict'
import test from 'node:test'
import { loadClient, findAll } from './client-render-harness.mjs'

function setup({ everyTurnOff = [], lockedBy = {} } = {}) {
  const state = {
    prefill: { A: 'default', B: 'default' },
    gate: {},
    everyTurn: {},
    enabled: Object.fromEntries(everyTurnOff.map((id) => [id, { everyTurn: false }])),
    ui: {},
  }
  const env = loadClient({
    routes: {
      '/api/dsh-prefill/summary': (body) => ({ ok: true, rev: '1', sessionId: body.sessionId, prefill: { [body.sessionId]: 'default' } }),
      '/api/dsh-prefill/state': () => ({ ok: true, state, turns: {}, materialized: {} }),
      '/api/dsh-prefill/draft': () => ({ ok: true, draft: [] }),
      // gate.everyTurnStatus：每轮注入关着也回 { enabled:false, lock }（lock 从会话日志认）
      '/api/dsh-prefill/packs': (body) =>
        body?.op === 'every-turn-status'
          ? { ok: true, op: body.op, status: { enabled: false, lock: lockedBy[body.sessionId] ?? { locked: false } } }
          : { ok: true, packs: [] },
    },
  })
  const h = env.React.createElement
  const el = (sid) => h('div', null, h(env.components.PrefillToggle, { sessionId: sid }), h(env.components.PrefillDock, { sessionId: sid }))
  const render = (sid) => env.renderer.render(el(sid))
  const open = async (sid) => {
    let tree = render(sid)
    await env.settle()
    tree = render(sid)
    findAll(tree, (p) => p['data-prefill-chip'] === '1')[0].props.onClick()
    for (let i = 0; i < 4; i += 1) {
      await env.settle()
      tree = render(sid)
    }
    return tree
  }
  const lockBadge = (tree) => findAll(tree, (p) => p['data-prefill-lock-badge'] !== undefined)[0]?.props['data-prefill-lock-badge']
  const statusReads = () => env.fetches.filter((f) => f.path === '/api/dsh-prefill/packs' && f.body?.op === 'every-turn-status').length
  return { env, render, open, lockBadge, statusReads }
}

test('旧会话（无 state.locked）已开跑、每轮注入开关关着 ⇒ 打开卡片仍拉 every-turn-status，认出首轮锁定', async () => {
  const t = setup({ everyTurnOff: ['B'], lockedBy: { B: { locked: true, turn: 3 } } })
  const tree = await t.open('B')
  assert.equal(t.lockBadge(tree), 'locked', '服务端 every-turn-status 说已锁定，卡片应显示「已锁定」')
})

test('每轮注入关着时只在打开卡片时拉一次，不按 15s 轮询', async () => {
  const t = setup({ everyTurnOff: ['B'], lockedBy: { B: { locked: true, turn: 3 } } })
  await t.open('B')
  const before = t.statusReads()
  await t.env.advance(60000)
  assert.equal(t.statusReads() - before, 0)
})

test('A（已锁定）切到 B（每轮注入关、无锁定依据）⇒ B 不沿用 A 的 every-turn-status', async () => {
  const t = setup({ everyTurnOff: ['B'], lockedBy: { A: { locked: true, turn: 5 } } })
  let tree = await t.open('A')
  assert.equal(t.lockBadge(tree), 'locked', 'A 本身确实已锁定')
  // 同一个 Dock 实例换 sessionId（宿主切会话）
  tree = await t.open('B')
  assert.equal(t.lockBadge(tree), 'open', 'B 不该显示 A 的「已锁定」')
})
