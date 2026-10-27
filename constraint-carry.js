/**
 * 约束承接（constraint carry）：把会话「存为预设」时，当时靠每轮注入维持的行为（中文思考、人称、
 * 四段式、角色提醒……）一起带进新会话，并在新会话第一条真实消息那一轮补一次「接缝提醒」。
 *
 * 为什么要做（实测，DeepSeek deepseek-flash）：
 * - 存预设时开场历史只取用户原话和回答正文，所有 `source.kind === 'prefill'` 的注入都被跳过；
 *   原会话里模型每轮都看得到「上一轮的提醒 + 上一轮的中文思维链」，新会话的开场历史里两样都没有。
 * - 旧的「带上每轮注入」只带 `state.everyTurn[本会话]`：约束来自 `'*'`（新会话默认）时整份丢掉，
 *   新会话完全没有提醒 ⇒ 思维链全英文。
 * - 就算带上了，接缝那一轮（导入的几轮历史里一句提醒都没有，突然出现一句）也经常不听：
 *   4 次里 2 次第一轮仍用英文思考，之后几轮才回到中文。
 *
 * 这里全是纯函数：
 * - `detectConstraints(events, state, sessionId, opts)`：扫会话日志里实际发过的每轮注入，
 *   认出当时生效的积木（不论来自本会话、'*' 还是角色卡），给存预设面板列出来；
 * - `mergeCarried(carried, base)`：把勾上的积木编成预设里的 everyTurn（工作台形状，带 `seam: true`）；
 * - `seamLine` / `withSeam` / `unwrapInjected`：接缝提醒的文案与注入正文的拆包；
 * - `seamApplies(entry, turns, isFirst)`：gate.js 判断这一轮要不要发接缝提醒。
 */

/** 每轮注入消息的外壳（gate.js renderInjectBlock 的第一行和「用户：」前缀）。 */
const INJECT_HEAD = /^【预填装 · 会话内注入】[^\n]*\n?/
const USER_PREFIX = /^用户：/

/** 接缝提醒（附在首轮段后面）。中英两版：按约束正文里有没有汉字选。 */
export const SEAM_LINES = Object.freeze({
  zh: '以上历史均遵守这些要求，继续保持。',
  en: 'All of the conversation history above followed these requirements; keep following them.',
})

/** 「冲突时以此为准」前缀（与 blocks.js PRIORITY_PREFIX 相同；这里不 import，免得拉进面板专用逻辑）。 */
const PRIORITY_PREFIX = '（以下为用户补充，与上文冲突时以此为准）'

export function seamLine(text) {
  return /[\u4e00-\u9fff]/.test(String(text ?? '')) ? SEAM_LINES.zh : SEAM_LINES.en
}

/** 首轮段 + 接缝提醒。 */
export function withSeam(text) {
  const body = String(text ?? '').trim()
  return body === '' ? body : `${body}\n${seamLine(body)}`
}

/** 注入消息正文 → 当时发的约束文字（去外壳、去接缝提醒）。 */
export function unwrapInjected(text) {
  let body = String(text ?? '').replace(INJECT_HEAD, '').replace(USER_PREFIX, '')
  for (const line of Object.values(SEAM_LINES)) {
    if (body.endsWith(`\n${line}`)) body = body.slice(0, -(line.length + 1))
  }
  return body.trim()
}

function textOf(message) {
  const content = message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((part) => (part?.type === 'text' && typeof part.text === 'string' ? part.text : '')).join('')
}

/**
 * 会话里实际发过的每轮注入（只认 `prefill: 'every-turn'`；世界书 / 故事记忆 / 会话内注入不算约束）。
 * @returns [{ turn, text, from }]，from = 注入消息 source.from（新版 gate 才有：'session' | 'default'）
 */
export function injectedTexts(events, opts = {}) {
  const from = Number(opts.fromTurn) > 0 ? Math.floor(Number(opts.fromTurn)) : 1
  const to = Number(opts.toTurn) > 0 ? Math.floor(Number(opts.toTurn)) : Infinity
  const out = []
  let turn = 0
  for (const event of Array.isArray(events) ? events : []) {
    const data = event?.data ?? {}
    if (event?.type === 'turn/start') turn = Number.isFinite(data.turn) ? data.turn : turn + 1
    else if (event?.type === 'user/message') {
      const source = data?.source ?? {}
      if (source.kind !== 'prefill' || source.prefill !== 'every-turn') continue
      if (turn < from || turn > to) continue
      const text = unwrapInjected(textOf(data))
      if (text !== '') out.push({ turn, text, ...(typeof source.from === 'string' ? { from: source.from } : {}) })
    }
  }
  return out
}

/** 一份每轮注入配置 → 积木列表（有工作台按块拆；没有就整份算一块）。 */
export function configBlocks(cfg, source) {
  if (cfg === null || typeof cfg !== 'object') return []
  if (Array.isArray(cfg.bench) && cfg.bench.length > 0) {
    return cfg.bench
      .filter((block) => block !== null && typeof block === 'object')
      .map((block) => ({
        ref: typeof block.ref === 'string' ? block.ref : '',
        name: typeof block.name === 'string' ? block.name : '',
        first: String(block.first ?? ''),
        text: String(block.text ?? ''),
        checks: Array.isArray(block.checks) ? [...block.checks] : [],
        ...(block.priority === true ? { priority: true } : {}),
        ...(block.builtin === true ? { builtin: true } : {}),
        source,
      }))
      .filter((block) => block.first.trim() !== '' || block.text.trim() !== '')
  }
  const text = String(cfg.text ?? '')
  const first = String(cfg.firstText ?? '')
  if (text.trim() === '' && first.trim() === '') return []
  return [{ ref: '', name: '', first, text, checks: Array.isArray(cfg.checks) ? [...cfg.checks] : [], source }]
}

/** 积木在一段注入正文里出现的那几段（首轮段 / 后续段，含「以此为准」前缀的写法）。 */
function needles(block) {
  const out = []
  for (const raw of [block.first, block.text]) {
    const body = String(raw ?? '').trim()
    if (body === '') continue
    out.push(PRIORITY_PREFIX + body, body)
  }
  return out
}

function hashOf(text) {
  let h = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

/** 本会话那格的来源：套预设 / 角色卡写进来的（slotSource）还是本会话自己改的。 */
function ownSource(state, sessionId) {
  const from = state?.slotSource?.[sessionId]?.everyTurn?.from
  return from === 'card' ? 'card' : from === 'preset' ? 'preset' : 'session'
}

/**
 * 认出会话里生效过的约束。
 * @param events 会话事件
 * @param state 插件状态（读 everyTurn[会话] / everyTurn['*'] / slotSource）
 * @param opts { fromTurn, toTurn, catalog }：catalog = 内置积木清单（builtin-presets everyTurnBlocks()），
 *   用来给配置已改掉、但历史里发过的内置积木认名字。
 * @returns { constraints: [{ id, ref, name, first, text, checks, source, turns, lastTurn, checked }], injected }
 *   source：'session' | 'preset' | 'card'（本会话那格）、'default'（'*'）、'builtin'（只在历史里认出的内置积木）、
 *   'history'（历史里发过、哪份配置都对不上的原文）。
 *   checked：默认勾不勾 —— 历史里发过的、或本会话那格当前的配置都勾；旧版本的原文不勾。
 */
export function detectConstraints(events, state, sessionId, opts = {}) {
  const injected = injectedTexts(events, opts)
  const all = state?.everyTurn ?? {}
  const own = typeof sessionId === 'string' ? all?.[sessionId] : undefined
  const ownOk = own !== null && typeof own === 'object'
  const fallback = all?.['*']
  const catalog = Array.isArray(opts.catalog) ? opts.catalog : []
  // 没名字的整份配置（旧版没有工作台）：正文和某块内置积木一样就借它的名字。
  const named = (block) => {
    if (block.name !== '') return block
    const twin = catalog.find((preset) => String(preset?.text ?? '').trim() === block.text.trim() && String(preset?.firstText ?? '').trim() === block.first.trim())
    return twin === undefined ? block : { ...block, ref: block.ref || String(twin.id ?? ''), name: String(twin.name ?? ''), builtin: true }
  }
  const candidates = [
    ...(ownOk ? configBlocks(own, ownSource(state, sessionId)).map((block) => ({ ...block, own: true })) : []),
    ...configBlocks(fallback, 'default'),
    ...catalog.map((preset) => ({
      ref: String(preset?.id ?? ''),
      name: String(preset?.name ?? ''),
      first: String(preset?.firstText ?? preset?.first ?? ''),
      text: String(preset?.text ?? ''),
      checks: Array.isArray(preset?.checks) ? [...preset.checks] : [],
      builtin: true,
      source: 'builtin',
    })),
  ].map(named)
  // 每段注入正文：被认出的部分逐段挖掉，剩下的就是对不上任何配置的原文。
  const leftovers = injected.map((entry) => ({ ...entry, rest: entry.text }))
  const seen = new Set()
  const constraints = []
  for (const block of candidates) {
    const key = `${block.first.trim()}\u0000${block.text.trim()}`
    if (seen.has(key)) continue
    const keys = needles(block)
    let turns = 0
    let lastTurn = 0
    for (const entry of leftovers) {
      const hit = keys.filter((needle) => entry.rest.includes(needle))
      if (hit.length === 0) continue
      turns += 1
      lastTurn = Math.max(lastTurn, entry.turn)
      for (const needle of hit) entry.rest = entry.rest.split(needle).join('\n')
    }
    // 内置清单 / '*' 只收历史里真发过的；本会话那格即使还没发过也列出（= 旧版「带上每轮注入」的行为）。
    if (turns === 0 && block.own !== true) continue
    seen.add(key)
    constraints.push({
      id: `c${hashOf(key)}`,
      ref: block.ref,
      name: block.name,
      first: block.first,
      text: block.text,
      checks: block.checks,
      ...(block.priority === true ? { priority: true } : {}),
      ...(block.builtin === true ? { builtin: true } : {}),
      source: block.source,
      turns,
      lastTurn,
      checked: true,
    })
  }
  // 对不上的原文（配置后来改了 / 删了）：同一段只列一次，最新那一轮的默认勾上，更早的版本列出但不勾。
  const latest = injected.length > 0 ? Math.max(...injected.map((entry) => entry.turn)) : 0
  const extra = new Map()
  for (const entry of leftovers) {
    const rest = entry.rest
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .join('\n')
    if (rest === '') continue
    const found = extra.get(rest)
    if (found === undefined) extra.set(rest, { turns: 1, lastTurn: entry.turn })
    else {
      found.turns += 1
      found.lastTurn = Math.max(found.lastTurn, entry.turn)
    }
  }
  for (const [text, info] of [...extra.entries()].sort((a, b) => b[1].lastTurn - a[1].lastTurn)) {
    const key = `\u0000${text}`
    if (seen.has(key)) continue
    seen.add(key)
    constraints.push({ id: `c${hashOf(key)}`, ref: '', name: '', first: '', text, checks: [], source: 'history', turns: info.turns, lastTurn: info.lastTurn, checked: info.lastTurn === latest })
  }
  return { constraints, injected: injected.length }
}

const CHECKS = ['zh', 'four', 'noLeak', 'firstPerson']

/** 面板传回来的一条约束 → 干净的工作台块（只留已知字段、截断防呆）。 */
function benchItem(raw, index) {
  if (raw === null || typeof raw !== 'object') return null
  const first = typeof raw.first === 'string' ? raw.first.slice(0, 20000) : ''
  const text = typeof raw.text === 'string' ? raw.text.slice(0, 20000) : ''
  if (first.trim() === '' && text.trim() === '') return null
  const ref = typeof raw.ref === 'string' && raw.ref !== '' ? raw.ref.slice(0, 120) : `carry-${index + 1}`
  return {
    key: `c${index + 1}`,
    ref,
    name: typeof raw.name === 'string' ? raw.name.slice(0, 80) : '',
    icon: '',
    first,
    text,
    checks: Array.isArray(raw.checks) ? CHECKS.filter((id) => raw.checks.includes(id)) : [],
    edited: false,
    priority: raw.priority === true,
    builtin: raw.builtin === true,
  }
}

/**
 * 勾上的约束 → 预设里的 everyTurn 原始配置（交给 impl.js sanitizeEveryTurn 编译 / 校验）。
 * - 工作台形状：一条约束一块，顺序照列表；
 * - 模式 / 只注入前 N 轮 / 自动参数沿用本会话那格（base）；没有就「一直注入」；
 * - `seam: true`：新会话第一条真实消息那一轮发接缝提醒。
 * 一条都没勾 ⇒ undefined（预设不带每轮注入）。
 */
export function mergeCarried(carried, base) {
  const bench = (Array.isArray(carried) ? carried : []).map(benchItem).filter((item) => item !== null)
  if (bench.length === 0) return undefined
  const settings = base !== null && typeof base === 'object' ? base : {}
  return {
    enabled: true,
    bench,
    benchTowers: {},
    mode: settings.mode === 'auto' || settings.mode === 'until' || settings.mode === 'always' ? settings.mode : 'always',
    untilTurn: Math.max(0, Math.floor(Number(settings.untilTurn) || 0)),
    auto: settings.auto ?? {},
    seam: true,
  }
}

/** 会话里有没有预填装写进去的开场历史（合成轮）。 */
export function hasImportedHistory(turns) {
  return (Array.isArray(turns) ? turns : []).some((turn) => turn?.synthetic === true)
}

/** 这一轮发不发接缝提醒：配置带 seam、本会话还没发过每轮注入、而且开场里有导入的历史。 */
export function seamApplies(entry, turns, isFirst) {
  return entry?.seam === true && isFirst === true && hasImportedHistory(turns)
}
