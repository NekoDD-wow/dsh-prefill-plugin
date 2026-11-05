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
    // F2 会话路由三态（W3 §1.5）：unknown 只做说明、绝不进 S.warn；on 是正面态。
    'reasoningRouteOn',
    'reasoningRouteOff',
    'reasoningRouteOffHint',
    'reasoningRouteUnknown',
    // F6 自动停用通知 + 忽略失败开关。
    'reasoningAutoDisabled',
    'labKnobIgnoreFailures',
    // F13/P1-5 实验臂标识 + 采样入口（留空 = 不干预）。
    'labKnobArmId',
    'labKnobArmIdPh',
    'labKnobRunId',
    'labKnobRunIdPh',
    'labKnobTemperature',
    'labKnobTopP',
    'labKnobSeed',
    'labSamplingHint',
    'labSamplingInvalid',
    // F11/F14 结果行开关 + 最近结果行。
    'labResultTitle',
    'labResultEnabled',
    'labResultFilePh',
    'labResultReasoningHead',
    'labResultReasoningHeadHint',
    'labResultSnippets',
    'labResultSnippetsHint',
    'labResultLast',
    'labResultArm',
    'labResultRun',
    'labResultAttempts',
    'labResultAt',
    // verdict 八态人话。
    'labVerdictPrefixKept',
    'labVerdictPrefixAbsent',
    'labVerdictNoReasoning',
    'labVerdictUnknown',
    'labVerdictPassthrough',
    'labVerdictSkipped',
    'labVerdictIgnored',
    'labVerdictError',
    // 阶段 C：F15-C 清单重复说明 + F17-C 预设旋钮计数。
    'labCatalogDuplicates',
    'labPresetKnobsN',
    'labPresetKnobsNone',
    'labPresetKnobsHint',
    // 日志轮转：上限 / 保留数 / 上限提示 / 两族占用 / 轮转文件数 / 两条非法提示。
    'labLoggingRotateMax',
    'labLoggingRotateKeep',
    'labLoggingRotateCap',
    'labLoggingUsage',
    'labLoggingUsageResult',
    'labLoggingRotated',
    'labLoggingSizeInvalid',
    'labLoggingKeepInvalid',
  ]) {
    assert.equal(keyCount(key), 2, key + ' 需要 zh + en 两份')
  }
  assert.match(src, /kpiBlocked: '拦截中'/, 'KPI 第 4 格按 Lead 拍板叫「拦截中」')
  assert.match(src, /kpiBlockedTip: '当前累计拦截数（观察档不计，无时间窗）'/)
  assert.match(src, /statusModelUnknown: '—（v2 接 summary\.model）'/)
})

test('F14 · verdict 八态都在面板里映射到人话键，且键中英成对', () => {
  for (const [verdict, key] of [
    ['prefix-kept', 'labVerdictPrefixKept'],
    ['prefix-absent', 'labVerdictPrefixAbsent'],
    ['no-reasoning', 'labVerdictNoReasoning'],
    ['unknown', 'labVerdictUnknown'],
    ['passthrough', 'labVerdictPassthrough'],
    ['skipped', 'labVerdictSkipped'],
    ['ignored', 'labVerdictIgnored'],
    ['error', 'labVerdictError'],
  ]) {
    assert.match(src, new RegExp("'?" + verdict + "'?: '" + key + "'"), verdict + ' 要映射到 ' + key)
    assert.equal(keyCount(key), 2, key + ' 需要 zh + en 两份')
  }
})

test('F8 · 思考前缀文案补「切了不一定生效 + 要回头校验」（zh / en 各 1 处）', () => {
  assert.equal((src.match(/切了不一定生效/g) ?? []).length, 1, 'zh 恰好 1 处')
  assert.equal((src.match(/not guaranteed to take effect/g) ?? []).length, 1, 'en 恰好 1 处')
  assert.match(src, /reasoningHint: '[^']*要回头校验是否真的切上了/, 'zh 启用说明里也点明要校验')
  assert.match(src, /reasoningHint: '[^']*verify the switch actually took effect/, 'en 启用说明里也点明要校验')
})

test('轮转文案 · 上限按「每个日志」说，并点明多份文件各占一份；不算合计', () => {
  // zh：必须是「每个日志最多」而不是「最多占用」（后者会被读成所有日志的合计）。
  assert.match(src, /labLoggingRotateCap: '上限 × \(保留数 \+ 1\) = 每个日志最多 \{size\}/, 'zh 按族说')
  assert.match(src, /labLoggingRotateCap: '[^']*开着的每个日志各自占用一份/, 'zh 点明各占一份')
  assert.match(src, /labLoggingRotateCap: '[^']*调试三件套/, 'zh 点明调试三件套再各占一份')
  assert.doesNotMatch(src, /labLoggingRotateCap: '[^']*最多占用/, 'zh 不许再写「最多占用」（会被读成合计）')
  // en 同义
  assert.match(src, /labLoggingRotateCap: 'Max size × \(files kept \+ 1\) = up to \{size\} per log/, 'en 按族说')
  assert.match(src, /labLoggingRotateCap: '[^']*Each enabled log takes its own share/, 'en 点明各占一份')
  assert.match(src, /labLoggingRotateCap: '[^']*three debug files/, 'en 点明调试三件套再各占一份')
  // 两族占用各有自己的键（结果行默认开，单独一行）
  assert.match(src, /labLoggingUsage: '代理日志：当前占用 \{size\}'/)
  assert.match(src, /labLoggingUsageResult: '结果行：当前占用 \{size\}'/)
  assert.match(src, /labLoggingUsage: 'Proxy log: using \{size\} now'/)
  assert.match(src, /labLoggingUsageResult: 'Result rows: using \{size\} now'/)
  // 面板：两族分别读各自的字段（不许把 result* 与代理族混用）
  assert.match(src, /'data-prefill-lab-logging-usage-result': '' \}, usageLineOf\('labLoggingUsageResult', resultUsageBytes, resultRotated, resultRotatedShown\)/)
  assert.match(src, /'data-prefill-lab-logging-usage': '' \}, usageLineOf\('labLoggingUsage', proxyUsageBytes, proxyRotated, proxyRotatedShown\)/)
})
