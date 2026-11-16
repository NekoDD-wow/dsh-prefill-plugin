// 「连续失败自动停用」的计数口径（impl.js onReasoningOutcome / reasoningFailures）。
//
// 设计（CHANGELOG 0.20 P0、impl 注释）：代理把透传分成三态，只有 passthrough（前缀版被上游拒绝后退回透传、
// 且透传也失败）算一次失败。ignored（本轮本就不该加前缀）/ skipped（用户点了「清空本轮填装」）
// 和前缀无关，它们撞上 429 / 5xx 不该把实验关掉、更不该删模型路由。
//
// 做法：在临时 DSH_HOME 里挂真实的 impl.apply()（真实代理、真实路由），把代理发往 api.deepseek.com 的
// fetch 改道到本地桩上游，再通过代理端口发真实 HTTP 请求。不需要 --experimental-test-module-mocks。
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ── 桩上游：按 mode 回状态码；200 时回一段最小 SSE ──────────────────────────
let mode = 'ok'
const upstream = http.createServer(async (req, res) => {
  for await (const _ of req) void _
  if (mode === 'ok') {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: '好' } }] }) + '\n\n')
    res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\n')
    res.end('data: [DONE]\n\n')
    return
  }
  const status = mode === 'busy' ? 503 : mode === 'limited' ? 429 : 400
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: mode } }))
})
await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve))
const UPSTREAM = 'http://127.0.0.1:' + upstream.address().port
const realFetch = globalThis.fetch
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url.startsWith('https://api.deepseek.com')) return realFetch(url.replace(/^https:\/\/api\.deepseek\.com(\/beta)?/, UPSTREAM), init)
  return realFetch(input, init)
}

const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => {
    const { port } = s.address()
    s.close(() => resolve(port))
  })
})

// ── 挂 impl ──────────────────────────────────────────────────────────────
const HOME = mkdtempSync(join(tmpdir(), 'prefill-autodisable-'))
process.env.DSH_HOME = HOME
const STATE_FILE = join(HOME, 'prefill', 'state.json')
mkdirSync(join(HOME, 'prefill'), { recursive: true })
const PORT = await freePort()
writeFileSync(STATE_FILE, JSON.stringify({ ui: { experimental: true, reasoningPrefix: { enabled: true, prefix: '想：', port: PORT, failureThreshold: 3 } } }))

const impl = await import('../impl.js')
const routes = new Map()
const hooks = new Map()
const scope = {
  get: (name) => (name === 'connection' ? { fetch: { register: (def) => routes.set(def.path, def) } } : undefined),
  effect: (fn) => fn(),
}
impl.apply({
  effect: (fn) => {
    try {
      fn()
    } catch {
      // 与本用例无关的注册失败忽略。
    }
  },
  on: (name, fn) => {
    if (!hooks.has(name)) hooks.set(name, [])
    hooks.get(name).push(fn)
    return () => {}
  },
  get: (name) => {
    throw new Error('no service ' + name)
  },
  inject: (deps, cb) => cb(scope),
  logger: { info() {}, warn() {}, error() {} },
})
// 启动 1s 后自启代理。
await new Promise((resolve) => setTimeout(resolve, 1300))

const call = async (path, body = {}) => {
  const route = routes.get(path)
  assert.ok(route, '路由未注册: ' + path)
  const res = await route.fetch({ json: async () => body })
  return res.json()
}
const status = () => call('/api/dsh-prefill/experimental/status')
const config = (patch) => call('/api/dsh-prefill/experimental/config', patch)
const enabledInState = () => JSON.parse(readFileSync(STATE_FILE, 'utf8')).ui?.reasoningPrefix?.enabled === true
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 经代理发一条聊天请求；返回状态码。 */
const chat = async (text = '你好') => {
  const st = await status()
  const port = st.reasoning.port
  const res = await realFetch('http://127.0.0.1:' + port + '/beta/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer x' },
    body: JSON.stringify({ model: 'deepseek-chat', stream: true, messages: [{ role: 'user', content: text }] }),
  })
  await res.text()
  await sleep(20)
  return res.status
}

/** 每条用例从「实验开着、计数为 0、无触发标记」出发。 */
const fresh = async () => {
  mode = 'ok'
  await config({ enabled: false, match: '' })
  await config({ enabled: true })
  await call('/api/dsh-prefill/experimental/stats/reset')
  const st = await status()
  assert.equal(st.reasoning.proxyRunning, true, '代理没起来')
  assert.equal(enabledInState(), true)
  return st
}

test.after(async () => {
  await config({ enabled: false })
  globalThis.fetch = realFetch
  upstream.closeAllConnections?.()
  await new Promise((resolve) => upstream.close(resolve))
})

test('基线：前缀轮连续被上游拒绝 3 次（阈值 3）⇒ 自动停用', async () => {
  await fresh()
  mode = 'reject'
  for (let i = 0; i < 3; i += 1) await chat()
  await sleep(50)
  assert.equal(enabledInState(), false, '前缀轮真失败够阈值了，应当自动停用')
  assert.equal(typeof (await status()).reasoning.autoDisabledAt, 'number')
})

test('ignored（触发标记未命中，本轮不加前缀）被上游 429 三次 ⇒ 不计失败、不停用', async () => {
  await fresh()
  await config({ match: '#前缀' })
  mode = 'limited'
  for (let i = 0; i < 3; i += 1) assert.equal(await chat('没有标记'), 429)
  await sleep(50)
  assert.equal(enabledInState(), true, 'ignored 的失败把实验自动停用了（还会删掉 provider 路由）')
  assert.equal((await status()).reasoning.failures, 0)
})

test('skipped（用户点了「清空本轮填装」）时上游 503 三次 ⇒ 不计失败、不停用', async () => {
  await fresh()
  const sessionId = 'sess-skip'
  await call('/api/dsh-prefill/experimental/skip', { sessionId, on: true })
  // 本轮第 1 步：把排队的「跳过」落成本轮生效。
  const preStep = hooks.get('agent/pre-step')[0]
  await preStep({ agent: { id: sessionId, session: { snapshotEvents: () => [] } }, turn: 1, step: 1, messages: [] }, async () => ({ kind: 'enter', messages: [] }))
  mode = 'busy'
  for (let i = 0; i < 3; i += 1) assert.equal(await chat(), 503)
  await sleep(50)
  assert.equal(enabledInState(), true, 'skipped 的失败把实验自动停用了')
  assert.equal((await status()).reasoning.failures, 0)
  for (const fn of hooks.get('agent/turn-stopping') ?? []) await fn({ agent: { id: sessionId }, turn: 1 })
})

test('ignored 成功不打断「连续」：前缀失败 2 次 + 未命中轮成功 1 次 ⇒ 计数仍是 2', async () => {
  await fresh()
  await config({ match: '#前缀' })
  mode = 'reject'
  await chat('#前缀 一')
  await chat('#前缀 二')
  assert.equal((await status()).reasoning.failures, 2)
  mode = 'ok'
  assert.equal(await chat('没有标记'), 200)
  assert.equal((await status()).reasoning.failures, 2, '未命中轮（没加前缀）的成功把前缀轮的连续失败清零了')
  // 前缀轮真成功仍然清零。
  await chat('#前缀 三')
  assert.equal((await status()).reasoning.failures, 0)
})

test('停用后重新启用：上一轮实验攒下的失败不带进来（第 1 次失败不该直接停用）', async () => {
  await fresh()
  mode = 'reject'
  await chat()
  await chat()
  assert.equal((await status()).reasoning.failures, 2)
  await config({ enabled: false })
  await config({ enabled: true })
  assert.equal((await status()).reasoning.failures, 0, '重新启用后面板仍显示上一轮的失败数')
  await chat()
  await sleep(50)
  assert.equal(enabledInState(), true, '重新启用后第 1 次失败就把实验停了')
  assert.equal((await status()).reasoning.failures, 1)
})

test('清零统计同时清掉连续失败计数', async () => {
  await fresh()
  mode = 'reject'
  await chat()
  await chat()
  assert.equal((await status()).reasoning.failures, 2)
  const after = await call('/api/dsh-prefill/experimental/stats/reset')
  assert.equal(after.reasoning.failures, 0, '清零统计后面板仍显示 failures=2')
  await chat()
  await sleep(50)
  assert.equal(enabledInState(), true, '清零统计后第 1 次失败就把实验停了')
})
