// 回归（v0.21.14 审查 #84）：换轮重挂时，本轮的判定必须和挂载用同一份 lever。
// 以前判定仍取「重挂前抓到的 entry.frozenLevers」⇒ 第一个座位挂新 lever、判旧 lever，
// 同一轮 root / agent 两个座位判定相反，开 / 关闸各有一个方向晚一轮。
import test from 'node:test'
import assert from 'node:assert/strict'
import { step } from '../gate.js'

const off = { probeSection: false, probeContext: false, blockSections: false, blockContexts: false, blockTools: false, blockMessages: false }
const mkState = (levers) => ({ armed: ['s1'], levers, gate: {}, enabled: {}, sandbox: {}, overrides: {}, everyTurn: {}, tools: [] })

const run = async (api, agent, turn, seat) => {
  const out = await step(api, { agent, turn, step: 1, __seat: seat }, {
    kind: 'enter',
    messages: [{ id: 1, source: { kind: 'runtime-context' }, content: [{ type: 'text', text: 'ctx' }] }],
  })
  return (out.messages?.length ?? 0) === 1 ? 'kept' : 'dropped'
}

test('第 2 轮打开 blockMessages：root / agent 两个座位都按新 lever 拦（不再一旧一新）', async () => {
  let state = mkState({ ...off })
  const latches = new Map()
  const api = {
    readState: () => state,
    note: () => {},
    latches,
    unlatch: (id) => {
      const entry = latches.get(id)
      if (entry === undefined) return
      for (const dispose of entry.disposers) {
        try {
          dispose()
        } catch {
          // 忽略。
        }
      }
      latches.delete(id)
    },
    rootCtx: undefined,
  }
  const agent = { id: 's1', session: {} }
  assert.equal(await run(api, agent, 1, 'root'), 'kept', '第 1 轮不该拦')
  state = mkState({ ...off, blockMessages: true })
  assert.equal(await run(api, agent, 2, 'root'), 'dropped', '第 2 轮 root 座位必须按新 lever 拦')
  assert.equal(await run(api, agent, 2, 'agent'), 'dropped', '第 2 轮 agent 座位必须按新 lever 拦（两个座位要一致）')
  state = mkState({ ...off })
  assert.equal(await run(api, agent, 3, 'root'), 'kept', '第 3 轮关掉后 root 座位必须放行')
  assert.equal(await run(api, agent, 3, 'agent'), 'kept', '第 3 轮关掉后 agent 座位必须放行（两个座位要一致）')
})
