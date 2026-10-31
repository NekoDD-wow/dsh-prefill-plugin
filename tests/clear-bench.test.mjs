// #23：工作台删空后每轮注入要真的停 —— 以前 writeEveryTurn 在没有 bench 时回落 stale 的
// text / firstText，导致台上 0 块但旧文本照样每轮发、面板还没有入口能删。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const start = src.indexOf('      const setBench = (nextBench, nextTowers, immediate = true) => {')
const end = src.indexOf('\n      }', start) + '\n      }'.length
assert.ok(start > 0 && end > start, '找不到 setBench 段')
const fnSrc = src.slice(start, end)

const build = (bench, benchTowers, calls) =>
  new Function('bench', 'benchTowers', 'editEveryTurn', fnSrc + '\nreturn setBench')(bench, benchTowers, (patch) => calls.push(patch))

test('删掉最后一块：写回时清空 text / firstText / checks，注入停掉', () => {
  const calls = []
  const setBench = build([{ key: 'k1', ref: 'zh', text: '思维链用中文' }], {}, calls)
  setBench([], {})
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].bench, [])
  assert.equal(calls[0].text, '')
  assert.equal(calls[0].firstText, '')
  assert.deepEqual(calls[0].checks, [])
})

test('还有块时不清 text（照旧交给 compileBench）', () => {
  const calls = []
  const setBench = build([{ key: 'k1' }], {}, calls)
  setBench([{ key: 'k2' }], {})
  assert.equal(calls.length, 1)
  assert.equal('text' in calls[0], false)
  assert.deepEqual(calls[0].bench, [{ key: 'k2' }])
})
