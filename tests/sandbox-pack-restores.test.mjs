// 回归（v0.21.14 审查 #86）：0.2.2-rc.3 起 agent-message 归核心、不再挂在 Agent Teams 包上。
// 严格档放行该包时按包声明额外恢复这个核心 kind（allow-only；deny 包不反向连带）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { decide, migrateSandbox, resolveSandbox } from '../sandbox.js'

test('strict + 放行 Agent Teams ⇒ agent-message 进消息白名单（队友消息能送达）', () => {
  const state = migrateSandbox({ sandbox: { s: { level: 'strict', packs: { 'agent-teams': 'allow' } } } })
  assert.equal(resolveSandbox(state, 's').messageAllow.has('agent-message'), true)
  assert.equal(decide(state, 's', { kind: 'agent-message' }).action, 'allow')
})

test('strict + 拦 Agent Teams ⇒ 不恢复核心 agent-message（deny 不连带核心能力）', () => {
  const state = migrateSandbox({ sandbox: { s: { level: 'strict', packs: { 'agent-teams': 'deny' } } } })
  assert.equal(resolveSandbox(state, 's').messageAllow.has('agent-message'), false)
  assert.equal(decide(state, 's', { kind: 'agent-message' }).action, 'deny')
})

test('没开任何包 / 非严格档：行为不变', () => {
  const untouched = migrateSandbox({ sandbox: { s: { level: 'strict' } } })
  assert.equal(resolveSandbox(untouched, 's').messageAllow.has('agent-message'), false, '严格档没放行包时仍然拦')
  const controlled = migrateSandbox({ sandbox: { s: { level: 'controlled', packs: { 'agent-teams': 'deny' } } } })
  // controlled 档 agent-message 是核心消息来源，controlledDefault 会放行；deny 团队包不该连带。
  assert.equal(decide(controlled, 's', { kind: 'agent-message' }, { known: { messages: new Set(['agent-message']) } }).action, 'allow')
})
