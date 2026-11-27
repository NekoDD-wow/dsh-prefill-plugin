// 开卡与写路径瘦身（docs/规划-开卡瘦身-v2.md）：
// Phase A：/draft 与 /packs（list/get/builtin/from-session/save/delete/import）不再白搭 1MB+ 的 ...envelope()；
// Phase B：/state 支持 { slim: true, sessionId } 按会话投影，以及 { sessionPatch, slim: true, sessionId } 按会话原子写
//          （不传 slim 的旧协议保持全量，兼容设置页总览 / CLI / 既有单测）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'prefill-state-slim-'))
process.env.DSH_HOME = HOME
const impl = await import('../impl.js')

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
      // ignore non-route setup in mock ctx
    }
  },
  on: () => {},
  inject: (deps, cb) => cb(scope),
  logger: { info() {}, error() {} },
})

const stateRoute = routes.get('/api/dsh-prefill/state')
const draftRoute = routes.get('/api/dsh-prefill/draft')
const packsRoute = routes.get('/api/dsh-prefill/packs')
assert.ok(stateRoute, 'state 路由已注册')
assert.ok(draftRoute, 'draft 路由已注册')
assert.ok(packsRoute, 'packs 路由已注册')

const DATA_DIR = join(HOME, 'prefill')
const STATE_FILE = join(DATA_DIR, 'state.json')

let bump = 0
function seed(state) {
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  const t = new Date(Date.UTC(2032, 0, 1) + ++bump * 1000)
  utimesSync(STATE_FILE, t, t)
}

const post = async (route, body, url = '') => {
  const res = await route.fetch({ url: url || 'http://127.0.0.1:3080' + route.path, json: async () => body })
  assert.equal(res.status, 200)
  const text = await res.text()
  return { data: JSON.parse(text), text, bytes: Buffer.byteLength(text) }
}

const SID_A = 'session-slim-a'
const SID_B = 'session-slim-b'
const BIG = '填'.repeat(2500)

function bigState() {
  const overrides = {}
  const lore = {}
  const sandbox = {
    [SID_A]: { level: 'controlled', own: [], rules: [] },
    [SID_B]: { level: 'strict', own: ['rewrite'], rules: [{ match: { section: 'prefill:persona', exact: true }, action: 'rewrite', text: 'B 的人格' }] },
    '*': { level: 'observe' },
  }
  const everyTurn = {
    '*': { enabled: true, text: '默认提醒', mode: 'always', checks: [] },
    [SID_A]: { enabled: true, text: 'A 的每轮提醒', firstText: 'A 的首轮', mode: 'always', checks: [] },
    [SID_B]: { enabled: true, text: 'B 的每轮提醒', mode: 'always', checks: [] },
  }
  const activePreset = { [SID_A]: 'pack:甲', [SID_B]: 'pack:乙' }
  const prefill = { [SID_A]: 'default', [SID_B]: 'default' }
  const locked = {
    [SID_A]: {
      turn: 1,
      at: 1000,
      items: [{ role: 'user', text: '开场' }],
      preset: {
        maps: { activePreset: 'pack:甲', gate: 'pass', everyTurn: { enabled: true, text: '开局提醒', mode: 'always', checks: [] } },
      },
    },
    [SID_B]: { turn: 2, at: 2000, items: [] },
  }
  for (let i = 0; i < 30; i += 1) {
    const sid = `session-filler-${i}`
    overrides[sid] = { messages: {}, sections: { 'prefill:persona': `${BIG}${i}` }, contexts: {} }
    lore[sid] = { enabled: true, scanDepth: 4, budget: 900, entries: [{ keys: ['甲'], text: BIG }], char: 'filler' }
    sandbox[sid] = { level: 'strict', own: ['rewrite'], rules: [{ match: { section: 'x' }, action: 'rewrite', text: BIG }] }
    everyTurn[sid] = { enabled: true, text: BIG, mode: 'always', checks: [] }
    activePreset[sid] = `pack:填充${i}`
    prefill[sid] = 'default'
  }
  overrides[SID_A] = { messages: {}, sections: { 'prefill:persona': 'A 的人格' }, contexts: {} }
  overrides[SID_B] = { messages: {}, sections: { 'prefill:persona': 'B 的人格' }, contexts: {} }
  return {
    version: 2,
    prefill,
    overrides,
    lore,
    sandbox,
    everyTurn,
    activePreset,
    locked,
    armed: [SID_A, SID_B],
    levers: { blockMessages: false },
    ui: { motion: 'off', experimental: false },
    noticeSeen: true,
  }
}

test.after(() => {
  try {
    rmSync(HOME, { recursive: true, force: true })
  } catch {
    // ignore cleanup error
  }
})

// ── Phase A：/draft 与 /packs 去掉冗余 ...envelope() ──────────────────────────

test('Phase A：/draft 读与写响应不再夹带整份 state / sandboxView，体积 < 4 KB', async () => {
  seed(bigState())
  const read = await post(draftRoute, { sessionId: SID_A })
  assert.equal(read.data.ok, true)
  assert.equal('state' in read.data, false, '/draft 读不应夹带 state')
  assert.equal('sandboxView' in read.data, false, '/draft 读不应夹带 sandboxView')
  assert.ok(read.bytes < 4096, `/draft 读响应过大：${read.bytes} B`)

  const write = await post(draftRoute, { sessionId: SID_A, items: [{ role: 'user', text: '你好' }] })
  assert.equal(write.data.ok, true)
  assert.equal('state' in write.data, false, '/draft 写不应夹带 state')
  assert.equal('sandboxView' in write.data, false, '/draft 写不应夹带 sandboxView')
  assert.ok(write.bytes < 4096, `/draft 写响应过大：${write.bytes} B`)
})

test('Phase A：/packs（list / builtin / save / get / delete）不再夹带整份 state / sandboxView', async () => {
  seed(bigState())
  const listed = await post(packsRoute, { sessionId: SID_A, op: 'list' })
  assert.equal(listed.data.ok, true)
  assert.ok(Array.isArray(listed.data.packs))
  assert.ok(Array.isArray(listed.data.builtins))
  assert.equal('state' in listed.data, false, '/packs list 不应夹带 state')
  assert.equal('sandboxView' in listed.data, false, '/packs list 不应夹带 sandboxView')

  const builtin = await post(packsRoute, { sessionId: SID_A, op: 'builtin', id: 'pure' })
  assert.equal(builtin.data.ok, true)
  assert.ok(builtin.data.pack)
  assert.equal('state' in builtin.data, false, '/packs builtin 不应夹带 state')
  assert.equal('sandboxView' in builtin.data, false, '/packs builtin 不应夹带 sandboxView')

  const saved = await post(packsRoute, { sessionId: SID_A, op: 'save', name: 'slim-test-pack', items: [{ role: 'user', text: 'hi' }] })
  assert.equal(saved.data.ok, true)
  assert.equal('state' in saved.data, false, '/packs save 不应夹带 state')
  assert.equal('sandboxView' in saved.data, false, '/packs save 不应夹带 sandboxView')

  const got = await post(packsRoute, { sessionId: SID_A, op: 'get', name: 'slim-test-pack' })
  assert.equal(got.data.ok, true)
  assert.equal(got.data.pack?.name, 'slim-test-pack')
  assert.equal('state' in got.data, false, '/packs get 不应夹带 state')
  assert.equal('sandboxView' in got.data, false, '/packs get 不应夹带 sandboxView')
  assert.ok(got.bytes < 4096, `/packs get 响应过大：${got.bytes} B`)

  const del = await post(packsRoute, { sessionId: SID_A, op: 'delete', name: 'slim-test-pack' })
  assert.equal(del.data.ok, true)
  assert.equal('state' in del.data, false)
})

// ── Phase B：/state 按会话投影（slim）+ 按会话原子补丁（sessionPatch） ────────

test('Phase B：/state 带 { slim: true, sessionId } 只投影目标会话与 *，体积远小于全量', async () => {
  seed(bigState())
  const full = await post(stateRoute, undefined)
  const slim = await post(stateRoute, { slim: true, sessionId: SID_A })

  assert.equal(slim.data.ok, true)
  assert.equal(slim.data.slim, true)
  assert.equal(slim.data.slimSessionId, SID_A)
  // 体积对比：30 个大填充会话下 slim 应比 full 小 10 倍以上且 < 35 KB
  assert.ok(full.bytes > 100_000, `全量基线应够大（实际 ${full.bytes} B）`)
  assert.ok(slim.bytes < 35_000, `slim 响应应 < 35 KB（实际 ${slim.bytes} B）`)
  assert.ok(slim.bytes * 10 < full.bytes, `slim (${slim.bytes} B) 应至少比 full (${full.bytes} B) 小 10 倍`)

  // 目标会话 A 和 '*' 都在
  assert.equal(slim.data.state.overrides?.[SID_A]?.sections?.['prefill:persona'], 'A 的人格')
  assert.equal(slim.data.state.everyTurn?.[SID_A]?.text, 'A 的每轮提醒')
  assert.equal(slim.data.state.everyTurn?.['*']?.text, '默认提醒')
  assert.equal(slim.data.state.sandbox?.[SID_A]?.level, 'controlled')
  assert.equal(slim.data.state.sandbox?.['*']?.level, 'observe')
  assert.equal(slim.data.state.activePreset?.[SID_A], 'pack:甲')
  assert.ok(slim.data.sandboxView?.[SID_A], '目标会话 sandboxView 存在')
  assert.ok(slim.data.sandboxView?.['*'], '全局 * sandboxView 存在')
  assert.deepEqual(slim.data.state.armed, [SID_A])

  // 其他会话绝不出现在 slim 里
  assert.equal(SID_B in (slim.data.state.overrides ?? {}), false)
  assert.equal(SID_B in (slim.data.state.everyTurn ?? {}), false)
  assert.equal(SID_B in (slim.data.state.sandbox ?? {}), false)
  assert.equal(SID_B in (slim.data.state.activePreset ?? {}), false)
  assert.equal(SID_B in (slim.data.state.locked ?? {}), false)
  assert.equal(SID_B in (slim.data.sandboxView ?? {}), false)
  assert.equal('session-filler-0' in (slim.data.state.lore ?? {}), false)

  // 不带 slim 的旧请求仍然返回全量（向后兼容设置页总览 / CLI）
  assert.equal(full.data.slim, undefined)
  assert.ok(SID_B in (full.data.state.activePreset ?? {}))
  assert.ok('session-filler-0' in (full.data.state.lore ?? {}))
})

test('Phase B：/state 也支持 query string ?slim=1&sessionId=... 空体读取', async () => {
  seed(bigState())
  const slim = await post(stateRoute, undefined, `http://127.0.0.1:3080/api/dsh-prefill/state?slim=1&sessionId=${SID_A}`)
  assert.equal(slim.data.ok, true)
  assert.equal(slim.data.slim, true)
  assert.equal(slim.data.state.activePreset?.[SID_A], 'pack:甲')
  assert.equal(SID_B in (slim.data.state.activePreset ?? {}), false)
})

test('Phase B：sessionPatch 原子写入单会话 set/unset/armed/global，绝不破坏其他会话', async () => {
  seed(bigState())
  const res = await post(stateRoute, {
    sessionId: SID_A,
    slim: true,
    sessionPatch: {
      target: SID_A,
      set: {
        activePreset: 'pack:新甲',
        overrides: { messages: {}, sections: { 'prefill:persona': 'A 的新人格' }, contexts: {} },
        everyTurn: { enabled: true, text: 'A 的新提醒', mode: 'always', checks: [] },
        workspaceInstructions: { mode: 'off' },
      },
      unset: ['lore'],
      armed: false,
      global: { ui: { loreConstWarn: true } },
    },
  })

  assert.equal(res.data.ok, true)
  assert.equal(res.data.slim, true)
  assert.equal(res.data.state.activePreset?.[SID_A], 'pack:新甲')
  assert.equal(res.data.state.overrides?.[SID_A]?.sections?.['prefill:persona'], 'A 的新人格')
  assert.equal(res.data.state.everyTurn?.[SID_A]?.text, 'A 的新提醒')
  assert.equal(res.data.state.workspaceInstructions?.[SID_A]?.mode, 'off')
  assert.deepEqual(res.data.state.armed, [])
  assert.equal(res.data.state.ui?.loreConstWarn, true)
  assert.equal(res.data.state.ui?.motion, 'off', '合并 ui 时保留既有偏好')
  assert.equal(res.data.summary?.sessionId, SID_A)

  // 读全量确认 SID_B 与 filler 完好无损
  const full = await post(stateRoute, undefined)
  assert.equal(full.data.state.activePreset?.[SID_B], 'pack:乙')
  assert.equal(full.data.state.overrides?.[SID_B]?.sections?.['prefill:persona'], 'B 的人格')
  assert.equal(full.data.state.everyTurn?.[SID_B]?.text, 'B 的每轮提醒')
  assert.equal(full.data.state.everyTurn?.['*']?.text, '默认提醒')
  assert.ok(full.data.state.armed.includes(SID_B), 'SID_B 的 armed 不受 SID_A 影响')
  assert.ok('session-filler-0' in full.data.state.lore, '其他会话 lore 完好无损')
})

test('Phase B：sessionPatch 支持 target="*"（复制成新会话默认 / 全局沙盒包），不破坏其他会话', async () => {
  seed(bigState())
  const res = await post(stateRoute, {
    sessionId: SID_A,
    slim: true,
    sessionPatch: {
      target: '*',
      set: {
        everyTurn: { enabled: true, text: '新的全局默认', mode: 'always', checks: [] },
      },
    },
  })
  assert.equal(res.data.ok, true)
  assert.equal(res.data.state.everyTurn?.['*']?.text, '新的全局默认')
  assert.equal(res.data.state.everyTurn?.[SID_A]?.text, 'A 的每轮提醒')

  const full = await post(stateRoute, undefined)
  assert.equal(full.data.state.everyTurn?.[SID_B]?.text, 'B 的每轮提醒')
})

test('Phase B：restoreOpening 带 slim: true 时恢复开局配置且只回单会话投影', async () => {
  seed(bigState())
  const res = await post(stateRoute, { restoreOpening: SID_A, slim: true, sessionId: SID_A })
  assert.equal(res.data.ok, true)
  assert.equal(res.data.restored, SID_A)
  assert.equal(res.data.slim, true)
  assert.equal(res.data.state.everyTurn?.[SID_A]?.text, '开局提醒')
  assert.equal(SID_B in (res.data.state.everyTurn ?? {}), false)
})
