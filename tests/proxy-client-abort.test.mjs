// reasoning-prefix 代理的请求生命周期：客户端中途断开（DSH 里点「停止」）、hop-by-hop 请求头、端口回退。
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createReasoningPrefixProxy } from '../reasoning-prefix.js'

const tempDirs = []
test.after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sse = (obj) => 'data: ' + JSON.stringify(obj) + '\n\n'
const delta = (content) => sse({ id: 'c1', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content } }] })
const stop = () => sse({ id: 'c1', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
const BODY = { model: 'deepseek-chat', stream: true, messages: [{ role: 'user', content: '你好' }] }

/**
 * 上游桩：handler 返回 { chunks, delayMs, headerDelayMs }。
 * `aborted` 记录上游这边是否在写完之前被对端关掉（= 代理中止了上游请求）。
 */
const startUpstream = async (handler) => {
  const state = { requests: 0, aborted: 0, finished: 0 }
  const server = http.createServer(async (req, res) => {
    for await (const _ of req) { /* 读完请求体 */ }
    state.requests += 1
    let done = false
    res.on('close', () => { if (!done) state.aborted += 1 })
    const out = handler(state.requests)
    if (out.headerDelayMs) await sleep(out.headerDelayMs)
    if (res.destroyed) return
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.flushHeaders()
    for (const chunk of out.chunks) {
      if (out.delayMs) await sleep(out.delayMs)
      if (res.destroyed) return
      res.write(chunk)
    }
    done = true
    state.finished += 1
    res.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    state,
    port: server.address().port,
    close: async () => {
      server.closeAllConnections?.()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}

const startProxy = async ({ upstream, config = {} }) => {
  const dir = mkdtempSync(join(tmpdir(), 'prefill-abort-'))
  tempDirs.push(dir)
  const resultFile = join(dir, 'result.jsonl')
  const outcomes = []
  const proxy = createReasoningPrefixProxy({
    getConfig: () => ({
      enabled: true,
      upstream: 'http://127.0.0.1:' + upstream.port,
      reasoningPrefix: '他喵',
      stripTools: true,
      shim: true,
      resultFile,
      ...config,
    }),
    onOutcome: (o) => { outcomes.push(o) },
  })
  const port = await proxy.listen(0)
  const rows = () => (existsSync(resultFile) ? readFileSync(resultFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
  return { proxy, rows, outcomes, url: 'http://127.0.0.1:' + port + '/beta/v1/chat/completions', close: () => proxy.close() }
}

/** 发流式请求；收到第一块响应体就掐掉客户端连接（模拟 DSH 里点「停止」）。 */
const abortAfterFirstChunk = (url) =>
  new Promise((resolve) => {
    const req = http.request(url, { method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
      res.once('data', () => { req.destroy(); resolve() })
    })
    req.on('error', () => {})
    req.end(JSON.stringify(BODY))
  })

/** 等条件成立（最多 ms），避免在断言里写死睡眠时长。 */
const waitFor = async (fn, ms = 3000) => {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (fn()) return true
    await sleep(20)
  }
  return fn()
}

const tenSlowDeltas = () => ({ chunks: [...Array.from({ length: 10 }, (_, i) => delta('x' + i)), stop()], delayMs: 100 })

const assertClientAbortRow = (px, variant) => {
  const rows = px.rows()
  assert.equal(rows.length, 1, '每请求恰好一行')
  const row = rows[0]
  assert.equal(row.clientAborted, true, '结果行要标成客户端中止')
  assert.equal(row.ok, false)
  assert.equal(row.verdict, 'error')
  if (variant !== undefined) assert.equal(row.variant, variant)
  assert.equal(px.proxy.stats().requests, 1, 'stats 要记这次请求')
  assert.equal(px.proxy.audit().some((e) => e.kind === 'client-abort'), true, '审计要有 client-abort')
  assert.deepEqual(px.outcomes, [], '用户主动停止不进 onOutcome（不计入连续失败）')
}

test('客户端中途断开 · 原样转发路径（shim 关）：上游被中止，结果行落一行并标 clientAborted，不报 outcome', async () => {
  const up = await startUpstream(tenSlowDeltas)
  const px = await startProxy({ upstream: up, config: { shim: false } })
  try {
    await abortAfterFirstChunk(px.url)
    assert.equal(await waitFor(() => px.rows().length === 1), true, '结果行没落（处理协程挂在 pipe 上）')
    assert.equal(await waitFor(() => up.state.aborted === 1, 500), true, '上游请求没被中止')
    assert.equal(up.state.finished, 0, '上游不该被读完')
    assertClientAbortRow(px, 'prefixed')
  } finally { await px.close(); await up.close() }
})

test('客户端中途断开 · shim 开但本轮 ignored（前缀为空，原样透传）：同样不挂死、不计失败', async () => {
  const up = await startUpstream(tenSlowDeltas)
  const px = await startProxy({ upstream: up, config: { reasoningPrefix: '' } })
  try {
    await abortAfterFirstChunk(px.url)
    assert.equal(await waitFor(() => px.rows().length === 1), true, '结果行没落（处理协程挂在 pipe 上）')
    assert.equal(await waitFor(() => up.state.aborted === 1, 500), true, '上游请求没被中止')
    assertClientAbortRow(px, 'ignored')
  } finally { await px.close(); await up.close() }
})

test('客户端中途断开 · shim 改写路径：上游立刻被中止（不再读完计费），结果行不再记 ok:true', async () => {
  const up = await startUpstream(() => ({ chunks: [...Array.from({ length: 30 }, (_, i) => delta('x' + i)), stop()], delayMs: 50 }))
  const px = await startProxy({ upstream: up })
  try {
    await abortAfterFirstChunk(px.url)
    assert.equal(await waitFor(() => up.state.aborted === 1, 400), true, '客户端已断开 400ms，上游请求仍在跑')
    assert.equal(await waitFor(() => px.rows().length === 1), true)
    assertClientAbortRow(px)
    assert.equal(['system', 'user'].includes(px.rows()[0].variant), true)
  } finally { await px.close(); await up.close() }
})

test('客户端在上游响应头到达前断开：记 client-abort 而不是 transport-error，不报 outcome', async () => {
  const up = await startUpstream(() => ({ chunks: [delta('晚'), stop()], headerDelayMs: 600 }))
  const px = await startProxy({ upstream: up })
  try {
    await new Promise((resolve) => {
      const req = http.request(px.url, { method: 'POST', headers: { 'content-type': 'application/json' } })
      req.on('error', () => {})
      req.end(JSON.stringify(BODY))
      setTimeout(() => { req.destroy(); resolve() }, 150)
    })
    assert.equal(await waitFor(() => px.rows().length === 1), true)
    assert.equal(await waitFor(() => up.state.aborted === 1, 1500), true, '上游请求没被中止')
    assertClientAbortRow(px, 'none')
    assert.equal(px.proxy.audit().some((e) => e.kind === 'transport-error'), false)
  } finally { await px.close(); await up.close() }
})

test('正常请求不受影响：两条路径都 ok:true、clientAborted:false、outcome 报一次', async () => {
  for (const config of [{}, { shim: false }]) {
    const up = await startUpstream(() => ({ chunks: [delta('你'), delta('好'), stop()] }))
    const px = await startProxy({ upstream: up, config })
    try {
      const response = await fetch(px.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(BODY) })
      const text = await response.text()
      assert.equal(response.status, 200)
      assert.match(text, /\[DONE\]|finish_reason/)
      assert.equal(await waitFor(() => px.rows().length === 1), true)
      const row = px.rows()[0]
      assert.equal(row.ok, true, JSON.stringify(config))
      assert.equal(row.clientAborted, false)
      assert.equal(px.outcomes.length, 1)
      assert.equal(px.outcomes[0].ok, true)
      assert.equal(up.state.aborted, 0)
    } finally { await px.close(); await up.close() }
  }
})

test('客户端以 Transfer-Encoding: chunked 发请求体：hop-by-hop 头不转给 fetch，不再 502', async () => {
  const up = await startUpstream(() => ({ chunks: [delta('ok'), stop()] }))
  const px = await startProxy({ upstream: up })
  try {
    const result = await new Promise((resolve) => {
      const req = http.request(px.url, { method: 'POST', headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' } }, (res) => {
        let text = ''
        res.on('data', (d) => (text += d))
        res.on('end', () => resolve({ status: res.statusCode, text }))
      })
      const raw = JSON.stringify(BODY)
      req.write(raw.slice(0, 10))
      req.end(raw.slice(10))
    })
    assert.equal(result.status, 200, result.text)
    assert.match(result.text, /ok/)
  } finally { await px.close(); await up.close() }
})

test('端口回退：重试不残留 listening 监听器，回退 12 次也不触发 MaxListenersExceededWarning', async () => {
  const warnings = []
  const onWarn = (w) => warnings.push(w.name)
  process.on('warning', onWarn)
  const blockers = []
  const base = 47100 + Math.floor(Math.random() * 500)
  try {
    for (let i = 0; i < 12; i += 1) {
      const s = http.createServer()
      await new Promise((r) => s.listen(base + i, '127.0.0.1', r))
      blockers.push(s)
    }
    const proxy = createReasoningPrefixProxy({ getConfig: () => ({}) })
    const port = await proxy.listen(base)
    await sleep(20)
    const leftover = proxy.server.listenerCount('listening') - http.createServer().listenerCount('listening')
    await proxy.close()
    assert.equal(port, base + 12)
    assert.equal(warnings.includes('MaxListenersExceededWarning'), false, '端口回退触发了 MaxListenersExceededWarning')
    assert.equal(leftover, 0, '成功后残留自加的 listening 监听器')
  } finally {
    process.off('warning', onWarn)
    for (const s of blockers) await new Promise((r) => s.close(r))
  }
})
