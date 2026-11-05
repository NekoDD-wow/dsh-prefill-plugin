// 结构化结果行（F11）：每请求恰好一行 + attempts 序列 + 冻结字段完备 + 关联通道纯函数。
//
// 关键回归：以前「一次全失败」会在旧 JSONL 里落 3 行（每个变体一行）。结果行走**独立 sink**
// 并用 try/finally + wrote 守卫，所以行数与早退分支数量无关。
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createReasoningPrefixProxy,
  extractResponseText,
  lastMessageHash,
  matchPendingTrace,
  messageText,
} from '../reasoning-prefix.js'

/** 冻结字段集（task-9 清单 ∪ `前缀功能-修复计划.md` §5 的最终裁定）。 */
const FROZEN_FIELDS = [
  'at', 'requestId', 'sessionId', 'turn', 'step', 'armId', 'runId',
  'ok', 'status', 'variant', 'attempts', 'ms', 'firstDeltaMs',
  'catalogBytes', 'catalogInjected', 'catalogMode', 'catalogPosition', 'catalogDetail', 'catalogRole',
  'prefix', 'sampling', 'usage', 'textHead', 'textTail', 'reasoningHead',
  'routeConfidence', 'autoDisabled', 'verdict',
]

const tempDirs = []
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'prefill-result-'))
  tempDirs.push(dir)
  return dir
}
test.after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

/** 上游桩：记录每次请求的解析体与原始字节，按 index 决定响应。 */
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
    res.writeHead(out.status, { 'content-type': out.contentType ?? 'application/json' })
    res.end(out.raw ?? JSON.stringify(out.json ?? { ok: true }))
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

/** 一段最小 SSE（可选思维链 + 正文 + finish + [DONE]）。 */
const sse = (text, reasoning) => {
  const frames = []
  if (reasoning !== undefined) {
    frames.push('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { reasoning_content: reasoning } }] }) + '\n\n')
  }
  if (text !== undefined) {
    frames.push('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] }) + '\n\n')
  }
  frames.push('data: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\n')
  frames.push('data: [DONE]\n\n')
  return frames.join('')
}

const readRows = (file) => {
  const text = readFileSync(file, 'utf8').trim()
  if (text === '') return []
  return text.split('\n').map((line) => JSON.parse(line))
}

const post = (port) =>
  fetch('http://127.0.0.1:' + port + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify({ model: 'deepseek-flash', messages: [{ role: 'user', content: '你好呀' }] }),
  })

/** 起一个代理 + 跑一次请求 + 收结果行；finally 里负责关掉两侧。 */
const runOnce = async ({ config, handler, chatBody }) => {
  const upstream = await startUpstream(handler)
  const proxy = createReasoningPrefixProxy({
    getConfig: () => ({ enabled: true, upstream: 'http://127.0.0.1:' + upstream.port, reasoningPrefix: '他喵', stripTools: true, ...config }),
  })
  const port = await proxy.listen(0)
  try {
    const response = chatBody === undefined
      ? await post(port)
      : await fetch('http://127.0.0.1:' + port + '/v1/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', connection: 'close' },
          body: chatBody,
        })
    await response.text()
    return { response, stats: proxy.stats(), audit: proxy.audit() }
  } finally {
    proxy.server.closeAllConnections?.()
    await proxy.close()
    await upstream.close()
  }
}

// ── 每请求恰好一行 ──────────────────────────────────────────────────────────

test('结果行：回退链 400→200 ⇒ 文件恰好 1 行，attempts 逐次记账', async () => {
  const file = join(tempDir(), 'result.jsonl')
  const upstream = await startUpstream((index) =>
    index === 1
      ? { status: 400, json: { error: { message: 'system not allowed' } } }
      : { status: 200, contentType: 'text/event-stream', raw: sse('你好', '先看看用户要什么，再决定怎么答') },
  )
  const proxy = createReasoningPrefixProxy({
    getConfig: () => ({
      enabled: true,
      upstream: 'http://127.0.0.1:' + upstream.port,
      reasoningPrefix: '他喵，我最喜欢的喵',
      stripTools: true,
      shim: true,
      textualize: true,
      catalog: '清单正文',
      resultFile: file,
      resultEnabled: true,
      reasoningHeadEnabled: true,
      armId: 'A1',
      runId: 'r-7',
    }),
  })
  const port = await proxy.listen(0)
  try {
    const response = await post(port)
    await response.text()
    assert.equal(response.status, 200)

    const rows = readRows(file)
    assert.equal(rows.length, 1, '每请求恰好一行（回退链两次尝试也只落一行）')
    const row = rows[0]
    assert.equal(row.ok, true)
    assert.equal(row.status, 200)
    assert.equal(row.variant, 'user', 'system 被拒后 user 变体生效')
    assert.equal(row.attempts.length, 2)
    assert.deepEqual(
      row.attempts.map((a) => [a.variant, a.status, a.ok]),
      [['system', 400, false], ['user', 200, true]],
    )
    assert.ok(row.attempts.every((a) => Number.isFinite(a.ms)), 'attempts 每项都要有 ms')
    assert.equal(row.armId, 'A1')
    assert.equal(row.runId, 'r-7')
    assert.equal(row.textHead, '你好')
    // 上游返回的是**续写**（真实形态：前缀不回显）—— 所以只记事实，不做「前缀是否被延续」的判定。
    assert.equal(row.reasoningHead, '先看看用户要什么，再决定怎么答')
    assert.equal(row.verdict, 'reasoning-collected')
    assert.ok(Number.isFinite(row.firstDeltaMs), '首块延迟也要落行（面板与实验都要用）')
    assert.ok(Number.isFinite(row.ms))
  } finally {
    proxy.server.closeAllConnections?.()
    await proxy.close()
    await upstream.close()
  }
})

test('结果行：全失败（system/user/passthrough 皆 400）⇒ 恰好 1 行且 attempts.length===3', async () => {
  const file = join(tempDir(), 'result.jsonl')
  const { response, stats } = await runOnce({
    config: { shim: true, textualize: true, catalog: '清单正文', resultFile: file, reasoningHeadEnabled: true },
    handler: () => ({ status: 400, json: { error: { message: 'nope' } } }),
  })
  assert.equal(response.status, 400, '透传兜底也被拒 ⇒ 原样把上游状态回给客户端')
  const rows = readRows(file)
  assert.equal(rows.length, 1, '修前这里会落 3 行')
  const row = rows[0]
  assert.equal(row.ok, false)
  assert.equal(row.status, 400)
  assert.equal(row.attempts.length, 3)
  assert.deepEqual(row.attempts.map((a) => a.variant), ['system', 'user', 'passthrough'])
  assert.deepEqual(row.attempts.map((a) => a.ok), [false, false, false])
  assert.equal(row.verdict, 'error')
  assert.equal(row.reasoningHead, null)
  // 旧语义未动：audit 仍逐变体记 upstream-error，record()/audit 一个字没改。
  assert.equal(stats.failed, 1)
  assert.equal(stats.requests, 1)
})

test('extractResponseText：认不出的返回空串（不把原始帧当正文）', () => {
  assert.equal(extractResponseText('application/json', '{"ok":true}'), '')
  assert.equal(extractResponseText('application/json', 'not json'), '')
  assert.equal(extractResponseText('text/event-stream', 'data: {bad}\n\n'), '')
  assert.equal(extractResponseText('application/json', JSON.stringify({ choices: [{ message: { content: 'x' } }] })), 'x')
  assert.equal(extractResponseText('text/event-stream', 'data: {"choices":[{"delta":{"content":"a"}}]}\n\ndata: [DONE]\n\n'), 'a')
})

test('textHead：非 shim 透传也要抽模型正文，不能把整段 JSON / SSE 原始帧写进去', async () => {
  const jsonFile = join(tempDir(), 'result-json.jsonl')
  await runOnce({
    config: { resultFile: jsonFile, shim: false },
    handler: () => ({ status: 200, json: { choices: [{ message: { content: '正文内容' } }] } }),
  })
  assert.equal(readRows(jsonFile)[0].textHead, '正文内容')

  const sseFile = join(tempDir(), 'result-sse.jsonl')
  await runOnce({
    config: { resultFile: sseFile, shim: false },
    handler: () => ({ status: 200, contentType: 'text/event-stream', raw: sse('流式正文', undefined) }),
  })
  assert.equal(readRows(sseFile)[0].textHead, '流式正文')
})

test('结果行：单变体成功（无回退）也只落一行', async () => {
  const file = join(tempDir(), 'result.jsonl')
  const { response } = await runOnce({
    config: { resultFile: file },
    handler: () => ({ status: 200, json: { ok: true } }),
  })
  assert.equal(response.status, 200)
  const rows = readRows(file)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].variant, 'prefixed')
  assert.equal(rows[0].attempts.length, 1)
  assert.equal(rows[0].attempts[0].ok, true)
})

// ── 开关与默认（代理层默认不写文件）────────────────────────────────────────

test('结果行：resultFile 为空 ⇒ 一个文件都不建（代理层默认不写，避免污染 DATA_DIR）', async () => {
  const dir = tempDir()
  const { response } = await runOnce({
    config: { resultFile: '' },
    handler: () => ({ status: 200, json: { ok: true } }),
  })
  assert.equal(response.status, 200)
  assert.deepEqual(readdirSync(dir), [])
})

test('结果行：resultEnabled=false ⇒ 有路径也不写（显式关闭可持久）', async () => {
  const file = join(tempDir(), 'result.jsonl')
  const { response } = await runOnce({
    config: { resultFile: file, resultEnabled: false },
    handler: () => ({ status: 200, json: { ok: true } }),
  })
  assert.equal(response.status, 200)
  assert.throws(() => readFileSync(file, 'utf8'), '关掉之后连文件都不该出现')
})

// ── 字段完备 ────────────────────────────────────────────────────────────────

test('结果行：Object.keys(row) 覆盖全部冻结字段，且嵌套结构齐全', async () => {
  const file = join(tempDir(), 'result.jsonl')
  await runOnce({
    config: {
      resultFile: file,
      reasoningHeadEnabled: true,
      sampling: { temperature: 0.3, topP: 0.9, seed: 42 },
      armId: 'A1',
      runId: 'r-1',
    },
    handler: () => ({
      status: 200,
      contentType: 'text/event-stream',
      raw: sse('正文', '思考'),
    }),
  })
  const row = readRows(file)[0]
  for (const key of FROZEN_FIELDS) {
    assert.ok(Object.hasOwn(row, key), '缺少冻结字段: ' + key)
  }
  assert.deepEqual(Object.keys(row.prefix), ['reasoningLen', 'contentLen'])
  assert.deepEqual(Object.keys(row.attempts[0]), ['variant', 'status', 'ok', 'ms'])
  assert.deepEqual(Object.keys(row.sampling), ['temperature', 'topP', 'seed'])
  assert.deepEqual(row.sampling, { temperature: 0.3, topP: 0.9, seed: 42 })
  // 关联未命中 ⇒ sessionId/turn/step 仍是 null（键必须在）
  assert.equal(row.sessionId, null)
  assert.equal(row.turn, null)
  assert.equal(row.step, null)
  assert.equal(row.routeConfidence, 'none')
  assert.equal(row.autoDisabled, false)
})

test('结果行：resolveTrace 命中 ⇒ sessionId/turn/step/routeConfidence 落盘', async () => {
  const file = join(tempDir(), 'result.jsonl')
  await runOnce({
    config: {
      resultFile: file,
      resolveTrace: () => ({ sessionId: 'session-1', turn: 3, step: 2, confidence: 'content' }),
    },
    handler: () => ({ status: 200, json: { ok: true } }),
  })
  const row = readRows(file)[0]
  assert.equal(row.sessionId, 'session-1')
  assert.equal(row.turn, 3)
  assert.equal(row.step, 2)
  assert.equal(row.routeConfidence, 'content')
})

test('结果行：resolveTrace 抛错 ⇒ 不影响转发，行照落（routeConfidence=none）', async () => {
  const file = join(tempDir(), 'result.jsonl')
  const { response } = await runOnce({
    config: {
      resultFile: file,
      resolveTrace: () => { throw new Error('boom') },
    },
    handler: () => ({ status: 200, json: { ok: true } }),
  })
  assert.equal(response.status, 200)
  const row = readRows(file)[0]
  assert.equal(row.routeConfidence, 'none')
  assert.equal(row.sessionId, null)
})

// ── autoDisabled（必须在写行之前取用）─────────────────────────────────────

test('结果行：onOutcome 返回 {autoDisabled:true} ⇒ 行里 autoDisabled=true（写行前取用）', async () => {
  const upstream = await startUpstream(() => ({ status: 400, json: { error: { message: 'nope' } } }))
  const file = join(tempDir(), 'result.jsonl')
  const proxy = createReasoningPrefixProxy({
    getConfig: () => ({ enabled: true, upstream: 'http://127.0.0.1:' + upstream.port, reasoningPrefix: '他喵', stripTools: true, resultFile: file }),
    onOutcome: () => ({ autoDisabled: true }),
  })
  const port = await proxy.listen(0)
  try {
    const response = await post(port)
    await response.text()
    assert.equal(response.status, 400)
    const rows = readRows(file)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].autoDisabled, true, 'onOutcome 的返回值必须在 finally 写行之前被取到')
  } finally {
    proxy.server.closeAllConnections?.()
    await proxy.close()
    await upstream.close()
  }
})

test('结果行：onOutcome 返回 undefined ⇒ autoDisabled 保持 false（向后兼容）', async () => {
  const file = join(tempDir(), 'result.jsonl')
  const upstream = await startUpstream(() => ({ status: 200, json: { ok: true } }))
  const proxy = createReasoningPrefixProxy({
    getConfig: () => ({ enabled: true, upstream: 'http://127.0.0.1:' + upstream.port, reasoningPrefix: '他喵', stripTools: true, resultFile: file }),
    onOutcome: () => undefined,
  })
  const port = await proxy.listen(0)
  try {
    const response = await post(port)
    await response.text()
    assert.equal(response.status, 200)
    assert.equal(readRows(file)[0].autoDisabled, false)
  } finally {
    proxy.server.closeAllConnections?.()
    await proxy.close()
    await upstream.close()
  }
})

// ── verdict：未采集 ⇒ unknown（不是 no-reasoning）─────────────────────────

test('verdict：reasoningHeadEnabled=false ⇒ unknown，绝不是 no-reasoning', async () => {
  const file = join(tempDir(), 'result.jsonl')
  await runOnce({
    config: { resultFile: file, shim: true, textualize: true, catalog: '清单正文', reasoningHeadEnabled: false },
    handler: () => ({ status: 200, contentType: 'text/event-stream', raw: sse('正文') }),
  })
  const row = readRows(file)[0]
  assert.equal(row.reasoningHead, null)
  assert.equal(row.verdict, 'unknown')
})

test('verdict：采集了但返回里没有 reasoning_content ⇒ no-reasoning', async () => {
  const file = join(tempDir(), 'result.jsonl')
  await runOnce({
    config: { resultFile: file, shim: true, textualize: true, catalog: '清单正文', reasoningHeadEnabled: true },
    handler: () => ({ status: 200, contentType: 'text/event-stream', raw: sse('正文') }),
  })
  const row = readRows(file)[0]
  assert.equal(row.reasoningHead, null)
  assert.equal(row.verdict, 'no-reasoning')
})

test('verdict：采集到 reasoning ⇒ reasoning-collected（**不做**「前缀是否被延续」的判定）', async () => {
  const file = join(tempDir(), 'result.jsonl')
  await runOnce({
    config: { resultFile: file, shim: true, textualize: true, catalog: '清单正文', reasoningHeadEnabled: true, reasoningPrefix: '他喵，我最喜欢的喵' },
    handler: () => ({ status: 200, contentType: 'text/event-stream', raw: sse('正文', '完全不一样的思考开头') }),
  })
  const row = readRows(file)[0]
  assert.equal(row.reasoningHead, '完全不一样的思考开头')
  // 前缀不回显 ⇒ 「以前缀开头」恒为假，所以这里**不能**判成「没生效」。
  // 只记事实：思维链采集到了，判断权交给脚本（跨臂对比）。
  assert.equal(row.verdict, 'reasoning-collected')
  // 脚本该看哪个通道，行里自带：reasoningLen>0 看 reasoningHead，contentLen>0 看 textHead。
  assert.equal(row.prefix.reasoningLen > 0, true)
})

test('verdict：即使返回的思维链"看起来"以前缀开头，也只记 reasoning-collected（不再有 kept/absent）', async () => {
  const file = join(tempDir(), 'result.jsonl')
  await runOnce({
    config: { resultFile: file, shim: true, textualize: true, catalog: '清单正文', reasoningHeadEnabled: true, reasoningPrefix: '他喵，我最喜欢的喵' },
    // 这个 fixture 以前被用来"证明" prefix-kept 可达 —— 其实是模型复述了前缀，不是前缀被遵守。
    handler: () => ({ status: 200, contentType: 'text/event-stream', raw: sse('正文', '他喵，我最喜欢的喵，接着想') }),
  })
  const row = readRows(file)[0]
  assert.equal(row.reasoningHead, '他喵，我最喜欢的喵，接着想')
  assert.equal(row.verdict, 'reasoning-collected')
})

test('verdict：只配内容前缀时同样是 reasoning-collected（判断该看 textHead，由脚本决定）', async () => {
  const file = join(tempDir(), 'result.jsonl')
  await runOnce({
    config: { resultFile: file, shim: true, textualize: true, catalog: '清单正文', reasoningHeadEnabled: true, reasoningPrefix: '', contentPrefix: '喵～' },
    handler: () => ({ status: 200, contentType: 'text/event-stream', raw: sse('正文', '随便想想') }),
  })
  const row = readRows(file)[0]
  assert.equal(row.reasoningHead, '随便想想')
  assert.equal(row.verdict, 'reasoning-collected')
  // 只配内容前缀 ⇒ 脚本要看的是正文（textHead），行里的 prefix.contentLen 指明这一点。
  assert.equal(row.prefix.contentLen > 0, true)
  assert.equal(row.prefix.reasoningLen, 0)
})

test('verdict：前缀臂被拒后透传成功 ⇒ passthrough（不冒充前缀臂结论）', async () => {
  const file = join(tempDir(), 'result.jsonl')
  const { response } = await runOnce({
    config: { resultFile: file, reasoningHeadEnabled: true, reasoningPrefix: '他喵，我最喜欢的喵' },
    handler: (index) => (index === 1 ? { status: 400, json: { error: { message: 'nope' } } } : { status: 200, json: { ok: true } }),
  })
  assert.equal(response.status, 200)
  const row = readRows(file)[0]
  assert.equal(row.variant, 'passthrough')
  assert.equal(row.ok, true)
  assert.equal(row.verdict, 'passthrough')
  assert.equal(row.attempts.length, 2)
})

test('verdict：本轮本就不该加前缀（空前缀）⇒ ignored，不算失败', async () => {
  const file = join(tempDir(), 'result.jsonl')
  await runOnce({
    config: { resultFile: file, reasoningHeadEnabled: true, reasoningPrefix: '' },
    handler: () => ({ status: 200, json: { ok: true } }),
  })
  const row = readRows(file)[0]
  assert.equal(row.variant, 'ignored')
  assert.equal(row.verdict, 'ignored')
  assert.equal(row.ok, true, 'ignored 不是失败（旧坑：误当 passthrough 会让实验自己把自己关掉）')
})

test('verdict：传输层失败 ⇒ error', async () => {
  const file = join(tempDir(), 'result.jsonl')
  const proxy = createReasoningPrefixProxy({
    getConfig: () => ({
      enabled: true,
      upstream: 'http://127.0.0.1:1', // 必然连不上
      reasoningPrefix: '他喵',
      stripTools: true,
      resultFile: file,
    }),
  })
  const port = await proxy.listen(0)
  try {
    const response = await post(port)
    await response.text()
    assert.equal(response.status, 502)
    const rows = readRows(file)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].ok, false)
    assert.equal(rows[0].verdict, 'error')
    assert.equal(rows[0].variant, 'none')
  } finally {
    proxy.server.closeAllConnections?.()
    await proxy.close()
  }
})

// ── 纯函数：messageText / lastMessageHash ──────────────────────────────────

test('messageText：DSH 的 block 数组与 wire 的 string 同值', () => {
  const text = '你好世界'
  assert.equal(messageText(text), text)
  assert.equal(messageText([{ type: 'text', text }]), text)
  assert.equal(messageText({ role: 'user', content: text }), text)
  assert.equal(messageText({ role: 'user', content: [{ type: 'text', text }] }), text)
  assert.equal(
    messageText({ role: 'user', content: [{ type: 'text', text: '你好' }, { type: 'image' }, { type: 'text', text: '世界' }] }),
    '你好世界',
  )
  assert.equal(messageText(null), '')
  assert.equal(messageText(undefined), '')
  assert.equal(messageText({ role: 'user', content: null }), '')
})

test('lastMessageHash：两种形状同 hash；无消息 / 空文本 ⇒ 空串', () => {
  const wire = lastMessageHash([{ role: 'user', content: '你好呀' }])
  const dsh = lastMessageHash([{ role: 'user', content: [{ type: 'text', text: '你好呀' }] }])
  assert.match(wire, /^[0-9a-f]{40}$/)
  assert.equal(wire, dsh)
  assert.equal(lastMessageHash([]), '')
  assert.equal(lastMessageHash(undefined), '')
  assert.equal(lastMessageHash([{ role: 'user', content: '' }]), '', '空指纹不参与匹配')
})

// ── 纯函数：matchPendingTrace 四例 ─────────────────────────────────────────

test('matchPendingTrace：唯一命中 ⇒ 返回并消费该条', () => {
  const pending = [{ sessionId: 's1', hash: lastMessageHash([{ role: 'user', content: '你好' }]), at: 1000 }]
  const hit = matchPendingTrace(pending, { messages: [{ role: 'user', content: '你好' }] }, 1500, 5000)
  assert.deepEqual(hit, { sessionId: 's1', turn: null, step: null, confidence: 'content' })
  assert.equal(pending.length, 0, '命中必须消费掉，避免同一登记被两次请求复用')
})

test('matchPendingTrace：0 候选 ⇒ null', () => {
  assert.equal(matchPendingTrace([], { messages: [{ role: 'user', content: '你好' }] }, 1000, 5000), null)
  const other = [{ sessionId: 's1', hash: lastMessageHash([{ role: 'user', content: '别的话' }]), at: 1000 }]
  assert.equal(matchPendingTrace(other, { messages: [{ role: 'user', content: '你好' }] }, 1000, 5000), null)
  assert.equal(other.length, 1, '没命中就不消费')
})

test('matchPendingTrace：超 TTL ⇒ null（过期候选不算命中）', () => {
  const pending = [{ sessionId: 's1', hash: lastMessageHash([{ role: 'user', content: '你好' }]), at: 1000 }]
  assert.equal(matchPendingTrace(pending, { messages: [{ role: 'user', content: '你好' }] }, 7001, 5000), null)
  assert.equal(pending.length, 1)
})

test('matchPendingTrace：2 条同 hash ⇒ null（不猜、不消费）', () => {
  const hash = lastMessageHash([{ role: 'user', content: '你好' }])
  const pending = [
    { sessionId: 's1', hash, at: 1000 },
    { sessionId: 's2', hash, at: 1100 },
  ]
  assert.equal(matchPendingTrace(pending, { messages: [{ role: 'user', content: '你好' }] }, 1200, 5000), null)
  assert.equal(pending.length, 2, '有歧义时一条都不能消费')
})

test('matchPendingTrace：带 turn/step 的登记原样带出（confidence 不是 exact 一律算 content）', () => {
  const pending = [
    { sessionId: 's9', hash: lastMessageHash([{ role: 'user', content: '你好' }]), at: 1000, turn: 4, step: 2, confidence: 'exact' },
  ]
  assert.deepEqual(matchPendingTrace(pending, { messages: [{ role: 'user', content: '你好' }] }, 1000, 5000), {
    sessionId: 's9',
    turn: 4,
    step: 2,
    confidence: 'exact',
  })
})

test('matchPendingTrace：过期条目与新鲜条目同 hash ⇒ 只认新鲜那条', () => {
  const hash = lastMessageHash([{ role: 'user', content: '你好' }])
  const pending = [
    { sessionId: 'old', hash, at: 0 },
    { sessionId: 'fresh', hash, at: 9000 },
  ]
  const hit = matchPendingTrace(pending, { messages: [{ role: 'user', content: '你好' }] }, 9500, 5000)
  assert.equal(hit.sessionId, 'fresh')
  assert.equal(pending.length, 1)
  assert.equal(pending[0].sessionId, 'old', '过期的那条不被消费（交给调用方的上限清理）')
})

// ── stats.arms：按 armId 分桶（P0-3）───────────────────────────────────────

/** 起一个 armId 可变的代理，方便验证「请求局部快照」。 */
const startArmProxy = async (configOf) => {
  const upstream = await startUpstream(() => ({ status: 200 }))
  const proxy = createReasoningPrefixProxy({
    getConfig: () => ({ enabled: true, upstream: 'http://127.0.0.1:' + upstream.port, reasoningPrefix: '他喵', stripTools: true, ...configOf() }),
  })
  const port = await proxy.listen(0)
  return {
    proxy,
    port,
    close: async () => {
      proxy.server.closeAllConnections?.()
      await proxy.close()
      await upstream.close()
    },
  }
}

test('stats.arms：按 armId 分桶，且 armId 是请求局部快照（不是导出时的当前值）', async () => {
  const file = join(tempDir(), 'result.jsonl')
  let current = 'A1'
  const { proxy, port, close } = await startArmProxy(() => ({ armId: current, resultFile: file }))
  try {
    let response = await post(port)
    await response.text()
    current = 'A2'
    response = await post(port)
    await response.text()

    const stats = proxy.stats()
    assert.deepEqual(Object.keys(stats.arms).sort(), ['A1', 'A2'])
    assert.equal(stats.arms.A1.requests, 1)
    assert.equal(stats.arms.A1.ok, 1)
    assert.equal(stats.arms.A2.requests, 1)

    // 快照：第一行落盘时 armId 还是 A1，事后改配置不能把它改写掉。
    const rows = readRows(file)
    assert.equal(rows.length, 2)
    assert.equal(rows[0].armId, 'A1')
    assert.equal(rows[1].armId, 'A2')
  } finally {
    await close()
  }
})

test('stats.arms：stats() 返回逐层深拷贝，外部改不到内部桶', async () => {
  const { proxy, port, close } = await startArmProxy(() => ({ armId: 'A1' }))
  try {
    const response = await post(port)
    await response.text()
    const snapshot = proxy.stats()
    snapshot.arms.A1.requests = 999
    snapshot.arms.A1.ms.sum = 999
    snapshot.arms.A1.firstDeltaMs.count = 999
    snapshot.arms.A1.usage.prompt = 999
    const again = proxy.stats()
    assert.equal(again.arms.A1.requests, 1)
    assert.notEqual(again.arms.A1.ms.sum, 999)
    assert.notEqual(again.arms.A1.firstDeltaMs.count, 999)
    assert.notEqual(again.arms.A1.usage.prompt, 999)
  } finally {
    await close()
  }
})

test('stats.arms：臂数上限 32，满则丢最旧', async () => {
  let current = 'arm-0'
  const { proxy, port, close } = await startArmProxy(() => ({ armId: current }))
  try {
    for (let i = 0; i < 33; i += 1) {
      current = 'arm-' + i
      const response = await post(port)
      await response.text()
    }
    const arms = proxy.stats().arms
    assert.equal(Object.keys(arms).length, 32, '臂名手抖不该无界涨内存')
    assert.equal(Object.hasOwn(arms, 'arm-0'), false, '最旧的那桶被丢掉')
    assert.equal(Object.hasOwn(arms, 'arm-32'), true)
  } finally {
    await close()
  }
})

test('stats.arms：resetStats 一并清空', async () => {
  const { proxy, port, close } = await startArmProxy(() => ({ armId: 'A1' }))
  try {
    const response = await post(port)
    await response.text()
    assert.equal(proxy.stats().arms.A1.requests, 1)
    proxy.resetStats()
    assert.deepEqual(proxy.stats().arms, {})
  } finally {
    await close()
  }
})

test('stats.arms：并发请求各入各桶，不串台也不丢', async () => {
  let seen = 0
  const { proxy, port, close } = await startArmProxy(() => {
    seen += 1
    return { armId: seen % 2 === 1 ? 'odd' : 'even' }
  })
  try {
    const responses = await Promise.all([...Array(6)].map(() => post(port)))
    await Promise.all(responses.map((response) => response.text()))
    const stats = proxy.stats()
    assert.equal(stats.requests, 6)
    assert.deepEqual(Object.keys(stats.arms).sort(), ['even', 'odd'])
    const total = Object.values(stats.arms).reduce((sum, bucket) => sum + bucket.requests, 0)
    assert.equal(total, 6, '每一次请求都必须落进某一个桶')
  } finally {
    await close()
  }
})

