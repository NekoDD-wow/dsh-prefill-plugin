/**
 * 会话沙盒的路由逻辑（`/api/dsh-prefill/sandbox`，issue #15 第 4 / 5 步）。壳（impl.js）只负责注册路由、
 * 把依赖（读写状态、在册会话、根 ctx）递进来；逻辑放这里方便单测。
 *
 * op：
 *   claims                       —— 插件自报的来源包（线索）
 *   trace       { group, name }  —— 静态扫描本机插件包源码，找注册点 + 候选来源包
 *   trace-ai    { group, name, sessionId } —— 同上，再用宿主 LLM 写结论（用户点按钮才调）
 *   attach      { pack, sessionId?, setting? } —— 用户确认：挂上来源包（写 state.sandboxPacks），可顺手设本会话开关
 *   detach      { id, member? }  —— 摘掉一个成员 / 整个用户挂上的包
 *   surface-*                    —— 第 5 步：直写会话的通道按条事后改写（见 sandbox-surface.js）
 *
 * @module @local/dsh-prefill/sandbox-routes
 */

import { BUILTIN_PACKS, memberKey, sanitizePacks } from './sandbox-packs.js'
import { aiTrace, candidatePack, claims, claimsFor, traceName, TARGET_OF } from './sandbox-trace.js'

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const sameMember = (a, b) => {
  const key = memberKey(a)
  return key !== undefined && key === memberKey(b) && a[key] === b[key] && (a.exact === true) === (b.exact === true)
}

/** 挂包：和已有的同 id 包合并成员；内置包（非本插件）只加成员。返回新的 sandboxPacks。 */
export function attachPack(current, raw) {
  if (!isObject(raw) || typeof raw.id !== 'string') return { ok: false, reason: 'bad-pack' }
  const packs = { ...(isObject(current) ? current : {}) }
  const builtin = BUILTIN_PACKS.find((pack) => pack.id === raw.id)
  if (builtin?.locked) return { ok: false, reason: 'locked' }
  const existing = packs[raw.id]
  const members = [...(Array.isArray(existing?.members) ? existing.members : [])]
  for (const member of Array.isArray(raw.members) ? raw.members : []) if (!members.some((entry) => sameMember(entry, member))) members.push(member)
  const merged = builtin
    ? { extends: true, members }
    : {
        ...(isObject(existing) ? existing : {}),
        id: raw.id,
        label: typeof raw.label === 'string' && raw.label !== '' ? raw.label : existing?.label ?? raw.id,
        ...(typeof raw.plugin === 'string' ? { plugin: raw.plugin } : existing?.plugin ? { plugin: existing.plugin } : {}),
        members,
        source: { ...(isObject(existing?.source) ? existing.source : {}), ...(isObject(raw.source) ? raw.source : {}), confirmed: true, at: new Date().toISOString().slice(0, 19) },
      }
  const next = sanitizePacks({ ...packs, [raw.id]: merged })
  if (next[raw.id] === undefined) return { ok: false, reason: 'no-valid-members' }
  const dropped = (Array.isArray(raw.members) ? raw.members : []).filter((member) => !next[raw.id].members.some((entry) => sameMember(entry, { ...member, exact: member.exact === true || !String(member[memberKey(member)] ?? '').includes('*') })))
  return { ok: true, packs: next, dropped }
}

/** 摘成员 / 摘包。 */
export function detachPack(current, id, member) {
  const packs = { ...(isObject(current) ? current : {}) }
  if (packs[id] === undefined) return { ok: false, reason: 'not-found' }
  if (member === undefined) delete packs[id]
  else {
    const members = (packs[id].members ?? []).filter((entry) => !sameMember(entry, member))
    if (members.length === 0) delete packs[id]
    else packs[id] = { ...packs[id], members }
  }
  return { ok: true, packs: sanitizePacks(packs) }
}

/**
 * 处理一次请求。
 * @param deps `{ readState, patchState, liveAgents, rootCtx, note, surface }`（surface = sandbox-surface.js 的处理函数，第 5 步）
 */
export async function sandboxRoute(body, deps) {
  const op = typeof body?.op === 'string' ? body.op : 'claims'
  const target = { group: body?.group, name: typeof body?.name === 'string' ? body.name.slice(0, 200) : '' }
  if (op === 'claims') return { ok: true, op, claims: claims() }
  if (op === 'trace' || op === 'trace-ai') {
    if (TARGET_OF[target.group] === undefined || target.name === '') return { ok: false, op, reason: 'bad-target' }
    const trace = traceName(target, { rootCtx: deps.rootCtx, packages: deps.packages })
    const top = trace.candidates[0]
    const result = {
      ok: true,
      op,
      ...trace,
      claims: claimsFor(target.group, target.name),
      pack: candidatePack(trace, top),
      single: candidatePack(trace, top, { only: true }),
    }
    if (op === 'trace-ai') {
      const agent = typeof body?.sessionId === 'string' ? deps.liveAgents?.get(body.sessionId) : undefined
      try {
        result.ai = await aiTrace(trace, { rootCtx: deps.rootCtx, agent })
      } catch (error) {
        result.ai = { ok: false, reason: String(error?.message ?? error) }
      }
      if (result.ai.ok && result.pack) result.pack.source.via = 'ai'
    }
    deps.note?.({ seat: 'sandbox-route', op, target, candidates: trace.candidates.length, scanned: trace.scanned, ai: result.ai?.ok ?? null })
    return result
  }
  if (op === 'attach') {
    const state = deps.readState()
    const got = attachPack(state?.sandboxPacks, body?.pack)
    if (!got.ok) return { ok: false, op, reason: got.reason }
    const patch = { sandboxPacks: got.packs }
    const setting = body?.setting
    if (typeof body?.sessionId === 'string' && body.sessionId !== '' && (setting === 'allow' || setting === 'deny')) {
      const sandbox = JSON.parse(JSON.stringify(state?.sandbox ?? {}))
      const scope = (sandbox[body.sessionId] ??= { rules: [] })
      scope.packs = { ...(scope.packs ?? {}), [body.pack.id]: setting }
      patch.sandbox = sandbox
    }
    deps.patchState(patch)
    deps.note?.({ seat: 'sandbox-route', op, id: body.pack.id, members: got.packs[body.pack.id]?.members?.length ?? 0, dropped: got.dropped.length })
    return { ok: true, op, id: body.pack.id, pack: got.packs[body.pack.id], dropped: got.dropped }
  }
  if (op === 'detach') {
    const state = deps.readState()
    const got = detachPack(state?.sandboxPacks, body?.id, isObject(body?.member) ? body.member : undefined)
    if (!got.ok) return { ok: false, op, reason: got.reason }
    deps.patchState({ sandboxPacks: got.packs })
    return { ok: true, op }
  }
  if (op.startsWith('surface-') && typeof deps.surface === 'function') return deps.surface(op, body, deps)
  return { ok: false, op, reason: 'unknown-op' }
}
