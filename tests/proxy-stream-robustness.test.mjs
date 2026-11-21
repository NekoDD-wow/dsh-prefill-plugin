// reasoning 代理剩余的健壮性问题：请求体读一半断开的结果行 / 运行期 server error / SSE 错误帧 / transformShimSse 的 data: null。
// 每条断言写的是期望行为；在 0.21.12（e62b23f）上全部失败。
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createReasoningPrefixProxy, transformShimSse } from '../reasoning-prefix.js'
import { startUpstream, startProxy, post, parseClientSse, sse, BODY, sleep } from './proxy-upstream-harness.mjs'

const delta = (d) => sse({ choices: [{ index: 0, delta: d }] })
const STOP = sse({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })

test('请求体读到一半客户端断开 ⇒ 照样落一行结果（clientAborted、verdict error、不报 outcome）', async () => {
  const up = await startUpstream(() => ({ chunks: [] }))
  const px = await startProxy({ upstream: up })
  try {
    await new Promise((resolve) => {
      const req = http.request(px.url, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '1000' } })
      req.on('error', () => {})
      req.write('{"messages":')
      setTimeout(() => { req.destroy(); resolve() }, 50)
    })
    await sleep(150)
    const rows = px.rows()
    assert.equal(rows.length, 1, '每请求恰好一行：请求体没读完就断开的请求一行都没落')
    assert.equal(rows[0].ok, false)
    assert.equal(rows[0].status, 0)
    assert.equal(rows[0].verdict, 'error')
    assert.equal(rows[0].clientAborted, true)
    assert.equal(up.bodies.length, 0, '请求体不完整，不应打上游')
    assert.equal(px.outcomes.length, 0, '客户端主动断开不进连续失败计数')
    assert.ok(px.proxy.audit().some((a) => a.kind === 'client-abort'), JSON.stringify(px.proxy.audit()))
  } finally { await px.close(); await up.close() }
})

test('监听成功后运行期的 server error（如 accept EMFILE）不会变成未捕获异常，只记日志', async () => {
  const warns = []
  const proxy = createReasoningPrefixProxy({ getConfig: () => ({}), logger: { warn: (m) => warns.push(m), info: () => {} } })
  await proxy.listen(0)
  try {
    const error = Object.assign(new Error('accept EMFILE'), { code: 'EMFILE', syscall: 'accept' })
    assert.doesNotThrow(() => proxy.server.emit('error', error), '没有常驻 error 监听器：emit 直接抛出（运行期就是宿主进程退出）')
    assert.ok(warns.some((m) => m.includes('EMFILE')), JSON.stringify(warns))
    assert.equal(proxy.server.listening, true)
  } finally { await proxy.close() }
})

test('端口回退后成功监听，也只挂一个常驻 error 监听器', async () => {
  const blocker = http.createServer()
  await new Promise((r) => blocker.listen(0, '127.0.0.1', r))
  const busy = blocker.address().port
  const proxy = createReasoningPrefixProxy({ getConfig: () => ({}), logger: { warn: () => {}, info: () => {} } })
  try {
    const port = await proxy.listen(busy)
    assert.notEqual(port, busy)
    assert.equal(proxy.server.listenerCount('error'), 1)
  } finally {
    await proxy.close()
    await new Promise((r) => blocker.close(r))
  }
})

const go = async (handler) => {
  const up = await startUpstream(handler)
  const px = await startProxy({ upstream: up })
  try {
    const res = await post(px.url, BODY)
    await sleep(30)
    return { res, sse: parseClientSse(res.text), rows: px.rows(), stats: px.proxy.stats(), audit: px.proxy.audit(), outcomes: px.outcomes }
  } finally {
    await px.close()
    await up.close()
  }
}

test('SSE 流中夹 `data: {"error":…}` 帧 ⇒ 按流错误记失败，错误帧原样转给客户端，客户端仍收到 [DONE]', async () => {
  const errorFrame = sse({ error: { message: 'Insufficient Balance', type: 'unknown_error', code: 'invalid_request_error' } })
  const r = await go(() => ({ chunks: [delta({ content: '前半段' }), errorFrame] }))
  assert.equal(r.rows.length, 1)
  assert.equal(r.rows[0].ok, false, '错误帧被吞掉，结果行记成了成功')
  assert.equal(r.rows[0].verdict, 'error')
  const streamErr = r.audit.find((a) => a.kind === 'stream-error')
  assert.ok(streamErr, '没有 stream-error 审计：' + JSON.stringify(r.audit))
  assert.match(streamErr.error, /Insufficient Balance/)
  assert.deepEqual(r.outcomes.map((o) => o.ok), [false], '应报一次失败 outcome（与非 SSE {error} 同口径）')
  assert.equal(r.stats.failed, 1)
  assert.ok(r.sse.payloads.some((p) => p.error?.message === 'Insufficient Balance'), '客户端看不到错误帧：' + r.res.text)
  assert.equal(r.sse.content, '前半段', '错误之前的正文照常转发')
  assert.equal(r.sse.done, true, '客户端仍应收到 [DONE]，不挂死')
})

test('SSE 流只有一帧 `data: {"error":…}`（无正文）⇒ 也记失败，不再落成 ok + no-delta', async () => {
  const r = await go(() => ({ chunks: [sse({ error: { message: 'rate limited', code: 429 } }), 'data: [DONE]\n\n'] }))
  assert.equal(r.rows[0].ok, false)
  assert.ok(r.audit.some((a) => a.kind === 'stream-error'), JSON.stringify(r.audit))
  assert.equal(r.audit.some((a) => a.kind === 'shim'), false, '不应再记一条 shim 成功审计')
})

test('`error: null` 的普通帧不算错误', async () => {
  const r = await go(() => ({ chunks: [sse({ error: null, choices: [{ index: 0, delta: { content: 'ok' } }] }), STOP] }))
  assert.equal(r.rows[0].ok, true)
  assert.equal(r.sse.content, 'ok')
})

test('transformShimSse 跳过 `data: null` / 非对象帧，不抛异常', () => {
  const raw = 'data: null\n\ndata: 1\n\ndata: []\n\n' + delta({ content: '你好' }) + STOP + 'data: [DONE]\n\n'
  let out
  assert.doesNotThrow(() => { out = transformShimSse(raw) })
  const parsed = parseClientSse(out.text)
  assert.equal(parsed.content, '你好')
  assert.equal(parsed.done, true)
})
