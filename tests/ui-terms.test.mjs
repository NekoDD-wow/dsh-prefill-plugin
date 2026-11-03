// 界面重构 v1（UI 工作流 C）· 术语：zh / en 同步（在册→运行中 / 未载入、首轮未发→首轮未发送、
// 沙盒·观察→拦截：仅观察、更多设置→更多、预注入→每轮注入）+ 新增键成对。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const cut = (from, to) => {
  const a = src.indexOf(from)
  const b = a < 0 ? -1 : src.indexOf(to, a)
  return a >= 0 && b > a ? src.slice(a, b) : ''
}
const zhDict = cut('    const zh = {', '    const en = {')
const sbxText = cut('    const SBX_TEXT = {', '    function SandboxSection(props) {')
const keyCount = (key) => (src.match(new RegExp('\\n\\s+' + key + ": '", 'g')) ?? []).length

test('在册 / 不在册 → 运行中 / 未载入（zh 主字典 + en）', () => {
  assert.ok(zhDict.length > 0, '找不到 zh 主字典')
  assert.doesNotMatch(zhDict, /在册/, 'zh 主字典里不应再有「在册」')
  assert.match(src, /armedEmpty: '当前没有运行中的会话。'/)
  assert.match(src, /armedNotLive: '未载入'/)
  assert.match(src, /overviewLive: '运行中'/)
  assert.match(src, /overviewNotLive: '未载入'/)
  assert.match(src, /overviewEmpty: '当前没有运行中的会话。'/)
  assert.match(src, /libraryNoSession: '当前没有运行中的会话：/)
  assert.match(src, /armedEmpty: 'No running sessions right now\.'/)
  assert.match(src, /armedNotLive: 'not loaded'/)
  assert.match(src, /overviewLive: 'running'/)
  assert.match(src, /overviewNotLive: 'not loaded'/)
  assert.doesNotMatch(src, /No live sessions right now|No live session:/)
})

test('首轮未发 → 首轮未发送 / First turn not sent', () => {
  assert.match(src, /lockOpenBadge: '首轮未发送'/)
  assert.match(src, /lockOpenBadge: 'First turn not sent'/)
  assert.doesNotMatch(src, /lockOpenBadge: '首轮未发'/)
  assert.doesNotMatch(src, /lockOpenBadge: 'Turn 1 not sent'/)
})

test('沙盒 · 观察 → 拦截：仅观察（SBX_TEXT，zh / en）', () => {
  assert.ok(sbxText.length > 0, '找不到 SBX_TEXT')
  assert.match(sbxText, /sbxBadge: '拦截'/)
  assert.match(sbxText, /sbxLevelObserve: '仅观察'/)
  assert.match(sbxText, /sbxBadge: 'Blocking'/)
  assert.match(sbxText, /sbxLevelObserve: 'Observe only'/)
  assert.match(sbxText, /injectTitle: '会话沙盒'/, 'v1 不改节标题')
  // 头部胶囊用「拦截：仅观察」拼法
  assert.match(src, /label: `\$\{t\('sbxBadge'\)\}\$\{t\('labelColon'\)\}\$\{sbxLevelLabel\(t, sbxSummary\.level\)\}`/)
})

test('更多设置 → 更多 / More；预注入 → 每轮注入；总览 pill 沙盒 → 拦截', () => {
  assert.match(src, /moreTitle: '更多'/)
  assert.match(src, /moreTitle: 'More'/)
  assert.doesNotMatch(src, /moreTitle: '更多设置'/)
  assert.doesNotMatch(src, /moreTitle: 'More settings'/)
  assert.match(src, /fileHint: '预设文件 = 完整预对话记录 \+ 每轮注入改写'/)
  assert.match(src, /overviewSandbox: '拦截'/)
  assert.match(src, /overviewSandbox: 'Blocking'/)
})

test('新增 UI 键 zh / en 成对', () => {
  for (const key of [
    'chipConfigured',
    'collapseTip',
    'statusTitle',
    'statusLock',
    'statusTools',
    'statusToolsHint',
    'statusModel',
    'statusModelUnknown',
    'statusOpenInject',
    'sbxOffTitle',
    'sbxOffBody',
    'kpiLive',
    'kpiPreset',
    'kpiEveryTurn',
    'kpiBlocked',
    'kpiLiveTip',
    'kpiPresetTip',
    'kpiEveryTurnTip',
    'kpiBlockedTip',
    'tocDefaultSandbox',
  ]) {
    assert.equal(keyCount(key), 2, key + ' 需要 zh + en 两份')
  }
  assert.match(src, /kpiBlocked: '拦截中'/, 'KPI 第 4 格按 Lead 拍板叫「拦截中」')
  assert.match(src, /kpiBlockedTip: '当前累计拦截数（观察档不计，无时间窗）'/)
  assert.match(src, /statusModelUnknown: '—（v2 接 summary\.model）'/)
})
