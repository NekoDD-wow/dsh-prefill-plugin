// issue #19「A」首轮锁定 +「B」开跑后套预设（turn-lock.js）。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { everyTurnStatus, onInboxInserted, preparePrefillPrompt, stageDraft, step } from '../gate.js'
import { replay, splitTurns } from '../inject-auto.js'
import { stampEveryTurn } from '../impl.js'
import { migrateSandbox, resolveSandbox, withLegacyView } from '../sandbox.js'
import {
  LOCK_KEYS,
  MAX_LOCKS,
  clampSince,
  firstOnceDue,
  firstPlan,
  lockRecord,
  lockStatus,
  lockedBefore,
  restorePatch,
  restoreSandbox,
  stampFirstOnce,
  withLock,
} from '../turn-lock.js'

const SID = 's-lock'
const ZH_REASONING = '我先理解问题，再一步步拆开来想清楚，最后验证一下结论是否站得住脚，确认无误之后再整理成回答，整个过程都用中文来思考，不夹杂英文。这样看到的思路也更清楚，我也更容易发现自己哪里想错了。'

/** 闸门测试台：真实轮一轮一轮地跑，api.lockSession 照壳的语义写 st.locked（已有就不动）。 */
function harness(state = {}, { events = [] } = {}) {
  const st = { version: 2, armed: [], levers: {}, allowKinds: [], ...state }
  const locks = []
  const notes = []
  const api = {
    readState: () => st,
    note: (e) => notes.push(e),
    latches: new Map(),
    unlatch() {},
    rootCtx: undefined,
    lockSession(sessionId, info) {
      locks.push({ sessionId, ...info })
      if (st.locked?.[sessionId] !== undefined) return false
      st.locked = withLock(st.locked, sessionId, lockRecord(withLegacyView(st), sessionId, info))
      return true
    },
  }
  const agent = { id: SID, session: { snapshotEvents: () => events } }
  let turn = events.filter((e) => e.type === 'turn/start').reduce((max, e) => Math.max(max, e.data.turn), 0)
  async function runTurn(text, { reasoning = ZH_REASONING } = {}) {
    turn += 1
    const payload = { agent, turn, step: 1, __seat: 'root' }
    const decision = { kind: 'enter', messages: [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] }] }
    let out = await step(api, payload, decision)
    out = await step(api, { ...payload, __seat: 'agent' }, out)
    events.push({ type: 'turn/start', data: { turn } })
    for (const message of out.messages) events.push({ type: 'user/message', data: message })
    events.push({ type: 'assistant/message', data: { message: { source: { kind: 'model' }, content: [{ type: 'reasoning', text: reasoning }, { type: 'text', text: `回答${turn}` }] } } })
    events.push({ type: 'turn/end', data: { turn, reason: { kind: 'completed' } } })
    return { turn, messages: out.messages, everyTurn: out.messages.filter((m) => m.source?.prefill === 'every-turn') }
  }
  return { st, api, agent, events, locks, notes, runTurn }
}

const textOf = (message) => message?.content?.[0]?.text ?? ''

/** 开场：预填装写进历史的两轮合成轮（和 writeSyntheticTurns 同形状）。 */
function imported() {
  const events = []
  for (const turn of [1, 2]) {
    events.push({ type: 'turn/start', data: { turn } })
    events.push({ type: 'user/message', data: { role: 'user', source: { kind: 'user', prefill: 'dsh-prefill' }, content: [{ type: 'text', text: `旧问题${turn}` }] } })
    events.push({ type: 'assistant/message', data: { message: { source: { kind: 'model', provider: 'prefill-probe', model: 'prefill-probe' }, content: [{ type: 'text', text: `旧回答${turn}` }] } } })
    events.push({ type: 'turn/end', data: { turn, reason: { kind: 'completed' } } })
  }
  return events
}

// ── A. 首轮锁定 ─────────────────────────────────────────────────────────

test('锁 · 没有开场对话的新会话：第一轮第 1 步记锁（第 1 轮、开局配置快照），之后不再写', async () => {
  const everyTurn = { [SID]: { enabled: true, text: '每轮', firstText: '首轮', mode: 'always' } }
  const h = harness({ everyTurn, activePreset: { [SID]: 'builtin:x' } })
  await h.runTurn('你好')
  assert.equal(h.st.locked[SID].turn, 1)
  assert.deepEqual(h.st.locked[SID].items, [])
  assert.equal(h.st.locked[SID].legacy, undefined)
  assert.equal(h.st.locked[SID].preset.maps.activePreset, 'builtin:x')
  assert.equal(h.st.locked[SID].preset.maps.everyTurn.firstText, '首轮')
  const first = h.st.locked[SID]
  h.st.activePreset = { [SID]: 'builtin:y' }
  await h.runTurn('再来')
  assert.equal(h.st.locked[SID], first, '已有锁就不动（快照还是开局那份）')
})

test('锁 · 本版之前就开跑的会话：第一次被看到时记 legacy 锁，turn = 日志里第一条真实消息的轮', async () => {
  const events = []
  for (const turn of [1, 2]) {
    events.push({ type: 'turn/start', data: { turn } })
    events.push({ type: 'user/message', data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'q' }] } })
    events.push({ type: 'turn/end', data: { turn, reason: { kind: 'completed' } } })
  }
  const h = harness({}, { events })
  await h.runTurn('第三轮')
  assert.equal(h.st.locked[SID].turn, 1)
  assert.equal(h.st.locked[SID].legacy, true)
})

test('锁 · 物化开场对话成功 ⇒ 锁住（items = 写进去的、turn = 合成轮之后），锁过的会话不再物化', async () => {
  const log = []
  const session = { get seq() { return log.length }, snapshotEvents: () => log.slice(), append: (type, data) => log.push({ type, data }) }
  const agent = { id: 's-mat', session, ctx: { get: (name) => (name === 'systemPrompt' ? { assemble: async () => ({ sections: [{ name: 'a', text: 'SYS' }], variables: {} }) } : undefined) } }
  const st = { version: 2, armed: [], levers: {}, allowKinds: [], everyTurn: { 's-mat': { enabled: true, text: 't', mode: 'always' } } }
  const calls = []
  const api = {
    readState: () => st,
    note() {},
    latches: new Map(),
    unlatch() {},
    lockSession: (sid, info) => {
      calls.push({ sid, ...info })
      st.locked = withLock(st.locked, sid, lockRecord(withLegacyView(st), sid, info))
    },
  }
  const items = [{ role: 'user', text: '开场问' }, { role: 'assistant', text: '开场答', reasoning: '想' }, { role: 'user', text: '   ' }]
  stageDraft('s-mat', items)
  await preparePrefillPrompt(api, agent)
  onInboxInserted(api, agent, { source: { kind: 'user' }, content: [{ type: 'text', text: '真问题' }] })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].turn, 2, '一轮合成轮 ⇒ 第一条真实消息在第 2 轮')
  assert.deepEqual(st.locked['s-mat'].items, [{ role: 'user', text: '开场问' }, { role: 'assistant', text: '开场答', reasoning: '想' }])
  assert.equal(st.locked['s-mat'].preset.maps.everyTurn.text, 't')

  // 锁过、但日志读出来是空的（例如 fork 出来的新会话里还没有轮）：不再物化。
  const log2 = []
  const fresh = { ...agent, id: 's-mat2', session: { get seq() { return log2.length }, snapshotEvents: () => log2.slice(), append: (type, data) => log2.push({ type, data }) } }
  st.locked = { ...st.locked, 's-mat2': { at: 'x', turn: 2, items: [], preset: { maps: {}, armed: false } } }
  stageDraft('s-mat2', items)
  await preparePrefillPrompt(api, fresh)
  onInboxInserted(api, fresh, { source: { kind: 'user' }, content: [{ type: 'text', text: '真问题' }] })
  assert.equal(log2.length, 0, '有锁就不写合成轮')
})

test('锁记录：快照取兼容视图（系统提示改写 / 纯净模式 / 工具白名单也在里面）、去掉 firstOnce；坏条目过滤', () => {
  const raw = migrateSandbox({
    version: 2,
    armed: [SID],
    overrides: { [SID]: { messages: {}, sections: { 'prefill:persona': '你是猫。' }, contexts: {} } },
    sessionTools: { [SID]: ['read'] },
    gate: { [SID]: 'pure' },
    everyTurn: { [SID]: { enabled: true, text: 'x', since: 1, firstOnce: { atTurn: 4 } } },
  })
  const record = lockRecord(withLegacyView(raw), SID, { turn: 3, items: [{ role: 'user', text: 'a' }, { role: 'system', text: 'b' }, { role: 'assistant', text: '' }], at: 'T' })
  assert.deepEqual(record, {
    at: 'T',
    turn: 3,
    items: [{ role: 'user', text: 'a' }],
    preset: {
      maps: {
        overrides: { messages: {}, sections: { 'prefill:persona': '你是猫。' }, contexts: {} },
        gate: 'pure',
        sessionTools: ['read'],
        everyTurn: { enabled: true, text: 'x', since: 1 },
      },
      armed: true,
      sandbox: raw.sandbox[SID],
    },
  })
  assert.equal(record.preset.sandbox.level, 'strict')
})

test('withLock：已有就返回 undefined（不写）；超过上限丢最老的', () => {
  assert.equal(withLock({ a: { at: '1' } }, 'a', { at: '2' }), undefined)
  const many = {}
  for (let i = 0; i < MAX_LOCKS; i += 1) many[`s${i}`] = { at: `2026-01-01T00:00:${String(i).padStart(4, '0')}` }
  const next = withLock(many, 'new', { at: '2027' })
  assert.equal(Object.keys(next).length, MAX_LOCKS)
  assert.ok(next.new !== undefined && next.s0 === undefined && next.s1 !== undefined)
})

test('lockedBefore：以日志为准（被中止、没落下用户原话的那一轮不算开跑）；日志读不出来才看锁', () => {
  const turns = [{ turn: 1, synthetic: true, hasUser: false }, { turn: 2, synthetic: false, hasUser: false }, { turn: 3, synthetic: false, hasUser: true }]
  assert.equal(lockedBefore({ turn: 2 }, turns, 3), false, '第 2 轮在落盘前被中止：第 3 轮仍是第一条真实消息')
  assert.equal(lockedBefore({ turn: 2 }, turns, 4), true)
  assert.equal(lockedBefore({ turn: 2 }, [], 3), true)
  assert.equal(lockedBefore(undefined, [], 3), false)
  assert.equal(lockedBefore({ turn: 3 }, [], 3), false)
})

test('lockStatus：有锁看锁；没锁但日志里有真实轮 ⇒ legacy 已锁、没有快照；都没有 ⇒ 首轮未发', () => {
  assert.deepEqual(lockStatus({ turn: 3, items: [{ role: 'user', text: 'a' }], at: 'T', preset: {} }, []), { locked: true, turn: 3, items: [{ role: 'user', text: 'a' }], legacy: false, at: 'T', hasSnapshot: true })
  assert.deepEqual(lockStatus(undefined, [{ turn: 2, synthetic: false, hasUser: true }]), { locked: true, turn: 2, items: [], legacy: true, at: null, hasSnapshot: false })
  assert.equal(lockStatus(undefined, [{ turn: 1, synthetic: true, hasUser: false }]).locked, false)
})

// ── B. 开跑后套预设：首轮段 ─────────────────────────────────────────────

test('首轮段 · 从头就开着：第 1 轮发首轮段，之后发每轮段（不变）', async () => {
  const h = harness({ everyTurn: { [SID]: { enabled: true, text: '每轮', firstText: '首轮', mode: 'always' } } })
  const r1 = await h.runTurn('a')
  const r2 = await h.runTurn('b')
  assert.ok(textOf(r1.everyTurn[0]).includes('首轮') && r1.everyTurn[0].source.first === true)
  assert.ok(textOf(r2.everyTurn[0]).includes('每轮') && !textOf(r2.everyTurn[0]).includes('首轮'))
  assert.equal(r2.everyTurn[0].source.first, false)
})

test('首轮段 · 开跑后才套带首轮段的预设：第 N 轮不再突然发出整段首轮设定，只发每轮段', async () => {
  const h = harness()
  await h.runTurn('a')
  await h.runTurn('b')
  h.st.everyTurn = { [SID]: { enabled: true, text: '每轮', firstText: '整段开场设定', mode: 'always', since: 3 } }
  const r3 = await h.runTurn('c')
  assert.equal(r3.everyTurn.length, 1)
  assert.ok(!textOf(r3.everyTurn[0]).includes('整段开场设定'), textOf(r3.everyTurn[0]))
  assert.ok(textOf(r3.everyTurn[0]).includes('每轮'))
  // 只有首轮段的预设：锁后什么都不发（不会拿首轮段顶上）。
  h.st.everyTurn = { [SID]: { enabled: true, text: '', firstText: '只有首轮', mode: 'always' } }
  const r4 = await h.runTurn('d')
  assert.equal(r4.everyTurn.length, 0)
})

test('首轮段 · 「下一轮发一次」：atTurn 起第一次注入发首轮段（标 first），之后不再发；暂停中的自动模式也发这一次', async () => {
  const h = harness()
  await h.runTurn('a')
  h.st.everyTurn = { [SID]: { enabled: true, text: '每轮', firstText: '首轮', mode: 'always', firstOnce: { atTurn: 2 } } }
  const r2 = await h.runTurn('b')
  const r3 = await h.runTurn('c')
  assert.ok(textOf(r2.everyTurn[0]).includes('首轮') && r2.everyTurn[0].source.first === true)
  assert.ok(!textOf(r3.everyTurn[0]).includes('首轮'))
  // 自动模式手动暂停中：「下一轮发一次」照样发出去。
  h.st.everyTurn = { [SID]: { enabled: true, text: '每轮', firstText: '首轮二', mode: 'auto', checks: ['zh'], since: 1, auto: { override: { action: 'pause', atTurn: 4 } } } }
  const r4 = await h.runTurn('d')
  assert.equal(r4.everyTurn.length, 0, '暂停中不注入')
  h.st.everyTurn[SID].firstOnce = { atTurn: 5 }
  const r5 = await h.runTurn('e')
  assert.ok(textOf(r5.everyTurn[0]).includes('首轮二'))
  const r6 = await h.runTurn('f')
  assert.equal(r6.everyTurn.length, 0, '发过一次之后回到暂停')
})

test('firstOnceDue / firstPlan / stampFirstOnce', () => {
  assert.equal(firstOnceDue({ atTurn: 3 }, [], 2), false)
  assert.equal(firstOnceDue({ atTurn: 3 }, [], 3), true)
  assert.equal(firstOnceDue({ atTurn: 3 }, [{ turn: 3, firstSent: true }], 4), false)
  assert.equal(firstOnceDue({ atTurn: 3 }, [{ turn: 2, firstSent: true }], 4), true, 'atTurn 之前发的不算')
  const entry = { firstText: 'F' }
  const real = [{ turn: 1, synthetic: false, hasUser: true }]
  assert.deepEqual(firstPlan(entry, { isFirst: true }, { turns: [], currentTurn: 1 }), { useFirst: true, force: false, locked: false, reason: 'first-turn' })
  assert.deepEqual(firstPlan(entry, { isFirst: true }, { turns: real, currentTurn: 2 }), { useFirst: false, force: false, locked: true, reason: 'locked-skip' })
  assert.equal(firstPlan({ ...entry, firstOnce: { atTurn: 2 } }, { isFirst: false }, { turns: real, currentTurn: 2 }).reason, 'once')
  assert.equal(firstPlan({ firstText: '' }, { isFirst: true }, { turns: [], currentTurn: 1 }).useFirst, false)
  // 盖章
  assert.deepEqual(stampFirstOnce({ firstOnce: true }, undefined, 6), { atTurn: 7 })
  assert.equal(stampFirstOnce({ firstOnce: false, firstText: 'F' }, { firstOnce: { atTurn: 3 }, firstText: 'F' }, 6), undefined)
  assert.deepEqual(stampFirstOnce({ firstText: 'F' }, { firstOnce: { atTurn: 3 }, firstText: 'F' }, 6), { atTurn: 3 }, '没带 + 首轮段没变 ⇒ 沿用')
  assert.equal(stampFirstOnce({ firstText: 'G' }, { firstOnce: { atTurn: 3 }, firstText: 'F' }, 6), undefined, '首轮段变了 ⇒ 去掉')
})

test('stampEveryTurn：firstOnce: true 盖成下一轮；改参数沿用；since 夹到 ≤ 下一轮', () => {
  const base = { enabled: true, text: 't', firstText: 'F', mode: 'auto', checks: ['zh'], auto: {} }
  const stamped = stampEveryTurn({ [SID]: { ...base, since: 1 } }, { [SID]: { ...base, firstOnce: true } }, () => 4)
  assert.deepEqual(stamped[SID].firstOnce, { atTurn: 5 })
  assert.equal(stamped[SID].since, 1)
  const kept = stampEveryTurn(stamped, { [SID]: { ...base, auto: { warmup: 4 } } }, () => 5)
  assert.deepEqual(kept[SID].firstOnce, { atTurn: 5 })
  // since 比实际轮数还大（例如快照 / 别处带来的旧章）：夹到下一轮，之后实际跑的轮照常计分。
  const clamped = stampEveryTurn({ [SID]: { ...base, since: 40 } }, { [SID]: { ...base } }, () => 6)
  assert.equal(clamped[SID].since, 7)
  assert.equal(clampSince(-3, 2), 0)
  assert.equal(clampSince(undefined, 2), 0)
})

test('自动模式：开跑后套的预设（首轮段没发）那一轮照常计分；旧日志（没有 first 标记）照旧按第一次注入排除', async () => {
  const h = harness()
  await h.runTurn('a')
  const entry = { enabled: true, text: '提醒', firstText: '首轮', mode: 'auto', checks: ['zh'], since: 2, auto: { warmup: 3, streak: 3, probation: 2 } }
  h.st.everyTurn = { [SID]: entry }
  for (const q of ['b', 'c', 'd']) await h.runTurn(q)
  const result = replay(splitTurns(h.events), { ...entry, auto: entry.auto }, 5)
  assert.deepEqual(result.history.map((row) => [row.turn, row.verdict]), [[2, 'pass'], [3, 'pass'], [4, 'pass']], '第 2 轮发的是每轮段，参与判定')
  assert.equal(result.state, 'trial')
  // 旧日志：没有 first 标记 ⇒ 第一次注入那轮当首轮段排除（老行为）。
  const legacy = h.events.map((e) => (e.type === 'user/message' && e.data.source?.prefill === 'every-turn' ? { ...e, data: { ...e.data, source: { kind: 'prefill', prefill: 'every-turn' } } } : e))
  assert.equal(replay(splitTurns(legacy), entry, 5).history[0].verdict, 'skip')
})

// ── 和已合并的三件事 ─────────────────────────────────────────────────────

test('接缝（约束承接）：物化开场后锁在第 3 轮，第 3 轮照样发首轮段 + 接缝提醒，第 4 轮起不再发', async () => {
  const h = harness({ everyTurn: { [SID]: { enabled: true, text: '每轮', firstText: '首轮', mode: 'always', seam: true } }, locked: { [SID]: { at: 'T', turn: 3, items: [{ role: 'user', text: '旧问题1' }], preset: { maps: {}, armed: false } } } }, { events: imported() })
  const r3 = await h.runTurn('新问题')
  const r4 = await h.runTurn('再问')
  assert.ok(textOf(r3.everyTurn[0]).includes('首轮') && r3.everyTurn[0].source.seam === true && r3.everyTurn[0].source.first === true)
  assert.ok(!textOf(r4.everyTurn[0]).includes('首轮') && r4.everyTurn[0].source.seam === undefined)
  assert.equal(h.locks.length, 0, '已经锁过：闸门不再请壳写')
})

test('手动注入（一次性）：锁住之后照常从状态队列发一次，排在每轮注入之前、用户原话之前', async () => {
  const h = harness({ everyTurn: { [SID]: { enabled: true, text: '每轮', mode: 'always' } } })
  await h.runTurn('a')
  h.st.injectQueue = { [SID]: [{ id: 'm1', role: 'user', text: '门外有脚步声', at: 'T' }] }
  const r2 = await h.runTurn('b')
  const kinds = r2.messages.map((m) => m.source?.prefill ?? m.source?.kind)
  assert.deepEqual(kinds, ['manual', 'every-turn', 'user'])
  assert.ok(h.st.locked[SID] !== undefined)
})

test('everyTurnStatus：给面板锁状态 + 首轮段下一轮发不发 / 「下一轮发一次」是否还在等', () => {
  const events = [{ type: 'turn/start', data: { turn: 1 } }, { type: 'user/message', data: { source: { kind: 'user' } } }, { type: 'turn/end', data: { turn: 1 } }]
  const st = { everyTurn: { [SID]: { enabled: true, text: 't', firstText: 'F', mode: 'always' } } }
  const a = everyTurnStatus(st, SID, events)
  assert.equal(a.lock.locked, true)
  assert.deepEqual(a.first, { has: true, willSend: false, reason: 'locked-skip', locked: true, once: 'none' })
  st.everyTurn[SID].firstOnce = { atTurn: 2 }
  const b = everyTurnStatus(st, SID, events)
  assert.equal(b.first.once, 'pending')
  assert.equal(b.first.willSend, true)
  events.push({ type: 'turn/start', data: { turn: 2 } }, { type: 'user/message', data: { source: { kind: 'prefill', prefill: 'every-turn', first: true } } })
  assert.equal(everyTurnStatus(st, SID, events).first.once, 'sent')
  assert.equal(everyTurnStatus({}, SID, []).lock.locked, false)
})

// ── B. 恢复开局时的预设 ───────────────────────────────────────────────

test('恢复开局：配置换回快照（别的会话不动），since 沿用快照自己的（不是重新开始），纯净模式 / 系统提示改写按规则表还原', () => {
  const opening = migrateSandbox({
    version: 2,
    armed: [],
    overrides: { [SID]: { messages: {}, sections: { 'prefill:persona': '你是猫。' }, contexts: {} }, other: { messages: {}, sections: { 'prefill:persona': '别人' }, contexts: {} } },
    gate: { [SID]: 'pure' },
    activePreset: { [SID]: 'card:cat' },
    everyTurn: { [SID]: { enabled: true, text: '猫的提醒', mode: 'auto', checks: ['zh'], since: 1, auto: { override: { action: 'pause', atTurn: 30 } } } },
  })
  const lock = lockRecord(withLegacyView(opening), SID, { turn: 1 })
  // 开跑后套了另一个预设：不纯净、换了系统提示和每轮注入；别的会话也变了。
  const later = migrateSandbox({
    ...opening,
    sandbox: undefined,
    overrides: { [SID]: { messages: {}, sections: { 'prefill:persona': '你是狗。' }, contexts: {} }, other: { messages: {}, sections: { 'prefill:persona': '别人改了' }, contexts: {} } },
    gate: { [SID]: 'pass' },
    activePreset: { [SID]: 'pack:狗' },
    everyTurn: { [SID]: { enabled: true, text: '狗的提醒', mode: 'always', since: 6 } },
    locked: { [SID]: lock },
  })
  assert.equal(resolveSandbox(later, SID).level, 'observe')
  const patch = restorePatch(withLegacyView(later), SID, later.locked[SID], 8)
  const restored = migrateSandbox({ ...later, ...patch })
  const view = withLegacyView(restored)
  assert.equal(view.overrides[SID].sections['prefill:persona'], '你是猫。')
  assert.equal(view.overrides.other.sections['prefill:persona'], '别人改了', '别的会话保持最新')
  assert.equal(view.gate[SID], 'pure')
  assert.equal(resolveSandbox(restored, SID).level, 'strict')
  assert.equal(restored.activePreset[SID], 'card:cat')
  assert.equal(restored.everyTurn[SID].text, '猫的提醒')
  assert.equal(restored.everyTurn[SID].since, 1, '沿用开局时的 since：开局以来的判定接着算')
  assert.equal(restored.everyTurn[SID].auto.override, undefined, '轮号超过下一轮的覆盖去掉')

  // 反过来：开局不纯净、后来套了纯净 ⇒ 恢复后撤掉严格档（gate 写 pass，不是删格）。
  const plain = migrateSandbox({ version: 2, armed: [] })
  const lock2 = lockRecord(withLegacyView(plain), SID, { turn: 1 })
  const pure = migrateSandbox({ version: 2, armed: [], gate: { [SID]: 'pure' }, sessionTools: { [SID]: [] } })
  assert.equal(resolveSandbox(pure, SID).level, 'strict')
  const back = migrateSandbox({ ...pure, ...restorePatch(withLegacyView(pure), SID, lock2, 3) })
  assert.equal(resolveSandbox(back, SID).level, 'observe')
  assert.equal(back.everyTurn[SID], undefined)
  assert.equal(restorePatch(withLegacyView(pure), SID, undefined, 3), undefined, '没有锁 ⇒ 不恢复')
})

test('恢复开局：快照里的 since 比现在的轮数还大 ⇒ 夹到下一轮', () => {
  const lock = { turn: 1, preset: { maps: { everyTurn: { enabled: true, text: 'x', mode: 'auto', checks: ['zh'], since: 12, firstOnce: { atTurn: 2 } } }, armed: false } }
  const patch = restorePatch({ everyTurn: {} }, SID, lock, 4)
  assert.equal(patch.everyTurn[SID].since, 5)
  assert.equal(patch.everyTurn[SID].firstOnce, undefined)
  assert.equal(patch.gate[SID], 'pass')
})

// ── 壳 / 面板 ─────────────────────────────────────────────────────────

const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const impl = readFileSync(new URL('../impl.js', import.meta.url), 'utf8')
const lockSrc = client.slice(client.indexOf('// <turn-lock>'), client.indexOf('// </turn-lock>'))
// eslint-disable-next-line no-new-func
const C = new Function(`${lockSrc}\nreturn { lockView, lockedApply }`)()

test('面板：快照覆盖的表和「取消预设」的 PRESET_KEYS 是同一份', () => {
  const match = client.match(/const PRESET_KEYS = (\[[^\]]+\])/)
  assert.deepEqual(JSON.parse(match[1].replace(/'/g, '"')), LOCK_KEYS)
})

test('面板：锁状态以 state.locked 为准，没有记录时看日志 / 闸门轮号；开跑后套预设不碰开场对话草稿', () => {
  assert.equal(C.lockView({ turn: 3, items: [{ role: 'user', text: 'a' }], preset: {} }, null, 0).hasSnapshot, true)
  assert.deepEqual(C.lockView(null, { locked: true, turn: 2 }, 0), { locked: true, turn: 2, items: [], legacy: true, hasSnapshot: false })
  assert.equal(C.lockView(null, null, 4).locked, true)
  assert.equal(C.lockView(null, { locked: false }, 0).locked, false)
  assert.deepEqual(C.lockedApply([{ role: 'user', text: 'a' }, { role: 'user', text: ' ' }], true), { touchItems: false, skipped: 1 })
  assert.deepEqual(C.lockedApply([{ role: 'user', text: 'a' }], false), { touchItems: true, skipped: 0 })
  const applySrc = client.slice(client.indexOf('const applyLayered = async'), client.indexOf('const applyBuiltin = async'))
  assert.match(applySrc, /lockedApply\(resolved\.items, lock\.locked\)/)
  assert.match(applySrc, /const touchItems = clearItems \|\| applied\.touchItems/, '「取消预设」照旧清草稿')
  assert.match(applySrc, /if \(touchItems\) \{\s+await postJson\(DRAFT_ROUTE/)
  assert.match(client, /const injectMode = turns > 0 \|\| lock\.locked/)
  assert.match(client, /postJson\(STATE_ROUTE, \{ restoreOpening: sessionId \}\)/)
  for (const attr of ['data-prefill-lock-badge', 'data-prefill-lock-restore', 'data-prefill-first-once', 'data-prefill-lock-presets']) assert.ok(client.includes(attr), attr)
  const zh = client.slice(client.indexOf('// ── 首轮锁定 / 开跑后套预设'), client.indexOf('    const S = {'))
  const keys = (block) => [...block.matchAll(/^\s+(lock\w+):/gm)].map((m) => m[1])
  const [zhBlock, enBlock] = zh.split('Object.assign(en,')
  assert.deepEqual(keys(zhBlock), keys(enBlock), '中英文案同步')
  assert.ok(keys(zhBlock).length >= 20)
})

test('壳：闸门拿得到 lockSession；状态路由收 restoreOpening；turn-lock.js 在 files 白名单里', () => {
  assert.match(impl, /pruneQueue, lockSession \}/)
  assert.match(impl, /patch\?\.restoreOpening/)
  assert.match(impl, /restorePatch\(withLegacyView\(current\), sid, lockOf\(current, sid\)/)
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.ok(pkg.files.includes('turn-lock.js'))
})

test('恢复开局预设：会话沙盒那一格（受控档 / 包开关）按快照换回', () => {
  const sid = 's-sbx'
  // 开局时本会话没有沙盒格
  const lock0 = lockRecord(withLegacyView({}), sid, { turn: 1 })
  assert.equal(Object.prototype.hasOwnProperty.call(lock0.preset, 'sandbox'), true)
  assert.equal(lock0.preset.sandbox, null)
  // 开跑后面板把本会话设成受控档、拦掉某个包
  const later = { [sid]: { level: 'controlled', own: [], rules: [{ match: { pack: 'team' }, action: 'deny' }] }, other: { level: 'strict', own: [], rules: [] } }
  const back = restoreSandbox(later, sid, lock0)
  assert.equal(back[sid], undefined)
  assert.deepEqual(back.other, later.other)
  // 开局时就是受控档 ⇒ 换回受控档（不被之后改成严格档覆盖）
  const opening = { sandbox: { [sid]: { level: 'controlled', own: [], rules: [] } } }
  const lock1 = lockRecord(opening, sid, { turn: 1 })
  const back1 = restoreSandbox({ [sid]: { level: 'strict', own: [], rules: [] } }, sid, lock1)
  assert.equal(back1[sid].level, 'controlled')
  // 本功能之前锁的（快照里没有 sandbox 键）⇒ 不动
  const old = { preset: { maps: {}, armed: false } }
  assert.equal(restoreSandbox(later, sid, old), undefined)
})
