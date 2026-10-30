/**
 * 会话沙盒 —— 面板用的只读视图（issue #15 第 3 步）。
 *
 * 面板是浏览器里的 client.js，拿不到 sandbox.js / sandbox-packs.js，所以「这一条现在是放行还是拦、
 * 谁说了算、属于哪个包」由宿主算好放进状态路由的 envelope（`sandboxView[会话]`）。
 * 输入是闸门已经在记的东西：装配里看到的段 / 上下文 / 工具、pre-step 看到的消息来源、注入审计。
 *
 * @module @local/dsh-prefill/sandbox-view
 */

import { decide, resolveSandbox, sandboxOf } from './sandbox.js'
import { PACK_ACTIONS, memberKey, packCatalog, packsOf } from './sandbox-packs.js'
import { PROTOCOL_KINDS } from './sandbox.js'
import { claimsFor } from './sandbox-trace.js'

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/** 面板的分组 ↔ 规则表的目标维度。 */
export const GROUPS = { sections: 'section', contexts: 'context', messages: 'kind', tools: 'tool' }
const GROUP_OF = { section: 'sections', context: 'contexts', kind: 'messages', tool: 'tools' }

const strings = (list) => (Array.isArray(list) ? list.filter((name) => typeof name === 'string' && name !== '') : [])

/**
 * 本会话观察到的名字：`{ sections, contexts, messages, tools }`（去重、不含 prefill:* 和用户原话）。
 * @param injections gate.injections() 的结果；@param tools gate.tools() 的结果；@param audit auditSnapshot()
 */
export function observedFor(sessionId, { injections, tools, audit } = {}) {
  const seen = { sections: new Set(), contexts: new Set(), messages: new Set(), tools: new Set() }
  const session = injections?.sessions?.[sessionId] ?? {}
  for (const name of strings(session.sections)) seen.sections.add(name)
  for (const name of strings(session.contexts)) seen.contexts.add(name)
  for (const name of strings(session.messages)) seen.messages.add(name)
  for (const name of strings(tools?.sessions?.[sessionId])) seen.tools.add(name)
  for (const row of Array.isArray(audit?.[sessionId]) ? audit[sessionId] : []) {
    if (seen[row?.group] !== undefined && typeof row?.name === 'string') seen[row.group].add(row.name)
  }
  const out = {}
  for (const [group, set] of Object.entries(seen)) {
    out[group] = [...set].filter((name) => !name.startsWith('prefill') && name !== 'user' && name !== '(none)' && name !== 'user-rpc' && name !== 'model').sort()
  }
  return out
}

/** 作用域里某个包的开关。 */
function packSetting(scope, id) {
  const value = scope?.packs?.[id]
  return PACK_ACTIONS.includes(value) ? value : undefined
}

/** 这一条怎么处理（审计表「处理」那一栏）。 */
function handlingOf(group, name, verdict, level, blockable) {
  if (group === 'messages' && PROTOCOL_KINDS.includes(name)) return 'protocol'
  if (group === 'messages' && (name.startsWith('developer:') || blockable === false)) return 'direct'
  if (verdict.action === 'rewrite') return 'rewrite'
  if (verdict.action === 'deny') {
    if (verdict.by === 'level' && level === 'strict') return 'strict'
    if (group === 'messages') return 'dropped'
    if (group === 'tools') return 'tool-filtered'
    return 'registry'
  }
  return 'allowed'
}

/**
 * 一个会话的沙盒视图：
 * ```js
 * {
 *   level, levelFrom: 'session' | 'global' | 'default',
 *   packs: [{ id, label, plugin, origin, locked, summary, note, source, members, extended,
 *             setting: { session, global }, effective: 'allow' | 'deny' | 'mixed', items: [{ group, name, action, by, shared }] }],
 *   unassigned: [{ group, name, action, by, preview, blockable, count }],
 *   audit: [{ group, name, count, blockable, preview, action, by, pack, packLabel, handling, lastSeq }],
 *   rules: { session: [...], global: [...] },   // 显式的 allow / deny（单条另设）
 *   blocked,                                     // 观察到的、本会话正在拦的条数
 * }
 * ```
 */
export function sandboxView(state, sessionId, { injections, tools, audit } = {}) {
  const known = { sections: strings(injections?.catalog?.sections), contexts: strings(injections?.catalog?.contexts), messages: [] }
  const options = { known }
  const resolved = resolveSandbox(state, sessionId)
  const table = sandboxOf(state)
  const session = table[sessionId]
  const global = table['*']
  const level = resolved.level
  const levelFrom = session?.level !== undefined ? 'session' : global?.level !== undefined ? 'global' : 'default'
  const observed = observedFor(sessionId, { injections, tools, audit })
  // 严格档 = 旧纯净模式：段 / 上下文 / 工具由 levers 整份接管，放行（包 / 单条）只对消息生效 ⇒ 面板照实显示成被纯净模式拦。
  const verdictOf = (group, name) => {
    const verdict = decide(state, sessionId, { [GROUPS[group]]: name }, options)
    if (level === 'strict' && group !== 'messages' && verdict.action === 'allow' && !['self', 'user', 'protocol'].includes(verdict.by)) return { action: 'deny', by: 'level' }
    return verdict
  }
  const auditRows = Array.isArray(audit?.[sessionId]) ? audit[sessionId] : []
  const auditIndex = new Map(auditRows.map((row) => [`${row.group}:${row.name}`, row]))

  const catalog = packCatalog(state)
  const packs = catalog.map((pack) => {
    const items = []
    for (const [group, names] of Object.entries(observed)) {
      for (const name of names) {
        const target = { [GROUPS[group]]: name }
        const lead = packsOf(state, target)[0]
        if (lead?.pack.id !== pack.id && !(pack.origin === 'self' && name.startsWith('prefill'))) continue
        const verdict = verdictOf(group, name)
        items.push({ group, name, action: verdict.action, by: verdict.by, ...(lead?.member?.shared ? { shared: true } : {}) })
      }
    }
    const setting = { session: packSetting(session, pack.id), global: packSetting(global, pack.id) }
    // 生效：显式开关 > 档位默认（受控：core 放行、第三方拦；严格：拦；观察：放行）。本插件恒放行。
    let effective
    if (pack.origin === 'self') effective = 'allow'
    else if (setting.session ?? setting.global) effective = setting.session ?? setting.global
    else if (level === 'controlled') effective = pack.origin === 'third-party' ? 'deny' : 'allow'
    else effective = level === 'strict' ? 'deny' : 'allow'
    const actions = new Set(items.filter((item) => !item.shared).map((item) => (item.action === 'rewrite' ? 'allow' : item.action)))
    return {
      id: pack.id,
      label: pack.label,
      ...(pack.plugin ? { plugin: pack.plugin } : {}),
      ...(pack.profile ? { profile: pack.profile } : {}),
      origin: pack.origin,
      locked: pack.locked === true,
      ...(pack.summary ? { summary: pack.summary } : {}),
      ...(pack.note ? { note: pack.note } : {}),
      ...(pack.source ? { source: pack.source } : {}),
      members: pack.members.map((member) => {
        const key = memberKey(member)
        return { group: GROUP_OF[key], name: member[key], ...(member.exact ? { exact: true } : {}), ...(member.shared ? { shared: member.shared } : {}), ...(member.at ? { at: member.at } : {}) }
      }),
      ...(pack.extended ? { extended: pack.extended.length } : {}),
      setting,
      effective: actions.size > 1 ? 'mixed' : effective,
      items,
    }
  })

  const unassigned = []
  for (const [group, names] of Object.entries(observed)) {
    for (const name of names) {
      const target = { [GROUPS[group]]: name }
      if (packsOf(state, target).length > 0) continue
      if (group === 'messages' && PROTOCOL_KINDS.includes(name)) continue
      // 全局 prompt 层登记过的段 / 上下文是 DSH 内容（受控档放行），不算「未归属」；工具只有审计里出现过的才列。
      if ((group === 'sections' || group === 'contexts') && known[group].includes(name)) continue
      if (group === 'tools') continue
      const row = auditIndex.get(`${group}:${name}`)
      const verdict = verdictOf(group, name)
      // 插件自报认领了它（第 4 步，只当线索）：面板给「确认挂到 …」。
      const claimed = claimsFor(group, name).map((claim) => ({ id: claim.id, plugin: claim.plugin, label: claim.label, members: claim.members, rejected: claim.rejected.length }))
      unassigned.push({
        group,
        name,
        action: verdict.action,
        by: verdict.by,
        ...(row ? { preview: row.preview ?? '', blockable: row.blockable !== false, count: row.count ?? 1 } : {}),
        ...(claimed.length > 0 ? { claims: claimed } : {}),
      })
    }
  }

  const auditView = auditRows.map((row) => {
    const verdict = verdictOf(row.group, row.name)
    const lead = packsOf(state, { [GROUPS[row.group]]: row.name })[0]
    return {
      group: row.group,
      name: row.name,
      count: row.count ?? 1,
      blockable: row.blockable !== false,
      preview: typeof row.preview === 'string' ? row.preview : '',
      ...(row.lastSeq !== undefined ? { lastSeq: row.lastSeq } : {}),
      action: verdict.action,
      by: verdict.by,
      ...(lead ? { pack: lead.pack.id, packLabel: lead.pack.label } : {}),
      handling: handlingOf(row.group, row.name, verdict, level, row.blockable),
    }
  })

  let blocked = 0
  for (const [group, names] of Object.entries(observed)) {
    for (const name of names) {
      const verdict = verdictOf(group, name)
      const direct = group === 'messages' && (name.startsWith('developer:') || auditIndex.get(`${group}:${name}`)?.blockable === false)
      if (verdict.action === 'deny' && !direct) blocked += 1
    }
  }

  const explicit = (scope) =>
    (scope?.rules ?? [])
      .filter((rule) => rule.action === 'allow' || rule.action === 'deny')
      .map((rule) => {
        const key = Object.keys(rule.match).find((entry) => entry !== 'exact')
        return { group: GROUP_OF[key], name: rule.match[key], action: rule.action, ...(rule.soft ? { soft: true } : {}), ...(rule.match.exact ? { exact: true } : {}) }
      })

  return {
    level,
    levelFrom,
    packs,
    unassigned,
    audit: auditView,
    rules: { session: explicit(session), global: explicit(global) },
    blocked,
  }
}

/** 全部会话的视图（envelope 用）：有观察记录或在规则表里有作用域的会话。 */
export function sandboxViews(state, sources = {}, sessionIds = []) {
  const ids = new Set(sessionIds.filter((id) => typeof id === 'string'))
  for (const id of Object.keys(sources.injections?.sessions ?? {})) ids.add(id)
  for (const id of Object.keys(sources.audit ?? {})) ids.add(id)
  for (const id of Object.keys(sandboxOf(state))) if (id !== '*') ids.add(id)
  const out = {}
  for (const id of ids) {
    try {
      out[id] = sandboxView(state, id, sources)
    } catch (error) {
      out[id] = { error: String(error?.message ?? error) }
    }
  }
  return out
}

export { isObject }
