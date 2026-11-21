// applyReasoningState 必须串行：两次启用重叠（双击保存、面板与左栏同时保存、自动停用与用户操作撞上）
// 时只能有一个代理在监听，端口不能漂到回退端口，停用后不能留下没人关的监听。
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { exitIfLeaked, fakeSettings, freePort, isListening, mount } from './impl-mount-harness.mjs'

const settings = fakeSettings()
const PORT = await freePort()
const h = await mount({
  tag: 'apply-serial',
  settings,
  state: { ui: { experimental: true, reasoningPrefix: { enabled: false, prefix: '想：', port: PORT } } },
})
const CONFIG = '/api/dsh-prefill/experimental/config'
const DISABLE = '/api/dsh-prefill/reasoning/disable'

after(() => exitIfLeaked())

test('两个并发的启用请求：只起一个代理，端口不漂移；停用后没有残留监听', async () => {
  assert.equal(await isListening(PORT), false)
  await Promise.all([h.post(CONFIG, { enabled: true }), h.post(CONFIG, { enabled: true, prefix: '想2：' })])
  assert.equal(await isListening(PORT), true, '代理应在配置端口上监听')
  assert.equal(await isListening(PORT + 1), false, `回退端口 ${PORT + 1} 上多了一个代理（并发启用起了两个）`)
  assert.equal(h.readStateFile().ui.reasoningPrefix.port, PORT, '状态里的端口被写成了回退端口')
  assert.equal(settings.store.providers['prefill-think']?.baseURL, `http://127.0.0.1:${PORT}/beta/v1`)
  await h.post(DISABLE, {})
  const leftover = []
  for (const port of [PORT, PORT + 1, PORT + 2]) if (await isListening(port)) leftover.push(port)
  assert.deepEqual(leftover, [], '停用后仍有代理在监听（泄漏的那个永远不会被关闭）')
})
