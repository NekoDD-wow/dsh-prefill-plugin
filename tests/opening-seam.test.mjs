// 接缝轮：物化开场历史时写的 system 是 agent/created 那刻渲染的，第一条真实消息那一步要对齐成本步渲染结果，
// 免得 DSH 在本轮末尾再追加一整份系统提示（排在接缝提醒之后，之后每轮历史里都带两份）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { alignOnRequest, alignSyntheticSystemPrompt, writeSyntheticTurns } from '../gate.js'
import { splitTurns } from '../inject-auto.js'

const textOf = (event) => (event.data.message ?? event.data).content.find((block) => block.type === 'text')?.text

/** 带 surface 的假会话：append 记事件、replace 原地替换节点（与 dsh-session 的语义一致到这里够用）。 */
function surfaceSession() {
  const log = []
  const nodes = []
  return {
    log,
    surface: { nodes },
    get seq() {
      return log.length
    },
    eventAt: (seq) => log[seq],
    snapshotEvents: () => log.slice(),
    append(type, data, intent) {
      const seq = log.length
      log.push({ seq, type, data, intent })
      const op = intent?.surfaceOp
      if (op === 'append') nodes.push(seq)
      else if (op?.op === 'replace') {
        const at = nodes.indexOf(op.startSeq)
        if (at >= 0) nodes[at] = seq
      }
    },
  }
}

const OPENING = [
  { role: 'user', text: 'Explain why the sky is blue.' },
  { role: 'assistant', text: 'Rayleigh scattering.' },
  { role: 'user', text: 'TCP vs UDP?' },
  { role: 'assistant', text: 'Reliable vs fast.' },
]
const api = { note() {} }

/** 物化好的开场 + 一个开着的真实轮（turn 3, step 1）。 */
function seamSession(headText = 'OLD SYS') {
  const session = surfaceSession()
  writeSyntheticTurns(api, { id: 'agent-align' }, session, headText, OPENING)
  session.append('turn/start', { turn: 3 })
  session.append('step/start', { turn: 3, step: 1 })
  return session
}
const agentWith = (session, text) => ({
  id: 'agent-align',
  session,
  ctx: { get: (name) => (name === 'systemPrompt' ? { assemble: async () => ({ sections: [{ name: 'a', text }], variables: {} }) } : undefined) },
})
const systemTexts = (session) => session.surface.nodes.map((seq) => session.eventAt(seq)).filter((e) => e.type === 'system/message').map(textOf)

test('对齐：第一条真实消息那一步，开场写的 system 和本步渲染不一致 ⇒ 原地替换，带当前轮 / 步', async () => {
  const session = seamSession('OLD SYS')
  const result = await alignSyntheticSystemPrompt(agentWith(session, 'NEW SYS'), splitTurns(session.log), { turn: 3, step: 1 })
  assert.deepEqual(result, { ok: true, changed: true, from: 7, to: 7 })
  assert.deepEqual(systemTexts(session), ['NEW SYS'])
  const replaced = session.log.at(-1)
  assert.equal(replaced.type, 'system/message')
  assert.equal(replaced.data.turn, 3)
  assert.equal(replaced.data.step, 1)
  const head = session.log.find((e) => e.type === 'system/message').seq
  assert.deepEqual(replaced.intent.surfaceOp, { op: 'replace', startSeq: head, endSeq: head })
  assert.deepEqual(replaced.intent.sourceEventSeqs, [head])
  // 节点替换后开场历史的结构不变：还是合成轮、仍按原顺序。
  assert.ok(splitTurns(session.log).filter((turn) => turn.turn < 3).every((turn) => turn.synthetic))
  // 再来一次：已经一致，什么都不写。
  const again = await alignSyntheticSystemPrompt(agentWith(session, 'NEW SYS'), splitTurns(session.log), { turn: 3, step: 1 })
  assert.deepEqual(again, { ok: true, changed: false })
})

test('对齐：已经有真实轮 / 不止一条 system / 没有开场历史 / 渲染失败 —— 都不动', async () => {
  const session = seamSession('OLD SYS')
  session.append('user/message', { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'q' }] }, { surfaceOp: 'append' })
  session.append('assistant/message', { turn: 3, step: 1, message: { source: { kind: 'model' }, content: [{ type: 'text', text: 'a' }] } }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 3, step: 1 })
  session.append('turn/end', { turn: 3, reason: { kind: 'completed' } })
  const later = await alignSyntheticSystemPrompt(agentWith(session, 'NEW SYS'), splitTurns(session.log), { turn: 4, step: 1 })
  assert.equal(later.reason, 'not-seam')
  assert.deepEqual(systemTexts(session), ['OLD SYS'])

  const two = seamSession('OLD SYS')
  two.append('system/message', { turn: 3, step: 1, message: { role: 'system', content: [{ type: 'text', text: 'X' }] } }, { surfaceOp: 'append' })
  const multi = await alignSyntheticSystemPrompt(agentWith(two, 'NEW SYS'), splitTurns(two.log), { turn: 3, step: 1 })
  assert.equal(multi.reason, 'system-nodes:2')

  const plain = surfaceSession()
  plain.append('turn/start', { turn: 1 })
  const none = await alignSyntheticSystemPrompt(agentWith(plain, 'NEW SYS'), splitTurns(plain.log), { turn: 1, step: 1 })
  assert.equal(none.reason, 'not-seam')

  const broken = seamSession('OLD SYS')
  const agent = { id: 'x', session: broken, ctx: { get: () => ({ assemble: async () => { throw new Error('boom') } }) } }
  const failed = await alignSyntheticSystemPrompt(agent, splitTurns(broken.log), { turn: 3, step: 1 })
  assert.equal(failed.ok, false)
  assert.match(failed.reason, /^render:boom/)
  assert.deepEqual(systemTexts(broken), ['OLD SYS'])

  const noSurface = await alignSyntheticSystemPrompt({ id: 'y', session: { append() {} } }, [], { turn: 1 })
  assert.equal(noSurface.reason, 'no-surface')
})

test('agent/request 座位：只在每轮第 1 步动手；没有开场历史的会话直接跳过', async () => {
  const session = seamSession('OLD SYS')
  const notes = []
  const seatApi = { note: (entry) => notes.push(entry) }
  await alignOnRequest(seatApi, { agent: agentWith(session, 'NEW SYS'), turn: 3, step: 2 })
  assert.deepEqual(systemTexts(session), ['OLD SYS'])
  await alignOnRequest(seatApi, { agent: agentWith(session, 'NEW SYS'), turn: 3, step: 1 })
  assert.deepEqual(systemTexts(session), ['NEW SYS'])
  assert.equal(notes.at(-1).alignSystem.changed, true)
  const plain = surfaceSession()
  await alignOnRequest(seatApi, { agent: agentWith(plain, 'NEW SYS'), turn: 1, step: 1 })
  assert.equal(plain.log.length, 0)
  await alignOnRequest(seatApi, { turn: 1, step: 1 })
})

test('impl 挂了 agent/request 座位，并且先 next() 再对齐（不改请求配置）', () => {
  const impl = readFileSync(new URL('../impl.js', import.meta.url), 'utf8')
  assert.match(impl, /ctx\.on\('agent\/request', async \(payload, next\) => \{\n\s+const config = await next\(\)/)
  assert.match(impl, /gate\.alignOnRequest\(api\(\), payload\)/)
})
