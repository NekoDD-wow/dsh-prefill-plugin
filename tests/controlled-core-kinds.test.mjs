// 会话沙盒受控档：DSH 核心消息来源不能当「未归属」拦掉。
// 宿主 DSH 0.2.1 里这几种 source.kind 都是 DSH 自带包送进来的（出处见 sandbox-packs.js 头注释）：
//   · skill-invocation   —— dsh-tool-skill：用户输入 /技能名 时在 agent/pre-step 里追加技能正文；
//   · ptc-mode           —— dsh-tools / dsh-spill-policy：PTC 模式下带图片的工具结果作为延后上下文追加；
//   · cordis-host-runner —— dsh-cordis-host-runner：Cordis 插件激活 / 运行失败的回报；
//   · webhook            —— dsh-webhook：webhook 触发新会话时的那条开场指令。
// 0.18.0 的受控档默认只认 dsh-core-context 包里的 kind 和 KNOWN_MESSAGE_KINDS，这几样都不在 ⇒
// decide() 判 deny、pre-step 把消息丢掉（技能正文不进模型）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { decide } from '../sandbox.js'
import { BUILTIN_PACKS, CORE_KINDS, packsOf } from '../sandbox-packs.js'
import { blocksFor, dropBlockedMessages } from '../injection-audit.js'
import { applyMessageBlocks } from '../gate.js'

const NEW_CORE = ['skill-invocation', 'ptc-mode', 'cordis-host-runner', 'webhook']
const empty = { messages: new Set(), sections: new Set(), contexts: new Set() }
const controlled = (scope = 's1') => ({ sandbox: { [scope]: { level: 'controlled' } } })
const msg = (kind, index) => ({ id: `m${index}`, role: 'user', source: { kind }, content: [{ type: 'text', text: kind }] })

test('DSH 核心消息来源都在 dsh-core-context 包里（CORE_KINDS）', () => {
  for (const kind of NEW_CORE) {
    assert.ok(CORE_KINDS.includes(kind), kind)
    assert.deepEqual(packsOf({}, { kind }).map(({ pack }) => pack.id), ['dsh-core-context'], kind)
  }
  const core = BUILTIN_PACKS.find((pack) => pack.id === 'dsh-core-context')
  for (const kind of NEW_CORE) assert.ok(core.members.some((member) => member.kind === kind && member.exact === true), kind)
  // team-message 目前没有任何 DSH 0.2.1 包发出（只在类型声明 / 旧会话格式迁移里出现）⇒ 不算核心，照旧按未归属处理。
  assert.equal(CORE_KINDS.includes('team-message'), false)
})

test('受控档 decide()：技能调用 / PTC 图片结果等放行（按包），不认识的来源照拦', () => {
  for (const kind of NEW_CORE) {
    assert.deepEqual(decide(controlled(), 's1', { kind }, { known: empty }), { action: 'allow', by: 'pack', pack: 'dsh-core-context', scope: 'level' }, kind)
    // 全局 '*' 设的受控档同样适用。
    assert.equal(decide(controlled('*'), 's1', { kind }, { known: empty }).action, 'allow', `* ${kind}`)
  }
  assert.deepEqual(decide(controlled(), 's1', { kind: 'acme-note' }, { known: empty }), { action: 'deny', by: 'level' })
  // 用户显式拦「DSH 核心 · 运行时上下文」包时仍然能拦（只是改档位默认，不是恒放行）。
  const denied = { sandbox: { s1: { level: 'controlled', packs: { 'dsh-core-context': 'deny' } } } }
  assert.equal(decide(denied, 's1', { kind: 'skill-invocation' }, { known: empty }).action, 'deny')
})

test('受控档 pre-step：dropBlockedMessages / applyMessageBlocks 不再丢技能正文和 PTC 图片结果', () => {
  const kinds = ['user', 'skill-invocation', 'ptc-mode', 'cordis-host-runner', 'webhook', 'acme-note']
  const decision = { kind: 'enter', messages: kinds.map(msg) }
  const blocks = blocksFor(controlled(), 's1', empty)
  for (const kind of NEW_CORE) assert.equal(blocks.messages.has(kind), false, kind)
  const { decision: next, dropped } = dropBlockedMessages(decision, blocks)
  assert.deepEqual(dropped, ['acme-note'])
  assert.deepEqual(next.messages.map((message) => message.source.kind), ['user', 'skill-invocation', 'ptc-mode', 'cordis-host-runner', 'webhook'])
  // 走 gate.js 的 pre-step 最外层（插件实际挂的那一层）。
  const api = { readState: () => controlled(), note() {}, latches: new Map(), unlatch() {}, rootCtx: undefined }
  const out = applyMessageBlocks(api, { agent: { id: 's1' } }, decision, decision)
  assert.deepEqual(out.messages.map((message) => message.source.kind), ['user', 'skill-invocation', 'ptc-mode', 'cordis-host-runner', 'webhook'])
})
