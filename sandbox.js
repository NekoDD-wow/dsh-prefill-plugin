/**
 * 会话沙盒 —— 规则表（issue #15 第 1 步：只做数据层）。
 *
 * 把原来散在 state.json 顶层的五处设置合成一张表：
 *
 * ```jsonc
 * "sandbox": {
 *   "session-xxx": {
 *     "level": "strict",                 // 可选：observe | controlled | strict；缺 = 回落 '*'，再缺 = observe
 *     "own": ["rewrite", "tools"],       // 可选：本作用域「自带整族」的规则族，解析时不再回落到 '*' 的同族规则
 *     "rules": [
 *       { "match": { "section": "prefill:persona" }, "action": "rewrite", "text": "你是……", "order": -1000 },
 *       { "match": { "kind": "runtime-context" }, "action": "rewrite", "text": "……" },
 *       { "match": { "kind": "agent-message" }, "action": "allow" },
 *       { "match": { "tool": "read" }, "action": "allow" },
 *       { "match": { "tool": "*" }, "action": "deny" },
 *       { "match": { "context": "team:*" }, "action": "deny" }
 *     ]
 *   },
 *   "*": { "rules": [ … ] }               // 全局（「全局记住」）
 * }
 * ```
 *
 * match：只认一个键 —— `kind`（消息 source.kind）/ `section`（段名）/ `context`（上下文名）/ `tool`（工具名）。
 * 值里的 `*` 是通配（`team:*` = 前缀匹配，`*` = 全部）；`exact: true` 关掉通配（旧字段迁移来的名字一律带它，
 * 这样旧名单里字面上的 `*` 不会突然变成「全部」）。
 *
 * 规则族（family）：
 *   rewrite —— action:rewrite（旧 overrides）
 *   allow   —— 内容上的 allow（旧 sessionAllowKinds：严格档下的消息白名单）
 *   tools   —— tool 上的 allow / deny（旧 sessionTools 白名单 = 若干 allow + 一条 `tool:*` deny）
 *   deny    —— 内容上的 deny（旧 injectionBlocks）
 *
 * 优先级：会话规则 > 全局规则 > 档位默认。具体到族：
 *   · rewrite / allow / tools：会话 `own` 了这一族 ⇒ 只看会话的；否则会话规则在前、'*' 的在后，
 *     同一目标先命中者生效（'*' own 了也一样排在会话规则之后）。旧字段迁移来的都带 own，
 *     所以和旧的「会话格整格遮住 '*' 格」完全一致。
 *   · deny vs allow（用户定的优先级）：**会话作用域的 allow 能盖过全局（'*'）的 deny；同一作用域内 deny 优先于 allow**。
 *     内容上：会话 deny > 会话 allow（硬放行）> 全局 deny > 全局 allow / rewrite > 档位默认。
 *     工具上（每个作用域依次）：显式 deny > allow > 兜底 `{ tool: '*' }` deny（白名单的「其余一律拦」），
 *     会话作用域整体排在全局前面；兜底 deny 不算「同作用域的 deny」，否则白名单里的 allow 全被它吃掉。
 *   · 软放行 `soft: true`（只有 allow 带）：只抬档位默认（= 旧纯净模式白名单），盖不过任何 deny。
 *     旧 sessionAllowKinds 迁来的 allow 都是软的 —— 0.15.2 里阻断名单在 pre-step 最外层先丢、白名单在后，
 *     「会话白名单 ∩ 全局阻断」是拦的；迁移后仍拦，行为和 0.15.2 等价。
 *   · 恒放行、规则管不到：用户原话（kind = user）、本插件（kind = prefill / prefill:*、段 / 上下文 prefill:*）、
 *     DSH 协议（工具结果、压缩 checkpoint、墓碑：放行只记录）。
 *
 * 旧字段迁移（`migrateSandbox`，读取时做，幂等）：
 *   overrides[作用域]          → own rewrite + rewrite 规则（messages→kind / sections→section / contexts→context；
 *                                sectionOrders[名] 挂到同名规则的 order 上）
 *   sessionAllowKinds[作用域]  → own allow + 每个 kind 一条 allow
 *   sessionTools[作用域]       → own tools + 每个工具一条 allow + 一条 `{ tool:'*' }` deny（[] = 只剩那条 deny）
 *   injectionBlocks[作用域]    → deny 规则（messages→kind / contexts→context / sections→section）
 *   gate[会话] === 'pure'      → sandbox[会话].level = 'strict'（gate 里的这一格删掉；replace / pass 留在 gate）
 * 旧字段一出现就**整族覆盖**（面板一直是整张表写回的），迁移完旧字段从内存里的 state 删掉。
 * 非对象 / 非数组的脏值按「没配」处理。
 *
 * 防降级（`withLegacyMirror`，写盘时用）：写盘时同时写回由规则表推出的旧字段（镜像）和每个旧字段的指纹
 * `sandboxMirror: { v, overrides?, sessionAllowKinds?, sessionTools?, injectionBlocks?, gate? }`，
 * 这样退回 0.15.2 读同一份 state.json 不丢配置。读回来时：
 *   · 旧字段的指纹和 `sandboxMirror` 记的一致 ⇒ 它只是镜像，**新表为准**，直接丢掉；
 *   · 不一致（或这一格没记指纹）⇒ 被旧版本改过，以这个旧字段整族重新迁移（其它没改的族不动）；
 *     gate 不一致时按 gate 重推严格档：`'pure'` 的格 = strict，原来 strict 但 gate 里不再是 `'pure'`（含被删掉）= 撤掉。
 *   · 旧版本重新迁来的 allow 是软的；规则表里同作用域同名的硬放行保留硬（旧版本只是改了名单）。
 *   · 规则表里旧字段表达不了的（通配 deny、硬放行、不带 own 的 rewrite / allow、controlled 档）镜像只写能表达的部分，
 *     旧版本按旧语义读；只要旧版本没改那一族，回到新版本时原样还在。
 *
 * 面板（client.js）第 3 步之前不改：它读写的仍是旧字段。服务端给它 `withLegacyView(state)`
 * （由新表推出的旧字段 + sandbox），它写回的旧字段（不带指纹）在 normalizeState 里被整族吸收。
 *
 * @module @local/dsh-prefill/sandbox
 */

export const LEVELS = ['observe', 'controlled', 'strict']
export const FAMILIES = ['rewrite', 'allow', 'tools', 'deny']
export const TARGETS = ['kind', 'section', 'context', 'tool']
export const ACTIONS = ['allow', 'deny', 'rewrite']
/** 被合进规则表的旧字段（gate 只迁 'pure' 那几格，单独处理）。 */
export const LEGACY_FIELDS = ['overrides', 'sessionAllowKinds', 'sessionTools', 'injectionBlocks']
/** 写盘时旧字段镜像的指纹。 */
export const MIRROR_KEY = 'sandboxMirror'
/** DSH 协议消息：恒放行，只记录（第 2 步的审计用）。 */
export const PROTOCOL_KINDS = ['tool', 'compact-checkpoint', 'tombstone']

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

// ── 匹配 ────────────────────────────────────────────────────────────────────

const GLOBS = new Map()
function globRegExp(pattern) {
  let re = GLOBS.get(pattern)
  if (re === undefined) {
    re = new RegExp(`^${pattern.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`)
    GLOBS.set(pattern, re)
  }
  return re
}

/** 名字是否匹配一个模式：`exact` 或不含 `*` ⇒ 全等；否则 `*` 通配。 */
export function matchName(pattern, name, exact = false) {
  if (typeof pattern !== 'string' || typeof name !== 'string') return false
  if (exact === true || !pattern.includes('*')) return pattern === name
  return globRegExp(pattern).test(name)
}

/** 规则的目标维度（kind / section / context / tool），不合法 ⇒ undefined。 */
export function targetOf(rule) {
  const match = rule?.match
  if (!isObject(match)) return undefined
  const keys = TARGETS.filter((key) => typeof match[key] === 'string')
  return keys.length === 1 ? keys[0] : undefined
}

/**
 * 一条规则是否命中目标。目标形如 `{ kind }` / `{ section }` / `{ context }` / `{ tool }`。
 */
export function matchRule(rule, target) {
  const key = targetOf(rule)
  if (key === undefined || !isObject(target) || typeof target[key] !== 'string') return false
  return matchName(rule.match[key], target[key], rule.match.exact === true)
}

/** 规则属于哪一族。 */
export function familyOf(rule) {
  const key = targetOf(rule)
  if (key === undefined || !ACTIONS.includes(rule?.action)) return undefined
  if (rule.action === 'rewrite') return key === 'tool' ? undefined : 'rewrite'
  if (key === 'tool') return 'tools'
  return rule.action === 'allow' ? 'allow' : 'deny'
}

/** 工具白名单的兜底 deny（`{ tool: '*' }` 这类匹配一切的）：表示「其余一律拦」，不算同作用域的显式 deny。 */
export function isCatchAll(rule) {
  return rule?.action === 'deny' && targetOf(rule) === 'tool' && matchName(rule.match.tool, '\u0000any', rule.match.exact === true)
}

/** 软放行：只抬档位默认，盖不过 deny（旧 sessionAllowKinds 迁来的都是）。 */
const isSoft = (rule) => rule?.soft === true

/**
 * 恒放行的目标（规则管不到）：用户原话、本插件、DSH 协议。
 * @returns 'user' | 'self' | 'protocol' | undefined
 */
export function protectedBy(target) {
  if (!isObject(target)) return undefined
  if (typeof target.kind === 'string') {
    if (target.kind === 'user') return 'user'
    if (target.kind === 'prefill' || target.kind.startsWith('prefill:')) return 'self'
    if (PROTOCOL_KINDS.includes(target.kind)) return 'protocol'
  }
  for (const key of ['section', 'context']) if (typeof target[key] === 'string' && target[key].startsWith('prefill:')) return 'self'
  return undefined
}

/**
 * 名单：可迭代的模式集合（Set），`has()` 会做通配匹配；`prefill:*` 永远不在里面
 * （本插件不可阻断，和旧 blocksFor 一样）。
 */
export class NameSet extends Set {
  constructor(entries = []) {
    super()
    this.globs = []
    for (const entry of entries) this.addPattern(entry.name, entry.exact === true)
  }
  addPattern(name, exact) {
    if (typeof name !== 'string' || name === '' || name.startsWith('prefill:')) return this
    super.add(name)
    if (!exact && name.includes('*')) this.globs.push(name)
    return this
  }
  has(name) {
    if (typeof name === 'string' && name.startsWith('prefill:')) return false
    if (super.has(name)) return true
    return this.globs.some((pattern) => matchName(pattern, name))
  }
}

/**
 * 阻断名单：会话 deny 一律拦；全局 deny 被会话的硬放行（非 soft 的 allow）盖过。
 * 迭代 / size 给闸门做签名和短路用：被会话精确放行整条盖住的全局名字不列出来。
 */
export class BlockSet extends NameSet {
  constructor(unless = new NameSet()) {
    super()
    this.session = new NameSet()
    this.global = new NameSet()
    this.unless = unless
  }
  addPattern(name, exact, scope = 'session') {
    if (typeof name !== 'string' || name === '' || name.startsWith('prefill:')) return this
    const glob = exact !== true && name.includes('*')
    if (scope === 'global') {
      this.global.addPattern(name, exact)
      if (glob || !this.unless.has(name)) super.addPattern(name, exact)
    } else {
      this.session.addPattern(name, exact)
      super.addPattern(name, exact)
    }
    return this
  }
  has(name) {
    if (typeof name !== 'string' || name.startsWith('prefill:')) return false
    return this.session.has(name) || (this.global.has(name) && !this.unless.has(name))
  }
}

// ── 形状校验 ──────────────────────────────────────────────────────────────────

function sanitizeRule(raw) {
  if (!isObject(raw) || familyOf(raw) === undefined) return undefined
  const key = targetOf(raw)
  const match = { [key]: raw.match[key], ...(raw.match.exact === true ? { exact: true } : {}) }
  const rule = { ...raw, match }
  if (rule.action !== 'allow' || rule.soft !== true) delete rule.soft
  if (rule.action !== 'rewrite') {
    delete rule.text
    delete rule.order
  } else if (!('text' in rule)) return undefined
  return rule
}

function sanitizeScope(raw) {
  if (!isObject(raw)) return undefined
  const scope = {}
  if (LEVELS.includes(raw.level)) scope.level = raw.level
  const own = Array.isArray(raw.own) ? [...new Set(raw.own.filter((family) => FAMILIES.includes(family)))] : []
  if (own.length > 0) scope.own = own
  scope.rules = Array.isArray(raw.rules) ? raw.rules.map(sanitizeRule).filter((rule) => rule !== undefined) : []
  return scope
}

const emptyScope = (scope) => scope.level === undefined && (scope.own ?? []).length === 0 && scope.rules.length === 0

/** 规范化整张表：丢掉不合法的作用域 / 规则；空作用域删掉。 */
export function sanitizeSandbox(raw) {
  const out = {}
  if (!isObject(raw)) return out
  for (const [key, value] of Object.entries(raw)) {
    if (typeof key !== 'string' || key === '') continue
    const scope = sanitizeScope(value)
    if (scope !== undefined && !emptyScope(scope)) out[key] = scope
  }
  return out
}

// ── 旧字段 → 规则 ─────────────────────────────────────────────────────────────

const exactMatch = (key, name) => ({ [key]: name, exact: true })
const stringsOf = (list) => (Array.isArray(list) ? list.filter((name) => typeof name === 'string') : [])

function rewriteRulesOf(entry) {
  const rules = []
  const orders = isObject(entry.sectionOrders) ? entry.sectionOrders : {}
  const push = (key, group) => {
    const map = entry[group]
    if (!isObject(map)) return
    for (const [name, text] of Object.entries(map)) {
      rules.push({ match: exactMatch(key, name), action: 'rewrite', text, ...(orders[name] !== undefined ? { order: orders[name] } : {}) })
    }
  }
  push('kind', 'messages')
  push('section', 'sections')
  push('context', 'contexts')
  return rules
}

function denyRulesOf(entry) {
  const rules = []
  for (const [group, key] of [['messages', 'kind'], ['contexts', 'context'], ['sections', 'section']]) {
    for (const name of stringsOf(entry[group])) if (name !== '') rules.push({ match: exactMatch(key, name), action: 'deny' })
  }
  return rules
}

/** 每个旧字段：一格值 → { rules, own }（undefined = 这格不算配置）。 */
const ABSORB = {
  overrides: { family: 'rewrite', of: (entry) => (isObject(entry) ? { own: true, rules: rewriteRulesOf(entry) } : undefined) },
  sessionAllowKinds: {
    family: 'allow',
    of: (list) => (Array.isArray(list) ? { own: true, rules: stringsOf(list).map((kind) => ({ match: exactMatch('kind', kind), action: 'allow', soft: true })) } : undefined),
  },
  sessionTools: {
    family: 'tools',
    of: (list) =>
      Array.isArray(list)
        ? { own: true, rules: [...stringsOf(list).map((name) => ({ match: exactMatch('tool', name), action: 'allow' })), { match: { tool: '*' }, action: 'deny' }] }
        : undefined,
  },
  injectionBlocks: { family: 'deny', of: (entry) => (isObject(entry) ? { own: false, rules: denyRulesOf(entry) } : undefined) },
}

/** 键排序后的 JSON（和 JSON.stringify 一样丢 undefined），指纹不受键顺序影响。 */
function stableJson(value) {
  return JSON.stringify(value, (_key, val) => (isObject(val) ? Object.fromEntries(Object.keys(val).sort().map((key) => [key, val[key]])) : val))
}

/** 旧字段一格的指纹（cyrb53，够区分「被旧版本改过」）。 */
export function mirrorHash(value) {
  const text = stableJson(value) ?? 'undefined'
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/** 规则表里每个作用域的硬放行 kind（旧版本改了 sessionAllowKinds 重新迁移时，同名的保留硬）。 */
function hardAllowKeys(table) {
  const keys = new Set()
  for (const [key, scope] of Object.entries(table)) {
    for (const rule of scope.rules) if (familyOf(rule) === 'allow' && !isSoft(rule) && targetOf(rule) === 'kind') keys.add(`${key}\u0000${rule.match.kind}`)
  }
  return keys
}

/** 由 withLegacyView 推出来的旧字段对象：再迁移时直接跳过（新表本来就是它的来源）。 */
const DERIVED = new WeakSet()
const MIGRATED = new WeakMap()

function dropFamily(table, family) {
  for (const scope of Object.values(table)) {
    scope.rules = scope.rules.filter((rule) => familyOf(rule) !== family)
    if (scope.own !== undefined) scope.own = scope.own.filter((name) => name !== family)
  }
}

function scopeIn(table, key) {
  return (table[key] ??= { rules: [] })
}

function tidy(table) {
  for (const [key, scope] of Object.entries(table)) {
    if (scope.own !== undefined && scope.own.length === 0) delete scope.own
    if (emptyScope(scope)) delete table[key]
  }
  return table
}

/**
 * 读取时迁移：旧字段 → `state.sandbox`，并从返回的 state 里删掉旧字段（gate 只删 'pure' 格）。
 * 纯函数、幂等；没东西可迁时原样返回同一个对象。
 */
export function migrateSandbox(state) {
  if (!isObject(state)) return state
  const cached = MIGRATED.get(state)
  if (cached !== undefined) return cached
  const fp = isObject(state[MIRROR_KEY]) ? state[MIRROR_KEY] : undefined
  // 镜像：withLegacyView 推出的同一对象，或写盘时记了指纹且指纹没变（旧版本没碰过）。
  const mirrored = (field, value) => DERIVED.has(value) || (fp !== undefined && typeof fp[field] === 'string' && fp[field] === mirrorHash(value))
  const legacy = LEGACY_FIELDS.filter((field) => state[field] !== undefined)
  const gate = isObject(state.gate) ? state.gate : undefined
  const gateDerived = gate !== undefined && mirrored('gate', gate)
  // 写盘时记过 gate 指纹、现在对不上 ⇒ 旧版本改过 gate：按 gate 重推严格档（被删掉的 pure 格也算撤掉）。
  const gateStale = gate !== undefined && !gateDerived && fp !== undefined && typeof fp.gate === 'string'
  const gateTouches =
    gate !== undefined &&
    !gateDerived &&
    (gateStale ||
      Object.entries(gate).some(([key, mode]) => key !== '*' && mode === 'pure') ||
      Object.entries(isObject(state.sandbox) ? state.sandbox : {}).some(([key, scope]) => key !== '*' && scope?.level === 'strict' && gate[key] !== undefined))
  if (legacy.length === 0 && !gateTouches && !gateDerived && !(MIRROR_KEY in state) && (state.sandbox === undefined || isObject(state.sandbox) === false)) {
    MIGRATED.set(state, state)
    return state
  }
  const table = sanitizeSandbox(state.sandbox)
  const next = { ...state }
  delete next[MIRROR_KEY]
  for (const field of legacy) {
    const value = state[field]
    delete next[field]
    if (mirrored(field, value)) continue
    const { family, of } = ABSORB[field]
    const hard = family === 'allow' ? hardAllowKeys(table) : undefined
    dropFamily(table, family)
    if (!isObject(value)) continue
    for (const [key, entry] of Object.entries(value)) {
      const got = of(entry)
      if (got === undefined) continue
      const scope = scopeIn(table, key)
      if (hard !== undefined) for (const rule of got.rules) if (hard.has(`${key}\u0000${rule.match.kind}`)) delete rule.soft
      scope.rules.push(...got.rules)
      if (got.own) scope.own = [...new Set([...(scope.own ?? []), family])]
    }
  }
  if (gate !== undefined) {
    const kept = {}
    for (const [key, mode] of Object.entries(gate)) {
      if (key !== '*' && mode === 'pure') {
        if (!gateDerived) scopeIn(table, key).level = 'strict'
      } else kept[key] = mode
    }
    if (!gateDerived) {
      // 面板把这个会话改成了 replace / pass（gate 里出现非 pure 的格）⇒ 不再是严格档。
      // 旧版本改过 gate（指纹对不上）：gate 里不再是 'pure' 的（含整格删掉）一律撤掉。
      for (const [key, scope] of Object.entries(table)) {
        if (key !== '*' && scope.level === 'strict' && (kept[key] !== undefined || (gateStale && gate[key] !== 'pure'))) delete scope.level
      }
    }
    next.gate = kept
  }
  // 再过一遍规范化：键顺序固定（level / own / rules），这样迁移结果和「读回来再迁移」逐字节一致。
  next.sandbox = sanitizeSandbox(tidy(table))
  MIGRATED.set(state, next)
  MIGRATED.set(next, next)
  return next
}

/** state 里生效的规则表（必要时先迁移）。 */
export function sandboxOf(state) {
  const migrated = migrateSandbox(state)
  return isObject(migrated?.sandbox) ? migrated.sandbox : {}
}

// ── 规则 → 旧字段（给还没改的面板 / applyEnabled 用的兼容视图）──────────────

function legacyRewriteEntry(rules) {
  const entry = { messages: {}, sections: {}, contexts: {} }
  const orders = {}
  const groups = { kind: 'messages', section: 'sections', context: 'contexts' }
  for (const rule of rules) {
    const key = targetOf(rule)
    const name = rule.match[key]
    const group = entry[groups[key]]
    if (Object.hasOwn(group, name)) continue
    group[name] = rule.text
    if (rule.order !== undefined && !Object.hasOwn(orders, name)) orders[name] = rule.order
  }
  if (Object.keys(orders).length > 0) entry.sectionOrders = orders
  return entry
}

/**
 * tools 族 → 旧白名单形状：第一条兜底 deny 之前的 allow，去掉被同作用域（或更高的会话作用域）显式 deny 的。
 * 没有兜底 deny ⇒ null（配了但不设白名单）。`tagged` = [{ rule, scope }]，scope 越靠前越高。
 */
function toolListOf(tagged) {
  const catchAll = tagged.findIndex(({ rule }) => isCatchAll(rule))
  if (catchAll < 0) return null
  const denied = (name, scope) =>
    tagged.some(({ rule, scope: by }) => rule.action === 'deny' && !isCatchAll(rule) && (by === scope || by === 'session') && matchRule(rule, { tool: name }))
  return tagged
    .slice(0, catchAll)
    .filter(({ rule, scope }) => rule.action === 'allow' && !denied(rule.match.tool, scope))
    .map(({ rule }) => rule.match.tool)
}

const legacyToolList = (rules) => toolListOf(rules.map((rule) => ({ rule, scope: 'one' })))

/**
 * 由规则表推出来的旧字段（overrides / sessionAllowKinds / sessionTools / injectionBlocks，
 * gate 补回严格档的 'pure' 格）。旧字段表达不了的规则只推能表达的部分（见文件头「防降级」）。
 */
function legacyFieldsOf(migrated) {
  const table = sandboxOf(migrated)
  const overrides = {}
  const sessionAllowKinds = {}
  const sessionTools = {}
  const injectionBlocks = {}
  const gate = { ...(isObject(migrated.gate) ? migrated.gate : {}) }
  for (const [key, scope] of Object.entries(table)) {
    const own = scope.own ?? []
    const byFamily = (family) => scope.rules.filter((rule) => familyOf(rule) === family)
    if (own.includes('rewrite')) overrides[key] = legacyRewriteEntry(byFamily('rewrite'))
    if (own.includes('allow')) sessionAllowKinds[key] = byFamily('allow').filter((rule) => targetOf(rule) === 'kind').map((rule) => rule.match.kind)
    if (own.includes('tools')) {
      const list = legacyToolList(byFamily('tools'))
      if (list !== null) sessionTools[key] = list
    }
    const deny = byFamily('deny')
    if (deny.length > 0) {
      const entry = {}
      for (const [group, target] of [['messages', 'kind'], ['contexts', 'context'], ['sections', 'section']]) {
        const names = deny.filter((rule) => targetOf(rule) === target).map((rule) => rule.match[target])
        if (names.length > 0) entry[group] = names
      }
      injectionBlocks[key] = entry
    }
    if (key !== '*' && scope.level === 'strict') gate[key] = 'pure'
  }
  return { overrides, sessionAllowKinds, sessionTools, injectionBlocks, gate }
}

/**
 * 兼容视图：在 state 上补回由规则表推出来的旧字段（给面板 / applyEnabled）。没有 sandbox 的 state 原样返回。
 * 推出来的对象会被记住：原样再迁移时跳过；被改过（新对象）则整族覆盖。
 */
export function withLegacyView(state) {
  if (!isObject(state) || !isObject(state.sandbox)) return state
  const migrated = migrateSandbox(state)
  const fields = legacyFieldsOf(migrated)
  const view = { ...migrated, ...fields }
  for (const value of Object.values(fields)) DERIVED.add(value)
  MIGRATED.set(view, migrated)
  return view
}

/**
 * 写盘形状（防降级）：规则表 + 由它推出的旧字段镜像 + 每个镜像字段的指纹 `sandboxMirror`。
 * 0.15.2 读同一份文件只认旧字段，照样生效；新版本读回来时指纹对得上的旧字段直接丢掉（新表为准），
 * 对不上的（被旧版本改过）整族重新迁移。空的镜像字段不写（gate 原来就有则照写）。
 */
export function withLegacyMirror(state) {
  if (!isObject(state)) return state
  const migrated = migrateSandbox(state)
  const fields = legacyFieldsOf(migrated)
  const out = { ...migrated }
  const fp = { v: 1 }
  for (const [field, value] of Object.entries(fields)) {
    if (Object.keys(value).length === 0 && !(field === 'gate' && migrated.gate !== undefined)) {
      delete out[field]
      continue
    }
    out[field] = value
    fp[field] = mirrorHash(value)
  }
  out[MIRROR_KEY] = fp
  return out
}

// ── 解析 ─────────────────────────────────────────────────────────────────────

/**
 * 取某一族在本会话生效的规则（带来源作用域）。
 * @returns { rules: [{ rule, scope: 'session' | 'global' }], owned } 或 undefined（两边都没配）
 */
function pickFamily(session, global, family) {
  const tagged = (scope, label) => (scope?.rules ?? []).filter((rule) => familyOf(rule) === family).map((rule) => ({ rule, scope: label }))
  const owns = (scope) => (scope?.own ?? []).includes(family)
  if (owns(session)) return { rules: tagged(session, 'session'), owned: true }
  const mine = tagged(session, 'session')
  if (owns(global)) return { rules: [...mine, ...tagged(global, 'global')], owned: true }
  const theirs = tagged(global, 'global')
  if (mine.length + theirs.length === 0) return undefined
  return { rules: [...mine, ...theirs], owned: false }
}

const RESOLVED = new WeakMap()

/**
 * 本会话的有效沙盒（等价于旧各字段的有效行为）：
 *
 * ```js
 * {
 *   level,          // 'observe' | 'controlled' | 'strict'（第 1 步：只有 gate 'pure' 迁来的 strict）
 *   rewrite,        // 旧 overridesFor(state, id)：{ messages, sections, contexts, sectionOrders? } | undefined
 *   allowKinds,     // 旧 allowKindsFor(state, id)：数组（会话 ?? '*' ?? state.allowKinds ?? ['user']）
 *   messageAllow,   // 同上的 NameSet（支持通配）
 *   toolAllow,      // 旧 sessionTools[id] ?? sessionTools['*']：数组 | null（配了但不设白名单）| undefined（没配，回落 state.tools）
 *   blocks,         // 旧 blocksFor(state, id)：{ messages, contexts, sections } 三个 BlockSet（会话 deny ∪（全局 deny − 会话硬放行））
 *   families,       // 每族生效规则（带来源作用域），给 decide() 和第 2 步用
 * }
 * ```
 */
export function resolveSandbox(state, sessionId) {
  const key = typeof sessionId === 'string' ? sessionId : '\u0000none'
  let perState = isObject(state) ? RESOLVED.get(state) : undefined
  const hit = perState?.get(key)
  if (hit !== undefined) return hit
  const table = sandboxOf(state)
  const global = table['*']
  const session0 = typeof sessionId === 'string' ? table[sessionId] : undefined
  const session = session0 === global ? undefined : session0

  const families = Object.fromEntries(FAMILIES.map((family) => [family, pickFamily(session, global, family)]))

  const rewrite = families.rewrite === undefined ? undefined : legacyRewriteEntry(families.rewrite.rules.map(({ rule }) => rule))

  const globalAllow = Array.isArray(state?.allowKinds) ? state.allowKinds : ['user']
  let allowKinds
  let messageAllow
  if (families.allow === undefined) {
    allowKinds = globalAllow
    messageAllow = new NameSet(globalAllow.map((name) => ({ name, exact: true })))
  } else {
    const kindRules = families.allow.rules.map(({ rule }) => rule).filter((rule) => targetOf(rule) === 'kind')
    const base = families.allow.owned ? [] : globalAllow.map((name) => ({ name, exact: true }))
    const entries = [...base, ...kindRules.map((rule) => ({ name: rule.match.kind, exact: rule.match.exact === true }))]
    allowKinds = entries.map((entry) => entry.name)
    messageAllow = new NameSet(entries)
  }

  const toolAllow = families.tools === undefined ? undefined : toolListOf(families.tools.rules)

  // 阻断名单：会话 deny ∪（全局 deny − 会话硬放行）。同作用域 deny 先于 allow；会话 allow 盖过全局 deny。
  const groupOf = (target) => (target === 'kind' ? 'messages' : target === 'context' ? 'contexts' : 'sections')
  const lift = { messages: new NameSet(), contexts: new NameSet(), sections: new NameSet() }
  for (const rule of session?.rules ?? []) {
    if (familyOf(rule) !== 'allow' || isSoft(rule)) continue
    const target = targetOf(rule)
    lift[groupOf(target)].addPattern(rule.match[target], rule.match.exact === true)
  }
  const blocks = { messages: new BlockSet(lift.messages), contexts: new BlockSet(lift.contexts), sections: new BlockSet(lift.sections) }
  for (const [scope, label] of [[global, 'global'], [session, 'session']]) {
    for (const rule of scope?.rules ?? []) {
      if (familyOf(rule) !== 'deny') continue
      const target = targetOf(rule)
      blocks[groupOf(target)].addPattern(rule.match[target], rule.match.exact === true, label)
    }
  }

  const level = LEVELS.includes(session?.level) ? session.level : LEVELS.includes(global?.level) ? global.level : 'observe'
  const resolved = { level, rewrite, allowKinds, messageAllow, toolAllow, blocks, families }
  if (isObject(state)) {
    if (perState === undefined) RESOLVED.set(state, (perState = new Map()))
    perState.set(key, resolved)
  }
  return resolved
}

/**
 * 单个目标的裁决（第 2 步的闸门会用它；第 1 步闸门仍读 resolveSandbox 推出的旧形状）。
 *
 * 顺序：恒放行（用户 / 本插件 / DSH 协议）→ 会话 deny → 会话硬放行可盖过的全局 deny → rewrite / allow（会话在前）
 * → 档位默认。工具：每个作用域（会话在前）依次 显式 deny → allow → 兜底 deny。
 * 档位默认：observe 放行；strict 拦（= 旧纯净模式）；controlled 第 2 步实现，先按放行。
 *
 * @returns { action: 'allow' | 'deny' | 'rewrite', by: 'user' | 'self' | 'protocol' | 'session' | 'global' | 'level', rule?, audit? }
 */
export function decide(state, sessionId, target) {
  const guard = protectedBy(target)
  if (guard !== undefined) return { action: 'allow', by: guard, ...(guard === 'protocol' ? { audit: true } : {}) }
  const resolved = resolveSandbox(state, sessionId)
  const { families } = resolved
  const first = (picked, pred = () => true) => picked?.rules.find(({ rule }) => pred(rule) && matchRule(rule, target))
  if (typeof target?.tool !== 'string') {
    const table = sandboxOf(state)
    const session = typeof sessionId === 'string' && sessionId !== '*' ? table[sessionId] : undefined
    const sessionDeny = (session?.rules ?? []).find((rule) => familyOf(rule) === 'deny' && matchRule(rule, target))
    if (sessionDeny !== undefined) return { action: 'deny', by: 'session', rule: sessionDeny }
    const globalDeny = (table['*']?.rules ?? []).find((rule) => familyOf(rule) === 'deny' && matchRule(rule, target))
    if (globalDeny !== undefined) {
      // 会话作用域的 allow（非 soft）盖过全局 deny。
      const lifted = (session?.rules ?? []).some((rule) => familyOf(rule) === 'allow' && !isSoft(rule) && matchRule(rule, target))
      if (!lifted) return { action: 'deny', by: 'global', rule: globalDeny }
    }
    const rewrite = first(families.rewrite)
    if (rewrite !== undefined) return { action: 'rewrite', by: rewrite.scope, rule: rewrite.rule }
    const allow = first(families.allow)
    if (allow !== undefined) return { action: 'allow', by: allow.scope, rule: allow.rule }
    // 没有规则命中、但在旧的全局白名单 state.allowKinds 里（规则表之外的「档位默认」名单）。
    if (typeof target?.kind === 'string' && resolved.messageAllow.has(target.kind)) return { action: 'allow', by: 'level' }
  } else {
    const table = sandboxOf(state)
    const global = table['*']
    const session0 = typeof sessionId === 'string' ? table[sessionId] : undefined
    const session = session0 === global ? undefined : session0
    const scopes = [['session', session]]
    if (!(session?.own ?? []).includes('tools')) scopes.push(['global', global])
    for (const [by, scope] of scopes) {
      const rules = (scope?.rules ?? []).filter((rule) => familyOf(rule) === 'tools' && matchRule(rule, target))
      const hit = rules.find((rule) => rule.action === 'deny' && !isCatchAll(rule)) ?? rules.find((rule) => rule.action === 'allow') ?? rules.find(isCatchAll)
      if (hit !== undefined) return { action: hit.action, by, rule: hit }
    }
  }
  return { action: resolved.level === 'strict' ? 'deny' : 'allow', by: 'level' }
}
