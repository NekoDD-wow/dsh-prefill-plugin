// F16：shim 尊重客户端的 `stream`（fail-fast）+ F15-B：清单「同文本不重复注入」。
//
// F16 的坑：shim 分支会伪造 SSE 帧序列，非流式客户端拿到的协议是错的。判据必须是
// `stream === false`（缺省当流式）——写成 `stream !== true` 会把所有不带 stream 的请求误杀。
// F15-B 的坑：短路以前只在 history 模式生效，「用过 history 又切回 each」的会话会拿到两份清单。
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createReasoningPrefixProxy,
  hasSameToolCatalog,
  hasToolCatalogMessage,
  TOOL_CATALOG_MARK,
} from '../reasoning-prefix.js'

const CATALOG = TOOL_CATALOG_MARK + '本轮没有 tools 参数。可用工具：\n- read\n- glob\n- grep'
const OLD_CATALOG = TOOL_CATALOG_MARK + '本轮没有 tools 参数。可用工具：\n- read'

const tempDirs = []
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'prefill-shim-'))
  tempDirs.push(dir)
  return dir
}
test.after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

/** 上游桩：记下每次请求的解析体，按 index 决定响应。 */
const startUpstream = async (handler) => {
  const bodies = []
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    bodies.push(body)
    const out = handler(bodies.length, body)
    res.writeHead(out.status, { 'content-type': out.contentType ?? 'application/json' })
    res.end(out.raw ?? JSON.stringify(out.json ?? { ok: true }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    server,
    bodies,
    port: server.address().port,
    close: async () => {
      server.server?.closeAllConnections?.()
      server.closeAllConnections?.()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}

const SSE_OK = [
  'data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: '你好' } }] }) + '\n\n',
  'data: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\n',
  'data: [DONE]\n\n',
].join('')

const readRows = (file) => {
  const text = readFileSync(file, 'utf8').trim()
  return text === '' ? [] : text.split('\n').map((line) => JSON.parse(line))
}

/** 发一条请求、跑完、把两侧都收干净。 */
const run = async ({ config, body, handler }) => {
  const upstream = await startUpstream(handler ?? (() => ({ status: 200, contentType: 'text/event-stream', raw: SSE_OK })))
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
      body: JSON.stringify(body),
    })
    const text = await response.text()
    return { response, text, upstream }
  } finally {
    proxy.server.closeAllConnections?.()
    await proxy.close()
    await upstream.close()
  }
}

const chatBody = (extra) => ({ model: 'deepseek-flash', messages: [{ role: 'user', content: '你好呀' }], ...extra })

// ── F16：stream 判据 ───────────────────────────────────────────────────────

test('F16：shim 生效 + stream:false ⇒ 400，且一次上游都不打', async () => {
  const file = join(tempDir(), 'result.jsonl')
  const { response, text, upstream } = await run({
    config: { shim: true, resultFile: file },
    body: chatBody({ stream: false }),
  })
  assert.equal(response.status, 400)
  assert.equal(upstream.bodies.length, 0, 'fail-fast 必须在变体链之前拦下，不打上游')
  const payload = JSON.parse(text)
  assert.equal(payload.error.code, 'non_streaming_unsupported')
  assert.match(payload.error.message, /只支持流式/)

  // 结果行照落：每请求恰好一行、verdict=error、status=400、没有 attempts。
  const rows = readRows(file)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].ok, false)
  assert.equal(rows[0].status, 400)
  assert.equal(rows[0].variant, 'none')
  assert.equal(rows[0].verdict, 'error')
  assert.deepEqual(rows[0].attempts, [])
})

test('F16：shim 生效 + 缺 stream ⇒ 行为不变（缺省当流式）', async () => {
  const { response, text, upstream } = await run({ config: { shim: true }, body: chatBody() })
  assert.equal(response.status, 200)
  assert.match(String(response.headers.get('content-type')), /text\/event-stream/)
  assert.match(text, /data: \[DONE\]/)
  assert.equal(upstream.bodies.length, 1)
})

test('F16：shim 生效 + stream:true ⇒ 行为不变', async () => {
  const { response, text, upstream } = await run({ config: { shim: true }, body: chatBody({ stream: true }) })
  assert.equal(response.status, 200)
  assert.match(text, /data: \[DONE\]/)
  assert.equal(upstream.bodies.length, 1)
})

test('F16：shim 关掉时 stream:false 照常原样转发（非流式客户端本来就能用）', async () => {
  const { response, upstream } = await run({
    config: {},
    body: chatBody({ stream: false }),
    handler: () => ({ status: 200, json: { ok: true } }),
  })
  assert.equal(response.status, 200)
  assert.equal(upstream.bodies.length, 1)
  assert.equal(upstream.bodies[0].stream, false, '原样转发，不改客户端语义')
})

test('F16：前缀没生效（空前缀）时不拦，照常透传', async () => {
  const { response, upstream } = await run({
    config: { shim: true, reasoningPrefix: '' },
    body: chatBody({ stream: false }),
    handler: () => ({ status: 200, json: { ok: true } }),
  })
  assert.equal(response.status, 200, '本轮没加前缀 ⇒ shim 不生效 ⇒ 非流式客户端照常可用')
  assert.equal(upstream.bodies.length, 1)
})

test('F16：带 tools 但 stripTools=true ⇒ 本轮仍会加前缀，所以 stream:false 照样拦', async () => {
  // 生产里 stripTools 是开的：tools 被剥掉换成文本清单 ⇒ 这就是一条前缀请求 ⇒ shim 会伪造 SSE。
  const { response, upstream } = await run({
    config: { shim: true },
    body: { model: 'deepseek-flash', messages: [{ role: 'user', content: '你好呀' }], tools: [{ name: 'read' }], stream: false },
  })
  assert.equal(response.status, 400)
  assert.equal(upstream.bodies.length, 0)
})

// ── F15-B：清单同文本不重复注入 ───────────────────────────────────────────

/** 数上游收到的 messages 里有几条带清单标记。 */
const countCatalogs = (messages) => messages.filter((message) => hasToolCatalogMessage([message])).length

test('F15-B：历史已有同文本清单（each 模式）⇒ 上游只有一份', async () => {
  const file = join(tempDir(), 'result.jsonl')
  const { response, upstream } = await run({
    config: { shim: true, catalog: CATALOG, catalogMode: 'each', resultFile: file },
    body: {
      model: 'deepseek-flash',
      messages: [
        { role: 'system', content: '系统提示' },
        { role: 'user', content: CATALOG }, // 以前 history 模式注入的那份，还留在历史里
        { role: 'user', content: '你好呀' },
      ],
    },
  })
  assert.equal(response.status, 200)
  const sent = upstream.bodies[0].messages
  assert.equal(countCatalogs(sent), 1, '历史里那份就是本轮的清单 ⇒ 不许再注入第二份')
  assert.equal(sent.filter((message) => message.role === 'user' && message.content === CATALOG).length, 1)
  assert.equal(readRows(file)[0].catalogInjected, false, '跳过注入要如实反映到结果行')
})

test('F15-B：历史清单文本不同 ⇒ 仍注入新的（共两份，其中一份是新清单）', async () => {
  const file = join(tempDir(), 'result.jsonl')
  const { response, upstream } = await run({
    config: { shim: true, catalog: CATALOG, catalogMode: 'each', resultFile: file },
    body: {
      model: 'deepseek-flash',
      messages: [
        { role: 'system', content: '系统提示' },
        { role: 'user', content: OLD_CATALOG },
        { role: 'user', content: '你好呀' },
      ],
    },
  })
  assert.equal(response.status, 200)
  const sent = upstream.bodies[0].messages
  assert.equal(countCatalogs(sent), 2, '工具集变了就必须带上新清单（旧清单里的工具可能已经不存在）')
  assert.ok(sent.some((message) => message.content === CATALOG), '新清单必须在')
  assert.ok(sent.some((message) => message.content === OLD_CATALOG), '旧那份留在历史里（不动它）')
  assert.equal(readRows(file)[0].catalogInjected, true)
})

test('F15-B：DSH 侧形状（source.prefill=tool-catalog + block 数组）同样短路', async () => {
  const { response, upstream } = await run({
    config: { shim: true, catalog: CATALOG, catalogMode: 'each' },
    body: {
      model: 'deepseek-flash',
      messages: [
        { role: 'user', source: { kind: 'prefill', prefill: 'tool-catalog', catalogHash: 'abc' }, content: [{ type: 'text', text: CATALOG }] },
        { role: 'user', content: '你好呀' },
      ],
    },
  })
  assert.equal(response.status, 200)
  assert.equal(countCatalogs(upstream.bodies[0].messages), 1)
})

test('F15-B：带 source 且明确不是清单 ⇒ 不拿它当清单（仍注入）', async () => {
  const { response, upstream } = await run({
    config: { shim: true, catalog: CATALOG, catalogMode: 'each' },
    body: {
      model: 'deepseek-flash',
      messages: [
        { role: 'user', source: { kind: 'user' }, content: CATALOG },
        { role: 'user', content: '你好呀' },
      ],
    },
  })
  assert.equal(response.status, 200)
  assert.equal(countCatalogs(upstream.bodies[0].messages), 2, 'source 说这是普通用户消息 ⇒ 不能据此短路')
})

test('F15-B：history 模式 + 历史有同文本 ⇒ 不注入（原行为保持）', async () => {
  const { response, upstream } = await run({
    config: { shim: true, catalog: CATALOG, catalogMode: 'history' },
    body: {
      model: 'deepseek-flash',
      messages: [
        { role: 'system', content: '系统提示' },
        { role: 'user', content: CATALOG },
        { role: 'user', content: '你好呀' },
      ],
    },
  })
  assert.equal(response.status, 200)
  assert.equal(countCatalogs(upstream.bodies[0].messages), 1)
})

test('F15-B：历史里没有清单 ⇒ 照常注入（不能被新短路误伤）', async () => {
  const file = join(tempDir(), 'result.jsonl')
  const { response, upstream } = await run({
    config: { shim: true, catalog: CATALOG, catalogMode: 'each', resultFile: file },
    body: chatBody(),
  })
  assert.equal(response.status, 200)
  assert.equal(countCatalogs(upstream.bodies[0].messages), 1)
  assert.equal(readRows(file)[0].catalogInjected, true)
})

// ── 纯函数边界 ─────────────────────────────────────────────────────────────

test('hasSameToolCatalog：逐字相同才算；空清单 / 空消息不算', () => {
  const wire = [{ role: 'user', content: CATALOG }]
  assert.equal(hasSameToolCatalog(wire, CATALOG), true)
  assert.equal(hasSameToolCatalog([{ role: 'user', content: CATALOG + ' ' }], CATALOG), false, '多一个空格就不算同一份')
  assert.equal(hasSameToolCatalog(wire, OLD_CATALOG), false)
  assert.equal(hasSameToolCatalog(wire, ''), false, '本轮没有清单 ⇒ 谈不上"已有"')
  assert.equal(hasSameToolCatalog([], CATALOG), false)
  assert.equal(hasSameToolCatalog(undefined, CATALOG), false)
  assert.equal(hasSameToolCatalog([{ role: 'user', content: '你好' }], CATALOG), false)
})

test('hasSameToolCatalog：block 数组与字符串两种形状等价', () => {
  assert.equal(hasSameToolCatalog([{ role: 'user', content: [{ type: 'text', text: CATALOG }] }], CATALOG), true)
  assert.equal(hasSameToolCatalog([{ role: 'user', content: CATALOG }], CATALOG), true)
})

test('hasToolCatalogMessage 原语义未动（只看标记，不看是否同一份）', () => {
  assert.equal(hasToolCatalogMessage([{ role: 'user', content: '你好' }]), false)
  assert.equal(hasToolCatalogMessage([{ role: 'user', content: OLD_CATALOG }]), true)
  assert.equal(hasToolCatalogMessage([{ role: 'user', content: [{ type: 'text', text: '前言\n' + TOOL_CATALOG_MARK }] }]), true)
})
