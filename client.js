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

    /**
     * 图标：Lucide（https://lucide.dev，ISC 许可，见 THIRD_PARTY_NOTICES.md）。
     * 只内联用到的几个，按名字取；没有对应图标时回落到 emoji 文本（兼容旧的文件预设）。
     */
    const ICONS = {"bot":[["path",{"d":"M12 8V4H8"}],["rect",{"width":"16","height":"12","x":"4","y":"8","rx":"2"}],["path",{"d":"M2 14h2"}],["path",{"d":"M20 14h2"}],["path",{"d":"M15 13v2"}],["path",{"d":"M9 13v2"}]],"castle":[["path",{"d":"M10 5V3"}],["path",{"d":"M14 5V3"}],["path",{"d":"M15 21v-3a3 3 0 0 0-6 0v3"}],["path",{"d":"M18 3v8"}],["path",{"d":"M18 5H6"}],["path",{"d":"M22 11H2"}],["path",{"d":"M22 9v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9"}],["path",{"d":"M6 3v8"}]],"cat":[["path",{"d":"M12 5c.67 0 1.35.09 2 .26 1.78-2 5.03-2.84 6.42-2.26 1.4.58-.42 7-.42 7 .57 1.07 1 2.24 1 3.44C21 17.9 16.97 21 12 21s-9-3-9-7.56c0-1.25.5-2.4 1-3.44 0 0-1.89-6.42-.5-7 1.39-.58 4.72.23 6.5 2.23A9.04 9.04 0 0 1 12 5Z"}],["path",{"d":"M8 14v.5"}],["path",{"d":"M16 14v.5"}],["path",{"d":"M11.25 16.25h1.5L12 17l-.75-.75Z"}]],"contact":[["path",{"d":"M16 2v2"}],["path",{"d":"M7 21v-2a2 2 0 012-2h6a2 2 0 012 2v2"}],["path",{"d":"M8 2v2"}],["circle",{"cx":"12","cy":"10","r":"3"}],["rect",{"x":"3","y":"3","width":"18","height":"18","rx":"2"}]],"download":[["path",{"d":"M12 15V3"}],["path",{"d":"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"}],["path",{"d":"m7 10 5 5 5-5"}]],"drama":[["path",{"d":"M10 11h.01"}],["path",{"d":"M14 6h.01"}],["path",{"d":"M18 6h.01"}],["path",{"d":"M6.5 13.1h.01"}],["path",{"d":"M22 5c0 9-4 12-6 12s-6-3-6-12c0-2 2-3 6-3s6 1 6 3"}],["path",{"d":"M17.4 9.9c-.8.8-2 .8-2.8 0"}],["path",{"d":"M10.1 7.1C9 7.2 7.7 7.7 6 8.6c-3.5 2-4.7 3.9-3.7 5.6 4.5 7.8 9.5 8.4 11.2 7.4.9-.5 1.9-2.1 1.9-4.7"}],["path",{"d":"M9.1 16.5c.3-1.1 1.4-1.7 2.4-1.4"}]],"eraser":[["path",{"d":"M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21"}],["path",{"d":"m5.082 11.09 8.828 8.828"}]],"flame":[["path",{"d":"M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4"}]],"flower-2":[["path",{"d":"M12 5a3 3 0 1 1 3 3m-3-3a3 3 0 1 0-3 3m3-3v1M9 8a3 3 0 1 0 3 3M9 8h1m5 0a3 3 0 1 1-3 3m3-3h-1m-2 3v-1"}],["circle",{"cx":"12","cy":"8","r":"2"}],["path",{"d":"M12 10v12"}],["path",{"d":"M12 22c4.2 0 7-1.667 7-5-4.2 0-7 1.667-7 5Z"}],["path",{"d":"M12 22c-4.2 0-7-1.667-7-5 4.2 0 7 1.667 7 5Z"}]],"folder":[["path",{"d":"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"}]],"image":[["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2","ry":"2"}],["circle",{"cx":"9","cy":"9","r":"2"}],["path",{"d":"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"}]],"languages":[["path",{"d":"m5 8 6 6"}],["path",{"d":"m4 14 6-6 2-3"}],["path",{"d":"M2 5h12"}],["path",{"d":"M7 2h1"}],["path",{"d":"m22 22-5-10-5 10"}],["path",{"d":"M14 18h6"}]],"layout-list":[["rect",{"width":"7","height":"7","x":"3","y":"3","rx":"1"}],["rect",{"width":"7","height":"7","x":"3","y":"14","rx":"1"}],["path",{"d":"M14 4h7"}],["path",{"d":"M14 9h7"}],["path",{"d":"M14 15h7"}],["path",{"d":"M14 20h7"}]],"message-circle-question":[["path",{"d":"M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"}],["path",{"d":"M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"}],["path",{"d":"M12 17h.01"}]],"message-circle":[["path",{"d":"M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"}]],"paw-print":[["circle",{"cx":"11","cy":"4","r":"2"}],["circle",{"cx":"18","cy":"8","r":"2"}],["circle",{"cx":"20","cy":"16","r":"2"}],["path",{"d":"M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"}]],"pen-line":[["path",{"d":"M13 21h8"}],["path",{"d":"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"}]],"play":[["path",{"d":"M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"}]],"puzzle":[["path",{"d":"M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z"}]],"scan-search":[["path",{"d":"M3 7V5a2 2 0 0 1 2-2h2"}],["path",{"d":"M17 3h2a2 2 0 0 1 2 2v2"}],["path",{"d":"M21 17v2a2 2 0 0 1-2 2h-2"}],["path",{"d":"M7 21H5a2 2 0 0 1-2-2v-2"}],["circle",{"cx":"12","cy":"12","r":"3"}],["path",{"d":"m16 16-1.9-1.9"}]],"scroll-text":[["path",{"d":"M15 12h-5"}],["path",{"d":"M15 8h-5"}],["path",{"d":"M19 17V5a2 2 0 0 0-2-2H4"}],["path",{"d":"M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"}]],"scissors":[["circle",{"cx":"6","cy":"6","r":"3"}],["path",{"d":"M8.12 8.12 12 12"}],["path",{"d":"M20 4 8.12 15.88"}],["circle",{"cx":"6","cy":"18","r":"3"}],["path",{"d":"M14.8 14.8 20 20"}]],"sword":[["path",{"d":"m11 19-6-6"}],["path",{"d":"m5 21-2-2"}],["path",{"d":"m8 16-4 4"}],["path",{"d":"M9.5 17.5 20.414 6.586A2 2 0 0021 5.172V3h-2.172a2 2 0 00-1.414.586L6.5 14.5"}]],"trash-2":[["path",{"d":"M10 11v6"}],["path",{"d":"M14 11v6"}],["path",{"d":"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"}],["path",{"d":"M3 6h18"}],["path",{"d":"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"}]],"upload":[["path",{"d":"M12 3v12"}],["path",{"d":"m17 8-5-5-5 5"}],["path",{"d":"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"}]],"user":[["path",{"d":"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"}],["circle",{"cx":"12","cy":"7","r":"4"}]],"wrench":[["path",{"d":"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"}]],"x":[["path",{"d":"M18 6 6 18"}],["path",{"d":"m6 6 12 12"}]]}
    /** 有正文的条目数：空行（点了加行没填）发送时会被跳过，不算进「N 条」（issue #1）。 */
    function countFilled(items) {
      return Array.isArray(items) ? items.filter((item) => typeof item?.text === 'string' && item.text.trim() !== '').length : 0
    }

    function Icon({ name, size = 14 }) {
      const shape = ICONS[name]
      if (shape === undefined) return null
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          style: { display: 'inline-block', verticalAlign: '-2px', flex: 'none' },
        },
        ...shape.map(([tag, attrs], index) => h(tag, { key: index, ...attrs })),
      )
    }
    /** 预设前面的小图标：有 icon 用图标，否则用旧的 emoji 文本。 */
    function glyph(preset, size = 14) {
      if (preset?.icon && ICONS[preset.icon]) return h(Icon, { name: preset.icon, size })
      return preset?.emoji ? h('span', { style: { fontSize: size, lineHeight: 1 } }, preset.emoji) : null
    }
    /** 图标 + 文字，横排。 */
    function withIcon(name, text, size = 14) {
      return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } }, h(Icon, { name, size }), text)
    }

    /** 本插件独占的 locale 命名空间。 */
    const NS = 'dsh-prefill'

    /** 自有路由。 */
    const PING_ROUTE = '/api/dsh-prefill/ping'
    const STATE_ROUTE = '/api/dsh-prefill/state'
    /** 草稿路由：读/写本会话的多轮 items（发送前可编辑的载体）。 */
    const DRAFT_ROUTE = '/api/dsh-prefill/draft'
    /** 包路由：预填装包按工作区存取（M4）。 */
    const PACKS_ROUTE = '/api/dsh-prefill/packs'
    /** 角色卡路由（v0.6 角色扮演扩展）。 */
    const CARDS_ROUTE = '/api/dsh-prefill/cards'
    const MEMORY_ROUTE = '/api/dsh-prefill/memory'

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

    /** 内置「纯净模式」预设的名字（不是文件里的预设，套用时写闸门配置）。 */
    const BUILTIN_PURE = '纯净模式'

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

    /**
     * 注入来源的说明（中/英）——"中文友好"：光看 `runtime-context` 这种 id 不知道是什么。
     *
     * 按当前语言挑一份：用一个已知 key 反查即可，不依赖 `t` 能否返回非字符串。
     */
    const INJECTION_DOCS = {
      zh: {
        'runtime-context': '运行时上下文：每轮由 harness 生成的当前环境信息（工作目录、时间、沙箱等）',
        'skill-catalog': '技能清单：可用 skill 的名字与一句说明',
        'agent-instructions': 'Agent 说明：当前 agent 预设 / 人设的补充说明',
        'time-context': '时间上下文：当前日期与时间',
        'session-reference': '会话引用：被 @ 提到的会话内容',
        'tmux-context': '终端上下文：tmux 会话状态',
        'model-notice': '模型提示：当前模型与能力说明',
        'compact-checkpoint': '压缩检查点：上下文被压缩后的摘要',
        'harness:identity': '身份段：模型是谁、基本行为准则（通常是最前面一段）',
        'harness:source': '源码位置：harness 的代码在哪里',
        'deployment:persona-prefix': '人设前缀：拼在身份段之前',
        'deployment:persona-suffix': '人设后缀：拼在身份段之后',
        'app:web-surface': '界面能力：Web 端能做什么',
        'ui:deliverable-file-references': '交付文件：怎么引用产出的文件',
        'mcp-resource-servers': 'MCP 资源服务器：外接工具服务的清单',
        'sandbox:policy': '沙箱策略：命令能在什么范围内跑',
        'approval:policy': '审批策略：哪些操作需要用户点头',
        __tool: '工具说明：这个工具怎么用。**改说明不影响调用格式**（参数 schema 不在这里），但删干净模型就不知道有这个工具',
        __custom: '自定义来源（原文见右框）',
        __empty: '留空 / 改回原文 = 不修改',
      },
      en: {
        'runtime-context': 'Runtime context: environment info the harness generates each turn (cwd, time, sandbox…)',
        'skill-catalog': 'Skill catalog: available skills and one-line descriptions',
        'agent-instructions': 'Agent instructions: extra notes for the current agent preset/persona',
        'time-context': 'Time context: current date and time',
        'session-reference': 'Session reference: content of sessions you @-mentioned',
        'tmux-context': 'Terminal context: tmux session state',
        'model-notice': 'Model notice: current model and capability notes',
        'compact-checkpoint': 'Compact checkpoint: summary after context compaction',
        'harness:identity': 'Identity: who the model is and its basic rules (usually the first section)',
        'harness:source': 'Source location: where the harness code lives',
        'deployment:persona-prefix': 'Persona prefix: prepended to the identity section',
        'deployment:persona-suffix': 'Persona suffix: appended to the identity section',
        'app:web-surface': 'Web surface: what the web UI can do',
        'ui:deliverable-file-references': 'Deliverable files: how to reference produced files',
        'mcp-resource-servers': 'MCP resource servers: external tool services',
        'sandbox:policy': 'Sandbox policy: where commands may run',
        'approval:policy': 'Approval policy: which actions need user confirmation',
        __tool: 'Tool description: how to use this tool. Editing it does NOT change the call format (the parameter schema lives elsewhere), but deleting it hides the tool from the model',
        __custom: 'Custom source (see the box on the right)',
        __empty: 'empty or unchanged = leave it alone',
      },
    }

    /** 当前语言的那份说明。 */
    function docsFor(t) {
      return t('dockTitle') === '预填装内容' ? INJECTION_DOCS.zh : INJECTION_DOCS.en
    }

    /** 名字像不像"工具说明"（只影响标注，不影响能不能改）。 */
    function looksLikeTool(name) {
      return typeof name === 'string' && /^(tool|tools|mcp)/i.test(name)
    }

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
      // ── 内置「纯净模式」预设（接管 pure preset 的语义）──
      purePresetName: '纯净模式（内置，接管 pure preset）',
      pureApplied: '纯净模式已生效',
      purePresetTip:
        '一键把本会话切到纯净态：清空系统提示与运行时上下文、不给工具、丢掉除你自己以外的注入。pure preset 已不再需要。',
      // ── 与其他插件的冲突 ──
      conflictTitle: '检测到注入冲突',
      conflictCompleteSection: '有插件占用了 complete 段（纯净态），已自动退化为逐名清空',
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
      emptyRowsSkipped: '（%N 条空的，发送时跳过）',
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
      stateReplace: '系统提示已替换',
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
      injectToolHint: '工具说明也可改：不影响调用格式（schema 不在这里），但别删干净',
      injectOriginalHint: '框里显示的是**当前原文**；改动即覆盖，改回原文 / 留空 = 不修改',
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
      // ── built-in "pure mode" preset (takes over the pure preset semantics) ──
      purePresetName: 'Pure mode (built-in; replaces the pure preset)',
      pureApplied: 'Pure mode active',
      purePresetTip:
        'Switches this session to pure: empty system prompt, no runtime context, no tools, only your own words pass. The pure preset is no longer needed.',
      // ── conflicts with other plugins ──
      conflictTitle: 'Injection conflict detected',
      conflictCompleteSection: 'another plugin occupies the complete section (pure state); fell back to per-name wipe',
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
      emptyRowsSkipped: ' (%N empty, skipped on send)',
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
      stateReplace: 'System prompt replaced',
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
      injectToolHint: 'Tool descriptions are editable too: the call format (schema) is not here, but do not wipe them',
      injectOriginalHint: 'The box shows the CURRENT original text; edit it to override, or match the original / clear it to leave it alone',
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


    // ── v0.2 文案（新手友好：每个框都说清楚"写什么、什么时候生效、花多少钱"）──
    Object.assign(zh, {
      gateOff: '纯净',
      gateOn: '纯净·开',
      gateOnTakeover: '接管·开',
      gateTitleOff: '当前：harness 的默认注入照常送出。点一下切到纯净（不发系统提示、运行时上下文和工具，只留你的话）',
      gateTitleOn: '当前：纯净已开。点一下关掉，恢复 harness 默认注入',
      gateNoticeTitle: '开启纯净？',
      gateNoticeBody: '系统提示会被清空：切换的那一轮缓存基本不命中，之后每轮输入反而更少。用量统计不受影响。此说明只弹一次。',
      injectTitleOff: '本会话已开跑，内容不会再写进历史。要点面板里的「注入」，内容才会在下一轮带上（这里只是启用）。',
      injectTitleOn: '已启用预注入，但不会自动生效：还需点面板里的「注入」，下一轮请求才会带上。',
      modeInjectTip: '会话已开跑，无法再写入历史，内容改为每轮注入。不会自动生效：点「注入」后下一轮请求才带上（不进历史、每轮都计费）。',
      injectOriginalHint: '框里显示的是当前原文；改动即覆盖，改回原文或清空 = 不修改',
      presetsTitle: '预设',
      presetsNone: '未套用',
      presetsActive: '已套用 1 个',
      presetClear: '取消预设',
      groupBuiltin: '内置',
      groupMine: '我的',
      manageShow: '＋ 保存 / 导入 / 导出预设',
      manageHide: '收起',
      presetsHint: '点一下即套用：下面的角色卡、系统提示、每轮注入、开场对话、改写注入内容和工具权限整体换成这个预设。首轮前套用从第一轮生效；会话开跑后套用从下一轮生效。',
      footPure: '系统提示 0 · 工具 0',
      footTakeover: '系统提示完全由你写',
      footReplace: '替换系统提示正文，工具照旧',
      footSystem: '追加系统提示',
      footMine: '我的预设',
      tagMine: '我的',
      myPresetDesc: '保存于本工作区',
      inUse: '使用中',
      packNamePlaceholder: '给当前配置起个名字，例如：周报助手',
      savePack: '保存为预设',
      needName: '先在左边输入预设名',
      historyOpen: '从当前会话取',
      historyTip: '把这个会话里已经发生的对话存成预设的开场对话，新会话套用后从这里接着聊',
      historyHint: '取用户原话和 AI 回答，存成开场对话（预设名用上面输入框里的）。插件注入（每轮注入、世界书、故事记忆）和工具调用不会带上；系统提示、工具权限照「保存为预设」一并保存。新会话套用后，首轮写进历史。',
      historyReasoning: '带上思维链',
      historyToTurn: '截至第',
      historyTurnUnit: '轮（留空 = 全部）',
      historyMeta: '{turns} 轮 · {n} 条 · ≈{tok} tok',
      historyTools: ' · 已略过 {n} 次工具调用',
      historySave: '存为预设',
      historyEmpty: '这个会话还没有可取的对话',
      savedAs: '已保存为',
      deleted: '已删除',
      imported: '已导入',
      importBad: '文件不是有效的预设 JSON',
      exportFile: '导出文件',
      importFile: '导入文件',
      deletePack: '删除',
      confirmYes: '再点确认',
      systemTitle: '系统提示',
      systemOffMeta: '不改',
      systemAppendMeta: '追加',
      systemTakeoverMeta: '接管',
      systemReplaceMeta: '替换',
      modeOff: '不改',
      modeAppend: '追加到默认提示后',
      modeTakeover: '接管整个系统提示',
      modeReplace: '替换正文·保留工具',
      everyTurnTitle: '每轮注入',
      everyTurnOffMeta: '关',
      everyTurnOn: '启用',
      everyTurnHint: '每轮在你的消息之前自动插一条提醒，模型每轮都会重新看到。实测在 step-5 上比系统提示管用得多：思维链语言、格式、人称都靠它稳住。代价：每轮多几十到一百多 token（会写进历史），前缀不变，缓存命中率基本不受影响。',
      everyTurnPresets: '常用：',
      everyTurnPlaceholder: '每轮要提醒模型的话。例如：本轮思维链请全程用中文。',
      everyTurnFirstLabel: '首轮专用（可选）：第 1 轮发这段，之后每轮发下面那段',
      everyTurnFirstPlaceholder: '第 1 轮要讲清楚的完整要求。例如：整场对话守住人设，思维链用角色第一人称、中文……\n留空 = 第 1 轮也发下面那段。',
      everyTurnLaterLabel: '每轮注入',
      everyTurnUntil: '只注入前',
      everyTurnUntilUnit: '轮（0 = 一直注入）',
      everyTurnDefault: '新会话默认也开启',
      everyTurnSaved: '每轮注入已保存，下一条消息起生效',
      everyTurnMode: '注入方式：',
      everyTurnModeAlways: '一直注入',
      everyTurnModeUntil: '只注入前 N 轮',
      everyTurnModeAuto: '自动',
      everyTurnAutoHint: '每轮结束后按规则检查上一轮的思维链：连续达标就先试停，停了还守得住才算暂停；跑偏了自动恢复。手动关掉每轮注入永远优先。',
      everyTurnChecks: '检查：',
      everyTurnCheck_zh: '中文思考',
      everyTurnCheck_four: '四段格式',
      everyTurnCheck_noLeak: '四段没漏进回答',
      everyTurnCheck_firstPerson: '第一人称（不说"用户"）',
      everyTurnNoChecks: '至少勾一项检查，否则自动模式等于一直注入',
      everyTurnAdvanced: '高级',
      everyTurnWarmup: '至少注入',
      everyTurnStreak: '连续达标',
      everyTurnProbation: '试停',
      everyTurnTurns: '轮',
      everyTurnResume: '立即恢复',
      everyTurnPause: '立即暂停',
      everyTurnState_injecting: '注入中 · 连续达标 {streak}/{need}',
      everyTurnState_trial: '试停中',
      everyTurnState_paused: '已暂停',
      everyTurnState_always: '不稳定，已改为一直注入',
      everyTurnStateNoReasoning: '看不到思维链，无法自动判断（一直注入）',
      everyTurnStateNoChecks: '没有检查项（一直注入）',
      everyTurnStateMeta: '自动 · {state}',
      everyTurnOverrideSaved: '已记下，从下一条消息起生效',
      historyWithEveryTurn: '带上每轮注入设置',
      historyWithMemory: '带上故事记忆摘要',
      historyMemoryLate: '摘要覆盖到第 {n} 轮，晚于截取点',
      packCardMissing: '已套用；预设里的角色卡找不到了，这一项跳过',
      presetContentHint: '下面这些都属于当前预设：保存时一起存，套用时整体替换（预设里没有的项恢复默认）。',
      memorySeedApplied: '已带入故事记忆摘要',
      everyTurnOffSaved: '每轮注入已关闭',
      modeReplaceHint: '用下面这段替换 dsh 默认系统提示的正文，但工具、运行时上下文（工作区、权限）和审批全部照旧。适合换语言（如中文版官方提示）或整体重写规则。可以写 {{model}} 和 {{cwd}}，dsh 会自动填入。',
      noteReplace: '替换：系统提示只剩你写的那段（约 {n} tok），工具和运行时上下文照旧。',
      modeOffHint: '保持 dsh 默认系统提示（身份、工具说明、工作区规则等）。下面写的内容不会发送。',
      modeAppendHint: '在 dsh 默认系统提示里追加下面这段（排在靠后位置）：工具、工作区、审批都照旧，模型只是多了这些设定（适合人格、口吻、团队规范）。默认提示的前缀不变，缓存照样能命中。',
      modeTakeoverHint: '系统提示只剩下面这段，不发运行时上下文、不给工具、只放行你的话（和开场对话）。效果等同用脚本直接调 API。留空 = 纯净模式（完全没有系统提示）。',
      systemPlaceholder: '在这里写系统提示。例如：\n你是一位耐心的 Python 老师，回答先给结论，再给 5 行以内的示例代码；遇到术语用括号解释。\n\n小提示：点上面的预设卡片可以一键填入现成的人格。',
      systemNotActive: '当前是「不改」，这段文字不会发送。选「追加」或「接管」后生效。',
      takeoverEmpty: '已接管：系统提示为空（= 纯净模式）。在框里写内容即成为唯一的系统提示',
      // 角色卡（v0.6）
      cardsTitle: '角色卡',
      cardsHint: '导入 SillyTavern 角色卡（V2/V3，JSON 或 PNG），选模式后套用：会自动写好人设段、开场白和每轮提醒。只影响本会话，不改其他设置。',
      cardsEmpty: '还没有角色卡，点「导入」选一个 .json 或 .png 文件。',
      cardsMeta: '{n} 张',
      cardImport: '导入',
      cardExport: '导出',
      cardDelete: '删除',
      cardApply: '套用到本会话',
      cardModeAgent: '带工具（Agent）',
      cardModePure: '纯角色扮演',
      cardModeAgentTip: '保留官方系统提示、工具和审批，角色卡追加在后面',
      cardModePureTip: '接管系统提示：只发角色卡，不带工具和运行时上下文',
      cardGreeting: '开场白',
      cardNoGreeting: '不要开场白',
      cardUserName: '我的名字',
      cardUserNamePlaceholder: '{{user}}，留空 = 你',
      cardReinforce: '每轮提醒（推荐）',
      cardThinkZh: '中文思考',
      cardFirstPerson: '第一人称思考',
      cardTools: '工具白名单',
      cardToolsPlaceholder: '逗号分隔，例如 read, grep, web_search；留空 = 全部',
      cardApplied: '已套用角色卡「{name}」',
      cardImported: '已导入「{name}」',
      cardImportBad: '没认出角色卡：',
      cardLore: '世界书 {n} 条',
      cardLoreToggle: '世界书（{n} 条关键词，命中才注入）',
      cardMemoryToggle: '故事记忆（每 {n} 轮总结一次前情）',
      memoryTitle: '故事记忆',
      memoryNone: '还没有总结（每 {n} 轮总结一次）',
      memoryThrough: '已总结到第 {n} 轮',
      memoryRunning: '正在总结…',
      memoryEdited: '手动改过',
      memoryShow: '查看',
      memoryHide: '收起',
      memorySave: '保存修改',
      memoryClear: '清空',
      memorySaved: '故事记忆已保存',
      memoryCleared: '故事记忆已清空',
      cardExportPng: '导出 PNG',
      cardGreetings: '开场白 {n} 句',
      cardBy: '作者',
      appliedFirstTurn: '已套用，发第一条消息时生效',
      appliedNextTurn: '已套用，从下一轮生效',
      presetCleared: '已取消预设，恢复默认',
      nextTurnNotice: '本轮进行中，改动从下一轮生效',
      itemsTitle: '开场对话（预填装）',
      itemsHistoryHint: '想让 AI 一开始就"记得"的对话写在这里。你发第一条消息时，这些会变成真实对话历史：只在首轮按输入计费一次，之后作为历史前缀，通常能命中缓存。用户和 AI 的消息顺序随意，连着几条也行。',
      itemsInjectHint: '会话已开跑，没法再写进开头的历史：现在改为「每轮注入」，点右下角「注入」后从下一轮起，每轮都会在你的话之前带上一份（每轮计费）。',
      itemsEmpty: '还没有内容。可以先点「填入示例」看看格式。',
      fillExample: '填入示例',
      exampleUser: '我是刚学编程的新手，接下来的回答请尽量通俗，多举例子。',
      exampleReasoning: '对方是新手 → 回答要短，先给结论，多用比喻，术语加括号解释。',
      exampleAssistant: '好的！之后我会先说结论，再用生活中的例子解释，遇到专业词会在括号里说明。',
      textUserPh: '用户说的话。例如：我叫小明，在做一个记账小程序，用 Vue。',
      textAssistantPh: 'AI 的回答（模型会当成自己说过的话）。例如：明白，小明！之后我都按 Vue 3 + 组合式 API 来给你写代码。',
      reasoningPh: '（可选）AI 的思考过程，会显示成折叠的思维链。例如：用户在做 Vue 记账应用 → 代码示例用 Vue 3。',
      roleUser: '用户',
      roleAssistant: 'AI',
      toUser: '点击改成"用户说"',
      toAssistant: '点击改成"AI 回答"',
      addUser: '＋ 用户说',
      addAssistant: '＋ AI 回答',
      dockClear: '清空',
      injectNow: '注入',
      injectUpdate: '更新注入',
      stopInject: '停止注入',
      injectNowTip: '把当前开场对话写成本会话的"每轮注入"，不产生任何消息；下一轮请求开始带上',
      advanced: '高级',
      injectHint: '把 harness 送进去的某条注入换成你的版本，只在本会话生效；框里是原文，改回原文或清空 = 不修改。',
      usageTitle: '用量与缓存',
      usageNoTurns: '还没开跑',
      turnsUnit: '轮',
      usageEmpty: '还没有用量记录：发一条消息后这里会按轮显示。',
      statInput: '未命中输入',
      statCache: '缓存命中',
      statOutput: '输出',
      statHit: '命中率',
      colTurn: '轮',
      colInput: '未命中',
      colCache: '命中',
      colOutput: '输出',
      colHit: '命中率',
      colSystem: '系统提示',
      colTools: '工具',
      charsUnit: '字',
      syntheticTurn: '预填装',
      notePure: '纯净：系统提示 0 字、工具 0 个，每轮输入大幅减少。',
      noteTakeover: '接管：系统提示只有你写的那段，没有工具和运行时上下文，每轮输入最少。',
      noteAppend: '追加：每轮多发约 {n} tok 的系统提示；它排在默认提示靠后的位置，前面的大段前缀不变，第 2 轮起通常照常命中缓存。',
      noteHistory: '开场对话约 {n} tok：首轮写进历史，只在首轮算一次未命中，之后作为历史前缀通常能命中。',
      noteInject: '每轮注入约 {n} tok：每一轮都会在你这句话之前再带上一份（会话日志里每轮一条），所以每轮都计费、轮数越多累计越多。长期有效的设定更适合写进「系统提示」。',
      noteSwitch: '切换预设 / 纯净 / 接管的那一轮，系统提示变了，缓存基本不命中，下一轮恢复。',
      noteMinCache: '很短的请求（例如纯净模式的头几轮）可能达不到服务商的最小缓存长度，命中 0% 属正常。',
      guideShow: '新手指南',
      guideHide: '收起指南',
      guideTitle: '三步上手',
      guide1: '在「预设」里点一张卡片：想换人格选人格卡，想完全自己写系统提示选「自定义系统提示」，想什么都不发选「纯净模式」。',
      guide2: '「系统提示」里选模式：不改 / 追加（保留 dsh 能力）/ 接管（像直接调 API）。框里的文字可以随时改，800 毫秒后自动保存。',
      guide3: '「开场对话」写你希望 AI 一开始就记得的对话，在发第一条消息前写好，会变成真实历史。',
      guide4: '会话已经聊过了也能改：系统提示从下一轮生效；开场对话要点「注入」才会每轮带上。',
      guide5: '展开「用量与缓存」能看到每轮实际花了多少、缓存命中多少，跟底栏的数字同源。',
      chipPure: '纯净',
      settingsWhere: '日常使用不需要来这里：在会话输入框上方点「预填装」打开面板，就能选预设、写系统提示和开场对话。这一页是开发 / 排查用的全局开关。',
      resetGlobal: '把全局开关恢复默认',
      resetTip: '关掉所有全局开关、清空「生效会话」——旧版「纯净模式」会在这里留下全局开关，导致之后套人格时连工具一起被拦。',
      toolsZero: '无工具',
      toolsUnit: '个工具',
      expandPanel: '展开',
      collapsePanel: '收起',
      prefillWritten: '预填装 · 已写入历史',
      itemsWrittenHint: '✓ 首轮已把 {n} 条开场对话写成真实历史（在对话里可以看到）。',
      prefillWrittenTip: '开场对话已在首轮写成真实历史，之后每轮作为历史前缀发送（通常命中缓存）。想再追加内容可在面板里改为每轮注入。',
      chipTakeover: '接管系统提示',
      pureApplied: '纯净模式已生效',
    })
    Object.assign(en, {
      gateOff: 'Pure',
      gateOn: 'Pure·on',
      gateOnTakeover: 'Custom·on',
      gateTitleOff: 'Harness injections flow as usual. Click to go pure (no system prompt, runtime context or tools)',
      gateTitleOn: 'Pure is on. Click to restore the harness defaults',
      gateNoticeTitle: 'Go pure?',
      gateNoticeBody: 'The system prompt is emptied: the switching turn mostly misses the cache, later turns send far fewer tokens. Usage stats are unaffected. Shown once.',
      presetsTitle: 'Presets',
      presetsNone: 'none applied',
      presetsActive: '1 applied',
      presetClear: 'Clear preset',
      groupBuiltin: 'Built-in',
      groupMine: 'Mine',
      manageShow: '+ Save / import / export',
      manageHide: 'Hide',
      presetsHint: 'Click to apply it: the character card, system prompt, every-turn injection, opening dialogue, injection rewrites and tool access below are all replaced by this preset. Before the first turn it applies from turn 1; afterwards from the next turn.',
      footPure: 'system 0 · tools 0',
      footTakeover: 'you write the whole system prompt',
      footReplace: 'replaces the system prompt body, tools stay',
      footSystem: 'appends to system',
      footMine: 'my preset',
      tagMine: 'mine',
      myPresetDesc: 'saved in this workspace',
      inUse: 'in use',
      packNamePlaceholder: 'Name the current setup, e.g. Weekly report helper',
      needName: 'Type a preset name first',
      historyOpen: 'From this session',
      historyTip: 'Save the conversation so far as the opening dialogue of a preset, so a new session can pick up from here',
      historyHint: 'Takes your messages and the AI answers and saves them as opening dialogue (named by the box above). Plugin injects (every-turn, lore, story memory) and tool calls are left out; the system prompt and tool access are saved like "Save as preset". A new session that applies it writes them into history on turn 1.',
      historyReasoning: 'Include reasoning',
      historyToTurn: 'Up to turn',
      historyTurnUnit: '(empty = all)',
      historyMeta: '{turns} turns · {n} rows · ≈{tok} tok',
      historyTools: ' · {n} tool calls skipped',
      historySave: 'Save as preset',
      historyEmpty: 'Nothing to take from this session yet',
      savedAs: 'Saved as',
      deleted: 'Deleted',
      imported: 'Imported',
      importBad: 'Not a valid preset JSON file',
      exportFile: 'Export',
      importFile: 'Import',
      deletePack: 'Delete',
      confirmYes: 'Click to confirm',
      systemTitle: 'System prompt',
      systemOffMeta: 'unchanged',
      systemAppendMeta: 'append',
      systemTakeoverMeta: 'take over',
      systemReplaceMeta: 'replace',
      modeOff: 'Unchanged',
      modeAppend: 'Append to default',
      modeTakeover: 'Take over entirely',
      modeReplace: 'Replace text, keep tools',
      everyTurnTitle: 'Every-turn reminder',
      everyTurnOffMeta: 'off',
      everyTurnOn: 'Enabled',
      everyTurnHint: 'Inserts a short reminder before your message on every turn. On step-5 this steers reasoning language, format and person far better than the system prompt. Cost: a few dozen to ~100 tokens per turn (kept in history); the prefix is unchanged, so cache hits barely move.',
      everyTurnPresets: 'Presets:',
      everyTurnPlaceholder: 'What to remind the model each turn, e.g. think in Chinese this turn.',
      everyTurnFirstLabel: 'First turn only (optional): sent on turn 1, the text below on later turns',
      everyTurnFirstPlaceholder: 'The full requirement to state on turn 1.\nEmpty = turn 1 also gets the text below.',
      everyTurnLaterLabel: 'Every turn',
      everyTurnUntil: 'Only for the first',
      everyTurnUntilUnit: 'turns (0 = always)',
      everyTurnDefault: 'Also on by default for new sessions',
      everyTurnSaved: 'Every-turn reminder saved — applies from your next message',
      everyTurnMode: 'Mode:',
      everyTurnModeAlways: 'Always',
      everyTurnModeUntil: 'First N turns',
      everyTurnModeAuto: 'Auto',
      everyTurnAutoHint: 'After each turn the last reasoning is checked by rules: a streak of passes starts a trial stop, holding through the trial pauses it, drifting resumes it. Turning the reminder off always wins.',
      everyTurnChecks: 'Check:',
      everyTurnCheck_zh: 'Chinese reasoning',
      everyTurnCheck_four: 'Four-section format',
      everyTurnCheck_noLeak: 'Sections not in answer',
      everyTurnCheck_firstPerson: 'First person (no "the user")',
      everyTurnNoChecks: 'Pick at least one check, otherwise auto = always',
      everyTurnAdvanced: 'Advanced',
      everyTurnWarmup: 'Inject at least',
      everyTurnStreak: 'Passes in a row',
      everyTurnProbation: 'Trial stop',
      everyTurnTurns: 'turns',
      everyTurnResume: 'Resume now',
      everyTurnPause: 'Pause now',
      everyTurnState_injecting: 'injecting · streak {streak}/{need}',
      everyTurnState_trial: 'trial stop',
      everyTurnState_paused: 'paused',
      everyTurnState_always: 'unstable, switched to always',
      everyTurnStateNoReasoning: 'No reasoning visible, cannot judge (always on)',
      everyTurnStateNoChecks: 'No checks (always on)',
      everyTurnStateMeta: 'auto · {state}',
      everyTurnOverrideSaved: 'Noted — applies from your next message',
      historyWithEveryTurn: 'Include every-turn reminder settings',
      historyWithMemory: 'Include story memory summary',
      historyMemoryLate: 'Summary covers up to turn {n}, after the cut',
      packCardMissing: 'Applied; the character card in this preset is gone, so it was skipped',
      presetContentHint: 'Everything below belongs to the current preset: saving stores all of it, applying replaces all of it (anything the preset lacks goes back to default).',
      memorySeedApplied: 'Story memory summary carried over',
      everyTurnOffSaved: 'Every-turn reminder off',
      modeReplaceHint: 'Replaces the body of the default dsh system prompt with the text below, while tools, runtime context (workspace, permissions) and approvals stay. {{model}} and {{cwd}} are filled in by dsh.',
      noteReplace: 'Replace: the system prompt is only your text (≈{n} tok); tools and runtime context stay.',
      modeOffHint: 'Keep the default dsh system prompt. The text below is not sent.',
      modeAppendHint: 'Appends the text below after the default dsh system prompt: tools, workspace and approvals stay; the model just gains these instructions. The default prefix is unchanged, so caching still works.',
      modeTakeoverHint: 'The system prompt becomes only the text below: no runtime context, no tools, only your messages (and the opening dialogue) pass. Same as calling the API from a script. Empty = pure mode.',
      systemPlaceholder: 'Write the system prompt here, e.g.\nYou are a patient Python teacher. Lead with the answer, then a code sample under 5 lines.\n\nTip: the preset cards above fill in ready-made personas.',
      systemNotActive: 'Mode is "Unchanged", so this text is not sent. Pick Append or Take over.',
      takeoverEmpty: 'Taken over with an empty prompt (= pure). Whatever you type becomes the only system prompt',
      // character cards (v0.6)
      cardsTitle: 'Character cards',
      cardsHint: 'Import SillyTavern cards (V2/V3, JSON or PNG), pick a mode and apply: persona, greeting and every-turn reminder are set for you. This session only; nothing else changes.',
      cardsEmpty: 'No cards yet — click Import and pick a .json or .png file.',
      cardsMeta: '{n} cards',
      cardImport: 'Import',
      cardExport: 'Export',
      cardDelete: 'Delete',
      cardApply: 'Apply to this session',
      cardModeAgent: 'With tools (agent)',
      cardModePure: 'Pure roleplay',
      cardModeAgentTip: 'Keeps the official system prompt, tools and approvals; the card is appended',
      cardModePureTip: 'Takes over the system prompt: only the card, no tools or runtime context',
      cardGreeting: 'Greeting',
      cardNoGreeting: 'No greeting',
      cardUserName: 'My name',
      cardUserNamePlaceholder: '{{user}}; empty = "you"',
      cardReinforce: 'Every-turn reminder (recommended)',
      cardThinkZh: 'Reason in Chinese',
      cardFirstPerson: 'First-person reasoning',
      cardTools: 'Tool allowlist',
      cardToolsPlaceholder: 'comma separated, e.g. read, grep, web_search; empty = all',
      cardApplied: 'Applied card "{name}"',
      cardImported: 'Imported "{name}"',
      cardImportBad: 'Not a character card: ',
      cardLore: '{n} lorebook entries',
      cardLoreToggle: 'Lorebook ({n} keyword entries, injected on match)',
      cardMemoryToggle: 'Story memory (summarize every {n} turns)',
      memoryTitle: 'Story memory',
      memoryNone: 'No summary yet (every {n} turns)',
      memoryThrough: 'Summarized through turn {n}',
      memoryRunning: 'Summarizing…',
      memoryEdited: 'edited',
      memoryShow: 'Show',
      memoryHide: 'Hide',
      memorySave: 'Save',
      memoryClear: 'Clear',
      memorySaved: 'Story memory saved',
      memoryCleared: 'Story memory cleared',
      cardExportPng: 'Export PNG',
      cardGreetings: '{n} greeting(s)',
      cardBy: 'by',
      appliedFirstTurn: 'Applied — takes effect on your first message',
      appliedNextTurn: 'Applied — takes effect next turn',
      presetCleared: 'Preset cleared, defaults restored',
      nextTurnNotice: 'A turn is running; changes apply next turn',
      itemsTitle: 'Opening dialogue (prefill)',
      itemsHistoryHint: 'Write the conversation the AI should "remember". On your first send it becomes real history: billed once as input, then cached as history prefix. Any order, several in a row is fine.',
      itemsInjectHint: 'This session has already run, so history is closed: the content is now injected every turn once you press Inject (not history, billed every turn).',
      itemsEmpty: 'Nothing yet. Try "Fill example" to see the format.',
      fillExample: 'Fill example',
      exampleUser: 'I am new to programming. Please keep answers simple with lots of examples.',
      exampleReasoning: 'Beginner → short answers, lead with the conclusion, use analogies.',
      exampleAssistant: 'Got it! I will lead with the answer, explain with everyday examples, and define any jargon.',
      textUserPh: 'What the user says, e.g. I am building a budgeting app with Vue.',
      textAssistantPh: 'The AI answer (the model treats it as its own words), e.g. Understood — I will write Vue 3 code with the Composition API.',
      reasoningPh: '(optional) AI reasoning, shown as a folded chain of thought.',
      injectNow: 'Inject',
      injectUpdate: 'Update injection',
      stopInject: 'Stop injecting',
      advanced: 'advanced',
      usageTitle: 'Usage & cache',
      usageNoTurns: 'not started',
      turnsUnit: 'turns',
      usageEmpty: 'No usage yet: send a message and each turn shows up here.',
      statInput: 'uncached input',
      statCache: 'cache hits',
      statOutput: 'output',
      statHit: 'hit rate',
      colTurn: 'turn',
      colInput: 'uncached',
      colCache: 'cached',
      colOutput: 'output',
      colHit: 'hit',
      colSystem: 'system',
      colTools: 'tools',
      charsUnit: 'ch',
      syntheticTurn: 'prefill',
      notePure: 'Pure: 0 system chars, 0 tools — far less input per turn.',
      noteTakeover: 'Take over: only your system text, no tools or runtime context.',
      noteAppend: 'Append: ~{n} tok more system prompt per turn, placed after the default prefix, so turn 2+ usually still hits the cache.',
      noteHistory: 'Opening dialogue ~{n} tok: written to history on turn 1, billed once, then usually cached.',
      noteInject: 'Per-turn injection ~{n} tok: a fresh copy is added before your message every turn (one row per turn in the session log), so it is billed every turn and adds up. Long-lived instructions belong in the system prompt.',
      noteSwitch: 'The turn where you switch preset / pure / take over changes the system prompt and mostly misses the cache; the next turn recovers.',
      noteMinCache: 'Very short requests may be below the provider minimum cache length; 0% is normal then.',
      guideShow: 'Guide',
      guideHide: 'Hide guide',
      guideTitle: 'Get started',
      guide1: 'Pick a preset card: personas change the voice, "Custom system prompt" lets you write it all, "Pure" sends nothing.',
      guide2: 'Choose the system-prompt mode: unchanged / append (keeps dsh abilities) / take over (like a raw API call). Edits autosave.',
      guide3: 'Write the opening dialogue before your first message; it becomes real history.',
      guide4: 'After the session has run: system prompt changes apply next turn; the opening dialogue needs Inject.',
      guide5: 'Open "Usage & cache" to see per-turn spend and cache hits, from the same data as the footer.',
      chipPure: 'Pure',
      settingsWhere: 'Everyday use happens in the Prefill panel above the composer (presets, system prompt, opening dialogue). This page holds developer/diagnostic global switches.',
      resetGlobal: 'Reset global switches',
      resetTip: 'Turn every global switch off and clear the affected-session list (older pure mode left them on).',
      toolsZero: 'no tools',
      toolsUnit: 'tools',
      expandPanel: 'Expand',
      collapsePanel: 'Collapse',
      prefillWritten: 'Prefill · in history',
      itemsWrittenHint: '✓ {n} opening rows were written into history on turn 1 (visible in the conversation).',
      prefillWrittenTip: 'The opening dialogue was written into history on turn 1 and is sent as cached history prefix from then on.',
      chipTakeover: 'Custom system',
      pureApplied: 'Pure mode active',
    })

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
        gridTemplateColumns: 'minmax(150px, 30%) 1fr',
        gap: 8,
        alignItems: 'start',
      },
      injectKeyCell: { display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 },
      injectDoc: {
        color: 'var(--dsw-alias-label-tertiary)',
        fontSize: 10.5,
        lineHeight: 1.35,
        overflow: 'hidden',
        display: '-webkit-box',
        WebkitLineClamp: 3,
        WebkitBoxOrient: 'vertical',
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
      // ── 与会话头部的模式徽标（回答"顶上那颗芯片为什么不跟着变"）──
      headerBadge: (gate) => ({
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '1px 8px',
        borderRadius: 999,
        fontSize: 11,
        whiteSpace: 'nowrap',
        border: `1px solid ${
          gate === 'pure'
            ? 'var(--dsw-alias-state-warn-primary)'
            : gate === 'filter'
              ? 'var(--dsw-alias-brand-primary)'
              : 'var(--dsw-alias-border-l2)'
        }`,
        color: 'var(--dsw-alias-label-secondary)',
        background: 'transparent',
      }),
      // ── 与其他插件的冲突横幅（**明说**，不悄悄降级）──
      conflictBanner: {
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        padding: '7px 10px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-state-error-primary, #d94a4a)',
        background: 'var(--dsw-alias-bg-layer-2)',
        fontSize: 11.5,
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
        h('div', { style: { ...S.intro, padding: '8px 10px', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-2)', borderLeft: '3px solid var(--dsw-alias-brand-primary)' } }, t('settingsWhere')),
        h('div', { style: S.intro }, t('intro')),
        h(
          'button',
          {
            type: 'button',
            style: S.button,
            title: t('resetTip'),
            onClick: () =>
              void mutate({
                armed: [],
                levers: { probeSection: false, probeContext: false, blockSections: false, blockContexts: false, blockTools: false, blockMessages: false },
                allowKinds: ['user'],
                tools: null,
              }),
          },
          t('resetGlobal'),
        ),

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
          envelope !== null && envelope !== undefined && envelope.tools === undefined
            ? h('div', { style: S.injectStale ?? S.note }, t('injectStaleHost'))
            : null,
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
      // 首轮前写好的预填装已经变成真实历史：不用再点注入，别拿警示色催人。
      const written = (envelope?.materialized?.[sessionId] ?? 0) > 0
      // 输入框芯片不知道面板里有没有内容，所以不在这里催；催促只在面板里（有内容、没注入时才高亮「注入」按钮）。
      const pending = false
      const label = injectMode
        ? written && !injected
          ? t('prefillWritten')
          : pending
            ? t('injectOn')
            : injected
              ? t('injectDone')
              : t('injectOff')
        : on
          ? t('prefillOn')
          : t('prefillOff')
      const title = injectMode
        ? written && !injected
          ? t('prefillWrittenTip')
          : on
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
        window.addEventListener(STATE_EVENT, refresh)
        return () => {
          clearInterval(timer)
          window.removeEventListener(STATE_EVENT, refresh)
        }
      }, [refresh, sessionId])

      if (sessionId === '') return null
      const gate = state?.gate !== null && typeof state?.gate === 'object' ? state.gate : {}
      const on = gate[sessionId] === 'pure'

      const write = (mode, markSeen) => {
        const patch = { gate: { ...gate, [sessionId]: mode } }
        if (markSeen === true) patch.noticeSeen = true
        if (mode !== 'pure') {
          // 关闭时把旧版「纯净模式」留下的 armed / 工具清单一并撤掉，否则看着关了、实际仍纯净。
          patch.armed = (state?.armed ?? []).filter((id) => id !== sessionId)
          const tools = { ...(state?.sessionTools ?? {}) }
          delete tools[sessionId]
          patch.sessionTools = tools
          if (state?.activePreset?.[sessionId] === 'builtin:pure') {
            const active = { ...(state?.activePreset ?? {}) }
            delete active[sessionId]
            patch.activePreset = active
          }
        }
        void call(patch)
          .then((data) => {
            setEnvelope(data)
            notifyStateChanged()
          })
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
        snap?.state === 'pure' ? t('statePure') : snap?.state === 'filter' ? t('stateFilter') : snap?.state === 'replace' ? t('stateReplace') : t('statePass')
      // 输入行只放一颗芯片：本轮状态的细节已经在面板与顶栏徽标里，这里只在"改动要到下一轮才生效"时提示。
      const badge =
        snap === undefined || !pending
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
          on
            ? typeof state?.overrides?.[sessionId]?.sections?.['prefill:persona'] === 'string' &&
              state.overrides[sessionId].sections['prefill:persona'].trim() !== ''
              ? t('gateOnTakeover')
              : t('gateOn')
            : t('gateOff'),
        ),
        badge,
      )
    }

    // ══════════════════════════════════════════════════════════════════════════
    // v0.2 面板：预设卡片 + 系统提示 + 开场对话 + 改写注入 + 用量与缓存
    // ══════════════════════════════════════════════════════════════════════════

    /** 人格段的名字（与 host 的 builtin-presets.js 保持一致）。 */
    const PERSONA_SECTION = 'prefill:persona'
    /** 用量路由（只读）。 */
    const USAGE_ROUTE = '/api/dsh-prefill/usage'

    /**
     * 粗估 token：中日韩字符 ≈ 0.7 token/字，其余 ≈ 1 token/3.5 字符。
     * 只用于"大概多花多少"的提示，真实计费以底栏 / 用量卡里的接口读数为准。
     */
    function estimateTokens(text) {
      if (typeof text !== 'string' || text === '') return 0
      let cjk = 0
      for (const char of text) if (/[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(char)) cjk += 1
      return Math.round(cjk * 0.7 + (text.length - cjk) / 3.5)
    }

    function itemsTokens(items) {
      return (items ?? []).reduce((sum, item) => sum + estimateTokens(item?.text) + estimateTokens(item?.reasoning), 0)
    }

    /** 1234 → "1.2K"。 */
    function fmt(value) {
      if (!Number.isFinite(value)) return '—'
      return value >= 10000 ? `${(value / 1000).toFixed(1)}K` : value >= 1000 ? `${(value / 1000).toFixed(2)}K` : String(value)
    }

    async function postJson(path, body) {
      const response = await fetch(path, {
        method: 'POST',
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.json()
    }

    /** 从 state 的"会话 → 值"表里删掉一个会话。 */
    /** 预设带来的故事记忆摘要，作为开场背景时的外壳（与 character-cards.js renderMemory 同一说法）。 */
    function memorySeedText(text) {
      return `【故事记忆 · 前情提要】以下是此前剧情的摘要，帮你记住发生过的事。直接按它延续剧情，不要复述、不要提到这份摘要：\n${String(text ?? '').trim()}`
    }

    function without(map, sessionId) {
      const next = { ...(map ?? {}) }
      delete next[sessionId]
      return next
    }

    /** 新面板的样式（只用 DSH 的 --dsw-alias-* token，深浅色自动跟随）。 */
    const V = {
      section: {
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '10px 12px',
        borderRadius: 10,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-base)',
      },
      sectionHead: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' },
      sectionTitle: { fontWeight: 600, fontSize: 12.5, color: 'var(--dsw-alias-label-primary)' },
      sectionMeta: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' },
      caret: (open) => ({
        display: 'inline-block',
        width: 10,
        color: 'var(--dsw-alias-label-tertiary)',
        transform: open ? 'rotate(90deg)' : 'none',
        transition: 'transform 120ms ease',
      }),
      hint: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 11.5, lineHeight: 1.6 },
      grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))', gap: 8 },
      pills: { display: 'flex', flexWrap: 'wrap', gap: 6 },
      pill: (active) => ({
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        height: 28,
        padding: '0 10px 0 8px',
        borderRadius: 14,
        cursor: 'pointer',
        fontSize: 12,
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
        border: `1px solid ${active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)'}`,
        background: active ? 'color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, var(--dsw-alias-bg-base))' : 'var(--dsw-alias-bg-layer-1)',
        color: active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-primary)',
        fontWeight: active ? 600 : 400,
      }),
      pillGroup: { fontSize: 10.5, color: 'var(--dsw-alias-label-tertiary)', alignSelf: 'center', marginRight: 2 },
      detail: {
        display: 'flex',
        gap: 8,
        alignItems: 'baseline',
        flexWrap: 'wrap',
        alignContent: 'flex-start',
        // 固定高度：说明长短不一，若随悬停变高，底部锚定的面板会整体上移，
        // 卡片在光标下"跳走"，点击落空（实测：mousedown 落在 A、mouseup 落在 B，click 丢失）。
        height: 72,
        overflow: 'hidden',
        fontSize: 11.5,
        lineHeight: 1.55,
        color: 'var(--dsw-alias-label-secondary)',
      },
      card: (active) => ({
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '8px 10px',
        borderRadius: 10,
        textAlign: 'left',
        cursor: 'pointer',
        border: `1px solid ${active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l1)'}`,
        background: active
          ? 'color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, var(--dsw-alias-bg-base))'
          : 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 12,
        fontFamily: 'inherit',
        minWidth: 0,
      }),
      cardTop: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 },
      cardEmoji: { fontSize: 16, lineHeight: 1 },
      cardName: { fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      tag: {
        marginLeft: 'auto',
        flex: '0 0 auto',
        padding: '0 6px',
        borderRadius: 999,
        fontSize: 10,
        lineHeight: '16px',
        color: 'var(--dsw-alias-label-tertiary)',
        border: '1px solid var(--dsw-alias-border-l2)',
      },
      cardDesc: {
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: 11,
        lineHeight: 1.45,
        overflow: 'hidden',
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
      },
      cardFoot: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: 'var(--dsw-alias-label-tertiary)' },
      activeMark: { color: 'var(--dsw-alias-brand-primary)', fontWeight: 600 },
      btn: {
        height: 26,
        padding: '0 10px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 12,
        fontFamily: 'inherit',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      },
      btnPrimary: {
        height: 26,
        padding: '0 12px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-label-primary)',
        color: 'var(--dsw-alias-bg-base)',
        fontSize: 12,
        fontFamily: 'inherit',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      },
      btnGhost: {
        height: 24,
        padding: '0 8px',
        borderRadius: 6,
        border: 'none',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: 12,
        fontFamily: 'inherit',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      },
      seg: {
        display: 'inline-flex',
        padding: 2,
        gap: 2,
        borderRadius: 8,
        background: 'var(--dsw-alias-bg-layer-2)',
        border: '1px solid var(--dsw-alias-border-l1)',
      },
      segBtn: (on) => ({
        height: 24,
        padding: '0 10px',
        borderRadius: 6,
        border: 'none',
        background: on ? 'var(--dsw-alias-bg-base)' : 'transparent',
        boxShadow: on ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
        color: on ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
        fontWeight: on ? 600 : 400,
        fontSize: 12,
        fontFamily: 'inherit',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }),
      textarea: {
        width: '100%',
        boxSizing: 'border-box',
        minHeight: 64,
        maxHeight: '28vh',
        padding: '8px 10px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 12.5,
        lineHeight: 1.55,
        fontFamily: 'inherit',
        resize: 'vertical',
      },
      input: {
        height: 26,
        boxSizing: 'border-box',
        padding: '0 8px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 12,
        fontFamily: 'inherit',
        minWidth: 0,
      },
      row: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
      callout: (tone) => ({
        padding: '7px 10px',
        borderRadius: 8,
        fontSize: 11.5,
        lineHeight: 1.6,
        color: 'var(--dsw-alias-label-secondary)',
        background: 'var(--dsw-alias-bg-layer-2)',
        borderLeft: `3px solid ${
          tone === 'warn'
            ? 'var(--dsw-alias-state-warn-primary)'
            : tone === 'brand'
              ? 'var(--dsw-alias-brand-primary)'
              : 'var(--dsw-alias-border-l2)'
        }`,
      }),
      table: { width: '100%', borderCollapse: 'collapse', fontSize: 11.5, fontVariantNumeric: 'tabular-nums' },
      th: {
        textAlign: 'right',
        fontWeight: 500,
        color: 'var(--dsw-alias-label-tertiary)',
        padding: '3px 6px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        whiteSpace: 'nowrap',
      },
      td: { textAlign: 'right', padding: '3px 6px', color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'nowrap' },
      stat: { display: 'flex', flexDirection: 'column', gap: 1, minWidth: 72 },
      statValue: { fontSize: 15, fontWeight: 600, color: 'var(--dsw-alias-label-primary)', fontVariantNumeric: 'tabular-nums' },
      statLabel: { fontSize: 10.5, color: 'var(--dsw-alias-label-tertiary)' },
      bar: { height: 6, borderRadius: 3, background: 'var(--dsw-alias-bg-layer-2)', overflow: 'hidden', display: 'flex' },
      steps: { margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 3 },
      itemCard: (assistant) => ({
        display: 'flex',
        gap: 8,
        alignItems: 'flex-start',
        padding: '8px 8px 8px 10px',
        borderRadius: 10,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: assistant ? 'var(--dsw-alias-bg-layer-1)' : 'var(--dsw-alias-bg-base)',
      }),
    }

    /** 角色卡面板选项的默认值（预设里的角色卡引用按它补全）。 */
    const DEFAULT_CARD_OPTS = { mode: 'agent', greeting: 0, userName: '', reinforce: true, thinkZh: false, firstPerson: false, tools: '', lore: true, memory: true }

    /** 可折叠的小节。 */
    function Section(props) {
      return h(
        'div',
        { style: V.section, 'data-prefill-section': props.id },
        h(
          'div',
          {
            style: V.sectionHead,
            role: 'button',
            tabIndex: 0,
            'aria-expanded': props.open ? 'true' : 'false',
            onClick: props.onToggle,
            onKeyDown: (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                props.onToggle()
              }
            },
          },
          h('span', { style: V.caret(props.open) }, '▸'),
          h('span', { style: V.sectionTitle }, props.title),
          props.meta ? h('span', { style: V.sectionMeta }, props.meta) : null,
          h('span', { style: { flex: '1 1 auto' } }),
          props.right ?? null,
        ),
        props.open ? props.children : null,
      )
    }

    /**
     * 输入框上方的预填装面板（v0.2）。
     *
     * 一个会话的配置只有四样东西，面板就按这四样排：
     *   ① 预设（一键套用下面三样）；② 系统提示（不改 / 追加 / 接管）；
     *   ③ 开场对话（预填装：首轮前写成真实历史，开跑后改为每轮注入）；
     *   ④ 改写注入（高级）。外加 ⑤ 用量与缓存（只读，数据同 DSH 底栏）。
     */
    function PrefillDock(props) {
      const t = props.t ?? ((key) => key)
      const sessionId = typeof props.sessionId === 'string' ? props.sessionId : ''
      const [items, setItems] = React.useState(null)
      const [enabled, setEnabled] = React.useState(false)
      const [status, setStatus] = React.useState('idle')
      const [revision, setRevision] = React.useState(0)
      const [packs, setPacks] = React.useState([])
      const [builtins, setBuiltins] = React.useState([])
      const [everyTurnList, setEveryTurnList] = React.useState([])
      const [everyTurnDraft, setEveryTurnDraft] = React.useState(null)
      const everyTurnTimer = React.useRef(0)
      React.useEffect(() => setEveryTurnDraft(null), [sessionId])
      const [packName, setPackName] = React.useState('')
      // 「从当前会话取」：把已发生的对话转成开场条目存成预设（v0.8）。
      const [historyOpen, setHistoryOpen] = React.useState(false)
      const [historyOpts, setHistoryOpts] = React.useState({ reasoning: false, toTurn: '', everyTurn: true, memory: false })
      const [everyTurnStatus, setEveryTurnStatus] = React.useState(null)
      const [historyPreview, setHistoryPreview] = React.useState(null)
      // 角色卡（v0.6）：列表、选中、套用选项、编译预览。
      const [cards, setCards] = React.useState([])
      const [cardPick, setCardPick] = React.useState('')
      const [cardOpts, setCardOpts] = React.useState(DEFAULT_CARD_OPTS)
      const [avatars, setAvatars] = React.useState({})
      const [cardPreview, setCardPreview] = React.useState(null)
      const cardFileRef = React.useRef(null)
      const [envelope, setEnvelope] = React.useState(null)
      const [toast, setToast] = React.useState('')
      const [open, setOpen] = React.useState({ guide: false, presets: true, system: false, items: true, inject: false, everyTurn: false, usage: false, manage: false })
      const [hovered, setHovered] = React.useState('')
      // 整个面板可收起成一行：会话开跑后默认收起（否则它会盖住对话）。用户手动展开/收起后按会话记住。
      const [collapsed, setCollapsed] = React.useState(null)
      const [systemDraft, setSystemDraft] = React.useState(null)
      const [usage, setUsage] = React.useState(null)
      const [confirming, setConfirming] = React.useState('')
      const [injectStatus, setInjectStatus] = React.useState('idle')
      const dirty = React.useRef(false)
      const systemDirty = React.useRef(false)
      const staged = React.useRef(false)
      const fileRef = React.useRef(null)
      const listRef = React.useRef(null)
      const [bounds, setBounds] = React.useState(null)

      const flash = React.useCallback((text) => {
        setToast(text)
        setTimeout(() => setToast((current) => (current === text ? '' : current)), 3200)
      }, [])

      // 面板宽度对齐输入框卡片、高度上限 = 输入框上沿到顶栏（只读几何，不写别人的 DOM）。
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
          const maxHeight = Math.max(240, Math.round(input.getBoundingClientRect().top - ceiling))
          setBounds((current) =>
            current !== null && current.width === width && current.maxHeight === maxHeight ? current : { width, maxHeight },
          )
        }
        measure()
        window.addEventListener('resize', measure)
        const timer = setInterval(measure, 1200)
        return () => {
          window.removeEventListener('resize', measure)
          clearInterval(timer)
        }
      }, [])

      React.useEffect(() => {
        const onChanged = () => setRevision((value) => value + 1)
        window.addEventListener(STATE_EVENT, onChanged)
        return () => window.removeEventListener(STATE_EVENT, onChanged)
      }, [])

      const refreshEnvelope = React.useCallback(() => {
        void postJson(STATE_ROUTE, undefined)
          .then((data) => setEnvelope(data))
          .catch(() => {})
      }, [])

      // 打开 / 换会话：读开关 + 草稿 + 系统提示。
      React.useEffect(() => {
        if (sessionId === '') return undefined
        let alive = true
        staged.current = false
        void (async () => {
          try {
            const snapshot = await postJson(STATE_ROUTE, undefined)
            if (!alive) return
            setEnvelope(snapshot)
            const map = snapshot?.state?.prefill
            const on = map !== null && typeof map === 'object' && typeof map[sessionId] === 'string' && map[sessionId] !== ''
            setEnabled(on)
            if (!on) {
              setItems(null)
              return
            }
            const draft = await postJson(DRAFT_ROUTE, { sessionId })
            if (!alive) return
            // 本地有没落盘的编辑（debounce 中）时不要用 host 的旧草稿覆盖它（套预设时实测踩到）。
            if (!dirty.current) setItems(Array.isArray(draft?.draft) ? draft.draft : [])
            if (!systemDirty.current) {
              const text = snapshot?.state?.overrides?.[sessionId]?.sections?.[PERSONA_SECTION]
              setSystemDraft(typeof text === 'string' ? text : '')
            }
          } catch {
            if (alive) setStatus('error')
          }
        })()
        return () => {
          alive = false
        }
      }, [sessionId, revision])

      // 状态轮询：轮次数 / 闸门 / 注入数会在别处变（跑完一轮、点了芯片）。
      React.useEffect(() => {
        if (!enabled || sessionId === '') return undefined
        const timer = setInterval(refreshEnvelope, 3000)
        return () => clearInterval(timer)
      }, [enabled, refreshEnvelope, sessionId])

      // 启用后先登记一份空草稿：声明"本会话用预填装"，也让 host 预热系统提示。
      React.useEffect(() => {
        if (!enabled || items === null || staged.current || sessionId === '') return
        staged.current = true
        if (items.length === 0) void postJson(DRAFT_ROUTE, { sessionId, items: [] }).catch(() => setStatus('error'))
      }, [enabled, items, sessionId])

      const packsCall = React.useCallback((payload) => postJson(PACKS_ROUTE, { sessionId, ...payload }), [sessionId])
      const adoptPacks = (data) => {
        setPacks(Array.isArray(data?.packs) ? data.packs : [])
        if (Array.isArray(data?.builtins)) setBuiltins(data.builtins)
        if (Array.isArray(data?.everyTurnPresets)) setEveryTurnList(data.everyTurnPresets)
      }
      React.useEffect(() => {
        if (enabled && sessionId !== '') void packsCall({ op: 'list' }).then(adoptPacks).catch(() => setStatus('error'))
      }, [enabled, packsCall, sessionId])
      const cardsCall = React.useCallback((payload) => postJson(CARDS_ROUTE, { sessionId, ...payload }), [sessionId])
      // 故事记忆（三期）：本会话开着记忆时，每 15 秒取一次摘要状态（总结在后台跑，几轮才变一次）。
      const memoryConfig = envelope?.state?.memory?.[sessionId] ?? null
      const memoryOn = memoryConfig !== null && typeof memoryConfig === 'object' && memoryConfig.enabled === true
      const [memoryView, setMemoryView] = React.useState(null)
      const [memoryOpen, setMemoryOpen] = React.useState(false)
      const [memoryDraft, setMemoryDraft] = React.useState(null)
      const memoryCall = React.useCallback((payload) => postJson(MEMORY_ROUTE, { sessionId, ...payload }), [sessionId])
      React.useEffect(() => {
        if (!enabled || !memoryOn || sessionId === '') {
          setMemoryView(null)
          return undefined
        }
        let alive = true
        const pull = () =>
          void memoryCall({ op: 'get' })
            .then((data) => {
              if (alive) setMemoryView(data ?? null)
            })
            .catch(() => {})
        pull()
        const timer = setInterval(pull, 15000)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [enabled, memoryOn, memoryCall, sessionId])
      React.useEffect(() => {
        if (enabled && sessionId !== '') void cardsCall({ op: 'list' }).then((data) => setCards(Array.isArray(data?.cards) ? data.cards : [])).catch(() => {})
      }, [enabled, cardsCall, sessionId])
      // 头像：PNG 卡导入时存了原图，按需取回做成 blob URL（只取一次）。
      React.useEffect(() => {
        for (const card of cards) {
          if (card.hasAvatar !== true || avatars[card.id] !== undefined) continue
          setAvatars((current) => ({ ...current, [card.id]: '' }))
          void cardsCall({ op: 'avatar', id: card.id })
            .then((data) => {
              if (typeof data?.png !== 'string') return
              const binary = atob(data.png)
              const bytes = new Uint8Array(binary.length)
              for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at)
              const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }))
              setAvatars((current) => ({ ...current, [card.id]: url }))
            })
            .catch(() => {})
        }
      }, [cards, cardsCall])

      // 开场对话：编辑后 700ms 落盘。
      React.useEffect(() => {
        if (!enabled || items === null || !dirty.current) return undefined
        const timer = setTimeout(() => {
          dirty.current = false
          setStatus('saving')
          void postJson(DRAFT_ROUTE, { sessionId, items })
            .then(() => setStatus('saved'))
            .catch(() => setStatus('error'))
        }, 700)
        return () => clearTimeout(timer)
      }, [items, enabled, sessionId])

      const state = envelope?.state ?? null
      const gateMode = state?.gate?.[sessionId] === 'pure' ? 'pure' : state?.gate?.[sessionId] === 'replace' ? 'replace' : 'pass'
      const storedSystem = state?.overrides?.[sessionId]?.sections?.[PERSONA_SECTION]
      const activePreset = state?.activePreset?.[sessionId] ?? ''
      const turns = envelope?.turns?.[sessionId] ?? 0
      const injectMode = turns > 0
      const injectCount = envelope?.injects?.[sessionId] ?? 0
      const conflict = envelope?.conflicts?.[sessionId]
      const pending = Array.isArray(envelope?.pendingReprime) && envelope.pendingReprime.includes(sessionId)
      // 系统提示模式：不改 / 追加 / 接管（接管 = 闸门 pure + 人格段；纯净 = 闸门 pure + 无人格段）。
      const systemText = systemDraft ?? (typeof storedSystem === 'string' ? storedSystem : '')
      const systemMode = gateMode === 'pure' ? 'takeover' : gateMode === 'replace' ? 'replace' : typeof storedSystem === 'string' && storedSystem.trim() !== '' ? 'append' : 'off'

      // 系统提示：编辑后 800ms 落盘（写 overrides[session].sections['prefill:persona']）。
      React.useEffect(() => {
        if (systemDraft === null || !systemDirty.current || sessionId === '') return undefined
        const timer = setTimeout(() => {
          systemDirty.current = false
          void writeSystem(systemDraft, undefined).catch(() => setStatus('error'))
        }, 800)
        return () => clearTimeout(timer)
      }, [systemDraft, sessionId])

      // 用量：展开时每 4 秒刷新一次。
      React.useEffect(() => {
        if (!open.usage || sessionId === '') return undefined
        let alive = true
        const load = () =>
          void postJson(USAGE_ROUTE, { sessionId })
            .then((data) => {
              if (alive) setUsage(data)
            })
            .catch(() => {})
        load()
        const timer = setInterval(load, 4000)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [open.usage, sessionId])

      // 每轮注入的自动判定（v0.9）：每 4 秒刷新一次（只读，算一次很便宜）。折叠时也刷，节标题上要显示状态。
      React.useEffect(() => {
        if (sessionId === '') return undefined
        let alive = true
        const load = () =>
          void postJson(PACKS_ROUTE, { sessionId, op: 'every-turn-status' })
            .then((data) => {
              if (alive) setEveryTurnStatus(data?.status ?? null)
            })
            .catch(() => {})
        load()
        const timer = setInterval(load, 4000)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [sessionId])

      if (sessionId === '' || !enabled || items === null) return null

      const collapseKey = `dsh-prefill:collapsed:${sessionId}`
      let remembered = null
      try {
        remembered = window.localStorage.getItem(collapseKey)
      } catch {
        remembered = null
      }
      const isCollapsed = collapsed ?? (remembered === null ? (envelope?.turns?.[sessionId] ?? 0) > 0 : remembered === '1')
      const setCollapsedRemembered = (value) => {
        setCollapsed(value)
        try {
          window.localStorage.setItem(collapseKey, value ? '1' : '0')
        } catch {
          // 存不了就只在本次生效。
        }
      }

      const toggle = (key) => setOpen((current) => ({ ...current, [key]: !current[key] }))
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
      const armConfirm = (key) => {
        if (confirming === key) return true
        setConfirming(key)
        setTimeout(() => setConfirming((current) => (current === key ? '' : current)), 4000)
        return false
      }

      /**
       * 写系统提示：`text` = 人格段正文（空 = 不改）；`mode` = 'off' | 'append' | 'takeover' | undefined（不动模式）。
       * 接管 = `gate[sid]='pure'`（闸门逐名清空 harness 的段、拦掉注入与工具），人格段作为唯一一段留下。
       */
      const writeSystem = async (text, mode, extra) => {
        const fresh = await postJson(STATE_ROUTE, undefined)
        const current = fresh?.state?.overrides?.[sessionId] ?? {}
        const sections = { ...(current.sections ?? {}) }
        if (typeof text === 'string' && text.trim() !== '') sections[PERSONA_SECTION] = text
        else delete sections[PERSONA_SECTION]
        const entry = { messages: { ...(current.messages ?? {}) }, sections, contexts: { ...(current.contexts ?? {}) } }
        const empty = Object.keys(entry.messages).length + Object.keys(entry.sections).length + Object.keys(entry.contexts).length === 0
        const patch = {
          overrides: empty ? without(fresh?.state?.overrides, sessionId) : { ...(fresh?.state?.overrides ?? {}), [sessionId]: entry },
          ...(extra ?? {}),
        }
        if (mode !== undefined) {
          patch.gate = { ...(fresh?.state?.gate ?? {}), [sessionId]: mode === 'takeover' ? 'pure' : mode === 'replace' ? 'replace' : 'pass' }
          // 旧版「纯净模式」写的是全局开关 + armed；这里顺手把本会话从 armed 里摘掉，免得关不掉。
          if (mode !== 'takeover') {
            patch.armed = (fresh?.state?.armed ?? []).filter((id) => id !== sessionId)
            patch.sessionTools = without(fresh?.state?.sessionTools, sessionId)
          } else {
            patch.sessionTools = { ...(fresh?.state?.sessionTools ?? {}), [sessionId]: [] }
          }
        }
        injectionDrafts.set(sessionId, entry)
        const data = await postJson(STATE_ROUTE, patch)
        setEnvelope(data)
        notifyStateChanged()
        return data
      }

      const setSystemMode = (mode) => {
        void writeSystem(systemText, mode)
          .then(() => {
            if (mode === 'takeover' && systemText.trim() === '') flash(t('takeoverEmpty'))
            else flash(injectMode ? t('appliedNextTurn') : t('appliedFirstTurn'))
          })
          .catch(() => setStatus('error'))
      }

      // ── 预设 ────────────────────────────────────────────────────────────────
      const applyBuiltin = async (summary, mode) => {
        const data = await packsCall({ op: 'builtin', id: summary.id })
        const preset = data?.pack
        if (preset === null || preset === undefined) throw new Error('missing preset')
        const fresh = await postJson(STATE_ROUTE, undefined)
        const activeMap = { ...(fresh?.state?.activePreset ?? {}), [sessionId]: `builtin:${summary.id}` }
        if (preset.pure === true) {
          // 纯净：系统提示 0、上下文 0、工具 0、只放行你的话（与预填装）。
          systemDirty.current = false
          setSystemDraft('')
          setEveryTurnDraft(null)
          await writeSystem('', 'takeover', {
            activePreset: activeMap,
            injects: without(fresh?.state?.injects, sessionId),
            ...presetLeftovers(fresh?.state),
          })
          flash(injectMode ? t('appliedNextTurn') : t('pureApplied'))
          return
        }
        const text = preset.overrides?.sections?.[PERSONA_SECTION] ?? ''
        systemDirty.current = false
        setSystemDraft(text)
        // 开场白：只在"还没写东西、会话也没开跑"时填入，不覆盖用户已有内容。
        // 先落草稿再写状态：写状态会广播刷新，晚了会被 host 的旧草稿盖掉。
        const opening = Array.isArray(preset.items) && preset.items.length > 0 && items.length === 0 && !injectMode
        if (opening) {
          dirty.current = true // 挡住写状态后的广播刷新，别让 host 的空草稿盖掉
          setItems(preset.items)
        }
        const nextMode = preset.takeover === true ? 'takeover' : preset.replace === true ? 'replace' : mode
        setEveryTurnDraft(null)
        await writeSystem(text, nextMode, { activePreset: activeMap, ...presetLeftovers(fresh?.state) })
        if (opening) {
          // 草稿后写：草稿路由会按**已生效的新系统提示**预热合成轮。
          await postJson(DRAFT_ROUTE, { sessionId, items: preset.items })
          dirty.current = false
          setStatus('saved')
        }
        if (preset.takeover === true || preset.replace === true) setOpen((current) => ({ ...current, system: true }))
        flash(injectMode ? t('appliedNextTurn') : t('appliedFirstTurn'))
      }

      /** 挂在预设下、但不经 writeSystem 的几项：角色卡引用、世界书、故事记忆、每轮注入——换 / 取消预设时一并归位。 */
      const presetLeftovers = (st) => ({
        cardRef: without(st?.cardRef, sessionId),
        lore: without(st?.lore, sessionId),
        memory: without(st?.memory, sessionId),
        // 回到「新会话默认」（'*'），不是硬关。
        everyTurn: without(st?.everyTurn, sessionId),
      })

      const clearPreset = async () => {
        const fresh = await postJson(STATE_ROUTE, undefined)
        systemDirty.current = false
        setSystemDraft('')
        // 取消套用 = 预设带来的东西全部归位（开场对话留着：那是你正在写的草稿 / 已发生的历史）。
        const extra = { activePreset: without(fresh?.state?.activePreset, sessionId), ...presetLeftovers(fresh?.state) }
        setEveryTurnDraft(null)
        await writeSystem('', 'off', extra)
        flash(t('presetCleared'))
      }

      const applyPack = async (name) => {
        const data = await packsCall({ op: 'get', name })
        const pack = data?.pack
        if (pack === null || pack === undefined) throw new Error('missing pack')
        edit(Array.isArray(pack.items) ? pack.items : [])
        setPackName(name)
        const fresh = await postJson(STATE_ROUTE, undefined)
        const st = fresh?.state ?? {}
        // 套用 = **整体替换**（0.10）：面板上挂在预设下的每一项都以预设为准，预设里没有的一项恢复默认，
        // 不再保留上一个预设 / 手动设置的残留。运行时状态（自动收放的 since / override）不在预设里，从头判断。
        const patch = { activePreset: { ...(st.activePreset ?? {}), [sessionId]: `pack:${name}` } }
        // ① 角色卡：只存引用，按 id + 选项现编译，世界书和故事记忆跟卡走；卡片不在了就跳过。
        let cardMissing = false
        let compiled = null
        if (pack.card?.id) {
          const res = await cardsCall({ op: 'compile', id: pack.card.id, options: cardOptions({ ...DEFAULT_CARD_OPTS, ...(pack.card.opts ?? {}) }) }).catch(() => null)
          compiled = res?.compiled ?? null
          cardMissing = compiled === null
        }
        patch.cardRef = compiled ? { ...(st.cardRef ?? {}), [sessionId]: { id: pack.card.id, opts: pack.card.opts ?? {} } } : without(st.cardRef, sessionId)
        patch.lore = compiled?.lore ? { ...(st.lore ?? {}), [sessionId]: compiled.lore } : without(st.lore, sessionId)
        patch.memory = compiled?.memory?.enabled ? { ...(st.memory ?? {}), [sessionId]: compiled.memory } : without(st.memory, sessionId)
        // ② 系统提示 + 改写注入内容。
        const overrides = pack.overrides !== undefined && pack.overrides !== null ? pack.overrides : { messages: {}, sections: {}, contexts: {} }
        injectionDrafts.set(sessionId, overrides)
        patch.overrides = pack.overrides ? { ...(st.overrides ?? {}), [sessionId]: pack.overrides } : without(st.overrides, sessionId)
        const text = overrides?.sections?.[PERSONA_SECTION]
        systemDirty.current = false
        setSystemDraft(typeof text === 'string' ? text : '')
        patch.gate = { ...(st.gate ?? {}), [sessionId]: pack.gate === 'pure' || pack.gate === 'replace' ? pack.gate : 'pass' }
        patch.armed = (st.armed ?? []).filter((id) => id !== sessionId)
        // ③ 工具权限：预设没存 = 默认放行。
        patch.sessionTools = pack.tools !== undefined && pack.tools !== null ? { ...(st.sessionTools ?? {}), [sessionId]: pack.tools } : without(st.sessionTools, sessionId)
        // ④ 每轮注入：只有配置；预设没存 = 回到「新会话默认」。
        patch.everyTurn = pack.everyTurn ? { ...(st.everyTurn ?? {}), [sessionId]: pack.everyTurn } : without(st.everyTurn, sessionId)
        setEveryTurnDraft(null)
        // 故事记忆摘要：本会话开着故事记忆（预设带了角色卡）⇒ 写成初始记忆；否则作为一条背景放在开场对话最前面。
        const memoryOn = compiled?.memory?.enabled === true
        const seed = typeof pack.memorySeed?.text === 'string' && pack.memorySeed.text.trim() !== '' ? pack.memorySeed.text.trim() : ''
        if (seed !== '' && !memoryOn && !injectMode) {
          const base = Array.isArray(pack.items) ? pack.items : []
          edit([{ role: 'user', text: memorySeedText(seed) }, ...base])
        }
        setEnvelope(await postJson(STATE_ROUTE, patch))
        if (seed !== '' && memoryOn) await memoryCall({ op: 'set', text: seed })
        notifyStateChanged()
        flash(cardMissing ? t('packCardMissing') : seed !== '' ? t('memorySeedApplied') : injectMode ? t('appliedNextTurn') : t('appliedFirstTurn'))
      }

      // ── 角色卡（v0.6）────────────────────────────────────────────────────────
      const cardOptions = (opts) => ({
        mode: opts.mode,
        greeting: opts.greeting,
        userName: opts.userName,
        reinforce: { enabled: opts.reinforce },
        thinking: { language: opts.thinkZh ? 'zh' : null, firstPerson: opts.firstPerson },
        tools: opts.tools.trim() === '' ? null : opts.tools.split(/[,，\s]+/).filter((name) => name !== ''),
        lore: opts.lore,
        memory: opts.memory,
      })
      const previewCard = (id, opts) => {
        if (id === '') {
          setCardPreview(null)
          return
        }
        void cardsCall({ op: 'compile', id, options: cardOptions(opts) })
          .then((data) => setCardPreview(data?.compiled ?? null))
          .catch(() => setCardPreview(null))
      }
      const pickCard = (summary) => {
        const next = { ...cardOpts, mode: summary.mode === 'pure' ? 'pure' : 'agent', greeting: 0 }
        setCardPick(summary.id)
        setCardOpts(next)
        previewCard(summary.id, next)
      }
      const editCardOpts = (patch) => {
        const next = { ...cardOpts, ...patch }
        setCardOpts(next)
        previewCard(cardPick, next)
      }
      const applyCard = async () => {
        const summary = cards.find((card) => card.id === cardPick)
        if (summary === undefined) return
        const data = await cardsCall({ op: 'compile', id: cardPick, options: cardOptions(cardOpts) })
        const compiled = data?.compiled
        if (compiled === undefined || compiled === null) {
          flash(String(data?.reason ?? 'error'))
          return
        }
        const fresh = await postJson(STATE_ROUTE, undefined)
        const activeMap = { ...(fresh?.state?.activePreset ?? {}), [sessionId]: `card:${cardPick}` }
        systemDirty.current = false
        setSystemDraft(compiled.systemText)
        // 开场白：规则同内置预设 —— 只在还没写东西、会话也没开跑时填入。
        const opening = compiled.items.length > 0 && items.length === 0 && !injectMode
        if (opening) {
          dirty.current = true
          setItems(compiled.items)
        }
        // 每轮提醒只写本会话这一格，不碰「新会话默认」（'*'）。
        const everyTurnMap = { ...(fresh?.state?.everyTurn ?? {}), [sessionId]: compiled.everyTurn }
        // 世界书关键词条目：存进 state.lore[会话]，闸门每轮匹配；卡片没有关键词条目就清掉这一格。
        const loreMap = compiled.lore ? { ...(fresh?.state?.lore ?? {}), [sessionId]: compiled.lore } : without(fresh?.state?.lore, sessionId)
        // 故事记忆（三期）：开着就写 state.memory[会话]，闸门每 N 轮在后台总结一次；关掉就清这一格（已有摘要文件保留，可在面板清空）。
        const memoryMap = compiled.memory?.enabled ? { ...(fresh?.state?.memory ?? {}), [sessionId]: compiled.memory } : without(fresh?.state?.memory, sessionId)
        await writeSystem(compiled.systemText, compiled.systemMode, { activePreset: activeMap, everyTurn: everyTurnMap, lore: loreMap, memory: memoryMap, cardRef: { ...(fresh?.state?.cardRef ?? {}), [sessionId]: { id: cardPick, opts: cardOpts } } })
        if (compiled.mode === 'agent' && Array.isArray(compiled.tools)) {
          const again = await postJson(STATE_ROUTE, undefined)
          setEnvelope(await postJson(STATE_ROUTE, { sessionTools: { ...(again?.state?.sessionTools ?? {}), [sessionId]: compiled.tools } }))
        }
        setEveryTurnDraft(null)
        if (opening) {
          await postJson(DRAFT_ROUTE, { sessionId, items: compiled.items })
          dirty.current = false
          setStatus('saved')
        }
        notifyStateChanged()
        flash(t('cardApplied').replace('{name}', summary.name))
      }
      const importCardFile = (event) => {
        const file = event?.target?.files?.[0]
        if (file === undefined) return
        const reader = new FileReader()
        const done = (data) => {
          setCards(Array.isArray(data?.cards) ? data.cards : [])
          if (data?.ok === false) flash(`${t('cardImportBad')}${data?.reason ?? ''}`)
          else {
            flash(t('cardImported').replace('{name}', data?.name ?? file.name))
            const added = (data?.cards ?? []).find((card) => card.id === data?.id)
            if (added !== undefined) pickCard(added)
          }
        }
        if (/\.png$/i.test(file.name) || file.type === 'image/png') {
          reader.onload = () => {
            const bytes = new Uint8Array(reader.result)
            let binary = ''
            for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
            void cardsCall({ op: 'import', png: btoa(binary) }).then(done).catch(() => setStatus('error'))
          }
          reader.readAsArrayBuffer(file)
        } else {
          reader.onload = () => void cardsCall({ op: 'import', json: String(reader.result) }).then(done).catch(() => setStatus('error'))
          reader.readAsText(file)
        }
        event.target.value = ''
      }
      const exportCardPng = async () => {
        const data = await cardsCall({ op: 'export-png', id: cardPick })
        if (typeof data?.png !== 'string') {
          flash(String(data?.reason ?? 'error'))
          return
        }
        const binary = atob(data.png)
        const bytes = new Uint8Array(binary.length)
        for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at)
        const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }))
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = `${data.name ?? cardPick}.png`
        anchor.click()
        setTimeout(() => URL.revokeObjectURL(url), 4000)
      }
      const exportCard = async () => {
        const data = await cardsCall({ op: 'get', id: cardPick })
        if (data?.card === undefined) return
        const blob = new Blob([`${JSON.stringify(data.card, null, 2)}\n`], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = `${data.card.data?.name ?? cardPick}.json`
        anchor.click()
        setTimeout(() => URL.revokeObjectURL(url), 4000)
      }
      const deleteCard = () => {
        if (!armConfirm(`card:${cardPick}`)) return
        setConfirming('')
        void cardsCall({ op: 'delete', id: cardPick })
          .then((data) => {
            setCards(Array.isArray(data?.cards) ? data.cards : [])
            setCardPick('')
            setCardPreview(null)
          })
          .catch(() => setStatus('error'))
      }

      const currentOverrides = async () => {
        const fresh = injectionDraftOf(sessionId)
        try {
          const snapshot = await postJson(STATE_ROUTE, undefined)
          const stored = snapshot?.state?.overrides?.[sessionId] ?? {}
          return {
            messages: { ...(stored.messages ?? {}), ...(fresh.messages ?? {}) },
            sections: { ...(stored.sections ?? {}), ...(fresh.sections ?? {}) },
            contexts: { ...(stored.contexts ?? {}), ...(fresh.contexts ?? {}) },
          }
        } catch {
          return fresh
        }
      }
      const currentCardRef = async () => {
        try {
          const snapshot = await postJson(STATE_ROUTE, undefined)
          return snapshot?.state?.cardRef?.[sessionId] ?? null
        } catch {
          return null
        }
      }
      const currentTools = async () => {
        try {
          const snapshot = await postJson(STATE_ROUTE, undefined)
          const stored = snapshot?.state?.sessionTools?.[sessionId]
          return Array.isArray(stored) ? stored : null
        } catch {
          return null
        }
      }

      const savePack = () => {
        const name = packName.trim()
        if (name === '') {
          flash(t('needName'))
          return
        }
        // 保存 = 面板上挂在预设下的**全部**内容：角色卡（引用）、系统提示、每轮注入（只存配置）、开场对话、改写注入内容、工具权限。
        void Promise.all([currentOverrides(), currentTools(), currentCardRef()])
          .then(([overrides, tools, card]) =>
            packsCall({ op: 'save', name, items, overrides, tools, gate: gateMode, ...(everyTurnStored !== null ? { everyTurn: everyTurnStored } : {}), ...(card ? { card } : {}) }),
          )
          .then((data) => {
            adoptPacks(data)
            flash(`${t('savedAs')}「${name}」`)
          })
          .catch(() => setStatus('error'))
      }
      const loadHistory = (opts) => {
        const next = { ...historyOpts, ...(opts ?? {}) }
        setHistoryOpts(next)
        const toTurn = Number(next.toTurn)
        void packsCall({ op: 'from-session', reasoning: next.reasoning === true, ...(toTurn > 0 ? { toTurn } : {}) })
          .then((data) => setHistoryPreview(Array.isArray(data?.items) ? data : { items: [], turnCount: 0, lastTurn: 0, toolCalls: 0 }))
          .catch(() => setStatus('error'))
      }
      const toggleHistory = () => {
        if (historyOpen) {
          setHistoryOpen(false)
          return
        }
        setHistoryOpen(true)
        loadHistory()
      }
      const saveHistoryPack = () => {
        const name = packName.trim()
        if (name === '') {
          flash(t('needName'))
          return
        }
        const historyItems = historyPreview?.items ?? []
        if (historyItems.length === 0) {
          flash(t('historyEmpty'))
          return
        }
        void Promise.all([currentOverrides(), currentTools(), currentCardRef()])
          .then(([overrides, tools, card]) => {
            const toTurn = Number(historyOpts.toTurn) > 0 ? Math.floor(Number(historyOpts.toTurn)) : 0
            const extra = {}
            if (historyOpts.everyTurn !== false && historyPreview?.everyTurn) extra.everyTurn = historyPreview.everyTurn
            if (historyOpts.memory === true && historyPreview?.memoryAllowed && historyPreview?.memory) extra.memorySeed = historyPreview.memory
            if (card) extra.card = card
            return packsCall({ op: 'save', name, items: historyItems, overrides, tools, gate: gateMode, ...(toTurn > 0 ? { toTurn } : {}), ...extra })
          })
          .then((data) => {
            adoptPacks(data)
            flash(`${t('savedAs')}「${name}」`)
            setHistoryOpen(false)
          })
          .catch(() => setStatus('error'))
      }
      const deletePack = (name) => {
        if (!armConfirm(`del:${name}`)) return
        setConfirming('')
        void packsCall({ op: 'delete', name })
          .then((data) => {
            adoptPacks(data)
            flash(`${t('deleted')}「${name}」`)
          })
          .catch(() => setStatus('error'))
      }
      const exportFile = async () => {
        const name = packName.trim() === '' ? 'prefill' : packName.trim()
        // 导出 = 和「保存为预设」同一套内容：既然「预设 = 面板下面全部东西」，导出文件也要带上
        // 角色卡引用 / 每轮注入配置 / 故事记忆摘要，否则导出再导入会悄悄丢东西。
        const [overrides, tools, card] = await Promise.all([currentOverrides(), currentTools(), currentCardRef()])
        const remembered = await memoryCall({ op: 'get' }).catch(() => null)
        const memorySeed =
          typeof remembered?.memory?.text === 'string' && remembered.memory.text.trim() !== ''
            ? { text: remembered.memory.text.trim(), throughTurn: Number(remembered.memory.throughTurn) || 0 }
            : undefined
        const payload = {
          version: 2,
          name,
          items,
          overrides,
          tools,
          gate: gateMode,
          ...(everyTurnStored !== null ? { everyTurn: everyTurnStored } : {}),
          ...(card === null || card === undefined ? {} : { card }),
          ...(memorySeed === undefined ? {} : { memorySeed }),
        }
        const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = `${name}.prefill.json`
        anchor.click()
        setTimeout(() => URL.revokeObjectURL(url), 4000)
      }
      const importFile = (event) => {
        const file = event?.target?.files?.[0]
        if (file === undefined) return
        const reader = new FileReader()
        reader.onload = () => {
          try {
            const parsed = JSON.parse(String(reader.result))
            const name = typeof parsed?.name === 'string' && parsed.name.trim() !== '' ? parsed.name.trim() : file.name.replace(/\.prefill\.json$|\.json$/i, '')
            void packsCall({ op: 'import', name, json: { ...parsed, name } })
              .then((data) => {
                adoptPacks(data)
                if (data?.reason) flash(String(data.reason))
                else flash(`${t('imported')}「${name}」`)
              })
              .catch(() => setStatus('error'))
          } catch {
            flash(t('importBad'))
          }
        }
        reader.readAsText(file)
        event.target.value = ''
      }

      const oneClickInject = () => {
        setInjectStatus('idle')
        void (async () => {
          const fresh = await postJson(STATE_ROUTE, undefined)
          const patch = { injects: { ...(fresh?.state?.injects ?? {}), [sessionId]: items } }
          setEnvelope(await postJson(STATE_ROUTE, patch))
          setInjectStatus('done')
        })().catch(() => setInjectStatus('error'))
      }
      const stopInject = () => {
        void (async () => {
          const fresh = await postJson(STATE_ROUTE, undefined)
          setEnvelope(await postJson(STATE_ROUTE, { injects: without(fresh?.state?.injects, sessionId) }))
          setInjectStatus('idle')
        })().catch(() => setInjectStatus('error'))
      }

      // ── 渲染 ───────────────────────────────────────────────────────────────
      const statusText =
        status === 'error' ? t('syncFailed') : status === 'saving' ? t('syncSaving') : status === 'saved' ? t('syncSaved') : ''
      const itemsTok = itemsTokens(items)
      const systemTok = estimateTokens(systemText)

      const presetPill = (key, { icon, emoji, name, active, onClick, onHover, tip }) =>
        h(
          'button',
          {
            key,
            type: 'button',
            title: tip,
            style: V.pill(active),
            onClick,
            onMouseEnter: onHover,
            onFocus: onHover,
            'data-prefill-preset': key,
            'aria-pressed': active ? 'true' : 'false',
          },
          glyph({ icon, emoji }),
          name,
        )
      const hoveredKey = hovered !== '' ? hovered : activePreset
      const hoveredBuiltin = builtins.find((preset) => `builtin:${preset.id}` === hoveredKey)
      const hoveredPack = packs.find((pack) => `pack:${pack.name}` === hoveredKey)
      const detail = hoveredBuiltin
        ? [
            h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } }, glyph(hoveredBuiltin), hoveredBuiltin.name),
            hoveredBuiltin.desc,
            hoveredBuiltin.pure ? t('footPure') : hoveredBuiltin.takeover ? t('footTakeover') : hoveredBuiltin.replace ? `${t('footReplace')} ≈${Math.round(hoveredBuiltin.personaChars * 0.7)} tok` : `${t('footSystem')} ≈${Math.round(hoveredBuiltin.personaChars * 0.7)} tok`,
          ]
        : hoveredPack
          ? [withIcon('folder', hoveredPack.name), `${t('myPresetDesc')} · ${hoveredPack.count}${t('countSuffix')}`, '']
          : ['', t('presetsHint'), '']

      // 存预设用：本会话自己那格的配置（关着就不带）。
      const ownEveryTurn = state?.everyTurn?.[sessionId]
      const everyTurnStored =
        ownEveryTurn?.enabled === true && (String(ownEveryTurn.text ?? '').trim() !== '' || String(ownEveryTurn.firstText ?? '').trim() !== '')
          ? { enabled: true, text: ownEveryTurn.text ?? '', firstText: ownEveryTurn.firstText ?? '', untilTurn: Number(ownEveryTurn.untilTurn) || 0, mode: ownEveryTurn.mode === 'auto' || ownEveryTurn.mode === 'until' || ownEveryTurn.mode === 'always' ? ownEveryTurn.mode : Number(ownEveryTurn.untilTurn) > 0 ? 'until' : 'always', checks: Array.isArray(ownEveryTurn.checks) ? ownEveryTurn.checks : [], auto: ownEveryTurn.auto ?? {} }
          : null
      const presetsSection = (nested) => h(
        Section,
        {
          id: 'presets',
          title: t('presetsTitle'),
          meta: activePreset === '' ? t('presetsNone') : t('presetsActive'),
          open: open.presets,
          onToggle: () => toggle('presets'),
          right:
            activePreset === ''
              ? null
              : h(
                  'button',
                  {
                    type: 'button',
                    style: V.btnGhost,
                    onClick: (event) => {
                      event.stopPropagation()
                      void clearPreset().catch(() => setStatus('error'))
                    },
                  },
                  t('presetClear'),
                ),
        },
        h(
          'div',
          { style: V.pills, onMouseLeave: () => setHovered('') },
          h('span', { style: V.pillGroup }, t('groupBuiltin')),
          ...builtins.map((preset) =>
            presetPill(`builtin:${preset.id}`, {
              icon: preset.icon,
              emoji: preset.emoji,
              name: preset.name,
              active: activePreset === `builtin:${preset.id}`,
              tip: preset.desc,
              onHover: () => setHovered(`builtin:${preset.id}`),
              onClick: () => void applyBuiltin(preset, systemMode === 'takeover' ? 'takeover' : 'append').catch(() => setStatus('error')),
            }),
          ),
          packs.length > 0 ? h('span', { style: { ...V.pillGroup, marginLeft: 6 } }, t('groupMine')) : null,
          ...packs.map((pack) =>
            presetPill(`pack:${pack.name}`, {
              icon: 'folder',
              name: pack.name,
              active: activePreset === `pack:${pack.name}`,
              onHover: () => setHovered(`pack:${pack.name}`),
              onClick: () => void applyPack(pack.name).catch(() => setStatus('error')),
            }),
          ),
        ),
        h(
          'div',
          { style: V.detail },
          detail[0] ? h('span', { style: { fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } }, detail[0]) : null,
          h('span', null, detail[1]),
          detail[2] ? h('span', { style: { color: 'var(--dsw-alias-label-tertiary)' } }, `· ${detail[2]}`) : null,
          hoveredPack
            ? h(
                'button',
                {
                  type: 'button',
                  style: { ...V.btnGhost, color: confirming === `del:${hoveredPack.name}` ? 'var(--dsw-alias-state-warn-primary)' : V.btnGhost.color },
                  onClick: () => deletePack(hoveredPack.name),
                },
                confirming === `del:${hoveredPack.name}` ? t('confirmYes') : t('deletePack'),
              )
            : null,
        ),
        h(
          'div',
          { 'data-prefill-preset-content': '', style: { display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 10, borderLeft: '2px solid var(--dsw-alias-border-l1)' } },
          h('div', { style: V.hint }, t('presetContentHint')),
          ...nested,
        ),
        open.manage
          ? h(
          'div',
          { style: V.row },
          h('input', {
            style: { ...V.input, flex: '1 1 160px' },
            value: packName,
            placeholder: t('packNamePlaceholder'),
            spellCheck: false,
            onChange: (event) => setPackName(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') savePack()
            },
          }),
          h('button', { type: 'button', style: V.btn, onClick: savePack }, t('savePack')),
          h('button', { type: 'button', style: V.btn, 'data-prefill-history-open': '', title: t('historyTip'), onClick: toggleHistory }, t('historyOpen')),
          h('button', { type: 'button', style: V.btn, onClick: () => void exportFile() }, t('exportFile')),
          h('button', { type: 'button', style: V.btn, onClick: () => fileRef.current?.click() }, t('importFile')),
          h('button', { type: 'button', style: V.btnGhost, onClick: () => toggle('manage') }, t('manageHide')),
        )
          : h(
              'div',
              { style: V.row },
              h('button', { type: 'button', style: V.btnGhost, onClick: () => toggle('manage') }, t('manageShow')),
            ),
        open.manage && historyOpen
          ? h(
              'div',
              { style: { ...V.callout('brand'), display: 'flex', flexDirection: 'column', gap: 6 }, 'data-prefill-history': '' },
              h('div', { style: V.hint }, t('historyHint')),
              h(
                'div',
                { style: V.row },
                h(
                  'label',
                  { style: { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12 } },
                  h('input', {
                    type: 'checkbox',
                    'data-prefill-history-reasoning': '',
                    checked: historyOpts.reasoning === true,
                    onChange: (event) => loadHistory({ reasoning: event.target.checked }),
                  }),
                  t('historyReasoning'),
                ),
                h(
                  'label',
                  { style: { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12 } },
                  t('historyToTurn'),
                  h('input', {
                    type: 'number',
                    min: 1,
                    'data-prefill-history-to': '',
                    style: { ...V.input, width: 64, flex: '0 0 auto' },
                    value: historyOpts.toTurn,
                    placeholder: String(historyPreview?.lastTurn ?? ''),
                    onChange: (event) => loadHistory({ toTurn: event.target.value }),
                  }),
                  t('historyTurnUnit'),
                ),
              ),
              historyPreview?.everyTurn || historyPreview?.memory
                ? h(
                    'div',
                    { style: V.row },
                    historyPreview?.everyTurn
                      ? h(
                          'label',
                          { style: { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12 } },
                          h('input', {
                            type: 'checkbox',
                            'data-prefill-history-everyturn': '',
                            checked: historyOpts.everyTurn !== false,
                            onChange: (event) => setHistoryOpts({ ...historyOpts, everyTurn: event.target.checked }),
                          }),
                          `${t('historyWithEveryTurn')}（${t(`everyTurnMode${historyPreview.everyTurn.mode === 'auto' ? 'Auto' : historyPreview.everyTurn.mode === 'until' ? 'Until' : 'Always'}`)} · ≈${estimateTokens(historyPreview.everyTurn.text)} tok/${t('turnsUnit')}）`,
                        )
                      : null,
                    historyPreview?.memory
                      ? h(
                          'label',
                          {
                            style: { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, opacity: historyPreview.memoryAllowed ? 1 : 0.55 },
                            title: historyPreview.memoryAllowed ? '' : t('historyMemoryLate').replace('{n}', String(historyPreview.memory.throughTurn)),
                          },
                          h('input', {
                            type: 'checkbox',
                            'data-prefill-history-memory': '',
                            disabled: !historyPreview.memoryAllowed,
                            checked: historyOpts.memory === true && historyPreview.memoryAllowed === true,
                            onChange: (event) => setHistoryOpts({ ...historyOpts, memory: event.target.checked }),
                          }),
                          historyPreview.memoryAllowed ? t('historyWithMemory') : `${t('historyWithMemory')}（${t('historyMemoryLate').replace('{n}', String(historyPreview.memory.throughTurn))}）`,
                        )
                      : null,
                  )
                : null,
              h(
                'div',
                { style: V.hint, 'data-prefill-history-meta': '' },
                historyPreview === null
                  ? '…'
                  : t('historyMeta')
                      .replace('{turns}', String(historyPreview.turnCount ?? 0))
                      .replace('{n}', String(historyPreview.items?.length ?? 0))
                      .replace('{tok}', String(itemsTokens(historyPreview.items ?? [])))
                      + (historyPreview.toolCalls > 0 ? t('historyTools').replace('{n}', String(historyPreview.toolCalls)) : ''),
              ),
              h(
                'div',
                { style: V.row },
                h('button', { type: 'button', style: V.btn, 'data-prefill-history-save': '', onClick: saveHistoryPack }, t('historySave')),
                h('button', { type: 'button', style: V.btnGhost, onClick: () => setHistoryOpen(false) }, t('manageHide')),
              ),
            )
          : null,
        h('input', { ref: fileRef, type: 'file', accept: '.json,application/json', style: { display: 'none' }, onChange: importFile }),
      )

      const pickedCard = cards.find((card) => card.id === cardPick)
      const check = (key, label, extraProps) =>
        h(
          'label',
          { style: { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
          h('input', { type: 'checkbox', checked: cardOpts[key] === true, onChange: (event) => editCardOpts({ [key]: event.target.checked }), ...(extraProps ?? {}) }),
          label,
        )
      const cardsSection = h(
        Section,
        {
          id: 'cards',
          title: h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } }, h(Icon, { name: 'contact', size: 13 }), t('cardsTitle')),
          meta: cards.length > 0 ? t('cardsMeta').replace('{n}', String(cards.length)) : '',
          open: open.cards === true,
          onToggle: () => toggle('cards'),
          right: h(
            'button',
            {
              type: 'button',
              style: V.btnGhost,
              'data-prefill-card-import': '',
              onClick: (event) => {
                event.stopPropagation()
                cardFileRef.current?.click()
              },
            },
            withIcon('upload', t('cardImport'), 12),
          ),
        },
        h('div', { style: V.hint }, cards.length === 0 ? t('cardsEmpty') : t('cardsHint')),
        memoryOn
          ? h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 6 }, 'data-prefill-memory': '' },
              h(
                'div',
                { style: V.row },
                h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 600 } }, h(Icon, { name: 'scroll-text', size: 13 }), t('memoryTitle')),
                h(
                  'span',
                  { style: V.sectionMeta, 'data-prefill-memory-status': '' },
                  [
                    memoryView?.running ? t('memoryRunning') : '',
                    typeof memoryView?.memory?.text === 'string' && memoryView.memory.text !== ''
                      ? t('memoryThrough').replace('{n}', String(memoryView.memory.throughTurn ?? 0))
                      : memoryView?.running
                        ? ''
                        : t('memoryNone').replace('{n}', String(memoryConfig.every ?? 8)),
                    memoryView?.memory?.edited ? t('memoryEdited') : '',
                  ]
                    .filter((part) => part !== '')
                    .join(' · '),
                ),
                typeof memoryView?.memory?.text === 'string' && memoryView.memory.text !== ''
                  ? h(
                      'button',
                      {
                        type: 'button',
                        style: V.btnGhost,
                        'data-prefill-memory-toggle': '',
                        onClick: () => {
                          setMemoryOpen(!memoryOpen)
                          setMemoryDraft(null)
                        },
                      },
                      memoryOpen ? t('memoryHide') : t('memoryShow'),
                    )
                  : null,
              ),
              memoryOpen && typeof memoryView?.memory?.text === 'string'
                ? h('textarea', {
                    style: { ...V.input, minHeight: 140, resize: 'vertical', fontSize: 12, lineHeight: 1.5 },
                    value: memoryDraft ?? memoryView.memory.text,
                    'data-prefill-memory-text': '',
                    onChange: (event) => setMemoryDraft(event.target.value),
                  })
                : null,
              memoryOpen
                ? h(
                    'div',
                    { style: V.row },
                    h(
                      'button',
                      {
                        type: 'button',
                        style: V.btn,
                        disabled: memoryDraft === null,
                        onClick: () =>
                          void memoryCall({ op: 'set', text: memoryDraft ?? '' })
                            .then((data) => {
                              setMemoryView(data)
                              setMemoryDraft(null)
                              flash(t('memorySaved'))
                            })
                            .catch(() => setStatus('error')),
                      },
                      t('memorySave'),
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        style: V.btnGhost,
                        'data-prefill-memory-clear': '',
                        onClick: () =>
                          void memoryCall({ op: 'clear' })
                            .then((data) => {
                              setMemoryView(data)
                              setMemoryDraft(null)
                              setMemoryOpen(false)
                              flash(t('memoryCleared'))
                            })
                            .catch(() => setStatus('error')),
                      },
                      withIcon('eraser', t('memoryClear'), 12),
                    ),
                  )
                : null,
            )
          : null,
        cards.length > 0
          ? h(
              'div',
              { style: V.pills },
              ...cards.map((card) =>
                h(
                  'button',
                  {
                    key: card.id,
                    type: 'button',
                    title: card.notes || card.name,
                    style: V.pill(cardPick === card.id || activePreset === `card:${card.id}`),
                    'data-prefill-card': card.id,
                    'aria-pressed': cardPick === card.id ? 'true' : 'false',
                    onClick: () => pickCard(card),
                  },
                  avatars[card.id]
                    ? h('img', { src: avatars[card.id], alt: '', style: { width: 16, height: 16, borderRadius: '50%', objectFit: 'cover', flex: '0 0 auto' } })
                    : glyph({ icon: card.icon }),
                  card.name,
                ),
              ),
            )
          : null,
        pickedCard === undefined
          ? null
          : h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
              h(
                'div',
                { style: { ...V.detail, height: 'auto', maxHeight: 72, alignItems: 'center' } },
                avatars[pickedCard.id]
                  ? h('img', { src: avatars[pickedCard.id], alt: pickedCard.name, 'data-prefill-card-avatar': '', style: { width: 36, height: 36, borderRadius: 8, objectFit: 'cover', flex: '0 0 auto' } })
                  : null,
                h('span', { style: { fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } }, pickedCard.name),
                h(
                  'span',
                  null,
                  [
                    pickedCard.creator ? `${t('cardBy')} ${pickedCard.creator}` : '',
                    pickedCard.tags.slice(0, 4).join(' / '),
                    t('cardGreetings').replace('{n}', String(pickedCard.greetings)),
                    pickedCard.lore > 0 ? t('cardLore').replace('{n}', String(pickedCard.lore)) : '',
                    cardPreview ? `≈${estimateTokens(cardPreview.systemText)} tok` : '',
                  ]
                    .filter((part) => part !== '')
                    .join(' · '),
                ),
              ),
              h(
                'div',
                { style: V.row },
                h(
                  'div',
                  { style: V.seg, role: 'radiogroup' },
                  ...[
                    ['agent', t('cardModeAgent'), t('cardModeAgentTip'), 'wrench'],
                    ['pure', t('cardModePure'), t('cardModePureTip'), 'message-circle'],
                  ].map(([key, label, tip, icon]) =>
                    h(
                      'button',
                      {
                        key,
                        type: 'button',
                        role: 'radio',
                        title: tip,
                        'aria-checked': cardOpts.mode === key ? 'true' : 'false',
                        style: V.segBtn(cardOpts.mode === key),
                        'data-prefill-card-mode': key,
                        onClick: () => editCardOpts({ mode: key }),
                      },
                      withIcon(icon, label, 12),
                    ),
                  ),
                ),
                h('span', { style: V.sectionMeta }, t('cardGreeting')),
                h(
                  'select',
                  {
                    style: { ...V.input, flex: '0 1 220px' },
                    value: String(cardOpts.greeting),
                    'data-prefill-card-greeting': '',
                    onChange: (event) => editCardOpts({ greeting: Number(event.target.value) }),
                  },
                  ...(cardPreview?.greetings ?? []).map((text, index) => h('option', { key: index, value: String(index) }, `${index + 1}. ${text}`)),
                  h('option', { key: 'none', value: '-1' }, t('cardNoGreeting')),
                ),
              ),
              h(
                'div',
                { style: V.row },
                h('span', { style: V.sectionMeta }, t('cardUserName')),
                h('input', {
                  style: { ...V.input, flex: '0 1 160px' },
                  value: cardOpts.userName,
                  placeholder: t('cardUserNamePlaceholder'),
                  spellCheck: false,
                  'data-prefill-card-user': '',
                  onChange: (event) => setCardOpts({ ...cardOpts, userName: event.target.value }),
                  onBlur: () => previewCard(cardPick, cardOpts),
                }),
                check('reinforce', t('cardReinforce'), { 'data-prefill-card-reinforce': '' }),
                check('thinkZh', t('cardThinkZh'), { 'data-prefill-card-zh': '' }),
                check('firstPerson', t('cardFirstPerson'), { 'data-prefill-card-firstperson': '' }),
                (pickedCard.keywordLore ?? 0) > 0 ? check('lore', t('cardLoreToggle').replace('{n}', String(pickedCard.keywordLore)), { 'data-prefill-card-lore': '' }) : null,
                check('memory', t('cardMemoryToggle').replace('{n}', String(cardPreview?.memory?.every ?? 8)), { 'data-prefill-card-memory': '' }),
              ),
              cardOpts.mode === 'agent'
                ? h(
                    'div',
                    { style: V.row },
                    h('span', { style: V.sectionMeta }, t('cardTools')),
                    h('input', {
                      style: { ...V.input, flex: '1 1 240px' },
                      value: cardOpts.tools,
                      placeholder: t('cardToolsPlaceholder'),
                      spellCheck: false,
                      'data-prefill-card-tools': '',
                      onChange: (event) => setCardOpts({ ...cardOpts, tools: event.target.value }),
                    }),
                  )
                : null,
              h(
                'div',
                { style: V.row },
                h('button', { type: 'button', style: V.btn, 'data-prefill-card-apply': '', onClick: () => void applyCard().catch(() => setStatus('error')) }, withIcon('play', t('cardApply'), 12)),
                h('button', { type: 'button', style: V.btnGhost, onClick: () => void exportCard().catch(() => setStatus('error')) }, withIcon('download', t('cardExport'), 12)),
                pickedCard.hasAvatar === true
                  ? h('button', { type: 'button', style: V.btnGhost, 'data-prefill-card-export-png': '', onClick: () => void exportCardPng().catch(() => setStatus('error')) }, withIcon('image', t('cardExportPng'), 12))
                  : null,
                h(
                  'button',
                  { type: 'button', style: { ...V.btnGhost, color: confirming === `card:${cardPick}` ? 'var(--dsw-alias-state-warn-primary)' : V.btnGhost.color }, onClick: deleteCard },
                  withIcon('trash-2', confirming === `card:${cardPick}` ? t('confirmYes') : t('cardDelete'), 12),
                ),
              ),
            ),
        h('input', { ref: cardFileRef, type: 'file', accept: '.json,.png,application/json,image/png', style: { display: 'none' }, onChange: importCardFile }),
      )

      const systemSection = h(
        Section,
        {
          id: 'system',
          title: t('systemTitle'),
          meta: systemMode === 'off' ? t('systemOffMeta') : systemMode === 'append' ? `${t('systemAppendMeta')} · ≈${systemTok} tok` : systemMode === 'replace' ? `${t('systemReplaceMeta')} · ≈${systemTok} tok` : `${t('systemTakeoverMeta')} · ≈${systemTok} tok`,
          open: open.system,
          onToggle: () => toggle('system'),
        },
        h(
          'div',
          { style: V.row },
          h(
            'div',
            { style: V.seg, role: 'radiogroup' },
            ...[
              ['off', t('modeOff')],
              ['append', t('modeAppend')],
              ['replace', t('modeReplace')],
              ['takeover', t('modeTakeover')],
            ].map(([key, label]) =>
              h(
                'button',
                {
                  key,
                  type: 'button',
                  role: 'radio',
                  'aria-checked': systemMode === key ? 'true' : 'false',
                  style: V.segBtn(systemMode === key),
                  'data-prefill-mode': key,
                  onClick: () => setSystemMode(key),
                },
                label,
              ),
            ),
          ),
          pending ? h('span', { style: { ...V.sectionMeta, color: 'var(--dsw-alias-state-warn-primary)' } }, t('nextTurnNotice')) : null,
        ),
        h('div', { style: V.hint }, systemMode === 'off' ? t('modeOffHint') : systemMode === 'append' ? t('modeAppendHint') : systemMode === 'replace' ? t('modeReplaceHint') : t('modeTakeoverHint')),
        h('textarea', {
          style: { ...V.textarea, minHeight: 90 },
          value: systemText,
          spellCheck: false,
          placeholder: t('systemPlaceholder'),
          'data-prefill-system': '1',
          onChange: (event) => {
            systemDirty.current = true
            setSystemDraft(event.target.value)
          },
        }),
        systemMode === 'off' && systemText.trim() !== ''
          ? h('div', { style: V.callout('warn') }, t('systemNotActive'))
          : null,
      )

      const itemRow = (item, index) => {
        const isAssistant = item?.role === 'assistant'
        return h(
          'div',
          { key: index, style: V.itemCard(isAssistant) },
          h(
            'button',
            {
              type: 'button',
              style: S.dockRole(isAssistant),
              title: isAssistant ? t('toUser') : t('toAssistant'),
              onClick: () => patchAt(index, isAssistant ? { role: 'user', reasoning: undefined } : { role: 'assistant', reasoning: '' }),
            },
            isAssistant ? withIcon('bot', t('roleAssistant'), 13) : withIcon('user', t('roleUser'), 13),
          ),
          h(
            'div',
            { style: S.dockBody },
            h('textarea', {
              style: { ...V.textarea, minHeight: 44 },
              value: item?.text ?? '',
              spellCheck: false,
              placeholder: isAssistant ? t('textAssistantPh') : t('textUserPh'),
              onChange: (event) => patchAt(index, { text: event.target.value }),
            }),
            isAssistant
              ? h('textarea', {
                  style: S.dockThink,
                  value: item?.reasoning ?? '',
                  spellCheck: false,
                  placeholder: t('reasoningPh'),
                  onChange: (event) => patchAt(index, { reasoning: event.target.value }),
                })
              : null,
          ),
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
            h('button', { type: 'button', style: S.dockMini, title: t('moveUp'), onClick: () => move(index, -1) }, '↑'),
            h('button', { type: 'button', style: S.dockMini, title: t('moveDown'), onClick: () => move(index, 1) }, '↓'),
            h('button', { type: 'button', style: S.dockMini, title: t('removeItem'), onClick: () => edit(items.filter((_unused, at) => at !== index)) }, h(Icon, { name: 'x', size: 12 })),
          ),
        )
      }

      const itemsSection = h(
        Section,
        {
          id: 'items',
          title: t('itemsTitle'),
          meta: `${countFilled(items)}${t('countSuffix')}${countFilled(items) < items.length ? t('emptyRowsSkipped').replace('%N', String(items.length - countFilled(items))) : ''} · ≈${itemsTok} tok · ${injectMode ? t('modeInject') : t('modeHistory')}${statusText === '' ? '' : ` · ${statusText}`}`,
          open: open.items,
          onToggle: () => toggle('items'),
          right:
            items.length === 0
              ? null
              : h(
                  'button',
                  {
                    type: 'button',
                    style: V.btnGhost,
                    onClick: (event) => {
                      event.stopPropagation()
                      if (!armConfirm('clear')) return
                      setConfirming('')
                      edit([])
                    },
                  },
                  confirming === 'clear' ? t('confirmYes') : t('dockClear'),
                ),
        },
        injectMode && (envelope?.materialized?.[sessionId] ?? 0) > 0
          ? h('div', { style: V.callout('brand') }, t('itemsWrittenHint').replace('{n}', String(envelope.materialized[sessionId])))
          : null,
        h('div', { style: V.callout(injectMode ? 'warn' : 'brand') }, injectMode ? t('itemsInjectHint') : t('itemsHistoryHint')),
        items.length === 0
          ? h(
              'div',
              { style: { ...V.row, color: 'var(--dsw-alias-label-tertiary)', fontSize: 11.5 } },
              h('span', null, t('itemsEmpty')),
              h(
                'button',
                {
                  type: 'button',
                  style: V.btn,
                  onClick: () =>
                    edit([
                      { role: 'user', text: t('exampleUser') },
                      { role: 'assistant', reasoning: t('exampleReasoning'), text: t('exampleAssistant') },
                    ]),
                },
                t('fillExample'),
              ),
            )
          : null,
        h('div', { ref: listRef, style: { display: 'flex', flexDirection: 'column', gap: 6 } }, ...items.map(itemRow)),
        h(
          'div',
          { style: V.row },
          h('button', { type: 'button', style: V.btn, onClick: () => edit([...items, { role: 'user', text: '' }]) }, t('addUser')),
          h('button', { type: 'button', style: V.btn, onClick: () => edit([...items, { role: 'assistant', reasoning: '', text: '' }]) }, t('addAssistant')),
          injectMode ? h('span', { style: { flex: '1 1 auto' } }) : null,
          injectMode
            ? injectCount > 0
              ? h('button', { type: 'button', style: V.btn, onClick: stopInject }, `${t('stopInject')} (${injectCount})`)
              : null
            : null,
          injectMode && items.length > 0
            ? h(
                'button',
                { type: 'button', style: V.btnPrimary, title: t('injectNowTip'), onClick: oneClickInject, 'data-prefill-inject': '1' },
                injectCount > 0 ? t('injectUpdate') : t('injectNow'),
              )
            : null,
          injectStatus === 'idle'
            ? null
            : h('span', { style: S.dockStatus(injectStatus === 'error' ? 'error' : 'saved') }, injectStatus === 'error' ? t('injectFailed') : t('injectedNext')),
        ),
      )

      // ── 每轮注入（state.everyTurn[会话]；勾"新会话默认"时同时写 '*'）──
      const storedEveryTurn = state?.everyTurn?.[sessionId] ?? state?.everyTurn?.['*'] ?? null
      const storedMode =
        storedEveryTurn?.mode === 'auto' || storedEveryTurn?.mode === 'until' || storedEveryTurn?.mode === 'always'
          ? storedEveryTurn.mode
          : Number(storedEveryTurn?.untilTurn) > 0
            ? 'until'
            : 'always'
      const everyTurn = everyTurnDraft ?? {
        enabled: storedEveryTurn?.enabled === true,
        text: typeof storedEveryTurn?.text === 'string' ? storedEveryTurn.text : '',
        firstText: typeof storedEveryTurn?.firstText === 'string' ? storedEveryTurn.firstText : '',
        untilTurn: Number(storedEveryTurn?.untilTurn) > 0 ? Number(storedEveryTurn.untilTurn) : 0,
        mode: storedMode,
        checks: Array.isArray(storedEveryTurn?.checks) ? storedEveryTurn.checks : [],
        auto: {
          warmup: Number(storedEveryTurn?.auto?.warmup) >= 0 && storedEveryTurn?.auto?.warmup !== undefined ? Number(storedEveryTurn.auto.warmup) : 3,
          streak: Number(storedEveryTurn?.auto?.streak) > 0 ? Number(storedEveryTurn.auto.streak) : 3,
          probation: Number(storedEveryTurn?.auto?.probation) > 0 ? Number(storedEveryTurn.auto.probation) : 2,
        },
        asDefault: state?.everyTurn?.['*']?.enabled === true,
      }
      const writeEveryTurn = async (nextValue, override) => {
        setEveryTurnDraft(nextValue)
        const fresh = await postJson(STATE_ROUTE, undefined)
        const map = { ...(fresh?.state?.everyTurn ?? {}) }
        const auto = {
          warmup: Math.max(0, Math.floor(Number(nextValue.auto?.warmup) || 0)),
          streak: Math.max(1, Math.floor(Number(nextValue.auto?.streak) || 3)),
          probation: Math.max(1, Math.floor(Number(nextValue.auto?.probation) || 2)),
          // 立即恢复 / 暂停：只给动作，轮号由服务端按「下一轮」盖章；没给就沿用服务端已有的。
          ...(override ? { override: { action: override } } : {}),
        }
        const entry = {
          enabled: nextValue.enabled === true,
          text: String(nextValue.text ?? ''),
          firstText: String(nextValue.firstText ?? ''),
          untilTurn: Math.max(0, Math.floor(Number(nextValue.untilTurn) || 0)),
          mode: nextValue.mode === 'auto' || nextValue.mode === 'until' ? nextValue.mode : 'always',
          checks: Array.isArray(nextValue.checks) ? nextValue.checks : [],
          auto,
        }
        map[sessionId] = entry
        if (nextValue.asDefault === true) {
          const { override: _ignored, ...autoForDefault } = auto
          map['*'] = { ...entry, auto: autoForDefault }
        } else delete map['*']
        const data = await postJson(STATE_ROUTE, { everyTurn: map })
        setEnvelope(data)
        notifyStateChanged()
        return data
      }
      const editEveryTurn = (patch, immediate) => {
        const nextValue = { ...everyTurn, ...patch }
        setEveryTurnDraft(nextValue)
        clearTimeout(everyTurnTimer.current)
        const run = () =>
          void writeEveryTurn(nextValue)
            .then(() => flash(nextValue.enabled && (String(nextValue.text).trim() !== '' || String(nextValue.firstText ?? '').trim() !== '') ? t('everyTurnSaved') : t('everyTurnOffSaved')))
            .catch(() => setStatus('error'))
        if (immediate) run()
        else everyTurnTimer.current = setTimeout(run, 700)
      }
      const everyTurnActive = everyTurn.enabled && (everyTurn.text.trim() !== '' || everyTurn.firstText.trim() !== '')
      // 自动模式的状态文字（来自 every-turn-status；只看本会话自己的判定）。
      const autoStatus = everyTurnStatus?.enabled === true && everyTurnStatus?.mode === 'auto' ? everyTurnStatus : null
      const autoNoReasoning =
        autoStatus !== null && autoStatus.history.length >= 2 && autoStatus.history.every((row) => row.verdict === 'skip' && (row.scores?.steps ?? 0) === 0)
      const autoStateText =
        autoStatus === null
          ? ''
          : autoStatus.reason === 'no checks'
            ? t('everyTurnStateNoChecks')
            : autoNoReasoning
              ? t('everyTurnStateNoReasoning')
              : t(`everyTurnState_${autoStatus.state}`)
                  .replace('{streak}', String(autoStatus.streak ?? 0))
                  .replace('{need}', String(autoStatus.need ?? 0))
      const verdictColor = { pass: '#16a34a', weak: '#d97706', fail: '#dc2626', skip: '#9ca3af' }
      const verdictTitle = (row) => {
        const parts = [`#${row.turn}`, row.verdict, row.injected ? '⚡' : '']
        const sc = row.scores ?? {}
        if (sc.zh !== undefined && sc.zh !== null) parts.push(`zh ${Math.round(sc.zh * 100)}%`)
        if (sc.four !== undefined) parts.push(`4段 ${sc.four}`)
        if (sc.leak === true) parts.push('漏进回答')
        if (sc.outsider !== undefined) parts.push(`旁观词 ${sc.outsider + (sc.breakChar ?? 0)}`)
        return parts.filter(Boolean).join(' · ')
      }
      const setMode = (mode) =>
        editEveryTurn(
          mode === 'until'
            ? { mode, untilTurn: everyTurn.untilTurn > 0 ? everyTurn.untilTurn : 5 }
            : mode === 'always'
              ? { mode, untilTurn: 0 }
              : { mode },
          true,
        )
      const toggleCheck = (id, on) => {
        const set = new Set(everyTurn.checks)
        if (on) set.add(id)
        else set.delete(id)
        editEveryTurn({ checks: ['zh', 'four', 'noLeak', 'firstPerson'].filter((key) => set.has(key)) }, true)
      }
      const overrideNow = (action) =>
        void writeEveryTurn(everyTurn, action)
          .then(() => flash(t('everyTurnOverrideSaved')))
          .catch(() => setStatus('error'))
      const radio = (mode, label) =>
        h(
          'label',
          { key: mode, style: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 } },
          h('input', { type: 'radio', name: `prefill-everyturn-mode-${sessionId}`, checked: everyTurn.mode === mode, 'data-prefill-everyturn-mode': mode, onChange: () => setMode(mode) }),
          label,
        )
      const numberInput = (key, value, min, attr) =>
        h('input', {
          type: 'number',
          min,
          step: 1,
          value: String(value),
          style: { ...V.input, width: 52, flex: '0 0 auto' },
          [attr]: '1',
          onChange: (event) => editEveryTurn({ auto: { ...everyTurn.auto, [key]: event.target.value } }, false),
        })
      const everyTurnSection = h(
        Section,
        {
          id: 'every-turn',
          title: t('everyTurnTitle'),
          meta: everyTurnActive
            ? autoStatus !== null
              ? t('everyTurnStateMeta').replace('{state}', autoStateText)
              : `≈${estimateTokens(everyTurn.text)} tok/${t('turnsUnit')}${everyTurn.mode === 'until' && everyTurn.untilTurn > 0 ? ` · ≤${everyTurn.untilTurn}` : ''}`
            : t('everyTurnOffMeta'),
          open: open.everyTurn,
          onToggle: () => toggle('everyTurn'),
        },
        h('div', { style: V.hint }, t('everyTurnHint')),
        h(
          'label',
          { style: { ...V.row, gap: 6, fontSize: 12 } },
          h('input', {
            type: 'checkbox',
            checked: everyTurn.enabled,
            'data-prefill-everyturn-toggle': '1',
            onChange: (event) => editEveryTurn({ enabled: event.target.checked }, true),
          }),
          t('everyTurnOn'),
        ),
        h(
          'div',
          { style: { ...V.row, flexWrap: 'wrap', gap: 6 } },
          h('span', { style: V.sectionMeta }, t('everyTurnPresets')),
          ...everyTurnList.map((preset) =>
            h(
              'button',
              {
                key: preset.id,
                type: 'button',
                style: everyTurn.text === preset.text && everyTurn.firstText === (preset.firstText ?? '') ? V.btn : V.btnGhost,
                title: preset.desc,
                'data-prefill-everyturn-preset': preset.id,
                onClick: () =>
                  editEveryTurn(
                    {
                      enabled: true,
                      text: preset.text,
                      firstText: preset.firstText ?? '',
                      checks: Array.isArray(preset.checks) ? preset.checks : [],
                      // 不支持自动的预设（简短思考）选中时，从自动退回一直注入。
                      ...(everyTurn.mode === 'auto' && !Array.isArray(preset.checks) ? { mode: 'always', untilTurn: 0 } : {}),
                    },
                    true,
                  ),
              },
              h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } }, glyph(preset, 13), preset.name),
            ),
          ),
        ),
        h('div', { style: V.sectionMeta }, t('everyTurnFirstLabel')),
        h('textarea', {
          style: { ...V.textarea, minHeight: 48 },
          value: everyTurn.firstText,
          spellCheck: false,
          placeholder: t('everyTurnFirstPlaceholder'),
          'data-prefill-everyturn-first': '1',
          onChange: (event) => editEveryTurn({ firstText: event.target.value }, false),
        }),
        h('div', { style: V.sectionMeta }, t('everyTurnLaterLabel')),
        h('textarea', {
          style: { ...V.textarea, minHeight: 60 },
          value: everyTurn.text,
          spellCheck: false,
          placeholder: t('everyTurnPlaceholder'),
          'data-prefill-everyturn-text': '1',
          onChange: (event) => editEveryTurn({ text: event.target.value }, false),
        }),
        h(
          'div',
          { style: { ...V.row, gap: 10, fontSize: 12, flexWrap: 'wrap' } },
          h('span', { style: V.sectionMeta }, t('everyTurnMode')),
          radio('always', t('everyTurnModeAlways')),
          radio('until', t('everyTurnModeUntil')),
          radio('auto', t('everyTurnModeAuto')),
        ),
        everyTurn.mode === 'until'
          ? h(
              'div',
              { style: { ...V.row, gap: 6, fontSize: 12 } },
              h('span', null, t('everyTurnUntil')),
              h('input', {
                type: 'number',
                min: 1,
                step: 1,
                value: String(everyTurn.untilTurn),
                style: { ...V.input, width: 64 },
                'data-prefill-everyturn-until': '1',
                onChange: (event) => editEveryTurn({ untilTurn: event.target.value }, false),
              }),
              h('span', null, t('turnsUnit')),
            )
          : null,
        everyTurn.mode === 'auto'
          ? h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 6 }, 'data-prefill-everyturn-auto': '1' },
              h('div', { style: V.hint }, t('everyTurnAutoHint')),
              h(
                'div',
                { style: { ...V.row, gap: 10, flexWrap: 'wrap', fontSize: 12 } },
                h('span', { style: V.sectionMeta }, t('everyTurnChecks')),
                ...['zh', 'four', 'noLeak', 'firstPerson'].map((id) =>
                  h(
                    'label',
                    { key: id, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
                    h('input', { type: 'checkbox', checked: everyTurn.checks.includes(id), 'data-prefill-everyturn-check': id, onChange: (event) => toggleCheck(id, event.target.checked) }),
                    t(`everyTurnCheck_${id}`),
                  ),
                ),
              ),
              everyTurn.checks.length === 0 ? h('div', { style: V.callout('warn') }, t('everyTurnNoChecks')) : null,
              h(
                'details',
                { style: { fontSize: 12 } },
                h('summary', { style: { cursor: 'pointer', color: 'var(--dsw-alias-label-secondary)' } }, t('everyTurnAdvanced')),
                h(
                  'div',
                  { style: { ...V.row, gap: 6, flexWrap: 'wrap', marginTop: 4 } },
                  h('span', null, t('everyTurnWarmup')),
                  numberInput('warmup', everyTurn.auto.warmup, 0, 'data-prefill-everyturn-warmup'),
                  h('span', null, `${t('everyTurnTurns')} ·`),
                  h('span', null, t('everyTurnStreak')),
                  numberInput('streak', everyTurn.auto.streak, 1, 'data-prefill-everyturn-streak'),
                  h('span', null, `${t('everyTurnTurns')} ·`),
                  h('span', null, t('everyTurnProbation')),
                  numberInput('probation', everyTurn.auto.probation, 1, 'data-prefill-everyturn-probation'),
                  h('span', null, t('everyTurnTurns')),
                ),
              ),
              autoStatus !== null
                ? h(
                    'div',
                    { style: { ...V.row, gap: 8, flexWrap: 'wrap', fontSize: 12 } },
                    h('span', { 'data-prefill-everyturn-state': autoStatus.state, title: autoStatus.reason }, autoStateText),
                    h(
                      'span',
                      { style: { display: 'inline-flex', gap: 3, alignItems: 'center' }, 'data-prefill-everyturn-dots': '1' },
                      ...autoStatus.history.slice(-12).map((row) =>
                        h('span', {
                          key: row.turn,
                          title: verdictTitle(row),
                          style: {
                            width: 8,
                            height: 8,
                            borderRadius: 4,
                            boxSizing: 'border-box',
                            // 实心 = 那一轮发了注入；空心 = 没发
                            background: row.injected ? verdictColor[row.verdict] : 'transparent',
                            border: `2px solid ${verdictColor[row.verdict]}`,
                          },
                        }),
                      ),
                    ),
                    autoStatus.inject
                      ? h('button', { type: 'button', style: V.btnGhost, 'data-prefill-everyturn-pause': '1', onClick: () => overrideNow('pause') }, t('everyTurnPause'))
                      : h('button', { type: 'button', style: V.btnGhost, 'data-prefill-everyturn-resume': '1', onClick: () => overrideNow('resume') }, t('everyTurnResume')),
                  )
                : null,
            )
          : null,
        h(
          'label',
          { style: { ...V.row, gap: 6, fontSize: 12 } },
          h('input', {
            type: 'checkbox',
            checked: everyTurn.asDefault,
            'data-prefill-everyturn-default': '1',
            onChange: (event) => editEveryTurn({ asDefault: event.target.checked }, true),
          }),
          t('everyTurnDefault'),
        ),
      )

      const injectSection = h(
        Section,
        { id: 'inject', title: t('injectTitle'), meta: t('advanced'), open: open.inject, onToggle: () => toggle('inject') },
        h('div', { style: V.hint }, t('injectHint')),
        h(InjectionSection, { t, sessionId }),
      )

      const usageSection = h(
        Section,
        {
          id: 'usage',
          title: t('usageTitle'),
          meta: turns > 0 ? `${turns} ${t('turnsUnit')}` : t('usageNoTurns'),
          open: open.usage,
          onToggle: () => toggle('usage'),
        },
        h(UsagePanel, { t, usage, systemMode, systemTok, itemsTok, injectMode, injectCount, gateMode, written: (envelope?.materialized?.[sessionId] ?? 0) > 0 }),
      )

      const activeName = (() => {
        const b = builtins.find((preset) => `builtin:${preset.id}` === activePreset)
        if (b !== undefined) return b.name
        if (activePreset.startsWith('pack:')) return activePreset.slice(5)
        if (activePreset.startsWith('card:')) return cards.find((card) => `card:${card.id}` === activePreset)?.name ?? activePreset.slice(5)
        return ''
      })()
      const collapsedSummary = [
        activeName,
        systemMode === 'off' || (systemMode === 'takeover' && systemText.trim() === '')
          ? ''
          : `${t('systemTitle')}·${systemMode === 'append' ? t('systemAppendMeta') : systemMode === 'replace' ? t('systemReplaceMeta') : t('systemTakeoverMeta')}`,
        countFilled(items) > 0 ? `${countFilled(items)}${t('countSuffix')}` : '',
        everyTurnActive ? t('everyTurnTitle') : '',
      ]
        .filter((part) => part !== '')
        .join(' · ')

      const guideSection = open.guide
        ? h(
            'div',
            { style: V.callout('brand') },
            h('div', { style: { fontWeight: 600, marginBottom: 4, color: 'var(--dsw-alias-label-primary)' } }, t('guideTitle')),
            h('ol', { style: V.steps }, ...[1, 2, 3, 4, 5].map((n) => h('li', { key: n }, t(`guide${n}`)))),
          )
        : null

      return h(
        'div',
        {
          'data-prefill-dock': '1',
          style: {
            ...S.dock,
            gap: 8,
            overflowY: 'auto',
            overflowX: 'hidden',
            width: bounds?.width === undefined ? '100%' : `${bounds.width}px`,
            maxWidth: '100%',
            maxHeight: bounds?.maxHeight === undefined ? '62vh' : `${bounds.maxHeight}px`,
            margin: '0 auto',
          },
        },
        h(
          'div',
          { style: V.row },
          h('span', { style: S.dockTitle }, withIcon('puzzle', t('dockTitle'))),
          h('span', { style: S.modeChip(injectMode), title: injectMode ? t('modeInjectTip') : t('modeHistoryTip') }, injectMode ? t('modeInject') : t('modeHistory')),
          gateMode === 'pure'
            ? h('span', { style: S.modeChip(true) }, systemMode === 'takeover' && systemText.trim() !== '' ? t('chipTakeover') : t('chipPure'))
            : null,
          toast === '' ? null : h('span', { style: { ...S.dockStatus('saved'), fontWeight: 600 } }, toast),
          isCollapsed ? h('span', { style: V.sectionMeta }, collapsedSummary) : null,
          h('span', { style: { flex: '1 1 auto' } }),
          isCollapsed
            ? null
            : h('button', { type: 'button', style: V.btnGhost, onClick: () => toggle('guide'), 'aria-expanded': open.guide ? 'true' : 'false' }, open.guide ? t('guideHide') : t('guideShow')),
          h(
            'button',
            { type: 'button', style: V.btn, onClick: () => setCollapsedRemembered(!isCollapsed), 'aria-expanded': isCollapsed ? 'false' : 'true', 'data-prefill-collapse': '1' },
            isCollapsed ? t('expandPanel') : t('collapsePanel'),
          ),
        ),
        conflict
          ? h(
              'div',
              { style: S.conflictBanner },
              h('span', { style: { fontWeight: 600 } }, `${t('conflictTitle')}：${conflict.kind === 'complete-section' ? t('conflictCompleteSection') : String(conflict.kind ?? '')}`),
              conflict.advice ? h('span', { style: S.dockHint }, String(conflict.advice)) : null,
            )
          : null,
        ...(isCollapsed ? [] : [guideSection, presetsSection([cardsSection, systemSection, everyTurnSection, itemsSection, injectSection]), usageSection]),
      )
    }

    /** 「用量与缓存」：逐轮读数 + 按当前配置解释"多花了多少、缓存还命不命中"。 */
    function UsagePanel(props) {
      const t = props.t
      const usage = props.usage
      const rows = Array.isArray(usage?.turns) ? usage.turns : []
      const total = usage?.total ?? { input: 0, cacheRead: 0, output: 0 }
      const prompt = total.input + total.cacheRead
      const hit = prompt > 0 ? Math.round((total.cacheRead / prompt) * 100) : null
      const notes = []
      if (props.gateMode === 'pure') notes.push(props.systemMode === 'takeover' && props.systemTok > 0 ? t('noteTakeover') : t('notePure'))
      else if (props.systemMode === 'append') notes.push(t('noteAppend').replace('{n}', String(props.systemTok)))
      else if (props.systemMode === 'replace') notes.push(t('noteReplace').replace('{n}', String(props.systemTok)))
      if (props.injectCount > 0) notes.push(t('noteInject').replace('{n}', String(props.itemsTok)))
      else if (props.itemsTok > 0 && (!props.injectMode || props.written)) notes.push(t('noteHistory').replace('{n}', String(props.itemsTok)))
      notes.push(t('noteSwitch'))
      notes.push(t('noteMinCache'))
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        h(
          'div',
          { style: { ...V.row, gap: 18 } },
          ...[
            [fmt(total.input), t('statInput')],
            [fmt(total.cacheRead), t('statCache')],
            [fmt(total.output), t('statOutput')],
            [hit === null ? '—' : `${hit}%`, t('statHit')],
          ].map(([value, label]) => h('div', { key: label, style: V.stat }, h('span', { style: V.statValue }, value), h('span', { style: V.statLabel }, label))),
        ),
        prompt > 0
          ? h(
              'div',
              { style: V.bar, title: `${t('statCache')} ${fmt(total.cacheRead)} / ${t('statInput')} ${fmt(total.input)}` },
              h('div', { style: { width: `${(total.cacheRead / prompt) * 100}%`, background: 'var(--dsw-alias-brand-primary)' } }),
            )
          : null,
        rows.length === 0
          ? h('div', { style: V.hint }, t('usageEmpty'))
          : h(
              'div',
              { style: { maxHeight: 180, overflowY: 'auto' } },
              h(
                'table',
                { style: V.table },
                h(
                  'thead',
                  null,
                  h('tr', null, ...[t('colTurn'), t('colInput'), t('colCache'), t('colOutput'), t('colHit'), t('colSystem'), t('colTools')].map((label) => h('th', { key: label, style: V.th }, label))),
                ),
                h(
                  'tbody',
                  null,
                  ...rows.map((row) => {
                    const p = row.input + row.cacheRead
                    return h(
                      'tr',
                      { key: row.turn },
                      h('td', { style: V.td }, row.synthetic && row.steps === 0 ? `${row.turn} · ${t('syntheticTurn')}` : String(row.turn)),
                      h('td', { style: V.td }, fmt(row.input)),
                      h('td', { style: V.td }, fmt(row.cacheRead)),
                      h('td', { style: V.td }, fmt(row.output)),
                      h('td', { style: V.td }, p > 0 ? `${Math.round((row.cacheRead / p) * 100)}%` : '—'),
                      h('td', { style: V.td }, row.systemChars === null ? '—' : `${fmt(row.systemChars)} ${t('charsUnit')}`),
                      h('td', { style: V.td }, row.tools === null ? '—' : String(row.tools)),
                    )
                  }),
                ),
              ),
            ),
        h('div', { style: V.callout('') }, ...notes.map((text, index) => h('div', { key: index }, `• ${text}`))),
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

      // ⚠️ 清单（`injections.catalog` / `tools.catalog`）是**后来才填满**的：工具注册表在
      // `agent/created` 登记、段/上下文名在装配时才知道。只在挂载时取一次的话，
      // 用户会看到"工具一个都没有"（实测反馈）。所以定期只刷新 **envelope**、不动 draft。
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
      }, [call])

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
      const docs = docsFor(t)

      // ── 注入原文：UI 要把**原文**显示出来，否则用户只能盲写改写 ──────────────
      // 来源是宿主观察到的原文（消息在 pre-step、段/上下文在装配时记录）。
      const originals = envelope?.injections?.sessions?.[sessionId]?.texts ?? {
        messages: {},
        sections: {},
        contexts: {},
      }
      const originalOf = (group, name) => originals?.[group]?.[name] ?? ''

      const setField = (group, name, value) => {
        if (draft === null) return
        dirty.current = true
        const next = { ...draft, [group]: { ...draft[group] } }
        // 留空、或改回与原文一字不差 ⇒ 视为"不修改"（不留无意义的覆盖）。
        if (value === '' || value === originalOf(group, name)) delete next[group][name]
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

      // 后台若是旧壳（返回的形状里没有 catalog，或根本没有 tools 字段），明说一句，
      // 别让用户以为是"清单是空的"。实测这个症状最容易被误判成功能没做。
      const staleHost =
        (envelope?.injections !== undefined && envelope.injections.catalog === undefined) ||
        (envelope !== null && envelope !== undefined && envelope.tools === undefined)
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
          (envelope?.injections?.catalog?.sections ?? []).some((name) => looksLikeTool(name))
            ? h('span', { style: S.injectHintText }, t('injectToolHint'))
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
                ...group.names.map((name) => {
                  const original = originalOf(group.key, name)
                  const changed = draft?.[group.key]?.[name] !== undefined
                  return h(
                    'div',
                    { key: `${group.key}-${name}`, style: S.injectRow },
                    h(
                      'div',
                      { style: S.injectKeyCell },
                      h(
                        'span',
                        {
                          style: changed
                            ? { ...S.injectKey, borderColor: 'var(--dsw-alias-state-warn-primary)' }
                            : S.injectKey,
                          title: name,
                        },
                        name,
                      ),
                      // 中文说明：让人一眼知道这条注入是什么（用户要求"中文友好"）。
                      h('span', { style: S.injectDoc }, docs[name] ?? (looksLikeTool(name) ? docs.__tool : docs.__custom)),
                    ),
                    h('textarea', {
                      style: S.injectBox,
                      // **显示原文**：未改写时显示宿主给的原文，改过就显示改写。
                      value: changed ? draft[group.key][name] : original,
                      placeholder: docs.__empty,
                      spellCheck: false,
                      onChange: (event) => setField(group.key, name, event.target.value),
                    }),
                  )
                }),
              ),
            ),
          ),
        ),
        addRow,
      )
    }

    /**
     * 会话头部的位置说明（`conversation.session.header.utilities`）。
     *
     * 为什么要它：顶上的 `标准模式` 是 DSH 的 **agent preset**，与本插件的闸门 / 预注入模式
     * 是两套东西 —— 我们不注册 preset，所以切到纯净态时它仍写着"标准模式"，会误导人
     * （用户实拍问过这点）。这里把**本插件这边实际生效的模式**贴在同一个头部行里，
     * 让顶栏说的是真话；等日后做了"每包一个 preset"（§15 第 ⑥ 项）再让那颗芯片自己变。
     */
    function SessionModeBadge(props) {
      const t = props.t ?? ((key) => key)
      const sessionId = typeof props.sessionId === 'string' ? props.sessionId : ''
      const [envelope, setEnvelope] = React.useState(null)

      const call = React.useCallback(async () => {
        const response = await fetch(STATE_ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return await response.json()
      }, [])

      React.useEffect(() => {
        if (sessionId === '') return undefined
        const refresh = () => {
          void call()
            .then((data) => setEnvelope(data))
            .catch(() => {})
        }
        refresh()
        const timer = setInterval(refresh, 2500)
        window.addEventListener(STATE_EVENT, refresh)
        return () => {
          clearInterval(timer)
          window.removeEventListener(STATE_EVENT, refresh)
        }
      }, [call, sessionId])

      if (sessionId === '') return null
      // 读**当前配置**而不是"上一轮快照"：模式徽标要跟着开关立刻变，
      // 而快照只在跑过一轮之后才更新（Q9 的语义是"本轮生效值"）。
      const levers = envelope?.state?.levers ?? {}
      const armedList = Array.isArray(envelope?.state?.armed) ? envelope.state.armed : []
      const armed = armedList.includes(sessionId) || armedList.includes('*')
      const gateMap = envelope?.state?.gate ?? {}
      const pureOn =
        gateMap[sessionId] === 'pure' ||
        armed === true &&
        levers.blockSections === true &&
        levers.blockContexts === true &&
        levers.blockTools === true &&
        levers.blockMessages === true
      const filterOn = armed === true && levers.blockMessages === true
      const gate = pureOn ? 'pure' : filterOn ? 'filter' : 'pass'
      const turns = envelope?.turns?.[sessionId] ?? 0
      const injected = (envelope?.injects?.[sessionId] ?? 0) > 0
      const tools = envelope?.state?.sessionTools?.[sessionId]
      const persona = envelope?.state?.overrides?.[sessionId]?.sections?.['prefill:persona']
      const hasPersona = typeof persona === 'string' && persona.trim() !== ''
      const gateText =
        gate === 'pure'
          ? hasPersona
            ? t('chipTakeover')
            : t('chipPure')
          : hasPersona
            ? `${t('systemTitle')}·${t('systemAppendMeta')}`
            : gate === 'filter'
              ? t('stateFilter')
              : t('statePass')
      const modeText = turns > 0 ? t('modeInject') : t('modeHistory')
      const toolsText = Array.isArray(tools) ? (tools.length === 0 ? t('toolsZero') : `${tools.length} ${t('toolsUnit')}`) : ''
      const summary = [gateText, modeText, toolsText].filter((part) => part !== '').join(' · ')

      return h(
        'span',
        {
          style: S.headerBadge(gate),
          title: `${t('nav')}：${summary}`,
        },
        `${t('nav')} · ${summary}`,
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
        // 会话头部：把本插件**实际生效的模式**贴在顶栏（顶上的 agent preset 芯片不归我们
        // 管，但不能让它一家之言 —— 用户实拍问过"切了模式顶上那颗为什么不跟着变"）。
        // ⚠️ 这个槽位由 `@deepseek-ai/dsh-client-ui-conversation` 渲染，实测里它没生效
        // （可能还要更精确的客户端包注入）；所以**再挂一份**到输入框左侧 —— 那里是我们
        // 自己的座位、一定可见。等"每包一个 preset"（§15 第 ⑥ 项）做完，顶栏芯片会自己变。
        ctx.slots.inject('conversation.session.header.utilities', () =>
          ctx.slots.register(
            {
              name: 'conversation.session.header.utilities',
              id: 'prefill-mode-badge',
              order: 30,
              // 该槽位声明为 `{kind:'list', scope:'session'}`：必须显式声明作用域，
              // 框架才会把 `sessionId` 注入 props。
              scope: 'session',
              locale: NS,
            },
            SessionModeBadge,
          ),
        )
      },
    }
  },
})
