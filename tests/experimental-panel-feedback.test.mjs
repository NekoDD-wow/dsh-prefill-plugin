// 胶囊弹窗「实验」页的保存反馈与未保存草稿：
//   · 保存参数 / 套用前缀预设要看 applied.ok（代理起不来、路由写失败时报错，不报「已保存 / 已套用」）；
//   · 未保存的旋钮草稿不被状态广播（STATE_EVENT）或本页其它按钮（清零统计 / 另存预设…）的重载冲掉；
//   · 「本轮（即将发出）」显示已保存的前缀（代理实际会发的），不是草稿。
// 切 client.js 的 ExperimentalPanel 段，用 tests/client-render-harness.mjs 的假 React 真渲染。
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { loadSlice, findAll, textOf } from './client-render-harness.mjs'

const STATUS = '/api/dsh-prefill/experimental/status'
const CONFIG = '/api/dsh-prefill/experimental/config'
const PRESETS = '/api/dsh-prefill/experimental/presets'
const RESET = '/api/dsh-prefill/experimental/stats/reset'
const KNOBS = { port: 46321, prefix: '先想一下：', contentPrefix: '', providerId: 'prefill-think', modelId: 'deepseek-flash', match: '', shim: true, textualize: true, catalogRole: 'system', maxEmittedCalls: 8, failureThreshold: 3, catalogMode: 'each', catalogDetail: 'full', catalogPosition: 'head', loggingEnabled: false, loggingFile: 'x.jsonl', fallbackOrder: '', allowPassthrough: true, catalogInclude: [], catalogExclude: [], ignoreFailures: false, armId: '', runId: '', sampling: null, loggingResultEnabled: true, loggingResultFile: '', loggingReasoningHead: false, loggingSnippets: true }
const statusReply = () => ({ ok: true, experimental: true, knobs: { ...KNOBS }, stats: null, reasoning: { route: null, proxyRunning: false, audit: [] }, presets: [], turns: { total: 0 }, logging: {}, log: [], prefill: {} })

function mount(routes = {}) {
  const listeners = []
  const posts = []
  const window = { addEventListener: (type, fn) => listeners.push({ type, fn }), removeEventListener: (type, fn) => { const i = listeners.findIndex((l) => l.fn === fn); if (i >= 0) listeners.splice(i, 1) } }
  const postJson = async (path, body) => {
    posts.push({ path, body })
    const route = routes[path]
    if (route !== undefined) return typeof route === 'function' ? route(body) : route
    if (path === STATUS) return statusReply()
    return { ok: true }
  }
  const V = new Proxy({}, { get: () => ({}) })
  const _src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  const _rot = _src.slice(_src.indexOf('    // <log-rotation-pure>'), _src.indexOf('    // </log-rotation-pure>'))
  // eslint-disable-next-line no-new-func
  const ROT = _rot ? new Function(`${_rot}\nreturn { formatBytes, megabytesToBytes, bytesToMegabytesText, keepFilesToText, parseKeepFiles }`)() : {}
  const slice = loadSlice('    function ExperimentalPanel(props) {', '\n    function SbxSegment(props) {', ['ExperimentalPanel'], {
    ...ROT, V, postJson, window, STATE_EVENT: 'dsh-prefill:state-changed', notifyStateChanged: () => { for (const l of [...listeners]) if (l.type === 'dsh-prefill:state-changed') l.fn() },
    EXPERIMENTAL_STATUS_ROUTE: STATUS, EXPERIMENTAL_CONFIG_ROUTE: CONFIG, EXPERIMENTAL_PING_ROUTE: '/ping', EXPERIMENTAL_EXPORT_ROUTE: '/export', EXPERIMENTAL_STATS_RESET_ROUTE: RESET, EXPERIMENTAL_PRESETS_ROUTE: PRESETS, EXPERIMENTAL_SKIP_ROUTE: '/skip', REASONING_REPAIR_ROUTE: '/repair',
  })
  const el = () => slice.React.createElement(slice.exports.ExperimentalPanel, { t: (k) => k, sessionId: 's1' })
  const settle = () => new Promise((r) => setTimeout(r, 0))
  const render = () => slice.renderer.render(el())
  return { render, settle, posts, listeners, broadcast: () => { for (const l of [...listeners]) if (l.type === 'dsh-prefill:state-changed') l.fn() } }
}
const knob = (tree, name) => findAll(tree, (p) => p['data-prefill-lab-knob'] === name)[0]
const button = (tree, attr) => findAll(tree, (p) => p[attr] !== undefined && p.onClick !== undefined)[0]
async function ready(panel) {
  panel.render(); await panel.settle(); return panel.render()
}

test('保存参数时服务端回 applied.ok=false（代理起不来 / 路由写失败）⇒ 进错误提示，不显示「已保存」', async () => {
  const panel = mount({ [CONFIG]: () => ({ ...statusReply(), ok: true, applied: { ok: false, error: '代理未监听' } }) })
  let tree = await ready(panel)
  knob(tree, 'port').props.onChange({ target: { value: '46400' } })
  tree = panel.render()
  button(tree, 'data-prefill-lab-save').props.onClick()
  for (let i = 0; i < 4; i += 1) { await panel.settle(); tree = panel.render() }
  const err = findAll(tree, (p) => p['data-prefill-lab-error'] !== undefined)
  const notice = findAll(tree, (p) => p['data-prefill-lab-notice'] !== undefined)
  assert.equal(notice.length === 1 ? textOf(notice[0]) : '', '', '不应显示 labSaved')
  assert.equal(err.length, 1, 'applied.ok=false 应进错误提示（左侧页同一路径已经这样做，见 reasoningAct）')
})

test('未保存的旋钮草稿不被 STATE_EVENT 冲掉（芯片 / 设置页 / 卡片任何写入都会广播）', async () => {
  const panel = mount()
  let tree = await ready(panel)
  knob(tree, 'prefix').props.onChange({ target: { value: '改过但还没保存的前缀' } })
  knob(tree, 'temperature').props.onChange({ target: { value: '0.3' } })
  tree = panel.render()
  assert.equal(knob(tree, 'prefix').props.value, '改过但还没保存的前缀')
  panel.broadcast() // 例如用户点了输入框旁的「纯净」芯片
  for (let i = 0; i < 3; i += 1) { await panel.settle(); tree = panel.render() }
  assert.equal(knob(tree, 'prefix').props.value, '改过但还没保存的前缀', '草稿应保留（#45 PR A 对左侧页同类问题的修法：有未保存修改时不让广播覆盖）')
  assert.equal(knob(tree, 'temperature').props.value, '0.3')
})

test('点「清零统计」不丢掉其它未保存的旋钮', async () => {
  const panel = mount()
  let tree = await ready(panel)
  knob(tree, 'maxEmittedCalls').props.onChange({ target: { value: '4' } })
  tree = panel.render()
  button(tree, 'data-prefill-lab-reset').props.onClick()
  for (let i = 0; i < 4; i += 1) { await panel.settle(); tree = panel.render() }
  assert.equal(knob(tree, 'maxEmittedCalls').props.value, '4', '清零统计与旋钮无关，不该重置草稿')
})

test('「本轮（即将发出）」显示已保存的前缀（代理实际会发的），不显示未保存的草稿', async () => {
  const panel = mount()
  let tree = await ready(panel)
  knob(tree, 'prefix').props.onChange({ target: { value: '还没点保存' } })
  tree = panel.render()
  const next = findAll(tree, (p) => p['data-prefill-lab-log-next'] !== undefined)[0]
  assert.doesNotMatch(textOf(next), /还没点保存/, '没保存的前缀不会被发出，不该标成「即将发出」')
  assert.match(textOf(next), /先想一下：/)
})

test('套用前缀预设（会一并恢复旋钮、可能重建路由）时 applied.ok=false ⇒ 报错，不显示「已套用」', async () => {
  const panel = mount({
    [STATUS]: () => ({ ...statusReply(), presets: [{ name: 'arm-A', prefix: 'x', contentPrefix: '', shim: false }] }),
    [PRESETS]: (body) => (body.op === 'apply' ? { ...statusReply(), ok: true, applied: { ok: false, error: '代理未监听' } } : { ok: true }),
  })
  let tree = await ready(panel)
  findAll(tree, (p) => p['data-prefill-lab-preset'] !== undefined)[0].props.onChange({ target: { value: 'arm-A' } })
  tree = panel.render()
  button(tree, 'data-prefill-lab-preset-apply').props.onClick()
  for (let i = 0; i < 4; i += 1) { await panel.settle(); tree = panel.render() }
  assert.equal(findAll(tree, (p) => p['data-prefill-lab-error'] !== undefined).length, 1, 'applied.ok=false 应报错')
  assert.equal(findAll(tree, (p) => p['data-prefill-lab-notice'] !== undefined).length, 0, '不应显示 labPresetApplied')
})

test('applied.ok=true 照常显示「已保存」，草稿换成服务端值、不再标「未保存」', async () => {
  let saved = { ...KNOBS }
  const panel = mount({
    [STATUS]: () => ({ ...statusReply(), knobs: { ...saved } }),
    [CONFIG]: (body) => {
      saved = { ...saved, prefix: body.prefix }
      return { ...statusReply(), knobs: { ...saved }, ok: true, applied: { ok: true, enabled: false } }
    },
  })
  let tree = await ready(panel)
  knob(tree, 'prefix').props.onChange({ target: { value: '新前缀' } })
  tree = panel.render()
  assert.equal(findAll(tree, (p) => p['data-prefill-lab-unsaved'] !== undefined).length, 1, '改了没保存 ⇒ 标「未保存」')
  button(tree, 'data-prefill-lab-save').props.onClick()
  for (let i = 0; i < 4; i += 1) { await panel.settle(); tree = panel.render() }
  assert.equal(textOf(findAll(tree, (p) => p['data-prefill-lab-notice'] !== undefined)[0]), 'labSaved')
  assert.equal(findAll(tree, (p) => p['data-prefill-lab-error'] !== undefined).length, 0)
  assert.equal(findAll(tree, (p) => p['data-prefill-lab-unsaved'] !== undefined).length, 0, '保存成功后不再是未保存')
  assert.match(textOf(findAll(tree, (p) => p['data-prefill-lab-log-next'] !== undefined)[0]), /新前缀/, '保存后「即将发出」跟着变')
})

test('「另存为前缀预设」后输入框保持草稿里的新前缀（预设存的就是它）', async () => {
  const panel = mount()
  let tree = await ready(panel)
  knob(tree, 'prefix').props.onChange({ target: { value: '要存进预设的新前缀' } })
  tree = panel.render()
  const nameInput = findAll(tree, (p) => p['data-prefill-lab-preset-name'] !== undefined)[0]
  nameInput.props.onChange({ target: { value: 'arm-B' } })
  tree = panel.render()
  button(tree, 'data-prefill-lab-preset-save').props.onClick()
  for (let i = 0; i < 4; i += 1) { await panel.settle(); tree = panel.render() }
  const sent = panel.posts.find((p) => p.path === PRESETS && p.body.op === 'save')
  assert.equal(sent.body.prefix, '要存进预设的新前缀')
  assert.equal(knob(tree, 'prefix').props.value, '要存进预设的新前缀', '存完预设不该把输入框变回旧前缀')
})

test('重载时没改过的格跟着服务端走，改过的格保留；「放弃修改」回到服务端值', async () => {
  let server = { ...KNOBS }
  const panel = mount({ [STATUS]: () => ({ ...statusReply(), knobs: { ...server } }) })
  let tree = await ready(panel)
  knob(tree, 'prefix').props.onChange({ target: { value: '我改的前缀' } })
  tree = panel.render()
  // 别处（例如另一个窗口）改了调用上限并广播
  server = { ...server, maxEmittedCalls: 5 }
  panel.broadcast()
  for (let i = 0; i < 3; i += 1) { await panel.settle(); tree = panel.render() }
  assert.equal(knob(tree, 'prefix').props.value, '我改的前缀', '改过的格保留')
  assert.equal(knob(tree, 'maxEmittedCalls').props.value, '5', '没改过的格跟着服务端')
  button(tree, 'data-prefill-lab-discard').props.onClick()
  tree = panel.render()
  assert.equal(knob(tree, 'prefix').props.value, '先想一下：', '放弃修改 ⇒ 回到服务端值')
  assert.equal(findAll(tree, (p) => p['data-prefill-lab-unsaved'] !== undefined).length, 0)
  assert.equal(findAll(tree, (p) => p['data-prefill-lab-discard'] !== undefined).length, 0)
})
