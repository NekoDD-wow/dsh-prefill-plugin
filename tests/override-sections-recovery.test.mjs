// 回归（v0.21.14 审查 #87）：F22 的段兜底按 **name** 判断在不在，不按正文前 40 字：
// 同名段正文被改时要替换（追加会出现两版人格）；两条改写前 40 字相同也不能当成「已在」。
import test from 'node:test'
import assert from 'node:assert/strict'
import { ensureOverrideSections } from '../gate.js'

const off = { probeSection: false, probeContext: false, blockSections: false, blockContexts: false, blockTools: false, blockMessages: false }
const stateFor = (sections) => ({
  armed: ['s1'],
  levers: { ...off },
  gate: {},
  enabled: {},
  sandbox: {},
  overrides: { s1: { messages: {}, sections, contexts: {} } },
  everyTurn: {},
  tools: [],
})
const apiFor = (state, notes) => ({ readState: () => state, note: (note) => notes.push(note), rootCtx: undefined })
const assemblyWith = (sections) => ({ sections, contexts: [], tools: [] })

test('缺段：按 name 补一条，其余段不动', () => {
  const notes = []
  const assembly = assemblyWith([{ name: 'dsh:tone', order: 10, text: '官方语气' }])
  const out = ensureOverrideSections(apiFor(stateFor({ 'prefill:persona': '你是测试人格。' }), notes), 's1', assembly)
  assert.equal(out.sections.length, 2)
  assert.deepEqual(out.sections.map((section) => section.name), ['dsh:tone', 'prefill:persona'])
  assert.equal(notes.find((note) => note.override_recovered)?.added?.join(','), 'prefill:persona')
})

test('同名段正文被轮内改掉：替换那一份，不追加第二个同名段', () => {
  const notes = []
  const assembly = assemblyWith([{ name: 'prefill:persona', order: 10, text: '旧的人格正文（上一轮挂的）' }])
  const out = ensureOverrideSections(apiFor(stateFor({ 'prefill:persona': '新的人格正文（这一轮改的）' }), notes), 's1', assembly)
  assert.equal(out.sections.length, 1, '同名段只能有一份（追加会出现两版人格）')
  assert.equal(out.sections[0].text, '新的人格正文（这一轮改的）')
  assert.equal(out.sections[0].order, 10, '替换时保留原 order')
  assert.equal(notes.find((note) => note.override_recovered)?.replaced?.join(','), 'prefill:persona')
})

test('正文一致（只差空白）：不动，也不记审计', () => {
  const notes = []
  const assembly = assemblyWith([{ name: 'prefill:persona', order: 10, text: '你是  测试人格。' }])
  const same = ensureOverrideSections(apiFor(stateFor({ 'prefill:persona': '你是 测试人格。' }), notes), 's1', assembly)
  assert.equal(same, assembly, '一致时应原样返回（不产生新对象）')
  assert.equal(notes.length, 0)
})

test('两条改写前 40 字相同、name 不同：按 name 判断，两条都要在', () => {
  const notes = []
  const prefix = '这是一段很长的人格正文，前四十个字完全一样，用来验证以前按前缀比对的误判。'
  const assembly = assemblyWith([{ name: 'prefill:a', order: 10, text: prefix + ' A 版本' }])
  const out = ensureOverrideSections(apiFor(stateFor({ 'prefill:a': prefix + ' A 版本', 'prefill:b': prefix + ' B 版本' }), notes), 's1', assembly)
  assert.deepEqual(out.sections.map((section) => section.name), ['prefill:a', 'prefill:b'])
  assert.equal(out.sections[1].text, prefix + ' B 版本')
})
