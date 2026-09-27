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

import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 壳的代次。核的代次由 gate.js 自己决定，通过诊断暴露。 */
const STAGE = 'M1.2-shell'

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
    const next = await gate.step({ readState, note, latches, unlatch, rootCtx: rootCtxRef }, { ...payload, __seat: seat }, decision)
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
              patchState(patch)
              // 【关键】写状态后当场重新挂载：让"点完开关再发"在该轮装配之前就位。
              await reprimeAll('state-write')
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

            const upsert = (name, items, overrides) => {
              // 预设 = 预填装内容 + 注入改写（用户要求绑在一起）。
              const pack = {
                name,
                updatedAt: new Date().toISOString(),
                items,
                ...(overrides === undefined ? {} : { overrides }),
              }
              const at = packs.findIndex((entry) => entry.name === name)
              if (at >= 0) packs[at] = pack
              else packs = [...packs, pack]
              writePacks(workspace, packs)
            }

            if (op === 'list') {
              // 无操作，直接回列表。
            } else if (op === 'get') {
              const name = typeof body?.name === 'string' ? body.name : ''
              const found = packs.find((entry) => entry.name === name)
              note({ seat: 'packs-route', op, name, hit: found !== undefined })
              return Response.json({ ok: true, op, name, pack: found ?? null, file, ...envelope() }, noStore)
            } else if (op === 'save') {
              const name = typeof body?.name === 'string' ? body.name.trim() : ''
              const items = sanitizeItems(body?.items)
              const overrides = sanitizeOverrides(body?.overrides)
              if (name === '') reason = 'missing name'
              else if (items === undefined) reason = 'invalid items[]'
              else upsert(name, items, overrides)
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
                const raw = parsed?.name ?? body?.name
                const name = typeof raw === 'string' ? raw.trim() : ''
                if (items === undefined || name === '') reason = 'import needs { name, items[] }'
                else upsert(name, items, overrides)
              }
            } else {
              reason = `unknown op "${op}"`
            }

            note({ seat: 'packs-route', op, sessionId, workspace: workspace ?? '(global)', count: packs.length, reason })
            return Response.json(
              { ok: true, op, packs: packSummaries(packs), file, reason, ...envelope() },
              noStore,
            )
          },
        }),
      'dsh-prefill: packs route',
    )

    ctx.logger?.info?.(`dsh-prefill: host half applied (${STAGE}), state at ${STATE_FILE}`)
  })
}
