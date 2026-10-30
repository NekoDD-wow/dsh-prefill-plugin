/**
 * 会话沙盒 —— 直写会话通道的事后按条改写（issue #15 第 5 步）。
 *
 * 有些消息不经 inbox / pre-step，而是 DSH（或插件）在回合里直接写进会话日志：工具增删通知
 * `developer/message`（source.kind = tool-registry）、运行时上下文快照 `user/message`（runtime-context）、
 * 时间上下文、技能目录…… 闸门没法提前拦，只能在它落盘之后，用会话日志自己的「替换」操作改掉
 * 它在模型视图（surface）里的样子：
 *
 * - 追加一条**同类型**事件，带 `surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq }` 和
 *   `sourceEventSeqs`（必须含被遮住的节点；再带上最初那条原文的 seq，方便追溯）。
 *   和 dsh-compaction-basic 的压缩、dsh-agent-loop 的系统提示投影是同一个机制
 *   （`@deepseek-ai/dsh-session/lib/index.js` 的 planSurfaceEvent / assertSourceEventReferences）。
 * - developer/message：内容里不再有 tool-addition 时必须去掉 `headerSeq`（validateSessionEventData：
 *   「requires headerSeq exactly when tool additions are present」），否则追加 / 重放都会抛。
 *   **而且它是「步内事件」**：落盘日志的格式校验（dsh-session-format-v3-to-v4 的 Relationships.requireStep）要求
 *   developer/message 的 turn / step 正好是一个开着的轮 / 步 —— 空闲时追加，内存里的 Session 收下了，
 *   重启后加载会报「developer/message does not match an open turn and step」，整个会话打不开（实测踩到过）。
 *   所以 developer/message 的改写 / 还原空闲时只**登记**（status: pending / pending 字段），等下一步的
 *   `agent/request` 座位（step/start 已落盘、请求还没组装）带上当前轮 / 步再追加（applyPendingSurfaceEdits），
 *   和开场系统提示对齐（gate.alignSyntheticSystemPrompt）是同一个座位。
 * - user/message：除了内容和 id，其它（source 等）原样保留 —— 运行时上下文的 RuntimeContextProjection
 *   认 source.kind 和正文，改写后的快照照样被当成「最近一份」，下一步渲染不同就再追加一份新的。
 *   改成空不行（user 消息空内容会原样发给模型），要写一句占位。
 * - **只在会话空闲时改**（agent.status 不是 running、日志里没有没结束的轮）：回合中途改会和本步的投影、
 *   工具增删校验抢同一段 surface。user/message 不是步内事件，空闲时当场追加；developer/message 见上，
 *   空闲时登记、下一步开头落盘（那一刻还没组装请求，不和本步的投影抢）。
 * - **原文永远留在日志里**（替换只是遮住）；Web 界面的对话记录读的是 append 的原始事件，看到的仍是原文，
 *   只有模型视图变了。还原 = 再追加一次替换，内容换回原文（有工具新增就把原文的 headerSeq 带回来）。
 * - 必须勾选四条风险确认（SURFACE_RISKS）。改写记录存 `state.surfaceEdits[会话]`。
 *
 * 能改的：developer/message（任何来源）；user/message 里 source.kind 不是用户原话（user / user-rpc）、
 * 不是本插件（prefill*）、不是 DSH 协议（tool / compact-checkpoint / tombstone）的。system / assistant /
 * tool/result 不在这里改（系统提示有自己的编辑器；对话内容不归沙盒管）。
 *
 * @module @local/dsh-prefill/sandbox-surface
 */

import { randomUUID } from 'node:crypto'
import { PROTOCOL_KINDS } from './sandbox.js'

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/** 四条风险确认（面板上逐条勾选；少一条就拒绝）。 */
export const SURFACE_RISKS = ['log', 'conflict', 'cache', 'internal']

/** 每个会话最多留多少条改写记录（还原过的也算，超了丢最旧的已还原记录）。 */
const MAX_EDITS_PER_SESSION = 200
const PREVIEW_MAX = 400
const TEXT_MAX = 64 * 1024

const SELF_KINDS = new Set(['user', 'user-rpc', 'model'])

/** 消息正文预览（工具增删块写成 `tool-addition:名字`）。 */
export function contentPreview(content, max = PREVIEW_MAX) {
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => (typeof part?.text === 'string' ? part.text : typeof part?.toolName === 'string' ? `${part.type}:${part.toolName}` : part?.type ? `[${part.type}]` : ''))
    .filter((piece) => piece !== '')
    .join('\n')
    .slice(0, max)
}

/** 这条事件能不能事后改写；能的话返回 `{ type, name }`（name 与审计表同名：developer:<kind> / <kind>）。 */
export function surfaceTargetOf(event) {
  if (event?.type === 'developer/message') {
    const message = event.data?.message
    if (!Array.isArray(message?.content)) return undefined
    return { type: event.type, name: `developer:${message?.source?.kind ?? 'developer'}` }
  }
  if (event?.type === 'user/message') {
    const message = event.data
    const kind = message?.source?.kind
    if (typeof kind !== 'string' || !Array.isArray(message?.content)) return undefined
    if (SELF_KINDS.has(kind) || kind.startsWith('prefill') || PROTOCOL_KINDS.includes(kind)) return undefined
    return { type: event.type, name: kind }
  }
  return undefined
}

function messageOf(event) {
  return event?.type === 'user/message' ? event.data : event?.data?.message
}

/** 日志里有没有没结束的轮（turn/start 之后没有 turn/end）。 */
function openTurn(events) {
  let open = null
  for (const event of events) {
    if (event?.type === 'turn/start') open = event.data?.turn ?? true
    else if (event?.type === 'turn/end') open = null
  }
  return open
}

function eventsOf(session) {
  try {
    const events = session?.snapshotEvents?.()
    return Array.isArray(events) ? events : []
  } catch {
    return []
  }
}

/** 会话能不能现在改：在册、有 surface / append、空闲。 */
export function surfaceReady(agent) {
  const session = agent?.session
  if (session === undefined || session === null) return { ok: false, reason: 'not-live' }
  if (typeof session.append !== 'function' || typeof session.eventAt !== 'function' || typeof session.surface?.nodes?.[Symbol.iterator] !== 'function') {
    return { ok: false, reason: 'no-surface' }
  }
  if (agent?.status === 'running') return { ok: false, reason: 'busy' }
  if (openTurn(eventsOf(session)) !== null) return { ok: false, reason: 'busy' }
  return { ok: true }
}

/** 规范化 `state.surfaceEdits`：`{ [会话]: [{ id, seq, currentSeq, type, name, text, status, at, … }] }`。 */
export function sanitizeSurfaceEdits(raw) {
  const out = {}
  if (!isObject(raw)) return out
  for (const [sessionId, list] of Object.entries(raw)) {
    if (!Array.isArray(list)) continue
    const clean = list.filter(
      (entry) =>
        isObject(entry) &&
        typeof entry.id === 'string' &&
        Number.isSafeInteger(entry.seq) &&
        Number.isSafeInteger(entry.currentSeq) &&
        (entry.type === 'developer/message' || entry.type === 'user/message') &&
        typeof entry.name === 'string' &&
        typeof entry.text === 'string' &&
        ['active', 'pending', 'restored', 'gone'].includes(entry.status),
    )
    if (clean.length > 0) out[sessionId] = clean
  }
  return out
}

/** 本会话 surface 上能改的节点：`[{ seq, currentSeq, type, name, turn?, preview, edit? }]`（seq = 最初那条原文）。 */
export function surfaceCandidates(agent, edits = [], { name } = {}) {
  const session = agent?.session
  if (typeof session?.eventAt !== 'function' || typeof session?.surface?.nodes?.[Symbol.iterator] !== 'function') return []
  const active = new Map(edits.filter((edit) => edit.status === 'active' || edit.status === 'pending').map((edit) => [edit.currentSeq, edit]))
  const out = []
  let turn = null
  const turnOf = new Map()
  for (const event of eventsOf(session)) {
    if (event?.type === 'turn/start') turn = event.data?.turn ?? null
    turnOf.set(event?.seq, turn)
  }
  for (const seq of session.surface.nodes) {
    const event = session.eventAt(seq)
    const edit = active.get(seq)
    const original = edit !== undefined ? session.eventAt(edit.seq) : event
    const target = surfaceTargetOf(original)
    if (target === undefined) continue
    if (name !== undefined && name !== '' && target.name !== name) continue
    out.push({
      seq: edit?.seq ?? seq,
      currentSeq: seq,
      type: target.type,
      name: target.name,
      turn: turnOf.get(edit?.seq ?? seq) ?? null,
      preview: contentPreview(messageOf(original)?.content),
      ...(edit !== undefined ? { edit: { id: edit.id, text: edit.pending?.op === 'edit' ? edit.pending.text : edit.text, at: edit.at, ...(edit.status === 'pending' || edit.pending !== undefined ? { pending: edit.pending?.op ?? 'edit' } : {}) } } : {}),
    })
  }
  return out
}

/** 按原文那条事件造一条替换事件的 data（content 换掉；developer 的 headerSeq 按内容决定带不带）。 */
export function replacementData(original, content, position) {
  const hasAdditions = content.some((part) => part?.type === 'tool-addition')
  if (original.type === 'developer/message') {
    const { headerSeq, ...rest } = original.data
    if (hasAdditions && headerSeq === undefined) throw new Error('tool-addition needs the original headerSeq')
    // 步内事件：轮 / 步必须是当前开着的那一步（见文件头）。
    if (!Number.isSafeInteger(position?.turn) || !Number.isSafeInteger(position?.step)) throw new Error('developer/message replacement needs the open turn / step')
    return { ...rest, turn: position.turn, step: position.step, message: { ...original.data.message, id: randomUUID(), content }, ...(hasAdditions ? { headerSeq } : {}) }
  }
  return { ...original.data, id: randomUUID(), content }
}

function contentForText(type, text) {
  if (text === '') return type === 'developer/message' ? [] : undefined
  return [{ type: 'text', text }]
}

/**
 * 改写一条（会话必须空闲）。
 * @param agent 在册 agent
 * @param request `{ seq, text, risks }`：seq = 原文那条（或它当前的替换节点）；text = 改成什么（developer 可以是空 = 去掉这条）
 * @param edits 本会话已有的改写记录
 * @returns `{ ok, edit, edits }` / `{ ok: false, reason }`
 */
export function applySurfaceEdit(agent, request, edits = [], { position } = {}) {
  const risks = Array.isArray(request?.risks) ? request.risks : []
  const missing = SURFACE_RISKS.filter((risk) => !risks.includes(risk))
  if (missing.length > 0) return { ok: false, reason: 'risks-unconfirmed', missing }
  if (typeof request?.text !== 'string' || request.text.length > TEXT_MAX) return { ok: false, reason: 'bad-text' }
  if (!Number.isSafeInteger(request?.seq)) return { ok: false, reason: 'bad-seq' }
  const ready = surfaceReady(agent)
  if (!ready.ok) return ready
  const session = agent.session
  const nodes = [...session.surface.nodes]
  const existing = edits.find((edit) => (edit.status === 'active' || edit.status === 'pending') && (edit.seq === request.seq || edit.currentSeq === request.seq))
  const originalSeq = existing?.seq ?? request.seq
  const currentSeq = existing?.currentSeq ?? request.seq
  if (!nodes.includes(currentSeq)) return { ok: false, reason: 'not-on-surface' }
  const original = session.eventAt(originalSeq)
  const target = surfaceTargetOf(original)
  if (target === undefined) return { ok: false, reason: 'not-editable' }
  // DSH 0.2.1-rc.3 实测：任何 surface replace 都会让 contentGeneration +1，下一次请求开新的工具声明 series，
  // ToolHistoryProjection 清空 updates，series 之前的 developer/message（包括替换节点）一律不再投影给模型
  // （dsh-llm projectToolUpdates 只发 updates 里的 id；deepseek-flash 还是 toolUpdate: addition-only）。
  // 所以改写 developer/message 到不了模型，唯一效果是前缀缓存断一次 ⇒ 默认不让新改；已有的改写照样能再改 / 还原，
  // 显式 `developer: true` 才放行（留给以后宿主改了投影再开）。
  if (target.type === 'developer/message' && existing === undefined && position === undefined && request.developer !== true) return { ok: false, reason: 'developer-not-projected' }
  const content = contentForText(target.type, request.text)
  if (content === undefined) return { ok: false, reason: 'empty-user-message' }
  const current = session.eventAt(currentSeq)
  const at = new Date().toISOString().slice(0, 19)
  if (target.type === 'developer/message' && position === undefined) {
    // 空闲时只登记：下一步开头（agent/request）再落盘，见文件头。
    const edit = existing
      ? existing.status === 'pending'
        ? { ...existing, text: request.text, at }
        : { ...existing, pending: { op: 'edit', text: request.text }, at }
      : { id: randomUUID().slice(0, 8), seq: originalSeq, currentSeq, type: target.type, name: target.name, text: request.text, preview: contentPreview(messageOf(original)?.content, 200), risks: [...SURFACE_RISKS], status: 'pending', at }
    return { ok: true, changed: true, pending: true, edit, edits: trimEdits([...edits.filter((entry) => entry.id !== edit.id), edit]) }
  }
  if (contentPreview(messageOf(current)?.content, TEXT_MAX) === request.text && existing?.status === 'active') return { ok: true, changed: false, edit: existing, edits }
  const appended = session.append(target.type, replacementData(original, content, position), {
    surfaceOp: { op: 'replace', startSeq: currentSeq, endSeq: currentSeq },
    sourceEventSeqs: currentSeq === originalSeq ? [currentSeq] : [originalSeq, currentSeq].sort((a, b) => a - b),
  })
  const { pending: _pending, ...settled } = existing ?? {}
  const edit = existing
    ? existing.status === 'pending'
      ? { ...settled, status: 'active', currentSeq: appended.seq, text: request.text, at }
      : { ...settled, currentSeq: appended.seq, text: request.text, at, history: [...(existing.history ?? []), existing.currentSeq].slice(-20) }
    : {
        id: randomUUID().slice(0, 8),
        seq: originalSeq,
        currentSeq: appended.seq,
        type: target.type,
        name: target.name,
        text: request.text,
        preview: contentPreview(messageOf(original)?.content, 200),
        risks: [...SURFACE_RISKS],
        status: 'active',
        at,
      }
  return { ok: true, changed: true, edit, edits: trimEdits([...edits.filter((entry) => entry.id !== edit.id), edit]) }
}

/** 还原一条：再替换回原文（原文那条一直在日志里）。 */
export function restoreSurfaceEdit(agent, id, edits = [], { position } = {}) {
  const edit = edits.find((entry) => entry.id === id)
  if (edit === undefined) return { ok: false, reason: 'not-found' }
  // 还没落盘的改写：撤销登记就是还原（日志里什么都没动过）。
  if (edit.status === 'pending') return { ok: true, cancelled: true, edit: { ...edit, status: 'restored', restoredAt: new Date().toISOString().slice(0, 19) }, edits: edits.filter((entry) => entry.id !== id) }
  if (edit.status !== 'active') return { ok: false, reason: `already-${edit.status}` }
  const ready = surfaceReady(agent)
  if (!ready.ok) return ready
  const session = agent.session
  if (![...session.surface.nodes].includes(edit.currentSeq)) {
    // 被压缩 / 别的替换遮住了：没东西可还原（原文仍在日志里，只是模型视图里那一段整个换掉了）。
    const gone = { ...edit, status: 'gone', at: new Date().toISOString().slice(0, 19) }
    return { ok: false, reason: 'not-on-surface', edit: gone, edits: edits.map((entry) => (entry.id === id ? gone : entry)) }
  }
  const original = session.eventAt(edit.seq)
  if (surfaceTargetOf(original) === undefined) return { ok: false, reason: 'original-missing' }
  if (original.type === 'developer/message' && position === undefined) {
    const marked = { ...edit, pending: { op: 'restore' }, at: new Date().toISOString().slice(0, 19) }
    return { ok: true, pending: true, edit: marked, edits: edits.map((entry) => (entry.id === id ? marked : entry)) }
  }
  const content = messageOf(original).content
  const appended = session.append(original.type, replacementData(original, content, position), {
    surfaceOp: { op: 'replace', startSeq: edit.currentSeq, endSeq: edit.currentSeq },
    sourceEventSeqs: [edit.seq, edit.currentSeq].sort((a, b) => a - b),
  })
  const { pending: _pending, ...settled } = edit
  const restored = { ...settled, status: 'restored', restoredAt: new Date().toISOString().slice(0, 19), restoreSeq: appended.seq }
  return { ok: true, edit: restored, edits: edits.map((entry) => (entry.id === id ? restored : entry)) }
}

/**
 * 把登记着的 developer/message 改写 / 还原落盘（`agent/request` 座位调：step 已开、请求还没组装）。
 * @param position `{ turn, step }`：当前开着的轮 / 步
 * @returns `{ edits, applied: [{ id, op, ok, reason? }] }`（edits 没变时原样返回）
 */
export function applyPendingSurfaceEdits(agent, edits, position) {
  const applied = []
  let next = edits
  for (const edit of edits) {
    const op = edit.status === 'pending' ? 'edit' : edit.pending?.op
    if (op === undefined) continue
    // 「步里」的检查：surfaceReady 要求空闲，这里正相反 —— 只要求会话有 surface / append。
    const live = { ...agent, status: 'idle', session: withoutOpenTurn(agent.session) }
    let got
    try {
      got =
        op === 'restore'
          ? restoreSurfaceEdit(live, edit.id, next, { position })
          : applySurfaceEdit(live, { seq: edit.seq, text: edit.status === 'pending' ? edit.text : edit.pending.text, risks: edit.risks }, next, { position })
    } catch (error) {
      got = { ok: false, reason: String(error?.message ?? error) }
    }
    applied.push({ id: edit.id, op, ok: got.ok, ...(got.ok ? {} : { reason: got.reason }) })
    if (got.edits !== undefined) next = got.edits
    else if (!got.ok) {
      // 落不了（节点已被压缩 / 替换遮掉等）：登记作废，免得每一步都重试。
      next = next.flatMap((entry) => {
        if (entry.id !== edit.id) return [entry]
        if (entry.status === 'pending') return []
        const { pending: _pending, ...rest } = entry
        return [{ ...rest, lastError: got.reason }]
      })
    }
  }
  return { edits: next, applied }
}

/** surface 读写原样转给真会话，只把「有没有没结束的轮」那一项遮掉（步内落盘时轮本来就开着）。 */
function withoutOpenTurn(session) {
  return {
    surface: session.surface,
    eventAt: (seq) => session.eventAt(seq),
    append: (...args) => session.append(...args),
    snapshotEvents: () => [],
  }
}

/** impl.js 的 `agent/request` 座位：本会话有登记着的 developer/message 改写就落盘。 */
export function surfaceOnRequest(payload, { readState, patchState, note } = {}) {
  const agent = payload?.agent
  const sessionId = agent?.id
  if (typeof sessionId !== 'string' || !Number.isSafeInteger(payload?.turn)) return
  const all = sanitizeSurfaceEdits(readState?.()?.surfaceEdits)
  const edits = all[sessionId] ?? []
  if (!edits.some((edit) => edit.status === 'pending' || edit.pending !== undefined)) return
  const got = applyPendingSurfaceEdits(agent, edits, { turn: payload.turn, step: payload.step ?? 1 })
  const surfaceEdits = { ...all, [sessionId]: got.edits }
  if (got.edits.length === 0) delete surfaceEdits[sessionId]
  patchState?.({ surfaceEdits })
  note?.({ seat: 'sandbox-surface', op: 'apply-pending', sessionId, turn: payload.turn, step: payload.step ?? 1, applied: got.applied })
  return got
}

function trimEdits(list) {
  let out = list
  while (out.length > MAX_EDITS_PER_SESSION) {
    const index = out.findIndex((entry) => entry.status !== 'active' && entry.status !== 'pending')
    if (index === -1) break
    out = [...out.slice(0, index), ...out.slice(index + 1)]
  }
  return out
}

/**
 * 路由分支（sandbox-routes.js 的 `surface-*`）：
 *   surface-list    { sessionId, name? }              —— 能改的节点 + 改写记录 + 能不能现在改
 *   surface-edit    { sessionId, seq, text, risks }   —— 改写一条
 *   surface-restore { sessionId, id }                 —— 还原一条
 * @param deps `{ readState, patchState, liveAgents, note }`
 */
export async function surfaceRoute(op, body, deps) {
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
  if (sessionId === '') return { ok: false, op, reason: 'no-session' }
  const agent = deps.liveAgents?.get(sessionId)
  const all = sanitizeSurfaceEdits(deps.readState()?.surfaceEdits)
  const edits = all[sessionId] ?? []
  const save = (next) => {
    const surfaceEdits = { ...all, [sessionId]: next }
    if (next.length === 0) delete surfaceEdits[sessionId]
    deps.patchState({ surfaceEdits })
  }
  if (op === 'surface-list') {
    const ready = surfaceReady(agent)
    return { ok: true, op, ready: ready.ok, reason: ready.reason, risks: SURFACE_RISKS, candidates: surfaceCandidates(agent, edits, { name: typeof body?.name === 'string' ? body.name : undefined }), edits }
  }
  if (op === 'surface-edit') {
    const got = applySurfaceEdit(agent, { seq: body?.seq, text: body?.text, risks: body?.risks, developer: body?.developer === true }, edits)
    if (got.edits !== undefined && got.changed !== false) save(got.edits)
    deps.note?.({ seat: 'sandbox-surface', op, sessionId, seq: body?.seq, ok: got.ok, reason: got.reason ?? null, currentSeq: got.edit?.currentSeq ?? null })
    return { op, ...got, edits: undefined }
  }
  if (op === 'surface-restore') {
    const got = restoreSurfaceEdit(agent, typeof body?.id === 'string' ? body.id : '', edits)
    if (got.edits !== undefined) save(got.edits)
    deps.note?.({ seat: 'sandbox-surface', op, sessionId, id: body?.id, ok: got.ok, reason: got.reason ?? null })
    return { op, ...got, edits: undefined }
  }
  return { ok: false, op, reason: 'unknown-op' }
}
