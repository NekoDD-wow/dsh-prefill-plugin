// issue #45 PR D：左侧栏「预填装」页的布局 / 小节目录 / 文案（第 17–25 条）。
// 只测能在 harness 里测的：结构（锚点 / 目录 / 折叠）、文案选择（冒号 / 复数 / 人话名）、库重拉去抖。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { makeSettingsHarness } from './settings-harness.mjs'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

const envelope = () => ({
  ok: true,
  state: {
    version: 2,
    armed: ['s1'],
    levers: { probeSection: false, probeContext: false, blockSections: false, blockContexts: false, blockTools: false, blockMessages: false },
    allowKinds: ['user'],
    tools: null,
    ui: { motion: 'lite' },
    activePreset: { s1: 'card:宋知夏-2rgz3x', s2: 'builtin:pure', s3: 'card:c1' },
    everyTurn: { '*': { enabled: false, text: '', firstText: '', mode: 'always' } },
  },
  tools: { catalog: [], sessions: { 's1': ['read'], 'session-7feceadd-a936-40a0-b11e-0326e0107f1c': [] } },
  turns: { s1: 2 },
  sandboxView: {
    '*': { level: 'observe', packs: [{ id: 'dsh-core-prompt', label: 'DSH 核心 · 系统提示', locked: false, setting: {} }] },
  },
  snapshots: {},
  injections: { catalog: { messages: [] } },
})

const routes = (extra = {}) => ({
  '/api/dsh-prefill/packs': (body) =>
    body?.op === 'list'
      ? {
          ok: true,
          packs: [],
          blocks: [],
          towers: [],
          builtins: [{ id: 'pure', name: '纯净模式' }],
          everyTurnBlocks: [{ id: 'zh-thinking', name: '中文思考' }],
          everyTurnTowers: [{ id: 'rp-pack', name: '角色扮演套餐' }],
          hiddenBuiltins: ['zh-thinking', 'rp-pack', 'gone-x'],
        }
      : { ok: true },
  '/api/dsh-prefill/cards': (body) => (body?.op === 'list' ? { ok: true, cards: [{ id: 'c1', name: '小卡' }] } : { ok: true }),
  '/api/dsh-prefill/reasoning/status': () => ({ ok: true, enabled: false, proxyRunning: false, catalog: { tools: 1, bytes: 512 }, hasApiKey: true, failures: 0, audit: [] }),
  ...extra,
})

const text = (node, out = []) => {
  if (node === null || node === undefined) return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    for (const entry of node) text(entry, out)
    return out
  }
  for (const child of node.children ?? []) text(child, out)
  return out
}
const textOf = (node) => text(node).join('')

/** 渲染到库也加载完（envelope 到了以后 effect 才带着会话拉库）。 */
async function ready(options = {}) {
  const h = makeSettingsHarness(envelope(), { routes: routes(), ...options })
  h.render()
  await h.settle()
  h.render()
  await h.settle()
  return h
}

test('第 17 条：页头只剩一段说明（settingsWhere）；m1Note 只在开发者区展开时出现', async () => {
  const h = await ready()
  let tree = h.render()
  const all = text(tree)
  assert.equal(all.filter((line) => line === 'settingsWhere').length, 1)
  assert.equal(all.includes('intro'), false, '不再渲染同义的 intro 段')
  assert.equal(all.includes('m1Note'), false, '开发者区折叠时不显示 m1Note')
  h.find(tree, (props) => props['data-prefill-dev-toggle'] !== undefined)[0].props.onClick()
  tree = h.render()
  assert.equal(text(tree).includes('m1Note'), true, '展开后显示 m1Note')
})

test('第 18 条：运行状态 JSON 默认收起；可展开；「复制 JSON」写剪贴板', async () => {
  const h = await ready()
  let tree = h.render()
  h.find(tree, (props) => props['data-prefill-dev-toggle'] !== undefined)[0].props.onClick()
  tree = h.render()
  assert.equal(h.find(tree, (props) => props['data-prefill-state-json'] !== undefined).length, 0, '默认收起')
  const toggle = h.find(tree, (props) => props['data-prefill-state-json-toggle'] !== undefined)[0]
  assert.equal(toggle.props['data-prefill-state-json-toggle'], 'closed')
  toggle.props.onClick()
  tree = h.render()
  const pre = h.find(tree, (props) => props['data-prefill-state-json'] !== undefined)[0]
  assert.ok(pre, '点了之后展开')
  assert.equal(JSON.parse(textOf(pre)).armed[0], 's1')

  const written = []
  const had = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async (value) => written.push(value) } }, configurable: true, writable: true })
  try {
    h.find(tree, (props) => props['data-prefill-state-json-copy'] !== undefined)[0].props.onClick()
  } finally {
    if (had) Object.defineProperty(globalThis, 'navigator', had)
    else delete globalThis.navigator
  }
  assert.equal(written.length, 1)
  assert.equal(JSON.parse(written[0]).armed[0], 's1')
})

test('第 19 条：一串状态广播只让库重拉一次（去抖 300ms）', async () => {
  const h = await ready()
  const lists = () => h.fetches.filter((entry) => entry.path === '/api/dsh-prefill/packs' && entry.body?.op === 'list').length
  const before = lists()
  h.emitStateEvent()
  h.emitStateEvent()
  h.emitStateEvent()
  await h.settle()
  assert.equal(lists(), before, '广播当下不立刻重拉')
  await new Promise((resolve) => setTimeout(resolve, 360))
  assert.equal(lists(), before + 1, '安静 300ms 后只重拉一次')
})

test('第 20 条：已隐藏的内置显示内置清单里的名字（查不到才显示 id）', async () => {
  const h = await ready()
  const tree = h.render()
  const rows = h.find(tree, (props) => typeof props['data-prefill-lib-hidden'] === 'string')
  assert.deepEqual(rows.map((row) => row.props['data-prefill-lib-hidden']), ['zh-thinking', 'rp-pack', 'gone-x'])
  const names = rows.map((row) => text(row)[0])
  assert.deepEqual(names, ['中文思考', '角色扮演套餐', 'gone-x'])
})

test('第 21 条：内容列限宽居中；勾选框贴着文字；N 输入框有标签', async () => {
  const h = await ready()
  let tree = h.render()
  assert.equal(h.find(tree, (props) => props['data-prefill-page-column'] !== undefined).length, 1)
  const section = cut('function PrefillSection(props) {', 'function PrefillPanelIcon(props) {')
  assert.match(src, /pageColumn: \{[^}]*maxWidth: 960/, '版心与宿主「插件」页一致（960px）')
  assert.match(src, /padding: '0 clamp\(24px, 4vw, 48px\) 48px'/)
  assert.match(section, /\{ style: \{ \.\.\.S\.checkRow, cursor: 'pointer' \} \},\s*h\('input', \{\s*type: 'checkbox',\s*checked: defTurn\.enabled/, '默认开关用 checkRow（不再 space-between）')
  h.find(tree, (props) => props['data-prefill-default-turn-mode'] === 'until')[0].props.onClick()
  tree = h.render()
  const label = h.find(tree, (props, node) => node.type === 'label' && h.find(node, (inner) => inner['data-prefill-default-turn-until'] !== undefined).length > 0)[0]
  assert.ok(label, 'N 输入框包在 label 里')
  assert.deepEqual(text(label), ['defaultTurnUntilLabel', 'defaultTurnUntilUnit'])
  assert.equal(h.find(label, (props) => props['data-prefill-default-turn-until'] !== undefined)[0].props.placeholder, 'N')
})

test('第 22 条：页顶小节目录，点了滚到对应 data-prefill-anchor', async () => {
  const h = await ready()
  const tree = h.render()
  const links = h.find(tree, (props) => typeof props['data-prefill-toc-link'] === 'string')
  const order = links.map((node) => node.props['data-prefill-toc-link'])
  assert.deepEqual(order, ['overview', 'default-everyturn', 'library', 'prefs', 'reasoning', 'dev'])
  assert.deepEqual(text(links.map((node) => ({ children: node.children }))), ['tocOverview', 'tocDefaults', 'tocLibrary', 'tocPrefs', 'tocExperiment', 'tocDev'])
  const anchors = new Set(h.find(tree, (props) => typeof props['data-prefill-anchor'] === 'string').map((node) => node.props['data-prefill-anchor']))
  for (const anchor of order) assert.ok(anchors.has(anchor), '目录项都有对应锚点：' + anchor)

  const scrolled = []
  const hadDocument = 'document' in globalThis
  globalThis.document = {
    querySelector: (selector) => ({ scrollIntoView: (options) => scrolled.push({ selector, options }) }),
  }
  try {
    links.find((node) => node.props['data-prefill-toc-link'] === 'library').props.onClick()
  } finally {
    if (!hadDocument) delete globalThis.document
  }
  assert.deepEqual(scrolled, [{ selector: '[data-prefill-anchor="library"]', options: { block: 'start' } }])
})

test('第 22 条：总览行 —— 标题一行 + 灰色短 id（悬停看全）；在册 pill 单独区分', async () => {
  const long = 'session-7feceadd-a936-40a0-b11e-0326e0107f1c'
  const h = await ready({ titleOf: (id) => (id === long ? '你好助手自我介绍' : '') })
  const tree = h.render()
  const row = h.find(tree, (props) => props['data-prefill-overview-row'] === long)[0]
  const idNode = h.find(row, (props) => props['data-prefill-overview-id'] === long)[0]
  assert.equal(text(idNode)[0], '7feceadd…', '去掉 session- 前缀，取前 8 位')
  assert.equal(idNode.props.title, long, '悬停看全')
  assert.equal(text(row).includes(long), false, '整条长 id 不再占一行')
  assert.equal(h.find(row, (props) => props['data-prefill-overview-live'] !== undefined)[0].props['data-prefill-overview-live'], 'live')
  const untitled = h.find(tree, (props) => props['data-prefill-overview-row'] === 's2')[0]
  assert.equal(text(untitled)[0], 'overviewUntitled', '没有标题的会话显示「未命名会话」而不是整条 id')
})

test('第 23 条：「改回跟随系统」是动作按钮（无选中态、跟随中禁用），档位是选项', async () => {
  const h = await ready()
  let tree = h.render()
  const auto = () => h.find(h.render(), (props) => props['data-prefill-pref-motion'] === 'auto')[0]
  assert.equal(auto().props['aria-pressed'], undefined, '动作按钮不带选中态')
  assert.equal(auto().props.disabled, false, '手动选了档位时可点')
  const lite = h.find(tree, (props) => props['data-prefill-pref-motion'] === 'lite')[0]
  assert.equal(lite.props['aria-pressed'], 'true')
  auto().props.onClick()
  await h.settle()
  tree = h.render()
  assert.equal(auto().props.disabled, true, '已经跟随系统 ⇒ 按钮禁用，而不是画成选中')
  assert.equal(h.find(tree, (props) => props['aria-pressed'] === 'true').length, 0, '跟随系统时没有档位被画成选中')
})

test('第 24 条：预设显示人话名（角色卡用库里的名字，库里没有就去掉 card: 和短哈希；内置用名字）', async () => {
  const h = await ready()
  const tree = h.render()
  const presetText = (id) => text(h.find(h.find(tree, (props) => props['data-prefill-overview-row'] === id)[0], (props) => props['data-prefill-overview-preset'] !== undefined)[0]).join('')
  assert.equal(presetText('s1'), 'overviewPreset：宋知夏')
  assert.equal(presetText('s2'), 'overviewPreset：纯净模式')
  assert.equal(presetText('s3'), 'overviewPreset：小卡')
})

test('第 24 条：卡片只读行 =「新会话默认：开 · 在左侧栏改」；思考前缀占位是中性示例', () => {
  assert.match(src, /t\('cardDefaultLabel'\) \+ t\('labelColon'\) \+ \(state\?\.everyTurn\?\.\['\*'\]\?\.enabled === true \? t\('stateOn'\) : t\('stateOff'\)\) \+ ' · ' \+ t\('movedToSidebarShort'\)/)
  assert.match(src, /cardDefaultLabel: '新会话默认',/)
  assert.match(src, /stateOn: '开',/)
  assert.match(src, /movedToSidebarShort: '在左侧栏改',/)
  assert.doesNotMatch(src, /reasoningPrefixPlaceholder: '[^']*他喵/)
  assert.match(src, /librarySession: '工作区',/, '库标签缩短，不再折两行')
})

// 英文：用一份小字典代替 t，看冒号 / 复数 / 来源包名。
const EN = {
  labelColon: ': ',
  overviewPreset: 'Preset',
  overviewNone: 'none',
  overviewSandbox: 'Sandbox',
  overviewEveryTurn: 'Every-turn',
  stateOn: 'on',
  stateOff: 'off',
  sbxLevelObserve: 'Observe',
  reasoningCatalog: 'Catalog',
  reasoningCatalogValue: '{n} tools · {kb} KB',
  reasoningCatalogValueOne: '{n} tool · {kb} KB',
  'sbxPack_dsh-core-prompt': 'DSH core · system prompt',
}

test('第 25 条：英文用半角冒号、单数 tool、来源包名有译文就用译文', async () => {
  const h = await ready({ t: (key) => EN[key] ?? key })
  const tree = h.render()
  const overview = textOf(h.find(tree, (props) => props['data-prefill-overview-row'] === 's2')[0])
  assert.match(overview, /Every-turn: off/)
  assert.doesNotMatch(overview, /：/)
  const reasoning = textOf(h.find(tree, (props) => props['data-prefill-reasoning'] !== undefined)[0])
  assert.match(reasoning, /Catalog: 1 tool · 0\.5 KB/)
  assert.doesNotMatch(reasoning, /：/)
  const pack = textOf(h.find(tree, (props) => props['data-prefill-default-pack'] === 'dsh-core-prompt')[0])
  assert.match(pack, /^DSH core · system prompt/)
})

test('第 25 条：英文页头说明换成新文案（不再说这页是开发者开关页）', () => {
  assert.ok(src.includes("settingsWhere: 'Global settings: session overview, new-session defaults, library and preferences."))
  assert.doesNotMatch(src, /settingsWhere: '[^']*developer\/diagnostic global switches/)
  assert.match(src, /labelColon: ': ',/)
  assert.match(src, /reasoningCatalogValueOne: '\{n\} tool · \{kb\} KB',/)
})

function cut(head, tail) {
  const at = src.indexOf(head)
  assert.ok(at > 0, '找不到源码段：' + head)
  return src.slice(at, src.indexOf(tail, at))
}
