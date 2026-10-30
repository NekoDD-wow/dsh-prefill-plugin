/**
 * 首轮锁定 + 开跑后套预设（issue #19「A」「B」）。
 *
 * ── A. 首轮锁定 ──────────────────────────────────────────────────────────
 * 以前「会话开没开跑」只靠面板里的 `turns > 0` 推断（来自闸门内存里的快照，DSH 重启后要等下一步才有），
 * 只影响首轮的配置（开场对话、每轮注入的「只在首轮」段）没有任何锁。现在会话第一次真正开跑时
 * 记一条 `state.locked[会话]`：
 *
 * ```jsonc
 * "locked": {
 *   "session-xxx": {
 *     "at": "2026-10-28T…Z",      // 锁定时间
 *     "turn": 3,                  // 第一条真实消息所在的轮（物化了 2 轮开场 ⇒ 3）
 *     "items": [ … ],             // 写进历史的开场对话（没有 = []）
 *     "preset": { "maps": { "everyTurn": …, "overrides": …, … }, "armed": false },  // 开局时的配置快照
 *     "legacy": true              // 可选：本版之前就开跑的会话，快照取自第一次被看到时（不是真正的开局）
 *   }
 * }
 * ```
 *
 * 两个落点（都只写一次，已有锁就不动）：
 *   · 物化开场对话成功时（gate.onInboxInserted，同步）—— items = 写进去的那些；
 *   · 每轮第 1 步（gate.step）发现还没有锁 —— 没有开场对话的会话、或本版之前开跑的会话。
 * 快照的形状和面板「取消预设 → 撤销」用的 presetSnapshot 一致（按会话的每张表里本会话那一格 + armed），
 * 取自兼容视图（withLegacyView：系统提示改写 / 工具白名单 / 纯净模式以旧字段的形状出现），
 * 恢复时也写旧字段，由 normalizeState 整族吸收回规则表 —— 和面板写状态是同一条路。
 *
 * 锁之后：
 *   · 不再物化开场对话（hasTurn 本来就挡着，这里再加一道：有锁就不写）；
 *   · 每轮注入的「只在首轮」段只在**会话的第一条真实消息那轮**发（firstPlan）。
 *     以前按「本会话第一次注入」判断：开跑后才打开 / 套用带首轮段的预设，第 N 轮会突然发出整段开场设定。
 *
 * ── B. 开跑后套预设 ──────────────────────────────────────────────────────
 * DSH 没有回退 / 截断会话的接口（只有 fork），已经写进历史的东西改不了。所以开跑后套预设：
 *   · 系统提示、每轮注入、工具、世界书照常换，下一轮生效（原本就是）；
 *   · 预设里的开场对话不发、不进草稿，面板提示可以用「手动注入」补；
 *   · 「只在首轮」段默认跳过；每轮注入配置里 `firstOnce: true` = 「下一轮发一次」，
 *     服务端盖成 `{ atTurn: 下一轮 }`，闸门从 atTurn 起第一次注入时发首轮段，之后靠会话日志里的标记
 *     （every-turn 消息的 `source.first`）判断已经发过，不用回写状态；
 *   · 「恢复开局时的预设」：用锁里的快照换回配置（restorePatch），下一轮生效，历史不动。
 *
 * ── since ────────────────────────────────────────────────────────────────
 * 自动模式的 `since` 是写配置时盖的「下一轮」（lastTurn + 1）。两处修正：
 *   · 恢复开局快照：快照里的配置不是「重新开始」，沿用它自己的 since（夹到 ≤ 下一轮），
 *     否则恢复后从下一轮重新预热、开局以来的判定全被跳过；
 *   · 任何写入都把 since 夹到 [0, lastTurn + 1]：since 比实际轮数还大时，之后实际跑的轮会被当成
 *     「重新开始之前」整段跳过、一直不计分（clampSince）。
 *
 * 本文件全是纯函数，不碰 IO。
 *
 * @module @local/dsh-prefill/turn-lock
 */

/** 快照 / 恢复覆盖的按会话表（与 client.js 的 PRESET_KEYS 一致，tests/turn-lock.test.mjs 比对两份）。 */
export const LOCK_KEYS = ['activePreset', 'overrides', 'gate', 'sessionTools', 'cardRef', 'lore', 'memory', 'everyTurn', 'enabled', 'workspaceInstructions', 'slotSource']

/** state.locked 最多留多少条（最老的先丢）。每条很小，只是别让长期跑的 DSH 无限涨。 */
export const MAX_LOCKS = 300

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const clone = (value) => (value === undefined ? undefined : structuredClone(value))

function without(map, sessionId) {
  const next = { ...(isObject(map) ? map : {}) }
  delete next[sessionId]
  return next
}

/** 本会话的锁（没有 / 坏值 ⇒ undefined）。 */
export function lockOf(state, sessionId) {
  const entry = typeof sessionId === 'string' && isObject(state?.locked) ? state.locked[sessionId] : undefined
  return isObject(entry) ? entry : undefined
}

/**
 * 开局快照：每张按会话表里本会话这一格（缺 = 不记）+ armed 里有没有本会话。
 * `view` 应当是兼容视图（withLegacyView），这样系统提示改写 / 工具 / 纯净模式也在里面。
 * 每轮注入那格去掉运行时字段里的一次性请求（firstOnce），since / override 保留（恢复时要用）。
 */
export function presetSnapshotOf(view, sessionId) {
  const maps = {}
  for (const key of LOCK_KEYS) {
    const map = view?.[key]
    if (isObject(map) && Object.prototype.hasOwnProperty.call(map, sessionId) && map[sessionId] !== undefined) maps[key] = clone(map[sessionId])
  }
  if (isObject(maps.everyTurn)) delete maps.everyTurn.firstOnce
  return { maps, armed: Array.isArray(view?.armed) && view.armed.includes(sessionId) }
}

/** 只留开场对话里有用的字段（和 sanitizeItems 同形）。 */
function lockItems(items) {
  if (!Array.isArray(items)) return []
  return items
    .filter((item) => isObject(item) && (item.role === 'user' || item.role === 'assistant') && typeof item.text === 'string' && item.text.trim() !== '')
    .map((item) => (item.role === 'assistant' ? { role: 'assistant', text: item.text, reasoning: typeof item.reasoning === 'string' ? item.reasoning : '' } : { role: 'user', text: item.text }))
}

/**
 * 锁记录。`info = { turn, items, legacy, at }`：turn = 第一条真实消息所在的轮。
 */
export function lockRecord(view, sessionId, info = {}) {
  const turn = Math.max(1, Math.floor(Number(info.turn) || 1))
  return {
    at: typeof info.at === 'string' ? info.at : new Date().toISOString(),
    turn,
    items: lockItems(info.items),
    preset: { ...presetSnapshotOf(view, sessionId), sandbox: clone(view?.sandbox?.[sessionId]) ?? null },
    ...(info.legacy === true ? { legacy: true } : {}),
  }
}

/** 把一条锁放进 state.locked（已有就原样返回 undefined = 不用写）；超过 MAX_LOCKS 丢最老的。 */
export function withLock(locked, sessionId, record) {
  const current = isObject(locked) ? locked : {}
  if (isObject(current[sessionId])) return undefined
  const next = { ...current, [sessionId]: record }
  const keys = Object.keys(next)
  if (keys.length > MAX_LOCKS) {
    const order = keys.sort((a, b) => String(next[a]?.at ?? '').localeCompare(String(next[b]?.at ?? '')))
    for (const key of order.slice(0, keys.length - MAX_LOCKS)) if (key !== sessionId) delete next[key]
  }
  return next
}

/**
 * 会话日志里第一条真实消息所在的轮（没有 = undefined）。turns = splitTurns 的结果。
 * 「真实」= 有用户原话（source.kind === 'user' 且不是预填装写的），不是合成轮。
 */
export function firstRealTurn(turns) {
  const hit = (Array.isArray(turns) ? turns : []).find((turn) => !turn.synthetic && turn.hasUser)
  return hit?.turn
}

/**
 * 第 currentTurn 轮之前，会话是否已经开跑过（锁住了）。
 * 以会话日志为准（第 1 步在落盘前被中止的那一轮没有用户原话，不算开跑）；日志读不出来时看锁。
 */
export function lockedBefore(lock, turns, currentTurn) {
  const list = Array.isArray(turns) ? turns : []
  if (list.some((turn) => turn.turn < currentTurn && !turn.synthetic && turn.hasUser)) return true
  if (list.length === 0 && lock !== undefined) return Number(lock.turn) < currentTurn
  return false
}

/**
 * 「下一轮发一次」首轮段（firstOnce = { atTurn }）到期没有：currentTurn ≥ atTurn，
 * 且 [atTurn, currentTurn) 之间还没有哪一轮发过首轮段（every-turn 消息带 source.first）。
 */
export function firstOnceDue(firstOnce, turns, currentTurn) {
  const at = Number(firstOnce?.atTurn)
  if (!Number.isFinite(at) || currentTurn < at) return false
  return !(Array.isArray(turns) ? turns : []).some((turn) => turn.turn >= at && turn.turn < currentTurn && turn.firstSent === true)
}

/**
 * 这一轮的首轮段怎么发。
 * @param entry everyTurnFor 的结果（firstText 已 trim；firstOnce 只认本会话那格）
 * @param plan replay 的结果（isFirst = 本会话还没注入过）
 * @returns { useFirst, force, locked, reason: 'first-turn' | 'once' | 'locked-skip' | 'none' }
 *   force = 自动模式暂停中也要发（用户点了「下一轮发一次」）。
 */
export function firstPlan(entry, plan, { lock, turns, currentTurn } = {}) {
  const locked = lockedBefore(lock, turns, currentTurn)
  const hasFirst = typeof entry?.firstText === 'string' && entry.firstText !== ''
  if (!hasFirst) return { useFirst: false, force: false, locked, reason: 'none' }
  if (!locked) return { useFirst: plan?.isFirst === true, force: false, locked, reason: plan?.isFirst === true ? 'first-turn' : 'none' }
  if (firstOnceDue(entry.firstOnce, turns, currentTurn)) return { useFirst: true, force: true, locked, reason: 'once' }
  return { useFirst: false, force: false, locked, reason: plan?.isFirst === true ? 'locked-skip' : 'none' }
}

/** since 夹到 [0, lastTurn + 1]。 */
export function clampSince(since, lastTurn) {
  const max = Math.max(0, Math.floor(Number(lastTurn) || 0)) + 1
  const value = Math.max(0, Math.floor(Number(since) || 0))
  return Math.min(value, max)
}

/**
 * 「恢复开局时的预设」的 state patch：按锁里的快照把本会话那一格放回最新的 state（别的会话不动）。
 * `view` = 兼容视图（旧字段形状，和快照一致）；lastTurn = 会话里最后一轮。
 *   · 快照里缺的一格 = 删掉；但 gate 写 'pass'（删掉 gate 格不会撤掉规则表里的严格档）；
 *   · 每轮注入那格沿用快照自己的 since（夹到 ≤ 下一轮），手动收放的覆盖只留轮号不超过下一轮的，
 *     去掉 firstOnce —— 不是「重新开始」，开局以来的判定接着算。
 * 返回 undefined = 没有锁。
 */
export function restorePatch(view, sessionId, lock, lastTurn) {
  if (!isObject(lock) || !isObject(lock.preset)) return undefined
  const maps = isObject(lock.preset.maps) ? lock.preset.maps : {}
  const patch = {}
  for (const key of LOCK_KEYS) {
    let value = clone(maps[key])
    if (key === 'gate' && value === undefined) value = 'pass'
    if (key === 'everyTurn' && isObject(value)) {
      delete value.firstOnce
      value.since = clampSince(value.since, lastTurn)
      const override = value.auto?.override
      if (override !== undefined && !(Number(override?.atTurn) <= Math.max(0, Number(lastTurn) || 0) + 1)) {
        value.auto = { ...value.auto }
        delete value.auto.override
      }
    }
    patch[key] = value === undefined ? without(view?.[key], sessionId) : { ...(isObject(view?.[key]) ? view[key] : {}), [sessionId]: value }
  }
  const armed = (Array.isArray(view?.armed) ? view.armed : []).filter((id) => id !== sessionId)
  patch.armed = lock.preset.armed === true ? [...armed, sessionId] : armed
  return patch
}

/**
 * 每轮注入写入时的 firstOnce 盖章（stampEveryTurn 里调用）：
 *   · 新格 firstOnce === true ⇒ { atTurn: lastTurn + 1 }；对象（已盖过章）原样；false ⇒ 去掉；
 *   · 新格没带 ⇒ 首轮段没变就沿用旧格的，变了就去掉（请求是针对旧的那段首轮段的）。
 */
export function stampFirstOnce(entry, old, lastTurn) {
  const wanted = entry?.firstOnce
  if (wanted === true) return { atTurn: Math.max(0, Math.floor(Number(lastTurn) || 0)) + 1 }
  if (wanted === false || wanted === null) return undefined
  if (isObject(wanted) && Number.isFinite(Number(wanted.atTurn))) return { atTurn: Math.floor(Number(wanted.atTurn)) }
  if (isObject(old?.firstOnce) && String(entry?.firstText ?? '') === String(old?.firstText ?? '')) return old.firstOnce
  return undefined
}

/**
 * 给面板的锁状态：{ locked, turn, items, legacy, at, hasSnapshot }。
 * 没有锁记录但会话已经开跑（本版之前开跑、还没跑过新的一步）⇒ locked: true、legacy: true、没有快照。
 */
export function lockStatus(lock, turns) {
  if (lock !== undefined) {
    return { locked: true, turn: Number(lock.turn) || 1, items: Array.isArray(lock.items) ? lock.items : [], legacy: lock.legacy === true, at: lock.at ?? null, hasSnapshot: isObject(lock.preset) }
  }
  const first = firstRealTurn(turns)
  if (first !== undefined) return { locked: true, turn: first, items: [], legacy: true, at: null, hasSnapshot: false }
  return { locked: false, turn: 0, items: [], legacy: false, at: null, hasSnapshot: false }
}

/**
 * 恢复开局预设时把会话沙盒那一格（档位 / 来源包开关 / 单条规则）也换回快照（会话沙盒第 2–3 步之后，
 * 受控档、包开关这些旧字段表达不了，只靠 restorePatch 的旧字段视图撤不回）。
 * 快照里没有 sandbox 键（本功能之前锁的）⇒ undefined = 不动；有但为 null ⇒ 删掉本会话那格。
 */
export function restoreSandbox(sandbox, sessionId, lock) {
  const preset = lock?.preset
  if (!isObject(preset) || !Object.prototype.hasOwnProperty.call(preset, 'sandbox')) return undefined
  const cell = clone(preset.sandbox)
  if (isObject(cell)) return { ...(isObject(sandbox) ? sandbox : {}), [sessionId]: cell }
  return without(isObject(sandbox) ? sandbox : {}, sessionId)
}
