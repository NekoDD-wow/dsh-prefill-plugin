// 会话沙盒第 5 步（issue #15）：直写会话通道的事后按条改写（surface replace）。
// 假会话按 @deepseek-ai/dsh-session@0.2.1-rc.3 的规则校验替换事件（范围在 surface 上、sourceEventSeqs 覆盖被遮节点、
// developer/message 的 headerSeq 当且仅当有 tool-addition）；本机装了 DSH 运行时的话，再用真的 Session 跑一遍追加 + 重放。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { SURFACE_RISKS, applyPendingSurfaceEdits, applySurfaceEdit, restoreSurfaceEdit, surfaceOnRequest, sanitizeSurfaceEdits, surfaceCandidates, surfaceReady, surfaceRoute, surfaceTargetOf } from '../sandbox-surface.js'
import { sandboxRoute } from '../sandbox-routes.js'
import { classifySurfaceEvent } from '../injection-audit.js'
import { sandboxView } from '../sandbox-view.js'
import { makeHarness } from './sandbox-harness.mjs'

const RISKS = [...SURFACE_RISKS]

/** 最小的会话：append / eventAt / surface.nodes / snapshotEvents，替换规则照 DSH。 */
function fakeSession() {
  const log = []
  const nodes = []
  const surfaceTypes = new Set(['system/message', 'developer/message', 'user/message', 'assistant/message', 'tool/result'])
  return {
    log,
    surface: {
      get nodes() {
        return [...nodes]
      },
    },
    eventAt: (seq) => log[seq],
    snapshotEvents: () => log.map((event) => JSON.parse(JSON.stringify(event))),
    append(type, data, opts = {}) {
      const seq = log.length
      const event = JSON.parse(JSON.stringify({ type, seq, data, ...opts }))
      if (type === 'developer/message') {
        const additions = data.message.content.some((part) => part.type === 'tool-addition')
        if (additions ? !Number.isSafeInteger(data.headerSeq) : Object.hasOwn(data, 'headerSeq')) throw new Error('requires headerSeq exactly when tool additions are present')
      }
      if (surfaceTypes.has(type)) {
        if (opts.surfaceOp === undefined) throw new Error('requires a surfaceOp marker')
        if (opts.surfaceOp !== 'append') {
          const { startSeq, endSeq } = opts.surfaceOp
          const start = nodes.indexOf(startSeq)
          const end = nodes.indexOf(endSeq)
          if (start === -1 || end === -1 || start > end) throw new Error('surface replace: range not found in surface')
          const shadowed = nodes.slice(start, end + 1)
          const missing = shadowed.filter((node) => !(opts.sourceEventSeqs ?? []).includes(node))
          if (missing.length > 0) throw new Error(`sourceEventSeqs must include every shadowed surface node; missing ${missing}`)
          if ((opts.sourceEventSeqs ?? []).some((source) => source >= seq)) throw new Error('sourceEventSeqs must reference earlier events')
          nodes.splice(start, end - start + 1, seq)
        } else nodes.push(seq)
      }
      log.push(event)
      return event
    },
  }
}

const text = (value) => [{ type: 'text', text: value }]
const contentOf = (event) => (event.type === 'user/message' ? event.data.content : event.data.message.content)

/** 一轮：系统提示、用户原话、运行时上下文（带第三方 mem:recall）、request/header、工具增删通知、本插件每轮注入（回答略：真 Session 要完整的流式结算字段）。 */
function oneTurn(session) {
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('system/message', { turn: 1, step: 1, message: { role: 'system', id: 's', content: text('sys'), source: { kind: 'system-prompt' } } }, { surfaceOp: 'append' }) // 2
  session.append('user/message', { role: 'user', id: 'u', content: text('hi'), source: { kind: 'user' } }, { surfaceOp: 'append' }) // 3
  session.append('user/message', { role: 'user', id: 'c', content: text('Current runtime context.\n\nRecalled memory: green tea'), source: { kind: 'runtime-context', form: 'snapshot', sections: [{ name: 'mem:recall', text: 'Recalled memory: green tea' }] } }, { surfaceOp: 'append' }) // 4
  const header = session.append('request/header', { header: { config: { provider: 'p', model: 'm' }, tools: [{ name: 'spawn_teammate', description: 'd', parameters: { type: 'object' }, deferLoading: true }] }, reason: 'initial' }) // 5
  session.append('developer/message', { turn: 1, step: 1, message: { role: 'developer', id: 'd', content: [{ type: 'tool-addition', toolName: 'spawn_teammate' }], source: { kind: 'tool-registry' } }, headerSeq: header.seq }, { surfaceOp: 'append' }) // 6
  session.append('user/message', { role: 'user', id: 'p', content: text('每轮注入'), source: { kind: 'prefill', prefill: 'every-turn' } }, { surfaceOp: 'append' }) // 7
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return session
}

test('能改的范围：developer/message 和非用户 / 非本插件 / 非协议的 user/message；名字和审计表一致', () => {
  const session = oneTurn(fakeSession())
  const agent = { status: 'idle', session }
  const list = surfaceCandidates(agent)
  assert.deepEqual(list.map((entry) => [entry.seq, entry.name, entry.type, entry.turn]), [
    [4, 'runtime-context', 'user/message', 1],
    [6, 'developer:tool-registry', 'developer/message', 1],
  ])
  assert.equal(list[1].preview, 'tool-addition:spawn_teammate')
  assert.deepEqual(surfaceCandidates(agent, [], { name: 'developer:tool-registry' }).map((entry) => entry.seq), [6])
  for (const kind of ['user', 'user-rpc', 'prefill', 'prefill-inject', 'tool', 'compact-checkpoint', 'tombstone']) {
    assert.equal(surfaceTargetOf({ type: 'user/message', data: { content: [], source: { kind } } }), undefined, kind)
  }
  assert.equal(surfaceTargetOf({ type: 'system/message', data: { message: { content: [] } } }), undefined)
  assert.deepEqual(surfaceTargetOf({ type: 'user/message', data: { content: [], source: { kind: 'agent-message' } } }), { type: 'user/message', name: 'agent-message' })
})

test('门槛：四条风险都要勾；会话要在册、空闲（agent 在跑 / 日志里有没结束的轮都不行）', () => {
  const session = oneTurn(fakeSession())
  const before = session.log.length
  assert.deepEqual(applySurfaceEdit({ status: 'idle', session }, { seq: 6, text: '', risks: RISKS.slice(0, 3) }), { ok: false, reason: 'risks-unconfirmed', missing: ['internal'] })
  assert.equal(applySurfaceEdit({ status: 'running', session }, { seq: 6, text: '', risks: RISKS, developer: true }).reason, 'busy')
  assert.equal(applySurfaceEdit(undefined, { seq: 6, text: '', risks: RISKS, developer: true }).reason, 'not-live')
  session.append('turn/start', { turn: 2 })
  assert.equal(surfaceReady({ status: 'idle', session }).reason, 'busy', '日志里第 2 轮开了没结束')
  assert.equal(applySurfaceEdit({ status: 'idle', session }, { seq: 6, text: '', risks: RISKS, developer: true }).reason, 'busy')
  assert.equal(session.log.length, before + 1, '被拒时一条事件都不追加')
})

test('改写 developer/message 为空：空闲时只登记；下一步开头（agent/request）落盘：同类型替换、去掉 headerSeq、轮步 = 当前开着的那一步', () => {
  const session = oneTurn(fakeSession())
  const agent = { status: 'idle', session }
  const before = session.log.length
  const got = applySurfaceEdit(agent, { seq: 6, text: '', risks: RISKS, developer: true }, [])
  assert.equal(got.ok, true)
  assert.equal(got.pending, true)
  assert.equal(session.log.length, before, 'developer/message 是步内事件：空闲时不落盘（落了重启后会话打不开）')
  assert.equal(got.edit.status, 'pending')
  assert.equal(surfaceCandidates(agent, got.edits)[1].edit.pending, 'edit')
  // 下一轮第 1 步开头。
  session.append('turn/start', { turn: 2 })
  session.append('step/start', { turn: 2, step: 1 })
  let state = { surfaceEdits: { s1: got.edits } }
  const notes = []
  const done = surfaceOnRequest({ agent: { ...agent, id: 's1', status: 'running' }, turn: 2, step: 1 }, { readState: () => state, patchState: (patch) => (state = { ...state, ...patch }), note: (entry) => notes.push(entry) })
  assert.deepEqual(done.applied, [{ id: got.edit.id, op: 'edit', ok: true }])
  const replacement = session.log.at(-1)
  assert.equal(replacement.type, 'developer/message')
  assert.deepEqual(replacement.surfaceOp, { op: 'replace', startSeq: 6, endSeq: 6 })
  assert.deepEqual(replacement.sourceEventSeqs, [6])
  assert.equal(Object.hasOwn(replacement.data, 'headerSeq'), false, '内容不再有 tool-addition ⇒ 不带 headerSeq')
  assert.deepEqual(replacement.data.message.content, [])
  assert.deepEqual([replacement.data.turn, replacement.data.step], [2, 1], '轮步 = 当前开着的那一步')
  assert.equal(replacement.data.message.source.kind, 'tool-registry')
  assert.notEqual(replacement.data.message.id, 'd', '新消息新 id')
  assert.ok(session.surface.nodes.includes(replacement.seq) && !session.surface.nodes.includes(6))
  assert.deepEqual(contentOf(session.eventAt(6)), [{ type: 'tool-addition', toolName: 'spawn_teammate' }], '原文没动')
  const [edit] = state.surfaceEdits.s1
  assert.deepEqual(edit, { ...edit, seq: 6, currentSeq: replacement.seq, type: 'developer/message', name: 'developer:tool-registry', text: '', status: 'active', risks: RISKS })
  assert.equal(notes[0].op, 'apply-pending')
  // 没有登记的：什么都不做。
  assert.equal(surfaceOnRequest({ agent: { ...agent, id: 's1' }, turn: 2, step: 2 }, { readState: () => state, patchState: () => assert.fail('不该写状态') }), undefined)
  // 候选里仍按原文那条列出，带改写记录。
  const [, tool] = surfaceCandidates(agent, state.surfaceEdits.s1)
  assert.equal(tool.seq, 6)
  assert.equal(tool.currentSeq, replacement.seq)
  assert.equal(tool.edit.text, '')
  // 没落盘之前撤销 = 删掉登记，日志不动。
  const queued = applySurfaceEdit({ status: 'idle', session: oneTurn(fakeSession()) }, { seq: 6, text: 'x', risks: RISKS, developer: true }, [])
  const cancelled = restoreSurfaceEdit(agent, queued.edit.id, queued.edits)
  assert.equal(cancelled.cancelled, true)
  assert.deepEqual(cancelled.edits, [])
})

test('改写 user/message（运行时上下文）：source 原样、只换内容；不能改成空', () => {
  const session = oneTurn(fakeSession())
  const agent = { status: 'idle', session }
  assert.equal(applySurfaceEdit(agent, { seq: 4, text: '', risks: RISKS }).reason, 'empty-user-message')
  const got = applySurfaceEdit(agent, { seq: 4, text: 'Current runtime context.', risks: RISKS }, [])
  assert.equal(got.ok, true)
  const replacement = session.log.at(-1)
  assert.equal(replacement.type, 'user/message')
  assert.deepEqual(replacement.data.content, text('Current runtime context.'))
  assert.deepEqual(replacement.data.source, session.eventAt(4).data.source)
  assert.equal(replacement.data.role, 'user')
  assert.equal(session.surface.nodes.indexOf(replacement.seq), 2, '在原位置（系统提示、用户原话之后）')
  assert.equal(applySurfaceEdit(agent, { seq: 3, text: 'x', risks: RISKS }).reason, 'not-editable', '用户原话不能改')
  assert.equal(applySurfaceEdit(agent, { seq: 7, text: 'x', risks: RISKS }).reason, 'not-editable', '本插件的注入不归这里改')
})

test('同一条再改：只留一条记录、替换当前节点、sourceEventSeqs 带上原文；还原 = 再替换回原文（带回 headerSeq）', () => {
  const session = oneTurn(fakeSession())
  const agent = { status: 'idle', session }
  const at = { position: { turn: 1, step: 1 } }   // 直接给出开着的步（= agent/request 座位里落盘）
  const first = applySurfaceEdit(agent, { seq: 6, text: '', risks: RISKS, developer: true }, [], at)
  assert.equal(first.edit.status, 'active')
  const second = applySurfaceEdit(agent, { seq: 6, text: '工具变更通知（已改写）', risks: RISKS, developer: true }, first.edits, at)
  assert.equal(second.ok, true)
  assert.equal(second.edits.length, 1)
  const replacement = session.log.at(-1)
  assert.deepEqual(replacement.surfaceOp, { op: 'replace', startSeq: first.edit.currentSeq, endSeq: first.edit.currentSeq })
  assert.deepEqual(replacement.sourceEventSeqs, [6, first.edit.currentSeq])
  assert.deepEqual(replacement.data.message.content, text('工具变更通知（已改写）'))
  assert.deepEqual(second.edit.history, [first.edit.currentSeq])
  // 空闲时点还原：developer 一样只登记。
  const queued = restoreSurfaceEdit(agent, second.edit.id, second.edits)
  assert.equal(queued.pending, true)
  assert.deepEqual(queued.edit.pending, { op: 'restore' })
  const { edits, applied } = applyPendingSurfaceEdits(agent, queued.edits, { turn: 2, step: 1 })
  assert.deepEqual(applied.map((entry) => [entry.op, entry.ok]), [['restore', true]])
  const back = session.log.at(-1)
  assert.deepEqual(back.data.message.content, [{ type: 'tool-addition', toolName: 'spawn_teammate' }])
  assert.equal(back.data.headerSeq, 5, '原文有工具新增 ⇒ 还原时带回原文的 headerSeq')
  assert.equal(edits[0].status, 'restored')
  assert.equal(edits[0].restoreSeq, back.seq)
  assert.equal(Object.hasOwn(edits[0], 'pending'), false)
  assert.equal(restoreSurfaceEdit(agent, second.edit.id, edits).reason, 'already-restored')
  assert.deepEqual(surfaceCandidates(agent, edits).map((entry) => [entry.name, entry.edit === undefined]), [['runtime-context', true], ['developer:tool-registry', true]])
  // user/message 空闲时当场改、当场还原。
  const ctx = applySurfaceEdit(agent, { seq: 4, text: 'ctx', risks: RISKS }, edits)
  assert.equal(ctx.pending, undefined)
  const ctxBack = restoreSurfaceEdit(agent, ctx.edit.id, ctx.edits)
  assert.equal(ctxBack.ok, true)
  assert.deepEqual(session.log.at(-1).data.content, session.eventAt(4).data.content)
})

test('被压缩遮掉的节点：还原报 not-on-surface 并把记录标成 gone', () => {
  const session = oneTurn(fakeSession())
  const agent = { status: 'idle', session }
  const got = applySurfaceEdit(agent, { seq: 4, text: 'ctx', risks: RISKS }, [])
  // 压缩：把 3..最后 一段换成 checkpoint。
  const nodes = session.surface.nodes
  session.append('user/message', { role: 'user', id: 'k', content: text('summary'), source: { kind: 'compact-checkpoint' } }, { surfaceOp: { op: 'replace', startSeq: nodes[1], endSeq: nodes.at(-1) }, sourceEventSeqs: nodes.slice(1) })
  const restored = restoreSurfaceEdit(agent, got.edit.id, got.edits)
  assert.equal(restored.ok, false)
  assert.equal(restored.reason, 'not-on-surface')
  assert.equal(restored.edits[0].status, 'gone')
  assert.equal(applySurfaceEdit(agent, { seq: 6, text: '', risks: RISKS, developer: true }, restored.edits).reason, 'not-on-surface')
  // 登记着、落盘前被压缩遮掉的 developer 改写：落盘时作废，不再每步重试。
  const pending = { id: 'p1', seq: 6, currentSeq: 6, type: 'developer/message', name: 'developer:tool-registry', text: '', status: 'pending', risks: RISKS }
  const dropped = applyPendingSurfaceEdits(agent, [pending], { turn: 2, step: 1 })
  assert.deepEqual(dropped.applied, [{ id: 'p1', op: 'edit', ok: false, reason: 'not-on-surface' }])
  assert.deepEqual(dropped.edits, [])
})

test('路由：surface-list / surface-edit / surface-restore 读写 state.surfaceEdits[会话]；经 sandboxRoute 的 surface-* 分支', async () => {
  const session = oneTurn(fakeSession())
  const agent = { status: 'idle', session }
  let state = { surfaceEdits: { other: [{ id: 'x', seq: 1, currentSeq: 2, type: 'user/message', name: 'k', text: 't', status: 'active' }] } }
  const deps = { readState: () => state, patchState: (patch) => (state = { ...state, ...patch }), liveAgents: new Map([['s1', agent]]), surface: surfaceRoute }
  const list = await sandboxRoute({ op: 'surface-list', sessionId: 's1', name: 'developer:tool-registry' }, deps)
  assert.equal(list.ok, true)
  assert.equal(list.ready, true)
  assert.deepEqual(list.risks, RISKS)
  assert.deepEqual(list.candidates.map((entry) => entry.seq), [6])
  assert.equal((await sandboxRoute({ op: 'surface-edit', sessionId: 's1', seq: 6, text: '', risks: ['log'] }, deps)).reason, 'risks-unconfirmed')
  assert.equal(state.surfaceEdits.s1, undefined)
  const edited = await sandboxRoute({ op: 'surface-edit', sessionId: 's1', seq: 4, text: 'ctx', risks: RISKS }, deps)
  assert.equal(edited.ok, true)
  const queued = await sandboxRoute({ op: 'surface-edit', sessionId: 's1', seq: 6, text: '', risks: RISKS, developer: true }, deps)
  assert.equal(queued.pending, true)
  assert.equal(state.surfaceEdits.s1.length, 2)
  assert.equal(edited.edits, undefined, '回复里不带整张记录')
  assert.equal(state.surfaceEdits.other.length, 1, '别的会话的记录不动')
  const restored = await sandboxRoute({ op: 'surface-restore', sessionId: 's1', id: edited.edit.id }, deps)
  assert.equal(restored.ok, true)
  assert.deepEqual(state.surfaceEdits.s1.map((edit) => edit.status), ['restored', 'pending'])
  assert.equal((await sandboxRoute({ op: 'surface-list', sessionId: 'nope' }, deps)).ready, false)
  assert.equal((await sandboxRoute({ op: 'surface-list' }, deps)).reason, 'no-session')
  assert.deepEqual(sanitizeSurfaceEdits({ a: [{ id: 1 }], b: 'x' }), {})
})

test('审计：替换事件（改写 / 压缩 / 系统提示对齐）不算新注入', () => {
  const known = { messages: new Set(), contexts: new Set(), sections: new Set() }
  const developer = { type: 'developer/message', seq: 9, data: { message: { content: [], source: { kind: 'tool-registry' } } } }
  assert.equal(classifySurfaceEvent({ ...developer, surfaceOp: 'append' }, known).length, 1)
  assert.equal(classifySurfaceEvent({ ...developer, surfaceOp: { op: 'replace', startSeq: 6, endSeq: 6 } }, known).length, 0)
})

test('面板：审计表「直写会话」行有「事后改写… ⚠」→ 弹窗列出节点；四条风险勾齐才能点；改写 / 还原发到 surface-* 路由', async () => {
  const SID = 'session-p'
  const audit = { [SID]: [{ group: 'messages', name: 'developer:tool-registry', preview: 'tool-addition:spawn_teammate', blockable: false, count: 1 }] }
  const sources = () => ({ injections: { catalog: {}, sessions: {} }, tools: { catalog: [], sessions: {} }, audit })
  const state = { sandbox: { [SID]: { level: 'controlled', rules: [] } } }
  const candidate = { seq: 6, currentSeq: 6, type: 'developer/message', name: 'developer:tool-registry', turn: 1, preview: 'tool-addition:spawn_teammate' }
  const routes = {
    'surface-list': { ok: true, ready: true, risks: RISKS, candidates: [candidate], edits: [] },
    'surface-edit': (body) => ({ ok: true, changed: true, edit: { id: 'e1', seq: body.seq, currentSeq: 12, text: body.text } }),
    'surface-restore': { ok: true },
  }
  const harness = makeHarness({ state, sandboxView: { [SID]: sandboxView(state, SID, sources()) } }, { sid: SID, sources, routes })
  const { render, find, posts, settle } = harness
  let tree = render()
  const [open] = find(tree, (props) => props['data-prefill-sbx-surface-open'] === 'developer:tool-registry')
  assert.ok(open, '直写会话那一行有入口')
  assert.ok(find(tree, (props) => props['data-prefill-sbx-surface-all'] !== undefined).length === 1, '审计表下方有「已有的直写消息」入口')
  open.props.onClick()
  await settle()
  tree = render()
  assert.deepEqual(posts.at(-1), { path: '/api/dsh-prefill/sandbox', op: 'surface-list', sessionId: SID, name: 'developer:tool-registry' })
  assert.equal(find(tree, (props) => props['data-prefill-sbx-surface-item'] === '6').length, 1)
  const go = () => find(render(), (props) => props['data-prefill-sbx-surface-go'] !== undefined)[0]
  assert.equal(go().props.disabled, true, '没勾风险不能点')
  for (const risk of RISKS.slice(0, 3)) find(render(), (props) => props['data-prefill-sbx-surface-risk'] === risk)[0].props.onChange()
  assert.equal(go().props.disabled, true, '少一条也不行')
  find(render(), (props) => props['data-prefill-sbx-surface-risk'] === 'internal')[0].props.onChange()
  assert.equal(go().props.disabled, false)
  go().props.onClick()
  await settle()
  await settle()
  const edit = posts.find((post) => post.op === 'surface-edit')
  assert.deepEqual(edit, { path: '/api/dsh-prefill/sandbox', op: 'surface-edit', sessionId: SID, seq: 6, text: '', risks: RISKS })
  assert.equal(find(render(), (props) => props['data-prefill-sbx-surface-result'] === 'ok').length, 1)
  // 已改写的节点：列表里有「还原」。
  routes['surface-list'] = { ok: true, ready: true, risks: RISKS, candidates: [{ ...candidate, currentSeq: 12, edit: { id: 'e1', text: '', at: 'x' } }], edits: [] }
  open.props.onClick()
  await settle()
  const [restore] = find(render(), (props) => props['data-prefill-sbx-surface-restore'] === 'e1')
  assert.ok(restore)
  restore.props.onClick({ preventDefault() {} })
  await settle()
  assert.deepEqual(posts.filter((post) => post.op === 'surface-restore'), [{ path: '/api/dsh-prefill/sandbox', op: 'surface-restore', sessionId: SID, id: 'e1' }])
  // 会话在跑：提示改不了、按钮不可点。
  routes['surface-list'] = { ok: true, ready: false, reason: 'busy', risks: RISKS, candidates: [candidate], edits: [] }
  open.props.onClick()
  await settle()
  tree = render()
  assert.equal(find(tree, (props) => props['data-prefill-sbx-surface-notready'] === 'busy').length, 1)
  for (const risk of RISKS) find(render(), (props) => props['data-prefill-sbx-surface-risk'] === risk)[0].props.onChange()
  assert.equal(go().props.disabled, true)
})

// 本机装了 DSH 运行时（实测环境）才跑：用真的 Session 追加替换事件、按日志重放，并跑一遍落盘日志的格式校验
// （dsh-session-format-v3-to-v4 的 assertReleasedV4Relationships，= 重启后加载会话时的那一道）。
const DSH = process.env.DSH_RUNTIME_MODULES ?? '/workspace/work/dsh-runtime/node_modules/@deepseek-ai/'
test('真的 dsh-session + 落盘格式校验：改写 / 再改 / 还原后日志能重放、能通过加载校验；空闲时落 developer 改写会被校验拒绝', { skip: !existsSync(`${DSH}dsh-session-format-v3-to-v4/lib/index.js`) && 'DSH 运行时不在本机' }, async () => {
  const { Session, SessionId, KNOWN_SESSION_EVENT_TYPES } = await import(pathToFileURL(`${DSH}dsh-session/lib/index.js`).href)
  const { assertReleasedV4Relationships } = await import(pathToFileURL(`${DSH}dsh-session-format-v3-to-v4/lib/index.js`).href)
  const header = { version: 4, id: 'session-real', createdAt: 1, isSeeded: false }
  const session = oneTurn(new Session(SessionId('session-real'), undefined, header))
  const agent = { status: 'idle', session, id: 'session-real' }
  const events = () => session.snapshotEvents().map((event) => JSON.parse(JSON.stringify(event)))
  const replay = () => new Session(SessionId('session-real'), events(), undefined)
  const stored = () => assertReleasedV4Relationships({ header, events: events(), inheritedEventCount: 0 }, KNOWN_SESSION_EVENT_TYPES)
  let state = { surfaceEdits: {} }
  const deps = { readState: () => state, patchState: (patch) => (state = { ...state, ...patch }), liveAgents: new Map([['session-real', agent]]) }
  assert.equal((await surfaceRoute('surface-edit', { sessionId: 'session-real', seq: 6, text: '', risks: RISKS, developer: true }, deps)).pending, true)
  assert.equal((await surfaceRoute('surface-edit', { sessionId: 'session-real', seq: 4, text: 'Current runtime context.', risks: RISKS }, deps)).ok, true)
  stored()
  // 下一轮：step 开着时落盘登记的 developer 改写。
  session.append('turn/start', { turn: 2 })
  session.append('step/start', { turn: 2, step: 1 })
  assert.deepEqual(surfaceOnRequest({ agent, turn: 2, step: 1 }, deps).applied.map((entry) => entry.ok), [true])
  session.append('step/end', { turn: 2, step: 1 })
  session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
  stored()
  assert.deepEqual([...replay().surface.nodes], [...session.surface.nodes])
  // 还原（developer：登记 → 下一步落盘；runtime-context：当场）。
  for (const edit of state.surfaceEdits['session-real']) assert.equal((await surfaceRoute('surface-restore', { sessionId: 'session-real', id: edit.id }, deps)).ok, true)
  session.append('turn/start', { turn: 3 })
  session.append('step/start', { turn: 3, step: 1 })
  surfaceOnRequest({ agent, turn: 3, step: 1 }, deps)
  session.append('step/end', { turn: 3, step: 1 })
  session.append('turn/end', { turn: 3, reason: { kind: 'completed' } })
  stored()
  const again = replay()
  assert.deepEqual([...again.surface.nodes], [...session.surface.nodes])
  const nodes = [...again.surface.nodes].map((seq) => again.eventAt(seq))
  assert.deepEqual(nodes.find((event) => event.type === 'developer/message').data.message.content, [{ type: 'tool-addition', toolName: 'spawn_teammate' }])
  assert.equal(nodes.find((event) => event.type === 'developer/message').data.headerSeq, 5)
  assert.deepEqual(nodes.find((event) => event.data?.source?.kind === 'runtime-context').data.content, session.eventAt(4).data.content)
  assert.deepEqual(state.surfaceEdits['session-real'].map((edit) => edit.status), ['restored', 'restored'])
  // 对照 1：空闲时直接落 developer 改写（第一版的做法）——内存里的 Session 收下，落盘校验拒绝（重启后会话打不开）。
  const idle = oneTurn(new Session(SessionId('session-real'), undefined, header))
  const original = idle.eventAt(6)
  const { headerSeq: _h, ...rest } = original.data
  idle.append('developer/message', { ...rest, message: { ...original.data.message, id: 'z', content: [] } }, { surfaceOp: { op: 'replace', startSeq: 6, endSeq: 6 }, sourceEventSeqs: [6] })
  assert.throws(() => assertReleasedV4Relationships({ header, events: idle.snapshotEvents().map((event) => JSON.parse(JSON.stringify(event))), inheritedEventCount: 0 }, KNOWN_SESSION_EVENT_TYPES), /does not match an open turn and step/)
  // 对照 2：去掉工具新增却留着 headerSeq，真 Session 当场拒绝（这就是要去掉 headerSeq 的原因）。
  const live = oneTurn(new Session(SessionId('session-real'), undefined, header))
  live.append('turn/start', { turn: 2 })
  live.append('step/start', { turn: 2, step: 1 })
  assert.throws(() => live.append('developer/message', { ...live.eventAt(6).data, turn: 2, message: { ...live.eventAt(6).data.message, id: 'z', content: [] } }, { surfaceOp: { op: 'replace', startSeq: 6, endSeq: 6 }, sourceEventSeqs: [6] }), /headerSeq/)
})

test('developer/message 默认不让新改（DSH 0.2.1-rc.3 新 series 不再投影 series 之前的 developer 消息，改写到不了模型）', () => {
  const session = oneTurn(fakeSession())
  const agent = { status: 'idle', session }
  const before = session.log.length
  assert.equal(applySurfaceEdit(agent, { seq: 6, text: '', risks: RISKS }, []).reason, 'developer-not-projected')
  assert.equal(session.log.length, before)
  // runtime-context 这类 user/message 照常能改
  assert.equal(applySurfaceEdit(agent, { seq: 4, text: 'ctx', risks: RISKS }, []).ok, true)
})
