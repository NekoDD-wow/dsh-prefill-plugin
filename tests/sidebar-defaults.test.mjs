// PR B（公开 issue #45 第 9–11 条）：默认值模型。
// 9  工作台类默认：左侧栏保存默认时保留 bench / benchTowers / seam；卡片加回「设为新会话默认」（复制本会话条目含工作台到 '*'）。
// 10 总览区分继承（默认）与自有（本会话）；「已设 / 未设」改为「开 / 关」；hint 说清默认作用于所有没单独设置的会话。
// 11 '*' 不提供严格档（会接管所有会话）；卡片只读行把 strict 误显示成「观察」的问题修掉。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { makeSettingsHarness } from './settings-harness.mjs'
import { makeHarness } from './sandbox-harness.mjs'
import { sandboxView } from '../sandbox-view.js'
import { migrateSandbox } from '../sandbox.js'
import { everyTurnFor } from '../gate.js'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const clone = (value) => JSON.parse(JSON.stringify(value))
const textOf = (node) => (node?.children ?? []).map((child) => (typeof child === 'string' ? child : textOf(child))).join('')

const LEVERS = { probeSection: false, probeContext: false, blockSections: false, blockContexts: false, blockTools: false, blockMessages: false }
const BENCH = [{ key: 'k1', ref: 'zh', name: '中文', text: '思维链（reasoning）全程用中文。' }]
const TOWERS = { t1: { ref: 't1', name: '塔', collapsed: false } }

const sidebarEnvelope = (patch = {}) => ({
  ok: true,
  state: {
    version: 2,
    armed: [],
    levers: LEVERS,
    allowKinds: ['user'],
    tools: null,
    ui: { motion: 'full' },
    everyTurn: {
      own: { enabled: true, text: '会话自己的', firstText: '', mode: 'always', checks: [] },
      off: { enabled: true, text: '关掉的', firstText: '', mode: 'always', checks: [] },
      '*': { enabled: true, text: '默认提醒', firstText: '', mode: 'always', checks: ['zh'], auto: { warmup: 3, streak: 3, probation: 2 } },
    },
    enabled: { off: { everyTurn: false } },
    sandbox: { '*': { level: 'controlled' }, own: { level: 'observe' } },
    ...patch,
  },
  tools: { catalog: [], sessions: { own: [], inherit: [], off: [] } },
  sandboxView: {
    '*': { level: 'controlled', levelFrom: 'global', packs: [] },
    own: { level: 'observe', levelFrom: 'session' },
    inherit: { level: 'controlled', levelFrom: 'global' },
    off: { level: 'controlled', levelFrom: 'global' },
  },
  injections: { catalog: { messages: [] } },
})

const mount = async (envelope) => {
  const h = makeSettingsHarness(envelope)
  h.render()
  await h.settle()
  return h
}

// ── 第 10 条：总览 ─────────────────────────────────────────────────────────

test('#45-10 总览：每轮注入 / 沙盒标出「默认」（继承 *）与「本会话」，值用「开 / 关」', async () => {
  const h = await mount(sidebarEnvelope())
  const tree = h.render()
  const pill = (attr, id) => h.find(tree, (props) => props[attr] === id)[0]
  const turn = (id) => pill('data-prefill-overview-everyturn', id)
  const sbx = (id) => pill('data-prefill-overview-sandbox', id)
  assert.ok(turn('own'), '每轮注入那一格要能定位')
  assert.equal(turn('own').props['data-from'], 'session')
  assert.equal(turn('inherit').props['data-from'], 'default')
  assert.match(textOf(turn('own')), /overviewOn · overviewFromSession$/)
  assert.match(textOf(turn('inherit')), /overviewOn · overviewFromDefault$/)
  // 左栏开关关掉的会话：哪怕条目 enabled，也是「关」（与 gate / 卡片同口径）。
  assert.match(textOf(turn('off')), /overviewOff · overviewFromSession$/)
  assert.doesNotMatch(textOf(tree), /defaultOn|defaultOff/, '总览不再用「已设 / 未设」')
  assert.equal(sbx('own').props['data-from'], 'session')
  assert.equal(sbx('inherit').props['data-from'], 'global')
  assert.match(textOf(sbx('own')), /sbxLevelObserve · overviewFromSession/)
  assert.match(textOf(sbx('inherit')), /sbxLevelControlled · overviewFromDefault/)
})

test('#45-10 总览：没有 * 也没有本会话条目 ⇒「关」且不标来源；* 关掉 ⇒ 继承的也是「关 · 默认」', async () => {
  const env = sidebarEnvelope({ everyTurn: { '*': { enabled: false, text: '默认提醒' } }, sandbox: {} })
  env.sandboxView = { inherit: { level: 'observe', levelFrom: 'default' } }
  let h = await mount(env)
  let tree = h.render()
  const turn = h.find(tree, (props) => props['data-prefill-overview-everyturn'] === 'inherit')[0]
  assert.match(textOf(turn), /overviewOff · overviewFromDefault$/)
  const sbx = h.find(tree, (props) => props['data-prefill-overview-sandbox'] === 'inherit')[0]
  assert.equal(textOf(sbx), 'overviewSandbox：sbxLevelObserve', '内置默认（观察）不标来源')
  h = await mount(sidebarEnvelope({ everyTurn: {} }))
  tree = h.render()
  const bare = h.find(tree, (props) => props['data-prefill-overview-everyturn'] === 'inherit')[0]
  assert.equal(textOf(bare), 'overviewEveryTurn：overviewOff')
})

test('#45-10 文案：总览 / 默认的 hint 说明「所有没单独设置的会话」，开 / 关 与来源标签中英文都有', () => {
  const dict = (lang) => {
    const at = src.indexOf(`    const ${lang} = {`)
    return src.slice(at, src.indexOf('\n    }\n', at))
  }
  for (const [lang, on, off, def, own] of [['zh', '开', '关', '默认', '本会话'], ['en', 'on', 'off', 'default', 'this session']]) {
    const body = dict(lang)
    assert.match(body, new RegExp(`overviewOn: '${on}'`))
    assert.match(body, new RegExp(`overviewOff: '${off}'`))
    assert.match(body, new RegExp(`overviewFromDefault: '${def}'`))
    assert.match(body, new RegExp(`overviewFromSession: '${own}'`))
    for (const key of ['everyTurnDefaultNow', 'everyTurnFollowingDefault', 'everyTurnSetDefault', 'everyTurnSetDefaultTip', 'everyTurnSetDefaultDone', 'defaultTurnBenchLocked', 'defaultTurnToPlain', 'defaultSbxStrictNote']) {
      assert.match(body, new RegExp(`\\n      ${key}: '`), `${lang} 缺 ${key}`)
    }
  }
  assert.match(dict('zh'), /defaultTurnHint: '所有没单独设置每轮注入的会话/)
  assert.match(dict('zh'), /defaultSbxHint: '所有没单独设档位/)
  assert.match(dict('en'), /defaultTurnHint: 'Every session without its own every-turn setting/)
  assert.match(dict('en'), /defaultSbxHint: 'Every session without its own level/)
})

// ── 第 9 条：左侧栏保存默认保留工作台 ────────────────────────────────────────

const benchDefault = (extra = {}) => ({
  enabled: true,
  text: '思维链（reasoning）全程用中文。',
  firstText: '首轮',
  mode: 'always',
  untilTurn: 0,
  checks: ['zh'],
  auto: { warmup: 3, streak: 3, probation: 2 },
  bench: BENCH,
  benchTowers: TOWERS,
  seam: true,
  ...extra,
})

test('#45-9 左侧栏：默认来自工作台时文本只读；保存只改开关 / 方式 / 轮数，bench / benchTowers / seam / 文本原样保留', async () => {
  const h = await mount(sidebarEnvelope({ everyTurn: { s1: { enabled: true, text: 'x' }, '*': benchDefault() } }))
  let tree = h.render()
  const text = () => h.find(tree, (props) => props['data-prefill-default-turn-text'] !== undefined)[0]
  assert.equal(text().props.readOnly, true, '工作台默认的文本是编译出来的，不在这里改')
  assert.equal(h.find(tree, (props) => props['data-prefill-default-turn-bench'] === 'locked').length, 1)
  h.find(tree, (props) => props['data-prefill-default-turn-mode'] === 'until')[0].props.onClick()
  tree = h.render()
  h.find(tree, (props) => props['data-prefill-default-turn-until'] !== undefined)[0].props.onChange({ target: { value: '4' } })
  tree = h.render()
  h.find(tree, (props) => props['data-prefill-default-turn-save'] !== undefined)[0].props.onClick()
  await h.settle()
  const saved = h.fetches.at(-1).body.everyTurn['*']
  assert.deepEqual(saved.bench, BENCH)
  assert.deepEqual(saved.benchTowers, TOWERS)
  assert.equal(saved.seam, true)
  assert.equal(saved.text, '思维链（reasoning）全程用中文。')
  assert.equal(saved.firstText, '首轮')
  assert.deepEqual(saved.checks, ['zh'])
  assert.equal(saved.mode, 'until')
  assert.equal(saved.untilTurn, 4)
  assert.equal(h.fetches.at(-1).body.everyTurn.s1.text, 'x', '别的会话不动')
})

test('#45-9 左侧栏：「改成纯文本默认」后文本可编辑，保存时丢掉工作台、写新文本', async () => {
  const h = await mount(sidebarEnvelope({ everyTurn: { '*': benchDefault() } }))
  let tree = h.render()
  h.find(tree, (props) => props['data-prefill-default-turn-plain'] !== undefined)[0].props.onClick()
  tree = h.render()
  const text = h.find(tree, (props) => props['data-prefill-default-turn-text'] !== undefined)[0]
  assert.equal(text.props.readOnly, false)
  assert.equal(h.find(tree, (props) => props['data-prefill-default-turn-bench'] === 'plain').length, 1, '提示保存会改成纯文本')
  text.props.onChange({ target: { value: '纯文本默认' } })
  tree = h.render()
  h.find(tree, (props) => props['data-prefill-default-turn-save'] !== undefined)[0].props.onClick()
  await h.settle()
  const saved = h.fetches.at(-1).body.everyTurn['*']
  assert.equal(saved.text, '纯文本默认')
  assert.equal('bench' in saved, false)
  assert.equal('benchTowers' in saved, false)
})

test('#45-9 左侧栏：纯文本默认照旧可改文本；从卡片带来的 auto 方式保存时不被降成 always', async () => {
  const h = await mount(sidebarEnvelope({ everyTurn: { '*': { enabled: true, text: 'a', firstText: '', mode: 'auto', checks: [], auto: { warmup: 2, streak: 4, probation: 1 } } } }))
  let tree = h.render()
  assert.equal(h.find(tree, (props) => props['data-prefill-default-turn-text'] !== undefined)[0].props.readOnly, false)
  assert.equal(h.find(tree, (props) => props['data-prefill-default-turn-mode'] === 'auto').length, 1, 'auto 照样显示出来')
  h.find(tree, (props) => props['data-prefill-default-turn-text'] !== undefined)[0].props.onChange({ target: { value: 'b' } })
  tree = h.render()
  h.find(tree, (props) => props['data-prefill-default-turn-save'] !== undefined)[0].props.onClick()
  await h.settle()
  const saved = h.fetches.at(-1).body.everyTurn['*']
  assert.equal(saved.text, 'b')
  assert.equal(saved.mode, 'auto')
  assert.deepEqual(saved.auto, { warmup: 2, streak: 4, probation: 1 })
})

// ── 第 9 条：卡片「设为新会话默认」 ───────────────────────────────────────────

const fnSrc = (head) => {
  const at = src.indexOf(head)
  assert.ok(at > 0, '找不到：' + head)
  return src.slice(at, src.indexOf('\n    }\n', at) + 7)
}
// 懒加载：改前 client.js 里没有这个函数，让每条测试各自失败而不是整份文件加载失败。
const defaultEveryTurnOf = (entry) => new Function(fnSrc('    function defaultEveryTurnOf(') + '\nreturn defaultEveryTurnOf')()(entry)

test('#45-9 defaultEveryTurnOf：照 0.18.2 的语义复制（enabled 恒 true、带工作台、去掉 seam / firstOnce / since / override）', () => {
  assert.equal(defaultEveryTurnOf(undefined), null)
  assert.equal(defaultEveryTurnOf(null), null)
  const own = {
    enabled: false,
    text: 'T',
    firstText: 'F',
    untilTurn: 3,
    mode: 'until',
    checks: ['zh'],
    auto: { warmup: 1, streak: 2, probation: 3, override: { action: 'pause', atTurn: 9 } },
    bench: BENCH,
    benchTowers: TOWERS,
    seam: true,
    since: 7,
    firstOnce: { atTurn: 8 },
  }
  const out = defaultEveryTurnOf(clone(own))
  assert.deepEqual(out, {
    enabled: true,
    text: 'T',
    firstText: 'F',
    untilTurn: 3,
    mode: 'until',
    checks: ['zh'],
    auto: { warmup: 1, streak: 2, probation: 3 },
    bench: BENCH,
    benchTowers: TOWERS,
  })
  // 空工作台不带 bench（和 writeEveryTurn 的 hasBench 一致）；没有 auto 给默认值。
  assert.deepEqual(defaultEveryTurnOf({ text: 'x', bench: [] }), { enabled: true, text: 'x', firstText: '', untilTurn: 0, mode: 'always', checks: [], auto: { warmup: 3, streak: 3, probation: 2 } })
  // 复制出来的 '*' 让没单独设置的会话真的按它注入（gate 读 everyTurn['*']）。
  const state = { everyTurn: { me: own, '*': out } }
  const inherited = everyTurnFor(state, 'other')
  assert.equal(inherited.text, 'T')
  assert.equal(inherited.from, 'default')
  assert.equal(inherited.since, 0)
  assert.equal(inherited.auto.override, undefined)
})

/** 切出卡片里的 hasOwnEveryTurn + setSessionAsDefault，用假的依赖跑。 */
const cardSetDefault = ({ stored, draft = null, sessionId = 'me' }) => {
  const start = src.indexOf('      // PR B（#45 第 9 条）：本会话有自己的条目时')
  assert.ok(start > 0, '找不到 setSessionAsDefault 段')
  const head = src.indexOf('      const setSessionAsDefault = async () => {', start)
  const end = src.indexOf('\n      }\n', head) + '\n      }\n'.length
  const body = src.slice(start, end)
  const calls = { writes: [], posts: [], envelopes: [], notified: 0, cleared: 0 }
  let current = clone({ state: stored })
  const postJson = async (_path, payload) => {
    if (payload !== undefined) {
      calls.posts.push(clone(payload))
      current = { state: { ...current.state, ...clone(payload) } }
    }
    return clone(current)
  }
  const writeEveryTurn = async (value) => {
    calls.writes.push(clone(value))
    current = { state: { ...current.state, everyTurn: { ...current.state.everyTurn, [sessionId]: { enabled: true, text: value.text, bench: value.bench, benchTowers: value.benchTowers, seam: value.seam } } } }
    return clone(current)
  }
  const make = new Function(
    'state', 'sessionId', 'everyTurnDraft', 'everyTurn', 'everyTurnTimer', 'clearTimeout', 'writeEveryTurn', 'postJson', 'STATE_ROUTE', 'setEnvelope', 'notifyStateChanged', 'defaultEveryTurnOf',
    body + '\nreturn { hasOwnEveryTurn, setSessionAsDefault }',
  )
  const out = make(
    stored, sessionId, draft, draft, { current: 1 }, () => { calls.cleared += 1 }, writeEveryTurn, postJson, '/api/dsh-prefill/state',
    (data) => calls.envelopes.push(data), () => { calls.notified += 1 }, defaultEveryTurnOf,
  )
  return { ...out, calls }
}

test('#45-9 卡片「设为新会话默认」：把本会话条目（含工作台）复制到 *，别的会话原样带上', async () => {
  const stored = { everyTurn: { me: benchDefault({ firstOnce: { atTurn: 4 }, since: 2 }), other: { enabled: true, text: 'o' } } }
  const ui = cardSetDefault({ stored })
  assert.equal(ui.hasOwnEveryTurn, true)
  await ui.setSessionAsDefault()
  assert.equal(ui.calls.writes.length, 0, '没有草稿就不重写本会话')
  assert.equal(ui.calls.posts.length, 1)
  const map = ui.calls.posts[0].everyTurn
  assert.deepEqual(map['*'].bench, BENCH)
  assert.deepEqual(map['*'].benchTowers, TOWERS)
  assert.equal(map['*'].enabled, true)
  assert.equal('seam' in map['*'] || 'firstOnce' in map['*'] || 'since' in map['*'], false)
  assert.deepEqual(map.me, stored.everyTurn.me, '本会话条目不动')
  assert.deepEqual(map.other, stored.everyTurn.other)
  assert.equal(ui.calls.envelopes.length, 1)
  assert.equal(ui.calls.notified, 1, '写完广播，左侧栏总览跟着刷新')
})

test('#45-9 卡片「设为新会话默认」：有未落盘的草稿先写掉再复制；本会话没有自己的条目 ⇒ 不显示入口、也不写', async () => {
  const draft = { text: '草稿', bench: BENCH, benchTowers: TOWERS }
  const ui = cardSetDefault({ stored: { everyTurn: { me: { enabled: true, text: '旧' } } }, draft })
  await ui.setSessionAsDefault()
  assert.equal(ui.calls.cleared, 1, '清掉 700ms 防抖')
  assert.equal(ui.calls.writes.length, 1)
  assert.equal(ui.calls.posts.at(-1).everyTurn['*'].text, '草稿')
  assert.deepEqual(ui.calls.posts.at(-1).everyTurn['*'].bench, BENCH)
  const none = cardSetDefault({ stored: { everyTurn: { '*': { enabled: true, text: 'd' } } } })
  assert.equal(none.hasOwnEveryTurn, false)
  assert.equal(await none.setSessionAsDefault(), null)
  assert.equal(none.calls.posts.length, 0)
})

test('#45-9 卡片接线：两步确认（ConfirmButton）+ 忙碌 / 错误走 act；只在本会话有条目时出现；只读行用「开 / 关」', () => {
  const at = src.indexOf("'data-prefill-everyturn-set-default': ''")
  assert.ok(at > 0)
  const block = src.slice(src.lastIndexOf('hasOwnEveryTurn', at) - 20, at + 900)
  assert.match(block, /hasOwnEveryTurn\s*\?\s*h\(\s*ConfirmButton,/)
  assert.match(block, /armed: confirming === 'everyturn-default'/)
  assert.match(block, /if \(!armConfirm\('everyturn-default'\)\) return/)
  assert.match(block, /act\('everyturn-default', t\('errOpBench'\), async \(\) => \{\s*await setSessionAsDefault\(\)/)
  assert.match(src, /t\('everyTurnDefaultNow'\) \+ '：' \+ \(state\?\.everyTurn\?\.\['\*'\]\?\.enabled === true \? t\('overviewOn'\) : t\('overviewOff'\)\)/)
})

// ── 第 11 条：严格档 ───────────────────────────────────────────────────────

test("#45-11 左侧栏：'*' 不提供严格档；状态里手写了 strict 就照实提示，而不是显示成「不设」", async () => {
  let h = await mount(sidebarEnvelope())
  let tree = h.render()
  const levels = h.find(tree, (props) => typeof props['data-prefill-default-sbx-level'] === 'string').map((node) => node.props['data-prefill-default-sbx-level'])
  assert.deepEqual(levels, ['none', 'observe', 'controlled'])
  assert.equal(h.find(tree, (props) => props['data-prefill-default-sbx-strict'] !== undefined).length, 0)
  h = await mount(sidebarEnvelope({ sandbox: { '*': { level: 'strict' } } }))
  tree = h.render()
  assert.equal(h.find(tree, (props) => props['data-prefill-default-sbx-strict'] !== undefined).length, 1)
})

const SID = 'session-sbx'
const sources = () => ({ injections: { catalog: { messages: [], sections: [], contexts: [] }, sessions: {} }, tools: { sessions: {} }, audit: {} })

test("#45-11 卡片只读行：'*' 是 strict 时显示「严格」，不再落成「观察」", () => {
  const state = { sandbox: { '*': { level: 'strict', rules: [] }, [SID]: { level: 'observe', rules: [] } } }
  const ui = makeHarness({ state, sandboxView: { [SID]: sandboxView(migrateSandbox(state), SID, sources()) } }, { sid: SID, sources })
  const tree = ui.render()
  const [line] = ui.find(tree, (props) => props['data-prefill-sbx-global-level-readonly'] !== undefined)
  assert.ok(line, '本会话不是严格档时显示只读行')
  assert.equal(line.props['data-prefill-sbx-global-level-readonly'], 'strict')
  assert.match(textOf(line), new RegExp(`：${ui.t('sbxLevelStrict')} · `))
  assert.doesNotMatch(textOf(line), new RegExp(`：${ui.t('sbxLevelObserve')} · `))
})
