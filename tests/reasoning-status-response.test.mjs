// POST /reasoning/disable 与 /reasoning-spike/status 的响应形状：
// reasoningStatus() 是 async，两处漏了 await ⇒ disable 只回 { applied }、spike 别名回 {}。
// 左栏 reasoningAct 直接拿 disable 的响应 setReasoning(data)，停用后状态行字段为空，要等下次刷新。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mount } from './impl-mount-harness.mjs'

const h = await mount({ state: { ui: { experimental: true } }, tag: 'status-shape' })

test('POST /reasoning/disable：响应带完整状态（enabled / proxyRunning / route）和 applied', async () => {
  const data = await h.post('/api/dsh-prefill/reasoning/disable', {})
  assert.deepEqual(
    { ok: data.ok, enabled: data.enabled, proxyRunning: data.proxyRunning, hasRoute: data.route !== undefined, hasApplied: data.applied !== undefined },
    { ok: true, enabled: false, proxyRunning: false, hasRoute: true, hasApplied: true },
    '响应键：' + Object.keys(data).join(','),
  )
})

test('POST /reasoning-spike/status（旧别名）与 /reasoning/status 同形', async () => {
  const alias = await h.post('/api/dsh-prefill/reasoning-spike/status', {})
  const main = await h.post('/api/dsh-prefill/reasoning/status', {})
  assert.equal(alias.ok, true, '别名返回：' + JSON.stringify(alias))
  assert.deepEqual(Object.keys(alias).sort(), Object.keys(main).sort())
})
