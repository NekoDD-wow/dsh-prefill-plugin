// 不在册会话（没加载 agent，比如在面板里编辑历史会话）保存每轮注入时的盖章。
// 0.17.0 为 #44 把 state 路由的 lastTurnFor 改成「不在 liveAgents ⇒ undefined（轮数未知）」，
// 连带跳过了读落盘日志的兜底 ⇒ 对**有日志**的不在册会话：改正文 since 不重开、
// 勾「下一轮发一次」/ 立即恢复 / 暂停被静默丢掉、改了首轮段旧 firstOnce 残留。
// 正确行为：有日志按日志算轮数（和在册一样盖章）；只有没有日志 / 日志读不了才算「轮数未知」（#44 原场景）。
// 用假 ctx 注册真实 state 路由，在临时 DSH_HOME 里放真实的多帧 zstd 会话日志。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'

const HOME = mkdtempSync(join(tmpdir(), 'prefill-stamp-unlisted-'))
process.env.DSH_HOME = HOME
const impl = await import('../impl.js')
const { stampEveryTurn } = impl

const routes = new Map()
const scope = {
  get: (name) => (name === 'connection' ? { fetch: { register: (def) => routes.set(def.path, def) } } : undefined),
  effect: (fn) => fn(),
}
impl.apply({
  effect: (fn) => {
    try {
      fn()
    } catch {
      // 注册失败不影响本用例关心的路由。
    }
  },
  on: () => {},
  inject: (deps, cb) => cb(scope),
  logger: { info() {}, error() {} },
})
const route = routes.get('/api/dsh-prefill/state')
assert.ok(route, 'state 路由已注册')

const post = async (body) => {
  const res = await route.fetch({ json: async () => body })
  assert.equal(res.status, 200)
  return res.json()
}
const STATE_FILE = join(HOME, 'prefill', 'state.json')
const everyTurn = () => JSON.parse(readFileSync(STATE_FILE, 'utf8')).everyTurn ?? {}

/** 直接把旧格写进 state.json（模拟之前已盖过章的状态；走路由的话新格会被当成「重新开始」重盖）。 */
let bump = 0
function seed(cells) {
  const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {}
  mkdirSync(join(HOME, 'prefill'), { recursive: true })
  writeFileSync(STATE_FILE, JSON.stringify({ ...state, everyTurn: { ...(state.everyTurn ?? {}), ...cells } }))
  const t = new Date(Date.UTC(2030, 0, 1) + ++bump * 1000) // 保证 mtime 变了（readState 按 mtime 缓存）
  utimesSync(STATE_FILE, t, t)
}

/** 写一份 N 轮的会话日志：每轮一帧（DSH 的日志是多个 zstd 帧首尾相接）。 */
function writeLog(sessionId, turns) {
  const dir = join(HOME, 'sessions', 'ws-test', sessionId)
  mkdirSync(dir, { recursive: true })
  const frames = []
  for (let turn = 1; turn <= turns; turn++) {
    const lines = [
      { type: 'turn/start', data: { turn } },
      { type: 'user/message', data: { source: { kind: 'user' }, message: { content: [{ type: 'text', text: `q${turn}` }] } } },
      { type: 'assistant/message', data: { message: { source: { kind: 'model' }, content: [{ type: 'text', text: `a${turn}` }] } } },
      { type: 'turn/end', data: { turn, reason: { kind: 'completed' } } },
    ]
    frames.push(zstdCompressSync(Buffer.from(lines.map((l) => JSON.stringify(l)).join('\n') + '\n')))
  }
  writeFileSync(join(dir, 'session.v4.jsonl.zstd'), Buffer.concat(frames))
}

const entry = (over = {}) => ({ enabled: true, text: 'A', firstText: 'F', mode: 'auto', checks: ['zh'], since: 3, auto: {}, ...over })

/** 旧格 prev 已在状态里，面板写 next，返回盖完章的那格。 */
async function saveTwice(id, prev, next) {
  seed({ [id]: prev })
  await post({ everyTurn: { [id]: next } })
  return everyTurn()[id]
}

// ── 有日志的不在册会话：按日志轮数（7 轮 ⇒ 下一轮 = 8）盖章 ──

test('有日志的不在册会话：改正文 ⇒ since 重开为下一轮（按日志 7 轮 ⇒ 8）', async () => {
  writeLog('session-log-a', 7)
  const out = await saveTwice('session-log-a', entry(), entry({ text: 'A2' }))
  assert.equal(out.since, 8)
})

test('有日志的不在册会话：勾「下一轮发一次」⇒ firstOnce = { atTurn: 8 }', async () => {
  writeLog('session-log-b', 7)
  const out = await saveTwice('session-log-b', entry(), entry({ firstOnce: true }))
  assert.deepEqual(out.firstOnce, { atTurn: 8 })
})

test('有日志的不在册会话：立即恢复 / 暂停 ⇒ override 盖上 atTurn = 8', async () => {
  writeLog('session-log-c', 7)
  const resumed = await saveTwice('session-log-c', entry(), entry({ auto: { override: { action: 'resume' } } }))
  assert.deepEqual(resumed.auto.override, { action: 'resume', atTurn: 8 })
  writeLog('session-log-d', 7)
  const paused = await saveTwice('session-log-d', entry(), entry({ auto: { override: { action: 'pause' } } }))
  assert.deepEqual(paused.auto.override, { action: 'pause', atTurn: 8 })
})

test('有日志的不在册会话：改了首轮段 ⇒ 旧 firstOnce 去掉（请求针对的是旧首轮段）', async () => {
  writeLog('session-log-e', 7)
  const out = await saveTwice('session-log-e', entry({ firstOnce: { atTurn: 5 } }), entry({ firstText: 'F2' }))
  assert.equal(out.firstOnce, undefined)
  assert.equal(out.since, 8)
})

// ── #44 原场景不回退：没有日志（轮数未知）的会话不被夹成 1 ──

test('#44 不回退：保存 a 时，没有日志的不在册会话 b 的 since 保持 17（不被夹成 1）', async () => {
  writeLog('session-44-a', 11)
  seed({ 'session-44-a': entry({ text: 'A', since: 11 }), 'session-44-b': entry({ text: 'B', since: 17 }) })
  await post({ everyTurn: { 'session-44-a': entry({ text: 'A2', since: 11 }), 'session-44-b': entry({ text: 'B', since: 17 }) } })
  const out = everyTurn()
  assert.equal(out['session-44-a'].since, 12, '有日志、改了正文 ⇒ 下一轮')
  assert.equal(out['session-44-b'].since, 17, '没有日志 ⇒ 轮数未知，沿用旧 since')
})

test('#44 不回退：日志读不了（坏的 zstd）也当轮数未知，since 不被夹成 1', async () => {
  const dir = join(HOME, 'sessions', 'ws-test', 'session-44-bad')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'session.v4.jsonl.zstd'), Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0xff, 0xff, 0xff, 0x00, 0x01]))
  seed({ 'session-44-bad': entry({ since: 17 }) })
  await post({ everyTurn: { 'session-44-bad': entry({ since: 17 }) } })
  assert.equal(everyTurn()['session-44-bad'].since, 17)
})

test('轮数未知时改了首轮段：旧 firstOnce 同样去掉（这条不需要轮数）', () => {
  const prev = { s: entry({ firstOnce: { atTurn: 2 } }) }
  assert.equal(stampEveryTurn(prev, { s: entry({ firstText: 'F2' }) }, () => undefined).s.firstOnce, undefined)
  assert.deepEqual(stampEveryTurn(prev, { s: entry() }, () => undefined).s.firstOnce, { atTurn: 2 }, '首轮段没变 ⇒ 沿用')
})
