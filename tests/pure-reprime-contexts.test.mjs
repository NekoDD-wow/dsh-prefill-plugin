// 回归：state-write / reprime 之后，pure 不能因为 contextsSuppressed 丢掉就漏 required 上下文。
// 线上事故：session-d4225a91 turn 3，reprime 后 working-directory:current / subagent:identity
// 又进了 runtime-context，模型思维链退成助手视角。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { prime } from '../gate.js'

const CONTEXT_NAMES = ['working-directory:current', 'subagent:identity']

function fakeWorld() {
  const global = { contexts: new Map() }
  const scoped = new Map()
  const agent = { id: 'session-reprime', session: { snapshotEvents: () => [] } }
  const agentLayer = { contexts: new Map() }
  scoped.set(agent, agentLayer)
  for (const name of CONTEXT_NAMES) {
    global.contexts.set(name, { name, order: 10, required: true, text: `${name} 原文` })
  }
  const layers = {
    global,
    peek: (scope) => scoped.get(scope),
    merge: (scope, pick) => {
      const merged = new Map(pick(global))
      const own = scoped.get(scope)
      if (own) for (const [name, value] of pick(own)) merged.set(name, value)
      return merged
    },
  }
  const sections = new Map()
  const contexts = new Map()
  const sp = {
    layers,
    section(entry) {
      sections.set(entry.name, entry)
      return () => sections.delete(entry.name)
    },
    context(entry) {
      if (contexts.has(entry.name)) throw new Error(`prompt context "${entry.name}" is already registered in this scope`)
      contexts.set(entry.name, entry)
      return () => contexts.delete(entry.name)
    },
    suppressRuntimeContext() {
      return () => {}
    },
    async assemble() {
      return {
        sections: [{ name: 'prefill:persona', text: '你是测试人格。' }],
        contexts: [...layers.merge(agent, (layer) => layer.contexts).values()],
        tools: [],
      }
    },
  }
  const toolService = {
    view: () => ({ restrictableNames: new Set(['read']) }),
    restrict: () => () => {},
  }
  const ctx = { get: (key) => (key === 'systemPrompt' ? sp : key === 'tools' ? toolService : undefined) }
  agent.ctx = ctx
  return { agent, ctx, sp, toolService }
}

const state = () => ({
  armed: ['session-reprime'],
  // 直接给挂载后的 levers；prime/step 的 effectiveStateFor 会原样保留。
  levers: {
    probeSection: false,
    probeContext: false,
    blockSections: true,
    blockContexts: true,
    blockTools: true,
    blockMessages: true,
  },
  gate: {},
  enabled: {},
  sandbox: {},
  overrides: {
    'session-reprime': { messages: {}, sections: { 'prefill:persona': '你是测试人格。' }, contexts: {} },
  },
  everyTurn: {},
  tools: [],
})

test('reprime 后 contextsSuppressed=false 时，装配仍按 frozen.blockContexts 清 required 上下文', async () => {
  const { agent, ctx, sp, toolService } = fakeWorld()
  const notes = []
  const latches = new Map()
  const listeners = []
  const rootCtx = {
    get: (key) => (key === 'systemPrompt' ? sp : key === 'tools' ? toolService : undefined),
    on: (name, fn) => {
      if (name === 'system-prompt/assemble') listeners.push(fn)
      return () => {}
    },
  }
  const api = {
    readState: state,
    note: (note) => notes.push(note),
    latches,
    rootCtx,
    unlatch: (id) => {
      const entry = latches.get(id)
      if (entry === undefined) return
      for (const dispose of entry.disposers ?? []) {
        try {
          dispose()
        } catch {
          // 忽略已撤的注册。
        }
      }
      latches.delete(id)
    },
  }
  // agent.ctx 也要能拿到 systemPrompt/tools；fakeWorld 已挂。
  agent.ctx = ctx
  await prime(api, agent)
  const listener = listeners[0]
  assert.ok(listener, 'prime 应注册 system-prompt/assemble 观察者')

  const runAssembly = async () => {
    const assembly = {
      sections: [{ name: 'prefill:persona', text: '你是测试人格。' }],
      contexts: [...sp.layers.merge(agent, (layer) => layer.contexts).values()],
      tools: [],
    }
    const result = await listener(assembly, { scope: agent, agent }, async () => assembly)
    return result
  }

  // 模拟 reprime：撤旧 → 重挂；再模拟线上丢标志。
  api.unlatch(agent.id)
  await prime(api, agent)
  latches.get(agent.id).contextsSuppressed = false
  latches.get(agent.id).frozenLevers = { ...latches.get(agent.id).frozenLevers, blockContexts: true }

  const result = await runAssembly()
  const names = (result.contexts ?? []).map((entry) => entry.name)
  for (const name of CONTEXT_NAMES) {
    assert.equal(names.includes(name), false, `${name} 不应留在装配结果里`)
  }
  assert.ok(notes.some((note) => note?.blocker === 'system-prompt/assemble' && Array.isArray(note.neutralized) && CONTEXT_NAMES.every((name) => note.neutralized.includes(name))), '必须留下 neutralized 审计')
})

test('reprimeOne 不先 unlatch：prime 早退时旧闩锁仍能兜住装配', () => {
  const impl = readFileSync(new URL('../impl.js', import.meta.url), 'utf8')
  const start = impl.indexOf('const reprimeOne =')
  assert.ok(start >= 0, '必须能找到 reprimeOne')
  const chunk = impl.slice(start, start + 900)
  assert.doesNotMatch(chunk, /unlatch\(agent\.id\)/, 'reprimeOne 不许先撤旧闩锁')
  assert.match(chunk, /await gate\.prime/, '要交给 prime 内部按需撤旧')
})

test('step() 在 pre-step 清 required 上下文，避免 runtime-context 快照早于装配', () => {
  const src = readFileSync(new URL('../gate.js', import.meta.url), 'utf8')
  const start = src.indexOf('export async function step')
  assert.ok(start >= 0, '必须能找到 step')
  const end = src.indexOf('const droppedKinds', start)
  const chunk = src.slice(start, end > start ? end : start + 6000)
  assert.match(chunk, /neutralizeRequiredContexts\(api, agent, currentLatch\)/, 'pre-step 要清 required 上下文')
  assert.match(chunk, /neutralized_prestep/, '清过要留审计')
})
