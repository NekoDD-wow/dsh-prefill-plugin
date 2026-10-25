// 导入预设文件：只有开场条目的裸数组也要能导入（服务端 import 认 `parsed.items ?? parsed`）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('面板导入：裸数组包成 { name, items }，不直接 spread', () => {
  const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  assert.match(src, /const json = Array\.isArray\(parsed\) \? \{ name, items: parsed \} : \{ \.\.\.parsed, name \}/)
  assert.doesNotMatch(src, /op: 'import', name, json: \{ \.\.\.parsed, name \}/)
  // 直接 spread 数组会把条目摊成数字键：服务端拿不到 items[]。
  const parsed = [{ role: 'user', text: 'hi' }]
  assert.equal(Array.isArray({ ...parsed, name: 'x' }.items), false)
})
