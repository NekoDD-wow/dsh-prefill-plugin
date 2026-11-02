// 思考前缀代理：注入条件（无工具 / 有前缀）和转发行为的最小单测。
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { buildToolCatalog, canInject, injectReasoningPrefix, createReasoningPrefixProxy, createShimStreamParser, parseDsmlToolCalls, transformShimSse } from '../reasoning-prefix.js'

const body = (tools = null) => ({
  model: 'deepseek-flash',
  messages: [{ role: 'user', content: '你好呀' }],
  ...(tools ? { tools } : {}),
})

test('无 tools + 有前缀：末尾追加 assistant 前缀消息', () => {
  const result = injectReasoningPrefix(body(), { reasoningPrefix: '他喵，我最喜欢的喵' })
  assert.equal(result.applied, true)
  const last = result.body.messages.at(-1)
  assert.deepEqual(last, { role: 'assistant', content: '', reasoning_content: '他喵，我最喜欢的喵', prefix: true })
  assert.equal(result.body.messages.length, 2)
  // 原始对象不被修改
  assert.equal(body().messages.length, 1)
})

test('带 tools：不加前缀（官方要求 prefix 与 function calling 互斥）', () => {
  const result = injectReasoningPrefix(body([{ name: 'read' }]), { reasoningPrefix: '他喵' })
  assert.equal(result.applied, false)
  assert.equal(result.reason, 'has-tools')
})

test('空前缀 / 无消息：不加前缀', () => {
  assert.equal(canInject(body(), ''), 'empty-prefix')
  assert.equal(canInject({ messages: [] }, '他喵'), 'no-messages')
})

test('代理：转发时注入前缀、按配置摘掉 tools，并把上游响应原样带回', async () => {
  const captured = []
  const upstream = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    captured.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, path: req.url }))
  })
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const upstreamPort = upstream.address().port
  const proxy = createReasoningPrefixProxy({
    getConfig: () => ({ enabled: true, upstream: `http://127.0.0.1:${upstreamPort}`, reasoningPrefix: '他喵', stripTools: true }),
  })
  const port = await proxy.listen(0)
  try {
    const response = await fetch(`http://127.0.0.1:${port}/beta/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test', connection: 'close' },
      body: JSON.stringify({ model: 'deepseek-flash', messages: [{ role: 'user', content: '你好呀' }], tools: [{ name: 'read' }] }),
    })
    const json = await response.json()
    assert.equal(response.status, 200)
    assert.deepEqual(json, { ok: true, path: '/chat/completions' })
    assert.equal(captured.length, 1)
    assert.equal(captured[0].tools, undefined)
    assert.deepEqual(captured[0].messages.at(-1), { role: 'assistant', content: '', reasoning_content: '他喵', prefix: true })
  } finally {
    proxy.server.closeAllConnections?.()
    await proxy.close()
    upstream.closeAllConnections?.()
    await new Promise((resolve) => upstream.close(resolve))
  }
})

const DSML = '\uFF5C\uFF5C' + 'DSML' + '\uFF5C\uFF5C'

test('工具清单：按真实 schema 拼名字/参数/必填', () => {
  const catalog = buildToolCatalog([
    { name: 'read', description: 'Read a UTF-8 text file', parameters: { type: 'object', properties: { file_path: { type: 'string', description: 'path' }, limit: { type: 'number' } }, required: ['file_path'] } },
    { name: 'bash', description: 'Run a command', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } },
  ])
  assert.match(catalog, /- read：/)
  assert.match(catalog, /file_path:string\(必填\)/)
  assert.match(catalog, /limit:number/)
  assert.match(catalog, /- bash：/)
  assert.match(catalog, /string="true"/)
})

test('DSML 解析：数字参数按 JSON、字符串参数按原文', () => {
  const text = '<' + DSML + ' invoke name="read">' + '<' + DSML + ' parameter name="file_path" string="true">E:\\a.md</' + DSML + ' parameter>' + '<' + DSML + ' parameter name="limit">10</' + DSML + ' parameter>' + '</' + DSML + ' invoke>'
  assert.deepEqual(parseDsmlToolCalls(text).calls, [{ name: 'read', arguments: '{"file_path":"E:\\\\a.md","limit":10}' }])
})

test('SSE 改写：DSML 调用变成结构化 tool_calls，残留标签清掉', () => {
  const content = '前文<' + DSML + ' invoke name="read">' + '<' + DSML + ' parameter name="file_path" string="true">a.md</' + DSML + ' parameter>' + '</' + DSML + ' invoke>后文'
  const raw = 'data: ' + JSON.stringify({ id: 'x', model: 'deepseek-flash', created: 1, choices: [{ index: 0, delta: { role: 'assistant', content } }] }) + '\n\ndata: [DONE]\n\n'
  const out = transformShimSse(raw).text
  assert.match(out, /"tool_calls"/)
  assert.match(out, /"name":"read"/)
  assert.match(out, /"file_path\\":\\"a.md\\"/)
  assert.match(out, /"finish_reason":"tool_calls"/)
  assert.doesNotMatch(out, /DSML/)
  assert.match(out, /前文/)
  assert.match(out, /后文/)
  assert.match(out, /data: \[DONE\]/)
})

test('SSE 改写：没有 DSML 时按普通文本还原', () => {
  const raw = 'data: ' + JSON.stringify({ id: 'x', model: 'deepseek-flash', created: 1, choices: [{ index: 0, delta: { role: 'assistant', content: '你好' } }] }) + '\n\ndata: [DONE]\n\n'
  const out = transformShimSse(raw).text
  assert.match(out, /你好/)
  assert.match(out, /"finish_reason":"stop"/)
  assert.doesNotMatch(out, /tool_calls/)
})

const startUpstream = async (handler) => {
  const bodies = []
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    bodies.push(body)
    const out = handler(bodies.length, body)
    res.writeHead(out.status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(out.json ?? { ok: true }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, bodies, port: server.address().port }
}

test('系统消息伪装：清单以 role=system 注入在 prefix 之前', async () => {
  const upstream = await startUpstream(() => ({ status: 200 }))
  const proxy = createReasoningPrefixProxy({
    getConfig: () => ({ enabled: true, upstream: 'http://127.0.0.1:' + upstream.port, reasoningPrefix: '他喵', stripTools: true, shim: true, textualize: true, catalog: '清单正文' }),
  })
  const port = await proxy.listen(0)
  try {
    const response = await fetch('http://127.0.0.1:' + port + '/beta/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify({ model: 'deepseek-flash', messages: [{ role: 'user', content: '你好' }] }),
    })
    assert.equal(response.status, 200)
    const sent = upstream.bodies[0]
    const last = sent.messages.at(-1)
    const catalog = sent.messages.at(-2)
    assert.equal(last.role, 'assistant')
    assert.equal(last.prefix, true)
    assert.deepEqual(catalog, { role: 'system', content: '清单正文' })
  } finally {
    proxy.server.closeAllConnections?.()
    await proxy.close()
    upstream.server.closeAllConnections?.()
    await new Promise((resolve) => upstream.server.close(resolve))
  }
})

test('回退链：system 版被拒 → user 包装版重试，审计记录 400', async () => {
  const upstream = await startUpstream((index) => (index === 1 ? { status: 400, json: { error: { message: 'system not allowed' } } } : { status: 200 }))
  const proxy = createReasoningPrefixProxy({
    getConfig: () => ({ enabled: true, upstream: 'http://127.0.0.1:' + upstream.port, reasoningPrefix: '他喵', stripTools: true, shim: true, textualize: true, catalog: '清单正文' }),
  })
  const port = await proxy.listen(0)
  try {
    const response = await fetch('http://127.0.0.1:' + port + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify({ model: 'deepseek-flash', messages: [{ role: 'user', content: '你好' }] }),
    })
    assert.equal(response.status, 200)
    assert.equal(upstream.bodies.length, 2)
    const catalog = upstream.bodies[1].messages.at(-2)
    assert.equal(catalog.role, 'user')
    assert.match(catalog.content, /<system-reminder>/)
    const audit = proxy.audit()
    assert.ok(audit.some((entry) => entry.kind === 'upstream-error' && entry.status === 400))
  } finally {
    proxy.server.closeAllConnections?.()
    await proxy.close()
    upstream.server.closeAllConnections?.()
    await new Promise((resolve) => upstream.server.close(resolve))
  }
})

// ── 流式改写（item 6：边收边转发）───────────────────────────────────────────
const tag = (name) => '<' + DSML + ' ' + name + '>'

test('流式解析：纯文本立即吐出，不留缓冲', () => {
  const parser = createShimStreamParser()
  assert.deepEqual(parser.push('你好'), [{ type: 'content', text: '你好' }])
  assert.deepEqual(parser.push('，世界'), [{ type: 'content', text: '，世界' }])
  assert.deepEqual(parser.end(), [])
})

test('流式解析：调用块跨 chunk 也能拼起来，前后文本照常吐出', () => {
  const parser = createShimStreamParser()
  const call = tag('invoke name="read"') + tag('parameter name="file_path" string="true"') + 'a.md</' + DSML + ' parameter>' + '</' + DSML + ' invoke>'
  const first = parser.push('前文' + call.slice(0, 8))
  assert.deepEqual(first.map((event) => event.type), ['content'])
  const rest = parser.push(call.slice(8) + '后文')
  const calls = rest.filter((event) => event.type === 'calls')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].calls[0].name, 'read')
  assert.equal(calls[0].calls[0].arguments, JSON.stringify({ file_path: 'a.md' }))
  const textAfter = rest.filter((event) => event.type === 'content').map((event) => event.text).join('') + parser.end().map((event) => event.text).join('')
  assert.equal(textAfter, '后文')
})

test('流式解析：句末单独的 < 会等一下个 chunk，凑不上就按文本吐出', () => {
  const parser = createShimStreamParser()
  const first = parser.push('a<').map((event) => event.text ?? '').join('')
  const second = parser.push('b').map((event) => event.text ?? '').join('')
  assert.equal(first, 'a')
  assert.equal(second, '<b')
  assert.deepEqual(parser.end(), [])
})

test('流式解析：外层 calls 包装直接吃掉', () => {
  const parser = createShimStreamParser()
  const text = tag('calls') + tag('invoke name="bash"') + tag('parameter name="command" string="true"') + 'ls</' + DSML + ' parameter>' + '</' + DSML + ' invoke>' + '</' + DSML + ' calls>'
  const events = parser.push(text)
  assert.equal(events.filter((event) => event.type === 'calls').length, 1)
  assert.deepEqual(parser.end(), [])
})


test('流式解析：残留的 </｜｜DSML｜｜> 之类标记清掉', () => {
  const parser = createShimStreamParser()
  assert.deepEqual(parser.push('</' + DSML + '>'), [])
  const text = parser.push('正文</' + DSML + ' invoke>尾巴').map((event) => event.text ?? '').join('')
  assert.equal(text, '正文尾巴')
})


test('流式解析：坏掉的重复闭合标记与参数泄漏都清掉', () => {
  const parser = createShimStreamParser()
  const noisy = "\n\n<｜｜DSML｜｜ invoke name=\"read\">\n<｜｜DSML｜｜ parameter name=\"file_path\" string=\"true\">E:\\py\\output\\aiouput\\dsh科研\\PLAN.md</｜｜DSML｜｜ parameter>\n<｜｜DSML｜｜ parameter name=\"limit\">3</｜｜DSML｜｜ parameter>\n</｜｜DSML｜｜ invoke>\n</｜｜ parameter name=\"limit\">3</｜｜ parameter>\n</｜｜ invoke>\n"
  const events = parser.push(noisy)
  const calls = events.filter((event) => event.type === 'calls')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].calls[0].name, 'read')
  const text = events.filter((event) => event.type === 'content').map((event) => event.text).join('') + parser.end().map((event) => event.text).join('')
  assert.doesNotMatch(text, /｜/)
  assert.doesNotMatch(text, /E:\\py/)
})


test('代理流式：重复调用去重、坏名字丢弃', async () => {
  const content = [
    '<' + DSML + ' invoke name="read">' + '<' + DSML + ' parameter name="file_path" string="true">a.md</' + DSML + ' parameter>' + '</' + DSML + ' invoke>',
    '<' + DSML + ' invoke name="read">' + '<' + DSML + ' parameter name="file_path" string="true">a.md</' + DSML + ' parameter>' + '</' + DSML + ' invoke>',
    '<' + DSML + ' invoke name="bad name!">' + '</' + DSML + ' invoke>',
  ].join('')
  const frame = 'data: ' + JSON.stringify({ id: 'x', model: 'm', created: 1, choices: [{ index: 0, delta: { content } }] }) + '\n\n'
  const end = 'data: ' + JSON.stringify({ id: 'x', model: 'm', created: 1, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n'
  const upstream = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(frame + end) })
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const proxy = createReasoningPrefixProxy({ getConfig: () => ({ enabled: true, upstream: 'http://127.0.0.1:' + upstream.address().port, reasoningPrefix: 'x', stripTools: true, shim: true, textualize: true, catalog: '清单' }) })
  const port = await proxy.listen(0)
  try {
    const response = await fetch('http://127.0.0.1:' + port + '/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'm', stream: true, messages: [{ role: 'user', content: 'hi' }] }) })
    const text = await response.text()
    assert.equal((text.match(/"name":"read"/g) ?? []).length, 1, '重复调用只保留一个')
    assert.doesNotMatch(text, /bad name/)
    assert.match(text, /"finish_reason":"tool_calls"/)
  } finally {
    proxy.server.closeAllConnections?.()
    await proxy.close()
    upstream.closeAllConnections?.()
    await new Promise((resolve) => upstream.close(resolve))
  }
})

test('代理流式：上游慢慢吐，客户端先收到文本块（不是整段缓冲）', async () => {
  const frames = [
    'data: ' + JSON.stringify({ id: 'x', model: 'm', created: 1, choices: [{ index: 0, delta: { role: 'assistant', content: '先到的文本' } }] }) + '\n\n',
    'data: ' + JSON.stringify({ id: 'x', model: 'm', created: 1, choices: [{ index: 0, delta: { content: '然后' } }] }) + '\n\n',
    'data: ' + JSON.stringify({ id: 'x', model: 'm', created: 1, choices: [{ index: 0, delta: { content: '结束' }, finish_reason: 'stop' }] }) + '\n\n',
    'data: ' + JSON.stringify({ id: 'x', model: 'm', created: 1, choices: [], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } }) + '\n\n',
    'data: [DONE]\n\n',
  ]
  const upstream = http.createServer(async (req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(frames[0])
    await new Promise((resolve) => setTimeout(resolve, 250))
    for (const frame of frames.slice(1)) res.write(frame)
    res.end()
  })
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const proxy = createReasoningPrefixProxy({
    getConfig: () => ({ enabled: true, upstream: 'http://127.0.0.1:' + upstream.address().port, reasoningPrefix: 'x', stripTools: true, shim: true, textualize: true, catalog: '清单' }),
  })
  const port = await proxy.listen(0)
  try {
    const started = Date.now()
    const response = await fetch('http://127.0.0.1:' + port + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'm', stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    })
    assert.equal(response.status, 200)
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let text = ''
    let firstChunkAt = null
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (firstChunkAt === null) firstChunkAt = Date.now() - started
      text += decoder.decode(value, { stream: true })
    }
    const total = Date.now() - started
    assert.ok(firstChunkAt !== null && firstChunkAt < total - 100, '首块应该早于整段结束（流式）')
    assert.match(text, /先到的文本/)
    assert.match(text, /"finish_reason":"stop"/)
    assert.match(text, /"usage"/)
    assert.match(text, /"usage":{"prompt_tokens":1/)
    assert.match(text, /data: \[DONE\]/)
  } finally {
    proxy.server.closeAllConnections?.()
    await proxy.close()
    upstream.closeAllConnections?.()
    await new Promise((resolve) => upstream.close(resolve))
  }
})


