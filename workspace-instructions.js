/**
 * 工作区说明（AGENTS.md / CLAUDE.md）：左栏「工作区说明」一项的闸门逻辑（纯函数，单测直接跑）。
 *
 * 来源：DSH 自带插件 dsh-agent-instructions 读 ~/.dsh/AGENTS.md + 项目根到 cwd 的
 * AGENTS.md / CLAUDE.md（及 .local），首个请求前作为一条 user/message 进来
 * （source.kind = 'agent-instructions'，source.baseline = true）；会话中途 read / write / edit
 * 碰到子目录或文件改了，再补同 kind 的消息（「This file changed after it was loaded…」）。
 *
 * 形状：`state.workspaceInstructions[会话] = { mode: 'off' } | { mode: 'rewrite', text }`，
 * 缺 = 原样（pass）。预设 / 导出只存这一份（模式 + 改写正文），**从不存文件原文**。
 * 左栏开关关掉（state.enabled[会话].workspace === false）= 按原样处理，设置保留。
 *
 * 三种模式：
 *   原样 —— 不碰。
 *   关闭 —— 丢掉所有 agent-instructions 消息（含中途补的）。
 *   改写 —— 本会话第一条换成用户的正文（source 原样保留：dsh-agent-instructions 靠
 *           source.baseline / baselineIdentity / changes 判断「已经发过」，保住它，下一步就不会
 *           再发一份 baseline，改写只进历史一次）；之后进来的同 kind 消息一律丢掉。
 *
 * 会话中途切换（历史里已有别的版本）：pre-step 只能改「这一步新进来的消息」，改不了历史。
 * 所以在下一轮第 1 步补一条同 kind 的说明（关闭：「之前的工作区说明不再适用」；改写：新正文
 * 取代之前的版本），历史里旧那份留着。只追加、不改历史，前缀缓存不受影响。
 */

export const WORKSPACE_KIND = 'agent-instructions'
/** 我方写出的 agent-instructions 消息在 source 上的标记。 */
export const WORKSPACE_MARK = 'workspace'

const OPEN = '<system-reminder>'
const CLOSE = '</system-reminder>'

/** djb2（与 enabled.js 同一份算法；这里单独写一份，免得两个模块互相引用）。 */
function print(text) {
  const source = String(text ?? '')
  let hash = 5381
  for (let at = 0; at < source.length; at += 1) hash = ((hash << 5) + hash + source.charCodeAt(at)) | 0
  return (hash >>> 0).toString(16)
}

/** 规范化一份设置；原样 / 无效 ⇒ undefined（状态 / 预设里都不存）。 */
export function sanitizeWorkspaceInstructions(raw) {
  if (raw === null || typeof raw !== 'object') return undefined
  if (raw.mode === 'off') return { mode: 'off' }
  if (raw.mode === 'rewrite') return { mode: 'rewrite', text: typeof raw.text === 'string' ? raw.text : '' }
  return undefined
}

/** 本会话生效的设置（只认本会话那一格；开关关着 ⇒ 原样）。 */
export function workspaceInstructionsFor(state, sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return undefined
  if (state?.enabled?.[sessionId]?.workspace === false) return undefined
  return sanitizeWorkspaceInstructions(state?.workspaceInstructions?.[sessionId])
}

/** 这份设置的签名：同一签名的我方消息已在历史里 ⇒ 不再补。 */
export function workspaceSignature(config) {
  if (config === undefined) return ''
  return config.mode === 'rewrite' ? `rewrite:${print(config.text)}` : 'off'
}

function frame(body) {
  return [OPEN, String(body).replaceAll(CLOSE, '<\\/system-reminder>'), CLOSE].join('\n')
}

/** 改写正文的外壳：已自带 <system-reminder> 的原样用。 */
export function rewriteText(text, { replacing = false } = {}) {
  const body = String(text ?? '')
  if (/^\s*<system-reminder>[\s\S]*<\/system-reminder>\s*$/.test(body)) return body
  const intro = replacing
    ? 'Workspace instructions, rewritten by the user. They replace all workspace instructions (AGENTS.md / CLAUDE.md) loaded earlier in this session. They do not override system, developer, or direct user instructions.'
    : 'Workspace instructions, rewritten by the user in place of the AGENTS.md / CLAUDE.md files in this workspace. They do not override system, developer, or direct user instructions.'
  return frame(`${intro}\n\n${body}`)
}

/** 中途关掉时补的那一条。 */
export const OFF_NOTICE = frame(
  'Workspace instructions were turned off by the user for the rest of this session. The workspace instructions (AGENTS.md / CLAUDE.md) loaded earlier no longer apply.',
)

function isWorkspace(message) {
  return message?.source?.kind === WORKSPACE_KIND
}
function isOurs(message) {
  return isWorkspace(message) && message?.source?.prefill === WORKSPACE_MARK
}

/**
 * 会话可见历史里最后一条 agent-instructions 消息（surface 优先：压缩后看不见的不算）。
 * 返回 `{ ours, signature }`，没有 ⇒ undefined。
 */
export function lastWorkspaceInHistory(session) {
  let events = []
  try {
    const nodes = session?.surface?.nodes
    if (nodes !== undefined && nodes !== null && typeof session?.eventAt === 'function') {
      for (const seq of nodes) events.push(session.eventAt(seq))
    } else if (typeof session?.snapshotEvents === 'function') {
      events = session.snapshotEvents()
    }
  } catch {
    events = []
  }
  let last
  for (const event of events) {
    if (event?.type !== 'user/message') continue
    const message = event.data?.message ?? event.data
    if (!isWorkspace(message)) continue
    last = message
  }
  if (last === undefined) return undefined
  return { ours: isOurs(last), signature: isOurs(last) ? String(last.source.prefillSig ?? '') : '' }
}

/**
 * 一步的处理。
 * @param messages decision.messages（这一步新进来的消息）
 * @param config workspaceInstructionsFor(...) 的结果
 * @param context `{ history: lastWorkspaceInHistory(...), firstStep: boolean }`
 * @returns `{ messages, dropped, rewritten, noticed, changed }`
 */
export function applyWorkspaceInstructions(messages, config, context = {}) {
  const result = { messages, dropped: 0, rewritten: false, noticed: false, changed: false }
  if (config === undefined || !Array.isArray(messages)) return result
  const signature = workspaceSignature(config)
  const history = context.history
  const mark = (source) => ({ ...source, prefill: WORKSPACE_MARK, prefillSig: signature })
  const text = config.mode === 'rewrite' ? String(config.text ?? '') : ''
  // 改写正文为空 = 等同关闭（不发一条空说明）。
  const rewriting = config.mode === 'rewrite' && text.trim() !== ''

  // 这一步里已经有我方同签名的那条（双座位第二次进来）⇒ 它留着，其余丢。
  const oursHere = messages.some((message) => isOurs(message) && message.source.prefillSig === signature)
  // 历史里最后一条就是我方同签名 ⇒ 本会话已生效，新进来的一律丢。
  const settled = oursHere || (history?.ours === true && history.signature === signature)

  const out = []
  let replacedFirst = false
  for (const message of messages) {
    if (!isWorkspace(message)) {
      out.push(message)
      continue
    }
    if (isOurs(message) && message.source.prefillSig === signature) {
      out.push(message)
      continue
    }
    if (!settled && history === undefined && rewriting && !replacedFirst && !isOurs(message)) {
      // 本会话第一条：换正文，source 保留（含 baseline 标记），只加我方标记。
      replacedFirst = true
      result.rewritten = true
      out.push({ ...message, source: mark(message.source), content: [{ type: 'text', text: rewriteText(text) }] })
      continue
    }
    result.dropped += 1
  }

  // 中途切换：历史里有别的版本（原文，或我方旧签名），这一轮第 1 步补一条。
  // 关闭 + 历史里只有我方「关闭」以外的东西 ⇒ 补「不再适用」；改写 ⇒ 补新正文。
  if (!settled && history !== undefined && context.firstStep === true) {
    const notice = rewriting ? rewriteText(text, { replacing: true }) : OFF_NOTICE
    // 历史里最后一条已是我方「关闭」且现在仍是关闭（签名相同）的情况上面 settled 已处理。
    const injected = {
      id: `prefill-workspace-${signature}`,
      role: 'user',
      source: { kind: WORKSPACE_KIND, form: 'instructions', changes: [], prefill: WORKSPACE_MARK, prefillSig: signature },
      content: [{ type: 'text', text: notice }],
    }
    let at = -1
    for (let index = out.length - 1; index >= 0; index -= 1) {
      if (out[index]?.source?.kind === 'user') {
        at = index
        break
      }
    }
    if (at >= 0) out.splice(at, 0, injected)
    else out.push(injected)
    result.noticed = true
  }

  result.changed = result.dropped > 0 || result.rewritten || result.noticed
  if (result.changed) result.messages = out
  return result
}
