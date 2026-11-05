// 实验面板（胶囊弹窗「实验」页）真渲染：stats / lastRequest 为空时不能崩。
// 回归：v0.20.7 的 P0 —— 预览段直接解引用 stats.lastRequest / stats.lastRequest.catalogHead，
// 代理未运行（stats=null）或还没有前缀请求（lastRequest=null，含「统计清零」）时打开实验页 TypeError。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const from = src.indexOf('    function ExperimentalPanel(props) {')
const to = src.indexOf('\n    function SbxSegment(props) {')
if (from < 0 || to <= from) throw new Error('找不到 ExperimentalPanel 段')
const panelSrc = src.slice(from, to)

/** 和 tests/settings-harness.mjs 同一套假 React：hooks 按调用顺序存槽位，useEffect 按 deps 变化执行。 */
function makeFakeReact() {
  const slots = []
  const effects = []
  const callbacks = []
  const refs = []
  let cursor = 0
  let effectCursor = 0
  let callbackCursor = 0
  let refCursor = 0
  return {
    resetCursors() {
      cursor = 0
      effectCursor = 0
      callbackCursor = 0
      refCursor = 0
    },
    React: {
      useState(init) {
        const index = cursor++
        if (!(index in slots)) slots[index] = typeof init === 'function' ? init() : init
        return [slots[index], (value) => (slots[index] = typeof value === 'function' ? value(slots[index]) : value)]
      },
      useEffect(fn, deps) {
        const index = effectCursor++
        const prev = effects[index]
        const changed =
          prev === undefined ||
          deps === undefined ||
          prev.deps === undefined ||
          deps.length !== prev.deps.length ||
          deps.some((value, at) => value !== prev.deps[at])
        if (!changed) return
        effects[index] = { deps }
        fn()
      },
      useCallback(fn, deps) {
        const index = callbackCursor++
        const prev = callbacks[index]
        if (
          prev !== undefined &&
          deps !== undefined &&
          prev.deps !== undefined &&
          deps.length === prev.deps.length &&
          deps.every((value, at) => value === prev.deps[at])
        ) {
          return prev.fn
        }
        callbacks[index] = { deps, fn }
        return fn
      },
      useRef(value) {
        const index = refCursor++
        if (!(index in refs)) refs[index] = { current: value }
        return refs[index]
      },
    },
  }
}

const h = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) })
const V = new Proxy({}, { get: () => ({}) })
const KNOBS = {
  port: 46321,
  prefix: '先想一下：',
  contentPrefix: '',
  providerId: 'prefill-think',
  modelId: 'deepseek-flash',
  match: '',
  shim: true,
  textualize: true,
  catalogRole: 'system',
  maxEmittedCalls: 8,
  failureThreshold: 3,
  catalogMode: 'each',
  catalogDetail: 'full',
  catalogPosition: 'head',
  loggingEnabled: false,
  loggingFile: '',
  fallbackOrder: '',
  allowPassthrough: true,
  catalogInclude: [],
  catalogExclude: [],
  loggingDump: false,
  loggingRaw: false,
  loggingContent: false,
  ignoreFailures: false,
  // 阶段 B（F13/P1-5/F11）：实验臂标识、采样（未设 = 缺省）、结果行开关。
  armId: '',
  runId: '',
  sampling: null,
  loggingResultEnabled: true,
  loggingResultFile: '',
  loggingReasoningHead: false,
  loggingSnippets: true,
}
/** experimental/status 的回包形状（impl.js experimentalStatus）：stats 代理没跑时是 null。
 *  over 可覆盖 knobs / reasoning / prefill / presets —— 默认 prefill **不带** sessionRoute / lastResult /
 *  catalogDuplicates（旧 fixture 的缺键形态，必须走「不告警 / 不渲染」的静默分支）。 */
const statusOf = (stats, over = {}) => ({
  ok: true,
  experimental: true,
  knobs: { ...KNOBS, ...(over.knobs ?? {}) },
  stats,
  reasoning: { route: null, proxyRunning: false, audit: [], autoDisabledAt: null, ...(over.reasoning ?? {}) },
  presets: over.presets ?? [],
  turns: { total: 0, session: 0 },
  logging: { enabled: false, file: 'x.jsonl', exists: false, bytes: 0, dumpFile: '', rawFile: '', contentFile: '' },
  log: [],
  prefill: { enabled: false, proxyRunning: false, routeOk: false, skipQueued: false, skipping: false, ready: false, ...(over.prefill ?? {}) },
})
const statsOf = (lastRequest) => ({
  requests: 1,
  ok: 1,
  failed: 0,
  variants: { system: 1 },
  calls: 0,
  firstDeltaMs: { sum: 800, count: 1 },
  ms: { sum: 1200, count: 1 },
  firstDeltaP95: 800,
  usage: { requests: 1, prompt: 1000, completion: 50, cacheHit: 900, cacheMiss: 100 },
  lastRequest,
})
const lastRequestOf = (patch = {}) => ({
  messages: 7,
  tools: 0,
  catalogBytes: 269,
  reasoningPrefix: '先想一下：',
  contentPrefix: '',
  variant: 'system',
  catalogHead: '- read：读文件\n- glob：找文件',
  prefixMessage: { reasoning: '先想一下：', content: '' },
  ...patch,
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const walk = (node, out = []) => {
  if (node === null || node === undefined || typeof node !== 'object') return out
  out.push(node)
  for (const child of node.children ?? []) walk(child, out)
  return out
}
const textOf = (node) => {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (typeof node !== 'object') return ''
  return (node.children ?? []).map(textOf).join(' ')
}

/** 把真实 client.js 里的 ExperimentalPanel 切出来，用假 React + 假 postJson 真渲染。 */
function makePanel(statusReply, translate) {
  const fake = makeFakeReact()
  const listeners = []
  const window = {
    addEventListener(type, fn) {
      listeners.push({ type, fn })
    },
    removeEventListener() {},
  }
  const posts = []
  const postJson = async (path, body) => {
    posts.push({ path, body })
    if (path === '/api/dsh-prefill/experimental/status') return JSON.parse(JSON.stringify(statusReply))
    return { ok: true, applied: { ok: true } }
  }
  const notifyStateChanged = () => {}
  // eslint-disable-next-line no-new-func
  const mod = new Function(
    'React',
    'h',
    'V',
    'postJson',
    'window',
    'STATE_EVENT',
    'notifyStateChanged',
    'EXPERIMENTAL_STATUS_ROUTE',
    'EXPERIMENTAL_CONFIG_ROUTE',
    'EXPERIMENTAL_PING_ROUTE',
    'EXPERIMENTAL_EXPORT_ROUTE',
    'EXPERIMENTAL_STATS_RESET_ROUTE',
    'EXPERIMENTAL_PRESETS_ROUTE',
    'EXPERIMENTAL_SKIP_ROUTE',
    'REASONING_REPAIR_ROUTE',
    `${panelSrc}\nreturn { ExperimentalPanel }`,
  )(
    fake.React,
    h,
    V,
    postJson,
    window,
    'dsh-prefill:state-changed',
    notifyStateChanged,
    '/api/dsh-prefill/experimental/status',
    '/api/dsh-prefill/experimental/config',
    '/api/dsh-prefill/experimental/ping',
    '/api/dsh-prefill/experimental/export',
    '/api/dsh-prefill/experimental/stats/reset',
    '/api/dsh-prefill/experimental/presets',
    '/api/dsh-prefill/experimental/skip',
    '/api/dsh-prefill/reasoning/repair',
  )
  const t = typeof translate === 'function' ? translate : (key) => key
  const render = () => {
    fake.resetCursors()
    return mod.ExperimentalPanel({ t, sessionId: 's1' })
  }
  const find = (tree, pred) => walk(tree).filter((node) => pred(node.props ?? {}, node))
  return { render, find, listeners, posts }
}

/** 首帧 = 加载中；load() 的 promise 落地后再渲染 = 完整面板（修复前这里会抛 TypeError）。
 *  translate 可选：默认 t 返回 key，测「错误原因有没有带到面板上」时要让 labError 带上 {reason}。 */
async function mount(statusReply, translate) {
  const panel = makePanel(statusReply, translate)
  panel.render()
  await settle()
  const tree = panel.render()
  return { panel, tree }
}

test('实验面板 · stats = null（代理未运行）不崩：预览段只给「暂无」提示', async () => {
  const { panel, tree } = await mount(statusOf(null))
  const preview = panel.find(tree, (props) => props['data-prefill-lab-preview'] !== undefined)
  assert.equal(preview.length, 1, '预览段仍在（DOM 属性不变）')
  assert.match(textOf(preview[0]), /labPreviewEmpty/, '空 stats 时渲染「暂无」提示')
  assert.equal(panel.find(tree, (props) => props['data-prefill-lab-preview-catalog'] !== undefined).length, 0)
  assert.equal(panel.find(tree, (props) => props['data-prefill-lab-preview-prefix'] !== undefined).length, 0)
  // 同一帧里统计段也不崩（stats=null 的既有分支）
  assert.match(textOf(panel.find(tree, (props) => props['data-prefill-lab-stats'] !== undefined)[0]), /labStatsEmpty/)
})

test('实验面板 · stats 有值但 lastRequest = null（还没有前缀请求 / 统计清零后）不崩', async () => {
  const { panel, tree } = await mount(statusOf(statsOf(null)))
  const preview = panel.find(tree, (props) => props['data-prefill-lab-preview'] !== undefined)
  assert.equal(preview.length, 1)
  assert.match(textOf(preview[0]), /labPreviewEmpty/)
  assert.equal(panel.find(tree, (props) => props['data-prefill-lab-preview-catalog'] !== undefined).length, 0)
  assert.equal(panel.find(tree, (props) => props['data-prefill-lab-preview-prefix'] !== undefined).length, 0)
})

test('实验面板 · lastRequest 有值：渲染消息数 / 清单大小 / 前缀长度 / 清单前几行 / 前缀原文', async () => {
  const { panel, tree } = await mount(statusOf(statsOf(lastRequestOf())))
  const preview = panel.find(tree, (props) => props['data-prefill-lab-preview'] !== undefined)[0]
  const text = textOf(preview)
  assert.doesNotMatch(text, /labPreviewEmpty/)
  assert.match(text, /labPreviewMessages/)
  assert.match(text, /labPreviewCatalog/)
  assert.match(text, /269 B/, '清单字节数')
  assert.match(text, /labPreviewPrefix/)
  assert.match(text, /先想一下：/, '前缀长度 pill 与「前缀消息」块都带前缀原文')
  const catalog = panel.find(tree, (props) => props['data-prefill-lab-preview-catalog'] !== undefined)
  assert.equal(catalog.length, 1)
  assert.match(textOf(catalog[0]), /- read/, '清单前几行原文')
  const prefix = panel.find(tree, (props) => props['data-prefill-lab-preview-prefix'] !== undefined)
  assert.equal(prefix.length, 1)
  assert.match(textOf(prefix[0]), /先想一下：/)
})

test('实验面板 · lastRequest 有值但 catalogHead 空 / prefixMessage 空：不崩且不渲染两个展开块', async () => {
  const { panel, tree } = await mount(statusOf(statsOf(lastRequestOf({ catalogHead: '', prefixMessage: null }))))
  const preview = panel.find(tree, (props) => props['data-prefill-lab-preview'] !== undefined)
  assert.equal(preview.length, 1)
  assert.doesNotMatch(textOf(preview[0]), /labPreviewEmpty/, '有 lastRequest 就仍然是 pills 行')
  assert.equal(panel.find(tree, (props) => props['data-prefill-lab-preview-catalog'] !== undefined).length, 0)
  assert.equal(panel.find(tree, (props) => props['data-prefill-lab-preview-prefix'] !== undefined).length, 0)
})

// ── F2 · 会话路由告警（prefill.sessionRoute 三态；只有 false 才出现）────────────────

const routeOffNode = (panel, tree) => panel.find(tree, (props) => props['data-prefill-lab-route-off'] !== undefined)
const routeNode = (panel, tree) => panel.find(tree, (props) => props['data-prefill-lab-session-route'] !== undefined)
const routeOf = (matchesPrefix) => ({ provider: 'cline-pass', model: 'deepseek-v4', matchesPrefix, at: 1730000000000 })

test('F2 面板 · sessionRoute 三态：缺键 / null / matchesPrefix:null ⇒ unknown，true ⇒ on，都不告警', async () => {
  const cases = [
    ['缺键（旧 fixture）', statusOf(null), 'unknown'],
    ['sessionRoute = null', statusOf(null, { prefill: { sessionRoute: null } }), 'unknown'],
    ['matchesPrefix = null（判断不了）', statusOf(null, { prefill: { sessionRoute: routeOf(null) } }), 'unknown'],
    ['matchesPrefix = true（已走前缀路由）', statusOf(null, { prefill: { sessionRoute: routeOf(true) } }), 'on'],
  ]
  for (const [name, reply, expected] of cases) {
    const { panel, tree } = await mount(reply)
    assert.equal(routeOffNode(panel, tree).length, 0, name + '：不能渲染告警节点')
    assert.doesNotMatch(textOf(tree), /reasoningRouteOff/, name + '：正文不能出现告警文案')
    const node = routeNode(panel, tree)
    assert.equal(node.length, 1, name + '：三态行恰好一个')
    assert.equal(node[0].props['data-prefill-lab-session-route'], expected, name + '：状态')
  }
  // 正面态是给用户「真的切上了」看的——README 让用户找的就是这一句。
  const on = await mount(statusOf(null, { prefill: { sessionRoute: routeOf(true) } }))
  assert.match(textOf(routeNode(on.panel, on.tree)[0]), /reasoningRouteOn/)
  const unknown = await mount(statusOf(null, { prefill: { sessionRoute: null } }))
  assert.match(textOf(routeNode(unknown.panel, unknown.tree)[0]), /reasoningRouteUnknown/)
})

test('F2 面板 · matchesPrefix = false ⇒ 告警节点 + data-prefill-lab-route-off + 两句可照做的文案', async () => {
  const { panel, tree } = await mount(statusOf(null, { prefill: { sessionRoute: routeOf(false) } }))
  const off = routeOffNode(panel, tree)
  assert.equal(off.length, 1, '恰好一个告警节点')
  const text = textOf(off[0])
  assert.match(text, /reasoningRouteOff\b/, '事实陈述：本会话没走前缀路由')
  assert.match(text, /reasoningRouteOffHint/, '给出「去哪切 + 切完怎么校验」')
  assert.equal(off[0].props['data-prefill-lab-route-off'], '', 'DOM 钩子（验收判据）')
  const node = routeNode(panel, tree)
  assert.equal(node.length, 1, '告警节点也带三态钩子')
  assert.equal(node[0].props['data-prefill-lab-session-route'], 'off')
})

// ── F6 · 自动停用通知 + ignoreFailures 开关 ────────────────────────────────────

test('F6 面板 · reasoning.autoDisabledAt 为 null / 缺键 ⇒ 不渲染；有值 ⇒ 通知 + 时间', async () => {
  const silent = [
    ['缺键', statusOf(null, { reasoning: { autoDisabledAt: undefined } })],
    ['null', statusOf(null, { reasoning: { autoDisabledAt: null } })],
  ]
  for (const [name, reply] of silent) {
    const { panel, tree } = await mount(reply)
    assert.equal(panel.find(tree, (props) => props['data-prefill-lab-auto-disabled'] !== undefined).length, 0, name + '：不渲染')
    assert.doesNotMatch(textOf(tree), /reasoningAutoDisabled/, name + '：正文不出现自动停用文案')
  }
  const { panel, tree } = await mount(statusOf(null, { reasoning: { autoDisabledAt: 1730000000000 } }))
  const node = panel.find(tree, (props) => props['data-prefill-lab-auto-disabled'] !== undefined)
  assert.equal(node.length, 1)
  assert.match(textOf(node[0]), /reasoningAutoDisabled/)
})

test('F6 面板 · ignoreFailures：knobs 回填勾选态，保存时写进 experimental/config', async () => {
  const { panel, tree } = await mount(statusOf(null, { knobs: { ignoreFailures: true } }))
  const box = panel.find(tree, (props) => props['data-prefill-lab-toggle'] === 'ignoreFailures')
  assert.equal(box.length, 1, '开关存在')
  assert.equal(box[0].props.checked, true, 'knobs.ignoreFailures = true 回填到勾选态')
  box[0].props.onChange({ target: { checked: false } })
  const after = panel.render()
  panel.find(after, (props) => props['data-prefill-lab-save'] !== undefined)[0].props.onClick()
  await settle()
  const saved = panel.posts.filter((entry) => entry.path === '/api/dsh-prefill/experimental/config')
  assert.equal(saved.length, 1, '保存只发一次 config')
  assert.equal(saved[0].body.ignoreFailures, false, '取消勾选后按 false 落盘')
  // 缺键时默认不勾（缺省 = 不忽略失败）
  const off = await mount(statusOf(null))
  assert.equal(off.panel.find(off.tree, (props) => props['data-prefill-lab-toggle'] === 'ignoreFailures')[0].props.checked, false)
})

// ── 阶段 B · F13 实验臂标识 / P1-5 采样入口 / F11 结果行开关 / F14 最近结果行 ──────────

/** 按 data-prefill-lab-knob 取输入框（取不到直接失败，免得后面抛 TypeError 掩盖真因）。 */
const knob = (panel, tree, name) => {
  const node = panel.find(tree, (props) => props['data-prefill-lab-knob'] === name)[0]
  assert.ok(node, '找不到参数输入框 ' + name)
  return node
}
const resultToggle = (panel, tree, name) => {
  const node = panel.find(tree, (props) => props['data-prefill-lab-result-toggle'] === name)[0]
  assert.ok(node, '找不到结果行开关 ' + name)
  return node
}
const findOne = (panel, tree, attr) => {
  const node = panel.find(tree, (props) => props[attr] !== undefined)[0]
  assert.ok(node, '找不到 ' + attr)
  return node
}
/** 点一次「保存参数」并把发出去的 config 请求体收回来（假 postJson 只记账）。 */
async function saveAndGetBodies(panel) {
  panel.find(panel.render(), (props) => props['data-prefill-lab-save'] !== undefined)[0].props.onClick()
  await settle()
  await settle()
  return panel.posts.filter((entry) => entry.path === '/api/dsh-prefill/experimental/config').map((entry) => entry.body)
}

test('F13 面板 · armId / runId：knobs 回填；空串（含只空格）按清空提交，不发 undefined', async () => {
  const filled = await mount(statusOf(null, { knobs: { armId: 'A0-default', runId: 'r1' } }))
  assert.equal(knob(filled.panel, filled.tree, 'armId').props.value, 'A0-default')
  assert.equal(knob(filled.panel, filled.tree, 'runId').props.value, 'r1')
  const first = await saveAndGetBodies(filled.panel)
  assert.equal(first.length, 1, '保存只发一次 config')
  assert.equal(first[0].armId, 'A0-default')
  assert.equal(first[0].runId, 'r1')

  const cleared = await mount(statusOf(null, { knobs: { armId: 'A0-default', runId: 'r1' } }))
  knob(cleared.panel, cleared.tree, 'armId').props.onChange({ target: { value: '' } })
  knob(cleared.panel, cleared.tree, 'runId').props.onChange({ target: { value: '   ' } })
  const second = await saveAndGetBodies(cleared.panel)
  assert.equal(second.length, 1)
  assert.equal(second[0].armId, '', '空串 = 清空')
  assert.equal(second[0].runId, '', '只空格也算清空（trim）')
  assert.ok('armId' in second[0] && 'runId' in second[0], '键必须在（清空是空串，不是不发）')
})

test('P1-5 面板 · 采样留空提交 null（不是 0 / NaN），缺省回填是空串', async () => {
  const blank = await mount(statusOf(null, { knobs: { sampling: null } }))
  for (const name of ['temperature', 'topP', 'seed']) {
    assert.equal(knob(blank.panel, blank.tree, name).props.value, '', name + '：缺省必须是空串，不是 undefined')
  }
  const bodies = await saveAndGetBodies(blank.panel)
  assert.equal(bodies.length, 1)
  assert.deepEqual(bodies[0].sampling, { temperature: null, topP: null, seed: null }, '留空 = null = 不干预')
})

test('P1-5 面板 · 填了数字就照发（0 是合法值，不能和留空混）', async () => {
  const filled = await mount(statusOf(null, { knobs: { sampling: { temperature: 0, topP: 0.9, seed: 42 } } }))
  assert.equal(knob(filled.panel, filled.tree, 'temperature').props.value, '0', '0 回填成 "0"（不是空串）')
  assert.equal(knob(filled.panel, filled.tree, 'topP').props.value, '0.9')
  assert.equal(knob(filled.panel, filled.tree, 'seed').props.value, '42')
  const bodies = await saveAndGetBodies(filled.panel)
  assert.deepEqual(bodies[0].sampling, { temperature: 0, topP: 0.9, seed: 42 })
})

test('P1-5 面板 · 非法采样值当场拦住：一个请求都不发，并在面板上报错', async () => {
  // 默认 t 返回 key，'labError' 里没有 {reason} 占位符 ⇒ 原因会被丢掉；这里补上占位符才看得见原因。
  const reasonT = (key) => (key === 'labError' ? 'labError {reason}' : key)
  // 范围与 impl.js 的 samplingOf 一致：temperature [0,2] / top_p [0,1] / seed 整数 [0, 4294967295]。
  // 服务端对越界成员是**静默丢弃**（那一项就不干预了），所以面板必须在提交前拦住，否则用户以为设上了。
  for (const [name, value] of [
    ['temperature', 'abc'],
    ['temperature', '-1'],
    ['temperature', '2.5'],
    ['topP', '3'],
    ['seed', '1.5'],
    ['seed', '-1'],
    ['seed', '4294967296'],
  ]) {
    const { panel, tree } = await mount(statusOf(null), reasonT)
    knob(panel, tree, name).props.onChange({ target: { value } })
    const bodies = await saveAndGetBodies(panel)
    assert.equal(bodies.length, 0, name + '=' + value + '：非法值不许发出去')
    const err = findOne(panel, panel.render(), 'data-prefill-lab-error')
    assert.match(textOf(err), /labSamplingInvalid/, name + '=' + value + '：要给出错误提示')
  }
})

test('F11 面板 · 结果行四个开关：缺键按文档默认（开 / 关 / 开），保存进 config', async () => {
  const missing = await mount(statusOf(null, { knobs: { loggingResultEnabled: undefined, loggingReasoningHead: undefined, loggingSnippets: undefined, loggingResultFile: undefined } }))
  assert.equal(resultToggle(missing.panel, missing.tree, 'enabled').props.checked, true, '结果行默认开')
  assert.equal(resultToggle(missing.panel, missing.tree, 'reasoningHead').props.checked, false, 'reasoning 采集默认关')
  assert.equal(resultToggle(missing.panel, missing.tree, 'snippets').props.checked, true, '正文片段默认开')
  assert.equal(findOne(missing.panel, missing.tree, 'data-prefill-lab-result-file').props.value, '', '路径缺键 = 空串，不画 undefined')

  const off = await mount(statusOf(null, { knobs: { loggingResultFile: 'D:/x/results.jsonl' } }))
  assert.equal(findOne(off.panel, off.tree, 'data-prefill-lab-result-file').props.value, 'D:/x/results.jsonl')
  resultToggle(off.panel, off.tree, 'enabled').props.onChange({ target: { checked: false } })
  resultToggle(off.panel, off.tree, 'reasoningHead').props.onChange({ target: { checked: true } })
  resultToggle(off.panel, off.tree, 'snippets').props.onChange({ target: { checked: false } })
  const bodies = await saveAndGetBodies(off.panel)
  assert.equal(bodies.length, 1)
  assert.equal(bodies[0].loggingResultEnabled, false)
  assert.equal(bodies[0].loggingReasoningHead, true)
  assert.equal(bodies[0].loggingSnippets, false)
  assert.equal(bodies[0].loggingResultFile, 'D:/x/results.jsonl')
})

test('F11 面板 · 说明写清「reasoning 采集才让 verdict 判断得了前缀延续」与正文片段的隐私含义', async () => {
  const { panel, tree } = await mount(statusOf(null))
  assert.match(textOf(findOne(panel, tree, 'data-prefill-lab-result-hint')), /labResultReasoningHeadHint/)
  assert.match(textOf(findOne(panel, tree, 'data-prefill-lab-result-privacy')), /labResultSnippetsHint/)
  assert.match(textOf(findOne(panel, tree, 'data-prefill-lab-sampling-hint')), /labSamplingHint/)
})

test('F14 面板 · prefill.lastResult 缺键 / null ⇒ 那一行完全不渲染', async () => {
  for (const [name, reply] of [
    ['缺键（旧 fixture）', statusOf(null)],
    ['null', statusOf(null, { prefill: { lastResult: null } })],
  ]) {
    const { panel, tree } = await mount(reply)
    assert.equal(panel.find(tree, (props) => props['data-prefill-lab-last-result'] !== undefined).length, 0, name + '：不渲染')
    assert.doesNotMatch(textOf(tree), /labResultLast/, name + '：正文不出现最近结果行')
  }
})

test('F14 面板 · lastResult 有值 ⇒ armId / verdict / status / attempts / 时间都出来', async () => {
  const { panel, tree } = await mount(
    statusOf(null, { prefill: { lastResult: { armId: 'A0-default', runId: 'r1', verdict: 'prefix-kept', status: 200, attemptsLength: 2, at: 1730000000000 } } }),
  )
  const row = findOne(panel, tree, 'data-prefill-lab-last-result')
  const text = textOf(row)
  assert.match(text, /labResultLast/)
  assert.match(text, /labVerdictPrefixKept/, 'verdict 给人话')
  assert.match(text, /A0-default/)
  assert.match(text, /r1/)
  assert.match(text, /200/)
  assert.match(text, /labResultAttempts/)
  assert.doesNotMatch(text, /undefined/)
})

test('F14 面板 · verdict 八态都映射到人话键；认不出的原样显示且不画 undefined', async () => {
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
    const { panel, tree } = await mount(statusOf(null, { prefill: { lastResult: { armId: 'a', runId: '', verdict, status: 200, attemptsLength: 1, at: 1 } } }))
    const row = findOne(panel, tree, 'data-prefill-lab-last-result')
    assert.match(textOf(row), new RegExp(key), verdict + ' → ' + key)
  }
  // 服务端将来加了新 verdict：原样显示，不因为认不出就画 undefined。
  const { panel, tree } = await mount(statusOf(null, { prefill: { lastResult: { verdict: 'brand-new', status: 0, attemptsLength: 0, at: 0 } } }))
  const text = textOf(findOne(panel, tree, 'data-prefill-lab-last-result'))
  assert.match(text, /brand-new/)
  assert.doesNotMatch(text, /undefined/)
})

// ── 阶段 C · F15-C 清单重复提示 / F17-C 预设旋钮计数 ──────────────────────────

test('F15-C 面板 · prefill.catalogDuplicates 缺键 / 0 / 非法 ⇒ 不渲染；> 0 ⇒ 说明性提示（非红色告警）', async () => {
  for (const [name, reply] of [
    ['缺键（旧 fixture）', statusOf(null)],
    ['0 = 干净', statusOf(null, { prefill: { catalogDuplicates: 0 } })],
    ['null', statusOf(null, { prefill: { catalogDuplicates: null } })],
    ['非数字', statusOf(null, { prefill: { catalogDuplicates: 'x' } })],
  ]) {
    const { panel, tree } = await mount(reply)
    assert.equal(panel.find(tree, (props) => props['data-prefill-lab-catalog-duplicates'] !== undefined).length, 0, name + '：不渲染')
    assert.doesNotMatch(textOf(tree), /labCatalogDuplicates/, name + '：正文不出现')
  }
  // 用真字典查表，才能验「{n} 被替换」而不是只看到 key。
  const dict = (key) => (key === 'labCatalogDuplicates' ? '发现 {n} 份重复清单' : key)
  const { panel, tree } = await mount(statusOf(null, { prefill: { catalogDuplicates: 2 } }), dict)
  const node = findOne(panel, tree, 'data-prefill-lab-catalog-duplicates')
  assert.equal(node.props['data-prefill-lab-catalog-duplicates'], '2')
  assert.match(textOf(node), /发现 2 份重复清单/, '{n} 替换成实际条数')
  assert.doesNotMatch(String(node.props.style?.color ?? ''), /warn/, '说明性提示，不是红色告警')
})

/** impl.js 的 PREFIX_PRESET_KNOBS（浏览器半不能 import，靠这条断言防漂移）。 */
const implPresetKnobs = (() => {
  const src = readFileSync(new URL('../impl.js', import.meta.url), 'utf8')
  const match = src.match(/const PREFIX_PRESET_KNOBS = \[([\s\S]*?)\]/)
  return match === null ? null : (match[1].match(/'[^']+'/g) ?? []).map((entry) => entry.slice(1, -1))
})()
const clientPresetKnobs = (() => {
  const match = panelSrc.match(/const PRESET_KNOB_KEYS = \[([^\]]*)\]/)
  return match === null ? null : (match[1].match(/'[^']+'/g) ?? []).map((entry) => entry.slice(1, -1))
})()

test('F17-C 面板 · 旋钮清单与 impl.js 的 PREFIX_PRESET_KNOBS 逐字一致（漂移告警）', () => {
  assert.ok(implPresetKnobs !== null, 'impl.js 里找不到 PREFIX_PRESET_KNOBS')
  assert.ok(clientPresetKnobs !== null, 'client.js 里找不到 PRESET_KNOB_KEYS')
  assert.deepEqual(clientPresetKnobs, implPresetKnobs, '两边清单必须一致，否则面板会数错旋钮数')
  assert.equal(clientPresetKnobs.length, 14)
})

test('F17-C 面板 · 预设项标出携带几个旋钮：全量 14 / 部分 3 / 旧预设「仅前缀」', async () => {
  const full = {
    shim: true,
    textualize: false,
    catalogRole: 'user',
    catalogMode: 'history',
    catalogDetail: 'brief',
    catalogPosition: 'tail',
    fallbackOrder: 'system-first',
    allowPassthrough: false,
    maxEmittedCalls: 4,
    failureThreshold: 5,
    catalogInclude: ['read'],
    catalogExclude: ['bash'],
    ignoreFailures: true,
    sampling: { temperature: 0.7 },
  }
  const { panel, tree } = await mount(
    statusOf(null, {
      presets: [
        { name: 'full', prefix: 'a', contentPrefix: '', ...full },
        { name: 'partial', prefix: 'b', contentPrefix: '', shim: true, catalogMode: 'history', maxEmittedCalls: 4 },
        { name: 'legacy', prefix: 'c', contentPrefix: '' },
      ],
    }),
  )
  const options = panel.find(tree, (props) => props['data-prefill-lab-preset-knobs'] !== undefined)
  assert.equal(options.length, 3, '三个预设各一行（占位「—」不算）')
  const byName = Object.fromEntries(options.map((node) => [node.props.value, node]))
  assert.equal(byName.full.props['data-prefill-lab-preset-knobs'], '14')
  assert.match(textOf(byName.full), /full/)
  assert.match(textOf(byName.full), /labPresetKnobsN/, '全量 = 含 N 项旋钮')
  assert.equal(byName.partial.props['data-prefill-lab-preset-knobs'], '3')
  assert.equal(byName.legacy.props['data-prefill-lab-preset-knobs'], '0')
  assert.match(textOf(byName.legacy), /labPresetKnobsNone/, '旧预设 = 仅前缀')
  assert.match(textOf(findOne(panel, tree, 'data-prefill-lab-preset-knobs-hint')), /labPresetKnobsHint/, '写清「套用会改配置」')
  assert.doesNotMatch(textOf(tree), /undefined/)
})

test('F17-C 面板 · 只数认得的键：嵌套 knobs 形态也认，认不出的键不算，无预设不崩', async () => {
  const nested = await mount(statusOf(null, { presets: [{ name: 'nested', prefix: '', contentPrefix: '', knobs: { shim: true, sampling: { seed: 7 }, brandNew: 1 } }] }))
  assert.equal(findOne(nested.panel, nested.tree, 'data-prefill-lab-preset-knobs').props['data-prefill-lab-preset-knobs'], '2', '嵌套形态：shim + sampling')
  const unknown = await mount(statusOf(null, { presets: [{ name: 'x', prefix: '', contentPrefix: '', brandNewKnob: 1 }] }))
  assert.equal(findOne(unknown.panel, unknown.tree, 'data-prefill-lab-preset-knobs').props['data-prefill-lab-preset-knobs'], '0', '认不出的键不算')
  const empty = await mount(statusOf(null))
  assert.equal(empty.panel.find(empty.tree, (props) => props['data-prefill-lab-preset-knobs'] !== undefined).length, 0, '没有预设 ⇒ 只有占位')
  assert.match(textOf(findOne(empty.panel, empty.tree, 'data-prefill-lab-preset-knobs-hint')), /labPresetKnobsHint/)
})

// ── F2 · 芯片（PrefillToggle）源码守卫：新标记只认 routeOff，且不碰唯一的状态点 ──────────
// ui-chip.test.mjs 只做源码计数（不改那个文件），这里补 F2 的结构守卫。
const chipSrc = src.slice(src.indexOf('    function PrefillToggle(props) {'), src.indexOf('    function fallbackName('))

test('F2 芯片 · 判据写死 + 新标记只出现 1 次且只在 routeOff 分支内', () => {
  assert.ok(chipSrc.length > 0, '找不到 PrefillToggle')
  // 硬约束（tests/ui-chip.test.mjs:27）：状态点仍只能声明 1 次 —— 新标记必须用新属性名。
  assert.equal((chipSrc.match(/'data-prefill-chip-dot'/g) ?? []).length, 1, '状态点仍只有 1 个')
  assert.match(
    chipSrc,
    /const routeOff = live\?\.state\?\.ui\?\.experimental === true && sessionRoute !== null && sessionRoute\.matchesPrefix === false/,
    '判据：实验开着 + 确实看过请求 + provider 不匹配（null 不算 false）',
  )
  assert.equal((chipSrc.match(/'data-prefill-chip-route'/g) ?? []).length, 1, '新标记只用一次')
  assert.match(
    chipSrc,
    /routeOff\s*\?\s*h\(\s*'span',\s*\{[\s\S]{0,400}'data-prefill-chip-route'/,
    '标记必须包在 routeOff 三元里（false 之外的任何状态都拿不到它）',
  )
  assert.match(chipSrc, /t\('reasoningRouteOff'\)/, 'tooltip 里有事实陈述')
  assert.match(chipSrc, /t\('reasoningRouteOffHint'\)/, 'tooltip 里有可照做的下一步')
  assert.doesNotMatch(chipSrc, /data-prefill-chip-warn/, '不引入 warn 属性')
  const compactBranch = chipSrc.slice(chipSrc.indexOf('summary !== undefined && compact'), chipSrc.indexOf(': summary === undefined'))
  assert.doesNotMatch(compactBranch, /data-prefill-chip-route/, '紧凑（钉住）分支不画路由标记')
})
