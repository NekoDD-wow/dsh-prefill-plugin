// 界面重构 v1（UI 工作流 C）· 芯片：8 彩点 → 1 状态点 +「已配置 N/8」；tooltip 明细保留；后台闪唯一点。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const cut = (from, to) => {
  const a = src.indexOf(from)
  const b = a < 0 ? -1 : src.indexOf(to, a)
  return a >= 0 && b > a ? src.slice(a, b) : ''
}
const chipSrc = cut('    function PrefillToggle(props) {', '    function fallbackName(')
const dockSrc = cut('    function PrefillDock(props) {', '    function UsagePanel(props) {')
const summarySrc = cut('      const summaryDots = FEATURE_NAV.map', '      const switchEl = (key, color) => {')

test('摘要对象：保留 dots（标记用），新增 status = { tone, configured, total }', () => {
  assert.ok(summarySrc.length > 0, '找不到芯片摘要片段')
  assert.match(summarySrc, /const summaryDots = FEATURE_NAV\.map/)
  assert.match(summarySrc, /const configuredN = summaryDots\.filter\(\(dot\) => dot\.on && dot\.filled\)\.length/)
  assert.match(summarySrc, /const summaryTone = conflict !== undefined \? 'warn' : configuredN === FEATURE_NAV\.length \? 'full' : configuredN > 0 \? 'partial' : 'empty'/)
  assert.match(summarySrc, /status: \{ tone: summaryTone, configured: configuredN, total: FEATURE_NAV\.length \}/)
  assert.match(summarySrc, /marker: cardOpen && shrunk/, '标记逻辑不变')
})

test('芯片：1 个状态点 +「已配置 N/8」，不再按 key 画 8 个彩点', () => {
  assert.ok(chipSrc.length > 0, '找不到 PrefillToggle')
  assert.equal((chipSrc.match(/'data-prefill-chip-dot'/g) ?? []).length, 1, '只声明 1 个状态点')
  assert.doesNotMatch(chipSrc, /summary\.dots\.map/, '不再遍历 8 个分类点')
  assert.match(chipSrc, /'data-prefill-chip-dot': 'status'/)
  assert.match(chipSrc, /'data-state': chipStatus\.tone/)
  assert.match(chipSrc, /'data-prefill-chip-dots': '1'/, '旧钩子保留')
  assert.match(chipSrc, /'data-prefill-chip-status': chipStatus\.tone/)
  assert.match(chipSrc, /'data-prefill-chip-configured': `\$\{chipStatus\.configured\}\/\$\{chipStatus\.total\}`/)
  assert.match(chipSrc, /t\('chipConfigured'\)/)
  // 4 种 tone 的语义色：full=success / partial=brand / warn=warn / empty=灰
  assert.match(chipSrc, /chipStatus\.tone === 'full'/)
  assert.match(chipSrc, /chipStatus\.tone === 'partial'/)
  assert.match(chipSrc, /chipStatus\.tone === 'warn'/)
  assert.match(chipSrc, /var\(--pf-off\)/)
})

test('tooltip 逐项明细保留（title 里拼 summary.tip）；fallback 补「点开卡片开始配置」', () => {
  assert.match(chipSrc, /const title = on \? `\$\{t\('chipCardTip'\)\}\$\{summary\?\.tip \? `\\n\$\{summary\.tip\}` : ''\}`/)
  assert.match(chipSrc, /: `\$\{t\('prefillTitleOff'\)\}\\n\$\{t\('chipFallbackTip'\)\}`/)
})

test('后台变化：只闪那一个状态点（不再按 key 找点）', () => {
  assert.match(chipSrc, /querySelector\('\[data-prefill-chip-dot\]'\) \?\? null, DOT_FLASH/)
  assert.doesNotMatch(chipSrc, /data-prefill-chip-dot="\$\{key\}"/)
  assert.match(chipSrc, /cueKey: 'chip:status'/)
})

test('紧凑（钉住）分支不变：不画点、不画预设名', () => {
  const compactBranch = chipSrc.slice(chipSrc.indexOf('summary !== undefined && compact'), chipSrc.indexOf(': summary === undefined'))
  assert.match(compactBranch, /'data-prefill-chip-pinned': ''/)
  assert.doesNotMatch(compactBranch, /data-prefill-chip-dot|summary\.name/)
})

test('钉住标记 v1 也只画 1 个语义点（data-prefill-marker-dot 只有一个，带 tone 值）', () => {
  assert.match(dockSrc, /'data-prefill-marker-dot': summaryTone/)
  assert.doesNotMatch(dockSrc, /'data-prefill-marker-dot': dot\.key/)
})
