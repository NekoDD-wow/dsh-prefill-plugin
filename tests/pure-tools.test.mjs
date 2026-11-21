// 回归：接管 / 纯净（strict）必须把工具清 0，不受「工具放行清单」影响。
// 背景：pure + sessionTools:['read'] 时，mountLevers 先走 allow 清单分支，strict 的
// restrict({allow: []}) 轮不到，最终请求头仍带 read（lab 复现：tools=1）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { migrateSandbox, resolveSandbox } from '../sandbox.js'
import { step } from '../gate.js'

const base = (extra = {}) => ({
  version: 2,
  armed: [],
  levers: { probeSection: false, probeContext: false, blockSections: false, blockContexts: false, blockTools: false, blockMessages: false, prefillProbe: false },
  allowKinds: ['user'],
  ...extra,
})
const roundTrip = (state) => JSON.parse(JSON.stringify(migrateSandbox(state)))

function fakeAgent(id, calls) {
  const disposer = (what) => () => calls.push(['dispose', what])
  const sp = {
    section(options) { calls.push(['section', options]); return disposer(`section:${options.name}`) },
    context(options) { calls.push(['context', options]); return disposer(`context:${options.name}`) },
    suppressRuntimeContext() { calls.push(['suppress']); return disposer('suppress') },
    async assemble() { return { sections: [], contexts: [], tools: [] } },
  }
  const tools = {
    restrict(options) { calls.push(['restrict', options]); return disposer('restrict') },
    view: () => ({ restrictableNames: new Set(['read', 'grep', 'bash']) }),
  }
  const ctx = { get: (key) => (key === 'systemPrompt' ? sp : key === 'tools' ? tools : undefined) }
  return { id, ctx, session: { snapshotEvents: () => [] } }
}

test('pure + 工具放行清单：strict 仍然 restrict({allow: []})', async () => {
  const sid = 'pure-tools'
  const state = roundTrip(base({
    gate: { [sid]: 'pure' },
    overrides: { [sid]: { messages: {}, sections: { 'prefill:persona': '你是测试人格。' }, contexts: {} } },
    sessionTools: { [sid]: ['read'] },
  }))
  const calls = []
  const agent = fakeAgent(sid, calls)
  const api = { readState: () => state, note() {}, latches: new Map(), unlatch: () => {}, rootCtx: undefined }
  const decision = {
    kind: 'enter',
    messages: [{ id: 'm1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '写一段。' }] }],
  }
  await step(api, { agent, turn: 1, step: 1 }, decision)

  const restrictCalls = calls.filter((call) => call[0] === 'restrict').map((call) => call[1])
  assert.deepEqual(restrictCalls, [{ allow: [] }], 'pure 必须清 0，不能被放行清单顶掉')
})

test('pass + 工具放行清单：清单仍然生效（strict 的修复不误伤）', async () => {
  const sid = 'pass-tools'
  const state = roundTrip(base({ armed: [sid], gate: { [sid]: 'pass' }, sessionTools: { [sid]: ['read'] } }))
  const calls = []
  const agent = fakeAgent(sid, calls)
  const api = { readState: () => state, note() {}, latches: new Map(), unlatch: () => {}, rootCtx: undefined }
  const decision = {
    kind: 'enter',
    messages: [{ id: 'm1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '读一下。' }] }],
  }
  await step(api, { agent, turn: 1, step: 1 }, decision)

  const restrictCalls = calls.filter((call) => call[0] === 'restrict').map((call) => call[1])
  assert.deepEqual(restrictCalls, [{ allow: ['read'] }], 'pass 下白名单要照旧收窄')
})

test('replace + 工具放行清单：清单仍生效（replace 不是 strict，别误伤）', async () => {
  const sid = 'replace-tools'
  const state = roundTrip(base({
    armed: [sid],
    gate: { [sid]: 'replace' },
    sessionTools: { [sid]: ['read'] },
  }))
  const calls = []
  const agent = fakeAgent(sid, calls)
  const api = { readState: () => state, note() {}, latches: new Map(), unlatch: () => {}, rootCtx: undefined }
  const decision = {
    kind: 'enter',
    messages: [{ id: 'm1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '读一下。' }] }],
  }
  await step(api, { agent, turn: 1, step: 1 }, decision)

  const restrictCalls = calls.filter((call) => call[0] === 'restrict').map((call) => call[1])
  assert.deepEqual(restrictCalls, [{ allow: ['read'] }], 'replace 下放行清单要照旧（strict 的修复不该误伤）')
})

test('strict + 沙盒规则 tools 族：规则表也不能把工具带回来', async () => {
  const sid = 'strict-rules'
  const state = roundTrip(base({
    sandbox: {
      [sid]: {
        level: 'strict',
        rules: [
          { match: { tool: 'read' }, action: 'allow' },
          { match: { tool: '*' }, action: 'deny' },
        ],
      },
    },
  }))
  // 前提：规则表解出来的白名单确实是 ['read']（否则这条用例根本没测到「清单被 strict 顶掉」）。
  assert.deepEqual(resolveSandbox(state, sid).toolAllow, ['read'])
  const calls = []
  const agent = fakeAgent(sid, calls)
  const api = { readState: () => state, note() {}, latches: new Map(), unlatch: () => {}, rootCtx: undefined }
  const decision = {
    kind: 'enter',
    messages: [{ id: 'm1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '跑一下。' }] }],
  }
  await step(api, { agent, turn: 1, step: 1 }, decision)

  const restrictCalls = calls.filter((call) => call[0] === 'restrict').map((call) => call[1])
  assert.deepEqual(restrictCalls, [{ allow: [] }], 'strict 下沙盒白名单同样要清 0')
})
