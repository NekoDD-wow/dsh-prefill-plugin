// #20：左栏「会话沙盒」开关关掉（enabled[会话].inject === false）后，闸门的 pre-step 丢消息 /
// 装配滤段·上下文·工具 也应按 applyEnabled 出来的视图（受控档 → 观察档）生效，
// 不能继续读原始 state 的规则表（原来只有面板显示关了、拦截照旧）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { applyAssemblyBlocks, applyMessageBlocks } from '../gate.js'
import { applyEnabled } from '../enabled.js'

const base = (extra = {}) => ({
  version: 2,
  armed: [],
  levers: { probeSection: false, probeContext: false, blockSections: false, blockContexts: false, blockTools: false, blockMessages: false, prefillProbe: false },
  allowKinds: ['user'],
  ...extra,
})
// 两个会话都是受控档；左栏开关只遮 s ⇒ 闸门对 s 回到观察档，other 仍按受控档拦。
const controlled = (extra = {}) => base({ sandbox: { s: { level: 'controlled', rules: [] }, other: { level: 'controlled', rules: [] } }, ...extra })
const offState = () => controlled({ enabled: { s: { inject: false } } })

// 装配结果：team:* / spawn_teammate 属于 Agent Teams（受控档默认拦）；
// harness:identity / working-directory:current / read 属于 DSH 核心（放行）。
const assembly = () => ({
  sections: ['harness:identity', 'team:policy', 'prefill:persona'].map((name) => ({ name, text: name })),
  contexts: ['working-directory:current', 'team:identity'].map((name) => ({ name, text: name })),
  tools: ['read', 'spawn_teammate'].map((name) => ({ name })),
})
const names = (list) => list.map((entry) => entry.name)

test('pre-step 消息：开关开着按受控档丢；关掉后回到观察档、一条不丢', () => {
  const decision = {
    kind: 'enter',
    messages: ['user', 'team-note', 'runtime-context', 'agent-message'].map((kind, index) => ({ id: `m${index}`, source: { kind } })),
  }
  const api = (state) => ({ readState: () => state, note() {}, rootCtx: undefined })
  const on = applyMessageBlocks(api(controlled()), { agent: { id: 's' } }, decision, decision)
  assert.deepEqual(on.messages.map((message) => message.source.kind), ['user', 'runtime-context', 'agent-message'])
  // 面板视图确实已经回到观察档；闸门要和它一致。
  assert.equal(applyEnabled(offState()).sandbox.s.level, 'observe')
  const off = applyMessageBlocks(api(offState()), { agent: { id: 's' } }, decision, decision)
  assert.deepEqual(off.messages.map((message) => message.source.kind), ['user', 'team-note', 'runtime-context', 'agent-message'])
})

test('装配：开关开着滤段/上下文/工具；关掉后全部保留', () => {
  const api = (state) => ({ readState: () => state, note() {}, rootCtx: undefined })
  const on = applyAssemblyBlocks(api(controlled()), 's', undefined, assembly(), undefined)
  assert.deepEqual(names(on.sections), ['harness:identity', 'prefill:persona'])
  assert.deepEqual(names(on.contexts), ['working-directory:current'])
  assert.deepEqual(names(on.tools), ['read'])
  const off = applyAssemblyBlocks(api(offState()), 's', undefined, assembly(), undefined)
  assert.deepEqual(names(off.sections), ['harness:identity', 'team:policy', 'prefill:persona'])
  assert.deepEqual(names(off.contexts), ['working-directory:current', 'team:identity'])
  assert.deepEqual(names(off.tools), ['read', 'spawn_teammate'])
  // enabled 只按会话 key 生效：别的会话仍按原规则表（全局受控档）拦。
  const other = applyAssemblyBlocks(api(offState()), 'other', undefined, assembly(), undefined)
  assert.deepEqual(names(other.sections), ['harness:identity', 'prefill:persona'])
})
