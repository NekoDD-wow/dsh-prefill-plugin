// 接缝轮加固（对照实验）：① 开场里留一份规则（headRule，选项，默认关）；② 第一条真实消息那一步把开场写的
// system 对齐成本步渲染结果，免得 DSH 在本轮末尾再追加一整份系统提示、压过接缝提醒。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { HEAD_RULE_HEADS, headRuleApplies, headRuleText, mergeCarried } from '../constraint-carry.js'
import { alignOnRequest, alignSyntheticSystemPrompt, everyTurnFor, materializePrefill, onInboxInserted, openingRule, preparePrefillPrompt, writeSyntheticTurns } from '../gate.js'
import { splitTurns } from '../inject-auto.js'
import { historyToItems } from '../session-history.js'
import { carriedPresetFields, sanitizeEveryTurn } from '../impl.js'

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
const RULE_BODY = '【思考语言】思维链请全程用中文。'
const api = { note() {} }

test('headRule：默认关，来自会话的预设（seam）+ headRule:true 才开；正文取首轮段，中英抬头按正文选', () => {
  assert.equal(headRuleApplies({ seam: true }), false)
  assert.equal(headRuleApplies({ seam: true, headRule: true }), true)
  assert.equal(headRuleApplies({ headRule: true }), false, '不是来自会话的预设不加')
  assert.equal(headRuleText({ text: '每轮', firstText: RULE_BODY }), `${HEAD_RULE_HEADS.zh}\n${RULE_BODY}`)
  assert.equal(headRuleText({ text: 'Think in English.', firstText: '' }), `${HEAD_RULE_HEADS.en}\nThink in English.`)
  assert.equal(headRuleText({ text: ' ', firstText: '' }), '')
})

test('headRule：存预设 / 清洗 / everyTurnFor 都带得过去，只存打开的 true', () => {
  const carried = [{ ref: 'zh-thinking', name: '中文思考', text: RULE_BODY, checks: ['zh'] }]
  assert.equal(mergeCarried(carried, {}).headRule, undefined)
  assert.equal(mergeCarried(carried, {}, { headRule: true }).headRule, true)
  const off = carriedPresetFields({ carried, fromSession: true })
  assert.equal(off.everyTurn.seam, true)
  assert.equal('headRule' in off.everyTurn, false)
  const on = carriedPresetFields({ carried, fromSession: true, headRule: true })
  assert.equal(on.everyTurn.headRule, true)
  // 没有 seam 时 headRule 没意义，不存。
  assert.equal(sanitizeEveryTurn({ enabled: true, text: 'x', headRule: true }).headRule, undefined)
  assert.equal(everyTurnFor({ everyTurn: { s1: { enabled: true, text: 'x', seam: true } } }, 's1').headRule, false)
  assert.equal(everyTurnFor({ everyTurn: { s1: { enabled: true, text: 'x', seam: true, headRule: true } } }, 's1').headRule, true)
  // 通配格不认（seam / headRule 只属于从预设开的那个会话）。
  assert.equal(everyTurnFor({ everyTurn: { '*': { enabled: true, text: 'x', seam: true, headRule: true } } }, 's2').headRule, false)
})

test('物化：规则紧跟系统提示、排在开场第一条之前；不算合成用户条目，也不算每轮注入；再存预设时跳过', () => {
  const session = surfaceSession()
  const rule = headRuleText({ text: RULE_BODY })
  writeSyntheticTurns(api, { id: 'agent-rule-1' }, session, 'SYS', OPENING, { rule })
  const shaped = session.log.filter((e) => e.type === 'system/message' || e.type === 'user/message' || e.type === 'assistant/message')
  assert.deepEqual(shaped.map((e) => e.type), ['system/message', 'user/message', 'user/message', 'assistant/message', 'user/message', 'assistant/message'])
  assert.equal(textOf(shaped[1]), rule)
  assert.deepEqual(shaped[1].data.source, { kind: 'prefill', prefill: 'rule' })
  assert.equal(shaped[2].data.source.kind, 'user')
  const turns = splitTurns(session.log)
  assert.ok(turns.every((turn) => turn.synthetic && !turn.injected))
  assert.deepEqual(historyToItems(session.log).items.map((item) => item.text), OPENING.map((item) => item.text))
})

test('物化端到端：本会话那格 seam + headRule:true ⇒ 开场最前面写规则；没开 ⇒ 不写', async () => {
  const before = process.env.PREFILL_PROBE_ITEMS
  process.env.PREFILL_PROBE_ITEMS = JSON.stringify(OPENING)
  try {
    for (const [headRule, expected] of [[true, 1], [undefined, 0]]) {
      const id = `agent-mat-${String(headRule)}`
      const entry = { enabled: true, text: RULE_BODY, mode: 'always', seam: true, ...(headRule === true ? { headRule } : {}) }
      const state = { version: 2, armed: [], levers: { prefillProbe: true }, allowKinds: [], everyTurn: { [id]: entry } }
      const session = surfaceSession()
      const agent = { ...agentWith(session, 'SYS'), id }
      await materializePrefill({ readState: () => state, note() {} }, agent)
      const rules = session.log.filter((e) => e.data?.source?.prefill === 'rule')
      assert.equal(rules.length, expected, `headRule=${headRule}`)
      if (expected) assert.equal(textOf(rules[0]), `${HEAD_RULE_HEADS.zh}\n${RULE_BODY}`)
    }
  } finally {
    if (before === undefined) delete process.env.PREFILL_PROBE_ITEMS
    else process.env.PREFILL_PROBE_ITEMS = before
  }
})

test('产品路径（agent/created 缓存提示 → 用户真发话时物化）同样写规则', async () => {
  const before = process.env.PREFILL_PROBE_ITEMS
  process.env.PREFILL_PROBE_ITEMS = JSON.stringify(OPENING)
  try {
    const id = 'agent-inbox-rule'
    const state = { version: 2, armed: [], levers: { prefillProbe: true }, allowKinds: [], everyTurn: { [id]: { enabled: true, text: RULE_BODY, mode: 'always', seam: true, headRule: true } } }
    const seatApi = { readState: () => state, note() {} }
    const session = surfaceSession()
    const agent = { ...agentWith(session, 'SYS'), id }
    await preparePrefillPrompt(seatApi, agent)
    onInboxInserted(seatApi, agent, { source: { kind: 'user' } })
    const shaped = session.log.filter((e) => e.type === 'system/message' || e.type === 'user/message')
    assert.equal(shaped[0].type, 'system/message')
    assert.equal(shaped[1].data.source.prefill, 'rule')
    assert.equal(textOf(shaped[1]), openingRule(state, id))
    assert.equal(openingRule({ everyTurn: { [id]: { enabled: true, text: RULE_BODY, seam: true } } }, id), '')
  } finally {
    if (before === undefined) delete process.env.PREFILL_PROBE_ITEMS
    else process.env.PREFILL_PROBE_ITEMS = before
  }
})

test('物化：没给规则 = 原样（只有系统提示 + 开场条目）', () => {
  const session = surfaceSession()
  writeSyntheticTurns(api, { id: 'agent-rule-2' }, session, 'SYS', OPENING)
  assert.equal(session.log.filter((e) => e.data?.source?.prefill === 'rule').length, 0)
})

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
  const result = await alignSyntheticSystemPrompt(agentWith(session, 'NEW SYS'), undefined, splitTurns(session.log), { turn: 3, step: 1 })
  assert.deepEqual(result, { ok: true, changed: true, from: 7, to: 7 })
  assert.deepEqual(systemTexts(session), ['NEW SYS'])
  const replaced = session.log.at(-1)
  assert.equal(replaced.type, 'system/message')
  assert.equal(replaced.data.turn, 3)
  assert.equal(replaced.data.step, 1)
  assert.equal(replaced.intent.surfaceOp.op, 'replace')
  // 再来一次：已经一致，什么都不写。
  const again = await alignSyntheticSystemPrompt(agentWith(session, 'NEW SYS'), undefined, splitTurns(session.log), { turn: 3, step: 1 })
  assert.deepEqual(again, { ok: true, changed: false })
})

test('对齐：已经有真实轮 / 不止一条 system / 没有开场历史 —— 都不动', async () => {
  const session = seamSession('OLD SYS')
  session.append('user/message', { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'q' }] }, { surfaceOp: 'append' })
  session.append('assistant/message', { turn: 3, step: 1, message: { source: { kind: 'model' }, content: [{ type: 'text', text: 'a' }] } }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 3, step: 1 })
  session.append('turn/end', { turn: 3, reason: { kind: 'completed' } })
  const later = await alignSyntheticSystemPrompt(agentWith(session, 'NEW SYS'), undefined, splitTurns(session.log), { turn: 4, step: 1 })
  assert.equal(later.reason, 'not-seam')

  const two = seamSession('OLD SYS')
  two.append('system/message', { turn: 3, step: 1, message: { role: 'system', content: [{ type: 'text', text: 'X' }] } }, { surfaceOp: 'append' })
  const multi = await alignSyntheticSystemPrompt(agentWith(two, 'NEW SYS'), undefined, splitTurns(two.log), { turn: 3, step: 1 })
  assert.equal(multi.reason, 'system-nodes:2')

  const plain = surfaceSession()
  plain.append('turn/start', { turn: 1 })
  const none = await alignSyntheticSystemPrompt(agentWith(plain, 'NEW SYS'), undefined, splitTurns(plain.log), { turn: 1, step: 1 })
  assert.equal(none.reason, 'not-seam')
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
})

test('面板：「开场里留一份规则」复选框（默认不勾），中英文案；impl 挂了 agent/request 座位', () => {
  const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  assert.match(src, /data-prefill-carry-head-rule/)
  assert.match(src, /\[carryHeadRule, setCarryHeadRule\] = React\.useState\(false\)/)
  assert.match(src, /carryHeadRule \? \{ headRule: true \} : \{\}/)
  for (const key of ['carryHeadRule', 'carryHeadRuleHint']) {
    const hits = src.match(new RegExp(`\\n\\s+${key}: '`, 'g')) ?? []
    assert.equal(hits.length, 2, `${key} 要有中英两份`)
  }
  const impl = readFileSync(new URL('../impl.js', import.meta.url), 'utf8')
  assert.match(impl, /ctx\.on\('agent\/request'/)
})
