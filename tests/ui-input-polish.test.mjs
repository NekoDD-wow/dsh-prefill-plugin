// 方案 B（插件内部输入框与文本框现代化升级 · Linear × Gemini 质感）专项回归单测：
// 1. 作用域 CSS 三态（hover / focus / placeholder / disabled / focus-within）与内部防双环（[data-prefill-editor-input="1"]）+ 零全局污染
// 2. 全量表单基础样式（桌面 30px / 圆角 10px / 柔和凹槽；多行 10px 12px / 1.6）+ applyTouchStyles 触控 34px / 16px 保护
// 3. 红线门禁：0 硬编码 HEX、冻结节（ExperimentalPanel / reasoning）0 接入、唯一 scrollMarginTop、i18n 成对、无 width:100%+水平 margin 溢出
// 4. 4 大核心长文区（系统提示 / 工作区 / 故事记忆 / 每轮注入）+ 设置页默认每轮接入 EditorShell（底栏统计/状态/专属动作/展开高度/钩子保真）
// 5. 3 处搜索框（预设下拉 / 世界书 / 设置页总览）接入 SearchInput（搜索图标 + 透明输入 + 单一清空钮）
// 6. 非冻结下拉框接入 SelectBox（去原生箭头 + 自定义 chevron-down + 保留受控 select 行为）
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { loadClient, findAll, textOf } from './client-render-harness.mjs'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const cut = (from, to) => {
  const a = src.indexOf(from)
  const b = a < 0 ? -1 : src.indexOf(to, a + from.length)
  assert.ok(a >= 0 && b > a, `找不到源码切片：${from} .. ${to}`)
  return src.slice(a, b)
}

const tokensSrc = cut('// <tokens>', '// </tokens>')
const expStart = src.indexOf('    function ExperimentalPanel(props) {')
const expSrc = src.slice(expStart, src.indexOf('\n    }\n', expStart) + 7)
const reasoningSecSrc = cut('        // ── 实验：思考前缀（DeepSeek Beta）', '        // ── 开发者区（默认折叠）')
const editorShellSrc = cut('    function EditorShell(props) {', '    /** DSH 左侧栏那一行 + 主区设置页共用的 panel id')
const dockSrc = cut('    function PrefillDock(props) {', '    function UsagePanel(props) {')

function splitTopSelectors(selectorList) {
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

function makeDockEnv({
  extraState = {},
  extraEnvelope = {},
  cards = [],
  memory = null,
  wsOriginal = '',
} = {}) {
  const state = {
    prefill: { s1: 'default' },
    gate: {},
    everyTurn: {},
    overrides: {},
    workspaceInstructions: {},
    ui: { motion: 'full' },
    ...extraState,
  }
  const env = loadClient({
    routes: {
      '/api/dsh-prefill/summary': () => ({
        ok: true,
        rev: '1',
        sessionId: 's1',
        prefill: state.prefill,
        gate: state.gate,
        ui: state.ui,
      }),
      '/api/dsh-prefill/state': (body) => {
        if (body?.sessionPatch?.set) {
          const sid = body.sessionPatch.target
          for (const [k, v] of Object.entries(body.sessionPatch.set)) {
            state[k] = { ...(state[k] ?? {}), [sid]: v }
          }
        }
        return {
          ok: true,
          state,
          turns: {},
          materialized: {},
          injections: {
            catalog: { messages: [], sections: [], contexts: [] },
            sessions: wsOriginal ? { s1: { texts: { messages: { 'agent-instructions': wsOriginal } } } } : {},
          },
          ...extraEnvelope,
        }
      },
      '/api/dsh-prefill/draft': () => ({ ok: true, draft: [] }),
      '/api/dsh-prefill/packs': () => ({
        ok: true,
        packs: [{ name: '写作搭档', count: 2 }],
        builtins: [{ id: 'pure', name: '纯净模式', desc: '纯净对话' }],
        everyTurnBlocks: [
          {
            id: 'rp-boost',
            name: '角色扮演强化（首轮完整 + 每轮提醒）',
            builtin: true,
            first: '【角色扮演要求】首轮完整规则',
            text: '【思考人称】每轮提醒内容',
            checks: ['zh'],
          },
        ],
        everyTurnTowers: [],
        status: { enabled: false },
      }),
      '/api/dsh-prefill/cards': () => ({ ok: true, cards }),
      '/api/dsh-prefill/memory': () => ({
        ok: true,
        running: false,
        memory: memory ?? { text: '第一幕：主角在雨夜抵达车站。', throughTurn: 8, edited: false },
      }),
      '/api/dsh-prefill/usage': () => ({ ok: true }),
    },
  })
  const h = env.React.createElement
  const el = () => h('div', null, h(env.components.PrefillToggle, { sessionId: 's1' }), h(env.components.PrefillDock, { sessionId: 's1' }))
  const pump = async () => {
    let tree = env.renderer.render(el())
    for (let i = 0; i < 4; i += 1) {
      await env.settle()
      tree = env.renderer.render(el())
    }
    return tree
  }
  return { env, state, pump, render: () => env.renderer.render(el()) }
}

// ── 1. 作用域 CSS 三态、防双环与零全局污染 ─────────────────────────────

test('[方案B-1] 作用域 CSS 覆盖表单三态、容器 focus-within、内部防双环与隐藏原生搜索清空钮，严禁全局污染和硬编码 HEX', () => {
  // eslint-disable-next-line no-new-func
  const { SCOPED_STYLE_CARD, SCOPED_STYLE_PAGE } = new Function(`${tokensSrc}\nreturn { SCOPED_STYLE_CARD, SCOPED_STYLE_PAGE }`)()
  for (const [label, css, prefix] of [
    ['card', SCOPED_STYLE_CARD, '[data-prefill-card-panel]'],
    ['page', SCOPED_STYLE_PAGE, '[data-prefill-page]'],
  ]) {
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, `${label} 作用域 CSS 禁止硬编码 HEX`)
    assert.doesNotMatch(css, /transition\s*:[^;]*(background|color|border)/i, `${label} 禁止色值 transition`)
    assert.match(css, /:not\(\[data-prefill-editor-input\]\):hover\s*\{\s*border-color:\s*var\(--dsw-alias-border-l2\)/, `${label} 独立控件 hover 提亮 border-l2`)
    assert.match(css, /:not\(\[data-prefill-editor-input\]\):focus\s*\{[^}]*background:\s*var\(--dsw-alias-bg-base\)[^}]*box-shadow:\s*0 0 0 3px color-mix\(in srgb, var\(--dsw-alias-brand-primary\) 14%, transparent\)[^}]*outline:\s*none/, `${label} 独立控件 focus 柔品牌光环且排除 editor-input 防双环`)
    assert.match(css, /::placeholder\s*\{\s*color:\s*var\(--dsw-alias-label-tertiary\);\s*opacity:\s*0\.85;/, `${label} 统一 placeholder 样式`)
    assert.match(css, /:is\(:disabled,\s*\[aria-disabled="true"\]\)\s*\{\s*opacity:\s*0\.55;/, `${label} 禁用态柔降透明度`)
    assert.match(css, /\[data-prefill-editor-input="1"\]:focus\s*\{\s*outline:\s*none !important;\s*box-shadow:\s*none !important;\s*border-color:\s*transparent !important;/, `${label} editor-input 禁止自身焦点环`)
    assert.match(css, /:is\(\[data-prefill-editor-shell="1"\],\s*\[data-prefill-search-box="1"\]\)[^}]*:hover\s*\{\s*border-color:\s*var\(--dsw-alias-border-l2\)/, `${label} 外容器 hover 提亮`)
    assert.match(css, /:is\(\[data-prefill-editor-shell="1"\],\s*\[data-prefill-search-box="1"\]\)[^}]*:focus-within\s*\{[^}]*background:\s*var\(--dsw-alias-bg-base\)[^}]*box-shadow:\s*0 0 0 3px color-mix\(in srgb, var\(--dsw-alias-brand-primary\) 14%, transparent\)/, `${label} 外容器 focus-within 泛起 3px 柔光环`)
    assert.match(css, /::-webkit-search-cancel-button\s*\{\s*-webkit-appearance:\s*none;/, `${label} 隐藏原生搜索框重复清空按钮`)
    // 每条选择器都必须严格限定在 prefix 下
    const stripped = css.replace(/@media[^{]*\{([\s\S]*?)\}\s*\}/g, '$1')
    for (const block of stripped.split('}')) {
      const sel = block.split('{')[0]?.trim() ?? ''
      if (sel === '' || sel.startsWith('@')) continue
      for (const part of splitTopSelectors(sel)) {
        assert.ok(part.includes(prefix), `${label} 存在越界选择器：${part}`)
      }
    }
  }
  // 冻结 reasoning 分节两处展开 S.input 的 <textarea> 靠 SCOPED_STYLE_PAGE 兜底恢复多行高度与上下内边距
  assert.match(
    SCOPED_STYLE_PAGE,
    /\[data-prefill-page\] textarea:is\(\[data-prefill-reasoning-prefix\], \[data-prefill-reasoning-content-prefix\]\)\s*\{\s*height:\s*auto !important;\s*padding:\s*8px 10px !important;\s*line-height:\s*1\.5;\s*\}/,
    'SCOPED_STYLE_PAGE 必须保护冻结 reasoning 分节两处 textarea 的上下内边距与自适应高度',
  )
})

// ── 2. 基础表单样式与触控保护 + 红线审计 ────────────────────────────────

test('[方案B-2] S/V 全量表单基元尺寸与柔和凹槽 + applyTouchStyles 34px/16px 触控保护 + 冻结节 0 改动与零 HEX', () => {
  // 冻结区不得被方案 B 改动或引入新组件
  assert.doesNotMatch(expSrc, /EditorShell|SearchInput|SelectBox|data-prefill-editor-shell|data-prefill-search-box/, 'ExperimentalPanel 保持冻结 0 改动')
  assert.doesNotMatch(reasoningSecSrc, /EditorShell|SearchInput|SelectBox|data-prefill-editor-shell|data-prefill-search-box/, '设置页 reasoning 分节保持冻结 0 改动')
  assert.doesNotMatch(editorShellSrc, /#[0-9a-fA-F]{3,8}\b/, 'EditorShell / SearchInput / SelectBox 零硬编码 HEX')
  assert.equal((src.match(/scrollMarginTop:\s*\d+/g) ?? []).length, 1, '唯一 scrollMarginTop: 44 保留')
  // 新增 i18n 键中英成对
  for (const key of ['editorExpand', 'editorCollapse', 'editorExpandTip', 'editorCollapseTip', 'editorClear', 'editorClearTip', 'editorFirstTag', 'editorTurnTag', 'editorReadOnly']) {
    assert.equal((src.match(new RegExp('\\n\\s+' + key + ": '", 'g')) ?? []).length, 2, `${key} 必须 zh / en 成对`)
  }
  // 静态核查 S / V 表单样式定义
  const singleLineExpected = { height: 30, padding: '0 10px', borderRadius: 10 }
  const multiLineExpected = { padding: '10px 12px', lineHeight: 1.6, borderRadius: 10 }
  const sSrc = cut('    const S = {', '    /** 自绘开关')
  const vSrc = cut('    const V = {', '    // <touch>')
  const touchSrc = cut('    // <touch>', '    // </touch>')
  // eslint-disable-next-line no-new-func
  const styles = new Function(
    `${tokensSrc}\nconst motionLevel = () => 'full'\nconst MOTION = { fast: 120, ease: 'ease' }\nconst KNOB_TRANSITION = 'transform 150ms ease'\n${sSrc}\n${vSrc}\n${touchSrc}\nreturn { S, V, applyTouchStyles }`,
  )()
  for (const [name, obj] of [
    ['V.input', styles.V.input],
    ['S.input', styles.S.input],
    ['S.numberInput', styles.S.numberInput],
    ['S.selectInput', styles.S.selectInput],
    ['S.dockSelect', styles.S.dockSelect],
    ['S.dockName', styles.S.dockName],
  ]) {
    assert.equal(obj.height, singleLineExpected.height, `${name} 桌面高 30`)
    assert.equal(obj.padding, singleLineExpected.padding, `${name} padding 0 10px`)
    assert.equal(obj.borderRadius, singleLineExpected.borderRadius, `${name} 圆角 10px`)
    assert.match(obj.background, /color-mix\(in srgb, var\(--dsw-alias-bg-layer-2\) 48%, var\(--dsw-alias-bg-base\)\)/, `${name} 柔和凹槽底`)
    assert.equal(obj.border, '1px solid var(--dsw-alias-border-l1)', `${name} border-l1`)
    assert.equal(obj.boxShadow, 'inset 0 1px 2px rgba(0,0,0,.035)', `${name} 微内阴影`)
  }
  for (const [name, obj] of [
    ['V.textarea', styles.V.textarea],
    ['S.textareaMd', styles.S.textareaMd],
    ['S.textareaSm', styles.S.textareaSm],
    ['S.injectBox', styles.S.injectBox],
  ]) {
    assert.equal(obj.padding, multiLineExpected.padding, `${name} padding 10px 12px`)
    assert.equal(obj.lineHeight, multiLineExpected.lineHeight, `${name} lineHeight 1.6`)
    assert.equal(obj.borderRadius, multiLineExpected.borderRadius, `${name} 圆角 10px`)
    assert.equal(obj.boxSizing, 'border-box', `${name} boxSizing border-box`)
    assert.equal(obj.maxWidth, '100%', `${name} maxWidth 100%`)
  }
  // 触控升级与回落
  styles.applyTouchStyles(true)
  assert.equal(styles.V.input.height, 34)
  assert.equal(styles.V.input.fontSize, 16)
  assert.equal(styles.V.textarea.fontSize, 16)
  assert.equal(styles.S.input.height, 34)
  assert.equal(styles.S.input.fontSize, 16)
  assert.equal(styles.S.dockSelect.height, 34)
  assert.equal(styles.S.dockSelect.fontSize, 16)
  assert.equal(styles.S.dockName.height, 34)
  assert.equal(styles.S.dockName.fontSize, 16)
  assert.equal(styles.S.numberInput.height, 34)
  assert.equal(styles.S.numberInput.fontSize, 16)
  assert.equal(styles.S.selectInput.height, 34)
  assert.equal(styles.S.selectInput.fontSize, 16)
  assert.equal(styles.S.textareaMd.fontSize, 16)
  assert.equal(styles.S.textareaSm.fontSize, 16)
  assert.equal(styles.S.injectBox.fontSize, 16)
  styles.applyTouchStyles(false)
  assert.equal(styles.V.input.height, 30)
  assert.equal(styles.S.input.height, 30)
})

// ── 3. 弹出卡片 4 大长文编辑区 EditorShell + 每轮积木防溢出回归门禁 ──────

test('[方案B-3] 卡片 4 大核心长文区（系统提示 / 工作区 / 故事记忆 / 每轮积木）均接入 EditorShell 且每轮积木杜绝 width:100%+水平 margin 溢出', async () => {
  // 源码级溢出回归门禁：全文件绝不出现 ...V.textarea / ...V.input / width:'100%' 与非零水平 margin 共存
  const benchCardSrc = cut('      const benchCard = (block) => {', '\n      /** list 缺省 = bench')
  assert.doesNotMatch(benchCardSrc, /\.\.\.V\.textarea[^}]*margin:\s*'[^']* [1-9]/, '每轮积木 textarea 不得把 width:100% 与水平 margin 叠加')
  assert.doesNotMatch(src, /style:\s*\{[^}\n]*\.\.\.(V\.textarea|V\.input|S\.input|S\.textareaMd|S\.textareaSm)[^}\n]*margin(Left|Right)?:\s*['"]?[1-9]/, '全文件表单控件禁止 width:100% 叠加水平 margin')

  const mockCard = { id: 'c1', name: '小夏', greetings: 1, lore: 2, memory: { enabled: true, every: 8 } }
  const { pump, render } = makeDockEnv({
    cards: [mockCard],
    wsOriginal: '# AGENTS.md\n请使用 TypeScript 严格模式。',
    extraState: {
      activePreset: { s1: 'card:c1' },
      cardRef: { s1: { id: 'c1', opts: { memory: true, lore: true } } },
      lore: { s1: { enabled: true, scanDepth: 4, entries: [{ id: 'l1', title: '雨夜车站', keys: ['车站'], content: '一座古老的木结构车站。' }] } },
      memory: { s1: { enabled: true, every: 8 } },
      workspaceInstructions: { s1: { mode: 'rewrite', text: '初始改写' } },
      everyTurn: {
        s1: {
          enabled: true,
          mode: 'always',
          text: '【思考人称】每轮提醒内容',
          firstText: '【角色扮演要求】首轮完整规则',
          checks: ['zh'],
          bench: [
            {
              key: 'b1',
              ref: 'rp-boost',
              name: '角色扮演强化（首轮完整 + 每轮提醒）',
              builtin: true,
              first: '【角色扮演要求】首轮完整规则',
              text: '【思考人称】每轮提醒内容',
              checks: ['zh'],
              edited: false,
            },
          ],
          benchTowers: {},
        },
      },
    },
  })

  let tree = await pump()
  // 打开卡片
  findAll(tree, (p) => p['data-prefill-chip'] === '1')[0].props.onClick()
  tree = await pump()

  // ① 系统提示 EditorShell：底栏统计、保存态、展开高度切换、清空
  findAll(tree, (p) => p['data-prefill-nav'] === 'system')[0].props.onClick()
  tree = await pump()
  const sysShell = findAll(tree, (p) => p['data-prefill-editor-shell'] === '1')[0]
  assert.ok(sysShell, '系统提示渲染 EditorShell 外壳')
  assert.equal(sysShell.props.style.borderRadius, 12)
  assert.equal(sysShell.props.style.overflow, 'hidden')
  assert.equal(sysShell.props.style.boxSizing, 'border-box')
  const sysInput = findAll(sysShell, (p, n) => n.type === 'textarea' && p['data-prefill-system'] === '1')[0]
  assert.ok(sysInput, '系统提示保留 data-prefill-system="1"')
  assert.equal(sysInput.props['data-prefill-editor-input'], '1', '内部 textarea 标记防双环')
  assert.equal(sysInput.props.style.border, 'none')
  assert.equal(sysInput.props.style.minHeight, 120)
  const sysFooter = findAll(sysShell, (p) => p['data-prefill-editor-footer'] === '1')[0]
  assert.ok(sysFooter, '系统提示带底部脚栏')
  assert.equal(findAll(sysFooter, (p) => p['data-prefill-system-metrics'] !== undefined).length, 1, '统计收进底栏左侧')
  // 编辑文本后出现保存态，点击展开按钮切换高度 120 → 300
  sysInput.props.onChange({ target: { value: '你是资深前端工程师' } })
  tree = render()
  assert.equal(findAll(tree, (p) => p['data-prefill-system-save-state'] === 'saving').length, 1, '编辑后底栏显示保存中微标')
  findAll(tree, (p) => p['data-prefill-editor-expand'] !== undefined)[0].props.onClick()
  tree = render()
  const sysInputExpanded = findAll(tree, (p) => p['data-prefill-system'] === '1')[0]
  assert.equal(sysInputExpanded.props.style.minHeight, 300, '点击展开切换到扩展编辑高度')
  assert.equal(findAll(tree, (p) => p['data-prefill-editor-expand'] === 'expanded').length, 1)
  // 清空动作
  findAll(tree, (p) => p['data-prefill-editor-clear'] === 'system')[0].props.onClick()
  tree = render()
  assert.equal(findAll(tree, (p) => p['data-prefill-system'] === '1')[0].props.value, '')

  // ② 工作区说明 EditorShell：底栏含「填入原文」与展开切换
  findAll(tree, (p) => p['data-prefill-nav'] === 'workspace')[0].props.onClick()
  tree = await pump()
  const wsShell = findAll(tree, (p) => p['data-prefill-editor-shell'] === '1')[0]
  assert.ok(wsShell, '工作区改写渲染 EditorShell')
  assert.equal(findAll(wsShell, (p) => p['data-prefill-ws-text'] === '1' && p['data-prefill-editor-input'] === '1').length, 1)
  const fillBtn = findAll(wsShell, (p) => p['data-prefill-ws-fill-original'] === '1')[0]
  assert.ok(fillBtn, '填入原文动作收进工作区 EditorShell 底栏')
  fillBtn.props.onClick()
  tree = render()
  assert.match(findAll(tree, (p) => p['data-prefill-ws-text'] === '1')[0].props.value, /AGENTS\.md/)

  // ③ 故事记忆 EditorShell：展开记忆后渲染 EditorShell + 未保存微标 + 展开高度
  findAll(tree, (p) => p['data-prefill-nav'] === 'memory')[0].props.onClick()
  tree = await pump()
  findAll(tree, (p) => p['data-prefill-memory-toggle'] !== undefined)[0].props.onClick()
  tree = await pump()
  const memShell = findAll(tree, (p) => p['data-prefill-editor-shell'] === '1')[0]
  assert.ok(memShell, '故事记忆正文渲染 EditorShell')
  const memTextarea = findAll(memShell, (p) => p['data-prefill-memory-text'] !== undefined)[0]
  assert.ok(memTextarea && memTextarea.props['data-prefill-editor-input'] === '1')
  assert.equal(memTextarea.props.style.minHeight, 140)
  findAll(memShell, (p) => p['data-prefill-editor-expand'] !== undefined)[0].props.onClick()
  tree = render()
  assert.equal(findAll(tree, (p) => p['data-prefill-memory-text'] !== undefined)[0].props.style.minHeight, 320)

  // ④ 每轮注入积木卡片：首轮 + 每轮双框均接入 EditorShell，且严丝合缝贴合父容器（零水平 margin 溢出）
  findAll(tree, (p) => p['data-prefill-nav'] === 'every-turn')[0].props.onClick()
  tree = await pump()
  const blockCard = findAll(tree, (p) => p['data-prefill-bench-block'] === 'b1')[0]
  assert.ok(blockCard, '找到每轮注入积木卡片')
  assert.equal(blockCard.props.style.boxSizing, 'border-box', '积木卡自身 border-box')
  assert.equal(blockCard.props.style.maxWidth, '100%')
  assert.equal(blockCard.props.style.minWidth, 0)
  const benchBody = findAll(blockCard, (p) => p['data-prefill-bench-body'] === 'b1')[0]
  assert.ok(benchBody, '积木编辑区包在带内边距的 bench-body 容器内')
  assert.equal(benchBody.props.style.padding, '6px 8px 8px')
  assert.equal(benchBody.props.style.boxSizing, 'border-box')
  assert.equal(benchBody.props.style.width, '100%')
  assert.equal(benchBody.props.style.maxWidth, '100%')
  const benchShells = findAll(benchBody, (p) => p['data-prefill-editor-shell'] === '1')
  assert.equal(benchShells.length, 2, '首轮 + 每轮两框均使用 EditorShell')
  for (const shell of benchShells) {
    assert.equal(shell.props.style.width, '100%')
    assert.equal(shell.props.style.maxWidth, '100%')
    assert.equal(shell.props.style.boxSizing, 'border-box')
    assert.equal(shell.props.style.margin, undefined, 'EditorShell 绝不叠水平 margin')
    assert.equal(shell.props.style.marginLeft, undefined)
    assert.equal(shell.props.style.marginRight, undefined)
    const ta = findAll(shell, (_p, n) => n.type === 'textarea')[0]
    assert.equal(ta.props['data-prefill-editor-input'], '1')
    assert.equal(ta.props.style.margin, 0, '内部 textarea 零 margin')
    assert.equal(ta.props.style.boxSizing, 'border-box')
  }
  assert.equal(findAll(benchBody, (p) => p['data-prefill-bench-first'] === 'b1').length, 1)
  assert.equal(findAll(benchBody, (p) => p['data-prefill-bench-text'] === 'b1').length, 1)
})

// ── 4. 3 处统一搜索框 SearchInput（预设下拉 / 世界书 / 设置页总览）──────

test('[方案B-4] 预设下拉、世界书、设置页总览 3 处搜索框均接入 SearchInput：搜索图标 + 透明输入 + 单一清空钮', async () => {
  const mockCard = { id: 'c1', name: '小夏', greetings: 1, lore: 2 }
  const { pump, render } = makeDockEnv({
    cards: [mockCard],
    extraState: {
      activePreset: { s1: 'card:c1' },
      cardRef: { s1: { id: 'c1', opts: { lore: true } } },
      lore: { s1: { enabled: true, scanDepth: 4, entries: [{ id: 'l1', title: '雨夜车站', keys: ['车站'], content: '旧车站' }] } },
    },
  })
  let tree = await pump()
  findAll(tree, (p) => p['data-prefill-chip'] === '1')[0].props.onClick()
  tree = await pump()

  // ① 预设下拉 SearchInput
  findAll(tree, (p) => p['data-prefill-preset-select'] !== undefined)[0].props.onClick()
  tree = await pump()
  const presetBar = findAll(tree, (p) => p['data-prefill-preset-search-bar'] !== undefined)[0]
  const presetBox = findAll(presetBar, (p) => p['data-prefill-search-box'] === '1')[0]
  assert.ok(presetBox, '预设下拉接入 SearchInput')
  assert.equal(presetBox.props.style.height, 30)
  assert.equal(presetBox.props.style.borderRadius, 10)
  assert.ok(findAll(presetBox, (_p, n) => n.type === 'svg').length >= 1, '带搜索图标')
  const presetInput = findAll(presetBox, (p) => p['data-prefill-preset-search'] !== undefined)[0]
  assert.equal(presetInput.props['data-prefill-editor-input'], '1')
  assert.equal(findAll(presetBox, (p) => p['data-prefill-search-clear'] === '1').length, 0, '空值时不显示清空钮')
  presetInput.props.onChange({ target: { value: '纯净' } })
  tree = render()
  const presetClears = findAll(findAll(tree, (p) => p['data-prefill-preset-search-bar'] !== undefined)[0], (_p, n) => n.type === 'button')
  assert.equal(presetClears.length, 1, '有文本时恰好 1 个清空按钮（无重复清空钮）')
  presetClears[0].props.onClick()
  tree = render()
  assert.equal(findAll(tree, (p) => p['data-prefill-preset-search'] !== undefined)[0].props.value, '')
  // 关掉预设菜单，切到世界书
  findAll(tree, (p) => p['data-prefill-preset-select'] !== undefined)[0].props.onClick()
  tree = await pump()

  // ② 世界书 SearchInput
  findAll(tree, (p) => p['data-prefill-nav'] === 'lore')[0].props.onClick()
  tree = await pump()
  const loreBox = findAll(tree, (p) => p['data-prefill-search-box'] === '1')[0]
  assert.ok(loreBox, '世界书接入 SearchInput')
  const loreInput = findAll(loreBox, (p) => p['data-prefill-lore-search'] !== undefined)[0]
  assert.equal(loreInput.props['data-prefill-editor-input'], '1')
  loreInput.props.onChange({ target: { value: '车站' } })
  tree = render()
  const loreClear = findAll(tree, (p) => p['data-prefill-lore-search-clear'] !== undefined)[0]
  assert.ok(loreClear, '世界书输入后出现单一清空钮')
  loreClear.props.onClick()
  tree = render()
  assert.equal(findAll(tree, (p) => p['data-prefill-lore-search'] !== undefined)[0].props.value, '')

  // ③ 设置页总览 SearchInput + 默认每轮双 EditorShell + 资源库 SelectBox
  const sessions = {}
  const sandboxView = { '*': { level: 'observe', levelFrom: 'global', packs: [] } }
  for (let i = 1; i <= 10; i += 1) {
    const id = `s${i}`
    sessions[id] = ['read']
    sandboxView[id] = { level: 'observe', levelFrom: 'global', blocked: 0 }
  }
  const pageEnv = loadClient({
    routes: {
      '/api/dsh-prefill/state': () => ({
        ok: true,
        state: {
          version: 2,
          armed: [],
          levers: { probeSection: false, probeContext: false, blockSections: false, blockContexts: false, blockTools: false, blockMessages: false },
          allowKinds: ['user'],
          tools: null,
          ui: { motion: 'lite', experimental: false },
          everyTurn: { '*': { enabled: true, text: '默认提醒正文', firstText: '首轮补充', mode: 'always', checks: [] } },
          sandbox: { '*': { level: 'observe' } },
        },
        tools: { catalog: ['read'], sessions },
        turns: {},
        sandboxView,
        snapshots: {},
        injections: { catalog: { messages: [] } },
      }),
      '/api/dsh-prefill/packs': () => ({ ok: true, packs: [], blocks: [], towers: [], builtins: [], hiddenBuiltins: [] }),
      '/api/dsh-prefill/cards': () => ({ ok: true, cards: [] }),
      '/api/dsh-prefill/reasoning/status': () => ({ ok: true, enabled: false, proxyRunning: false, hasApiKey: true, failures: 0, audit: [] }),
    },
  })
  const h = pageEnv.React.createElement
  const renderPage = () => pageEnv.renderer.render(h(pageEnv.components.PrefillSection, { t: (k) => k }))
  let pTree = renderPage()
  for (let i = 0; i < 4; i += 1) {
    await pageEnv.settle()
    pTree = renderPage()
  }
  // 总览 SearchInput
  const ovBox = findAll(pTree, (p) => p['data-prefill-search-box'] === '1')[0]
  assert.ok(ovBox, '设置页总览接入 SearchInput')
  const ovInput = findAll(ovBox, (p) => p['data-prefill-overview-filter'] !== undefined)[0]
  assert.equal(ovInput.props['data-prefill-editor-input'], '1')
  ovInput.props.onChange({ target: { value: 's1' } })
  pTree = renderPage()
  const ovClears = findAll(findAll(pTree, (p) => p['data-prefill-search-box'] === '1')[0], (_p, n) => n.type === 'button')
  assert.equal(ovClears.length, 1, '设置页总览搜索有文本时仅 1 个清空按钮')
  assert.ok(ovClears[0].props['data-prefill-overview-filter-clear'] !== undefined, '保留 data-prefill-overview-filter-clear 钩子')
  ovClears[0].props.onClick()
  pTree = renderPage()
  assert.equal(findAll(pTree, (p) => p['data-prefill-overview-filter'] !== undefined)[0].props.value, '')

  // 设置页默认每轮双 EditorShell（含底栏 metrics + 展开切换）
  const defCard = findAll(pTree, (p) => p['data-prefill-default-everyturn'] !== undefined)[0]
  const defShells = findAll(defCard, (p) => p['data-prefill-editor-shell'] === '1')
  assert.equal(defShells.length, 2, '设置页默认每轮 text / firstText 均接入 EditorShell')
  assert.equal(findAll(defShells[0], (p) => p['data-prefill-default-turn-text'] !== undefined && p['data-prefill-editor-input'] === '1').length, 1)
  assert.equal(findAll(defShells[0], (p) => p['data-prefill-default-turn-text-metrics'] !== undefined).length, 1)
  assert.equal(findAll(defShells[1], (p) => p['data-prefill-default-turn-first'] !== undefined && p['data-prefill-editor-input'] === '1').length, 1)
  assert.equal(findAll(defShells[1], (p) => p['data-prefill-default-turn-first-metrics'] !== undefined).length, 1)
  findAll(defShells[0], (p) => p['data-prefill-editor-expand'] !== undefined)[0].props.onClick()
  pTree = renderPage()
  assert.equal(findAll(pTree, (p) => p['data-prefill-default-turn-text'] !== undefined)[0].props.style.minHeight, 240, '设置页默认每轮 EditorShell 展开高度生效')

  // 资源库下拉 SelectBox（去原生箭头 + 自定义 chevron-down）
  const selectBoxes = findAll(pTree, (p) => p['data-prefill-select-box'] === '1')
  assert.ok(selectBoxes.length >= 1, '设置页资源库工作区下拉接入 SelectBox')
  const libSelect = findAll(selectBoxes[0], (p, n) => n.type === 'select' && p['data-prefill-lib-session'] !== undefined)[0]
  assert.ok(libSelect, 'SelectBox 保留内部原生 select 与 data-prefill-lib-session 钩子')
  assert.equal(libSelect.props.style.appearance, 'none', '隐藏原生系统下拉箭头')
  assert.equal(findAll(selectBoxes[0], (_p, n) => n.type === 'svg').length, 1, '叠加自定义 chevron-down 图标')
})
