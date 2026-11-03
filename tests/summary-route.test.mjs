// 规划 §2.1：轻量 summary 路由 + 瘦身后的 every-turn-status。
//
// 背景（.ui-audit/fluidity.md 实测）：整份 envelope 1.28 MB × 3 个常驻轮询 = 空闲 30 s 50 MB decoded。
// 这里用假 ctx 注册真实路由、在临时 DSH_HOME 里**直接写 state.json**（模拟宿主或另一个进程改了状态），
// 覆盖：只回目标会话 / <10 KB / 只读 / rev 随 state 变化 / every-turn-status 只有 {ok,op,status} 且 <2 KB /
// state.json 损坏时 ok:false 不抛 / 异常 state 形状不抛。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'prefill-summary-route-'))
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
      // 注册失败不影响本用例关心的路由。
    }
  },
  on: () => {},
  inject: (deps, cb) => cb(scope),
  logger: { info() {}, error() {} },
})

const summaryRoute = routes.get('/api/dsh-prefill/summary')
const packsRoute = routes.get('/api/dsh-prefill/packs')
assert.ok(summaryRoute, 'summary 路由已注册')
assert.ok(packsRoute, 'packs 路由已注册')

const DATA_DIR = join(HOME, 'prefill')
const STATE_FILE = join(DATA_DIR, 'state.json')

let bump = 0
/** 直接写 state.json（字符串 = 原样写，用于坏文件），并把 mtime 推到未来：readState 与 rev 都按 mtime 缓存。 */
function seed(state) {
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(STATE_FILE, typeof state === 'string' ? state : `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  const t = new Date(Date.UTC(2031, 0, 1) + ++bump * 1000)
  utimesSync(STATE_FILE, t, t)
}

/** 发一个 POST，回 { data, text, bytes }：bytes 是线上真实字节数（测体积用）。 */
const post = async (route, body) => {
  const res = await route.fetch({ json: async () => body })
  assert.equal(res.status, 200)
  const text = await res.text()
  return { data: JSON.parse(text), text, bytes: Buffer.byteLength(text) }
}

const SID_A = 'session-target-a'
const SID_B = 'session-target-b'
const PERSONA_TEXT = '你是 A 的人格（这段正文不该出现在 summary 里）'
const BIG = '填'.repeat(3000)

/**
 * 一份「像生产环境」的状态：目标会话 A 配满各类字段，B 也有一格，另加若干大体积的填充会话
 * （overrides / lore / sandbox 都是生产里的大头：实测 943 KB 的 state.json 里这三项占 700 KB+）。
 */
function bigState() {
  const overrides = {}
  const lore = {}
  const sandbox = {
    [SID_A]: { level: 'controlled', own: [], rules: [] },
    '*': { level: 'observe' },
  }
  const everyTurn = {}
  const activePreset = {}
  for (let i = 0; i < 30; i += 1) {
    const sid = `session-filler-${i}`
    overrides[sid] = { messages: {}, sections: { 'prefill:persona': `${BIG}${i}` }, contexts: {} }
    lore[sid] = { enabled: true, scanDepth: 4, budget: 900, entries: [{ keys: ['甲'], text: BIG }], char: 'filler' }
    sandbox[sid] = { level: 'strict', own: ['rewrite'], rules: [{ match: { section: 'x' }, action: 'rewrite', text: BIG }] }
    everyTurn[sid] = { enabled: true, text: BIG, mode: 'auto', checks: ['zh'], since: 1 }
    activePreset[sid] = `pack:填充${i}`
  }
  overrides[SID_A] = { messages: {}, sections: { 'prefill:persona': PERSONA_TEXT }, contexts: {} }
  overrides[SID_B] = { messages: {}, sections: {}, contexts: {} }
  everyTurn[SID_A] = { enabled: true, text: '每轮提醒', mode: 'auto', checks: [], since: 1 }
  activePreset[SID_A] = 'pack:甲'
  activePreset[SID_B] = 'builtin:pure'
  return {
    version: 2,
    prefill: { [SID_A]: 'default', [SID_B]: 'default' },
    armed: [SID_A],
    levers: { blockSections: true, blockMessages: true },
    noticeSeen: true,
    activePreset,
    gate: { [SID_A]: 'replace', [SID_B]: 'pass' },
    overrides,
    lore,
    sandbox,
    everyTurn,
    // 左栏开关：只给 B 记一格（给 A 记 `inject: false` 会把 A 的受控档按 enabled.js 折成观察档）。
    enabled: { [SID_B]: { inject: false } },
    locked: {
      [SID_A]: { at: '2026-01-01T00:00:00.000Z', turn: 3, items: [{ role: 'user', text: '开场白' }], preset: { maps: {}, armed: false, sandbox: null } },
    },
    // 注意 `reasoningPrefix.enabled` **不能**是 true：impl 启动后 1 s 会按 state 自启代理（真监听端口），
    // 那样测试进程收不住。这里只要「ui 里有大字符串」这一个事实，用来证明 summary 不会把 ui 整份带出来。
    ui: { motion: 'lite', experimental: true, reasoningPrefix: { enabled: false, prefix: BIG, contentPrefix: BIG } },
  }
}

// ── 1. 形状：只回目标会话 + 最小全局字段 ─────────────────────────────────────

test('summary：目标会话字段齐全、其他会话一格都不出现', async () => {
  seed(bigState())
  const { data, text } = await post(summaryRoute, { sessionId: SID_A })

  assert.equal(data.ok, true)
  assert.equal(data.sessionId, SID_A)
  assert.equal(typeof data.rev, 'string')
  assert.notEqual(data.rev, '')
  // 目标会话那几格（键名是客户端契约，见 docs/规划-界面重构-v1.md §2.1）。
  assert.deepEqual(data.prefill, { [SID_A]: 'default' })
  assert.deepEqual(data.gate, { [SID_A]: 'replace' })
  assert.deepEqual(data.activePreset, { [SID_A]: 'pack:甲' })
  assert.deepEqual(data.armed, [SID_A])
  assert.deepEqual(Object.keys(data.levers).sort(), [
    'blockContexts',
    'blockMessages',
    'blockSections',
    'blockTools',
    'prefillProbe',
    'probeContext',
    'probeSection',
  ])
  assert.equal(data.levers.blockSections, true)
  assert.equal(data.levers.blockTools, false)
  // locked 是**原记录**（客户端 lockView 要 turn / items / legacy / preset 是否存在）。
  assert.deepEqual(Object.keys(data.locked), [SID_A])
  assert.equal(data.locked[SID_A].turn, 3)
  assert.equal(data.locked[SID_A].items.length, 1)
  // 沙盒只给目标会话一格（level / levelFrom / blocked）。
  assert.deepEqual(data.sandbox, { [SID_A]: { level: 'controlled', levelFrom: 'session', blocked: 0 } })
  // 人格段：persona 是 store 用的名字，overridesPersona 是 §2.1 契约里的旧名，两个都给。
  assert.deepEqual(data.persona, { [SID_A]: true })
  assert.deepEqual(data.overridesPersona, { [SID_A]: true })
  // 全局偏好：motion 必须带上（芯片 setMotionPref 要它）。
  assert.deepEqual(data.ui, { experimental: true, motion: 'lite' })
  assert.equal(data.noticeSeen, true)
  // 没有在册会话 ⇒ 这些表为空而不是 undefined（客户端直接读，不想每个都判空）。
  assert.deepEqual(data.turns, {})
  assert.deepEqual(data.materialized, {})
  assert.deepEqual(data.snapshots, {})
  assert.deepEqual(data.tools, {})
  assert.deepEqual(data.pendingReprime, [])
  assert.deepEqual(data.running, [])

  // 其他会话 / 大字段一律不出现（连 id 都不该有）。
  assert.equal(text.includes(SID_B), false, 'B 会话不出现')
  assert.equal(text.includes('session-filler'), false, '填充会话不出现')
  assert.equal(text.includes('prefill:persona'), false)
  assert.equal(text.includes(PERSONA_TEXT), false, '人格正文不外泄')
})

test('summary：空 sessionId = 全局摘要（只给全局标量 + 全局 id 列表）', async () => {
  seed(bigState())
  const { data, bytes } = await post(summaryRoute, {})
  assert.equal(data.ok, true)
  assert.equal(data.sessionId, '')
  assert.deepEqual(data.prefill, {})
  assert.deepEqual(data.gate, {})
  assert.deepEqual(data.activePreset, {})
  assert.deepEqual(data.sandbox, {})
  assert.deepEqual(data.locked, {})
  assert.deepEqual(data.armed, [SID_A])
  assert.equal(data.ui.motion, 'lite')
  assert.ok(bytes < 10 * 1024)
})

test('summary：未知会话也 ok（各表为空，不抛）', async () => {
  seed(bigState())
  const { data } = await post(summaryRoute, { sessionId: 'session-does-not-exist' })
  assert.equal(data.ok, true)
  assert.deepEqual(data.prefill, {})
  assert.deepEqual(data.locked, {})
  // 沙盒仍给一格（跟随全局默认档），客户端据此显示「观察」。
  assert.equal(data.sandbox['session-does-not-exist'].level, 'observe')
  assert.equal(data.sandbox['session-does-not-exist'].levelFrom, 'global')
})

// ── 2. 体积：< 10 KB（整份 state 是它的几十倍）────────────────────────────────

test('summary：序列化 < 10 KB，且远小于整份状态', async () => {
  seed(bigState())
  const fileBytes = statSync(STATE_FILE).size
  assert.ok(fileBytes > 200 * 1024, `前提：整份 state 很大（实际 ${fileBytes} B）`)
  const { bytes } = await post(summaryRoute, { sessionId: SID_A })
  assert.ok(bytes < 10 * 1024, `summary ${bytes} B 应 < 10 KB`)
  assert.ok(bytes < fileBytes / 10, `summary ${bytes} B 应远小于整份 state ${fileBytes} B`)
})

test('summary：只读 —— 调用不改 state.json（不 patchState / 不迁移写盘）', async () => {
  seed(bigState())
  const before = statSync(STATE_FILE)
  await post(summaryRoute, { sessionId: SID_A })
  const after = statSync(STATE_FILE)
  assert.equal(after.size, before.size)
  assert.equal(after.mtimeMs, before.mtimeMs)
})

// ── 3. rev：state 变了才变 ───────────────────────────────────────────────────

test('summary：rev 是 state 文件指纹 —— 没写盘不变，写盘后跟着变', async () => {
  seed(bigState())
  const first = await post(summaryRoute, { sessionId: SID_A })
  const again = await post(summaryRoute, { sessionId: SID_A })
  assert.equal(again.data.rev, first.data.rev, '没人写盘 ⇒ rev 不变（客户端据此跳过 setState）')

  const next = bigState()
  next.gate = { [SID_A]: 'pure' }
  next.activePreset = { [SID_A]: 'builtin:other' }
  seed(next)
  const changed = await post(summaryRoute, { sessionId: SID_A })
  assert.notEqual(changed.data.rev, first.data.rev, '状态变了 ⇒ rev 必须变')
  assert.deepEqual(changed.data.gate, { [SID_A]: 'pure' }, '同一份响应里内容也跟着新状态走')
  assert.deepEqual(changed.data.activePreset, { [SID_A]: 'builtin:other' })
})

// ── 4. every-turn-status：只剩 {ok, op, status} 且 < 2 KB ─────────────────────

test('every-turn-status：只回 {ok, op, status}，< 2 KB，不再夹带 state / envelope', async () => {
  seed(bigState())
  const { data, text, bytes } = await post(packsRoute, { sessionId: SID_A, op: 'every-turn-status' })
  assert.deepEqual(Object.keys(data).sort(), ['ok', 'op', 'status'], '响应只剩三个键')
  assert.equal(data.ok, true)
  assert.equal(data.op, 'every-turn-status')
  assert.equal(typeof data.status, 'object')
  assert.ok(bytes < 2 * 1024, `every-turn-status ${bytes} B 应 < 2 KB`)
  // 大字段一个都不在（以前这里 spread 了整份 envelope）。
  for (const key of ['state', 'envelope', 'snapshots', 'sandboxView', 'injections', 'audit', 'tools', 'diagnostics', 'manualInbox']) {
    assert.equal(key in data, false, `${key} 不该出现在 every-turn-status 里`)
  }
  // 整份状态里的填充正文也不该漏进来。
  assert.equal(text.includes(BIG), false)
})

// ── 5. 健壮性：坏 state.json / 异常形状都不抛 ────────────────────────────────

test('summary：state.json 损坏 ⇒ ok:false + reason（不抛、不假装空状态）', async () => {
  seed('{ 这不是 JSON')
  const { data, bytes } = await post(summaryRoute, { sessionId: SID_A })
  assert.equal(data.ok, false)
  assert.equal(typeof data.reason, 'string')
  assert.ok(data.reason.length > 0, '要说清楚为什么')
  assert.equal(data.sessionId, SID_A)
  assert.equal(typeof data.rev, 'string')
  assert.ok(bytes < 1024)
})

test('summary：坏文件修好后 ok 恢复 true（错误标记会清掉）', async () => {
  seed(bigState())
  const { data } = await post(summaryRoute, { sessionId: SID_A })
  assert.equal(data.ok, true)
})

test('summary：异常 state 形状（字符串 / 数组 / 缺格）不抛，字段类型仍然稳定', async () => {
  seed({
    prefill: 'not-a-map',
    armed: 'not-an-array',
    levers: 42,
    activePreset: ['not-a-map'],
    gate: 7,
    locked: { [SID_A]: 'not-a-record' },
    sandbox: { [SID_A]: 5, '*': 'observe' },
    overrides: { [SID_A]: null },
    everyTurn: { [SID_A]: 1 },
    ui: 'not-an-object',
    noticeSeen: 'yes',
  })
  const { data } = await post(summaryRoute, { sessionId: SID_A })
  assert.equal(data.ok, true, '形状再怪也不能把路由搞崩')
  assert.equal(data.sessionId, SID_A)
  assert.equal(typeof data.prefill, 'object')
  assert.equal(Array.isArray(data.armed), true)
  assert.equal(typeof data.sandbox, 'object')
  assert.equal(typeof data.ui, 'object')
  assert.equal(typeof data.noticeSeen, 'boolean')
})

test('summary：没有 state.json 时 rev=0#0 且 ok:true，且不会凭空建文件', async () => {
  // 放到最后：前面的用例都写过 state.json，这里先删掉。
  rmSync(STATE_FILE, { force: true })
  const { data } = await post(summaryRoute, { sessionId: SID_A })
  assert.equal(data.ok, true)
  assert.equal(data.rev, '0#0')
  assert.deepEqual(data.prefill, {})
  assert.equal(existsSync(STATE_FILE), false, '只读路由不该写盘')
})

// ── 6. 写接口顺带 summary（客户端 applySummaryWrite 用，规划 §2.2）────────────

test('packs 写响应带 summary：与 summary 路由同形，客户端可直喂 store', async () => {
  seed(bigState())
  const { data } = await post(packsRoute, { sessionId: SID_A, op: 'hidden-set', ids: ['builtin-x'] })
  assert.equal(data.ok, true)
  assert.ok(data.summary !== undefined, '写响应里要有 summary')
  assert.equal(data.summary.sessionId, SID_A)
  assert.equal(typeof data.summary.rev, 'string')
  assert.deepEqual(data.summary.activePreset, { [SID_A]: 'pack:甲' })
})
