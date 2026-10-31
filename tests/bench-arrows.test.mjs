// 工作台 ↑↓：按钮能不能点，必须和点了怎么动用同一套「显示行」规则。
// 以前 disabled 按 bench 下标算、移动按 benchDisplayRows 算 ⇒ 塔框首块的 ↑ / 尾块的 ↓ 亮着、点了没反应；
// tower 指向 benchTowers 里不存在的塔（孤儿）时渲染成散卡，benchDisplayRows 却把它们并成一行 ⇒ ↑ 无效、邻块 ↓ 一次跳几块；
// 相邻的散块也被并成一行 ⇒ 紧挨塔上方的散块按 ↓ 没反应。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const cut = (a, b) => {
  const s = src.indexOf(a)
  const e = src.indexOf(b, s)
  assert.ok(s > 0 && e > s, '找不到源码段：' + a)
  return src.slice(s, e)
}
const region = cut('      const benchDisplayRows = () => {', '      const addTowerToBenchNow')
const rowsSrc = cut('      const benchRows = () => {', '      // ── v0.15：工作台的渲染件')
// 从源码里取真实的 disabled 表达式，免得测的是自己抄的逻辑。
const upDis = src.match(/disabled: (.+?), title: t\('benchMoveUp'\)/)
const downDis = src.match(/disabled: (.+?), title: t\('benchMoveDown'\)/)
assert.ok(upDis && downDis, '源码里没找到 ↑↓ 的 disabled 表达式')

const T = 'rp'
const towersOf = (...ids) => Object.fromEntries(ids.map((id) => [id, { ref: id, name: id, collapsed: false }]))
const b = (key, tower = null) => ({ key, ref: key, tower })
const keys = (list) => list.map((item) => item.key)

const harness = (bench, benchTowers) => {
  const calls = []
  const api = new Function(
    'bench',
    'benchTowers',
    'setBench',
    region +
      '\nreturn { benchDisplayRows, moveBenchBlock, disabledOf: (block) => { const index = bench.findIndex((item) => item.key === block.key); return { up: ' +
      upDis[1] +
      ', down: ' +
      downDis[1] +
      ' } } }',
  )(bench, benchTowers, (next) => calls.push(next))
  return { ...api, calls, disabled: (key) => api.disabledOf(bench.find((item) => item.key === key)) }
}
/** 点一下 key 的 ↑ / ↓：返回新 bench 的 key 序；没调 setBench 返回 null。 */
const click = (bench, towers, key, delta) => {
  const h = harness(bench, towers)
  h.moveBenchBlock(key, delta)
  return h.calls.length === 0 ? null : keys(h.calls[0])
}
const rendered = (bench, benchTowers) => {
  const out = []
  const walk = (node) => {
    if (Array.isArray(node)) return void node.forEach(walk)
    if (node === null || typeof node !== 'object') return
    if (typeof node.card === 'string') return void out.push(node.card)
    walk(node.children)
  }
  const benchRows = new Function('bench', 'benchTowers', 'h', 't', 'benchCard', 'benchColor', 'toggleTowerCollapsed', 'removeTowerFromBench', 'V', 'setBench',
    cut('      const benchDisplayRows = () => {', '      const moveBlockTo') + '\n' + rowsSrc + '\nreturn benchRows')(
    bench, benchTowers, (tag, props, ...children) => ({ tag, props, children }), (k) => k, (x) => ({ card: x.key }), () => '#000', () => {}, () => {}, { row: {}, btnGhost: {} }, () => {})
  walk(benchRows())
  return out
}

test('塔框首块的 ↑、尾块的 ↓ 禁用（点了也不动）；框内换位照常', () => {
  const towers = towersOf(T)
  const bench = [b('A'), b('t1', T), b('t2', T), b('B')]
  const h = harness(bench, towers)
  assert.equal(h.disabled('t1').up, true, 't1 的 ↑ 应禁用（框首不往外跳）')
  assert.equal(h.disabled('t2').down, true, 't2 的 ↓ 应禁用（框尾不往外跳）')
  assert.equal(click(bench, towers, 't1', -1), null)
  assert.equal(click(bench, towers, 't2', 1), null)
  assert.equal(h.disabled('t1').down, false)
  assert.deepEqual(click(bench, towers, 't1', 1), ['A', 't2', 't1', 'B'])
  assert.equal(h.disabled('A').up, true)
  assert.equal(h.disabled('B').down, true)
})

test('孤儿塔（tower 不在 benchTowers）：按散块处理，和渲染成散卡一致', () => {
  const bench = [b('A'), b('x1', 'gone'), b('x2', 'gone')]
  const h = harness(bench, {})
  assert.deepEqual(rendered(bench, {}), ['A', 'x1', 'x2'])
  assert.deepEqual(h.benchDisplayRows().map(keys), [['A'], ['x1'], ['x2']], '显示行应和渲染一样是三张散卡')
  assert.equal(h.disabled('x1').up, false)
  assert.deepEqual(click(bench, {}, 'x1', -1), ['x1', 'A', 'x2'], 'x1 ↑ 和 A 换位')
  assert.deepEqual(click(bench, {}, 'A', 1), ['x1', 'A', 'x2'], 'A ↓ 只走一步')
  assert.equal(h.disabled('x2').down, true)
})

test('相邻散块各自一行：紧挨塔上方的散块 ↓ 越过整座塔', () => {
  const towers = towersOf(T)
  const bench = [b('A'), b('B'), b('t1', T), b('t2', T)]
  const h = harness(bench, towers)
  assert.deepEqual(h.benchDisplayRows().map(keys), [['A'], ['B'], ['t1', 't2']])
  assert.equal(h.disabled('B').down, false)
  assert.deepEqual(click(bench, towers, 'B', 1), ['A', 't1', 't2', 'B'])
  assert.deepEqual(click(bench, towers, 'A', 1), ['B', 'A', 't1', 't2'])
})

test('任意形状：按钮可点 ⇔ 点了真的改顺序；显示行展开 = 渲染顺序 = bench 顺序', () => {
  const towers = towersOf(T, 'q')
  const cases = [
    [b('A'), b('t1', T), b('t2', T), b('B')],
    [b('t1', T), b('t2', T), b('t3', T)],
    [b('t1', T), b('A'), b('t2', T)], // 同一个塔被散块隔开
    [b('t1', T), b('q1', 'q'), b('q2', 'q'), b('A')], // 两座塔相邻
    [b('A'), b('x1', 'gone'), b('t1', T), b('x2', 'gone'), b('t2', T), b('t3', T)],
    [b('s', T), b('A'), b('B')], // 单块塔
  ]
  for (const bench of cases) {
    const h = harness(bench, towers)
    const label = JSON.stringify(bench.map((x) => x.key + (x.tower ? '@' + x.tower : '')))
    assert.deepEqual(keys(h.benchDisplayRows().flat()), keys(bench), label)
    assert.deepEqual(rendered(bench, towers), keys(bench), label)
    for (const { key } of bench) {
      for (const [delta, dir] of [[-1, 'up'], [1, 'down']]) {
        const next = click(bench, towers, key, delta)
        assert.equal(h.disabled(key)[dir], next === null, label + ' ' + key + ' ' + dir + '：disabled 应 ⇔ 点了不动')
        if (next !== null) assert.notDeepEqual(next, keys(bench), label + ' ' + key + ' ' + dir + '：点了应改变顺序')
      }
    }
  }
})
