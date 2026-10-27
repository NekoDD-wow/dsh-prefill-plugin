// 注入审计 + 按名阻断：疑似未登记注入的识别、合并记录、会话级 / 全局阻断。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  blocksFor,
  classifyAssembly,
  classifySurfaceEvent,
  dropBlockedMessages,
  forgetSession,
  recordFindings,
  auditSnapshot,
} from '../injection-audit.js'

const known = {
  messages: new Set(['runtime-context', 'compact-checkpoint']),
  sections: new Set(['harness:identity']),
  contexts: new Set(['working-directory:current']),
}

test('运行时上下文里作用域内注册的贡献者（team:identity）算疑似未登记，全局注册的不算', () => {
  const event = {
    type: 'user/message',
    seq: 9,
    data: {
      role: 'user',
      content: [{ type: 'text', text: '...' }],
      source: {
        kind: 'runtime-context',
        form: 'snapshot',
        sections: [
          { name: 'working-directory:current', text: 'Current working directory: "/tmp/ws".' },
          { name: 'team:identity', text: 'You are the Team Lead named "lead".' },
          { name: 'prefill:own', text: 'x' },
        ],
      },
    },
  }
  assert.deepEqual(classifySurfaceEvent(event, known), [
    { group: 'contexts', name: 'team:identity', preview: 'You are the Team Lead named "lead".', blockable: true },
  ])
})

test('用户原话、本插件、已登记来源不记；其他来源按是否经过 pre-step 标 blockable', () => {
  const msg = (kind) => ({ type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: `from ${kind}` }], source: { kind } } })
  assert.deepEqual(classifySurfaceEvent(msg('user'), known), [])
  assert.deepEqual(classifySurfaceEvent(msg('prefill:every-turn'), known), [])
  assert.deepEqual(classifySurfaceEvent(msg('compact-checkpoint'), known), [])
  assert.deepEqual(classifySurfaceEvent(msg('agent-message'), known, new Set(['agent-message'])), [
    { group: 'messages', name: 'agent-message', preview: 'from agent-message', blockable: true },
  ])
  assert.equal(classifySurfaceEvent(msg('webhook'), known, new Set())[0].blockable, false)
})

test('developer 消息（工具增删通知）只能记录', () => {
  const event = {
    type: 'developer/message',
    data: { message: { role: 'developer', source: { kind: 'tool-registry' }, content: [{ type: 'tool-removal', toolName: 'bash' }] } },
  }
  assert.deepEqual(classifySurfaceEvent(event, known), [
    { group: 'messages', name: 'developer:tool-registry', preview: 'tool-removal:bash', blockable: false },
  ])
})

test('装配里不在全局注册表的段 / 上下文算疑似未登记', () => {
  const findings = classifyAssembly(
    {
      sections: [{ name: 'harness:identity', text: 'a' }, { name: 'team:policy', text: 'team rules' }, { name: 'prefill:pure', text: '' }],
      contexts: [{ name: 'team:identity', text: 'lead' }],
    },
    known,
  )
  assert.deepEqual(findings.map((entry) => `${entry.group}:${entry.name}`), ['sections:team:policy', 'contexts:team:identity'])
})

test('同一条注入合并计数', () => {
  forgetSession('s-merge')
  const finding = { group: 'messages', name: 'agent-message', preview: 'hi', blockable: true }
  assert.deepEqual(recordFindings('s-merge', [finding], 3), ['messages:agent-message'])
  assert.deepEqual(recordFindings('s-merge', [{ ...finding, preview: 'again' }], 7), [])
  const [row] = auditSnapshot()['s-merge']
  assert.equal(row.count, 2)
  assert.equal(row.preview, 'again')
  assert.equal(row.firstSeq, 3)
  assert.equal(row.lastSeq, 7)
  forgetSession('s-merge')
})

test('阻断名单 = 会话级 ∪ 全局记住；本插件命名空间不可阻断', () => {
  const state = {
    injectionBlocks: {
      's-a': { messages: ['agent-message'], contexts: ['prefill:x'] },
      '*': { contexts: ['team:identity'] },
    },
  }
  const a = blocksFor(state, 's-a')
  assert.deepEqual([...a.messages], ['agent-message'])
  assert.deepEqual([...a.contexts], ['team:identity'])
  const b = blocksFor(state, 's-b')
  assert.deepEqual([...b.messages], [])
  assert.deepEqual([...b.contexts], ['team:identity'])
})

test('pre-step 丢掉被阻断来源，用户原话永不丢', () => {
  const blocks = blocksFor({ injectionBlocks: { s: { messages: ['agent-message', 'user'] } } }, 's')
  const decision = {
    kind: 'enter',
    messages: [{ source: { kind: 'user' } }, { source: { kind: 'agent-message' } }, { source: { kind: 'goal' } }],
  }
  const { decision: next, dropped } = dropBlockedMessages(decision, blocks)
  assert.deepEqual(next.messages.map((message) => message.source.kind), ['user', 'goal'])
  assert.deepEqual(dropped, ['agent-message'])
  assert.equal(dropBlockedMessages(decision, blocksFor({}, 's')).decision, decision)
})
