// 界面重构 v1（UI 工作流 C）· 头部三区：结构 / 控件预算 / 状态胶囊 / popover / ⋯ 菜单 / 收起≠关闭。
// 与仓库既有做法一致：切 client.js 的源码片段断言（组件太大，不真渲染 PrefillDock）。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const cut = (from, to) => {
  const a = src.indexOf(from)
  const b = a < 0 ? -1 : src.indexOf(to, a)
  return a >= 0 && b > a ? src.slice(a, b) : ''
}
// 从 statRow 开始切：statusPill / headerLeft / headerCenter / headerRight / header / statusPopover 都在里面。
const headerSrc = cut("      const statRow = (label, value, hint = '') =>", '      // 错误详情（P0-1）')
const collapseSrc = cut('      const collapseCard = React.useCallback(', '      // 几何（cardGeometry）')
const moreSrc = cut('      const moreMenu = h(', '      // 世界书 / 故事记忆')

test('三区结构：data-prefill-header + 左中右三个 zone', () => {
  assert.ok(headerSrc.length > 0, '找不到头部片段')
  assert.match(headerSrc, /'data-prefill-header': '1'/)
  assert.equal((headerSrc.match(/'data-prefill-header-zone'/g) ?? []).length, 3, '左 / 中 / 右三区')
  assert.match(headerSrc, /'data-prefill-header-zone': 'left'/)
  assert.match(headerSrc, /'data-prefill-header-zone': 'center'/)
  assert.match(headerSrc, /'data-prefill-header-zone': 'right'/)
  // 右区容器钩子保留（旧工具找它）
  assert.match(headerSrc, /'data-prefill-header-tools': ''/)
})

test('头部控件预算：可点按钮 ≤ 8（无错误 7 / 有错误 8），且七个业务入口都在', () => {
  const buttons = (headerSrc.match(/\bh\('button'/g) ?? []).length
  assert.ok(buttons <= 8, `头部按钮 ${buttons} 个，应 ≤ 8`)
  for (const hook of ['data-prefill-preset-select', 'data-prefill-save', 'data-prefill-status-pill', 'data-prefill-more', 'data-prefill-pin', 'data-prefill-collapse', 'data-prefill-close']) {
    assert.ok(headerSrc.includes(hook), '缺钩子：' + hook)
  }
})

test('移除：独立 ? / 3 个 token 胶囊 / 头部另存为与取消预设', () => {
  assert.doesNotMatch(headerSrc, /badge\('var\(--pf-system\)'/, 'token 读数徽标已删')
  assert.doesNotMatch(headerSrc, /'data-prefill-badge': 'first'|'data-prefill-badge': 'turn'|'data-prefill-badge': 'cache'/)
  assert.doesNotMatch(headerSrc, /toggle\('guide'\)/, '独立 ? 按钮已删（引导收进 ⋯ 菜单）')
  assert.doesNotMatch(headerSrc, /'data-prefill-save-as'/, '另存为按钮已移出头部')
  assert.doesNotMatch(headerSrc, /'data-prefill-preset-clear'/, '取消预设已移出头部')
})

test('收起 ≠ 关闭：收起 = 钉住 + 缩成标记；关闭 = closeCard', () => {
  assert.match(collapseSrc, /const collapseCard = React\.useCallback/)
  assert.match(collapseSrc, /setPinned\(true\)/)
  assert.match(collapseSrc, /setShrunk\(true\)/)
  assert.match(collapseSrc, /const closeCardFully = React\.useCallback/)
  assert.match(collapseSrc, /setPinned\(false\)/)
  assert.match(collapseSrc, /closeCard\(\)/)
  assert.match(headerSrc, /'data-prefill-collapse': '', onClick: collapseCard/)
  assert.match(headerSrc, /'data-prefill-close': '', onClick: closeCardFully/)
})

test('状态胶囊：锁态 + 拦截档位 + 缓存，锁徽章闪层原样搬进胶囊', () => {
  assert.match(headerSrc, /const statusPill = h\(/)
  assert.match(headerSrc, /'data-prefill-status-pill': ''/)
  assert.match(headerSrc, /'data-prefill-lock-badge': lock\.locked \? 'locked' : 'open'/)
  assert.match(headerSrc, /'data-prefill-flash-bg': '', style: \{ position: 'absolute', inset: 0, borderRadius: 999, background: lock\.locked \? 'var\(--pf-ai\)' : 'var\(--pf-system\)', opacity: 0\.13/)
  // 头部的沙盒段走 SandboxBadge（前两个 prop 固定，测试/旧脚本按字面匹配），扁平化嵌在胶囊里
  assert.match(headerSrc, /h\(SandboxBadge, \{\n\s+key: 'sandbox',\n\s+'data-prefill-badge': 'sandbox',/)
  assert.match(headerSrc, /as: 'span'/)
  assert.match(headerSrc, /flat: true/)
  assert.match(headerSrc, /t\('badgeCache'\)/)
})

test('状态 popover：首轮 / 每轮 token、首轮状态、拦截、工具、模型（v1 是 —）', () => {
  assert.match(headerSrc, /'data-prefill-menu': 'status'/)
  assert.match(headerSrc, /statRow\(t\('badgeFirst'\), \['\+',/)
  assert.match(headerSrc, /statRow\(t\('badgeTurn'\), \['\+',/)
  assert.match(headerSrc, /badgeValue\(num\(firstTok\)\)/)
  assert.match(headerSrc, /badgeValue\(num\(perTurnTok\)\)/)
  assert.match(headerSrc, /cacheHit === null \? '—' : `\$\{cacheHit\}%`/)
  assert.match(headerSrc, /statRow\(t\('statusLock'\)/)
  assert.match(headerSrc, /statRow\(\s+t\('sbxBadge'\)/)
  assert.match(headerSrc, /statRow\(t\('statusTools'\), toolsCount === null \? '—'/)
  assert.match(headerSrc, /statRow\(t\('statusModel'\), '—', t\('statusModelUnknown'\)\)/)
  assert.match(headerSrc, /'data-prefill-status-open': 'inject'/)
})

test('错误 pill 用 fallback 占位（保留进出场动画），且不再挂 token 徽标', () => {
  assert.match(headerSrc, /h\(ErrorPill, \{ t, error, onToggle:/)
  assert.match(headerSrc, /fallback: statusPill/)
  assert.doesNotMatch(headerSrc, /fallback: \[/)
})

test('⋯ 菜单：另存为 / 导出 / 引导 / 动效偏好（真跳左侧栏），标题是「更多」', () => {
  assert.match(moreSrc, /t\('moreTitle'\)/)
  assert.match(moreSrc, /'data-prefill-more-save-as': '', 'data-prefill-save-as': ''/)
  assert.match(moreSrc, /'data-prefill-more-export': ''/)
  assert.match(moreSrc, /exportFile\(\)/)
  assert.match(moreSrc, /'data-prefill-more-guide': ''/)
  assert.match(moreSrc, /toggle\('guide'\)/)
  assert.match(moreSrc, /'data-prefill-more-prefs': ''/)
  assert.match(moreSrc, /openPrefillPanel\('prefs'\)/)
  assert.doesNotMatch(moreSrc, /motionMovedHint/, '不再只放一句「动效已移到左侧栏」')
})
