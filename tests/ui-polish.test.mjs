// v1.1 polish（task-9）：用量大数单位 K/M/G、表格横滚、暗色一致、标记 keyframes 外移、a11y、芯片 fallback 提示。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const cut = (from, to) => {
  const a = src.indexOf(from)
  const b = a < 0 ? -1 : src.indexOf(to, a)
  return a >= 0 && b > a ? src.slice(a, b) : ''
}
/** 4 空格缩进的函数体：从 `function name(` 到下一个 `\n    }\n`。 */
const fnSrc = (name) => {
  const at = src.indexOf(`    function ${name}(props) {`)
  if (at < 0) return ''
  const end = src.indexOf('\n    }\n', at)
  return end < 0 ? '' : src.slice(at, end + 7)
}
const dockSrc = cut('    function PrefillDock(props) {', '    function UsagePanel(props) {')
const usageSrc = fnSrc('UsagePanel')
const fmtSrc = cut('    function fmt(value) {', '    async function postJson(')

test('fmt：大数自动 K / M / G（一位小数），不再出现 1185933.7K', () => {
  assert.ok(fmtSrc.length > 0, '找不到 fmt')
  const fmt = new Function(fmtSrc + '; return fmt')()
  assert.equal(fmt(0), '0')
  assert.equal(fmt(999), '999')
  assert.equal(fmt(1000), '1.0K')
  assert.equal(fmt(1234), '1.2K')
  assert.equal(fmt(12345), '12.3K')
  assert.equal(fmt(1185933), '1.2M', '六位数进 M 档，不会输出 1185.9K')
  assert.equal(fmt(1185933.7), '1.2M')
  assert.equal(fmt(1234567), '1.2M')
  assert.equal(fmt(2500000000), '2.5G')
  assert.equal(fmt(Number.NaN), '—')
  assert.equal(fmt(undefined), '—')
  // 边界：999.96K 四舍五入会变 1000.0K ⇒ 升 M 档
  assert.equal(fmt(999960), '1.0M')
})

test('UsagePanel：数字全走 fmt，表格外层横向滚动 + 最小宽度（1440 / 窄屏都不硬挤）', () => {
  assert.ok(usageSrc.length > 0, '找不到 UsagePanel')
  for (const field of ['total.input', 'total.cacheRead', 'total.output', 'row.input', 'row.cacheRead', 'row.output']) {
    assert.ok(usageSrc.includes(`fmt(${field})`), '漏了 fmt：' + field)
  }
  assert.ok(usageSrc.includes("overflowX: 'auto'"), '容器要能横向滚动')
  assert.ok(usageSrc.includes("'data-prefill-usage-scroll': ''"))
  assert.ok(usageSrc.includes('minWidth: 560'), '表格给最小宽度（窄屏横向滚动而不是压扁列）')
  assert.ok(usageSrc.includes("'data-prefill-usage-table': ''"))
})

test('暗色一致：every-turn「第 1 轮…」行改成边框 + 透明底（不再整宽 layer-2 浅底块）', () => {
  const row = cut("'data-prefill-bench-cost-row': ''", '}\n')
  const styleSrc = cut('h(\n          \'div\',\n          { style: { ...V.row, gap: 8, alignItems: \'center\', marginTop: 10', "'data-prefill-bench-cost-row': '' }")
  assert.ok(styleSrc.length > 0, '找不到 bench cost 行')
  assert.ok(styleSrc.includes("border: '1px solid var(--dsw-alias-border-l1)'"))
  assert.ok(styleSrc.includes("background: 'transparent'"))
  assert.ok(!styleSrc.includes("background: 'var(--dsw-alias-bg-layer-2)'"), '不再用主题不一的 layer-2 整宽底块')
  assert.ok(row.length >= 0)
})

test('标记：keyframes 移出 button（aria / textContent 不含 @keyframes），保留 1 点 + N/8', () => {
  assert.ok(dockSrc.length > 0, '找不到 PrefillDock')
  assert.match(dockSrc, /shrunk && motion !== 'off'\n\s+\? h\('style', \{ key: 'marker-keyframes' \}, '@keyframes dsh-prefill-pop/)
  // 按钮内部不再挂 style（原来在 children 里）
  assert.doesNotMatch(dockSrc, /motion === 'off' \? null : h\('style', null, '@keyframes/)
  assert.match(dockSrc, /'data-prefill-marker': '1'/)
  assert.match(dockSrc, /'data-prefill-marker-dot': summaryTone/)
  assert.match(dockSrc, /`\$\{configuredN\}\/\$\{FEATURE_NAV\.length\}`/)
  assert.match(dockSrc, /title: t\('markerTip'\)/)
  assert.match(dockSrc, /'aria-label': t\('markerTip'\)/)
})

test('a11y：错误详情关闭按钮有 aria-label；卡片关闭 / Esc 后焦点回芯片', () => {
  const dismisses = src.match(/data-prefill-error-detail-dismiss': '', 'aria-label': t\('errDismiss'\)/g) ?? []
  assert.equal(dismisses.length, 2, '卡片错误详情 + 设置页节错误详情都要 aria-label')
  assert.match(dockSrc, /const focusChipBack = React\.useCallback/)
  assert.match(dockSrc, /document\.querySelector\('\[data-prefill-chip\]'\)/)
  assert.match(dockSrc, /chip\.focus\(\{ preventScroll: true \}\)/)
  assert.match(dockSrc, /closeCard\(\)\n\s+focusChipBack\(\)/, 'closeCardFully 关闭后还焦点')
  assert.match(dockSrc, /if \(!pinned\) \{\n\s+closeCard\(\)\n\s+focusChipBack\(\)\n\s+\}/, 'Esc 关闭也还焦点')
})

test('TOC 当前项：aria-current 之外有可见高亮（左边条 + 字重）', () => {
  const activeSrc = cut('      tocLinkActive: {', '      },\n      // v1：总览顶部的 4 个 KPI')
  assert.ok(activeSrc.length > 0, '找不到 tocLinkActive')
  assert.ok(activeSrc.includes("boxShadow: 'inset 2px 0 0 var(--dsw-alias-brand-primary)'"), '左边条')
  assert.ok(activeSrc.includes('fontWeight: 700'), '加粗')
})

test('芯片 fallback：tooltip 补「点开卡片开始配置」，zh / en 成对', () => {
  assert.equal((src.match(/\n\s+chipFallbackTip: '/g) ?? []).length, 2)
  assert.match(src, /chipFallbackTip: '点开卡片开始配置'/)
  assert.match(src, /chipFallbackTip: 'Open the card to start configuring'/)
  assert.match(src, /: `\$\{t\('prefillTitleOff'\)\}\\n\$\{t\('chipFallbackTip'\)\}`/)
})
