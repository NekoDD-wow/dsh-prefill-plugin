// impl 给代理的 getConfig 要带 providerId，否则前缀里的 {{provider}} 永远展不开。
// 挂真实 impl + 真实代理；代理打上游用的全局 fetch 在本进程里换成桩（只截 api.deepseek.com），不走网络。
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { exitIfLeaked, fakeSettings, freePort, mount } from './impl-mount-harness.mjs'

const realFetch = globalThis.fetch
const upstreamBodies = []
globalThis.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input)
  if (!url.startsWith('https://api.deepseek.com/')) return realFetch(input, init)
  upstreamBodies.push(JSON.parse(Buffer.from(init.body).toString('utf8')))
  const body = 'data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n'
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

const settings = fakeSettings({})
const PORT = await freePort()
const h = await mount({
  tag: 'provider-var',
  settings,
  state: { ui: { experimental: true, reasoningPrefix: { enabled: true, prefix: '想（{{provider}}）：', providerId: 'prefill-var', port: PORT } } },
})

after(async () => {
  await h.post('/api/dsh-prefill/reasoning/disable', {})
  globalThis.fetch = realFetch
  exitIfLeaked()
})

test('{{provider}} 展开成当前路由名（impl getConfig 传了 providerId）', async () => {
  const baseURL = settings.store.providers['prefill-var']?.baseURL
  assert.ok(baseURL, '前提：路由已写')
  const res = await realFetch(baseURL + '/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer x' },
    body: JSON.stringify({ model: 'deepseek-chat', stream: true, messages: [{ role: 'user', content: '你好' }] }),
  })
  await res.text()
  assert.equal(upstreamBodies.length, 1)
  assert.equal(upstreamBodies[0].messages.at(-1).reasoning_content, '想（prefill-var）：')
})
