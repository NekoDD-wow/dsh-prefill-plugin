// 界面重构 v1（UI 工作流 C）· 左栏：开关统一语义色、分类色只留 3px 色条、副文本内容状态点。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const cut = (from, to) => {
  const a = src.indexOf(from)
  const b = a < 0 ? -1 : src.indexOf(to, a)
  return a >= 0 && b > a ? src.slice(a, b) : ''
}
const switchSrc = cut('      const switchEl = (key, color) => {', '      // P0-4 / P1-9：每个左栏项')
const navSrc = cut('      const navItem = (key, paneId, color, parent) => {', '      const tabItem = (key, paneId, color, parent) => {')
const tabSrc = cut('      const tabItem = (key, paneId, color, parent) => {', '      // ── 头部三区')
const stateSrc = cut('      const NAV_GLYPH = { empty', '      const summaryDots = FEATURE_NAV')

test('开关：品牌 on / 灰 off（不再用分类色当开关色）', () => {
  assert.ok(switchSrc.length > 0, '找不到 switchEl')
  assert.match(switchSrc, /background: on \? 'var\(--dsw-alias-brand-primary\)' : 'var\(--pf-off\)'/)
  assert.doesNotMatch(switchSrc, /on \? color :/, '开关不再用传入的分类色')
  // 既有钩子 / 行为不动
  assert.match(switchSrc, /'data-prefill-enable': key/)
  assert.match(switchSrc, /role: 'switch'/)
})

test('分类色只保留色条：3px 色条仍在，停用时压暗；标题不再染分类色', () => {
  assert.ok(navSrc.length > 0, '找不到 navItem')
  assert.ok(navSrc.includes('color-mix(in srgb, ${color} 45%, var(--pf-off))'), '色条仍用分类色（停用压暗）')
  assert.match(navSrc, /width: 3, borderRadius: 2, background: stripe/)
  // 选中标题不再 color-mix(color 70%…)
  assert.doesNotMatch(navSrc, /color-mix\(in srgb, \$\{color\} 70%/)
  assert.match(navSrc, /color: off \? 'var\(--dsw-alias-label-tertiary\)' : 'var\(--dsw-alias-label-primary\)'/)
  // 窄屏标签：7px 分类点仍在（它是窄屏的色条替身）
  assert.match(tabSrc, /background: key === 'usage' \? 'var\(--dsw-alias-label-tertiary\)' : off \? 'var\(--pf-off\)' : color/)
})

test('副文本内容状态点：○ 空 / ● 已填 / ⚠ 冲突 / — 停用', () => {
  assert.ok(stateSrc.length > 0, '找不到状态点映射')
  assert.match(stateSrc, /const NAV_GLYPH = \{ empty: '○', filled: '●', conflict: '⚠', off: '—' \}/)
  assert.match(stateSrc, /const CONFLICT_PANE = \{ 'complete-section': 'system' \}/, '冲突标在系统提示这一项')
  assert.match(stateSrc, /if \(conflictPane === key\) return 'conflict'/)
  assert.match(stateSrc, /if \(!isOn\(key\) \|\| offBy\[key\] === true\) return 'off'/)
  assert.match(stateSrc, /return hasContent\[key\] === true \? 'filled' : 'empty'/)
  assert.match(navSrc, /'data-prefill-nav-dot': state/)
  assert.match(navSrc, /NAV_GLYPH\[state\]/)
})

test('副文本不再重复「已停用」（glyph 已表达）；随角色卡停用仍保留文字原因', () => {
  assert.doesNotMatch(navSrc, /navDisabled/, '开关关着不再拼 · 已停用')
  assert.match(navSrc, /offBy\[key\] === true \? ` · \$\{t\('navOffByCard'\)\}` : ''/)
})

test('变化签名不受影响：glyph 不进 navStatus / navSignature 仍用原 parts', () => {
  assert.match(navSrc, /h\(RollText, \{ value: nodeText\(parts\), still: rollStill, defer: turnEnded, block: true \}, \.\.\.parts\)/)
  assert.doesNotMatch(navSrc, /navSignature\(/, 'navSignature 只在左栏签名块里调用一次')
})
