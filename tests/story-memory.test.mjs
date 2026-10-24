// 角色卡三期：故事记忆。
import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanMemory, compileCard, memoryDue, memoryInput, memorySystemPrompt, parseCard, renderMemory } from '../character-cards.js'
import { dialogueByTurn, memoryFor, routeLabel, summarizeMemory } from '../gate.js'

const card = parseCard({ spec: 'chara_card_v2', spec_version: '2.0', data: { name: '阿澄', description: '书店店员', first_mes: '欢迎光临。' } })

test('compileCard 默认开记忆，每 8 轮；选项和卡内设置都能改', () => {
  assert.deepEqual(compileCard(card).memory, { enabled: true, every: 8, maxChars: 800, char: '阿澄', user: '' })
  assert.equal(compileCard(card, { memory: false }).memory.enabled, false)
  assert.equal(compileCard(card, { memoryEvery: 3, userName: '小林' }).memory.every, 3)
  assert.equal(compileCard(card, { userName: '小林' }).memory.user, '小林')
  const tuned = parseCard({ ...card, data: { ...card.data, extensions: { dsh_prefill: { memory: { every: 5, maxChars: 300, enabled: false } } } } })
  assert.deepEqual(compileCard(tuned).memory, { enabled: false, every: 5, maxChars: 300, char: '阿澄', user: '' })
})

test('memoryDue：多出 every 轮才总结', () => {
  assert.equal(memoryDue(7, 0, 8), false)
  assert.equal(memoryDue(8, 0, 8), true)
  assert.equal(memoryDue(15, 8, 8), false)
  assert.equal(memoryDue(16, 8, 8), true)
  assert.equal(memoryDue(NaN, 0, 8), false)
})

test('memoryInput / renderMemory / prompt / clean', () => {
  const input = memoryInput('', [{ who: 'char', text: '欢迎光临。' }, { who: 'user', text: '有推理小说吗' }, { who: 'user', text: '  ' }], { char: '阿澄', user: '小林' })
  assert.match(input, /## 旧记忆\n（空）/)
  assert.match(input, /阿澄：欢迎光临。\n小林：有推理小说吗$/)
  assert.match(renderMemory('A 和 B 认识了', '阿澄'), /^【故事记忆 · 前情提要】.*\nA 和 B 认识了$/s)
  assert.match(memorySystemPrompt({ char: '阿澄', maxChars: 500 }), /不超过 500 字/)
  assert.equal(cleanMemory('  x  ', 800), 'x')
  assert.equal(cleanMemory('啊'.repeat(400), 200).length, 301)
})

test('memoryFor 只认 enabled:true', () => {
  assert.equal(memoryFor({ memory: { s: { enabled: false } } }, 's'), undefined)
  assert.equal(memoryFor({ memory: { s: { enabled: true, every: 2 } } }, 's').every, 2)
  assert.equal(memoryFor({}, 's'), undefined)
})

const user = (text, kind = 'user') => ({ type: 'user/message', data: { role: 'user', content: [{ type: 'text', text }], source: { kind } } })
const ai = (text) => ({ type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'reasoning', text: '想' }, { type: 'text', text }] } } })
const turn = (n) => ({ type: 'turn/start', data: { turn: n } })
const events = [
  turn(1), ai('欢迎光临。'),
  turn(2), user('有推理小说吗'), user('注入', 'prefill'), ai('左边第二排。'),
  turn(3), user('那本多少钱'), ai('三十八。'),
  turn(4), user('我买了'), ai('谢谢惠顾。'),
]

test('dialogueByTurn：按轮切，只要真实对话正文', () => {
  const lines = dialogueByTurn(events)
  assert.deepEqual(lines.map((line) => [line.turn, line.who, line.text]), [
    [1, 'char', '欢迎光临。'],
    [2, 'user', '有推理小说吗'],
    [2, 'char', '左边第二排。'],
    [3, 'user', '那本多少钱'],
    [3, 'char', '三十八。'],
    [4, 'user', '我买了'],
    [4, 'char', '谢谢惠顾。'],
  ])
})

test('summarizeMemory：只送 (throughTurn, completed] 的对话，结果写回', async () => {
  const written = {}
  let request
  const api = {
    note() {},
    memory: { read: (id) => written[id], write: (id, value) => (written[id] = value) },
    rootCtx: {
      llm: {
        async *stream(options) {
          request = options
          yield { type: 'reasoning-delta', index: 0, text: '先想想' }
          yield { type: 'text-delta', index: 1, text: '【已发生的事】小林' }
          yield { type: 'text-delta', index: 1, text: '买了推理小说。' }
          yield { type: 'finish', reason: 'stop' }
        },
      },
    },
  }
  const agent = { id: 's1', session: { id: 's1', snapshotEvents: () => events, requestHeader: () => ({ config: { provider: 'dsapi', model: 'deepseek-flash' } }) } }
  await summarizeMemory(api, agent, { every: 2, maxChars: 800, char: '阿澄', user: '小林' }, { text: '旧的', throughTurn: 2 }, 4)
  const body = request.messages[0].content[0].text
  assert.match(body, /## 旧记忆\n旧的/)
  assert.doesNotMatch(body, /左边第二排/)
  assert.match(body, /小林：那本多少钱[\s\S]*阿澄：谢谢惠顾。$/)
  assert.equal(request.provider, 'dsapi')
  assert.equal(written.s1.text, '【已发生的事】小林买了推理小说。')
  assert.equal(written.s1.throughTurn, 4)
  assert.equal(written.s1.model, 'dsapi/deepseek-flash')
})

test('summarizeMemory：拿不到模型就不写', async () => {
  const written = {}
  const api = { note() {}, memory: { read: () => undefined, write: (id, value) => (written[id] = value) }, rootCtx: {} }
  const agent = { id: 's2', session: { id: 's2', snapshotEvents: () => events, requestHeader: () => undefined } }
  await summarizeMemory(api, agent, { every: 2, maxChars: 800 }, {}, 4)
  assert.deepEqual(written, {})
})

test('routeLabel：model 已带 provider 前缀时不重复（issue #4）', () => {
  assert.equal(routeLabel({ provider: 'cline-pass', model: 'cline-pass/deepseek-v4.1-flash' }), 'cline-pass/deepseek-v4.1-flash')
  assert.equal(routeLabel({ provider: 'dsapi', model: 'deepseek-flash' }), 'dsapi/deepseek-flash')
  assert.equal(routeLabel({ provider: 'a', model: 'ab/x' }), 'a/ab/x')
})
