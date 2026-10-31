/**
 * 手动注入（一次性，issue #19「C」）。
 *
 * 0.15.2 之前的「会话内注入」是**每轮**发：开跑后在开场对话区点「注入」，`state.injects[会话]`
 * 被闸门每轮渲染成一条注入消息。用户要的其实是「插一句话」——发一次、落进会话日志成为历史，
 * 之后作为历史重放，不再重复发。
 *
 * ── 通道（两条，优先第一条）────────────────────────────────────────────────
 *
 * ① **agent.inbox 的 next-step 队列**（与 dsh-agent-instructions 补 AGENTS.md 变更消息同一条路）：
 *    会话在册（拿得到 agent）时，点「注入」直接 `agent.inbox.append('next-step', 消息)`。
 *      · AI 正在跑：循环在**步骤之间**领取 next-step ⇒ 下一步就看到（插话）；本轮最后一步结束时
 *        队列不空，循环会再开一步（与官方 steer 同语义）。
 *      · 空闲：不唤醒（与 `agent.inject()` 同语义），随下一轮的排队提示词一起领取，排在用户原话之前。
 *      · 被领取的消息由循环自己写进会话日志（`user/message`），之后作为历史重放 ⇒ 天然只发一次，
 *        我们不维护「发后清除」。还没领取时撤回 / 编辑走 `inbox.remove` / `inbox.replace`。
 *    用 append 而不是 prepend：连点几条时保持先后顺序（agent-instructions 用 prepend 是因为
 *    它只有一条可替换的消息）。
 *
 * ② **状态队列 + 闸门 pre-step 插入**（兜底）：会话不在册（未加载 / 已卸载）时写进
 *    `state.injectQueue[会话] = [{ id, role, text, at }]`。
 *      · 会话 `agent/created` 时壳把队列整体搬进 inbox（走①），搬完从状态里删掉；
 *      · 万一搬不了（老版本没有 inbox），闸门在下一次 step 1（decision enter）把它插在最后一条
 *        真实用户消息之前——与旧 prefill-inject 同一个位置，循环照样把它写进会话日志。
 *      · 去重靠**会话日志**：日志里已有同 id 的手动注入 = 已送达 ⇒ 不再发、并从状态里删。
 *        插入后**不立刻删**：这一步若在写进日志前就被中止，下一轮还会再发（不丢）；若已写进日志，
 *        下一次 pre-step 看到日志里有它就删掉（不重复）。同一轮后续 step 本来就不插（只在 step 1），
 *        双座位重入靠「本轮消息里已有同 id」短路；循环的重试不重跑 pre-step。
 *
 * ── 角色 ────────────────────────────────────────────────────────────────
 * inbox 只收 user 消息，pre-step 插进去的消息循环也一律记成 `user/message`，所以「AI 回答」
 * 两条路都做不成真正的 assistant 消息：统一渲染成带标注的 user 消息（标注写明「视为 AI
 * 先前说过的话」），role 记在 `source.manual.role` 上。存回预设（session-history.js）时按
 * 这个 role 还原成对应角色的条目、去掉标注。
 *
 * 本文件是纯函数 + 对传入 agent 的操作，不读写 state.json（那是壳的事）。
 */
import { compileBench, migrateEveryTurn } from './blocks.js'

/** 手动注入消息的标记：`source = { kind: 'prefill', prefill: 'manual', manual: { id, role } }`。 */
export const MANUAL_MARK = 'manual'
export const MANUAL_ID_PREFIX = 'prefill-manual-'
/** 「AI 回答」角色的标注（只有 assistant 角色加；用户角色原话照发）。 */
// 措辞要坦白「这是用户补进来的」：实测写成「以下是你先前说过的话」时，模型会把它识别成伪造的
// AI 发言并否认（deepseek-flash，2026-10-27）。
export const ASSISTANT_HEAD = '【剧情补充 · 由用户添加】下面这段算作你（AI 一方）在这段对话里已经说过的话，是既成剧情：接着它往下写，不要否认、不要复述。'
export const MAX_TEXT = 20000
export const MAX_QUEUE = 50

/**
 * 只留"有正文"的条目（issue #1）：空行原样写进历史会让有的网关 400。
 * gate.js 也从这里取（旧 injects 迁移要用同一套规则）。
 */
export function filledItems(items) {
  if (!Array.isArray(items)) return []
  return items.filter((item) => typeof item?.text === 'string' && item.text.trim() !== '')
}

/**
 * 旧版「会话内注入」的渲染（模式 B）：一整块文本塞进一条注入消息。
 * 0.15.3 起只剩两处用：旧 `state.injects` 迁移成每轮注入积木时的文本、每轮注入的「背景」外壳。
 */
export function renderInjectBlock(items) {
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

/** 队列条目的规范形状；不合格 ⇒ undefined。 */
export function sanitizeEntry(raw) {
  if (raw === null || typeof raw !== 'object') return undefined
  const id = typeof raw.id === 'string' ? raw.id.trim().slice(0, 80) : ''
  const text = typeof raw.text === 'string' ? raw.text.slice(0, MAX_TEXT) : ''
  if (id === '' || text.trim() === '') return undefined
  return {
    id,
    role: raw.role === 'assistant' ? 'assistant' : 'user',
    text,
    at: typeof raw.at === 'string' && raw.at !== '' ? raw.at : new Date(0).toISOString(),
  }
}

/** 某会话的状态队列（规范化过；坏条目丢掉）。 */
export function queueOf(state, sessionId) {
  const list = typeof sessionId === 'string' ? state?.injectQueue?.[sessionId] : undefined
  if (!Array.isArray(list)) return []
  return list.map(sanitizeEntry).filter((entry) => entry !== undefined)
}

/** 发出去的正文：用户角色原话；AI 角色加标注。 */
export function renderManual(entry) {
  const text = String(entry?.text ?? '')
  return entry?.role === 'assistant' ? `${ASSISTANT_HEAD}\n${text}` : text
}

/** 从发出去的正文还原原话（session-history 用）。 */
export function unrenderManual(text, role) {
  const body = String(text ?? '')
  if (role !== 'assistant') return body
  if (body.startsWith(`${ASSISTANT_HEAD}\n`)) return body.slice(ASSISTANT_HEAD.length + 1)
  // 标注措辞改过（以后也可能再改）：首行是一整段【…】标注就去掉，旧日志里的也能还原。
  const match = /^【[^\n]*】[^\n]*\n/.exec(body)
  return match === null ? body : body.slice(match[0].length)
}

/** 是不是本插件的手动注入消息（消息对象或 user/message 事件的 data 都行）。 */
export function isManual(message) {
  return message?.source?.kind === 'prefill' && message?.source?.prefill === MANUAL_MARK
}

/** 手动注入消息的条目 id（不是就 ''）。 */
export function manualIdOf(message) {
  return isManual(message) && typeof message.source.manual?.id === 'string' ? message.source.manual.id : ''
}

/**
 * 条目 → 一条 user 消息（形状同 dsh-llm 的 createUserMessage：`{ content, source, role, id }`）。
 * 消息 id 由条目 id 派生：同一条目两次生成的消息 id 相同，inbox 的「同 id 不能重复挂起」也替我们兜一层。
 */
export function manualMessage(entry) {
  return {
    content: [{ type: 'text', text: renderManual(entry) }],
    source: { kind: 'prefill', prefill: MANUAL_MARK, manual: { id: entry.id, role: entry.role === 'assistant' ? 'assistant' : 'user' } },
    role: 'user',
    id: MANUAL_ID_PREFIX + entry.id,
  }
}

/** 消息 → 条目（inbox 里挂着的那些要显示在面板上）。 */
export function entryOfMessage(message) {
  const id = manualIdOf(message)
  if (id === '') return undefined
  const role = message.source.manual?.role === 'assistant' ? 'assistant' : 'user'
  const text = Array.isArray(message.content) ? message.content.map((part) => (part?.type === 'text' ? String(part.text ?? '') : '')).join('') : ''
  return { id, role, text: unrenderManual(text, role) }
}

/** 拿得到能用的 inbox 吗（ReactLoopInbox：nextStep / append / remove / replace）。 */
export function inboxOf(agent) {
  const inbox = agent?.inbox
  if (inbox === null || typeof inbox !== 'object') return undefined
  if (typeof inbox.append !== 'function' || typeof inbox.remove !== 'function') return undefined
  try {
    if (!Array.isArray(inbox.nextStep)) return undefined
  } catch {
    // 投影没注册（agent 已卸载）时读 nextStep 会抛。
    return undefined
  }
  return inbox
}

/** inbox 里还挂着（没被领取）的手动注入。 */
export function pendingInInbox(agent) {
  const inbox = inboxOf(agent)
  if (inbox === undefined) return []
  return inbox.nextStep.map(entryOfMessage).filter((entry) => entry !== undefined)
}

/** AI 正在跑吗（ReactLoopAgent.status：'idle' | 'running'）。 */
export function isRunning(agent) {
  try {
    return agent?.status === 'running'
  } catch {
    return false
  }
}

/**
 * 会话日志里已经送达的手动注入：`Map<条目 id, 轮号>`。
 * 送达 = 循环把它写成了 `user/message`（不论来自 inbox 还是 pre-step 插入）。
 */
export function deliveredIn(events) {
  const out = new Map()
  let turn = 0
  for (const event of Array.isArray(events) ? events : []) {
    if (event?.type === 'turn/start') turn = Number.isFinite(event.data?.turn) ? event.data.turn : turn + 1
    else if (event?.type === 'user/message') {
      const id = manualIdOf(event.data)
      if (id !== '' && !out.has(id)) out.set(id, turn)
    }
  }
  return out
}

/** 最近送达的几条（面板「已写入会话 · 第 N 轮」）。 */
export function recentDelivered(events, limit = 10) {
  const out = []
  let turn = 0
  for (const event of Array.isArray(events) ? events : []) {
    if (event?.type === 'turn/start') turn = Number.isFinite(event.data?.turn) ? event.data.turn : turn + 1
    else if (event?.type === 'user/message') {
      const entry = entryOfMessage(event.data)
      if (entry !== undefined) out.push({ ...entry, turn })
    }
  }
  return out.slice(-limit)
}

/**
 * 走 inbox 送一条（通道①）。拿不到 inbox ⇒ `{ ok: false }`，调用方退回状态队列。
 * 已在 inbox 里挂着（同 id）⇒ 不重复挂，算成功。
 */
export function deliverToInbox(agent, entry) {
  const inbox = inboxOf(agent)
  if (inbox === undefined) return { ok: false, reason: 'no-inbox' }
  const message = manualMessage(entry)
  if (inbox.nextStep.some((pending) => pending?.id === message.id)) return { ok: true, via: 'inbox', running: isRunning(agent), already: true }
  try {
    inbox.append('next-step', message)
  } catch (error) {
    return { ok: false, reason: String(error?.message ?? error) }
  }
  return { ok: true, via: 'inbox', running: isRunning(agent) }
}

/** 改 inbox 里还没领取的一条；已被领取 ⇒ false。 */
export function replaceInInbox(agent, entry) {
  const inbox = inboxOf(agent)
  if (inbox === undefined || typeof inbox.replace !== 'function') return false
  const message = manualMessage(entry)
  try {
    return inbox.replace(message.id, message) === true
  } catch {
    return false
  }
}

/** 撤回 inbox 里还没领取的一条；已被领取 ⇒ false。 */
export function removeFromInbox(agent, id) {
  const inbox = inboxOf(agent)
  if (inbox === undefined) return false
  try {
    return inbox.remove(MANUAL_ID_PREFIX + id) === true
  } catch {
    return false
  }
}

/**
 * 状态队列 → inbox（会话 agent/created 时、或会话在册时顺手搬）。
 * 已送达（日志里有）或已在 inbox 挂着的跳过；返回要从状态里删掉的 id（搬走的 + 已送达的）。
 */
export function flushQueueToInbox(agent, queue, events) {
  const done = []
  if (inboxOf(agent) === undefined) return { done, moved: 0 }
  const delivered = deliveredIn(events)
  let moved = 0
  for (const entry of queue) {
    if (delivered.has(entry.id)) {
      done.push(entry.id)
      continue
    }
    const result = deliverToInbox(agent, entry)
    if (result.ok) {
      done.push(entry.id)
      if (result.already !== true) moved += 1
    } else break // 保序：前一条送不进去，后面的也别越过它
  }
  return { done, moved }
}

/**
 * 闸门兜底（通道②）：本次 step 1 要插哪些条目、哪些可以从状态里删了。
 * @param queue 状态队列
 * @param events 会话日志（判断已送达）
 * @param messages 本次 decision.messages（判断双座位已插过 / inbox 已带进来）
 * @returns { send: 条目[], drop: 已送达的 id[] }
 */
export function planQueued(queue, events, messages) {
  const delivered = deliveredIn(events)
  const present = new Set((Array.isArray(messages) ? messages : []).map(manualIdOf).filter((id) => id !== ''))
  const send = []
  const drop = []
  for (const entry of queue) {
    if (delivered.has(entry.id)) drop.push(entry.id)
    else if (!present.has(entry.id)) send.push(entry)
  }
  return { send, drop }
}

/** 插在最后一条真实用户消息之前（没有就追加）——与其他注入同一个落点。 */
export function insertBeforeLastUser(messages, inserted) {
  const out = [...messages]
  let at = -1
  for (let index = out.length - 1; index >= 0; index -= 1) {
    if (out[index]?.source?.kind === 'user') {
      at = index
      break
    }
  }
  if (at >= 0) out.splice(at, 0, ...inserted)
  else out.push(...inserted)
  return out
}

// ── 旧 state.injects 的读取时迁移 ──────────────────────────────────────────

export const LEGACY_BLOCK_REF = 'my:legacy-inject'
export const LEGACY_BLOCK_NAME = '旧版会话内注入'

function legacyBlock(text) {
  return { key: 'legacy-inject', ref: LEGACY_BLOCK_REF, name: LEGACY_BLOCK_NAME, icon: '', first: '', text, checks: [], edited: false, priority: false, builtin: false }
}

/** 迁移工作台时的唯一 key：旧实现没传 makeKey，塔里展开出的多块会全叫 b1（改一块会同时改多块）。 */
function migrationKeyFactory() {
  let next = 0
  return () => `migrated-${++next}`
}

/** 条目的工作台：有 bench 用 bench；只有旧 text/firstText ⇒ 按 blocks.js 的规则迁成工作台。 */
function benchOf(entry, options) {
  if (entry === null || typeof entry !== 'object') return { bench: [], benchTowers: {} }
  if (Array.isArray(entry.bench) && entry.bench.length > 0) return { bench: entry.bench, benchTowers: entry.benchTowers ?? {} }
  const resolved = options !== null && typeof options === 'object' ? options : {}
  return migrateEveryTurn(entry, { ...resolved, makeKey: typeof resolved.makeKey === 'function' ? resolved.makeKey : migrationKeyFactory() })
}

/**
 * 旧 `state.injects[会话]`（开跑后点「注入」写的、每轮发）→ 该会话每轮注入工作台里的一块自定义积木，
 * 文本 = 原先每轮渲染出来的注入文本 ⇒ 仍然每轮发；然后删掉 injects 那一格。
 *
 * 规则（纯函数，幂等：迁过的不会再迁；中途断了重跑也只有一块 legacy 积木）：
 *   · 空条目（全是空行）：直接删。
 *   · 左栏「开场对话」关着（enabled.items === false）：旧行为是不发 ⇒ **先不迁**，原样留着
 *     （闸门已不再读 injects，所以照样不发）；以后打开开关，下次读状态时再迁。
 *   · 本会话已有每轮注入：积木追加到工作台末尾（替换掉同 ref 的旧 legacy 块），模式 / 轮数 / 自动参数沿用。
 *     本会话没有自己的格、但有「新会话默认」'*'：以 '*' 的工作台为底（否则迁完这个会话就丢了默认注入）。
 *     都没有：新建一格，模式 always。
 *   · 本会话每轮注入是关的：迁进去但保持关（取舍：不能为了让旧注入继续发，就把用户关掉的每轮注入
 *     一起打开；内容不丢，打开开关即恢复）。
 * @returns 新状态；没东西可迁 ⇒ 原对象。
 */
export function migrateLegacyInjects(state, options = {}) {
  const injects = state?.injects
  if (injects === null || typeof injects !== 'object' || Array.isArray(injects)) return state
  if (Object.keys(injects).length === 0) {
    const next = { ...state }
    delete next.injects
    return next
  }
  const everyTurn = state.everyTurn !== null && typeof state.everyTurn === 'object' ? { ...state.everyTurn } : {}
  const rest = { ...injects }
  let changed = false
  for (const [sid, items] of Object.entries(injects)) {
    const filled = filledItems(items)
    if (filled.length === 0) {
      delete rest[sid]
      changed = true
      continue
    }
    if (state.enabled?.[sid]?.items === false) continue
    const text = renderInjectBlock(filled)
    const own = everyTurn[sid] !== null && typeof everyTurn[sid] === 'object' ? everyTurn[sid] : undefined
    const wildcard = sid !== '*' && own === undefined && everyTurn['*']?.enabled === true ? everyTurn['*'] : undefined
    const baseEntry = own ?? wildcard
    const { bench: baseBench, benchTowers } = benchOf(baseEntry, options)
    const bench = [...baseBench.filter((block) => block?.ref !== LEGACY_BLOCK_REF), legacyBlock(text)]
    const compiled = compileBench(bench)
    const entry = {
      ...(baseEntry ?? {}),
      enabled: own === undefined ? true : own.enabled === true,
      text: compiled.text,
      firstText: compiled.firstText,
      checks: compiled.checks,
      mode: typeof baseEntry?.mode === 'string' ? baseEntry.mode : 'always',
      untilTurn: Number(baseEntry?.untilTurn) > 0 ? Math.floor(Number(baseEntry.untilTurn)) : 0,
      bench,
      benchTowers,
    }
    // 通配格的运行时字段属于别的会话，不能带过来（同 gate.js everyTurnFor）。
    if (wildcard !== undefined) {
      delete entry.since
      if (entry.auto !== null && typeof entry.auto === 'object') {
        entry.auto = { ...entry.auto }
        delete entry.auto.override
      }
    }
    everyTurn[sid] = entry
    delete rest[sid]
    changed = true
  }
  if (!changed) return state
  const next = { ...state, everyTurn }
  if (Object.keys(rest).length > 0) next.injects = rest
  else delete next.injects
  return next
}
