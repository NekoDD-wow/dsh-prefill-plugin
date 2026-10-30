// v0.10.1 卡片体验：开场对话「从当前会话取」（范围 / 放置 / 撤销 / 大内容保护）、芯片开关、钉住标记。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { historyToItems, turnRange } from '../session-history.js'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
// client.js 里 <fetch-helpers> 那段是纯函数，切出来直接跑（和 enabled.test.mjs 取指纹函数同一做法）。
const helperSrc = src.slice(src.indexOf('// <fetch-helpers>'), src.indexOf('// </fetch-helpers>'))
const estimateSrc = src.slice(src.indexOf('const tokenCache = new Map()'), src.indexOf('// <fetch-helpers>'))
// eslint-disable-next-line no-new-func
const H = new Function(`${estimateSrc}\n${helperSrc}\nreturn { fetchRange, placeFetched, seedAllowed, isLongText, itemsTokens, estimateTokens, FETCH_WARN_TOK, ROW_BATCH }`)()

const turn = (n) => ({ type: 'turn/start', data: { turn: n } })
const user = (text) => ({ type: 'user/message', data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] } })
const ai = (n, t, r = '') => ({ type: 'assistant/message', data: { turn: n, message: { role: 'assistant', source: { kind: 'model' }, content: [...(r ? [{ type: 'reasoning', text: r }] : []), { type: 'text', text: t }] } } })
const events = [1, 2, 3, 4].flatMap((n) => [turn(n), user(`问${n}`), ai(n, `答${n}`, `想${n}`)])

test('范围：第 N 轮 到 第 M 轮（客户端参数 + 服务端规整 + 取条目）', () => {
  assert.deepEqual(H.fetchRange('', ''), { fromTurn: 1, toTurn: 0 })
  assert.deepEqual(H.fetchRange('2', '3'), { fromTurn: 2, toTurn: 3 })
  assert.deepEqual(H.fetchRange('3', '2'), { fromTurn: 2, toTurn: 3 }, 'M < N 对调')
  assert.deepEqual(H.fetchRange('0', 'x'), { fromTurn: 1, toTurn: 0 })
  assert.deepEqual(H.fetchRange(' 2 ', ''), { fromTurn: 2, toTurn: 0 }, 'M 留空 = 到最后')
  // 服务端：旧调用只给 toTurn 照旧
  assert.deepEqual(turnRange({ toTurn: 1 }), { from: 1, to: 1 })
  assert.deepEqual(turnRange({}), { from: 1, to: 0 })
  assert.deepEqual(turnRange({ fromTurn: 3, toTurn: 2 }), { from: 2, to: 3 })
  const pick = (body) => {
    const r = turnRange(body)
    return historyToItems(events, { reasoning: true, fromTurn: r.from, toTurn: r.to })
  }
  const mid = pick({ fromTurn: 2, toTurn: 3 })
  assert.deepEqual(mid.items.map((i) => i.text), ['问2', '答2', '问3', '答3'])
  assert.equal(mid.turnCount, 2)
  assert.equal(mid.lastTurn, 4)
  assert.deepEqual(pick({ toTurn: 1 }).items.map((i) => i.text), ['问1', '答1'])
  assert.deepEqual(pick({ fromTurn: 4 }).items.map((i) => i.text), ['问4', '答4'])
  assert.equal(pick({ fromTurn: 9 }).items.length, 0)
})

test('放置：替换 / 插在第 k 条后（默认 = 末尾 = 追加），不改原数组', () => {
  const list = [{ role: 'user', text: 'a' }, { role: 'assistant', text: 'b', reasoning: '' }, { role: 'user', text: 'c' }]
  const got = [{ role: 'user', text: 'X' }, { role: 'assistant', text: 'Y', reasoning: 'r' }]
  const texts = (arr) => arr.map((i) => i.text).join('')
  assert.equal(texts(H.placeFetched(list, got, 'replace')), 'XY')
  assert.equal(texts(H.placeFetched(list, got, 'insert', 0)), 'XYabc')
  assert.equal(texts(H.placeFetched(list, got, 'insert', 1)), 'aXYbc')
  assert.equal(texts(H.placeFetched(list, got, 'insert', list.length)), 'abcXY', 'k = 条数 = 追加')
  assert.equal(texts(H.placeFetched(list, got, 'insert', 99)), 'abcXY')
  assert.equal(texts(H.placeFetched(list, got, 'insert', -3)), 'XYabc')
  assert.equal(texts(H.placeFetched([], got, 'insert', 0)), 'XY')
  assert.equal(texts(list), 'abc')
  const placed = H.placeFetched(list, got, 'insert', 3)
  placed[3].text = 'changed'
  assert.equal(got[0].text, 'X', '放进去的是副本')
  // 撤销 = 放回放置前的那份数组（commitFetch 存 before）
  const src2 = src.slice(src.indexOf('const commitFetch = '), src.indexOf('const fetchFromSession = '))
  assert.match(src2, /const before = items/)
  assert.match(src2, /setUndoSnap\(\{ items: before, mode \}\)/)
  // 只改预设的开场对话草稿：不碰注入 / 会话历史（不调 inject、不发 packs 以外的写操作）
  const fetchAll = src.slice(src.indexOf('const commitFetch = '), src.indexOf('// 故事记忆：取本会话的摘要'))
  assert.doesNotMatch(fetchAll, /oneClickInject|injectCall|op: 'inject'|op: 'save'|call\(\{/)
})

test('故事记忆摘要不能晚于截取末轮 M', () => {
  const memory = { text: '前情', throughTurn: 3 }
  assert.equal(H.seedAllowed(memory, 0), true, 'M = 到最后')
  assert.equal(H.seedAllowed(memory, 3), true)
  assert.equal(H.seedAllowed(memory, 2), false)
  assert.equal(H.seedAllowed(null, 0), false)
  assert.equal(H.seedAllowed({ text: '  ', throughTurn: 1 }, 0), false)
  // 保存时带上 toTurn，服务端 save 再核一次（impl.js 原有规则）
  assert.match(src, /memorySeed: seedDraft, \.\.\.\(cutTo > 0 \? \{ toTurn: cutTo \} : \{\}\)/)
})

test('大内容保护：长卡片折叠、分批渲染、超过 ~20k tok 先提醒', () => {
  assert.equal(H.FETCH_WARN_TOK, 20000)
  assert.equal(H.isLongText('短'), false)
  assert.equal(H.isLongText('一'.repeat(361)), true)
  assert.equal(H.isLongText('a\nb\nc\nd\ne\nf'), false)
  assert.equal(H.isLongText('a\nb\nc\nd\ne\nf\ng'), true)
  // 100 轮、每轮长思维链 ≈ 200 条：估算超过阈值 ⇒ 走确认（不直接放进列表）
  const big = Array.from({ length: 200 }, (_, i) => (i % 2 ? { role: 'assistant', text: '好的。'.repeat(60), reasoning: '我想想这个问题应该怎么回答比较好。'.repeat(30) } : { role: 'user', text: '继续讲。'.repeat(20) }))
  const t0 = performance.now()
  const tok = H.itemsTokens(big)
  const cold = performance.now() - t0
  const t1 = performance.now()
  H.itemsTokens(big)
  const warm = performance.now() - t1
  assert.ok(tok > H.FETCH_WARN_TOK, `tok=${tok}`)
  assert.equal(big.filter((i) => H.isLongText(i.text) || H.isLongText(i.reasoning)).length, 100, '长回答默认折叠')
  console.log(`# 200 条估算 token：${tok} tok，首次 ${cold.toFixed(1)}ms，缓存后 ${warm.toFixed(2)}ms`)
  const fetchFn = src.slice(src.indexOf('const fetchFromSession = '), src.indexOf('const undoFetch = '))
  assert.match(fetchFn, /items\.length === 0 && pending\.tok <= FETCH_WARN_TOK\) commitFetch\(pending, 'replace'\)/)
  assert.match(src, /\.\.\.items\.slice\(0, shownRows\)\.map\(itemRow\)/)
  assert.equal(H.ROW_BATCH, 40)
})

test('结构：「从当前会话取」在开场对话里，另存为只剩起名保存和导入导出', () => {
  const saveAs = src.slice(src.indexOf('const saveAsPanel = h('), src.indexOf('const pickedCard = '))
  assert.doesNotMatch(saveAs, /data-prefill-history/)
  assert.match(saveAs, /exportFile\(\)/)
  assert.match(saveAs, /fileRef\.current\?\.click\(\)/)
  const bar = src.slice(src.indexOf('const fetchBar = h('), src.indexOf('const itemsSection = h('))
  for (const attr of ['data-prefill-history-open', 'data-prefill-history-reasoning', 'data-prefill-history-from', 'data-prefill-history-to', 'data-prefill-fetch-replace', 'data-prefill-fetch-insert', 'data-prefill-fetch-at', 'data-prefill-fetch-cancel']) assert.ok(bar.includes(attr), attr)
  assert.match(src, /'data-prefill-seed-fetch': ''/)
  assert.doesNotMatch(src, /saveHistoryPack|historyPreview/)
})

test('芯片是纯开关；钉住用 Lucide pin，收起用 chevron-down', () => {
  const chip = src.slice(src.indexOf("'aria-expanded': cardOpen ? 'true' : 'false',"), src.indexOf('function fallbackName('))
  assert.match(chip, /if \(cardOpen\) \{\s*setCardOpen\(sessionId, false\)/)
  assert.match(chip, /'aria-expanded': cardOpen/)
  // 点外面：芯片（composedPath 里有 data-prefill-chip）不算外面
  const outside = src.slice(src.indexOf('const onDown = (event) => {'), src.indexOf('const onKey = (event) => {'))
  assert.match(outside, /pathHas\(event, 'data-prefill-chip'\)/)
  assert.ok(src.includes('"pin":[["path",{"d":"M12 17v5"}]'))
  assert.ok(src.includes('"chevron-down":[["path",{"d":"m6 9 6 6 6-6"}]]'))
  assert.match(src, /'data-prefill-collapse': ''/)
  assert.match(src, /ICONS\.pin \? h\(Icon, \{ name: 'pin', size: 15, fill: pinned \? 'currentColor' : 'none' \}\) : h\('span'/)
  // 钉住缩成标记：焦点在卡片里 / 菜单、确认开着不缩；淡出的卡片不接收点击；尊重 reduced-motion
  const shrink = src.slice(src.indexOf('const scheduleShrink = '), src.indexOf('const restoreCard = '))
  assert.match(shrink, /hoverRef\.current \|\| holdRef\.current/)
  assert.match(shrink, /typing && cardRef\.current\?\.contains\(active\)/)
  assert.match(src, /const holdOpen = menu !== '' \|\| fetchPending !== null \|\| confirming !== ''/)
  assert.match(src, /pointerEvents: shrunk \|\| closing \? 'none' : 'auto'/)
  assert.match(src, /prefers-reduced-motion: reduce/)
})
