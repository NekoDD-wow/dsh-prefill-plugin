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
}
/** experimental/status 的回包形状（impl.js experimentalStatus）：stats 代理没跑时是 null。 */
const statusOf = (stats) => ({
  ok: true,
  experimental: true,
  knobs: KNOBS,
  stats,
  reasoning: { route: null, proxyRunning: false, audit: [] },
  presets: [],
  turns: { total: 0, session: 0 },
  logging: { enabled: false, file: 'x.jsonl', exists: false, bytes: 0, dumpFile: '', rawFile: '', contentFile: '' },
  log: [],
  prefill: { enabled: false, proxyRunning: false, routeOk: false, skipQueued: false, skipping: false, ready: false },
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
function makePanel(statusReply) {
  const fake = makeFakeReact()
  const listeners = []
  const window = {
    addEventListener(type, fn) {
      listeners.push({ type, fn })
    },
    removeEventListener() {},
  }
  const postJson = async (path) => {
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
  const render = () => {
    fake.resetCursors()
    return mod.ExperimentalPanel({ t: (key) => key, sessionId: 's1' })
  }
  const find = (tree, pred) => walk(tree).filter((node) => pred(node.props ?? {}, node))
  return { render, find, listeners }
}

/** 首帧 = 加载中；load() 的 promise 落地后再渲染 = 完整面板（修复前这里会抛 TypeError）。 */
async function mount(statusReply) {
  const panel = makePanel(statusReply)
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
