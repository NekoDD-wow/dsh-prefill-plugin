/**
 * 每轮注入的「积木」模型（v0.15 草案，见 docs/规划-每轮注入积木.md）。
 *
 * 三个概念：
 *   · 积木 block —— 一段注入：首轮文字 first（可空）、之后文字 text、检查项 checks。
 *   · 积木塔 tower —— 一组有序的积木引用（塔不嵌套，放进去即拆平）。
 *   · 工作台 bench —— 本会话实际堆着的块（顺序 = 注入顺序）。
 *
 * 发送内容 = 工作台从上到下拼接，没有别的隐藏规则；gate.js 只读 everyTurn 的
 * text / firstText / checks，所以这里把工作台编译回那三个字段，闸门与自动收放的
 * 状态机零改动。
 *
 * 本文件是纯函数，服务端（impl.js）与浏览器端（client.js）各有一份：
 * 面板是浏览器模块，require 只有宿主给的几张表，import 不了插件自己的文件，
 * 所以 client.js 里有一份带 <bench-helpers> 标记的副本，单测比对两份一致
 * （沿用 everyTurnSwitchOn / fetch-helpers 的先例）。
 */

/** 发送时给「冲突时以此为准」的块加的前缀。 */
export const PRIORITY_PREFIX = '（以下为用户补充，与上文冲突时以此为准）'

/** checks 的规范顺序（与 inject-auto.js 的 CHECK_IDS 一致）。 */
export const CHECK_ORDER = ['zh', 'four', 'noLeak', 'firstPerson']

/** 规范化 checks：只留已知项，并按固定顺序。 */
export function normalizeChecks(raw) {
  const list = Array.isArray(raw) ? raw.filter((id) => CHECK_ORDER.includes(id)) : []
  return CHECK_ORDER.filter((id) => list.includes(id))
}

/** 一块积木的规范形状。 */
export function makeBlock(input = {}) {
  const block = {
    id: String(input.id ?? ''),
    name: String(input.name ?? '').trim() || '未命名积木',
    icon: typeof input.icon === 'string' ? input.icon : '',
    desc: typeof input.desc === 'string' ? input.desc : '',
    first: String(input.first ?? ''),
    text: String(input.text ?? ''),
    checks: normalizeChecks(input.checks),
    overlaps: Array.isArray(input.overlaps) ? input.overlaps.filter((id) => typeof id === 'string' && id !== '') : [],
    builtin: input.builtin === true,
  }
  if (typeof input.overrides === 'string' && input.overrides !== '') block.overrides = input.overrides
  if (typeof input.updatedAt === 'string' && input.updatedAt !== '') block.updatedAt = input.updatedAt
  return block
}

/** 内置预设项（builtin-presets.js 的 EVERY_TURN_PRESETS）→ 积木。 */
export function blockFromPreset(preset) {
  return makeBlock({
    id: preset.id,
    name: preset.name,
    icon: preset.icon,
    desc: preset.desc,
    first: preset.firstText,
    text: preset.text,
    checks: preset.checks,
    overlaps: preset.overlaps,
    builtin: true,
  })
}

/** 台上的一块：块头信息 + 当前内容（可能被临时改过）。 */
export function benchBlockOf(block, key, tower = null) {
  return {
    key,
    ref: block.id,
    tower,
    name: block.name,
    icon: block.icon ?? '',
    first: block.first,
    text: block.text,
    checks: [...block.checks],
    edited: false,
    priority: false,
    builtin: block.builtin === true,
  }
}

/** 台上块的一行实际发送文本（priority 块带前缀）。 */
function sendText(block, text) {
  const body = String(text ?? '')
  if (body.trim() === '') return ''
  return block.priority === true ? PRIORITY_PREFIX + body : body
}

/**
 * 工作台 → 实际发送内容。
 * 第 1 轮：每块取 first（没有就取 text）；之后：每块取 text（空的不发）。
 */
export function compileBench(bench) {
  const list = Array.isArray(bench) ? bench.filter((block) => block !== null && typeof block === 'object') : []
  const first = []
  const rest = []
  for (const block of list) {
    const text = String(block.text ?? '')
    const head = String(block.first ?? '')
    const firstBody = head.trim() !== '' ? sendText(block, head) : sendText(block, text)
    const restBody = sendText(block, text)
    if (firstBody.trim() !== '') first.push(firstBody)
    if (restBody.trim() !== '') rest.push(restBody)
  }
  return { firstText: first.join('\n'), text: rest.join('\n'), checks: unionChecks(list) }
}

/** checks = 各块并集（按固定顺序）。 */
export function unionChecks(bench) {
  const list = Array.isArray(bench) ? bench : []
  const seen = new Set()
  for (const block of list) for (const id of normalizeChecks(block?.checks)) seen.add(id)
  return CHECK_ORDER.filter((id) => seen.has(id))
}

/** 塔里的积木按顺序展开（塔不嵌套：遇到塔直接拆平）。 */
export function flattenTower(tower, towers, blocks) {
  const out = []
  const items = Array.isArray(tower?.items) ? tower.items : []
  for (const item of items) {
    if (item === null || typeof item !== 'object') continue
    const ref = String(item.ref ?? '')
    const block = (blocks ?? []).find((entry) => entry.id === ref)
    if (block !== undefined) {
      // 塔里的局部覆盖：只盖文字 / 首轮，不动 checks。
      out.push({
        ...block,
        first: typeof item.first === 'string' ? item.first : block.first,
        text: typeof item.text === 'string' ? item.text : block.text,
      })
      continue
    }
    const inner = (towers ?? []).find((entry) => entry.id === ref)
    if (inner !== undefined) out.push(...flattenTower(inner, towers, blocks))
    else if (item.snap !== null && typeof item.snap === 'object') {
      // 原积木已删除：用文字快照兜底，照常能发。
      out.push(makeBlock({ id: ref, name: String(item.snap.name ?? ref), first: item.snap.first, text: item.snap.text, checks: item.snap.checks }))
    }
  }
  return out
}

/** 往工作台追加一座塔：按顺序放，已在台上的同 ref 跳过（去重）。 */
export function addTowerToBench(bench, tower, towers, blocks, makeKey) {
  const list = Array.isArray(bench) ? [...bench] : []
  const have = new Set(list.map((block) => block.ref))
  const key = typeof makeKey === 'function' ? makeKey : (() => String(Math.random()).slice(2, 10))
  for (const block of flattenTower(tower, towers, blocks)) {
    if (have.has(block.id)) continue
    have.add(block.id)
    list.push(benchBlockOf(block, key(), tower.id))
  }
  return list
}

/** 台上块的概要（成本行 / 预览用）。 */
export function benchSummary(bench) {
  const compiled = compileBench(bench)
  const chars = (text) => String(text ?? '').length
  // 中文大约 1 字 1 token，这里按字数粗估，与面板别处一致。
  return {
    firstTok: chars(compiled.firstText),
    restTok: chars(compiled.text),
    blocks: Array.isArray(bench) ? bench.length : 0,
    checks: compiled.checks,
  }
}

/**
 * 读取时迁移：旧 everyTurn（只有 text / firstText / checks，没有 bench）→ 工作台。
 * 与某个内置积木完全一致 ⇒ 一块该积木；与某座内置塔的拼接结果一致 ⇒ 该塔；否则一块自定义块。
 */
export function migrateEveryTurn(entry, { blocks = [], towers = [], makeKey } = {}) {
  const text = String(entry?.text ?? '')
  const first = String(entry?.firstText ?? '')
  const checks = normalizeChecks(entry?.checks)
  const key = typeof makeKey === 'function' ? makeKey : (() => 'b1')
  if (text.trim() === '' && first.trim() === '') return { bench: [], benchTowers: {} }
  const same = (block) => String(block.first ?? '') === first && String(block.text ?? '') === text
  // 旧模型里 checks 是独立勾选的（可能和文字来自的内置积木不同）：
  // 认出是某块积木时保留旧 checks，否则迁移后一编辑就会悄悄换成积木自带的 checks。
  const sameChecks = (list) => list.length === checks.length && list.every((id, index) => id === checks[index])
  const block = blocks.find((candidate) => same(candidate))
  if (block !== undefined) {
    const placed = benchBlockOf(block, key())
    if (!sameChecks(placed.checks)) {
      placed.checks = [...checks]
      placed.edited = true
    }
    return { bench: [placed], benchTowers: {} }
  }
  // 旧模型里 firstText === '' 表示「没有首轮专用段」；工作台里如果每块都没有 first，
  // 编译出来的 firstText 会等于 text（第 1 轮取不到 first 就取 text）。两种写法等价，都要认。
  const sameFirst = (compiled) => compiled.firstText === first || (first.trim() === '' && compiled.firstText === compiled.text)
  for (const tower of towers) {
    const flat = flattenTower(tower, towers, blocks).map((item, index) => benchBlockOf(item, 't' + index))
    const compiled = compileBench(flat)
    // 塔的 checks 是各块并集，拆不回单块 ⇒ checks 不一致就不认成塔，走下面的自定义块。
    if (compiled.text === text && sameFirst(compiled) && sameChecks(compiled.checks)) {
      return {
        bench: addTowerToBench([], tower, towers, blocks, key),
        benchTowers: { [tower.id]: { ref: tower.id, name: tower.name, collapsed: false } },
      }
    }
  }
  const custom = makeBlock({ id: 'my:' + (typeof makeKey === 'function' ? key() : 'custom'), name: '自定义', first, text, checks })
  return { bench: [benchBlockOf(custom, key())], benchTowers: {} }
}
