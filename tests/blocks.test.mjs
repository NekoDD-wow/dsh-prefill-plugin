// v0.15 积木模型：拼接 / 首轮规则 / checks 并集 / 去重 / 塔拆平 / 迁移，以及「面板那份副本和服务端一致」。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  PRIORITY_PREFIX,
  addTowerToBench,
  benchBlockOf,
  blockFromPreset,
  compileBench,
  flattenTower,
  makeBlock,
  migrateEveryTurn,
  normalizeChecks,
  unionChecks,
} from '../blocks.js'

// 面板那份副本（client.js 里 <bench-helpers> 段），与 blocks.js 比对行为一致。
const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const helperSrc = src.slice(src.indexOf('// <bench-helpers>'), src.indexOf('// </bench-helpers>'))
const clientSide = new Function(helperSrc + '\nreturn { compileBench, unionChecks, flattenTower, addTowerToBench, migrateEveryTurn, makeBlock, benchBlockOf, normalizeChecks, PRIORITY_PREFIX }')()

const block = (input) => makeBlock({ id: 'x', name: 'x', builtin: true, ...input })
const onBench = (entry, key) => benchBlockOf(entry, key)

test('拼接：第 1 轮取 first（没有就取 text），之后只取 text', () => {
  const bench = [
    onBench(block({ id: 'a', first: '首轮A', text: '每轮A' }), 'b1'),
    onBench(block({ id: 'b', first: '', text: '每轮B' }), 'b2'),
    onBench(block({ id: 'c', first: '只有首轮', text: '' }), 'b3'),
  ]
  const compiled = compileBench(bench)
  assert.equal(compiled.firstText, '首轮A\n每轮B\n只有首轮')
  assert.equal(compiled.text, '每轮A\n每轮B', '纯首轮块第 2 轮起不发')
})

test('拼接：空块不产生空行；顺序就是注入顺序', () => {
  const bench = [onBench(block({ id: 'a', text: '第一块' }), 'b1'), onBench(block({ id: 'b', text: '' }), 'b2'), onBench(block({ id: 'c', text: '第三块' }), 'b3')]
  assert.equal(compileBench(bench).text, '第一块\n第三块')
  const swapped = [bench[2], bench[0]]
  assert.equal(compileBench(swapped).text, '第三块\n第一块')
})

test('「冲突时以此为准」块带前缀（第 1 轮与之后都带）', () => {
  const bench = [{ ...onBench(block({ id: 'a', first: '首轮', text: '正文' }), 'b1'), priority: true }]
  const compiled = compileBench(bench)
  assert.equal(compiled.firstText, PRIORITY_PREFIX + '首轮')
  assert.equal(compiled.text, PRIORITY_PREFIX + '正文')
})

test('checks = 各块并集，按固定顺序、去重', () => {
  const bench = [
    onBench(block({ id: 'a', checks: ['four', 'zh'] }), 'b1'),
    onBench(block({ id: 'b', checks: ['zh', 'firstPerson'] }), 'b2'),
    onBench(block({ id: 'c', checks: [] }), 'b3'),
  ]
  assert.deepEqual(unionChecks(bench), ['zh', 'four', 'firstPerson'])
  assert.deepEqual(compileBench(bench).checks, ['zh', 'four', 'firstPerson'])
  assert.deepEqual(normalizeChecks(['nope', 'zh', 'zh']), ['zh'])
})

test('塔：按顺序展开、局部覆盖文字、塔不嵌套（遇到塔直接拆平）、删掉的积木用快照兜底', () => {
  const blocks = [block({ id: 'a', text: 'A' }), block({ id: 'b', text: 'B' })]
  const inner = { id: 'inner', name: '内塔', items: [{ ref: 'b' }] }
  const towers = [inner, { id: 'outer', name: '外塔', items: [{ ref: 'a', text: 'A（覆盖）' }, { ref: 'inner' }, { ref: 'gone', snap: { name: '没了', text: '快照文字', first: '' } }] }]
  const flat = flattenTower(towers[1], towers, blocks)
  assert.deepEqual(flat.map((entry) => entry.text), ['A（覆盖）', 'B', '快照文字'])
})

test('装塔去重：台上已有的积木跳过', () => {
  const blocks = [block({ id: 'a', text: 'A' }), block({ id: 'b', text: 'B' })]
  const tower = { id: 't', name: '塔', items: [{ ref: 'a' }, { ref: 'b' }] }
  let n = 0
  const key = () => 'k' + (n += 1)
  const bench = addTowerToBench([onBench(blocks[0], 'k0')], tower, [tower], blocks, key)
  assert.equal(bench.length, 2)
  assert.deepEqual(bench.map((entry) => entry.ref), ['a', 'b'])
  assert.equal(bench[1].tower, 't')
  // 再装一次：一块都不加
  assert.equal(addTowerToBench(bench, tower, [tower], blocks, key).length, 2)
})

test('迁移：与内置积木一致 ⇒ 一块积木；与塔拼接一致 ⇒ 那座塔；否则一块自定义块；空 ⇒ 空工作台', () => {
  const blocks = [block({ id: 'zh', first: '', text: '中文', checks: ['zh'] })]
  const tower = { id: 'rp', name: '套餐', items: [{ ref: 'zh' }] }
  let n = 0
  const makeKey = () => 'k' + (n += 1)
  const exact = migrateEveryTurn({ text: '中文', firstText: '', checks: ['zh'] }, { blocks, towers: [tower], makeKey })
  assert.deepEqual(exact.bench.map((entry) => entry.ref), ['zh'])
  assert.deepEqual(exact.benchTowers, {})
  // 塔的拼接结果（两块拼起来）不与任何单块一致 ⇒ 走塔那条分支
  const four = block({ id: 'four', text: '四段', checks: ['four'] })
  const two = { id: 'rp2', name: '两块塔', items: [{ ref: 'zh' }, { ref: 'four' }] }
  n = 0
  const viaTower = migrateEveryTurn({ text: '中文\n四段', firstText: '', checks: ['zh', 'four'] }, { blocks: [blocks[0], four], towers: [two], makeKey })
  assert.deepEqual(viaTower.bench.map((entry) => entry.ref), ['zh', 'four'])
  assert.equal(viaTower.bench[0].tower, 'rp2')
  assert.deepEqual(Object.keys(viaTower.benchTowers), ['rp2'])
  n = 0
  const custom = migrateEveryTurn({ text: '手写的', firstText: '首轮手写', checks: ['zh', 'four'] }, { blocks, towers: [tower], makeKey })
  assert.equal(custom.bench.length, 1)
  assert.equal(custom.bench[0].text, '手写的')
  assert.equal(custom.bench[0].first, '首轮手写')
  assert.deepEqual(custom.bench[0].checks, ['zh', 'four'])
  assert.deepEqual(migrateEveryTurn({ text: '', firstText: '', checks: [] }, { blocks, towers: [], makeKey }), { bench: [], benchTowers: {} })
})

test('内置预设 → 积木（firstText 变 first，overlaps 保留）', () => {
  const built = blockFromPreset({ id: 'four-section', name: '四段式', firstText: '', text: '四段', checks: ['zh', 'four', 'noLeak'], overlaps: ['zh-thinking'], desc: 'd' })
  assert.equal(built.id, 'four-section')
  assert.equal(built.first, '')
  assert.deepEqual(built.checks, ['zh', 'four', 'noLeak'])
  assert.deepEqual(built.overlaps, ['zh-thinking'])
  assert.equal(built.builtin, true)
})

test('面板那份副本与服务端一致（同样输入同样输出）', () => {
  const bench = [
    { ...onBench(block({ id: 'a', first: '首轮', text: '正文', checks: ['zh', 'four'] }), 'b1'), priority: true },
    onBench(block({ id: 'b', text: '第二块', checks: ['firstPerson'] }), 'b2'),
  ]
  assert.deepEqual(clientSide.compileBench(bench), compileBench(bench))
  const blocks = [block({ id: 'zh', text: '中文', checks: ['zh'] })]
  const tower = { id: 'rp', name: '套餐', items: [{ ref: 'zh' }] }
  const args = [{ text: '中文', firstText: '', checks: ['zh'] }, { blocks, towers: [tower], makeKey: () => 'k1' }]
  assert.deepEqual(clientSide.migrateEveryTurn(...args), migrateEveryTurn(...args))
  assert.deepEqual(clientSide.unionChecks(bench), unionChecks(bench))
  assert.deepEqual(clientSide.flattenTower(tower, [tower], blocks), flattenTower(tower, [tower], blocks))
  assert.equal(clientSide.PRIORITY_PREFIX, PRIORITY_PREFIX)
})

test('迁移：旧条目的 checks 是独立勾选的，认出内置积木 / 塔后不能被换成积木自带的 checks', async () => {
  const { everyTurnPresets, everyTurnTowers } = await import('../builtin-presets.js')
  const blocks = everyTurnPresets().map(blockFromPreset)
  const towers = everyTurnTowers()
  const zh = everyTurnPresets().find((preset) => preset.id === 'zh-thinking')
  assert.deepEqual(zh.checks, ['zh'])
  const tower = towers.find((entry) => entry.id === 'rp-pack')
  const towerFlat = compileBench(flattenTower(tower, towers, blocks).map((item, index) => benchBlockOf(item, 't' + index)))
  for (const impl of [{ migrateEveryTurn, compileBench }, clientSide]) {
    // 0.14 里套了「中文思考」、又手动取消了自动检查：checks = []。
    const single = impl.migrateEveryTurn({ text: zh.text, firstText: zh.firstText ?? '', checks: [] }, { blocks, towers })
    assert.equal(single.bench[0].ref, 'zh-thinking', '仍认成内置积木')
    assert.deepEqual(impl.compileBench(single.bench).checks, [], '迁移后 checks 保持旧值')
    assert.equal(single.bench[0].edited, true)
    // checks 一致时照旧原样认出，不标「改过」。
    const same = impl.migrateEveryTurn({ text: zh.text, firstText: zh.firstText ?? '', checks: ['zh'] }, { blocks, towers })
    assert.equal(same.bench[0].edited, false)
    // 塔：checks 拆不回单块 ⇒ 不一致时退成自定义块，文字和 checks 都不变。
    const fromTower = impl.migrateEveryTurn({ text: towerFlat.text, firstText: towerFlat.firstText, checks: ['zh'] }, { blocks, towers })
    assert.deepEqual(Object.keys(fromTower.benchTowers), [])
    const compiled = impl.compileBench(fromTower.bench)
    assert.deepEqual(compiled.checks, ['zh'])
    assert.equal(compiled.text, towerFlat.text)
  }
})
