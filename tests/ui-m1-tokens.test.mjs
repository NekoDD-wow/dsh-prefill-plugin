// M1 底座收口 + P0 止血回归测试（先红后绿）：
// 1. // <tokens> 令牌底座与组件级作用域 <style>（严禁全局污染 / 严禁放进 <button>）
// 2. WAAPI // <motion> 升级：HAS_LINEAR_EASING、MOTION.springSnappy（过冲 ≤1.2%）、isSpringEasing() lite 降级、卡片入场 springSnappy / 退场 easeOut
// 3. P0-① 暗色开关无 #fff、硬编码 HEX 清零（SaveCheck / verdictColor / Sandbox / COLOR_VARS）
// 4. P0-② 统一防抖落盘总线 createDraftBus + flushAllDrafts（保存/导出/关卡片防丢稿，切 sessionId 防跨会话污染）
// 5. P0-③ 停掉 SandboxSection & InjectionSection 2500ms 重复 /state 轮询 + 保留轮询严格遵守 document.hidden
// 6. P0-④ 消灭弯折括号伪影：S.tocLinkActive 平直底边无 inset 2px 0 0；V.callout 无 borderLeft / inset 3px 0 0
// 7. P0-⑤ 3 处实机小 Bug：S.pill 补 1px 透明边框、设置页总览 observe 档 blocked>0 不误黄、statusPill 箭头方向与 140ms 旋转过渡
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { loadClient, findAll } from './client-render-harness.mjs'
import { makeSettingsHarness } from './settings-harness.mjs'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const cut = (from, to) => {
  const a = src.indexOf(from)
  const b = a < 0 ? -1 : src.indexOf(to, a)
  return a >= 0 && b > a ? src.slice(a, b) : ''
}
const tokensSrc = cut('// <tokens>', '// </tokens>')
const motionSrc = cut('// <motion>', '// </motion>')
const draftBusSrc = cut('// <draft-bus>', '// </draft-bus>')
const dockSrc = cut('    function PrefillDock(props) {', '    function UsagePanel(props) {')
const sandboxSrc = cut('    function SandboxSection(props) {', '    function InjectionSection(props) {')
const injectSrc = cut('    function InjectionSection(props) {', '    function SessionModeBadge(props) {')

class FakeEvent {
  constructor(type, init) {
    this.type = type
    this.detail = init?.detail
  }
}

function fakeWindow({ supportsLinear = true, reduce = false } = {}) {
  return {
    CSS: {
      supports(prop, val) {
        return supportsLinear && prop === 'animation-timing-function' && typeof val === 'string' && val.startsWith('linear(')
      },
    },
    matchMedia: () => ({ matches: reduce, addEventListener() {} }),
    dispatchEvent: () => true,
  }
}

function fakeEl() {
  const calls = []
  return {
    style: { willChange: '' },
    calls,
    animate(frames, timing) {
      const anim = {
        frames,
        timing,
        finished: Promise.resolve(),
        cancel() {},
      }
      calls.push(anim)
      return anim
    },
  }
}

// ── 1. // <tokens> 底座与组件作用域 <style> ────────────────────────────

test('[M1-1] // <tokens> 围栏：6 档整数字号、4 档舒展圆角、5 档 4px 间距、mix()、T.surface / T.layout', () => {
  assert.ok(tokensSrc.length > 0, '缺少 // <tokens> ... // </tokens> 围栏')
  // eslint-disable-next-line no-new-func
  const mod = new Function(`${tokensSrc}\nreturn { T, mix, SCOPED_STYLE_CARD, SCOPED_STYLE_PAGE }`)()
  assert.deepEqual(Object.values(mod.T.font), [11, 12, 13, 14, 16, 20])
  assert.equal(Object.keys(mod.T.radius).length, 4)
  assert.deepEqual(Object.values(mod.T.radius), [8, 10, 14, 999])
  assert.deepEqual(Object.values(mod.T.space), [4, 8, 12, 16, 24])
  assert.equal(mod.mix('var(--dsw-alias-brand-primary)', 8), 'color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, transparent)')
  assert.equal(mod.mix('var(--dsw-alias-brand-primary)', 24, 'var(--dsw-alias-border-l1)'), 'color-mix(in srgb, var(--dsw-alias-brand-primary) 24%, var(--dsw-alias-border-l1))')
  assert.equal(mod.T.surface.L0, 'var(--dsw-alias-bg-base)')
  assert.equal(mod.T.surface.L1, 'var(--dsw-alias-bg-layer-1)')
  assert.equal(mod.T.surface.L2, 'var(--dsw-alias-bg-layer-2)')
  assert.equal(mod.T.surface.L3, 'var(--dsw-alias-bg-layer-3)')
  assert.equal(mod.T.layout.num.fontVariantNumeric, 'tabular-nums')
  // 作用域 CSS 必须全量带前缀、覆盖 hover / active / focus-visible / scrollbar、且零色值 transition
  for (const [label, css, prefix] of [
    ['card', mod.SCOPED_STYLE_CARD, '[data-prefill-card-panel]'],
    ['page', mod.SCOPED_STYLE_PAGE, '[data-prefill-page]'],
  ]) {
    assert.equal(typeof css, 'string', `${label} scoped css 应为字符串`)
    assert.ok(css.includes(':hover'), `${label} 缺 :hover`)
    assert.ok(css.includes(':active'), `${label} 缺 :active`)
    assert.ok(css.includes(':focus-visible'), `${label} 缺 :focus-visible`)
    assert.ok(css.includes('scrollbar'), `${label} 缺细滚动条规则`)
    assert.doesNotMatch(css, /transition\s*:[^;]*(background|color|border)/i, `${label} 不得有色值 transition`)
    // 每条顶层规则选择器（去除 @media 包装，且不切开 :is(...) 括号内逗号）都必须包含容器前缀，严禁污染宿主全局
    const splitTopSelectors = (selectorList) => {
      const parts = []
      let depth = 0
      let cur = ''
      for (const ch of selectorList) {
        if (ch === '(') depth += 1
        else if (ch === ')') depth = Math.max(0, depth - 1)
        if (ch === ',' && depth === 0) {
          parts.push(cur.trim())
          cur = ''
        } else cur += ch
      }
      if (cur.trim() !== '') parts.push(cur.trim())
      return parts
    }
    const stripped = css.replace(/@media[^{]*\{([\s\S]*?)\}\s*\}/g, '$1')
    for (const block of stripped.split('}')) {
      const sel = block.split('{')[0]?.trim() ?? ''
      if (sel === '' || sel.startsWith('@')) continue
      for (const part of splitTopSelectors(sel)) {
        assert.ok(part.includes(prefix), `${label} 存在未限定作用域的选择器：${part}`)
      }
    }
  }
})

test('[M1-1] 作用域 <style> 挂在卡片根容器与设置页根容器内（且绝不放进 <button>）', async () => {
  const env = loadClient({
    routes: {
      '/api/dsh-prefill/summary': () => ({ ok: true, rev: '1', sessionId: 's1', prefill: { s1: 'default' } }),
      '/api/dsh-prefill/state': () => ({ ok: true, state: { prefill: { s1: 'default' }, gate: {}, everyTurn: {}, ui: {} }, turns: {}, materialized: {} }),
      '/api/dsh-prefill/draft': () => ({ ok: true, draft: [] }),
      '/api/dsh-prefill/packs': () => ({ ok: true, packs: [], status: { enabled: false } }),
      '/api/dsh-prefill/cards': () => ({ ok: true, cards: [] }),
      '/api/dsh-prefill/usage': () => ({ ok: true }),
    },
  })
  const h = env.React.createElement
  const dockEl = () => h('div', null, h(env.components.PrefillToggle, { sessionId: 's1' }), h(env.components.PrefillDock, { sessionId: 's1' }))
  let tree = env.renderer.render(dockEl())
  await env.settle()
  tree = env.renderer.render(dockEl())
  findAll(tree, (p) => p['data-prefill-chip'] === '1')[0].props.onClick()
  for (let i = 0; i < 4; i += 1) {
    await env.settle()
    tree = env.renderer.render(dockEl())
  }
  const panel = findAll(tree, (p) => p['data-prefill-card-panel'] === '1')[0]
  assert.ok(panel, '卡片根容器存在')
  const cardStyles = findAll(panel, (p, node) => node.type === 'style' && p['data-prefill-scoped-style'] === 'card')
  assert.equal(cardStyles.length, 1, '卡片根容器内挂载 1 份作用域 <style>')
  const buttonsWithStyle = findAll(panel, (_p, node) => node.type === 'button' && findAll(node, (_q, inner) => inner.type === 'style').length > 0)
  assert.equal(buttonsWithStyle.length, 0, '任何 <button> 内部不得包含 <style>')

  const pageTree = env.renderer.render(h(env.components.PrefillSection, { t: (k) => k }))
  const pageRoot = findAll(pageTree, (p) => p['data-prefill-page'] === 'prefill')[0]
  assert.ok(pageRoot, '设置页根容器存在')
  assert.ok(['full', 'lite', 'off'].includes(pageRoot.props['data-prefill-motion']), '设置页根容器同步挂 data-prefill-motion 供作用域 CSS 遵守 motion=off')
  const pageStyles = findAll(pageRoot, (p, node) => node.type === 'style' && p['data-prefill-scoped-style'] === 'page')
  assert.equal(pageStyles.length, 1, '设置页根容器内挂载 1 份作用域 <style>')
})

// ── 2. WAAPI // <motion> 升级 ─────────────────────────────────────────

test('[M1-2] HAS_LINEAR_EASING / MOTION.springSnappy（过冲 ≤1.2%）/ easeGem / isSpringEasing lite 降级', () => {
  // 支持 linear()
  // eslint-disable-next-line no-new-func
  const modern = new Function('window', 'CustomEvent', `${motionSrc}\nreturn { HAS_LINEAR_EASING, MOTION, isSpringEasing, play, setMotionPref }`)(fakeWindow({ supportsLinear: true }), FakeEvent)
  assert.equal(modern.HAS_LINEAR_EASING, true)
  assert.equal(modern.MOTION.fast, 120)
  assert.equal(modern.MOTION.base, 180)
  assert.equal(modern.MOTION.slow, 260)
  assert.equal(modern.MOTION.spring, 'cubic-bezier(.34,1.56,.64,1)')
  assert.equal(modern.MOTION.easeGem, 'cubic-bezier(0.2, 0, 0, 1)')
  assert.match(modern.MOTION.springSnappy, /^linear\(/)
  const nums = modern.MOTION.springSnappy.slice(7, -1).split(',').map((s) => Number.parseFloat(s.trim()))
  assert.equal(nums[0], 0)
  assert.equal(nums.at(-1), 1)
  const peak = Math.max(...nums)
  assert.ok(peak <= 1.012, `springSnappy 过冲 ${((peak - 1) * 100).toFixed(2)}% 超过 1.2%`)
  assert.equal(modern.isSpringEasing(modern.MOTION.spring), true)
  assert.equal(modern.isSpringEasing(modern.MOTION.springSnappy), true)
  assert.equal(modern.isSpringEasing(modern.MOTION.ease), false)

  // lite 档把 springSnappy 降级为 MOTION.ease（timing 与 keyframe 均降级）
  modern.setMotionPref('lite')
  const el = fakeEl()
  const anim = modern.play(
    el,
    [{ opacity: 0, transform: 'scale(.96)', easing: modern.MOTION.springSnappy }, { opacity: 1, transform: 'none' }],
    { duration: modern.MOTION.base, easing: modern.MOTION.springSnappy },
  )
  assert.ok(anim)
  assert.equal(anim.timing.easing, modern.MOTION.ease, 'lite 档 timing.easing 降级为 ease')
  assert.equal(anim.frames[0].easing, modern.MOTION.ease, 'lite 档 keyframe.easing 降级为 ease')

  // 老引擎不支持 linear() ⇒ 回退 cubic-bezier(0.2, 0, 0, 1)，且 lite 同样降级
  // eslint-disable-next-line no-new-func
  const legacy = new Function('window', 'CustomEvent', `${motionSrc}\nreturn { HAS_LINEAR_EASING, MOTION, isSpringEasing, play, setMotionPref }`)(fakeWindow({ supportsLinear: false }), FakeEvent)
  assert.equal(legacy.HAS_LINEAR_EASING, false)
  assert.equal(legacy.MOTION.springSnappy, 'cubic-bezier(0.2, 0, 0, 1)')
  assert.equal(legacy.isSpringEasing(legacy.MOTION.springSnappy), true)
  legacy.setMotionPref('lite')
  const el2 = fakeEl()
  const anim2 = legacy.play(el2, [{ opacity: 0 }, { opacity: 1 }], { duration: legacy.MOTION.base, easing: legacy.MOTION.springSnappy })
  assert.equal(anim2.timing.easing, legacy.MOTION.ease)

  // 卡片入场切用 springSnappy，退场保持 easeOut
  assert.match(dockSrc, /play\(el, CARD_ENTER\(originRef\.current\), \{ duration: MOTION\.base, easing: MOTION\.springSnappy \}\)/)
  assert.match(dockSrc, /play\(el, CARD_EXIT\(originRef\.current\), \{ duration: MOTION\.fast, easing: MOTION\.easeOut, fill: 'forwards' \}\)/)
})

// ── 3. P0-① 暗色开关白球贴白轨 + 硬编码 HEX 清零 ───────────────────────

test('[M1-P0-1] 暗色开关无 #fff；SaveCheck / Sandbox / verdictColor / COLOR_VARS 硬编码 HEX 清零', () => {
  const switchSrc = cut('      const switchEl = (key, color) => {', '      // P0-4 / P1-9：每个左栏项')
  assert.ok(switchSrc.length > 0)
  assert.doesNotMatch(switchSrc, /#fff/i, 'switchEl 圆点不再写死 #fff')
  assert.match(switchSrc, /background: 'var\(--dsw-alias-bg-base\)'/, 'switchEl 圆点使用 --dsw-alias-bg-base')
  assert.doesNotMatch(switchSrc, /transition:[^,\n]*background/, 'switchEl 轨道零色值 transition')

  const saveCheckSrc = cut('    function SaveCheck(props) {', '    const SECTION_SAVED_MS =')
  assert.doesNotMatch(saveCheckSrc, /#fff/i, 'SaveCheck 不再写死 #fff')
  assert.match(saveCheckSrc, /color: 'var\(--dsw-alias-bg-base\)'/)

  assert.doesNotMatch(sandboxSrc, /#fff/i, 'SandboxSection 不再写死 #fff')
  assert.doesNotMatch(sandboxSrc, /#1f2128|#e8e8ee/i, '沙盒溯源码框不再写死暗色 HEX')
  assert.match(sandboxSrc, /'data-prefill-sbx-trace-code': '', style: \{[^\n]*background: 'var\(--dsw-alias-bg-layer-2\)'[^\n]*color: 'var\(--dsw-alias-label-primary\)'[^\n]*border: '1px solid var\(--dsw-alias-border-l1\)'/)

  const verdictLine = src.split('\n').find((line) => line.includes('const verdictColor =')) ?? ''
  assert.ok(verdictLine.length > 0)
  assert.doesNotMatch(verdictLine, /#[0-9a-fA-F]{3,6}/, 'verdictColor 不再写死 HEX')
  for (const tone of ['success', 'warn', 'error', 'idle']) {
    assert.ok(verdictLine.includes(`--dsw-alias-state-${tone}-primary`), `verdictColor 缺 state-${tone}-primary`)
  }

  const colorVarsSrc = cut('    const COLOR_VARS = {', '    /** 左栏顺序')
  assert.doesNotMatch(colorVarsSrc, /#[0-9a-fA-F]{3,6}/, 'COLOR_VARS 不再含硬编码 HEX')
  for (const key of ['--pf-card', '--pf-system', '--pf-turn', '--pf-lore', '--pf-user', '--pf-ai', '--pf-ws', '--pf-adv', '--pf-off']) {
    assert.ok(colorVarsSrc.includes(`'${key}':`), `COLOR_VARS 保留键名 ${key}`)
  }
})

// ── 4. P0-② 统一防抖落盘总线（根治丢稿 & 跨会话污染） ──────────────────

test('[M1-P0-2] createDraftBus 纯逻辑：覆盖取消旧定时器、按 sessionId 冲刷、discard 不落盘', async () => {
  assert.ok(draftBusSrc.length > 0, '缺少 // <draft-bus> ... // </draft-bus> 围栏')
  // eslint-disable-next-line no-new-func
  const { createDraftBus } = new Function(`${draftBusSrc}\nreturn { createDraftBus }`)()
  const bus = createDraftBus()
  const log = []
  bus.schedule('ws', { sessionId: 's1', cancel: () => log.push('cancel-1'), commit: async () => log.push('commit-1') })
  bus.schedule('ws', { sessionId: 's1', cancel: () => log.push('cancel-2'), commit: async () => log.push('commit-2') })
  bus.schedule('system', { sessionId: 's2', cancel: () => log.push('cancel-s2'), commit: async () => log.push('commit-s2') })
  assert.deepEqual(log, ['cancel-1'], '重新排程取消上一次定时器')
  await bus.flushAll('s1')
  assert.deepEqual(log, ['cancel-1', 'cancel-2', 'commit-2'], '只冲刷 s1，不动 s2')
  assert.equal(bus.hasPending('system'), true)
  bus.discard(['system'])
  assert.deepEqual(log, ['cancel-1', 'cancel-2', 'commit-2', 'cancel-s2'], 'discard 取消但不提交')
  assert.equal(bus.size(), 0)
})

test('[M1-P0-2] PrefillDock：防抖中点保存/关卡片自动 flush 防丢稿；切 sessionId 先冲刷旧会话不污染新会话', async () => {
  const savedPacks = []
  const stateWrites = []
  const state = {
    prefill: { s1: 'default', s2: 'default' },
    activePreset: { s1: 'pack:my-pack' },
    gate: {},
    everyTurn: {},
    overrides: {},
    workspaceInstructions: {},
    ui: {},
  }
  const env = loadClient({
    routes: {
      '/api/dsh-prefill/summary': (body) => ({ ok: true, rev: '1', sessionId: body.sessionId, prefill: state.prefill }),
      '/api/dsh-prefill/state': (body) => {
        if (body?.sessionPatch) {
          stateWrites.push(JSON.parse(JSON.stringify(body)))
          const sid = body.sessionPatch.target
          if (body.sessionPatch.set?.overrides) state.overrides[sid] = body.sessionPatch.set.overrides
          if (body.sessionPatch.set?.workspaceInstructions) state.workspaceInstructions[sid] = body.sessionPatch.set.workspaceInstructions
        }
        return { ok: true, state, turns: {}, materialized: {} }
      },
      '/api/dsh-prefill/draft': () => ({ ok: true, draft: [] }),
      '/api/dsh-prefill/packs': (body) => {
        if (body?.op === 'save') savedPacks.push(JSON.parse(JSON.stringify(body)))
        return { ok: true, packs: [{ name: 'my-pack', count: 0 }], builtins: [], status: { enabled: false } }
      },
      '/api/dsh-prefill/cards': () => ({ ok: true, cards: [] }),
      '/api/dsh-prefill/usage': () => ({ ok: true }),
    },
  })
  const h = env.React.createElement
  const renderDock = async (sid) => {
    const el = h('div', null, h(env.components.PrefillToggle, { sessionId: sid }), h(env.components.PrefillDock, { sessionId: sid }))
    let tree = env.renderer.render(el)
    for (let i = 0; i < 4; i += 1) {
      await env.settle()
      tree = env.renderer.render(el)
    }
    return tree
  }
  let tree = await renderDock('s1')
  findAll(tree, (p) => p['data-prefill-chip'] === '1')[0].props.onClick()
  tree = await renderDock('s1')

  // 切到「工作区说明」→ 点「改写」→ 700ms 内连续两次输入 → advance(800) 必须按第 2 次值自动落盘（不得误清自己的新定时器）
  findAll(tree, (p) => p['data-prefill-nav'] === 'workspace')[0].props.onClick()
  tree = await renderDock('s1')
  findAll(tree, (p) => p['data-prefill-ws-mode'] === 'rewrite')[0].props.onClick()
  tree = await renderDock('s1')
  stateWrites.length = 0
  findAll(tree, (p) => p['data-prefill-ws-text'] === '1')[0].props.onChange({ target: { value: '第 1 次输入' } })
  tree = await renderDock('s1')
  await env.advance(200)
  findAll(tree, (p) => p['data-prefill-ws-text'] === '1')[0].props.onChange({ target: { value: '连续第 2 次输入' } })
  tree = await renderDock('s1')
  await env.advance(800)
  assert.equal(stateWrites.some((w) => w.sessionPatch?.target === 's1' && w.sessionPatch?.set?.workspaceInstructions?.text === '第 1 次输入'), false, '第 1 次防抖已被取消')
  assert.equal(stateWrites.some((w) => w.sessionPatch?.target === 's1' && w.sessionPatch?.set?.workspaceInstructions?.text === '连续第 2 次输入'), true, '第 2 次防抖定时器正常落盘，未被误清')

  // 输入正文（700ms 防抖未到期）→ 立即点「保存」
  stateWrites.length = 0
  findAll(tree, (p) => p['data-prefill-ws-text'] === '1')[0].props.onChange({ target: { value: '未到期就点保存的正文' } })
  tree = await renderDock('s1')
  // 还没过 700ms，立即点保存按钮
  findAll(tree, (p) => p['data-prefill-save'] === '')[0].props.onClick()
  await env.settle()
  await env.settle()
  assert.equal(savedPacks.length, 1, '已触发保存预设')
  assert.equal(savedPacks[0].workspaceInstructions?.text, '未到期就点保存的正文', '保存前 flush 了未落盘草稿，没有丢稿')
  assert.ok(stateWrites.some((w) => w.sessionPatch?.target === 's1' && w.sessionPatch?.set?.workspaceInstructions?.text === '未到期就点保存的正文'), '已同步冲刷落盘到 s1')

  // 再次在 s1 上编辑（700ms 防抖未到期）→ 立即切到 s2 → 推进 2000ms：只写回 s1，绝不写进 s2
  stateWrites.length = 0
  findAll(tree, (p) => p['data-prefill-ws-text'] === '1')[0].props.onChange({ target: { value: '切会话前最后一句' } })
  tree = await renderDock('s1')
  tree = await renderDock('s2')
  await env.advance(2000)
  assert.ok(stateWrites.some((w) => w.sessionPatch?.target === 's1' && w.sessionPatch?.set?.workspaceInstructions?.text === '切会话前最后一句'), '切会话前安全冲刷旧会话 s1')
  assert.equal(stateWrites.some((w) => w.sessionPatch?.target === 's2'), false, '绝不把旧定时器回调写进新会话 s2')

  // 在 s2 上编辑后立刻关卡片：关闭前自动 flush 防丢稿
  findAll(tree, (p) => p['data-prefill-chip'] === '1')[0].props.onClick()
  tree = await renderDock('s2')
  findAll(tree, (p) => p['data-prefill-nav'] === 'workspace')[0].props.onClick()
  tree = await renderDock('s2')
  findAll(tree, (p) => p['data-prefill-ws-mode'] === 'rewrite')[0].props.onClick()
  tree = await renderDock('s2')
  stateWrites.length = 0
  findAll(tree, (p) => p['data-prefill-ws-text'] === '1')[0].props.onChange({ target: { value: '关卡片前最后一句' } })
  tree = await renderDock('s2')
  findAll(tree, (p) => p['data-prefill-close'] === '')[0].props.onClick()
  await env.settle()
  assert.ok(stateWrites.some((w) => w.sessionPatch?.target === 's2' && w.sessionPatch?.set?.workspaceInstructions?.text === '关卡片前最后一句'), '关卡片前主动 flush 未落盘草稿')
})

// ── 5. P0-③ 停掉 SandboxSection & InjectionSection 2500ms 重复轮询 ─────

test('[M1-P0-3] SandboxSection & InjectionSection 不再独立 2500ms 轮询 /state；复用 PrefillDock envelope；后台暂停', async () => {
  assert.doesNotMatch(sandboxSrc, /setInterval\([^)]*2500\)/, 'SandboxSection 不再有 2500ms 轮询')
  assert.doesNotMatch(injectSrc, /setInterval\([^)]*2500\)/, 'InjectionSection 不再有 2500ms 轮询')

  const state = { prefill: { s1: 'default' }, gate: {}, everyTurn: {}, ui: {}, sandbox: { s1: { level: 'controlled', rules: [] } } }
  const env = loadClient({
    routes: {
      '/api/dsh-prefill/summary': () => ({ ok: true, rev: '1', sessionId: 's1', prefill: { s1: 'default' } }),
      '/api/dsh-prefill/state': () => ({
        ok: true,
        state,
        turns: {},
        materialized: {},
        sandboxView: { s1: { level: 'controlled', packs: [], unassigned: [], audit: [], blocked: 0 } },
        injections: { catalog: { messages: [], sections: [], contexts: [] }, sessions: {} },
      }),
      '/api/dsh-prefill/draft': () => ({ ok: true, draft: [] }),
      '/api/dsh-prefill/packs': () => ({ ok: true, packs: [], status: { enabled: false } }),
      '/api/dsh-prefill/cards': () => ({ ok: true, cards: [] }),
      '/api/dsh-prefill/usage': () => ({ ok: true }),
    },
  })
  const h = env.React.createElement
  const dockEl = () => h('div', null, h(env.components.PrefillToggle, { sessionId: 's1' }), h(env.components.PrefillDock, { sessionId: 's1' }))
  const pump = async () => {
    let tree = env.renderer.render(dockEl())
    for (let i = 0; i < 4; i += 1) {
      await env.settle()
      tree = env.renderer.render(dockEl())
    }
    return tree
  }
  let tree = await pump()
  findAll(tree, (p) => p['data-prefill-chip'] === '1')[0].props.onClick()
  tree = await pump()
  // 切到「会话沙盒」并展开「高级（InjectionSection）」
  findAll(tree, (p) => p['data-prefill-nav'] === 'inject')[0].props.onClick()
  tree = await pump()
  const advBtn = findAll(tree, (p, node) => node.type === 'button' && p['aria-expanded'] === 'false' && JSON.stringify(node).includes('sbxAdvanced'))[0]
  assert.ok(advBtn, '找到沙盒「高级」展开按钮')
  advBtn.props.onClick()
  tree = await pump()

  // 前台推进 15s：只有 PrefillDock 自己的 5s 轮询（3 次），无 SandboxSection / InjectionSection 2.5s 叠加（否则会高达 15 次）
  const beforeFg = env.fetches.length
  await env.advance(15000)
  const fgStateCalls = env.fetches.slice(beforeFg).filter((f) => f.path === '/api/dsh-prefill/state').length
  assert.ok(fgStateCalls <= 3, `开着沙盒+高级 15s 内 /state 调用 ${fgStateCalls} 次，应 ≤ 3（无 2500ms 重复轮询）`)

  // 切到后台：30s 内 0 次 /state 与 /usage
  env.document.hidden = true
  const beforeBg = env.fetches.length
  await env.advance(30000)
  assert.equal(env.fetches.slice(beforeBg).filter((f) => f.path === '/api/dsh-prefill/state').length, 0, '后台 0 次 /state')
  assert.equal(env.fetches.slice(beforeBg).filter((f) => f.path === '/api/dsh-prefill/usage').length, 0, '后台 0 次 /usage')
})

// ── 6. P0-④ 消灭弯折括号伪影 ──────────────────────────────────────────

test('[M1-P0-4] S.tocLinkActive 平直底边无 inset 2px 0 0；V.callout 无 borderLeft / inset 3px 0 0', () => {
  const tocSrc = cut('      tocLinkActive: {', '      },\n      // v1：总览顶部的 4 个 KPI')
  assert.ok(tocSrc.includes("boxShadow: 'inset 0 -2px 0 var(--dsw-alias-brand-primary)'"), 'TOC 激活态为平直底边指示条')
  assert.doesNotMatch(tocSrc, /inset 2px 0 0/, '不再用弯折成 [ 的左边条')

  const calloutSrc = cut('      callout: (tone) =>', '      table: {')
  assert.ok(calloutSrc.length > 0)
  assert.doesNotMatch(calloutSrc, /borderLeft/, 'V.callout 不再用 borderLeft 弯折成 (')
  assert.doesNotMatch(calloutSrc, /inset 3px 0 0/, 'V.callout 不再用 inset 3px 0 0 弯折成 (')
  assert.match(calloutSrc, /border:\s*`1px solid/, 'V.callout 带圆角细边框')
  assert.match(calloutSrc, /backgroundImage:/, 'V.callout 使用内部内缩平直竖条')
})

// ── 7. P0-⑤ 3 处实机小 Bug 止血 ───────────────────────────────────────

test('[M1-P0-5] S.pill 含 1px 透明边框；总览 observe 档 blocked>0 不误黄；statusPill 箭头方向与 140ms 旋转过渡', async () => {
  // ① S.pill 补 1px solid transparent
  const pillSrc = cut('      pill: {', '      track: (on) =>')
  assert.match(pillSrc, /border:\s*'1px solid transparent'/, 'S.pill 需带 1px solid transparent 让未保存 borderColor 生效')

  // ② 设置页总览 observe 档 blocked>0 不标 warn
  const sbxKinds = []
  const hSettings = makeSettingsHarness({
    ok: true,
    state: {
      version: 2,
      armed: [],
      levers: {},
      allowKinds: ['user'],
      ui: { motion: 'lite' },
    },
    tools: { catalog: [], sessions: { sObs: [], sCtrl: [] } },
    turns: {},
    sandboxView: {
      sObs: { level: 'observe', blocked: 5, packs: [] },
      sCtrl: { level: 'controlled', blocked: 2, packs: [] },
    },
    snapshots: {},
    injections: { catalog: { messages: [] } },
  })
  // 通过 client.js 真实样式核对：observe 档走 'on'，controlled 档走 'warn'
  assert.match(src, /S\.statusPill\(row\.blocked > 0 && row\.level !== 'observe' && row\.level !== '' \? 'warn' : row\.level === '' \? 'off' : 'on'\)/)
  hSettings.render()
  await hSettings.settle()
  const sTree = hSettings.render()
  assert.equal(hSettings.find(sTree, (p) => p['data-prefill-overview-sandbox'] === 'sObs').length, 1)
  void sbxKinds

  // 通过整模块 PrefillSection 核对真实渲染色（observe 不含 state-warn-primary，controlled 含 state-warn-primary）
  const env = loadClient({
    routes: {
      '/api/dsh-prefill/summary': () => ({ ok: true, rev: '1', sessionId: 's1', prefill: { s1: 'default' } }),
      '/api/dsh-prefill/state': () => ({
        ok: true,
        state: { prefill: { s1: 'default' }, gate: {}, everyTurn: {}, ui: { motion: 'full' } },
        turns: {},
        materialized: {},
        tools: { catalog: [], sessions: { sObs: [], sCtrl: [] } },
        sandboxView: {
          sObs: { level: 'observe', blocked: 5, packs: [] },
          sCtrl: { level: 'controlled', blocked: 2, packs: [] },
        },
        injections: { catalog: { messages: [] } },
      }),
      '/api/dsh-prefill/draft': () => ({ ok: true, draft: [] }),
      '/api/dsh-prefill/packs': () => ({ ok: true, packs: [], status: { enabled: false } }),
      '/api/dsh-prefill/cards': () => ({ ok: true, cards: [] }),
      '/api/dsh-prefill/usage': () => ({ ok: true }),
    },
  })
  const h = env.React.createElement
  let pTree = env.renderer.render(h(env.components.PrefillSection, { t: (k) => k }))
  for (let i = 0; i < 4; i += 1) {
    await env.settle()
    pTree = env.renderer.render(h(env.components.PrefillSection, { t: (k) => k }))
  }
  const obsPill = findAll(pTree, (p) => p['data-prefill-overview-sandbox'] === 'sObs')[0]
  const ctrlPill = findAll(pTree, (p) => p['data-prefill-overview-sandbox'] === 'sCtrl')[0]
  assert.ok(obsPill && ctrlPill)
  assert.doesNotMatch(String(obsPill.props.style?.color ?? ''), /state-warn-primary/, 'observe 档 blocked>0 绝不标黄')
  assert.match(String(ctrlPill.props.style?.color ?? ''), /state-warn-primary/, 'controlled 档 blocked>0 照常标黄')

  // ③ statusPill 箭头方向：收起向下（none）、展开向上（rotate(180deg)），并带 140ms 过渡
  const dockEl = () => h('div', null, h(env.components.PrefillToggle, { sessionId: 's1' }), h(env.components.PrefillDock, { sessionId: 's1' }))
  let dTree = env.renderer.render(dockEl())
  for (let i = 0; i < 4; i += 1) {
    await env.settle()
    dTree = env.renderer.render(dockEl())
  }
  findAll(dTree, (p) => p['data-prefill-chip'] === '1')[0].props.onClick()
  for (let i = 0; i < 4; i += 1) {
    await env.settle()
    dTree = env.renderer.render(dockEl())
  }
  const closedCaret = findAll(dTree, (p) => p['data-prefill-status-caret'] !== undefined)[0]
  assert.ok(closedCaret, '找到 statusPill 箭头节点')
  assert.equal(closedCaret.props['data-prefill-status-caret'], 'closed')
  assert.equal(closedCaret.props.style.transform, 'none', '收起态 chevron-down 向下（none）')
  assert.match(String(closedCaret.props.style.transition ?? ''), /transform 140ms/, '带 140ms 旋转过渡')

  findAll(dTree, (p) => p['data-prefill-status-pill'] === '')[0].props.onClick()
  await env.settle()
  dTree = env.renderer.render(dockEl())
  const openCaret = findAll(dTree, (p) => p['data-prefill-status-caret'] !== undefined)[0]
  assert.equal(openCaret.props['data-prefill-status-caret'], 'open')
  assert.equal(openCaret.props.style.transform, 'rotate(180deg)', '展开态箭头旋转 180deg 向上')
})
