// issue #1：开场对话里没填的空条目不能写进会话历史。
import test from 'node:test'
import assert from 'node:assert/strict'
import { filledItems, writeSyntheticTurns } from '../gate.js'

function fakeSession() {
  const events = []
  return {
    events,
    seq: 0,
    append(type, data) {
      events.push({ type, data })
      this.seq += 1
    },
  }
}
const api = { note() {} }
const textOf = (event) => (event.data.message ?? event.data).content.find((block) => block.type === 'text')?.text

test('filledItems 去掉空白条目', () => {
  const items = [
    { role: 'user', text: '' },
    { role: 'assistant', text: '   ', reasoning: '' },
    { role: 'assistant', text: '', reasoning: '只有思维链' },
    { role: 'user', text: '你好' },
  ]
  assert.deepEqual(filledItems(items), [{ role: 'user', text: '你好' }])
  assert.deepEqual(filledItems(undefined), [])
})

test('只有空条目时什么都不写', () => {
  const session = fakeSession()
  writeSyntheticTurns(api, { id: 'agent-empty-1' }, session, 'SYS', [
    { role: 'user', text: '' },
    { role: 'assistant', text: '', reasoning: '' },
  ])
  const messages = session.events.filter((e) => e.type === 'user/message' || e.type === 'assistant/message')
  assert.equal(messages.length, 0)
})

test('空条目混在中间时只写有内容的', () => {
  const session = fakeSession()
  writeSyntheticTurns(api, { id: 'agent-empty-2' }, session, 'SYS', [
    { role: 'user', text: '在吗' },
    { role: 'user', text: '' },
    { role: 'assistant', text: '在', reasoning: '' },
    { role: 'assistant', text: '', reasoning: '' },
  ])
  const messages = session.events.filter((e) => e.type === 'user/message' || e.type === 'assistant/message')
  assert.deepEqual(messages.map(textOf), ['在吗', '在'])
})
