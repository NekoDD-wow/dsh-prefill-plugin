// 顶栏徽标 SessionModeBadge 与芯片 / 卡片同口径：整模块真渲染（tests/client-render-harness.mjs）。
import assert from 'node:assert/strict'
import test from 'node:test'
import { loadClient, textOf } from './client-render-harness.mjs'

async function renderAll(summary) {
  const env = loadClient({ routes: { '/api/dsh-prefill/summary': (body) => ({ ok: true, rev: '1', sessionId: body.sessionId, ...summary }) } })
  const { SessionModeBadge, PrefillToggle } = env.components
  const h = env.React.createElement
  const el = () => h('div', null, h(SessionModeBadge, { sessionId: 's1' }), h('hr'), h(PrefillToggle, { sessionId: 's1' }))
  env.renderer.render(el())
  await env.settle()
  const tree = env.renderer.render(el())
  const [badge, , chip] = tree.children
  return { badge: textOf(badge), chip: textOf(chip) }
}

test('DSH 重启后（turns / materialized 归零）有首轮锁定记录的会话：徽标与芯片一样认作已开跑，不写「写入历史」', async () => {
  // turns / materialized 来自 gate 内存快照（重启清零）；locked 来自 state.json（落盘、重启不丢）
  const { badge, chip } = await renderAll({ prefill: { s1: 'default' }, gate: {}, turns: {}, materialized: {}, locked: { s1: { turn: 1, at: 'x', items: [{ role: 'user', text: '开局' }] } } })
  assert.match(chip, /prefillWritten/, '芯片：已开跑 + 已写入（用了 state.locked）')
  assert.doesNotMatch(badge, /modeHistory/, '有首轮锁定记录 = 已开跑，不该再显示「写入历史」')
  assert.match(badge, /itemsAfterRun/)
})

test('没有轮次、没有写入、也没有锁定记录：徽标仍写「写入历史」（未开跑）', async () => {
  const { badge } = await renderAll({ prefill: { s1: 'default' }, gate: {}, turns: {}, materialized: {}, locked: {} })
  assert.match(badge, /modeHistory/)
})

test('系统提示「替换」模式（gate=replace + 人格段）：徽标写「系统提示·替换」，不是「追加」', async () => {
  const { badge } = await renderAll({ prefill: { s1: 'default' }, gate: { s1: 'replace' }, persona: { s1: true }, turns: { s1: 2 } })
  assert.doesNotMatch(badge, /systemAppendMeta/, 'replace 是「替换系统提示」，不是「追加」')
  assert.match(badge, /systemTitle·systemReplaceMeta/)
})

test('追加模式（gate=pass + 人格段）与接管（gate=pure + 人格段）徽标不变', async () => {
  const append = await renderAll({ prefill: { s1: 'default' }, gate: { s1: 'pass' }, persona: { s1: true }, turns: { s1: 2 } })
  assert.match(append.badge, /systemTitle·systemAppendMeta/)
  const takeover = await renderAll({ prefill: { s1: 'default' }, gate: { s1: 'pure' }, persona: { s1: true }, turns: { s1: 2 } })
  assert.match(takeover.badge, /chipTakeover/)
})
