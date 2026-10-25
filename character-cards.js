/**
 * 角色卡（角色扮演模式扩展，v0.6 一期）。
 *
 * 只做两件事，都是纯函数：
 *   1. `parseCard` / `cardFromPng`：把 SillyTavern V1 / V2 / V3 卡（JSON 或 PNG 里的 `chara`/`ccv3` 文本块）
 *      规整成一份 V2 形状的卡；
 *   2. `compileCard`：把卡编译成插件**现有机制**认识的东西 —— 人设段正文、系统提示模式（追加 / 接管）、
 *      开场白 items、工具放行、每轮注入配置。
 * 本模块不读写状态、不碰闸门；套用仍走原有的系统提示 / 草稿 / 每轮注入路径（规划-角色卡 §1）。
 *
 * @module @local/dsh-prefill/character-cards
 */

/** 我们自己的扩展字段名（放在 `data.extensions` 下）。 */
export const EXT_KEY = 'dsh_prefill'

const STRING_FIELDS = [
  'name',
  'description',
  'personality',
  'scenario',
  'first_mes',
  'mes_example',
  'creator_notes',
  'system_prompt',
  'post_history_instructions',
  'creator',
  'character_version',
]

const str = (value) => (typeof value === 'string' ? value : '')

/**
 * 规整成 V2 形状：`{ spec: 'chara_card_v2', spec_version: '2.0', data: {...} }`。
 * 接受：V2/V3 对象、V1 平铺对象、JSON 字符串。认不出来返回 `undefined`。
 */
export function parseCard(input) {
  let raw = input
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch {
      return undefined
    }
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const nested = raw.data !== null && typeof raw.data === 'object' && !Array.isArray(raw.data)
  const source = nested ? raw.data : raw
  // V1 平铺卡偶尔用 `char_name` / `char_persona` / `world_scenario` / `example_dialogue`。
  const data = {}
  for (const field of STRING_FIELDS) data[field] = str(source[field])
  if (data.name === '') data.name = str(source.char_name)
  if (data.description === '') data.description = str(source.char_persona)
  if (data.scenario === '') data.scenario = str(source.world_scenario)
  if (data.first_mes === '') data.first_mes = str(source.char_greeting)
  if (data.mes_example === '') data.mes_example = str(source.example_dialogue)
  data.name = data.name.trim()
  if (data.name === '') return undefined
  data.alternate_greetings = Array.isArray(source.alternate_greetings) ? source.alternate_greetings.filter((g) => typeof g === 'string' && g.trim() !== '') : []
  data.tags = Array.isArray(source.tags) ? source.tags.filter((tag) => typeof tag === 'string' && tag.trim() !== '').map((tag) => tag.trim()) : []
  data.character_book = source.character_book !== null && typeof source.character_book === 'object' ? source.character_book : null
  data.extensions = source.extensions !== null && typeof source.extensions === 'object' && !Array.isArray(source.extensions) ? source.extensions : {}
  return { spec: 'chara_card_v2', spec_version: '2.0', data }
}

// ── PNG ──────────────────────────────────────────────────────────────────────

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** 读 PNG 里的 `tEXt` 块，返回 `{ keyword: text }`（latin1）。 */
export function pngTextChunks(bytes) {
  const buffer = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  for (let i = 0; i < 8; i += 1) if (buffer[i] !== PNG_SIGNATURE[i]) return undefined
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const out = {}
  let at = 8
  while (at + 12 <= buffer.length) {
    const length = view.getUint32(at)
    const type = String.fromCharCode(buffer[at + 4], buffer[at + 5], buffer[at + 6], buffer[at + 7])
    const start = at + 8
    if (start + length > buffer.length) break
    if (type === 'tEXt') {
      const chunk = buffer.subarray(start, start + length)
      const zero = chunk.indexOf(0)
      if (zero > 0) {
        const keyword = String.fromCharCode(...chunk.subarray(0, zero))
        let text = ''
        for (let k = zero + 1; k < chunk.length; k += 1) text += String.fromCharCode(chunk[k])
        out[keyword] = text
      }
    }
    if (type === 'IEND') break
    at = start + length + 4
  }
  return out
}

function decodeBase64Utf8(text) {
  const binary = typeof atob === 'function' ? atob(text) : Buffer.from(text, 'base64').toString('latin1')
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}

/** 从 PNG 卡里取卡：优先 `ccv3`（字段更全），其次 `chara`。 */
export function cardFromPng(bytes) {
  const chunks = pngTextChunks(bytes)
  if (chunks === undefined) return undefined
  for (const keyword of ['ccv3', 'chara']) {
    if (typeof chunks[keyword] !== 'string') continue
    try {
      const card = parseCard(decodeBase64Utf8(chunks[keyword]))
      if (card !== undefined) return card
    } catch {
      // 换下一个块。
    }
  }
  return undefined
}

// ── 编译 ─────────────────────────────────────────────────────────────────────

/** `{{char}}` / `{{user}}` / `{{original}}` 和 V1 的 `<BOT>` / `<USER>`，大小写不敏感。 */
export function expandMacros(text, { char, user }) {
  // 用函数做替换值：名字里的 `$&` / `$$` / `` $` `` / `$'` 不能被当成 replace 的特殊替换模式。
  const charName = str(char)
  const userName = str(user)
  return str(text)
    .replace(/\{\{\s*char\s*\}\}|<bot>/gi, () => charName)
    .replace(/\{\{\s*user\s*\}\}|<user>/gi, () => userName)
    .replace(/\{\{\s*original\s*\}\}/gi, '')
}

/** 开场白里的 HTML（社区卡常见的卡片样式）在 DSH 里不渲染：转成纯文本。 */
export function stripHtml(text) {
  const source = str(text)
  if (!/<\/?[a-z][^>]*>/i.test(source)) return source.trim()
  return source
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|h[1-6]|tr|section|details|summary)>/gi, '\n')
    .replace(/<\/span>\s*<span[^>]*>/gi, ' · ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 世界书里 `constant` 且启用的条目：一期只做这类（常驻设定），关键词触发留到二期。 */
export function constantLore(card) {
  const entries = card?.data?.character_book?.entries
  if (!Array.isArray(entries)) return []
  return entries
    .filter((entry) => entry && entry.enabled !== false && entry.constant === true && typeof entry.content === 'string' && entry.content.trim() !== '')
    .sort((a, b) => (Number(a.insertion_order) || 0) - (Number(b.insertion_order) || 0))
    .map((entry) => ({ title: str(entry.comment) || str(entry.name), content: entry.content.trim() }))
}

/** 可选的开场白：`[first_mes, ...alternate_greetings]`，空的去掉。 */
export function greetingsOf(card) {
  const data = card?.data ?? {}
  return [str(data.first_mes), ...(data.alternate_greetings ?? [])].filter((g) => g.trim() !== '')
}

/** 卡上的 DSH 设置（缺省值见规划 §2）。 */
export function cardSettings(card) {
  const ext = card?.data?.extensions?.[EXT_KEY]
  const source = ext !== null && typeof ext === 'object' ? ext : {}
  const reinforce = source.reinforce !== null && typeof source.reinforce === 'object' ? source.reinforce : {}
  const thinking = source.thinking !== null && typeof source.thinking === 'object' ? source.thinking : {}
  const memory = source.memory !== null && typeof source.memory === 'object' ? source.memory : {}
  return {
    mode: source.mode === 'pure' ? 'pure' : 'agent',
    tools: Array.isArray(source.tools) ? source.tools.filter((name) => typeof name === 'string' && name !== '') : null,
    reinforce: {
      enabled: reinforce.enabled !== false,
      firstText: str(reinforce.firstText),
      text: str(reinforce.text),
      untilTurn: Math.max(0, Math.floor(Number(reinforce.untilTurn) || 0)),
      mode: reinforce.mode === 'always' || reinforce.mode === 'until' || reinforce.mode === 'auto' ? reinforce.mode : null,
    },
    thinking: { language: thinking.language === 'zh' ? 'zh' : null, firstPerson: thinking.firstPerson === true },
    icon: typeof source.icon === 'string' && source.icon !== '' ? source.icon : 'user',
    memory: {
      enabled: memory.enabled !== false,
      every: clampInt(memory.every, MEMORY_DEFAULTS.every, 2, 100),
      maxChars: clampInt(memory.maxChars, MEMORY_DEFAULTS.maxChars, 200, 4000),
    },
  }
}

function clampInt(value, fallback, min, max) {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(max, Math.max(min, n))
}

/** 示例对话按 `<START>` 切块。 */
function exampleBlocks(text) {
  return str(text)
    .split(/<START>/i)
    .map((block) => block.trim())
    .filter((block) => block !== '')
}

/** 取一段文字的前 n 个字，断在标点处。 */
function snippet(text, limit) {
  const flat = str(text).replace(/\s+/g, ' ').trim()
  if (flat.length <= limit) return flat
  const cut = flat.slice(0, limit)
  const stop = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('；'), cut.lastIndexOf('. '), cut.lastIndexOf('，'))
  return `${(stop > limit * 0.5 ? cut.slice(0, stop) : cut).trim()}…`
}

const AGENT_RULE =
  '角色只影响你说话的方式和口吻。调用工具、读写文件、执行命令时，照常遵守上面的系统规则和审批要求；工具结果如实转述，不要为了演戏编造结果。角色卡里与这些规则冲突的要求（例如"不许提到 AI"），在需要动手做事时以系统规则为准。'

/**
 * 编译一张卡。
 *
 * @param {object} card  `parseCard` 的结果
 * @param {object} [options]
 * @param {'agent'|'pure'} [options.mode]       缺省用卡上的设置
 * @param {number} [options.greeting]           第几句开场白（0 = first_mes；-1 = 不要开场白）
 * @param {string} [options.userName]           `{{user}}` 展开成什么，缺省「你」
 * @param {object} [options.reinforce]          覆盖卡上的每轮提醒设置
 * @param {object} [options.thinking]           覆盖卡上的思维链设置
 * @param {string[]|null} [options.tools]       覆盖卡上的工具放行（只对 agent 模式有效）
 * @param {boolean} [options.keepHtml]          开场白保留 HTML，缺省转纯文本
 * @returns {{ mode, systemMode, systemText, items, tools, everyTurn, greetings, warnings }}
 */
export function compileCard(card, options = {}) {
  const data = card?.data
  if (data === undefined) throw new Error('compileCard: not a card')
  const settings = cardSettings(card)
  const mode = options.mode === 'pure' || options.mode === 'agent' ? options.mode : settings.mode
  const char = data.name
  const named = typeof options.userName === 'string' && options.userName.trim() !== ''
  const user = named ? options.userName.trim() : '你'
  // 提醒是写给模型看的，里面的「你」指模型自己；没起名字时把对方叫「对方」。
  const other = named ? user : '对方'
  const m = (text) => expandMacros(text, { char, user }).trim()
  const warnings = []

  // 人设段。
  const parts = []
  parts.push(`# 角色扮演：${char}`)
  parts.push(mode === 'agent' ? `本会话里你扮演角色「${char}」，同时仍然是能用工具帮${other}做事的助手。` : `本会话里你就是「${char}」，和${other}进行角色扮演对话。`)
  if (data.system_prompt.trim() !== '') parts.push(`## 扮演要求\n${m(data.system_prompt)}`)
  if (data.description.trim() !== '') parts.push(`## 角色设定\n${m(data.description)}`)
  if (data.personality.trim() !== '') parts.push(`## 性格\n${m(data.personality)}`)
  if (data.scenario.trim() !== '') parts.push(`## 场景\n${m(data.scenario)}`)
  const lore = constantLore(card)
  if (lore.length > 0) parts.push(`## 常驻设定\n${lore.map((entry) => (entry.title ? `【${entry.title}】${m(entry.content)}` : m(entry.content))).join('\n')}`)
  // 世界书关键词条目：编译成 `lore`，由闸门在每轮按最近几条消息匹配、命中才注入（二期）。
  const keywordLore = compileLore(card, { char, user })
  const examples = exampleBlocks(data.mes_example)
  if (examples.length > 0) parts.push(`## 示例对话（只学语气和节奏，不要照抄）\n${examples.map((block) => m(block)).join('\n\n')}`)
  if (mode === 'agent') parts.push(`## 和工具的关系\n${AGENT_RULE}`)
  const systemText = parts.join('\n\n')

  // 开场白。
  const greetings = greetingsOf(card)
  const pick = Number.isInteger(options.greeting) ? options.greeting : 0
  const items = []
  if (pick >= 0 && pick < greetings.length) {
    // 先展开宏再去 HTML：V1 的 `<USER>` / `<BOT>` 长得像标签。
    const text = options.keepHtml === true ? m(greetings[pick]) : stripHtml(m(greetings[pick]))
    if (text !== '') items.push({ role: 'assistant', text, reasoning: '' })
  }

  // 工具：纯角色扮演一个都不给；agent 模式按白名单（null = 全部）。
  const toolList = Array.isArray(options.tools) || options.tools === null ? options.tools : settings.tools
  const tools = mode === 'pure' ? [] : toolList

  // 每轮提醒。
  const reinforce = { ...settings.reinforce, ...(options.reinforce ?? {}) }
  const thinking = { ...settings.thinking, ...(options.thinking ?? {}) }
  const extra = []
  if (thinking.language === 'zh') extra.push('思维链（reasoning）全程用中文。')
  if (thinking.firstPerson === true) extra.push(`思维链也用${char}的第一人称来想，不要把对方称为"用户"${named ? `，就叫${user}` : ''}。`)
  if (mode === 'agent') extra.push('需要动手时照常调用工具，结果如实说。')
  const style = snippet(m(data.personality) || m(data.description), 60)
  let text = m(reinforce.text)
  if (text === '' && data.post_history_instructions.trim() !== '') text = m(data.post_history_instructions)
  if (text === '') {
    text = [
      `【角色提醒】你正在扮演${char}。继续用${char}的身份、语气和说话习惯回应${other}${style ? `（要点：${style}）` : ''}。`,
      `不要跳出角色解释设定，不要替${other}说话或决定行动。`,
      ...extra,
    ].join('')
  } else if (extra.length > 0) {
    text = `${text}\n${extra.join('')}`
  }
  let firstText = m(reinforce.firstText)
  if (firstText === '' && reinforce.text === '' && data.post_history_instructions.trim() === '') {
    const setting = snippet(m(data.scenario) || m(data.description), 80)
    firstText = [
      `【角色提醒·开场】从这一轮起你就是${char}。`,
      setting ? `当前场景：${setting}。` : '',
      `说话方式、口头禅、对${other}的称呼都按角色卡来${style ? `（${style}）` : ''}。`,
      `始终留在角色里：不要跳出来解释设定，不要替${other}说话或决定行动，回复长度跟着对话节奏走。`,
      ...extra,
    ].join('')
  }
  // v0.9：能用规则检查的要求（中文思考、第一人称）默认走「自动」——稳定后停注、跑偏再恢复；
  // 卡里写了 untilTurn 的照旧「只注入前 N 轮」，写了 mode 的以卡为准。
  const checks = [...(thinking.language === 'zh' ? ['zh'] : []), ...(thinking.firstPerson ? ['firstPerson'] : [])]
  const untilTurn = Math.max(0, Math.floor(Number(reinforce.untilTurn) || 0))
  let everyTurnMode = reinforce.mode ?? (untilTurn > 0 ? 'until' : checks.length > 0 ? 'auto' : 'always')
  if (everyTurnMode === 'auto' && checks.length === 0) everyTurnMode = untilTurn > 0 ? 'until' : 'always'
  const everyTurn = { enabled: reinforce.enabled === true, text, firstText, untilTurn, mode: everyTurnMode, checks }

  return {
    mode,
    systemMode: mode === 'pure' ? 'takeover' : 'append',
    systemText,
    items,
    tools,
    everyTurn,
    greetings: greetings.map((g) => snippet(stripHtml(m(g)), 40)),
    lore: keywordLore.entries.length > 0 ? { ...keywordLore, enabled: options.lore !== false, char } : null,
    // 故事记忆（三期）：每 every 轮把新发生的剧情并进一段摘要，闸门每轮把摘要作为背景注入。
    memory: {
      enabled: options.memory === undefined ? settings.memory.enabled : options.memory !== false,
      every: clampInt(options.memoryEvery, settings.memory.every, 2, 100),
      maxChars: settings.memory.maxChars,
      char,
      user: named ? user : '',
    },
    warnings,
  }
}

/** 列表用的摘要。 */
export function cardSummary(id, card) {
  const data = card.data
  const settings = cardSettings(card)
  return {
    id,
    name: data.name,
    tags: data.tags.slice(0, 6),
    creator: data.creator,
    icon: settings.icon,
    mode: settings.mode,
    greetings: greetingsOf(card).length,
    lore: Array.isArray(data.character_book?.entries) ? data.character_book.entries.length : 0,
    keywordLore: Array.isArray(data.character_book?.entries) ? data.character_book.entries.filter((entry) => entry && entry.enabled !== false && entry.constant !== true).length : 0,
    notes: snippet(stripHtml(data.creator_notes), 120),
  }
}

/** 卡的存储 id：名字里的安全字符 + 短哈希（同名不同卡不会互相覆盖）。 */
export function cardId(card) {
  const name = card.data.name
  let hash = 2166136261
  const text = JSON.stringify(card.data)
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  const base = name.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'card'
  return `${base}-${hash.toString(36).slice(0, 6)}`
}

// ── 世界书（二期）：关键词触发 ───────────────────────────────────────────────
// 语义按 SillyTavern 的常用子集：
//   · keys 任一命中即候选；`/正则/flags` 形式的 key 当正则用；
//   · selective + secondary_keys：selectiveLogic 0=再含任一 / 1=不全含 / 2=一个都不含 / 3=全含；
//   · case_sensitive 缺省不区分大小写；match_whole_words 缺省：纯 ASCII 的词按整词，含中文的按子串；
//   · probability（useProbability 时）按「会话 + 轮号 + 条目」确定性取随机，同一轮两次经过结果一致；
//   · 扫描最近 scan_depth 条消息（缺省 4，含本轮这句），总长超过预算时按 insertion_order 高的优先。
// 暂不做：递归扫描、sticky / cooldown / delay、position（统一插在本轮用户消息前）。

const LORE_DEFAULT_DEPTH = 4
const LORE_DEFAULT_BUDGET = 2400

/** 卡片 → 关键词条目表（可以 JSON 化存进 state）。 */
export function compileLore(card, macros) {
  const book = card?.data?.character_book
  const entries = Array.isArray(book?.entries) ? book.entries : []
  const out = []
  entries.forEach((entry, index) => {
    if (entry === null || typeof entry !== 'object' || entry.enabled === false || entry.constant === true) return
    const content = expandMacros(str(entry.content), macros).trim()
    const keys = (Array.isArray(entry.keys) ? entry.keys : []).filter((key) => typeof key === 'string' && key.trim() !== '').map((key) => key.trim())
    if (content === '' || keys.length === 0) return
    const ext = entry.extensions !== null && typeof entry.extensions === 'object' ? entry.extensions : {}
    const secondary = (Array.isArray(entry.secondary_keys) ? entry.secondary_keys : []).filter((key) => typeof key === 'string' && key.trim() !== '').map((key) => key.trim())
    const pick = (...values) => values.find((value) => value !== undefined && value !== null)
    const probability = Number(pick(ext.probability, entry.probability, 100))
    out.push({
      id: entry.id ?? index,
      title: str(entry.comment) || str(entry.name),
      keys,
      secondary: entry.selective === true ? secondary : [],
      logic: [0, 1, 2, 3].includes(Number(ext.selectiveLogic)) ? Number(ext.selectiveLogic) : 0,
      caseSensitive: pick(entry.case_sensitive, ext.case_sensitive) === true,
      wholeWords: pick(ext.match_whole_words, entry.match_whole_words) ?? null,
      probability: ext.useProbability === false || !Number.isFinite(probability) ? 100 : Math.max(0, Math.min(100, probability)),
      order: Number(entry.insertion_order) || 0,
      content,
    })
  })
  const depth = Number(book?.scan_depth)
  const budget = Number(book?.token_budget)
  return {
    scanDepth: Number.isFinite(depth) && depth > 0 ? Math.floor(depth) : LORE_DEFAULT_DEPTH,
    // token_budget 是 token；中文大约 1 字 1 token，这里按字数算，上限放宽到 2 倍。
    budget: Number.isFinite(budget) && budget > 0 ? Math.floor(budget * 2) : LORE_DEFAULT_BUDGET,
    entries: out,
  }
}

function keyMatcher(key, entry) {
  const regex = /^\/(.+)\/([a-z]*)$/s.exec(key)
  if (regex !== null) {
    try {
      const re = new RegExp(regex[1], regex[2].replace(/[gy]/g, ''))
      return (text) => re.test(text)
    } catch {
      return () => false
    }
  }
  const needle = entry.caseSensitive ? key : key.toLowerCase()
  const ascii = /^[\x20-\x7e]+$/.test(key)
  const whole = entry.wholeWords === null ? ascii : entry.wholeWords === true
  if (whole && ascii) {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`(^|[^A-Za-z0-9_])${escaped}($|[^A-Za-z0-9_])`, entry.caseSensitive ? '' : 'i')
    return (text) => re.test(text)
  }
  return (text) => (entry.caseSensitive ? text : text.toLowerCase()).includes(needle)
}

/** 确定性的 0–100 随机数（FNV-1a）。 */
function seeded(seed) {
  let hash = 2166136261
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return (hash % 10000) / 100
}

/**
 * 在最近几条消息里找命中的条目。
 * @param {object} lore     `compileLore` 的结果（state 里存的那份）
 * @param {string[]} texts  最近的消息文本，旧 → 新（调用方已按 scanDepth 截好）
 * @param {string} [seed]   概率条目的随机种子（会话 id + 轮号）
 * @returns 命中的条目，按 insertion_order 升序（越大越靠后、越靠近本轮）
 */
export function matchLore(lore, texts, seed = '') {
  const entries = Array.isArray(lore?.entries) ? lore.entries : []
  const haystack = texts.filter((text) => typeof text === 'string' && text !== '').join('\n')
  if (haystack === '' || entries.length === 0) return []
  const hits = []
  for (const entry of entries) {
    if (!entry.keys.some((key) => keyMatcher(key, entry)(haystack))) continue
    if (entry.secondary.length > 0) {
      const present = entry.secondary.map((key) => keyMatcher(key, entry)(haystack))
      const any = present.some(Boolean)
      const all = present.every(Boolean)
      const ok = entry.logic === 1 ? !all : entry.logic === 2 ? !any : entry.logic === 3 ? all : any
      if (!ok) continue
    }
    if (entry.probability < 100 && seeded(`${seed}:${entry.id}`) >= entry.probability) continue
    hits.push(entry)
  }
  // 预算：insertion_order 高的优先保留。
  const budget = Number(lore.budget) > 0 ? Number(lore.budget) : LORE_DEFAULT_BUDGET
  const kept = []
  let used = 0
  for (const entry of [...hits].sort((a, b) => b.order - a.order)) {
    if (used + entry.content.length > budget && kept.length > 0) continue
    kept.push(entry)
    used += entry.content.length
  }
  return kept.sort((a, b) => a.order - b.order)
}

/** 命中条目渲染成一条注入消息的正文。 */
export function renderLore(entries, char) {
  const who = typeof char === 'string' && char !== '' ? char : '角色'
  return [
    `【世界书 · 本轮相关设定】以下是和当前对话有关的背景设定，供${who}参考；自然地用在回应里，不要整段复述，也不要提到「世界书」或「设定」这些词。`,
    ...entries.map((entry) => (entry.title ? `【${entry.title}】${entry.content}` : entry.content)),
  ].join('\n')
}

// ── PNG 导出（二期）──────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function encodeBase64Utf8(text) {
  const bytes = new TextEncoder().encode(text)
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64')
  let binary = ''
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  return btoa(binary)
}

function textChunk(keyword, text) {
  const data = new Uint8Array(keyword.length + 1 + text.length)
  for (let i = 0; i < keyword.length; i += 1) data[i] = keyword.charCodeAt(i)
  data[keyword.length] = 0
  for (let i = 0; i < text.length; i += 1) data[keyword.length + 1 + i] = text.charCodeAt(i)
  const chunk = new Uint8Array(12 + data.length)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, data.length)
  chunk.set([0x74, 0x45, 0x58, 0x74], 4) // tEXt
  chunk.set(data, 8)
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)))
  return chunk
}

/**
 * 把卡写进一张 PNG：去掉原有的 `chara` / `ccv3` 块，在 IEND 前写入新的 V2（`chara`）和 V3（`ccv3`）。
 * 返回新 PNG 的字节；输入不是 PNG 时返回 `undefined`。
 */
export function embedCardInPng(bytes, card) {
  const buffer = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  for (let i = 0; i < 8; i += 1) if (buffer[i] !== PNG_SIGNATURE[i]) return undefined
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const parts = [buffer.subarray(0, 8)]
  let at = 8
  let iend
  while (at + 12 <= buffer.length) {
    const length = view.getUint32(at)
    const type = String.fromCharCode(buffer[at + 4], buffer[at + 5], buffer[at + 6], buffer[at + 7])
    const end = at + 12 + length
    if (end > buffer.length) return undefined
    if (type === 'IEND') {
      iend = buffer.subarray(at, end)
      break
    }
    let drop = false
    if (type === 'tEXt') {
      const chunk = buffer.subarray(at + 8, at + 8 + length)
      const zero = chunk.indexOf(0)
      const keyword = zero > 0 ? String.fromCharCode(...chunk.subarray(0, zero)) : ''
      drop = keyword === 'chara' || keyword === 'ccv3'
    }
    if (!drop) parts.push(buffer.subarray(at, end))
    at = end
  }
  if (iend === undefined) return undefined
  const v2 = { spec: 'chara_card_v2', spec_version: '2.0', data: card.data }
  const v3 = { spec: 'chara_card_v3', spec_version: '3.0', data: { ...card.data, group_only_greetings: card.data.group_only_greetings ?? [] } }
  parts.push(textChunk('chara', encodeBase64Utf8(JSON.stringify(v2))))
  parts.push(textChunk('ccv3', encodeBase64Utf8(JSON.stringify(v3))))
  parts.push(iend)
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}


// ── 故事记忆（三期）──────────────────────────────────────────────────────────
// 长对话里早先的剧情会被压缩或挤出上下文，人物关系、约定和伏笔跟着丢。做法：每 N 轮让模型把
// 「旧摘要 + 这 N 轮的新对话」合并成一段新摘要（不超过 maxChars 字），之后每轮作为一条
// `{kind:'prefill', prefill:'memory'}` 背景消息插在用户消息前。只加不删，不动真实历史。

export const MEMORY_DEFAULTS = { every: 8, maxChars: 800 }

/** 总结用的系统提示。 */
export function memorySystemPrompt({ char, user, maxChars } = {}) {
  const who = typeof char === 'string' && char !== '' ? char : '角色'
  const other = typeof user === 'string' && user !== '' ? user : '对方'
  const limit = Number(maxChars) > 0 ? Math.floor(Number(maxChars)) : MEMORY_DEFAULTS.maxChars
  return [
    `你是角色扮演对话的记录员，负责维护「${who}」和${other}之间的故事记忆。`,
    '输入里有「旧记忆」（可能为空）和「新对话」。把新对话里发生的事并进旧记忆，输出一份完整的新记忆。',
    '只写已经发生、对之后剧情有用的事实，按下面四节写，每节用短句列点，某节没有内容就写「无」：',
    '【人物与关系】【已发生的事】【约定与伏笔】【当前状态】（地点、时间、正在做什么、情绪）',
    '【已发生的事】只留会影响后面剧情的关键事件，最多 8 条，每条一句；动作细节、原话、环境描写一律省略，旧事件可以合并成一句。',
    `要求：用中文；第三人称，直接写名字；不评价、不续写、不猜测；总长严格不超过 ${limit} 字，超了就合并或删掉最不重要的旧细节。`,
    '只输出记忆正文，不要任何开场白或解释。',
  ].join('\n')
}

/**
 * 把旧记忆和新对话拼成总结请求的正文。
 * @param previous - 旧记忆（可空）。
 * @param lines - [{ who: 'user' | 'char', text }]，按时间顺序。
 */
export function memoryInput(previous, lines, { char, user } = {}) {
  const who = typeof char === 'string' && char !== '' ? char : '角色'
  const other = typeof user === 'string' && user !== '' ? user : '对方'
  const old = typeof previous === 'string' && previous.trim() !== '' ? previous.trim() : '（空）'
  const dialogue = (Array.isArray(lines) ? lines : [])
    .filter((line) => typeof line?.text === 'string' && line.text.trim() !== '')
    .map((line) => `${line.who === 'char' ? who : other}：${line.text.trim()}`)
    .join('\n')
  return `## 旧记忆\n${old}\n\n## 新对话\n${dialogue}`
}

/** 每轮注入的正文。 */
export function renderMemory(text, char) {
  const who = typeof char === 'string' && char !== '' ? char : '角色'
  return `【故事记忆 · 前情提要】以下是此前剧情的摘要，帮你（${who}）记住发生过的事。直接按它延续剧情，不要复述、不要提到这份摘要：\n${String(text ?? '').trim()}`
}

/**
 * 该不该在这一轮发起总结：已完成的轮数比上次总结覆盖到的多出 every 轮。
 * @param completedTurns - 已经结束的轮数（本轮之前）。
 * @param throughTurn - 上次总结覆盖到第几轮（没总结过 = 0）。
 */
export function memoryDue(completedTurns, throughTurn, every) {
  const n = Number(every) > 0 ? Math.floor(Number(every)) : MEMORY_DEFAULTS.every
  return Number.isFinite(completedTurns) && completedTurns - (Number(throughTurn) || 0) >= n
}

/** 模型偶尔会把四节标题前后加废话或超长：去掉首尾空白，硬截到 maxChars 的 1.5 倍兜底。 */
export function cleanMemory(text, maxChars) {
  const limit = Number(maxChars) > 0 ? Math.floor(Number(maxChars)) : MEMORY_DEFAULTS.maxChars
  const flat = String(text ?? '').replace(/\r\n/g, '\n').trim()
  const cap = Math.floor(limit * 1.5)
  return flat.length <= cap ? flat : `${flat.slice(0, cap)}…`
}
