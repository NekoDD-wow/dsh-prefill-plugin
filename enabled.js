/**
 * 面板左栏每一项的「启用开关」（v0.10 悬浮卡片）：关掉 = 停用但**保留内容**。
 *
 * 形状：`state.enabled[会话] = { card, lore, memory, system, everyTurn, items, inject }`，
 * 只有 `false` 才算关；缺键 / 缺整格 = 开（与旧状态兼容）。
 *
 * 服务端只在**组装提示 / 注入**时看它：闸门拿到的是 `applyEnabled(state)` 折算过的视图，
 * 停用项在视图里被摘掉；state.json 本身不动，面板读到的仍是原内容，重新打开即恢复。
 *
 * 各项停用后的效果：
 *   system    —— 系统提示段（prefill:persona）不发；替换 / 接管退回「不改」（接管时清零的工具一并恢复）。
 *   inject    —— 改写注入内容（overrides 里 persona 以外的全部改写）不生效。
 *   everyTurn —— 每轮注入不发（本会话显式记为关，不回落到「新会话默认」）。
 *   items     —— 开场对话不写入历史，会话开跑后的注入（injects）也不发。
 *   lore      —— 世界书不匹配、不注入。
 *   memory    —— 故事记忆不总结、不注入（已有摘要文件保留）。
 *   card      —— 角色卡只是角色扮演扩展：关掉它 = 世界书、故事记忆停用，另外**仍是套卡时原样**的
 *                系统提示 / 每轮注入 / 工具清单（按 cardRef.applied 里的指纹判断）也停用；
 *                你在套卡之后自己改过的那几项算你的，不受角色卡开关影响。
 */

export const FEATURES = ['card', 'lore', 'memory', 'system', 'everyTurn', 'items', 'inject']
export const PERSONA_SECTION = 'prefill:persona'

/** 简短指纹（djb2，32 位，十六进制）：客户端 client.js 里有同一份实现。 */
export function fingerprint(text) {
  const source = String(text ?? '')
  let hash = 5381
  for (let at = 0; at < source.length; at += 1) hash = ((hash << 5) + hash + source.charCodeAt(at)) | 0
  return (hash >>> 0).toString(16)
}

/** 每轮注入的指纹：正文 + 首轮段。 */
export function everyTurnFingerprint(entry) {
  return fingerprint(`${String(entry?.text ?? '')}\u0000${String(entry?.firstText ?? '')}`)
}

/** 工具清单的指纹（null / 缺省 = 全部放行，不算卡片设置）。 */
export function toolsFingerprint(tools) {
  return Array.isArray(tools) ? fingerprint(JSON.stringify(tools)) : ''
}

/** 只留已知键里的 `false`；全开 ⇒ undefined（预设 / 状态里都不存）。 */
export function sanitizeEnabled(raw) {
  if (raw === null || typeof raw !== 'object') return undefined
  const out = {}
  for (const key of FEATURES) if (raw[key] === false) out[key] = false
  return Object.keys(out).length > 0 ? out : undefined
}

/** 某会话某项是否开着（缺 = 开）。 */
export function isEnabled(state, sessionId, key) {
  return state?.enabled?.[sessionId]?.[key] !== false
}

/**
 * 「每轮注入」这一项开没开：左栏开关（state.enabled）与旧版条目自带的 enabled 一起看。
 *
 * 0.11 之前这个开关是面板里那个「启用」勾选框，写的是 state.everyTurn[会话].enabled；
 * 0.11 把开关搬到左栏，写的是 state.enabled[会话].everyTurn。两个开关并存会互相打架：
 * 勾选框关过、后来用左栏开关打开时，entry.enabled 还是 false ⇒ everyTurnFor() 返回 undefined，
 * 开关是开的、芯片点也是亮的，却一轮都不注入。所以旧值也算「关」，由左栏开关负责清掉它。
 * client.js 里有一份同规则的 everyTurnSwitchOn（面板不能 import 服务端模块），测试比对两者。
 */
export function everyTurnOn(state, sessionId) {
  if (state?.enabled?.[sessionId]?.everyTurn === false) return false
  const own = state?.everyTurn?.[sessionId]
  return !(own !== null && typeof own === 'object' && own.enabled === false)
}

const VIEWS = new WeakMap()

function withoutKey(map, key) {
  if (map === null || typeof map !== 'object' || !(key in map)) return map
  const next = { ...map }
  delete next[key]
  return next
}

/**
 * 折算启用开关后的状态视图（纯函数；同一个 state 对象只算一次）。
 * 不认识的会话、通配格 '*' 都原样保留。
 */
export function applyEnabled(state) {
  if (state === null || typeof state !== 'object') return state
  const map = state.enabled
  if (map === null || typeof map !== 'object') return state
  const cached = VIEWS.get(state)
  if (cached !== undefined) return cached
  let view = state
  for (const [sid, raw] of Object.entries(map)) {
    const flags = sanitizeEnabled(raw)
    if (sid === '*' || flags === undefined) continue
    view = maskSession(view, sid, flags)
  }
  VIEWS.set(state, view)
  return view
}

function maskSession(state, sid, flags) {
  const next = { ...state }
  const overrides = next.overrides?.[sid]
  let entry = overrides !== null && typeof overrides === 'object' ? overrides : undefined
  const persona = entry?.sections?.[PERSONA_SECTION]
  const applied = next.cardRef?.[sid]?.applied ?? null
  // 角色卡关：只摘「仍是套卡时原样」的那几项。
  let dropSystem = flags.system === false
  let dropEveryTurn = flags.everyTurn === false
  let dropCardTools = false
  if (flags.card === false && applied !== null && typeof applied === 'object') {
    if (typeof applied.system === 'string' && typeof persona === 'string' && fingerprint(persona) === applied.system) dropSystem = true
    const ownTurn = next.everyTurn?.[sid]
    if (typeof applied.everyTurn === 'string' && ownTurn && everyTurnFingerprint(ownTurn) === applied.everyTurn) dropEveryTurn = true
    if (typeof applied.tools === 'string' && applied.tools !== '' && toolsFingerprint(next.sessionTools?.[sid]) === applied.tools) dropCardTools = true
  }
  if (flags.card === false || flags.lore === false) next.lore = withoutKey(next.lore, sid)
  if (flags.card === false || flags.memory === false) next.memory = withoutKey(next.memory, sid)

  if (entry !== undefined && (dropSystem || flags.inject === false)) {
    const sections = { ...(entry.sections ?? {}) }
    const keepPersona = !dropSystem && typeof persona === 'string'
    const out = { messages: {}, sections: {}, contexts: {} }
    if (flags.inject !== false) {
      out.messages = { ...(entry.messages ?? {}) }
      out.contexts = { ...(entry.contexts ?? {}) }
      delete sections[PERSONA_SECTION]
      out.sections = sections
      if (entry.sectionOrders) out.sectionOrders = withoutKey(entry.sectionOrders, PERSONA_SECTION)
    }
    if (keepPersona) {
      out.sections[PERSONA_SECTION] = persona
      if (entry.sectionOrders?.[PERSONA_SECTION] !== undefined) out.sectionOrders = { ...(out.sectionOrders ?? {}), [PERSONA_SECTION]: entry.sectionOrders[PERSONA_SECTION] }
    }
    // 留一格空表（而不是删掉）：删掉会让闸门回落到通配格 '*'。
    next.overrides = { ...next.overrides, [sid]: out }
  }
  if (dropSystem) {
    const mode = next.gate?.[sid]
    if (mode === 'pure' || mode === 'replace') {
      next.gate = { ...next.gate, [sid]: 'pass' }
      // 接管时清零的工具是系统提示模式带来的，一并恢复。
      if (mode === 'pure') dropCardTools = true
    }
    if (Array.isArray(next.armed) && next.armed.includes(sid)) next.armed = next.armed.filter((id) => id !== sid)
  }
  if (dropCardTools) next.sessionTools = withoutKey(next.sessionTools, sid)
  if (dropEveryTurn && next.everyTurn !== null && typeof next.everyTurn === 'object') {
    // 显式记成关：不回落到「新会话默认」。
    next.everyTurn = { ...next.everyTurn, [sid]: { enabled: false } }
  } else if (dropEveryTurn) next.everyTurn = { [sid]: { enabled: false } }
  if (flags.items === false) next.injects = withoutKey(next.injects, sid)
  return next
}
