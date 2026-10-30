/**
 * 注入审计 + 按名阻断（issue #9 的后续）。
 *
 * 思路：
 *   · 纯净模式自己保证干净（见 gate.js 的 neutralizeRequiredContexts）；
 *   · 其他会话**默认放行**，但盯着会话里实际落盘、会进模型的东西：凡是不在"已登记清单"
 *     （全局 prompt 层的段 / 上下文名 + 常见消息来源）里的，就记成「疑似未登记注入」；
 *   · 用户可以在「改写注入」面板里对某一条点「本会话阻断」，或「全局记住」——
 *     之后所有会话都提前拦掉。
 *
 * 状态形状（旧：state.json 顶层 `injectionBlocks`，UI 整体写回；现在读取时迁成 `state.sandbox` 的 deny 规则，见 sandbox.js）：
 * ```jsonc
 * "injectionBlocks": {
 *   "session-xxx": { "messages": ["agent-message"], "contexts": ["team:identity"], "sections": [] },
 *   "*": { "contexts": ["team:identity"] }        // 「全局记住」
 * }
 * ```
 *
 * 能拦到什么程度（实话实说，UI 会标出来）：
 *   · messages：走 inbox → `agent/pre-step` 进来的（队友消息、goal、schedule…）能在 pre-step 丢掉；
 *     DSH 自己在 step() 里直接写会话的（工具增删通知、压缩 checkpoint）只能记录，`blockable:false`；
 *   · contexts / sections：在注册表层面清掉（本作用域的注册改正文为空，继承来的注册空遮蔽项），
 *     对 required 上下文、step() 里的 refreshContext 一样有效。
 */

import { policyBlocks } from './sandbox.js'

/** 挂 Symbol 穿过内核热换。 */
const AUDIT = (globalThis[Symbol.for('dsh-prefill.injection-audit')] ??= new Map())
const PRESTEP_KINDS = (globalThis[Symbol.for('dsh-prefill.prestep-kinds')] ??= new Map())

/** 每个会话最多记多少条不同的注入（防止异常插件刷爆内存）。 */
const MAX_PER_SESSION = 64
const PREVIEW_MAX = 400

/** 视为"用户 / 模型 / 本插件自己"的消息来源，永不记。 */
const SELF_KINDS = new Set(['user', 'user-rpc', 'model', 'tool'])

/** 由 DSH 本体按规矩产生、面板早就列着的消息来源（不算"未登记"）。 */
export const KNOWN_MESSAGE_KINDS = [
  'runtime-context',
  'skill-catalog',
  'agent-instructions',
  'time-context',
  'session-reference',
  'tmux-context',
  'model-notice',
  'compact-checkpoint',
]

function previewOf(content) {
  if (typeof content === 'string') return content.slice(0, PREVIEW_MAX)
  if (!Array.isArray(content)) return ''
  const text = content
    .map((part) => {
      if (typeof part?.text === 'string') return part.text
      if (typeof part?.toolName === 'string') return `${part.type ?? ''}:${part.toolName}`
      return ''
    })
    .filter((piece) => piece !== '')
    .join('\n')
  return text.slice(0, PREVIEW_MAX)
}

/**
 * 把一条会话事件归类成 0..n 条"疑似未登记注入"。
 *
 * @param event - `session/event` 的事件 `{ type, seq, data }`。
 * @param known - `{ messages, contexts, sections }`（Set），已登记的名字。
 * @param prestepKinds - 本会话在 pre-step 里见过的消息来源（用来判断能不能提前拦）。
 */
export function classifySurfaceEvent(event, known, prestepKinds = new Set()) {
  const findings = []
  const type = event?.type
  // 替换事件（压缩 checkpoint、系统提示对齐、沙盒第 5 步的事后改写）不是新注入：原文那条已经记过了。
  if (event?.surfaceOp !== undefined && event.surfaceOp !== 'append') return findings
  if (type === 'user/message') {
    const message = event.data
    const kind = message?.source?.kind
    if (typeof kind !== 'string' || SELF_KINDS.has(kind) || kind.startsWith('prefill')) return findings
    if (kind === 'runtime-context') {
      // 运行时上下文：按 section 名看，有没有不在全局注册表里的贡献者（作用域内注册、动态注册……）。
      const sections = Array.isArray(message?.source?.sections) ? message.source.sections : []
      for (const section of sections) {
        const name = section?.name
        if (typeof name !== 'string' || name.startsWith('prefill:') || known.contexts.has(name)) continue
        findings.push({ group: 'contexts', name, preview: String(section?.text ?? '').slice(0, PREVIEW_MAX), blockable: true })
      }
      return findings
    }
    if (known.messages.has(kind)) return findings
    findings.push({ group: 'messages', name: kind, preview: previewOf(message?.content), blockable: prestepKinds.has(kind) })
    return findings
  }
  if (type === 'developer/message') {
    const message = event.data?.message
    const kind = message?.source?.kind ?? 'developer'
    findings.push({ group: 'messages', name: `developer:${kind}`, preview: previewOf(message?.content), blockable: false })
  }
  return findings
}

/** 装配里出现、但全局注册表里没有的段 / 上下文名（作用域内注册的插件贡献）。 */
export function classifyAssembly(assembly, known) {
  const findings = []
  for (const section of assembly?.sections ?? []) {
    const name = section?.name
    if (typeof name !== 'string' || name.startsWith('prefill:') || known.sections.has(name)) continue
    findings.push({ group: 'sections', name, preview: String(section?.text ?? '').slice(0, PREVIEW_MAX), blockable: true })
  }
  for (const entry of assembly?.contexts ?? []) {
    const name = entry?.name
    if (typeof name !== 'string' || name.startsWith('prefill:') || known.contexts.has(name)) continue
    findings.push({ group: 'contexts', name, preview: String(entry?.text ?? '').slice(0, PREVIEW_MAX), blockable: true })
  }
  return findings
}

/** 记下 pre-step 里见过的消息来源。 */
export function notePrestepKinds(sessionId, messages) {
  if (typeof sessionId !== 'string' || !Array.isArray(messages)) return
  let seen = PRESTEP_KINDS.get(sessionId)
  if (seen === undefined) PRESTEP_KINDS.set(sessionId, (seen = new Set()))
  for (const message of messages) {
    const kind = message?.source?.kind
    if (typeof kind === 'string') seen.add(kind)
  }
}

export function prestepKindsOf(sessionId) {
  return PRESTEP_KINDS.get(sessionId) ?? new Set()
}

/** 合并记录（同一 group+name 只记一条，计数、最近一次的预览和 seq）。 */
export function recordFindings(sessionId, findings, seq) {
  if (typeof sessionId !== 'string' || findings.length === 0) return []
  let table = AUDIT.get(sessionId)
  if (table === undefined) AUDIT.set(sessionId, (table = new Map()))
  const fresh = []
  for (const finding of findings) {
    const key = `${finding.group}:${finding.name}`
    const current = table.get(key)
    if (current === undefined) {
      if (table.size >= MAX_PER_SESSION) continue
      table.set(key, { ...finding, count: 1, firstSeq: seq ?? null, lastSeq: seq ?? null, at: Date.now() })
      fresh.push(key)
    } else {
      current.count += 1
      current.preview = finding.preview || current.preview
      current.blockable = current.blockable || finding.blockable
      if (seq !== undefined) current.lastSeq = seq
      current.at = Date.now()
    }
  }
  return fresh
}

/** 给面板的快照：`{ [会话]: [{ group, name, preview, blockable, count, … }] }`。 */
export function auditSnapshot() {
  return Object.fromEntries([...AUDIT].map(([id, table]) => [id, [...table.values()].map((entry) => ({ ...entry }))]))
}

/** 会话被清理时丢掉它的记录。 */
export function forgetSession(sessionId) {
  AUDIT.delete(sessionId)
  PRESTEP_KINDS.delete(sessionId)
}

/**
 * 本会话生效的阻断名单 = 会话级 ∪ 全局记住（'*'）。
 * 会话沙盒第 1 步（issue #15）起数据在 state.sandbox 的 deny 规则里；旧形状的 `state.injectionBlocks` 照样认（读取时迁移）。
 * 第 2 步：受控档 / 有来源包开关的会话逐条裁决（sandbox.js policyBlocks → decide），多一个 `tools`；
 * 其余会话还是 resolveSandbox 的 BlockSet（行为和第 1 步一样）。都不含 prefill:*（本插件不可阻断）。
 * @param known `{ messages, sections, contexts }`：已登记的名字（受控档里「已登记放行、未归属拦」用）。
 */
export function blocksFor(state, sessionId, known) {
  return policyBlocks(state, sessionId, known)
}

export function hasBlocks(blocks) {
  return blocks.messages.size > 0 || blocks.contexts.size > 0 || blocks.sections.size > 0
}

/** pre-step：丢掉被阻断来源的消息（用户原话和本插件自己的永不丢）。 */
export function dropBlockedMessages(decision, blocks) {
  if (blocks.messages.size === 0 || !Array.isArray(decision?.messages)) return { decision, dropped: [] }
  const dropped = []
  const messages = decision.messages.filter((message) => {
    const kind = message?.source?.kind
    if (typeof kind !== 'string' || kind === 'user' || kind.startsWith('prefill')) return true
    if (!blocks.messages.has(kind)) return true
    dropped.push(kind)
    return false
  })
  return dropped.length === 0 ? { decision, dropped } : { decision: { ...decision, messages }, dropped }
}
