// M3 弹出卡片 8 个活跃功能节逻辑与体验完善：源码契约 + 组件挂载行为回归单测。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { makeHarness } from './sandbox-harness.mjs'
import { migrateSandbox } from '../sandbox.js'
import { sandboxView } from '../sandbox-view.js'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const cut = (from, to) => {
  const a = src.indexOf(from)
  const b = src.indexOf(to, a)
  assert.ok(a >= 0 && b > a, `找不到切片：${from} .. ${to}`)
  return src.slice(a, b)
}

const dockSrc = cut('    function PrefillDock(props) {', '    /** 「用量与缓存」：逐轮读数')
const manualSrc = cut('    function ManualInject(props) {', '    /**\n     * 输入框上方的预填装面板（v0.2）。')
const usageSrc = cut('    function UsagePanel(props) {', '    /**\n     * 预填装面板里的**注入改写**一节')
const sbxTextSrc = cut('    const SBX_TEXT = {', '    const SBX_SURFACE_RISKS =')
const sandboxSrc = cut('    function SandboxSection(props) {', '    function InjectionSection(props) {')

// ── 通用：零 window.prompt & M3 i18n 成对 ─────────────────────────────

test('[M3] 全文件消灭全部 window.prompt()，改用 Modal 行内对话框', () => {
  assert.equal((src.match(/window\.prompt/g) ?? []).length, 0, '全文件不应残留 window.prompt')
  // 去掉字符串字面量与注释后，全文件不得存在任何 prompt(...) 调用
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, '')
  assert.equal((codeOnly.match(/\bprompt\s*\(/g) ?? []).length, 0, '全文件代码不应残留 prompt(...) 调用')
  assert.match(dockSrc, /const openBenchPrompt = \(\{ title, defaultValue, onConfirm \}\) =>/)
  assert.match(dockSrc, /'data-prefill-bench-prompt': ''/)
  assert.match(dockSrc, /'data-prefill-bench-prompt-input': ''/)
  assert.match(dockSrc, /'data-prefill-bench-prompt-ok': ''/)
  // 原 5 处触发点全部接入 openBenchPrompt
  assert.ok((dockSrc.match(/openBenchPrompt\(/g) ?? []).length >= 5, '原 5 处 window.prompt 全部改为 openBenchPrompt')
})

// ── 1. 头部预设菜单、另存为与状态胶囊 ──────────────────────────────────

test('[M3] 头部预设菜单三段固定布局 + 吸顶搜索 + 吸底 footer + 另存为重名二次确认 + 导出 toast + dirty 微标 + 状态行跳 usage', () => {
  // presetsMenu 三段布局：吸顶搜索框 + 滚动区 + 吸底 footer
  assert.match(dockSrc, /'data-prefill-preset-search': ''/)
  assert.match(dockSrc, /'data-prefill-preset-scroll': ''/)
  assert.match(dockSrc, /'data-prefill-preset-footer': ''/)
  // saveAsPanel 自动 focus、重名警告与覆盖确认
  assert.match(dockSrc, /saveAsInputRef\.current\?\.focus\?\.\(\)/)
  assert.match(dockSrc, /'data-prefill-save-as-warn': trimmedPackName/)
  assert.match(dockSrc, /'data-prefill-save-as-overwrite': saveAsOverwriteArmed \? '1' : undefined/)
  // 导出失败走 failed(...) 且成功弹 toast
  assert.match(dockSrc, /exportFile\(\)\.catch\(failed\('export', t\('errOpExport'\)\)\)/)
  assert.match(dockSrc, /flash\(t\('exportDone'\)\.replace\('\{name\}', name\)\)/)
  // 相对已套用预设存在改动显示轻巧 dirty 微标（放在按钮内部，头部可点控件仍严格 === 7）
  assert.match(dockSrc, /'data-prefill-preset-dirty': '1'/)
  // presetsMenu footer 说明区不设 height: 52 硬裁切，改为自适应高度且 overflow: visible
  assert.match(dockSrc, /'data-prefill-preset-detail': '', style: \{ \.\.\.V\.detail, height: 'auto', minHeight: 44, overflow: 'visible'/)
  assert.doesNotMatch(dockSrc, /style: \{ \.\.\.V\.detail, height: 52/)
  // 状态 Popover 内缓存/用量行点击可直跳 usage 节
  assert.match(dockSrc, /'data-prefill-status-open': 'usage'/)
  assert.match(dockSrc, /setMenu\(''\)\s*\n\s*setPane\('usage'\)/)
})

test('[M3] 回归：bench-helpers（CHECK_ORDER/PRIORITY_PREFIX）先于 everyTurnEntryOf 初始化，渲染期 everyTurnDraft 含块绝不触发 TDZ；切会话重置 cardUserBusy', () => {
  const helpersAt = dockSrc.indexOf('// <bench-helpers>')
  const checkOrderAt = dockSrc.indexOf('const CHECK_ORDER =')
  const priorityAt = dockSrc.indexOf('const PRIORITY_PREFIX =')
  const entryOfAt = dockSrc.indexOf('const everyTurnEntryOf =')
  assert.ok(helpersAt > 0 && checkOrderAt > helpersAt && priorityAt > helpersAt && entryOfAt > checkOrderAt, 'bench-helpers 必须在 everyTurnEntryOf 之前声明')
  // 按源码真实顺序执行：模拟渲染期 everyTurnDraft !== null 且含块时调用 everyTurnEntryOf
  const slice = dockSrc.slice(helpersAt, dockSrc.indexOf('const everyTurnStored =', entryOfAt))
  // eslint-disable-next-line no-new-func
  const run = new Function('everyTurnDraft', 'state', 'sessionId', `${slice}\nreturn ownEveryTurn`)
  const draft = {
    mode: 'always',
    bench: [{ key: 'b1', text: '自定义内容', first: '', checks: ['zh'], priority: true }],
    benchTowers: {},
  }
  const own = run(draft, {}, 'sid-tdz')
  assert.equal(own.checks[0], 'zh')
  assert.match(own.text, /自定义内容/)
  assert.match(own.text, /以下为用户补充/)
  // 切会话重置 cardUserBusy（且在组件早退之前）
  const bailAt = dockSrc.indexOf("if (sessionId === '' || !enabled || items === null) return null")
  const resetAt = dockSrc.indexOf('React.useEffect(() => setCardUserBusy(false), [sessionId])')
  assert.ok(resetAt > 0 && resetAt < bailAt, 'cardUserBusy 切会话重置 hook 必须在早退前')
})

// ── 2. 角色卡 / 世界书 / 故事记忆 ──────────────────────────────────────

test('[M3] 角色卡详情直套按钮 + 同名副标 + 我的名字 Enter/Spinner', () => {
  assert.match(dockSrc, /'data-prefill-card-use': pickedCard\.id/)
  assert.match(dockSrc, /actApply\(`card:\$\{pickedCard\.id\}`, \(\) => applyCardPreset\(pickedCard\)\)/)
  assert.doesNotMatch(src, /data-prefill-card-apply/, '保留既有单测约束：不使用 data-prefill-card-apply')
  assert.match(dockSrc, /'data-prefill-card-sub': card\.id/)
  assert.match(dockSrc, /event\.key === 'Enter'[\s\S]{0,80}commitCardUser\(\)/)
  assert.match(dockSrc, /'data-prefill-card-compiling': '1'/)
})

test('[M3] 世界书：删条与还原接 ConfirmButton + 顶部搜索过滤 + 受控关键词 + 标题/关键词用 V.input', () => {
  assert.match(dockSrc, /'data-prefill-lore-search': ''/)
  assert.match(dockSrc, /armed: confirming === delConfirmKey,[\s\S]{0,140}'data-prefill-lore-delete': key/)
  assert.match(dockSrc, /armed: confirming === 'lore-revert',[\s\S]{0,160}'data-prefill-lore-revert': ''/)
  assert.match(dockSrc, /const \[loreKeyDrafts, setLoreKeyDrafts\] = React\.useState\(\{\}\)/)
  assert.match(dockSrc, /h\('input', \{ style: \{ \.\.\.V\.input, width: '100%' \}, value: String\(entry\.title \?\? ''\), 'data-prefill-lore-title': key/)
  assert.match(dockSrc, /h\('input', \{\s*style: \{ \.\.\.V\.input, width: '100%' \},\s*value: keysInputValue,\s*'data-prefill-lore-keys-input': key/)
})

test('[M3] 故事记忆：摘要接 EditorShell（minHeight 140 / 90ch）+ 清空接 ConfirmButton + 未保存草稿收起警示 + fetchSeed 接 busyCtl + Reveal', () => {
  assert.match(dockSrc, /h\(EditorShell, \{[\s\S]{0,200}minHeight: 140,[\s\S]{0,120}maxWidth: '90ch',[\s\S]{0,120}'data-prefill-memory-text': ''/)
  assert.match(dockSrc, /armed: confirming === 'memory-clear',[\s\S]{0,160}'data-prefill-memory-clear': ''/)
  assert.match(dockSrc, /'data-prefill-memory-unsaved': ''/)
  assert.match(dockSrc, /'data-prefill-memory-discard': ''/)
  assert.match(dockSrc, /'data-prefill-memory-reveal': ''/)
  assert.match(dockSrc, /busyCtl\s*\.run\('seed-fetch'/)
})

// ── 3. 系统提示 & 工作区说明 ───────────────────────────────────────────

test('[M3] 系统提示：off 态语义统一 + 实时字数/tok 与保存微标 + setSystemMode busyCtl + 接管 warn callout', () => {
  assert.match(dockSrc, /systemMode === 'off' \? `\$\{t\('systemAppendMeta'\)\} · \$\{t\('systemOffMeta'\)\}`/)
  assert.match(dockSrc, /'data-prefill-system-metrics': ''/)
  assert.match(dockSrc, /'data-prefill-system-save-state': systemSaveState/)
  assert.match(dockSrc, /busyCtl\.run\('system-mode', \(\) => writeSystem\(systemText, mode\)\)/)
  assert.match(dockSrc, /systemMode === 'takeover'\s*\?\s*h\('div', \{ style: V\.callout\('warn'\), 'data-prefill-system-takeover-warn': '1' \}, t\('systemTakeoverWarn'\)\)/)
})

test('[M3] 工作区说明：改写模式「填入原文作为起点」+ 长 wsOriginal（>8行）默认折叠接 Reveal', () => {
  assert.match(dockSrc, /'data-prefill-ws-fill-original': '1'/)
  assert.match(dockSrc, /const wsOriginalLong = wsOriginalLines > 8/)
  assert.match(dockSrc, /'data-prefill-ws-original-toggle': ''/)
  assert.match(dockSrc, /'data-prefill-ws-original-reveal': ''/)
})

// ── 4. 每轮注入积木工作台 ──────────────────────────────────────────────

test('[M3] 每轮注入工作台：字/tok 单位一致 + 去重空态按钮 + SegmentedControl + 内联二次确认 + 空台副标 + overrideNow busy + 去 SVG 弧线 + 菜单退场', () => {
  // 字与 tok 分开标注，消灭「约 N tok」标字符数的矛盾
  assert.match(dockSrc, /t\('benchCostUnit'\)/)
  assert.match(dockSrc, /t\('benchPreviewUnit'\)/)
  assert.doesNotMatch(dockSrc, /benchSummaryNow\.firstTok \+ ' tok'/)
  // 空态去重：底部「+ 自己写一段」只在 bench.length > 0 时渲染
  assert.match(dockSrc, /bench\.length > 0\s*\?\s*h\(\s*'div',[\s\S]{0,240}'data-prefill-bench-add-row': ''/)
  // 模式改用 SegmentedControl
  assert.match(dockSrc, /optionAttr: 'data-prefill-everyturn-mode'/)
  // 删自定义积木 / 塔改两步内联确认
  assert.match(dockSrc, /'data-prefill-bench-menu-armed':/)
  // 空台且开着时左栏副文本改「○ 空（未放积木）」
  assert.match(dockSrc, /everyTurnEmptyMeta/)
  // overrideNow 接 busyCtl + 立即刷新 every-turn-status
  assert.match(dockSrc, /busyCtl\s*\.run\('everyturn-override'/)
  // 移除错位固定行高 overlapLayer SVG 弧线；保留并强化 ⇄ 徽章 + 同组 hover 高亮
  assert.doesNotMatch(dockSrc, /const overlapLayer =/)
  assert.match(dockSrc, /'data-prefill-overlap-highlight':/)
  assert.match(dockSrc, /setBenchHoverOverlap/)
  // blockMenu 补退场过渡
  assert.match(dockSrc, /usePresence\(benchMenu, null, MENU_EXIT,/)
})

// ── 5. 开场对话 & 手动注入 ─────────────────────────────────────────────

test('[M3] 开场对话：删单条接 UndoBar + 首尾 ↑↓ disabled + move/删行保留展开态 + AI/用户暂存 reasoning + fetchBar 范围校验与 Spinner + Reveal', () => {
  // 删单条走 removeItemAt -> UndoBar
  assert.match(dockSrc, /const removeItemAt = \(index\) => \{[\s\S]*?setUndoSnap\(\{ items: before, mode: 'delete' \}\)/)
  assert.match(dockSrc, /h\(UndoBar, \{\s*token: undoSnap,\s*barAttr: 'data-prefill-fetch-undo-bar'/)
  // 首尾行 ↑↓ disabled
  assert.match(dockSrc, /disabled: atFirst,[\s\S]{0,120}'data-prefill-item-up': String\(index\)/)
  assert.match(dockSrc, /disabled: atLast,[\s\S]{0,120}'data-prefill-item-down': String\(index\)/)
  // move 交换 key，不清整套 expandedRows
  assert.doesNotMatch(dockSrc, /const move = \(index, delta\) => \{\s*const target = index \+ delta\s*if \(target < 0 \|\| target >= items\.length\) return\s*setExpandedRows\(new Set\(\)\)/)
  // AI 切用户暂存 reasoning，切回可复原
  assert.match(dockSrc, /reasoningStashRef\.current\[index\] = currentReasoning/)
  assert.match(dockSrc, /const restored = reasoningStashRef\.current\[index\] \?\? ''/)
  // fetchBar from <= to 校验 + Spinner
  assert.match(dockSrc, /const fetchRangeInvalid =/)
  assert.match(dockSrc, /'data-prefill-fetch-range-error': '1'/)
  assert.match(dockSrc, /fetchBusy \? h\(Spinner, \{ key: 'spin', size: 11 \}\) : null/)
  // 长行展开 & 锁定详情接 Reveal
  assert.match(dockSrc, /h\(Reveal, \{ open: !collapsed, gap: 4, 'data-prefill-item-reveal': String\(index\)/)
  assert.match(dockSrc, /'data-prefill-lock-toggle': ''/)
  assert.match(dockSrc, /h\(\s*Reveal,\s*\{ open: lockDetailsOpen, gap: 4, 'data-prefill-lock-items': String\(lockedItems\.length\)/)
})

test('[M3] 手动注入：写错误接入 reportError + send/withdraw/saveEdit busy+Spinner + Esc 防冒泡仅退出编辑 + Ctrl/Cmd+Enter + 复用 streaming', async () => {
  // 源码契约：PrefillDock 透传 streaming；capture 阶段 Esc 守卫不关卡片
  assert.match(dockSrc, /h\(ManualInject, \{ t, sessionId, streaming \}\)/)
  assert.match(dockSrc, /\[data-prefill-manual-edit-text\],\[data-prefill-dialog-panel\]/)
  assert.match(manualSrc, /dialogLayers\.push\(\(\) => setEditing\(null\)\)/)
  assert.match(manualSrc, /const running = typeof props\.streaming === 'boolean' \? props\.streaming : data\?\.running === true/)

  // 运行时挂载验证：真实跑 ManualInject，测 Esc 防冒泡、Ctrl+Enter 保存、写失败调 reportError、复用 streaming
  const hooks = []
  let idx = 0
  const effects = []
  const React = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children: children.flat() }
    },
    useState(init) {
      const slot = idx++
      if (!(slot in hooks)) hooks[slot] = typeof init === 'function' ? init() : init
      return [hooks[slot], (v) => (hooks[slot] = typeof v === 'function' ? v(hooks[slot]) : v)]
    },
    useRef(init) {
      const slot = idx++
      if (!(slot in hooks)) hooks[slot] = { current: init }
      return hooks[slot]
    },
    useCallback(fn, deps) {
      const slot = idx++
      const prev = hooks[slot]
      if (!prev || !deps || deps.length !== prev.deps.length || deps.some((d, i) => !Object.is(d, prev.deps[i]))) {
        hooks[slot] = { fn, deps: deps ?? [] }
      }
      return hooks[slot].fn
    },
    useEffect(fn, deps) {
      const slot = idx++
      const prev = hooks[slot]
      const changed = !prev || !deps || deps.length !== prev.deps.length || deps.some((d, i) => !Object.is(d, prev.deps[i]))
      if (changed) effects.push({ slot, fn, deps: deps ?? [] })
    },
    useLayoutEffect() {},
  }
  const h = React.createElement
  const find = (node, pred, out = []) => {
    if (!node || typeof node !== 'object') return out
    if (pred(node.props ?? {}, node)) out.push(node)
    for (const child of node.children ?? []) find(child, pred, out)
    return out
  }
  const errors = []
  const oks = []
  const layers = []
  let nextResponse = { ok: true, live: true, running: false, pending: [{ id: 'm1', role: 'user', text: '旧文本' }], recent: [] }
  const calls = []
  const postJson = async (_route, payload) => {
    calls.push(payload)
    if (payload.op === 'add' && payload.text === 'FAIL') return { ok: false, reason: 'queue-full' }
    if (payload.op === 'edit') return { ok: true, live: true, running: false, pending: [{ id: 'm1', role: payload.role, text: payload.text }], recent: [] }
    return nextResponse
  }
  const V = { row: {}, hint: {}, sectionMeta: {}, textarea: {}, btnPrimary: {}, btn: {}, btnGhost: {}, callout: () => ({}) }
  const S = { dockStatus: () => ({}) }
  const useBusy = () => ({
    pending: () => false,
    shown: () => false,
    run: (_k, fn) => fn(),
  })
  const busyAttrs = () => ({})
  const Spinner = () => h('span', { 'data-spinner': '1' })
  const SegmentedControl = (p) => h('div', { 'data-seg': p.value })
  const RollText = (p) => h('span', null, p.children)
  const withGhosts = (list) => list.map((entry) => ({ entry, leaving: false }))
  const rowChanges = () => ({ removed: [], added: [] })
  const dialogLayers = {
    push(fn) {
      layers.push(fn)
      return () => {
        const at = layers.indexOf(fn)
        if (at >= 0) layers.splice(at, 1)
      }
    },
  }
  // eslint-disable-next-line no-new-func
  const ManualInject = new Function(
    'React', 'h', 'V', 'S', 'INJECT_ROUTE', 'postJson', 'postJsonWithTimeout', 'useBusy', 'busyAttrs', 'BUSY_LOOK', 'Spinner', 'SegmentedControl', 'RollText', 'withGhosts', 'rowChanges', 'ROW_FX', 'NAV_FLASH', 'FLASH_MS', 'play', 'reportError', 'reportOk', 'dialogLayers',
    `${manualSrc}\nreturn ManualInject`,
  )(
    React, h, V, S, '/api/dsh-prefill/inject', postJson, postJson, useBusy, busyAttrs, {}, Spinner, SegmentedControl, RollText, withGhosts, rowChanges, { enter() {}, exit: () => ({ abort() {} }) }, [], 200, () => null,
    (sid, key, op, err) => errors.push({ sid, key, op, msg: String(err?.message ?? err) }),
    (sid, key) => oks.push({ sid, key }),
    dialogLayers,
  )
  const flushCleanups = () => {
    for (const slot of Object.keys(hooks)) {
      const entry = hooks[slot]
      if (entry && typeof entry.cleanup === 'function') {
        entry.cleanup()
        entry.cleanup = undefined
      }
    }
  }
  const tFn = (k) => k
  const render = (extra = {}) => {
    idx = 0
    effects.length = 0
    const tree = ManualInject({ t: tFn, sessionId: 'sid-1', streaming: true, ...extra })
    for (const eff of effects.splice(0)) {
      if (typeof hooks[eff.slot]?.cleanup === 'function') hooks[eff.slot].cleanup()
      const cleanup = eff.fn()
      hooks[eff.slot] = { deps: eff.deps, cleanup }
    }
    return tree
  }
  try {
    let tree = render()
    await new Promise((r) => setTimeout(r, 0))
    tree = render()
    // 1) 复用 PrefillDock 的 streaming=true（即便后端回 running=false）
    assert.equal(tree.props['data-running'], '1')
    assert.match(JSON.stringify(find(tree, (p) => 'data-prefill-manual-status' in p)), /manualRunning/)
    // 2) 写失败进 reportError 联动 ErrorPill
    find(tree, (p) => 'data-prefill-manual-text' in p)[0].props.onChange({ target: { value: 'FAIL' } })
    tree = render()
    find(tree, (p) => p['data-prefill-manual-inject'] === '1')[0].props.onClick()
    await new Promise((r) => setTimeout(r, 0))
    assert.equal(errors.length, 1, '手动注入失败应调用 reportError 联动头部 ErrorPill')
    assert.equal(errors[0].key, 'manual')
    // 3) 进入行内编辑：按 Esc 调 stopPropagation() 并退出编辑，绝不冒泡关卡片
    tree = render()
    find(tree, (p) => p['data-prefill-manual-edit'] === 'm1')[0].props.onClick()
    tree = render()
    const [editArea] = find(tree, (p) => 'data-prefill-manual-edit-text' in p)
    assert.ok(editArea, '行内编辑 textarea 应带 data-prefill-manual-edit-text')
    let stopped = 0
    let prevented = 0
    let immediate = 0
    editArea.props.onKeyDown({
      key: 'Escape',
      preventDefault: () => (prevented += 1),
      stopPropagation: () => (stopped += 1),
      nativeEvent: { stopImmediatePropagation: () => (immediate += 1) },
    })
    assert.equal(prevented, 1)
    assert.equal(stopped, 1, 'Esc 必须调用 stopPropagation()')
    assert.equal(immediate, 1)
    tree = render()
    assert.equal(find(tree, (p) => 'data-prefill-manual-edit-text' in p).length, 0, 'Esc 后仅退出行内编辑')
    // 4) 行内编辑 Ctrl/Cmd+Enter 保存
    find(tree, (p) => p['data-prefill-manual-edit'] === 'm1')[0].props.onClick()
    tree = render()
    find(tree, (p) => 'data-prefill-manual-edit-text' in p)[0].props.onChange({ target: { value: '新文本' } })
    tree = render()
    find(tree, (p) => 'data-prefill-manual-edit-text' in p)[0].props.onKeyDown({
      key: 'Enter',
      ctrlKey: true,
      preventDefault() {},
    })
    await new Promise((r) => setTimeout(r, 0))
    assert.ok(calls.some((c) => c.op === 'edit' && c.text === '新文本'), 'Ctrl+Enter 触发保存')
  } finally {
    flushCleanups()
  }
})

// ── 6. 会话沙盒 ────────────────────────────────────────────────────────

test('[M3] 会话沙盒：清「⭐ 全局记住」幽灵文案 + 可点跳链 + busyCtl + 改写保存微标 + 审计横向滚 + 事后改写切候选防误弃 + Reveal', async () => {
  // 清空幽灵文案「⭐ 全局记住」
  assert.doesNotMatch(sbxTextSrc, /⭐/, 'SBX_TEXT 不应残留过时的「⭐ 全局记住」幽灵文案')
  assert.match(sbxTextSrc, /sbxGlobalInSidebar: '全局默认请在左侧栏设置页调整 ↗'/)
  assert.match(sandboxSrc, /'data-prefill-sbx-open-settings': 'default-sandbox'/)
  assert.match(sandboxSrc, /'data-prefill-sbx-audit-scroll': ''/)
  assert.match(sandboxSrc, /overflowX: 'auto'/)
  assert.match(sandboxSrc, /'data-prefill-sbx-pack-reveal': pack\.id/)
  assert.match(sandboxSrc, /'data-prefill-sbx-advanced-reveal': ''/)

  // 运行时挂载验证：事后改写编辑后切换候选弹窗内警示确认，不会静默丢失改动
  const SID = 'sid-sbx'
  const audit = { [SID]: [{ group: 'messages', name: 'developer:tool-registry', preview: 'p', blockable: false, count: 2 }] }
  const sources = () => ({ injections: { catalog: {}, sessions: {} }, tools: { catalog: [], sessions: {} }, audit })
  const state = { sandbox: { [SID]: { level: 'controlled', rules: [] } } }
  const c1 = { seq: 4, currentSeq: 4, type: 'user/message', name: 'runtime-context', turn: 1, preview: 'ctx-1' }
  const c2 = { seq: 6, currentSeq: 6, type: 'user/message', name: 'runtime-context', turn: 2, preview: 'ctx-2' }
  const routes = {
    'surface-list': { ok: true, ready: true, risks: ['log', 'conflict', 'cache', 'internal'], candidates: [c1, c2], edits: [] },
  }
  const ui = makeHarness({ state, sandboxView: { [SID]: sandboxView(migrateSandbox(state), SID, sources()) } }, { sid: SID, sources, routes })
  let tree = ui.render()
  // 跳链存在
  assert.equal(ui.find(tree, (p) => p['data-prefill-sbx-open-settings'] === 'default-sandbox').length, 1)
  // 审计表外包横向滚动容器
  assert.equal(ui.find(tree, (p) => 'data-prefill-sbx-audit-scroll' in p).length, 1)
  // 打开事后改写，改写文本框后切换候选 → 弹出未提交确认条而不是静默清空
  ui.find(tree, (p) => 'data-prefill-sbx-surface-all' in p)[0].props.onClick()
  await ui.settle()
  tree = ui.render()
  // 默认选中最后一条 seq=6，改内容
  ui.find(tree, (p) => 'data-prefill-sbx-surface-text' in p)[0].props.onChange({ target: { value: '未提交的草稿' } })
  tree = ui.render()
  const item4 = ui.find(tree, (p) => p['data-prefill-sbx-surface-item'] === '4')[0]
  ui.find(item4, (p, node) => node.type === 'input' && p.type === 'radio')[0].props.onChange()
  tree = ui.render()
  assert.equal(ui.find(tree, (p) => 'data-prefill-sbx-surface-switch-warn' in p).length, 1, '已编辑切换候选前应提示确认')
  assert.equal(ui.find(tree, (p) => 'data-prefill-sbx-surface-text' in p)[0].props.value, '未提交的草稿', '未确认前草稿不丢')
  // 点「留在当前」保留草稿
  ui.find(tree, (p) => 'data-prefill-sbx-surface-switch-cancel' in p)[0].props.onClick()
  tree = ui.render()
  assert.equal(ui.find(tree, (p) => 'data-prefill-sbx-surface-switch-warn' in p).length, 0)
  assert.equal(ui.find(tree, (p) => 'data-prefill-sbx-surface-text' in p)[0].props.value, '未提交的草稿')
  // 再次切候选并点「放弃并切换」才真正切换
  ui.find(ui.find(tree, (p) => p['data-prefill-sbx-surface-item'] === '4')[0], (p, node) => node.type === 'input' && p.type === 'radio')[0].props.onChange()
  tree = ui.render()
  ui.find(tree, (p) => 'data-prefill-sbx-surface-switch-confirm' in p)[0].props.onClick()
  tree = ui.render()
  assert.equal(ui.find(tree, (p) => 'data-prefill-sbx-surface-text' in p)[0].props.value, '')
})

// ── 7. 用量与缓存 ──────────────────────────────────────────────────────

test('[M3] 用量与缓存：4 格 KPI 网格 + 命中率百分比与色阶 + 吸顶表头 + 自适应余高 + 倒序切换 + 按需轮询', () => {
  // 源码契约：USAGE_ROUTE 仅在 pane === 'usage' || streaming 时 4s 轮询
  assert.match(dockSrc, /const usagePollActive = pane === 'usage' \|\| streaming/)
  assert.match(dockSrc, /if \(!usagePollActive\) \{/)
  // 解除 maxHeight: 180 死锁
  assert.doesNotMatch(usageSrc, /maxHeight:\s*180\b/)
  assert.match(usageSrc, /position: 'sticky',\s*top: 0/)

  // 运行时挂载验证：KPI 网格、命中率色阶（高/中/低）、正序/倒序切换
  const hooks = []
  let idx = 0
  const React = {
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children: children.flat() }
    },
    useState(init) {
      const slot = idx++
      if (!(slot in hooks)) hooks[slot] = typeof init === 'function' ? init() : init
      return [hooks[slot], (v) => (hooks[slot] = typeof v === 'function' ? v(hooks[slot]) : v)]
    },
  }
  const h = React.createElement
  const T = { surface: { card: {} }, font: { xs: 11, kpi: 20 }, layout: { num: {} }, radius: { sm: 6 } }
  const V = { bar: {}, hint: {}, btnGhost: {}, table: {}, th: {}, td: {}, callout: () => ({}) }
  const fmt = (n) => String(n)
  // eslint-disable-next-line no-new-func
  const UsagePanel = new Function('React', 'h', 'T', 'V', 'fmt', `${usageSrc}\nreturn UsagePanel`)(React, h, T, V, fmt)
  const find = (node, pred, out = []) => {
    if (!node || typeof node !== 'object') return out
    if (pred(node.props ?? {}, node)) out.push(node)
    for (const child of node.children ?? []) find(child, pred, out)
    return out
  }
  const renderUsage = (usage) => {
    idx = 0
    return UsagePanel({ t: (k) => k, usage, gateMode: 'pass', systemMode: 'off', systemTok: 0, itemsTok: 0, injectMode: false, written: false })
  }
  // 高命中（80%）：high
  let tree = renderUsage({
    total: { input: 200, cacheRead: 800, output: 150 },
    turns: [
      { turn: 1, input: 100, cacheRead: 400, output: 50, systemChars: 1200, tools: 4 },
      { turn: 2, input: 100, cacheRead: 400, output: 100, systemChars: 1200, tools: 4 },
    ],
  })
  assert.equal(find(tree, (p) => p['data-prefill-usage-kpi-grid'] === '1').length, 1)
  assert.equal(find(tree, (p) => 'data-prefill-usage-kpi' in p).length, 4)
  assert.equal(find(tree, (p) => p['data-prefill-usage-cache-bar'] === 'high').length, 1)
  assert.equal(find(tree, (p) => p['data-prefill-usage-hit-pct'] === '80').length, 1)
  const [tbodyAsc] = find(tree, (_p, n) => n.type === 'tbody')
  assert.deepEqual(tbodyAsc.children.map((tr) => tr.props.key), [1, 2])
  // 切换倒序
  find(tree, (p) => p['data-prefill-usage-order'] === 'asc')[0].props.onClick()
  tree = renderUsage({
    total: { input: 200, cacheRead: 800, output: 150 },
    turns: [
      { turn: 1, input: 100, cacheRead: 400, output: 50, systemChars: 1200, tools: 4 },
      { turn: 2, input: 100, cacheRead: 400, output: 100, systemChars: 1200, tools: 4 },
    ],
  })
  assert.equal(find(tree, (p) => p['data-prefill-usage-order'] === 'desc').length, 1)
  const [tbodyDesc] = find(tree, (_p, n) => n.type === 'tbody')
  assert.deepEqual(tbodyDesc.children.map((tr) => tr.props.key), [2, 1])
  // 低命中（10%）：low；中命中（40%）：mid
  const lowTree = renderUsage({ total: { input: 900, cacheRead: 100, output: 50 }, turns: [] })
  assert.equal(find(lowTree, (p) => p['data-prefill-usage-cache-bar'] === 'low').length, 1)
  const midTree = renderUsage({ total: { input: 600, cacheRead: 400, output: 50 }, turns: [] })
  assert.equal(find(midTree, (p) => p['data-prefill-usage-cache-bar'] === 'mid').length, 1)
})
