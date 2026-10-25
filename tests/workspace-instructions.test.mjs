// 工作区说明（AGENTS.md / CLAUDE.md）：原样 / 关闭 / 改写（首条换正文、之后的丢）、中途切换补一条、预设只存模式。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  OFF_NOTICE,
  WORKSPACE_KIND,
  applyWorkspaceInstructions,
  lastWorkspaceInHistory,
  rewriteText,
  sanitizeWorkspaceInstructions,
  workspaceInstructionsFor,
  workspaceSignature,
} from '../workspace-instructions.js'
import { FEATURES, applyEnabled, sanitizeEnabled } from '../enabled.js'
import * as gate from '../gate.js'

const SID = 'session-ws'
const user = (text) => ({ id: `u-${text}`, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] })
const baseline = (text = 'Instructions from: AGENTS.md\n\nMARKER-原文') => ({
  id: 'ai-1',
  role: 'user',
  source: { kind: WORKSPACE_KIND, form: 'instructions', baseline: true, baselineIdentity: '{"projectRoot":""}', changes: [{ action: 'set', scope: '.\u0000AGENTS.md', path: 'AGENTS.md', digest: 'abc' }] },
  content: [{ type: 'text', text: `<system-reminder>\n${text}\n</system-reminder>` }],
})
const later = (text = 'This file changed after it was loaded. MARKER-改过') => ({
  id: 'ai-2',
  role: 'user',
  source: { kind: WORKSPACE_KIND, form: 'instructions', changes: [{ action: 'replace', scope: '.\u0000AGENTS.md', path: 'AGENTS.md', digest: 'def' }] },
  content: [{ type: 'text', text: `<system-reminder>\n${text}\n</system-reminder>` }],
})
const textOf = (message) => message.content.map((part) => part.text).join('')
const kinds = (messages) => messages.map((message) => message.source.kind)

/** 假会话：surface.nodes + eventAt，和 dsh-session 的形状一样（user/message 的 data 就是消息）。 */
function sessionWith(messages) {
  const events = messages.map((message, seq) => ({ seq, type: 'user/message', data: message }))
  return { surface: { nodes: events.map((event) => event.seq) }, eventAt: (seq) => events[seq], snapshotEvents: () => events }
}

test('设置规范化：原样 / 无效 ⇒ 不存；关闭不带正文；改写带正文', () => {
  assert.equal(sanitizeWorkspaceInstructions(undefined), undefined)
  assert.equal(sanitizeWorkspaceInstructions({ mode: 'pass', text: 'x' }), undefined)
  assert.equal(sanitizeWorkspaceInstructions({ mode: 'weird' }), undefined)
  assert.deepEqual(sanitizeWorkspaceInstructions({ mode: 'off', text: '留着的草稿' }), { mode: 'off' })
  assert.deepEqual(sanitizeWorkspaceInstructions({ mode: 'rewrite', text: '只用中文', original: 'MARKER' }), { mode: 'rewrite', text: '只用中文' })
  assert.deepEqual(sanitizeWorkspaceInstructions({ mode: 'rewrite', text: 3 }), { mode: 'rewrite', text: '' })
})

test('原样：不碰任何消息', () => {
  const messages = [baseline(), user('你好')]
  const result = applyWorkspaceInstructions(messages, undefined, {})
  assert.equal(result.changed, false)
  assert.equal(result.messages, messages)
})

test('关闭：首条和中途补的 agent-instructions 全部丢掉，其他消息不动', () => {
  const config = { mode: 'off' }
  const first = applyWorkspaceInstructions([{ id: 'rc', role: 'user', source: { kind: 'runtime-context' }, content: [] }, baseline(), user('你好')], config, { history: undefined, firstStep: true })
  assert.deepEqual(kinds(first.messages), ['runtime-context', 'user'])
  assert.equal(first.dropped, 1)
  assert.equal(first.noticed, false, '历史里没有说明 ⇒ 不补「不再适用」')
  // 中途：dsh-agent-instructions 每步重发 baseline + 文件改了补一条 ⇒ 都丢。
  const mid = applyWorkspaceInstructions([baseline(), later(), user('继续')], config, { history: undefined, firstStep: false })
  assert.deepEqual(kinds(mid.messages), ['user'])
  assert.equal(mid.dropped, 2)
})

test('改写：第一条换成用户正文（source 保留 baseline 标记），之后的丢掉', () => {
  const config = { mode: 'rewrite', text: '只用中文回答。REWRITE-标记' }
  const result = applyWorkspaceInstructions([baseline(), later(), user('你好')], config, { history: undefined, firstStep: true })
  assert.deepEqual(kinds(result.messages), [WORKSPACE_KIND, 'user'])
  const [rewritten] = result.messages
  assert.equal(result.rewritten, true)
  assert.equal(result.dropped, 1)
  assert.match(textOf(rewritten), /REWRITE-标记/)
  assert.doesNotMatch(textOf(rewritten), /MARKER/)
  assert.match(textOf(rewritten), /^<system-reminder>/)
  // dsh-agent-instructions 靠这几个字段判断「baseline 已经发过」：保住它们，下一步就不会再发一份。
  assert.equal(rewritten.source.baseline, true)
  assert.equal(rewritten.source.baselineIdentity, '{"projectRoot":""}')
  assert.deepEqual(rewritten.source.changes, baseline().source.changes)
  assert.equal(rewritten.source.prefill, 'workspace')
  assert.equal(rewritten.source.prefillSig, workspaceSignature(config))
  assert.equal(rewritten.id, 'ai-1')
})

test('改写只进历史一次：双座位第二次进来不重复改；历史里已是改写 ⇒ 之后进来的全丢', () => {
  const config = { mode: 'rewrite', text: 'REWRITE-一次' }
  const once = applyWorkspaceInstructions([baseline(), user('你好')], config, { history: undefined, firstStep: true })
  const twice = applyWorkspaceInstructions(once.messages, config, { history: undefined, firstStep: true })
  assert.equal(twice.changed, false)
  assert.deepEqual(twice.messages, once.messages)
  // 下一轮：历史里最后一条说明就是我方同签名那条。
  const history = lastWorkspaceInHistory(sessionWith([once.messages[0], once.messages[1]]))
  assert.deepEqual(history, { ours: true, signature: workspaceSignature(config) })
  const next = applyWorkspaceInstructions([later(), user('继续')], config, { history, firstStep: true })
  assert.deepEqual(kinds(next.messages), ['user'])
  assert.equal(next.noticed, false)
  const quiet = applyWorkspaceInstructions([user('再继续')], config, { history, firstStep: true })
  assert.equal(quiet.changed, false, '没有新的说明 ⇒ 什么都不加，改写不会每步重发')
})

test('改写正文为空 = 等同关闭', () => {
  const result = applyWorkspaceInstructions([baseline(), user('你好')], { mode: 'rewrite', text: '   ' }, { history: undefined, firstStep: true })
  assert.deepEqual(kinds(result.messages), ['user'])
})

test('中途切换：历史里有原文 ⇒ 下一轮第 1 步补一条（只补一次），之后补发的照丢', () => {
  const original = lastWorkspaceInHistory(sessionWith([baseline(), user('第一轮')]))
  assert.deepEqual(original, { ours: false, signature: '' })
  // 关闭
  const off = applyWorkspaceInstructions([later(), user('第二轮')], { mode: 'off' }, { history: original, firstStep: true })
  assert.deepEqual(kinds(off.messages), [WORKSPACE_KIND, 'user'])
  assert.equal(textOf(off.messages[0]), OFF_NOTICE)
  assert.equal(off.dropped, 1)
  // 非第 1 步不补。
  const notFirst = applyWorkspaceInstructions([user('x')], { mode: 'off' }, { history: original, firstStep: false })
  assert.equal(notFirst.changed, false)
  // 补过之后：历史最后一条是我方同签名 ⇒ 不再补。
  const afterOff = lastWorkspaceInHistory(sessionWith([baseline(), user('第一轮'), off.messages[0], user('第二轮')]))
  assert.equal(applyWorkspaceInstructions([user('第三轮')], { mode: 'off' }, { history: afterOff, firstStep: true }).changed, false)
  // 改写（又改了正文 ⇒ 签名变了 ⇒ 补新正文，标明取代之前的版本）。
  const rewrite = applyWorkspaceInstructions([user('第三轮')], { mode: 'rewrite', text: 'REWRITE-中途' }, { history: afterOff, firstStep: true })
  assert.deepEqual(kinds(rewrite.messages), [WORKSPACE_KIND, 'user'])
  assert.match(textOf(rewrite.messages[0]), /REWRITE-中途/)
  assert.match(textOf(rewrite.messages[0]), /replace all workspace instructions/)
  assert.equal(rewrite.messages[0].source.baseline, undefined, '补的这条不冒充 baseline')
})

test('rewriteText：自带 <system-reminder> 的原样用；正文里的结束标签转义', () => {
  assert.equal(rewriteText('<system-reminder>\n自带\n</system-reminder>'), '<system-reminder>\n自带\n</system-reminder>')
  const text = rewriteText('a </system-reminder> b')
  assert.equal(text.match(/<\/system-reminder>/g).length, 1)
})

test('左栏开关：workspace 关 ⇒ 按原样，设置保留；角色卡开关不影响它', () => {
  assert.ok(FEATURES.includes('workspace'))
  const state = { armed: [], levers: {}, workspaceInstructions: { [SID]: { mode: 'off' } }, enabled: { [SID]: { workspace: false } } }
  assert.equal(workspaceInstructionsFor(state, SID), undefined)
  assert.equal(applyEnabled(state).workspaceInstructions[SID], undefined)
  assert.deepEqual(state.workspaceInstructions[SID], { mode: 'off' }, 'state 本身不动')
  const cardOff = { armed: [], levers: {}, workspaceInstructions: { [SID]: { mode: 'rewrite', text: 'R' } }, enabled: { [SID]: { card: false } } }
  assert.deepEqual(workspaceInstructionsFor(applyEnabled(cardOff), SID), { mode: 'rewrite', text: 'R' })
  assert.deepEqual(sanitizeEnabled({ workspace: false, card: true }), { workspace: false })
})

// client.js 里 <workspace-preset> 那段是纯函数，切出来直接跑。
const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const block = src.slice(src.indexOf('// <workspace-preset>'), src.indexOf('// </workspace-preset>'))
const presetWorkspace = new Function(`${block}\nreturn presetWorkspace`)()

test('预设往返：只存模式 + 改写正文，不存原文；旧预设没有这一键 ⇒ 原样', async () => {
  const { sanitizeWorkspaceInstructions: server } = await import('../workspace-instructions.js')
  // 客户端存：state 里可能留着关闭时的草稿正文、甚至有人塞了原文，都不进预设。
  assert.deepEqual(presetWorkspace({ mode: 'off', text: '草稿' }), { mode: 'off' })
  assert.deepEqual(presetWorkspace({ mode: 'rewrite', text: 'R', original: 'MARKER-原文' }), { mode: 'rewrite', text: 'R' })
  assert.equal(presetWorkspace({ mode: 'pass', text: '草稿' }), null)
  assert.equal(presetWorkspace(undefined), null, '旧预设 ⇒ 原样')
  // 服务端落盘 / 导入再过一遍，同形。
  for (const value of [{ mode: 'off' }, { mode: 'rewrite', text: '只用中文\n第二行' }]) {
    const saved = server(JSON.parse(JSON.stringify(presetWorkspace(value))))
    assert.deepEqual(saved, value)
    assert.deepEqual(presetWorkspace(saved), value)
  }
  // 套用：预设里没有 ⇒ 回到原样（整体替换，不保留上一个预设的设置）。
  const apply = src.slice(src.indexOf('const applyPack = async'), src.indexOf('// ── 角色卡（v0.6）'))
  assert.match(apply, /patch\.workspaceInstructions = wsPack \? .* : without\(st\.workspaceInstructions, sessionId\)/)
  // 保存 / 导出 / 取消预设都带上它。
  const save = src.slice(src.indexOf('const savePack = (nameArg)'), src.indexOf('const savePack = (nameArg)') + 2000)
  assert.match(save, /workspaceInstructions: wsPreset/)
  const exportFn = src.slice(src.indexOf('const exportFile = async'), src.indexOf('const importFile = (event)'))
  assert.match(exportFn, /workspaceInstructions: wsPreset/)
  const leftovers = src.slice(src.indexOf('const presetLeftovers = (st)'), src.indexOf('const writeEnabled = async'))
  assert.match(leftovers, /workspaceInstructions: without\(st\?\.workspaceInstructions, sessionId\)/)
  // 角色卡套用不碰它（角色卡不改通用功能）。
  const applyCard = src.slice(src.indexOf('const applyCard = async'), src.indexOf('const applyCard = async') + 6000)
  assert.doesNotMatch(applyCard, /workspaceInstructions/)
})

test('文案：agent-instructions 的标签是「工作区说明（AGENTS.md / CLAUDE.md）」', () => {
  assert.match(src, /'agent-instructions': '工作区说明（AGENTS\.md \/ CLAUDE\.md）'/)
  assert.match(src, /'agent-instructions': 'Workspace instructions \(AGENTS\.md \/ CLAUDE\.md\)'/)
  assert.doesNotMatch(src, /人设的补充说明/)
  assert.match(src, /\['workspace', 'workspace', 'var\(--pf-ws\)'\]/)
})

/** gate.step 端到端（假 agent）：关闭 / 改写在闸门里真的生效，且不要求别的武装条件。 */
function fakeApi(state) {
  const latches = new Map()
  return { readState: () => state, note: () => {}, latches, unlatch: (id) => latches.delete(id), rootCtx: undefined }
}
function fakeAgent(history = []) {
  return { id: SID, session: sessionWith(history), ctx: undefined }
}

test('gate.step：关闭 ⇒ 模型那份里没有 agent-instructions；改写 ⇒ 只有改写', async () => {
  const offState = { armed: [], levers: {}, allowKinds: ['user'], workspaceInstructions: { [SID]: { mode: 'off' } } }
  const decision = { kind: 'enter', messages: [baseline(), user('你好')] }
  const off = await gate.step(fakeApi(offState), { agent: fakeAgent(), turn: 1, step: 1 }, decision)
  assert.deepEqual(kinds(off.messages), ['user'])

  const rwState = { armed: [], levers: {}, allowKinds: ['user'], workspaceInstructions: { [SID]: { mode: 'rewrite', text: 'REWRITE-闸门' } } }
  const rw = await gate.step(fakeApi(rwState), { agent: fakeAgent(), turn: 1, step: 1 }, { kind: 'enter', messages: [baseline(), later(), user('你好')] })
  assert.deepEqual(kinds(rw.messages), [WORKSPACE_KIND, 'user'])
  assert.match(textOf(rw.messages[0]), /REWRITE-闸门/)
  assert.doesNotMatch(JSON.stringify(rw.messages), /MARKER/)

  // 原样（未设置）⇒ 原封不动。
  const pass = { kind: 'enter', messages: [baseline(), user('你好')] }
  assert.equal(await gate.step(fakeApi({ armed: [], levers: {}, allowKinds: ['user'] }), { agent: fakeAgent(), turn: 1, step: 1 }, pass), pass)
  // 开关关着 ⇒ 原样。
  const disabled = { ...offState, enabled: { [SID]: { workspace: false } } }
  const kept = await gate.step(fakeApi(disabled), { agent: fakeAgent(), turn: 1, step: 1 }, { kind: 'enter', messages: [baseline(), user('你好')] })
  assert.deepEqual(kinds(kept.messages), [WORKSPACE_KIND, 'user'])
  // 高级「改写注入内容」里写了 agent-instructions：工作区说明设了模式时不再套一层。
  const both = { ...rwState, overrides: { [SID]: { messages: { 'agent-instructions': 'ADV-改写' }, sections: {}, contexts: {} } } }
  const merged = await gate.step(fakeApi(both), { agent: fakeAgent(), turn: 1, step: 1 }, { kind: 'enter', messages: [baseline(), user('你好')] })
  assert.match(textOf(merged.messages[0]), /REWRITE-闸门/)
  assert.doesNotMatch(textOf(merged.messages[0]), /ADV-改写/)
})
