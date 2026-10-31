// 角色卡编译单测：node --test tests/character-cards.test.mjs
// 素材是 samples/cards/ 下的真实社区卡（来源与许可见 samples/cards/README.md）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { cardFromPng, cardId, cardSummary, compileCard, embedCardInPng, expandMacros, matchLore, parseCard, pngTextChunks, renderLore, stripHtml } from '../character-cards.js'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'samples', 'cards')
const load = (file) => (file.endsWith('.png') ? cardFromPng(readFileSync(join(DIR, file))) : parseCard(readFileSync(join(DIR, file), 'utf8')))
const files = readdirSync(DIR).filter((file) => /\.(json|png)$/.test(file))

test('every sample card parses and compiles in both modes', () => {
  assert.ok(files.length >= 5)
  for (const file of files) {
    const card = load(file)
    assert.ok(card, `${file} parses`)
    assert.equal(card.spec, 'chara_card_v2')
    const agent = compileCard(card)
    const pure = compileCard(card, { mode: 'pure' })
    assert.equal(agent.systemMode, 'append', file)
    assert.equal(pure.systemMode, 'takeover', file)
    assert.equal(agent.tools, null, `${file}: agent keeps all tools by default`)
    assert.deepEqual(pure.tools, [], `${file}: pure roleplay has no tools`)
    assert.match(agent.systemText, /和工具的关系/)
    assert.doesNotMatch(pure.systemText, /和工具的关系/)
    assert.doesNotMatch(agent.systemText, /\{\{\s*(char|user)\s*\}\}/i, `${file}: macros expanded`)
    assert.equal(agent.items.length, 1, `${file}: greeting becomes one assistant item`)
    assert.equal(agent.items[0].role, 'assistant')
    assert.doesNotMatch(agent.items[0].text, /<div|<span|style=/, `${file}: HTML stripped from greeting`)
    assert.ok(agent.everyTurn.enabled && agent.everyTurn.text.length >= 60, `${file}: reminder is not a one-liner`)
    assert.ok(cardSummary(cardId(card), card).name === card.data.name)
  }
})

test('PNG card prefers ccv3 and keeps the lorebook', () => {
  const card = load('seraphina.png')
  assert.equal(card.data.name, 'Seraphina')
  assert.equal(card.data.character_book.entries.length, 4)
  assert.equal(compileCard(card).lore.entries.length, 4)
})

test('constant lore entries go into the persona', () => {
  const card = load('tangtuantuan.v2.json')
  const out = compileCard(card)
  assert.match(out.systemText, /## 常驻设定\n【核心档案】/)
})

test('macros: {{user}} / <USER> / {{original}}', () => {
  assert.equal(expandMacros('{{User}} 和 {{char}}，<USER> 与 <BOT>{{original}}', { char: '甲', user: '乙' }), '乙 和 甲，乙 与 甲')
  const out = compileCard(load('tangtuantuan.v2.json'), { userName: '阿明', mode: 'pure' })
  assert.match(out.systemText, /阿明/)
  assert.match(out.everyTurn.text, /阿明/)
})

test('options: greeting pick, no greeting, tool allowlist, thinking switches', () => {
  const card = load('songzhixia.v2.json')
  assert.equal(compileCard(card, { greeting: -1 }).items.length, 0)
  const second = compileCard(card, { greeting: 1 })
  assert.notEqual(second.items[0].text, compileCard(card).items[0].text)
  assert.deepEqual(compileCard(card, { tools: ['read', 'grep'] }).tools, ['read', 'grep'])
  assert.deepEqual(compileCard(card, { mode: 'pure', tools: ['read'] }).tools, [])
  const think = compileCard(card, { thinking: { language: 'zh', firstPerson: true } })
  assert.match(think.everyTurn.text, /思维链（reasoning）全程用中文/)
  assert.match(think.everyTurn.text, /第一人称/)
  assert.equal(compileCard(card, { reinforce: { enabled: false } }).everyTurn.enabled, false)
})

test('post_history_instructions is used as the every-turn text', () => {
  const raw = JSON.parse(readFileSync(join(DIR, 'peiyu.v2.json'), 'utf8'))
  raw.data.post_history_instructions = '保持{{char}}的冷静，不要替{{user}}行动。'
  const out = compileCard(parseCard(raw), { userName: '小林' })
  assert.match(out.everyTurn.text, /^保持裴聿的冷静，不要替小林行动。/)
  assert.equal(out.everyTurn.firstText, '')
})

test('V1 flat cards and junk input', () => {
  const v1 = parseCard({ name: '旧卡', description: '一张 V1 卡', first_mes: '你好，<USER>。' })
  assert.equal(compileCard(v1, { userName: '丙' }).items[0].text, '你好，丙。')
  assert.equal(parseCard('not json'), undefined)
  assert.equal(parseCard({ description: 'no name' }), undefined)
  assert.equal(cardFromPng(new Uint8Array([1, 2, 3])), undefined)
})

test('stripHtml keeps text, drops markup', () => {
  assert.equal(stripHtml('<div style="x"><span>A</span><span>B</span></div>\n\n\n\n正文<br>下一行'), 'A · B\n\n正文\n下一行')
  assert.equal(stripHtml('*动作* "台词"'), '*动作* "台词"')
})

// ── 二期：世界书关键词 ───────────────────────────────────────────────────────

const loreOf = (file, options) => compileCard(load(file), options).lore

test('lore: keyword hit, miss, and the constant entry stays out of the keyword table', () => {
  const lore = loreOf('songzhixia.v2.json')
  assert.equal(lore.scanDepth, 4)
  assert.ok(lore.entries.every((entry) => entry.title !== '核心档案'))
  assert.deepEqual(matchLore(lore, ['学姐你的腿还疼吗？']).map((e) => e.title), ['腘绳肌拉伤'])
  assert.deepEqual(matchLore(lore, ['今天天气不错']), [])
  // 扫的是最近几条消息的合集：前一条提到钉鞋，这一条提到腿，两条都命中。
  assert.deepEqual(matchLore(lore, ['你的钉鞋好亮', '腿还疼吗']).map((e) => e.title).sort(), ['腘绳肌拉伤', '荧光橙钉鞋'].sort())
})

test('lore: selective secondary keys (AND ANY) and probability are deterministic per seed', () => {
  const lore = loreOf('songzhixia.v2.json')
  // 「大二那件事」：主键 大二/省队/教练/信任，次键 过去/为什么/不信，概率 80。
  let withSecondary = 0
  let without = 0
  for (let i = 0; i < 500; i += 1) {
    withSecondary += matchLore(lore, ['大二的时候教练为什么不信你？'], `s:${i}`).some((e) => e.title === '大二那件事')
    without += matchLore(lore, ['大二的时候省队怎么样'], `s:${i}`).some((e) => e.title === '大二那件事')
  }
  assert.equal(without, 0)
  assert.ok(withSecondary > 350 && withSecondary < 450, `~80% of 500, got ${withSecondary}`)
  const a = matchLore(lore, ['大二的时候教练为什么不信你？'], 'same').length
  const b = matchLore(lore, ['大二的时候教练为什么不信你？'], 'same').length
  assert.equal(a, b)
})

test('lore: ASCII keys match whole words, case-insensitive; regex keys work', () => {
  const lore = loreOf('frankie-doyle.v2.json')
  assert.deepEqual(matchLore(lore, ['Is SAL here?']).map((e) => e.title), ['Sal and the end stool'])
  assert.deepEqual(matchLore(lore, ['salt please']), [])
  const custom = { scanDepth: 4, budget: 2400, entries: [{ id: 1, title: 'r', keys: ['/dra(g|k)on/i'], secondary: [], logic: 0, caseSensitive: false, wholeWords: null, probability: 100, order: 1, content: 'x' }] }
  assert.equal(matchLore(custom, ['A DRAKON appears']).length, 1)
  assert.equal(matchLore(custom, ['a drone']).length, 0)
})

test('lore: budget keeps higher insertion_order first, output is ascending', () => {
  const mk = (id, order, len) => ({ id, title: String(id), keys: ['k'], secondary: [], logic: 0, caseSensitive: false, wholeWords: null, probability: 100, order, content: 'x'.repeat(len) })
  const lore = { scanDepth: 4, budget: 250, entries: [mk(1, 10, 100), mk(2, 30, 100), mk(3, 20, 100)] }
  assert.deepEqual(matchLore(lore, ['k']).map((e) => e.id), [3, 2])
  assert.match(renderLore(matchLore(lore, ['k']), '甲'), /^【世界书 · 本轮相关设定】.*供甲参考/)
})

test('lore: option off, card without keyword entries', () => {
  assert.equal(loreOf('songzhixia.v2.json', { lore: false }).enabled, false)
  assert.equal(loreOf('songzhixia.v2.json').enabled, true)
  assert.equal(compileCard(parseCard({ name: '无书' })).lore, null)
})

test('PNG export round-trips through cardFromPng and replaces old chunks', () => {
  const png = readFileSync(join(DIR, 'seraphina.png'))
  const other = load('tangtuantuan.v2.json')
  const out = embedCardInPng(png, other)
  assert.deepEqual(Object.keys(pngTextChunks(out)).sort(), ['ccv3', 'chara'])
  const back = cardFromPng(out)
  assert.equal(back.data.name, '唐团团')
  assert.equal(back.data.character_book.entries.length, other.data.character_book.entries.length)
  assert.equal(embedCardInPng(new Uint8Array([1, 2, 3]), other), undefined)
})

test('V3 group_only_greetings 导入 → 导出 PNG → 再导入不丢（#30）', () => {
  const png = readFileSync(join(DIR, 'seraphina.png'))
  const card = parseCard({ spec: 'chara_card_v3', spec_version: '3.0', data: { name: '分组开场', group_only_greetings: ['第一组', '第二组', '  '] } })
  assert.deepEqual(card.data.group_only_greetings, ['第一组', '第二组'])
  const back = cardFromPng(embedCardInPng(png, card))
  assert.deepEqual(back.data.group_only_greetings, ['第一组', '第二组'])
  // 没有这个字段的卡不硬写空数组。
  const plain = parseCard({ name: '无分组' })
  assert.equal('group_only_greetings' in plain.data, false)
  assert.equal('group_only_greetings' in cardFromPng(embedCardInPng(png, plain)).data, false)
})

test('expandMacros: names containing $ are inserted literally', () => {
  assert.equal(expandMacros('{{char}} meets {{user}}', { char: 'Ca$$h', user: 'A$&B' }), 'Ca$$h meets A$&B')
  assert.equal(expandMacros('<USER>!', { char: 'x', user: "$'tail" }), "$'tail!")
  assert.equal(expandMacros('hi <BOT>', { char: '$`x', user: 'u' }), 'hi $`x')
})
