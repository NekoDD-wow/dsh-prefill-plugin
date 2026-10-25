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
import { zstdDecompressSync } from 'node:zlib'
import { builtinPreset, builtinSummaries, everyTurnPresets } from './builtin-presets.js'
import { historyToItems, turnRange } from './session-history.js'
import { CHECK_IDS, autoParams, modeOf, splitTurns } from './inject-auto.js'
import { applyEnabled, sanitizeEnabled } from './enabled.js'
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
/** 预填装包的读写入口（M4）。 */
const PACKS_ROUTE = '/api/dsh-prefill/packs'
/** 本会话逐轮用量（输入 / 缓存命中 / 输出 + 系统提示规模），给面板的「用量与缓存」卡片。 */
const USAGE_ROUTE = '/api/dsh-prefill/usage'
/** 角色卡（角色扮演扩展，v0.6）：按工作区存取 + 编译。不改动上面任何一条路由。 */
const CARDS_ROUTE = '/api/dsh-prefill/cards'
/** 故事记忆（角色卡三期）：op = get | set | clear，按会话。 */
const MEMORY_ROUTE = '/api/dsh-prefill/memory'

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

function normalizeState(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const levers = source.levers !== null && typeof source.levers === 'object' ? source.levers : {}
  return {
    // 先摊开原始对象：**保留未知字段**。M2 的按会话闸门映射 `gate`、
    // Q9 的 `noticeSeen` 都靠这一行才不至于被规范化抹掉（否则 UI 写进去就没了）。
    ...source,
    version: 2,
    armed: Array.isArray(source.armed) ? source.armed.filter((id) => typeof id === 'string') : [],
    levers: Object.fromEntries(Object.keys(DEFAULT_LEVERS).map((key) => [key, levers[key] === true])),
    allowKinds: Array.isArray(source.allowKinds)
      ? source.allowKinds.filter((kind) => typeof kind === 'string')
      : [...DEFAULT_ALLOW_KINDS],
  }
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
  cache = { state, mtimeMs }
  return state
}

function writeState(next) {
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(STATE_FILE, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  cache = { state: null, mtimeMs: -1 }
  return readState()
}

function patchState(patch) {
  const current = readState()
  return writeState(
    normalizeState({
      ...current,
      ...patch,
      levers: { ...current.levers, ...(patch?.levers ?? {}) },
    }),
  )
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
  const text = typeof raw.text === 'string' ? raw.text : ''
  const firstText = typeof raw.firstText === 'string' ? raw.firstText : ''
  if (raw.enabled !== true || (text.trim() === '' && firstText.trim() === '')) return undefined
  const untilTurn = Math.max(0, Math.floor(Number(raw.untilTurn) || 0))
  const checks = Array.isArray(raw.checks) ? CHECK_IDS.filter((id) => raw.checks.includes(id)) : []
  let mode = modeOf({ ...raw, untilTurn })
  if (mode === 'auto' && checks.length === 0) mode = untilTurn > 0 ? 'until' : 'always'
  const { warmup, streak, probation } = autoParams(raw.auto)
  return { enabled: true, text, firstText, mode, untilTurn, checks, auto: { warmup, streak, probation } }
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
  // -1 = 面板上的「不要开场白」（compileCard 认负数），不能被夹成 0（= 第一句开场白）。
  if (Number.isFinite(Number(src.greeting))) opts.greeting = Math.max(-1, Math.floor(Number(src.greeting)))
  for (const key of ['userName', 'tools']) if (typeof src[key] === 'string') opts[key] = src[key].slice(0, 500)
  return { id, opts }
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
    let since
    if (restart) {
      since = lastOf(key) + 1
      delete auto.override
    } else {
      since = Number(old?.since) || 0
      const wanted = entry.auto?.override
      if (wanted?.action === 'resume' || wanted?.action === 'pause') {
        auto.override = Number.isFinite(Number(wanted.atTurn)) && wanted.atTurn !== null ? wanted : { action: wanted.action, atTurn: lastOf(key) + 1 }
      } else if (old?.auto?.override !== undefined) auto.override = old.auto.override
      else delete auto.override
    }
    out[key] = { ...entry, since, auto }
  }
  return out
}

/** 选择器需要的轻量摘要（不把 items 全丢给下拉框）。 */
function packSummaries(packs) {
  return packs.map((pack) => ({
    name: pack.name,
    count: Array.isArray(pack.items) ? pack.items.length : 0,
    updatedAt: pack.updatedAt ?? null,
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
  } catch {
    return []
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
    const next = await gate.step({ readState, note, latches, unlatch, rootCtx: rootCtxRef, memory: memoryStore }, { ...payload, __seat: seat }, decision)
    return next ?? decision
  } catch (error) {
    note({ seat, error: String(error?.message ?? error) })
    return decision
  }
}

export function apply(ctx) {
  rootCtxRef = ctx
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
  const api = () => ({ readState, note, latches, unlatch, rootCtx: rootCtxRef })

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
    const envelope = () => {
      const snapshots = typeof gateCache.module?.snapshots === 'function' ? gateCache.module.snapshots() : {}
      const state = readState()
      const injects = state?.injects !== null && typeof state?.injects === 'object' ? state.injects : {}
      return {
        ok: true,
        plugin: '@local/dsh-prefill',
        stage: STAGE,
        gateStage: gateCache.module?.STAGE ?? null,
        stateFile: STATE_FILE,
        state,
        drafts: typeof gateCache.module?.draftIds === 'function' ? gateCache.module.draftIds() : [],
        // Q9 角标：每会话最近一轮的生效快照（三态 + 被丢弃的 kind）。
        snapshots,
        // 每会话"已跑到第几轮"：面板据此自动切换「写入历史」/「每轮注入」两种模式。
        turns: Object.fromEntries(Object.entries(snapshots).map(([id, snap]) => [id, snap?.turn ?? 0])),
        // 每会话"每轮注入"的条目数（模式 B；0 表示没配）。
        injects: Object.fromEntries(Object.entries(injects).map(([id, items]) => [id, Array.isArray(items) ? items.length : 0])),
        // Q17：可改的注入清单 = **预置 catalog**（全局 prompt 层的真实注册名）+ 每会话已发现的条目。
        // 有 catalog，用户就能在某条注入还没出现过时先写好改写（"直接劫持"）。
        injections: typeof gateCache.module?.injections === 'function' ? gateCache.module.injections(rootCtxRef) : {},
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
            if (patch !== null && typeof patch === 'object' && Object.keys(patch).length > 0) {
              if (patch.everyTurn !== null && typeof patch.everyTurn === 'object') {
                const previous = readState()?.everyTurn ?? {}
                // 只有要盖章的那格才去读会话（读落盘日志要解压，别对每个旧会话都读一遍）。
                const lastTurnFor = (key) => lastTurnOf(sessionEvents(liveAgents.get(key), key))
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
            return Response.json(envelope(), noStore)
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

            const upsert = (name, items, overrides, tools, gate, extra = {}) => {
              // 预设 = 预填装内容 + 注入改写 + **工具放行**（§4-M5：换包=换权限）。
              const pack = {
                name,
                updatedAt: new Date().toISOString(),
                items,
                ...(overrides === undefined ? {} : { overrides }),
                ...(tools === undefined ? {} : { tools }),
                ...(gate === 'pure' || gate === 'pass' || gate === 'replace' ? { gate } : {}),
                ...(extra.everyTurn === undefined ? {} : { everyTurn: extra.everyTurn }),
                ...(extra.memorySeed === undefined ? {} : { memorySeed: extra.memorySeed }),
                ...(extra.card === undefined ? {} : { card: extra.card }),
                // 左栏启用开关（v0.10）：只存关掉的项；全开 = 不存。
                ...(extra.enabled === undefined ? {} : { enabled: extra.enabled }),
                // 工作区说明（AGENTS.md / CLAUDE.md）：只存模式 + 改写正文，从不存文件原文；原样 = 不存。
                ...(extra.workspaceInstructions === undefined ? {} : { workspaceInstructions: extra.workspaceInstructions }),
              }
              const at = packs.findIndex((entry) => entry.name === name)
              if (at >= 0) packs[at] = pack
              else packs = [...packs, pack]
              writePacks(workspace, packs)
            }

            if (op === 'list') {
              // 无操作，直接回列表。
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
              const result = historyToItems(sessionEvents(liveAgents.get(sessionId), sessionId), {
                reasoning: body?.reasoning === true,
                fromTurn: range.from,
                toTurn: range.to,
              })
              // 本会话的每轮注入配置（只认本会话自己那格，不认 '*'）和故事记忆摘要，给「带上……」两个复选框。
              const everyTurn = sanitizeEveryTurn(readState()?.everyTurn?.[sessionId]) ?? null
              const stored = memoryStore.read(sessionId)
              const memory = typeof stored?.text === 'string' && stored.text.trim() !== '' ? { text: stored.text.trim(), throughTurn: Number(stored.throughTurn) || 0 } : null
              const toTurn = range.to
              // 截了轮次、而摘要覆盖到截取末轮 M 之后 ⇒ 不许带（摘要里有分支点之后的剧情）。
              const memoryAllowed = memory !== null && (toTurn === 0 || memory.throughTurn <= toTurn)
              note({ seat: 'packs-route', op, sessionId, items: result.items.length, turnCount: result.turnCount, lastTurn: result.lastTurn, toolCalls: result.toolCalls, everyTurn: everyTurn?.mode ?? null, memory: memory?.throughTurn ?? null, memoryAllowed })
              return Response.json({ ok: true, op, ...result, fromTurn: range.from, toTurn: range.to, everyTurn, memory, memoryAllowed, ...envelope() }, noStore)
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
              const items = sanitizeItems(body?.items)
              const overrides = sanitizeOverrides(body?.overrides)
              const tools = sanitizeTools(body?.tools)
              const everyTurn = sanitizeEveryTurn(body?.everyTurn)
              const memorySeed = sanitizeMemorySeed(body?.memorySeed)
              const cut = Number(body?.toTurn) > 0 ? Math.floor(Number(body.toTurn)) : 0
              if (name === '') reason = 'missing name'
              else if (items === undefined) reason = 'invalid items[]'
              else if (memorySeed !== undefined && cut > 0 && memorySeed.throughTurn > cut) reason = 'memory summary covers turns after the cut'
              else upsert(name, items, overrides, tools, body?.gate, { everyTurn, memorySeed, card: sanitizeCardRef(body?.card), enabled: sanitizeEnabled(body?.enabled), workspaceInstructions: sanitizeWorkspaceInstructions(body?.workspaceInstructions) })
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
                const items = sanitizeItems(parsed?.items ?? parsed)
                const overrides = sanitizeOverrides(parsed?.overrides)
                const tools = sanitizeTools(parsed?.tools)
                const raw = parsed?.name ?? body?.name
                const name = typeof raw === 'string' ? raw.trim() : ''
                if (items === undefined || name === '') reason = 'import needs { name, items[] }'
                else upsert(name, items, overrides, tools, parsed?.gate, { everyTurn: sanitizeEveryTurn(parsed?.everyTurn), memorySeed: sanitizeMemorySeed(parsed?.memorySeed), card: sanitizeCardRef(parsed?.card), enabled: sanitizeEnabled(parsed?.enabled), workspaceInstructions: sanitizeWorkspaceInstructions(parsed?.workspaceInstructions) })
              }
            } else {
              reason = `unknown op "${op}"`
            }

            note({ seat: 'packs-route', op, sessionId, workspace: workspace ?? '(global)', count: packs.length, reason })
            return Response.json(
              { ok: true, op, packs: packSummaries(packs), builtins: builtinSummaries(), everyTurnPresets: everyTurnPresets(), file, reason, ...envelope() },
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
