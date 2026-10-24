import assert from 'node:assert/strict'
import test from 'node:test'
import { historyToItems } from '../session-history.js'

const turn = (n) => ({ type: 'turn/start', data: { turn: n } })
const user = (text, source = { kind: 'user' }) => ({ type: 'user/message', data: { role: 'user', source, content: [{ type: 'text', text }] } })
const ai = (n, parts, provider = 'dsapi') => ({
  type: 'assistant/message',
  data: { turn: n, message: { role: 'assistant', source: { kind: 'model', provider, model: 'x' }, content: parts } },
})
const text = (t) => ({ type: 'text', text: t })
const think = (t) => ({ type: 'reasoning', text: t })
const call = (name) => ({ type: 'tool-call', name, callId: name, arguments: '{}' })

// 一段典型会话：首轮是合成的开场白，之后每轮前面有插件注入，第 3 轮带工具调用（两步）。
const events = [
  { type: 'session', data: {} },
  turn(1),
  ai(1, [text('（推门进来）你来啦。')], 'prefill-probe'),
  turn(2),
  user('【每轮注入】……', { kind: 'prefill', prefill: 'every-turn' }),
  user('【世界书】……', { kind: 'prefill', prefill: 'lore' }),
  user('今晚九点器材室见？'),
  user('Current runtime context.', { kind: 'runtime-context' }),
  ai(2, [think('她在约时间'), text('好，九点见。')]),
  turn(3),
  user('【故事记忆】……', { kind: 'prefill', prefill: 'memory' }),
  user('帮我记一下'),
  ai(3, [think('先写文件'), text('我记一下。'), call('write')]),
  { type: 'tool/result', data: { turn: 3, message: { role: 'tool', content: [text('ok')] } } },
  ai(3, [think('写好了'), text('记好了：九点，器材室。')]),
  turn(4),
  user('   '),
  ai(4, [text('')]),
]

test('只取用户原话和模型回答，丢掉注入、runtime-context、工具结果', () => {
  const { items, turnCount, lastTurn, toolCalls, skipped } = historyToItems(events)
  assert.deepEqual(items, [
    { role: 'assistant', text: '（推门进来）你来啦。', reasoning: '' },
    { role: 'user', text: '今晚九点器材室见？' },
    { role: 'assistant', text: '好，九点见。', reasoning: '' },
    { role: 'user', text: '帮我记一下' },
    { role: 'assistant', text: '我记一下。\n\n记好了：九点，器材室。', reasoning: '' },
  ])
  assert.equal(turnCount, 3)
  assert.equal(lastTurn, 4)
  assert.equal(toolCalls, 1)
  assert.equal(skipped, 3)
})

test('reasoning:true 时带上思维链，同一轮多步合并', () => {
  const { items } = historyToItems(events, { reasoning: true })
  assert.equal(items[2].reasoning, '她在约时间')
  assert.equal(items[4].reasoning, '先写文件\n\n写好了')
})

test('toTurn / fromTurn 截取轮次（当分支点用）', () => {
  assert.deepEqual(
    historyToItems(events, { toTurn: 2 }).items.map((item) => item.text),
    ['（推门进来）你来啦。', '今晚九点器材室见？', '好，九点见。'],
  )
  assert.deepEqual(
    historyToItems(events, { fromTurn: 3 }).items.map((item) => item.text),
    ['帮我记一下', '我记一下。\n\n记好了：九点，器材室。'],
  )
})

test('空会话 / 坏输入不抛错', () => {
  assert.deepEqual(historyToItems([]).items, [])
  assert.deepEqual(historyToItems(undefined).items, [])
  assert.deepEqual(historyToItems([{ type: 'user/message' }, null, { type: 'assistant/message', data: null }]).items, [])
})
