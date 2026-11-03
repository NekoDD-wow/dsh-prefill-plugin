// 界面重构 v1（UI 工作流 C）· 三个语义缺陷：顶栏徽标 turns 缺失、观察档拦截数、沙盒关着时的停用态。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const cut = (from, to) => {
  const a = src.indexOf(from)
  const b = a < 0 ? -1 : src.indexOf(to, a)
  return a >= 0 && b > a ? src.slice(a, b) : ''
}
const badgeSrc = cut('    function SessionModeBadge(props) {', '\n    return {')
const injectSrc = cut('      const injectSection = h(', '      const usageSection = h(')
const summaryFnSrc = cut('    function sandboxSummary(t, view) {', '    /** 实验面板')

test('缺陷 #3 顶栏徽标：turns 缺失但已写入历史 ⇒ 已开跑，不回退「写入历史」', () => {
  assert.ok(badgeSrc.length > 0, '找不到 SessionModeBadge')
  assert.match(badgeSrc, /const turns = live\?\.turns\?\.\[sessionId\] \?\? 0/)
  assert.match(badgeSrc, /const materialized = live\?\.materialized\?\.\[sessionId\] \?\? 0/)
  assert.match(badgeSrc, /const started = turns > 0 \|\| materialized > 0/)
  assert.match(badgeSrc, /const modeText = started \? t\('itemsAfterRun'\) : t\('modeHistory'\)/)
  assert.doesNotMatch(badgeSrc, /turns > 0 \? t\('itemsAfterRun'\)/)
})

test('缺陷 #5 观察档：sandboxSummary 不报「拦 N」（受控 / 严格照旧）', () => {
  assert.ok(summaryFnSrc.length > 0, '找不到 sandboxSummary')
  const sandboxSummary = new Function('t', 'sbxLevelLabel', summaryFnSrc + '; return sandboxSummary')(
    (key) => key,
    (t, level) => t(level === 'controlled' ? 'sbxLevelControlled' : level === 'strict' ? 'sbxLevelStrict' : 'sbxLevelObserve'),
  )
  assert.deepEqual(sandboxSummary((key) => key, { level: 'observe', blocked: 3, unassigned: [] }), { level: 'observe', blocked: 0, pending: 0, text: 'sbxLevelObserve' }, '观察档不显示拦截数')
  assert.equal(sandboxSummary((key) => key, { level: 'controlled', blocked: 3, unassigned: [] }).blocked, 3, '受控档照旧')
  assert.equal(sandboxSummary((key) => key, { level: 'strict', blocked: 2, unassigned: [{ name: 'x' }] }).blocked, 2, '严格档照旧')
  assert.equal(sandboxSummary((key) => key, null), null)
})

test('缺陷 #5 一致性：左栏 inject 状态 / 总览 pill 用同一口径（blocked 已归零）', () => {
  // 左栏直接用 sbxSummary.blocked（已被 sandboxSummary 归零），不再各自判断档位
  assert.match(src, /inject: sbxSummary !== null \? \[B\(sbxLevelLabel\(t, sbxSummary\.level\)\), sbxSummary\.blocked > 0 \?/)
  // 总览 pill 对观察档 / 未设档位（默认 observe）不拼「拦 N」
  assert.match(src, /row\.blocked > 0 && row\.level !== 'observe' && row\.level !== '' \? ' · ' \+ t\('sbxBlockedN'\)/)
})

test('缺陷 #14 沙盒开关关着：inject 节只渲染停用说明，不渲染完整可用控件', () => {
  assert.ok(injectSrc.length > 0, '找不到 injectSection')
  assert.match(injectSrc, /off: !isOn\('inject'\)/, '停止黄条照旧')
  assert.match(injectSrc, /isOn\('inject'\)\s*\?\s*h\(SandboxSection, \{ t, sessionId \}\)/)
  assert.match(injectSrc, /'data-prefill-sbx-disabled': '1'/)
  assert.match(injectSrc, /t\('sbxOffTitle'\)/)
  assert.match(injectSrc, /t\('sbxOffBody'\)/)
  // 关着时不再挂 SandboxSection
  const offBranch = injectSrc.slice(injectSrc.indexOf(': h('))
  assert.doesNotMatch(offBranch, /h\(SandboxSection/)
})

test('停用态文案成对（zh / en 字典都在）', () => {
  for (const key of ['sbxOffTitle', 'sbxOffBody', 'statusModelUnknown', 'kpiBlockedTip']) {
    assert.equal((src.match(new RegExp('\\n\\s+' + key + ": '", 'g')) ?? []).length, 2, key + ' 需要 zh + en 两份')
  }
})
