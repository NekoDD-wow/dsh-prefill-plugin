// v0.10：左栏启用开关 —— 关掉 = 停用但保留内容；缺键 = 开；跟着预设存取。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { FEATURES, applyEnabled, everyTurnFingerprint, fingerprint, isEnabled, sanitizeEnabled, toolsFingerprint } from '../enabled.js'
import { everyTurnFor, loreFor, memoryFor } from '../gate.js'

const SID = 'session-a'
const persona = '你是宋知夏。'
const base = () => ({
  armed: [],
  levers: {},
  gate: { [SID]: 'pure' },
  overrides: {
    [SID]: { messages: { 'runtime-context': '改写后的上下文' }, sections: { 'prefill:persona': persona, 'harness:identity': '改写身份段' }, contexts: { 'x:ctx': '改写' } },
    '*': { messages: {}, sections: { 'prefill:persona': '通配' }, contexts: {} },
  },
  everyTurn: { [SID]: { enabled: true, text: '【提醒】用中文思考', firstText: '' }, '*': { enabled: true, text: '默认提醒' } },
  lore: { [SID]: { enabled: true, scanDepth: 4, budget: 800, entries: [{ id: 1, keys: ['田径'], content: '校田径队' }] } },
  memory: { [SID]: { enabled: true, every: 8 } },
  injects: { [SID]: [{ role: 'user', text: '注入' }] },
  sessionTools: { [SID]: [] },
  cardRef: { [SID]: { id: 'songzhixia', opts: {}, applied: { system: fingerprint(persona), everyTurn: everyTurnFingerprint({ text: '【提醒】用中文思考', firstText: '' }), tools: '' } } },
})

test('默认全开：没有 enabled / 空表 / 全 true 都不改状态', () => {
  const state = base()
  assert.equal(applyEnabled(state), state)
  const withEmpty = { ...base(), enabled: { [SID]: {} } }
  assert.deepEqual(applyEnabled(withEmpty).overrides, withEmpty.overrides)
  const allTrue = { ...base(), enabled: { [SID]: Object.fromEntries(FEATURES.map((key) => [key, true])) } }
  assert.deepEqual(applyEnabled(allTrue).lore, allTrue.lore)
  for (const key of FEATURES) assert.equal(isEnabled(allTrue, SID, key), true)
  assert.equal(isEnabled({}, SID, 'system'), true)
})

test('每项关掉：闸门看到的视图里不注入，state 里的内容原样保留', () => {
  const state = { ...base(), enabled: { [SID]: { system: false, inject: false, everyTurn: false, lore: false, memory: false, items: false } } }
  const before = JSON.stringify(state)
  const view = applyEnabled(state)
  // 系统提示：persona 段不发、接管退回 pass、接管清零的工具恢复；不回落到通配格
  assert.deepEqual(view.overrides[SID], { messages: {}, sections: {}, contexts: {} })
  assert.equal(view.gate[SID], 'pass')
  assert.equal(view.sessionTools[SID], undefined)
  // 每轮注入：显式关，不回落到「新会话默认」
  assert.equal(everyTurnFor(view, SID), undefined)
  assert.notEqual(everyTurnFor(view, 'session-other'), undefined)
  assert.equal(loreFor(view, SID), undefined)
  assert.equal(memoryFor(view, SID), undefined)
  assert.equal(view.injects[SID], undefined)
  // 原状态一个字没动：重新打开就是原样
  assert.equal(JSON.stringify(state), before)
  assert.equal(state.overrides[SID].sections['prefill:persona'], persona)
  const reopened = { ...state, enabled: {} }
  assert.equal(applyEnabled(reopened).overrides[SID].sections['prefill:persona'], persona)
  assert.notEqual(everyTurnFor(applyEnabled(reopened), SID), undefined)
})

test('只关系统提示：改写注入照旧；只关改写注入：persona 照旧', () => {
  const sysOff = applyEnabled({ ...base(), enabled: { [SID]: { system: false } } })
  assert.equal(sysOff.overrides[SID].sections['prefill:persona'], undefined)
  assert.equal(sysOff.overrides[SID].sections['harness:identity'], '改写身份段')
  assert.equal(sysOff.overrides[SID].messages['runtime-context'], '改写后的上下文')
  const injOff = applyEnabled({ ...base(), enabled: { [SID]: { inject: false } } })
  assert.deepEqual(injOff.overrides[SID], { messages: {}, sections: { 'prefill:persona': persona }, contexts: {} })
  assert.equal(injOff.gate[SID], 'pure')
})

test('角色卡关：世界书 / 记忆停用；仍是套卡原样的系统提示 / 每轮注入停用，改过的不受影响', () => {
  const view = applyEnabled({ ...base(), enabled: { [SID]: { card: false } } })
  assert.equal(loreFor(view, SID), undefined)
  assert.equal(memoryFor(view, SID), undefined)
  assert.equal(view.overrides[SID].sections['prefill:persona'], undefined)
  assert.equal(view.overrides[SID].sections['harness:identity'], '改写身份段')
  assert.equal(view.gate[SID], 'pass')
  assert.equal(everyTurnFor(view, SID), undefined)
  // 用户改过系统提示 / 每轮注入 ⇒ 是自己的，不跟角色卡开关
  const edited = base()
  edited.overrides[SID].sections['prefill:persona'] = '我自己改过的提示'
  edited.everyTurn[SID].text = '我自己的提醒'
  edited.enabled = { [SID]: { card: false } }
  const v2 = applyEnabled(edited)
  assert.equal(v2.overrides[SID].sections['prefill:persona'], '我自己改过的提示')
  assert.equal(v2.gate[SID], 'pure')
  assert.notEqual(everyTurnFor(v2, SID), undefined)
  assert.equal(loreFor(v2, SID), undefined)
  // 卡片设的工具清单（agent 模式）也只在原样时停用
  const tools = base()
  tools.gate[SID] = 'pass'
  tools.sessionTools[SID] = ['read', 'grep']
  tools.cardRef[SID].applied.tools = toolsFingerprint(['read', 'grep'])
  tools.enabled = { [SID]: { card: false } }
  assert.equal(applyEnabled(tools).sessionTools[SID], undefined)
})

test('预设往返：只存关掉的项；套用时整体替换，缺 = 全开', () => {
  assert.equal(sanitizeEnabled(undefined), undefined)
  assert.equal(sanitizeEnabled({ card: true, lore: true }), undefined)
  assert.deepEqual(sanitizeEnabled({ memory: false, inject: false, junk: false, system: 'no' }), { memory: false, inject: false })
  // 保存：state.enabled[会话] → pack.enabled；套用：pack.enabled → state.enabled[新会话]（与 client applyPack 同一规则）
  const saved = sanitizeEnabled({ memory: false, inject: false })
  const apply = (st, sid, pack) => (pack.enabled ? { ...(st.enabled ?? {}), [sid]: pack.enabled } : Object.fromEntries(Object.entries(st.enabled ?? {}).filter(([key]) => key !== sid)))
  const B = 'session-b'
  const st = { ...base(), enabled: { [B]: { system: false } } }
  const afterApply = apply(st, B, { enabled: saved })
  assert.deepEqual(afterApply[B], { memory: false, inject: false })
  assert.equal(isEnabled({ enabled: afterApply }, B, 'system'), true)
  assert.deepEqual(apply({ enabled: afterApply }, B, {}), {})
  // impl.js：save / import 都经过 sanitizeEnabled；client：applyPack / presetLeftovers / savePack 都带上 enabled
  const impl = readFileSync(new URL('../impl.js', import.meta.url), 'utf8')
  assert.equal((impl.match(/enabled: sanitizeEnabled\(/g) ?? []).length, 2)
  const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  assert.match(client, /patch\.enabled = pack\.enabled/)
  assert.match(client, /enabled: without\(st\?\.enabled, sessionId\)/)
  assert.match(client, /op: 'save', name, items, overrides, tools, gate: gateMode, enabled: ownEnabled/)
})

test('client 与 enabled.js 用同一份指纹', () => {
  const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  const body = client.slice(client.indexOf('function fingerprint(text) {'), client.indexOf('const tint ='))
  // eslint-disable-next-line no-new-func
  const clientFp = new Function(`${body}; return fingerprint`)()
  for (const text of ['', persona, '【提醒】用中文思考\u0000', 'abc'.repeat(500)]) assert.equal(clientFp(text), fingerprint(text))
})
