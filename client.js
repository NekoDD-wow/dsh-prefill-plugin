/**
 * @local/dsh-prefill —— 浏览器半（M1：四通道闸门面板）。
 *
 * 交付形态照官方 `templates/decoration/client.js`：注册 lazy factory，id 必须
 * 与 package.json 的 name 完全一致。只用浏览器模块表供给的 `react`。
 *
 * 两条官方红线（规划 §2.5.2）：
 *   P1 不 require 任何 Harness Client 包 —— 控件全部自绘；
 *   P9 不写组件外的 DOM —— 一切都在自己的 slot 组件内。
 *
 * 文案走 Client locale 服务，颜色走 `--dsw-alias-*` token（P10）。
 *
 * @module @local/dsh-prefill/client
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-prefill',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** 本插件独占的 locale 命名空间。 */
    const NS = 'dsh-prefill'

    /** 自有路由。 */
    const PING_ROUTE = '/api/dsh-prefill/ping'
    const STATE_ROUTE = '/api/dsh-prefill/state'
    /** 草稿路由：读/写本会话的多轮 items（发送前可编辑的载体）。 */
    const DRAFT_ROUTE = '/api/dsh-prefill/draft'
    /** 包路由：预填装包按工作区存取（M4）。 */
    const PACKS_ROUTE = '/api/dsh-prefill/packs'

    /**
     * 同页两个组件之间的状态同步：输入框里的「预填装」开关写完之后广播一次，
     * 草稿区（`conversation.input.dock`）收到就重读状态 ⇒ 开关一翻，草稿区**立刻**出现。
     * 不轮询、不读别人的 DOM（P9）。
     */
    const STATE_EVENT = 'dsh-prefill:state-changed'
    function notifyStateChanged() {
      try {
        window.dispatchEvent(new CustomEvent(STATE_EVENT))
      } catch {
        // 广播失败不该拖垮 UI。
      }
    }

    /**
     * 每个会话**当前的注入改写草稿**（`{messages, sections, contexts}`）。
     *
     * 为什么要有这个模块级表：注入改写现在是**预填装面板里的一节**，而"预设"要把它
     * 和预填装内容一起存/取（用户要求"跟预设绑在一起"）。面板里的编辑器更新它，
     * 面板的预设按钮读写它，两者同模块共享即可。
     */
    const injectionDrafts = new Map()

    /** 读某会话的注入改写草稿（没有就空对象）。 */
    function injectionDraftOf(sessionId) {
      const draft = injectionDrafts.get(sessionId)
      return draft === undefined || draft === null ? { messages: {}, sections: {}, contexts: {} } : draft
    }

    /** 面板上的开关清单（顺序即展示顺序）。 */
    const LEVERS = [
      { key: 'probeSection', tone: 'write' },
      { key: 'probeContext', tone: 'write' },
      { key: 'blockSections', tone: 'block' },
      { key: 'blockContexts', tone: 'block' },
      { key: 'blockTools', tone: 'block' },
      { key: 'blockMessages', tone: 'block' },
    ]

    const zh = {
      nav: '预填装',
      // 两个开关：① 用不用预填装 ② 拦不拦 harness 的默认注入
      gateOff: '不拦注入',
      gateOn: '拦注入',
      gateTitleOff: '当前：harness 的默认注入照常送出。点一下改成「拦注入」',
      gateTitleOn: '当前：拦注入已开——这一轮不再送系统提示 / 工具 / 各种注入，只留你预填装的内容。点一下关掉',
      gateNoticeTitle: '开启「拦注入」？',
      gateNoticeBody: '这一轮系统提示会被清空重写 ⇒ 开新 series、前缀缓存失效、这一轮更贵。此说明只弹一次。',
      gateConfirm: '开启',
      gateCancel: '取消',
      prefillOff: '预填装',
      prefillOn: '预填装·开',
      // 会话开跑后自动改名：预填装（写进历史）→ **预注入**（每轮注入，且必须手动触发）。
      injectOff: '预注入',
      injectOn: '预注入 · 待点注入',
      injectDone: '预注入 · 已注入',
      injectTitleOff:
        '本会话已开跑 ⇒ 内容不会再写进历史。注意：**不会自动注入** —— 要点面板里的「注入」，内容才会在下一轮带上（这里只是启用）。',
      injectTitleOn:
        '已启用预注入。但**不会自动生效**：还需点面板里的「注入」，把内容写进本会话配置（下一轮请求生效）。',
      prefillTitleOff: '本会话还没用预填装——点一下开启，编辑区会出现在输入框上方',
      prefillTitleOn: '本会话已用预填装——你发第一条消息时，这些内容会变成真实对话历史。点一下关掉',
      title: '预填装 · 注入控制',
      intro:
        '开发 / 排查用的开关：系统提示(sections) / 运行时上下文(contexts) / 工具(tools) / 注入消息，各自「能写」与「能拦」。默认不碰任何会话——只有在「生效会话」里填了会话 id 才起作用。',
      cardTitle: '开关',
      writeGroup: '写入测试内容（开发用）',
      blockGroup: '拦掉（开发用）',
      probeSection: '写一段测试系统提示',
      probeContext: '写一段测试运行时上下文',
      blockSections: '清空系统提示',
      blockContexts: '清空运行时上下文',
      blockTools: '不给工具',
      blockMessages: '拦掉注入消息',
      armedLabel: '生效会话（会话 id，空格或逗号分隔；留空＝不干预任何会话）',
      allowLabel: '放行哪些来源（点标签加入白名单；再点一次移除）',
      allowLocked: 'user（恒定放行）',
      allowSessionLabel: '本会话放行来源（只影响这个会话）',
      // ── 工具放行（不改工具说明，只管能不能用）──
      toolsLabel: '放行哪些工具（全局）',
      toolsSessionLabel: '本会话放行的工具（只管能不能用，不改工具说明）',
      toolsAll: '全部放行',
      toolsNone: '一个都不给',
      toolsEmpty: '还没扫到工具（先跑一轮）',
      allowSessionInherit: '继承全局',
      sessionClear: '清除本会话注入配置',
      sessionClearTip: '删掉这个会话的注入改写、每轮注入内容与独立白名单（回到全局默认）',
      clearDone: '已清除',
      confirmDeletePreset: '删除这个预设？再点一次确认',
      confirmClearSession: '清除本会话的注入配置？再点一次确认',
      confirmYes: '确认？',
      apply: '保存',
      applyArmed: '保存生效会话',
      saved: '已保存',
      saveFailed: '保存失败',
      stateTitle: '运行状态',
      stateFileLabel: '状态文件',
      hostLabel: '后台连接',
      routeLabel: '接口',
      reachable: '通',
      unreachable: '不通',
      busy: '检测中…',
      idle: '未检测',
      m1Note: '排查用：状态文件可以直接改，不必污染当前会话。',
      // ── 预填装内容（输入框上方的编辑区）──
      dockTitle: '预填装内容',
      dockHint:
        '想让 AI 一开始就“记得”什么，写在这里：用户说的话和 AI 的回答顺序随意、连着好几条也行；AI 的思考过程写在 AI 那条里。你发第一条消息时，它们会变成真实对话历史。',
      dockEmpty: '还没有内容——点下面的按钮加一条。',
      addUser: '＋ 用户说',
      addAssistant: '＋ AI 回答',
      dockClear: '清空',
      roleUser: '用户',
      roleAssistant: 'AI',
      textUser: '用户说的话',
      textAssistant: 'AI 的回答',
      reasoning: '思维链（可选）',
      toUser: '改成“用户说”',
      toAssistant: '改成“AI 回答”',
      moveUp: '上移',
      moveDown: '下移',
      removeItem: '删掉这条',
      syncIdle: '未改动',
      syncSaving: '保存中…',
      syncSaved: '已保存',
      syncFailed: '保存失败（后台接口不通？）',
      countSuffix: ' 条',
      // ── 模式（首轮前=写入历史；会话已开跑=每轮注入）──
      modeHistory: '写入历史',
      modeHistoryTip: '首轮发出时，这些内容会变成真实对话历史（持久、省 token、模型当成自己的记忆）',
      modeInject: '每轮注入',
      modeInjectTip:
        '会话已开跑，无法再写入历史 ⇒ 内容改为**每轮注入**。注意：**不会自动生效** —— 点「注入」才会在下一轮请求里带上（不进历史、每轮花 token）。',
      injectNow: '注入',
      injectNowTip: '把当前内容与注入改写写成"本会话配置"，不产生任何消息；下一轮请求就带上',
      injectedNext: '已注入 · 下一轮生效',
      injectFailed: '注入失败',
      // ── Q9 角标 ──
      statePure: '只留预填装',
      statePass: '注入照旧',
      stateFilter: '按勾选的放行',
      nextTurn: '下一轮才生效',
      badgeTip: '这一轮实际生效的状态（本轮已锁定，改开关从下一轮开始）',
      // ── 预设（原「包」）──
      packs: '预设',
      packsEmpty: '（暂无预设）',
      loadPack: '套用',
      savePack: '保存为预设',
      deletePack: '删除预设',
      packNamePlaceholder: '预设名',
      exportFile: '导出为文件',
      importFile: '从文件导入',
      fileHint: '预设文件 = 完整预对话记录 + 预注入改写',
      injectIgnored: '工具类注入已忽略（改了会让工具失效）',
      // ── 注入内容改写（Q17，只在本会话生效）──
      injectTitle: '改写注入内容',
      injectHint: '把 harness 送进去的内容改掉，只在本会话生效；留空＝不修改。下面列的是默认注入清单，还没出现过的也能先改（命中即生效）。',
      injectNone: '（没拿到可改清单）',
      injectMessages: '消息类注入',
      injectSections: '系统提示里的段落',
      injectContexts: '运行时上下文',
      injectAdd: '＋ 加',
      injectToggle: '注入改写',
      injectToggleTip: '改写 harness 送进去的默认注入（只在本会话生效）',
      injectAddLabel: '添加条目',
      injectAddPick: '从清单选，或直接输入自定义名字',
      injectAddPlaceholder: '名字：来源 kind / 段名 / 上下文名',
      injectStaleHost: '后台是旧版本，没返回清单——重启一次 DSH 即可',
      injectSaved: '已保存',
      injectFailed: '保存失败',
    }

    const en = {
      nav: 'Prefill',
      gateOff: 'Injections on',
      gateOn: 'Blocked',
      gateTitleOff: 'Harness injections flow as usual — click to block them',
      gateTitleOn: 'Blocking is on — the system prompt, tools and injections are withheld; only your prefill stays. Click to turn off',
      gateNoticeTitle: 'Block injections?',
      gateNoticeBody:
        'This turn empties and rewrites the system prompt ⇒ a new series starts, the prefix cache is void, and the turn costs more. Shown once.',
      gateConfirm: 'Turn on',
      gateCancel: 'Cancel',
      prefillOff: 'Prefill',
      prefillOn: 'Prefill·on',
      // Renamed automatically once the session has run: prefill (history) → pre-inject (per turn, manual).
      injectOff: 'Pre-inject',
      injectOn: 'Pre-inject · click Inject',
      injectDone: 'Pre-inject · injected',
      injectTitleOff:
        'This session has already run, so nothing is written to history. Nothing is injected automatically — press "Inject" in the panel to carry it into the next turn (this only enables the mode).',
      injectTitleOn:
        'Pre-injection is enabled, but it is NOT automatic: press "Inject" in the panel to write the content into this session config (effective next turn).',
      prefillTitleOff: 'This session does not use prefill — click to enable; the editor shows up above the composer',
      prefillTitleOn: 'Prefill is on — this content becomes real history on your first send. Click to turn off',
      title: 'Prefill · injection control',
      intro:
        'Developer/diagnostic switches: sections / contexts / tools / injected messages, each writable or blockable. Nothing is touched unless a session id is listed below.',
      cardTitle: 'Switches',
      writeGroup: 'Write test content (dev)',
      blockGroup: 'Block (dev)',
      probeSection: 'Write a test system section',
      probeContext: 'Write a test runtime context',
      blockSections: 'Empty the system prompt',
      blockContexts: 'Empty runtime contexts',
      blockTools: 'No tools',
      blockMessages: 'Block injected messages',
      armedLabel: 'Affected sessions (session ids, space/comma separated; empty touches nothing)',
      allowLabel: 'Sources to admit (click a tag to allow it; click again to remove)',
      allowLocked: 'user (always allowed)',
      allowSessionLabel: 'Sources admitted in this session (this session only)',
      // ── tool admission (does not rewrite tool descriptions) ──
      toolsLabel: 'Tools to admit (global)',
      toolsSessionLabel: 'Tools admitted in this session (availability only; descriptions are never rewritten)',
      toolsAll: 'All tools',
      toolsNone: 'No tools',
      toolsEmpty: 'no tools discovered yet (run one turn first)',
      allowSessionInherit: 'inherit global',
      sessionClear: 'Clear this session\u2019s injection config',
      sessionClearTip: 'Drop this session\u2019s injection rewrites, per-turn injected content and its own allow-list',
      clearDone: 'cleared',
      confirmDeletePreset: 'Delete this preset? Click again to confirm',
      confirmClearSession: 'Clear this session\u2019s injection config? Click again to confirm',
      confirmYes: 'Confirm?',
      apply: 'Save',
      applyArmed: 'Save affected sessions',
      saved: 'Saved',
      saveFailed: 'Save failed',
      stateTitle: 'Runtime state',
      stateFileLabel: 'State file',
      hostLabel: 'Host link',
      routeLabel: 'Route',
      reachable: 'reachable',
      unreachable: 'unreachable',
      busy: 'checking…',
      idle: 'not checked',
      m1Note: 'Diagnostics: the state file can be edited directly, so verification need not pollute a session.',
      // ── prefill content (editor above the composer) ──
      dockTitle: 'Prefill content',
      dockHint:
        'Write whatever the AI should "remember" from the start: your messages and AI answers in any order, several in a row is fine; the AI reasoning goes inside its own row. They become real history on your first send.',
      dockEmpty: 'Nothing yet — add a row below.',
      addUser: '+ User says',
      addAssistant: '+ AI answer',
      dockClear: 'Clear',
      roleUser: 'User',
      roleAssistant: 'AI',
      textUser: 'What the user says',
      textAssistant: 'The AI answer',
      reasoning: 'Reasoning (optional)',
      toUser: 'Make it a user message',
      toAssistant: 'Make it an AI answer',
      moveUp: 'Move up',
      moveDown: 'Move down',
      removeItem: 'Remove',
      syncIdle: 'unchanged',
      syncSaving: 'saving…',
      syncSaved: 'saved',
      syncFailed: 'save failed (host route?)',
      countSuffix: ' rows',
      // ── mode (before first turn = write history; after = inject every turn) ──
      modeHistory: 'Write to history',
      modeHistoryTip: 'On your first send these become real conversation history (durable, cheap, owned by the model)',
      modeInject: 'Inject every turn',
      modeInjectTip:
        'This session has already run, so history is out of reach — the content is injected on every turn instead. Note: it is NOT automatic — press "Inject" to carry it into the next request (not history, costs tokens each turn).',
      injectNow: 'Inject',
      injectNowTip: 'Write the current content and injection rewrites into this session config — no message is produced; the next turn carries it',
      injectedNext: 'Injected · next turn',
      injectFailed: 'Inject failed',
      // ── Q9 badge ──
      statePure: 'Prefill only',
      statePass: 'Injections normal',
      stateFilter: 'Selected only',
      nextTurn: 'next turn',
      badgeTip: 'What is actually in effect this turn (locked for the turn; toggling applies next turn)',
      // ── presets (was "packs") ──
      packs: 'Preset',
      packsEmpty: '(no presets)',
      loadPack: 'Apply',
      savePack: 'Save as preset',
      deletePack: 'Delete preset',
      packNamePlaceholder: 'preset name',
      exportFile: 'Export to file',
      importFile: 'Import from file',
      fileHint: 'A preset file = the full pre-conversation plus the injection rewrites',
      injectIgnored: 'Tool-related injections are ignored (editing them would break tools)',
      // ── rewrite injections (Q17, this session only) ──
      injectTitle: 'Rewrite injections',
      injectHint:
        'Override what the harness feeds in — this session only. Empty means leave it alone. The rows below are the default injection catalog: you can pre-set an override before it ever appears.',
      injectNone: '(no catalog available)',
      injectMessages: 'Injected messages',
      injectSections: 'System prompt sections',
      injectContexts: 'Runtime contexts',
      injectAdd: '+ Add',
      injectToggle: 'Rewrite',
      injectToggleTip: 'Rewrite the default injections the harness feeds in (this session only)',
      injectAddLabel: 'Add a row',
      injectAddPick: 'pick from the list, or type a custom name',
      injectAddPlaceholder: 'name: source kind / section / context',
      injectStaleHost: 'Host half is an older build and returned no catalog — restart DSH once',
      injectSaved: 'saved',
      injectFailed: 'save failed',
    }

    const S = {
      page: {
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        padding: '4px 2px 20px',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 13,
        lineHeight: 1.6,
      },
      title: { fontSize: 15, fontWeight: 600 },
      intro: { color: 'var(--dsw-alias-label-secondary)' },
      card: {
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '12px 14px',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 10,
        background: 'var(--dsw-alias-bg-layer-1)',
      },
      cardTitle: { fontWeight: 600 },
      group: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12 },
      switchRow: {
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        justifyContent: 'space-between',
      },
      track: (on) => ({
        width: 38,
        height: 22,
        borderRadius: 11,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: on ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-bg-layer-2)',
        position: 'relative',
        cursor: 'pointer',
        flex: '0 0 auto',
        padding: 0,
      }),
      knob: (on) => ({
        position: 'absolute',
        top: 2,
        left: on ? 18 : 2,
        width: 16,
        height: 16,
        borderRadius: 8,
        background: on ? 'var(--dsw-alias-bg-base)' : 'var(--dsw-alias-state-idle-primary)',
        transition: 'left 120ms ease',
      }),
      label: { color: 'var(--dsw-alias-label-secondary)' },
      input: {
        width: '100%',
        boxSizing: 'border-box',
        padding: '6px 9px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 12,
      },
      button: {
        alignSelf: 'flex-start',
        padding: '5px 12px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 12,
        cursor: 'pointer',
      },
      pre: {
        margin: 0,
        padding: '8px 10px',
        borderRadius: 8,
        background: 'var(--dsw-alias-bg-layer-2)',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 11,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        maxHeight: 220,
        overflow: 'auto',
      },
      note: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12 },
      // ── M2：输入框内开关（尺寸要收紧到 composer 工具行的量级）──
      gatePill: (on) => ({
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        height: 24,
        padding: '0 9px',
        borderRadius: 12,
        border: `1px solid ${on ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)'}`,
        background: on ? 'color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent)' : 'transparent',
        color: on ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)',
        fontSize: 12,
        lineHeight: 1,
        cursor: 'pointer',
        flex: '0 0 auto',
      }),
      gateDot: (on) => ({
        width: 6,
        height: 6,
        borderRadius: 3,
        background: on ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-state-idle-primary)',
      }),
      gateNotice: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 8px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-state-warn-primary)',
        background: 'var(--dsw-alias-bg-layer-2)',
        fontSize: 12,
        maxWidth: 520,
        flexWrap: 'wrap',
      },
      gateNoticeTitle: { fontWeight: 600 },
      gateNoticeBody: { color: 'var(--dsw-alias-label-secondary)' },
      gateBtn: {
        padding: '2px 8px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 12,
        cursor: 'pointer',
      },
      warn: { color: 'var(--dsw-alias-state-warn-primary)', fontSize: 12 },
      // ── 草稿区（输入框上方的会话级面板）──
      dock: {
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '10px 12px',
        // 宽度要和输入框那张卡片**外沿对齐**，所以 padding 必须算进宽度。
        boxSizing: 'border-box',
        // 不加这句，显式 height 会被 flex 压缩（实测给了 683px 仍只渲染 321px）。
        flexShrink: 0,
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 12,
        background: 'var(--dsw-alias-bg-layer-1)',
        fontSize: 12,
        // 轮次再多也不许把整个面板顶高：否则它会把工作区选择 / 模式选择挤出可见区。
        maxHeight: '62vh',
        overflow: 'hidden',
      },
      dockHead: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
      dockTitle: { fontWeight: 600, fontSize: 13 },
      dockHint: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 11, lineHeight: 1.5 },
      dockRow: { display: 'flex', gap: 8, alignItems: 'flex-start' },
      dockRole: (assistant) => ({
        flex: '0 0 auto',
        height: 22,
        padding: '0 8px',
        borderRadius: 11,
        border: `1px solid ${assistant ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)'}`,
        background: assistant ? 'color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent)' : 'transparent',
        color: assistant ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-secondary)',
        fontSize: 11,
        lineHeight: '20px',
        cursor: 'pointer',
      }),
      dockBody: { flex: '1 1 auto', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 },
      dockText: {
        width: '100%',
        boxSizing: 'border-box',
        minHeight: 40,
        padding: '6px 9px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 12,
        fontFamily: 'inherit',
        resize: 'vertical',
      },
      dockThink: {
        width: '100%',
        boxSizing: 'border-box',
        minHeight: 32,
        maxHeight: '16vh',
        padding: '5px 9px',
        borderRadius: 8,
        border: '1px dashed var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: 11,
        fontFamily: 'inherit',
        resize: 'vertical',
      },
      // ── 预填装内容列表：**自己滚**（轮次多时只滚这一块，头部/预设行始终可见）──
      // 高度不写死：外层按"输入框上沿 → 顶栏下沿"算出的可用高度当上限，
      // 内容短就自然撑开，长到接近顶栏才开始内滚（用户要求）。
      dockList: {
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        flex: '1 1 auto',
        minHeight: 0,
        overflowY: 'auto',
        paddingRight: 4,
      },
      // ── Q17：注入内容改写（排版按"卡片 + 分组 + 网格行"来，不再是裸文本框堆叠）──
      injectCard: {
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        flex: '1 1 auto',
        minHeight: 0,
        borderRadius: 12,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
        overflow: 'hidden',
      },
      injectHead: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
        padding: '8px 12px',
        background: 'var(--dsw-alias-bg-layer-2)',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
      },
      injectTitleText: { fontWeight: 600, fontSize: 12.5 },
      injectHintText: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 11 },
      injectStale: { color: 'var(--dsw-alias-state-warn-primary)', fontSize: 11 },
      injectBody: {
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '10px 12px',
        flex: '1 1 auto',
        minHeight: 0,
        overflowY: 'auto',
      },
      injectGroupHead: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: 11,
      },
      injectRule: { flex: '1 1 auto', height: 1, background: 'var(--dsw-alias-border-l2)' },
      injectRows: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 },
      injectRow: {
        display: 'grid',
        gridTemplateColumns: 'minmax(110px, 24%) 1fr',
        gap: 8,
        alignItems: 'start',
      },
      injectKey: {
        fontFamily: 'ui-monospace, Menlo, monospace',
        fontSize: 11,
        color: 'var(--dsw-alias-label-secondary)',
        background: 'var(--dsw-alias-bg-layer-2)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 6,
        padding: '3px 6px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      injectBox: {
        width: '100%',
        minHeight: 34,
        maxHeight: '14vh',
        boxSizing: 'border-box',
        padding: '6px 9px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 12,
        fontFamily: 'inherit',
        resize: 'vertical',
      },
      injectAddRow: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
        padding: '8px 12px',
        borderTop: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-2)',
      },
      injectAddLabel: { color: 'var(--dsw-alias-label-secondary)', fontSize: 11 },
      dockMini: {
        flex: '0 0 auto',
        width: 22,
        height: 22,
        padding: 0,
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: 11,
        lineHeight: 1,
        cursor: 'pointer',
      },
      // ── 标签（放行来源 / 白名单）：来源 id 能直接扫出来，所以点选比手打逗号靠谱 ──
      chipRow: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
      chip: (active) => ({
        padding: '2px 9px',
        borderRadius: 999,
        fontSize: 11,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        border: `1px solid ${active ? 'var(--dsw-alias-state-success-primary, var(--dsw-alias-border-l1))' : 'var(--dsw-alias-border-l2)'}`,
        color: active ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
        background: active ? 'var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-layer-2))' : 'transparent',
      }),
      chipStatic: {
        padding: '2px 9px',
        borderRadius: 999,
        fontSize: 11,
        whiteSpace: 'nowrap',
        border: '1px dashed var(--dsw-alias-border-l2)',
        color: 'var(--dsw-alias-label-tertiary)',
      },
      // ── 模式标签（写入历史 / 每轮注入）──
      modeChip: (injectMode) => ({
        flex: '0 0 auto',
        padding: '1px 8px',
        borderRadius: 999,
        fontSize: 11,
        whiteSpace: 'nowrap',
        border: `1px solid ${injectMode ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-border-l2)'}`,
        color: injectMode ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-label-secondary)',
        background: 'transparent',
      }),
      dockSelect: {
        height: 24,
        padding: '0 6px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 12,
        maxWidth: 200,
      },
      dockName: {
        height: 24,
        boxSizing: 'border-box',
        width: 120,
        padding: '0 8px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 12,
      },
      dockStatus: (kind) => ({
        fontSize: 11,
        color:
          kind === 'error'
            ? 'var(--dsw-alias-state-warn-primary)'
            : kind === 'saved'
              ? 'var(--dsw-alias-brand-primary)'
              : 'var(--dsw-alias-label-tertiary)',
      }),
      // ── Q9：本轮闸门快照角标 ──
      gateWrap: { display: 'inline-flex', alignItems: 'center', gap: 6, flex: '0 0 auto' },
      badge: (state) => ({
        display: 'inline-flex',
        alignItems: 'center',
        height: 20,
        padding: '0 7px',
        borderRadius: 10,
        border: '1px solid var(--dsw-alias-border-l1)',
        background:
          state === 'pure' ? 'color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent)' : 'transparent',
        color: 'var(--dsw-alias-label-tertiary)',
        fontSize: 11,
        lineHeight: 1,
        whiteSpace: 'nowrap',
        flex: '0 0 auto',
      }),
    }

    /** 自绘开关（不 require 官方 Switch，P1）。 */
    function Toggle(props) {
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': props.on ? 'true' : 'false',
          'aria-label': props.label,
          style: S.track(props.on),
          onClick: props.onToggle,
        },
        h('span', { style: S.knob(props.on) }),
      )
    }

    function Field(props) {
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        h('span', { style: S.label }, props.label),
        h('input', {
          style: S.input,
          value: props.value,
          spellCheck: false,
          onChange: (event) => props.onChange(event.target.value),
        }),
      )
    }

    /** 设置页主体；`t` 由 slot 的 `locale: NS` 席位合成。 */
    function PrefillSection(props) {
      const t = props.t ?? ((key) => key)
      const [state, setState] = React.useState(null)
      // envelope（整封信）也留一份：清单（`injections.catalog`）在它上面，不在 `state` 上。
      const [envelope, setEnvelope] = React.useState(null)
      const [ping, setPing] = React.useState({ phase: 'idle' })
      const [note, setNote] = React.useState('')
      const [armedDraft, setArmedDraft] = React.useState('')
      const [allowDraft, setAllowDraft] = React.useState('')
      // 工具放行的草稿：`''` = 全部放行（null），`' '` = 一个都不给（[]）。
      const [toolsDraft, setToolsDraft] = React.useState('')

      const adopt = React.useCallback((next) => {
        setEnvelope(next)
        setState(next?.state ?? null)
        setArmedDraft((next?.state?.armed ?? []).join(' '))
        setAllowDraft((next?.state?.allowKinds ?? []).join(', '))
        const toolList = next?.state?.tools
        setToolsDraft(Array.isArray(toolList) ? (toolList.length === 0 ? ' ' : toolList.join(',')) : '')
      }, [])

      const call = React.useCallback(async (body) => {
        const response = await fetch(STATE_ROUTE, {
          method: 'POST',
          headers: body === undefined ? {} : { 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return await response.json()
      }, [])

      React.useEffect(() => {
        void call(undefined)
          .then((data) => {
            adopt(data)
            setPing({ phase: 'ok', data })
          })
          .catch((error) => setPing({ phase: 'error', message: String(error) }))
      }, [call, adopt])

      const mutate = React.useCallback(
        async (body) => {
          try {
            const data = await call(body)
            adopt(data)
            setNote(t('saved'))
          } catch (error) {
            setNote(`${t('saveFailed')}: ${String(error)}`)
          }
        },
        [call, adopt, t],
      )

      const splitList = (text) =>
        text
          .split(/[\s,]+/)
          .map((part) => part.trim())
          .filter((part) => part !== '')

      const hostTone = ping.phase === 'ok' ? 'ok' : ping.phase === 'error' ? 'fail' : undefined

      return h(
        'div',
        { style: S.page },
        h('div', { style: S.title }, t('title')),
        h('div', { style: S.intro }, t('intro')),

        h(
          'div',
          { style: S.card },
          h('div', { style: S.cardTitle }, t('cardTitle')),
          h('div', { style: S.group }, t('writeGroup')),
          ...LEVERS.filter((lever) => lever.tone === 'write').map((lever) =>
            h(
              'div',
              { key: lever.key, style: S.switchRow },
              h('span', null, t(lever.key)),
              h(Toggle, {
                on: state?.levers?.[lever.key] === true,
                label: t(lever.key),
                onToggle: () => void mutate({ levers: { [lever.key]: !(state?.levers?.[lever.key] === true) } }),
              }),
            ),
          ),
          h('div', { style: S.group }, t('blockGroup')),
          ...LEVERS.filter((lever) => lever.tone === 'block').map((lever) =>
            h(
              'div',
              { key: lever.key, style: S.switchRow },
              h('span', null, t(lever.key)),
              h(Toggle, {
                on: state?.levers?.[lever.key] === true,
                label: t(lever.key),
                onToggle: () => void mutate({ levers: { [lever.key]: !(state?.levers?.[lever.key] === true) } }),
              }),
            ),
          ),
        ),

        h(
          'div',
          { style: S.card },
          h(Field, {
            label: t('armedLabel'),
            value: armedDraft,
            onChange: setArmedDraft,
          }),
          h(
            'button',
            {
              type: 'button',
              style: S.button,
              onClick: () => void mutate({ armed: splitList(armedDraft) }),
            },
            t('applyArmed'),
          ),
          // 放行来源：**标签式**。来源 id（source.kind）本来就能从注入清单里直接扫出来，
          // 让人凭记忆手打一串逗号既容易错、也不知道有哪些可选。点标签 = 加入白名单，再点 = 移除。
          h('div', { style: S.note }, t('allowLabel')),
          h(
            'div',
            { style: S.chipRow },
            ...(envelope?.injections?.catalog?.messages ?? []).map((kind) =>
              h(
                'button',
                {
                  key: kind,
                  type: 'button',
                  style: S.chip(splitList(allowDraft).includes(kind)),
                  title: kind,
                  onClick: () => {
                    const current = splitList(allowDraft)
                    const next = current.includes(kind)
                      ? current.filter((entry) => entry !== kind)
                      : [...current, kind]
                    setAllowDraft(next.join(', '))
                    void mutate({ allowKinds: next })
                  },
                },
                kind,
              ),
            ),
            h('span', { style: S.chipStatic }, t('allowLocked')),
          ),
          // 工具放行（全局）：同样只管"能不能用"。
          h('div', { style: S.note }, t('toolsLabel')),
          h(
            'div',
            { style: S.chipRow },
            ...(envelope?.tools?.catalog ?? []).map((name) =>
              h(
                'button',
                {
                  key: `gtool-${name}`,
                  type: 'button',
                  style: S.chip(splitList(toolsDraft).includes(name)),
                  title: name,
                  onClick: () => {
                    const current = splitList(toolsDraft)
                    const next = current.includes(name)
                      ? current.filter((entry) => entry !== name)
                      : [...current, name]
                    setToolsDraft(next.join(','))
                    void mutate({ tools: next })
                  },
                },
                name,
              ),
            ),
            h(
              'button',
              {
                type: 'button',
                style: S.chip(toolsDraft === ''),
                onClick: () => {
                  setToolsDraft('')
                  void mutate({ tools: null })
                },
              },
              t('toolsAll'),
            ),
            h(
              'button',
              {
                type: 'button',
                style: S.chip(toolsDraft === ' '),
                onClick: () => {
                  setToolsDraft(' ')
                  void mutate({ tools: [] })
                },
              },
              t('toolsNone'),
            ),
          ),
          note === '' ? null : h('div', { style: S.note }, note),
        ),

        h(
          'div',
          { style: S.card },
          h('div', { style: S.cardTitle }, t('stateTitle')),
          h(
            'div',
            { style: S.switchRow },
            h('span', { style: S.label }, t('hostLabel')),
            h('span', null, hostTone === 'ok' ? t('reachable') : hostTone === 'fail' ? t('unreachable') : t('busy')),
          ),
          h(
            'div',
            { style: S.switchRow },
            h('span', { style: S.label }, t('routeLabel')),
            h('span', { style: { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 } }, STATE_ROUTE),
          ),
          ping.data?.stateFile === undefined
            ? null
            : h('div', { style: S.label }, `${t('stateFileLabel')}: ${ping.data.stateFile}`),
          h('pre', { style: S.pre }, JSON.stringify(state ?? ping.data?.state ?? null, null, 2)),
          (state?.armed?.length ?? 0) === 0
            ? h('div', { style: S.warn }, 'armed 为空 ⇒ 本插件此刻不干预任何会话（安全默认）。')
            : null,
        ),

        h('div', { style: S.note }, t('m1Note')),
      )
    }

    /**
     * 输入框内的「预填装」开关（M2 纠偏后新增）。
     *
     * 与「阻断注入」是**两个独立开关**（用户确认）：
     *   预填装   = 本会话是否使用预填装（进入预填装模式 → 预渲染填装内容）
     *   阻断注入 = 是否把 harness 的默认注入挡掉
     * 两者可自由组合。这里只负责状态；**预填装的对话内容 + 首轮物化成真实事件属 M3**。
     */
    function PrefillToggle(props) {
      const t = props.t ?? ((key) => key)
      const sessionId = typeof props.sessionId === 'string' ? props.sessionId : ''
      // 存**整封信**而不是 `data.state`：模式判定要 `turns`、注入状态要 `injects`，
      // 这两个都在 envelope 上（不在插件状态里）。
      const [envelope, setEnvelope] = React.useState(null)

      const call = React.useCallback(async (body) => {
        const response = await fetch(STATE_ROUTE, {
          method: 'POST',
          headers: body === undefined ? {} : { 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return await response.json()
      }, [])

      React.useEffect(() => {
        void call(undefined)
          .then((data) => setEnvelope(data))
          .catch(() => {})
      }, [call, sessionId])

      // ⚠️ 光在挂载时取一次是不够的：**跑完一轮**要自动改名（预填装 → 预注入），
      // 而"跑了一轮"这件事不会产生状态事件。所以照角标的做法轻量轮询（2.5s），
      // 外加插件内部状态事件用于即时刷新。
      React.useEffect(() => {
        const refresh = () => {
          void call(undefined)
            .then((data) => setEnvelope(data))
            .catch(() => {})
        }
        const timer = setInterval(refresh, 2500)
        window.addEventListener(STATE_EVENT, refresh)
        return () => {
          clearInterval(timer)
          window.removeEventListener(STATE_EVENT, refresh)
        }
      }, [call, sessionId])

      if (sessionId === '') return null
      const state = envelope?.state ?? null
      const map = state?.prefill !== null && typeof state?.prefill === 'object' ? state.prefill : {}
      const on = typeof map[sessionId] === 'string' && map[sessionId] !== ''
      // 会话开跑过就没有"写进历史"这条路了 ⇒ 同一颗键自动改叫「预注入」，并要求手动触发。
      const injected = (envelope?.injects?.[sessionId] ?? 0) > 0
      const injectMode = (envelope?.turns?.[sessionId] ?? 0) > 0
      const pending = injectMode && on && !injected
      const label = injectMode
        ? pending
          ? t('injectOn')
          : injected
            ? t('injectDone')
            : t('injectOff')
        : on
          ? t('prefillOn')
          : t('prefillOff')
      const title = injectMode
        ? on
          ? t('injectTitleOn')
          : t('injectTitleOff')
        : on
          ? t('prefillTitleOn')
          : t('prefillTitleOff')

      return h(
        'button',
        {
          type: 'button',
          'aria-pressed': on ? 'true' : 'false',
          title,
          // 待触发时用警示色描边：**不点「注入」就不会生效**，这个状态必须刺眼。
          style: pending
            ? { ...S.gatePill(on), borderColor: 'var(--dsw-alias-state-warn-primary)' }
            : S.gatePill(on),
          onClick: () => {
            void call({ prefill: { ...map, [sessionId]: on ? '' : 'default' } })
              .then((data) => {
                setEnvelope(data)
                notifyStateChanged()
              })
              .catch(() => {})
          },
        },
        h('span', { style: S.gateDot(on) }),
        label,
      )
    }

    /**
     * 输入框内的预注入开关（M2）。
     *
     * 会话 id 走**槽位下发的 `props.sessionId`** —— 官方 sentinel 由 composer 提供
     * （@dsh-external/dsh-prompt-optimizer 的注释原文："slot 的 sessionId 是权威来源"）。
     * 不用 `ctx.sessions`、不读 DOM、不碰 document.body（P9）。
     *
     * 状态读写走本插件自有路由，与设置页同一条通道 —— 因此"设成 ON"这件事
     * **不依赖任何 DOM 拦截**：它只写 `gate[sessionId]='pure'`，闸门在宿侧生效。
     */
    function GateToggle(props) {
      const t = props.t ?? ((key) => key)
      const sessionId = typeof props.sessionId === 'string' ? props.sessionId : ''
      const [envelope, setEnvelope] = React.useState(null)
      const [confirming, setConfirming] = React.useState(false)
      const state = envelope?.state ?? null

      const call = React.useCallback(async (body) => {
        const response = await fetch(STATE_ROUTE, {
          method: 'POST',
          headers: body === undefined ? {} : { 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return await response.json()
      }, [])

      const refresh = React.useCallback(() => {
        void call(undefined)
          .then((data) => setEnvelope(data))
          .catch(() => {})
      }, [call])

      // Q9 角标要显示**本轮**的生效快照，而快照是插件私有的宿主状态 ——
      // 没有推送通道，所以轻量轮询（2.5s，随组件卸载即停）。
      React.useEffect(() => {
        refresh()
        const timer = setInterval(refresh, 2500)
        return () => clearInterval(timer)
      }, [refresh, sessionId])

      if (sessionId === '') return null
      const gate = state?.gate !== null && typeof state?.gate === 'object' ? state.gate : {}
      const on = gate[sessionId] === 'pure'

      const write = (mode, markSeen) => {
        const patch = { gate: { ...gate, [sessionId]: mode } }
        if (markSeen === true) patch.noticeSeen = true
        void call(patch)
          .then((data) => setEnvelope(data))
          .catch(() => {})
      }

      // Q9：只在**首次**开启时弹一次说明，之后直接生效（不做每次提交前确认）。
      if (confirming) {
        return h(
          'div',
          { style: S.gateNotice },
          h('span', { style: S.gateNoticeTitle }, t('gateNoticeTitle')),
          h('span', { style: S.gateNoticeBody }, t('gateNoticeBody')),
          h(
            'button',
            {
              type: 'button',
              style: S.gateBtn,
              onClick: () => {
                setConfirming(false)
                write('pure', true)
              },
            },
            t('gateConfirm'),
          ),
          h('button', { type: 'button', style: S.gateBtn, onClick: () => setConfirming(false) }, t('gateCancel')),
        )
      }

      // Q9 角标：本轮生效的三态 + 被丢弃的 kind 计数（数据来自宿主 `snapshots`）。
      // ⚠️ 轮内翻开关**不会**影响正在跑的这一轮（Q18：本轮 levers 已冻结，重挂延后到
      // `agent/turn-stopping`）—— 所以当宿主报"该会话有待生效的重挂"时，角标必须明说，
      // 否则用户会以为"纯净没关掉工具"（实测踩过：轮内点纯净，本轮仍带工具跑到结束）。
      const snap = envelope?.snapshots?.[sessionId]
      const pending = Array.isArray(envelope?.pendingReprime) && envelope.pendingReprime.includes(sessionId)
      const dropped = Array.isArray(snap?.droppedKinds) ? snap.droppedKinds : []
      const badgeLabel =
        snap?.state === 'pure' ? t('statePure') : snap?.state === 'filter' ? t('stateFilter') : t('statePass')
      const badge =
        snap === undefined
          ? null
          : h(
              'span',
              {
                style: S.badge(snap.state),
                title: `${t('badgeTip')}\nturn ${String(snap.turn ?? '?')} · step ${String(snap.step ?? '?')}${
                  dropped.length > 0 ? `\ndropped: ${dropped.join(', ')}` : ''
                }`,
              },
              `${badgeLabel}${dropped.length > 0 ? ` · 丢${dropped.length}` : ''}${pending ? ` · ${t('nextTurn')}` : ''}`,
            )

      return h(
        'div',
        { style: S.gateWrap },
        h(
          'button',
          {
            type: 'button',
            'aria-pressed': on ? 'true' : 'false',
            title: on ? t('gateTitleOn') : t('gateTitleOff'),
            style: S.gatePill(on),
            onClick: () => {
              if (on) {
                write('pass')
                return
              }
              if (state?.noticeSeen === true) {
                write('pure', true)
                return
              }
              setConfirming(true)
            },
          },
          h('span', { style: S.gateDot(on) }),
          on ? t('gateOn') : t('gateOff'),
        ),
        badge,
      )
    }

    /**
     * 预填装草稿区（`conversation.input.dock` —— 输入框上方的会话级面板）。
     *
     * 编辑模型（用户定，§14.3）：
     *   items = 有序列表，每项 `{ role:'user'|'assistant', text, reasoning? }`
     *   · 思维链是 **AI 那一项里的一个字段**，不是单独一轮；
     *   · **不强制 user/ai 交替** —— 连续多条 user、连续多条 assistant 都合法。
     * 落盘规则由 host 侧负责（连续 user 同轮 / 每个 assistant 独占一轮 / 尾部 user 自开一轮），
     * 客户端只管"编辑 → debounce 推到 `POST /api/dsh-prefill/draft`"。
     *
     * 会话 id 来自**槽位下发的 `props.sessionId`**（`scope: 'session'` 的槽位由框架注入），
     * 不读 DOM、不碰 document.body（P9）；控件全部自绘（P1）。
     */
    function PrefillDock(props) {
      const t = props.t ?? ((key) => key)
      const sessionId = typeof props.sessionId === 'string' ? props.sessionId : ''
      const [items, setItems] = React.useState(null)
      const [enabled, setEnabled] = React.useState(false)
      const [status, setStatus] = React.useState('idle')
      const [revision, setRevision] = React.useState(0)
      // M4：包（按工作区存在 host 侧）
      const [packs, setPacks] = React.useState([])
      const [selected, setSelected] = React.useState('')
      const [packName, setPackName] = React.useState('')
      // 注入改写不再单独占一行：它是本面板里的一节（用户要求：放进预填装窗口、跟预设绑在一起）。
      const [injectOpen, setInjectOpen] = React.useState(false)
      // ⚠️ hooks 一律放**提前 return 之前**：放后面会随渲染次数变化 ⇒ React 直接抛错、
      // 整个面板白屏（这个坑踩过两次，记在 §14.19）。
      const [confirming, setConfirming] = React.useState('')
      const dirty = React.useRef(false)
      const staged = React.useRef(false)
      /** 导入文件用的隐藏 input（hook 必须在提前 return 之前）。 */
      const fileRef = React.useRef(null)

      /**
       * 让面板**真的长到上限**：dock 在宿主的 flex 列里是默认项（`flex: 0 1 auto`），
       * 内容一多它就被压扁 —— 实测 maxHeight 算出 803px，实际只渲染 462px。
       * 所以内容装不下时显式给一个 height；装得下就交回 auto（不来回抖）。
       */
      const listRef = React.useRef(null)
      const [panelHeight, setPanelHeight] = React.useState(undefined)
      React.useEffect(() => {
        const list = listRef.current
        if (!(list instanceof HTMLElement) || bounds?.maxHeight === undefined) return
        const panel = list.closest('[data-prefill-dock]')
        if (!(panel instanceof HTMLElement)) return
        const chrome = panel.clientHeight - list.clientHeight
        const needed = list.scrollHeight + chrome
        const target = needed >= bounds.maxHeight ? bounds.maxHeight : undefined
        setPanelHeight((current) => (current === target ? current : target))
      })

      /**
       * 面板尺寸跟着输入框走（用户要求：宽度一致；高度先自动伸展，快到顶部栏再内滚）：
       *   · 宽度 = 输入框那张**圆角卡片**的宽度（往上找第一个够宽且有圆角的自绘容器）
       *   · 高度上限 = 输入框上沿 − 顶栏下沿 ⇒ 内容短就自然撑开，长到接近顶栏才内滚
       * 只**读**别人的几何信息，不写 DOM（守 P9）。
       */
      const [bounds, setBounds] = React.useState(null)
      React.useEffect(() => {
        const measure = () => {
          const input = document.querySelector('[contenteditable="true"]')
          if (!(input instanceof HTMLElement)) return
          let width
          let node = input
          for (let depth = 0; depth < 8 && node instanceof HTMLElement; depth += 1) {
            const rect = node.getBoundingClientRect()
            const radius = Number.parseFloat(window.getComputedStyle(node).borderTopLeftRadius || '0')
            if (rect.width > 300 && Number.isFinite(radius) && radius > 4) {
              width = Math.round(rect.width)
              break
            }
            node = node.parentElement
          }
          const pane = document.querySelector('[data-conversation-session]')
          const ceiling = pane === null ? 56 : pane.getBoundingClientRect().top + 52
          setBounds({
            width,
            maxHeight: Math.max(220, Math.round(input.getBoundingClientRect().top - ceiling)),
          })
        }
        measure()
        window.addEventListener('resize', measure)
        const timer = setInterval(measure, 1200)
        return () => {
          window.removeEventListener('resize', measure)
          clearInterval(timer)
        }
      }, [])

      // 输入框里的开关翻动后广播 ⇒ 这里重读状态，草稿区立刻出现 / 消失。
      React.useEffect(() => {
        const onChanged = () => setRevision((value) => value + 1)
        window.addEventListener(STATE_EVENT, onChanged)
        return () => window.removeEventListener(STATE_EVENT, onChanged)
      }, [])

      const post = React.useCallback(async (path, body) => {
        const response = await fetch(path, {
          method: 'POST',
          headers: body === undefined ? {} : { 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return await response.json()
      }, [])

      React.useEffect(() => {
        if (sessionId === '') return undefined
        let alive = true
        void (async () => {
          try {
            const snapshot = await post(STATE_ROUTE, undefined)
            if (!alive) return
            const map = snapshot?.state?.prefill
            const on =
              map !== null && typeof map === 'object' && typeof map[sessionId] === 'string' && map[sessionId] !== ''
            setEnabled(on)
            if (!on) {
              setItems(null)
              return
            }
            const draft = await post(DRAFT_ROUTE, { sessionId })
            if (!alive) return
            setItems(Array.isArray(draft?.draft) ? draft.draft : [])
          } catch {
            if (alive) setStatus('error')
          }
        })()
        return () => {
          alive = false
        }
      }, [post, sessionId, revision])

      // 开关打开、host 还没有草稿 ⇒ 先登记一份空的：既声明"本会话启用预填装"，
      // 也让 host 顺手把系统提示**预热**好（物化时要用，见 §14.5 的两条硬约束）。
      React.useEffect(() => {
        if (!enabled || items === null || staged.current || sessionId === '') return
        staged.current = true
        if (items.length === 0) {
          void post(DRAFT_ROUTE, { sessionId, items: [] }).catch(() => setStatus('error'))
        }
      }, [enabled, items, post, sessionId])

      // ── M4：包 ────────────────────────────────────────────────────────────────
      const packsCall = React.useCallback(
        async (payload) => {
          const response = await fetch(PACKS_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId, ...payload }),
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          return await response.json()
        },
        [sessionId],
      )

      const refreshPacks = React.useCallback(() => {
        void packsCall({ op: 'list' })
          .then((data) => setPacks(Array.isArray(data?.packs) ? data.packs : []))
          .catch(() => setStatus('error'))
      }, [packsCall])

      React.useEffect(() => {
        if (enabled && sessionId !== '') refreshPacks()
      }, [enabled, refreshPacks, sessionId])

      // 模式判定：`turns[sessionId]` —— 首轮前 = 写入历史；会话已开跑 = 每轮注入。
      // 这不是偏好问题：首轮之后"写进历史"这条路被 F11/F12 关死了，继续显示
      // "将变成真实历史"就是在骗人，所以自动切换并**明写**当前模式。
      const [envelope, setEnvelope] = React.useState(null)
      const [injectStatus, setInjectStatus] = React.useState('idle')
      const refreshEnvelope = React.useCallback(() => {
        void post(STATE_ROUTE, undefined)
          .then((data) => setEnvelope(data))
          .catch(() => {
            // 拿不到就维持当前显示。
          })
      }, [])
      React.useEffect(() => {
        if (enabled && sessionId !== '') refreshEnvelope()
      }, [enabled, refreshEnvelope, sessionId])
      const turns = envelope?.turns?.[sessionId] ?? 0
      const injectCount = envelope?.injects?.[sessionId] ?? 0
      const injectMode = turns > 0

      const save = React.useCallback(
        (next) => {
          setStatus('saving')
          void post(DRAFT_ROUTE, { sessionId, items: next })
            .then(() => setStatus('saved'))
            .catch(() => setStatus('error'))
        },
        [post, sessionId],
      )

      // 编辑后 700ms 落盘（debounce）。
      React.useEffect(() => {
        if (!enabled || items === null || !dirty.current) return undefined
        const timer = setTimeout(() => {
          dirty.current = false
          save(items)
        }, 700)
        return () => clearTimeout(timer)
      }, [items, enabled, save])

      if (sessionId === '' || !enabled || items === null) return null

      const edit = (next) => {
        dirty.current = true
        setItems(next)
      }
      const patchAt = (index, patch) => edit(items.map((item, at) => (at === index ? { ...item, ...patch } : item)))
      const move = (index, delta) => {
        const target = index + delta
        if (target < 0 || target >= items.length) return
        const next = [...items]
        const [moved] = next.splice(index, 1)
        next.splice(target, 0, moved)
        edit(next)
      }

      const adoptPacks = (data) => {
        setPacks(Array.isArray(data?.packs) ? data.packs : [])
      }
      const loadPack = () => {
        if (selected === '') return
        void packsCall({ op: 'get', name: selected })
          .then(async (data) => {
            const next = Array.isArray(data?.pack?.items) ? data.pack.items : []
            edit(next)
            setPackName(selected)
            // 预设里的注入改写也一并套用（"跟预设绑在一起"）：先登记草稿，再落 state.json。
            const overrides = data?.pack?.overrides
            if (overrides !== undefined && overrides !== null) {
              injectionDrafts.set(sessionId, overrides)
              const fresh = await post(STATE_ROUTE, undefined)
              await post(STATE_ROUTE, {
                overrides: { ...(fresh?.state?.overrides ?? {}), [sessionId]: overrides },
              })
            }
          })
          .catch(() => setStatus('error'))
      }
      const savePack = () => {
        const name = (packName.trim() === '' ? selected : packName).trim()
        if (name === '') {
          setStatus('error')
          return
        }
        // 存预设 = 预填装内容 + 注入改写（用户要求绑在一起）。
        void currentOverrides()
          .then((overrides) => packsCall({ op: 'save', name, items, overrides }))
          .then((data) => {
            adoptPacks(data)
            setSelected(name)
            setStatus('saved')
          })
          .catch(() => setStatus('error'))
      }
      /**
       * 删除类动作统一用**两步确认**，不用 `window.confirm`：
       * 浏览器可以屏蔽反复弹的对话框（返回 false）⇒ 删除会**静默失败**，最坑。
       * 第一次点变成"确认？"，再点才真删；换别的操作就自动复位。
       */
      const armConfirm = (key) => {
        if (confirming === key) return true
        setConfirming(key)
        setTimeout(() => setConfirming((current) => (current === key ? '' : current)), 4000)
        return false
      }
      const deletePack = () => {
        if (selected === '') return
        if (!armConfirm('preset')) return
        setConfirming('')
        void packsCall({ op: 'delete', name: selected })
          .then((data) => {
            adoptPacks(data)
            setSelected('')
            setStatus('saved')
          })
          .catch(() => setStatus('error'))
      }
      // ── 导出 / 导入：**走文件**（用户要求），文件名 = 预设名 ──
      // 预设文件内容 = 完整预对话记录（items） + 预注入改写（overrides）。
      // ⚠️ fileRef 必须和其他 hook 一起放在**提前 return 之前**（hook 数量不能随渲染变化）。
      /**
       * 取本会话"当前生效的注入改写"。
       *
       * ⚠️ 必须**从宿主拉一次**，不能只读模块级的 `injectionDrafts`：那个表只有在
       * "注入改写"章节**被展开挂载过**才有内容 —— 否则用户没点开过它，
       * 导出的预设文件就会**悄悄丢掉改写**（实测踩到）。
       * 两边的都有时，以面板里正在编辑的草稿为准。
       */
      const currentOverrides = async () => {
        const fresh = injectionDraftOf(sessionId)
        try {
          const envelope = await post(STATE_ROUTE, undefined)
          const stored = envelope?.state?.overrides?.[sessionId] ?? {}
          return {
            messages: { ...(stored.messages ?? {}), ...(fresh.messages ?? {}) },
            sections: { ...(stored.sections ?? {}), ...(fresh.sections ?? {}) },
            contexts: { ...(stored.contexts ?? {}), ...(fresh.contexts ?? {}) },
          }
        } catch {
          return fresh
        }
      }

      /**
       * **一键注入**：把"当前内容 + 注入改写"写成**本会话配置**，不产生任何消息。
       *
       * 为什么不要"手输一句话触发"：注入是宿主侧配置，写完下一轮请求就带上了；拿一句
       * 废话当触发器会把那句废话永久留在历史里、还烧一次钱，也把"改配置"和"问正事"耦合了。
       */
      const oneClickInject = () => {
        setInjectStatus('idle')
        void currentOverrides()
          .then(async (overrides) => {
            const fresh = await post(STATE_ROUTE, undefined)
            const patch = {
              overrides: { ...(fresh?.state?.overrides ?? {}), [sessionId]: overrides },
            }
            // 只有"已开跑"的会话才写每轮注入；首轮前交给物化（那才是真的写入历史）。
            if (injectMode && items.length > 0) {
              patch.injects = { ...(fresh?.state?.injects ?? {}), [sessionId]: items }
            }
            await post(STATE_ROUTE, patch)
            setInjectStatus('done')
            refreshEnvelope()
          })
          .catch(() => setInjectStatus('error'))
      }

      const exportFile = async () => {
        const explicit = (packName.trim() === '' ? selected : packName).trim()
        const name = explicit === '' ? 'prefill' : explicit
        const payload = { version: 1, name, items, overrides: await currentOverrides() }
        const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        // 游离的 <a> 触发下载：不写别人的 DOM（守 P9）。
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = explicit === '' ? 'prefill.json' : `${name}.prefill.json`
        anchor.click()
        setTimeout(() => URL.revokeObjectURL(url), 4000)
        setStatus('saved')
      }
      const importFile = (event) => {
        const file = event?.target?.files?.[0]
        if (file === undefined) return
        const reader = new FileReader()
        reader.onload = () => {
          try {
            const parsed = JSON.parse(String(reader.result))
            const next = Array.isArray(parsed) ? parsed : parsed?.items
            if (Array.isArray(next)) edit(next)
            const overrides = parsed?.overrides
            if (overrides !== undefined && overrides !== null && typeof overrides === 'object') {
              injectionDrafts.set(sessionId, overrides)
              void post(STATE_ROUTE, undefined).then((fresh) =>
                post(STATE_ROUTE, {
                  overrides: { ...(fresh?.state?.overrides ?? {}), [sessionId]: overrides },
                }),
              )
            }
            if (typeof parsed?.name === 'string' && parsed.name !== '') setPackName(parsed.name)
            setStatus('saved')
          } catch {
            setStatus('error')
          }
        }
        reader.readAsText(file)
      }

      const statusKind = status === 'error' ? 'error' : status === 'saved' ? 'saved' : 'idle'
      const statusText =
        status === 'error' ? t('syncFailed') : status === 'saving' ? t('syncSaving') : status === 'saved' ? t('syncSaved') : t('syncIdle')

      return h(
        'div',
        {
          'data-prefill-dock': '1',
          style: {
            ...S.dock,
            width: bounds?.width === undefined ? '100%' : `${bounds.width}px`,
            maxWidth: '100%',
            maxHeight: bounds?.maxHeight === undefined ? '62vh' : `${bounds.maxHeight}px`,
            ...(panelHeight === undefined ? {} : { height: `${panelHeight}px` }),
            margin: '0 auto',
          },
        },
        h(
          'div',
          { style: S.dockHead },
          h('span', { style: S.dockTitle }, t('dockTitle')),
          h('span', { style: S.label }, `${items.length}${t('countSuffix')}`),
          h('span', { style: S.dockStatus(statusKind) }, statusText),
          // 模式标签：把"现在是写入历史还是每轮注入"明写出来（说明见 title）。
          h(
            'span',
            { style: S.modeChip(injectMode), title: injectMode ? t('modeInjectTip') : t('modeHistoryTip') },
            injectMode ? `${t('modeInject')}${injectCount > 0 ? ` · ${injectCount}` : ''}` : t('modeHistory'),
          ),
          // 一键注入：写成本会话配置，不产生任何消息。
          // 「待注入」时用警示色 + 加粗：**不点它就不会生效**，这个提示必须够显眼。
          h(
            'button',
            {
              type: 'button',
              style:
                injectMode && injectCount === 0 && items.length > 0
                  ? {
                      ...S.gateBtn,
                      borderColor: 'var(--dsw-alias-state-warn-primary)',
                      color: 'var(--dsw-alias-state-warn-primary)',
                      fontWeight: 600,
                    }
                  : S.gateBtn,
              title: t('injectNowTip'),
              onClick: oneClickInject,
            },
            t('injectNow'),
          ),
          injectStatus === 'idle'
            ? null
            : h(
                'span',
                { style: S.dockStatus(injectStatus === 'error' ? 'error' : 'saved') },
                injectStatus === 'error' ? t('injectFailed') : t('injectedNext'),
              ),
          h('span', { style: { flex: '1 1 auto' } }),
          h(
            'button',
            { type: 'button', style: S.gateBtn, onClick: () => edit([]) },
            t('dockClear'),
          ),
        ),
        // M4：包行 —— 选择 / 载入 / 存为 / 删除 / 导入导出
        h(
          'div',
          { style: S.dockHead },
          h('span', { style: S.label }, t('packs')),
          h(
            'select',
            { style: S.dockSelect, value: selected, onChange: (event) => setSelected(event.target.value) },
            h('option', { value: '' }, t('packsEmpty')),
            ...packs.map((pack) =>
              h('option', { key: pack.name, value: pack.name }, `${pack.name} (${pack.count})`),
            ),
          ),
          h('button', { type: 'button', style: S.gateBtn, onClick: loadPack }, t('loadPack')),
          h('input', {
            style: S.dockName,
            value: packName,
            placeholder: t('packNamePlaceholder'),
            spellCheck: false,
            onChange: (event) => setPackName(event.target.value),
          }),
          h('button', { type: 'button', style: S.gateBtn, onClick: savePack }, t('savePack')),
          // 两步确认：第一次点变"确认删除？"，再点才真删（避免误删，也避开被屏蔽的 window.confirm）。
          h(
            'button',
            {
              type: 'button',
              style: S.gateBtn,
              title: t('confirmDeletePreset'),
              onClick: deletePack,
              disabled: selected === '',
            },
            confirming === 'preset' ? t('confirmYes') : t('deletePack'),
          ),
          h('button', { type: 'button', style: S.gateBtn, onClick: exportFile }, t('exportFile')),
          h('button', { type: 'button', style: S.gateBtn, onClick: () => fileRef.current?.click() }, t('importFile')),
          h('input', {
            ref: fileRef,
            type: 'file',
            accept: '.json,application/json',
            style: { display: 'none' },
            onChange: importFile,
          }),
          h('span', { style: S.dockHint }, t('fileHint')),
        ),

        h('div', { style: S.dockHint }, injectMode ? t('modeInjectTip') : t('dockHint')),

        items.length === 0 ? h('div', { style: S.dockHint }, t('dockEmpty')) : null,

        // 内容列表自己滚：轮次多时只滚这一块，头部/预设行始终可见。
        h(
          'div',
          { ref: listRef, style: S.dockList },
          ...items.map((item, index) => {
            const isAssistant = item?.role === 'assistant'
          return h(
            'div',
            { key: index, style: S.dockRow },
            h(
              'button',
              {
                type: 'button',
                style: S.dockRole(isAssistant),
                title: isAssistant ? t('toUser') : t('toAssistant'),
                onClick: () =>
                  patchAt(
                    index,
                    isAssistant ? { role: 'user', reasoning: undefined } : { role: 'assistant', reasoning: '' },
                  ),
              },
              isAssistant ? t('roleAssistant') : t('roleUser'),
            ),
            h(
              'div',
              { style: S.dockBody },
              h('textarea', {
                style: S.dockText,
                value: item?.text ?? '',
                spellCheck: false,
                placeholder: isAssistant ? t('textAssistant') : t('textUser'),
                onChange: (event) => patchAt(index, { text: event.target.value }),
              }),
              // 思维链**只挂在 AI 那一项里**（用户定的模型）。
              isAssistant
                ? h('textarea', {
                    style: S.dockThink,
                    value: item?.reasoning ?? '',
                    spellCheck: false,
                    placeholder: t('reasoning'),
                    onChange: (event) => patchAt(index, { reasoning: event.target.value }),
                  })
                : null,
            ),
            h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
              h('button', { type: 'button', style: S.dockMini, title: t('moveUp'), onClick: () => move(index, -1) }, '↑'),
              h(
                'button',
                { type: 'button', style: S.dockMini, title: t('moveDown'), onClick: () => move(index, 1) },
                '↓',
              ),
              h(
                'button',
                {
                  type: 'button',
                  style: S.dockMini,
                  title: t('removeItem'),
                  onClick: () => edit(items.filter((_unused, at) => at !== index)),
                },
                '✕',
              ),
            ),
          )
          }),
        ),

        h(
          'div',
          { style: { display: 'flex', gap: 8 } },
          h(
            'button',
            { type: 'button', style: S.gateBtn, onClick: () => edit([...items, { role: 'user', text: '' }]) },
            t('addUser'),
          ),
          h(
            'button',
            {
              type: 'button',
              style: S.gateBtn,
              onClick: () => edit([...items, { role: 'assistant', reasoning: '', text: '' }]),
            },
            t('addAssistant'),
          ),
        ),

        // 注入改写：**本面板里的一节**（不是常驻横条），和预设一起存/取。
        h(
          'div',
          { style: S.dockHead },
          h(
            'button',
            { type: 'button', style: S.gateBtn, onClick: () => setInjectOpen(!injectOpen) },
            `${injectOpen ? '▾' : '▸'} ${t('injectTitle')}`,
          ),
          h('span', { style: S.injectHintText }, t('injectHint')),
        ),
        injectOpen ? h(InjectionSection, { t, sessionId }) : null,
      )
    }

    /**
     * 预填装面板里的**注入改写**一节（Q17）：改写 harness 默认注入的内容，只在本会话生效。
     *
     * 它是"预填装窗口"的一部分（用户要求：放进预填装窗口、跟预设绑在一起）——
     * 所以**没有自己的折叠条**：是否展开由外层的预填装面板决定；它的当前草稿会登记到
     * 模块级的 `injectionDrafts`，供预设一并存/取。
     *
     * 清单来自宿主 `envelope.injections`：`catalog`（全局 prompt 层的真实注册名 + 已知 kind）
     * ∪ 本会话已发现 ∪ 手加 ∪ 已有改写的键 ⇒ **某条注入还没出现过也能先改**（命中即生效）。
     */
    function InjectionSection(props) {
      const t = props.t ?? ((key) => key)
      const sessionId = typeof props.sessionId === 'string' ? props.sessionId : ''
      const onCount = props.onCount
      const [envelope, setEnvelope] = React.useState(null)
      const [draft, setDraft] = React.useState(null)
      const [status, setStatus] = React.useState('idle')
      const [custom, setCustom] = React.useState({ messages: [], sections: [], contexts: [] })
      const [addGroup, setAddGroup] = React.useState('sections')
      const [addName, setAddName] = React.useState('')
      // 同上：hooks 必须在提前 return 之前。
      const [confirmClear, setConfirmClear] = React.useState(false)
      const dirty = React.useRef(false)

      const call = React.useCallback(async (body) => {
        const response = await fetch(STATE_ROUTE, {
          method: 'POST',
          headers: body === undefined ? {} : { 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return await response.json()
      }, [])

      React.useEffect(() => {
        if (sessionId === '') return undefined
        let alive = true
        void call(undefined)
          .then((data) => {
            if (!alive) return
            setEnvelope(data)
            const current = data?.state?.overrides?.[sessionId] ?? {}
            setDraft({
              messages: { ...(current.messages ?? {}) },
              sections: { ...(current.sections ?? {}) },
              contexts: { ...(current.contexts ?? {}) },
            })
          })
          .catch(() => {
            if (alive) setStatus('error')
          })
        return () => {
          alive = false
        }
      }, [call, sessionId])

      // 把当前草稿登记到模块级表：预设存/取时要用它（"跟预设绑在一起"）。
      React.useEffect(() => {
        if (sessionId !== '' && draft !== null) injectionDrafts.set(sessionId, draft)
      }, [draft, sessionId])

      // 改完 800ms 落盘（写 state.json 的 overrides）。
      React.useEffect(() => {
        if (draft === null || !dirty.current) return undefined
        const timer = setTimeout(() => {
          dirty.current = false
          setStatus('saving')
          void call({ overrides: { ...(envelope?.state?.overrides ?? {}), [sessionId]: draft } })
            .then((data) => {
              setEnvelope(data)
              setStatus('saved')
            })
            .catch(() => setStatus('error'))
        }, 800)
        return () => clearTimeout(timer)
      }, [call, draft, envelope, sessionId])

      if (sessionId === '') return null
      // 清单 = 预置 catalog ∪ 本会话已发现 ∪ 手加的 ∪ 已有改写的键。
      // 有预置 catalog，用户就能在"某条注入还没出现过"时先写好改写 —— 命中即生效（直接劫持）。
      const catalog = envelope?.injections?.catalog ?? {}
      const discovered = envelope?.injections?.sessions?.[sessionId] ?? {}
      const merge = (...lists) => {
        const out = []
        for (const list of lists) {
          for (const name of list ?? []) {
            if (typeof name !== 'string' || name === '') continue
            if (!out.includes(name)) out.push(name)
          }
        }
        return out
      }
      const groups = [
        {
          key: 'messages',
          label: t('injectMessages'),
          names: merge(catalog.messages, discovered.messages, custom.messages, Object.keys(draft?.messages ?? {})),
        },
        {
          key: 'sections',
          label: t('injectSections'),
          names: merge(catalog.sections, discovered.sections, custom.sections, Object.keys(draft?.sections ?? {})),
        },
        {
          key: 'contexts',
          label: t('injectContexts'),
          names: merge(catalog.contexts, discovered.contexts, custom.contexts, Object.keys(draft?.contexts ?? {})),
        },
      ]
      const count = groups.reduce((sum, group) => sum + group.names.length, 0)

      const setField = (group, name, value) => {
        if (draft === null) return
        dirty.current = true
        const next = { ...draft, [group]: { ...draft[group] } }
        if (value === '') delete next[group][name]
        else next[group][name] = value
        setDraft(next)
      }

      // ── 本会话白名单（放行来源）────────────────────────────────────────────
      // 与设置页那张全局表分开：这里是**会话级**的，只影响本会话。
      const globalAllow = Array.isArray(envelope?.state?.allowKinds) ? envelope.state.allowKinds : ['user']
      const sessionAllowRaw = envelope?.state?.sessionAllowKinds?.[sessionId]
      const sessionAllow = Array.isArray(sessionAllowRaw) ? sessionAllowRaw : globalAllow
      const inheritsGlobal = !Array.isArray(sessionAllowRaw)
      const toggleAllow = (kind) => {
        const current = sessionAllow.filter((entry) => entry !== 'user')
        const next = current.includes(kind) ? current.filter((entry) => entry !== kind) : [...current, kind]
        void call({ sessionAllowKinds: { ...(envelope?.state?.sessionAllowKinds ?? {}), [sessionId]: next } })
          .then((data) => setEnvelope(data))
          .catch(() => setStatus('error'))
      }

      // ── 工具放行（只管能不能用，不改工具说明）──────────────────────────────
      const toolCatalog = envelope?.tools?.catalog ?? []
      const toolsRaw = envelope?.state?.sessionTools?.[sessionId]
      const toolsValue = Array.isArray(toolsRaw) ? toolsRaw : null // null = 全部放行
      const writeTools = (list) => {
        void call({ sessionTools: { ...(envelope?.state?.sessionTools ?? {}), [sessionId]: list } })
          .then((data) => setEnvelope(data))
          .catch(() => setStatus('error'))
      }
      const toggleTool = (name) => {
        // 从"全部放行"点某一条 ⇒ 变成"除了它都放行"，直觉上更符合"取消这个工具"。
        const current = Array.isArray(toolsValue) ? toolsValue : toolCatalog
        const next = current.includes(name) ? current.filter((entry) => entry !== name) : [...current, name]
        writeTools(next)
      }

      /** 清除本会话的注入配置（改写 / 每轮注入内容 / 独立白名单 / 工具放行）——删除功能之一。 */
      const clearSessionConfig = () => {
        // 同样两步确认（不用 window.confirm：可能被屏蔽 ⇒ 静默失败）。
        if (!confirmClear) {
          setConfirmClear(true)
          setTimeout(() => setConfirmClear(false), 4000)
          return
        }
        setConfirmClear(false)
        void call(undefined)
          .then((env) => {
            const overrides = { ...(env?.state?.overrides ?? {}) }
            const injects = { ...(env?.state?.injects ?? {}) }
            const sessionAllowKinds = { ...(env?.state?.sessionAllowKinds ?? {}) }
            const sessionTools = { ...(env?.state?.sessionTools ?? {}) }
            delete overrides[sessionId]
            delete injects[sessionId]
            delete sessionAllowKinds[sessionId]
            delete sessionTools[sessionId]
            return call({ overrides, injects, sessionAllowKinds, sessionTools })
          })
          .then((data) => {
            setEnvelope(data)
            setDraft({ messages: {}, sections: {}, contexts: {} })
            injectionDrafts.delete(sessionId)
            setStatus('saved')
          })
          .catch(() => setStatus('error'))
      }

      // 后台若是旧壳（返回的形状里没有 catalog），明说一句，别让用户以为是空清单。
      const staleHost = envelope?.injections !== undefined && envelope.injections.catalog === undefined
      const statusLine =
        status === 'idle'
          ? null
          : h(
              'span',
              { style: S.dockStatus(status === 'error' ? 'error' : status === 'saved' ? 'saved' : 'idle') },
              status === 'error' ? t('injectFailed') : status === 'saving' ? t('syncSaving') : t('injectSaved'),
            )
      const addRow = h(
        'div',
        { style: S.injectAddRow },
        h('span', { style: S.injectAddLabel }, t('injectAddLabel')),
        h(
          'select',
          { style: S.dockSelect, value: addGroup, onChange: (event) => setAddGroup(event.target.value) },
          h('option', { value: 'messages' }, t('injectMessages')),
          h('option', { value: 'sections' }, t('injectSections')),
          h('option', { value: 'contexts' }, t('injectContexts')),
        ),
        // 名字控件 = **可选的下拉（datalist）**，手输只是兜底。
        h('input', {
          list: `prefill-inject-names-${addGroup}`,
          style: S.dockName,
          value: addName,
          placeholder: t('injectAddPick'),
          spellCheck: false,
          onChange: (event) => setAddName(event.target.value),
        }),
        h(
          'datalist',
          { id: `prefill-inject-names-${addGroup}` },
          ...(groups.find((group) => group.key === addGroup)?.names ?? []).map((name) =>
            h('option', { key: name, value: name }),
          ),
        ),
        h(
          'button',
          {
            type: 'button',
            style: S.gateBtn,
            onClick: () => {
              const name = addName.trim()
              if (name === '') return
              setCustom((current) => ({ ...current, [addGroup]: [...(current[addGroup] ?? []), name] }))
              setAddName('')
            },
          },
          t('injectAdd'),
        ),
      )

      return h(
        'div',
        { style: S.injectCard },
        h(
          'div',
          { style: S.injectHead },
          h('span', { style: S.injectTitleText }, t('injectTitle')),
          h('span', { style: S.label }, `${count}`),
          h('span', { style: S.injectHintText }, t('injectHint')),
          h('span', { style: { flex: '1 1 auto' } }),
          (envelope?.injections?.catalog?.ignored ?? []).length > 0
            ? h('span', { style: S.injectHintText }, t('injectIgnored'))
            : null,
          staleHost ? h('span', { style: S.injectStale }, t('injectStaleHost')) : null,
          statusLine,
          // 删除功能：一键清掉本会话的注入配置（改写 / 每轮注入 / 独立白名单）。
          h(
            'button',
            { type: 'button', style: S.gateBtn, title: t('sessionClearTip'), onClick: clearSessionConfig },
            confirmClear ? t('confirmYes') : t('sessionClear'),
          ),
        ),
        h(
          'div',
          { style: S.injectBody },
          count === 0 ? h('div', { style: S.injectGroupHead }, t('injectNone')) : null,
          // 本会话白名单：点标签即生效（会话级，不动全局那张表）。
          h(
            'div',
            { style: S.injectGroupHead },
            h('span', null, t('allowSessionLabel')),
            inheritsGlobal ? h('span', { style: S.chipStatic }, `${t('allowSessionInherit')}：${globalAllow.join(', ')}`) : null,
            h('span', { style: S.injectRule }),
          ),
          h(
            'div',
            { style: S.chipRow },
            ...(catalog.messages ?? []).map((kind) =>
              h(
                'button',
                {
                  key: `allow-${kind}`,
                  type: 'button',
                  style: S.chip(sessionAllow.includes(kind)),
                  title: kind,
                  onClick: () => toggleAllow(kind),
                },
                kind,
              ),
            ),
            h('span', { style: S.chipStatic }, t('allowLocked')),
          ),
          // 工具放行：**不改工具说明**（工具类注入一律忽略），这里只管"能不能用"。
          h(
            'div',
            { style: S.injectGroupHead },
            h('span', null, t('toolsSessionLabel')),
            h(
              'span',
              { style: S.chipStatic },
              toolCatalog.length === 0
                ? t('toolsEmpty')
                : toolsValue === null
                  ? t('toolsAll')
                  : `${toolsValue.length}/${toolCatalog.length}`,
            ),
            h('span', { style: S.injectRule }),
          ),
          h(
            'div',
            { style: S.chipRow },
            h(
              'button',
              { type: 'button', style: S.chip(toolsValue === null), onClick: () => writeTools(null) },
              t('toolsAll'),
            ),
            ...toolCatalog.map((name) =>
              h(
                'button',
                {
                  key: `tool-${name}`,
                  type: 'button',
                  style: S.chip(Array.isArray(toolsValue) && toolsValue.includes(name)),
                  title: name,
                  onClick: () => toggleTool(name),
                },
                name,
              ),
            ),
            h(
              'button',
              {
                type: 'button',
                style: S.chip(Array.isArray(toolsValue) && toolsValue.length === 0),
                onClick: () => writeTools([]),
              },
              t('toolsNone'),
            ),
          ),
          ...groups.map((group) =>
            h(
              'div',
              { key: `g-${group.key}` },
              h(
                'div',
                { style: S.injectGroupHead },
                h('span', null, group.label),
                h('span', { style: S.label }, String(group.names.length)),
                h('span', { style: S.injectRule }),
              ),
              h(
                'div',
                { style: S.injectRows },
                ...group.names.map((name) =>
                  h(
                    'div',
                    { key: `${group.key}-${name}`, style: S.injectRow },
                    h('span', { style: S.injectKey, title: name }, name),
                    h('textarea', {
                      style: S.injectBox,
                      value: draft?.[group.key]?.[name] ?? '',
                      spellCheck: false,
                      onChange: (event) => setField(group.key, name, event.target.value),
                    }),
                  ),
                ),
              ),
            ),
          ),
        ),
        addRow,
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-prefill: copy dictionaries')

        const t = ctx.locale.bind(NS)

        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'prefill',
              order: 95,
              label: () => t('nav'),
              locale: NS,
            },
            PrefillSection,
          ),
        )

        // 两个独立开关（用户确认）：预填装 / 阻断注入。
        ctx.slots.inject('conversation.input.left', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.left',
              id: 'prefill-pack',
              order: 14,
              locale: NS,
            },
            PrefillToggle,
          ),
        )

        // M2 的主交付：输入框左侧工具行里的预注入开关（规划 §3.6）。
        ctx.slots.inject('conversation.input.left', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.left',
              id: 'prefill-gate',
              order: 15,
              locale: NS,
            },
            GateToggle,
          ),
        )

        // M3 主交付：输入框**上方**的预填装草稿区（会话级常驻面板）。
        // 只有该会话的「预填装」开关打开时才渲染；编辑内容 debounce 后推到 host。
        ctx.slots.inject('conversation.input.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.dock',
              id: 'prefill-draft',
              order: 20,
              locale: NS,
            },
            PrefillDock,
          ),
        )
        // Q17 的注入改写不再是独立槽位：它是预填装面板里的一节（见 InjectionSection）。
      },
    }
  },
})
