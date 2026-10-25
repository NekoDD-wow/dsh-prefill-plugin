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
})

test('面板：挂在预设下的各项都在悬浮卡片里，保存不再有「连同每轮注入」开关', () => {
  const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  // v0.10 悬浮卡片：左栏每项对应右栏一节（世界书 / 故事记忆从角色卡拆出），预设下拉在头部。
  assert.match(src, /const sections = \{ cards: cardsSection, lore: loreSection, memory: memorySection, system: systemSection, workspace: workspaceSection, 'every-turn': everyTurnSection, items: itemsSection, inject: injectSection, usage: usageSection \}/)
  assert.match(src, /const presetsMenu = h\(/)
  assert.doesNotMatch(src, /packWithEveryTurn/)
  // 套用 = 整体替换：预设里没有的项恢复默认（不再 `if (pack.x !== undefined)` 才覆盖）。
  const apply = src.slice(src.indexOf('const applyPack = async'), src.indexOf('// ── 角色卡（v0.6）'))
  for (const key of ['cardRef', 'lore', 'memory', 'overrides', 'gate', 'sessionTools', 'everyTurn', 'enabled']) assert.match(apply, new RegExp(`patch\\.${key} =`), key)
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
