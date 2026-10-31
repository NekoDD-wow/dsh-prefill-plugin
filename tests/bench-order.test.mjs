// #22：工作台显示顺序（塔成员合并成一行）≠ bench 数组顺序（= 注入顺序）。
// ↑↓ / 拖动以前按 bench 下标算，会把普通块一步挪进塔组、或落位错乱。
// 现在移动以「显示行」为单位，落位后归一化 bench 顺序 = 显示顺序 = 注入顺序。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const start = src.indexOf('      const benchDisplayRows = () => {')
const end = src.indexOf('      const addTowerToBenchNow', start)
assert.ok(start > 0 && end > start, '找不到 bench 显示行 / 移动函数段')
const region = src.slice(start, end)

const T = 'rp'
const block = (key, tower = null) => ({ key, ref: key, tower })
const initial = () => [block('A'), block('t1', T), block('t2', T), block('B')]
const harness = (bench, capture) =>
  new Function('bench', 'setBench', region + '\nreturn { benchDisplayRows, moveBenchBlock, moveBlockTo }')(bench, (next) => capture.push(next))
const keys = (list) => list.map((item) => item.key)

test('显示行：塔成员合并成一行、普通块各自一行；行序 = 第一次出现顺序', () => {
  const h = harness(initial(), [])
  assert.deepEqual(h.benchDisplayRows().map(keys), [['A'], ['t1', 't2'], ['B']])
})

test('↑↓ 按显示行移动：A 下移 ⇒ A 落到整座塔后面，不跳进塔组', () => {
  const calls = []
  const h = harness(initial(), calls)
  h.moveBenchBlock('A', 1)
  assert.deepEqual(keys(calls[0]), ['t1', 't2', 'A', 'B'])
  // 新顺序的显示展开 = 注入顺序
  const after = harness(calls[0], [])
  assert.deepEqual(keys(after.benchDisplayRows().flat()), ['t1', 't2', 'A', 'B'])
})

test('塔里的块只在塔框内换位；到边界不再往外跳', () => {
  const calls = []
  const h = harness(initial(), calls)
  h.moveBenchBlock('t2', 1)
  assert.equal(calls.length, 0, '塔内最后一块再往下 = 不动')
  h.moveBenchBlock('t1', 1)
  assert.deepEqual(keys(calls[0]), ['A', 't2', 't1', 'B'])
})

test('向上移动越过塔组：塔整行后移', () => {
  const calls = []
  const h = harness(initial(), calls)
  h.moveBenchBlock('B', -1)
  assert.deepEqual(keys(calls[0]), ['A', 'B', 't1', 't2'])
})

test('拖动按落点那块（before）落位，null = 放末尾', () => {
  const calls = []
  const h = harness(initial(), calls)
  h.moveBlockTo('A', 'B', null) // 拖到 B 之前
  assert.deepEqual(keys(calls[0]), ['t1', 't2', 'A', 'B'])
  const calls2 = []
  const h2 = harness(initial(), calls2)
  h2.moveBlockTo('B', 'A', null) // 拖到最前
  assert.deepEqual(keys(calls2[0]), ['B', 'A', 't1', 't2'])
})

// 只改移动不改渲染的话，「显示顺序 = 注入顺序」仍然不成立：bench [A, t1, t2, B] 在面板上渲染成
// A / B / 塔框[t1, t2]（普通块被并成一组），按 B 的 ↓ 后 bench 变成 [A, t1, t2, B] 的另一种排列、
// 面板却纹丝不动 —— 用户看不见的变化偷偷改了注入顺序。这里把 benchRows 也挂到同一套显示行上。
test('渲染和移动共用行模型：渲染顺序 = 显示行顺序 = bench 顺序（交错的历史数据也一样）', () => {
  const dStart = src.indexOf('      const benchDisplayRows = () => {')
  const dEnd = src.indexOf('      const moveBenchBlock', dStart)
  const rStart = src.indexOf('      const benchRows = () => {')
  const rEnd = src.indexOf('      // ── v0.15：工作台的渲染件', rStart)
  assert.ok(dStart > 0 && dEnd > dStart && rStart > 0 && rEnd > rStart, '找不到 benchDisplayRows / benchRows')
  const towers = { [T]: { ref: T, name: '塔', collapsed: false } }
  const build = (bench) =>
    new Function(
      'bench',
      'benchTowers',
      'h',
      't',
      'benchCard',
      'benchColor',
      'toggleTowerCollapsed',
      'removeTowerFromBench',
      'V',
      src.slice(dStart, dEnd) + '\n' + src.slice(rStart, rEnd) + '\nreturn { benchDisplayRows, benchRows }',
    )(bench, towers, (tag, props, ...children) => ({ tag, props, children }), (key) => key, (item) => ({ card: item.key }), () => '#000', () => {}, () => {}, { row: {}, btnGhost: {} })
  const rendered = (rows) => {
    const out = []
    const walk = (node) => {
      if (Array.isArray(node)) {
        for (const item of node) walk(item)
        return
      }
      if (node === null || typeof node !== 'object') return
      if (typeof node.card === 'string') {
        out.push(node.card)
        return
      }
      walk(node.children)
    }
    walk(rows)
    return out
  }
  const cases = [
    initial(), // 普通块在前：A / B / 塔
    [block('A'), block('B'), block('t1', T), block('t2', T)], // 常见形状
    [block('t1', T), block('t2', T), block('A')], // 塔在前
  ]
  for (const bench of cases) {
    const got = build(bench)
    const model = keys(got.benchDisplayRows().flat())
    assert.deepEqual(rendered(got.benchRows()), model, '渲染顺序应等于显示行顺序：' + JSON.stringify(model))
    assert.deepEqual(model, keys(bench), '显示行顺序应等于 bench 顺序：' + JSON.stringify(keys(bench)))
  }
})
