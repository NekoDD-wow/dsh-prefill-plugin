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

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import https from 'node:https'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { zstdDecompressSync } from 'node:zlib'
import { builtinPreset, builtinSummaries, everyTurnBlocks, everyTurnPresets, everyTurnTowers, migrateLegacyCwdOverrides, migrateLegacyCwdPrompt } from './builtin-presets.js'
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
import { sandboxView, sandboxViews } from './sandbox-view.js'
import { sandboxRoute } from './sandbox-routes.js'
import { surfaceOnRequest, surfaceRoute } from './sandbox-surface.js'
import { claims as sandboxClaims, installClaimApi } from './sandbox-trace.js'
import { sanitizeWorkspaceInstructions } from './workspace-instructions.js'
import { cardFromPng, cardId, cardSummary, compileCard, embedCardInPng, parseCard } from './character-cards.js'
import { buildToolCatalog, createReasoningPrefixProxy } from './reasoning-prefix.js'

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

/** 「每会话最后轮数」sidecar（跨进程复用，写状态时不必再解压大日志）。 */
const LAST_TURN_FILE = join(DATA_DIR, 'last-turn.json')

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
/** 轻量摘要（规划 §2.1）：常驻轮询只拉这一条（< 10 KB），不再每 2.5 s 拉整份 state。 */
const SUMMARY_ROUTE = '/api/dsh-prefill/summary'

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
  // 「改常驻条目会重拼系统提示」的确认框勾了「不再提示」⇒ 记住（全局设置，不进预设）。
  if (raw.loreConstWarn === true) out.loreConstWarn = true
  // 实验性功能总开关（默认关）：关着时实验区只留开关，胶囊弹窗不显示实验面板。
  if (raw.experimental === true) out.experimental = true
  // 思考前缀实验（DeepSeek beta）：开关 / 前缀 / 端口 / 路由名 / 触发标记；未知字段丢掉。
  const reasoning = raw.reasoningPrefix
  if (reasoning !== null && typeof reasoning === 'object' && !Array.isArray(reasoning)) {
    const next = {}
    if (reasoning.enabled === true) next.enabled = true
    if (typeof reasoning.prefix === 'string') next.prefix = reasoning.prefix.slice(0, 2000)
    // 内容前缀（assistant 消息的 content 开头，官方 beta 的另一种前缀）。
    if (typeof reasoning.contentPrefix === 'string') next.contentPrefix = reasoning.contentPrefix.slice(0, 2000)
    if (Number.isInteger(reasoning.port) && reasoning.port > 0 && reasoning.port < 65536) next.port = reasoning.port
    if (typeof reasoning.providerId === 'string' && /^[a-z0-9-]+$/.test(reasoning.providerId)) next.providerId = reasoning.providerId
    if (typeof reasoning.modelId === 'string' && reasoning.modelId !== '') next.modelId = reasoning.modelId.slice(0, 200)
    if (typeof reasoning.match === 'string') next.match = reasoning.match
    if (reasoning.catalogRole === 'user' || reasoning.catalogRole === 'system') next.catalogRole = reasoning.catalogRole
    // 面板可调的 shim / textualize（默认 true）：**必须在这里放行**，否则路由收下、写盘时被丢掉，
    // 表现就是「保存提示成功、复选框回弹、代理永远按 true 跑」（docs §5 那条坑）。
    if (typeof reasoning.shim === 'boolean') next.shim = reasoning.shim
    if (typeof reasoning.textualize === 'boolean') next.textualize = reasoning.textualize
    // 工具清单的三个可选口径（v0.20.5）：
    // catalogMode：each = 每轮代理内部注入（默认）| history = 插件往会话历史注入一次，代理不再重复注入
    // catalogDetail：full 完整 / brief 精简 / names 仅工具名（瘦身）
    // catalogPosition：head 插在开头 system 段后（利于缓存，默认）/ tail 紧贴前缀消息（老行为）
    if (reasoning.catalogMode === 'history' || reasoning.catalogMode === 'each') next.catalogMode = reasoning.catalogMode === 'history' ? 'history' : 'each'
    if (reasoning.catalogDetail === 'full' || reasoning.catalogDetail === 'brief' || reasoning.catalogDetail === 'names') next.catalogDetail = reasoning.catalogDetail
    if (reasoning.catalogPosition === 'head' || reasoning.catalogPosition === 'tail') next.catalogPosition = reasoning.catalogPosition === 'tail' ? 'tail' : 'head'
    // P1：回退链顺序 / 是否允许 passthrough。
    if (reasoning.fallbackOrder === 'system-first' || reasoning.fallbackOrder === 'user-first') next.fallbackOrder = reasoning.fallbackOrder
    if (reasoning.allowPassthrough === false) next.allowPassthrough = false
    // P1：清单包含 / 排除（工具名；最多 60 个，单个 ≤80 字）。
    const toolList = (value) => {
      if (!Array.isArray(value)) return undefined
      const out = value
        .filter((item) => typeof item === 'string' && item.trim() !== '')
        .map((item) => item.trim().slice(0, 80))
        .slice(0, 60)
      return out.length > 0 ? out : undefined
    }
    const include = toolList(reasoning.catalogInclude)
    if (include !== undefined) next.catalogInclude = include
    const exclude = toolList(reasoning.catalogExclude)
    if (exclude !== undefined) next.catalogExclude = exclude
    // 代理 JSONL 日志：开关 + 路径（默认路径由 config 兜底，这里只存用户改过的）。
    if (reasoning.logging !== null && typeof reasoning.logging === 'object' && !Array.isArray(reasoning.logging)) {
      const logging = {}
      if (reasoning.logging.enabled === true) logging.enabled = true
      if (typeof reasoning.logging.file === 'string' && reasoning.logging.file.trim() !== '') logging.file = reasoning.logging.file.trim().slice(0, 300)
      // P1：调试用三份文件（请求形态 dump / 原始流 raw / 模型文本 content），空字符串 = 关闭。
      for (const key of ['dumpFile', 'rawFile', 'contentFile']) {
        if (typeof reasoning.logging[key] === 'string' && reasoning.logging[key].trim() !== '') logging[key] = reasoning.logging[key].trim().slice(0, 300)
      }
      if (Object.keys(logging).length > 0) next.logging = logging
    }
    // 实验面板可调的硬编码：一次响应最多吐几个工具调用 / 连续失败几次自动停用。
    if (Number.isInteger(reasoning.maxEmittedCalls) && reasoning.maxEmittedCalls >= 1 && reasoning.maxEmittedCalls <= 32) next.maxEmittedCalls = reasoning.maxEmittedCalls
    if (Number.isInteger(reasoning.failureThreshold) && reasoning.failureThreshold >= 1 && reasoning.failureThreshold <= 10) next.failureThreshold = reasoning.failureThreshold
    out.reasoningPrefix = next
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * 前缀预设（独立预设，v0.20.3）：[{ name, prefix, contentPrefix }]。
 * 先独立存，之后整体预设要接过来时直接读这张表即可。
 */
export function sanitizePrefixPresets(raw) {
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  const out = []
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
    const name = typeof entry.name === 'string' ? entry.name.trim().slice(0, 60) : ''
    if (name === '' || seen.has(name)) continue
    seen.add(name)
    out.push({
      name,
      prefix: typeof entry.prefix === 'string' ? entry.prefix.slice(0, 2000) : '',
      contentPrefix: typeof entry.contentPrefix === 'string' ? entry.contentPrefix.slice(0, 2000) : '',
      // P1：预设也可以带触发标记（套用时一并写入 match；空 = 不改当前触发）。
      ...(typeof entry.match === 'string' && entry.match !== '' ? { match: entry.match.slice(0, 200) } : {}),
    })
    if (out.length >= 30) break
  }
  return out
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
    reasoningPrefixPresets: sanitizePrefixPresets(source.reasoningPrefixPresets),
  })
  if (out.ui === undefined) delete out.ui
  if (out.reasoningPrefixPresets.length === 0) delete out.reasoningPrefixPresets
  return migrateLegacyCwdSandbox(out)
}

/**
 * 旧版内置「中文版官方系统提示」残留的 `你的工作目录是 {{cwd}}。`（见 builtin-presets.js 的 migrateLegacyCwdPrompt）：
 * 读取时把规则表里 section 改写规则的这一行换成新版文案，否则整段 interpolate:false、`{{model}}` 也不替换。
 * 只动 `match.section` 的 rewrite 规则（系统提示段）；没变就返回原对象。旧字段镜像由 writeState 按迁移后的表重推。
 */
function migrateLegacyCwdSandbox(state) {
  const table = state?.sandbox
  if (table === null || typeof table !== 'object') return state
  let changed = false
  const nextTable = {}
  for (const [key, scope] of Object.entries(table)) {
    if (!Array.isArray(scope?.rules)) {
      nextTable[key] = scope
      continue
    }
    let scopeChanged = false
    const rules = scope.rules.map((rule) => {
      if (rule?.action !== 'rewrite' || typeof rule?.match?.section !== 'string' || typeof rule.text !== 'string') return rule
      const text = migrateLegacyCwdPrompt(rule.text)
      if (text === rule.text) return rule
      scopeChanged = true
      return { ...rule, text }
    })
    nextTable[key] = scopeChanged ? { ...scope, rules } : scope
    if (scopeChanged) changed = true
  }
  return changed ? { ...state, sandbox: nextTable } : state
}

let cache = { state: null, mtimeMs: -1 }

/**
 * 最近一次读 state.json 的失败原因（'' = 正常）。readState 照旧吞异常回默认状态（闸门不能因为
 * 坏文件停摆），但 summary 路由要据此回 `ok:false`：否则面板会把「状态文件坏了」显示成「什么都没配」。
 */
let stateReadError = ''

function readState() {
  let mtimeMs = -1
  try {
    mtimeMs = statSync(STATE_FILE).mtimeMs
  } catch {
    // 文件缺失 = 默认状态。
  }
  if (cache.state !== null && cache.mtimeMs === mtimeMs) return cache.state
  let state = DEFAULT_STATE
  stateReadError = ''
  if (mtimeMs >= 0) {
    try {
      state = normalizeState(JSON.parse(readFileSync(STATE_FILE, 'utf8')))
    } catch (error) {
      state = DEFAULT_STATE
      stateReadError = String(error?.message ?? error)
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

/**
 * state 文件的版本指纹（mtime + size）：客户端拿它跳过「没变化」的响应（规划 §2.1 的 `rev`）。
 * 只做一次 statSync，不读文件；patchState / writeState 都是重写整份文件，mtime 一定变。
 * 文件不存在 ⇒ `0#0`（与「空状态」区分开）。
 */
function stateRevision() {
  try {
    const stat = statSync(STATE_FILE)
    return `${stat.mtimeMs}#${stat.size}`
  } catch {
    return '0#0'
  }
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
    // 旧预设里存着旧版内置「中文版官方系统提示」（含 `{{cwd}}` 那一行）：读出时换成新版文案，套用 / 导出拿到的都是新文本。
    return Array.isArray(raw?.packs)
      ? raw.packs
          .filter((pack) => typeof pack?.name === 'string')
          .map((pack) => {
            const overrides = migrateLegacyCwdOverrides(pack.overrides)
            return overrides === pack.overrides ? pack : { ...pack, overrides }
          })
      : []
  } catch {
    return []
  }
}

/**
 * 写一个工作区的包文件。**失败只记一笔不抛**：盘满 / 只读 / 路径被文件占住时，写接口不能把
 * reject 冒到宿主（那会让整个路由 500、面板看不出发生了什么），返回 false 交给调用方标 reason。
 */
function writePacks(workspace, packs) {
  const file = packFileFor(workspace)
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify({ version: 1, packs }, null, 2)}\n`, 'utf8')
    return true
  } catch (error) {
    note({ seat: 'packs-write', file, workspace: workspace ?? '(global)', error: String(error?.message ?? error) })
    return false
  }
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
  // 导入旧版导出的 JSON / 旧面板直接存：同样把旧内置的 `{{cwd}}` 那一行换掉。
  return migrateLegacyCwdOverrides(out)
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
      // 常驻条目（拼进系统提示、面板只显示）：标记要留着，否则存成预设再套用时会被当成普通条目。
      ...(entry.constant === true ? { constant: true } : {}),
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
    // 不在册的会话要 zstd 解压 + 解析整份日志；大日志一次 1s+。而「写状态」会反复问到同一批会话
    // （套预设时客户端还会带整张 everyTurn 表）⇒ 按日志 mtime+size 缓存最后一轮，日志没变就直接复用。
    // 缓存分两层：进程内 Map + 落盘 sidecar（进程重启 / 换实例后也能直接命中）。
    let stat
    try {
      stat = statSync(file)
    } catch {
      stat = undefined // 拿不到 stat 就走慢路径（读日志失败时返回 undefined）。
    }
    const side = lastTurnSidecar()[sessionId]
    if (lastTurnCacheHit(side, stat)) return side.last
    const cached = LAST_TURN_CACHE.get(sessionId)
    if (lastTurnCacheHit(cached, stat)) return cached.last
    const last = splitTurns(readSessionLog(file)).at(-1)?.turn ?? 0
    if (stat !== undefined) recordLastTurn(sessionId, last, stat)
    return last
  } catch {
    return undefined
  }
}

/**
 * 缓存条目是否匹配当前日志 stat（纯函数，便于单测）：mtime+size 一致 ⇒ 缓存可信。
 * @param {{mtimeMs?:number,size?:number}|undefined|null} entry
 * @param {{mtimeMs?:number,size?:number}|undefined|null} stat
 */
export function lastTurnCacheHit(entry, stat) {
  if (entry === undefined || entry === null || stat === undefined || stat === null) return false
  return Number(entry.mtimeMs) === Number(stat.mtimeMs) && Number(entry.size) === Number(stat.size)
}

/** 读取（并缓存）sidecar 内容：sessionId → { last, mtimeMs, size }；坏文件当作空缓存。 */
function lastTurnSidecar() {
  if (LAST_TURN_SIDECAR !== null) return LAST_TURN_SIDECAR
  const out = {}
  try {
    const raw = JSON.parse(readFileSync(LAST_TURN_FILE, 'utf8'))
    if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [id, entry] of Object.entries(raw)) {
        if (typeof id !== 'string' || id === '' || entry === null || typeof entry !== 'object') continue
        const last = Number(entry.last)
        const mtimeMs = Number(entry.mtimeMs)
        const size = Number(entry.size)
        if (!Number.isFinite(last) || !Number.isFinite(mtimeMs) || !Number.isFinite(size)) continue
        out[id] = { last: Math.max(0, Math.floor(last)), mtimeMs, size }
      }
    }
  } catch {
    // 文件不存在 / 坏了 ⇒ 空缓存，后续按需重建。
  }
  LAST_TURN_SIDECAR = out
  return out
}

/** 把 sidecar 落盘（只在算出新值 / 轮结束时调用，不是每次读都写）。 */
function persistLastTurnSidecar() {
  const map = LAST_TURN_SIDECAR
  if (map === null) return
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    const ids = Object.keys(map)
    if (ids.length > 300) {
      ids.sort((a, b) => (map[a].mtimeMs ?? 0) - (map[b].mtimeMs ?? 0))
      const keep = {}
      for (const id of ids.slice(ids.length - 300)) keep[id] = map[id]
      LAST_TURN_SIDECAR = keep
    }
    writeFileSync(LAST_TURN_FILE, JSON.stringify(LAST_TURN_SIDECAR, null, 2) + '\n', 'utf8')
  } catch {
    // 写不进去不影响本轮（内存缓存还在，下次再写）。
  }
}

/**
 * 记一条「会话最后一轮」到内存 + sidecar（写盘 / 轮结束都走它）。
 * stat 是会话日志的 stat —— mtime+size 是校验凭据：日志一变就自动失效，不会拿旧轮数骗人。
 * @param {string} sessionId
 * @param {number} turn
 * @param {{mtimeMs?:number,size?:number}} stat
 */
export function recordLastTurn(sessionId, turn, stat) {
  if (typeof sessionId !== 'string' || sessionId === '') return undefined
  const value = Number(turn)
  if (!Number.isFinite(value)) return undefined
  const entry = { last: Math.max(0, Math.floor(value)), mtimeMs: Number(stat?.mtimeMs) || 0, size: Number(stat?.size) || 0 }
  const map = lastTurnSidecar()
  const prev = map[sessionId]
  if (prev !== undefined && prev.last === entry.last && prev.mtimeMs === entry.mtimeMs && prev.size === entry.size) return prev
  map[sessionId] = entry
  LAST_TURN_CACHE.set(sessionId, entry)
  persistLastTurnSidecar()
  return entry
}

/**
 * 启动后空闲预热：把 state.everyTurn 里各会话的「最后一轮」提前算进 sidecar。
 * sidecar 已经命中的几乎零成本；没命中的才读一次日志（把冷读从「用户点套用那一刻」挪到空闲）。
 */
export function preheatLastTurnCache() {
  const queue = []
  try {
    const state = readState()
    for (const id of Object.keys(state?.everyTurn ?? {})) {
      if (id !== '*' && typeof id === 'string' && id !== '') queue.push(id)
    }
  } catch {
    return 0
  }
  let index = 0
  const tick = () => {
    if (index >= queue.length) return
    const id = queue[index++]
    try {
      stampLastTurn(undefined, id)
    } catch {
      // 单个会话读不了不影响后面的。
    }
    const next = setTimeout(tick, 120)
    next.unref?.()
  }
  const first = setTimeout(tick, 0)
  first.unref?.()
  return queue.length
}

/** 不在册会话的「最后一轮」缓存：sessionId → { mtimeMs, size, last }（日志没动就不重复解压）。 */
const LAST_TURN_CACHE = new Map()
/** sidecar 的内存副本（懒加载；null = 还没读过文件）。 */
let LAST_TURN_SIDECAR = null

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

/** PR5 spike：思考前缀代理（仅 DSH_PREFILL_SPIKE_PORT 打开时存在）。 */
let reasoningSpike = null

/** 两个座位共用的处理：先拿内核，再委托；任何异常都不许打断这一轮。 */
async function handle(payload, decision, seat) {
  const gate = await loadGate()
  if (gate === null || typeof gate.step !== 'function') {
    note({ seat, error: diagnostics.gateError || 'gate.step 不可用' })
    return decision
  }
  try {
    const api = { readState, note, latches, unlatch, rootCtx: rootCtxRef, memory: memoryStore, pruneQueue, lockSession, patchState }
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
  const api = () => ({ readState, note, latches, unlatch, rootCtx: rootCtxRef, pruneQueue, lockSession, patchState })

  // ── 思考前缀实验（DeepSeek 官方 beta 专用）：状态在 state.ui.reasoningPrefix，启用时起代理并确保 pi-ai 路由 ──
  const REASONING_DEFAULT = { enabled: false, prefix: '', port: 46321, providerId: 'prefill-think', modelId: 'deepseek-flash' }
  /** 实验性功能总开关（state.ui.experimental）：关着时实验能力一律不可用（env 强制端口除外）。 */
  const experimentalOn = () => {
    try {
      return readState()?.ui?.experimental === true
    } catch {
      return false
    }
  }
  /** 当前活动代理：{ proxy, port }；未启用为 null。 */
  let reasoningActive = null
  /**
   * 前缀日志（v0.20.3）：每轮第一步记一条「这轮实际会发的前缀」快照，面板据此逐轮微调。
   * 内存环形 + JSONL 落盘（<DATA_DIR>/prefix-log.jsonl），状态文件不动（每请求写 900KB 不划算）。
   */
  const prefixLog = []
  const PREFIX_LOG_LIMIT = 200
  /** 前缀轮总数（不受环形 200 上限影响，面板「前缀轮」用）。 */
  let prefixTurnTotal = 0
  /** 代理 JSONL 日志默认落盘路径（面板可改；开关在 state 里）。 */
  const DEFAULT_PROXY_LOG = join(DATA_DIR, 'reasoning-proxy.jsonl')
  /** 用户点了「清空本轮填装」的会话：下一轮第一个请求跳过前缀（记进日志，标明 skipped）。 */
  const prefixSkipQueued = new Set()
  /** 本轮正在跳过前缀的会话 / 轮号：整轮都跳过（多步工具轮也不加），轮结束时清掉。 */
  let skipTurnSession = ''
  let skipTurnNumber = 0
  /** 最近一次代理启动失败的原因（面板要能看到「为什么模型选择不生效」）。 */
  let reasoningProxyError = null
  /** 最近一次 apply 的结果（enable/disable/repair 路由回给面板）。 */
  let reasoningLastApply = null
  const reasoningConfigOf = () => {
    let raw
    try {
      raw = readState()?.ui?.reasoningPrefix
    } catch {
      raw = undefined
    }
    const config = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
    const envPort = Number(process.env.DSH_PREFILL_SPIKE_PORT || 0)
    const experimental = experimentalOn()
    return {
      // 环境变量端口 = 隔离实验用，绕过总开关；面板里的启用必须总开关先开。
      experimental,
      enabled: envPort > 0 ? true : config.enabled === true && experimental,
      prefix: typeof config.prefix === 'string' ? config.prefix : process.env.DSH_PREFILL_SPIKE_PREFIX || '',
      contentPrefix: typeof config.contentPrefix === 'string' ? config.contentPrefix : process.env.DSH_PREFILL_SPIKE_CONTENT_PREFIX || '',
      port: Number.isInteger(config.port) && config.port > 0 ? config.port : envPort > 0 ? envPort : REASONING_DEFAULT.port,
      providerId: typeof config.providerId === 'string' && config.providerId !== '' ? config.providerId : REASONING_DEFAULT.providerId,
      modelId: typeof config.modelId === 'string' && config.modelId !== '' ? config.modelId : REASONING_DEFAULT.modelId,
      match: typeof config.match === 'string' ? config.match : '',
      shim: config.shim !== false,
      textualize: config.textualize !== false,
      catalogRole: config.catalogRole === 'user' ? 'user' : 'system',
      catalogMode: config.catalogMode === 'history' ? 'history' : 'each',
      catalogDetail: config.catalogDetail === 'brief' || config.catalogDetail === 'names' ? config.catalogDetail : 'full',
      catalogPosition: config.catalogPosition === 'tail' ? 'tail' : 'head',
      // 原来是硬编码在代理 / 自动停用里的 8 与 3：搬到状态里，由面板暴露。
      maxEmittedCalls: Number.isInteger(config.maxEmittedCalls) ? config.maxEmittedCalls : 8,
      failureThreshold: Number.isInteger(config.failureThreshold) ? config.failureThreshold : 3,
      // P1：回退链顺序 / 允许 passthrough / 清单包含排除。
      fallbackOrder: config.fallbackOrder === 'user-first' ? 'user-first' : config.fallbackOrder === 'system-first' ? 'system-first' : '',
      allowPassthrough: config.allowPassthrough !== false,
      catalogInclude: Array.isArray(config.catalogInclude) ? config.catalogInclude : [],
      catalogExclude: Array.isArray(config.catalogExclude) ? config.catalogExclude : [],
      // P0：代理 JSONL 日志（面板开关 + 路径；默认落在 <DATA_DIR>/reasoning-proxy.jsonl）。
      logging: {
        enabled: config.logging !== null && typeof config.logging === 'object' && config.logging.enabled === true,
        file:
          config.logging !== null && typeof config.logging === 'object' && typeof config.logging.file === 'string' && config.logging.file !== ''
            ? config.logging.file
            : DEFAULT_PROXY_LOG,
        dumpFile: config.logging !== null && typeof config.logging === 'object' && typeof config.logging.dumpFile === 'string' ? config.logging.dumpFile : '',
        rawFile: config.logging !== null && typeof config.logging === 'object' && typeof config.logging.rawFile === 'string' ? config.logging.rawFile : '',
        contentFile: config.logging !== null && typeof config.logging === 'object' && typeof config.logging.contentFile === 'string' ? config.logging.contentFile : '',
      },
    }
  }
  /** 每轮第一步记一条前缀快照：这一轮实际会发什么（含是否被跳过），面板按轮显示。 */
  const recordPrefixTurn = (sessionId, turn) => {
    if (typeof sessionId !== 'string' || sessionId === '') return
    const config = reasoningConfigOf()
    prefixTurnTotal += 1
    const skipped = prefixSkipQueued.has(sessionId)
    if (skipped) {
      prefixSkipQueued.delete(sessionId)
      skipTurnSession = sessionId
      skipTurnNumber = Number(turn) || 0
    }
    const entry = {
      sessionId,
      turn: Number(turn) || 0,
      at: Date.now(),
      enabled: config.enabled,
      proxyRunning: reasoningActive !== null,
      reasoningPrefix: config.prefix,
      contentPrefix: config.contentPrefix,
      skipped,
    }
    prefixLog.push(entry)
    if (prefixLog.length > PREFIX_LOG_LIMIT) prefixLog.shift()
    try {
      mkdirSync(DATA_DIR, { recursive: true })
      appendFileSync(join(DATA_DIR, 'prefix-log.jsonl'), JSON.stringify(entry) + '\n', 'utf8')
    } catch (error) {
      note({ seat: 'reasoning-prefix', prefixLog: String(error?.message ?? error) })
    }
    note({ seat: 'reasoning-prefix', turn: entry.turn, reasoning: config.prefix.slice(0, 40), content: config.contentPrefix.slice(0, 40), skipped })
  }
  /**
   * catalogMode=history：把工具清单**一次性注入会话历史**（工具集不变就不重复注入；
   * 工具集变了、或上下文压缩把它挤掉之后，自动再补一条）。
   * 注入的是 source.kind='prefill' 的 user 消息：DSH 会写进会话日志（模型可见），
   * 但不会当作普通用户消息展示；代理看到历史里已有清单就不再每轮重复注入。
   * @returns {Promise<boolean>} 这一轮是否新注入了清单
   */
  const ensureCatalogInjected = async (payload, decision) => {
    const config = reasoningConfigOf()
    if (config.enabled !== true || config.catalogMode !== 'history') return false
    if (Number(payload?.step ?? 1) !== 1) return false
    const agent = payload?.agent
    if (typeof agent?.id !== 'string') return false
    const catalog = toolCatalogOf()
    if (catalog === '') return false
    const hash = createHash('sha1').update(catalog).digest('hex').slice(0, 12)
    let existing = null
    for (const event of sessionEvents(agent, agent.id)) {
      if (event?.type === 'user/message' && event.data?.source?.prefill === 'tool-catalog') existing = event.data
    }
    if (existing !== null && existing.source?.catalogHash === hash) return false
    const messages = Array.isArray(decision?.messages) ? decision.messages : []
    if (messages.some((message) => message?.source?.prefill === 'tool-catalog')) return false
    const injected = {
      id: 'prefill-tool-catalog-' + hash,
      role: 'user',
      source: { kind: 'prefill', prefill: 'tool-catalog', catalogHash: hash, bytes: catalog.length },
      content: [{ type: 'text', text: catalog }],
    }
    decision.messages = [injected, ...messages]
    note({ seat: 'reasoning-prefix', catalog: 'injected', id: agent.id, hash, bytes: catalog.length, detail: config.catalogDetail })
    return true
  }
  /** 由工具 registry 现拼的文本清单（每请求一次；tools 服务不在时退回内置清单）。 */
  const toolCatalogOf = () => {
    try {
      const tools = ctx.get('tools')
      if (typeof tools?.schemas !== 'function') return ''
      const config = reasoningConfigOf()
      // P1：按工具名做包含 / 排除（大小写不敏感；include 非空时只留名单内的）。
      const include = new Set(config.catalogInclude.map((name) => name.toLowerCase()))
      const exclude = new Set(config.catalogExclude.map((name) => name.toLowerCase()))
      const schemas = tools.schemas().filter((schema) => {
        const name = typeof schema?.name === 'string' ? schema.name.toLowerCase() : ''
        if (name === '') return false
        if (include.size > 0 && !include.has(name)) return false
        return !exclude.has(name)
      })
      return buildToolCatalog(schemas, { detail: config.catalogDetail })
    } catch (error) {
      note({ seat: 'reasoning-prefix', catalog: String(error?.message ?? error) })
      return ''
    }
  }
  const reasoningProviderProfile = (config) => ({
    displayName: 'DeepSeek（思考前缀）',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    api: 'openai-completions',
    baseURL: 'http://127.0.0.1:' + String(config.port) + '/beta/v1',
    compat: { supportsDeveloperRole: false },
    models: [{
      id: config.modelId,
      name: 'DeepSeek Flash（思考前缀）',
      contextWindow: 1000000,
      maxTokens: 384000,
      input: ['text', 'image'],
      reasoningEfforts: { off: 'none', low: 'low', medium: 'medium', high: 'high', max: 'max' },
    }],
  })
  const settingsOf = () => {
    try {
      return ctx.get('settings')
    } catch {
      return undefined
    }
  }
  const credentialsOf = () => {
    try {
      return ctx.get('credentials')
    } catch {
      return undefined
    }
  }
  /** 官方 key 是否就绪（只看有没有解析结果，绝不读取值）。 */
  const reasoningKeyReady = async () => {
    const credentials = credentialsOf()
    if (credentials === undefined || typeof credentials.resolve !== 'function') return undefined
    try {
      return (await credentials.resolve('DEEPSEEK_API_KEY')) !== undefined
    } catch {
      return false
    }
  }
  const reasoningFormOf = (settings) => {
    try {
      const forms = settings.describe() ?? {}
      const list = Array.isArray(forms) ? forms : Object.values(forms)
      const nameOf = (entry) => entry?.ns ?? entry?.id ?? entry?.entryId ?? entry?.key ?? ''
      const entry = list.find((item) => nameOf(item) === 'llm-pi-ai') ?? list.find((item) => String(nameOf(item)).includes('pi-ai'))
      if (entry === undefined) return { keys: list.map((item) => nameOf(item)) }
      const providers = entry.value?.providers ?? entry.form?.providers ?? entry.values?.providers ?? entry.config?.providers
      return {
        key: nameOf(entry),
        revision: entry.revision,
        providerIds: providers !== null && typeof providers === 'object' ? Object.keys(providers) : null,
      }
    } catch (error) {
      return { error: String(error?.message ?? error) }
    }
  }
  const upsertReasoningRoute = async () => {
    const settings = settingsOf()
    if (settings === undefined) return { ok: false, error: 'settings 服务不可用' }
    const config = reasoningConfigOf()
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const form = reasoningFormOf(settings)
      if (form.key === undefined) return { ok: false, error: '没有找到 llm-pi-ai 设置命名空间', keys: form.keys }
      try {
        await settings.update(form.key, { providers: { [config.providerId]: reasoningProviderProfile(config) } }, form.revision)
        return { ok: true, providerId: config.providerId, providerIds: reasoningFormOf(settings).providerIds }
      } catch (error) {
        if (attempt === 1) return { ok: false, error: String(error?.message ?? error) }
      }
    }
    return { ok: false, error: '路由写入重试后仍失败' }
  }
  const removeReasoningRoute = async () => {
    const settings = settingsOf()
    if (settings === undefined) return { ok: false, error: 'settings 服务不可用' }
    const config = reasoningConfigOf()
    const form = reasoningFormOf(settings)
    if (form.key === undefined) return { ok: false, error: '没有找到 llm-pi-ai 设置命名空间' }
    try {
      await settings.mutate(form.key, [{ op: 'unset', path: ['providers', config.providerId] }], form.revision)
      return { ok: true, providerIds: reasoningFormOf(settings).providerIds }
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) }
    }
  }
  /**
   * 连续失败计数：前缀轮被上游拒绝 / 回退透传达到阈值 ⇒ 自动关实验并记审计。
   * ⚠️ 代理侧现在把透传分成三态（skipped = 用户点了「清空本轮填装」、ignored = 本轮本就不该加前缀、
   * passthrough = 前缀被上游拒绝），只有最后一种该算失败 —— 否则跳过/未命中几次就会把实验自己关掉。
   */
  let reasoningFailures = 0
  const onReasoningOutcome = (outcome) => {
    const failed = outcome?.ok !== true || outcome.variant === 'passthrough'
    if (!failed) {
      reasoningFailures = 0
      return
    }
    reasoningFailures += 1
    // 连续失败阈值改为可调（状态里的 failureThreshold，默认 3）。
    const threshold = Number.isInteger(reasoningConfigOf().failureThreshold) ? reasoningConfigOf().failureThreshold : 3
    if (reasoningFailures < Math.max(1, threshold)) return
    reasoningFailures = 0
    note({ seat: 'reasoning-prefix', autoDisable: true, last: outcome })
    try {
      patchState({ ui: { reasoningPrefix: { ...reasoningConfigOf(), enabled: false } } })
    } catch (error) {
      note({ seat: 'reasoning-prefix', autoDisablePatch: String(error?.message ?? error) })
    }
    void applyReasoningState().catch((error) => note({ seat: 'reasoning-prefix', autoDisable: String(error?.message ?? error) }))
  }
  const ensureReasoningProxy = async () => {
    const config = reasoningConfigOf()
    if (!config.enabled) return null
    if (reasoningActive !== null && reasoningActive.port === config.port) return reasoningActive
    // 端口变了（或首次启动）：先把旧代理关掉，再按新端口起。
    if (reasoningActive !== null) await stopReasoningProxy()
    const proxy = createReasoningPrefixProxy({
      getConfig: () => {
        const current = reasoningConfigOf()
        // 「清空本轮填装」：整轮跳过前缀（多步工具轮也不加）；轮结束时由 turn-stopping 复位。
        const skipping = skipTurnSession !== '' && current.enabled
        return {
          enabled: skipping ? false : current.enabled,
          skipping,
          stripTools: true,
          textualize: current.textualize,
          shim: current.shim,
          match: current.match,
          catalogRole: current.catalogRole,
          catalogMode: current.catalogMode,
          catalogDetail: current.catalogDetail,
          catalogPosition: current.catalogPosition,
          fallbackOrder: current.fallbackOrder,
          allowPassthrough: current.allowPassthrough,
          maxEmittedCalls: current.maxEmittedCalls,
          reasoningPrefix: current.prefix,
          contentPrefix: current.contentPrefix,
          catalog: toolCatalogOf(),
          logging: current.logging,
        }
      },
      logger: {
        info: (message) => ctx.logger?.info?.(message),
        warn: (message) => ctx.logger?.warn?.(message),
      },
      onOutcome: onReasoningOutcome,
    })
    const active = { proxy, port: config.port }
    try {
      // listen 自带端口回退：46321 被别的实例 / 残留进程占住时会顺序向后找空位。
      active.port = await proxy.listen(config.port)
      reasoningProxyError = null
      reasoningActive = active
      if (active.port !== config.port) {
        // 实际端口和配置不一致 ⇒ 写回状态，保证路由 baseURL 跟着代理走（否则模型选择指向死端口）。
        note({ seat: 'reasoning-prefix', portFallback: { want: config.port, got: active.port } })
        try {
          patchState({ ui: { reasoningPrefix: { ...reasoningConfigOf(), port: active.port } } })
        } catch (error) {
          note({ seat: 'reasoning-prefix', portPersist: String(error?.message ?? error) })
        }
      }
      note({ seat: 'reasoning-prefix', listening: active.port })
    } catch (error) {
      reasoningProxyError = String(error?.message ?? error)
      note({ seat: 'reasoning-prefix', listen: reasoningProxyError })
      return null
    }
    return active
  }
  const stopReasoningProxy = async () => {
    if (reasoningActive === null) return
    const active = reasoningActive
    reasoningActive = null
    try {
      await active.proxy.close()
    } catch (error) {
      note({ seat: 'reasoning-prefix', close: String(error?.message ?? error) })
    }
  }
  /** 最近一次代理 / 路由写入的结果：面板据此显示「模型路由」状态，别再静默失败。 */
  const reasoningRouteState = { ok: null, error: null, at: null }
  const applyReasoningState = async () => {
    const config = reasoningConfigOf()
    if (!config.enabled) {
      const removed = await removeReasoningRoute()
      await stopReasoningProxy()
      reasoningProxyError = null
      reasoningRouteState.ok = removed.ok === true ? true : false
      reasoningRouteState.error = removed.ok === true ? null : String(removed.error ?? '')
      reasoningRouteState.at = Date.now()
      const applied = { ok: removed.ok !== false, enabled: false, ...removed }
      reasoningLastApply = applied
      return applied
    }
    const active = await ensureReasoningProxy()
    if (active === null) {
      // 代理都起不来就别写路由：写出去只会让「模型选择」指向死端口（这正是「选了没用」的来由）。
      await removeReasoningRoute()
      const applied = { ok: false, enabled: true, proxyRunning: false, port: config.port, error: reasoningProxyError ?? '代理未监听' }
      reasoningRouteState.ok = false
      reasoningRouteState.error = applied.error
      reasoningRouteState.at = Date.now()
      reasoningLastApply = applied
      return applied
    }
    const route = await upsertReasoningRoute()
    reasoningRouteState.ok = route.ok === true
    reasoningRouteState.error = route.ok === true ? null : String(route.error ?? '')
    reasoningRouteState.at = Date.now()
    const applied = { ok: route.ok === true, enabled: true, proxyRunning: true, port: active.port, ...route }
    reasoningLastApply = applied
    return applied
  }
  /** 面板用的模型路由快照：写没写、在不在 llm-pi-ai 配置里、指向哪个端口。 */
  const reasoningRouteOf = (settings) => {
    const config = reasoningConfigOf()
    const profile = reasoningProviderProfile(config)
    const form = settings === undefined ? undefined : reasoningFormOf(settings)
    const providerIds = Array.isArray(form?.providerIds) ? form.providerIds : null
    return {
      ok: reasoningRouteState.ok,
      error: reasoningRouteState.error,
      at: reasoningRouteState.at,
      providerId: config.providerId,
      modelId: config.modelId,
      displayName: profile.displayName,
      modelName: profile.models[0]?.name ?? '',
      port: config.port,
      baseURL: 'http://127.0.0.1:' + String(config.port) + '/beta/v1',
      inConfig: providerIds === null ? null : providerIds.includes(config.providerId),
    }
  }

  // 启动时按已保存的实验状态自启（settings/credentials 尚未就绪也没关系，enable 路由会再试一次）。
  setTimeout(() => {
    void applyReasoningState().catch((error) => note({ seat: 'reasoning-prefix', apply: String(error?.message ?? error) }))
  }, 1000)

  // 启动后空闲预热「每会话最后轮数」：把写状态时的冷读（大日志解压 1s+）挪到启动空闲期。
  // sidecar 已命中的会话几乎零成本；只跑一轮，失败不影响任何功能。
  const warmLastTurnTimer = setTimeout(() => {
    try {
      preheatLastTurnCache()
    } catch {
      // 尽力而为。
    }
  }, 5000)
  warmLastTurnTimer.unref?.()

  // ── 座位 1（主）：根级 agent/pre-step，agent 直接来自 payload ──
  // 顺带维护"轮是否开着"，供轮次规则判断（见 reprimeAll）。
  ctx.on(
    'agent/pre-step',
    async (payload, next) => {
      if (typeof payload?.agent?.id === 'string') openTurn.add(payload.agent.id)
      // 前缀日志：每轮第一步记一条（面板逐轮微调用；日志里也标出这轮是否被「清空填装」跳过）。
      if (Number(payload?.step) === 1 && typeof payload?.agent?.id === 'string') {
        try {
          recordPrefixTurn(payload.agent.id, payload?.turn)
        } catch (error) {
          note({ seat: 'reasoning-prefix', logTurn: String(error?.message ?? error) })
        }
      }
      const decision = await next()
      // 工具清单「注入一次」（catalogMode=history）：工具集不变就不重复注入，变了/被压缩掉才补。
      try {
        await ensureCatalogInjected(payload, decision)
      } catch (error) {
        note({ seat: 'reasoning-prefix', catalog: 'inject-failed', error: String(error?.message ?? error) })
      }
      return handle(payload, decision, 'root')
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
    // 轮结束：把「最后轮数」+ 当时日志 stat 写进 sidecar（下次写状态不用再解压这份日志）。
    // 这里只尽力而为：日志可能还在追加导致 mtime/size 之后变化，校验失效只会多读一次，不会给错轮数。
    if (event?.type === 'turn/end' && typeof session?.id === 'string') {
      try {
        const turn = Number(event?.data?.turn)
        const file = sessionLogFile(session.id)
        if (Number.isFinite(turn) && file !== undefined) recordLastTurn(session.id, turn, statSync(file))
      } catch {
        // 落盘时序 / 日志缺失都不影响功能。
      }
    }
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
    // 轮结束：这一轮若被「清空填装」跳过，到此为止（下一轮恢复正常）。
    if (skipTurnSession === id) {
      skipTurnSession = ''
      skipTurnNumber = 0
    }
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

    // ── 思考前缀实验路由：status / enable / disable（旧 spike 路径保留为别名）──
    const reasoningStatus = async () => {
      const config = reasoningConfigOf()
      const catalog = toolCatalogOf()
      const settings = settingsOf()
      return {
        ok: true,
        enabled: config.enabled,
        proxyRunning: reasoningActive !== null,
        proxyError: reasoningProxyError,
        port: reasoningActive !== null ? reasoningActive.port : config.port,
        config: { prefix: config.prefix, contentPrefix: config.contentPrefix, providerId: config.providerId, modelId: config.modelId, shim: config.shim, textualize: config.textualize, catalogRole: config.catalogRole },
        catalog: { bytes: catalog.length, tools: (catalog.match(/^- /gm) ?? []).length },
        hasSettings: settings !== undefined,
        hasApiKey: await reasoningKeyReady(),
        failures: reasoningFailures,
        route: reasoningRouteOf(settings),
        applied: reasoningLastApply,
        audit: reasoningActive !== null ? (reasoningActive.proxy.audit?.() ?? []).slice(-10) : [],
        ...(settings === undefined ? {} : { form: reasoningFormOf(settings) }),
      }
    }
    const reasoningEnable = async (request) => {
      let body = {}
      try {
        body = (await request?.json?.()) ?? {}
      } catch {
        body = {}
      }
      if (!experimentalOn()) {
        // 实验性功能总开关没开：不允许启用（关闭时启动流程也会删路由）。
        return Response.json({ ok: false, enabled: false, error: '实验性功能未开启：先在左侧页实验区打开总开关。' }, noStore)
      }
      const current = reasoningConfigOf()
      const next = {
        enabled: true,
        prefix: typeof body.prefix === 'string' ? body.prefix : current.prefix,
        contentPrefix: typeof body.contentPrefix === 'string' ? body.contentPrefix : current.contentPrefix,
        port: Number.isInteger(body.port) && body.port > 0 ? body.port : current.port,
        providerId: typeof body.providerId === 'string' && body.providerId !== '' ? body.providerId : current.providerId,
        modelId: typeof body.modelId === 'string' && body.modelId !== '' ? body.modelId : current.modelId,
        match: current.match,
        shim: current.shim,
        textualize: current.textualize,
        catalogRole: typeof body.catalogRole === 'string' && body.catalogRole === 'user' ? 'user' : current.catalogRole,
        catalogMode: current.catalogMode,
        catalogDetail: current.catalogDetail,
        catalogPosition: current.catalogPosition,
        fallbackOrder: current.fallbackOrder,
        allowPassthrough: current.allowPassthrough,
        catalogInclude: current.catalogInclude,
        catalogExclude: current.catalogExclude,
        logging: current.logging,
        maxEmittedCalls: current.maxEmittedCalls,
        failureThreshold: current.failureThreshold,
      }
      patchState({ ui: { reasoningPrefix: next } })
      const applied = await applyReasoningState()
      return Response.json({ ...await reasoningStatus(), applied }, noStore)
    }
    const reasoningDisable = async () => {
      patchState({ ui: { reasoningPrefix: { ...reasoningConfigOf(), enabled: false } } })
      const applied = await applyReasoningState()
      return Response.json({ ...reasoningStatus(), applied }, noStore)
    }

    // ── 实验面板（胶囊弹窗里的「实验」页）：总开关 + 累计统计 + 暴露参数 ──
    const readJsonBody = async (request) => {
      try {
        return (await request?.json?.()) ?? {}
      } catch {
        return {}
      }
    }
    /** 面板可写的参数（也是状态里的真相）；实验性功能关着时全部不可用。 */
    const experimentalKnobsOf = () => {
      const config = reasoningConfigOf()
      return {
        experimental: config.experimental,
        port: config.port,
        prefix: config.prefix,
        contentPrefix: config.contentPrefix,
        providerId: config.providerId,
        modelId: config.modelId,
        shim: config.shim,
        textualize: config.textualize,
        catalogRole: config.catalogRole,
        catalogMode: config.catalogMode,
        catalogDetail: config.catalogDetail,
        catalogPosition: config.catalogPosition,
        match: config.match,
        maxEmittedCalls: config.maxEmittedCalls,
        failureThreshold: config.failureThreshold,
        fallbackOrder: config.fallbackOrder,
        allowPassthrough: config.allowPassthrough,
        catalogInclude: config.catalogInclude,
        catalogExclude: config.catalogExclude,
        loggingEnabled: config.logging.enabled,
        loggingFile: config.logging.file,
        loggingDump: String(config.logging.dumpFile ?? '') !== '',
        loggingRaw: String(config.logging.rawFile ?? '') !== '',
        loggingContent: String(config.logging.contentFile ?? '') !== '',
      }
    }
    /** P0：代理 JSONL 日志状态（开关 / 路径 / 是否已落盘 / 文件大小）。 */
    const proxyLoggingStatus = () => {
      const config = reasoningConfigOf()
      const file = config.logging.file
      let exists = false
      let bytes = 0
      try {
        const stat = statSync(file)
        exists = true
        bytes = stat.size
      } catch {
        // 还没写过
      }
      return {
        enabled: config.logging.enabled,
        file,
        exists,
        bytes,
        dumpFile: config.logging.dumpFile,
        rawFile: config.logging.rawFile,
        contentFile: config.logging.contentFile,
      }
    }
    /** @param {{ sessionId?: string }} [scope] 面板会把当前会话带进来：日志 / 跳过状态按会话给。 */
    const experimentalStatus = async (scope = {}) => {
      const sessionId = typeof scope.sessionId === 'string' ? scope.sessionId : ''
      const config = reasoningConfigOf()
      const route = reasoningRouteOf(settingsOf())
      const log = sessionId === '' ? prefixLog.slice(-30) : prefixLog.filter((entry) => entry.sessionId === sessionId).slice(-30)
      return {
        ok: true,
        experimental: experimentalOn(),
        knobs: experimentalKnobsOf(),
        // 代理没起来时没有统计数据（不是 0，是「没有」）。
        stats: reasoningActive !== null ? (reasoningActive.proxy.stats?.() ?? null) : null,
        reasoning: await reasoningStatus(),
        presets: readState()?.reasoningPrefixPresets ?? [],
        // P0：前缀轮计数（total 不受环形上限影响）与代理日志状态（开关 / 路径 / 是否已落盘 / 大小）。
        turns: { total: prefixTurnTotal, session: log.length },
        logging: proxyLoggingStatus(),
        log,
        // 「填装」状态：这轮到底加不加前缀（跳过按钮 / 已排队跳过）。
        prefill: {
          enabled: config.enabled,
          proxyRunning: reasoningActive !== null,
          routeOk: route.ok === true && route.inConfig === true,
          skipQueued: prefixSkipQueued.has(sessionId),
          skipping: skipTurnSession === sessionId && skipTurnSession !== '',
          ready: config.enabled && reasoningActive !== null && route.ok === true && route.inConfig === true && !(skipTurnSession === sessionId && skipTurnSession !== ''),
        },
      }
    }
    const experimentalToggle = async (request) => {
      const body = await readJsonBody(request)
      const on = body.on === true
      const raw = readState()?.ui?.reasoningPrefix
      const rawConfig = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
      // 关总开关 ⇒ 顺带停用实验（否则代理继续跑，和「关掉就不可用」不一致）。
      patchState({ ui: { experimental: on, ...(on ? {} : { reasoningPrefix: { ...rawConfig, enabled: false } }) } })
      const applied = await applyReasoningState()
      return Response.json({ ...(await experimentalStatus()), applied }, noStore)
    }
    const experimentalConfig = async (request) => {
      const body = await readJsonBody(request)
      if (!experimentalOn()) return Response.json({ ok: false, error: '实验性功能未开启：先在左侧页实验区打开总开关。' }, noStore)
      const raw = readState()?.ui?.reasoningPrefix
      const base = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
      const patch = {}
      const isInt = (value, min, max) => Number.isInteger(value) && value >= min && value <= max
      const reject = (message) => Response.json({ ok: false, error: message }, noStore)
      if (body.port !== undefined) {
        if (!isInt(body.port, 1, 65535)) return reject('端口要 1..65535 的整数')
        patch.port = body.port
      }
      if (body.enabled !== undefined) {
        if (typeof body.enabled !== 'boolean') return reject('enabled 要是布尔值')
        patch.enabled = body.enabled
      }
      if (body.prefix !== undefined) {
        if (typeof body.prefix !== 'string') return reject('前缀要是字符串')
        patch.prefix = body.prefix.slice(0, 2000)
      }
      if (body.contentPrefix !== undefined) {
        if (typeof body.contentPrefix !== 'string') return reject('内容前缀要是字符串')
        patch.contentPrefix = body.contentPrefix.slice(0, 2000)
      }
      if (body.providerId !== undefined) {
        if (typeof body.providerId !== 'string' || !/^[a-z0-9-]+$/.test(body.providerId)) return reject('模型路由名只能是小写字母/数字/短横线')
        patch.providerId = body.providerId
      }
      if (body.modelId !== undefined) {
        if (typeof body.modelId !== 'string' || body.modelId === '' || body.modelId.length > 200) return reject('模型 id 要 1..200 字符')
        patch.modelId = body.modelId
      }
      if (body.match !== undefined) {
        if (typeof body.match !== 'string') return reject('触发标记要是字符串')
        patch.match = body.match
      }
      if (body.shim !== undefined) {
        if (typeof body.shim !== 'boolean') return reject('shim 要是布尔值')
        patch.shim = body.shim
      }
      if (body.textualize !== undefined) {
        if (typeof body.textualize !== 'boolean') return reject('textualize 要是布尔值')
        patch.textualize = body.textualize
      }
      if (body.catalogRole !== undefined) {
        if (body.catalogRole !== 'system' && body.catalogRole !== 'user') return reject('清单伪装只支持 system / user')
        patch.catalogRole = body.catalogRole
      }
      if (body.catalogMode !== undefined) {
        if (body.catalogMode !== 'each' && body.catalogMode !== 'history') return reject('清单注入方式只支持 each / history')
        patch.catalogMode = body.catalogMode
      }
      if (body.catalogDetail !== undefined) {
        if (!['full', 'brief', 'names'].includes(body.catalogDetail)) return reject('清单详略只支持 full / brief / names')
        patch.catalogDetail = body.catalogDetail
      }
      if (body.catalogPosition !== undefined) {
        if (body.catalogPosition !== 'head' && body.catalogPosition !== 'tail') return reject('清单位置只支持 head / tail')
        patch.catalogPosition = body.catalogPosition
      }
      if (body.fallbackOrder !== undefined) {
        if (!['', 'system-first', 'user-first'].includes(body.fallbackOrder)) return reject('回退顺序只支持 默认 / system-first / user-first')
        patch.fallbackOrder = body.fallbackOrder === 'system-first' || body.fallbackOrder === 'user-first' ? body.fallbackOrder : ''
      }
      if (body.allowPassthrough !== undefined) {
        if (typeof body.allowPassthrough !== 'boolean') return reject('允许透传要是布尔值')
        patch.allowPassthrough = body.allowPassthrough
      }
      const nameList = (value) => {
        if (!Array.isArray(value)) return null
        return value.filter((item) => typeof item === 'string' && item.trim() !== '').map((item) => item.trim().slice(0, 80)).slice(0, 60)
      }
      if (body.catalogInclude !== undefined) {
        const include = nameList(body.catalogInclude)
        if (include === null) return reject('清单包含要是字符串数组')
        patch.catalogInclude = include
      }
      if (body.catalogExclude !== undefined) {
        const exclude = nameList(body.catalogExclude)
        if (exclude === null) return reject('清单排除要是字符串数组')
        patch.catalogExclude = exclude
      }
      if (body.loggingEnabled !== undefined || body.loggingFile !== undefined || body.loggingDump !== undefined || body.loggingRaw !== undefined || body.loggingContent !== undefined) {
        const logging = { ...(base.logging !== null && typeof base.logging === 'object' ? base.logging : {}) }
        if (body.loggingEnabled !== undefined) {
          if (typeof body.loggingEnabled !== 'boolean') return reject('日志开关要是布尔值')
          logging.enabled = body.loggingEnabled
        }
        if (body.loggingFile !== undefined) {
          if (typeof body.loggingFile !== 'string' || body.loggingFile.trim() === '') return reject('日志路径要是非空字符串')
          logging.file = body.loggingFile.trim().slice(0, 300)
        }
        // 调试三件套：勾选 = 写默认路径（<数据目录>/proxy-*.log），取消 = 清掉该字段。
        for (const [field, key, suffix] of [
          ['loggingDump', 'dumpFile', 'proxy-dump.jsonl'],
          ['loggingRaw', 'rawFile', 'proxy-raw.log'],
          ['loggingContent', 'contentFile', 'proxy-content.jsonl'],
        ]) {
          if (body[field] === undefined) continue
          if (typeof body[field] !== 'boolean') return reject(field + ' 要是布尔值')
          if (body[field] === true) logging[key] = join(DATA_DIR, suffix)
          else delete logging[key]
        }
        patch.logging = logging
      }
      if (body.maxEmittedCalls !== undefined) {
        if (!isInt(body.maxEmittedCalls, 1, 32)) return reject('一次最多工具调用要 1..32 的整数')
        patch.maxEmittedCalls = body.maxEmittedCalls
      }
      if (body.failureThreshold !== undefined) {
        if (!isInt(body.failureThreshold, 1, 10)) return reject('连续失败阈值要 1..10 的整数')
        patch.failureThreshold = body.failureThreshold
      }
      if (Object.keys(patch).length === 0) return reject('没有可写字段')
      patchState({ ui: { reasoningPrefix: { ...base, ...patch } } })
      const applied = await applyReasoningState()
      return Response.json({ ...(await experimentalStatus()), applied }, noStore)
    }
    /** 上游连通性测试：TLS 握手 + HEAD，不碰 key、不发业务请求。 */
    const experimentalPing = async () => {
      const upstream = String(process.env.DSH_PREFILL_UPSTREAM ?? 'https://api.deepseek.com/beta').replace(/\/+$/, '')
      let host = ''
      try {
        host = new URL(upstream).hostname
      } catch {
        host = ''
      }
      const started = Date.now()
      if (host === '') return Response.json({ ok: false, error: 'upstream 不是合法 URL', ms: 0 }, noStore)
      try {
        await new Promise((resolve, reject) => {
          const request = https.request({ host, port: 443, method: 'HEAD', path: '/', timeout: 5000 }, (response) => {
            response.resume()
            resolve()
          })
          request.on('timeout', () => request.destroy(new Error('timeout')))
          request.on('error', reject)
          request.end()
        })
        return Response.json({ ok: true, host, ms: Date.now() - started }, noStore)
      } catch (error) {
        return Response.json({ ok: false, host, error: String(error?.message ?? error), ms: Date.now() - started }, noStore)
      }
    }
    /** P0：导出前缀日志 + 审计 + 统计为 JSONL（面板下载，或直接 curl）。 */
    const experimentalExport = async (request) => {
      const body = await readJsonBody(request)
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
      const lines = []
      for (const entry of prefixLog) {
        if (sessionId === '' || entry.sessionId === sessionId) lines.push(JSON.stringify({ kind: 'prefix', ...entry }))
      }
      const audit = reasoningActive !== null ? (reasoningActive.proxy.audit?.() ?? []) : []
      for (const entry of audit) lines.push(JSON.stringify({ kind: 'audit', ...entry }))
      const stats = reasoningActive !== null ? (reasoningActive.proxy.stats?.() ?? null) : null
      if (stats !== null) lines.push(JSON.stringify({ kind: 'stats', stats }))
      return new Response(lines.join('\n') + '\n', {
        headers: {
          'content-type': 'application/x-ndjson; charset=utf-8',
          'cache-control': 'no-store',
          'content-disposition': 'attachment; filename="prefill-prefix-log.jsonl"',
        },
      })
    }
    const experimentalStatsReset = async (request) => {
      reasoningActive?.proxy?.resetStats?.()
      const body = await readJsonBody(request)
      return Response.json(await experimentalStatus({ sessionId: body.sessionId }), noStore)
    }
    /** 前缀预设（独立预设）：list / save / delete / apply。 */
    const experimentalPresets = async (request) => {
      const body = await readJsonBody(request)
      if (!experimentalOn()) return Response.json({ ok: false, error: '实验性功能未开启：先在左侧页实验区打开总开关。' }, noStore)
      const op = typeof body.op === 'string' ? body.op : 'list'
      const list = readState()?.reasoningPrefixPresets ?? []
      const reply = async () => Response.json({ ...(await experimentalStatus({ sessionId: body.sessionId })), presets: readState()?.reasoningPrefixPresets ?? [] }, noStore)
      if (op === 'list') return reply()
      if (op === 'save') {
        const name = typeof body.name === 'string' ? body.name.trim().slice(0, 60) : ''
        if (name === '') return Response.json({ ok: false, error: '预设名不能为空' }, noStore)
        const entry = {
          name,
          prefix: typeof body.prefix === 'string' ? body.prefix.slice(0, 2000) : '',
          contentPrefix: typeof body.contentPrefix === 'string' ? body.contentPrefix.slice(0, 2000) : '',
          ...(typeof body.match === 'string' && body.match !== '' ? { match: body.match.slice(0, 200) } : {}),
        }
        const next = [...list.filter((item) => item.name !== name), entry].slice(-30)
        patchState({ reasoningPrefixPresets: next })
        return reply()
      }
      if (op === 'delete') {
        const name = typeof body.name === 'string' ? body.name : ''
        patchState({ reasoningPrefixPresets: list.filter((item) => item.name !== name) })
        return reply()
      }
      if (op === 'apply') {
        const name = typeof body.name === 'string' ? body.name : ''
        const entry = list.find((item) => item.name === name)
        if (entry === undefined) return Response.json({ ok: false, error: '找不到这个前缀预设' }, noStore)
        const raw = readState()?.ui?.reasoningPrefix
        const base = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
        patchState({
          ui: {
            reasoningPrefix: {
              ...base,
              prefix: entry.prefix,
              contentPrefix: entry.contentPrefix,
              ...(typeof entry.match === 'string' && entry.match !== '' ? { match: entry.match } : {}),
            },
          },
        })
        const applied = await applyReasoningState()
        return Response.json({ ...(await experimentalStatus({ sessionId: body.sessionId })), applied }, noStore)
      }
      // P1：前缀预设导出 / 导入（导出给面板下载 JSON；导入接受同结构数组，同名覆盖）。
      if (op === 'export') return Response.json({ ok: true, presets: list }, noStore)
      if (op === 'import') {
        const incoming = Array.isArray(body.presets) ? sanitizePrefixPresets(body.presets) : []
        if (incoming.length === 0) return Response.json({ ok: false, error: '导入内容里没有可用的前缀预设' }, noStore)
        const merged = [...list.filter((item) => !incoming.some((preset) => preset.name === item.name)), ...incoming].slice(-30)
        patchState({ reasoningPrefixPresets: merged })
        return reply()
      }
      return Response.json({ ok: false, error: '未知操作：' + op }, noStore)
    }
    /** 「清空本轮填装」：排队让下一轮整轮跳过前缀（日志里标 skipped）。 */
    const experimentalSkip = async (request) => {
      const body = await readJsonBody(request)
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
      const on = body.on !== false
      if (sessionId === '') return Response.json({ ok: false, error: '缺少会话 id' }, noStore)
      if (on) prefixSkipQueued.add(sessionId)
      else prefixSkipQueued.delete(sessionId)
      return Response.json(await experimentalStatus({ sessionId }), noStore)
    }
    register({
      path: '/api/dsh-prefill/reasoning/repair',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async () => Response.json({ ...(await reasoningStatus()), applied: await applyReasoningState() }, noStore),
    }, 'dsh-prefill: reasoning repair')
    register({ path: '/api/dsh-prefill/reasoning/status', methods: ['POST'], requestBody: 'buffered', fetch: async () => Response.json(await reasoningStatus(), noStore) }, 'dsh-prefill: reasoning status')
    register({ path: '/api/dsh-prefill/reasoning/enable', methods: ['POST'], requestBody: 'buffered', fetch: reasoningEnable }, 'dsh-prefill: reasoning enable')
    register({ path: '/api/dsh-prefill/reasoning/disable', methods: ['POST'], requestBody: 'buffered', fetch: reasoningDisable }, 'dsh-prefill: reasoning disable')
    register({ path: '/api/dsh-prefill/reasoning-spike/status', methods: ['POST'], requestBody: 'buffered', fetch: async () => Response.json(reasoningStatus(), noStore) }, 'dsh-prefill: reasoning status (spike alias)')
    register({ path: '/api/dsh-prefill/reasoning-spike/upsert', methods: ['POST'], requestBody: 'buffered', fetch: reasoningEnable }, 'dsh-prefill: reasoning enable (spike alias)')
    register({ path: '/api/dsh-prefill/reasoning-spike/remove', methods: ['POST'], requestBody: 'buffered', fetch: reasoningDisable }, 'dsh-prefill: reasoning disable (spike alias)')
    // 实验面板（胶囊弹窗）：状态 / 总开关 / 参数 / 统计清零。
    register({
      path: '/api/dsh-prefill/experimental/status',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const body = await readJsonBody(request)
        return Response.json(await experimentalStatus({ sessionId: body.sessionId }), noStore)
      },
    }, 'dsh-prefill: experimental status')
    register({ path: '/api/dsh-prefill/experimental/toggle', methods: ['POST'], requestBody: 'buffered', fetch: experimentalToggle }, 'dsh-prefill: experimental toggle')
    register({ path: '/api/dsh-prefill/experimental/config', methods: ['POST'], requestBody: 'buffered', fetch: experimentalConfig }, 'dsh-prefill: experimental config')
    register({ path: '/api/dsh-prefill/experimental/stats/reset', methods: ['POST'], requestBody: 'buffered', fetch: experimentalStatsReset }, 'dsh-prefill: experimental stats reset')
    register({ path: '/api/dsh-prefill/experimental/presets', methods: ['POST'], requestBody: 'buffered', fetch: experimentalPresets }, 'dsh-prefill: experimental presets')
    register({ path: '/api/dsh-prefill/experimental/skip', methods: ['POST'], requestBody: 'buffered', fetch: experimentalSkip }, 'dsh-prefill: experimental skip')
    register({ path: '/api/dsh-prefill/experimental/ping', methods: ['POST'], requestBody: 'buffered', fetch: experimentalPing }, 'dsh-prefill: experimental ping')
    register({ path: '/api/dsh-prefill/experimental/export', methods: ['POST'], requestBody: 'buffered', fetch: experimentalExport }, 'dsh-prefill: experimental export')
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
        // 正在跑（流式输出中）的会话：面板据此在卡片根节点标 data-prefill-busy="stream"，自动提示攒到回合结束再播。
        running: [...liveAgents].filter(([, agent]) => isRunning(agent)).map(([id]) => id),
        // 每会话 inbox 里还挂着（没被领取）的手动注入条数：变少了 = 刚发出去（面板回合结束后提示一下，P1-9）。
        manualInbox: Object.fromEntries([...liveAgents].map(([id, agent]) => [id, pendingInInbox(agent).length])),
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

    /**
     * 轻量摘要（规划 §2.1）：只给**目标会话**那几格 + 最小全局字段，序列化 < 10 KB。
     * 常驻轮询（芯片 / 纯净芯片 / 顶栏徽标）只拉它，不再拉整份 envelope —— 本机实测整份响应
     * 1.28 MB × 3 个轮询 = 空闲 30 s 50 MB decoded，正是要消灭的那条。
     *
     * 刻意**不**调的东西（都会把整份 state 拖进来）：
     *   · `withLegacyView(state)` 的整份结果（只取 gate 那一格）；
     *   · `sandboxViewsFor(state)`（按会话 × 包 × 条目算全量视图 —— 这里只算目标会话一格）；
     *   · `...envelope()`（state / snapshots / injections / audit / manualInbox / diagnostics 全是大字段）。
     *
     * 形状（客户端 store 直接消费，扁平、键名稳定）：
     *   { ok, rev, sessionId,
     *     prefill, gate, activePreset, armed, levers, locked, turns, materialized,
     *     pendingReprime, running, sandbox, tools, persona, overridesPersona,
     *     snapshots, noticeSeen, ui }
     * 按会话的表：给了 sessionId 就只含该会话（缺失的格不出现）；没给 sessionId ⇒ 空对象
     * （armed / pendingReprime / running / turns / materialized 这类全局表照给全）。
     *
     * @param {string} rawSessionId 目标会话；空 = 全局摘要
     */
    const summaryOf = (rawSessionId) => {
      const sessionId = typeof rawSessionId === 'string' ? rawSessionId : ''
      const rev = stateRevision()
      // 先读（读的过程才可能发现文件坏了），再看错误标记。readState 自己吞异常回默认状态，
      // 所以这里必须显式回 ok:false —— 否则面板把「读不到」显示成「什么都没配」，用户会以为配置丢了。
      const state = readState()
      if (stateReadError !== '') return { ok: false, rev, sessionId, reason: `state unreadable: ${stateReadError}` }
      const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
      /** 按会话的表只挑目标会话那一格（没给 sessionId / 没这一格 ⇒ 空对象）。 */
      const cell = (map) => (sessionId !== '' && isObject(map) && map[sessionId] !== undefined ? { [sessionId]: map[sessionId] } : {})
      /** 全局 id 列表：给了 sessionId 就只留它和通配 '*'（'*' 是本会话的默认格）；没给就照给全。 */
      const listOf = (ids) => (Array.isArray(ids) ? ids.filter((id) => typeof id === 'string' && (sessionId === '' || id === sessionId || id === '*')) : [])
      // 派生视图：applyEnabled 按 state 对象缓存（WeakMap），命中后几乎是白拿；它带出 legacy 旧字段（含 gate）。
      const legacy = applyEnabled(state)
      const snapshotsAll = typeof gateCache.module?.snapshots === 'function' ? gateCache.module.snapshots() : {}
      const materializedAll = typeof gateCache.module?.materialized === 'function' ? gateCache.module.materialized() : {}
      const turnsAll = Object.fromEntries(Object.entries(snapshotsAll).map(([id, snap]) => [id, snap?.turn ?? 0]))
      const toolsAll = typeof gateCache.module?.tools === 'function' ? gateCache.module.tools(rootCtxRef) : { catalog: [], sessions: {} }
      // 沙盒：只算目标会话一格。有 blocked（本会话正在拦的条数）才需要 gate 的三张观察表；算不出来就只给档位。
      const sandbox = (() => {
        if (sessionId === '') return {}
        const table = isObject(state?.sandbox) ? state.sandbox : {}
        const own = typeof table[sessionId]?.level === 'string'
        const global = typeof table['*']?.level === 'string'
        let level = own ? table[sessionId].level : global ? table['*'].level : 'observe'
        let levelFrom = own ? 'session' : global ? 'global' : 'default'
        let blocked = 0
        try {
          const view = sandboxView(legacy, sessionId, {
            injections: typeof gateCache.module?.injections === 'function' ? gateCache.module.injections(rootCtxRef) : {},
            tools: toolsAll,
            audit: typeof gateCache.module?.auditSnapshot === 'function' ? gateCache.module.auditSnapshot() : {},
          })
          if (typeof view?.level === 'string') level = view.level
          if (typeof view?.levelFrom === 'string') levelFrom = view.levelFrom
          blocked = Number(view?.blocked) || 0
        } catch (error) {
          note({ seat: 'summary-route', sandbox: 'view-failed', error: String(error?.message ?? error) })
        }
        return { [sessionId]: { level, levelFrom, blocked } }
      })()
      // 人格段（overrides[会话].sections['prefill:persona'] 非空）：顶栏徽标/芯片用它区分「接管」与「纯净」。
      // ⚠️ 必须读 `legacy`（applyEnabled → withLegacyView）而不是 `state`：0.16 起 overrides 已被做成
      // 规则表（state.sandbox[会话].rules）的兼容镜像，state 上根本没有 overrides 这个键。
      const personaOn = (() => {
        if (sessionId === '') return false
        const text = isObject(legacy?.overrides) && isObject(legacy.overrides[sessionId]) ? legacy.overrides[sessionId].sections?.['prefill:persona'] : undefined
        return typeof text === 'string' && text.trim() !== ''
      })()
      return {
        ok: true,
        rev,
        sessionId,
        // 旧版「本会话在用预填装」的表（值：'default' 等标签；客户端只看有没有字符串）。
        prefill: cell(state?.prefill),
        // 闸门模式：'pure'（严格档 / 纯净 / 接管）| 'replace'（替换系统提示）；'pass' 省略 = 默认不改。
        gate: (() => {
          const mode = sessionId !== '' && isObject(legacy?.gate) ? legacy.gate[sessionId] : undefined
          return typeof mode === 'string' && mode !== '' && mode !== 'pass' ? { [sessionId]: mode } : {}
        })(),
        activePreset: cell(state?.activePreset),
        armed: listOf(state?.armed),
        levers: Object.fromEntries(Object.keys(DEFAULT_LEVERS).map((key) => [key, isObject(state?.levers) && state.levers[key] === true])),
        // 首轮锁定记录（**原记录**：客户端 lockView 要 turn / items / legacy / preset 是否存在）。
        locked: cell(state?.locked),
        turns: sessionId === '' ? turnsAll : cell(turnsAll),
        materialized: cell(materializedAll),
        pendingReprime: listOf([...pendingReprime]),
        running: listOf([...liveAgents].filter(([, agent]) => isRunning(agent)).map(([id]) => id)),
        sandbox,
        // 该会话装配到的工具数（客户端显示「工具 N」；没装配过就不出现）。
        tools: sessionId !== '' && Array.isArray(toolsAll?.sessions?.[sessionId]) ? { [sessionId]: toolsAll.sessions[sessionId].length } : {},
        // 人格段是否非空（扁平映射；只在该会话有内容时出现）。
        persona: personaOn ? { [sessionId]: true } : {},
        // §2.1 契约里的旧名，保留为 persona 的别名（客户端 store 用 persona，旧消费方读 overridesPersona）。
        overridesPersona: personaOn ? { [sessionId]: true } : {},
        // Q9 角标：本轮生效的三态 / 被丢弃的 kind（4 个字段够客户端画角标，seenKinds/texts 等大字段一律不传）。
        snapshots: (() => {
          if (sessionId === '') return {}
          const snap = snapshotsAll[sessionId]
          if (!isObject(snap)) return {}
          return {
            [sessionId]: {
              state: typeof snap.state === 'string' ? snap.state : null,
              turn: Number(snap.turn) || 0,
              step: Number(snap.step) || 0,
              droppedKinds: Array.isArray(snap.droppedKinds) ? snap.droppedKinds.filter((kind) => typeof kind === 'string').slice(0, 12) : [],
            },
          }
        })(),
        // 纯净模式首次说明看没看过（全局标量）。
        noticeSeen: state?.noticeSeen === true,
        // 全局偏好：motion 给 null = 跟随系统（客户端 setMotionPref 认这个）；experimental 只在开时为 true。
        ui: {
          experimental: isObject(state?.ui) && state.ui.experimental === true,
          motion: isObject(state?.ui) && typeof state.ui.motion === 'string' ? state.ui.motion : null,
        },
      }
    }

    scope.effect(
      () =>
        register({
          path: SUMMARY_ROUTE,
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
            try {
              // 只读：绝不 patchState / reprimeAll（首轮锁定和迁移由闸门负责，轮询路由不该写盘）。
              return Response.json(summaryOf(sessionId), noStore)
            } catch (error) {
              note({ seat: 'summary-route', error: String(error?.message ?? error) })
              return Response.json({ ok: false, rev: stateRevision(), sessionId, reason: String(error?.message ?? error) }, noStore)
            }
          },
        }),
      'dsh-prefill: summary route',
    )

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
            // 写状态这一路要落盘 + 重挂 + 预热，任何一步抛都不该把 reject 冒到宿主（那是 500，
            // 面板只看到「网络错误」）。包一层：失败回 `{ ok:false, reason }` 并记一笔。
            // `sessionId` 只当路由提示（决定回哪份 summary），**不进 state**：状态里有未知会话级 map 才是有意义的键。
            const summarySession = (() => {
              if (patch !== null && typeof patch === 'object' && typeof patch.sessionId === 'string') {
                const sid = patch.sessionId
                delete patch.sessionId
                return sid
              }
              return typeof patch?.restoreOpening === 'string' ? patch.restoreOpening : ''
            })()
            try {
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
              // 写成功后顺手附上当前会话的 summary（客户端 applySummaryWrite 直接喂 store，省一次往返，规划 §2.2）。
              const summary = (() => {
                try {
                  return summaryOf(summarySession)
                } catch (error) {
                  note({ seat: 'state-route', summary: 'failed', error: String(error?.message ?? error) })
                  return undefined
                }
              })()
              return Response.json(
                { ...envelope(), ...(restored !== undefined ? { restored } : {}), ...(summary === undefined ? {} : { summary }) },
                noStore,
              )
            } catch (error) {
              note({ seat: 'state-route', error: String(error?.message ?? error) })
              return Response.json({ ok: false, rev: stateRevision(), reason: String(error?.message ?? error) }, noStore)
            }
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
            // 整个 op 分支包一层：读包 / 写盘 / 加载闸门任何一步抛，都不该把 reject 冒到宿主（500）。
            try {
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
                // 写盘失败只记 note + reason，不抛（内存里的列表照旧用于本次响应）。
                if (!writePacks(workspace, packs)) reason = 'packs write failed'
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
                // **只回 {ok, op, status}**：这里以前带 ...envelope()（整份 state 1 MB 级），而这个接口
                // 是卡片打开时每 4 s 一次的常驻轮询 —— 客户端只读 data.status，别的字段纯属白烧带宽。
                const gate = await loadGate()
                const status =
                  typeof gate?.everyTurnStatus === 'function'
                    ? gate.everyTurnStatus(applyEnabled(readState()), sessionId, sessionEvents(liveAgents.get(sessionId), sessionId))
                    : { enabled: false }
                return Response.json({ ok: true, op, status }, noStore)
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
                  if (!writePacks(workspace, packs)) reason = 'packs write failed'
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
              // 写 / 列表成功都附上当前会话的 summary（客户端 applySummaryWrite 直接喂 store，规划 §2.2）。
              const summary = (() => {
                try {
                  return summaryOf(sessionId)
                } catch (error) {
                  note({ seat: 'packs-route', summary: 'failed', error: String(error?.message ?? error) })
                  return undefined
                }
              })()
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
                  ...(summary === undefined ? {} : { summary }),
                  ...envelope(),
                },
                noStore,
              )
            } catch (error) {
              // 读包 / 写盘 / 加载闸门任何一步抛：回 ok:false 而不是让宿主 500（面板至少能看到原因）。
              note({ seat: 'packs-route', op, error: String(error?.message ?? error) })
              return Response.json({ ok: false, op, reason: String(error?.message ?? error), file }, noStore)
            }
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
