/**
 * @local/dsh-prefill —— host 半「壳」（M1.2）。**只有改本文件才需要重启 dsh。**
 *
 * 职责划分：
 *   壳（本文件）—— 启动标记、状态文件读写、自有路由、两个 pre-step 座位、
 *                  闩锁容器、诊断缓冲，以及**热插拔加载器**。
 *   核（gate.js）—— 四通道怎么挂、消息怎么过滤。每次 pre-step 按 mtime 带
 *                  `?rev=` 动态 import ⇒ 改闸门逻辑**免重启**。
 *
 * 为什么要有"壳/核"这层拆法（实测依据）：
 *   · 规划 §9.2-F3：替换已安装包后 `set_bundle` 关→开**不换模块代**（ESM 缓存
 *     按行/包名命中）。本轮又实测一次：把 bundle 从 profile 列表摘掉 → 路由立刻
 *     404（reconciler 确实生效），放回后**仍是旧代**、新字段为空。
 *     ⇒ 改壳必须重启，一次。
 *   · 而动态 import 的 URL 由我控制 `?rev=`，不受该缓存约束 ⇒ 核可以真热换。
 *     这让 M2–M5 的闸门迭代不再需要重启。
 *
 * 三条设计红线：默认零干预（armed 为空即不碰任何会话）；不碰
 * `system-prompt/assemble`（practices P2）；per-step 改写必须 spread（P4）。
 *
 * @module @local/dsh-prefill
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { zstdDecompressSync } from 'node:zlib'
import { builtinPreset, builtinSummaries, everyTurnBlocks, everyTurnPresets, everyTurnTowers } from './builtin-presets.js'
import { blockFromPreset, compileBench, makeBlock, normalizeChecks } from './blocks.js'
import {
  MAX_QUEUE,
  MAX_TEXT,
  deliverToInbox,
  flushQueueToInbox,
  inboxOf,
  isRunning,
  migrateLegacyInjects,
  pendingInInbox,
  queueOf,
  recentDelivered,
  removeFromInbox,
  replaceInInbox,
  sanitizeEntry,
} from './inject-once.js'
import { historyToItems, turnRange } from './session-history.js'
import { detectConstraints, mergeCarried } from './constraint-carry.js'
import { CHECK_IDS, autoParams, modeOf, splitTurns } from './inject-auto.js'
import { applyEnabled, sanitizeEnabled } from './enabled.js'
import { migrateSandbox, withLegacyMirror, withLegacyView } from './sandbox.js'
import { clampSince, lockOf, lockRecord, restorePatch, restoreSandbox, stampFirstOnce, withLock } from './turn-lock.js'
import { sandboxViews } from './sandbox-view.js'
import { sandboxRoute } from './sandbox-routes.js'
import { surfaceOnRequest, surfaceRoute } from './sandbox-surface.js'
import { claims as sandboxClaims, installClaimApi } from './sandbox-trace.js'
import { sanitizeWorkspaceInstructions } from './workspace-instructions.js'
import { cardFromPng, cardId, cardSummary, compileCard, embedCardInPng, parseCard } from './character-cards.js'

/** 壳的代次。核的代次由 gate.js 自己决定，通过诊断暴露。 */
const STAGE = 'M6-shell'

/** Cordis 插件名。 */
export const name = 'dsh-prefill'

/** 家目录：宿主进程里 DSH_HOME 未必注入，兜底到 ~/.dsh。 */
const HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')

/** 本插件的数据目录（规划 §3.3）。 */
const DATA_DIR = join(HOME, 'prefill')

/** 闸门状态文件。 */
const STATE_FILE = join(DATA_DIR, 'state.json')

/** 启动标记：每次 apply 覆盖写，记录当前活着的 JS 模块代。 */
const BOOT_FILE = join(DATA_DIR, 'boot.json')

/** 自有路由（必须落在认证过的 `/api` 栅栏下）。 */
const PING_ROUTE = '/api/dsh-prefill/ping'
const STATE_ROUTE = '/api/dsh-prefill/state'
/** 客户端草稿入口：编辑好的多轮 items 在这里暂存，等用户"发出"时物化。 */
const DRAFT_ROUTE = '/api/dsh-prefill/draft'
/** 手动注入（一次性，issue #19「C」）：op = list | add | edit | remove。 */
const INJECT_ROUTE = '/api/dsh-prefill/inject'
/** 预填装包的读写入口（M4）。 */
const PACKS_ROUTE = '/api/dsh-prefill/packs'
/** 本会话逐轮用量（输入 / 缓存命中 / 输出 + 系统提示规模），给面板的「用量与缓存」卡片。 */
const USAGE_ROUTE = '/api/dsh-prefill/usage'
/** 角色卡（角色扮演扩展，v0.6）：按工作区存取 + 编译。不改动上面任何一条路由。 */
const CARDS_ROUTE = '/api/dsh-prefill/cards'
/** 故事记忆（角色卡三期）：op = get | set | clear，按会话。 */
const MEMORY_ROUTE = '/api/dsh-prefill/memory'
/** 会话沙盒：溯源 / 挂来源包 / 事后改写（issue #15 第 4 / 5 步，逻辑在 sandbox-routes.js）。 */
const SANDBOX_ROUTE = '/api/dsh-prefill/sandbox'

/** 热插拔内核的位置。 */
const HERE = dirname(fileURLToPath(import.meta.url))
const GATE_FILE = join(HERE, 'gate.js')

/** 六个开关的默认值。 */
const DEFAULT_LEVERS = {
  probeSection: false,
  probeContext: false,
  blockSections: false,
  blockContexts: false,
  blockTools: false,
  blockMessages: false,
  // P1 探针（加法路线）：为每个新建 agent 写一个「合成预填装轮」。
  // ⚠️ 这是探针专用开关，全局生效 —— 只能在隔离的 DSH_HOME 里打开。
  prefillProbe: false,
}

/** 默认放行集合：用户原话恒放行，其余注入按白名单。 */
const DEFAULT_ALLOW_KINDS = ['user']

/** 默认状态：`armed` 为空 = 不干预任何会话。 */
const DEFAULT_STATE = {
  version: 1,
  armed: [],
  levers: { ...DEFAULT_LEVERS },
  allowKinds: [...DEFAULT_ALLOW_KINDS],
}

/** 诊断环形缓冲：让插件能自证"卡在哪一步"。 */
const diagnostics = { seen: 0, mounted: 0, gateLoads: 0, gateError: '', last: [] }

function note(entry) {
  diagnostics.seen += 1
  diagnostics.last.push(entry)
  if (diagnostics.last.length > 12) diagnostics.last.shift()
  // 诊断出口之二：无头/CLI 环境下没有 /api 路由可读，用环境变量开 stderr 打印。
  if (process.env.PREFILL_DIAG === '1') {
    try {
      console.error(`[prefill] ${JSON.stringify(entry)}`)
    } catch {
      // 诊断不该拖垮插件。
    }
  }
}

/**
 * 面板的全局偏好 `state.ui`（不进预设、不随导出，只在 state.json 里）：
 *   motion = 'full' | 'lite' | 'off'（动效档位；缺 = 跟随系统「减少动态效果」）。
 * 认不出的键 / 值一律丢掉；什么都不剩 ⇒ undefined（state 里就没有 ui 这一键）。
 */
export function sanitizeUi(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out = {}
  if (['full', 'lite', 'off'].includes(raw.motion)) out.motion = raw.motion
  return Object.keys(out).length > 0 ? out : undefined
}

export function normalizeState(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const levers = source.levers !== null && typeof source.levers === 'object' ? source.levers : {}
  // 会话沙盒第 1 步（issue #15）：overrides / sessionAllowKinds / sessionTools / injectionBlocks / gate 'pure'
  // 读取时迁进 state.sandbox（幂等），旧字段从内存结果里删掉；writeState 写盘时再补回镜像（防降级）。
  // 面板写回的旧字段（patchState 把它们摊在当前状态上）也在这里被整族吸收。
  const out = migrateSandbox({
    // 先摊开原始对象：**保留未知字段**。M2 的按会话闸门映射 `gate`、
    // Q9 的 `noticeSeen` 都靠这一行才不至于被规范化抹掉（否则 UI 写进去就没了）。
    ...source,
    version: 2,
    armed: Array.isArray(source.armed) ? source.armed.filter((id) => typeof id === 'string') : [],
    levers: Object.fromEntries(Object.keys(DEFAULT_LEVERS).map((key) => [key, levers[key] === true])),
    allowKinds: Array.isArray(source.allowKinds)
      ? source.allowKinds.filter((kind) => typeof kind === 'string')
      : [...DEFAULT_ALLOW_KINDS],
    // 面板全局偏好：合法才留，否则连键一起去掉（`...source` 摊进来的脏值也盖掉）。
    ui: sanitizeUi(source.ui),
  })
  if (out.ui === undefined) delete out.ui
  return out
}

let cache = { state: null, mtimeMs: -1 }

function readState() {
  let mtimeMs = -1
  try {
    mtimeMs = statSync(STATE_FILE).mtimeMs
  } catch {
    // 文件缺失 = 默认状态。
  }
  if (cache.state !== null && cache.mtimeMs === mtimeMs) return cache.state
  let state = DEFAULT_STATE
  if (mtimeMs >= 0) {
    try {
      state = normalizeState(JSON.parse(readFileSync(STATE_FILE, 'utf8')))
    } catch {
      state = DEFAULT_STATE
    }
  }
  // 旧版「会话内注入」（state.injects，每轮发）读取时迁成每轮注入积木（issue #19「C」）。
  // 迁移幂等；迁了就顺手落盘一次，之后的读都是新形状。写不进去也不要紧：每次读都会再迁一遍。
  // 落盘必须和 writeState 一样带「防降级」旧字段镜像（withLegacyMirror）：否则从 0.15.x 升级上来、
  // 配过旧 injects 的用户第一次读状态就会把镜像抹掉，回退 0.15.2 读不到自己的逐会话配置（#21）。
  const migrated = migrateLegacyInjects(state, legacyMigrationOptions())
  if (migrated !== state) {
    state = normalizeState(migrated)
    try {
      mkdirSync(DATA_DIR, { recursive: true })
      writeFileSync(STATE_FILE, `${JSON.stringify(withLegacyMirror(state), null, 2)}\n`, 'utf8')
      mtimeMs = statSync(STATE_FILE).mtimeMs
    } catch {
      // 只读环境：保持内存里的迁移结果。
    }
  }
  cache = { state, mtimeMs }
  return state
}

/** 旧每轮注入（只有 text）迁成工作台时要认内置积木 / 塔，与面板同一套。 */
function legacyMigrationOptions() {
  try {
    return { blocks: everyTurnBlocks().map((preset) => blockFromPreset(preset)), towers: everyTurnTowers() }
  } catch {
    return {}
  }
}

/** 从状态队列里删掉这些条目（已搬进 inbox / 已送达）。 */
function pruneQueue(sessionId, ids) {
  if (typeof sessionId !== 'string' || !Array.isArray(ids) || ids.length === 0) return
  const current = readState()
  const list = Array.isArray(current?.injectQueue?.[sessionId]) ? current.injectQueue[sessionId] : []
  const kept = list.filter((entry) => !ids.includes(entry?.id))
  if (kept.length === list.length) return
  const injectQueue = { ...(current.injectQueue ?? {}) }
  if (kept.length > 0) injectQueue[sessionId] = kept
  else delete injectQueue[sessionId]
  patchState({ injectQueue })
}

/** 往状态队列里写（会话不在册时的兜底通道）。 */
function writeQueue(sessionId, list) {
  const current = readState()
  const injectQueue = { ...(current.injectQueue ?? {}) }
  if (list.length > 0) injectQueue[sessionId] = list
  else delete injectQueue[sessionId]
  patchState({ injectQueue })
}

function writeState(next) {
  mkdirSync(DATA_DIR, { recursive: true })
  // 防降级（会话沙盒第 1 步）：同时写回由规则表推出的旧字段镜像 + 指纹，退回 0.15.2 读同一份文件不丢配置；
  // 读回来时指纹对得上的旧字段直接丢掉（新表为准），对不上的（旧版本改过）整族重新迁移。见 sandbox.js。
  writeFileSync(STATE_FILE, `${JSON.stringify(withLegacyMirror(next), null, 2)}\n`, 'utf8')
  cache = { state: null, mtimeMs: -1 }
  return readState()
}

function mergeUi(current, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return current
  return { ...(current ?? {}), ...patch }
}

function patchState(patch) {
  const current = readState()
  return writeState(
    normalizeState({
      ...current,
      ...patch,
      levers: { ...current.levers, ...(patch?.levers ?? {}) },
      // ui 按键合并（以后多了别的偏好，写 motion 不抹掉它们）；`motion: null` = 改回跟随系统。
      ...(patch?.ui !== undefined ? { ui: mergeUi(current.ui, patch.ui) } : {}),
    }),
  )
}

/**
 * 首轮锁定（issue #19 A，turn-lock.js）：记一条 state.locked[会话]（已有就不动）。
 * 由闸门在物化开场对话成功时 / 每轮第 1 步发现还没锁时调用；快照取自兼容视图（旧字段形状），和面板同一份。
 */
function lockSession(sessionId, info) {
  if (typeof sessionId !== 'string' || sessionId === '') return false
  const current = readState()
  if (lockOf(current, sessionId) !== undefined) return false
  const record = lockRecord(withLegacyView(current), sessionId, info)
  const locked = withLock(current.locked, sessionId, record)
  if (locked === undefined) return false
  patchState({ locked })
  note({ lock: 'created', id: sessionId, turn: record.turn, items: record.items.length, legacy: record.legacy === true })
  return true
}

/** 每 agent 的轮次闩锁容器（放壳里，跨内核热换存活）。 */
const latches = new Map()

// ── 预填装包（M4）────────────────────────────────────────────────────────────
// 按工作区一份（规划 §3.3 / Q7）：`<workspace>/.dsh-prefill/packs.json`；
// 会话不在册或没有 cwd 时落到 `<DSH_HOME>/prefill/global/.dsh-prefill/packs.json`。
// 一个包 = `{ id, name, updatedAt, items[] }`，items 与草稿同形（§14.3）。

/** 包文件路径。 */
function packFileFor(workspace) {
  const root = typeof workspace === 'string' && workspace !== '' ? workspace : join(DATA_DIR, 'global')
  return join(root, '.dsh-prefill', 'packs.json')
}

/** 读一个工作区的全部包（坏文件当空，不抛）。 */
function readPacks(workspace) {
  try {
    const raw = JSON.parse(readFileSync(packFileFor(workspace), 'utf8'))
    return Array.isArray(raw?.packs) ? raw.packs.filter((pack) => typeof pack?.name === 'string') : []
  } catch {
    return []
  }
}

/** 写回一个工作区的全部包，返回文件路径。 */
function writePacks(workspace, packs) {
  const file = packFileFor(workspace)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ version: 1, packs }, null, 2)}\n`, 'utf8')
  return file
}

/** 校验注入改写：只留 `{messages, sections, contexts}` 三张「名字 → 文本」表。 */
function sanitizeOverrides(raw) {
  if (raw === null || typeof raw !== 'object') return undefined
  const out = {}
  for (const group of ['messages', 'sections', 'contexts']) {
    const source = raw[group]
    if (source === null || typeof source !== 'object') continue
    const table = {}
    for (const [key, value] of Object.entries(source)) {
      if (key !== '' && typeof value === 'string') table[key] = value
    }
    out[group] = table
  }
  return out
}

/** 校验"工具放行清单"：`['read','edit']`（只放这些）或 `[]`（一个都不给）；`null`/缺省 = 全部放行。 */
function sanitizeTools(raw) {
  if (raw === null) return null
  if (!Array.isArray(raw)) return undefined
  return raw.filter((name) => typeof name === 'string' && name !== '')
}

/**
 * 预设里的每轮注入**配置**（v0.9 §A）：不含运行时状态（since / override）。
 * 关掉或两段都空 ⇒ undefined（不存）。
 */
export function sanitizeEveryTurn(raw) {
  if (raw === null || typeof raw !== 'object') return undefined
  // v0.15：工作台（bench）随条目一起存；有工作台时 text / firstText / checks 由它编译得到，
  // gate.js 仍然只读那三个字段，所以闸门零改动。
  const bench = sanitizeBench(raw.bench)
  const benchTowers = sanitizeBenchTowers(raw.benchTowers)
  const compiled = bench.length > 0 ? compileBench(bench) : null
  const text = compiled !== null ? compiled.text : typeof raw.text === 'string' ? raw.text : ''
  const firstText = compiled !== null ? compiled.firstText : typeof raw.firstText === 'string' ? raw.firstText : ''
  if (raw.enabled !== true || (text.trim() === '' && firstText.trim() === '')) return undefined
  const untilTurn = Math.max(0, Math.floor(Number(raw.untilTurn) || 0))
  const checks =
    compiled !== null ? compiled.checks : Array.isArray(raw.checks) ? CHECK_IDS.filter((id) => raw.checks.includes(id)) : []
  let mode = modeOf({ ...raw, untilTurn })
  if (mode === 'auto' && checks.length === 0) mode = untilTurn > 0 ? 'until' : 'always'
  const { warmup, streak, probation } = autoParams(raw.auto)
  return {
    enabled: true,
    text,
    firstText,
    mode,
    untilTurn,
    checks,
    auto: { warmup, streak, probation },
    ...(bench.length > 0 ? { bench, benchTowers } : {}),
    // 约束承接：来自会话的预设，新会话第一条真实消息那轮发「首轮段 + 接缝提醒」（constraint-carry.js）。
    ...(raw.seam === true ? { seam: true } : {}),
  }
}

/**
 * 存预设 / 导入时的「约束承接」字段（constraint-carry.js）。
 * - 给了 `carried`（面板「从当前会话取」后列出的约束，勾上的那些）⇒ 每轮注入由它们编成，
 *   模式沿用 body.everyTurn（本会话那格）；一条都没勾 = 不带（基于角色卡的预设存 null，免得回落到卡的提醒）；
 * - 没给 ⇒ 照旧只看 body.everyTurn；
 * - `fromSession: true` 原样保留（标记「这份预设来自会话」）。
 */
export function carriedPresetFields(body, { layered = false } = {}) {
  const base = layered && body?.everyTurn === null ? null : sanitizeEveryTurn(body?.everyTurn)
  const fromSession = body?.fromSession === true ? true : undefined
  if (!Array.isArray(body?.carried)) return { everyTurn: base, fromSession }
  const merged = sanitizeEveryTurn(mergeCarried(body.carried, base))
  return { everyTurn: merged ?? (layered ? null : undefined), fromSession }
}

/** v0.15：工作台（面板层数据）—— 每块只留已知字段，文字截断防呆。 */
function sanitizeBench(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue
    const ref = typeof item.ref === 'string' ? item.ref.slice(0, 120) : ''
    if (ref === '') continue
    out.push({
      key: typeof item.key === 'string' && item.key !== '' ? item.key.slice(0, 40) : 'b' + (out.length + 1),
      ref,
      ...(typeof item.tower === 'string' && item.tower !== '' ? { tower: item.tower.slice(0, 120) } : {}),
      name: typeof item.name === 'string' ? item.name.slice(0, 80) : '',
      icon: typeof item.icon === 'string' ? item.icon.slice(0, 40) : '',
      first: typeof item.first === 'string' ? item.first.slice(0, 20000) : '',
      text: typeof item.text === 'string' ? item.text.slice(0, 20000) : '',
      checks: normalizeChecks(item.checks),
      edited: item.edited === true,
      priority: item.priority === true,
      builtin: item.builtin === true,
    })
  }
  return out.slice(0, 60)
}

/** v0.15：台上的塔框（折叠状态）。 */
function sanitizeBenchTowers(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out = {}
  for (const [key, value] of Object.entries(raw)) {
    if (key === '' || value === null || typeof value !== 'object') continue
    out[key.slice(0, 120)] = {
      ref: typeof value.ref === 'string' ? value.ref.slice(0, 120) : key.slice(0, 120),
      name: typeof value.name === 'string' ? value.name.slice(0, 80) : '',
      collapsed: value.collapsed === true,
    }
  }
  return out
}

/** 预设里的故事记忆摘要：{ text, throughTurn }；空 ⇒ undefined。 */
export function sanitizeMemorySeed(raw) {
  if (raw === null || typeof raw !== 'object') return undefined
  const text = typeof raw.text === 'string' ? raw.text.trim() : ''
  if (text === '') return undefined
  return { text, throughTurn: Math.max(0, Math.floor(Number(raw.throughTurn) || 0)) }
}

/**
 * 预设里的角色卡引用（0.10）：只存卡片 id + 面板上的套用选项，不存卡片内容 ——
 * 套用预设时按 id 现编译（世界书、故事记忆开关跟卡走），卡片删了就跳过这一项。
 */
export function sanitizeCardRef(raw) {
  if (raw === null || typeof raw !== 'object') return undefined
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (id === '' || id.length > 200) return undefined
  const src = raw.opts !== null && typeof raw.opts === 'object' ? raw.opts : {}
  const opts = {}
  for (const key of ['reinforce', 'thinkZh', 'firstPerson', 'lore', 'memory']) if (typeof src[key] === 'boolean') opts[key] = src[key]
  if (src.mode === 'agent' || src.mode === 'pure') opts.mode = src.mode
  // -1 = 不要开场白（0.14 之前这里会被夹成 0）。
  if (Number.isFinite(Number(src.greeting))) opts.greeting = Math.max(-1, Math.floor(Number(src.greeting)))
  for (const key of ['userName', 'tools']) if (typeof src[key] === 'string') opts[key] = src[key].slice(0, 500)
  return { id, opts }
}

/** 基于角色卡的预设（0.14）：`layered: true` + 有效的角色卡引用。这种预设可以不带 items、可以存 everyTurn: null。 */
export function isLayered(body) {
  return body !== null && typeof body === 'object' && body.layered === true && sanitizeCardRef(body.card) !== undefined
}

/** v0.15：我的积木的校验（面板那份走同一个 blocks.js，两边形状必须一致）。 */
function sanitizeBlock(raw) {
  if (raw === null || typeof raw !== 'object') return undefined
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (id === '' || id.length > 120) return undefined
  const block = makeBlock({ ...raw, id })
  if (block.text.trim() === '' && block.first.trim() === '') return undefined
  return block
}

/**
 * 预设里存的世界书（0.15+，本会话改过的世界书「保存为预设」时整份存）：只留匹配要用的字段，文字截断防呆。
 * 形状同 character-cards.js 的 compileLore（外加渲染用的 char）；custom / source / enabled 是会话标记，不存。
 */
export function sanitizeLore(raw) {
  if (raw === null || typeof raw !== 'object' || !Array.isArray(raw.entries)) return undefined
  const strs = (list, max) => (Array.isArray(list) ? list.filter((key) => typeof key === 'string' && key.trim() !== '').map((key) => key.trim().slice(0, 200)).slice(0, max) : [])
  const entries = []
  for (const entry of raw.entries.slice(0, 500)) {
    if (entry === null || typeof entry !== 'object') continue
    const id = typeof entry.id === 'string' || Number.isFinite(entry.id) ? entry.id : entries.length
    const probability = Number(entry.probability)
    entries.push({
      id,
      title: typeof entry.title === 'string' ? entry.title.slice(0, 200) : '',
      keys: strs(entry.keys, 50),
      secondary: strs(entry.secondary, 50),
      logic: [0, 1, 2, 3].includes(Number(entry.logic)) ? Number(entry.logic) : 0,
      caseSensitive: entry.caseSensitive === true,
      wholeWords: typeof entry.wholeWords === 'boolean' ? entry.wholeWords : null,
      probability: Number.isFinite(probability) ? Math.max(0, Math.min(100, probability)) : 100,
      order: Number(entry.order) || 0,
      content: typeof entry.content === 'string' ? entry.content.slice(0, 20000) : '',
    })
  }
  const depth = Number(raw.scanDepth)
  const budget = Number(raw.budget)
  return {
    ...(Number.isFinite(depth) && depth > 0 ? { scanDepth: Math.floor(depth) } : {}),
    ...(Number.isFinite(budget) && budget > 0 ? { budget: Math.floor(budget) } : {}),
    ...(typeof raw.char === 'string' ? { char: raw.char.slice(0, 200) } : {}),
    entries,
  }
}

/** v0.15：积木塔的校验（塔里引用的积木可以带局部覆盖文字；引用不到的保留快照兜底）。 */
function sanitizeTower(raw) {
  if (raw === null || typeof raw !== 'object') return undefined
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (id === '' || id.length > 120) return undefined
  const items = []
  for (const item of Array.isArray(raw.items) ? raw.items.slice(0, 40) : []) {
    if (item === null || typeof item !== 'object') continue
    const ref = typeof item.ref === 'string' ? item.ref.trim() : ''
    if (ref === '') continue
    items.push({
      ref: ref.slice(0, 120),
      ...(typeof item.text === 'string' ? { text: item.text.slice(0, 20000) } : {}),
      ...(typeof item.first === 'string' ? { first: item.first.slice(0, 20000) } : {}),
      ...(item.snap !== null && typeof item.snap === 'object'
        ? {
            snap: {
              name: String(item.snap.name ?? '').slice(0, 80),
              first: String(item.snap.first ?? '').slice(0, 20000),
              text: String(item.snap.text ?? '').slice(0, 20000),
              checks: normalizeChecks(item.snap.checks),
            },
          }
        : {}),
    })
  }
  return {
    id,
    name: typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name.trim().slice(0, 80) : id,
    icon: typeof raw.icon === 'string' ? raw.icon.slice(0, 40) : '',
    ...(typeof raw.desc === 'string' && raw.desc !== '' ? { desc: raw.desc.slice(0, 300) } : {}),
    items,
    updatedAt: new Date().toISOString(),
  }
}

/** 会话里最后一轮的轮号（没有 = 0）。 */
function lastTurnOf(events) {
  try {
    return splitTurns(events).at(-1)?.turn ?? 0
  } catch {
    return 0
  }
}

/**
 * 写每轮注入时给自动模式盖章（v0.9 §B5）：
 * - 配置「重新开始」（打开、换模式、改正文 / 首轮段 / 检查项）⇒ since = 下一轮，清掉手动覆盖；
 * - 否则沿用旧的 since；
 * - 带了 `auto.override = { action }` 但没轮号 ⇒ 盖上 atTurn = 下一轮；没带 ⇒ 沿用旧的。
 * - 沿用的 since 夹到 ≤ 下一轮（issue #19）；`firstOnce`（「下一轮发一次」首轮段）见 turn-lock.js stampFirstOnce。
 * 通配格 '*' 不盖（它是新会话默认，不属于任何会话）。
 */
export function stampEveryTurn(previous, next, lastTurnFor) {
  const out = {}
  const lastOf = (key) => (typeof lastTurnFor === 'function' ? lastTurnFor(key) : Number(lastTurnFor) || 0)
  for (const [key, entry] of Object.entries(next ?? {})) {
    if (key === '*' || entry === null || typeof entry !== 'object') {
      out[key] = entry
      continue
    }
    const old = previous?.[key]
    const sameChecks = JSON.stringify([...(entry.checks ?? [])].sort()) === JSON.stringify([...(old?.checks ?? [])].sort())
    const restart =
      old === undefined ||
      old === null ||
      (entry.enabled === true && old.enabled !== true) ||
      modeOf(entry) !== modeOf(old) ||
      String(entry.text ?? '') !== String(old.text ?? '') ||
      String(entry.firstText ?? '') !== String(old.firstText ?? '') ||
      !sameChecks
    const auto = { ...(entry.auto ?? {}) }
    const last = lastOf(key)
    // 不在册的会话：不知道实际轮数，沿用旧值而不是按 0 夹、也不是当成「下一轮」重盖（#44）。
    const knownLast = Number.isFinite(last)
    const fallbackSince = Math.max(0, Math.floor(Number(old?.since) || 0))
    let since
    if (restart) {
      since = knownLast ? last + 1 : fallbackSince
      delete auto.override
    } else {
      // issue #19：since 不能比实际轮数还大（否则之后实际跑的轮一直被当成「重新开始之前」、不计分）。
      since = knownLast ? clampSince(old?.since, last) : fallbackSince
      const wanted = entry.auto?.override
      if ((wanted?.action === 'resume' || wanted?.action === 'pause') && knownLast) {
        auto.override = Number.isFinite(Number(wanted.atTurn)) && wanted.atTurn !== null ? wanted : { action: wanted.action, atTurn: last + 1 }
      } else if (old?.auto?.override !== undefined) auto.override = old.auto.override
      else delete auto.override
    }
    // 「下一轮发一次」首轮段（issue #19 B）：true ⇒ 盖成 { atTurn: 下一轮 }；没带 ⇒ 首轮段没变就沿用。
    // 「首轮段变了 ⇒ 旧 firstOnce 作废」不需要轮数，未知时也照做；只有 true（要盖下一轮）没法盖、按没带处理。
    const firstOnce = knownLast
      ? stampFirstOnce(entry, old, last)
      : stampFirstOnce(entry?.firstOnce === true ? { ...entry, firstOnce: undefined } : entry, old, 0)
    const { firstOnce: _wanted, ...rest } = entry
    out[key] = { ...rest, since, auto, ...(firstOnce !== undefined ? { firstOnce } : {}) }
  }
  return out
}

/** 选择器需要的轻量摘要（不把 items 全丢给下拉框）。 */
function packSummaries(packs) {
  return packs.map((pack) => ({
    name: pack.name,
    count: Array.isArray(pack.items) ? pack.items.length : 0,
    updatedAt: pack.updatedAt ?? null,
    // 0.14：基于角色卡的预设（没写的格从卡来），下拉里标出来。
    ...(typeof pack.card?.id === 'string' && pack.card.id !== '' ? { card: pack.card.id } : {}),
  }))
}

/** 校验一个 items 数组：只留 user / assistant 两形，字段做最小清洗。 */
function sanitizeItems(raw) {
  if (!Array.isArray(raw)) return undefined
  return raw
    .map((item) => {
      if (item === null || typeof item !== 'object') return undefined
      const role = item.role === 'assistant' ? 'assistant' : item.role === 'user' ? 'user' : undefined
      if (role === undefined) return undefined
      const text = typeof item.text === 'string' ? item.text : ''
      if (role === 'assistant') {
        return { role, text, reasoning: typeof item.reasoning === 'string' ? item.reasoning : '' }
      }
      return { role, text }
    })
    .filter((item) => item !== undefined)
}


// ── 角色卡（v0.6，角色扮演扩展）────────────────────────────────────────────
// 一卡一文件：`<workspace>/.dsh-prefill/cards/<id>.json`，内容就是 V2 卡原文（可以直接拷走给 SillyTavern）。
// 没有工作区时落到全局目录，规则同 packs.json。

function cardsDirFor(workspace) {
  const root = typeof workspace === 'string' && workspace !== '' ? workspace : join(DATA_DIR, 'global')
  return join(root, '.dsh-prefill', 'cards')
}

const SAFE_ID = /^[\p{L}\p{N}_-]{1,64}$/u

function readCards(workspace) {
  const dir = cardsDirFor(workspace)
  let names = []
  try {
    names = readdirSync(dir).filter((file) => file.endsWith('.json'))
  } catch {
    return []
  }
  const out = []
  for (const file of names.sort()) {
    try {
      const card = parseCard(readFileSync(join(dir, file), 'utf8'))
      if (card !== undefined) out.push({ id: file.slice(0, -5), card })
    } catch {
      // 坏文件跳过。
    }
  }
  return out
}

function readCard(workspace, id) {
  if (!SAFE_ID.test(id)) return undefined
  try {
    return parseCard(readFileSync(join(cardsDirFor(workspace), `${id}.json`), 'utf8'))
  } catch {
    return undefined
  }
}

function writeCard(workspace, card, png) {
  const dir = cardsDirFor(workspace)
  mkdirSync(dir, { recursive: true })
  const id = cardId(card)
  writeFileSync(join(dir, `${id}.json`), `${JSON.stringify(card, null, 2)}\n`, 'utf8')
  // PNG 卡把原图存在旁边（头像 + 导出 PNG 用）；卡片数据仍以 .json 为准。
  if (png !== undefined) writeFileSync(join(dir, `${id}.png`), png)
  return id
}

function cardPng(workspace, id) {
  if (!SAFE_ID.test(id)) return undefined
  try {
    return readFileSync(join(cardsDirFor(workspace), `${id}.png`))
  } catch {
    return undefined
  }
}

// ── 用量（只读）──────────────────────────────────────────────────────────────
// 数据来源与 DSH 自己的 token-meter 相同：会话日志里 `assistant/message.usage`
// （模型接口返回的计费用量）。本插件**不写**任何统计相关的东西，只是按轮汇总给面板看，
// 外加两项"构成"读数：该轮的系统提示字数与工具 schema 个数 —— 用来回答
// "套了预设 / 纯净模式之后，到底少发了多少、缓存还命不命中"。

/** 会话日志文件：`<DSH_HOME>/sessions/<工作区>/session-<id>/session.v4.jsonl.zstd`。 */
function sessionLogFile(sessionId) {
  const root = join(HOME, 'sessions')
  try {
    for (const workspace of readdirSync(root)) {
      // 会话 id 本身就带 `session-` 前缀，目录名 = 会话 id；兼容不带前缀的旧写法。
      for (const dir of [sessionId, `session-${sessionId}`]) {
        const file = join(root, workspace, dir, 'session.v4.jsonl.zstd')
        if (existsSync(file)) return file
      }
    }
  } catch {
    // 没有 sessions 目录。
  }
  return undefined
}

// 会话日志是**多个 zstd 帧首尾相接**：`zstdDecompressSync` 只解第一帧，必须逐帧切开。
// （帧解析与仓库根的 dump-session.mjs 相同。）
const ZSTD_MAGIC = 4247762216

function scanZstdFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) break
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`bad magic at ${offset}`)
    offset += 4
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    offset += (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    for (;;) {
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      offset += blockType === 1 ? 1 : blockSize
      if (lastBlock) break
    }
    if (checksum) offset += 4
    frames.push({ start, end: offset })
  }
  return frames
}


function decodeSessionLog(buffer) {
  let text = ''
  for (const { start, end } of scanZstdFrames(buffer)) text += zstdDecompressSync(buffer.subarray(start, end)).toString('utf8')
  return text
}

/** 解码一份落盘会话日志成事件列表（读不了 / 解压失败会抛，调用方决定怎么兜底）。 */
function readSessionLog(file) {
  return decodeSessionLog(readFileSync(file))
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return undefined
      }
    })
    .filter((event) => event !== undefined)
}

/** 取会话事件：在册 agent 直接读内存快照，否则解码落盘日志（只读）。 */
function sessionEvents(agent, sessionId) {
  try {
    const events = agent?.session?.snapshotEvents?.()
    if (Array.isArray(events)) return events
  } catch {
    // 落到读文件。
  }
  const file = sessionLogFile(sessionId)
  if (file === undefined) return []
  try {
    return readSessionLog(file)
  } catch {
    return []
  }
}

/**
 * 每轮注入盖章用的「会话最后一轮」（state 路由的 lastTurnFor）：
 * - 在册 ⇒ 读内存快照（快照拿不到时照旧落到日志）；
 * - 不在册、有落盘日志且读得了 ⇒ 按日志算（会话没在跑，日志就是它的最终轮数）；
 * - 不在册且**没有日志 / 日志读不了** ⇒ undefined = 轮数未知，stampEveryTurn 沿用旧值（#44：
 *   以前这里得到 0，会把别的会话的 since 夹成 1）。区分不了「没跑过」和「日志不在本机」，按未知处理。
 */
export function stampLastTurn(agent, sessionId) {
  if (agent !== undefined) return lastTurnOf(sessionEvents(agent, sessionId))
  const file = sessionLogFile(sessionId)
  if (file === undefined) return undefined
  try {
    return splitTurns(readSessionLog(file)).at(-1)?.turn ?? 0
  } catch {
    return undefined
  }
}

/** 一条消息里所有文本块的总字数。 */
function textLength(message) {
  const content = Array.isArray(message?.content) ? message.content : []
  return content.reduce((sum, block) => sum + (typeof block?.text === 'string' ? block.text.length : 0), 0)
}

/** 把事件流折叠成逐轮用量。 */
export function usageOf(events) {
  const turns = new Map()
  const bucket = (turn) => {
    const key = Number.isFinite(turn) ? turn : 0
    if (!turns.has(key)) {
      turns.set(key, { turn: key, steps: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, systemChars: null, tools: null, injectedChars: 0, synthetic: false })
    }
    return turns.get(key)
  }
  let currentTurn = 0
  for (const event of events) {
    const data = event?.data ?? {}
    if (Number.isFinite(data.turn)) currentTurn = data.turn
    if (event?.type === 'system/message') {
      bucket(currentTurn).systemChars = textLength(data.message)
    } else if (event?.type === 'request/header') {
      const tools = data?.header?.tools
      bucket(currentTurn).tools = Array.isArray(tools) ? tools.length : 0
    } else if (event?.type === 'user/message') {
      const kind = data?.source?.kind
      if (typeof kind === 'string' && kind !== 'user') bucket(currentTurn).injectedChars += textLength(data)
    } else if (event?.type === 'assistant/message') {
      const usage = data?.usage ?? data?.message?.usage
      const row = bucket(Number.isFinite(data.turn) ? data.turn : currentTurn)
      if (usage === undefined || usage === null) {
        // 预填装写进历史的合成轮：没有 usage（零消耗）。
        row.synthetic = true
        continue
      }
      row.steps += 1
      row.input += Number(usage.inputTokens) || 0
      row.cacheRead += Number(usage.cacheReadTokens) || 0
      row.cacheWrite += Number(usage.cacheWriteTokens) || 0
      row.output += Number(usage.outputTokens) || 0
    }
  }
  const rows = [...turns.values()].filter((row) => row.turn > 0).sort((a, b) => a.turn - b.turn)
  const total = rows.reduce(
    (sum, row) => ({
      input: sum.input + row.input,
      cacheRead: sum.cacheRead + row.cacheRead,
      cacheWrite: sum.cacheWrite + row.cacheWrite,
      output: sum.output + row.output,
    }),
    { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
  )
  return { turns: rows, total }
}

function unlatch(agentId) {
  const entry = latches.get(agentId)
  if (entry === undefined) return
  for (const dispose of entry.disposers) {
    try {
      dispose()
    } catch {
      // 已随 agent scope 释放的 disposer 会抛，忽略。
    }
  }
  latches.delete(agentId)
}

// ── 热插拔加载器：按 gate.js 的 mtime 决定是否重新 import ──
let gateCache = { mtimeMs: -1, module: null }

async function loadGate() {
  let mtimeMs = 0
  try {
    mtimeMs = statSync(GATE_FILE).mtimeMs
  } catch (error) {
    diagnostics.gateError = `stat gate.js: ${String(error?.message ?? error)}`
    return gateCache.module
  }
  if (gateCache.module !== null && gateCache.mtimeMs === mtimeMs) return gateCache.module
  try {
    const url = new URL('./gate.js', import.meta.url)
    const module = await import(`${url.href}?rev=${mtimeMs}`)
    gateCache = { mtimeMs, module }
    diagnostics.gateLoads += 1
    diagnostics.gateError = ''
    note({ gate: 'reloaded', rev: mtimeMs, stage: module.STAGE ?? '(no STAGE)' })
  } catch (error) {
    diagnostics.gateError = String(error?.message ?? error)
    note({ gate: 'load-failed', error: diagnostics.gateError })
  }
  return gateCache.module
}

/**
 * 故事记忆（v0.6 三期）：一会话一文件 `<DATA_DIR>/memory/<会话>.json`
 * = { text, throughTurn, updatedAt, model }。闸门读写，面板经 MEMORY_ROUTE 查看 / 修改 / 清空。
 */
const MEMORY_DIR = join(DATA_DIR, 'memory')
const SAFE_SESSION = /^[A-Za-z0-9_-]{1,128}$/
const memoryStore = {
  read(sessionId) {
    if (typeof sessionId !== 'string' || !SAFE_SESSION.test(sessionId)) return undefined
    try {
      const parsed = JSON.parse(readFileSync(join(MEMORY_DIR, `${sessionId}.json`), 'utf8'))
      return parsed !== null && typeof parsed === 'object' ? parsed : undefined
    } catch {
      return undefined
    }
  },
  write(sessionId, value) {
    if (typeof sessionId !== 'string' || !SAFE_SESSION.test(sessionId)) return
    mkdirSync(MEMORY_DIR, { recursive: true })
    writeFileSync(join(MEMORY_DIR, `${sessionId}.json`), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  },
  clear(sessionId) {
    if (typeof sessionId !== 'string' || !SAFE_SESSION.test(sessionId)) return
    try {
      unlinkSync(join(MEMORY_DIR, `${sessionId}.json`))
    } catch {
      // 本来就没有。
    }
  },
}

/** 插件根 ctx 的引用：内核的服务解析第三级回退要用它。 */
let rootCtxRef = null

/** 两个座位共用的处理：先拿内核，再委托；任何异常都不许打断这一轮。 */
async function handle(payload, decision, seat) {
  const gate = await loadGate()
  if (gate === null || typeof gate.step !== 'function') {
    note({ seat, error: diagnostics.gateError || 'gate.step 不可用' })
    return decision
  }
  try {
    const api = { readState, note, latches, unlatch, rootCtx: rootCtxRef, memory: memoryStore, pruneQueue, lockSession }
    const next = (await gate.step(api, { ...payload, __seat: seat }, decision)) ?? decision
    // 用户点过「阻断」的消息来源（会话级 + 全局记住）：不论会话是否武装都生效。
    return typeof gate.applyMessageBlocks === 'function' ? gate.applyMessageBlocks(api, payload, decision, next) : next
  } catch (error) {
    note({ seat, error: String(error?.message ?? error) })
    return decision
  }
}

export function apply(ctx) {
  rootCtxRef = ctx
  // 会话沙盒第 4 步：开放给别的插件自报来源包（globalThis[Symbol.for('dsh-prefill.sandbox')].claim，只当线索）。
  installClaimApi()
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(
      BOOT_FILE,
      `${JSON.stringify({ stage: STAGE, pid: process.pid, at: new Date().toISOString() }, null, 2)}\n`,
      'utf8',
    )
  } catch {
    // 标记写不进去不该拖垮插件。
  }

  ctx.effect(
    () => () => {
      for (const agentId of [...latches.keys()]) unlatch(agentId)
    },
    'dsh-prefill: dispose every agent latch',
  )

  /** 交给内核的能力包（每次现取，保证 rootCtx 指向最新一代）。 */
  const api = () => ({ readState, note, latches, unlatch, rootCtx: rootCtxRef, pruneQueue, lockSession })

  // ── 座位 1（主）：根级 agent/pre-step，agent 直接来自 payload ──
  // 顺带维护"轮是否开着"，供轮次规则判断（见 reprimeAll）。
  ctx.on(
    'agent/pre-step',
    async (payload, next) => {
      if (typeof payload?.agent?.id === 'string') openTurn.add(payload.agent.id)
      return handle(payload, await next(), 'root')
    },
    { prepend: true },
  )

  // 开场历史的系统提示对齐（gate.alignOnRequest）：第一条真实消息那一步，把物化时写的那条 system
  // 换成本步的渲染结果，免得 DSH 在本轮末尾追加一整份系统提示（之后每轮历史里都带着两份）。
  ctx.on('agent/request', async (payload, next) => {
    const config = await next()
    const gate = gateCache.module
    if (typeof gate?.alignOnRequest === 'function') {
      try {
        await gate.alignOnRequest(api(), payload)
      } catch (error) {
        note({ alignSystem: 'threw', error: String(error?.message ?? error) })
      }
    }
    // 会话沙盒第 5 步：登记着的 developer/message 事后改写在这里落盘（步内事件，空闲时落盘重启后会话打不开）。
    try {
      surfaceOnRequest(payload, { readState, patchState, note })
    } catch (error) {
      note({ seat: 'sandbox-surface', op: 'apply-pending', error: String(error?.message ?? error) })
    }
    return config
  })

  // 注入审计：盯着落进会话、会进模型的消息（含绕过 pre-step 直接写入的），未登记的记下来给面板。
  ctx.on('session/event', (session, event) => {
    const gate = gateCache.module
    if (typeof gate?.auditEvent !== 'function') return
    try {
      gate.auditEvent(api(), session, event)
    } catch (error) {
      note({ audit: 'error', error: String(error?.message ?? error) })
    }
  })

  // 轮即将结束：此刻 flush 延后的重挂 —— 本轮装配已成过去、下一轮装配尚未发生。
  ctx.on('agent/turn-stopping', async (payload) => {
    const id = payload?.agent?.id
    if (typeof id !== 'string') return
    openTurn.delete(id)
    if (pendingReprime.has(id)) await flushPendingReprime()
  })

  // 活跃 agent 表：状态变化时要能立刻对它们**当场重新挂载**。
  const liveAgents = new Map()

  /** 当前是否有轮正在开（由 pre-step 置真、turn-stopping 置假）。 */
  const openTurn = new Set()

  /** 轮内点击时暂存的重挂请求 —— 等该轮结束再执行（用户定的轮次规则）。 */
  const pendingReprime = new Set()

  /** 立刻对单个 agent 重挂（撤旧 → 按当前状态挂上，latch 标记 pending）。 */
  const reprimeOne = async (agent, label) => {
    const gate = await loadGate()
    if (typeof gate?.prime !== 'function') return
    try {
      unlatch(agent.id)
      await gate.prime({ readState, note, latches, unlatch, rootCtx: rootCtxRef }, agent)
      note({ reprime: label, id: agent.id })
    } catch (error) {
      note({ reprime: label, id: agent.id, error: String(error?.message ?? error) })
    }
  }

  /**
   * 【轮次规则】按当前状态对所有活跃 agent 重新挂载。
   *
   * 规则（用户定）：**点击时的轮次号是基线，效果只在轮次号增加后生效**。
   *   · 会话空闲时点 → 当场挂 ⇒ 紧随的那一轮（turn = N+1）沿用，装配时已就位；
   *   · 一轮进行中点 → 该轮后续 step 的 turn 仍是 N，**不得生效** ⇒ 延后到
   *     `agent/turn-stopping`（本轮的装配已成过去、下一轮的装配还没发生）再挂。
   *
   * 这条规则补的正是"点即挂载"唯一的缝：轮内点击会渗进当前轮的后半段。
   */
  const reprimeAll = async (label) => {
    for (const [id, agent] of liveAgents) {
      if (openTurn.has(id)) {
        pendingReprime.add(id)
        continue
      }
      await reprimeOne(agent, label)
    }
    note({ reprime: label, agents: liveAgents.size, deferred: pendingReprime.size })
  }

  /** 轮结束时：本轮的装配已成过去，此刻重挂对下一轮才是"装配前就位"。 */
  const flushPendingReprime = async () => {
    for (const id of [...pendingReprime]) {
      pendingReprime.delete(id)
      const agent = liveAgents.get(id)
      if (agent !== undefined) await reprimeOne(agent, 'turn-closed')
    }
  }

  // ── 座位 2（次）：per-agent 最外层（改写最外层位置需要 per-agent 注册）──
  ctx.on('agent/created', async ({ agent }) => {
    if (typeof agent?.id === 'string') liveAgents.set(agent.id, agent)
    // 会话不在册时点的手动注入（state.injectQueue）：会话一加载就整体搬进 inbox（next-step），
    // 由循环在下一轮领取、写进会话日志；搬完从状态里删。搬不了（没有 inbox）就留着给闸门兜底。
    try {
      const queue = queueOf(readState(), agent?.id)
      if (queue.length > 0) {
        const { done, moved } = flushQueueToInbox(agent, queue, sessionEvents(agent, agent.id))
        pruneQueue(agent.id, done)
        note({ manual: 'flush-on-created', id: agent.id, moved, done: done.length, left: queue.length - done.length })
      }
    } catch (error) {
      note({ manual: 'flush-failed', id: agent?.id, error: String(error?.message ?? error) })
    }
    if (typeof agent?.ctx?.on === 'function') {
      agent.ctx.on(
        'agent/pre-step',
        async (payload, next) => handle(payload, await next(), 'agent'),
        { prepend: true },
      )
    } else {
      note({ seat: 'agent/created', problem: 'agent.ctx.on 不可用' })
    }

    // 【急切挂载】必须在**任何请求装配之前**把 lever / 阻断器挂上。
    // 实测：只在 pre-step 挂载时，会话首个请求的装配抢在挂载之前发生
    // （诊断里出现过 `{blocker:…, frozen:false, hit:false}`），表现为
    // "首轮不生效、第二轮才生效"。所以这里按当前状态先挂一次。
    const gate = await loadGate()
    if (typeof gate?.prime === 'function') {
      try {
        // prime 现在是 async：它内部要**立刻**探一次"complete 段是否撞车"
        // （harness 在 agent/created 之后、首轮之前就会装配一次，那次抛错的话
        //  pre-step 根本不会跑，只能在这里当场换方案）。
        await gate.prime({ readState, note, latches, unlatch, rootCtx: rootCtxRef }, agent)
      } catch (error) {
        note({ seat: 'agent/created', error: String(error?.message ?? error) })
      }
    }

    // 【预填装：两条触发路径，共用内核的 writeSyntheticTurns】────────────────
    //  · 默认（产品路径）—— 这里只**异步预热系统提示缓存**；真正的物化留到
    //    `agent/inbox/inserted`，那是"用户真发话、但轮次还没开始"的唯一窗口
    //    （`dsh-agent-loop:206` 发事件 → `:803-804` 才 wakeDriver）。
    //    这样"发送前可编辑、发出即物化"才成立。
    //  · 对照（PREFILL_PROBE_TRIGGER=created）—— 仍在 created 当场物化。
    const trigger = process.env.PREFILL_PROBE_TRIGGER ?? 'inbox'
    try {
      if (trigger === 'created') {
        if (typeof gate?.materializePrefill === 'function') await gate.materializePrefill(api(), agent)
      } else if (typeof gate?.preparePrefillPrompt === 'function') {
        await gate.preparePrefillPrompt(api(), agent)
      }
    } catch (error) {
      note({ seat: 'agent/created', prefill: 'threw', error: String(error?.message ?? error) })
    }
  })

  ctx.on('agent/disposed', ({ agent }) => {
    if (typeof agent?.id === 'string') liveAgents.delete(agent.id)
  })

  // ── 预填装物化：用户真发话、轮次还没开始的那个窗口 ──
  // ⚠️ 这是**同步 emit**（`dsh-agent:242-263`：payload 融合 agent、逐监听器 try/catch
  // 只 warn），所以这里**不能 await** —— 一旦 await，写入就晚于 `wakeDriver()`，
  // `turn/start` 已经落地，合成轮再也插不进去（F11/F12）。内核为此把异步的
  // `assemble()` 前移到了 `agent/created` 的 `preparePrefillPrompt`。
  ctx.on('agent/inbox/inserted', ({ agent, message }) => {
    try {
      const gate = gateCache.module
      if (typeof gate?.onInboxInserted === 'function') gate.onInboxInserted(api(), agent, message)
    } catch (error) {
      note({ seat: 'agent/inbox/inserted', prefill: 'threw', error: String(error?.message ?? error) })
    }
  })

  // ── 自有路由（运输层 + 诊断出口）──
  ctx.inject(['connection'], (scope) => {
    const connection = scope.get('connection')
    const register =
      typeof connection?.fetch?.register === 'function'
        ? connection.fetch.register.bind(connection.fetch)
        : undefined

    if (register === undefined) {
      note({ seat: 'routes', problem: 'connection.fetch.register 不可用' })
      return
    }

    const noStore = { headers: { 'cache-control': 'no-store' } }
    const sandboxViewsFor = (state) => {
      try {
        const gate = gateCache.module
        return sandboxViews(
          applyEnabled(state),
          {
            injections: typeof gate?.injections === 'function' ? gate.injections(rootCtxRef) : {},
            tools: typeof gate?.tools === 'function' ? gate.tools(rootCtxRef) : {},
            audit: typeof gate?.auditSnapshot === 'function' ? gate.auditSnapshot() : {},
          },
          [...liveAgents.keys()],
        )
      } catch (error) {
        note({ seat: 'sandbox-view', error: String(error?.message ?? error) })
        return {}
      }
    }
    const envelope = () => {
      const snapshots = typeof gateCache.module?.snapshots === 'function' ? gateCache.module.snapshots() : {}
      const state = readState()
      const injectQueue = state?.injectQueue !== null && typeof state?.injectQueue === 'object' ? state.injectQueue : {}
      return {
        ok: true,
        plugin: '@local/dsh-prefill',
        stage: STAGE,
        gateStage: gateCache.module?.STAGE ?? null,
        stateFile: STATE_FILE,
        // 面板（第 3 步之前）仍读写旧字段：给它由规则表推出的兼容视图（旧字段 + sandbox）。
        state: withLegacyView(state),
        drafts: typeof gateCache.module?.draftIds === 'function' ? gateCache.module.draftIds() : [],
        // Q9 角标：每会话最近一轮的生效快照（三态 + 被丢弃的 kind）。
        snapshots,
        // 每会话"已跑到第几轮"：面板据此自动切换「写入历史」/「每轮注入」两种模式。
        turns: Object.fromEntries(Object.entries(snapshots).map(([id, snap]) => [id, snap?.turn ?? 0])),
        // 每会话状态队列里待发的手动注入条数（会话不在册时的兜底通道；inbox 里挂着的看 INJECT_ROUTE）。
        manualQueued: Object.fromEntries(Object.entries(injectQueue).map(([id, items]) => [id, Array.isArray(items) ? items.length : 0])),
        // Q17：可改的注入清单 = **预置 catalog**（全局 prompt 层的真实注册名）+ 每会话已发现的条目。
        // 有 catalog，用户就能在某条注入还没出现过时先写好改写（"直接劫持"）。
        injections: typeof gateCache.module?.injections === 'function' ? gateCache.module.injections(rootCtxRef) : {},
        // 疑似未登记注入（每会话）：面板据此给出「本会话阻断 / 全局记住」。
        audit: typeof gateCache.module?.auditSnapshot === 'function' ? gateCache.module.auditSnapshot() : {},
        // 会话沙盒页（issue #15 第 3 步）：每会话的档位 / 来源包 / 未归属 / 审计裁决（面板拿不到 sandbox.js，由宿主算好）。
        sandboxView: sandboxViewsFor(state),
        // 插件自报的来源包（第 4 步，只当线索；用户确认后才进 state.sandboxPacks）。
        sandboxClaims: sandboxClaims(),
        // 工具放行：catalog = 扫到的工具名（装配看到的）+ 官方可限制名单；sessions = 每会话装配到的工具。
        // 注意：**不改工具说明**（工具类注入一律忽略），这里只管"能不能用"。
        tools: typeof gateCache.module?.tools === 'function' ? gateCache.module.tools(rootCtxRef) : { catalog: [], sessions: {} },
        // 与其他插件的冲突（典型：`complete:true` 段被 pure preset 占）——UI 要**明说**，
        // 不能悄悄降级：用户已定 pure preset 不再使用、由本插件的「纯净模式」接管。
        conflicts: typeof gateCache.module?.conflicts === 'function' ? gateCache.module.conflicts() : {},
        // 有"延后到下一轮"的重挂请求 ⇒ 客户端角标要明说"下一轮生效"，
        // 否则用户在**轮内**翻开关会以为没生效（它会一直跑到本轮结束 —— Q18 的轮次冻结）。
        pendingReprime: [...pendingReprime],
        // 预填装已写成真实历史的会话（会话 → 条数）。
        materialized: typeof gateCache.module?.materialized === 'function' ? gateCache.module.materialized() : {},
        // 诊断（给脚本/排查用）。
        diagnostics: {
          seen: diagnostics.seen,
          mounted: diagnostics.mounted,
          gateLoads: diagnostics.gateLoads,
          gateError: diagnostics.gateError,
          last: diagnostics.last.slice(-8),
        },
      }
    }

    scope.effect(
      () => register({ path: PING_ROUTE, methods: ['POST'], requestBody: 'buffered', fetch: async () => Response.json(envelope(), noStore) }),
      'dsh-prefill: ping route',
    )

    scope.effect(
      () =>
        register({
          path: STATE_ROUTE,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: async (request) => {
            let patch
            try {
              patch = await request?.json?.()
            } catch {
              patch = undefined
            }
            // 「恢复开局时的预设」（issue #19 B）：`{ restoreOpening: 会话 }` ⇒ 用 state.locked[会话] 里的快照换回配置，
            // 下一轮生效，历史不动。补丁由服务端按最新状态现算（别的键一概不收）；每轮注入沿用快照自己的 since。
            let restored
            if (typeof patch?.restoreOpening === 'string' && patch.restoreOpening !== '') {
              const sid = patch.restoreOpening
              const current = readState()
              const built = restorePatch(withLegacyView(current), sid, lockOf(current, sid), lastTurnOf(sessionEvents(liveAgents.get(sid), sid)))
              if (built === undefined) return Response.json({ ...envelope(), ok: false, reason: 'not-locked' }, noStore)
              patchState(built)
              // 沙盒那一格（受控档 / 包开关 / 单条规则）旧字段表达不了，按快照原样换回；在旧字段吸收之后写，以快照为准。
              const sandbox = restoreSandbox(readState().sandbox, sid, lockOf(current, sid))
              if (sandbox !== undefined) patchState({ sandbox })
              note({ restoreOpening: sid, everyTurn: built.everyTurn?.[sid] ? { since: built.everyTurn[sid].since, mode: built.everyTurn[sid].mode } : null })
              restored = sid
              patch = undefined
              await reprimeAll('restore-opening')
            }
            if (patch !== null && typeof patch === 'object' && Object.keys(patch).length > 0) {
              if (patch.everyTurn !== null && typeof patch.everyTurn === 'object') {
                const previous = readState()?.everyTurn ?? {}
                // 不在册的会话按落盘日志算；没有日志 / 读不了才返回 undefined（= 不知道轮数，#44）。
                // 只在 0.17.0 那样一律返回 undefined 会让编辑历史会话时改正文 / 下一轮发一次 / 立即恢复暂停失效。
                const lastTurnFor = (key) => stampLastTurn(liveAgents.get(key), key)
                patch = { ...patch, everyTurn: stampEveryTurn(previous, patch.everyTurn, lastTurnFor) }
              }
              patchState(patch)
              // 【关键】写状态后当场重新挂载：让"点完开关再发"在该轮装配之前就位。
              await reprimeAll('state-write')
              // 系统提示可能变了（套人格 / 接管）：首轮前要物化的预填装轮得用**新**提示，
              // 否则合成轮里记着旧系统提示（实测：合成轮 5766 字无人格、真实轮 5971 字有人格）。
              const gate = await loadGate()
              for (const [, live] of liveAgents) {
                try {
                  if (typeof gate?.preparePrefillPrompt === 'function') await gate.preparePrefillPrompt(api(), live)
                } catch {
                  // 预热失败不影响写状态。
                }
              }
            }
            return Response.json(restored !== undefined ? { ...envelope(), restored } : envelope(), noStore)
          },
        }),
      'dsh-prefill: state route',
    )

    // 草稿入口：客户端编辑好的多轮 items 先暂存在这里（内存注册表），
    // 等用户真的发出第一条消息时，`agent/inbox/inserted` 才把它物化成 durable 事件。
    // —— 这就是"发送前可编辑、发出即固定"（Q15）的传输层。
    scope.effect(
      () =>
        register({
          path: DRAFT_ROUTE,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: async (request) => {
            let body
            try {
              body = await request?.json?.()
            } catch {
              body = undefined
            }
            const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
            const items = Array.isArray(body?.items) ? body.items : undefined
            const gate = await loadGate()

            // 读形态：只给 sessionId ⇒ 回当前草稿（客户端编辑器首次打开时用）。
            if (items === undefined) {
              const draft =
                sessionId !== '' && typeof gate?.readDraft === 'function' ? (gate.readDraft(sessionId) ?? null) : null
              return Response.json({ ok: true, sessionId, draft, staged: false, ...envelope() }, noStore)
            }

            let staged = false
            let reason = ''
            if (sessionId === '') reason = 'missing sessionId'
            else if (typeof gate?.stageDraft !== 'function') reason = 'gate.stageDraft unavailable'
            else staged = gate.stageDraft(sessionId, items) === true

            // 草稿登记后立刻预热系统提示：会话已存在时 `agent/created` 早就过去了。
            if (staged) {
              for (const [, live] of liveAgents) {
                if (live.id !== sessionId) continue
                try {
                  if (typeof gate?.preparePrefillPrompt === 'function') await gate.preparePrefillPrompt(api(), live)
                } catch (error) {
                  note({ seat: 'draft-route', prefill: 'prewarm-failed', error: String(error?.message ?? error) })
                }
              }
            }
            note({ seat: 'draft-route', staged, sessionId, items: items?.length ?? 0, reason })
            return Response.json(
              { ok: true, staged, sessionId, items: items?.length ?? 0, reason, ...envelope() },
              noStore,
            )
          },
        }),
      'dsh-prefill: draft route',
    )

    // 手动注入（issue #19「C」，见 inject-once.js）：会话在册 ⇒ 走 agent.inbox（next-step，插话）；
    // 不在册 ⇒ 写进 state.injectQueue，会话加载时搬进 inbox / 闸门兜底。
    //   list   —— { pending: [{ id, role, text, via }], running, live, recent: [{ id, role, text, turn }] }
    //   add    —— { role, text } ⇒ 入队；返回 { entry, via: 'inbox'|'queue', running }
    //   edit   —— { id, role, text } ⇒ 改还没发出去的那条；已发出 ⇒ ok:false, reason:'sent'
    //   remove —— { id } ⇒ 撤回；已发出 ⇒ ok:false, reason:'sent'
    scope.effect(
      () =>
        register({
          path: INJECT_ROUTE,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: async (request) => {
            let body
            try {
              body = await request?.json?.()
            } catch {
              body = undefined
            }
            const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
            const op = typeof body?.op === 'string' ? body.op : 'list'
            if (sessionId === '') return Response.json({ ok: false, reason: 'missing sessionId' }, noStore)
            const agent = liveAgents.get(sessionId)
            const live = inboxOf(agent) !== undefined
            // 会话在册但状态队列里还有残留（例如加载时没搬成）：顺手搬进 inbox。
            if (live) {
              const queue = queueOf(readState(), sessionId)
              if (queue.length > 0) pruneQueue(sessionId, flushQueueToInbox(agent, queue, sessionEvents(agent, sessionId)).done)
            }
            const listing = () => {
              const pending = [
                ...(live ? pendingInInbox(agent).map((entry) => ({ ...entry, via: 'inbox' })) : []),
                ...queueOf(readState(), sessionId).map((entry) => ({ ...entry, via: 'queue' })),
              ]
              return { pending, running: isRunning(agent), live, recent: recentDelivered(sessionEvents(agent, sessionId)) }
            }
            let ok = true
            let reason = ''
            let result = {}
            const textOf = (raw) => (typeof raw === 'string' ? raw.slice(0, MAX_TEXT) : '')
            if (op === 'add') {
              const entry = sanitizeEntry({ id: randomUUID(), role: body?.role, text: textOf(body?.text), at: new Date().toISOString() })
              if (entry === undefined) {
                ok = false
                reason = 'empty'
              } else {
                const delivered = live ? deliverToInbox(agent, entry) : { ok: false }
                if (delivered.ok) result = { entry, via: 'inbox', running: delivered.running === true }
                else {
                  const queue = queueOf(readState(), sessionId)
                  if (queue.length >= MAX_QUEUE) {
                    ok = false
                    reason = 'queue-full'
                  } else {
                    writeQueue(sessionId, [...queue, entry])
                    await reprimeAll('manual-inject')
                    result = { entry, via: 'queue', running: false }
                  }
                }
              }
            } else if (op === 'edit' || op === 'remove') {
              const id = typeof body?.id === 'string' ? body.id : ''
              const queue = queueOf(readState(), sessionId)
              const inQueue = queue.findIndex((entry) => entry.id === id)
              if (inQueue >= 0) {
                if (op === 'remove') writeQueue(sessionId, queue.filter((entry) => entry.id !== id))
                else {
                  const entry = sanitizeEntry({ ...queue[inQueue], role: body?.role ?? queue[inQueue].role, text: textOf(body?.text) })
                  if (entry === undefined) {
                    ok = false
                    reason = 'empty'
                  } else writeQueue(sessionId, queue.map((item) => (item.id === id ? entry : item)))
                }
              } else if (live) {
                const pending = pendingInInbox(agent).find((entry) => entry.id === id)
                if (op === 'remove') ok = removeFromInbox(agent, id)
                else {
                  const entry = sanitizeEntry({ id, role: body?.role ?? pending?.role, text: textOf(body?.text) })
                  if (entry === undefined) {
                    ok = false
                    reason = 'empty'
                  } else ok = pending !== undefined && replaceInInbox(agent, entry)
                }
                if (!ok && reason === '') reason = 'sent'
              } else {
                ok = false
                reason = 'sent'
              }
            }
            note({ seat: 'inject-route', op, sessionId, ok, reason, via: result.via, live })
            return Response.json({ ok, op, sessionId, reason, ...result, ...listing() }, noStore)
          },
        }),
      'dsh-prefill: manual inject route',
    )

    // 会话沙盒：溯源（静态读插件包源码 / 用户点了才让 AI 读）、确认后挂来源包、直写通道的事后改写。
    scope.effect(
      () =>
        register({
          path: SANDBOX_ROUTE,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: async (request) => {
            let body
            try {
              body = await request?.json?.()
            } catch {
              body = undefined
            }
            let result
            try {
              result = await sandboxRoute(body ?? {}, { readState, patchState, liveAgents, rootCtx: rootCtxRef, note, surface: surfaceRoute })
            } catch (error) {
              result = { ok: false, op: body?.op ?? null, reason: String(error?.message ?? error) }
            }
            if (result.ok && (body?.op === 'attach' || body?.op === 'detach')) await reprimeAll('sandbox-pack')
            return Response.json(result, noStore)
          },
        }),
      'dsh-prefill: sandbox route',
    )

    // 预填装包：按工作区存取（Q7）。op = list | get | save | delete | import
    scope.effect(
      () =>
        register({
          path: PACKS_ROUTE,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: async (request) => {
            let body
            try {
              body = await request?.json?.()
            } catch {
              body = undefined
            }
            const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
            // 工作区取自在册 agent 的 session header（会话不在册就落全局目录）。
            const workspace = liveAgents.get(sessionId)?.session?.header?.cwd
            const op = typeof body?.op === 'string' ? body.op : 'list'
            const file = packFileFor(workspace)
            let packs = readPacks(workspace)
            let reason = ''
            // 工作台 4 个 op 的返回附加值（id / affected）。以前只赋值没声明也没返回：ESM 严格模式下
            // 给未声明变量赋值会抛 ReferenceError，而 patchState 已经执行 ⇒ 界面报错但状态已写。
            let extra = {}

            const upsert = (name, items, overrides, tools, gate, extra = {}) => {
              // 预设 = 预填装内容 + 注入改写 + **工具放行**（§4-M5：换包=换权限）。
              const pack = {
                name,
                updatedAt: new Date().toISOString(),
                // 基于角色卡的预设（0.14）可以不带 items：没写的格套用时从卡现编译。
                ...(items === undefined ? {} : { items }),
                ...(overrides === undefined ? {} : { overrides }),
                ...(tools === undefined ? {} : { tools }),
                ...(gate === 'pure' || gate === 'pass' || gate === 'replace' ? { gate } : {}),
                ...(extra.everyTurn === undefined ? {} : { everyTurn: extra.everyTurn }),
                ...(extra.memorySeed === undefined ? {} : { memorySeed: extra.memorySeed }),
                ...(extra.card === undefined ? {} : { card: extra.card }),
                // 改过的世界书（0.15+）：只在带着角色卡时存（世界书跟卡走）；角色卡文件本身不动。
                ...(extra.lore === undefined || extra.card === undefined ? {} : { lore: extra.lore }),
                // 左栏启用开关（v0.10）：只存关掉的项；全开 = 不存。
                ...(extra.enabled === undefined ? {} : { enabled: extra.enabled }),
                // 工作区说明（AGENTS.md / CLAUDE.md）：只存模式 + 改写正文，从不存文件原文；原样 = 不存。
                ...(extra.workspaceInstructions === undefined ? {} : { workspaceInstructions: extra.workspaceInstructions }),
                // 约束承接：这份预设是从会话存下来的（开场里带着那段历史）。
                ...(extra.fromSession === true ? { fromSession: true } : {}),
              }
              const at = packs.findIndex((entry) => entry.name === name)
              if (at >= 0) packs[at] = pack
              else packs = [...packs, pack]
              writePacks(workspace, packs)
            }

            if (op === 'list') {
              // 无操作，直接回列表。
            } else if (op === 'block-save') {
              // v0.15：新建 / 覆盖「我的积木」（含遮内置的「我的版本」）。
              const block = sanitizeBlock(body?.block)
              if (block === undefined) reason = 'invalid block'
              else {
                patchState({ blocks: { ...(readState()?.blocks ?? {}), [block.id]: block } })
                extra = { id: block.id }
              }
            } else if (op === 'block-delete') {
              const id = typeof body?.id === 'string' ? body.id : ''
              const state = readState()
              const blocks = state?.blocks ?? {}
              const towers = state?.towers ?? {}
              const affected = Object.values(towers)
                .filter((tower) => (Array.isArray(tower?.items) ? tower.items : []).some((item) => item?.ref === id))
                .map((tower) => tower.id)
              if (id === '') reason = 'missing id'
              else if (body?.dryRun === true) {
                // 只报影响面（面板先拿列表做确认）。
              } else if (blocks[id] === undefined) reason = 'not found'
              else {
                const gone = blocks[id]
                const nextBlocks = { ...blocks }
                delete nextBlocks[id]
                // 塔里保留文字快照：原积木删了，塔照常能发。
                const snapshot = { name: gone.name, first: gone.first, text: gone.text, checks: [...gone.checks] }
                const nextTowers = {}
                for (const [key, tower] of Object.entries(towers)) {
                  nextTowers[key] = {
                    ...tower,
                    items: (Array.isArray(tower?.items) ? tower.items : []).map((item) =>
                      item?.ref === id ? { ...item, snap: item.snap ?? snapshot } : item,
                    ),
                  }
                }
                patchState({ blocks: nextBlocks, towers: nextTowers })
              }
              extra = { affected }
            } else if (op === 'tower-save') {
              const tower = sanitizeTower(body?.tower)
              if (tower === undefined) reason = 'invalid tower'
              else {
                patchState({ towers: { ...(readState()?.towers ?? {}), [tower.id]: tower } })
                extra = { id: tower.id }
              }
            } else if (op === 'tower-delete') {
              const id = typeof body?.id === 'string' ? body.id : ''
              const towers = { ...(readState()?.towers ?? {}) }
              if (id === '' || towers[id] === undefined) reason = 'not found'
              else {
                delete towers[id]
                patchState({ towers })
              }
            } else if (op === 'hidden-set') {
              // 隐藏的内置积木 / 塔（设置里可找回）。
              const ids = Array.isArray(body?.ids) ? body.ids.filter((value) => typeof value === 'string' && value !== '').slice(0, 200) : []
              patchState({ hiddenBuiltins: ids })
            } else if (op === 'builtin') {
              const id = typeof body?.id === 'string' ? body.id : ''
              const preset = builtinPreset(id)
              note({ seat: 'packs-route', op, id, hit: preset !== undefined })
              return Response.json({ ok: true, op, id, pack: preset ?? null, ...envelope() }, noStore)
            } else if (op === 'get') {
              const name = typeof body?.name === 'string' ? body.name : ''
              const found = packs.find((entry) => entry.name === name)
              note({ seat: 'packs-route', op, name, hit: found !== undefined })
              return Response.json({ ok: true, op, name, pack: found ?? null, file, ...envelope() }, noStore)
            } else if (op === 'from-session') {
              // 把当前会话已发生的对话转成开场条目（只读，不存）；客户端预览后再走 save。
              // 范围「第 N 轮 到 第 M 轮」（v0.10.1）：fromTurn 缺省 1，toTurn 缺省 = 到最后；旧调用只给 toTurn 照旧。
              const range = turnRange(body)
              const events = sessionEvents(liveAgents.get(sessionId), sessionId)
              const result = historyToItems(events, {
                reasoning: body?.reasoning === true,
                fromTurn: range.from,
                toTurn: range.to,
              })
              // 本会话的每轮注入配置（只认本会话自己那格，不认 '*'）和故事记忆摘要，给「带上……」两个复选框。
              const everyTurn = sanitizeEveryTurn(readState()?.everyTurn?.[sessionId]) ?? null
              // 约束承接：会话里实际发过的每轮注入 → 当时生效的积木（不论来自本会话、'*' 还是角色卡），面板默认勾上带进预设。
              const { constraints } = detectConstraints(events, readState(), sessionId, { fromTurn: range.from, toTurn: range.to, catalog: everyTurnBlocks() })
              const stored = memoryStore.read(sessionId)
              const memory = typeof stored?.text === 'string' && stored.text.trim() !== '' ? { text: stored.text.trim(), throughTurn: Number(stored.throughTurn) || 0 } : null
              const toTurn = range.to
              // 截了轮次、而摘要覆盖到截取末轮 M 之后 ⇒ 不许带（摘要里有分支点之后的剧情）。
              const memoryAllowed = memory !== null && (toTurn === 0 || memory.throughTurn <= toTurn)
              note({ seat: 'packs-route', op, sessionId, items: result.items.length, turnCount: result.turnCount, lastTurn: result.lastTurn, toolCalls: result.toolCalls, everyTurn: everyTurn?.mode ?? null, memory: memory?.throughTurn ?? null, memoryAllowed })
              return Response.json({ ok: true, op, ...result, fromTurn: range.from, toTurn: range.to, everyTurn, constraints, memory, memoryAllowed, ...envelope() }, noStore)
            } else if (op === 'every-turn-status') {
              // 面板状态行：本会话每轮注入的自动判定（只读）。
              const gate = await loadGate()
              const status =
                typeof gate?.everyTurnStatus === 'function'
                  ? gate.everyTurnStatus(applyEnabled(readState()), sessionId, sessionEvents(liveAgents.get(sessionId), sessionId))
                  : { enabled: false }
              return Response.json({ ok: true, op, status, ...envelope() }, noStore)
            } else if (op === 'save') {
              const name = typeof body?.name === 'string' ? body.name.trim() : ''
              // 基于角色卡（0.14）：只存和卡不一样的格；没写的格 = 从卡来，null = 明确用默认。
              const layered = isLayered(body)
              const items = layered && body?.items === undefined ? undefined : sanitizeItems(body?.items)
              const overrides = sanitizeOverrides(body?.overrides)
              const tools = sanitizeTools(body?.tools)
              // 约束承接：「从当前会话取」后勾上的约束（carried）编成每轮注入，并记下 fromSession。
              const { everyTurn, fromSession } = carriedPresetFields(body, { layered })
              const memorySeed = sanitizeMemorySeed(body?.memorySeed)
              const cut = Number(body?.toTurn) > 0 ? Math.floor(Number(body.toTurn)) : 0
              if (name === '') reason = 'missing name'
              else if (items === undefined && !layered) reason = 'invalid items[]'
              else if (memorySeed !== undefined && cut > 0 && memorySeed.throughTurn > cut) reason = 'memory summary covers turns after the cut'
              else upsert(name, items, overrides, tools, body?.gate, { everyTurn, fromSession, memorySeed, card: sanitizeCardRef(body?.card), lore: sanitizeLore(body?.lore), enabled: sanitizeEnabled(body?.enabled), workspaceInstructions: sanitizeWorkspaceInstructions(body?.workspaceInstructions) })
            } else if (op === 'delete') {
              const name = typeof body?.name === 'string' ? body.name : ''
              const next = packs.filter((entry) => entry.name !== name)
              if (next.length === packs.length) reason = 'not found'
              else {
                packs = next
                writePacks(workspace, packs)
              }
            } else if (op === 'import') {
              let parsed
              try {
                parsed = typeof body?.json === 'string' ? JSON.parse(body.json) : body?.json
              } catch (error) {
                parsed = undefined
                reason = `bad json: ${String(error?.message ?? error)}`
              }
              if (parsed !== undefined) {
                const layered = isLayered(parsed)
                const items = layered && parsed?.items === undefined ? undefined : sanitizeItems(parsed?.items ?? parsed)
                const overrides = sanitizeOverrides(parsed?.overrides)
                const tools = sanitizeTools(parsed?.tools)
                const raw = parsed?.name ?? body?.name
                const name = typeof raw === 'string' ? raw.trim() : ''
                if ((items === undefined && !layered) || name === '') reason = 'import needs { name, items[] }'
                else upsert(name, items, overrides, tools, parsed?.gate, { ...carriedPresetFields(parsed, { layered }), memorySeed: sanitizeMemorySeed(parsed?.memorySeed), card: sanitizeCardRef(parsed?.card), lore: sanitizeLore(parsed?.lore), enabled: sanitizeEnabled(parsed?.enabled), workspaceInstructions: sanitizeWorkspaceInstructions(parsed?.workspaceInstructions) })
              }
            } else {
              reason = `unknown op "${op}"`
            }

            note({ seat: 'packs-route', op, sessionId, workspace: workspace ?? '(global)', count: packs.length, reason })
            return Response.json(
              {
                ok: true,
                op,
                packs: packSummaries(packs),
                builtins: builtinSummaries(),
                everyTurnPresets: everyTurnPresets(),
                everyTurnTowers: everyTurnTowers(),
                everyTurnBlocks: everyTurnBlocks(),
                blocks: Object.values(readState()?.blocks ?? {}),
                towers: Object.values(readState()?.towers ?? {}),
                hiddenBuiltins: Array.isArray(readState()?.hiddenBuiltins) ? readState().hiddenBuiltins : [],
                file,
                reason,
                ...extra,
                ...envelope(),
              },
              noStore,
            )
          },
        }),
      'dsh-prefill: packs route',
    )


    // 角色卡：op = list | get | import | delete | compile | avatar | export-png（规划-角色卡 §6）。
    // 只读写卡片文件、做编译；套用由客户端走原有的系统提示 / 草稿 / 每轮注入路径完成。
    scope.effect(
      () =>
        register({
          path: CARDS_ROUTE,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: async (request) => {
            let body
            try {
              body = await request?.json?.()
            } catch {
              body = undefined
            }
            const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
            const workspace = liveAgents.get(sessionId)?.session?.header?.cwd
            const op = typeof body?.op === 'string' ? body.op : 'list'
            const id = typeof body?.id === 'string' ? body.id : ''
            let reason = ''
            let extra = {}
            if (op === 'list') {
              // 直接回列表。
            } else if (op === 'get') {
              const card = readCard(workspace, id)
              if (card === undefined) reason = 'not found'
              else extra = { card }
            } else if (op === 'import') {
              let card
              if (typeof body?.png === 'string') {
                let bytes
                try {
                  bytes = Buffer.from(body.png, 'base64')
                  card = cardFromPng(bytes)
                } catch {
                  card = undefined
                }
                if (card === undefined) reason = 'no character data in PNG'
                else extra = { id: writeCard(workspace, card, bytes), name: card.data.name }
              } else {
                card = parseCard(body?.json)
                if (card === undefined) reason = 'not a character card (needs at least a name)'
              }
              if (card !== undefined && extra.id === undefined) extra = { id: writeCard(workspace, card), name: card.data.name }
            } else if (op === 'delete') {
              if (!SAFE_ID.test(id)) reason = 'bad id'
              else {
                try {
                  unlinkSync(join(cardsDirFor(workspace), `${id}.json`))
                } catch {
                  reason = 'not found'
                }
                try {
                  unlinkSync(join(cardsDirFor(workspace), `${id}.png`))
                } catch {
                  // 没有头像就算了。
                }
              }
            } else if (op === 'avatar') {
              // 头像：PNG 卡导入时存下的原图（base64）。
              const png = cardPng(workspace, id)
              if (png === undefined) reason = 'no avatar'
              else extra = { png: png.toString('base64') }
            } else if (op === 'export-png') {
              // 导出 PNG：原图 + 当前卡片数据（重写 chara / ccv3 两个文本块）。
              const card = readCard(workspace, id)
              const png = cardPng(workspace, id)
              const out = card !== undefined && png !== undefined ? embedCardInPng(png, card) : undefined
              if (out === undefined) reason = 'no avatar'
              else extra = { png: Buffer.from(out).toString('base64'), name: card.data.name }
            } else if (op === 'compile') {
              const card = readCard(workspace, id)
              if (card === undefined) reason = 'not found'
              else {
                try {
                  extra = { compiled: compileCard(card, body?.options ?? {}) }
                } catch (error) {
                  reason = String(error?.message ?? error)
                }
              }
            } else {
              reason = `unknown op "${op}"`
            }
            const cards = readCards(workspace).map(({ id: key, card }) => ({
              ...cardSummary(key, card),
              hasAvatar: existsSync(join(cardsDirFor(workspace), `${key}.png`)),
            }))
            note({ seat: 'cards-route', op, id, workspace: workspace ?? '(global)', count: cards.length, reason })
            return Response.json({ ok: reason === '', op, reason, cards, dir: cardsDirFor(workspace), ...extra }, noStore)
          },
        }),
      'dsh-prefill: cards route',
    )

    // 故事记忆：面板查看 / 手动改 / 清空本会话的摘要。running = 这会儿正在后台总结。
    scope.effect(
      () =>
        register({
          path: MEMORY_ROUTE,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: async (request) => {
            let body
            try {
              body = await request?.json?.()
            } catch {
              body = undefined
            }
            const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
            const op = typeof body?.op === 'string' ? body.op : 'get'
            let reason = ''
            if (!SAFE_SESSION.test(sessionId)) reason = 'bad session'
            else if (op === 'set') {
              const text = typeof body?.text === 'string' ? body.text.trim() : ''
              const current = memoryStore.read(sessionId) ?? {}
              memoryStore.write(sessionId, { ...current, text, updatedAt: new Date().toISOString(), edited: true })
            } else if (op === 'clear') {
              memoryStore.clear(sessionId)
            } else if (op !== 'get') {
              reason = `unknown op "${op}"`
            }
            const memory = reason === '' ? memoryStore.read(sessionId) ?? null : null
            const running = typeof gateCache.module?.memoryJobs === 'function' ? gateCache.module.memoryJobs().includes(sessionId) : false
            note({ seat: 'memory-route', op, sessionId, reason })
            return Response.json({ ok: reason === '', op, reason, memory, running }, noStore)
          },
        }),
      'dsh-prefill: memory route',
    )

    scope.effect(
      () =>
        register({
          path: USAGE_ROUTE,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: async (request) => {
            let body
            try {
              body = await request?.json?.()
            } catch {
              body = undefined
            }
            const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
            if (sessionId === '') return Response.json({ ok: false, reason: 'missing sessionId' }, noStore)
            const usage = usageOf(sessionEvents(liveAgents.get(sessionId), sessionId))
            return Response.json({ ok: true, sessionId, ...usage }, noStore)
          },
        }),
      'dsh-prefill: usage route',
    )

    ctx.logger?.info?.(`dsh-prefill: host half applied (${STAGE}), state at ${STATE_FILE}`)
  })
}
