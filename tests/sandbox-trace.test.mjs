// 会话沙盒第 4 步（issue #15）：插件开放注册来源包（自报）+ 溯源（静态读插件包源码 / 用户点了才让 AI 读）。
// 两条路得到的都只当线索：确认挂上时冒充本插件 / DSH 核心的名字一律剔掉。
import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { activePackages, aiTrace, aiTracePrompt, candidatePack, claimPack, claims, claimsFor, installClaimApi, registrationsIn, traceName } from '../sandbox-trace.js'
import { attachPack, detachPack, sandboxRoute } from '../sandbox-routes.js'
import { decide } from '../sandbox.js'
import { packCatalog } from '../sandbox-packs.js'
import { sandboxView } from '../sandbox-view.js'

const ROOT = fileURLToPath(new URL('./fixtures/sandbox-trace/', import.meta.url))
const MODULES = join(ROOT, 'node_modules')
const PACKAGES = [
  { name: '@acme/dsh-memory', version: '1.4.0', dir: join(MODULES, '@acme/dsh-memory') },
  { name: 'dsh-plain-tool', version: '0.1.0', dir: join(MODULES, 'dsh-plain-tool') },
  { name: '@local/dsh-prefill', version: 'x', dir: fileURLToPath(new URL('../', import.meta.url)) },
]

test('静态溯源：找到注册点（包@版本 文件:行 + 片段），同包注册的其它名字，置信度', () => {
  const trace = traceName({ group: 'contexts', name: 'mem:recall' }, { packages: PACKAGES })
  assert.equal(trace.scanned.packages, 3)
  const [top, other] = trace.candidates
  assert.equal(top.package, '@acme/dsh-memory')
  assert.equal(top.version, '1.4.0')
  assert.equal(top.file, 'lib/index.js')
  assert.equal(top.line, 7)
  assert.equal(top.confidence, 'high')
  assert.equal(top.registeredAs, 'contexts')
  assert.match(top.snippet, /name: 'mem:recall', order: 50/)
  assert.deepEqual(
    top.siblings.map((entry) => `${entry.group}:${entry.name}`),
    ['sections:mem:policy', 'tools:memory_search', 'messages:acme-memory', 'messages:runtime-context'],
  )
  assert.equal(other.package, 'dsh-plain-tool')
  assert.notEqual(other.confidence, 'high', '只是提到字面量，不是注册点')
  assert.ok(!trace.candidates.some((candidate) => candidate.package === '@local/dsh-prefill'), '本插件自己的源码不算')
  // 工具 / 消息来源也能溯。
  assert.equal(traceName({ group: 'tools', name: 'memory_search' }, { packages: PACKAGES }).candidates[0].registeredAs, 'tools')
  assert.equal(traceName({ group: 'messages', name: 'acme-memory' }, { packages: PACKAGES }).candidates[0].how, 'source.kind')
  assert.deepEqual(traceName({ group: 'contexts', name: 'nobody:here' }, { packages: PACKAGES }).candidates, [])
  assert.deepEqual(registrationsIn("x.section({ name: 'a:b', text: '' }); defineTool({ name: 't1' }); source: { kind: 'k1' }").map((entry) => entry.name), ['a:b', 't1', 'k1'])
})

test('候选来源包：目标 + 同包名字；冒充 DSH 核心的 runtime-context 剔掉；「只挂这一条」只有目标', () => {
  const trace = traceName({ group: 'contexts', name: 'mem:recall' }, { packages: PACKAGES })
  const pack = candidatePack(trace, trace.candidates[0])
  assert.equal(pack.id, '@acme/dsh-memory')
  assert.deepEqual(pack.members.map((member) => member.context ?? member.section ?? member.tool ?? member.kind), ['mem:recall', 'mem:policy', 'memory_search', 'acme-memory'])
  assert.deepEqual(pack.rejected.map((member) => `${member.kind}:${member.why}`), ['runtime-context:core'])
  assert.equal(pack.source.confirmed, false, '没确认之前只是候选')
  assert.deepEqual(candidatePack(trace, trace.candidates[0], { only: true }).members.map((member) => member.context), ['mem:recall'])
})

test('插件自报（开放注册）：全局 API；冒充本插件 / DSH 核心的成员剔掉；撤销后消失', () => {
  const api = installClaimApi()
  assert.equal(globalThis[Symbol.for('dsh-prefill.sandbox')], api)
  const undo = api.claim({ plugin: '@acme/dsh-memory', label: '记忆召回', members: [{ context: 'mem:recall' }, { tool: 'memory_search' }, { section: 'prefill:persona' }, { section: 'harness:identity' }, { kind: 'agent-message' }] })
  const undo2 = claimPack({ plugin: '@acme/dsh-memory', members: [{ section: 'mem:policy' }] })
  const [claim] = claims()
  assert.equal(claim.plugin, '@acme/dsh-memory')
  assert.deepEqual(claim.members, [{ context: 'mem:recall', exact: true }, { tool: 'memory_search', exact: true }, { section: 'mem:policy', exact: true }])
  assert.deepEqual(claim.rejected.map((member) => member.why).sort(), ['core', 'core', 'self'])
  assert.equal(claimsFor('contexts', 'mem:recall').length, 1)
  assert.equal(claimsFor('contexts', 'other').length, 0)
  // 面板视图：未归属那条带上「插件自报」。
  const view = sandboxView({ sandbox: { s: { level: 'controlled', rules: [] } } }, 's', { injections: { catalog: {}, sessions: { s: { contexts: ['mem:recall'] } } } })
  assert.equal(view.unassigned[0].claims[0].plugin, '@acme/dsh-memory')
  undo()
  undo2()
  assert.deepEqual(claims(), [])
  assert.equal(claimPack({ plugin: '', members: [] })(), undefined, '不合法的自报：返回空撤销函数')
})

test('插件自报：同一份自报重复调（每个 agent/created 一次）只记一份、剔掉的成员不重复；全部撤销后才消失', () => {
  const raw = { plugin: '@acme/dsh-memory', members: [{ context: 'mem:recall' }, { section: 'harness:identity' }] }
  const undos = [claimPack(raw), claimPack(raw), claimPack(raw)]
  const [claim] = claims()
  assert.equal(claims().length, 1)
  assert.deepEqual(claim.members, [{ context: 'mem:recall', exact: true }])
  assert.deepEqual(claim.rejected.map((member) => member.section), ['harness:identity'], '剔掉的成员不随重复自报翻倍')
  assert.equal(globalThis[Symbol.for('dsh-prefill.sandbox-claims')].size, 1, '内存里不随会话数增长')
  undos[0]()
  undos[0]()
  assert.equal(claims().length, 1, '还有别的调用方持有')
  undos[1]()
  undos[2]()
  assert.deepEqual(claims(), [])
})

test('确认挂上（attach）：合并成员、剔掉冒充成员、可顺手设本会话开关；挂上后受控档按第三方包裁决；detach 摘掉', async () => {
  let state = { sandbox: { s: { level: 'controlled', rules: [] } } }
  const deps = { readState: () => state, patchState: (patch) => (state = { ...state, ...patch }), liveAgents: new Map(), packages: PACKAGES, note() {} }
  const traced = await sandboxRoute({ op: 'trace', group: 'contexts', name: 'mem:recall' }, deps)
  assert.equal(traced.ok, true)
  assert.equal(traced.candidates[0].package, '@acme/dsh-memory')
  assert.equal(traced.single.members.length, 1)
  assert.deepEqual(decide(state, 's', { context: 'mem:recall' }), { action: 'deny', by: 'level' }, '挂上之前：未归属')
  const attached = await sandboxRoute({ op: 'attach', pack: { ...traced.pack, members: [...traced.pack.members, { kind: 'runtime-context' }] }, sessionId: 's', setting: 'allow' }, deps)
  assert.equal(attached.ok, true)
  assert.deepEqual(attached.dropped.map((member) => member.kind), ['runtime-context'])
  assert.equal(state.sandboxPacks['@acme/dsh-memory'].source.confirmed, true)
  assert.equal(state.sandboxPacks['@acme/dsh-memory'].source.via, 'trace')
  assert.deepEqual(state.sandbox.s.packs, { '@acme/dsh-memory': 'allow' })
  assert.deepEqual(decide(state, 's', { context: 'mem:recall' }), { action: 'allow', by: 'pack', pack: '@acme/dsh-memory', scope: 'session' })
  assert.equal(decide(state, 's', { tool: 'memory_search' }).action, 'allow')
  assert.equal(decide({ ...state, sandbox: { t: { level: 'controlled', rules: [] } } }, 't', { tool: 'memory_search' }).action, 'deny', '别的受控会话：第三方包默认拦')
  // 手动挂到内置核心包：只加成员。
  const core = attachPack(state.sandboxPacks, { id: 'dsh-core-context', members: [{ context: 'acme:core-ish' }] })
  assert.deepEqual(core.packs['dsh-core-context'], { extends: true, members: [{ context: 'acme:core-ish', exact: true }] })
  assert.equal(attachPack({}, { id: 'prefill', members: [{ section: 'x' }] }).reason, 'locked')
  assert.equal(attachPack({}, { id: 'evil', members: [{ section: 'prefill:persona' }] }).reason, 'no-valid-members')
  // 摘一个成员 / 整包。
  assert.deepEqual(detachPack(state.sandboxPacks, '@acme/dsh-memory', { tool: 'memory_search', exact: true }).packs['@acme/dsh-memory'].members.length, 3)
  await sandboxRoute({ op: 'detach', id: '@acme/dsh-memory' }, deps)
  assert.equal(state.sandboxPacks['@acme/dsh-memory'], undefined)
  assert.equal(packCatalog(state).some((pack) => pack.id === '@acme/dsh-memory'), false)
  assert.equal((await sandboxRoute({ op: 'nope' }, deps)).reason, 'unknown-op')
  assert.equal((await sandboxRoute({ op: 'trace', group: 'bogus', name: 'x' }, deps)).reason, 'bad-target')
})

test('让 AI 读（用户点按钮才调）：走宿主 LLM + 当前会话的模型路由；没有 LLM / 路由时只给静态结果', async () => {
  const trace = traceName({ group: 'contexts', name: 'mem:recall' }, { packages: PACKAGES })
  const prompt = aiTracePrompt(trace)
  assert.match(prompt, /@acme\/dsh-memory@1\.4\.0 lib.index\.js:7/)
  assert.match(prompt, /同文件还注册了：sections:mem:policy/)
  const calls = []
  const llm = {
    async *stream(request) {
      calls.push(request)
      yield { type: 'text-delta', text: '@acme/dsh-memory 注册的「记忆召回」。' }
      yield { type: 'block-end', block: { type: 'text', text: '@acme/dsh-memory 注册的「记忆召回」，置信度高。' } }
    },
  }
  const agent = { session: { id: 's', requestHeader: () => ({ config: { provider: 'deepseek', model: 'deepseek-flash' } }) } }
  const rootCtx = { get: (key) => (key === 'llm' ? llm : undefined) }
  const result = await aiTrace(trace, { rootCtx, agent })
  assert.deepEqual(result, { ok: true, text: '@acme/dsh-memory 注册的「记忆召回」，置信度高。', model: 'deepseek/deepseek-flash' })
  assert.equal(calls[0].model, 'deepseek-flash')
  assert.equal(calls[0].messages[0].source.kind, 'prefill', '本插件自己的请求，不进会话')
  assert.equal((await aiTrace(trace, { rootCtx: { get: () => undefined }, agent })).reason, 'no-llm')
  assert.equal((await aiTrace(trace, { rootCtx, agent: undefined })).reason, 'no-route')
  // 路由：trace-ai 成功时候选包标成 AI 溯源。
  const routed = await sandboxRoute({ op: 'trace-ai', group: 'contexts', name: 'mem:recall', sessionId: 's' }, { readState: () => ({}), patchState() {}, liveAgents: new Map([['s', agent]]), rootCtx, packages: PACKAGES })
  assert.equal(routed.ai.ok, true)
  assert.equal(routed.pack.source.via, 'ai')
})

test('枚举启用的插件包：Cordis Loader 的启用条目（跳过 group / 停用 / 相对路径），按条目的 baseUrl 找包目录', () => {
  const base = pathToFileURL(join(ROOT, 'entry.js')).href
  const entry = (name, extra = {}) => ({ options: { name }, parent: { tree: { ctx: { baseUrl: base } } }, ...extra })
  const loader = { entries: () => [entry('@acme/dsh-memory'), entry('dsh-plain-tool/lib/index.js'), entry('./local.js'), entry('gone', { disabled: true }), { options: { group: true } }] }
  const found = activePackages({ get: (key) => (key === 'loader' ? loader : undefined) })
  assert.deepEqual(found.map((pkg) => `${pkg.name}@${pkg.version}`), ['@acme/dsh-memory@1.4.0', 'dsh-plain-tool@0.1.0'])
  assert.equal(traceName({ group: 'contexts', name: 'mem:recall' }, { packages: found }).candidates[0].package, '@acme/dsh-memory')
})

// ── 面板：未归属 → 溯源弹窗 → 挂上；插件自报一键确认；手动挂到… ─────────────────────
import { makeHarness } from './sandbox-harness.mjs'

test('面板：未归属那条点「溯源」→ 弹窗显示注册点 / 同包名字 / 只当线索提示 →「挂到 包（N 项）」= attach；自报一键确认；手动挂到已有包', async () => {
  const SID = 'session-trace'
  const sources = () => ({ injections: { catalog: { sections: [], contexts: [] }, sessions: { [SID]: { contexts: ['mem:recall'] } } }, tools: {}, audit: { [SID]: [{ group: 'contexts', name: 'mem:recall', count: 2, blockable: true }] } })
  const traced = traceName({ group: 'contexts', name: 'mem:recall' }, { packages: PACKAGES })
  const traceReply = { ok: true, ...traced, claims: [], pack: candidatePack(traced, traced.candidates[0]), single: candidatePack(traced, traced.candidates[0], { only: true }) }
  const state = { sandbox: { [SID]: { level: 'controlled', rules: [] } } }
  const undo = claimPack({ plugin: '@acme/dsh-memory', label: '记忆召回', members: [{ context: 'mem:recall' }, { tool: 'memory_search' }] })
  const envelope = { state, sandboxView: { [SID]: sandboxView(state, SID, sources()) }, injections: sources().injections }
  undo()
  const ui = makeHarness(envelope, { sid: SID, sources, routes: { trace: traceReply, 'trace-ai': { ...traceReply, ai: { ok: true, text: '是 @acme/dsh-memory 的记忆召回。', model: 'deepseek/deepseek-flash' } }, attach: { ok: true } } })
  let tree = ui.render()
  // 自报：一键确认挂到「记忆召回」（2 项）。
  const [claimButton] = ui.find(tree, (props) => props['data-prefill-sbx-claim'] === '@acme/dsh-memory')
  claimButton.props.onClick()
  await ui.settle()
  assert.deepEqual(ui.posts.at(-1), { path: '/api/dsh-prefill/sandbox', op: 'attach', sessionId: SID, pack: { id: '@acme/dsh-memory', label: '记忆召回', plugin: '@acme/dsh-memory', members: [{ context: 'mem:recall', exact: true }, { tool: 'memory_search', exact: true }], source: { via: 'claim', plugin: '@acme/dsh-memory' } } })
  // 溯源弹窗。
  tree = ui.render()
  ui.find(tree, (props) => props['data-prefill-sbx-trace'] === 'contexts:mem:recall')[0].props.onClick()
  await ui.settle()
  assert.deepEqual(ui.posts.at(-1), { path: '/api/dsh-prefill/sandbox', op: 'trace', group: 'contexts', name: 'mem:recall', sessionId: SID })
  tree = ui.render()
  const [dialog] = ui.find(tree, (props) => props['data-prefill-sbx-trace-dialog'] === 'contexts:mem:recall')
  const text = JSON.stringify(dialog)
  assert.match(text, /@acme\/dsh-memory@1\.4\.0  lib.index\.js:7/)
  assert.match(text, /name: 'mem:recall', order: 50/)
  assert.match(text, /只当线索/)
  assert.match(text, /已剔掉 1 项/)
  // 让 AI 读（按钮触发）→ 结论显示出来，挂上时来源标成 AI 溯源。
  ui.find(dialog, (props) => props['data-prefill-sbx-trace-ai-go'] !== undefined)[0].props.onClick()
  await ui.settle()
  assert.equal(ui.posts.at(-1).op, 'trace-ai')
  tree = ui.render()
  assert.match(JSON.stringify(ui.find(tree, (props) => props['data-prefill-sbx-trace-ai'] !== undefined)), /记忆召回/)
  ui.find(tree, (props) => props['data-prefill-sbx-attach-one'] !== undefined)[0].props.onClick()
  await ui.settle()
  assert.equal(ui.posts.at(-1).op, 'attach')
  assert.equal(ui.posts.at(-1).pack.source.via, 'ai')
  assert.deepEqual(ui.posts.at(-1).pack.members.map((member) => member.context), ['mem:recall'])
  // 再开一次，挂整包（4 项，runtime-context 已剔掉）。
  tree = ui.render()
  ui.find(tree, (props) => props['data-prefill-sbx-trace'] === 'contexts:mem:recall')[0].props.onClick()
  await ui.settle()
  tree = ui.render()
  const [all] = ui.find(tree, (props) => props['data-prefill-sbx-attach-all'] !== undefined)
  assert.match(JSON.stringify(all.children), /挂到 @acme\/dsh-memory（4 项）/)
  all.props.onClick()
  await ui.settle()
  assert.equal(ui.posts.at(-1).pack.members.length, 4)
  // 手动挂到 Agent Teams。
  tree = ui.render()
  ui.find(tree, (props) => props['data-prefill-sbx-attach-to'] === 'contexts:mem:recall')[0].props.onClick()
  tree = ui.render()
  ui.find(tree, (props) => props['data-prefill-sbx-attach-pick'] !== undefined)[0].props.onChange({ target: { value: 'agent-teams' } })
  tree = ui.render()
  ui.find(tree, (props) => props['data-prefill-sbx-attach-go'] !== undefined)[0].props.onClick()
  await ui.settle()
  assert.deepEqual(ui.posts.at(-1).pack, { id: 'agent-teams', members: [{ context: 'mem:recall', exact: true }], source: { via: 'manual' } })
})
