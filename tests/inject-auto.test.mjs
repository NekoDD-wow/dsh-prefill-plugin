// 每轮注入自动收放（v0.9）：规则打分、按轮切分、状态机重放、gate 端到端、预设与盖章。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { AUTO_DEFAULTS, replay, scoreTurn, splitTurns, stripCode, zhRatio } from '../inject-auto.js'
import { everyTurnFor, everyTurnStatus, step } from '../gate.js'
import { sanitizeEveryTurn, sanitizeMemorySeed, stampEveryTurn } from '../impl.js'
import { everyTurnPresets } from '../builtin-presets.js'
import { compileCard, parseCard } from '../character-cards.js'

const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/inject-auto/sessions.json', import.meta.url), 'utf8'))
const METRICS = JSON.parse(readFileSync(new URL('./fixtures/inject-auto/metrics.json', import.meta.url), 'utf8'))

// ── 打分：和 analyze.py 同一口径 ────────────────────────────────────────────

test('中文占比与四段判定：和 metrics.json（analyze.py 算的）逐轮一致', () => {
  let compared = 0
  for (const [tag, turns] of Object.entries(FIXTURE)) {
    const real = turns.filter((turn) => turn.hasUser)
    const expected = METRICS[tag].turns
    real.forEach((turn, index) => {
      const want = expected[index]
      if (want === undefined) return
      const z = zhRatio(turn.reasoning.join('\n'))
      if (want.zh === null) assert.equal(z, null, `${tag} 第 ${turn.turn} 轮`)
      else assert.ok(Math.abs(z - want.zh) < 0.006, `${tag} 第 ${turn.turn} 轮 zh ${z} vs ${want.zh}`)
      const steps = turn.reasoning.filter((step) => step.trim() !== '')
      const four = scoreTurn(turn, ['four']).scores.four
      assert.equal(four, `${want.format_steps}/${steps.length}`, `${tag} 第 ${turn.turn} 轮四段`)
      assert.equal(scoreTurn(turn, ['noLeak']).scores.leak === true, want.format_in_answer, `${tag} 第 ${turn.turn} 轮漏进回答`)
      compared += 1
    })
  }
  assert.ok(compared >= 60, `比对了 ${compared} 轮`)
})

test('D1（裸注入）：每一轮都判「四段漏进回答」⇒ fail', () => {
  const real = FIXTURE['D1-everyturn-stop5'].filter((turn) => turn.hasUser)
  for (const turn of real) assert.equal(scoreTurn(turn, ['zh', 'four', 'noLeak']).verdict, 'fail')
})

test('去掉代码 / 路径 / 标识符后再算中文占比', () => {
  const text = '我先看一下 `src/gate.js` 里的 everyTurnFor 函数，再改 impl.js。\n```js\nconst value = readState()\nfunction foo_bar() { return value }\n```\n然后跑一遍单测确认没有回归，最后把结论写进说明文档里给主人看。'
  assert.ok(zhRatio(text) < 0.8)
  assert.ok(zhRatio(stripCode(text)) > 0.95)
})

test('判不了的轮次一律 skip：没思维链、太短、只有 noLeak', () => {
  assert.equal(scoreTurn({ reasoning: [], answer: '好的' }, ['zh']).verdict, 'skip')
  assert.equal(scoreTurn({ reasoning: ['好的，我来回答。'], answer: '好' }, ['zh', 'firstPerson']).verdict, 'skip')
  // 只凭「回答里没漏」不算达标
  assert.equal(scoreTurn({ reasoning: ['ok'], answer: '普通回答' }, ['four', 'noLeak']).verdict, 'skip')
  // 但漏了就是 fail，不管思维链多短
  assert.equal(scoreTurn({ reasoning: ['ok'], answer: '【理解】a\n【拆解】b\n【验证】c\n【结论】d' }, ['four', 'noLeak']).verdict, 'fail')
})

test('第一人称：旁观者词 0 次 pass、1 次 weak、2 次 fail', () => {
  const base = '我觉得主人今天心情不错，我该陪他多聊一会儿，顺便提醒他早点休息，明天还要早起去上班呢，不能熬夜。我还想给他泡一杯热牛奶，再把明天要带的东西提前收拾好。'
  assert.equal(scoreTurn({ reasoning: [base], answer: 'x' }, ['firstPerson']).verdict, 'pass')
  assert.equal(scoreTurn({ reasoning: [`${base}用户想聊天。`], answer: 'x' }, ['firstPerson']).verdict, 'weak')
  assert.equal(scoreTurn({ reasoning: [`${base}用户想聊天，我在扮演角色。`], answer: 'x' }, ['firstPerson']).verdict, 'fail')
})

// ── 按轮切分 ───────────────────────────────────────────────────────────────

test('splitTurns：认出合成开场轮、每轮注入、未完成轮', () => {
  const events = [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'user/message', data: { source: { kind: 'user', prefill: 'probe' }, content: [{ type: 'text', text: '开场' }] } },
    { type: 'assistant/message', data: { message: { source: { kind: 'model', provider: 'prefill-probe' }, content: [{ type: 'text', text: '你好' }] } } },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    { type: 'turn/start', data: { turn: 2 } },
    { type: 'user/message', data: { source: { kind: 'prefill', prefill: 'every-turn' }, content: [{ type: 'text', text: '提醒' }] } },
    { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '问题' }] } },
    { type: 'assistant/message', data: { message: { source: { kind: 'model' }, content: [{ type: 'reasoning', text: '想一想' }, { type: 'text', text: '第一步' }] } } },
    { type: 'assistant/message', data: { message: { source: { kind: 'model' }, content: [{ type: 'reasoning', text: '再想' }, { type: 'text', text: '第二步' }] } } },
    { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } },
    { type: 'turn/start', data: { turn: 3 } },
    { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '取消的' }] } },
    { type: 'turn/end', data: { turn: 3, reason: { kind: 'cancelled' } } },
  ]
  const turns = splitTurns(events)
  assert.deepEqual(turns.map((t) => [t.turn, t.synthetic, t.injected, t.completed]), [
    [1, true, false, true],
    [2, false, true, true],
    [3, false, false, false],
  ])
  assert.deepEqual(turns[1].reasoning, ['想一想', '再想'])
  assert.equal(turns[1].answer, '第一步\n\n第二步')
})

// ── 状态机 ─────────────────────────────────────────────────────────────────

const ZH = '我先理解问题，再一步步拆开来想清楚，最后验证一下结论是否站得住脚，确认无误之后再整理成回答，整个过程都用中文来思考，不夹杂英文。这样主人看到的思路也更清楚，我也更容易发现自己哪里想错了。'
const EN = 'Let me think about this step by step. First I need to understand the question, then break it down and verify the conclusion before answering.'
const WEAK = `${ZH.slice(0, 60)} Let me also double check the numbers here and there once more, and then verify the final output format carefully.`
const kinds = { p: ZH, f: EN, w: WEAK, s: '' }

/** 造一串轮次：script 每个字符一轮（p/w/f/s），injected 取状态机自己给出的决定（模拟真实运行）。 */
function simulate(script, entry = { mode: 'auto', checks: ['zh'] }, { overrides = {} } = {}) {
  const turns = []
  const plan = []
  for (let index = 0; index < script.length; index += 1) {
    const turnNo = index + 1
    const current = { ...entry, ...(overrides[turnNo] ?? {}) }
    const decision = replay(turns, current, turnNo)
    plan.push(decision.inject ? 'I' : '.')
    const text = kinds[script[index]]
    turns.push({ turn: turnNo, completed: true, synthetic: false, hasUser: true, injected: decision.inject, reasoning: text === '' ? [] : [text], answer: '回答' })
    entry = current
  }
  const last = replay(turns, entry, script.length + 1)
  return { plan: plan.join(''), last }
}

test('自检：三种造出来的轮次分别判 pass / weak / fail', () => {
  assert.equal(scoreTurn({ reasoning: [ZH] }, ['zh']).verdict, 'pass')
  assert.equal(scoreTurn({ reasoning: [WEAK] }, ['zh']).verdict, 'weak')
  assert.equal(scoreTurn({ reasoning: [EN] }, ['zh']).verdict, 'fail')
})

test('一直达标：注入 3 轮 → 试停 2 轮 → 已暂停', () => {
  const { plan, last } = simulate('pppppppp')
  assert.equal(plan, 'III.....')
  assert.equal(last.state, 'paused')
})

test('warmup 没满不停：W=5 时要注入满 5 轮', () => {
  const { plan } = simulate('pppppppp', { mode: 'auto', checks: ['zh'], auto: { warmup: 5 } })
  assert.equal(plan, 'IIIII...')
})

test('skip 不打断也不计数', () => {
  const { plan } = simulate('psppsppp')
  // 第 1、3、4 轮 pass（第 2 轮 skip 不算）⇒ 第 5 轮起试停
  assert.equal(plan, 'IIII....')
})

test('weak 打断连续计数', () => {
  const { plan } = simulate('ppwppppp')
  assert.equal(plan, 'IIIIII..')
})

test('试停期一轮不达标立刻恢复；第 2 次试停失败时 K 翻倍', () => {
  // ppp → 试停；第 4 轮 w ⇒ 恢复；ppp → 再试停；第 8 轮 f ⇒ 恢复且 K=6
  const { plan, last } = simulate('pppwpppfpppppp')
  assert.equal(plan, 'III.III.IIIIII')
  assert.equal(last.need, 6)
  assert.equal(last.resumes, 0)
})

test('已暂停：单轮 fail 不恢复，3 轮里 2 轮 fail 才恢复（K 翻倍）', () => {
  const { plan, last } = simulate('pppppfpfpp')
  // 1-3 注入，4-5 试停通过，6 fail（观察），7 pass，8 fail ⇒ 窗口 [f,p,f] 恢复，第 9 轮起注入
  assert.equal(plan, 'III.....II')
  assert.equal(last.state, 'injecting')
  assert.equal(last.need, 6)
  assert.equal(last.resumes, 1)
})

test('已暂停：1 fail + 1 weak 也恢复', () => {
  const { plan } = simulate('pppppfwp')
  assert.equal(plan, 'III....I')
})

test('恢复 R 次后转常开', () => {
  const entry = { mode: 'auto', checks: ['zh'], auto: { streak: 1, warmup: 1, probation: 1, maxResumes: 2 } }
  // K=1：p 试停，p 暂停，ff 恢复(K=2)；pp 试停，p 暂停，ff 恢复 ⇒ 第 2 次 ⇒ 常开
  const { plan, last } = simulate('pppffpppffpppp', entry)
  assert.equal(last.state, 'always')
  assert.equal(plan.slice(-4), 'IIII')
})

test('手动覆盖：立即暂停 / 立即恢复按轮号生效', () => {
  const pause = simulate('ffffffff', { mode: 'auto', checks: ['zh'] }, { overrides: { 4: { auto: { override: { action: 'pause', atTurn: 4 } } } } })
  assert.equal(pause.plan.slice(0, 4), 'III.')
  const resume = simulate('pppppppp', { mode: 'auto', checks: ['zh'] }, { overrides: { 7: { auto: { override: { action: 'resume', atTurn: 7 } } } } })
  assert.equal(resume.plan, 'III...II')
})

test('since：配置重新开始后只看之后的轮次', () => {
  const turns = [1, 2, 3, 4, 5].map((turn) => ({ turn, completed: true, hasUser: true, injected: true, reasoning: [ZH], answer: 'a' }))
  assert.equal(replay(turns, { mode: 'auto', checks: ['zh'] }, 6).inject, false)
  assert.equal(replay(turns, { mode: 'auto', checks: ['zh'], since: 5 }, 6).inject, true)
})

test('没有检查项的 auto 等于一直注入；看不到思维链也一直注入', () => {
  assert.equal(simulate('pppppp', { mode: 'auto', checks: [] }).plan, 'IIIIII')
  assert.equal(simulate('ssssss').plan, 'IIIIII')
})

test('首轮专用段那一轮不参与判定', () => {
  const { plan } = simulate('pppppp', { mode: 'auto', checks: ['zh'], firstText: '完整要求' })
  assert.equal(plan, 'IIII..')
})

test('旧数据兼容：没有 mode 时按 untilTurn 推断', () => {
  assert.equal(simulate('pppppp', { untilTurn: 2 }).plan, 'II....')
  assert.equal(simulate('pppppp', { untilTurn: 0 }).plan, 'IIIIII')
})

test('用 D4 实测数据重放：step-5 第一人称一直不够稳，不会停', () => {
  const turns = FIXTURE['D4-everyturn-firstperson-wrapped']
  const result = replay(turns, { mode: 'auto', checks: ['zh', 'firstPerson'] }, turns.at(-1).turn + 1)
  assert.equal(result.state, 'injecting')
  assert.ok(result.history.some((h) => h.verdict === 'pass'))
})

// ── gate 端到端：真的走 step()，事件写回会话，模拟插件重载 ───────────────────

async function runSession(entry, script) {
  const events = []
  const state = { version: 2, armed: [], levers: {}, allowKinds: [], everyTurn: { s1: entry } }
  const notes = []
  const sent = []
  for (let index = 0; index < script.length; index += 1) {
    const turn = index + 1
    const api = { readState: () => state, note: (e) => notes.push(e), latches: new Map(), unlatch() {}, rootCtx: undefined }
    const agent = { id: 's1', session: { snapshotEvents: () => events } }
    const decision = { kind: 'enter', messages: [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: `问题${turn}` }] }] }
    const seat = { agent, turn, step: 1, __seat: 'test' }
    const out = await step(api, seat, decision)
    // 双座位：同一轮再经过一次，结果必须一样
    const again = await step(api, seat, decision)
    const injected = out.messages.filter((m) => m.source?.prefill === 'every-turn')
    assert.equal(again.messages.filter((m) => m.source?.prefill === 'every-turn').length, injected.length)
    sent.push(injected.length > 0 ? (injected[0].content[0].text.includes('完整要求') ? 'F' : 'I') : '.')
    events.push({ type: 'turn/start', data: { turn } })
    for (const message of out.messages) events.push({ type: 'user/message', data: message })
    const text = kinds[script[index]]
    events.push({ type: 'assistant/message', data: { message: { source: { kind: 'model' }, content: [...(text ? [{ type: 'reasoning', text }] : []), { type: 'text', text: '回答' }] } } })
    events.push({ type: 'turn/end', data: { turn, reason: { kind: 'completed' } } })
  }
  return { sent: sent.join(''), notes, events, state }
}

test('gate 端到端：自动模式稳定后停注、跑偏后恢复，每轮都"重载"也不乱', async () => {
  const { sent, notes } = await runSession({ enabled: true, text: '【思考语言】中文', firstText: '', mode: 'auto', checks: ['zh'] }, 'pppppppffppp')
  assert.equal(sent, 'III......III')
  const autoNotes = notes.filter((n) => n.everyTurn === 'auto')
  assert.ok(autoNotes.length >= 12)
  assert.equal(autoNotes.at(-1).state, 'injecting')
})

test('gate 端到端：首轮专用段只发一次（插件重载不再重发）', async () => {
  const { sent } = await runSession({ enabled: true, text: '每轮提醒', firstText: '完整要求', mode: 'always' }, 'pppp')
  assert.equal(sent, 'FIII')
})

test('gate 端到端：只注入前 N 轮按历史计数', async () => {
  const { sent } = await runSession({ enabled: true, text: '提醒', untilTurn: 2 }, 'pppp')
  assert.equal(sent, 'II..')
})

test('everyTurnStatus：给面板的只读判定', async () => {
  const { events, state } = await runSession({ enabled: true, text: '提醒', mode: 'auto', checks: ['zh'] }, 'ppppp')
  const status = everyTurnStatus(state, 's1', events)
  assert.equal(status.enabled, true)
  assert.equal(status.nextTurn, 6)
  assert.equal(status.state, 'paused')
  assert.equal(status.history.length, 5)
})

test("everyTurnFor：通配格 '*' 不带别的会话的 since / override", () => {
  const state = { everyTurn: { '*': { enabled: true, text: 'x', mode: 'auto', checks: ['zh'], since: 9, auto: { override: { action: 'pause', atTurn: 3 } } } } }
  const entry = everyTurnFor(state, 'new-session')
  assert.equal(entry.since, 0)
  assert.equal(entry.auto.override, undefined)
  assert.equal(entry.mode, 'auto')
})

// ── 预设：存配置不存状态；截轮与记忆摘要 ────────────────────────────────────

test('sanitizeEveryTurn：只留配置，去掉 since / override；auto 没检查项退回普通模式', () => {
  const clean = sanitizeEveryTurn({ enabled: true, text: 't', firstText: '', mode: 'auto', checks: ['zh', 'bogus'], since: 7, auto: { warmup: 4, override: { action: 'pause', atTurn: 2 } } })
  assert.deepEqual(clean, { enabled: true, text: 't', firstText: '', mode: 'auto', untilTurn: 0, checks: ['zh'], auto: { warmup: 4, streak: AUTO_DEFAULTS.streak, probation: AUTO_DEFAULTS.probation } })
  assert.equal(sanitizeEveryTurn({ enabled: true, text: 't', mode: 'auto', checks: [], untilTurn: 3 }).mode, 'until')
  assert.equal(sanitizeEveryTurn({ enabled: false, text: 't' }), undefined)
  assert.equal(sanitizeEveryTurn({ enabled: true, text: ' ', firstText: '' }), undefined)
})

test('sanitizeMemorySeed', () => {
  assert.deepEqual(sanitizeMemorySeed({ text: ' 前情 ', throughTurn: '3' }), { text: '前情', throughTurn: 3 })
  assert.equal(sanitizeMemorySeed({ text: '' }), undefined)
})

test('stampEveryTurn：重新开始盖 since；改参数沿用；覆盖按下一轮盖章；通配格不盖', () => {
  const previous = { s1: { enabled: true, text: 'a', mode: 'auto', checks: ['zh'], since: 3, auto: {} } }
  const last = () => 10
  // 只改参数：沿用 since
  assert.equal(stampEveryTurn(previous, { s1: { ...previous.s1, auto: { warmup: 5 } } }, last).s1.since, 3)
  // 改正文：重新开始
  assert.equal(stampEveryTurn(previous, { s1: { ...previous.s1, text: 'b' } }, last).s1.since, 11)
  // 打开
  assert.equal(stampEveryTurn({ s1: { ...previous.s1, enabled: false } }, { s1: previous.s1 }, last).s1.since, 11)
  // 立即暂停
  const paused = stampEveryTurn(previous, { s1: { ...previous.s1, auto: { override: { action: 'pause' } } } }, last).s1
  assert.deepEqual(paused.auto.override, { action: 'pause', atTurn: 11 })
  // 之后的普通编辑不带 override ⇒ 沿用
  assert.deepEqual(stampEveryTurn({ s1: paused }, { s1: { ...previous.s1, auto: { warmup: 2 } } }, last).s1.auto.override, { action: 'pause', atTurn: 11 })
  // 重新开始清掉 override
  assert.equal(stampEveryTurn({ s1: paused }, { s1: { ...previous.s1, text: 'c' } }, last).s1.auto.override, undefined)
  // 通配格原样
  const star = { enabled: true, text: 'x' }
  assert.equal(stampEveryTurn({}, { '*': star }, last)['*'], star)
})

test('内置每轮注入预设：除「简短思考」外都带 checks', () => {
  const byId = Object.fromEntries(everyTurnPresets().map((p) => [p.id, p]))
  assert.deepEqual(byId['four-section'].checks, ['zh', 'four', 'noLeak'])
  assert.deepEqual(byId['zh-thinking'].checks, ['zh'])
  assert.equal(byId['brief-thinking'].checks, undefined)
})

test('角色卡：要求中文 / 第一人称思考时强化注入默认自动；写了 untilTurn 的照旧', () => {
  const card = parseCard({ spec: 'chara_card_v2', data: { name: '小猫', description: '一只猫', first_mes: '喵', post_history_instructions: '保持猫的口吻' } })
  const auto = compileCard(card, { thinking: { language: 'zh', firstPerson: true }, reinforce: { enabled: true } })
  assert.equal(auto.everyTurn.mode, 'auto')
  assert.deepEqual(auto.everyTurn.checks, ['zh', 'firstPerson'])
  const until = compileCard(card, { thinking: { language: 'zh' }, reinforce: { enabled: true, untilTurn: 4 } })
  assert.equal(until.everyTurn.mode, 'until')
  const plain = compileCard(card, { thinking: { language: null, firstPerson: false }, reinforce: { enabled: true } })
  assert.equal(plain.everyTurn.mode, 'always')
})
