// 设置页 2026-11 起走 DSH 官方通道：左侧栏一行（sidebar.panellist）+ 主区页面（main）。
// 之前是 DSH「设置」页里的一节（settings.section），后来一度塞进预填装卡片左栏；两处都不是官方入口。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const cut = (head, tail) => {
  const at = src.indexOf(head)
  assert.ok(at > 0, '找不到源码段：' + head)
  return src.slice(at, src.indexOf(tail, at))
}

test('注册走官方通道：sidebar.panellist + main，共用一个 panel id，不再注册设置页那节', () => {
  assert.match(src, /const PREFILL_PANEL_ID = 'prefill'/)
  assert.match(src, /ctx\.slots\.inject\('main', \(\) => ctx\.slots\.register\(\{ name: 'main', key: PREFILL_PANEL_ID, locale: NS \}, PrefillSection\)\)/)
  assert.match(src, /name: 'sidebar\.panellist', id: PREFILL_PANEL_ID, order: 20, label: \(\) => t\('nav'\), locale: NS/)
  assert.doesNotMatch(src, /settings\.section/)
})

test('左侧栏只收图标组件（宿主传 size）：自绘 svg、颜色跟 currentColor、不引宿主图标包', () => {
  const icon = cut('function PrefillPanelIcon(props) {', 'function PrefillToggle(props) {')
  assert.match(icon, /const size = Number\(props\?\.size\) \|\| 16/)
  assert.match(icon, /h\(\s*'svg'/)
  assert.match(icon, /stroke: 'currentColor'/)
  assert.match(icon, /'aria-hidden': 'true'/)
  assert.doesNotMatch(icon, /require\(/)
})

test('设置页还是原来那页：标题 / 「日常使用不需要来这里」/ 恢复默认都在', () => {
  const body = cut('function PrefillSection(props) {', 'function PrefillPanelIcon(props) {')
  assert.match(body, /h\('div', \{ style: S\.title \}, t\('title'\)\)/)
  assert.match(body, /t\('settingsWhere'\)/)
  assert.match(body, /t\('resetGlobal'\)/)
})

test('预填装卡片左栏恢复原样：不再多出「设置」页，还是 8 个开关项 + 用量与缓存', () => {
  assert.doesNotMatch(src, /EXTRA_NAV/)
  assert.doesNotMatch(src, /settingsSection/)
  assert.match(src, /const sections = \{ cards: cardsSection, lore: loreSection, memory: memorySection, system: systemSection, workspace: workspaceSection, 'every-turn': everyTurnSection, items: itemsSection, inject: injectSection, usage: usageSection \}/)
  assert.match(src, /tabItem\('usage', 'usage', 'var\(--dsw-alias-label-tertiary\)'\),/)
  assert.match(src, /navItem\('usage', 'usage', 'var\(--dsw-alias-label-tertiary\)'\),/)
})
