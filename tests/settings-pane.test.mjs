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
test('PR1：左侧页接 STATE_EVENT 双向广播 + busy / 错误 pill', () => {
  const body = cut('function PrefillSection(props) {', 'function PrefillPanelIcon(props) {')
  assert.match(body, /window\.addEventListener\(STATE_EVENT, refresh\)/)
  assert.match(body, /window\.removeEventListener\(STATE_EVENT, refresh\)/)
  assert.match(body, /notifyStateChanged\(\)/)
  assert.match(body, /const busy = useBusy\(\)/)
  assert.match(body, /busy\.run\(/)
  assert.match(body, /h\(ErrorPill, \{/)
  assert.match(body, /errorsReduce\(/)
})

test('PR1：开发者区默认折叠、可展开；生效会话改成勾选', () => {
  const body = cut('function PrefillSection(props) {', 'function PrefillPanelIcon(props) {')
  assert.match(body, /const \[devOpen, setDevOpen\] = React\.useState\(false\)/)
  assert.match(body, /'data-prefill-dev-toggle': devOpen \? 'open' : 'closed'/)
  assert.match(body, /\.\.\.\(devOpen \? devCards : \[\]\)/)
  assert.match(body, /'data-prefill-armed-session': id/)
  assert.match(body, /'data-prefill-armed-session': '\*'/)
  assert.doesNotMatch(body, /armedDraft/)
  assert.doesNotMatch(body, /t\('applyArmed'\)/)
})

test('PR1：恢复默认是两步确认（与沙盒页共用 ConfirmButton）', () => {
  const body = cut('function PrefillSection(props) {', 'function PrefillPanelIcon(props) {')
  assert.match(body, /h\(\s*ConfirmButton,/)
  assert.match(body, /const \[resetArmed, setResetArmed\] = React\.useState\(false\)/)
  assert.match(body, /t\('resetGlobal'\)/)
})


test('PR2：卡片不再编辑全局默认 / 动效；左侧页接管（一个字段只有一处可编辑）', () => {
  const section = cut('function PrefillSection(props) {', 'function PrefillPanelIcon(props) {')
  assert.match(section, /'data-prefill-default-everyturn': ''/)
  assert.match(section, /'data-prefill-default-sbx-level': 'none'/)
  assert.match(section, /'data-prefill-pref-motion': 'auto'/)
  assert.match(section, /'data-prefill-pref-reset-noask': ''/)
  // 卡片：旧的可编辑控件全部移除，只留只读显示 / 指路。
  assert.doesNotMatch(src, /'data-prefill-motion-opt': level/)
  assert.doesNotMatch(src, /'data-prefill-sbx-remember': pack\.id/)
  assert.doesNotMatch(src, /'data-prefill-sbx-global-level': ''/)
  assert.doesNotMatch(src, /'data-prefill-everyturn-default': '1'/)
  assert.doesNotMatch(src, /asDefault/)
  assert.match(src, /'data-prefill-sbx-remember-readonly': pack\.id/)
  assert.match(src, /'data-prefill-everyturn-default-readonly': '1'/)
  assert.match(src, /motionMovedHint/)
})

test('PR3：双向跳转走官方服务（layout.selectPanel / uiWorkspace.openSession），卡片有「改默认 ↗」', () => {
  assert.match(src, /panelCtx = ctx/)
  assert.match(src, /panelCtx\?\.get\?\.\('layout'\)\?\.selectPanel\?\.\(PREFILL_PANEL_ID\)/)
  assert.match(src, /panelCtx\?\.get\?\.\('uiWorkspace'\)\?\.openSession\?\.\(sessionId\)/)
  assert.match(src, /'data-prefill-open-prefill': 'default-everyturn'/)
  assert.match(src, /'data-prefill-open-prefill': 'default-sandbox'/)
  const section = cut('function PrefillSection(props) {', 'function PrefillPanelIcon(props) {')
  assert.match(section, /'data-prefill-anchor': 'overview'/)
  assert.match(section, /'data-prefill-overview-open': row\.id/)
  assert.match(section, /window\.addEventListener\(ANCHOR_EVENT, onAnchor\)/)
})

test('PR4：卡片只留「套用 / 存为」，删除·导入导出指向左侧栏「库」', () => {
  assert.doesNotMatch(src, /'data-prefill-pack-delete'/)
  assert.doesNotMatch(src, /'data-prefill-card-import'/)
  assert.doesNotMatch(src, /'data-prefill-card-delete'/)
  assert.doesNotMatch(src, /'data-prefill-card-export-png'/)
  assert.match(src, /'data-prefill-open-prefill': 'library'/)
  const section = cut('function PrefillSection(props) {', 'function PrefillPanelIcon(props) {')
  assert.match(section, /'data-prefill-lib-pack-delete': pack\.name/)
  assert.match(section, /'data-prefill-lib-card-import': ''/)
  assert.match(section, /'data-prefill-lib-unhide': id/)
  assert.match(section, /'data-prefill-anchor': 'library'/)
})
