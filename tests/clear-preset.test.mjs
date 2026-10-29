// 0.13.1：「取消预设」连开场对话草稿一起清空，并且几秒内可以撤销（放回取消前的全部）。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const withoutSrc = src.slice(src.indexOf('    function without(map, sessionId) {'), src.indexOf('// <preset-undo>'))
const undoSrc = src.slice(src.indexOf('// <preset-undo>'), src.indexOf('// </preset-undo>'))
// eslint-disable-next-line no-new-func
const H = new Function(`${withoutSrc}\n${undoSrc}\nreturn { without, PRESET_KEYS, presetSnapshot, presetRestorePatch }`)()
const clearSrc = src.slice(src.indexOf('const clearPreset = async () => {'), src.indexOf('/** 按引用现编译一张卡'))
// 0.14 起取消预设 = 套一个空预设，走唯一的写入路径 applyLayered → presetPatch。
const applySrc = src.slice(src.indexOf('const applyLayered = async'), src.indexOf('const applyBuiltin = async'))
const patchSrc = src.slice(src.indexOf('    function presetPatch('), src.indexOf('    function cardDiff('))

const SID = 's1'
const OTHER = 's2'
const state = () => ({
  activePreset: { [SID]: 'card:seraphina', [OTHER]: 'pack:别人' },
  overrides: { [SID]: { messages: {}, sections: { 'prefill:persona': '你是塞拉菲娜。' }, contexts: {} }, [OTHER]: { messages: {}, sections: { 'prefill:persona': 'x' }, contexts: {} } },
  gate: { [SID]: 'pure', [OTHER]: 'pass' },
  sessionTools: { [SID]: ['read'] },
  cardRef: { [SID]: { id: 'seraphina', opts: { mode: 'pure' } } },
  lore: { [SID]: { enabled: true, entries: [{ keys: ['森林'], content: '林地' }] } },
  memory: { [SID]: { enabled: true, every: 8 } },
  everyTurn: { [SID]: { enabled: true, text: '提醒' }, '*': { enabled: true, text: '默认' } },
  enabled: { [SID]: { lore: false } },
  workspaceInstructions: { [SID]: { mode: 'off' } },
  armed: [SID, OTHER],
})
const items = [{ role: 'user', text: '你好' }, { role: 'assistant', text: '*塞拉菲娜看着你*', reasoning: '' }]

test('取消预设：清开场对话草稿（会话已开跑时只清草稿，不碰历史）', () => {
  assert.match(clearSrc, /await applyLayered\(\{ clearItems: true \}\)/, '取消 = 套空预设（同一条写入路径；开跑后也照旧清草稿，issue #19 B）')
  assert.match(applySrc, /setItems\(resolved\.items\)/, '开场对话列表整体替换（空预设 = 清空）')
  assert.match(applySrc, /postJson\(DRAFT_ROUTE, \{ sessionId, items: resolved\.items \}\)/, '草稿落盘')
  // 不注入、不改会话历史：只走草稿路由和 state 路由。
  assert.doesNotMatch(applySrc + clearSrc.slice(0, clearSrc.indexOf('const undoClearPreset')), /INJECT_ROUTE|op: 'inject'|oneClickInject/)
  // 快照覆盖写入路径写的每一张按会话的表。
  for (const key of [...patchSrc.matchAll(/^\s+(\w+): put\(st\?\.\w+,/gm)].map((m) => m[1])) {
    assert.ok(H.PRESET_KEYS.includes(key), `快照漏了 ${key}`)
  }
  for (const key of ['overrides', 'gate', 'sessionTools', 'activePreset', 'slotSource']) assert.ok(H.PRESET_KEYS.includes(key))
})

test('撤销：取消前的系统提示 / 残留 / 开场对话全部放回，别的会话不动', () => {
  const before = state()
  const snap = H.presetSnapshot(before, SID, items, items)
  assert.deepEqual(snap.items, items)
  assert.deepEqual(snap.pending, items)
  assert.equal(snap.armed, true)
  // 模拟取消后的 state（clearPreset 的结果），期间别的会话又变了。
  const cleared = state()
  for (const key of H.PRESET_KEYS) cleared[key] = H.without(cleared[key], SID)
  cleared.gate[SID] = 'pass'
  cleared.armed = [OTHER]
  cleared.activePreset[OTHER] = 'pack:又换了'
  const patch = H.presetRestorePatch(cleared, SID, snap)
  for (const key of H.PRESET_KEYS) assert.deepEqual(patch[key][SID], before[key]?.[SID], `${key} 放回`)
  assert.equal(patch.activePreset[OTHER], 'pack:又换了', '别的会话保持最新')
  assert.deepEqual(patch.everyTurn['*'], before.everyTurn['*'], '新会话默认不动')
  assert.deepEqual(patch.armed.sort(), [OTHER, SID].sort())
  // 快照是副本：之后改 state 不影响撤销。
  before.cardRef[SID].opts.mode = 'agent'
  items[0].text = '改了'
  assert.equal(snap.maps.cardRef.opts.mode, 'pure')
  assert.equal(snap.items[0].text, '你好')
})

test('撤销：取消前本来没有的一格，撤销后也是没有', () => {
  const st = { activePreset: { [SID]: 'builtin:zh' }, gate: { [SID]: 'pass' } }
  const snap = H.presetSnapshot(st, SID, [])
  const patch = H.presetRestorePatch({ cardRef: { [SID]: { id: 'x' } }, armed: [SID] }, SID, snap)
  assert.equal(SID in patch.cardRef, false)
  assert.equal(SID in patch.lore, false)
  assert.deepEqual(patch.armed, [])
  assert.equal(patch.activePreset[SID], 'builtin:zh')
})

test('面板：取消后出现撤销条，撤销同时放回草稿', () => {
  assert.match(src, /'data-prefill-preset-undo-bar': ''/)
  assert.match(src, /'data-prefill-preset-undo': '', onClick: \(\) => void undoClearPreset\(\)/)
  const undo = src.slice(src.indexOf('const undoClearPreset = async () => {'), src.indexOf('/** 按引用现编译一张卡'))
  assert.match(undo, /presetRestorePatch\(fresh\?\.state, sessionId, snap\)/)
  // 只把 host 上本来还没发出的草稿放回去；已经写进历史的（pending = null）不能再登记成草稿。
  assert.match(undo, /if \(snap\.pending !== null\) await postJson\(DRAFT_ROUTE, \{ sessionId, items: snap\.pending \}\)/)
  assert.doesNotMatch(undo, /items: snap\.items \}/)
  assert.equal(H.presetSnapshot({}, SID, items, null).pending, null)
  assert.deepEqual(H.presetSnapshot({}, SID, items, null).items, items, '列表照样放回显示')
  assert.match(clearSrc, /setPresetUndo\(snap\)/)
})
