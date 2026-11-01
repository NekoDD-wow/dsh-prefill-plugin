// 世界书常驻条目（constant）的数据标记 + 面板区分（颜色 / 名字）。
// 行为要求：常驻内容仍在系统提示里（compileCard 的 systemText），面板能看到一条带 constant 标记的记录，
// 但它永远不参与关键词匹配（matchLore 跳过），预设存 / 套用后标记不丢。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compileLore, matchLore } from '../character-cards.js'
import { sanitizeLore, sanitizeUi } from '../impl.js'

const card = {
  data: {
    character_book: {
      entries: [
        { id: 1, comment: '核心档案', content: '她是校田径队的学姐。', constant: true },
        { id: 2, comment: '腿伤', keys: ['腿', '拉伤'], content: '腘绳肌拉伤，不能剧烈跑。' },
      ],
    },
  },
}

test('数据标记：常驻条目也进 entries，带 constant 标记、没有关键词', () => {
  const lore = compileLore(card, { char: '学姐', user: '我' })
  const constant = lore.entries.find((entry) => entry.constant === true)
  assert.ok(constant, '常驻条目没进表')
  assert.equal(constant.title, '核心档案')
  assert.equal(constant.keys.length, 0)
  assert.equal(constant.probability, 100)
  assert.equal(lore.entries.filter((entry) => entry.constant !== true).length, 1)
  // 常驻内容仍然只走系统提示那段（不进关键词渲染）。
  assert.equal(lore.entries.find((entry) => entry.constant === true).secondary.length, 0)
})

test('匹配：常驻条目永不命中（内容已在系统提示里，不再按关键词二次注入）', () => {
  const lore = compileLore(card, { char: '学姐', user: '我' })
  const hits = matchLore(lore, ['核心档案 学姐 腿也疼'])
  assert.deepEqual(hits.map((entry) => entry.title), ['腿伤'])
  assert.ok(hits.every((entry) => entry.constant !== true))
})

test('预设往返：sanitizeLore 保留 constant 标记；旧预设没有标记照旧', () => {
  const lore = compileLore(card, { char: '学姐', user: '我' })
  const saved = sanitizeLore({ ...lore, char: '学姐' })
  assert.deepEqual(saved.entries.filter((entry) => entry.constant === true).map((entry) => entry.title), ['核心档案'])
  const old = sanitizeLore({ entries: [{ id: 9, title: '旧条目', keys: ['x'], content: 'y' }] })
  assert.equal(old.entries[0].constant, undefined)
})

// 面板：常驻条目换颜色（var(--pf-system)，和系统提示同色）+ 「常驻」名标；meta 只数关键词条目。
test('面板：常驻条目用系统提示色 + 「常驻」标，meta 只数关键词条目', () => {
  const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  const loreCard = src.slice(src.indexOf('      const loreCard = (entry, index) => {'), src.indexOf('      const loreSection = h('))
  assert.match(loreCard, /const constant = entry\.constant === true/)
  assert.match(loreCard, /'var\(--pf-system\)' : 'var\(--pf-lore\)'/)
  assert.match(loreCard, /data-prefill-lore-constant-badge/)
  assert.match(loreCard, /t\('loreConstant'\)/)
  assert.match(loreCard, /t\('loreConstantNote'\)/)
  const meta = src.slice(src.indexOf('          meta: loreEntries.some'), src.indexOf("          off: !isOn('lore')"))
  assert.ok(meta.length > 0, '找不到 lore 的 meta 段')
  assert.match(meta, /filter\(\(entry\) => entry\?\.constant !== true\)/)
  // 文案两份（zh / en）都在
  assert.match(src, /loreConstant: '常驻'/)
  assert.match(src, /loreConstant: 'Constant'/)
})

// ── 常驻条目改动 → 重拼系统提示（改之前给一次提示，可勾「不再提示」）──────────
const src2 = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const cut2 = (from, to) => {
  const a = src2.indexOf(from)
  const b = src2.indexOf(to, a)
  return a >= 0 && b > a ? src2.slice(a, b) : ""
}
const spliceHelpers = (() => {
  const region = cut2('      /** 常驻条目 → 系统提示里「## 常驻设定」段的文本', '      /** 常驻条目集合的指纹')
  return new Function(region + '\nreturn { constantLoreBlock, spliceConstantLore }')()
})()

test('重拼：把「## 常驻设定」段换成当前常驻条目，段前正文 / 段后各段都不动', () => {
  const text = '# 角色扮演：学姐\n\n## 角色设定\n设定正文\n\n## 常驻设定\n【旧】旧内容\n\n## 示例对话\n示例'
  const entries = [
    { id: 2, title: '腿伤', keys: ['腿'], content: '关键词条目（不该进这段）' },
    { id: 1, title: '核心档案', constant: true, content: '新内容' },
  ]
  const block = spliceHelpers.constantLoreBlock(entries)
  assert.equal(block, '## 常驻设定\n【核心档案】新内容')
  const next = spliceHelpers.spliceConstantLore(text, block)
  assert.match(next, /## 常驻设定\n【核心档案】新内容\n\n## 示例对话/)
  assert.match(next, /## 角色设定\n设定正文/)
  assert.doesNotMatch(next, /旧内容/)
  assert.doesNotMatch(next, /关键词条目/)
})

test('重拼：常驻删光 ⇒ 整段拿掉；原来没有这段 ⇒ 追加末尾；正文为空 ⇒ 不动', () => {
  const text = '## 角色设定\n设定\n\n## 常驻设定\n【旧】旧\n\n## 示例对话\n示例'
  assert.equal(spliceHelpers.spliceConstantLore(text, ''), '## 角色设定\n设定\n\n## 示例对话\n示例')
  assert.equal(spliceHelpers.spliceConstantLore('只有正文', '## 常驻设定\n【新】x'), '只有正文\n\n## 常驻设定\n【新】x')
  assert.equal(spliceHelpers.spliceConstantLore('', '## 常驻设定\n【新】x'), '')
})

test('确认闸门：常驻改动先弹提示，确认后落盘 + 重拼系统提示（overrides.sections）', () => {
  const editLore = cut2("      const editLore = (nextEntries, confirmed = false) => {", "      const patchLoreEntry =")
  assert.match(editLore, /constantLorePrint\(nextEntries\) !== constantLorePrint\(loreEntries\)/)
  assert.match(editLore, /state\?\.ui\?\.loreConstWarn !== true/)
  assert.match(editLore, /setLoreConstPending\(\{ entries: nextEntries \}\)/)
  assert.match(editLore, /if \(splice\) await applyConstantLore\(nextEntries\)/)
  const apply = cut2("      const applyConstantLore = async (entries) => {", "      /** 「不再提示」")
  assert.match(apply, /spliceConstantLore\(before, constantLoreBlock\(entries\)\)/)
  assert.match(apply, /sections: \{ \.\.\.sections, \[PERSONA_SECTION\]: next \}/)
})

test('提示条：文案 + 不再提示勾选 + 重拼 / 取消；勾了不再提示写 state.ui.loreConstWarn', () => {
  const at = src2.indexOf("'data-prefill-lore-const-warn': ''")
  assert.ok(at > 0, "找不到确认条")
  const region = src2.slice(at - 300, at + 1800)
  assert.match(region, /data-prefill-lore-const-noask/)
  assert.match(region, /data-prefill-lore-const-ok/)
  assert.match(region, /data-prefill-lore-const-cancel/)
  assert.match(region, /rememberLoreConstWarn\(\)/)
  assert.match(region, /editLore\(pending\.entries, true\)/)
  const remember = cut2("      const rememberLoreConstWarn = async () => {", "      const editLore = (nextEntries")
  assert.match(remember, /ui: \{ \.\.\.ui, loreConstWarn: true \}/)
  // 全局偏好：sanitizeUi 认得这个键（脏值丢掉）
  assert.deepEqual(sanitizeUi({ motion: 'lite', loreConstWarn: true }), { motion: 'lite', loreConstWarn: true })
  assert.deepEqual(sanitizeUi({ loreConstWarn: 'yes' }), undefined)
})
