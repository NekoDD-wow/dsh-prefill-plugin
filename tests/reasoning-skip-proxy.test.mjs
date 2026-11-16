// 代理侧「清空本轮填装」按会话生效：getConfig().isSkipping(sessionId) 为真 ⇒ 只有认领到该会话的请求透传（记 skipped），
// 别的会话照常加前缀；认不出会话的请求不跳过。
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createReasoningPrefixProxy } from '../reasoning-prefix.js'

const withProxy = async (cfg, fn) => {
  const captured = []
  const upstream = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    captured.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
  })
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const outcomes = []
  const proxy = createReasoningPrefixProxy({
    getConfig: () => ({ enabled: true, upstream: 'http://127.0.0.1:' + upstream.address().port, reasoningPrefix: '他喵', stripTools: true, ...cfg }),
    onOutcome: (outcome) => outcomes.push(outcome),
  })
  const port = await proxy.listen(0)
  const send = async (text) => {
    const response = await fetch('http://127.0.0.1:' + port + '/beta/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify({ model: 'm', messages: [{ role: 'user', content: text }] }),
    })
    await response.text()
    return { body: captured.at(-1), outcome: outcomes.at(-1) }
  }
  try {
    await fn(send)
  } finally {
    proxy.server.closeAllConnections?.()
    await proxy.close()
    upstream.closeAllConnections?.()
    await new Promise((resolve) => upstream.close(resolve))
  }
}

const PREFIXED = { role: 'assistant', content: '', reasoning_content: '他喵', prefix: true }

test('只跳过正在跳过的那个会话：A 透传记 skipped，B 照常加前缀', async () => {
  await withProxy(
    {
      // 按请求正文认领会话（真实实现按 llm/stream 登记的指纹）。
      resolveTrace: (body) => ({ sessionId: body.messages.at(-1).content.startsWith('A') ? 'sess-A' : 'sess-B', turn: 1, step: 1, confidence: 'exact' }),
      isSkipping: (sid) => sid === 'sess-A',
    },
    async (send) => {
      const a = await send('A 你好')
      assert.deepEqual(a.body.messages.at(-1), { role: 'user', content: 'A 你好' }, 'A 这一轮应原样透传')
      assert.equal(a.outcome.variant, 'skipped', '用户主动跳过要记成 skipped（不算失败）')
      const b = await send('B 你好')
      assert.deepEqual(b.body.messages.at(-1), PREFIXED, 'B 没点跳过，必须照常加前缀')
      assert.notEqual(b.outcome.variant, 'skipped')
    },
  )
})

test('认不出会话的请求不跳过（宁可多加一次前缀，也不全局跳过）', async () => {
  await withProxy({ resolveTrace: () => null, isSkipping: () => true }, async (send) => {
    const r = await send('你好')
    assert.deepEqual(r.body.messages.at(-1), PREFIXED)
  })
})
