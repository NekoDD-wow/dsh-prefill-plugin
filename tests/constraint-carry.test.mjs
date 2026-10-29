// 约束承接：存预设时带上会话里生效过的每轮约束（不论来自本会话、'*' 还是角色卡），
// 新会话第一条真实消息那一轮发一次「首轮段 + 接缝提醒」，自动模式不把导入的开场历史算进遵守判定。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { detectConstraints, mergeCarried, seamApplies, seamLine, SEAM_LINES, unwrapInjected, withSeam } from '../constraint-carry.js'
import { everyTurnBlocks } from '../builtin-presets.js'
import { everyTurnFor, step } from '../gate.js'
import { replay, splitTurns } from '../inject-auto.js'
import { carriedPresetFields, sanitizeEveryTurn } from '../impl.js'

const ZH_TEXT = everyTurnBlocks().find((block) => block.id === 'zh-thinking').text
const HEAD = '【预填装 · 会话内注入】以下内容视为本会话开始前就已存在的背景：\n用户：'

/** 造一段带每轮注入的真实会话：texts[i] = 第 i+1 轮注入的约束文字（null = 这轮没注入）。 */
function sessionWith(texts) {
  const events = []
  texts.forEach((text, index) => {
    const turn = index + 1
    events.push({ type: 'turn/start', data: { turn } })
    if (text !== null) events.push({ type: 'user/message', data: { role: 'user', source: { kind: 'prefill', prefill: 'every-turn' }, content: [{ type: 'text', text: HEAD + text }] } })
    events.push({ type: 'user/message', data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: `问题${turn}` }] } })
    events.push({ type: 'assistant/message', data: { message: { source: { kind: 'model' }, content: [{ type: 'reasoning', text: '想' }, { type: 'text', text: `回答${turn}` }] } } })
    events.push({ type: 'turn/end', data: { turn, reason: { kind: 'completed' } } })
  })
  return events
}

test("检出：约束来自 '*'（新会话默认）也能认出来，本会话那格是空的", () => {
  const events = sessionWith([ZH_TEXT, ZH_TEXT, ZH_TEXT])
  const state = { everyTurn: { '*': { enabled: true, text: ZH_TEXT, mode: 'always', checks: ['zh'] } } }
  const { constraints, injected } = detectConstraints(events, state, 's1', { catalog: everyTurnBlocks() })
  assert.equal(injected, 3)
  assert.equal(constraints.length, 1)
  assert.equal(constraints[0].source, 'default')
  assert.equal(constraints[0].name, '中文思考')
  assert.equal(constraints[0].text, ZH_TEXT)
  assert.deepEqual(constraints[0].checks, ['zh'])
  assert.equal(constraints[0].turns, 3)
  assert.equal(constraints[0].checked, true)
})

test('检出：本会话那格来自角色卡（slotSource）标成 card；按轮次范围只看截取的几轮', () => {
  const card = '思维链也用小夏的第一人称来想，不要把对方称为"用户"。思维链（reasoning）全程用中文。'
  const events = sessionWith([card, card, null, card])
  const state = { everyTurn: { s1: { enabled: true, text: card } }, slotSource: { s1: { everyTurn: { from: 'card', fp: 'x' } } } }
  const { constraints } = detectConstraints(events, state, 's1', { fromTurn: 1, toTurn: 2 })
  assert.equal(constraints.length, 1)
  assert.equal(constraints[0].source, 'card')
  assert.equal(constraints[0].turns, 2)
  assert.equal(constraints[0].lastTurn, 2)
})

test('检出：工作台按块拆；首轮段也认；本会话那格还没发过的块照样列出', () => {
  const bench = [
    { key: 'b1', ref: 'rp-first', name: '角色扮演·首轮要求', first: '完整要求', text: '', checks: ['zh', 'firstPerson'] },
    { key: 'b2', ref: 'first-person', name: '第一人称', first: '', text: '第一人称提醒', checks: ['firstPerson'] },
    { key: 'b3', ref: 'brief', name: '简短', first: '', text: '后来加的', checks: [] },
  ]
  const events = sessionWith(['完整要求\n第一人称提醒', '第一人称提醒'])
  const state = { everyTurn: { s1: { enabled: true, bench, text: '第一人称提醒\n后来加的', firstText: '完整要求\n第一人称提醒\n后来加的' } } }
  const { constraints } = detectConstraints(events, state, 's1', {})
  assert.deepEqual(constraints.map((c) => [c.ref, c.turns, c.source]), [
    ['rp-first', 1, 'session'],
    ['first-person', 2, 'session'],
    ['brief', 0, 'session'],
  ])
  assert.ok(constraints.every((c) => c.checked))
})

test('检出：配置后来改掉了，历史里发过的原文仍列出（最新一版默认勾，旧版不勾），内置积木按原文认名字', () => {
  const events = sessionWith(['旧的自定义提醒', '旧的自定义提醒', `新的提醒\n${ZH_TEXT}`])
  const state = { everyTurn: {} }
  const { constraints } = detectConstraints(events, state, 's1', { catalog: everyTurnBlocks() })
  const byText = Object.fromEntries(constraints.map((c) => [c.text, c]))
  assert.equal(byText[ZH_TEXT].source, 'builtin')
  assert.equal(byText[ZH_TEXT].ref, 'zh-thinking')
  assert.equal(byText['新的提醒'].source, 'history')
  assert.equal(byText['新的提醒'].checked, true)
  assert.equal(byText['旧的自定义提醒'].checked, false)
})

test('拆包：去外壳、去接缝提醒；接缝文案按约束语言选中英', () => {
  assert.equal(unwrapInjected(HEAD + withSeam(ZH_TEXT)), ZH_TEXT)
  assert.equal(unwrapInjected(HEAD + withSeam('Think in English bullet points.')), 'Think in English bullet points.')
  assert.equal(seamLine(ZH_TEXT), SEAM_LINES.zh)
  assert.equal(seamLine('Use first person.'), SEAM_LINES.en)
  assert.equal(withSeam(ZH_TEXT), `${ZH_TEXT}\n${SEAM_LINES.zh}`)
})

test('合并：勾上的约束编成工作台，模式沿用本会话那格；sanitize 保留 seam 标记', () => {
  const carried = [
    { ref: 'zh-thinking', name: '中文思考', first: '', text: ZH_TEXT, checks: ['zh'], source: 'default' },
    { ref: '', name: '', first: '首轮完整要求', text: '每轮人称提醒', checks: ['firstPerson'], source: 'history' },
  ]
  const raw = mergeCarried(carried, { mode: 'auto', untilTurn: 0, auto: { warmup: 2, streak: 3, probation: 2 } })
  const cfg = sanitizeEveryTurn(raw)
  assert.equal(cfg.seam, true)
  assert.equal(cfg.mode, 'auto')
  assert.equal(cfg.auto.warmup, 2)
  assert.equal(cfg.text, `${ZH_TEXT}\n每轮人称提醒`)
  assert.equal(cfg.firstText, `${ZH_TEXT}\n首轮完整要求`)
  assert.deepEqual(cfg.checks, ['zh', 'firstPerson'])
  assert.equal(cfg.bench[1].ref, 'carry-2')
  assert.equal(mergeCarried([], {}), undefined)
  // 没带 seam 的旧配置照旧没有这个字段。
  assert.equal('seam' in sanitizeEveryTurn({ enabled: true, text: 'x' }), false)
})

test('存预设 / 导入：carried 决定每轮注入，fromSession 标记保留；没给 carried 照旧', () => {
  const body = {
    fromSession: true,
    everyTurn: { enabled: true, text: '本会话自己的', mode: 'until', untilTurn: 5 },
    carried: [{ ref: 'zh-thinking', name: '中文思考', first: '', text: ZH_TEXT, checks: ['zh'] }],
  }
  const out = carriedPresetFields(body, { layered: false })
  assert.equal(out.fromSession, true)
  assert.equal(out.everyTurn.text, ZH_TEXT)
  assert.equal(out.everyTurn.mode, 'until')
  assert.equal(out.everyTurn.untilTurn, 5)
  assert.equal(out.everyTurn.seam, true)
  // 一条都不勾：普通预设不带每轮注入；基于角色卡的预设明确存 null（不回落到卡的提醒）。
  assert.equal(carriedPresetFields({ ...body, carried: [] }, { layered: false }).everyTurn, undefined)
  assert.equal(carriedPresetFields({ ...body, carried: [] }, { layered: true }).everyTurn, null)
  // 没走「从当前会话取」：和以前一样只看 everyTurn，没有 fromSession。
  const plain = carriedPresetFields({ everyTurn: { enabled: true, text: 'x' } }, { layered: false })
  assert.equal(plain.fromSession, undefined)
  assert.equal(plain.everyTurn.text, 'x')
})

test("everyTurnFor：seam 只认本会话那格，'*' 里的不算", () => {
  const entry = { enabled: true, text: 'x', seam: true }
  assert.equal(everyTurnFor({ everyTurn: { s1: entry } }, 's1').seam, true)
  assert.equal(everyTurnFor({ everyTurn: { '*': entry } }, 's1').seam, false)
  assert.equal(everyTurnFor({ everyTurn: { s1: { enabled: true, text: 'x' } } }, 's1').seam, false)
})

/** 开场：预填装写进历史的两轮合成轮（和 writeSyntheticTurns 同形状）。 */
function imported() {
  const events = []
  for (const turn of [1, 2]) {
    events.push({ type: 'turn/start', data: { turn } })
    events.push({ type: 'user/message', data: { role: 'user', source: { kind: 'user', prefill: 'dsh-prefill' }, content: [{ type: 'text', text: `旧问题${turn}` }] } })
    events.push({ type: 'assistant/message', data: { message: { source: { kind: 'model', provider: 'prefill-probe', model: 'prefill-probe' }, content: [{ type: 'text', text: `Old answer ${turn}` }] } } })
    events.push({ type: 'turn/end', data: { turn, reason: { kind: 'completed' } } })
  }
  return events
}

const ZH_REASONING = '我先理解问题，再一步步拆开来想清楚，最后验证一下结论是否站得住脚，确认无误之后再整理成回答，整个过程都用中文来思考，不夹杂英文。这样看到的思路也更清楚，我也更容易发现自己哪里想错了。'

async function runImported(entry, rounds, key = 's1') {
  const events = imported()
  const state = { version: 2, armed: [], levers: {}, allowKinds: [], everyTurn: { [key]: entry } }
  const sent = []
  for (let index = 0; index < rounds; index += 1) {
    const turn = 3 + index
    const api = { readState: () => state, note() {}, latches: new Map(), unlatch() {}, rootCtx: undefined }
    const agent = { id: 's1', session: { snapshotEvents: () => events } }
    const decision = { kind: 'enter', messages: [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: `新问题${turn}` }] }] }
    const out = await step(api, { agent, turn, step: 1, __seat: 'test' }, decision)
    const injected = out.messages.find((m) => m.source?.prefill === 'every-turn')
    sent.push(injected ?? null)
    events.push({ type: 'turn/start', data: { turn } })
    for (const message of out.messages) events.push({ type: 'user/message', data: message })
    events.push({ type: 'assistant/message', data: { message: { source: { kind: 'model' }, content: [{ type: 'reasoning', text: ZH_REASONING }, { type: 'text', text: '回答' }] } } })
    events.push({ type: 'turn/end', data: { turn, reason: { kind: 'completed' } } })
  }
  return { sent, events }
}

test('gate 端到端：来自会话的预设，第一条真实消息那轮发「首轮段 + 接缝提醒」，之后照常', async () => {
  const { sent } = await runImported({ enabled: true, text: '每轮提醒', firstText: '首轮完整要求', mode: 'always', seam: true }, 3)
  const texts = sent.map((m) => m?.content?.[0]?.text ?? '')
  assert.ok(texts[0].endsWith(`首轮完整要求\n${SEAM_LINES.zh}`), texts[0])
  assert.equal(sent[0].source.seam, true)
  assert.ok(texts[1].endsWith('每轮提醒') && !texts[1].includes(SEAM_LINES.zh))
  assert.ok(texts[2].endsWith('每轮提醒'))
  // 拆包后还是原约束（再存一次预设时能认出来）。
  assert.equal(unwrapInjected(texts[0]), '首轮完整要求')
})

test('gate 端到端：没有 seam 标记 / 来自 * / 开场里没有导入历史，都不加接缝提醒', async () => {
  const plain = await runImported({ enabled: true, text: '每轮提醒', mode: 'always' }, 1)
  assert.ok(!plain.sent[0].content[0].text.includes(SEAM_LINES.zh))
  const wild = await runImported({ enabled: true, text: '每轮提醒', mode: 'always', seam: true }, 1, '*')
  assert.ok(!wild.sent[0].content[0].text.includes(SEAM_LINES.zh))
  assert.equal(wild.sent[0].source.from, 'default')
  // 开场里没有导入历史（普通新会话）：有 seam 也不加。
  assert.equal(seamApplies({ seam: true }, [{ turn: 1, synthetic: false }], true), false)
  assert.equal(seamApplies({ seam: true }, [{ turn: 1, synthetic: true }], true), true)
  assert.equal(seamApplies({ seam: true }, [{ turn: 1, synthetic: true }], false), false)
})

test('自动模式：导入的开场历史不计入遵守判定，接缝那轮不判，从预热开始', async () => {
  const entry = { enabled: true, text: '提醒', mode: 'auto', checks: ['zh'], auto: { warmup: 3, streak: 3, probation: 2 }, seam: true }
  const { events, sent } = await runImported(entry, 4)
  assert.ok(sent.every((m) => m !== null), '预热期每轮都注入')
  const cfg = everyTurnFor({ everyTurn: { s1: entry } }, 's1')
  const result = replay(splitTurns(events), cfg, 7)
  // 合成轮（1、2）不进 history；接缝那轮（3）记 skip，不算预热；4–6 三轮 pass ⇒ 刚好满预热进入试停。
  assert.deepEqual(result.history.map((h) => [h.turn, h.verdict]), [[3, 'skip'], [4, 'pass'], [5, 'pass'], [6, 'pass']])
  assert.equal(result.evaluated, 3)
  assert.equal(result.state, 'trial')
})

test('面板：存预设带上检出的约束（复选框），中英文案齐全；新文件在 files 白名单里', () => {
  const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  assert.match(src, /data-prefill-carry-list/)
  assert.match(src, /data-prefill-carry-item/)
  assert.match(src, /fromSession: true, carried:/)
  for (const key of ['carryTitle', 'carryHint', 'carrySrcSession', 'carrySrcDefault', 'carrySrcCard', 'carrySrcPreset', 'carrySrcBuiltin', 'carrySrcHistory', 'carryTurns', 'carryNotYet', 'carryUnnamed']) {
    const hits = src.match(new RegExp(`\\n\\s+${key}: '`, 'g')) ?? []
    assert.equal(hits.length, 2, `${key} 要有中英两份`)
  }
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.ok(pkg.files.includes('constraint-carry.js'))
})
