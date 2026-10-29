/**
 * 会话沙盒 —— 溯源（issue #15 第 4 步）：「这个名字是谁注册的」。
 *
 * DSH 不记录段 / 上下文 / 消息来源是哪个插件注册的，所以两条路，得到的**都只当线索**，用户确认后才挂成来源包
 * （写进 `state.sandboxPacks`，见 sandbox-packs.js；冒充本插件 / DSH 核心名字的成员在那里一律剔掉）：
 *
 * 1. **插件自报**（开放注册）：别的插件在自己的 apply 里调
 *    ```js
 *    globalThis[Symbol.for('dsh-prefill.sandbox')]?.claim({
 *      plugin: '@acme/dsh-memory', label: '记忆召回',
 *      members: [{ context: 'mem:recall' }, { section: 'mem:policy' }, { tool: 'memory_search' }],
 *    })   // 返回撤销函数；插件卸载时调用
 *    ```
 *    本插件没加载时这个全局对象不存在，可选链让对方插件不受影响。
 * 2. **读源码**：枚举本机已装、当前启用的插件包（Cordis Loader 的启用条目 = DSH 发给模型的 `dsh_plugin_packages`
 *    同一份来源；拿不到时退回 dsh 安装目录 + profile 的 node_modules），在包的 JS 源码里找这个名字的字面量，
 *    看它是不是落在 `.section({` / `.context({` / `defineTool({` / `source: { kind:` 这类注册点里（静态扫描，
 *    不执行任何代码），再把同一个包里注册的其它名字列成「同包还注册了」。
 *    「让 AI 读」是用户点按钮才触发：把扫到的注册点和上下文交给宿主已有的 LLM 能力（当前会话的模型路由，
 *    和故事记忆总结同一条路）写一段结论；没有在册会话 / 没有 LLM 时就只给静态结果。
 *
 * @module @local/dsh-prefill/sandbox-trace
 */

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, sep } from 'node:path'
import { BUILTIN_PACKS, forbiddenMember, memberKey } from './sandbox-packs.js'

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const GROUP_OF = { section: 'sections', context: 'contexts', kind: 'messages', tool: 'tools' }
export const TARGET_OF = { sections: 'section', contexts: 'context', messages: 'kind', tools: 'tool' }

// ── 1. 插件自报 ──────────────────────────────────────────────────────────────────

const CLAIMS = (globalThis[Symbol.for('dsh-prefill.sandbox-claims')] ??= new Map())
let claimSeq = 0

/** 规范化一份自报：成员里冒充本插件 / DSH 核心的剔掉并记下原因。 */
export function sanitizeClaim(raw) {
  if (!isObject(raw) || typeof raw.plugin !== 'string' || raw.plugin.trim() === '') return undefined
  const plugin = raw.plugin.trim().slice(0, 214)
  const members = []
  const rejected = []
  for (const member of Array.isArray(raw.members) ? raw.members : []) {
    const key = memberKey(member)
    if (key === undefined) continue
    const clean = { [key]: member[key], ...(member.exact === true || !member[key].includes('*') ? { exact: true } : {}) }
    const why = forbiddenMember(clean)
    if (why !== undefined) rejected.push({ ...clean, why })
    else members.push(clean)
  }
  if (members.length === 0 && rejected.length === 0) return undefined
  return {
    plugin,
    id: typeof raw.id === 'string' && /^[a-z0-9@/._:-]{1,80}$/i.test(raw.id) && !BUILTIN_PACKS.some((pack) => pack.id === raw.id) ? raw.id : plugin,
    label: typeof raw.label === 'string' && raw.label.trim() !== '' ? raw.label.trim().slice(0, 80) : plugin,
    members,
    rejected,
    ...(typeof raw.note === 'string' ? { note: raw.note.slice(0, 200) } : {}),
  }
}

/**
 * 插件自报一个来源包（只当线索）。返回撤销函数。
 * 同一份自报（id + 成员 + 剔掉的成员都相同）只记一份、按调用方计数：插件常在每个 `agent/created` 里自报一次，
 * 不合并的话自报表随会话数增长，剔掉的成员也会在合并视图里重复出现。每个撤销函数只生效一次，全部撤销后才消失。
 */
export function claimPack(raw) {
  const claim = sanitizeClaim(raw)
  if (claim === undefined) return () => {}
  const signature = JSON.stringify([claim.id, claim.plugin, claim.label, claim.members, claim.rejected, claim.note ?? null])
  let key
  for (const [existingKey, entry] of CLAIMS) if (entry.signature === signature) key = existingKey
  if (key === undefined) {
    key = ++claimSeq
    CLAIMS.set(key, { ...claim, signature, holders: 0, at: new Date().toISOString() })
  }
  CLAIMS.get(key).holders += 1
  let done = false
  return () => {
    if (done) return
    done = true
    const entry = CLAIMS.get(key)
    if (entry !== undefined && --entry.holders <= 0) CLAIMS.delete(key)
  }
}

/** 当前所有自报（同一插件多次自报合并成员）。 */
export function claims() {
  const merged = new Map()
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  for (const { signature, holders, ...claim } of CLAIMS.values()) {
    const current = merged.get(claim.id)
    if (current === undefined) merged.set(claim.id, { ...claim, members: [...claim.members], rejected: [...claim.rejected] })
    else {
      for (const member of claim.members) if (!current.members.some((entry) => same(entry, member))) current.members.push(member)
      for (const member of claim.rejected) if (!current.rejected.some((entry) => same(entry, member))) current.rejected.push(member)
    }
  }
  return [...merged.values()]
}

/** 自报里认领了这个目标的（`{ group, name }`）。 */
export function claimsFor(group, name) {
  const key = TARGET_OF[group]
  return claims().filter((claim) => claim.members.some((member) => memberKey(member) === key && matchPattern(member[key], name, member.exact === true)))
}

function matchPattern(pattern, name, exact) {
  if (exact || !pattern.includes('*')) return pattern === name
  return new RegExp(`^${pattern.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(name)
}

/** 挂到全局：插件 apply 时调一次（重复调用同一个对象）。 */
export function installClaimApi() {
  const api = (globalThis[Symbol.for('dsh-prefill.sandbox')] ??= { version: 1 })
  api.claim = claimPack
  api.claims = claims
  return api
}

// ── 2. 读源码（静态扫描）──────────────────────────────────────────────────────────

const MAX_FILES_PER_PACKAGE = 400
const MAX_FILE_BYTES = 4 * 1024 * 1024
const SKIP_DIRS = new Set(['node_modules', '.git', 'test', 'tests', '__tests__', 'docs', 'fixtures', 'examples'])

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

/** 包目录：从 base（URL 或路径）按 Node 的查找顺序找 `<name>/package.json`。 */
export function packageDirOf(name, base) {
  try {
    const require = createRequire(base)
    for (const searchPath of require.resolve.paths(name) ?? []) {
      const candidate = join(searchPath, name)
      if (existsSync(join(candidate, 'package.json'))) return candidate
    }
  } catch {
    // 落到 undefined。
  }
  return undefined
}

const bareName = (specifier) => {
  if (typeof specifier !== 'string' || specifier.startsWith('.') || specifier.startsWith('/') || specifier.includes(':')) return undefined
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? (parts.length >= 2 ? `${parts[0]}/${parts[1]}` : undefined) : parts[0]
}

/**
 * 当前启用的插件包：`[{ name, version, dir }]`。
 * 优先 Cordis Loader 的启用条目（和 dsh-plugin-package-inventory-deepseek 一样：非 group、未停用、fiber 已起），
 * 拿不到就退回 dsh 安装目录（process.argv[1] 所在的 node_modules）和 DSH_HOME 下各 profile 的 node_modules。
 */
export function activePackages(rootCtx) {
  const found = new Map()
  const add = (name, dir) => {
    if (typeof name !== 'string' || dir === undefined || found.has(name)) return
    const manifest = readJson(join(dir, 'package.json'))
    if (manifest === undefined) return
    found.set(name, { name, version: typeof manifest.version === 'string' ? manifest.version : '', dir })
  }
  let loader
  try {
    loader = typeof rootCtx?.get === 'function' ? rootCtx.get('loader') : undefined
    if (loader === undefined) loader = rootCtx?.loader
  } catch {
    loader = undefined
  }
  const fallbackBase = (() => {
    try {
      return pathToBase(realpathSync(process.argv[1] ?? '.'))
    } catch {
      return pathToBase(process.cwd())
    }
  })()
  const visit = (tree) => {
    let entries = []
    try {
      entries = typeof tree?.entries === 'function' ? [...tree.entries()] : []
    } catch {
      entries = []
    }
    for (const entry of entries) {
      try {
        if (entry?.options?.group || entry?.disabled) continue
        const name = bareName(entry?.options?.name)
        if (name === undefined) continue
        const base = entry?.parent?.tree?.ctx?.baseUrl ?? fallbackBase
        add(name, packageDirOf(name, base) ?? packageDirOf(name, fallbackBase))
      } catch {
        // 单条坏了跳过。
      }
    }
  }
  if (loader !== undefined) visit(loader)
  if (found.size === 0) {
    for (const root of fallbackRoots()) {
      for (const name of listPackages(root)) add(name, join(root, name))
    }
  }
  return [...found.values()]
}

function pathToBase(path) {
  return `file://${path.endsWith(sep) ? path : `${path}${sep}`}`
}

/** 退回用的 node_modules 根：dsh 可执行文件所在的、DSH_HOME/profiles/* 的。 */
function fallbackRoots() {
  const roots = new Set()
  try {
    let dir = dirname(realpathSync(process.argv[1] ?? '.'))
    while (dir !== dirname(dir)) {
      if (dir.endsWith(`${sep}node_modules`)) {
        roots.add(dir)
        break
      }
      dir = dirname(dir)
    }
  } catch {
    // 忽略。
  }
  const home = process.env.DSH_HOME
  if (typeof home === 'string' && home !== '') {
    try {
      for (const profile of readdirSync(join(home, 'profiles'))) {
        const modules = join(home, 'profiles', profile, 'node_modules')
        if (existsSync(modules)) roots.add(modules)
      }
    } catch {
      // 忽略。
    }
  }
  return [...roots]
}

function listPackages(root) {
  const out = []
  let names = []
  try {
    names = readdirSync(root)
  } catch {
    return out
  }
  for (const name of names) {
    if (name.startsWith('.')) continue
    if (name.startsWith('@')) {
      try {
        for (const inner of readdirSync(join(root, name))) out.push(`${name}/${inner}`)
      } catch {
        // 忽略。
      }
    } else out.push(name)
  }
  return out
}

/** 包里的 JS 源码文件（跳过 node_modules / 测试 / 文档；有上限）。 */
export function sourceFiles(dir) {
  const files = []
  const walk = (current) => {
    if (files.length >= MAX_FILES_PER_PACKAGE) return
    let names = []
    try {
      names = readdirSync(current)
    } catch {
      return
    }
    for (const name of names) {
      if (files.length >= MAX_FILES_PER_PACKAGE) return
      const path = join(current, name)
      let info
      try {
        info = statSync(path)
      } catch {
        continue
      }
      if (info.isDirectory()) {
        if (!SKIP_DIRS.has(name) && !name.startsWith('.')) walk(path)
      } else if (/\.(m|c)?js$/.test(name) && !name.endsWith('.d.ts') && !/\.(test|spec)\./.test(name) && info.size <= MAX_FILE_BYTES) files.push(path)
    }
  }
  walk(dir)
  return files
}

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 字面量出现处前面最近的注册点，判断它是哪一类（段 / 上下文 / 工具 / 消息来源）。 */
function registrationAt(text, index) {
  const before = text.slice(Math.max(0, index - 260), index)
  const near = (re) => {
    let last = -1
    for (const match of before.matchAll(re)) last = match.index
    return last
  }
  const scores = [
    ['section', near(/\.section\s*\(\s*\{/g)],
    ['context', near(/\.context\s*\(\s*\{/g)],
    ['tool', Math.max(near(/defineTool\s*\(\s*\{/g), near(/tools\.register\s*\(\s*\{/g))],
    ['kind', near(/source\s*:\s*\{\s*$|kind\s*:\s*$/g)],
  ]
  // 名字紧跟在 `kind:` 后面 ⇒ 消息来源。
  if (/kind\s*:\s*$/.test(before)) return { key: 'kind', how: 'source.kind' }
  if (!/name\s*:\s*$/.test(before)) return undefined
  const best = scores.filter(([, at]) => at >= 0).sort((a, b) => b[1] - a[1])[0]
  return best === undefined ? undefined : { key: best[0], how: best[0] === 'tool' ? 'defineTool' : `.${best[0]}({ name })` }
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length

function snippetAt(text, index, before = 2, after = 4) {
  const lines = text.split('\n')
  const line = lineOf(text, index) - 1
  return lines
    .slice(Math.max(0, line - before), line + after + 1)
    .map((value) => (value.length > 160 ? `${value.slice(0, 157)}…` : value))
    .join('\n')
}

/** 一个文件里所有注册点：`[{ group, name, line }]`（只认字面量名字）。 */
export function registrationsIn(text) {
  const out = []
  const re = /\.(section|context)\s*\(\s*\{[^{}]{0,200}?name\s*:\s*(['"`])([^'"`$\n]{1,120})\2|defineTool\s*\(\s*\{[^{}]{0,120}?name\s*:\s*(['"`])([^'"`$\n]{1,120})\4|source\s*:\s*\{\s*kind\s*:\s*(['"`])([^'"`$\n]{1,120})\6/g
  for (const match of text.matchAll(re)) {
    const [, which, , regName, , toolName, , kind] = match
    if (regName !== undefined) out.push({ group: which === 'section' ? 'sections' : 'contexts', name: regName, line: lineOf(text, match.index) })
    else if (toolName !== undefined) out.push({ group: 'tools', name: toolName, line: lineOf(text, match.index) })
    else if (kind !== undefined) out.push({ group: 'messages', name: kind, line: lineOf(text, match.index) })
  }
  return out
}

/**
 * 找注册了这个名字的源码位置。
 * @param target `{ group, name }`
 * @param options.packages `[{ name, version, dir }]`（不给就 activePackages(options.rootCtx)）
 * @returns `{ target, candidates: [{ package, version, file, line, snippet, confidence, how, siblings }], scanned }`
 */
export function traceName(target, options = {}) {
  const started = Date.now()
  const group = target?.group
  const name = typeof target?.name === 'string' ? target.name : ''
  const key = TARGET_OF[group]
  if (key === undefined || name === '') return { target, candidates: [], scanned: { packages: 0, files: 0, ms: 0 }, error: 'bad-target' }
  const packages = options.packages ?? activePackages(options.rootCtx)
  const self = options.self ?? '@local/dsh-prefill'
  const literal = new RegExp(`(['"\`])${escapeRe(name)}\\1`, 'g')
  // 模板名：`mcp:${server}` 这种，用冒号前的前缀找 `前缀:${`。
  const prefix = name.includes(':') ? name.slice(0, name.lastIndexOf(':') + 1) : undefined
  const template = prefix === undefined ? undefined : new RegExp(`\`${escapeRe(prefix)}\\$\\{`, 'g')
  const candidates = []
  let files = 0
  for (const pkg of packages) {
    if (pkg.name === self) continue
    for (const file of sourceFiles(pkg.dir)) {
      files += 1
      let text
      try {
        text = readFileSync(file, 'utf8')
      } catch {
        continue
      }
      if (!text.includes(name) && (prefix === undefined || !text.includes(`${prefix}\${`))) continue
      const hits = []
      for (const match of text.matchAll(literal)) hits.push({ index: match.index, exactName: true })
      if (template !== undefined) for (const match of text.matchAll(template)) hits.push({ index: match.index, exactName: false })
      for (const hit of hits) {
        const reg = registrationAt(text, hit.index)
        const confidence = reg?.key === key ? (hit.exactName ? 'high' : 'medium') : reg !== undefined ? 'low' : hit.exactName ? 'medium' : 'low'
        if (reg === undefined && !hit.exactName) continue
        candidates.push({
          package: pkg.name,
          version: pkg.version,
          file: relative(pkg.dir, file),
          line: lineOf(text, hit.index),
          snippet: snippetAt(text, hit.index),
          confidence,
          how: reg?.how ?? 'literal',
          registeredAs: reg?.key !== undefined ? GROUP_OF[reg.key] : undefined,
          siblings: registrationsIn(text)
            .filter((entry) => !(entry.group === group && entry.name === name))
            .filter((value, index, list) => list.findIndex((other) => other.group === value.group && other.name === value.name) === index)
            .slice(0, 24)
            .map((entry) => ({ ...entry, at: `${relative(pkg.dir, file)}:${entry.line}` })),
        })
      }
    }
  }
  const rank = { high: 0, medium: 1, low: 2 }
  candidates.sort((a, b) => rank[a.confidence] - rank[b.confidence] || a.package.localeCompare(b.package))
  return { target: { group, name }, candidates: candidates.slice(0, 12), scanned: { packages: packages.length, files, ms: Date.now() - started } }
}

/**
 * 由溯源结果生成候选来源包（用户确认后才挂）：同一个包的目标 + 同包注册的其它名字。
 * 冒充本插件 / DSH 核心的名字剔掉（放进 `rejected`）。
 */
export function candidatePack(trace, candidate, { only = false, via = 'trace' } = {}) {
  if (candidate === undefined) return undefined
  const members = [{ [TARGET_OF[trace.target.group]]: trace.target.name, exact: true, at: `${candidate.file}:${candidate.line}` }]
  if (!only) {
    for (const sibling of candidate.siblings ?? []) {
      const key = TARGET_OF[sibling.group]
      if (key === undefined) continue
      members.push({ [key]: sibling.name, exact: true, at: sibling.at })
    }
  }
  const kept = []
  const rejected = []
  for (const member of members) {
    const why = forbiddenMember(member)
    if (why === undefined) kept.push(member)
    else rejected.push({ ...member, why })
  }
  return {
    id: candidate.package,
    label: candidate.package,
    plugin: candidate.package,
    origin: 'third-party',
    members: kept,
    rejected,
    source: { via, plugin: candidate.package, confirmed: false },
  }
}

// ── 「让 AI 读」（用户点按钮才触发）────────────────────────────────────────────────

/** 交给模型的提示：只给扫描结果和上下文，不让它编。 */
export function aiTracePrompt(trace) {
  const lines = [
    `要找的名字：${trace.target.group === 'sections' ? '系统提示段' : trace.target.group === 'contexts' ? '运行时上下文' : trace.target.group === 'tools' ? '工具' : '消息来源 source.kind'} \`${trace.target.name}\``,
    '下面是在本机已装插件包源码里静态扫到的出现位置（包名@版本 文件:行，附近几行）。',
    '',
  ]
  for (const candidate of trace.candidates.slice(0, 6)) {
    lines.push(`### ${candidate.package}@${candidate.version} ${candidate.file}:${candidate.line}（${candidate.how}，静态置信度 ${candidate.confidence}）`)
    lines.push('```js', candidate.snippet, '```')
    if (candidate.siblings.length > 0) lines.push(`同文件还注册了：${candidate.siblings.slice(0, 12).map((entry) => `${entry.group}:${entry.name}`).join('、')}`)
    lines.push('')
  }
  return lines.join('\n')
}

export const AI_TRACE_SYSTEM =
  '你在帮用户判断一段送进模型的注入是哪个插件注册的。只根据给出的源码片段回答，不要猜测片段里没有的东西。' +
  '用中文写三到五句：是哪个包注册的、它大概是做什么的（每轮 / 一次性、放在系统提示还是运行时上下文）、同包还注册了哪些名字、置信度（高 / 中 / 低）和理由。' +
  '如果片段不足以判断，就直说不确定。不要给出操作建议。'

/** 用宿主的 LLM 写结论（当前会话的模型路由）；拿不到就返回 { ok: false, reason }。 */
export async function aiTrace(trace, { rootCtx, agent, signal } = {}) {
  if (trace.candidates.length === 0) return { ok: false, reason: 'no-candidates' }
  let llm
  try {
    llm = typeof rootCtx?.get === 'function' ? rootCtx.get('llm') : undefined
    if (llm === undefined) llm = rootCtx?.llm
  } catch {
    llm = undefined
  }
  const session = agent?.session
  const route = typeof session?.requestHeader === 'function' ? session.requestHeader()?.config : undefined
  if (llm === undefined || typeof llm.stream !== 'function') return { ok: false, reason: 'no-llm' }
  if (typeof route?.provider !== 'string' || typeof route?.model !== 'string') return { ok: false, reason: 'no-route' }
  let text = ''
  const closed = []
  for await (const chunk of llm.stream({
    provider: route.provider,
    model: route.model,
    system: AI_TRACE_SYSTEM,
    messages: [{ id: `trace-${Date.now()}`, role: 'user', source: { kind: 'prefill', prefill: 'sandbox-trace' }, content: [{ type: 'text', text: aiTracePrompt(trace) }] }],
    maxTokens: 800,
    sessionId: session.id,
    purpose: 'compaction',
    signal: signal ?? AbortSignal.timeout(90000),
  })) {
    if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
    else if (chunk?.type === 'block-end' && chunk.block?.type === 'text' && typeof chunk.block.text === 'string') closed.push(chunk.block.text)
  }
  const out = (closed.length > 0 ? closed.join('') : text).trim()
  return out === '' ? { ok: false, reason: 'empty' } : { ok: true, text: out.slice(0, 2000), model: `${route.provider}/${route.model}` }
}

