// 0.14：角色卡 = 预设的子集。分层 默认 ← 角色卡编译结果 ← 预设覆盖 ← 本会话手改；套卡 / 套预设走同一条写入路径。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { compileCard, parseCard } from '../character-cards.js'
import { isLayered, sanitizeCardRef } from '../impl.js'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
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
  `const PERSONA_SECTION = 'prefill:persona'\n${fpSrc}\n${withoutSrc}\n${wsSrc}\n${composeSrc}\nreturn { LAYER_KEYS, cardRefOf, cardCompileOptions, cardLayer, builtinLayer, resolveLayers, slotPrints, slotSourceOf, slotTag, presetPatch, cardDiff, greetingIndex, withGreeting, navEntries }`,
)()

const P = 'prefill:persona'
const SID = 'session-a'
const card = parseCard(JSON.parse(readFileSync(new URL('../samples/cards/songzhixia.v2.json', import.meta.url), 'utf8')))
const compile = (ref, legacy) => compileCard(card, H.cardCompileOptions(ref, legacy))
const REF = { id: 'songzhixia', opts: {} }
const cardL = () => H.cardLayer(compile(REF, null), REF)
// 模拟 state 路由的合并（patchState：顶层键整格替换）。
const write = (st, patch) => ({ ...st, ...patch })
const applyAll = (st, card0, pack, key) => {
  const { resolved, from } = H.resolveLayers(card0, pack)
  return { st: write(st, H.presetPatch(st, SID, resolved, from, key)), resolved, from }
}
const session = (st, items) => ({ overrides: st.overrides?.[SID], gate: st.gate?.[SID], tools: st.sessionTools?.[SID] ?? null, everyTurn: st.everyTurn?.[SID], items, workspaceInstructions: st.workspaceInstructions?.[SID] })

test('唯一写入路径：套卡 → 套预设 → 再套卡，整体替换、没有残留', () => {
  const other = { overrides: { 'session-b': { sections: { [P]: '别的会话' } } }, gate: { 'session-b': 'pure' } }
  let st = { ...other, injects: {} }
  // ① 套卡
  const L = cardL()
  ;({ st } = applyAll(st, L, null, 'card:songzhixia'))
  assert.equal(st.activePreset[SID], 'card:songzhixia')
  assert.equal(st.cardRef[SID].id, 'songzhixia')
  assert.ok(st.overrides[SID].sections[P].includes('宋知夏'))
  assert.ok(st.everyTurn[SID].text.length > 0, '卡带每轮提醒')
  assert.ok(st.lore[SID]?.entries?.length > 0, '卡带世界书')
  assert.equal(st.memory[SID].enabled, true)
  assert.deepEqual(Object.keys(st.slotSource[SID]).sort(), ['everyTurn', 'items', 'system'], '卡没白名单 ⇒ 工具是默认，不记来源')
  assert.ok(Object.values(st.slotSource[SID]).every((e) => e.from === 'card'))
  // ② 套内置预设（只有系统提示）：卡的一切归位
  const builtin = H.builtinLayer({ id: 'zh', overrides: { sections: { [P]: '用中文。' } }, items: [] })
  let r
  ;({ st, resolved: r } = applyAll(st, null, builtin, 'builtin:zh'))
  assert.equal(st.overrides[SID].sections[P], '用中文。')
  for (const key of ['cardRef', 'lore', 'memory', 'everyTurn', 'sessionTools', 'enabled', 'workspaceInstructions']) assert.equal(SID in (st[key] ?? {}), false, `${key} 留下了`)
  assert.equal(st.gate[SID], 'pass')
  assert.deepEqual(r.items ?? [], [], '开场对话也整体替换')
  assert.deepEqual(st.slotSource[SID], { system: { from: 'preset', fp: H.slotPrints(r).system } })
  // ③ 我的预设（存了每轮注入 + 工具 + 开关），再 ④ 套卡：预设的东西不留
  const pack = { items: [{ role: 'user', text: '嗨' }], overrides: { messages: { x: 'y' }, sections: {}, contexts: {} }, tools: ['read'], everyTurn: { enabled: true, text: '提醒', firstText: '' }, enabled: { inject: false }, workspaceInstructions: { mode: 'off' } }
  ;({ st } = applyAll(st, null, pack, 'pack:我的'))
  assert.deepEqual(st.sessionTools[SID], ['read'])
  assert.equal(st.workspaceInstructions[SID].mode, 'off')
  ;({ st, resolved: r } = applyAll(st, cardL(), null, 'card:songzhixia'))
  assert.equal(st.overrides[SID].messages?.x, undefined, '改写注入内容不留')
  assert.notEqual(st.everyTurn[SID].text, '提醒')
  assert.equal(SID in st.enabled, false)
  assert.equal(SID in st.workspaceInstructions, false)
  assert.equal(st.sessionTools[SID], undefined, '卡没白名单 = 默认全放行')
  assert.deepEqual(r.items, cardL().items, '开场对话换成卡的开场白')
  // 别的会话一直没动
  assert.equal(st.overrides['session-b'].sections[P], '别的会话')
  assert.equal(st.gate['session-b'], 'pure')
  // ⑤ 取消（空预设）：全部归位
  ;({ st } = applyAll(st, null, null, ''))
  for (const key of ['activePreset', 'cardRef', 'lore', 'memory', 'overrides', 'everyTurn', 'sessionTools', 'slotSource']) assert.equal(SID in (st[key] ?? {}), false, key)
  // client：四个入口都只调 applyLayered，不再各写各的
  for (const fn of ['const applyBuiltin = async', 'const applyPack = async', 'const applyCardPreset = async', 'const clearPreset = async']) {
    const body = src.slice(src.indexOf(fn), src.indexOf('\n      }\n', src.indexOf(fn)))
    assert.match(body, /applyLayered\(/, fn)
    assert.doesNotMatch(body, /writeSystem\(/, `${fn} 不能另走 writeSystem`)
  }
  assert.doesNotMatch(src, /const applyCard = async \(\) =>/, '旧的套卡路径删掉了')
  assert.doesNotMatch(src, /presetLeftovers/)
})

test('纯角色扮演卡 / 接管内置预设：闸门 pure + 工具 0；替换正文 = replace', () => {
  const pure = compileCard(card, H.cardCompileOptions(REF, { mode: 'pure' }))
  const L = H.cardLayer(pure, REF)
  assert.equal(L.gate, 'pure')
  assert.deepEqual(L.tools, [])
  assert.deepEqual(H.builtinLayer({ pure: true, items: [] }), { overrides: null, gate: 'pure', tools: [], items: null })
  assert.equal(H.builtinLayer({ takeover: true, overrides: { sections: { [P]: 'x' } }, items: [] }).gate, 'pure')
  assert.equal(H.builtinLayer({ replace: true, overrides: { sections: { [P]: 'x' } }, items: [] }).gate, 'replace')
})

test('基于角色卡的预设：只存改过的格，套用时其余从卡来', () => {
  const L = cardL()
  let { st, resolved } = applyAll({}, L, null, 'card:songzhixia')
  // 本会话只改了每轮注入
  const items = resolved.items
  st = write(st, { everyTurn: { [SID]: { enabled: true, text: '只用中文思考。', firstText: '', mode: 'always', untilTurn: 0, checks: [] } } })
  const diff = H.cardDiff(session(st, items), L)
  assert.deepEqual(Object.keys(diff), ['everyTurn'], '只存改过的那一格')
  // 存下来（服务端 save：layered + card 引用）
  assert.equal(isLayered({ layered: true, card: REF }), true)
  assert.equal(isLayered({ layered: true }), false)
  const pack = { card: sanitizeCardRef(REF), ...diff }
  // 新会话套用：每轮注入 = 预设的，其余 = 卡的
  const parsed = H.cardRefOf(pack.card)
  const again = H.cardLayer(compile(parsed.ref, parsed.legacy), parsed.ref)
  const out = applyAll({}, again, pack, 'pack:基于卡')
  assert.equal(out.st.everyTurn[SID].text, '只用中文思考。')
  assert.equal(out.st.overrides[SID].sections[P], L.overrides.sections[P])
  assert.deepEqual(out.resolved.items, L.items)
  assert.ok(out.st.lore[SID].entries.length > 0)
  assert.equal(out.st.cardRef[SID].id, 'songzhixia')
  assert.equal(out.st.slotSource[SID].everyTurn.from, 'preset')
  assert.equal(out.st.slotSource[SID].system.from, 'card')
  assert.equal(out.st.slotSource[SID].items.from, 'card')
  // 卡有、预设明确清空：存 null / [] ⇒ 套用时是默认，不从卡补
  const cleared = H.cardDiff({ ...session(out.st, []), everyTurn: null }, L)
  assert.deepEqual(cleared.items, [])
  assert.equal(cleared.everyTurn, null)
  const out2 = applyAll({}, again, { card: REF, ...cleared }, 'pack:清空')
  assert.deepEqual(out2.resolved.items, [])
  assert.equal(SID in out2.st.everyTurn, false)
  // 改写注入内容（卡里没有）整份存
  const withInject = H.cardDiff({ ...session(out.st, items), overrides: { messages: { 'runtime-context': '改' }, sections: { [P]: L.overrides.sections[P] }, contexts: {} } }, L)
  assert.equal(withInject.overrides.messages['runtime-context'], '改')
  // 没套卡 = 全存
  assert.ok(H.cardDiff(session(out.st, items), null).items)
})

test('来源标签：来自角色卡 / 来自预设 / 本会话改过', () => {
  const L = cardL()
  const { st, resolved, from } = applyAll({}, L, { everyTurn: { enabled: true, text: '预设提醒', firstText: '' } }, 'pack:x')
  const src0 = st.slotSource[SID]
  const cur = session(st, resolved.items)
  assert.equal(H.slotTag(src0, 'system', cur, true), 'card')
  assert.equal(H.slotTag(src0, 'everyTurn', cur, true), 'preset')
  // 服务端给每轮注入盖的运行时章（since / override）不算改过
  assert.equal(H.slotTag(src0, 'everyTurn', { ...cur, everyTurn: { ...cur.everyTurn, since: 3, override: null } }, true), 'preset')
  assert.equal(H.slotTag(src0, 'items', { ...cur, items: [{ role: 'user', text: '改了' }] }, true), 'session')
  assert.equal(H.slotTag(src0, 'system', { ...cur, gate: 'pure' }, true), 'session', '换了模式也算改过')
  assert.equal(H.slotTag(null, 'items', cur, false), '')
  assert.equal(H.slotTag(null, 'items', cur, true), 'session')
  assert.equal(H.slotSourceOf(resolved, from).workspace, undefined, '默认的格不记来源')
  // 面板：每格都带标签
  for (const id of ['system', 'every-turn', 'items', 'workspace']) {
    const at = src.indexOf(`id: '${id}',`)
    assert.match(src.slice(at, at + 200), /tags: sourceTag\(tagOf\('/, id)
  }
  assert.match(src, /'data-prefill-source': kind/)
})

test('开场白 ↔ 开场对话：选一句 = 换第一条 AI 回答；改了第一条，下拉跟着变', () => {
  const compiled = compile(REF, null)
  const g = compiled.greetingTexts
  assert.ok(g.length >= 1)
  assert.equal(compiled.items[0].text, g[0], '全文和 items 里那条同样处理')
  assert.equal(H.greetingIndex(compiled.items, g), 0)
  const two = ['第一句', '第二句']
  const items = [{ role: 'user', text: '前情' }, { role: 'assistant', text: '第一句', reasoning: 'r' }, { role: 'assistant', text: '后来' }]
  const picked = H.withGreeting(items, two, 1)
  assert.equal(picked[1].text, '第二句')
  assert.equal(picked[1].reasoning, 'r')
  assert.equal(picked[2].text, '后来', '只换第一条')
  assert.equal(items[1].text, '第一句', '不改原数组')
  assert.equal(H.greetingIndex(picked, two), 1)
  assert.equal(H.greetingIndex([{ ...picked[0] }, { ...picked[1], text: '我改过了' }], two), -2, '手改 ⇒ 不是卡里的开场白')
  assert.equal(H.greetingIndex([{ role: 'user', text: 'x' }], two), -1)
  assert.deepEqual(H.withGreeting([], two, 0), [{ role: 'assistant', text: '第一句', reasoning: '' }], '没有 AI 回答 ⇒ 放在最前')
  assert.deepEqual(H.withGreeting(picked, two, -1).map((i) => i.text), ['前情', '后来'], '不要开场白 ⇒ 去掉')
  assert.deepEqual(H.withGreeting([{ role: 'assistant', text: '自己写的' }], two, -1).map((i) => i.text), ['自己写的'], '不是开场白的不删')
  // 面板：下拉在开场对话里、选择走 withGreeting；角色卡面板里不再有
  const itemsAt = src.indexOf('const greetingBar =')
  assert.ok(itemsAt > 0)
  assert.match(src.slice(itemsAt, itemsAt + 2000), /edit\(withGreeting\(items, greetingTexts, k\)\)/)
  const cardsSec = cut('      const cardsSection = h(', '      // ── 来源标签（0.14）')
  for (const attr of ['data-prefill-card-greeting', 'data-prefill-card-apply', 'data-prefill-card-zh', 'data-prefill-card-firstperson', 'data-prefill-card-reinforce', 'data-prefill-card-mode', 'data-prefill-card-tools', 'data-prefill-card-lore', 'data-prefill-card-memory']) {
    assert.ok(!cardsSec.includes(`'${attr}'`), `角色卡面板里还有 ${attr}`)
  }
  assert.ok(cardsSec.includes("'data-prefill-card-user'"), '我的名字留在卡上')
  const et = cut('      const everyTurnSection = h(', '      const injectSection = h(')
  for (const attr of ['data-prefill-card-zh', 'data-prefill-card-firstperson', 'data-prefill-card-reinforce']) assert.ok(et.includes(`[attr]: ''`) || et.includes(`'${attr}'`), attr)
  assert.match(src, /'data-prefill-card-mode': key, onClick: \(\) => \(on \? undefined : void setCardMode\(key\)/)
})

test('旧预设迁移：card.opts 的开场白 / 提醒 / 中文 / 第一人称 / 模式 / 白名单映射到对应的格', () => {
  const old = { id: 'songzhixia', opts: { mode: 'pure', greeting: -1, reinforce: true, thinkZh: true, firstPerson: true, tools: '', userName: '小林', lore: true, memory: false } }
  const stored = sanitizeCardRef(old)
  const parsed = H.cardRefOf(stored)
  assert.deepEqual(parsed.ref, { id: 'songzhixia', opts: { userName: '小林', memory: false } }, '卡上只留卡自己的')
  assert.deepEqual(Object.keys(parsed.legacy).sort(), ['firstPerson', 'greeting', 'mode', 'reinforce', 'thinkZh', 'tools'])
  const L = H.cardLayer(compile(parsed.ref, parsed.legacy), parsed.ref)
  assert.equal(L.gate, 'pure', '模式 → 闸门')
  assert.deepEqual(L.tools, [])
  assert.deepEqual(L.items, [], '不要开场白 → 开场对话为空')
  assert.deepEqual([...L.everyTurn.checks].sort(), ['firstPerson', 'zh'], '中文 / 第一人称 → 每轮注入')
  assert.match(L.everyTurn.text, /中文/)
  assert.equal(L.memory, null, '故事记忆关')
  assert.match(L.overrides.sections[P], /小林|宋知夏/)
  // 旧预设（0.10–0.13 存了全部格）：格以预设为准；没有的格（比如 0.9 之前没存每轮注入）从迁移后的卡来
  const oldPack = { card: stored, items: [{ role: 'user', text: '旧草稿' }], overrides: { messages: {}, sections: { [P]: '旧人设' }, contexts: {} }, gate: 'pure', tools: [] }
  const { st, resolved } = applyAll({}, L, oldPack, 'pack:旧')
  assert.equal(st.overrides[SID].sections[P], '旧人设')
  assert.deepEqual(resolved.items, [{ role: 'user', text: '旧草稿' }])
  assert.deepEqual([...st.everyTurn[SID].checks].sort(), ['firstPerson', 'zh'])
  assert.deepEqual(st.cardRef[SID].opts, { userName: '小林', memory: false }, 'state 里的引用也不再带旧选项')
  // 带工具 + 白名单
  const agent = H.cardRefOf({ id: 'x', opts: { mode: 'agent', tools: 'read, grep，web_search' } })
  assert.deepEqual(H.cardCompileOptions(agent.ref, agent.legacy).tools, ['read', 'grep', 'web_search'])
  assert.equal(H.cardRefOf({ id: 'x' }).legacy, null)
  assert.equal(H.cardRefOf(null), null)
  // 旧导出文件照样能导入：服务端 import 走同一个 sanitizeCardRef，不要求 layered
  assert.equal(isLayered(oldPack), false)
  const impl = readFileSync(new URL('../impl.js', import.meta.url), 'utf8')
  assert.match(impl, /if \(\(items === undefined && !layered\) \|\| name === ''\) reason = 'import needs \{ name, items\[\] \}'/)
})

test('角色卡只填格，不改通用功能', () => {
  const L = cardL()
  assert.deepEqual(Object.keys(L).sort(), ['card', 'everyTurn', 'gate', 'items', 'lore', 'memory', 'overrides', 'tools'].sort())
  assert.deepEqual(L.overrides.messages, {})
  assert.deepEqual(L.overrides.contexts, {})
  assert.equal('enabled' in L || 'workspaceInstructions' in L, false)
})

test('左栏：世界书 / 故事记忆挂在角色卡下，只在套用的卡带了它们时出现', () => {
  const NAV = [['card', 'cards', 'c'], ['lore', 'lore', 'l'], ['memory', 'memory', 'm'], ['system', 'system', 's']]
  assert.deepEqual(H.navEntries(NAV, {}).map((e) => e[0]), ['card', 'system'])
  assert.deepEqual(H.navEntries(NAV, { lore: true }).map((e) => e[0]), ['card', 'lore', 'system'])
  const all = H.navEntries(NAV, { lore: true, memory: true })
  assert.deepEqual(all.map((e) => e[3]), ['', 'card', 'card', ''])
  assert.match(src, /'data-prefill-nav-parent': parent/)
  assert.match(src, /navList\.map\(\(\[key, paneId, color, parent\]\) => navItem\(key, paneId, color, parent\)\)/)
  assert.match(src, /navList\.map\(\(\[key, paneId, color, parent\]\) => tabItem\(key, paneId, color, parent\)\)/)
  // 隐藏的子项不会停在右栏
  assert.match(src, /sections\[shownPane\] \?\? itemsSection/)
})

test('头部下拉三组：内置 / 我的预设 / 角色卡；卡片面板没有自己的套用按钮', () => {
  const menu = cut('      const presetsMenu = h(', '      // 「另存为…」')
  assert.match(menu, /t\('groupBuiltin'\)/)
  assert.match(menu, /t\('groupMine'\)/)
  assert.match(menu, /t\('groupCards'\)/)
  assert.match(menu, /'data-prefill-preset': `card:\$\{card\.id\}`/)
  assert.match(menu, /applyCardPreset\(card\)/)
  assert.doesNotMatch(src, /data-prefill-card-apply/)
})
