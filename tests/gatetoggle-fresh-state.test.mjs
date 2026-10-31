// #26：GateToggle 关闭「阻断注入」时不能拿 2.5s 轮询的旧快照整表回写 sessionTools / armed，
// 否则刚在注入改写面板写好的会话工具白名单会被抹掉（窗口约 2.5s）。修法：写之前先取最新 state。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const start = src.indexOf('      const write = async (mode, markSeen) => {')
const end = src.indexOf('      // Q9：只在', start)
assert.ok(start > 0 && end > start, '找不到 GateToggle write 段')
const body = src.slice(start, end)

test('写之前先取最新 state，并用它组 patch（不用渲染时快照）', () => {
  assert.match(body, /await call\(undefined\)/, '必须先取最新 state')
  assert.match(body, /base\?\.sessionTools/, 'sessionTools 用最新 state')
  assert.match(body, /base\?\.armed/, 'armed 用最新 state')
  assert.doesNotMatch(body, /state\?\.sessionTools/, '不能再用旧快照的 sessionTools')
  assert.doesNotMatch(body, /gate: \{ \.\.\.gate,/, 'gate 也不能用旧快照')
})

test('注入改写面板写完后广播状态，其他组件不必等 2.5s 轮询', () => {
  for (const fn of ['const toggleAllow = (kind) => {', 'const writeTools = (list) => {', 'const toggleBlock = (key, group, name) => {']) {
    const at = src.indexOf(fn)
    assert.ok(at > 0, fn)
    const block = src.slice(at, src.indexOf('\n      }', at))
    assert.match(block, /notifyStateChanged\(\)/, fn + ' 写完要广播')
  }
})
