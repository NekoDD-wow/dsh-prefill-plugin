// #25：旧预设迁移出的角色卡选项（cardRefOf 的 legacy）在改「我的名字」后必须继续传给编译，
// 否则 refreshCardLayer 传 null 会按默认值重编译 ⇒ 纯角色扮演变追加、中文/第一人称检查项清空、自动变一直注入。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const start = src.indexOf('      const refreshCardLayer = async (userName) => {')
const end = src.indexOf('      /** 角色卡在每轮注入 / 系统提示里的几个选项', start)
assert.ok(start > 0 && end > start, '找不到 refreshCardLayer 段')
const body = src.slice(start, end)

test('改名字时保留旧预设迁移出的卡片选项（legacy）', () => {
  assert.match(body, /const parsed = cardRefOf\(appliedRef\)/)
  assert.match(body, /compileCardLayer\(ref, parsed\.legacy\)/)
  assert.doesNotMatch(body, /compileCardLayer\(ref, null\)/, '传 null 会丢掉 legacy → 配置被重置')
})
