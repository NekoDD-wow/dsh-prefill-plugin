// 会话沙盒第 1 步（issue #15）：规则表 + 旧字段迁移 + 解析函数。
// 重点：迁移幂等、迁移前后闸门行为完全一致、prefill:* 不能被 deny。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  NameSet,
  decide,
  matchName,
  matchRule,
  migrateSandbox,
  protectedBy,
  resolveSandbox,
  sanitizeSandbox,
  MIRROR_KEY,
  withLegacyMirror,
  withLegacyView,
} from '../sandbox.js'
import { applyEnabled, fingerprint } from '../enabled.js'
import { applyMessageBlocks, snapshots, step } from '../gate.js'
import { blocksFor } from '../injection-audit.js'

const clone = (value) => JSON.parse(JSON.stringify(value))
/** impl.js 的 normalizeState 会把 levers / armed / allowKinds 补齐，这里照做。 */
const base = (extra = {}) => ({
  version: 2,
  armed: [],
  levers: { probeSection: false, probeContext: false, blockSections: false, blockContexts: false, blockTools: false, blockMessages: false, prefillProbe: false },
  allowKinds: ['user'],
  ...extra,
})
/** 模拟「读盘 → normalizeState（迁移）」：内存里只剩新字段。 */
const roundTrip = (state) => clone(migrateSandbox(state))
/** 写盘形状（impl.js writeState）：规则表 + 旧字段镜像 + 指纹。 */
const toDisk = (state) => clone(withLegacyMirror(state))

// ── 每种旧字段的迁移结果 ─────────────────────────────────────────────────────

test('overrides → own rewrite + rewrite 规则（sectionOrders 挂到同名规则上）', () => {
  const state = {
    overrides: {
      s: { messages: { 'runtime-context': 'R' }, sections: { 'prefill:persona': 'P', 'harness:identity': 'I' }, contexts: { 'x:ctx': 'C' }, sectionOrders: { 'harness:identity': -1000, orphan: 5 } },
      '*': { sections: { 'prefill:persona': '通配' } },
      broken: null,
    },
  }
  const out = migrateSandbox(state)
  assert.equal(out.overrides, undefined)
  assert.deepEqual(out.sandbox.s, {
    own: ['rewrite'],
    rules: [
      { match: { kind: 'runtime-context', exact: true }, action: 'rewrite', text: 'R' },
      { match: { section: 'prefill:persona', exact: true }, action: 'rewrite', text: 'P' },
      { match: { section: 'harness:identity', exact: true }, action: 'rewrite', text: 'I', order: -1000 },
      { match: { context: 'x:ctx', exact: true }, action: 'rewrite', text: 'C' },
    ],
  })
  assert.deepEqual(out.sandbox['*'], { own: ['rewrite'], rules: [{ match: { section: 'prefill:persona', exact: true }, action: 'rewrite', text: '通配' }] })
  assert.equal(out.sandbox.broken, undefined, 'null 格 = 没配（旧逻辑会回落到 *）')
  // 空表也算「配了」（applyEnabled 用它挡住 '*' 回落、闸门据此武装会话）。
  const empty = migrateSandbox({ overrides: { s: { messages: {}, sections: {}, contexts: {} } } })
  assert.deepEqual(empty.sandbox.s, { own: ['rewrite'], rules: [] })
  assert.deepEqual(resolveSandbox(empty, 's').rewrite, { messages: {}, sections: {}, contexts: {} })
})

test('sessionAllowKinds → own allow + 每个 kind 一条软 allow（字面 * 不变通配）', () => {
  const out = migrateSandbox({ sessionAllowKinds: { s: ['agent-message', 7, '*'], '*': [], junk: 'x' } })
  assert.equal(out.sessionAllowKinds, undefined)
  assert.deepEqual(out.sandbox.s, {
    own: ['allow'],
    rules: [
      { match: { kind: 'agent-message', exact: true }, action: 'allow', soft: true },
      { match: { kind: '*', exact: true }, action: 'allow', soft: true },
    ],
  })
  assert.deepEqual(out.sandbox['*'], { own: ['allow'], rules: [] })
  assert.equal(out.sandbox.junk, undefined)
  assert.equal(resolveSandbox(out, 's').messageAllow.has('goal'), false, '旧名单里字面的 * 只匹配 kind "*"')
})

test('sessionTools → own tools + allow 若干 + tool:* deny；[] = 一个都不给；null = 没配', () => {
  const out = migrateSandbox({ sessionTools: { s: ['read', 'grep'], none: [], reset: null } })
  assert.equal(out.sessionTools, undefined)
  assert.deepEqual(out.sandbox.s, {
    own: ['tools'],
    rules: [
      { match: { tool: 'read', exact: true }, action: 'allow' },
      { match: { tool: 'grep', exact: true }, action: 'allow' },
      { match: { tool: '*' }, action: 'deny' },
    ],
  })
  assert.deepEqual(out.sandbox.none, { own: ['tools'], rules: [{ match: { tool: '*' }, action: 'deny' }] })
  assert.equal(out.sandbox.reset, undefined)
  assert.deepEqual(resolveSandbox(out, 's').toolAllow, ['read', 'grep'])
  assert.deepEqual(resolveSandbox(out, 'none').toolAllow, [])
  assert.equal(resolveSandbox(out, 'reset').toolAllow, undefined, '没配 ⇒ 闸门回落 state.tools')
})

test('injectionBlocks → deny 规则（不带 own：会话 ∪ 全局）', () => {
  const out = migrateSandbox({
    injectionBlocks: { s: { messages: ['agent-message'], contexts: ['team:identity'], sections: ['team:policy'] }, '*': { contexts: ['team:identity'] } },
  })
  assert.equal(out.injectionBlocks, undefined)
  assert.deepEqual(out.sandbox.s, {
    rules: [
      { match: { kind: 'agent-message', exact: true }, action: 'deny' },
      { match: { context: 'team:identity', exact: true }, action: 'deny' },
      { match: { section: 'team:policy', exact: true }, action: 'deny' },
    ],
  })
  assert.deepEqual(out.sandbox['*'], { rules: [{ match: { context: 'team:identity', exact: true }, action: 'deny' }] })
})

test("gate 'pure' → level strict；replace / pass 留在 gate；'*' 格不迁", () => {
  const out = migrateSandbox({ gate: { a: 'pure', b: 'replace', c: 'pass', '*': 'pure' } })
  assert.deepEqual(out.gate, { b: 'replace', c: 'pass', '*': 'pure' })
  assert.deepEqual(out.sandbox, { a: { level: 'strict', rules: [] } })
  assert.equal(resolveSandbox(out, 'a').level, 'strict')
  assert.equal(resolveSandbox(out, 'b').level, 'observe')
  assert.equal(resolveSandbox(out, 'zzz').level, 'observe', "旧 gate['*'] 本来就不作用于任何会话")
  // 面板把 a 改成 pass（gate 里出现非 pure 的格）⇒ 严格档撤掉。
  const back = migrateSandbox({ ...out, gate: { ...out.gate, a: 'pass' } })
  assert.equal(back.sandbox.a, undefined)
  assert.equal(back.gate.a, 'pass')
})

// ── 幂等 / 写回 ───────────────────────────────────────────────────────────────

const LEGACY = () => ({
  ...base(),
  gate: { s: 'pure', r: 'replace' },
  overrides: { s: { messages: { 'runtime-context': 'R' }, sections: { 'prefill:persona': 'P' }, contexts: {} }, '*': { messages: {}, sections: { probe: '1' }, contexts: {} } },
  sessionAllowKinds: { s: ['agent-message'], '*': ['goal'] },
  sessionTools: { s: [], t: ['read'] },
  injectionBlocks: { s: { messages: ['team-note'] }, '*': { contexts: ['team:identity'] } },
  everyTurn: { s: { enabled: true, text: '提醒' } },
})

test('迁移幂等：再迁一次 / 读回来再迁 都不变；旧字段不再写回', () => {
  const once = migrateSandbox(LEGACY())
  assert.equal(migrateSandbox(once), once)
  const disk = roundTrip(LEGACY())
  assert.deepEqual(roundTrip(disk), disk)
  assert.equal(JSON.stringify(roundTrip(disk)), JSON.stringify(disk), '键顺序也稳定')
  for (const field of ['overrides', 'sessionAllowKinds', 'sessionTools', 'injectionBlocks']) assert.equal(field in disk, false, field)
  assert.deepEqual(disk.gate, { r: 'replace' })
  assert.deepEqual(disk.everyTurn, LEGACY().everyTurn, '无关字段原样保留')
  // 没东西可迁：同一个对象。
  const plain = base()
  assert.equal(migrateSandbox(plain), plain)
})

test('兼容视图 → 迁回：和原来的规则表一致（面板整张表写回不丢东西）', () => {
  const disk = roundTrip(LEGACY())
  const view = clone(withLegacyView(disk))
  assert.deepEqual(view.overrides.s, LEGACY().overrides.s)
  assert.deepEqual(view.sessionAllowKinds, LEGACY().sessionAllowKinds)
  assert.deepEqual(view.sessionTools, LEGACY().sessionTools)
  assert.deepEqual(view.injectionBlocks, LEGACY().injectionBlocks)
  assert.deepEqual(view.gate, LEGACY().gate)
  // 面板像以前那样把旧字段整张写回（JSON 新对象）：吸收后规则表不变。
  const patched = roundTrip({ ...disk, overrides: view.overrides, sessionTools: view.sessionTools, gate: view.gate, sessionAllowKinds: view.sessionAllowKinds, injectionBlocks: view.injectionBlocks })
  assert.deepEqual(patched, disk)
  // 面板改一格：只动那一族。
  const edited = roundTrip({ ...disk, sessionTools: { ...view.sessionTools, s: ['bash'] } })
  assert.deepEqual(resolveSandbox(edited, 's').toolAllow, ['bash'])
  assert.deepEqual(resolveSandbox(edited, 's').rewrite, resolveSandbox(disk, 's').rewrite)
  assert.equal(resolveSandbox(edited, 's').level, 'strict')
  // 「清除本会话配置」：删掉会话格 ⇒ 回落 '*'。
  const cleared = roundTrip({ ...disk, overrides: { '*': view.overrides['*'] }, sessionAllowKinds: { '*': ['goal'] }, sessionTools: { t: ['read'] }, injectionBlocks: { '*': view.injectionBlocks['*'] } })
  assert.deepEqual(resolveSandbox(cleared, 's').rewrite, view.overrides['*'])
  assert.deepEqual(resolveSandbox(cleared, 's').allowKinds, ['goal'])
})

// ── 解析：等价于旧各字段的读法 ───────────────────────────────────────────────

/** 旧版各读法的原样拷贝（0.15.2 的 gate.js / injection-audit.js）。 */
const old = {
  overridesFor(state, id) {
    const all = state?.overrides
    if (all === null || typeof all !== 'object') return undefined
    const exact = typeof id === 'string' ? all[id] : undefined
    const entry = exact !== undefined && exact !== null && typeof exact === 'object' ? exact : all['*']
    return entry !== undefined && entry !== null && typeof entry === 'object' ? entry : undefined
  },
  allowKindsFor(state, id) {
    const per = state?.sessionAllowKinds
    if (per !== null && typeof per === 'object') {
      const list = (typeof id === 'string' ? per[id] : undefined) ?? per['*']
      if (Array.isArray(list)) return list.filter((kind) => typeof kind === 'string')
    }
    return Array.isArray(state?.allowKinds) ? state.allowKinds : ['user']
  },
  tools: (state, id) => state?.sessionTools?.[id] ?? state?.sessionTools?.['*'] ?? state?.tools,
  blocks(state, id) {
    const all = state?.injectionBlocks
    const pick = (key) => (all !== null && typeof all === 'object' && all[key] !== null && typeof all[key] === 'object' ? all[key] : {})
    const list = (value) => (Array.isArray(value) ? value.filter((name) => typeof name === 'string' && name !== '') : [])
    const session = typeof id === 'string' ? pick(id) : {}
    const global = pick('*')
    const merge = (group) => [...new Set([...list(global[group]), ...list(session[group])].filter((name) => !name.startsWith('prefill:')))]
    return { messages: merge('messages'), contexts: merge('contexts'), sections: merge('sections') }
  },
}
/** 旧 overrides 格可能缺组 / 组是 null；闸门对这些一律按空组处理，所以比的是「补齐后」。 */
const fill = (entry) =>
  entry === undefined
    ? undefined
    : {
        messages: entry.messages && typeof entry.messages === 'object' ? entry.messages : {},
        sections: entry.sections && typeof entry.sections === 'object' ? entry.sections : {},
        contexts: entry.contexts && typeof entry.contexts === 'object' ? entry.contexts : {},
      }

test('resolveSandbox 与旧读法逐会话等价（含 * 回落、缺组、null 格）', () => {
  const states = [
    LEGACY(),
    base({ overrides: { '*': { sections: { a: '1' } }, s: null }, sessionTools: { '*': ['read'], s: null }, sessionAllowKinds: { s: null, '*': ['x'] } }),
    base({ overrides: { s: { sections: null, messages: { m: '1' } } }, tools: ['grep'], allowKinds: ['user', 'goal'] }),
    base({ injectionBlocks: { s: { messages: ['agent-message', 'user'], contexts: ['prefill:x'] }, '*': { contexts: ['team:identity'], sections: [] } } }),
    base(),
  ]
  for (const legacy of states) {
    const migrated = roundTrip(legacy)
    for (const id of ['s', 't', 'r', 'other', '*', undefined]) {
      const label = `${JSON.stringify(legacy).slice(0, 60)} @ ${id}`
      const r = resolveSandbox(migrated, id)
      const ro = resolveSandbox(legacy, id) // 未迁移的旧形状直接喂也一样
      assert.deepEqual(fill(r.rewrite), fill(old.overridesFor(legacy, id)), label)
      assert.deepEqual(ro.rewrite, r.rewrite, label)
      assert.deepEqual(r.allowKinds, old.allowKindsFor(legacy, id), label)
      const wanted = r.toolAllow !== undefined ? r.toolAllow : migrated.tools
      const oldWanted = old.tools(legacy, id)
      assert.deepEqual(Array.isArray(wanted) ? wanted : null, Array.isArray(oldWanted) ? oldWanted.filter((name) => typeof name === 'string') : null, label)
      const blocks = blocksFor(migrated, id)
      const oldBlocks = old.blocks(legacy, id)
      for (const group of ['messages', 'contexts', 'sections']) assert.deepEqual([...blocks[group]], oldBlocks[group], `${label} ${group}`)
    }
  }
})

// ── 匹配语义 ─────────────────────────────────────────────────────────────────

test('match：kind / section / context / tool，前缀通配，exact 关通配', () => {
  assert.equal(matchName('team:*', 'team:identity'), true)
  assert.equal(matchName('team:*', 'teams:x'), false)
  assert.equal(matchName('*', 'anything'), true)
  assert.equal(matchName('*', 'anything', true), false)
  assert.equal(matchName('a.b', 'aXb'), false, '正则元字符按字面')
  assert.equal(matchRule({ match: { section: 'harness:*' }, action: 'deny' }, { section: 'harness:identity' }), true)
  assert.equal(matchRule({ match: { section: 'harness:*' }, action: 'deny' }, { context: 'harness:identity' }), false, '维度不同不命中')
  assert.equal(matchRule({ match: { tool: 'mcp_*' }, action: 'allow' }, { tool: 'mcp_fs_read' }), true)
  assert.equal(matchRule({ match: { kind: 'x', section: 'y' }, action: 'deny' }, { kind: 'x' }), false, '一条规则只认一个维度')
  const set = new NameSet([{ name: 'team:*' }, { name: 'prefill:persona' }, { name: 'lit*', exact: true }])
  assert.equal(set.has('team:policy'), true)
  assert.equal(set.has('lit*'), true)
  assert.equal(set.has('literal'), false)
  assert.equal(set.has('prefill:persona'), false)
  assert.deepEqual([...set], ['team:*', 'lit*'])
})

test('sanitizeSandbox：丢掉不合法的作用域 / 规则 / 档位', () => {
  const out = sanitizeSandbox({
    s: { level: 'nope', own: ['tools', 'bogus'], rules: [{ match: { tool: '*' }, action: 'deny' }, { match: {}, action: 'deny' }, { match: { kind: 'x' }, action: 'rewrite' }, { match: { tool: 'a' }, action: 'rewrite', text: '' }, 'junk'] },
    empty: { rules: [] },
    '': { level: 'strict' },
    g: { level: 'controlled' },
  })
  assert.deepEqual(out, { s: { own: ['tools'], rules: [{ match: { tool: '*' }, action: 'deny' }] }, g: { level: 'controlled', rules: [] } })
})

// ── 优先级 + 恒放行 ──────────────────────────────────────────────────────────

test('优先级：会话规则 > 全局规则 > 档位默认', () => {
  const state = {
    sandbox: {
      s: { level: 'strict', rules: [{ match: { kind: 'goal' }, action: 'allow' }, { match: { section: 'harness:identity' }, action: 'rewrite', text: '会话版' }, { match: { tool: 'read' }, action: 'allow' }] },
      '*': {
        level: 'observe',
        rules: [
          { match: { section: 'harness:identity' }, action: 'rewrite', text: '全局版' },
          { match: { section: 'harness:tools' }, action: 'rewrite', text: '全局工具说明' },
          { match: { kind: 'schedule' }, action: 'allow' },
          { match: { tool: 'read' }, action: 'deny' },
          { match: { tool: 'bash' }, action: 'deny' },
        ],
      },
    },
  }
  assert.deepEqual(decide(state, 's', { section: 'harness:identity' }), { action: 'rewrite', by: 'session', rule: state.sandbox.s.rules[1] })
  assert.equal(decide(state, 's', { section: 'harness:tools' }).by, 'global', '会话没写的目标落到全局规则')
  assert.equal(decide(state, 's', { kind: 'goal' }).by, 'session')
  assert.equal(decide(state, 's', { kind: 'schedule' }).by, 'global')
  assert.deepEqual(decide(state, 's', { kind: 'agent-message' }), { action: 'deny', by: 'level' }, '会话 strict 盖过全局 observe')
  assert.deepEqual(decide(state, 'other', { kind: 'agent-message' }), { action: 'allow', by: 'level' })
  assert.equal(decide(state, 's', { tool: 'read' }).action, 'allow', '会话 allow 盖过全局 deny（同族）')
  assert.equal(decide(state, 'other', { tool: 'read' }).action, 'deny')
  assert.equal(decide(state, 's', { tool: 'bash' }).by, 'global')
  // resolveSandbox 的 rewrite：同一目标会话在前，全局补上没写的。
  assert.deepEqual(resolveSandbox(state, 's').rewrite.sections, { 'harness:identity': '会话版', 'harness:tools': '全局工具说明' })
  // own = 整族自带：全局同族规则一条都不看（旧字段迁移就是这样）。
  const owned = { sandbox: { ...state.sandbox, s: { ...state.sandbox.s, own: ['rewrite'] } } }
  assert.deepEqual(resolveSandbox(owned, 's').rewrite.sections, { 'harness:identity': '会话版' })
  assert.equal(decide(owned, 's', { section: 'harness:tools' }).by, 'level')
})

// ── deny vs allow：会话 allow 盖过全局 deny；同一作用域 deny 先于 allow ─────────

const KIND = (kind, action, extra = {}) => ({ match: { kind }, action, ...extra })

test('全局 deny + 会话 allow → 放行（decide 与闸门阻断名单一致）', () => {
  const state = { sandbox: { s: { rules: [KIND('agent-message', 'allow')] }, '*': { rules: [KIND('agent-message', 'deny'), KIND('team-*', 'deny')] } } }
  assert.deepEqual(decide(state, 's', { kind: 'agent-message' }), { action: 'allow', by: 'session', rule: state.sandbox.s.rules[0] })
  assert.equal(resolveSandbox(state, 's').blocks.messages.has('agent-message'), false)
  assert.deepEqual([...blocksFor(state, 's').messages], ['team-*'], '被会话精确放行盖住的全局名字不列出')
  assert.equal(decide(state, 's', { kind: 'team-note' }).action, 'deny', '会话没放行的照拦')
  // 通配：会话 allow team-* 盖过全局精确 deny；全局通配 deny 被会话精确 allow 只开一个口子。
  const glob = { sandbox: { s: { rules: [KIND('team-note', 'allow')] }, '*': { rules: [KIND('team-*', 'deny')] } } }
  assert.equal(resolveSandbox(glob, 's').blocks.messages.has('team-note'), false)
  assert.equal(resolveSandbox(glob, 's').blocks.messages.has('team-plan'), true)
  assert.equal(decide(glob, 's', { kind: 'team-plan' }).by, 'global')
  // section / context 同理。
  const sec = { sandbox: { s: { rules: [{ match: { section: 'harness:identity' }, action: 'allow' }] }, '*': { rules: [{ match: { section: 'harness:*' }, action: 'deny' }] } } }
  assert.equal(decide(sec, 's', { section: 'harness:identity' }).action, 'allow')
  assert.equal(resolveSandbox(sec, 's').blocks.sections.has('harness:identity'), false)
  assert.equal(resolveSandbox(sec, 's').blocks.sections.has('harness:tools'), true)
  // 别的会话不受影响。
  assert.equal(decide(state, 'other', { kind: 'agent-message' }).action, 'deny')
  assert.equal(resolveSandbox(state, 'other').blocks.messages.has('agent-message'), true)
})

test('会话 deny + 会话 allow → 拦；全局 deny + 全局 allow → 拦（同一作用域 deny 先于 allow）', () => {
  const state = {
    sandbox: {
      s: { rules: [KIND('agent-message', 'allow'), KIND('agent-message', 'deny')] },
      '*': { rules: [KIND('goal', 'allow'), KIND('goal', 'deny')] },
    },
  }
  assert.deepEqual(decide(state, 's', { kind: 'agent-message' }), { action: 'deny', by: 'session', rule: state.sandbox.s.rules[1] })
  assert.equal(resolveSandbox(state, 's').blocks.messages.has('agent-message'), true)
  assert.equal(decide(state, 's', { kind: 'goal' }).action, 'deny')
  assert.equal(resolveSandbox(state, 's').blocks.messages.has('goal'), true)
  // 会话 deny + 全局 allow → 拦。
  const mixed = { sandbox: { s: { rules: [KIND('goal', 'deny')] }, '*': { rules: [KIND('goal', 'allow')] } } }
  assert.equal(decide(mixed, 's', { kind: 'goal' }).by, 'session')
})

test('全局 deny、没有会话规则 → 拦', () => {
  const state = { sandbox: { '*': { rules: [KIND('agent-message', 'deny')] }, s: { level: 'strict', rules: [] } } }
  for (const id of ['s', 'other', undefined]) {
    assert.equal(decide(state, id, { kind: 'agent-message' }).action, 'deny', String(id))
    assert.equal(blocksFor(state, id).messages.has('agent-message'), true, String(id))
  }
})

test('工具：会话 allow 盖全局 deny；同一作用域显式 deny 先于 allow；兜底 tool:* 只拦其余', () => {
  const T = (tool, action, extra = {}) => ({ match: { tool, ...extra }, action })
  const state = {
    sandbox: {
      s: { rules: [T('read', 'allow'), T('bash', 'allow'), T('bash', 'deny'), T('*', 'deny')] },
      t: { rules: [T('read', 'allow')] },
      '*': { rules: [T('read', 'deny'), T('grep', 'allow'), T('grep', 'deny'), T('*', 'deny')] },
    },
  }
  assert.equal(decide(state, 's', { tool: 'read' }).action, 'allow', '白名单里的 allow 不被兜底 deny 吃掉')
  assert.deepEqual(decide(state, 's', { tool: 'bash' }), { action: 'deny', by: 'session', rule: state.sandbox.s.rules[2] })
  assert.equal(decide(state, 's', { tool: 'grep' }).by, 'session', '会话兜底 deny 盖过全局')
  assert.deepEqual(resolveSandbox(state, 's').toolAllow, ['read'])
  assert.deepEqual(decide(state, 't', { tool: 'read' }), { action: 'allow', by: 'session', rule: state.sandbox.t.rules[0] }, '会话 allow 盖全局 deny')
  assert.equal(decide(state, 't', { tool: 'grep' }).action, 'deny', '全局同作用域 deny 先于 allow')
  assert.deepEqual(resolveSandbox(state, 't').toolAllow, ['read'])
  assert.equal(decide(state, 'other', { tool: 'read' }).action, 'deny')
  assert.deepEqual(resolveSandbox(state, 'other').toolAllow, [])
})

test('旧 injectionBlocks 迁来的会话 / 全局 deny：照拦，旧白名单（软放行）盖不过 —— 和 0.15.2 一样', () => {
  const legacy = base({
    gate: { s: 'pure' },
    sessionAllowKinds: { s: ['agent-message', 'team-note', 'goal'] },
    injectionBlocks: { s: { messages: ['team-note'] }, '*': { messages: ['agent-message'], contexts: ['team:identity'] } },
  })
  const state = migrateSandbox(legacy)
  assert.deepEqual(decide(state, 's', { kind: 'agent-message' }), { action: 'deny', by: 'global', rule: state.sandbox['*'].rules[0] })
  assert.equal(decide(state, 's', { kind: 'team-note' }).by, 'session')
  assert.equal(decide(state, 's', { kind: 'goal' }).action, 'allow')
  assert.equal(decide(state, 's', { context: 'team:identity' }).action, 'deny')
  for (const group of ['messages', 'contexts', 'sections']) assert.deepEqual([...blocksFor(state, 's')[group]], old.blocks(legacy, 's')[group], group)
  // 以后在规则表里写的硬放行（不带 soft）才盖得过全局 deny。
  const hard = clone(state)
  hard.sandbox.s.rules.push(KIND('agent-message', 'allow'))
  assert.equal(decide(hard, 's', { kind: 'agent-message' }).action, 'allow')
  assert.equal(blocksFor(hard, 's').messages.has('agent-message'), false)
  assert.equal(blocksFor(hard, 's').messages.has('team-note'), true, '会话自己的 deny 照拦')
})

test('prefill:* / 用户原话 / DSH 协议恒放行，规则拦不住', () => {
  const state = {
    sandbox: {
      s: {
        level: 'strict',
        rules: [
          { match: { section: 'prefill:*' }, action: 'deny' },
          { match: { section: '*' }, action: 'deny' },
          { match: { context: 'prefill:persona', exact: true }, action: 'deny' },
          { match: { kind: '*' }, action: 'deny' },
        ],
      },
    },
  }
  for (const target of [{ section: 'prefill:persona' }, { context: 'prefill:persona' }, { kind: 'prefill' }, { kind: 'prefill:inject' }]) {
    assert.deepEqual(decide(state, 's', target), { action: 'allow', by: 'self' }, JSON.stringify(target))
  }
  assert.deepEqual(decide(state, 's', { kind: 'user' }), { action: 'allow', by: 'user' })
  assert.deepEqual(decide(state, 's', { kind: 'tool' }), { action: 'allow', by: 'protocol', audit: true })
  assert.equal(protectedBy({ kind: 'compact-checkpoint' }), 'protocol')
  assert.equal(decide(state, 's', { section: 'harness:identity' }).action, 'deny')
  const blocks = resolveSandbox(state, 's').blocks
  assert.equal(blocks.sections.has('prefill:persona'), false)
  assert.equal(blocks.sections.has('harness:identity'), true)
  assert.equal(blocks.contexts.has('prefill:persona'), false)
  // 旧形状里写了 prefill:* 也一样（迁移保留原样，解析时剔掉）。
  assert.equal(blocksFor({ injectionBlocks: { s: { sections: ['prefill:persona'] } } }, 's').sections.has('prefill:persona'), false)
  // 闸门 pre-step：用户原话和本插件消息不会被丢。
  const api = { readState: () => state, note() {} }
  const decision = { kind: 'enter', messages: [{ source: { kind: 'user' } }, { source: { kind: 'prefill', prefill: 'inject' } }, { source: { kind: 'goal' } }] }
  const next = applyMessageBlocks(api, { agent: { id: 's' } }, decision, decision)
  assert.deepEqual(next.messages.map((message) => message.source.kind), ['user', 'prefill'])
})

// ── 防降级：写盘镜像 + 指纹 ─────────────────────────────────────────────────

test('写盘镜像：0.15.2 的读法读写盘形状 = 读原来的旧字段；新版本读回来 = 原规则表', () => {
  const mem = roundTrip(LEGACY())
  const disk = toDisk(mem)
  for (const field of ['overrides', 'sessionAllowKinds', 'sessionTools', 'injectionBlocks']) assert.deepEqual(disk[field], LEGACY()[field], field)
  assert.deepEqual(disk.gate, LEGACY().gate)
  assert.deepEqual(Object.keys(disk[MIRROR_KEY]).sort(), ['gate', 'injectionBlocks', 'overrides', 'sessionAllowKinds', 'sessionTools', 'v'])
  for (const id of ['s', 't', 'r', 'other', '*', undefined]) {
    assert.deepEqual(old.overridesFor(disk, id), old.overridesFor(LEGACY(), id), String(id))
    assert.deepEqual(old.allowKindsFor(disk, id), old.allowKindsFor(LEGACY(), id), String(id))
    assert.deepEqual(old.tools(disk, id), old.tools(LEGACY(), id), String(id))
    assert.deepEqual(old.blocks(disk, id), old.blocks(LEGACY(), id), String(id))
  }
  // 新版本读回来：镜像丢掉、指纹丢掉、规则表原样；再写一次逐字节一样（幂等）。
  const back = roundTrip(disk)
  assert.deepEqual(back, mem)
  assert.equal(MIRROR_KEY in back, false)
  assert.equal(JSON.stringify(toDisk(back)), JSON.stringify(disk))
  // 什么都没配：不写空的镜像字段。
  assert.deepEqual(toDisk(roundTrip(base())), { ...base(), [MIRROR_KEY]: { v: 1 } })
  assert.deepEqual(roundTrip(toDisk(roundTrip(base()))), { ...base(), sandbox: {} })
})

test('镜像以新表为准：旧字段表达不了的规则原样保留（键顺序变了也算没改）', () => {
  const mem = {
    ...base(),
    sandbox: {
      s: { level: 'controlled', rules: [KIND('agent-message', 'allow'), { match: { section: 'harness:*' }, action: 'deny' }] },
      '*': { own: ['tools'], rules: [{ match: { tool: 'read', exact: true }, action: 'allow' }, { match: { tool: '*' }, action: 'deny' }] },
    },
  }
  const disk = toDisk(mem)
  assert.deepEqual(disk.injectionBlocks, { s: { sections: ['harness:*'] } })
  assert.deepEqual(disk.sessionTools, { '*': ['read'] })
  assert.deepEqual(roundTrip(disk).sandbox, sanitizeSandbox(mem.sandbox))
  // 旧版本把整份 JSON 读进来再写回，键顺序不同：指纹按排序后的 JSON 算，照样认成镜像。
  const reordered = { ...disk, sessionTools: Object.fromEntries(Object.entries(disk.sessionTools).reverse()), injectionBlocks: JSON.parse(JSON.stringify(disk.injectionBlocks)) }
  assert.deepEqual(roundTrip(reordered).sandbox, sanitizeSandbox(mem.sandbox))
})

test('旧版本改过某个旧字段（指纹对不上）：只重新迁那一族，其它族以新表为准', () => {
  const mem = roundTrip(LEGACY())
  mem.sandbox.s.rules.push(KIND('team-*', 'deny'), KIND('agent-message', 'allow'))
  const disk = toDisk(mem)
  // 0.15.2 改了 s 的工具白名单、加了一格 overrides；sandbox 和指纹原样带着（旧版本保留未知字段）。
  const edited = clone(disk)
  edited.sessionTools.s = ['bash']
  edited.overrides.x = { messages: {}, sections: { 'prefill:persona': '新会话' }, contexts: {} }
  const back = roundTrip(edited)
  assert.deepEqual(resolveSandbox(back, 's').toolAllow, ['bash'])
  assert.deepEqual(resolveSandbox(back, 'x').rewrite.sections, { 'prefill:persona': '新会话' })
  assert.deepEqual(resolveSandbox(back, 's').rewrite, resolveSandbox(mem, 's').rewrite)
  assert.equal(resolveSandbox(back, 's').level, 'strict')
  // 没改的族（deny / allow）：表里的通配 deny 和硬放行都还在。
  assert.equal(blocksFor(back, 's').messages.has('team-plan'), true)
  assert.equal(decide(back, 's', { kind: 'agent-message' }).action, 'allow')
  // 再写盘、再读：稳定。
  assert.deepEqual(roundTrip(toDisk(back)), back)
})

test('旧版本改过 sessionAllowKinds：按旧名单重迁（软放行），同名的硬放行保留硬', () => {
  const mem = { ...base(), sandbox: { s: { own: ['allow'], rules: [KIND('agent-message', 'allow', { exact: true }), KIND('goal', 'allow', { exact: true, soft: true })] }, '*': { rules: [KIND('agent-message', 'deny'), KIND('goal', 'deny'), KIND('team-note', 'deny')] } } }
  const disk = toDisk(mem)
  assert.deepEqual(disk.sessionAllowKinds, { s: ['agent-message', 'goal'] })
  const edited = clone(disk)
  edited.sessionAllowKinds.s = ['agent-message', 'goal', 'team-note']
  const back = roundTrip(edited)
  assert.deepEqual(back.sandbox.s.rules, [
    { match: { kind: 'agent-message', exact: true }, action: 'allow' },
    { match: { kind: 'goal', exact: true }, action: 'allow', soft: true },
    { match: { kind: 'team-note', exact: true }, action: 'allow', soft: true },
  ])
  assert.equal(decide(back, 's', { kind: 'agent-message' }).action, 'allow')
  assert.equal(decide(back, 's', { kind: 'team-note' }).action, 'deny', '旧版本加进来的只是白名单，盖不过全局阻断')
})

test('旧版本改过 gate：按 gate 重推严格档（删掉 / 改成 pass = 撤掉，新加 pure = 严格）', () => {
  const mem = roundTrip(base({ gate: { a: 'pure', b: 'pure', r: 'replace' }, sessionTools: { a: [] } }))
  const disk = toDisk(mem)
  assert.deepEqual(disk.gate, { r: 'replace', a: 'pure', b: 'pure' })
  const edited = clone(disk)
  delete edited.gate.a
  edited.gate.c = 'pure'
  const back = roundTrip(edited)
  assert.equal(resolveSandbox(back, 'a').level, 'observe', '整格删掉也算撤掉')
  assert.deepEqual(resolveSandbox(back, 'a').toolAllow, [], '别的族不动')
  assert.equal(resolveSandbox(back, 'b').level, 'strict')
  assert.equal(resolveSandbox(back, 'c').level, 'strict')
  assert.deepEqual(back.gate, { r: 'replace' })
  // 指纹对得上：pure 格只是镜像，丢掉；replace / pass 留在 gate。
  assert.deepEqual(roundTrip(disk).gate, { r: 'replace' })
  assert.deepEqual(roundTrip(disk).sandbox, mem.sandbox)
  // 面板（不带指纹）把 b 改成 pass：照旧撤掉严格档。
  const viaPanel = roundTrip({ ...mem, gate: { ...withLegacyView(mem).gate, b: 'pass' } })
  assert.equal(resolveSandbox(viaPanel, 'b').level, 'observe')
  assert.equal(resolveSandbox(viaPanel, 'a').level, 'strict')
})

// ── 迁移前后闸门行为等价（真的走 step()）────────────────────────────────────

function fakeAgent(id) {
  const calls = []
  const disposer = (what) => () => calls.push(['dispose', what])
  const sp = {
    section(options) {
      calls.push(['section', options])
      return disposer(`section:${options.name}`)
    },
    context(options) {
      calls.push(['context', options])
      return disposer(`context:${options.name}`)
    },
    suppressRuntimeContext() {
      calls.push(['suppress'])
      return disposer('suppress')
    },
    async assemble() {
      return { sections: [], contexts: [], tools: [] }
    },
  }
  const tools = {
    restrict(options) {
      calls.push(['restrict', options])
      return disposer('restrict')
    },
    view: () => ({ restrictableNames: new Set(['read', 'grep', 'bash']) }),
  }
  const ctx = { get: (key) => (key === 'systemPrompt' ? sp : key === 'tools' ? tools : undefined) }
  return { agent: { id, ctx, session: { snapshotEvents: () => [] } }, calls }
}

const MESSAGES = () => ({
  kind: 'enter',
  messages: [
    { id: 'm1', role: 'user', source: { kind: 'runtime-context' }, content: [{ type: 'text', text: '原始上下文' }] },
    { id: 'm2', role: 'user', source: { kind: 'agent-message' }, content: [{ type: 'text', text: '队友' }] },
    { id: 'm3', role: 'user', source: { kind: 'goal' }, content: [{ type: 'text', text: '目标' }] },
    { id: 'm4', role: 'user', source: { kind: 'team-note' }, content: [{ type: 'text', text: '团队' }] },
    { id: 'm5', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '你好' }] },
  ],
})

async function runGate(state, id) {
  const { agent, calls } = fakeAgent(id)
  const latches = new Map()
  const notes = []
  const api = { readState: () => state, note: (entry) => notes.push(entry), latches, unlatch: (key) => latches.delete(key), rootCtx: undefined }
  const incoming = MESSAGES()
  const blocked = applyMessageBlocks(api, { agent }, incoming, incoming)
  const out = await step(api, { agent, turn: 1, step: 1 }, blocked)
  const { at, ...snapshot } = snapshots()[id] ?? {}
  return { out, calls, snapshot }
}

const SCENARIOS = {
  '接管（pure + 人格段 + 工具清零）': (sid) =>
    base({
      gate: { [sid]: 'pure' },
      overrides: { [sid]: { messages: { 'runtime-context': '改写后的上下文' }, sections: { 'prefill:persona': '你是宋知夏。' }, contexts: {} } },
      sessionTools: { [sid]: [] },
      sessionAllowKinds: { [sid]: ['goal'] },
      injectionBlocks: { [sid]: { messages: ['team-note'] }, '*': { messages: ['agent-message'] } },
    }),
  '纯净 + 白名单 + 通配格回落': (sid) =>
    base({
      gate: { [sid]: 'pure' },
      sessionAllowKinds: { '*': ['agent-message', 'team-note'] },
      sessionTools: { '*': ['read', 'nope'] },
      injectionBlocks: { '*': { messages: ['team-note'] } },
    }),
  '替换（replace，只换系统提示）': (sid) =>
    base({ gate: { [sid]: 'replace' }, overrides: { [sid]: { messages: {}, sections: { 'prefill:persona': '中文版官方提示' }, contexts: {}, sectionOrders: { 'prefill:persona': -1000 } } } }),
  '只改写注入（未武装，靠 overrides 进来）': (sid) =>
    base({ overrides: { [sid]: { messages: { goal: '改过的目标' }, sections: { 'harness:identity': '身份' }, contexts: { 'x:ctx': '上下文' } } }, sessionTools: { [sid]: ['grep'] } }),
  '通配 overrides 回落 + 全局 tools': (sid) => base({ overrides: { '*': { sections: { 'prefill:persona': '通配人格' } } }, tools: ['bash'], armed: [sid] }),
  '关掉系统提示（pure 退回 pass、卡工具一并恢复）': (sid) =>
    base({
      gate: { [sid]: 'pure' },
      overrides: { [sid]: { messages: { 'runtime-context': '改写' }, sections: { 'prefill:persona': '你是宋知夏。', 'harness:identity': '身份' }, contexts: {} } },
      sessionTools: { [sid]: [] },
      enabled: { [sid]: { system: false } },
    }),
  '关掉改写注入 + 角色卡关（指纹命中的工具清单摘掉）': (sid) =>
    base({
      gate: { [sid]: 'pass' },
      overrides: { [sid]: { messages: { goal: '改写' }, sections: { 'prefill:persona': '你是宋知夏。' }, contexts: { c: '1' } } },
      sessionTools: { [sid]: ['read', 'grep'] },
      cardRef: { [sid]: { applied: { system: fingerprint('你是宋知夏。'), tools: fingerprint(JSON.stringify(['read', 'grep'])) } } },
      enabled: { [sid]: { inject: false, card: false } },
    }),
  '纯净 + 会话白名单与全局阻断重叠（阻断照拦）': (sid) =>
    base({
      gate: { [sid]: 'pure' },
      sessionAllowKinds: { [sid]: ['agent-message', 'team-note', 'goal'] },
      injectionBlocks: { [sid]: { messages: ['team-note'] }, '*': { messages: ['agent-message'] } },
    }),
  '什么都没配': () => base(),
}

for (const [name, make] of Object.entries(SCENARIOS)) {
  test(`迁移前后 step() 等价：${name}`, async () => {
    const sid = `sandbox-eq-${name}`
    const legacy = make(sid)
    const before = await runGate(legacy, sid)
    for (const [label, state] of [['迁移后', roundTrip(make(sid))], ['写盘再读回', roundTrip(toDisk(roundTrip(make(sid))))]]) {
      const after = await runGate(state, sid)
      assert.deepEqual(after.out, before.out, `${label}：返回的 decision`)
      assert.deepEqual(after.calls, before.calls, `${label}：挂载动作（段 / 上下文 / suppress / restrict）`)
      assert.deepEqual(after.snapshot, before.snapshot, `${label}：快照（三态 / 丢弃 / 改写 / 放行清单）`)
    }
  })
}

test('applyEnabled：新形状 state 也能停用（视图里补回旧字段再遮掉）', () => {
  const sid = 's'
  const legacy = SCENARIOS['关掉系统提示（pure 退回 pass、卡工具一并恢复）'](sid)
  const migrated = roundTrip(legacy)
  const viewOld = applyEnabled(legacy)
  const viewNew = applyEnabled(migrated)
  assert.deepEqual(resolveSandbox(viewNew, sid).rewrite, resolveSandbox(viewOld, sid).rewrite)
  assert.equal(resolveSandbox(viewNew, sid).level, 'observe')
  assert.equal(resolveSandbox(viewNew, sid).toolAllow, undefined)
  assert.equal(viewNew.gate[sid], 'pass')
  // 停用只在视图里：存储的规则表原样。
  assert.equal(resolveSandbox(migrated, sid).level, 'strict')
  assert.deepEqual(resolveSandbox(migrated, sid).toolAllow, [])
  // 没有 enabled 的新形状 state：applyEnabled 给兼容视图（旧读者照样能读 gate[会话] === 'pure'）。
  const plain = roundTrip(base({ gate: { a: 'pure' } }))
  assert.equal(applyEnabled(plain).gate.a, 'pure')
})
