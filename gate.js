/**
 * @local/dsh-prefill —— 热插拔闸门内核（M1.1）。
 *
 * 这个文件是**可热换**的：壳（`impl.js`）在每次 `agent/pre-step` 时按本文件的
 * mtime 带 `?rev=` 动态 import，所以改这里**不需要重启 dsh**。
 * ——只改闸门逻辑（四通道怎么挂、消息怎么过滤）时改这里；改壳本身才需要重启。
 *
 * 契约：`export function step(api, payload, decision)`，返回 PreStepDecision。
 *   api = { readState, note, latches, unlatch, rootCtx }
 *   payload.agent / payload.turn / payload.step 来自事件契约（实测携带）
 *
 * ── M1.0 的教训（为什么 M1.1 要这么写）──────────────────────────────────────
 * M1.0 把闸门只挂在 `agent/created → agent.ctx.on('agent/pre-step')` 上，结果
 * **静默失效**：探针没进 system/message、tools 没变、零报错。原因是代码里每个
 * 失败分支都「悄悄 return」，无法定位。M1.1 因此强制：
 *   ① agent 取自 `payload.agent`（不依赖 agent/created 是否送达）；
 *   ② 服务解析列出三级回退，并把最终命中哪一级写进诊断；
 *   ③ 每个分支都必须留一条 note()。
 *
 * @module @local/dsh-prefill/gate
 */

import { randomUUID } from 'node:crypto'

/** 内核代次：壳会在诊断里回报它，用来确认热换是否生效。 */
export const STAGE = 'M1.1-gate+p1'

/** 探针内容：一眼可辨、且带自有命名空间。 */
export const PROBE_SECTION_TEXT =
  '[prefill:probe-section] M1 探针段：这条文本由 @local/dsh-prefill 注册，用于证明 sections 通道「能写」。'
export const PROBE_CONTEXT_TEXT =
  '[prefill:probe-context] M1 探针上下文：由 @local/dsh-prefill 注册，用于证明 contexts 通道「能写」。'

/** 一条消息是否放行：自有 prefill:* 与用户原话恒放行，其余按 allowKinds。 */
function keeper(state, message) {
  const kind = message?.source?.kind
  if (kind === 'user') return true
  if (typeof kind !== 'string') return false
  if (kind.startsWith('prefill:')) return true
  return state.allowKinds.includes(kind)
}

/**
 * Q17：取该会话的注入改写配置。
 *
 * 形状（存在 state.json 顶层 `overrides`，由 UI / 脚本写）：
 * ```jsonc
 * "overrides": {
 *   "session-xxx": {
 *     "messages": { "runtime-context": "改写后的正文" },   // 按 source.kind 改写消息内容
 *     "sections": { "harness:identity": "改写后的段" },     // 同名遮蔽（scoped 覆盖 global）
 *     "contexts": { "some:context": "改写后的上下文" },
 *     "sectionOrders": { "harness:identity": -1000 }        // 可选：保住原来的排序落点
 *   },
 *   "*": { ... }                                            // 通配，探针用
 * }
 * ```
 * 「仅在单个会话生效」由 key 就是会话 id 保证；`*` 只是给无头探针省事。
 */
function overridesFor(state, agentId) {
  const all = state?.overrides
  if (all === null || typeof all !== 'object') return undefined
  const exact = typeof agentId === 'string' ? all[agentId] : undefined
  const entry = exact !== undefined && exact !== null && typeof exact === 'object' ? exact : all['*']
  return entry !== undefined && entry !== null && typeof entry === 'object' ? entry : undefined
}

/**
 * 每会话**最近一次装配**的名字清单（Q17 的"注入内容改写"UI 要用它列出可改的段/上下文）。
 * 挂 globalThis Symbol 以穿过内核热换。
 */
const ASSEMBLIES = (globalThis[Symbol.for('dsh-prefill.assemblies')] ??= new Map())

/** 每会话**最近一轮**的闸门快照（Q9 角标）。挂 globalThis Symbol 以穿过内核热换。 */
const SNAPSHOTS = (globalThis[Symbol.for('dsh-prefill.snapshots')] ??= new Map())

/**
 * 由**本轮冻结的** lever 集合推出三态（规划 §3.5）：
 *   pure   = 四通道全关（闸门 ON）
 *   filter = 只开了消息过滤（白名单生效）
 *   pass   = 什么都没关（全放行）
 */
function gateStateOf(levers) {
  if (levers.blockSections && levers.blockContexts && levers.blockTools && levers.blockMessages) return 'pure'
  if (levers.blockMessages) return 'filter'
  return 'pass'
}

/** 读全部会话快照（UI / 诊断出口）。 */
export function snapshots() {
  return Object.fromEntries(SNAPSHOTS)
}

/**
 * **不提供改写**的注入名：工具类（含 MCP 这类工具来源）。
 *
 * 理由（用户定）：工具相关的段被改掉，模型就失去了"有哪些工具、怎么用"的说明，
 * 工具实际等于失效 ⇒ 直接忽略，不列进清单、也不应用。
 * 前缀匹配即可（`tool-*` / `tools*` / `mcp*`）。
 */
const IGNORED_INJECTION = /^(tool|tools|mcp)/i

/** 这个名字能不能改。 */
export function isEditableInjection(name) {
  return typeof name === 'string' && name !== '' && !IGNORED_INJECTION.test(name)
}

/** 消息类注入的常见来源（**预置清单**：即使某条还没出现过，也能先写好改写）。 */
const KNOWN_MESSAGE_KINDS = [
  'runtime-context',
  'skill-catalog',
  'agent-instructions',
  'time-context',
  'session-reference',
  'tmux-context',
  'model-notice',
  'compact-checkpoint',
]

/** 取全局 prompt 层（段 / 上下文 / 变量的真实注册名都在这里）。 */
function globalPromptLayer(rootCtx) {
  try {
    const service = typeof rootCtx?.get === 'function' ? rootCtx.get('systemPrompt') : rootCtx?.systemPrompt
    return service?.layers?.global
  } catch {
    return undefined
  }
}

/** NamedEntries → 名字数组（拿不到就空）。 */
function entryNames(entries) {
  if (entries === null || entries === undefined) return []
  try {
    if (typeof entries.keys === 'function') return [...entries.keys()]
    if (typeof entries.entries === 'function') return [...entries.entries()].map(([name]) => name)
  } catch {
    // 取不到就算了。
  }
  return []
}

/**
 * 覆盖某个全局段 / 上下文时，尽量**沿用它原本的 order**。
 * 否则 scoped 注册会用自己的 order（默认 1000），把这段挪到列表末尾 ——
 * 实测踩到：改写 `harness:identity`（order -1000）后，它跑到了 persona 后面，首段不再是它。
 */
function globalOrderOf(rootCtx, entriesKey, name) {
  const layer = globalPromptLayer(rootCtx)
  const entries = layer?.[entriesKey]
  if (entries === undefined || entries === null || typeof entries.entries !== 'function') return undefined
  try {
    for (const [key, value] of entries.entries()) {
      if (key === name && Number.isFinite(value?.order)) return value.order
    }
  } catch {
    // 拿不到就用默认值。
  }
  return undefined
}

/**
 * Q17 的"可改注入"清单：`{ catalog, sessions }`。
 *
 *   catalog —— **预置清单**：消息 kind 用已知常见值；段 / 上下文取全局 prompt 层的
 *              **真实注册名**。有它，用户就能在"某条注入还没出现过"时先写好改写
 *              ⇒ 这就是"直接劫持"，不必等会话先被干扰一轮。
 *   sessions —— 每个会话**已发现**的条目（最近一轮实际进入的 kind；最近一次装配的段 / 上下文名）。
 */
export function injections(rootCtx) {
  const layer = globalPromptLayer(rootCtx)
  const keep = (names) => (names ?? []).filter((name) => isEditableInjection(name))
  const catalog = {
    messages: keep(KNOWN_MESSAGE_KINDS),
    sections: keep(entryNames(layer?.sections).sort()),
    contexts: keep(entryNames(layer?.contexts).sort()),
    // 被忽略的名字一并回给 UI，好让它说明"为什么少了几个"。
    ignored: [...entryNames(layer?.sections), ...entryNames(layer?.contexts), ...KNOWN_MESSAGE_KINDS].filter(
      (name) => !isEditableInjection(name),
    ),
  }

  const sessions = {}
  for (const [id, snap] of SNAPSHOTS) {
    sessions[id] = {
      messages: keep(snap.seenKinds),
      sections: [],
      contexts: [],
      tools: 0,
    }
  }
  for (const [id, assembly] of ASSEMBLIES) {
    sessions[id] = {
      messages: sessions[id]?.messages ?? [],
      sections: keep(assembly.sections),
      contexts: keep(assembly.contexts),
      tools: assembly.tools,
    }
  }
  return { catalog, sessions }
}

/** 记录本轮快照。 */
function recordSnapshot(agentId, entry) {
  if (typeof agentId !== 'string') return
  SNAPSHOTS.set(agentId, { ...entry, at: Date.now() })
}

/**
 * 解析服务：显式三级回退，并记录命中哪一级。
 * `agent.ctx` 属性 → `agent.ctx.get()` → 插件根 ctx。
 */
function resolveServices(agent, rootCtx) {
  const scope = agent?.ctx
  const pick = (key) => {
    // ⚠️ 顺序至关重要：**先 `get()`**。Cordis 对属性访问有守卫——没在 inject 里
    // 声明就写 `ctx.systemPrompt` 会抛 "cannot get property X without inject"。
    // 上一版把属性访问放在第一位，异常被 mountLevers 的 try/catch 吞掉 ⇒
    // mounted:0、静默什么都不挂（5ec1c8fd 就是这么整条失效的，而 4868f6d1 恰好
    // 允许属性访问所以看起来正常——同一份代码两个行为，排查了很久）。
    if (typeof scope?.get === 'function') {
      try {
        const value = scope.get(key)
        if (value !== undefined) return { service: value, via: `agent.ctx.get(${key})` }
      } catch {
        // 落到下面的属性访问再试。
      }
    }
    try {
      if (scope?.[key] !== undefined) return { service: scope[key], via: `agent.ctx.${key}` }
    } catch {
      // 守卫拦下，继续兜底。
    }
    const fallback = typeof rootCtx?.get === 'function' ? rootCtx.get(key) : rootCtx?.[key]
    if (fallback !== undefined) return { service: fallback, via: `root.get(${key})` }
    return { service: undefined, via: 'none' }
  }
  return { systemPrompt: pick('systemPrompt'), tools: pick('tools') }
}

/**
 * M2：把「按会话三态闸门」折算成"这个 agent **这一轮**的有效状态"。
 *
 * 这样做的好处是**其余代码一行都不用改** —— step() 后面所有逻辑读的都是
 * `state.armed` / `state.levers` / `state.allowKinds`，这里把 gate 映射翻译成
 * 同样的形状即可。新增的 `gate` 字段由 UI 通过自有路由写入 state.json；
 * M1 的 `armed` + 全局 `levers` 保持原样，专供探针脚本使用，两者并存不冲突。
 *
 * @param state - 规范化后的原始状态。
 * @param agentId - 本轮 agent 的 SessionId。
 */
function effectiveStateFor(state, agentId) {
  const gate = state.gate !== null && typeof state.gate === 'object' ? state.gate : {}
  if (typeof agentId !== 'string' || gate[agentId] !== 'pure') return state
  return {
    ...state,
    armed: state.armed.includes(agentId) ? state.armed : [...state.armed, agentId],
    levers: {
      probeSection: false,
      probeContext: false,
      blockSections: true,
      blockContexts: true,
      blockTools: true,
      blockMessages: true,
    },
  }
}

/**
 * 线上级 tools 阻断器：**每 agent 只注册一次**，装配时按实时状态决定是否清空。
 *
 * 为什么不能 per-turn 注册 + disposer 撤销：
 *   实测 turn 6（blockTools=false 的一轮）`request/header.tools = 0` —— turn 5 挂上去
 *   的 assemble 监听器**没被撤干净**（撤销时机与装配时机竞态）。改成"注册一次、
 *   装配时查状态"后，"撤"变成无需发生的动作，竞态从根上消失。
 *
 * 为什么需要它（restrict 不够）：
 *   `dsh-tools/lib/index.js:2944-2955` 明写 "A restriction filters what a scope
 *   INHERITS … and never what its OWN layer registers."；本部署的模型可见工具恰好
 *   全注册在 agent 本层 —— 实测 restrict 一个都挡不住（43 个原样出厂）。
 *   官方 `pure-preset` 也因此额外加了同一条腿（规划 §2.2 第 ④ 条腿）。
 *
 * ⚠️ practices P2 不鼓励监听 assemble（会绕过其它插件的贡献）；这里只清 tools、
 *    且只在"该 agent 在册 且 闸门 ON"时生效，属"够用的最弱机制都不够"之后的兜底。
 *
 * 注册表挂在 globalThis 的 Symbol 上：内核是热插拔的，普通模块级变量会在热换时
 * 清空，造成重复注册、旧监听器永久残留。
 */
const BLOCKERS = (globalThis[Symbol.for('dsh-prefill.tools-blockers')] ??= new Map())

/**
 * 挂在**插件根 ctx**（无标签监听器 ⇒ 必然收到每一次 `system-prompt/assemble` 派发），
 * 再按**本次派发的 scope**判断：该 agent 在册且 `blockTools` 开 ⇒ 清空 tools。
 *
 * 为什么不能挂在 `agent.ctx` 上：实测 round C 里，同一个监听器在**我的自检装配**中
 * 生效（tools:0），在**循环真正那次装配**中却没生效（`request/header.tools=2`）——
 * 两次调用的 scope 键不是同一个对象（自检传 `payload.agent`，循环传 ReactLoopAgent）。
 * 挂根 ctx 把"作用域过滤"这件事从注册期推迟到派发期，用 `context.scope` 自己判，
 * 作用域键是谁就不再重要。
 *
 * 被它清掉的正是 `restrict` 永远挡不住的那部分：agent **本层**注册的工具
 * （`dsh-tools:2946-2949` 点名委派运行时就是往子层注册的）——实测残留
 * `subagent` / `list_subagent_models` 两个。
 */
function ensureToolsBlocker(api) {
  const rootCtx = api.rootCtx
  if (rootCtx === undefined || rootCtx === null || typeof rootCtx.on !== 'function') return
  if (BLOCKERS.has('root')) return
  const dispose = rootCtx.on(
    'system-prompt/assemble',
    async (assembly, context, next) => {
      const result = await next()
      const id = context?.scope?.id ?? context?.agent?.id
      // Q17：顺手记下这次装配里有哪些段 / 上下文（UI 靠它列出"可改的注入"）。
      if (typeof id === 'string') {
        ASSEMBLIES.set(id, {
          sections: (result?.sections ?? []).map((section) => section.name),
          contexts: (result?.contexts ?? []).map((entry) => entry.name),
          tools: (result?.tools ?? []).length,
          at: Date.now(),
        })
      }
      // 用**本轮冻结的** lever，而不是实时状态：否则轮内翻开关会让线上装配
      // 与"挂载的 lever"不一致（半轮移除、半轮恢复）。
      const frozen = typeof id === 'string' ? api.latches.get(id)?.frozenLevers : undefined
      const hit = frozen?.blockTools === true
      api.note({ blocker: 'system-prompt/assemble', id: typeof id === 'string' ? id : '(none)', frozen: frozen !== undefined, hit })
      if (!hit) return result
      return { ...result, tools: [] }
    },
    { prepend: true },
  )
  if (typeof dispose === 'function') BLOCKERS.set('root', dispose)
}

/** 把状态解析成该 agent 这一轮该挂的 lever 集合。 */
function mountLevers(agent, state, api, sink) {
  const rootCtx = api.rootCtx
  const { systemPrompt, tools } = resolveServices(agent, rootCtx)
  const sp = systemPrompt.service
  const toolService = tools.service
  // ⚠️ disposer 数组由**调用方**传入并持有：mountLevers 中途抛错时，已经成功注册
  // 的那些必须仍可被下一轮 unlatch 清掉。上一版把数组留在函数内部，一旦第 2 条注册
  // 抛错，第 1 条注册的 disposer 就随函数栈一起丢了 ⇒ 段永久残留 ⇒ 之后每轮同名注册
  // 都抛 "already registered in this scope" ⇒ 该会话的挂载链**永久死掉**（实测 turn 9）。
  const disposers = sink ?? []
  const push = (disposer) => {
    if (typeof disposer === 'function') disposers.push(disposer)
  }

  if (state.levers.probeSection && typeof sp?.section === 'function') {
    push(sp.section({ name: 'prefill:probe-section', order: 1000, text: PROBE_SECTION_TEXT }))
  }
  // ── 一次判定作用域的对照探针 ─────────────────────────────────────────────
  // 同一个文本，**同时**在 agent 作用域（上面那段）与**插件根 ctx**各注册一段，
  // 名字不同。线上 system/message 里出现哪个名字，就说明哪条路真的进了循环的装配链。
  // 背景：round C 的 2e268144 上 agent 作用域生效、5ec1c8fd 上却不生效，必须定论。
  if (state.levers.probeSection && typeof rootCtx?.systemPrompt?.section === 'function') {
    push(
      rootCtx.systemPrompt.section({
        name: 'prefill:root-section',
        order: 1001,
        text: `${PROBE_SECTION_TEXT} [ROOT-SCOPE]`,
      }),
    )
  }
  // ── Q17：段 / 上下文的"同名遮蔽"先算出来（下面的"拦注入"要用它）────────────
  // 官方机制（`dsh-system-prompt` 的 `ScopedLayers.merge`）：**同名的 scoped 项覆盖
  // global 项**。所以只要在 agent scope 里用同名注册一段，就等价于"改写"了全局那段 ——
  // 不需要、也不允许去动 `system-prompt/assemble`（practices P2）。
  const overrides = overridesFor(state, agent?.id)
  const overrideSectionNames = Object.keys(overrides?.sections ?? {})
  const overrideContextNames = Object.keys(overrides?.contexts ?? {})

  // ── 拦注入 = **只拦"非本插件"的注入**（用户定的语义）───────────────────────
  // 旧实现是一条 `complete:true` 的空中段；它的语义是"整份段列表替换成我自己这一条"
  // （`dsh-system-prompt:335-359`）⇒ **连带把本插件的改写也清掉了**。
  // 实测：PURE 下 `system chars=0`、`runtime-context` 的改写消息被丢 —— 也就是
  // "开着拦注入时，改写静默失效"。现在改成**逐名清空 harness 自己的段**，
  // 留下我们要改写的那几条。
  if (state.levers.blockSections && typeof sp?.section === 'function') {
    if (overrideSectionNames.length === 0) {
      // 没有我方改写：沿用"一条清空"（保证 0 字符，也不怕漏名字）。
      push(sp.section({ name: 'prefill:pure', order: 0, text: '', complete: true }))
    } else {
      const known = new Set([
        ...entryNames(globalPromptLayer(rootCtx)?.sections),
        ...(ASSEMBLIES.get(agent?.id)?.sections ?? []),
      ])
      for (const name of known) {
        // 我方要改写的那条留着（下面会用同名遮蔽装上改写文本）。
        if (overrideSectionNames.includes(name)) continue
        push(sp.section({ name, order: globalOrderOf(rootCtx, 'sections', name) ?? 1000, text: '' }))
      }
    }
  }
  if (state.levers.probeContext && typeof sp?.context === 'function') {
    push(sp.context({ name: 'prefill:probe-context', order: 1000, text: PROBE_CONTEXT_TEXT }))
  }
  // 有上下文改写时不整体 suppress：否则会连我方那条一起丢。
  // 另外：如果用户**改写了 `runtime-context` 这条消息**，也要取消整体抑制 ——
  // `suppressRuntimeContext` 是在装配层把它抹掉，抹掉之后 pre-step 根本见不到它，
  // 改写就永远无从下手（实测：`overrode:[]`、消息整条消失）。
  // 用户的意思很清楚："这条我自己发我的版本"，那就别在源头把它删了。
  const messageOverrideKinds = Object.keys(overrides?.messages ?? {})
  if (
    state.levers.blockContexts &&
    overrideContextNames.length === 0 &&
    !messageOverrideKinds.includes('runtime-context') &&
    typeof sp?.suppressRuntimeContext === 'function'
  ) {
    push(sp.suppressRuntimeContext())
  }
  if (state.levers.blockTools && typeof toolService?.restrict === 'function') {
    push(toolService.restrict({ allow: [] }))
  }

  // ── Q17：段 / 上下文改写的挂载（同名遮蔽）──────────────────────────────────
  if (overrides !== undefined) {
    const orders = overrides.sectionOrders !== null && typeof overrides.sectionOrders === 'object' ? overrides.sectionOrders : {}
    // 工具类注入一律不应用（防御性第二道：清单里已经不列了）。
    const ignoredOverrides = []
    if (overrides.sections !== null && typeof overrides.sections === 'object' && typeof sp?.section === 'function') {
      for (const [name, text] of Object.entries(overrides.sections)) {
        if (!isEditableInjection(name)) {
          ignoredOverrides.push(name)
          continue
        }
        // 优先显式给的 order，其次沿用全局那段的原 order，最后才默认 1000。
        const order = Number.isFinite(orders[name]) ? orders[name] : (globalOrderOf(rootCtx, 'sections', name) ?? 1000)
        push(sp.section({ name, order, text: String(text) }))
      }
    }
    if (overrides.contexts !== null && typeof overrides.contexts === 'object' && typeof sp?.context === 'function') {
      for (const [name, text] of Object.entries(overrides.contexts)) {
        if (!isEditableInjection(name)) {
          ignoredOverrides.push(name)
          continue
        }
        const order = Number.isFinite(orders[name]) ? orders[name] : (globalOrderOf(rootCtx, 'contexts', name) ?? 1000)
        push(sp.context({ name, order, text: String(text) }))
      }
    }
    if (ignoredOverrides.length > 0) api.note({ overrides_ignored: ignoredOverrides, id: agent?.id })
  }

  ensureToolsBlocker(api)

  return {
    disposers,
    ui: {
      systemPromptVia: systemPrompt.via,
      toolsVia: tools.via,
      scopeIsAgentCtx: agent?.ctx !== undefined,
      hasSection: typeof sp?.section === 'function',
      hasContext: typeof sp?.context === 'function',
      hasSuppress: typeof sp?.suppressRuntimeContext === 'function',
      hasRestrict: typeof toolService?.restrict === 'function',
    },
  }
}

/**
 * 【急切挂载】由壳在 `agent/created` 时调用 —— **抢在任何请求装配之前**就位。
 *
 * 为什么必须有它（实测依据）：turn 1 的线上是 `sysmsg 9343 / tools=43`，而同轮诊断里
 * 却有一条 `{blocker:…, frozen:false, hit:false}`，**出现在挂载之前** ⇒ 首个请求的装配
 * 发生在我们按轮挂载之**前**。也就是说"在 pre-step 挂载"对会话的第一个请求结构性太晚，
 * 表现为"首轮不生效、第二轮才生效"。
 *
 * 挂上后把闩锁标记为 `turn:'pending'`，让紧随其后的第一个 pre-step **沿用它**而不是重挂
 * （重挂会因同名段已注册而抛错）。
 */
export function prime(api, agent) {
  if (typeof agent?.id !== 'string') return
  const state = effectiveStateFor(api.readState(), agent.id)
  if (!state.armed.includes(agent.id) && !state.armed.includes('*')) return
  const disposers = []
  let error = ''
  try {
    mountLevers(agent, state, api, disposers)
  } catch (thrown) {
    error = String(thrown?.message ?? thrown)
  }
  api.latches.set(agent.id, { turn: 'pending', disposers, ui: {}, frozenLevers: state.levers })
  api.note({ prime: 'agent/created', id: agent.id, mounted: disposers.length, error })
}

/**
 * 一次 pre-step 的全部闸门处理：取值 → 轮次闩锁 → 消息过滤。
 * 幂等：多个座位（根级 / per-agent）重复进入时靠 signature 短路。
 */
export async function step(api, payload, decision) {
  const { readState, note, latches, unlatch, rootCtx } = api
  const agent = payload?.agent
  // 无论是否武装都要挂"装配观察者"：Q17 的注入清单（段/上下文名）靠它拿。
  ensureToolsBlocker(api)
  // M2：`state` 已经是"折算过按会话闸门"的有效状态（见 effectiveStateFor）。
  const state0 = effectiveStateFor(readState(), payload?.agent?.id)
  // 三种情况都算"要接管这个会话"：
  //   ① 显式列进 armed；② 通配 `*`（探针）；③ **该会话配了注入改写** ——
  // ③ 是必需的：用户要的是"预填装留空、只改系统提示"，那种情况下没有任何 lever，
  // 光靠 armed 永远进不来，改写就静默不生效了。
  const hasOverrides = overridesFor(state0, agent?.id) !== undefined
  const armed =
    typeof agent?.id === 'string' &&
    (state0.armed.includes(agent.id) || state0.armed.includes('*') || hasOverrides)

  if (!armed) {
    note({
      seat: payload?.__seat,
      turn: payload?.turn,
      step: payload?.step,
      id: agent?.id,
      armed: false,
      armedList: state0.armed,
    })
    // 未武装 = 完全不干预 ⇒ 角标显示"全放行"。
    const idleKinds = Array.isArray(decision?.messages)
      ? decision.messages.map((message) => message?.source?.kind ?? '(none)')
      : []
    recordSnapshot(agent?.id, {
      turn: payload?.turn,
      step: payload?.step,
      state: 'pass',
      armed: false,
      droppedKinds: [],
      seenKinds: idleKinds,
      allowed: state0.allowKinds,
    })
    return decision
  }

  // ── 轮次闩锁：**只认 turn**，本轮取一次值后整轮冻结 ─────────────────────
  // 规划 Q4 原文：「本轮内改开关 → 只影响下一轮」。上一版签名写成了
  // `${turn}|${levers}` ⇒ levers 一变就重挂，于是轮内翻开关会在**同一轮中途**
  // 卸掉限制（实测"一轮内 移除41 → 新增41"）。现在改为按 turn 冻结：
  // 挂载的 lever、消息过滤、线上阻断器三者都用这一份冻结值，中途改开关一律
  // 等到下一轮 —— 这才是"第一轮 OFF 全开、第二轮 ON 全关"的语义。
  const entry = latches.get(agent.id)
  // 急切挂载（prime）留下的 `turn:'pending'`：被本轮**沿用**，不重挂
  // （重挂会因同名段已注册而抛 "already registered in this scope"）。
  if (entry?.turn === 'pending') entry.turn = payload?.turn
  const remounted = entry?.turn !== payload?.turn
  let mounted = entry?.disposers.length ?? 0
  let ui = entry?.ui
  let mountError = ''
  if (remounted) {
    unlatch(agent.id)
    const disposers = []
    try {
      const result = mountLevers(agent, state0, api, disposers)
      ui = result.ui
    } catch (error) {
      mountError = String(error?.message ?? error)
      ui = { mountError }
    }
    // 无论成功失败都存下来：partial 也要能清，否则泄漏成永久死锁。
    mounted = disposers.length
    latches.set(agent.id, { turn: payload?.turn, disposers, ui, frozenLevers: state0.levers })
  }
  // 本轮所有判定都用冻结值，不再读实时状态。
  const state = { ...state0, levers: entry?.frozenLevers ?? state0.levers }

  const droppedKinds = []
  const overrode = []
  // 记录这一步**实际进入**的消息种类：④ 通道要看"有没有东西可丢"，
  // 否则 droppedKinds 为空会被误读成"过滤器失效"（实测 turn 6 就是这种情形）。
  const seenKinds = Array.isArray(decision?.messages)
    ? decision.messages.map((message) => message?.source?.kind ?? '(none)')
    : []
  let next = decision

  // ── Q17：单会话注入改写（"劫持注入"）────────────────────────────────────────
  // 作用点选在 `agent/pre-step` 的 `decision.messages` —— 这是**唯一**能改到
  // "已经生产出来、即将进模型"的消息的地方（运行时上下文由 `runtimeContext.project()`
  // 在装配前生成，改这里等价于改它的产物）。改写必须在过滤**之前**：先改内容，
  // 再决定放不放行。
  // practices P4：必须 spread，否则丢 `startsRequestSeries`。
  const overrides = overridesFor(state, agent.id)
  if (overrides?.messages !== undefined && decision?.kind === 'enter' && Array.isArray(decision.messages)) {
    const rewrites = overrides.messages
    const messages = decision.messages.map((message) => {
      const kind = message?.source?.kind
      if (typeof kind !== 'string' || !Object.hasOwn(rewrites, kind)) return message
      overrode.push(kind)
      return { ...message, content: [{ type: 'text', text: String(rewrites[kind]) }] }
    })
    if (overrode.length > 0) next = { ...next, messages }
  }

  // "拦注入"只拦**非本插件**的注入：我方改写过的 kind 照发（发的是我们的版本）。
  // 否则会出现"开着拦注入、改写就静默失效"的怪状（实测 PURE 下 runtime-context 被丢）。
  const overriddenKinds = new Set(overrode)
  const keepMessage = (message) => {
    const kind = message?.source?.kind
    if (typeof kind === 'string' && overriddenKinds.has(kind)) return true
    return keeper(state, message)
  }
  if (state.levers.blockMessages && decision?.kind === 'enter' && Array.isArray(next.messages)) {
    for (const message of next.messages) {
      if (!keepMessage(message)) droppedKinds.push(message?.source?.kind ?? '(none)')
    }
    if (droppedKinds.length > 0) {
      next = { ...next, messages: next.messages.filter((message) => keepMessage(message)) }
    }
  }

  // ── 会话内注入（模式 B · "首轮之后再预填装"）──────────────────────────────
  // 首轮之后"写进历史"这条路已经被物理约束关死了（F11：`session.append` 禁止在系统节点与
  // 首条用户消息之间重入插入；F12：assistant/message 必须在已开的 turn+step 内），
  // 所以改成**每轮注入**：把预填装内容渲染成一条注入消息，插在真实用户消息**之前**
  // （位置与 harness 自己的 runtime-context 一致），既不写 session、也不是历史。
  //
  // 只在 `turn > 1` 生效：首轮仍然走物化 —— 那才是"变成真实历史"。
  const injectItems = Array.isArray(state?.injects?.[agent.id]) ? state.injects[agent.id] : []
  if (
    injectItems.length > 0 &&
    Number.isFinite(payload?.turn) &&
    payload.turn > 1 &&
    decision?.kind === 'enter' &&
    Array.isArray(next.messages)
  ) {
    const messages = [...next.messages]
    // 借用 harness 自己那条注入消息的形状（省得猜字段），只换 kind 和正文。
    const template = messages.find((message) => message?.source?.kind === 'runtime-context') ?? {
      role: 'user',
      source: {},
    }
    const text = renderInjectBlock(injectItems)
    const injected = {
      ...template,
      id: `prefill-inject-${payload.turn}-${payload.step ?? 0}`,
      role: 'user',
      source: { ...(template.source ?? {}), kind: 'prefill', prefill: 'inject' },
      content: [{ type: 'text', text }],
    }
    // 插在**最后一条真实用户消息之前**（没有就追加）。
    let at = -1
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.source?.kind === 'user') {
        at = index
        break
      }
    }
    if (at >= 0) messages.splice(at, 0, injected)
    else messages.push(injected)
    next = { ...next, messages }
    note({ inject: 'done', id: agent.id, turn: payload.turn, chars: text.length, items: injectItems.length })
  }

  // ── 自检：直接向装配器要一份"此刻到底装配成什么"的真相 ──────────────────
  // 为什么需要它：`system/message` 是**投影提交**的结果（round A 的探针段直到 step 2
  // 才落地），而单 step 的回合根本不提交 —— 只看日志会把"没提交"误判成"没生效"。
  // 装配器返回值才是权威。代价：多跑一次装配（provider 会被再求值一次），因此只在
  // 测阻断通道的那两轮（blockTools / blockSections）里、每轮重挂时测一次。
  let selfCheck
  if (remounted && (state.levers.blockTools || state.levers.blockSections)) {
    try {
      const { systemPrompt } = resolveServices(agent, rootCtx)
      const probe = await systemPrompt?.assemble?.({ agent, scope: agent })
      selfCheck = {
        sections: (probe?.sections ?? []).map((entry) => `${entry.name}(${entry.text.length})`),
        contexts: (probe?.contexts ?? []).length,
        tools: (probe?.tools ?? []).length,
      }
    } catch (error) {
      selfCheck = { failed: String(error?.message ?? error) }
    }
  }

  // Q9：把本轮的生效快照记下来（客户端角标读它）；seenKinds 供 Q17 的注入清单用。
  recordSnapshot(agent.id, {
    turn: payload?.turn,
    step: payload?.step,
    state: gateStateOf(state.levers),
    armed: true,
    droppedKinds,
    seenKinds,
    overrode,
    allowed: state.allowKinds,
  })

  note({
    seat: payload?.__seat,
    turn: payload?.turn,
    step: payload?.step,
    id: agent.id,
    armed: true,
    remounted,
    mounted,
    droppedKinds,
    overrode,
    seenKinds,
    mountError,
    selfCheck,
    ...ui,
  })
  return next
}

// ══════════════════════════════════════════════════════════════════════════════
// P1 探针：合成「预填装轮」—— 加法路线的最小可行性验证
// ══════════════════════════════════════════════════════════════════════════════
//
// 要验证什么（规划 §12.4 的 P1）：能否把「user 提问 + assistant 思维链 + assistant
// 回答」作为**真实 durable 事件**写进会话，且 ① 会话能正常重开、后续轮次正常
// ② 客户端原生渲染（含思维链折叠块）③ 模型把它当**历史**而不是注入。
//
// ── 为什么必须是"一个完整的合成轮"（本轮从代码里判掉的四条硬约束）─────────────
// 1. `session.append` **禁止重入**（`dsh-session/lib/index.js:1412`：*"session append
//    cannot reenter while another append is being published"*）⇒ 无法在 `session/event`
//    里插事件 ⇒ 循环里「system 节点(agent-loop:1041) → 用户消息(:1046)」这个窗口**不可达**。
// 2. `assistant/message` 必须落在**开着的 turn+step** 内
//    （`dsh-session/lib/invariant.js:59-61` 的 `requireOpenStep`）；而 `agent/pre-step`
//    发生时 **step/start 还没写**（`dsh-agent-loop:954 preStep → :968 step/start`）⇒
//    在 pre-step 里塞 assistant 消息是"无 enclosure"的。
// 3. 客户端同样要求 enclosure：`dsh-client-ui-chat/lib/client.js:7576` 明写
//    *"assistant-step start requires step/start"*，节点 id = `${turn}:${step}`（:7562）
//    ⇒ 没有 step/start 的 assistant/message **根本不会渲染**。
// 4. DeepSeek 适配器（in-history 路由）只把**第一条** system 消息提升为顶层 `system`
//    字段（`dsh-llm-deepseek/lib/index.js:1648-1657, 1696`）⇒ 若 system 节点排在预填装
//    消息**之后**，整份系统提示会退化成"历史末尾的一条 system"。
// ⇒ 结论：唯一可行结构 = 插件自造一个**完整的合成轮**，并且**先写 system 节点**。
//
// ── 本机实测补充 ─────────────────────────────────────────────────────────────
// `@deepseek-ai/dsh-invariants` **没有**被 web/headless profile 装载
// （`dsh --profile web --dump-config` 里 grep 不到），所以约束 2 运行时不被强制；
// 但约束 3（客户端渲染）是硬的 —— 所以照样按合规形状写。

/** 探针内容可用环境变量覆盖（做对照实验时避免"内容自述"污染模型判断）。 */
function probeText(envName, fallback) {
  const value = process.env[envName]
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

/** 探针内容：一眼可辨，且带自有命名空间。 */
export const PREFILL_PROBE_QUESTION = probeText(
  'PREFILL_PROBE_QUESTION',
  '【prefill:probe】预填装提问：请说明这个会话正在做什么。',
)
export const PREFILL_PROBE_REASONING = probeText(
  'PREFILL_PROBE_REASONING',
  '【prefill:probe】预填装思维链：用户要的是一段"预先写好、当作历史"的对话；这里放思维链，用来验证客户端能否原生折叠渲染（ReasoningRow）。',
)
export const PREFILL_PROBE_ANSWER = probeText(
  'PREFILL_PROBE_ANSWER',
  '【prefill:probe】预填装回答：这段内容由 @local/dsh-prefill 以真实 durable 事件写入，不是注入，也不是模型生成的。',
)

/** 预填装包标识：**放 `source.prefill`，不放 `source.kind`**（见 F16）。 */
export const PREFILL_PACK_ID = probeText('PREFILL_PACK_ID', 'probe')

/**
 * 多轮预填装的内容模型。
 *
 * 一条 item 只有两种形态，**思维链是 ai 那一部分里的一个字段**：
 *   { role:'user',      text }
 *   { role:'assistant', reasoning?, text }
 * 列表本身**不要求 user/ai 交替**：连续多条 user、连续多条 assistant 都合法。
 *
 * 默认（未设 `PREFILL_PROBE_ITEMS`）= 一问一答，保持 P1 原行为。
 */
export function resolveProbeItems() {
  const raw = process.env.PREFILL_PROBE_ITEMS
  if (typeof raw === 'string' && raw.length > 0) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    } catch {
      // 解析失败就落回默认，别让探针整条挂掉。
    }
  }
  return [
    { role: 'user', text: PREFILL_PROBE_QUESTION },
    { role: 'assistant', reasoning: PREFILL_PROBE_REASONING, text: PREFILL_PROBE_ANSWER },
  ]
}

/**
 * 造一条形状与真流一致的紧凑流（不含 usage 块 ⇒ token-meter 自然忽略该事件）。
 * @see assistant/message 必须带 stream —— 见 materializePrefill 顶部注释（F13）。
 */
export function buildStream(reasoning, text) {
  const at = Date.now()
  const records = []
  let index = 0
  if (typeof reasoning === 'string' && reasoning.length > 0) {
    records.push(
      { type: 'chunk', time: at, chunk: { type: 'block-start', index, blockType: 'reasoning' } },
      { type: 'chunk', time: at, chunk: { type: 'block-end', index, block: { type: 'reasoning', text: reasoning } } },
    )
    index += 1
  }
  records.push(
    { type: 'chunk', time: at, chunk: { type: 'block-start', index, blockType: 'text' } },
    { type: 'text-chunks', time0: at, index, dt: [], texts: [text] },
    { type: 'chunk', time: at, chunk: { type: 'block-end', index, block: { type: 'text', text } } },
    { type: 'chunk', time: at, chunk: { type: 'finish', reason: { kind: 'stop' } } },
  )
  return records
}

// ── 渲染系统提示：语义逐字复制自 @deepseek-ai/dsh-system-prompt/lib/index.js:104-177 ──
// 为什么必须自己渲染：合成轮要**先写 system 节点**（约束 4），而节点的文本必须与
// 循环稍后在 `agent-loop:1032 renderPrompt(assembly)` 算出的**完全一致**，否则
// `SystemPromptProjection.project()`（agent-loop:264-282）会发现 head.text !== rendered
// 而**再追加一个 system 节点**，系统提示就退化成了历史中段的一条 system。
// 官方 `renderPrompt` 未从服务上暴露，故按源码逐字复制；是否一致的判据是
// 「会话里 system/message 事件恰好 1 条」。
const GROUP_AT = /^\{\{([^{}]*)\}\}/
const VARIABLE_NAME = /^[a-z][a-z0-9_]*$/

function interpolate(input, variables, kind) {
  const text = input.text
  let result = ''
  let last = 0
  for (let open = text.indexOf('{{'); open >= 0; open = text.indexOf('{{', last)) {
    const group = GROUP_AT.exec(text.slice(open))
    if (group === null) {
      if (text.indexOf('}}', open + 2) >= 0) {
        throw new Error(`malformed prompt variable reference at "${text.slice(open, open + 16)}…" in ${kind} "${input.name}"`)
      }
      result += text.slice(last, open + 2)
      last = open + 2
      continue
    }
    const name = group[0].slice(2, -2)
    if (!VARIABLE_NAME.test(name)) throw new Error(`malformed prompt variable reference "{{${name}}}" in ${kind} "${input.name}"`)
    if (!Object.hasOwn(variables, name)) throw new Error(`unknown prompt variable "{{${name}}}" in ${kind} "${input.name}"`)
    const value = variables[name]
    if (value === undefined) throw new Error(`prompt variable "{{${name}}}" has no value for this assembly (${kind} "${input.name}")`)
    result += text.slice(last, open) + value
    last = open + group[0].length
  }
  return result + text.slice(last)
}

/** @see @deepseek-ai/dsh-system-prompt `renderPrompt` */
export function renderPrompt(assembly) {
  return assembly.sections
    .map((section) => (section.interpolate === false ? section.text : interpolate(section, assembly.variables, 'section')))
    .filter((text) => text.length > 0)
    .join('\n\n')
}

/** 取系统提示服务：先 `get()`（Cordis 对属性访问有守卫，见 §12.3 第 6 条）。 */
function systemPromptOf(agent) {
  const scope = agent?.ctx
  if (typeof scope?.get === 'function') {
    try {
      const value = scope.get('systemPrompt')
      if (value !== undefined) return value
    } catch {
      // 落到属性访问。
    }
  }
  try {
    return scope?.systemPrompt
  } catch {
    return undefined
  }
}

/**
 * 把一个「合成预填装轮」写进会话（P1 探针）。
 *
 * 触发点：`agent/created`（串行、且**早于首个轮次**）。真实产品化时触发点可以移到
 * `agent/inbox/inserted`（`dsh-agent-loop:206`，session.append 已返回、`wakeDriver`
 * 之前）—— 那是"用户已发送、但轮次尚未开始"的窗口，能同时满足"发送前可编辑"。
 *
 * 写完后必须把循环的轮号推到 1：循环的轮号是**构造时**从 `turnBoundary` 投影取的、
 * 之后只存内存（`dsh-agent-loop:782` 构造、`:864 wakeDriver` 用 `phase.lastTurn`），
 * 所以插件后写的合成轮它看不见 —— 不推的话它会再写一次 `turn/start{1}`，客户端按
 * `${turn}:${step}` 分组会把"预填装回答"和"真实回答"并成同一个 assistant-step 节点。
 *
 * @param api - 壳传进来的能力包（readState / note / latches / unlatch / rootCtx）。
 * @param agent - `agent/created` 给的 agent（就是 AgentLoop 实例）。
 * @returns 无；一切结果都写进 note() 诊断。
 */
// ── 跨热换存活的注册表（挂 globalThis 的 Symbol，理由同 tools-blockers）──────
/** agentId → 已渲染好的系统提示文本（在 agent/created 时算好，供同步物化使用）。 */
const PROMPTS = (globalThis[Symbol.for('dsh-prefill.prompts')] ??= new Map())
/** sessionId(=agentId) → 客户端草稿 items（"发送前可编辑"的载体）。 */
const DRAFTS = (globalThis[Symbol.for('dsh-prefill.drafts')] ??= new Map())

/** 登记一份客户端草稿（由自有路由写入）。 */
export function stageDraft(sessionId, items) {
  if (typeof sessionId !== 'string' || sessionId === '' || !Array.isArray(items)) return false
  DRAFTS.set(sessionId, items)
  return true
}

/** 读一份草稿（诊断用）。 */
export function readDraft(sessionId) {
  return DRAFTS.get(sessionId)
}

/** 丢弃草稿（物化后调用，避免同一会话重复物化）。 */
export function clearDraft(sessionId) {
  return DRAFTS.delete(sessionId)
}

/** 已登记的草稿会话 id（诊断用）。 */
export function draftIds() {
  return [...DRAFTS.keys()]
}

/** 该 agent 是否需要预填装：探针开关 / 已有草稿 / 会话开关（`prefill[sessionId]`）打开。 */
function prefillWanted(state, agentId) {
  if (state?.levers?.prefillProbe === true) return true
  if (DRAFTS.has(agentId)) return true
  const toggle = state?.prefill
  return (
    toggle !== null && typeof toggle === 'object' && typeof toggle[agentId] === 'string' && toggle[agentId] !== ''
  )
}

/**
 * 内容来源，三级优先：
 *   ① **客户端草稿** —— 注意**空数组也算数**："开关打开但还没加内容" = 不预填装任何东西，
 *      而不是回落到探针内容。
 *   ② 探针开关打开 → 探针内容。
 *   ③ 都没有 → 空。
 */
function resolveItems(state, agentId) {
  if (DRAFTS.has(agentId)) return DRAFTS.get(agentId)
  if (state?.levers?.prefillProbe === true) return resolveProbeItems()
  return []
}

/**
 * 把预填装条目渲染成"会话内注入"的正文（模式 B）。
 *
 * 与模式 A（物化成真实消息）的区别：这里是**一整块文本**塞进一条注入消息，
 * 不写 session、不进历史、每轮都要重新注入（所以要花 token）。
 */
function renderInjectBlock(items) {
  const lines = ['【预填装 · 会话内注入】以下内容视为本会话开始前就已存在的背景：']
  for (const item of items) {
    const text = typeof item?.text === 'string' ? item.text : ''
    if (item?.role === 'assistant') {
      const reasoning =
        typeof item?.reasoning === 'string' && item.reasoning !== '' ? `（思维链：${item.reasoning}）` : ''
      lines.push(`AI：${text}${reasoning}`)
    } else {
      lines.push(`用户：${text}`)
    }
  }
  return lines.join('\n')
}

/** 会话里是否已经有轮次（幂等守卫）。读不出来就当有，宁可不动。 */
function hasTurn(session) {  try {
    return session.snapshotEvents().some((event) => event.type === 'turn/start')
  } catch {
    return true
  }
}

/** 组装 + 渲染系统提示（异步）。 */
async function computeRendered(agent) {
  const systemPrompt = systemPromptOf(agent)
  const assembly = await systemPrompt.assemble({ agent, scope: agent })
  return renderPrompt(assembly)
}

/**
 * 【第一步 · 异步】`agent/created` 时把渲染好的系统提示**缓存**下来。
 *
 * 为什么必须先缓存：真正的物化触发点 `agent/inbox/inserted` 是**同步 emit**
 * （`dsh-agent/lib/index.js:242-263`：payload 融合 `agent`、逐监听器 try/catch 只 warn），
 * 而 `assemble()` 是异步的。若在 emit 里 `await`，写入就会晚于 `wakeDriver()`
 * （`dsh-agent-loop:803-804`）—— 那时 `turn/start` 已经落地，合成轮再也插不进去（F11/F12）。
 * ⇒ 异步的部分前移到 created，物化本身保持纯同步。
 */
export async function preparePrefillPrompt(api, agent) {
  if (typeof agent?.id !== 'string') return
  if (!prefillWanted(api.readState(), agent.id)) return
  try {
    const rendered = await computeRendered(agent)
    PROMPTS.set(agent.id, rendered)
    api.note({ prefill: 'prompt-cached', id: agent.id, chars: rendered.length })
  } catch (error) {
    api.note({ prefill: 'assemble-failed', id: agent.id, error: String(error?.message ?? error) })
  }
}

/**
 * 【第二步 · 同步】`agent/inbox/inserted` —— **用户真发了话、但轮次还没开始**的唯一窗口。
 *
 * 时序（实测/源码）：`send()` → `inbox.splice()` → `session.append('agent/inbox/spliced')`
 * → `dispatch.emit('agent/inbox/inserted')`（`dsh-agent-loop:206`）→ 返回 → `wakeDriver()`
 * （`:803-804`）。所以此刻：① 还没有任何 `turn/start`；② 我们写完合成轮后立刻改
 * `phase.lastTurn`，紧接着的 `wakeDriver` 就会把真实轮开在 N+1 上。
 *
 * 这也正是"发送前可编辑、发出即物化"的落点：草稿留在客户端/本注册表，只有用户
 * 真的发出第一条消息时才变成 durable 事件。
 */
export function onInboxInserted(api, agent, message) {
  if (typeof agent?.id !== 'string') return
  const state = api.readState()
  if (!prefillWanted(state, agent.id)) return
  // 只在**用户原话**上物化；注入（runtime-context / skill-catalog 等）不算"发出"。
  if (message?.source?.kind !== 'user') return
  const session = agent.session
  if (session === null || typeof session?.append !== 'function') return
  if (hasTurn(session)) return
  const rendered = PROMPTS.get(agent.id)
  if (rendered === undefined) {
    api.note({ prefill: 'no-cached-prompt', id: agent.id })
    return
  }
  const turns = writeSyntheticTurns(api, agent, session, rendered, resolveItems(state, agent.id))
  // 物化成功 ⇒ 顺手把会话标题钉到**这次的真实提问**上（F18 收尾）。
  if (typeof turns === 'number' && turns > 0) pinTitle(api, agent, session, message)
}

/**
 * F18 收尾：把会话标题**钉到真实提问**上。
 *
 * 为什么需要：`dsh-session-title/lib/index.js:91` 判定"人说的话"只看
 * `event.data.source.kind === 'user'`；而 F16 之后预填装的 user 消息**也必须是**
 * `kind:'user'`（否则客户端把它归为不可见的 Context 行）⇒ 标题被预填装的第一条劫持
 * （实测标题变成 `U1：读一下 a.js`）。那个判定在官方包里，我们改不了。
 *
 * 官方给了正当解法：`sessionTitle.rename(session, title)` 写一条 `source.kind === 'user'`
 * 的 `session/title` —— 它是**钉住**语义：在途的自动生成被取代，之后的 user 消息也不再
 * 触发自动生成（源码注释原文："pins the title"）。于是在物化那一刻，用触发本次物化的
 * **真实提问**去钉标题。
 */
function pinTitle(api, agent, session, message) {
  const blocks = Array.isArray(message?.content) ? message.content : []
  const text = blocks
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (text === '') return
  const title = text.slice(0, 24)
  const service = typeof api.rootCtx?.get === 'function' ? api.rootCtx.get('sessionTitle') : undefined
  if (service === undefined || typeof service.rename !== 'function') {
    api.note({ prefill: 'no-title-service', id: agent.id })
    return
  }
  try {
    service.rename(session, title)
    api.note({ prefill: 'title-pinned', id: agent.id, title })
  } catch (error) {
    api.note({ prefill: 'title-pin-failed', id: agent.id, error: String(error?.message ?? error) })
  }
}

/**
 * 旧的触发点（`agent/created`）：探针保留一条对照路径。
 * 产品路径用 `onInboxInserted`；两者都收敛到 `writeSyntheticTurns`。
 */
export async function materializePrefill(api, agent) {
  if (typeof agent?.id !== 'string') return
  const state = api.readState()
  if (!prefillWanted(state, agent.id)) return
  const session = agent.session
  if (session === null || typeof session?.append !== 'function') {
    api.note({ prefill: 'no-session', id: agent.id })
    return
  }
  if (hasTurn(session)) {
    api.note({ prefill: 'skip-has-turn', id: agent.id, seq: session.seq })
    return
  }
  let rendered = PROMPTS.get(agent.id)
  if (rendered === undefined) {
    try {
      rendered = await computeRendered(agent)
      PROMPTS.set(agent.id, rendered)
    } catch (error) {
      api.note({ prefill: 'assemble-failed', id: agent.id, error: String(error?.message ?? error) })
      return
    }
  }
  writeSyntheticTurns(api, agent, session, rendered, resolveItems(state, agent.id))
}

/**
 * 同步写入多轮合成轮，并推进循环轮号。
 *
 * ── 多轮预填装：items = 有序消息列表，**不强制 user/ai 交替** ────────────────
 * 落盘映射受 DSH 的 turn/step 结构约束：
 *   · 连续 user 项 → 放进**同一个 turn/step**（每条各自一个 user/message 节点 ⇒
 *     客户端各画一个气泡；wire 上连续同角色会被适配器合并，无妨）
 *   · 每个 assistant 项 → **独占一个 turn**（客户端 assistant-step 节点 id 是
 *     `${turn}:${step}`，同一 turn 里多条 assistant/message 会被并成一个节点）
 *   · 尾部没有 assistant 承接的 user 项 → 自己开一轮
 */
export function writeSyntheticTurns(api, agent, session, rendered, items) {
  // 空草稿 = "开关开了但还没写内容" ⇒ 什么都不物化，也把草稿消费掉。
  if (!Array.isArray(items) || items.length === 0) {
    api.note({ prefill: 'empty-draft', id: agent.id })
    clearDraft(agent.id)
    return
  }
  const written = []
  let turnNo = 0

  /** 写一个完整合成轮。 */
  const writeTurn = (turn, users, assistant) => {
    session.append('turn/start', { turn })
    session.append('step/start', { turn, step: 1 })
    // 顺序即语义：system 必须是**第一条**（F14）。
    if (turn === 1) {
      session.append(
        'system/message',
        {
          turn,
          step: 1,
          message: {
            role: 'system',
            content: [{ type: 'text', text: rendered }],
            source: { kind: 'system-prompt' },
            id: randomUUID(),
          },
        },
        { surfaceOp: 'append' },
      )
      written.push('system/message')
    }
    for (const user of users) {
      session.append(
        'user/message',
        {
          role: 'user',
          content: [{ type: 'text', text: user.text }],
          // ⚠️ F16：这里**必须**是 kind:'user'。客户端的渲染分类器就用它
          // （`dsh-client-ui-chat/lib/client.js:9208`：kind !== 'user' ⇒ 归为普通 Context 行；
          // 而 `isVisibleChatNode`（:7651）把普通 Context 行**排除在可见聊天行之外**
          // ⇒ 预填装提问在 GUI 里根本不显示）。包标识因此改放 `prefill` 字段。
          source: { kind: 'user', prefill: PREFILL_PACK_ID },
          id: randomUUID(),
        },
        { surfaceOp: 'append' },
      )
      written.push('user/message')
    }
    if (assistant !== undefined) {
      session.append(
        'assistant/message',
        {
          turn,
          step: 1,
          message: {
            role: 'assistant',
            content: [
              ...(typeof assistant.reasoning === 'string' && assistant.reasoning.length > 0
                ? [{ type: 'reasoning', text: assistant.reasoning }]
                : []),
              { type: 'text', text: assistant.text },
            ],
            // 约束：assistant/message 的 source 必须是 kind:'model' 且带 provider+model
            // （dsh-session/lib/index.js:1169-1172）。刻意**不带** replayState —— 合成内容
            // 没有可原生回放的 provider 签名。
            source: { kind: 'model', provider: 'prefill-probe', model: 'prefill-probe' },
            id: randomUUID(),
          },
          stream: buildStream(assistant.reasoning, assistant.text),
        },
        { surfaceOp: 'append' },
      )
      written.push('assistant/message')
    }
    session.append('step/end', { turn, step: 1 })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
  }

  try {
    let pending = []
    for (const item of items) {
      if (item?.role === 'user') {
        pending.push({ text: String(item.text ?? '') })
        continue
      }
      turnNo += 1
      writeTurn(turnNo, pending, { reasoning: item?.reasoning, text: String(item?.text ?? '') })
      pending = []
    }
    if (pending.length > 0) {
      turnNo += 1
      writeTurn(turnNo, pending, undefined)
    }
  } catch (error) {
    api.note({ prefill: 'append-failed', id: agent.id, written, turnNo, error: String(error?.message ?? error) })
    return
  }

  // 推进循环的轮号（见上方说明）。
  // ⚠️ 实测：`agent/created` 时刻循环的 phase 是 **`maintenance`**（agent 的创建/装配
  // 本身跑在一个 maintenance job 里，见 `dsh-agent-loop:822-845`），不是 idle。
  // `runMaintenance` 结束时会 `setPhase({kind:'idle', lastTurn: maintenance.lastTurn})`
  // ——它取的是**同一个对象上的字段**，所以**任何** kind 下就地改 `phase.lastTurn`
  // 都能传到 idle 相位。只改 idle 会漏掉首轮（实测表现为 turn/start{1} 被写两次）。
  let turnAdjusted = 'no-phase'
  try {
    const phase = agent.phase
    if (phase !== null && typeof phase === 'object') {
      const was = String(phase.kind)
      phase.lastTurn = turnNo
      turnAdjusted = `${was}->lastTurn=${turnNo}`
    }
  } catch (error) {
    turnAdjusted = `error:${String(error?.message ?? error)}`
  }

  api.note({
    prefill: 'materialized',
    id: agent.id,
    seq: session.seq,
    headChars: rendered.length,
    turns: turnNo,
    items: items.length,
    writes: written.length,
    turnAdjusted,
  })

  // 草稿是"一次性"的：物化完成即消费掉（Q15：发出即固定）。探针路径下是 no-op。
  clearDraft(agent.id)

  // ── 诊断脚手架（只在 PREFILL_DIAG=1 时装）──────────────────────────────────
  // 用途：无头 runner（`dsh-headless` 的 run()）在 create 之后依次调
  // `agent.whenIdle()` / `agent.followup()` / `agent.whenIdle()`；一旦这条路上抛错，
  // CLI 只打印 `dsh: <message>`，拿不到栈。这里把三个入口包一层，把栈打到 stderr。
  if (process.env.PREFILL_DIAG === '1') {
    for (const method of ['followup', 'whenIdle', 'send', 'inject']) {
      const original = agent[method]
      if (typeof original !== 'function') continue
      try {
        agent[method] = function instrumented(...args) {
          try {
            const result = original.apply(this, args)
            if (result !== null && typeof result?.then === 'function') {
              return result.catch((error) => {
                console.error(`[prefill] agent.${method} rejected:`, error?.stack ?? String(error))
                throw error
              })
            }
            return result
          } catch (error) {
            console.error(`[prefill] agent.${method} threw:`, error?.stack ?? String(error))
            throw error
          }
        }
      } catch {
        // 只读属性就算了。
      }
    }
    console.error('[prefill] instrumented agent.followup / whenIdle / send / inject')
  }

  return turnNo
}
