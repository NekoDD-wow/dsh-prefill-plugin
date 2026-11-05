// 采样覆盖（P1-5）：**对所有变体统一生效**，缺省时完全零变化。
//
// 为什么必须覆盖透传臂：前缀臂被上游拒了会退回透传，如果只有前缀臂带了采样参数，
// 两条臂的采样就不同 —— 那本身就是一个新的混淆变量，实验结论会被它污染。
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createReasoningPrefixProxy } from '../reasoning-prefix.js'

// 故意用带多余空格 + 非标准键序的字节：一旦被重新序列化，Buffer.equals 立刻能看出来。
const ORIGINAL = '{"model":"deepseek-flash",   "messages":[{"role":"user","content":"你好呀"}]}'

const tempDirs = []
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'prefill-sampling-'))
  tempDirs.push(dir)
  return dir
}
test.after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

const startUpstream = async (handler) => {
  const bodies = []
  const raws = []
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const raw = Buffer.concat(chunks)
    raws.push(raw)
    bodies.push(JSON.parse(raw.toString('utf8') || '{}'))
    const out = handler(bodies.length, bodies[bodies.length - 1])
    res.writeHead(out.status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(out.json ?? { ok: true }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    server,
    bodies,
    raws,
    port: server.address().port,
    close: async () => {
      server.closeAllConnections?.()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}

/** 起代理 + 发一条固定字节的请求，把上游/代理交给回调断言，最后统一收尾。 */
const withProxy = async (config, handler, fn) => {
  const upstream = await startUpstream(handler)
  const proxy = createReasoningPrefixProxy({
    getConfig: () => ({
      enabled: true,
      upstream: 'http://127.0.0.1:' + upstream.port,
      reasoningPrefix: '他喵',
      stripTools: true,
      ...config,
    }),
  })
  const port = await proxy.listen(0)
  try {
    const response = await fetch('http://127.0.0.1:' + port + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: ORIGINAL,
    })
    await response.text()
    return await fn({ response, upstream, proxy })
  } finally {
    proxy.server.closeAllConnections?.()
    await proxy.close()
    await upstream.close()
  }
}

/** 第一次 400（前缀臂被拒）、第二次 200（透传兜底成功）⇒ 两条臂都会真的发出去。 */
const rejectFirst = (index) => (index === 1 ? { status: 400, json: { error: { message: 'nope' } } } : { status: 200 })

test('采样覆盖：前缀臂与透传臂都带 temperature / top_p / seed', async () => {
  const file = join(tempDir(), 'result.jsonl')
  await withProxy({ sampling: { temperature: 0.3, topP: 0.9, seed: 42 }, resultFile: file }, rejectFirst, async ({ upstream }) => {
    assert.equal(upstream.bodies.length, 2, '前缀臂被拒 ⇒ 透传臂也要真的发一次')
    for (const [label, body] of [['前缀臂', upstream.bodies[0]], ['透传臂', upstream.bodies[1]]]) {
      assert.equal(body.temperature, 0.3, label + ' 缺 temperature')
      assert.equal(body.top_p, 0.9, label + ' 缺 top_p')
      assert.equal(body.seed, 42, label + ' 缺 seed')
      assert.deepEqual(body.messages[0], { role: 'user', content: '你好呀' }, label + ' 不该丢原始消息')
    }
    const row = JSON.parse(readFileSync(file, 'utf8').trim())
    assert.deepEqual(row.sampling, { temperature: 0.3, topP: 0.9, seed: 42 }, 'row.sampling 记的是发给上游的值')
  })
})

test('采样覆盖：透传臂被重新序列化（不再是 incoming 原字节）', async () => {
  await withProxy({ sampling: { temperature: 0.3 } }, rejectFirst, async ({ upstream }) => {
    assert.equal(upstream.bodies[1].temperature, 0.3)
    assert.equal(upstream.raws[1].equals(Buffer.from(ORIGINAL, 'utf8')), false, '有覆盖时透传臂必须重序列化')
  })
})

test('采样缺省：透传臂字节与 incoming 完全相同（Buffer.equals）', async () => {
  await withProxy({}, rejectFirst, async ({ upstream }) => {
    assert.equal(upstream.bodies.length, 2)
    assert.ok(
      upstream.raws[1].equals(Buffer.from(ORIGINAL, 'utf8')),
      '没有覆盖时透传臂必须原样转发，一个字节都不许变',
    )
  })
})

test('采样缺省：sampling=null / 空对象 / 全非法值 ⇒ 都不干预（零变化）', async () => {
  for (const sampling of [null, {}, undefined, { temperature: Infinity, topP: 'x', seed: 1.5 }]) {
    await withProxy({ sampling }, rejectFirst, async ({ upstream }) => {
      assert.ok(
        upstream.raws[1].equals(Buffer.from(ORIGINAL, 'utf8')),
        'sampling=' + JSON.stringify(sampling) + ' 不该改动透传臂字节',
      )
    })
  }
})

test('row.sampling：入参无采样且无覆盖 ⇒ null', async () => {
  const file = join(tempDir(), 'result.jsonl')
  await withProxy({ resultFile: file }, () => ({ status: 200 }), async () => {
    const row = JSON.parse(readFileSync(file, 'utf8').trim())
    assert.equal(row.sampling, null)
  })
})

test('row.sampling：无覆盖但请求体自带 temperature ⇒ 记「发出值」', async () => {
  const file = join(tempDir(), 'result.jsonl')
  const upstream = await startUpstream(() => ({ status: 200 }))
  const proxy = createReasoningPrefixProxy({
    getConfig: () => ({
      enabled: true,
      upstream: 'http://127.0.0.1:' + upstream.port,
      reasoningPrefix: '他喵',
      stripTools: true,
      resultFile: file,
    }),
  })
  const port = await proxy.listen(0)
  try {
    const response = await fetch('http://127.0.0.1:' + port + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify({ model: 'deepseek-flash', messages: [{ role: 'user', content: '你好呀' }], temperature: 0.7 }),
    })
    await response.text()
    assert.equal(response.status, 200)
    const row = JSON.parse(readFileSync(file, 'utf8').trim())
    assert.deepEqual(row.sampling, { temperature: 0.7, topP: null, seed: null })
    assert.equal(upstream.bodies[0].temperature, 0.7, '没覆盖就原样转发 DSH 自己的决定')
  } finally {
    proxy.server.closeAllConnections?.()
    await proxy.close()
    await upstream.close()
  }
})

test('采样覆盖优先级：覆盖值胜过请求体自带值，且请求体里不存在的键被补上', async () => {
  const file = join(tempDir(), 'result.jsonl')
  const upstream = await startUpstream(() => ({ status: 200 }))
  const proxy = createReasoningPrefixProxy({
    getConfig: () => ({
      enabled: true,
      upstream: 'http://127.0.0.1:' + upstream.port,
      reasoningPrefix: '他喵',
      stripTools: true,
      resultFile: file,
      sampling: { temperature: 0.3, seed: 7 },
    }),
  })
  const port = await proxy.listen(0)
  try {
    const response = await fetch('http://127.0.0.1:' + port + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify({ model: 'deepseek-flash', messages: [{ role: 'user', content: '你好呀' }], temperature: 0.7 }),
    })
    await response.text()
    assert.equal(response.status, 200)
    const sent = upstream.bodies[0]
    assert.equal(sent.temperature, 0.3, '覆盖值优先')
    assert.equal(sent.seed, 7, '请求体没有的键要补上')
    assert.equal(sent.top_p, undefined, '没给 topP 就不许凭空写')
    const row = JSON.parse(readFileSync(file, 'utf8').trim())
    assert.deepEqual(row.sampling, { temperature: 0.3, topP: null, seed: 7 })
  } finally {
    proxy.server.closeAllConnections?.()
    await proxy.close()
    await upstream.close()
  }
})

test('采样覆盖：seed 必须是整数，1.5 被丢弃', async () => {
  await withProxy({ sampling: { seed: 1.5 } }, rejectFirst, async ({ upstream }) => {
    assert.equal(upstream.bodies[0].seed, undefined)
    assert.ok(upstream.raws[1].equals(Buffer.from(ORIGINAL, 'utf8')), '全非法 ⇒ 视同没配，透传臂零变化')
  })
})
