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
import { checksOf, modeOf, replay, splitTurns } from './inject-auto.js'
import { filledItems, insertBeforeLastUser, isManual, manualMessage, planQueued, queueOf, renderInjectBlock } from './inject-once.js'
import { hasImportedHistory, seamApplies, withSeam } from './constraint-carry.js'
import { firstPlan, firstRealTurn, lockOf, lockStatus } from './turn-lock.js'
import { applyEnabled, isEnabled } from './enabled.js'
import { WORKSPACE_KIND, WORKSPACE_MARK, applyWorkspaceInstructions, lastWorkspaceInHistory, workspaceInstructionsFor } from './workspace-instructions.js'
import {
  KNOWN_MESSAGE_KINDS as AUDIT_KNOWN_KINDS,
  auditSnapshot,
  blocksFor,
  classifyAssembly,
  classifySurfaceEvent,
  dropBlockedMessages,
  hasBlocks,
  notePrestepKinds,
  prestepKindsOf,
  recordFindings,
} from './injection-audit.js'
import { resolveSandbox } from './sandbox.js'
import { cleanMemory, matchLore, memoryDue, memoryInput, memorySystemPrompt, renderLore, renderMemory } from './character-cards.js'

/** 内核代次：壳会在诊断里回报它，用来确认热换是否生效。 */
export const STAGE = 'M1.1-gate+p1'

/** 探针内容：一眼可辨、且带自有命名空间。 */
export const PROBE_SECTION_TEXT =
  '[prefill:probe-section] M1 探针段：这条文本由 @local/dsh-prefill 注册，用于证明 sections 通道「能写」。'
export const PROBE_CONTEXT_TEXT =
  '[prefill:probe-context] M1 探针上下文：由 @local/dsh-prefill 注册，用于证明 contexts 通道「能写」。'

/**
 * 该会话**实际生效**的放行来源清单。
 *
 * 优先会话级（旧 `state.sessionAllowKinds[sessionId]`，UI 里按标签勾选写进去），
 * 再 `'*'`（探针用）；没配就回落到全局 `state.allowKinds`。
 * 会话沙盒第 1 步（issue #15）起统一经 resolveSandbox 读规则表（旧字段读取时迁移），结果不变。
 */
function allowKindsFor(state, sessionId) {
  return resolveSandbox(state, sessionId).allowKinds
}

/**
 * 工具放行的清单与策略（"不改工具说明，只管能不能用"）。
 *
 * 为什么不能直接把用户勾的名字丢给 `tools.restrict({allow})`：
 * 官方实现遇到**未知名字会抛错**（`dsh-tools:2908`），一个过期/拼错的名字就会让
 * 该会话的整条挂载链挂掉。所以先用 `view(scope).restrictableNames` 求交集。
 */
export function tools(rootCtx) {
  const catalog = new Set(TOOL_REGISTRY)
  const sessions = {}
  for (const [id, assembly] of ASSEMBLIES) {
    const names = Array.isArray(assembly.toolNames) ? assembly.toolNames : []
    sessions[id] = names
    for (const name of names) catalog.add(name)
  }
  return { catalog: [...catalog].sort(), sessions }
}

/** 该 agent 允许放行的全局工具名（官方 restrict 的白名单；拿不到就返回空=不设限）。 */
function restrictableToolNames(toolService, agent) {
  try {
    const view = typeof toolService?.view === 'function' ? toolService.view(agent) : undefined
    const names = view?.restrictableNames
    if (names instanceof Set) return [...names]
    if (Array.isArray(names)) return names
  } catch {
    // 忽略。
  }
  return []
}

/**
 * **`complete:true` 撞过车的会话**（撞上 `pure` preset 的 persona 段）。
 *
 * 为什么需要"记住"：冲突只能在 `assemble()` 时发现（注册时不报错），发现一次就要花
 * 一次失败的装配。记下来之后，这个会话后续每轮**直接走逐名清空**，不再试探。
 * 挂 Symbol 以穿过内核热换。
 */
const COMPLETE_CONFLICTS = (globalThis[Symbol.for('dsh-prefill.complete-conflicts')] ??= new Set())

/**
 * **与其他插件的冲突记录**（UI 要明确告诉用户，而不是悄悄退化）。
 *
 * 现状唯一一类：`complete:true` 段被占（典型是 `pure` preset 的 persona）。
 * 用户已定：pure preset 不再使用、其语义由本插件的「纯净模式」预设接管 ——
 * 所以撞上它时要**报出来并建议停用**，而不是默默降级。
 * 挂 Symbol 以穿过内核热换。
 */
const CONFLICTS = (globalThis[Symbol.for('dsh-prefill.conflicts')] ??= new Map())

/** 从 `multiple complete prompt sections are active: "a", "b"` 里抠出**别人**的名字。 */
function competingNamesFrom(message) {
  return [...String(message).matchAll(/"([^"]+)"/g)]
    .map((match) => match[1])
    .filter((name) => typeof name === 'string' && name !== '' && !name.startsWith('prefill'))
}

/** 记一条冲突（UI 读它）。 */
function rememberConflict(sessionId, kind, message) {
  if (typeof sessionId !== 'string' || sessionId === '') return undefined
  const entry = {
    kind,
    others: competingNamesFrom(message),
    message: String(message).slice(0, 300),
    at: new Date().toISOString(),
    advice:
      kind === 'complete-section'
        ? 'pure preset 已不再需要：请停用它，改由本插件的「纯净模式」预设接管（勾选后一键生效）'
        : '请检查是否有其它插件在同一作用域重复注册',
  }
  CONFLICTS.set(sessionId, entry)
  return entry
}

/** 读全部冲突（UI / 诊断出口）。 */
export function conflicts() {
  return Object.fromEntries(CONFLICTS)
}

/**
 * "逐名清空"：把 harness **已知的**段逐条清空（跳过我方要改写的那几条）。
 *
 * 与 `complete:true` 的分工：
 *   · `complete:true` = **绝对接管**整份段列表（连不认识的段也清掉），但同 scope 只能有一个，
 *     撞上 `pure` preset 的 persona 段会让 `assemble()` **直接抛错**（§9.3 的 R14，活的危险）。
 *   · 逐名清空 = 只清已知名字，安全但可能漏掉未见过的作用域局部段。
 * 默认用前者（更强），一旦探测到占用就当场换成后者（见 `step()` 的自检 + `swapToPerNameWipe`）。
 */
function mountPerNameWipe(sp, rootCtx, agentId, overrideSectionNames, push) {
  const known = new Set([
    ...entryNames(globalPromptLayer(rootCtx)?.sections),
    ...(ASSEMBLIES.get(agentId)?.sections ?? []),
  ])
  let count = 0
  for (const name of known) {
    if (overrideSectionNames.includes(name)) continue
    // 逐条兜住：agent 作用域里已有同名段时注册会抛 "already registered in this scope"，
    // 一条抛错不许把后面的清空（以及我方的改写段）一起带崩。
    try {
      push(sp.section({ name, order: globalOrderOf(rootCtx, 'sections', name) ?? 1000, text: '' }))
      count += 1
    } catch {
      // 跳过这一条。
    }
  }
  return count
}

/**
 * 撞上 `complete:true` 占用时的**救场**：撤掉我方那条、换成"逐名清空"，并记住这个会话。
 *
 * 调用点只在 `step()` 的自检探针 catch 里 —— 因为冲突**只在 `assemble()` 抛错**，
 * 注册处不会报错，"注册时 try/catch"这条路根本不成立。自检跑的正是同 scope、
 * 同一条装配路径，它抛什么循环里就会抛什么 ⇒ 在这里换掉，本轮就照常跑。
 * 返回 `{ok, wiped}` / `{ok:false, reason}`；不抛。
 */
function swapToPerNameWipe(agent, state, api, entry, completeDisposer) {
  try {
    if (typeof completeDisposer === 'function') completeDisposer()
    if (typeof agent?.id === 'string') COMPLETE_CONFLICTS.add(agent.id)
    const { systemPrompt } = resolveServices(agent, api.rootCtx)
    const sp = systemPrompt?.service
    if (typeof sp?.section !== 'function') return { ok: false, reason: 'no-section-api' }
    const overrideSectionNames = Object.keys(overridesFor(state, agent?.id)?.sections ?? {})
    const disposers = entry?.disposers ?? []
    const keep = (disposer) => {
      if (typeof disposer === 'function') disposers.push(disposer)
    }
    const wiped = mountPerNameWipe(sp, api.rootCtx, agent?.id, overrideSectionNames, keep)
    // 接管时改写段原本并在 complete 段里，complete 撤掉后要把它们单独补挂回来。
    const sections = overridesFor(state, agent?.id)?.sections ?? {}
    for (const [name, text] of Object.entries(sections)) {
      try {
        keep(sp.section({ name, order: globalOrderOf(api.rootCtx, 'sections', name) ?? 1000, text: String(text) }))
      } catch {
        // 已挂过（非接管路径）就跳过。
      }
    }
    return { ok: true, wiped }
  } catch (error) {
    return { ok: false, reason: String(error?.message ?? error) }
  }
}

/** 一条消息是否放行：自有 prefill:* 与用户原话恒放行，其余按（会话级优先的）白名单。 */
function keeper(state, message, sessionId) {
  const kind = message?.source?.kind
  if (kind === 'user') return true
  if (typeof kind !== 'string') return false
  if (kind.startsWith('prefill:')) return true
  // 手动注入（inbox 带进来的那条）是用户自己点的，不算外来注入。
  if (isManual(message)) return true
  return resolveSandbox(state, sessionId).messageAllow.has(kind)
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
/**
 * 每轮注入的轮数不再放内存计数（v0.9）：每次从会话事件重算（inject-auto.js `replay`），
 * 插件重载后不会把首轮专用段再发一次，自动收放的状态也不丢。
 */
/**
 * 本会话的「每轮注入」配置：`state.everyTurn[会话] ?? state.everyTurn['*']`。
 * 形状 `{ enabled, text, firstText, untilTurn }`：第 1 轮发 `firstText`（空则发 `text`），之后每轮发 `text`。
 * 关掉或两段都空 ⇒ undefined。
 */
export function everyTurnFor(state, agentId) {
  const all = state?.everyTurn
  if (all === null || typeof all !== 'object') return undefined
  const exact = typeof agentId === 'string' ? all[agentId] : undefined
  const entry = exact !== undefined && exact !== null && typeof exact === 'object' ? exact : all['*']
  if (entry === null || typeof entry !== 'object' || entry.enabled !== true) return undefined
  const text = typeof entry.text === 'string' ? entry.text.trim() : ''
  const firstText = typeof entry.firstText === 'string' ? entry.firstText.trim() : ''
  if (text === '' && firstText === '') return undefined
  const until = Number(entry.untilTurn)
  const untilTurn = Number.isFinite(until) && until > 0 ? Math.floor(until) : 0
  // 通配格 '*' 是新会话默认：它的 since / override 属于别的会话，不能带过来。
  const own = entry === exact
  return {
    text,
    firstText,
    untilTurn,
    mode: modeOf({ ...entry, untilTurn }),
    checks: checksOf(entry),
    auto: { ...(entry.auto ?? {}), override: own ? entry.auto?.override : undefined },
    since: own ? Number(entry.since) || 0 : 0,
    // 约束承接（constraint-carry.js）：来自会话的预设带过来的标记，只认本会话那格。
    seam: own && entry.seam === true,
    from: own ? 'session' : 'default',
    // 「下一轮发一次」首轮段（issue #19 B，turn-lock.js）：只认本会话那格、盖过章的。
    firstOnce: own && Number.isFinite(Number(entry.firstOnce?.atTurn)) ? { atTurn: Number(entry.firstOnce.atTurn) } : undefined,
  }
}

/** 本会话每轮注入的当前判定（给面板状态行；不改任何东西）。 */
export function everyTurnStatus(state, agentId, events, currentTurn) {
  const turns = splitTurns(events)
  const lock = lockStatus(lockOf(state, agentId), turns)
  const entry = everyTurnFor(state, agentId)
  if (entry === undefined) return { enabled: false, lock }
  const next = Number.isFinite(currentTurn) ? currentTurn : (turns.at(-1)?.turn ?? 0) + 1
  const result = replay(turns, entry, next)
  // 首轮段（issue #19 B）：下一轮发不发、为什么；「下一轮发一次」请求是否还在等。
  const first = firstPlan(entry, result, { lock: lockOf(state, agentId), turns, currentTurn: next })
  const oncePending = entry.firstOnce !== undefined && first.reason === 'once'
  const onceSent = entry.firstOnce !== undefined && !oncePending && turns.some((turn) => turn.turn >= entry.firstOnce.atTurn && turn.firstSent === true)
  return {
    enabled: true,
    mode: entry.mode,
    checks: entry.checks,
    nextTurn: next,
    ...result,
    ...(first.force ? { inject: true } : {}),
    lock,
    first: { has: entry.firstText !== '', willSend: first.useFirst, reason: first.reason, locked: first.locked, once: oncePending ? 'pending' : onceSent ? 'sent' : 'none' },
  }
}

/**
 * 世界书关键词条目（v0.6 二期，角色卡专用）：`state.lore[会话] = { enabled, scanDepth, budget, entries, char }`。
 * 只有套用了带关键词世界书的角色卡才会有这一格；没有时下面的注入逻辑完全不走。
 */
export function loreFor(state, agentId) {
  const entry = typeof agentId === 'string' ? state?.lore?.[agentId] : undefined
  if (entry === null || typeof entry !== 'object' || entry.enabled !== true) return undefined
  if (!Array.isArray(entry.entries) || entry.entries.length === 0) return undefined
  return entry
}

/** 故事记忆配置（三期）：只对套了角色卡、开着记忆的会话生效。 */
export function memoryFor(state, agentId) {
  const entry = typeof agentId === 'string' ? state?.memory?.[agentId] : undefined
  if (entry === null || typeof entry !== 'object' || entry.enabled !== true) return undefined
  return entry
}

/** 进行中的总结（会话 → Promise）：双座位、连续几轮都只跑一个。 */
const MEMORY_JOBS = (globalThis[Symbol.for('dsh-prefill.memoryJobs')] ??= new Map())
/** 每个会话最近一次注入的摘要版本（throughTurn）和轮号。 */
const MEMORY_INJECTED = (globalThis[Symbol.for('dsh-prefill.memoryInjected')] ??= new Map())
/** 每个会话最近一次发起总结时的轮数：同一轮（双座位）失败了也不重复发。 */
const MEMORY_TRIED = (globalThis[Symbol.for('dsh-prefill.memoryTried')] ??= new Map())
export function memoryJobs() {
  return [...MEMORY_JOBS.keys()]
}

/**
 * 把会话事件按轮切出「真实对话」：用户原话 + 角色回答正文（不含思维链、注入、工具结果）。
 * @returns [{ turn, who: 'user' | 'char', text }]
 */
export function dialogueByTurn(events) {
  const out = []
  let turn = 0
  for (const event of Array.isArray(events) ? events : []) {
    if (event?.type === 'turn/start') {
      turn = Number.isFinite(event.data?.turn) ? event.data.turn : turn + 1
    } else if (event?.type === 'user/message' && event.data?.source?.kind === 'user') {
      const text = messageText(event.data)
      if (text.trim() !== '') out.push({ turn, who: 'user', text })
    } else if (event?.type === 'assistant/message') {
      const text = messageText(event.data?.message)
      if (text.trim() !== '') out.push({ turn, who: 'char', text })
    }
  }
  return out
}

/**
 * 后台总结：旧记忆 + (throughTurn, completed] 这几轮的对话 → 新记忆，写回存储。
 * 不阻塞当前这一轮；失败只记诊断，下一轮还会再试。
 */
export async function summarizeMemory(api, agent, config, stored, completed) {
  const session = agent.session
  const from = Number(stored?.throughTurn) || 0
  const lines = dialogueByTurn(session?.snapshotEvents?.() ?? []).filter((line) => line.turn > from && line.turn <= completed)
  if (lines.length === 0) {
    api.memory.write(agent.id, { ...(stored ?? {}), throughTurn: completed })
    return
  }
  const rootCtx = api.rootCtx
  // Cordis：插件没声明 inject 时直接读 ctx.llm 会抛错，先走 ctx.get（和 resolveServices 的回退一致）。
  let llm
  try {
    llm = typeof rootCtx?.get === 'function' ? rootCtx.get('llm') : undefined
    if (llm === undefined) llm = rootCtx?.llm
  } catch {
    llm = undefined
  }
  const route = typeof session?.requestHeader === 'function' ? session.requestHeader()?.config : undefined
  if (llm === undefined || typeof llm.stream !== 'function' || typeof route?.provider !== 'string' || typeof route?.model !== 'string') {
    api.note({ memory: 'unavailable', id: agent.id, llm: llm !== undefined, route: route ?? null })
    return
  }
  const started = Date.now()
  const signal = AbortSignal.timeout(120000)
  let text = ''
  const closed = []
  for await (const chunk of llm.stream({
    provider: route.provider,
    model: route.model,
    system: memorySystemPrompt(config),
    messages: [
      {
        id: randomUUID(),
        role: 'user',
        source: { kind: 'prefill', prefill: 'memory-request' },
        content: [{ type: 'text', text: memoryInput(stored?.text, lines, config) }],
      },
    ],
    maxTokens: 4000,
    sessionId: session.id,
    purpose: 'compaction',
    signal,
  })) {
    if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
    else if (chunk?.type === 'block-end' && chunk.block?.type === 'text' && typeof chunk.block.text === 'string') closed.push(chunk.block.text)
  }
  const summary = cleanMemory(closed.length > 0 ? closed.join('') : text, config.maxChars)
  if (summary === '') {
    api.note({ memory: 'empty', id: agent.id, completed })
    return
  }
  api.memory.write(agent.id, { text: summary, throughTurn: completed, updatedAt: new Date().toISOString(), model: routeLabel(route) })
  api.note({ memory: 'updated', id: agent.id, from, through: completed, lines: lines.length, chars: summary.length, ms: Date.now() - started })
}

/** 记录用的模型名：有的 profile 里 route.model 已经带 provider 前缀（cline-pass/xxx），不再重复拼（issue #4）。 */
export function routeLabel(route) {
  const prefix = `${route.provider}/`
  return route.model.startsWith(prefix) ? route.model : `${prefix}${route.model}`
}

/** 一条消息里的纯文本（只取 text 段）。 */
function messageText(message) {
  const content = message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((part) => (part?.type === 'text' && typeof part.text === 'string' ? part.text : '')).join('')
}

/**
 * 本会话的注入改写（旧 `state.overrides[会话] ?? state.overrides['*']` 整格回落）。
 * 会话沙盒第 1 步起是规则表里 rewrite 族推回的同形状对象（见 sandbox.js resolveSandbox）。
 */
function overridesFor(state, agentId) {
  return resolveSandbox(state, agentId).rewrite
}

/**
 * **全局工具注册表**（与"放行与否"无关）——UI 的工具清单就取这里。
 *
 * 为什么不能用装配结果当清单：装配结果是 **restriction 之后**的。用户问得很对——
 * 一开"拦注入"（或把放行清单设小）装配结果里就 0 个工具，"扫一轮就有了"会变成
 * "越拦越扫不到"，甚至**永远为空**。所以清单必须来自注册表，而不是筛完的产物。
 * 挂 Symbol 以穿过内核热换。
 */
const TOOL_REGISTRY = (globalThis[Symbol.for('dsh-prefill.tools')] ??= new Set())

/**
 * **每会话的"注入原文"**：UI 要把原文显示出来（否则用户只能盲写改写）。
 *
 * 形状：`{ [sessionId]: { messages: {kind: text}, sections: {name: text}, contexts: {name: text} } }`
 * 来源：`step()` 里记 `decision.messages`（注意是**改写之前**的那份）、
 * `assemble` 监听器里记各段/各上下文的 `text`。挂 Symbol 以穿过内核热换。
 */
const ORIGINALS = (globalThis[Symbol.for('dsh-prefill.originals')] ??= new Map())

/** 单条原文的最大长度（避免 envelope 被超长段撑爆）。 */
const ORIGINAL_MAX = 20000

/** 记一条原文。 */
function rememberOriginal(sessionId, group, name, text) {
  if (typeof sessionId !== 'string' || sessionId === '' || typeof name !== 'string' || name === '') return
  if (typeof text !== 'string') return
  let entry = ORIGINALS.get(sessionId)
  if (entry === undefined) {
    entry = { messages: {}, sections: {}, contexts: {} }
    ORIGINALS.set(sessionId, entry)
  }
  entry[group][name] = text.length > ORIGINAL_MAX ? text.slice(0, ORIGINAL_MAX) : text
}

/** 工作区说明的原文：只记 DSH 发来的（不记我方改写 / 补发的），baseline 优先，中途补的不顶掉它。 */
function rememberWorkspaceOriginal(sessionId, messages) {
  if (!Array.isArray(messages)) return
  for (const message of messages) {
    if (message?.source?.kind !== WORKSPACE_KIND || message?.source?.prefill === WORKSPACE_MARK) continue
    if (message?.source?.baseline !== true && ORIGINALS.get(sessionId)?.messages?.[WORKSPACE_KIND] !== undefined) continue
    rememberOriginal(sessionId, 'messages', WORKSPACE_KIND, messageText(message))
  }
}

/** 往注册表里记名字。 */
function rememberToolNames(names) {
  for (const name of names ?? []) {
    if (typeof name === 'string' && name !== '') TOOL_REGISTRY.add(name)
  }
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
  if (levers.blockSections) return 'replace'
  return 'pass'
}

/** 读全部会话快照（UI / 诊断出口）。 */
export function snapshots() {
  return Object.fromEntries(SNAPSHOTS)
}

/**
 * 工具类注入名的判定 —— **只用于 UI 标注**，不再用于"禁止改写"。
 *
 * 早期版本（用户当时的要求）是"工具类一律忽略"。后来用户修订了：
 * 把**原文显示出来**之后改说明是安全的 —— 参数 schema 走 `request.header.tools`，
 * 不由这些文本决定，所以改说明不会破坏调用格式。UI 用它标注"工具说明"，
 * 提醒别把说明删干净（删了模型就不知道有这个工具了）。
 */
const TOOL_INJECTION = /^(tool|tools|mcp)/i

/** 这个名字是不是"工具说明"。 */
export function isToolInjection(name) {
  return typeof name === 'string' && TOOL_INJECTION.test(name)
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
  // 工具类名字**不再排除**（用户修订）：那些段只是"说明文字"，改它不会破坏调用格式 ——
  // 真正决定调用的是 `request.header.tools` 里的参数 schema，那个我们从不碰。
  // UI 会给工具类条目标注"工具说明"，提醒别把说明删干净（删了模型就不知道有这工具）。
  const catalog = {
    messages: [...KNOWN_MESSAGE_KINDS],
    sections: entryNames(layer?.sections).sort(),
    contexts: entryNames(layer?.contexts).sort(),
  }

  const textsOf = (id) => ORIGINALS.get(id) ?? { messages: {}, sections: {}, contexts: {} }
  const sessions = {}
  for (const [id, snap] of SNAPSHOTS) {
    sessions[id] = {
      messages: Array.isArray(snap.seenKinds) ? snap.seenKinds : [],
      sections: [],
      contexts: [],
      tools: 0,
      texts: textsOf(id),
    }
  }
  for (const [id, assembly] of ASSEMBLIES) {
    sessions[id] = {
      messages: sessions[id]?.messages ?? [],
      sections: assembly.sections,
      contexts: assembly.contexts,
      tools: assembly.tools,
      // 原文（给 UI 显示）：消息类来自 pre-step 观察，段/上下文来自装配。
      texts: textsOf(id),
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
  if (typeof agentId !== 'string') return state
  if (gate[agentId] === 'replace') {
    // 【替换】只换系统提示正文（一条 complete 段 = 用户写的那段），工具、运行时上下文、
    // 消息全部照旧 —— 典型用途：中文版官方系统提示，换语言但能力不变。
    return {
      ...state,
      armed: state.armed.includes(agentId) ? state.armed : [...state.armed, agentId],
      levers: {
        probeSection: false,
        probeContext: false,
        blockSections: true,
        blockContexts: false,
        blockTools: false,
        blockMessages: false,
      },
    }
  }
  // 纯净模式 = 沙盒严格档（旧 gate[会话] === 'pure'，读取时迁成 sandbox[会话].level = 'strict'）。
  if (resolveSandbox(state, agentId).level !== 'strict') {
    // 没被显式武装（armed / '*'）的会话 —— 典型是"只套了人格预设"的会话 —— 不吃全局开关：
    // 全局 levers 是开发面板 / 旧版「纯净模式」写的，若照搬，套个人格就会顺带
    // 清空系统提示、拦掉工具（实测踩到：人格会话 tools=0、runtime-context 被丢）。
    const explicit = state.armed.includes(agentId) || state.armed.includes('*')
    if (explicit) return state
    return {
      ...state,
      levers: Object.fromEntries(Object.keys(state.levers ?? {}).map((key) => [key, false])),
    }
  }
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
 * 纯净模式下清掉 `required: true` 的运行时上下文（issue #9）。
 *
 * 官方 `suppressRuntimeContext()` 只抑制可选上下文；required 的会在 `assemble()` 里保留、
 * 在 `refreshContext()` 里"缺了就补回"，在 `system-prompt/assemble` 瀑布里删也删不掉。
 * 对策（只作用于这一个 agent）：
 *   · 注册在**该 agent 自己作用域**里的（如 Agent Teams 的 `team:identity`）：
 *     同作用域不能再注册同名项，只能把那条注册的正文临时换成 ''（空正文的上下文渲染时会被丢掉），
 *     unlatch 时还原；
 *   · 继承来的（全局 / 上层作用域，如 `working-directory:current`）：在 agent 作用域注册一条
 *     同名、**非 required**、空正文的遮蔽项 ⇒ 合并后生效的是我们这条，suppress 自然把它去掉。
 * 恢复动作挂进 latch.disposers，随下一轮 unlatch 一起撤。返回本次新处理的名字。
 */
export function neutralizeRequiredContexts(api, scope, latch) {
  return neutralizeEntries(api, scope, latch, 'contexts', (name, entry) => entry?.required === true)
}

/**
 * 按条件把某个 agent 能看到的段 / 上下文注册清空（同上：本作用域改正文，继承项注册空遮蔽）。
 * `holder` 需有 `disposers` 数组；处理过的名字记在 `holder.neutralizedContexts` / `neutralizedSections`。
 */
export function neutralizeEntries(api, scope, holder, group, match) {
  const doneKey = group === 'sections' ? 'neutralizedSections' : 'neutralizedContexts'
  const done = (holder[doneKey] ??= new Set())
  const fresh = []
  let layers
  let sp
  try {
    const services = resolveServices(scope, api.rootCtx)
    sp = services.systemPrompt.service
    layers = sp?.layers ?? (typeof api.rootCtx?.get === 'function' ? api.rootCtx.get('systemPrompt')?.layers : undefined)
  } catch {
    return fresh
  }
  if (typeof layers?.merge !== 'function') return fresh
  let merged
  try {
    merged = layers.merge(scope, (layer) => layer[group])
  } catch {
    return fresh
  }
  const own = typeof layers.peek === 'function' ? layers.peek(scope)?.[group] : undefined
  const register = group === 'sections' ? sp?.section : sp?.context
  for (const [name, entry] of merged) {
    if (done.has(name) || String(name).startsWith('prefill:') || !match(name, entry)) continue
    try {
      if (own !== undefined && own.get(name) === entry) {
        const original = entry.text
        entry.text = ''
        holder.disposers.push(() => {
          if (entry.text === '') entry.text = original
        })
      } else if (typeof register === 'function') {
        holder.disposers.push(register.call(sp, { name, order: Number.isFinite(entry.order) ? entry.order : 1000, text: '' }))
      } else {
        continue
      }
      done.add(name)
      fresh.push(name)
    } catch {
      // 冻结对象 / 注册冲突：跳过这一条，别拖垮装配。
    }
  }
  return fresh
}

/** 每个 agent 一份「按名阻断」的挂载（名单变了就整份撤掉重挂）。 */
const BLOCK_HOLDERS = (globalThis[Symbol.for('dsh-prefill.block-holders')] ??= new Map())

function releaseBlockHolder(id) {
  const holder = BLOCK_HOLDERS.get(id)
  if (holder === undefined) return
  BLOCK_HOLDERS.delete(id)
  for (const dispose of holder.disposers.splice(0)) {
    try {
      dispose()
    } catch {
      // 随 scope 释放过的 disposer 会抛，忽略。
    }
  }
}

/** 已登记的名字：全局 prompt 层的段 / 上下文 + 常见消息来源。 */
function knownInjectionNames(rootCtx) {
  const layer = globalPromptLayer(rootCtx)
  return {
    messages: new Set(AUDIT_KNOWN_KINDS),
    sections: new Set(entryNames(layer?.sections)),
    contexts: new Set(entryNames(layer?.contexts)),
  }
}

/** 装配观察者里调用：审计作用域内注册的段 / 上下文，并按名阻断。返回过滤后的装配结果。 */
function applyAssemblyBlocks(api, id, scope, result, latch) {
  if (typeof id !== 'string') return result
  try {
    // 只记**真会进模型**的：段被本插件的 complete 段整份顶掉 / 上下文被 suppress 时，装配里列着也不算。
    const seen = {
      sections: latch?.frozenLevers?.blockSections === true ? [] : result?.sections,
      contexts: latch?.contextsSuppressed === true ? [] : result?.contexts,
    }
    const fresh = recordFindings(id, classifyAssembly(seen, knownInjectionNames(api.rootCtx)))
    if (fresh.length > 0) api.note({ audit: 'assembly', id, fresh })
  } catch {
    // 审计失败不影响装配。
  }
  const blocks = blocksFor(api.readState?.(), id, knownInjectionNames(api.rootCtx))
  const signature = JSON.stringify([[...blocks.sections].sort(), [...blocks.contexts].sort()])
  // 会话沙盒第 2 步：受控档 / 来源包拦下的工具（Agent Teams 的工具注册在 agent 自己作用域，restrict 拦不住，只能在装配结果里滤掉）。
  const toolBlocks = blocks.tools
  const withTools = (value) =>
    toolBlocks === undefined || !Array.isArray(value?.tools) ? value : { ...value, tools: value.tools.filter((tool) => !toolBlocks.has(tool?.name)) }
  let holder = BLOCK_HOLDERS.get(id)
  if (holder !== undefined && holder.signature !== signature) {
    releaseBlockHolder(id)
    holder = undefined
  }
  if (blocks.sections.size === 0 && blocks.contexts.size === 0) return withTools(result)
  if (holder === undefined) {
    holder = { signature, disposers: [] }
    BLOCK_HOLDERS.set(id, holder)
  }
  if (scope !== undefined) {
    neutralizeEntries(api, scope, holder, 'sections', (name) => blocks.sections.has(name))
    neutralizeEntries(api, scope, holder, 'contexts', (name) => blocks.contexts.has(name))
  }
  return withTools({
    ...result,
    sections: (result?.sections ?? []).filter((entry) => !blocks.sections.has(entry?.name)),
    contexts: (result?.contexts ?? []).filter((entry) => !blocks.contexts.has(entry?.name)),
  })
}

/** `session/event` 观察者：把落进会话、会进模型的未登记注入记下来。 */
export function auditEvent(api, session, event) {
  const id = session?.id
  if (typeof id !== 'string') return
  const findings = classifySurfaceEvent(event, knownInjectionNames(api.rootCtx), prestepKindsOf(id))
  const fresh = recordFindings(id, findings, event?.seq)
  if (fresh.length > 0) api.note({ audit: 'session', id, fresh })
}

/**
 * pre-step 的最外层：记下进来的消息来源（判断"能不能提前拦"），再按阻断名单丢消息。
 * 不论会话是否武装都跑 —— 阻断是会话级 / 全局的用户选择，跟纯净与否无关。
 */
export function applyMessageBlocks(api, payload, incoming, decision) {
  const id = payload?.agent?.id
  if (typeof id !== 'string') return decision
  notePrestepKinds(id, incoming?.messages)
  const blocks = blocksFor(api.readState?.(), id, knownInjectionNames(api.rootCtx))
  if (!hasBlocks(blocks)) return decision
  const { decision: next, dropped } = dropBlockedMessages(decision, blocks)
  if (dropped.length > 0) api.note({ blocked: 'messages', id, dropped })
  return next
}

export { auditSnapshot }

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
      // 工具清单：注册表（与放行无关）优先；装配观察到的名字作为补充（含 scope 局部工具）。
      try {
        const { tools: registryService } = resolveServices(context?.agent, api.rootCtx)
        rememberToolNames(restrictableToolNames(registryService.service, context?.agent))
      } catch {
        // 忽略。
      }
      rememberToolNames((result?.tools ?? []).map((tool) => tool?.name))
      // 段的原文（UI 要显示出来给用户改；工具类段的 text 也只是"说明文字"，
      // 真正决定调用格式的 schema 走 request.header.tools，不在这里）。
      for (const section of result?.sections ?? []) {
        rememberOriginal(id, 'sections', section?.name, section?.text)
      }
      for (const entry of result?.contexts ?? []) {
        rememberOriginal(id, 'contexts', entry?.name, entry?.text)
      }
      // Q17：顺手记下这次装配里有哪些段 / 上下文（UI 靠它列出"可改的注入"）。
      if (typeof id === 'string') {
        ASSEMBLIES.set(id, {
          sections: (result?.sections ?? []).map((section) => section.name),
          contexts: (result?.contexts ?? []).map((entry) => entry.name),
          tools: (result?.tools ?? []).length,
          // 工具名也存下来：它是"放行哪些工具"UI 的清单来源（Assembly 看到的即模型看到的）。
          toolNames: (result?.tools ?? [])
            .map((tool) => tool?.name)
            .filter((name) => typeof name === 'string'),
          at: Date.now(),
        })
      }
      // 用**本轮冻结的** lever，而不是实时状态：否则轮内翻开关会让线上装配
      // 与"挂载的 lever"不一致（半轮移除、半轮恢复）。
      const latch = typeof id === 'string' ? api.latches.get(id) : undefined
      const frozen = latch?.frozenLevers
      // 拦上下文：suppressRuntimeContext 只去掉"可选"上下文，`required: true` 的（Agent Teams 的
      // `team:identity`、工作目录 `working-directory:current` …）照样进运行时快照，而且 0.2.x 的
      // agent-loop 在 step() 里会 refreshContext() 重算快照、绕过 pre-step 直接写进会话 ⇒
      // 只能在注册表层面把它们清掉（见 neutralizeRequiredContexts）。
      let neutralized = []
      if (latch?.contextsSuppressed === true && context?.scope !== undefined) {
        neutralized = neutralizeRequiredContexts(api, context.scope, latch)
      }
      const unrequired = neutralized.length > 0 || latch?.neutralizedContexts?.size > 0
        ? { ...result, contexts: (result?.contexts ?? []).filter((entry) => !latch.neutralizedContexts.has(entry?.name)) }
        : result
      // 用户点过「阻断」的段 / 上下文（会话级 + 全局记住），顺带审计作用域内注册的贡献者。
      const filtered = applyAssemblyBlocks(api, id, context?.scope, unrequired, latch)
      const hit = frozen?.blockTools === true
      api.note({ blocker: 'system-prompt/assemble', id: typeof id === 'string' ? id : '(none)', frozen: frozen !== undefined, hit, ...(neutralized.length > 0 ? { neutralized } : {}) })
      if (!hit) return filtered
      return { ...filtered, tools: [] }
    },
    { prepend: true },
  )
  if (typeof dispose === 'function') BLOCKERS.set('root', dispose)
}

/**
 * 用户文本里的 `{{…}}`：dsh 默认会做变量插值，遇到未知变量会让整份系统提示装配抛错。
 * 只有全部引用都是 loop 提供的 `model` / `cwd` 时才插值，否则原样保留（interpolate:false）。
 */
function interpolateOk(text) {
  const refs = String(text ?? '').match(/\{\{[^}]*\}\}/g) ?? []
  return refs.every((ref) => /^\{\{\s*(model|cwd)\s*\}\}$/.test(ref))
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
  let completeDisposer
  // 是否挂了 suppressRuntimeContext：装配观察者据此再清掉 `required: true` 的上下文（见 neutralizeRequiredContexts）。
  let contextsSuppressed = false
  // 接管系统提示时，我方改写的段**并进那一条 complete 段**，不再单独注册。
  let sectionsFoldedIntoComplete = false
  if (state.levers.blockSections && typeof sp?.section === 'function') {
    if (COMPLETE_CONFLICTS.has(agent?.id)) {
      // 撞过车的会话直接走逐名清空：不再试探，省掉一次注定失败的装配。
      mountPerNameWipe(sp, rootCtx, agent?.id, overrideSectionNames, push)
    } else if (overrideSectionNames.length > 0) {
      // 【接管】用**一条带正文的 complete 段**一次性替换整份段列表 ⇒ 系统提示 = 用户写的那段，
      // 跟脚本直接调 API 一样。为什么不再用逐名清空：它只认得全局层登记过的名字，
      // agent 自己作用域里注册的段（如 `context:file-reference`）一清就撞
      // "already registered in this scope"，挂载链中途抛错 ⇒ 人格段根本没挂上、
      // 还残留 2954 字的 harness 段（实测）。
      const text = overrideSectionNames
        .map((name) => String(overrides.sections[name] ?? ''))
        .filter((value) => value.trim() !== '')
        .join('\n\n')
      completeDisposer = sp.section({ name: 'prefill:pure', order: 0, text, complete: true, ...(interpolateOk(text) ? {} : { interpolate: false }) })
      push(completeDisposer)
      sectionsFoldedIntoComplete = true
    } else {
      // 没有我方改写、也没撞过车：先用"一条清空"（最强：绝对接管整份段列表）。
      // ⚠️ 它同 scope 只能有一个：撞上 `pure` preset 会在 assemble() 抛错 ⇒
      // `step()` 的自检探针抓到后会当场换成逐名清空（见 swapToPerNameWipe）。
      completeDisposer = sp.section({ name: 'prefill:pure', order: 0, text: '', complete: true })
      push(completeDisposer)
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
    contextsSuppressed = true
  }
  // ── 工具放行：**不改工具说明，只管"能不能用"**（用户要求）──────────────────
  //   · 配了放行清单（会话级优先于全局）⇒ `restrict({ allow: 清单 })`
  //   · 没配但 lever 打开 ⇒ `restrict({ allow: [] })`（一个都不给）
  //   · 都没配 ⇒ 不干预
  // 清单先与官方 `restrictableNames` 求交集：`restrict()` 遇到未知名字会**抛错**，
  // 一个过期名字就能把该会话的挂载链搞挂（`dsh-tools:2908`）。
  // 会话级映射统一支持 `'*'` 通配（无头探针用），别只按键精确查——这个坑踩过一次。
  // 会话沙盒第 1 步：旧 sessionTools[会话] ?? sessionTools['*'] 现在是规则表的 tools 族（undefined = 没配，回落全局 state.tools）。
  const sandboxTools = resolveSandbox(state, agent?.id).toolAllow
  const wantedTools = sandboxTools !== undefined ? sandboxTools : state?.tools
  if (Array.isArray(wantedTools) && typeof toolService?.restrict === 'function') {
    const known = new Set(restrictableToolNames(toolService, agent))
    const allow = known.size === 0
      ? wantedTools.filter((name) => typeof name === 'string')
      : wantedTools.filter((name) => typeof name === 'string' && known.has(name))
    const dropped = known.size === 0 ? [] : wantedTools.filter((name) => !known.has(name))
    push(toolService.restrict({ allow }))
    if (dropped.length > 0) api.note({ tools_unknown_ignored: dropped, id: agent?.id })
    if (allow.length === 0) api.note({ tools_policy: 'none', id: agent?.id })
  } else if (state.levers.blockTools && typeof toolService?.restrict === 'function') {
    push(toolService.restrict({ allow: [] }))
  }

  // ── Q17：段 / 上下文改写的挂载（同名遮蔽）──────────────────────────────────
  // 工具类段**现在也允许改写**（用户修订）：段的 text 只是"说明文字"，
  // 参数 schema 走 `request.header.tools`，不由这里决定 ⇒ 改说明不会破坏调用格式。
  if (overrides !== undefined) {
    const orders = overrides.sectionOrders !== null && typeof overrides.sectionOrders === 'object' ? overrides.sectionOrders : {}
    if (!sectionsFoldedIntoComplete && overrides.sections !== null && typeof overrides.sections === 'object' && typeof sp?.section === 'function') {
      for (const [name, text] of Object.entries(overrides.sections)) {
        // 优先显式给的 order，其次沿用全局那段的原 order，最后才默认 1000。
        const order = Number.isFinite(orders[name]) ? orders[name] : (globalOrderOf(rootCtx, 'sections', name) ?? 1000)
        push(sp.section({ name, order, text: String(text), ...(interpolateOk(text) ? {} : { interpolate: false }) }))
      }
    }
    if (overrides.contexts !== null && typeof overrides.contexts === 'object' && typeof sp?.context === 'function') {
      for (const [name, text] of Object.entries(overrides.contexts)) {
        const order = Number.isFinite(orders[name]) ? orders[name] : (globalOrderOf(rootCtx, 'contexts', name) ?? 1000)
        push(sp.context({ name, order, text: String(text) }))
      }
    }
  }

  ensureToolsBlocker(api)

  return {
    disposers,
    // 交给 step()：一旦自检探针发现 `complete` 段撞车，就靠它撤掉再换逐名清空。
    completeDisposer,
    contextsSuppressed,
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
export async function prime(api, agent) {
  if (typeof agent?.id !== 'string') return
  // 装配观察者要赶在会话第一次装配之前挂上：注入审计 / 按名阻断都靠它，晚了首轮就漏。
  ensureToolsBlocker(api)
  // 工具清单在**武装判定之前**登记：清单与"放不放行"无关，且这样"开会话就有"，
  // 不必先跑一轮（拦注入开着的会话也一样能扫到）。
  try {
    const { tools: registryService } = resolveServices(agent, api.rootCtx)
    rememberToolNames(restrictableToolNames(registryService.service, agent))
  } catch {
    // 拿不到就算了（清单还能靠装配观察补）。
  }
  const state = effectiveStateFor(applyEnabled(api.readState()), agent.id)
  // 与 step() 的武装判定保持一致：**只配了注入改写（例如人格预设）**的会话也要急切挂载，
  // 否则首个请求的装配抢在 pre-step 之前 ⇒ 人格段"首轮不生效、第二轮才生效"。
  const hasOverrides = overridesFor(state, agent.id) !== undefined
  const hasInjects = queueOf(state, agent.id).length > 0 || everyTurnFor(state, agent.id) !== undefined
  if (!state.armed.includes(agent.id) && !state.armed.includes('*') && !hasOverrides && !hasInjects) return
  const disposers = []
  let error = ''
  let primedComplete
  let primedSuppressed = false
  try {
    const mounted = mountLevers(agent, state, api, disposers)
    primedComplete = mounted.completeDisposer
    primedSuppressed = mounted.contextsSuppressed === true
  } catch (thrown) {
    error = String(thrown?.message ?? thrown)
  }
  api.latches.set(agent.id, {
    turn: 'pending',
    disposers,
    ui: {},
    frozenLevers: state.levers,
    completeDisposer: primedComplete,
    contextsSuppressed: primedSuppressed,
  })
  api.note({ prime: 'agent/created', id: agent.id, mounted: disposers.length, error })

  // ★ R14 探测（**必须在这里**）：harness 在 `agent/created` 之后、轮次开始之前就会装配
  // 一次系统提示。如果我的 `complete:true` 段撞上别人（`pure` preset 的 persona），
  // **那次装配**就会抛错，而 `agent/pre-step` 根本没机会跑 —— 实测：step 一行日志都没有、
  // 直接 `turn/end error`，所以"在 step 的自检里换方案"救不到。
  // 这里抛错就当场撤掉 complete 段、换成逐名清空，再装配一次（顺便把渲染结果烧进缓存）。
  if (typeof primedComplete === 'function') {
    try {
      await computeRendered(agent)
    } catch (thrown) {
      const message = String(thrown?.message ?? thrown)
      if (message.includes('multiple complete prompt sections')) {
        const entry = api.latches.get(agent.id)
        const swapped = swapToPerNameWipe(agent, state, api, entry, primedComplete)
        if (entry !== undefined) entry.completeDisposer = undefined
        const conflict = rememberConflict(agent.id, 'complete-section', message)
        api.note({ complete_conflict: 'at-created', fell_back: swapped, conflict, id: agent.id })
        if (swapped?.ok === true) {
          try {
            await computeRendered(agent)
          } catch (second) {
            api.note({ complete_conflict: 'after-fallback-failed', error: String(second?.message ?? second) })
          }
        }
      } else {
        api.note({ prime: 'probe-failed', id: agent.id, error: message })
      }
    }
  }
}

/**
 * 首轮锁定（issue #19 A，turn-lock.js）：会话真正开跑的第 1 步（decision enter）还没有锁 ⇒ 请壳记一条。
 * 物化了开场对话的会话在 onInboxInserted 里已经锁过（带 items），这里只兜没有开场对话的会话、
 * 和本版之前就开跑的会话（日志里本轮之前已经有真实轮 ⇒ legacy：快照不是真正的开局配置）。
 */
function lockOnStep(api, agent, payload, decision) {
  if (typeof api?.lockSession !== 'function' || typeof agent?.id !== 'string') return
  if ((payload?.step ?? 1) !== 1 || decision?.kind !== 'enter' || !Number.isFinite(payload?.turn)) return
  try {
    if (lockOf(api.readState(), agent.id) !== undefined) return
    let events = []
    try {
      events = agent.session?.snapshotEvents?.() ?? []
    } catch {
      events = []
    }
    const earlier = firstRealTurn(splitTurns(events).filter((turn) => turn.turn < payload.turn))
    api.lockSession(agent.id, earlier !== undefined ? { turn: earlier, items: [], legacy: true } : { turn: payload.turn, items: [] })
  } catch (error) {
    api.note?.({ lock: 'failed', id: agent.id, error: String(error?.message ?? error) })
  }
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
  // 首轮锁定（issue #19 A）：每轮第 1 步发现还没有锁 ⇒ 记一条（不论是否武装；状态写入由壳做，已有就不动）。
  lockOnStep(api, agent, payload, decision)
  // M2：`state` 已经是"折算过按会话闸门"的有效状态（见 effectiveStateFor）。
  const state0 = effectiveStateFor(applyEnabled(readState()), payload?.agent?.id)
  // 三种情况都算"要接管这个会话"：
  //   ① 显式列进 armed；② 通配 `*`（探针）；③ **该会话配了注入改写** ——
  // ③ 是必需的：用户要的是"预填装留空、只改系统提示"，那种情况下没有任何 lever，
  // 光靠 armed 永远进不来，改写就静默不生效了。
  const hasOverrides = overridesFor(state0, agent?.id) !== undefined
  // ④ 会话配了**每轮注入**，或状态队列里有待发的手动注入：没有系统提示改写时也必须进来，
  // 否则注入静默不生效（实测：只写每轮注入、不套人格的会话，日志里一条注入消息都没有）。
  const hasInjects = queueOf(state0, agent?.id).length > 0 || everyTurnFor(state0, agent?.id) !== undefined
  // ⑤ 工作区说明设成关闭 / 改写：同样要进来（否则 AGENTS.md 原样照发）。
  const hasWorkspace = workspaceInstructionsFor(state0, agent?.id) !== undefined
  const armed =
    typeof agent?.id === 'string' &&
    (state0.armed.includes(agent.id) || state0.armed.includes('*') || hasOverrides || hasInjects || hasWorkspace)

  if (!armed) {
    note({
      seat: payload?.__seat,
      turn: payload?.turn,
      step: payload?.step,
      id: agent?.id,
      armed: false,
      armedList: state0.armed,
    })
    // 工作区说明的原文照样记（面板「工作区说明」要给原样模式的会话也显示读到了什么）。
    rememberWorkspaceOriginal(agent?.id, decision?.messages)
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
      allowed: allowKindsFor(state0, agent?.id),
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
  let completeDisposer = entry?.completeDisposer
  let contextsSuppressed = entry?.contextsSuppressed === true
  if (remounted) {
    unlatch(agent.id)
    const disposers = []
    contextsSuppressed = false
    try {
      const result = mountLevers(agent, state0, api, disposers)
      ui = result.ui
      completeDisposer = result.completeDisposer
      contextsSuppressed = result.contextsSuppressed === true
    } catch (error) {
      mountError = String(error?.message ?? error)
      ui = { mountError }
    }
    // 无论成功失败都存下来：partial 也要能清，否则泄漏成永久死锁。
    mounted = disposers.length
    latches.set(agent.id, {
      turn: payload?.turn,
      disposers,
      ui,
      frozenLevers: state0.levers,
      completeDisposer,
      contextsSuppressed,
    })
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
  // 记下**注入原文**（取自改写之前）：UI 要把原文显示出来，用户才知道自己在改什么。
  if (Array.isArray(decision?.messages)) {
    for (const message of decision.messages) {
      const kind = message?.source?.kind
      const text = Array.isArray(message?.content)
        ? message.content.map((part) => part?.text ?? '').join('')
        : ''
      if (typeof kind === 'string' && kind !== '' && !kind.startsWith('prefill')) {
        // 工作区说明：我方写的不算原文；记 baseline（首条），中途补的那几条不顶掉它。
        if (kind === WORKSPACE_KIND) {
          if (message?.source?.prefill === WORKSPACE_MARK) continue
          if (message?.source?.baseline !== true && ORIGINALS.get(agent.id)?.messages?.[kind] !== undefined) continue
        }
        rememberOriginal(agent.id, 'messages', kind, text)
      }
    }
  }
  let next = decision

  // ── Q17：单会话注入改写（"劫持注入"）────────────────────────────────────────
  // 作用点选在 `agent/pre-step` 的 `decision.messages` —— 这是**唯一**能改到
  // "已经生产出来、即将进模型"的消息的地方（运行时上下文由 `runtimeContext.project()`
  // 在装配前生成，改这里等价于改它的产物）。改写必须在过滤**之前**：先改内容，
  // 再决定放不放行。
  // practices P4：必须 spread，否则丢 `startsRequestSeries`。
  const overrides = overridesFor(state, agent.id)
  const workspace = workspaceInstructionsFor(state, agent.id)
  if (overrides?.messages !== undefined && decision?.kind === 'enter' && Array.isArray(decision.messages)) {
    const rewrites = overrides.messages
    const messages = decision.messages.map((message) => {
      const kind = message?.source?.kind
      if (typeof kind !== 'string' || !Object.hasOwn(rewrites, kind)) return message
      // 工作区说明设了关闭 / 改写：由下面那段管，高级改写不再套一层。
      if (kind === WORKSPACE_KIND && workspace !== undefined) return message
      overrode.push(kind)
      return { ...message, content: [{ type: 'text', text: String(rewrites[kind]) }] }
    })
    if (overrode.length > 0) next = { ...next, messages }
  }

  // ── 工作区说明（AGENTS.md / CLAUDE.md）：关闭 = 全丢；改写 = 首条换正文、之后的丢 ───────
  // 中途切换补一条说明（只追加，不改历史）。见 workspace-instructions.js。
  if (workspace !== undefined && decision?.kind === 'enter' && Array.isArray(next.messages)) {
    let history
    try {
      history = lastWorkspaceInHistory(agent.session)
    } catch {
      history = undefined
    }
    const result = applyWorkspaceInstructions(next.messages, workspace, { history, firstStep: (payload?.step ?? 1) === 1 })
    if (result.changed) {
      next = { ...next, messages: result.messages }
      if (result.rewritten || result.noticed) overrode.push(WORKSPACE_KIND)
      for (let index = 0; index < result.dropped; index += 1) droppedKinds.push(WORKSPACE_KIND)
      note({ workspace: workspace.mode, id: agent.id, turn: payload?.turn, step: payload?.step, dropped: result.dropped, rewritten: result.rewritten, noticed: result.noticed, history: history === undefined ? 'none' : history.ours ? 'ours' : 'original' })
    }
  }

  // "拦注入"只拦**非本插件**的注入：我方改写过的 kind 照发（发的是我们的版本）。
  // 否则会出现"开着拦注入、改写就静默失效"的怪状（实测 PURE 下 runtime-context 被丢）。
  const overriddenKinds = new Set(overrode)
  const keepMessage = (message) => {
    const kind = message?.source?.kind
    if (typeof kind === 'string' && overriddenKinds.has(kind)) return true
    return keeper(state, message, agent.id)
  }
  if (state.levers.blockMessages && decision?.kind === 'enter' && Array.isArray(next.messages)) {
    for (const message of next.messages) {
      if (!keepMessage(message)) droppedKinds.push(message?.source?.kind ?? '(none)')
    }
    if (droppedKinds.length > 0) {
      next = { ...next, messages: next.messages.filter((message) => keepMessage(message)) }
    }
  }

  // ── 手动注入 · 兜底通道（issue #19「C」，见 inject-once.js）─────────────────
  // 0.15.2 之前这里是「会话内注入」：开跑后把开场对话（state.injects）**每轮**渲染成一条注入消息。
  // 现在手动注入只发一次：正常走 agent.inbox（壳在点「注入」/ agent/created 时送进去，循环自己领取、
  // 写进会话日志）；这里只处理 inbox 送不进去时留在 state.injectQueue 里的条目。旧 injects 由壳在
  // 读状态时迁成每轮注入积木（migrateLegacyInjects），闸门不再读它。
  //
  // 只在每轮第 1 步（真实用户消息那一轮的 enter）插，位置同其他注入（最后一条真实用户消息之前；
  // 首轮有物化时，物化的开场在会话历史里、不在本次 messages 里，所以天然排在它之后）。
  // 去重 / 不丢的权衡：
  //   · 已送达 = 会话日志里有同 id 的手动注入 ⇒ 不发，并请壳从状态里删（api.pruneQueue）；
  //   · 本次插了也**不立刻删**：若这一步在写进日志前被中止，下一轮还会再发（不丢）；
  //     若已落盘，下一次 pre-step 看到日志就删（不重复）。
  //   · 双座位重入：本次 messages 里已有同 id ⇒ 不再插；同轮后续 step 不进这段；循环重试不重跑 pre-step。
  const queued = queueOf(state, agent.id)
  if (queued.length > 0 && decision?.kind === 'enter' && Array.isArray(next.messages)) {
    let events = []
    try {
      events = agent.session?.snapshotEvents?.() ?? []
    } catch {
      events = []
    }
    const { send, drop } = planQueued(queued, events, next.messages)
    if (drop.length > 0) {
      try {
        api.pruneQueue?.(agent.id, drop)
      } catch (error) {
        note({ manual: 'prune-failed', id: agent.id, error: String(error?.message ?? error) })
      }
    }
    if (send.length > 0 && (payload?.step ?? 1) === 1) {
      next = { ...next, messages: insertBeforeLastUser(next.messages, send.map(manualMessage)) }
      note({ manual: 'queued-sent', id: agent.id, turn: payload?.turn, ids: send.map((entry) => entry.id) })
    }
  }

  // ── 每轮注入（可选功能，`state.everyTurn`）─────────────────────────────────
  // 与上面"开跑后的预填装注入"不同：从**第 1 轮**起就生效，
  // 可设"只注入前 N 轮"。同样只在每轮第 1 步插、按 kind 查重（双座位会各进一次）。
  //
  // 「第几轮」按本会话**已注入过几次**数，不按 payload.turn：人格预设会先写一轮开场白
  // （turn 1 不调模型、也不经过这里的 enter），用户真正的第一句是 turn 2 —— 实测 E2 里
  // 按 payload.turn===1 判首轮，首轮专用段一次都没发出去。
  const everyTurn = everyTurnFor(state, agent.id)
  // 已注入几次、自动模式下这一轮发不发：都从会话事件重放（只看本轮之前的轮），
  // 同一轮经过多次（双座位、标题生成等旁路请求）结果一样，不会被旁路请求先吃掉首轮专用段。
  let plan
  let first
  let seam = false
  if (everyTurn !== undefined && Number.isFinite(payload?.turn) && (payload?.step ?? 1) === 1 && decision?.kind === 'enter') {
    let events = []
    try {
      events = agent.session?.snapshotEvents?.() ?? []
    } catch {
      events = []
    }
    const turns = splitTurns(events)
    plan = replay(turns, everyTurn, payload.turn)
    // 接缝提醒：从会话存下的预设开的新会话，开场历史里一句提醒都没有（存预设时注入被跳过），
    // 第一条真实消息那轮实测常常不听 ⇒ 这一轮发首轮段并附「以上历史均遵守这些要求，继续保持」。
    // 首轮段（issue #19 B）：只在会话第一条真实消息那轮发；开跑之后（锁住）默认跳过，
    // 除非用户点了「下一轮发一次」。以前按「本会话第一次注入」判，开跑后才打开 / 套用带首轮段的预设，
    // 第 N 轮会突然发出整段开场设定。
    first = firstPlan(everyTurn, plan, { lock: lockOf(state, agent.id), turns, currentTurn: payload.turn })
    if (first.force) plan = { ...plan, inject: true }
    // 接缝提醒只属于会话的第一条真实消息（开场导入历史之后那一轮）。
    seam = seamApplies(everyTurn, turns, plan.isFirst && !first.locked)
    if (everyTurn.mode === 'auto') {
      const last = plan.history.at(-1)
      note({ everyTurn: 'auto', id: agent.id, turn: payload.turn, state: plan.state, inject: plan.inject, streak: plan.streak, need: plan.need, resumes: plan.resumes, reason: plan.reason, lastTurn: last?.turn, lastVerdict: last?.verdict, lastScores: last?.scores })
    }
  }
  const isFirst = first?.useFirst === true
  const baseEveryTurnText =
    everyTurn === undefined ? '' : isFirst && everyTurn.firstText !== '' ? everyTurn.firstText : everyTurn.text
  const everyTurnText = seam ? withSeam(baseEveryTurnText) : baseEveryTurnText
  if (
    everyTurn !== undefined &&
    everyTurnText !== '' &&
    Number.isFinite(payload?.turn) &&
    plan?.inject === true &&
    (payload?.step ?? 1) === 1 &&
    decision?.kind === 'enter' &&
    Array.isArray(next.messages) &&
    !next.messages.some((message) => message?.source?.kind === 'prefill' && message?.source?.prefill === 'every-turn')
  ) {
    const messages = [...next.messages]
    // 消息形状自己拼，不再借 runtime-context 的：借来的 source 带着 `form:'snapshot'` 和整份
    // 运行时上下文的 `sections`（实测会话日志里每条注入都背着一份），而接管 / 纯净模式下
    // runtime-context 已被拦掉、根本借不到 ⇒ 两种模式下注入的形状不一致。
    const injected = {
      id: `prefill-everyturn-${payload.turn}`,
      role: 'user',
      // from / seam：给「存为预设」认约束来源用（constraint-carry.js），模型看不到 source。
      // first：这一轮发的是首轮段（或接缝那轮）—— 自动模式靠它把这一轮排除在判定外，「下一轮发一次」靠它知道已经发过。
      source: { kind: 'prefill', prefill: 'every-turn', from: everyTurn.from, first: isFirst || seam, ...(seam ? { seam: true } : {}) },
      // 必须套"背景"外壳：裸发正文时 step-5 把它当成用户本轮的要求，四段直接写进了回答正文、
      // 思维链反而不守格式（实测 D1：注入的 5 轮四段只命中 1 轮）；套上外壳后与 B2b 一致（13/14）。
      content: [{ type: 'text', text: renderInjectBlock([{ role: 'user', text: everyTurnText }]) }],
    }
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
    note({ everyTurn: 'done', id: agent.id, turn: payload.turn, nth: plan.nth, first: isFirst && everyTurn.firstText !== '', firstReason: first?.reason, seam, chars: everyTurnText.length, mode: everyTurn.mode, untilTurn: everyTurn.untilTurn, gate: state?.gate?.[agent.id] ?? 'pass' })
  }

  // ── 世界书关键词注入（v0.6 二期，只对套了角色卡的会话）────────────────────
  // 扫最近 scanDepth 条真实对话（用户原话 + 模型回答，不含任何注入），命中的条目渲染成一条
  // 背景消息插在本轮用户消息前。和每轮注入一样只在每轮第 1 步、按 kind 查重（双座位各进一次）。
  // 概率条目用「会话 + 轮号」做种子，两次经过结果一致。
  const lore = loreFor(state, agent.id)
  if (
    lore !== undefined &&
    Number.isFinite(payload?.turn) &&
    (payload?.step ?? 1) === 1 &&
    decision?.kind === 'enter' &&
    Array.isArray(next.messages) &&
    !next.messages.some((message) => message?.source?.kind === 'prefill' && message?.source?.prefill === 'lore')
  ) {
    // 本轮装配器手里只有这一轮的新消息；更早的对话从会话事件里取（用户原话 + 模型回答正文，不含思维链和注入）。
    const dialogue = []
    const seen = new Set()
    try {
      for (const event of agent.session?.snapshotEvents?.() ?? []) {
        if (event?.type === 'user/message' && event.data?.source?.kind === 'user') {
          if (typeof event.data.id === 'string') seen.add(event.data.id)
          dialogue.push(messageText(event.data))
        } else if (event?.type === 'assistant/message') {
          const text = messageText(event.data?.message)
          if (text !== '') dialogue.push(text)
        }
      }
    } catch {
      // 读不到历史就只看本轮。
    }
    for (const message of next.messages) {
      if (message?.source?.kind !== 'user' && message?.role !== 'assistant') continue
      if (typeof message.id === 'string' && seen.has(message.id)) continue
      dialogue.push(messageText(message))
    }
    const depth = Number(lore.scanDepth) > 0 ? Math.floor(Number(lore.scanDepth)) : 4
    const texts = dialogue.slice(-depth)
    const hits = matchLore(lore, texts, `${agent.id}:${payload.turn}`)
    if (hits.length > 0) {
      const messages = [...next.messages]
      const injected = {
        id: `prefill-lore-${payload.turn}`,
        role: 'user',
        source: { kind: 'prefill', prefill: 'lore' },
        content: [{ type: 'text', text: renderLore(hits, lore.char) }],
      }
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
    }
    note({ lore: hits.length > 0 ? 'done' : 'none', id: agent.id, turn: payload.turn, scanned: texts.length, hits: hits.map((entry) => entry.title || String(entry.id)) })
  }

  // ── 故事记忆（v0.6 三期，只对套了角色卡、开着记忆的会话）──────────────────
  // ① 有摘要就注入一条背景消息（插在本轮用户消息前，按 kind 查重）；
  // ② 已结束的轮数比上次总结多出 every 轮 ⇒ 后台发起一次总结，本轮不等它，下一轮起用新摘要。
  const memory = memoryFor(state, agent.id)
  if (
    memory !== undefined &&
    api.memory !== undefined &&
    Number.isFinite(payload?.turn) &&
    (payload?.step ?? 1) === 1 &&
    decision?.kind === 'enter' &&
    Array.isArray(next.messages)
  ) {
    const stored = api.memory.read(agent.id) ?? {}
    const already = next.messages.some((message) => message?.source?.kind === 'prefill' && message?.source?.prefill === 'memory')
    // 注入会落进会话历史，所以同一版摘要只注入一次（同一轮的两个座位都注入），新摘要出来再注入；
    // 插件重启后丢了记录就补注入一次。这样历史里不会每轮堆一份几百字的摘要。
    const through = Number(stored.throughTurn) || 0
    const last = MEMORY_INJECTED.get(agent.id)
    const fresh = last === undefined || last.through !== through || last.turn === payload.turn
    if (!already && fresh && typeof stored.text === 'string' && stored.text.trim() !== '') {
      MEMORY_INJECTED.set(agent.id, { through, turn: payload.turn })
      const messages = [...next.messages]
      const injected = {
        id: `prefill-memory-${payload.turn}`,
        role: 'user',
        source: { kind: 'prefill', prefill: 'memory' },
        content: [{ type: 'text', text: renderMemory(stored.text, memory.char) }],
      }
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
      note({ memory: 'injected', id: agent.id, turn: payload.turn, through: stored.throughTurn ?? 0, chars: stored.text.length })
    }
    const completed = payload.turn - 1
    if (!already && memoryDue(completed, stored.throughTurn, memory.every) && !MEMORY_JOBS.has(agent.id) && MEMORY_TRIED.get(agent.id) !== completed) {
      MEMORY_TRIED.set(agent.id, completed)
      note({ memory: 'start', id: agent.id, from: stored.throughTurn ?? 0, through: completed })
      const job = summarizeMemory(api, agent, memory, stored, completed)
        .catch((error) => note({ memory: 'failed', id: agent.id, error: String(error?.message ?? error) }))
        .finally(() => MEMORY_JOBS.delete(agent.id))
      MEMORY_JOBS.set(agent.id, job)
    }
  }

  // ── 自检：直接向装配器要一份"此刻到底装配成什么"的真相 ──────────────────
  // 为什么需要它：`system/message` 是**投影提交**的结果（round A 的探针段直到 step 2
  // 才落地），而单 step 的回合根本不提交 —— 只看日志会把"没提交"误判成"没生效"。
  // 装配器返回值才是权威。代价：多跑一次装配（provider 会被再求值一次），因此只在
  // 测阻断通道的那两轮（blockTools / blockSections）里、每轮重挂时测一次。
  let selfCheck
  // 探针跑的条件：老的"重挂那两轮"，**外加**"本轮挂了 complete 段"（要验它没撞车）。
  const needsProbe =
    (remounted && (state.levers.blockTools || state.levers.blockSections)) ||
    typeof completeDisposer === 'function'
  if (needsProbe) note({ probe: 'start', remounted, complete: typeof completeDisposer === 'function', id: agent?.id })
  if (needsProbe) {
    const probe = async () => {
      const { systemPrompt } = resolveServices(agent, rootCtx)
      return await systemPrompt?.assemble?.({ agent, scope: agent })
    }
    try {
      const result = await probe()
      selfCheck = {
        sections: (result?.sections ?? []).map((probed) => `${probed.name}(${probed.text.length})`),
        contexts: (result?.contexts ?? []).length,
        tools: (result?.tools ?? []).length,
      }
    } catch (error) {
      const message = String(error?.message ?? error)
      // ★ R14：`pure` preset 的 persona 已经占了 `complete:true` ⇒ 当场换方案，本轮不炸。
      if (message.includes('multiple complete prompt sections')) {
        const swapped = swapToPerNameWipe(agent, state, api, entry, completeDisposer)
        completeDisposer = undefined
        const conflict = rememberConflict(agent?.id, 'complete-section', message)
        note({ complete_conflict: 'at-pre-step', fell_back: swapped, conflict, id: agent?.id })
        selfCheck = { failed: message, fallback: swapped }
        if (swapped?.ok === true) {
          try {
            const result = await probe()
            selfCheck.afterFallback = {
              sections: (result?.sections ?? []).map((probed) => `${probed.name}(${probed.text.length})`),
              contexts: (result?.contexts ?? []).length,
              tools: (result?.tools ?? []).length,
            }
          } catch (error2) {
            selfCheck.afterFallback = { failed: String(error2?.message ?? error2) }
          }
        }
      } else {
        selfCheck = { failed: message }
      }
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
    allowed: allowKindsFor(state, agent.id),
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
 * 开场历史的系统提示对齐（约束承接 · 接缝）。
 *
 * 物化开场历史时写进去的 system/message 是 `agent/created` 那一刻渲染的（见 computeRendered），
 * 那时别的插件（如 Agent Teams）还没挂完段 ⇒ 和第一条真实消息那一步真正渲染出来的不一样。
 * dsh-agent-loop 的 SystemPromptProjection 发现「最新一条 system 节点 ≠ 本步渲染」就**追加**一条
 * system/message，线上它排在本轮用户消息和运行时上下文之后 —— 也就是模型生成前看到的最后一段，
 * 一整份系统提示，排在紧挨用户消息的每轮注入 / 接缝提醒之后；而且之后每轮的历史里都带着两份系统提示。
 *
 * 做法：第一条真实消息那一步（开场里有合成轮、还没有真实轮、system 节点只有开头那一条），
 * 在 `agent/request` 座位（step/start 已落盘、投影还没比较）把开头那条按本步的渲染结果原地替换掉
 * （带当前轮 / 步，否则会话日志校验不过）⇒ 投影比较时一致，不再追加。
 * 只改合成轮自己写的那条，条件不满足或失败就什么都不做（回到原行为）。
 * @param position { turn, step }：当前轮 / 步。
 */
export async function alignSyntheticSystemPrompt(agent, turns, position = {}) {
  const session = agent?.session
  const surface = session?.surface
  if (typeof session?.append !== 'function' || typeof session?.eventAt !== 'function' || typeof surface?.nodes?.[Symbol.iterator] !== 'function') {
    return { ok: false, reason: 'no-surface' }
  }
  if (!hasImportedHistory(turns) || turns.some((turn) => !turn.synthetic && turn.completed)) return { ok: false, reason: 'not-seam' }
  const nodes = []
  for (const seq of surface.nodes) {
    const event = session.eventAt(seq)
    if (event?.type === 'system/message') nodes.push({ seq, event })
  }
  if (nodes.length !== 1) return { ok: false, reason: `system-nodes:${nodes.length}` }
  let rendered
  try {
    const assembly = await systemPromptOf(agent)?.assemble?.({ agent, scope: agent })
    if (assembly === undefined) return { ok: false, reason: 'no-assembly' }
    rendered = renderPrompt(assembly)
  } catch (error) {
    return { ok: false, reason: `render:${String(error?.message ?? error)}` }
  }
  const [{ seq, event }] = nodes
  const current = (event.data?.message?.content ?? []).map((part) => (part?.type === 'text' ? part.text : '')).join('')
  if (current === rendered || rendered === '') return { ok: true, changed: false }
  session.append(
    'system/message',
    { turn: position.turn, step: position.step ?? 1, message: { role: 'system', content: [{ type: 'text', text: rendered }], source: { kind: 'system-prompt' }, id: randomUUID() } },
    { surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq }, sourceEventSeqs: [seq] },
  )
  return { ok: true, changed: true, from: current.length, to: rendered.length }
}

/**
 * `agent/request` 座位：此刻 step/start 已落盘、系统提示投影还没比较 ⇒ 正好对齐开场那条 system。
 * 只在每轮第 1 步、开场有合成轮且还没有真实轮时动手。
 */
export async function alignOnRequest(api, payload) {
  const agent = payload?.agent
  if (typeof agent?.id !== 'string' || !Number.isFinite(payload?.turn) || (payload?.step ?? 1) !== 1) return
  let events = []
  try {
    events = agent.session?.snapshotEvents?.() ?? []
  } catch {
    return
  }
  const turns = splitTurns(events)
  if (!hasImportedHistory(turns)) return
  try {
    const aligned = await alignSyntheticSystemPrompt(agent, turns, { turn: payload.turn, step: payload.step ?? 1 })
    if (aligned.reason !== 'not-seam') api.note({ alignSystem: aligned, id: agent.id, turn: payload.turn })
  } catch (error) {
    api.note({ alignSystem: { ok: false, reason: String(error?.message ?? error) }, id: agent.id, turn: payload.turn })
  }
}

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
  // 左栏「开场对话」关着：内容留在草稿里，不写进历史。
  if (!isEnabled(state, agentId, 'items')) return []
  if (DRAFTS.has(agentId)) return filledItems(DRAFTS.get(agentId))
  if (state?.levers?.prefillProbe === true) return resolveProbeItems()
  return []
}

// filledItems / renderInjectBlock 搬到 inject-once.js（旧 injects 迁移要用同一套），这里转出口保持原有导入不变。
export { filledItems }

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
  if (!prefillWanted(applyEnabled(api.readState()), agent.id)) return
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
  const state = applyEnabled(api.readState())
  if (!prefillWanted(state, agent.id)) return
  // 只在**用户原话**上物化；注入（runtime-context / skill-catalog 等）不算"发出"。
  if (message?.source?.kind !== 'user') return
  const session = agent.session
  if (session === null || typeof session?.append !== 'function') return
  if (hasTurn(session)) return
  // 首轮锁定（issue #19 A）：锁过的会话（已经开跑过）不再物化开场对话。hasTurn 本来就挡着，这里再加一道。
  if (lockOf(state, agent.id) !== undefined) {
    api.note({ prefill: 'skip-locked', id: agent.id })
    return
  }
  const rendered = PROMPTS.get(agent.id)
  if (rendered === undefined) {
    api.note({ prefill: 'no-cached-prompt', id: agent.id })
    return
  }
  const items = resolveItems(state, agent.id)
  const turns = writeSyntheticTurns(api, agent, session, rendered, items)
  if (typeof turns === 'number' && turns > 0) {
    // 物化成功 ⇒ 锁住：记下写进历史的开场对话和此刻的配置快照；第一条真实消息在第 turns + 1 轮。
    try {
      api.lockSession?.(agent.id, { turn: turns + 1, items: filledItems(items) })
    } catch (error) {
      api.note({ lock: 'failed', id: agent.id, error: String(error?.message ?? error) })
    }
    // 顺手把会话标题钉到**这次的真实提问**上（F18 收尾）。
    pinTitle(api, agent, session, message)
  }
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
/**
 * 从用户消息取会话标题：文本块拼起来、压空白，取前 24 个**字符**（按码点切，
 * 不按 UTF-16 码元 —— 否则 emoji 等代理对会被切成半个，标题末尾出现乱码 `\uFFFD`）。
 * 没有文本 ⇒ ''。
 */
export function titleOf(message, limit = 24) {
  const blocks = Array.isArray(message?.content) ? message.content : []
  const text = blocks
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  return Array.from(text).slice(0, limit).join('')
}

function pinTitle(api, agent, session, message) {
  const title = titleOf(message)
  if (title === '') return
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
  const state = applyEnabled(api.readState())
  if (!prefillWanted(state, agent.id)) return
  const session = agent.session
  if (session === null || typeof session?.append !== 'function') {
    api.note({ prefill: 'no-session', id: agent.id })
    return
  }
  if (hasTurn(session) || lockOf(state, agent.id) !== undefined) {
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
  const items = resolveItems(state, agent.id)
  const turns = writeSyntheticTurns(api, agent, session, rendered, items)
  if (typeof turns === 'number' && turns > 0) api.lockSession?.(agent.id, { turn: turns + 1, items: filledItems(items) })
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
/** 哪些会话的预填装已经写成真实历史（会话 → 条数）：输入框芯片据此显示"已写入历史"，而不是催你去点注入。 */
const MATERIALIZED = (globalThis[Symbol.for('dsh-prefill.materialized')] ??= new Map())
export function materialized() {
  return Object.fromEntries(MATERIALIZED)
}

export function writeSyntheticTurns(api, agent, session, rendered, items) {
  items = filledItems(items)
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

  MATERIALIZED.set(agent.id, items.length)
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
