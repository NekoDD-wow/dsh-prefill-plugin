// 实验功能没开（默认用户）时，pre-step 不该记「前缀轮」：既不追加 prefix-log.jsonl，也不累计 turns.total。
// 之前 recordPrefixTurn 没有任何开关判断 ⇒ 每个会话每一轮都往数据目录写一行（enabled:false），
// 之后打开总开关，面板「前缀轮」把这些非前缀轮也算进去。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mount } from './impl-mount-harness.mjs'

const h = await mount({ state: { prefill: {} }, tag: 'prefix-log-off' }) // 从没开过实验
const LOG = join(h.DATA_DIR, 'prefix-log.jsonl')
const lines = () => (existsSync(LOG) ? readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean) : [])

test('实验功能没开：普通会话发话不写 prefix-log.jsonl、不计入「前缀轮」', async () => {
  for (let turn = 1; turn <= 3; turn += 1) await h.preStep('sess-plain', turn, 1)
  const written = lines()
  await h.post('/api/dsh-prefill/experimental/toggle', { on: true })
  const status = await h.post('/api/dsh-prefill/experimental/status', { sessionId: 'sess-plain' })
  assert.deepEqual(
    { lines: written.length, turnsTotal: status.turns.total },
    { lines: 0, turnsTotal: 0 },
    `实验未开时写了 ${written.length} 行（首行 ${written[0]}），前缀轮 total=${status.turns.total}`,
  )
})

test('总开关打开后照常记录（回归：开关判断不能把正常记录也挡掉）', async () => {
  await h.post('/api/dsh-prefill/experimental/toggle', { on: true })
  const before = lines().length
  const totalBefore = (await h.post('/api/dsh-prefill/experimental/status', { sessionId: 'sess-lab' })).turns.total
  // 思考前缀本身没启用也要记（面板逐轮微调用，enabled:false 如实标出）。
  await h.preStep('sess-lab', 1, 1)
  await h.preStep('sess-lab', 1, 2) // 非第一步不记
  const written = lines()
  assert.equal(written.length - before, 1, '打开总开关后每轮第一步应记一行')
  assert.equal(JSON.parse(written.at(-1)).sessionId, 'sess-lab')
  const status = await h.post('/api/dsh-prefill/experimental/status', { sessionId: 'sess-lab' })
  assert.equal(status.turns.total - totalBefore, 1)
})
