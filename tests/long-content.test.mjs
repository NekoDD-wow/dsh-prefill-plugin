// 长内容折叠 / 展开 + 世界书本会话修改，以及「保存为预设」时改过的世界书持久化（不改角色卡本身）。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { compileCard, matchLore, parseCard } from '../character-cards.js'
import { loreFor } from '../gate.js'
import { sanitizeLore } from '../impl.js'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const implSrc = readFileSync(new URL('../impl.js', import.meta.url), 'utf8')
const cut = (from, to) => {
  const a = src.indexOf(from)
  const b = src.indexOf(to, a)
  assert.ok(a >= 0 && b > a, `找不到 ${from}`)
  return src.slice(a, b)
}
const fpSrc = cut('    function fingerprint(text) {', '    /**\n     * 「每轮注入」这一项开没开')
const withoutSrc = cut('    function without(map, sessionId) {', '// <preset-undo>')
const wsSrc = cut('// <workspace-preset>', '// </workspace-preset>')
const composeSrc = cut('// <preset-compose>', '// </preset-compose>')
// eslint-disable-next-line no-new-func
const H = new Function(
  `const PERSONA_SECTION = 'prefill:persona'\n${fpSrc}\n${withoutSrc}\n${wsSrc}\n${composeSrc}\nreturn { cardCompileOptions, cardLayer, resolveLayers, presetPatch, cardDiff, lorePackOf }`,
)()

const SID = 'session-a'
const cardFile = readFileSync(new URL('../samples/cards/songzhixia.v2.json', import.meta.url), 'utf8')
const card = parseCard(JSON.parse(cardFile))
const REF = { id: 'songzhixia', opts: {} }
const cardL = () => H.cardLayer(compileCard(card, H.cardCompileOptions(REF, null)), REF)
const apply = (st, card0, pack, key) => {
  const { resolved, from } = H.resolveLayers(card0, pack)
  return { ...st, ...H.presetPatch(st, SID, resolved, from, key) }
}
/** 面板上「编辑一条」做的事：改条目 + 打 custom 标记（editLore）。 */
const editFirst = (lore, patch) => ({ ...lore, entries: lore.entries.map((entry, i) => (i === 0 ? { ...entry, ...patch } : entry)), custom: true, source: 'session' })

test('世界书本会话修改 → 存成预设 → 新会话套用拿到改过的版本；角色卡不变', () => {
  const L = cardL()
  assert.ok(L.lore.entries.length > 0, '样例卡带世界书')
  let st = apply({}, L, null, 'card:songzhixia')
  const original = structuredClone(st.lore[SID])
  // ① 本会话改第一条：内容 + 关键词
  st = { ...st, lore: { ...st.lore, [SID]: editFirst(st.lore[SID], { content: '改过的设定', keys: ['新关键词'] }) } }
  // 闸门照常读：下一轮就按改过的匹配
  const live = loreFor(st, SID)
  assert.ok(live !== undefined)
  const hits = matchLore(live, ['我提到了新关键词'], 'seed')
  assert.ok(hits.some((entry) => entry.content === '改过的设定'))
  // ② 保存为「基于角色卡」的预设：diff 里带上整份世界书（会话标记不存），过一遍服务端校验
  const session = { overrides: st.overrides?.[SID], gate: st.gate?.[SID], tools: st.sessionTools?.[SID] ?? null, everyTurn: st.everyTurn?.[SID], items: L.items, lore: st.lore[SID] }
  const diff = H.cardDiff(session, L)
  assert.ok(diff.lore !== undefined, '改过的世界书要存进预设')
  for (const key of ['custom', 'source', 'enabled']) assert.equal(key in diff.lore, false, `${key} 是会话标记，不该存`)
  const pack = { name: '改过的宋知夏', layered: true, card: REF, ...diff, lore: sanitizeLore(diff.lore) }
  // ③ 新会话（另一个 state）套这个预设：卡照常现编译，但世界书用预设里的
  const fresh = apply({}, cardL(), pack, 'pack:改过的宋知夏')
  assert.equal(fresh.lore[SID].entries[0].content, '改过的设定')
  assert.deepEqual(fresh.lore[SID].entries[0].keys, ['新关键词'])
  assert.equal(fresh.lore[SID].custom, true)
  assert.equal(fresh.lore[SID].source, 'preset')
  assert.equal(fresh.lore[SID].enabled, true)
  assert.equal(fresh.lore[SID].entries.length, original.entries.length)
  // ④ 角色卡本身不变：重新编译还是原来的世界书，样例文件也没被碰
  assert.deepEqual(cardL().lore.entries, original.entries)
  assert.equal(readFileSync(new URL('../samples/cards/songzhixia.v2.json', import.meta.url), 'utf8'), cardFile)
})

test('没改过世界书：预设不存 lore，套用照旧从卡现编译', () => {
  const L = cardL()
  const st = apply({}, L, null, 'card:songzhixia')
  const session = { overrides: st.overrides?.[SID], gate: st.gate?.[SID], tools: null, everyTurn: st.everyTurn?.[SID], items: L.items, lore: st.lore[SID] }
  assert.equal(H.cardDiff(session, L).lore, undefined)
  assert.equal(H.lorePackOf(st.lore[SID]), undefined)
  const { resolved, from } = H.resolveLayers(L, { overrides: null })
  assert.deepEqual(resolved.lore, L.lore)
  assert.equal(from.lore, undefined)
})

test('预设带改过的世界书但卡没套上（卡已删）：不带世界书；卡引用关了世界书 ⇒ enabled=false', () => {
  const lore = { scanDepth: 4, entries: [{ id: 1, title: 'x', keys: ['k'], content: 'c' }] }
  assert.equal(H.resolveLayers(null, { lore }).resolved.lore, null)
  const off = H.cardLayer(compileCard(card, H.cardCompileOptions({ id: 'songzhixia', opts: { lore: false } }, null)), { id: 'songzhixia', opts: { lore: false } })
  const { resolved } = H.resolveLayers(off, { lore })
  assert.equal(resolved.lore.enabled, false)
  assert.equal(loreFor({ lore: { [SID]: resolved.lore } }, SID), undefined, '关着就不注入')
})

test('sanitizeLore：只留匹配字段、截断、丢掉会话标记；非法输入 = undefined', () => {
  assert.equal(sanitizeLore(null), undefined)
  assert.equal(sanitizeLore({ entries: 'x' }), undefined)
  const out = sanitizeLore({
    scanDepth: 3.7,
    budget: 900,
    char: '宋知夏',
    custom: true,
    source: 'session',
    enabled: true,
    entries: [{ id: 'u1', title: 't', keys: [' a ', '', 3, 'b'], secondary: ['s'], logic: 9, probability: 250, content: 'x'.repeat(30000), extra: 1 }, null],
  })
  assert.deepEqual(Object.keys(out).sort(), ['budget', 'char', 'entries', 'scanDepth'])
  assert.equal(out.scanDepth, 3)
  assert.equal(out.entries.length, 1)
  const [entry] = out.entries
  assert.deepEqual(entry.keys, ['a', 'b'])
  assert.equal(entry.logic, 0)
  assert.equal(entry.probability, 100)
  assert.equal(entry.content.length, 20000)
  assert.equal('extra' in entry, false)
})

test('服务端：保存 / 导入预设都收 lore，且只在带角色卡时存', () => {
  assert.match(implSrc, /card: sanitizeCardRef\(body\?\.card\), lore: sanitizeLore\(body\?\.lore\)/)
  assert.match(implSrc, /card: sanitizeCardRef\(parsed\?\.card\), lore: sanitizeLore\(parsed\?\.lore\)/)
  assert.match(implSrc, /extra\.lore === undefined \|\| extra\.card === undefined \? \{\} : \{ lore: extra\.lore \}/)
})

test('面板：改「我的名字」重编译时不覆盖改过的世界书', () => {
  assert.match(src, /lore: st\.lore\?\.\[sessionId\]\?\.custom === true \? st\.lore : put\(st\.lore, got\.layer\.lore\)/)
})

test('工作台长块：超过 240 字或 8 行默认收起；聚焦即展开（正在编辑的不会突然折叠）；展开后输入框自动增高', () => {
  const benchLong = new Function(cut('const benchLong = (block) => {', '\n      const setBenchBlockOpen') + '\nreturn benchLong')()
  assert.equal(benchLong({ first: '', text: '短' }), false)
  assert.equal(benchLong({ first: '', text: 'x'.repeat(241) }), true)
  assert.equal(benchLong({ first: '', text: Array(9).fill('行').join('\n') }), true)
  assert.equal(benchLong({ first: 'a\nb\nc\nd', text: 'e\nf\ng\nh\ni' }), true, '首轮段和每轮段合起来算')
  const card = cut('      const benchCard = (block) => {', '\n      const benchRows = ')
  assert.match(card, /const folded = long && !benchOpen\.has\(block\.key\)/)
  assert.match(card, /data-prefill-bench-folded/)
  assert.equal((card.match(/setBenchBlockOpen\(block\.key, true\)\n/g) ?? []).length, 3, '两个输入框聚焦 + 点预览')
  assert.match(card, /maxHeight: 'none', overflow: 'hidden'/)
  assert.match(src, /data-prefill-bench-fold-all/)
})

test('世界书面板：可展开、关键词全显示、超过 40 条可再显示、可编辑 / 删除 / 新增 / 还原', () => {
  const lore = cut('      // ── 世界书 / 故事记忆（从角色卡拆出来的两项）──', '      const memorySection = h(')
  assert.doesNotMatch(lore, /keys \?\? \[\]\)\.slice\(0, 6\)/, '关键词不再只显示前 6 个')
  assert.doesNotMatch(lore, /loreEntries\.slice\(0, 40\)/, '不再固定只显示 40 条')
  for (const sel of ['data-prefill-lore-toggle', 'data-prefill-lore-edit', 'data-prefill-lore-delete', 'data-prefill-lore-add', 'data-prefill-lore-more', 'data-prefill-lore-revert', 'data-prefill-lore-content']) assert.ok(lore.includes(sel), sel)
  assert.match(lore, /custom: true, source: 'session'/)
  // 中英文案都有「不会改动角色卡本身」的声明
  assert.match(src, /loreEditHint: '[^']*不会改动角色卡本身/)
  assert.match(src, /loreEditHint: '[^']*character card itself is never changed/)
})
