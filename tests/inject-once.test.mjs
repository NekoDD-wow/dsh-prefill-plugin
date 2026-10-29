// issue #19「C」：手动注入改成一次性 —— inbox 插话通道、状态队列兜底、旧 injects 迁移。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { step } from '../gate.js'
import {
  ASSISTANT_HEAD,
  LEGACY_BLOCK_REF,
  deliverToInbox,
  deliveredIn,
  flushQueueToInbox,
  manualMessage,
  migrateLegacyInjects,
  pendingInInbox,
  planQueued,
  recentDelivered,
  removeFromInbox,
  renderInjectBlock,
  replaceInInbox,
} from '../inject-once.js'
import { historyToItems } from '../session-history.js'
import { applyEnabled } from '../enabled.js'

const SID = 's1'

// ── 一个最小的 ReactLoopInbox + 循环：领取语义照 dsh-agent-loop（轮边界领 next-step + 一条 next-turn；步骤之间只领 next-step）──
function fakeInbox() {
  const lists = { 'next-turn': [], 'next-step': [] }
  return {
    get nextTurn() {
      return lists['next-turn']
    },
    get nextStep() {
      return lists['next-step']
    },
    append(target, message) {
      for (const list of Object.values(lists)) if (list.some((m) => m.id === message.id)) throw new Error(`message "${message.id}" is already pending`)
      lists[target].push(message)
    },
    prepend(target, message) {
      lists[target].unshift(message)
    },
    replace(id, message) {
      for (const list of Object.values(lists)) {
        const at = list.findIndex((m) => m.id === id)
        if (at >= 0) {
          list[at] = message
          return true
        }
      }
      return false
    },
    remove(id) {
      for (const list of Object.values(lists)) {
        const at = list.findIndex((m) => m.id === id)
        if (at >= 0) {
          list.splice(at, 1)
          return true
        }
      }
      return false
    },
    claim(target) {
      const out = lists['next-step'].splice(0)
      if (target === 'next-turn') out.push(...lists['next-turn'].splice(0, 1))
      return out
    },
  }
}

const userMsg = (text) => ({ id: 'u-' + text, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] })
const textOf = (m) => m.content.map((p) => p.text ?? '').join('')

function harness({ inbox = true, state = {} } = {}) {
  const events = []
  const notes = []
  const pruned = []
  const st = { version: 2, armed: [], levers: {}, allowKinds: [], ...state }
  const agent = { id: SID, status: 'idle', session: { snapshotEvents: () => events } }
  if (inbox) agent.inbox = fakeInbox()
  const api = {
    readState: () => st,
    note: (e) => notes.push(e),
    latches: new Map(),
    unlatch() {},
    rootCtx: undefined,
    pruneQueue: (sid, ids) => {
      pruned.push(...ids)
      if (Array.isArray(st.injectQueue?.[sid])) st.injectQueue[sid] = st.injectQueue[sid].filter((e) => !ids.includes(e.id))
    },
  }
  let turn = events.filter((e) => e.type === 'turn/start').length
  const requests = []
  /**
   * 跑一轮：steps = 本轮步数；between(stepNo) 在第 stepNo 步结束后调用（模拟 AI 跑着时用户插话）。
   * opts.abortFirstStep：第 1 步在写进日志前被中止（pre-step 跑过，但消息没落盘）。
   */
  async function runTurn(text, { steps = 1, between, abortFirstStep = false, dualSeat = true } = {}) {
    turn += 1
    if (text !== undefined) {
      if (agent.inbox) agent.inbox.append('next-turn', userMsg(text))
    }
    events.push({ type: 'turn/start', data: { turn } })
    agent.status = 'running'
    let stepNo = 0
    let target = 'next-turn'
    while (true) {
      stepNo += 1
      let claimed
      if (agent.inbox) claimed = agent.inbox.claim(target)
      else claimed = stepNo === 1 && text !== undefined ? [userMsg(text)] : []
      if (stepNo > steps && claimed.length === 0) break
      const payload = { agent, turn, step: stepNo, __seat: 'root' }
      let out = await step(api, payload, { kind: 'enter', messages: claimed })
      if (dualSeat) out = await step(api, { ...payload, __seat: 'agent' }, out)
      requests.push({ turn, step: stepNo, messages: out.messages })
      if (stepNo === 1 && abortFirstStep) {
        events.push({ type: 'turn/end', data: { turn, reason: { kind: 'aborted' } } })
        agent.status = 'idle'
        return
      }
      events.push({ type: 'step/start', data: { turn, step: stepNo } })
      for (const message of out.messages) events.push({ type: 'user/message', data: message })
      events.push({ type: 'assistant/message', data: { message: { source: { kind: 'model' }, content: [{ type: 'text', text: `回答${turn}.${stepNo}` }] } } })
      events.push({ type: 'step/end', data: { turn, step: stepNo } })
      if (typeof between === 'function') between(stepNo)
      target = 'next-step'
      if (stepNo >= steps && (!agent.inbox || agent.inbox.nextStep.length === 0)) break
    }
    events.push({ type: 'turn/end', data: { turn, reason: { kind: 'completed' } } })
    agent.status = 'idle'
  }
  return { st, events, notes, pruned, agent, api, requests, runTurn }
}

const manualIn = (messages, id) => messages.filter((m) => m.source?.prefill === 'manual' && (id === undefined || m.source.manual?.id === id))

// ── 通道①：inbox ────────────────────────────────────────────────────────

test('inbox · 空闲时注入：下一轮发一次（排在用户原话之前），再下一轮只作为历史', async () => {
  const h = harness()
  await h.runTurn('第一句')
  const r = deliverToInbox(h.agent, { id: 'm1', role: 'user', text: '其实我是卧底' })
  assert.deepEqual({ ok: r.ok, via: r.via, running: r.running }, { ok: true, via: 'inbox', running: false })
  assert.equal(pendingInInbox(h.agent).length, 1)
  await h.runTurn('第二句')
  const t2 = h.requests.find((q) => q.turn === 2 && q.step === 1).messages
  assert.equal(manualIn(t2, 'm1').length, 1)
  const at = t2.findIndex((m) => m.source?.prefill === 'manual')
  assert.ok(at < t2.findIndex((m) => m.source?.kind === 'user'), '在用户原话之前')
  assert.equal(textOf(manualIn(t2)[0]), '其实我是卧底')
  await h.runTurn('第三句')
  const t3 = h.requests.find((q) => q.turn === 3).messages
  assert.equal(manualIn(t3).length, 0, '再下一轮请求的新消息里没有它')
  assert.equal(h.events.filter((e) => e.type === 'user/message' && e.data.source?.prefill === 'manual').length, 1, '会话日志里只有一份（之后靠历史重放）')
  assert.deepEqual([...deliveredIn(h.events)], [['m1', 2]])
  assert.equal(pendingInInbox(h.agent).length, 0)
})

test('inbox · AI 正在跑时注入：下一步就带上（插话），同轮后续步骤不重复', async () => {
  const h = harness()
  await h.runTurn('帮我写个文件', {
    steps: 3,
    between: (n) => {
      if (n === 1) assert.equal(deliverToInbox(h.agent, { id: 'm2', role: 'user', text: '顺便用中文注释' }).running, true)
    },
  })
  const byStep = h.requests.filter((q) => q.turn === 1).map((q) => manualIn(q.messages).length)
  assert.deepEqual(byStep, [0, 1, 0])
  assert.equal(h.events.filter((e) => e.type === 'user/message' && e.data.source?.prefill === 'manual').length, 1)
})

test('inbox · 本轮最后一步之后才插：循环再开一步带上它（与 steer 同语义），只发一次', async () => {
  const h = harness()
  await h.runTurn('你好', { steps: 1, between: (n) => n === 1 && deliverToInbox(h.agent, { id: 'm3', role: 'user', text: '等等' }) })
  const turn1 = h.requests.filter((q) => q.turn === 1)
  assert.equal(turn1.length, 2)
  assert.equal(manualIn(turn1[1].messages).length, 1)
  await h.runTurn('下一句')
  assert.equal(manualIn(h.requests.at(-1).messages).length, 0)
})

test('inbox · 「AI 回答」角色渲染成带标注的 user 消息，role 记在 source.manual 上', () => {
  const message = manualMessage({ id: 'a1', role: 'assistant', text: '我早就知道了。' })
  assert.equal(message.role, 'user')
  assert.deepEqual(message.source, { kind: 'prefill', prefill: 'manual', manual: { id: 'a1', role: 'assistant' } })
  assert.equal(textOf(message), `${ASSISTANT_HEAD}\n我早就知道了。`)
  const plain = manualMessage({ id: 'u1', role: 'user', text: '原话' })
  assert.equal(textOf(plain), '原话')
})

test('inbox · 未领取前可编辑、可撤回；同一条重复注入不会挂两份', () => {
  const h = harness()
  deliverToInbox(h.agent, { id: 'e1', role: 'user', text: '旧' })
  assert.equal(deliverToInbox(h.agent, { id: 'e1', role: 'user', text: '旧' }).already, true)
  assert.equal(h.agent.inbox.nextStep.length, 1)
  assert.equal(replaceInInbox(h.agent, { id: 'e1', role: 'assistant', text: '新' }), true)
  assert.deepEqual(pendingInInbox(h.agent), [{ id: 'e1', role: 'assistant', text: '新' }])
  assert.equal(removeFromInbox(h.agent, 'e1'), true)
  assert.equal(removeFromInbox(h.agent, 'e1'), false, '已经不在了')
  assert.equal(replaceInInbox(h.agent, { id: 'e1', role: 'user', text: 'x' }), false)
})

test('首轮物化后真实轮：手动注入在物化历史之后、用户消息之前，且与每轮注入共存不重复', async () => {
  const h = harness({ state: { everyTurn: { [SID]: { enabled: true, text: '每轮提醒', firstText: '', mode: 'always' } } } })
  deliverToInbox(h.agent, { id: 'f1', role: 'user', text: '开跑前补一句' })
  // 物化写进的合成轮（turn 1）
  h.events.push({ type: 'turn/start', data: { turn: 1 } })
  h.events.push({ type: 'user/message', data: { source: { kind: 'user', prefill: 'items' }, content: [{ type: 'text', text: '开场' }] } })
  h.events.push({ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  await h.runTurn('真实第一句') // turn 1（计数器）→ 用日志里的轮号断言顺序
  const req = h.requests[0].messages
  const kinds = req.map((m) => (m.source?.kind === 'prefill' ? m.source.prefill : m.source?.kind))
  assert.deepEqual(kinds, ['manual', 'every-turn', 'user'])
  assert.equal(manualIn(req).length, 1)
  assert.equal(req.filter((m) => m.source?.prefill === 'every-turn').length, 1)
  const logIndex = (pred) => h.events.findIndex(pred)
  const opening = logIndex((e) => e.data?.source?.prefill === 'items')
  const manual = logIndex((e) => e.data?.source?.prefill === 'manual')
  const user = logIndex((e) => e.data?.source?.kind === 'user' && e.data?.source?.prefill === undefined)
  assert.ok(opening < manual && manual < user)
})

test('拦注入开着（allowKinds 空）：inbox 带进来的手动注入不被当成外来注入丢掉', async () => {
  const h = harness({ state: { armed: [SID], levers: { blockMessages: true }, allowKinds: [] } })
  deliverToInbox(h.agent, { id: 'b1', role: 'user', text: '留着我' })
  await h.runTurn('你好')
  assert.equal(manualIn(h.requests[0].messages).length, 1)
})

// ── 通道②：状态队列兜底 ──────────────────────────────────────────────────

test('队列 · 会话 agent/created 时整体搬进 inbox；已送达的跳过并删掉', () => {
  const h = harness()
  const queue = [
    { id: 'q1', role: 'user', text: '一', at: 'x' },
    { id: 'q2', role: 'assistant', text: '二', at: 'x' },
  ]
  const events = [{ type: 'turn/start', data: { turn: 1 } }, { type: 'user/message', data: manualMessage(queue[0]) }]
  const { done, moved } = flushQueueToInbox(h.agent, queue, events)
  assert.deepEqual(done, ['q1', 'q2'])
  assert.equal(moved, 1)
  assert.deepEqual(pendingInInbox(h.agent).map((e) => e.id), ['q2'])
  // 再搬一次（幂等）：不会挂第二份
  assert.equal(flushQueueToInbox(h.agent, queue, events).moved, 0)
  assert.equal(h.agent.inbox.nextStep.length, 1)
})

test('队列 · 没有 inbox：下一轮 step 1 插一次，双座位 / 同轮多步不重复，再下一轮不发并从状态里删掉', async () => {
  const h = harness({ inbox: false, state: { injectQueue: { [SID]: [{ id: 'p1', role: 'user', text: '补一句', at: 'x' }] } } })
  await h.runTurn('第一句', { steps: 3 })
  const t1 = h.requests.filter((q) => q.turn === 1).map((q) => manualIn(q.messages).length)
  assert.deepEqual(t1, [1, 0, 0])
  const first = h.requests[0].messages
  assert.ok(first.findIndex((m) => m.source?.prefill === 'manual') < first.findIndex((m) => m.source?.kind === 'user'))
  // 第 1 步插了不立刻删（中止了还能补发，见下一个用例）；第 2 步看到日志里已有 ⇒ 删
  assert.deepEqual(h.pruned, ['p1'])
  assert.equal(h.st.injectQueue[SID].length, 0)
  await h.runTurn('第二句')
  assert.equal(manualIn(h.requests.at(-1).messages).length, 0)
  assert.deepEqual(h.pruned, ['p1'])
  assert.equal(h.events.filter((e) => e.type === 'user/message' && e.data.source?.prefill === 'manual').length, 1)
})

test('队列 · 第 1 步在落盘前被中止：不丢，下一轮补发且只发一次', async () => {
  const h = harness({ inbox: false, state: { injectQueue: { [SID]: [{ id: 'p2', role: 'user', text: '别丢', at: 'x' }] } } })
  await h.runTurn('第一句', { abortFirstStep: true })
  assert.equal(h.events.filter((e) => e.data?.source?.prefill === 'manual').length, 0)
  assert.equal(h.st.injectQueue[SID].length, 1, '插过但没落盘：还在队列里')
  await h.runTurn('第二句')
  assert.equal(manualIn(h.requests.at(-1).messages).length, 1)
  await h.runTurn('第三句')
  assert.equal(manualIn(h.requests.at(-1).messages).length, 0)
  assert.equal(h.events.filter((e) => e.data?.source?.prefill === 'manual').length, 1)
})

test('planQueued：日志里有的 ⇒ drop；本次消息里已有的 ⇒ 不再插', () => {
  const queue = [
    { id: 'a', role: 'user', text: 'A' },
    { id: 'b', role: 'user', text: 'B' },
    { id: 'c', role: 'user', text: 'C' },
  ]
  const events = [{ type: 'turn/start', data: { turn: 1 } }, { type: 'user/message', data: manualMessage(queue[0]) }]
  const { send, drop } = planQueued(queue, events, [manualMessage(queue[1])])
  assert.deepEqual(drop, ['a'])
  assert.deepEqual(send.map((e) => e.id), ['c'])
})

test('recentDelivered：给面板「已写入会话 · 第 N 轮」', () => {
  const events = [
    { type: 'turn/start', data: { turn: 3 } },
    { type: 'user/message', data: manualMessage({ id: 'r1', role: 'assistant', text: '嗯' }) },
  ]
  assert.deepEqual(recentDelivered(events), [{ id: 'r1', role: 'assistant', text: '嗯', turn: 3 }])
})

// ── 旧 state.injects ─────────────────────────────────────────────────────

test('闸门不再读旧 injects：开跑后不会再每轮发开场对话', async () => {
  const h = harness({ state: { injects: { [SID]: [{ role: 'user', text: '旧注入' }] } } })
  await h.runTurn('一')
  await h.runTurn('二')
  await h.runTurn('三')
  for (const request of h.requests) assert.equal(request.messages.filter((m) => m.source?.kind === 'prefill').length, 0)
})

test('迁移：旧 injects → 每轮注入工作台里的一块自定义积木（文本 = 原先的注入文本），删掉 injects', () => {
  const items = [{ role: 'user', text: '我叫阿明' }, { role: 'assistant', text: '记住了', reasoning: '' }, { role: 'user', text: '   ' }]
  const state = { armed: [], injects: { [SID]: items } }
  const next = migrateLegacyInjects(state)
  assert.equal(next.injects, undefined)
  const entry = next.everyTurn[SID]
  const expected = renderInjectBlock(items.slice(0, 2))
  assert.equal(entry.enabled, true)
  assert.equal(entry.mode, 'always')
  assert.equal(entry.text, expected)
  assert.equal(entry.bench.length, 1)
  assert.equal(entry.bench[0].ref, LEGACY_BLOCK_REF)
  assert.equal(entry.bench[0].text, expected)
  // 原对象没动
  assert.equal(state.injects[SID].length, 3)
})

test('迁移幂等：再迁一次不变；中途断了（积木已在、injects 还在）重跑也只有一块', () => {
  const state = { injects: { [SID]: [{ role: 'user', text: '甲' }] } }
  const once = migrateLegacyInjects(state)
  assert.equal(migrateLegacyInjects(once), once)
  const crashed = { ...once, injects: state.injects }
  const twice = migrateLegacyInjects(crashed)
  assert.equal(twice.everyTurn[SID].bench.filter((b) => b.ref === LEGACY_BLOCK_REF).length, 1)
  assert.deepEqual(twice.everyTurn, once.everyTurn)
})

test('迁移：已有每轮注入工作台 ⇒ 追加到末尾，模式沿用；只有旧 text ⇒ 先迁成工作台再追加', () => {
  const bench = [{ key: 'b1', ref: 'zh', name: '中文', icon: '', first: '', text: '用中文', checks: ['zh'], edited: false, priority: false, builtin: true }]
  const next = migrateLegacyInjects({
    everyTurn: { [SID]: { enabled: true, text: '用中文', firstText: '', mode: 'auto', checks: ['zh'], bench, benchTowers: {}, since: 4 }, s2: { enabled: true, text: '老提醒', firstText: '', mode: 'until', untilTurn: 5 } },
    injects: { [SID]: [{ role: 'user', text: '甲' }], s2: [{ role: 'user', text: '乙' }] },
  })
  const one = next.everyTurn[SID]
  assert.deepEqual(one.bench.map((b) => b.ref), ['zh', LEGACY_BLOCK_REF])
  assert.equal(one.mode, 'auto')
  assert.equal(one.since, 4)
  assert.deepEqual(one.checks, ['zh'])
  assert.equal(one.text, `用中文\n${renderInjectBlock([{ role: 'user', text: '甲' }])}`)
  const two = next.everyTurn.s2
  assert.equal(two.mode, 'until')
  assert.equal(two.untilTurn, 5)
  assert.equal(two.text, `老提醒\n${renderInjectBlock([{ role: 'user', text: '乙' }])}`)
})

test('迁移：本会话没有自己的格但有「新会话默认」⇒ 以默认为底（迁完不丢默认注入），不带 since / override', () => {
  const next = migrateLegacyInjects({
    everyTurn: { '*': { enabled: true, text: '默认', firstText: '', mode: 'always', since: 9, auto: { override: 'stop' } } },
    injects: { [SID]: [{ role: 'user', text: '甲' }] },
  })
  const entry = next.everyTurn[SID]
  assert.ok(entry.text.startsWith('默认\n'))
  assert.equal(entry.since, undefined)
  assert.equal(entry.auto.override, undefined)
  assert.equal(next.everyTurn['*'].since, 9, '默认格本身不动')
})

test('迁移：本会话每轮注入是关的 ⇒ 迁进去但保持关（不替用户打开）', () => {
  const next = migrateLegacyInjects({ everyTurn: { [SID]: { enabled: false, text: '关着的', firstText: '' } }, injects: { [SID]: [{ role: 'user', text: '甲' }] } })
  assert.equal(next.everyTurn[SID].enabled, false)
  assert.equal(next.everyTurn[SID].bench.at(-1).ref, LEGACY_BLOCK_REF)
})

test('items 关着：旧 injects 先不迁（旧行为本来就不发），手动注入照常一次性发出', async () => {
  const state = { enabled: { [SID]: { items: false } }, injects: { [SID]: [{ role: 'user', text: '旧' }] } }
  assert.equal(migrateLegacyInjects(state), state)
  const reopened = migrateLegacyInjects({ ...state, enabled: {} })
  assert.equal(reopened.injects, undefined)
  assert.equal(reopened.everyTurn[SID].bench[0].ref, LEGACY_BLOCK_REF)
  // 手动注入不受「开场对话」开关影响
  const h = harness({ inbox: false, state: { enabled: { [SID]: { items: false } }, injectQueue: { [SID]: [{ id: 'i1', role: 'user', text: '照发', at: 'x' }] } } })
  await h.runTurn('一')
  assert.equal(manualIn(h.requests[0].messages).length, 1)
  assert.deepEqual(applyEnabled(h.st).injectQueue, h.st.injectQueue)
})

test('迁移：全是空行的旧条目直接删；空 injects 表也删掉', () => {
  assert.equal(migrateLegacyInjects({ injects: { [SID]: [{ role: 'user', text: ' ' }] } }).injects, undefined)
  assert.equal('injects' in migrateLegacyInjects({ injects: {} }), false)
  const plain = { armed: [] }
  assert.equal(migrateLegacyInjects(plain), plain)
})

// ── 存成预设：手动注入属于剧情，按角色取回 ─────────────────────────────────

test('session-history：手动注入按角色取回（去掉标注），每轮注入 / 世界书 / 故事记忆照旧跳过', () => {
  const events = [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'user/message', data: { source: { kind: 'prefill', prefill: 'every-turn' }, content: [{ type: 'text', text: '提醒' }] } },
    { type: 'user/message', data: manualMessage({ id: 'h1', role: 'assistant', text: '（她其实早就到了）' }) },
    { type: 'user/message', data: manualMessage({ id: 'h2', role: 'user', text: '我推门进去' }) },
    { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '你好' }] } },
    { type: 'assistant/message', data: { message: { source: { kind: 'model' }, content: [{ type: 'text', text: '你来了' }] } } },
    { type: 'turn/start', data: { turn: 2 } },
    { type: 'user/message', data: { source: { kind: 'prefill', prefill: 'lore' }, content: [{ type: 'text', text: '世界书' }] } },
    { type: 'user/message', data: { source: { kind: 'prefill', prefill: 'memory' }, content: [{ type: 'text', text: '记忆' }] } },
    { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '嗯' }] } },
  ]
  const { items, skipped } = historyToItems(events)
  assert.deepEqual(items, [
    { role: 'assistant', text: '（她其实早就到了）', reasoning: '' },
    { role: 'user', text: '我推门进去' },
    { role: 'user', text: '你好' },
    { role: 'assistant', text: '你来了', reasoning: '' },
    { role: 'user', text: '嗯' },
  ])
  assert.equal(skipped, 3)
})

// ── 面板 ────────────────────────────────────────────────────────────────

test('面板：去掉开场对话区「开跑后每轮注入」那条路，换成独立的手动注入入口，中英文案同步', () => {
  const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /oneClickInject|stopInject|data-prefill-inject=|'data-prefill-inject'/)
  assert.doesNotMatch(src, /injects: \{ \.\.\.\(fresh\?\.state\?\.injects/)
  assert.match(src, /'data-prefill-manual-inject'/)
  assert.match(src, /INJECT_ROUTE = '\/api\/dsh-prefill\/inject'/)
  const impl = readFileSync(new URL('../impl.js', import.meta.url), 'utf8')
  assert.match(impl, /INJECT_ROUTE = '\/api\/dsh-prefill\/inject'/)
  // 两份 i18n 对象都有这些键（中文一份、英文一份）
  for (const key of ['manualTitle', 'manualSend', 'manualRoleUser', 'manualRoleAssistant', 'manualPending', 'manualDelivered', 'manualRunning', 'manualIdle', 'manualWithdraw']) {
    const hits = src.match(new RegExp(`\\n\\s+${key}: `, 'g')) ?? []
    assert.ok(hits.length >= 2, `${key} 应在中英两份文案里各有一份（实际 ${hits.length}）`)
  }
})

test('标注措辞改过也能还原：旧日志里首行是【…】标注的「AI 回答」照样去掉标注', async () => {
  const { unrenderManual } = await import('../inject-once.js')
  assert.equal(unrenderManual('【补充 · 以下视为你（AI）先前已经说过的话，接着往下走，不要复述】\n原话', 'assistant'), '原话')
  assert.equal(unrenderManual(`${ASSISTANT_HEAD}\n原话`, 'assistant'), '原话')
  assert.equal(unrenderManual('【用户自己写的括号】不是标注', 'assistant'), '【用户自己写的括号】不是标注', '没有换行的不当成标注')
  assert.equal(unrenderManual('【标注】\n用户原话', 'user'), '【标注】\n用户原话', '用户角色原样')
})
