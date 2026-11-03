// 常驻提示：会话被勾进「生效会话」且至少一个开发者开关为 true 时，输入框芯片旁显示一个小标。
// 纯函数 devInterventionOf 从 client.js 切出来直接跑；另外用源码断言保证 UI 与文案接上了。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const cut = (head, tail) => {
  const at = src.indexOf(head)
  assert.ok(at > 0, '找不到源码段：' + head)
  return src.slice(at, src.indexOf(tail, at))
}
const loadHelper = () => {
  const body = cut('function devInterventionOf(', 'function PrefillToggle(props) {')
  // eslint-disable-next-line no-new-func
  return new Function(body + '\nreturn devInterventionOf')(  )
}

test('devInterventionOf：只有 armed + 至少一个开关 true 才算干预', () => {
  const devInterventionOf = loadHelper()
  assert.deepEqual(devInterventionOf(true, { blockTools: true }, false), ['blockTools'])
  assert.deepEqual(devInterventionOf(true, { probeSection: true, blockMessages: true }, false), ['probeSection', 'blockMessages'])
  assert.deepEqual(devInterventionOf(false, { blockTools: true }, false), [], '没勾生效会话不算')
  assert.deepEqual(devInterventionOf(true, { blockTools: false }, false), [], '开关全关不算')
  assert.deepEqual(devInterventionOf(true, null, false), [])
  assert.deepEqual(devInterventionOf(true, { blockTools: true }, true), [], '待生效时交给 Q9 角标，避免两颗标')
})

test('芯片渲染接上常驻标与文案（zh / en 都有键）', () => {
  const toggle = cut('function PrefillToggle(props) {', 'function fallbackName(')
  // 数据来源从「自己轮询整封 envelope」换成模块级 summary store（规划 §2.2）：读法不变，变量叫 live。
  assert.match(toggle, /devInterventionOf\(sessionArmed, live\?\.state\?\.levers \?\? \{\}, pendingHere\)/)
  assert.match(toggle, /'data-prefill-dev-badge': devActive\.join\(', '\)/)
  assert.match(toggle, /t\('devBadge'\)/)
  assert.match(toggle, /t\('devBadgeTip'\)/)
  const zh = cut('const zh = {', 'const en = {')
  const en = cut('const en = {', 'const SBX_TEXT = {')
  for (const dict of [zh, en]) {
    assert.match(dict, /devBadge: '/)
    assert.match(dict, /devBadgeTip: '/)
  }
})
