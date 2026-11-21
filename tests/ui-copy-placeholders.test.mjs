// 用户可见文案：开发占位不能漏到界面上；README 功能说明跟上 0.21 的术语。
// - 状态 popover「模型」行的 tooltip（statusModelUnknown）原来是实现备注「—（v2 接 summary.model）」/「— (v2: summary.model)」。
// - README「首轮锁定」一节仍写旧术语「头部徽章显示「首轮未发 / 已锁定」」—— 0.21 已改「首轮未发送」，独立徽章也并进了卡片头部状态胶囊。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')

test('状态 popover「模型」行 tooltip：zh / en 都不含实现备注（v2 / summary.model）', () => {
  const values = [...src.matchAll(/statusModelUnknown: '([^']*)'/g)].map((m) => m[1])
  assert.equal(values.length, 2, 'zh + en 两份')
  for (const value of values) {
    assert.doesNotMatch(value, /v2|summary\.model/, `用户可见文案里不该有实现备注：${value}`)
    assert.notEqual(value.trim(), '', 'tooltip 不能为空')
  }
})

test('README：不再写旧术语「首轮未发 / 已锁定」与「头部徽章」，改为状态胶囊「首轮未发送 / 已锁定」', () => {
  assert.doesNotMatch(readme, /「首轮未发 \//)
  assert.doesNotMatch(readme, /头部徽章显示/)
  assert.match(readme, /状态胶囊显示「首轮未发送 \/ 已锁定」/)
})
