// issue #9：纯净模式要连 `required: true` 的运行时上下文一起清掉（suppressRuntimeContext 挡不住它们）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { neutralizeRequiredContexts } from '../gate.js'

/** 仿 dsh-scope 的 ScopedLayers：global + 每个 scope 一层，merge 时近的覆盖远的。 */
function fakeWorld() {
  const global = { contexts: new Map() }
  const scoped = new Map()
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
  const agent = { id: 'session-a' }
  const agentLayer = { contexts: new Map() }
  scoped.set(agent, agentLayer)
  const registered = []
  const sp = {
    layers,
    context(entry) {
      if (agentLayer.contexts.has(entry.name)) throw new Error(`prompt context "${entry.name}" is already registered in this scope`)
      agentLayer.contexts.set(entry.name, entry)
      registered.push(entry.name)
      return () => agentLayer.contexts.delete(entry.name)
    },
  }
  agent.ctx = { get: (key) => (key === 'systemPrompt' ? sp : undefined) }
  return { global, agentLayer, agent, layers, registered }
}

const effective = (layers, scope) =>
  [...layers.merge(scope, (layer) => layer.contexts).values()]
    .map((entry) => ({ name: entry.name, required: entry.required === true, text: typeof entry.text === 'function' ? entry.text() : entry.text }))

test('本作用域的 required 上下文：正文临时清空，unlatch 后还原', () => {
  const { agentLayer, agent, layers } = fakeWorld()
  const identity = { name: 'team:identity', order: 125, required: true, text: () => 'You are the Team Lead named "lead".' }
  agentLayer.contexts.set('team:identity', identity)
  const latch = { disposers: [] }
  assert.deepEqual(neutralizeRequiredContexts({ rootCtx: undefined }, agent, latch), ['team:identity'])
  assert.equal(effective(layers, agent).find((entry) => entry.name === 'team:identity').text, '')
  // 再来一次是幂等的。
  assert.deepEqual(neutralizeRequiredContexts({ rootCtx: undefined }, agent, latch), [])
  for (const dispose of latch.disposers) dispose()
  assert.equal(identity.text(), 'You are the Team Lead named "lead".')
})

test('继承来的 required 上下文：在 agent 作用域注册非 required 的空遮蔽项', () => {
  const { global, agent, layers, registered } = fakeWorld()
  global.contexts.set('working-directory:current', { name: 'working-directory:current', order: 10, required: true, text: 'Current working directory: "/tmp".' })
  global.contexts.set('time', { name: 'time', order: 20, text: 'now' })
  const latch = { disposers: [] }
  assert.deepEqual(neutralizeRequiredContexts({ rootCtx: undefined }, agent, latch), ['working-directory:current'])
  assert.deepEqual(registered, ['working-directory:current'])
  const cwd = effective(layers, agent).find((entry) => entry.name === 'working-directory:current')
  assert.deepEqual(cwd, { name: 'working-directory:current', required: false, text: '' })
  // 全局那条本身不动（别的会话不受影响）；可选上下文不碰。
  assert.equal(global.contexts.get('working-directory:current').text, 'Current working directory: "/tmp".')
  assert.equal(effective(layers, agent).find((entry) => entry.name === 'time').text, 'now')
  for (const dispose of latch.disposers) dispose()
  assert.equal(effective(layers, agent).find((entry) => entry.name === 'working-directory:current').required, true)
})
