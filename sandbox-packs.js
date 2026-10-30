/**
 * 会话沙盒 —— 来源包（issue #15 第 2 步）。
 *
 * 来源包 = 「同一个来源送进模型的一组东西」：段（section）/ 上下文（context）/ 消息来源（source.kind）/ 工具。
 * 按包放行 / 拦截，避免拦一半把功能拦坏（典型：只拦 Agent Teams 的段、不拦它的工具和队友消息，
 * 模型照样会派队友，队友消息却卡在等待里）。
 *
 * 作用域里只存「包 id → allow | deny」（`sandbox[作用域].packs`），包的成员表在这里（内置）或
 * `state.sandboxPacks`（第 4 步：溯源 / 插件自报后由用户确认挂上的）。解析时展开，
 * 排在会话 / 全局显式规则之后、档位默认之前（见 sandbox.js decide）。
 *
 * ── 内置包的名字从哪来（不是猜的）────────────────────────────────────────────────
 * 全部取自 `@deepseek-ai/*@0.2.1-rc.3` 的发布包源码（npm 上的同版本包，路径为包内 `lib/index.js:行号`）：
 *
 * Agent Teams（`dsh-experimental-agent-team-profile` 把下面两个包插进 profile，同时停用 tool-subagent*）：
 *   · dsh-experimental-tool-agent-team:234  段 `team:policy`（agent 自己作用域注册）
 *   · dsh-experimental-tool-agent-team:239  上下文 `team:identity`（required: true，agent 作用域）
 *   · dsh-experimental-tool-agent-team:251-457 工具 spawn_teammate / send_message / list_agents / wait_agent /
 *     interrupt_agent / team_task_create / team_task_list / team_task_get / team_task_update（agent 作用域注册 ⇒
 *     `tools.restrict` 拦不住，只能在装配结果里过滤）
 *   · dsh-experimental-agent-team:1599     队友消息 `source.kind = 'agent-message'`（form: 'relay'）
 *   ⚠ 同名：`agent-message` 也是 DSH 核心子代理的回传消息（dsh-subagent:446）；send_message / interrupt_agent /
 *     list_agents 也是 dsh-tool-subagent-control 的全局工具名。这几项标 `shared`：只有用户**显式**拦这个包时才跟着拦，
 *     档位默认（受控档默认拦第三方）不连带它们，免得没开 Agent Teams 的会话把子代理拦坏。
 *
 * DSH 核心 · 系统提示（段）：dsh-system-prompt:228 `harness:identity`、:59/:61 `deployment:persona-prefix|suffix`；
 *   各工具说明段 `tool:*`（dsh-tool-bash:376 `tool:bash`、dsh-tool-fs:245 `tool:read` …、dsh-tool-subagent:509
 *   `tool:${toolName}`）、dsh-tools:2825/2842 `tools:ptc-only` / `tools:sdk`、dsh-file-reference-local:343
 *   `context:file-reference`、dsh-client-ui-deliverables:264 `ui:deliverable-file-references`、dsh-plan-mode:170
 *   `plan:policy`、dsh-mcp-client:736 `mcp:${server}`、dsh-mcp-resources:119 `mcp-resource-servers`、
 *   dsh-harness-dev-context:25/27 `harness:source` / `app:web-surface`、dsh-subagent:390 `deployment:persona-prefix`。
 *
 * DSH 核心 · 运行时上下文（上下文 + 消息来源）：
 *   上下文：dsh-working-directory:41 `working-directory:current`（required）、dsh-user-approval:80 `approval:policy`、
 *   dsh-sandbox-policy:122 `sandbox:policy`、dsh-subagent:385 `subagent:delegation`、dsh-tool-subagent:519
 *   `tool:${toolName}:depth`、dsh-harness-dev-context:104/116 `harness:source` / `app:web-surface`。
 *   消息：dsh-agent-loop:218 `runtime-context`、dsh-agent-instructions:885 `agent-instructions`、dsh-time-context:102
 *   `time-context`、dsh-tmux-context:2130 `tmux-context`、dsh-session-reference:34 `session-reference`、
 *   dsh-tool-skill:984 `skill-catalog`、dsh-working-directory:145 `working-directory`、dsh-goal-round-driver:147 `goal`、
 *   dsh-schedule:1594 `schedule`、dsh-plan-mode:410 `plan-mode`、dsh-user-approval:107 `user-approval`、
 *   dsh-user-questions:563 `user-question-reply`、dsh-tool-goal:368 `tool-goal`、dsh-tool-jobs:278 `tool-jobs`、
 *   dsh-subagent:446/534 `agent-message` / `subagent-settled`、dsh-agent:142 `model-selection`、
 *   dsh-agent-loop:1255 developer 消息 `tool-registry`（审计里记作 `developer:tool-registry`，直写会话，提前拦不了）。
 *   协议消息（恒放行、规则管不到，见 sandbox.js PROTOCOL_KINDS）：dsh-llm:105 `tool`、dsh-compaction:109
 *   `compact-checkpoint`、墓碑；`model`（dsh-llm:75）/ `system-prompt`（dsh-llm:93）不是注入。
 *
 * @module @local/dsh-prefill/sandbox-packs
 */

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

export const MEMBER_KEYS = ['kind', 'section', 'context', 'tool']
export const PACK_ACTIONS = ['allow', 'deny']
/** 包的来源：self = 本插件（恒放行）；core = DSH 核心（受控档默认放行）；third-party = 第三方（受控档默认拦）。 */
export const ORIGINS = ['self', 'core', 'third-party']

const TEAM_TOOL = 'dsh-experimental-tool-agent-team/lib/index.js'
const SUBAGENT_CONTROL = '@deepseek-ai/dsh-tool-subagent-control'

/** 内置来源包（顺序 = 面板里的顺序）。 */
export const BUILTIN_PACKS = Object.freeze([
  {
    id: 'prefill',
    label: '本插件 · dsh-prefill',
    plugin: '@local/dsh-prefill',
    origin: 'self',
    locked: true,
    summary: 'prefill:* 的段 / 上下文 / 消息',
    members: [{ section: 'prefill:*' }, { context: 'prefill:*' }, { kind: 'prefill:*' }, { kind: 'prefill', exact: true }],
  },
  {
    id: 'dsh-core-prompt',
    label: 'DSH 核心 · 系统提示',
    plugin: '@deepseek-ai/dsh-system-prompt',
    origin: 'core',
    summary: 'harness:identity、deployment:*、各工具说明 tool:* …',
    members: [
      { section: 'harness:*' },
      { section: 'deployment:*' },
      { section: 'tool:*' },
      { section: 'tools:*' },
      { section: 'context:file-reference', exact: true },
      { section: 'ui:*' },
      { section: 'plan:policy', exact: true },
      { section: 'mcp:*' },
      { section: 'mcp-resource-servers', exact: true },
      { section: 'app:web-surface', exact: true },
    ],
  },
  {
    id: 'dsh-core-context',
    label: 'DSH 核心 · 运行时上下文',
    plugin: '@deepseek-ai/dsh-agent-loop',
    origin: 'core',
    summary: '工作目录、审批 / 沙盒策略、时间、技能目录、目标 / 定时 …（工作目录为 required）',
    members: [
      { context: 'working-directory:*' },
      { context: 'approval:policy', exact: true },
      { context: 'sandbox:policy', exact: true },
      { context: 'subagent:delegation', exact: true },
      { context: 'tool:*' },
      { context: 'harness:source', exact: true },
      { context: 'app:web-surface', exact: true },
      ...[
        'runtime-context',
        'agent-instructions',
        'time-context',
        'tmux-context',
        'session-reference',
        'skill-catalog',
        'working-directory',
        'goal',
        'schedule',
        'plan-mode',
        'user-approval',
        'user-question-reply',
        'tool-goal',
        'tool-jobs',
        'agent-message',
        'subagent-settled',
        'model-selection',
        'developer:tool-registry',
      ].map((kind) => ({ kind, exact: true })),
    ],
  },
  {
    id: 'agent-teams',
    label: 'Agent Teams',
    plugin: '@deepseek-ai/dsh-experimental-tool-agent-team',
    profile: '@deepseek-ai/dsh-experimental-agent-team-profile',
    origin: 'third-party',
    summary: 'team:* 的段 / 上下文 + 队友消息 + 团队工具',
    note: '拦截后队友消息不会送达；放行时整包一起放（只放一半，队友消息会卡在等待里）',
    members: [
      { section: 'team:policy', exact: true, at: `${TEAM_TOOL}:234` },
      { context: 'team:identity', exact: true, at: `${TEAM_TOOL}:239` },
      { section: 'team:*' },
      { context: 'team:*' },
      { kind: 'agent-message', exact: true, shared: ['@deepseek-ai/dsh-subagent'], at: 'dsh-experimental-agent-team/lib/index.js:1599' },
      { tool: 'spawn_teammate', exact: true, at: `${TEAM_TOOL}:251` },
      { tool: 'send_message', exact: true, shared: [SUBAGENT_CONTROL], at: `${TEAM_TOOL}:293` },
      { tool: 'list_agents', exact: true, shared: [SUBAGENT_CONTROL], at: `${TEAM_TOOL}:321` },
      { tool: 'wait_agent', exact: true, at: `${TEAM_TOOL}:330` },
      { tool: 'interrupt_agent', exact: true, shared: [SUBAGENT_CONTROL], at: `${TEAM_TOOL}:352` },
      { tool: 'team_task_create', exact: true, at: `${TEAM_TOOL}:365` },
      { tool: 'team_task_list', exact: true, at: `${TEAM_TOOL}:400` },
      { tool: 'team_task_get', exact: true, at: `${TEAM_TOOL}:444` },
      { tool: 'team_task_update', exact: true, at: `${TEAM_TOOL}:457` },
    ],
  },
])

/** DSH 核心的消息来源（受控档默认放行；没进任何包时也按「已登记」算）。 */
export const CORE_KINDS = Object.freeze(
  BUILTIN_PACKS.find((pack) => pack.id === 'dsh-core-context').members.filter((member) => typeof member.kind === 'string').map((member) => member.kind),
)

// ── 匹配（和 sandbox.js 的 matchName 同一套：`*` 通配，exact 关掉）──────────────

const GLOBS = new Map()
function matchName(pattern, name, exact = false) {
  if (typeof pattern !== 'string' || typeof name !== 'string') return false
  if (exact === true || !pattern.includes('*')) return pattern === name
  let re = GLOBS.get(pattern)
  if (re === undefined) {
    re = new RegExp(`^${pattern.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`)
    GLOBS.set(pattern, re)
  }
  return re.test(name)
}

/** 成员的目标维度（kind / section / context / tool）。 */
export function memberKey(member) {
  if (!isObject(member)) return undefined
  const keys = MEMBER_KEYS.filter((key) => typeof member[key] === 'string' && member[key] !== '')
  return keys.length === 1 ? keys[0] : undefined
}

export function memberMatches(member, target) {
  const key = memberKey(member)
  return key !== undefined && isObject(target) && typeof target[key] === 'string' && matchName(member[key], target[key], member.exact === true)
}

/** 具体程度：精确名 > 通配（通配按 `*` 前的字面长度）。同一目标命中多个包时，具体的先看。 */
function specificity(member) {
  const key = memberKey(member)
  const pattern = member[key]
  if (member.exact === true || !pattern.includes('*')) return 10000 + pattern.length
  return pattern.indexOf('*')
}

// ── 用户确认挂上的包（state.sandboxPacks，第 4 步）──────────────────────────────

/** 冒充本插件 / DSH 核心的成员：剔掉（插件自报、溯源推断都只当线索，核心名字不许挂到第三方包上）。 */
export function forbiddenMember(member) {
  const key = memberKey(member)
  if (key === undefined) return 'invalid'
  const name = member[key]
  if (name === 'user' || name === 'prefill' || name.startsWith('prefill')) return 'self'
  if (key !== 'tool' && (name === '*' || /^[*:]/.test(name))) return 'too-broad'
  if (key === 'tool' && name === '*') return 'too-broad'
  for (const pack of BUILTIN_PACKS) {
    if (pack.origin !== 'core' && pack.origin !== 'self') continue
    for (const core of pack.members) {
      if (memberKey(core) !== key) continue
      // 精确名落在核心包里，或通配会吞掉核心名字（例如 `harness:*`）。
      if (matchName(core[key], name, core.exact === true)) return 'core'
      if (member.exact !== true && name.includes('*') && matchName(name, core[key].replace(/\*$/, 'x'), false)) return 'core'
    }
  }
  return undefined
}

function sanitizeMember(raw) {
  if (!isObject(raw)) return undefined
  const key = memberKey(raw)
  if (key === undefined) return undefined
  const member = { [key]: raw[key] }
  if (raw.exact === true || !raw[key].includes('*')) member.exact = true
  if (Array.isArray(raw.shared) && raw.shared.length > 0) member.shared = raw.shared.filter((value) => typeof value === 'string')
  if (typeof raw.at === 'string') member.at = raw.at.slice(0, 300)
  return member
}

/**
 * 规范化 `state.sandboxPacks`：`{ [id]: { id, label, plugin?, origin: 'third-party', members, source: { via, plugin?, confirmed, at? } } }`。
 * 内置包（非 self）可以有一格 `{ extends: true, members }`：用户手动挂上的额外成员。
 * 冒充本插件 / DSH 核心的成员一律剔掉；没有成员的包删掉。
 */
export function sanitizePacks(raw) {
  const out = {}
  if (!isObject(raw)) return out
  for (const [id, value] of Object.entries(raw)) {
    if (!isObject(value) || typeof id !== 'string' || !/^[a-z0-9@/._:-]{1,80}$/i.test(id)) continue
    const builtin = BUILTIN_PACKS.find((pack) => pack.id === id)
    if (builtin?.locked) continue
    const members = []
    for (const member of Array.isArray(value.members) ? value.members : []) {
      const clean = sanitizeMember(member)
      if (clean === undefined) continue
      // 内置核心包可以手动加成员（用户自己点的）；第三方包不许吞核心名字。
      if (builtin?.origin !== 'core' && forbiddenMember(clean) !== undefined) continue
      if (!members.some((existing) => JSON.stringify(existing) === JSON.stringify(clean))) members.push(clean)
    }
    if (members.length === 0) continue
    if (builtin !== undefined) {
      out[id] = { extends: true, members }
      continue
    }
    const source = isObject(value.source) ? value.source : {}
    out[id] = {
      id,
      label: typeof value.label === 'string' && value.label.trim() !== '' ? value.label.trim().slice(0, 80) : id,
      ...(typeof value.plugin === 'string' && value.plugin !== '' ? { plugin: value.plugin.slice(0, 214) } : {}),
      origin: 'third-party',
      members,
      source: {
        via: ['trace', 'claim', 'manual', 'ai'].includes(source.via) ? source.via : 'manual',
        ...(typeof source.plugin === 'string' ? { plugin: source.plugin.slice(0, 214) } : {}),
        confirmed: true,
        ...(typeof source.at === 'string' ? { at: source.at.slice(0, 40) } : {}),
      },
      ...(typeof value.note === 'string' && value.note !== '' ? { note: value.note.slice(0, 200) } : {}),
    }
  }
  return out
}

const CATALOGS = new WeakMap()

/** 生效的包表：内置（含用户手动加的成员）+ 用户确认挂上的。 */
export function packCatalog(state) {
  if (isObject(state)) {
    const hit = CATALOGS.get(state)
    if (hit !== undefined) return hit
  }
  const registered = sanitizePacks(state?.sandboxPacks)
  const packs = BUILTIN_PACKS.map((pack) => {
    const extra = registered[pack.id]
    return extra?.extends ? { ...pack, members: [...pack.members, ...extra.members], extended: extra.members } : pack
  })
  for (const pack of Object.values(registered)) if (pack.extends !== true) packs.push(pack)
  if (isObject(state)) CATALOGS.set(state, packs)
  return packs
}

/**
 * 一个目标命中的包（按具体程度排，同样具体时第三方在前），每项 `{ pack, member }`。
 * 本插件的包（self）不在里面：那是 protectedBy 管的恒放行。
 */
export function packsOf(state, target) {
  const hits = []
  for (const pack of packCatalog(state)) {
    if (pack.origin === 'self') continue
    let best
    for (const member of pack.members) if (memberMatches(member, target) && (best === undefined || specificity(member) > specificity(best))) best = member
    if (best !== undefined) hits.push({ pack, member: best })
  }
  const rank = (origin) => (origin === 'third-party' ? 0 : 1)
  return hits.sort((a, b) => specificity(b.member) - specificity(a.member) || rank(a.pack.origin) - rank(b.pack.origin))
}

/** 作用域里的包开关：`{ [id]: 'allow' | 'deny' }`（不合法的丢掉）。 */
export function sanitizePackSettings(raw) {
  const out = {}
  if (!isObject(raw)) return out
  for (const [id, action] of Object.entries(raw)) {
    if (typeof id === 'string' && id !== '' && id !== 'prefill' && PACK_ACTIONS.includes(action)) out[id] = action
  }
  return out
}

/**
 * 包给出的裁决（规则表之后、档位默认之前）：
 *   · 依次看命中的包：会话作用域的开关 > 全局（'*'）的开关；第一个有显式开关的包说了算；
 *   · 都没开关：档位是 controlled 时，第一个「非 shared 成员」命中的包按来源给默认（core 放行、third-party 拦）。
 * @returns { action, by: 'pack', pack, scope: 'session' | 'global' | 'level' } | undefined
 */
export function packVerdict(state, session, global, target, level) {
  const hits = packsOf(state, target)
  if (hits.length === 0) return undefined
  for (const { pack } of hits) {
    const own = session?.packs?.[pack.id]
    if (PACK_ACTIONS.includes(own)) return { action: own, by: 'pack', pack: pack.id, scope: 'session' }
    const theirs = global?.packs?.[pack.id]
    if (PACK_ACTIONS.includes(theirs)) return { action: theirs, by: 'pack', pack: pack.id, scope: 'global' }
  }
  if (level !== 'controlled') return undefined
  const lead = hits.find(({ member }) => !(Array.isArray(member.shared) && member.shared.length > 0))
  if (lead === undefined) return undefined
  return { action: lead.pack.origin === 'third-party' ? 'deny' : 'allow', by: 'pack', pack: lead.pack.id, scope: 'level' }
}

/** 一个包里显式放行的消息来源（严格档的消息白名单要加上它们：放行 Agent Teams = 队友消息能送达）。 */
export function packKinds(state, packId) {
  const pack = packCatalog(state).find((entry) => entry.id === packId)
  return (pack?.members ?? []).filter((member) => typeof member.kind === 'string').map((member) => ({ name: member.kind, exact: member.exact === true }))
}
