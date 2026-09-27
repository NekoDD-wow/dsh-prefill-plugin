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
  // complete:true 的段在同 scope 内必须唯一；每轮先撤后挂，故至多一个。
  if (state.levers.blockSections && typeof sp?.section === 'function') {
    push(sp.section({ name: 'prefill:pure', order: 0, text: '', complete: true }))
  }
  if (state.levers.probeContext && typeof sp?.context === 'function') {
    push(sp.context({ name: 'prefill:probe-context', order: 1000, text: PROBE_CONTEXT_TEXT }))
  }
  if (state.levers.blockContexts && typeof sp?.suppressRuntimeContext === 'function') {
    push(sp.suppressRuntimeContext())
  }
  if (state.levers.blockTools && typeof toolService?.restrict === 'function') {
    push(toolService.restrict({ allow: [] }))
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
  if (!state.armed.includes(agent.id)) return
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
  // M2：`state` 已经是"折算过按会话闸门"的有效状态（见 effectiveStateFor）。
  const state0 = effectiveStateFor(readState(), payload?.agent?.id)
  const armed = typeof agent?.id === 'string' && state0.armed.includes(agent.id)

  if (!armed) {
    note({
      seat: payload?.__seat,
      turn: payload?.turn,
      step: payload?.step,
      id: agent?.id,
      armed: false,
      armedList: state0.armed,
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
  // 记录这一步**实际进入**的消息种类：④ 通道要看"有没有东西可丢"，
  // 否则 droppedKinds 为空会被误读成"过滤器失效"（实测 turn 6 就是这种情形）。
  const seenKinds = Array.isArray(decision?.messages)
    ? decision.messages.map((message) => message?.source?.kind ?? '(none)')
    : []
  let next = decision
  if (state.levers.blockMessages && decision?.kind === 'enter' && Array.isArray(decision.messages)) {
    for (const message of decision.messages) {
      if (!keeper(state, message)) droppedKinds.push(message?.source?.kind ?? '(none)')
    }
    if (droppedKinds.length > 0) {
      // practices P4：必须 spread，否则丢 startsRequestSeries。
      next = { ...decision, messages: decision.messages.filter((message) => keeper(state, message)) }
    }
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

  note({
    seat: payload?.__seat,
    turn: payload?.turn,
    step: payload?.step,
    id: agent.id,
    armed: true,
    remounted,
    mounted,
    droppedKinds,
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
export async function materializePrefill(api, agent) {
  const state = api.readState()
  if (state.levers?.prefillProbe !== true) return
  const session = agent?.session
  if (session === null || typeof session?.append !== 'function') {
    api.note({ prefill: 'no-session', id: agent?.id })
    return
  }

  // 幂等：已经有轮次（或已经有 system 节点）就不再写。
  let events
  try {
    events = session.snapshotEvents()
  } catch (error) {
    api.note({ prefill: 'snapshot-failed', error: String(error?.message ?? error) })
    return
  }
  if (events.some((event) => event.type === 'turn/start')) {
    api.note({ prefill: 'skip-has-turn', id: agent.id, seq: session.seq })
    return
  }

  let rendered = ''
  try {
    const systemPrompt = systemPromptOf(agent)
    const assembly = await systemPrompt.assemble({ agent, scope: agent })
    rendered = renderPrompt(assembly)
  } catch (error) {
    api.note({ prefill: 'assemble-failed', id: agent.id, error: String(error?.message ?? error) })
    return
  }

  const turn = 1
  const step = 1
  const written = []

  // ⚠️ 【P1 实测·必须】assistant/message **必须带 `stream`（紧凑流）**，否则会炸。
  // 实测栈（PREFILL_DIAG=1 抓到）：
  //   dsh-token-meter/lib/index.js:392 usageOf()
  //     → `event.data.usage === undefined` 时无条件 `lastAssistantStreamChunk(event.data.stream,'usage')`
  //     → dsh-llm/lib/index.js:1412 `stream.length` ← stream 为 undefined ⇒ TypeError
  //   ⇒ 整条 agent.followup() 直接抛，会话卡死。
  // 同一处缺口客户端也有：`dsh-client-ui-chat/lib/client.js:10265` 的
  //   `streamUsage(event.data.stream) ?? state.sample` **没有短路**，stream 缺失同样会炸。
  // 注意 `dsh-session-format-v3-to-v4` 用 `Array.isArray(data.stream)` 包着（不强制），
  // 所以"没流"能写进去、也能读回来，但**读的时候**会炸在投影里 —— 这类"写时不管、读时炸"
  // 的字段正是 P1 要提前钉住的。
  // 故这里造一条形状与真流一致的紧凑流（不含 usage 块 ⇒ token-meter 自然忽略该事件，
  // 不会把预填装算成真实 token 消耗）。
  const at = Date.now()
  const stream = [
    { type: 'chunk', time: at, chunk: { type: 'block-start', index: 0, blockType: 'reasoning' } },
    { type: 'chunk', time: at, chunk: { type: 'block-end', index: 0, block: { type: 'reasoning', text: PREFILL_PROBE_REASONING } } },
    { type: 'chunk', time: at, chunk: { type: 'block-start', index: 1, blockType: 'text' } },
    { type: 'text-chunks', time0: at, index: 1, dt: [], texts: [PREFILL_PROBE_ANSWER] },
    { type: 'chunk', time: at, chunk: { type: 'block-end', index: 1, block: { type: 'text', text: PREFILL_PROBE_ANSWER } } },
    { type: 'chunk', time: at, chunk: { type: 'finish', reason: { kind: 'stop' } } },
  ]

  try {
    // 顺序即语义：system 必须是**第一条**（约束 4）。
    session.append('turn/start', { turn })
    session.append('step/start', { turn, step })
    session.append(
      'system/message',
      {
        turn,
        step,
        message: {
          role: 'system',
          content: [{ type: 'text', text: rendered }],
          source: { kind: 'system-prompt' },
          id: randomUUID(),
        },
      },
      { surfaceOp: 'append' },
    )
    session.append(
      'user/message',
      {
        role: 'user',
        content: [{ type: 'text', text: PREFILL_PROBE_QUESTION }],
        source: { kind: 'prefill:probe' },
        id: randomUUID(),
      },
      { surfaceOp: 'append' },
    )
    session.append(
      'assistant/message',
      {
        turn,
        step,
        message: {
          role: 'assistant',
          content: [
            { type: 'reasoning', text: PREFILL_PROBE_REASONING },
            { type: 'text', text: PREFILL_PROBE_ANSWER },
          ],
          // 约束：assistant/message 的 source 必须是 kind:'model' 且带 provider+model
          // （dsh-session/lib/index.js:1169-1172）。刻意**不带** replayState —— 合成内容
          // 没有可原生回放的 provider 签名。
          source: { kind: 'model', provider: 'prefill-probe', model: 'prefill-probe' },
          id: randomUUID(),
        },
        stream,
      },
      { surfaceOp: 'append' },
    )
    session.append('step/end', { turn, step })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
    written.push(...['turn/start', 'step/start', 'system/message', 'user/message', 'assistant/message', 'step/end', 'turn/end'])
  } catch (error) {
    api.note({ prefill: 'append-failed', id: agent.id, written, error: String(error?.message ?? error) })
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
      phase.lastTurn = turn
      turnAdjusted = `${was}->lastTurn=1`
    }
  } catch (error) {
    turnAdjusted = `error:${String(error?.message ?? error)}`
  }

  api.note({
    prefill: 'materialized',
    id: agent.id,
    seq: session.seq,
    headChars: rendered.length,
    written,
    turnAdjusted,
  })

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
}
