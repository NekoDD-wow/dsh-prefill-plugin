// 回归（v0.21.14 审查 #85）：prime 挂载失败且一条都没挂上时，不许把「已经 dispose 过的旧闩锁」
// 塞回去 —— 那会得到一个看起来有挂载、其实什么都没挂的假闩锁，把 F23 的空挂载重挂骗过去。
import test from 'node:test'
import assert from 'node:assert/strict'
import { prime, step } from '../gate.js'

const off = { probeSection: false, probeContext: false, blockSections: false, blockContexts: false, blockTools: false, blockMessages: false }
const mkState = () => ({
  armed: ['s1'],
  levers: { ...off, blockSections: true },
  gate: {},
  enabled: {},
  sandbox: {},
  overrides: { s1: { messages: {}, sections: { 'prefill:persona': '你是测试人格。' }, contexts: {} } },
  everyTurn: {},
  tools: [],
})

test('prime 失败时旧闩锁已撤：写空闩锁交 F23 重挂，不装成「有挂载」的假闩锁', async () => {
  const notes = []
  const latches = new Map()
  let disposed = 0
  latches.set('s1', { turn: 1, disposers: [() => { disposed += 1 }], ui: {}, frozenLevers: { ...off }, contextsSuppressed: false })
  let failNext = true
  const sp = {
    section() {
      if (failNext) throw new Error('already registered in this scope')
      return () => {}
    },
    context() {
      return () => {}
    },
    suppressRuntimeContext() {
      return () => {}
    },
  }
  const api = {
    readState: () => mkState(),
    note: (note) => notes.push(note),
    latches,
    unlatch: (id) => {
      const entry = latches.get(id)
      if (entry === undefined) return
      for (const dispose of entry.disposers) {
        try {
          dispose()
        } catch {
          // 忽略。
        }
      }
      latches.delete(id)
    },
    rootCtx: { systemPrompt: sp, tools: {} },
  }
  const agent = { id: 's1', session: { snapshotEvents: () => [] } }

  await prime(api, agent)
  assert.equal(disposed, 1, '旧闩锁的 disposer 应该已经执行（旧注册确实不在了）')
  const afterPrime = latches.get('s1')
  assert.equal(afterPrime?.turn, 'pending', 'prime 失败后应留一个待接管的空闩锁')
  assert.equal(afterPrime?.disposers?.length, 0, '不许把已撤掉的旧闩锁塞回来（disposers 会骗过 F23）')

  failNext = false
  await step(api, { agent, turn: 1, step: 1 }, { kind: 'enter', messages: [] })
  assert.ok(notes.some((note) => note?.remount === 'empty-latch'), 'F23 应该识别出空挂载并重挂')
  const afterStep = latches.get('s1')
  assert.ok((afterStep?.disposers?.length ?? 0) > 0, 'F23 重挂后 latch 应真的有挂载')
})
