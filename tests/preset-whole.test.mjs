// 0.10：预设整体保存 / 套用 —— 角色卡只存引用。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { sanitizeCardRef } from '../impl.js'

test('sanitizeCardRef 只留 id 和已知选项', () => {
  assert.equal(sanitizeCardRef(null), undefined)
  assert.equal(sanitizeCardRef({ id: '  ' }), undefined)
  assert.deepEqual(sanitizeCardRef({ id: ' songzhixia ', opts: { thinkZh: true, firstPerson: 'yes', mode: 'pure', greeting: '2', tools: 'read,bash', junk: 1 } }), {
    id: 'songzhixia',
    opts: { thinkZh: true, mode: 'pure', greeting: 2, tools: 'read,bash' },
  })
  assert.deepEqual(sanitizeCardRef({ id: 'x', opts: { mode: 'chat' } }), { id: 'x', opts: {} })
  // 「不要开场白」= -1，存预设 / 导入时要原样保留；更小的值收成 -1。
  assert.deepEqual(sanitizeCardRef({ id: 'x', opts: { greeting: -1 } }), { id: 'x', opts: { greeting: -1 } })
  assert.deepEqual(sanitizeCardRef({ id: 'x', opts: { greeting: -5 } }), { id: 'x', opts: { greeting: -1 } })
})

test('面板：挂在预设下的各项都在悬浮卡片里，保存不再有「连同每轮注入」开关', () => {
  const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  // v0.10 悬浮卡片：左栏每项对应右栏一节（世界书 / 故事记忆从角色卡拆出），预设下拉在头部。
  assert.match(src, /const sections = \{ cards: cardsSection, lore: loreSection, memory: memorySection, system: systemSection, workspace: workspaceSection, 'every-turn': everyTurnSection, items: itemsSection, inject: injectSection, usage: usageSection \}/)
  assert.match(src, /const presetsMenu = h\(/)
  assert.doesNotMatch(src, /packWithEveryTurn/)
  // 套用 = 整体替换：预设里没有的项恢复默认（不再 `if (pack.x !== undefined)` 才覆盖）。
  // 0.14：内置 / 我的预设 / 角色卡 / 取消都走 applyLayered → presetPatch，每一格都写（没有 = 恢复默认）。
  const patchFn = src.slice(src.indexOf('    function presetPatch('), src.indexOf('    function cardDiff('))
  for (const key of ['cardRef', 'lore', 'memory', 'overrides', 'gate', 'sessionTools', 'everyTurn', 'enabled', 'workspaceInstructions', 'slotSource']) assert.match(patchFn, new RegExp(`\\b${key}: `), key)
  const apply = src.slice(src.indexOf('const applyPack = async'), src.indexOf('// ── 角色卡（v0.6）'))
  assert.match(apply, /applyLayered\(\{ card: got\?\.layer \?\? null, pack,/)
})

test('保存为预设 / 导出带上工作台 bench / benchTowers（#24）', () => {
  const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  const start = src.indexOf('      const everyTurnStored =')
  const end = src.indexOf('      // 约束承接', start)
  assert.ok(start > 0 && end > start, '找不到 everyTurnStored 段')
  const expr = src.slice(start + '      const everyTurnStored ='.length, end).trim()
  const build = new Function('ownEveryTurn', 'return (' + expr + ')')
  const bench = [{ key: 'k1', ref: 'zh', name: '中文思考', text: '提醒', checks: ['zh'] }]
  const benchTowers = { t1: { ref: 't1', name: '塔', collapsed: false } }
  const got = build({ text: '提醒', firstText: '', checks: ['zh'], mode: 'always', bench, benchTowers })
  assert.deepEqual(got.bench, bench)
  assert.deepEqual(got.benchTowers, benchTowers)
  // 没有工作台（旧数据）时不写这两个字段。
  const plain = build({ text: '提醒', firstText: '', checks: [], mode: 'always' })
  assert.equal('bench' in plain, false)
  assert.equal('benchTowers' in plain, false)
})

test('导出文件和「保存为预设」带同样的字段（角色卡 / 每轮注入 / 故事记忆摘要）', () => {
  const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  const from = src.indexOf('const exportFile = async')
  const to = src.indexOf('const importFile = (event)')
  assert.ok(from > 0 && to > from, '找不到 exportFile 段')
  const exportFn = src.slice(from, to)
  for (const key of ['currentCardRef()', 'everyTurnStored', 'memorySeed', '{ card }', 'enabled: ownEnabled']) {
    assert.ok(exportFn.includes(key), `exportFile 里缺 ${key}`)
  }
})
