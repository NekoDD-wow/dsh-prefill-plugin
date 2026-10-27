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
     * pin / chevron-down 取自 lucide-static 1.61.0（ISC），其余 1.59.0。
     */
    const ICONS = {"bot":[["path",{"d":"M12 8V4H8"}],["rect",{"width":"16","height":"12","x":"4","y":"8","rx":"2"}],["path",{"d":"M2 14h2"}],["path",{"d":"M20 14h2"}],["path",{"d":"M15 13v2"}],["path",{"d":"M9 13v2"}]],"castle":[["path",{"d":"M10 5V3"}],["path",{"d":"M14 5V3"}],["path",{"d":"M15 21v-3a3 3 0 0 0-6 0v3"}],["path",{"d":"M18 3v8"}],["path",{"d":"M18 5H6"}],["path",{"d":"M22 11H2"}],["path",{"d":"M22 9v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9"}],["path",{"d":"M6 3v8"}]],"chevron-down":[["path",{"d":"m6 9 6 6 6-6"}]],"cat":[["path",{"d":"M12 5c.67 0 1.35.09 2 .26 1.78-2 5.03-2.84 6.42-2.26 1.4.58-.42 7-.42 7 .57 1.07 1 2.24 1 3.44C21 17.9 16.97 21 12 21s-9-3-9-7.56c0-1.25.5-2.4 1-3.44 0 0-1.89-6.42-.5-7 1.39-.58 4.72.23 6.5 2.23A9.04 9.04 0 0 1 12 5Z"}],["path",{"d":"M8 14v.5"}],["path",{"d":"M16 14v.5"}],["path",{"d":"M11.25 16.25h1.5L12 17l-.75-.75Z"}]],"contact":[["path",{"d":"M16 2v2"}],["path",{"d":"M7 21v-2a2 2 0 012-2h6a2 2 0 012 2v2"}],["path",{"d":"M8 2v2"}],["circle",{"cx":"12","cy":"10","r":"3"}],["rect",{"x":"3","y":"3","width":"18","height":"18","rx":"2"}]],"download":[["path",{"d":"M12 15V3"}],["path",{"d":"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"}],["path",{"d":"m7 10 5 5 5-5"}]],"drama":[["path",{"d":"M10 11h.01"}],["path",{"d":"M14 6h.01"}],["path",{"d":"M18 6h.01"}],["path",{"d":"M6.5 13.1h.01"}],["path",{"d":"M22 5c0 9-4 12-6 12s-6-3-6-12c0-2 2-3 6-3s6 1 6 3"}],["path",{"d":"M17.4 9.9c-.8.8-2 .8-2.8 0"}],["path",{"d":"M10.1 7.1C9 7.2 7.7 7.7 6 8.6c-3.5 2-4.7 3.9-3.7 5.6 4.5 7.8 9.5 8.4 11.2 7.4.9-.5 1.9-2.1 1.9-4.7"}],["path",{"d":"M9.1 16.5c.3-1.1 1.4-1.7 2.4-1.4"}]],"eraser":[["path",{"d":"M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21"}],["path",{"d":"m5.082 11.09 8.828 8.828"}]],"flame":[["path",{"d":"M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4"}]],"flower-2":[["path",{"d":"M12 5a3 3 0 1 1 3 3m-3-3a3 3 0 1 0-3 3m3-3v1M9 8a3 3 0 1 0 3 3M9 8h1m5 0a3 3 0 1 1-3 3m3-3h-1m-2 3v-1"}],["circle",{"cx":"12","cy":"8","r":"2"}],["path",{"d":"M12 10v12"}],["path",{"d":"M12 22c4.2 0 7-1.667 7-5-4.2 0-7 1.667-7 5Z"}],["path",{"d":"M12 22c-4.2 0-7-1.667-7-5 4.2 0 7 1.667 7 5Z"}]],"folder":[["path",{"d":"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"}]],"image":[["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2","ry":"2"}],["circle",{"cx":"9","cy":"9","r":"2"}],["path",{"d":"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"}]],"languages":[["path",{"d":"m5 8 6 6"}],["path",{"d":"m4 14 6-6 2-3"}],["path",{"d":"M2 5h12"}],["path",{"d":"M7 2h1"}],["path",{"d":"m22 22-5-10-5 10"}],["path",{"d":"M14 18h6"}]],"layout-list":[["rect",{"width":"7","height":"7","x":"3","y":"3","rx":"1"}],["rect",{"width":"7","height":"7","x":"3","y":"14","rx":"1"}],["path",{"d":"M14 4h7"}],["path",{"d":"M14 9h7"}],["path",{"d":"M14 15h7"}],["path",{"d":"M14 20h7"}]],"message-circle-question":[["path",{"d":"M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"}],["path",{"d":"M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"}],["path",{"d":"M12 17h.01"}]],"message-circle":[["path",{"d":"M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"}]],"paw-print":[["circle",{"cx":"11","cy":"4","r":"2"}],["circle",{"cx":"18","cy":"8","r":"2"}],["circle",{"cx":"20","cy":"16","r":"2"}],["path",{"d":"M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"}]],"pen-line":[["path",{"d":"M13 21h8"}],["path",{"d":"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"}]],"pin":[["path",{"d":"M12 17v5"}],["path",{"d":"M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"}]],"play":[["path",{"d":"M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"}]],"puzzle":[["path",{"d":"M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z"}]],"scan-search":[["path",{"d":"M3 7V5a2 2 0 0 1 2-2h2"}],["path",{"d":"M17 3h2a2 2 0 0 1 2 2v2"}],["path",{"d":"M21 17v2a2 2 0 0 1-2 2h-2"}],["path",{"d":"M7 21H5a2 2 0 0 1-2-2v-2"}],["circle",{"cx":"12","cy":"12","r":"3"}],["path",{"d":"m16 16-1.9-1.9"}]],"scroll-text":[["path",{"d":"M15 12h-5"}],["path",{"d":"M15 8h-5"}],["path",{"d":"M19 17V5a2 2 0 0 0-2-2H4"}],["path",{"d":"M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"}]],"scissors":[["circle",{"cx":"6","cy":"6","r":"3"}],["path",{"d":"M8.12 8.12 12 12"}],["path",{"d":"M20 4 8.12 15.88"}],["circle",{"cx":"6","cy":"18","r":"3"}],["path",{"d":"M14.8 14.8 20 20"}]],"sword":[["path",{"d":"m11 19-6-6"}],["path",{"d":"m5 21-2-2"}],["path",{"d":"m8 16-4 4"}],["path",{"d":"M9.5 17.5 20.414 6.586A2 2 0 0021 5.172V3h-2.172a2 2 0 00-1.414.586L6.5 14.5"}]],"trash-2":[["path",{"d":"M10 11v6"}],["path",{"d":"M14 11v6"}],["path",{"d":"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"}],["path",{"d":"M3 6h18"}],["path",{"d":"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"}]],"upload":[["path",{"d":"M12 3v12"}],["path",{"d":"m17 8-5-5-5 5"}],["path",{"d":"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"}]],"user":[["path",{"d":"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"}],["circle",{"cx":"12","cy":"7","r":"4"}]],"wrench":[["path",{"d":"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"}]],"x":[["path",{"d":"M18 6 6 18"}],["path",{"d":"m6 6 12 12"}]]}
    /** 有正文的条目数：空行（点了加行没填）发送时会被跳过，不算进「N 条」（issue #1）。 */
    function countFilled(items) {
      return Array.isArray(items) ? items.filter((item) => typeof item?.text === 'string' && item.text.trim() !== '').length : 0
    }

    function Icon({ name, size = 14, fill = 'none' }) {
      const shape = ICONS[name]
      if (shape === undefined) return null
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill,
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
     * 悬浮卡片（v0.10）：芯片和卡片是两个槽位组件，靠模块级表 + 窗口事件通信（不读别人的 DOM）。
     *   cardOpen[会话]   = 卡片开着没有（芯片点一下切换）；
     *   chipSummary[会话] = 卡片算好的「预设名 + 每项开关」，芯片拿来画名字和彩点。
     */
    const CARD_EVENT = 'dsh-prefill:card'
    const cardOpenMap = new Map()
    const chipSummary = new Map()
    /** 卡片被「点外面」关掉的时刻（按会话）：同一下点击落到芯片上时，芯片不再把它重新打开（v0.10.1 芯片收不起来的修复）。 */
    const autoClosedAt = new Map()
    /** 事件路径里有没有带某个属性的元素（composedPath：芯片在 shadow DOM 里时 event.target 会被改成宿主）。 */
    function pathHas(event, attr) {
      const path = typeof event?.composedPath === 'function' ? event.composedPath() : []
      for (const node of path) if (node instanceof Element && node.hasAttribute(attr)) return true
      const target = event?.target
      return target instanceof Element && target.closest(`[${attr}]`) !== null
    }
    function setCardOpen(sessionId, open) {
      cardOpenMap.set(sessionId, open === true)
      try {
        window.dispatchEvent(new CustomEvent(CARD_EVENT, { detail: { sessionId, open: open === true } }))
      } catch {
        // 忽略。
      }
    }
    function publishSummary(sessionId, summary) {
      const before = chipSummary.get(sessionId)
      if (before !== undefined && JSON.stringify(before) === JSON.stringify(summary)) return
      chipSummary.set(sessionId, summary)
      try {
        window.dispatchEvent(new CustomEvent(CARD_EVENT, { detail: { sessionId, summary: true } }))
      } catch {
        // 忽略。
      }
    }

    /** 左栏各项的颜色（CSS 变量；深浅色主题里 warn / success / tertiary 跟随 DSH）。 */
    const COLOR_VARS = {
      '--pf-card': '#e0457b',
      '--pf-system': '#7c5cff',
      '--pf-turn': 'var(--dsw-alias-state-warn-primary, #f59e0b)',
      '--pf-lore': '#0fa3a3',
      '--pf-user': '#3b82f6',
      '--pf-ai': 'var(--dsw-alias-state-success-primary, #22a06b)',
      '--pf-ws': '#8b5e34',
      '--pf-adv': 'var(--dsw-alias-label-secondary, #6b6b6b)',
      '--pf-off': 'var(--dsw-alias-border-l2, #cfcfcf)',
    }
    /** 左栏顺序（用量与缓存单列在分隔线下面，没有开关）。 */
    const FEATURE_NAV = [
      ['card', 'cards', 'var(--pf-card)'],
      ['lore', 'lore', 'var(--pf-lore)'],
      ['memory', 'memory', 'var(--pf-lore)'],
      ['system', 'system', 'var(--pf-system)'],
      ['workspace', 'workspace', 'var(--pf-ws)'],
      ['everyTurn', 'every-turn', 'var(--pf-turn)'],
      ['items', 'items', 'var(--pf-user)'],
      ['inject', 'inject', 'var(--pf-adv)'],
    ]
    /** 与 enabled.js 同一份指纹（djb2）：角色卡关掉时，服务端靠它认出「仍是套卡时原样」的几项。 */
    function fingerprint(text) {
      const source = String(text ?? '')
      let hash = 5381
      for (let at = 0; at < source.length; at += 1) hash = ((hash << 5) + hash + source.charCodeAt(at)) | 0
      return (hash >>> 0).toString(16)
    }
    /**
     * 「每轮注入」这一项开没开：左栏开关（state.enabled）+ 旧版条目自带的 enabled 一起看。
     * 0.11 之前这个开关是面板里那个「启用」勾选框，写的是 state.everyTurn[会话].enabled；
     * 两个开关并存会打架：勾选框关过、之后用左栏开关打开时 entry.enabled 还是 false
     * ⇒ everyTurnFor() 返回 undefined，开关是开的、芯片点也亮着，却一轮都不注入。
     * 规则与 enabled.js 的 everyTurnOn 一致（面板不能 import 服务端模块，抄一份，测试比对）。
     */
    function everyTurnSwitchOn(state, sessionId) {
      if (state?.enabled?.[sessionId]?.everyTurn === false) return false
      const own = state?.everyTurn?.[sessionId]
      return !(own !== null && typeof own === 'object' && own.enabled === false)
    }
    const tint = (color, pct = 12) => `color-mix(in srgb, ${color} ${pct}%, var(--dsw-alias-bg-base))`
    const num = (value) => (Number.isFinite(value) ? Math.round(value).toLocaleString('en-US') : '—')

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
        'agent-instructions': '工作区说明（AGENTS.md / CLAUDE.md）',
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
        'agent-instructions': 'Workspace instructions (AGENTS.md / CLAUDE.md)',
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
      auditLabel: '检测到的疑似未登记注入',
      auditHint: '不在默认注入清单里、却进了模型上下文的内容（例如其他插件在会话作用域里注册的上下文、直接写进会话的消息）。默认放行，只做记录。',
      auditPureLeak: '纯净模式下仍出现，请反馈',
      auditBlockSession: '本会话阻断',
      auditUnblockSession: '取消本会话阻断',
      auditRemember: '全局记住',
      auditForget: '取消全局阻断',
      auditBlockedGlobal: '已全局阻断',
      auditBlockedSession: '本会话已阻断',
      auditDirect: 'DSH 直接写入，只能记录',
      auditCount: '{n} 次',
      auditNextTurn: '下一轮生效',
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
      auditLabel: 'Suspected unregistered injections',
      auditHint: 'Content that reached the model context without being in the default injection catalog (e.g. contexts another plugin registered in the session scope, messages written straight into the session). Allowed by default and only recorded.',
      auditPureLeak: 'still present in pure mode, please report',
      auditBlockSession: 'Block in this session',
      auditUnblockSession: 'Unblock in this session',
      auditRemember: 'Remember globally',
      auditForget: 'Stop blocking globally',
      auditBlockedGlobal: 'blocked globally',
      auditBlockedSession: 'blocked in this session',
      auditDirect: 'written directly by DSH, record only',
      auditCount: '{n}×',
      auditNextTurn: 'applies next turn',
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
      historyTip: '取这个会话第 N–M 轮的用户原话和 AI 回答，放进下面的开场对话（可编辑）；再点「保存 / 另存为」存进预设，新会话套用后从这里接着聊。插件注入和工具调用不带，也不会改动本会话已经发出的历史。',
      historyReasoning: '带上思维链',
      rangeFrom: '第',
      rangeTo: '轮 到 第',
      rangeUnit: '轮',
      rangeEnd: '末',
      fetchGot: '已取到',
      fetchBig: '内容约 {tok} tok，超过 {limit} tok：套用这个预设后每个新会话首轮都要多付这么多输入，列表也会变长。确定要放进来吗？',
      fetchReplace: '替换现有',
      fetchInsert: '插入到',
      fetchAtTop: '最前面',
      fetchAfterN: '第 {n} 条后',
      fetchAtEnd: '（末尾）',
      fetchPut: '放进开场对话',
      fetchPlaced: '已放进 {n} 条，记得保存预设',
      fetchReplaced: '已替换开场对话。',
      fetchInserted: '已插入开场对话。',
      fetchCleared: '已清空开场对话。',
      undo: '撤销',
      cancel: '取消',
      rowExpand: '展开全文（≈{tok} tok）',
      rowCollapse: '收起',
      rowsLoading: '还有 {n} 条正在载入…',
      seedFetch: '从当前会话取摘要',
      seedTip: '把本会话的故事记忆摘要随预设保存；新会话套用后作为前情提要。开场对话是从会话里截取的，摘要就不能晚于截取的末轮。',
      seedReady: '保存预设时会带上摘要（覆盖到第 {n} 轮，≈{tok} tok）',
      seedNone: '这个会话还没有故事记忆摘要',
      seedLate: '摘要覆盖到第 {n} 轮，晚于开场对话截取的第 {m} 轮，不能带上',
      seedDropped: '开场对话改成只到第 {m} 轮，摘要（到第 {n} 轮）已不再带上',
      seedDrop: '不带',
      carryTitle: '带上会话里生效过的每轮约束',
      carryHint: '这些要求在原会话里靠每轮注入维持（存进开场的历史里不含注入）。勾上的会编进预设的每轮注入；新会话第一条消息那轮再提醒一次「以上历史均遵守这些要求，继续保持」。',
      carrySrcSession: '本会话设置',
      carrySrcPreset: '来自预设',
      carrySrcCard: '来自角色卡',
      carrySrcDefault: '新会话默认',
      carrySrcBuiltin: '内置积木',
      carrySrcHistory: '历史里发过',
      carryTurns: '注入过 {n} 轮',
      carryNotYet: '还没注入过',
      carryUnnamed: '每轮注入',
      collapseCard: '收起卡片',
      pinOn: '钉住',
      pinOff: '取消钉住',
      markerTip: '预填装（已钉住）· 悬停或点一下展开',
      historyMeta: '{turns} 轮 · {n} 条 · ≈{tok} tok',
      historyTools: ' · 已略过 {n} 次工具调用',
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
      everyTurnHint: '每轮在你的消息之前自动插一条提醒，模型每轮都会重新看到。实测在 step-5 上比系统提示管用得多：思维链语言、格式、人称都靠它稳住。代价：每轮多几十到一百多 token（会写进历史），前缀不变，缓存命中率基本不受影响。',
      everyTurnPresets: '常用：',
      everyTurnTowers: '积木塔：',
      benchCustom: '自己写一段',
      benchEmpty: '工作台是空的：点上面的积木按钮放一块进来。',
      benchCost: '第 1 轮 ≈{first} 字 · 之后 ≈{rest} 字/轮',
      benchChecks: '自动检查：{list}',
      benchPreview: '预览',
      benchPreviewHide: '收起预览',
      benchPreviewFirst: '第 1 轮实际发送',
      benchPreviewRest: '第 2 轮起实际发送',
      benchPreviewEmpty: '（空）',
      benchTowerLabel: '塔框：{name}',
      benchTowerRemove: '拿走整组',
      benchFromBuiltin: '内置',
      benchFromMine: '我的',
      benchEdited: '改过',
      benchExpand: '展开',
      benchCollapse: '收起',
      benchExpandAll: '全部展开',
      benchCollapseAll: '长块全部收起',
      benchFoldedMeta: '{n} 字 · 点开编辑',
      benchFirstTag: '首轮 ▾',
      benchSaveMine: '存为我的积木',
      benchMySuffix: '（我的）',
      benchOverlap: '⇄ 与「{name}」重叠',
      benchOverlapDrop: '拿掉它',
      benchPriority: '冲突时以此为准',
      blockSaved: '已存为我的积木',
      benchTowerGroup: '塔',
      benchBlockGroup: '积木',
      benchFromCard: '来自角色卡',
      benchOverlapTag: '重叠',
      benchOverlapIcon: '与台上的另一块内容重叠',
      benchOverlapNarrow: '⇄ 与 {name} 重叠',
      benchHiddenToggle: '隐藏的内置（{n}）',
      benchHiddenList: '已隐藏：',
      benchPreviewShell: '以下是本轮的背景提醒，不是用户说的话：',
      benchMoveUp: '上移',
      benchMoveDown: '下移',
      benchMenuTitle: '菜单',
      benchMenuSaveTo: '保存到「{name}」',
      benchMenuSaveToMine: '改的是我的积木，引用它的塔都会跟着变',
      benchMenuSaveToBuiltin: '内置积木 → 存为「我的版本」',
      benchMenuTowerOnly: '只改「塔」里的这块',
      benchMenuTowerOnlySub: '原积木不动',
      benchMenuSaveNewBlock: '另存为新积木…',
      benchNewBlockAsk: '新积木的名字',
      benchMenuSaveFrame: '把这个塔框存为新塔…',
      benchMenuSaveBench: '把整个工作台存为新塔…',
      benchMenuRevert: '放弃修改',
      benchMenuDrop: '从工作台拿走',
      benchMenuDeleteBlock: '删除这个积木…',
      benchMenuRename: '重命名…',
      benchMenuHide: '隐藏（设置里可找回）',
      benchMenuDeleteTower: '删除这座塔…',
      benchMenuRemoveTower: '拿走整组',
      benchMenuClose: '关闭菜单',
      benchTowerNameAsk: '给这座塔起个名字',
      benchTowerDefaultName: '我的塔',
      benchRenameAsk: '改名',
      cardTowerName: '角色卡：{name}',
      cardBlockReinforce: '角色提醒',
      cardBlockZh: '中文思考',
      cardBlockFirstPerson: '第一人称思考',
      blockDeleted: '已删除我的积木',
      towerSaved: '已存为我的塔',
      check_zh: '中文',
      check_four: '四段',
      check_noLeak: '四段没漏进回答',
      check_firstPerson: '第一人称',
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
      takeoverEmpty: '已接管：系统提示为空（= 纯净模式）。在框里写内容即成为唯一的系统提示',
      // 角色卡（v0.6）
      cardsTitle: '角色卡',
      cardsHint: '导入 SillyTavern 角色卡（V2/V3，JSON 或 PNG）。套用在顶部预设下拉的「角色卡」组里：卡会填好系统提示、开场对话、每轮注入和工具这几格（各格标着「来自角色卡」），开场白、思考提醒、模式在对应的格里改。',
      cardUserHint: '{{user}} 展开成它',
      groupCards: '角色卡',
      source_card: '来自角色卡',
      source_preset: '来自预设',
      source_session: '本会话改过',
      sourceTip_card: '这一格是套用的角色卡编译出来的，还没改过',
      sourceTip_preset: '这一格是预设里存的',
      sourceTip_session: '这一格在本会话里改过（和套用时不一样了）；另存为预设会存下现在的样子',
      toolsTag: '工具',
      cardModeLabel: '角色卡模式',
      cardModeHint: '切换会按这个模式重新编译卡的人设，工具跟着换',
      everyTurnCardChips: '角色卡：',
      cardReinforceTip: '换成角色卡自己的每轮提醒（不带思考要求）',
      greetingEdited: '（已改过，不是卡里的开场白）',
      saveOnCard: '基于角色卡「{name}」：只存和卡不一样的格，其余套用时从卡来',
      packOnCard: '基于角色卡「{name}」',
      cardPresetDesc: '套用这张角色卡：系统提示、开场对话、每轮注入、工具都按卡来，世界书 / 故事记忆跟卡走；上一个预设的东西全部清掉。',
      cardInUse: '本会话正在用这张卡。',
      cardApplyHint: '要套用，在顶部预设下拉的「角色卡」组里选它。',
      cardUserSaved: '名字已更新（改过的格不动）',
      cardsEmpty: '还没有角色卡，点「导入」选一个 .json 或 .png 文件。',
      cardsMeta: '{n} 张',
      cardImport: '导入',
      cardExport: '导出',
      cardDelete: '删除',
      cardModeAgent: '带工具（Agent）',
      cardModePure: '纯角色扮演',
      cardModeAgentTip: '保留官方系统提示、工具和审批，角色卡追加在后面',
      cardModePureTip: '接管系统提示：只发角色卡，不带工具和运行时上下文',
      cardGreeting: '开场白',
      cardNoGreeting: '不要开场白',
      cardUserName: '我的名字',
      cardUserNamePlaceholder: '{{user}}，留空 = 你',
      cardReinforce: '角色提醒',
      cardThinkZh: '中文思考',
      cardFirstPerson: '第一人称思考',
      cardApplied: '已套用角色卡「{name}」',
      cardImported: '已导入「{name}」',
      cardImportBad: '没认出角色卡：',
      cardLore: '世界书 {n} 条',
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
      presetCleared: '已取消预设，恢复默认（开场对话草稿也已清空）',
      presetRestored: '已撤销：预设和开场对话都放回来了',
      presetUndoBar: '已取消预设，开场对话草稿也清空了。',
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
      guideTitle: '三步上手',
      guide1: '在「预设」里点一张卡片：想换人格选人格卡，想完全自己写系统提示选「自定义系统提示」，想什么都不发选「纯净模式」。',
      guide2: '「系统提示」里选模式：追加（保留 dsh 能力）/ 替换正文（工具照旧）/ 接管（像直接调 API）。框里的文字可以随时改，800 毫秒后自动保存；要停用就关掉这一项的开关，正文会保留。',
      guide3: '「开场对话」写你希望 AI 一开始就记得的对话，在发第一条消息前写好，会变成真实历史。',
      guide4: '会话已经聊过了也能改：系统提示从下一轮生效；开场对话要点「注入」才会每轮带上。',
      guide5: '展开「用量与缓存」能看到每轮实际花了多少、缓存命中多少，跟底栏的数字同源。',
      chipPure: '纯净',
      settingsWhere: '日常使用不需要来这里：在会话输入框上方点「预填装」打开面板，就能选预设、写系统提示和开场对话。这一页是开发 / 排查用的全局开关。',
      resetGlobal: '把全局开关恢复默认',
      resetTip: '关掉所有全局开关、清空「生效会话」——旧版「纯净模式」会在这里留下全局开关，导致之后套人格时连工具一起被拦。',
      toolsZero: '无工具',
      toolsUnit: '个工具',
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
      historyTip: 'Take your messages and the AI answers from turns N–M of this session into the opening dialogue below (editable); then Save / Save as to keep them in a preset. Plugin injects and tool calls are left out, and the history this session already sent is not changed.',
      historyReasoning: 'Include reasoning',
      rangeFrom: 'Turns',
      rangeTo: 'to',
      rangeUnit: '',
      rangeEnd: 'end',
      fetchGot: 'Fetched',
      fetchBig: 'About {tok} tok, more than {limit} tok: every new session using this preset pays that much extra input on turn 1, and the list gets long. Add it anyway?',
      fetchReplace: 'Replace',
      fetchInsert: 'Insert',
      fetchAtTop: 'at the top',
      fetchAfterN: 'after row {n}',
      fetchAtEnd: ' (end)',
      fetchPut: 'Add to opening dialogue',
      fetchPlaced: 'Added {n} rows — remember to save the preset',
      fetchReplaced: 'Opening dialogue replaced.',
      fetchInserted: 'Rows inserted.',
      fetchCleared: 'Opening dialogue cleared.',
      undo: 'Undo',
      cancel: 'Cancel',
      rowExpand: 'Show all (≈{tok} tok)',
      rowCollapse: 'Collapse',
      rowsLoading: '{n} more rows loading…',
      seedFetch: 'Take summary from this session',
      seedTip: 'Save this session\'s story memory summary with the preset; a new session gets it as a recap. When the opening dialogue is a cut of this session, the summary must not run past its last turn.',
      seedReady: 'The summary (through turn {n}, ≈{tok} tok) will be saved with the preset',
      seedNone: 'No story memory summary in this session yet',
      seedLate: 'The summary covers through turn {n}, after turn {m} where the opening dialogue ends — it cannot be included',
      seedDropped: 'The opening dialogue now ends at turn {m}; the summary (through turn {n}) is no longer included',
      seedDrop: 'Drop',
      carryTitle: 'Carry the per-turn constraints that were active in this session',
      carryHint: 'These requirements were kept up by per-turn injections in the original session (the history saved into the opening does not include injections). Checked ones go into the preset\'s per-turn injection; on the first message of a new session they are sent once more with "All of the conversation history above followed these requirements; keep following them."',
      carrySrcSession: 'This session',
      carrySrcPreset: 'From preset',
      carrySrcCard: 'From character card',
      carrySrcDefault: 'New-session default',
      carrySrcBuiltin: 'Built-in block',
      carrySrcHistory: 'Sent in history',
      carryTurns: 'injected in {n} turns',
      carryNotYet: 'not injected yet',
      carryUnnamed: 'Per-turn injection',
      collapseCard: 'Collapse card',
      pinOn: 'Pin',
      pinOff: 'Unpin',
      markerTip: 'Prefill (pinned) · hover or click to expand',
      historyMeta: '{turns} turns · {n} rows · ≈{tok} tok',
      historyTools: ' · {n} tool calls skipped',
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
      everyTurnHint: 'Inserts a short reminder before your message on every turn. On step-5 this steers reasoning language, format and person far better than the system prompt. Cost: a few dozen to ~100 tokens per turn (kept in history); the prefix is unchanged, so cache hits barely move.',
      everyTurnPresets: 'Presets:',
      everyTurnTowers: 'Towers:',
      benchCustom: 'Write your own',
      benchEmpty: 'The bench is empty - click a block above to stack one.',
      benchCost: 'Turn 1 ≈{first} chars · after ≈{rest}/turn',
      benchChecks: 'Auto checks: {list}',
      benchPreview: 'Preview',
      benchPreviewHide: 'Hide preview',
      benchPreviewFirst: 'Sent on turn 1',
      benchPreviewRest: 'Sent from turn 2 on',
      benchPreviewEmpty: '(empty)',
      benchTowerLabel: 'Tower: {name}',
      benchTowerRemove: 'Remove all',
      benchFromBuiltin: 'built-in',
      benchFromMine: 'mine',
      benchEdited: 'edited',
      benchExpand: 'Expand',
      benchCollapse: 'Collapse',
      benchExpandAll: 'Expand all',
      benchCollapseAll: 'Collapse long blocks',
      benchFoldedMeta: '{n} chars · click to edit',
      benchFirstTag: 'first turn ▾',
      benchSaveMine: 'Save as my block',
      benchMySuffix: ' (mine)',
      benchOverlap: '⇄ overlaps "{name}"',
      benchOverlapDrop: 'remove it',
      benchPriority: 'Takes precedence on conflict',
      blockSaved: 'Saved to my blocks',
      benchTowerGroup: 'Towers',
      benchBlockGroup: 'Blocks',
      benchFromCard: 'from card',
      benchOverlapTag: 'overlap',
      benchOverlapIcon: 'Overlaps another block on the bench',
      benchOverlapNarrow: '⇄ overlaps {name}',
      benchHiddenToggle: 'Hidden built-ins ({n})',
      benchHiddenList: 'Hidden:',
      benchPreviewShell: 'background reminder for this turn, not the user:',
      benchMoveUp: 'Move up',
      benchMoveDown: 'Move down',
      benchMenuTitle: 'Menu',
      benchMenuSaveTo: 'Save to “{name}”',
      benchMenuSaveToMine: 'Changes my block; every tower using it follows',
      benchMenuSaveToBuiltin: 'Built-in → save as “my version”',
      benchMenuTowerOnly: 'Only this one in the tower',
      benchMenuTowerOnlySub: 'The block itself stays unchanged',
      benchMenuSaveNewBlock: 'Save as a new block…',
      benchNewBlockAsk: 'Name for the new block',
      benchMenuSaveFrame: 'Save this tower frame as a new tower…',
      benchMenuSaveBench: 'Save the whole bench as a new tower…',
      benchMenuRevert: 'Discard changes',
      benchMenuDrop: 'Remove from bench',
      benchMenuDeleteBlock: 'Delete this block…',
      benchMenuRename: 'Rename…',
      benchMenuHide: 'Hide (findable in settings)',
      benchMenuDeleteTower: 'Delete this tower…',
      benchMenuRemoveTower: 'Remove all',
      benchMenuClose: 'Close menu',
      benchTowerNameAsk: 'Name for this tower',
      benchTowerDefaultName: 'My tower',
      benchRenameAsk: 'Rename',
      cardTowerName: 'Card: {name}',
      cardBlockReinforce: 'Role reminder',
      cardBlockZh: 'Chinese thinking',
      cardBlockFirstPerson: 'First-person thinking',
      blockDeleted: 'My block deleted',
      towerSaved: 'Saved as my tower',
      check_zh: 'Chinese',
      check_four: 'Four sections',
      check_noLeak: 'Sections not leaked',
      check_firstPerson: 'First person',
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
      takeoverEmpty: 'Taken over with an empty prompt (= pure). Whatever you type becomes the only system prompt',
      // character cards (v0.6)
      cardsTitle: 'Character cards',
      cardsHint: 'Import SillyTavern cards (V2/V3, JSON or PNG). Apply one from the “Character cards” group in the preset menu at the top: it fills the system prompt, opening dialogue, every-turn and tools slots (tagged “from card”); greeting, thinking reminders and mode are edited in those slots.',
      cardUserHint: '{{user}} expands to this',
      groupCards: 'Character cards',
      source_card: 'from card',
      source_preset: 'from preset',
      source_session: 'edited here',
      sourceTip_card: 'Compiled from the applied character card, unchanged',
      sourceTip_preset: 'Stored in the preset',
      sourceTip_session: 'Edited in this session (differs from what was applied); Save as stores it as it is now',
      toolsTag: 'Tools',
      cardModeLabel: 'Card mode',
      cardModeHint: 'Switching recompiles the card persona for that mode; tools follow',
      everyTurnCardChips: 'Card:',
      cardReinforceTip: 'Use the card’s own every-turn reminder (no thinking requirements)',
      greetingEdited: '(edited, not a card greeting)',
      saveOnCard: 'Based on card “{name}”: store only slots that differ from the card; the rest comes from the card when applied',
      packOnCard: 'Based on card “{name}”',
      cardPresetDesc: 'Apply this card: system prompt, opening dialogue, every-turn and tools follow the card, lorebook / story memory come with it; everything from the previous preset is cleared.',
      cardInUse: 'This session is using this card.',
      cardApplyHint: 'To apply it, pick it in the “Character cards” group of the preset menu at the top.',
      cardUserSaved: 'Name updated (edited slots kept)',
      cardsEmpty: 'No cards yet — click Import and pick a .json or .png file.',
      cardsMeta: '{n} cards',
      cardImport: 'Import',
      cardExport: 'Export',
      cardDelete: 'Delete',
      cardModeAgent: 'With tools (agent)',
      cardModePure: 'Pure roleplay',
      cardModeAgentTip: 'Keeps the official system prompt, tools and approvals; the card is appended',
      cardModePureTip: 'Takes over the system prompt: only the card, no tools or runtime context',
      cardGreeting: 'Greeting',
      cardNoGreeting: 'No greeting',
      cardUserName: 'My name',
      cardUserNamePlaceholder: '{{user}}; empty = "you"',
      cardReinforce: 'Card reminder',
      cardThinkZh: 'Reason in Chinese',
      cardFirstPerson: 'First-person reasoning',
      cardApplied: 'Applied card "{name}"',
      cardImported: 'Imported "{name}"',
      cardImportBad: 'Not a character card: ',
      cardLore: '{n} lorebook entries',
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
      presetCleared: 'Preset cleared, defaults restored (opening draft cleared too)',
      presetRestored: 'Undone: preset and opening dialogue restored',
      presetUndoBar: 'Preset cleared, opening dialogue draft cleared too.',
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
      guideTitle: 'Get started',
      guide1: 'Pick a preset card: personas change the voice, "Custom system prompt" lets you write it all, "Pure" sends nothing.',
      guide2: 'Choose the system-prompt mode: append (keeps dsh abilities) / replace body (tools stay) / take over (like a raw API call). Edits autosave; to stop sending it, turn this item’s switch off — the text is kept.',
      guide3: 'Write the opening dialogue before your first message; it becomes real history.',
      guide4: 'After the session has run: system prompt changes apply next turn; the opening dialogue needs Inject.',
      guide5: 'Open "Usage & cache" to see per-turn spend and cache hits, from the same data as the footer.',
      chipPure: 'Pure',
      settingsWhere: 'Everyday use happens in the Prefill panel above the composer (presets, system prompt, opening dialogue). This page holds developer/diagnostic global switches.',
      resetGlobal: 'Reset global switches',
      resetTip: 'Turn every global switch off and clear the affected-session list (older pure mode left them on).',
      toolsZero: 'no tools',
      toolsUnit: 'tools',
      prefillWritten: 'Prefill · in history',
      itemsWrittenHint: '✓ {n} opening rows were written into history on turn 1 (visible in the conversation).',
      prefillWrittenTip: 'The opening dialogue was written into history on turn 1 and is sent as cached history prefix from then on.',
      chipTakeover: 'Custom system',
      pureApplied: 'Pure mode active',
    })

    // ── v0.10 悬浮卡片 ──
    Object.assign(zh, {
      itemsTitle: '开场对话',
      itemsNavTitle: '开场对话',
      loreTitle: '世界书',
      loreMeta: '{n} 条关键词条目',
      loreHint: '角色卡里带关键词的设定条目：每轮扫描最近 {depth} 条消息，命中关键词的条目才注入，没命中不花 token。',
      loreEmpty: '还没有世界书。套用一张带世界书（character_book）的角色卡后，这里会列出它的关键词条目。',
      loreKeys: '关键词',
      loreEditHint: '可以直接改：改动只对本会话生效；「保存为预设」时会一起存进预设，以后套用这个预设就是改过的版本。不会改动角色卡本身。',
      loreCustomBar: '本会话的世界书和角色卡里的不一样了。',
      loreRevert: '还原成角色卡里的',
      loreEdit: '编辑',
      loreDone: '完成',
      loreDelete: '删除',
      loreAdd: '新条目',
      loreNewTitle: '新条目',
      loreTitleLabel: '标题',
      loreKeysLabel: '关键词（用 / 或逗号分隔）',
      loreContentLabel: '内容',
      loreMore: '再显示 {n} 条',
      loreSaved: '世界书已保存（本会话）',
      loreNoKeys: '没有关键词的条目不会被匹配',
      loreOffBody: '条目都还在，只是不再匹配、不再注入。打开开关即恢复。',
      loreByCardBody: '角色卡关着，它带来的这一项也一起停用；打开角色卡即恢复。',
      memoryEveryMeta: '每 {n} 轮总结一次',
      memoryHint: '每隔几轮在后台把前情总结成一段摘要，之后每轮作为背景带上，长对话也不忘事。可以查看、手改或清空。',
      memoryEmpty: '还没有故事记忆。套用角色卡时勾选「故事记忆」后，这里会显示总结进度和摘要。',
      memoryOffBody: '摘要和设置都保留，只是不再总结、不再注入。打开开关即恢复。',
      offTitle: '已停用。',
      offByCardTitle: '随角色卡停用。',
      offByCardBody: '这段仍是套用角色卡时的原样，角色卡关着时不发送；你改过之后就算你自己的，不再跟着角色卡开关。',
      cardOffBody: '套用记录还在：世界书、故事记忆，以及仍是套卡原样的系统提示和每轮注入都不发送。打开开关即恢复。',
      cardCurrent: '当前：',
      systemOffBody: '正文和模式都保留，只是不发送（替换 / 接管也退回默认提示）。打开开关即恢复。',
      everyTurnOffBody: '设置都保留，只是不再注入。打开开关即恢复。',
      itemsOffBody: '内容都保留，只是不写入历史、不注入。打开开关即恢复。',
      injectOffBody: '改写都保留，只是不生效，harness 发原文。打开开关即恢复。',
      featureOnSaved: '已打开，从下一条消息起生效',
      featureOffSaved: '已停用（内容保留），从下一条消息起生效',
      switchOnTip: '打开：恢复这一项',
      switchOffTip: '关掉：停用这一项，内容保留',
      navNone: '未套用',
      navWithCard: '随角色卡',
      navLore: ' 条 · 命中才注入',
      navMemoryEvery: '每 {n} 轮总结',
      navMemoryThrough: '已总结到第 {n} 轮',
      navSystemEmpty: '未填写',
      navModeAlways: '一直',
      navModeUntil: '前 {n} 轮',
      navNotInjected: '待点注入',
      navChanged: '改了 {n}',
      navChangedUnit: ' 处',
      navDisabled: '已停用',
      navOffByCard: '随角色卡停用',
      usageShort: '用量',
      kindMine: '我的预设',
      saveShort: '保存',
      saveAs: '另存为…',
      saveAsTip: '还没有在用的「我的预设」：起个名字存一份',
      saveOverTip: '覆盖保存到当前预设',
      saveAsHint: '把当前整套配置（角色卡、系统提示、每轮注入、开场对话、改写注入内容、工具权限和左栏开关）存成一个预设。',
      badgeFirst: '首轮',
      badgeTurn: '每轮',
      badgeCache: '缓存',
      pinTip: '点外面、按 Esc 都不会关；鼠标移开会缩成小标记',
      closeCard: '关闭',
      chipCardTip: '点一下打开 / 收起预填装卡片',
      chipNoPreset: '未套用预设',
      chipWritten: '已写入历史',
      chipOn: '开',
      chipOff: '关',
      chipEmpty: '开（未配置）',
      chipOffByCard: '随角色卡停用',
      wsTitle: '工作区说明',
      wsMeta: 'AGENTS.md / CLAUDE.md',
      wsHint: 'DSH 会把 ~/.dsh/AGENTS.md 和项目里从根目录到工作目录的 AGENTS.md / CLAUDE.md（含 .local）读进来，在第一条请求前发给模型；会话中途碰到子目录里的说明或文件改了，还会再补。这里决定它们怎么发。',
      wsModePass: '原样',
      wsModeOff: '关闭',
      wsModeRewrite: '改写',
      wsPassHint: '原样发送，不做改动。',
      wsOffHint: '一条都不发，包括会话中途补发的。',
      wsRewriteHint: '本会话第一条换成下面的正文（只进历史一次）；之后补发的不再发，免得和改写重复。正文留空 = 等同关闭。',
      wsRewritePlaceholder: '写给模型的工作区说明，代替 AGENTS.md / CLAUDE.md……',
      wsRewriteEmpty: '正文是空的：现在等同关闭。',
      wsMidSession: '本会话已经发过工作区说明。新设置从下一条请求起生效：插件补发一条说明告诉模型以新设置为准，之前那份仍留在历史里（不改历史，前缀缓存不受影响，但多一条消息）。想要干净的效果，开个新会话。',
      wsNewSessionNote: '一般在开新会话、发第一条消息前设好：这条说明在最前面，进了历史后中途再改只能追加，不能替换。',
      wsOriginal: 'DSH 读到的原文（只读）',
      wsOriginalNone: '本会话还没发出请求，或者工作区里没有 AGENTS.md / CLAUDE.md。发出第一条消息后这里显示读到的原文。',
      wsOriginalReplaced: '已被改写替换',
      wsOriginalDropped: '已关闭，不发送',
      wsOffBody: '模式和改写正文都保留，现在按原样发送。打开开关即恢复。',
      wsSaved: '工作区说明已保存',
      navWsPass: '原样',
      navWsOff: '关闭',
      navWsRewrite: '改写',
    })
    Object.assign(en, {
      itemsTitle: 'Opening dialogue',
      itemsNavTitle: 'Opening dialogue',
      loreTitle: 'Lorebook',
      loreMeta: '{n} keyword entries',
      loreHint: 'Keyword entries from the character card: each turn the last {depth} messages are scanned and only matching entries are injected.',
      loreEmpty: 'No lorebook yet. Apply a character card that has a character_book to see its keyword entries here.',
      loreKeys: 'Keys',
      loreEditHint: 'Editable: changes apply to this session only; Save as preset stores them in the preset, so applying it later gives the edited version. The character card itself is never changed.',
      loreCustomBar: 'This session\'s lorebook differs from the card.',
      loreRevert: 'Restore from card',
      loreEdit: 'Edit',
      loreDone: 'Done',
      loreDelete: 'Delete',
      loreAdd: 'New entry',
      loreNewTitle: 'New entry',
      loreTitleLabel: 'Title',
      loreKeysLabel: 'Keys (separate with / or commas)',
      loreContentLabel: 'Content',
      loreMore: 'Show {n} more',
      loreSaved: 'Lorebook saved (this session)',
      loreNoKeys: 'An entry without keys never matches',
      loreOffBody: 'Entries are kept; they are just not matched or injected. Turn it back on to restore.',
      loreByCardBody: 'The character card is off, so this is paused with it; turn the card on to restore.',
      memoryEveryMeta: 'summarizes every {n} turns',
      memoryHint: 'Every few turns the story so far is summarized in the background and sent as background each turn. You can view, edit or clear it.',
      memoryEmpty: 'No story memory yet. Tick "Story memory" when applying a character card.',
      memoryOffBody: 'The summary and settings are kept; nothing is summarized or injected. Turn it back on to restore.',
      offTitle: 'Disabled.',
      offByCardTitle: 'Paused with the character card.',
      offByCardBody: 'This is still exactly what the card set, so it is not sent while the card is off. Once you edit it, it is yours and no longer follows the card switch.',
      cardOffBody: 'The applied card is kept: its lorebook, story memory and the unchanged card system prompt / reminder are not sent. Turn it back on to restore.',
      cardCurrent: 'Current:',
      systemOffBody: 'Text and mode are kept, just not sent (replace / take over fall back to the default prompt). Turn it back on to restore.',
      everyTurnOffBody: 'Settings are kept; nothing is injected. Turn it back on to restore.',
      itemsOffBody: 'Content is kept; it is not written into history or injected. Turn it back on to restore.',
      injectOffBody: 'Rewrites are kept but not applied; the harness sends the originals. Turn it back on to restore.',
      featureOnSaved: 'Enabled, from the next message',
      featureOffSaved: 'Disabled (content kept), from the next message',
      switchOnTip: 'Turn on: restore this item',
      switchOffTip: 'Turn off: disable this item, keep its content',
      navNone: 'not applied',
      navWithCard: 'comes with a card',
      navLore: ' entries · on match',
      navMemoryEvery: 'every {n} turns',
      navMemoryThrough: 'summarized to turn {n}',
      navSystemEmpty: 'empty',
      navModeAlways: 'Always',
      navModeUntil: 'First {n}',
      navNotInjected: 'not injected',
      navChanged: '{n}',
      navChangedUnit: ' changed',
      navDisabled: 'disabled',
      navOffByCard: 'paused with card',
      usageShort: 'Usage',
      kindMine: 'My preset',
      saveShort: 'Save',
      saveAs: 'Save as…',
      saveAsTip: 'No preset of yours in use yet: name it and save',
      saveOverTip: 'Overwrite the current preset',
      saveAsHint: 'Save the whole setup (card, system prompt, every-turn reminder, opening dialogue, injection rewrites, tool permissions and the item switches) as a preset.',
      badgeFirst: 'First',
      badgeTurn: 'Per turn',
      badgeCache: 'Cache',
      pinTip: 'Clicking outside or Esc will not close it; moving the mouse away shrinks it to a small marker',
      closeCard: 'Close',
      chipCardTip: 'Click to open / close the prefill card',
      chipNoPreset: 'no preset',
      chipWritten: 'written',
      chipOn: 'on',
      chipOff: 'off',
      chipEmpty: 'on (empty)',
      chipOffByCard: 'paused with card',
      wsTitle: 'Workspace instructions',
      wsMeta: 'AGENTS.md / CLAUDE.md',
      wsHint: 'DSH reads ~/.dsh/AGENTS.md and the AGENTS.md / CLAUDE.md files (and .local) from the project root down to the working directory, and sends them before the first request; mid-session it adds more when a nested directory is touched or a file changes. This decides how they are sent.',
      wsModePass: 'As is',
      wsModeOff: 'Off',
      wsModeRewrite: 'Rewrite',
      wsPassHint: 'Sent unchanged.',
      wsOffHint: 'None are sent, including the ones added mid-session.',
      wsRewriteHint: 'The first one in this session is replaced by the text below (it enters history once); later additions are not sent so the rewrite is not duplicated. Empty text = off.',
      wsRewritePlaceholder: 'Workspace instructions for the model, in place of AGENTS.md / CLAUDE.md…',
      wsRewriteEmpty: 'The text is empty, so this currently acts as Off.',
      wsMidSession: 'Workspace instructions were already sent in this session. The new setting applies from the next request: the plugin adds a note telling the model to follow it, and the earlier copy stays in history (history is not edited, so the prefix cache is kept, at the cost of one extra message). Start a new session for a clean result.',
      wsNewSessionNote: 'Best set in a new session before the first message: these instructions sit at the very start, and once they are in history a later change can only be appended, not replaced.',
      wsOriginal: 'What DSH read (read-only)',
      wsOriginalNone: 'No request has been sent in this session yet, or the workspace has no AGENTS.md / CLAUDE.md. The original text shows up here after the first message.',
      wsOriginalReplaced: 'replaced by your rewrite',
      wsOriginalDropped: 'off, not sent',
      wsOffBody: 'Mode and rewrite text are kept; the instructions are sent as is for now. Turn it back on to restore.',
      wsSaved: 'Workspace instructions saved',
      navWsPass: 'As is',
      navWsOff: 'Off',
      navWsRewrite: 'Rewrite',
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

      // 卡片开没开 / 卡片发来的摘要（预设名 + 彩点）：都走 CARD_EVENT。
      const [, setTick] = React.useState(0)
      React.useEffect(() => {
        const onCard = (event) => {
          if (event?.detail?.sessionId === sessionId) setTick((value) => value + 1)
        }
        window.addEventListener(CARD_EVENT, onCard)
        return () => window.removeEventListener(CARD_EVENT, onCard)
      }, [sessionId])

      if (sessionId === '') return null
      const state = envelope?.state ?? null
      const map = state?.prefill !== null && typeof state?.prefill === 'object' ? state.prefill : {}
      const on = typeof map[sessionId] === 'string' && map[sessionId] !== ''
      const injected = (envelope?.injects?.[sessionId] ?? 0) > 0
      const injectMode = (envelope?.turns?.[sessionId] ?? 0) > 0
      const written = (envelope?.materialized?.[sessionId] ?? 0) > 0
      const cardOpen = cardOpenMap.get(sessionId) === true
      const summary = on ? chipSummary.get(sessionId) : undefined
      const fallback = injectMode ? (written && !injected ? t('prefillWritten') : injected ? t('injectDone') : t('injectOff')) : on ? t('prefillOn') : t('prefillOff')
      const title = on ? `${t('chipCardTip')}${summary?.tip ? `\n${summary.tip}` : ''}` : t('prefillTitleOff')

      return h(
        'button',
        {
          type: 'button',
          'aria-pressed': on ? 'true' : 'false',
          'aria-expanded': cardOpen ? 'true' : 'false',
          'data-prefill-chip': '1',
          title,
          'data-open': cardOpen ? 'true' : 'false',
          style: {
            ...S.gatePill(on),
            ...COLOR_VARS,
            gap: 6,
            maxWidth: 320,
            ...(cardOpen ? { boxShadow: '0 0 0 2px color-mix(in srgb, var(--dsw-alias-label-primary) 22%, transparent)', background: 'color-mix(in srgb, var(--dsw-alias-label-primary) 8%, var(--dsw-alias-bg-base))' } : {}),
          },
          // 纯开关：开着就收起（不看 on）；关着才打开，本会话还没用预填装时先打开它，再弹出卡片。
          onClick: () => {
            if (cardOpen) {
              setCardOpen(sessionId, false)
              return
            }
            // 同一下点击已经被「点外面」关过了（芯片没被认出来时的兜底）：保持关着。
            if (Date.now() - (autoClosedAt.get(sessionId) ?? 0) < 400) return
            if (!on) {
              void call({ prefill: { ...map, [sessionId]: 'default' } })
                .then((data) => {
                  setEnvelope(data)
                  notifyStateChanged()
                  setCardOpen(sessionId, true)
                })
                .catch(() => {})
              return
            }
            setCardOpen(sessionId, !cardOpen)
          },
        },
        summary === undefined
          ? [h('span', { key: 'dot', style: S.gateDot(on) }), h('span', { key: 'label' }, fallback)]
          : [
              h('b', { key: 'name', style: { fontWeight: 700 } }, t('nav')),
              h('span', { key: 'sep', style: { opacity: 0.5 } }, '·'),
              h('span', { key: 'preset', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 } }, summary.name || fallbackName(t, injectMode, written, injected)),
              h(
                'span',
                { key: 'dots', style: { display: 'inline-flex', gap: 3, marginLeft: 2, flex: '0 0 auto' }, 'data-prefill-chip-dots': '1' },
                ...summary.dots.map((dot) =>
                  h('i', {
                    key: dot.key,
                    'data-prefill-chip-dot': dot.key,
                    'data-on': dot.on ? 'true' : 'false',
                    style: {
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      display: 'inline-block',
                      boxSizing: 'border-box',
                      background: dot.on && dot.filled ? dot.color : dot.on ? 'transparent' : 'var(--pf-off)',
                      border: `1.5px solid ${dot.on ? dot.color : 'var(--pf-off)'}`,
                    },
                  }),
                ),
              ),
              h('span', { key: 'chev', style: { display: 'inline-flex', flex: '0 0 auto', opacity: 0.6, transition: 'transform 150ms ease', transform: cardOpen ? 'none' : 'rotate(180deg)' }, 'aria-hidden': 'true' }, h(Icon, { name: 'chevron-down', size: 12 })),
            ],
      )
    }
    function fallbackName(t, injectMode, written, injected) {
      return injectMode ? (written && !injected ? t('chipWritten') : t('chipNoPreset')) : t('chipNoPreset')
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
    const tokenCache = new Map()
    function estimateTokens(text) {
      if (typeof text !== 'string' || text === '') return 0
      // 长文本（取来的几百条思维链）每次渲染都逐字扫一遍会卡：按原文缓存，满了整表清掉。
      const cached = text.length > 64 ? tokenCache.get(text) : undefined
      if (cached !== undefined) return cached
      let cjk = 0
      for (const char of text) if (/[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(char)) cjk += 1
      const value = Math.round(cjk * 0.7 + (text.length - cjk) / 3.5)
      if (text.length > 64) {
        if (tokenCache.size > 4000) tokenCache.clear()
        tokenCache.set(text, value)
      }
      return value
    }

    function itemsTokens(items) {
      return (items ?? []).reduce((sum, item) => sum + estimateTokens(item?.text) + estimateTokens(item?.reasoning), 0)
    }

    // <fetch-helpers> 开场对话「从当前会话取」用到的纯函数（tests/card-ux.test.mjs 从源码切出来跑）。
    /** 取来的内容超过这么多 token（估算）就先提醒，确认后才放进列表。 */
    const FETCH_WARN_TOK = 20000
    /** 列表分批渲染：先画这么多条，之后每帧再加一批。 */
    const ROW_BATCH = 40
    /** 「第 N 轮 到 第 M 轮」→ from-session 的参数。N 缺省 1；M 留空 / 0 = 到最后；M < N 时对调。toTurn 0 = 到最后。 */
    function fetchRange(fromRaw, toRaw) {
      const num = (raw) => {
        const value = Math.floor(Number(String(raw ?? '').trim()))
        return Number.isFinite(value) && value > 0 ? value : 0
      }
      let fromTurn = num(fromRaw) || 1
      let toTurn = num(toRaw)
      if (toTurn > 0 && toTurn < fromTurn) [fromTurn, toTurn] = [toTurn, fromTurn]
      return { fromTurn, toTurn }
    }
    /** 把取来的条目放进列表：replace = 整个换掉；insert = 插在第 k 条后（0 = 最前，k ≥ 条数 = 追加）。不改原数组。 */
    function placeFetched(items, fetched, mode, k) {
      const list = Array.isArray(items) ? items : []
      const add = Array.isArray(fetched) ? fetched.map((item) => ({ ...item })) : []
      if (mode === 'replace') return add
      const at = Math.max(0, Math.min(list.length, Math.floor(Number(k)) || 0))
      return [...list.slice(0, at), ...add, ...list.slice(at)]
    }
    /** 故事记忆摘要能不能随预设带上：摘要覆盖到的轮次不能晚于截取范围的末轮 M（M = 0 = 到最后，总可以）。 */
    function seedAllowed(memory, toTurn) {
      if (memory === null || memory === undefined || typeof memory.text !== 'string' || memory.text.trim() === '') return false
      const to = Math.floor(Number(toTurn)) || 0
      return to <= 0 || (Number(memory.throughTurn) || 0) <= to
    }
    /** 长卡片默认折叠：超过 6 行或 360 字。 */
    function isLongText(text) {
      if (typeof text !== 'string') return false
      if (text.length > 360) return true
      let lines = 1
      for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) if ((lines += 1) > 6) return true
      return false
    }
    // </fetch-helpers>

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

    // <workspace-preset>
    /**
     * 工作区说明在预设 / 导出文件里的形状：`{ mode: 'off' }` 或 `{ mode: 'rewrite', text }`；
     * 原样 / 缺 / 认不出 ⇒ null（不存；旧预设没有这一键 ⇒ 套用时回到原样）。从不带 AGENTS.md 原文。
     */
    function presetWorkspace(raw) {
      if (raw === null || typeof raw !== 'object') return null
      if (raw.mode === 'off') return { mode: 'off' }
      if (raw.mode === 'rewrite') return { mode: 'rewrite', text: typeof raw.text === 'string' ? raw.text : '' }
      return null
    }
    // </workspace-preset>

    function without(map, sessionId) {
      const next = { ...(map ?? {}) }
      delete next[sessionId]
      return next
    }

    // <preset-undo> 「取消预设」的撤销（tests/clear-preset.test.mjs 从源码切出来跑）。
    /** 取消预设会归位的、按会话存的每一张表（与 presetPatch 写的一致）。 */
    const PRESET_KEYS = ['activePreset', 'overrides', 'gate', 'sessionTools', 'cardRef', 'lore', 'memory', 'everyTurn', 'enabled', 'workspaceInstructions', 'slotSource']
    /**
     * 取消前拍一张快照：每张表里本会话这一格（缺 = undefined）、armed 里有没有本会话、开场对话。
     * `items` = 列表里显示的；`pending` = host 上还没发出的草稿（null = 没有：会话已开跑、草稿已写进历史）。
     * 撤销只把 `pending` 放回草稿 —— 已经写进历史的那几条不能再登记成草稿，否则开跑后会被当成每轮注入再发一遍。
     */
    function presetSnapshot(st, sessionId, items, pending) {
      const maps = {}
      for (const key of PRESET_KEYS) {
        const map = st?.[key]
        maps[key] = map !== null && typeof map === 'object' && Object.prototype.hasOwnProperty.call(map, sessionId) ? structuredClone(map[sessionId]) : undefined
      }
      return {
        maps,
        armed: Array.isArray(st?.armed) && st.armed.includes(sessionId),
        items: Array.isArray(items) ? structuredClone(items) : [],
        pending: Array.isArray(pending) ? structuredClone(pending) : null,
      }
    }
    /** 撤销：按快照把本会话那一格放回最新的 state（别的会话不动）；快照里缺的一格 = 删掉。 */
    function presetRestorePatch(st, sessionId, snap) {
      const patch = {}
      for (const key of PRESET_KEYS) {
        const value = snap?.maps?.[key]
        patch[key] = value === undefined ? without(st?.[key], sessionId) : { ...(st?.[key] ?? {}), [sessionId]: value }
      }
      const armed = (Array.isArray(st?.armed) ? st.armed : []).filter((id) => id !== sessionId)
      patch.armed = snap?.armed === true ? [...armed, sessionId] : armed
      return patch
    }
    // </preset-undo>

    // <preset-compose> 预设分层（0.14）：默认 ← 角色卡编译结果 ← 预设覆盖 ← 本会话手改。
    // 套内置预设 / 我的预设 / 角色卡都走同一条写入路径（presetPatch），整体替换。tests/card-as-preset.test.mjs 从源码切出来跑。
    /** 预设里的槽位（pack 的键）。角色卡编译成同形的稀疏对象，只填它有的几格。 */
    const LAYER_KEYS = ['overrides', 'gate', 'tools', 'everyTurn', 'items', 'enabled', 'workspaceInstructions', 'memorySeed']
    /** 面板上标来源的几格 ← 它们由哪些 pack 键组成。 */
    const SLOT_KEYS = { system: ['overrides', 'gate'], everyTurn: ['everyTurn'], items: ['items'], tools: ['tools'], workspace: ['workspaceInstructions'] }
    /** 0.13 之前角色卡面板上的套用选项，0.14 起搬去对应的槽位（开场白 → 开场对话，思考 / 提醒 → 每轮注入，模式 / 白名单 → 系统提示 / 工具）。 */
    const LEGACY_CARD_OPTS = ['mode', 'greeting', 'reinforce', 'thinkZh', 'firstPerson', 'tools']

    /**
     * 读角色卡引用（预设里的 `card`、state.cardRef[会话]）：卡上只留卡自己的东西（我的名字、世界书 / 故事记忆开关）；
     * 旧预设 card.opts 里的开场白 / 提醒 / 中文 / 第一人称 / 模式 / 白名单拆成 `legacy`，读的时候映射到编译选项，
     * 于是它们的效果落在开场对话 / 每轮注入 / 系统提示 / 工具这几格，而不是留在卡上。
     */
    function cardRefOf(raw) {
      if (raw === null || typeof raw !== 'object' || typeof raw.id !== 'string' || raw.id === '') return null
      const src = raw.opts !== null && typeof raw.opts === 'object' ? raw.opts : {}
      const opts = {}
      if (typeof src.userName === 'string' && src.userName.trim() !== '') opts.userName = src.userName
      if (src.lore === false) opts.lore = false
      if (src.memory === false) opts.memory = false
      const legacy = {}
      for (const key of LEGACY_CARD_OPTS) if (src[key] !== undefined) legacy[key] = src[key]
      return { ref: { id: raw.id, opts }, legacy: Object.keys(legacy).length > 0 ? legacy : null }
    }

    /** 编译选项：没有旧选项 = 全按卡自己的设置（模式、开场白第 1 句、提醒、思考、白名单）。 */
    function cardCompileOptions(ref, legacy) {
      const opts = ref?.opts ?? {}
      const out = { userName: typeof opts.userName === 'string' ? opts.userName : '', lore: opts.lore !== false, memory: opts.memory !== false }
      if (legacy) {
        if (legacy.mode === 'agent' || legacy.mode === 'pure') out.mode = legacy.mode
        if (Number.isFinite(Number(legacy.greeting))) out.greeting = Math.floor(Number(legacy.greeting))
        if (typeof legacy.reinforce === 'boolean') out.reinforce = { enabled: legacy.reinforce }
        if (typeof legacy.thinkZh === 'boolean' || typeof legacy.firstPerson === 'boolean') out.thinking = { language: legacy.thinkZh === true ? 'zh' : null, firstPerson: legacy.firstPerson === true }
        if (typeof legacy.tools === 'string' && legacy.tools.trim() !== '') out.tools = legacy.tools.split(/[,，\s]+/).filter((name) => name !== '')
      }
      return out
    }

    /** 角色卡编译结果 → 预设形状的稀疏对象（只填卡有的格；世界书 / 故事记忆跟卡走）。 */
    function cardLayer(compiled, ref) {
      if (compiled === null || compiled === undefined) return null
      const pure = compiled.mode === 'pure'
      return {
        card: ref,
        overrides: { messages: {}, sections: { [PERSONA_SECTION]: String(compiled.systemText ?? '') }, contexts: {} },
        gate: pure ? 'pure' : 'pass',
        tools: pure ? [] : Array.isArray(compiled.tools) ? compiled.tools : null,
        everyTurn: compiled.everyTurn ?? null,
        items: Array.isArray(compiled.items) ? compiled.items : [],
        lore: compiled.lore ?? null,
        memory: compiled.memory?.enabled ? compiled.memory : null,
      }
    }

    /** 内置预设 → 预设形状（纯净 / 接管 = 闸门 pure + 工具 0；替换正文 = replace；其余 = 追加）。 */
    function builtinLayer(preset) {
      const text = String(preset?.overrides?.sections?.[PERSONA_SECTION] ?? '')
      const pure = preset?.pure === true || preset?.takeover === true
      return {
        overrides: text.trim() !== '' && preset?.pure !== true ? { messages: {}, sections: { [PERSONA_SECTION]: text }, contexts: {} } : null,
        gate: pure ? 'pure' : preset?.replace === true ? 'replace' : 'pass',
        tools: pure ? [] : null,
        // 没有开场白 = 这一格是默认（空），不标来源。
        items: Array.isArray(preset?.items) && preset.items.length > 0 ? preset.items : null,
      }
    }

    /**
     * 分层：每一格「预设里写了（含 null = 明确用默认）就用预设的，没写就用角色卡的，都没有 = 默认」。
     * 返回合成后的预设 + 每格的来源（'preset' | 'card'；默认 = 不记）。
     */
    function resolveLayers(card, pack) {
      const out = { card: card?.card ?? null, lore: card?.lore ?? null, memory: card?.memory ?? null }
      const from = {}
      for (const key of LAYER_KEYS) {
        if (pack && pack[key] !== undefined) {
          out[key] = pack[key]
          if (pack[key] !== null) from[key] = 'preset'
        } else if (card && card[key] !== undefined && card[key] !== null) {
          out[key] = card[key]
          from[key] = 'card'
        } else out[key] = null
      }
      // 世界书（0.15+）：预设里存了改过的世界书就用它，不再从卡现编译；世界书跟卡走，没套上卡就不带。
      // 开关沿用卡引用上的「世界书」选项。
      const packLore = pack?.lore
      if (packLore !== null && typeof packLore === 'object' && Array.isArray(packLore.entries) && out.card !== null) {
        out.lore = { ...packLore, enabled: out.card?.opts?.lore !== false, custom: true, source: 'preset' }
        from.lore = 'preset'
      }
      return { resolved: out, from }
    }

    /** 存进预设的世界书：只留匹配要用的字段（custom / source / enabled 是本会话的标记，不存）。 */
    function lorePackOf(lore) {
      if (lore === null || typeof lore !== 'object' || lore.custom !== true || !Array.isArray(lore.entries)) return undefined
      const { custom: _c, source: _s, enabled: _e, ...rest } = lore
      return rest
    }

    /** 每轮注入只比较配置（不比较运行时盖的 since / override）。 */
    function everyTurnShape(entry) {
      if (entry === null || entry === undefined || typeof entry !== 'object') return null
      const text = String(entry.text ?? '')
      const firstText = String(entry.firstText ?? '')
      if (entry.enabled === false || (text.trim() === '' && firstText.trim() === '')) return null
      const untilTurn = Math.max(0, Math.floor(Number(entry.untilTurn) || 0))
      const mode = entry.mode === 'auto' || entry.mode === 'until' || entry.mode === 'always' ? entry.mode : untilTurn > 0 ? 'until' : 'always'
      return { text, firstText, mode, untilTurn, checks: Array.isArray(entry.checks) ? [...entry.checks].sort() : [] }
    }
    function itemsShape(items) {
      return (Array.isArray(items) ? items : []).map((item) => (item?.role === 'assistant' ? ['a', String(item.text ?? ''), String(item.reasoning ?? '')] : ['u', String(item?.text ?? '')]))
    }
    /** 每格的指纹：套用时记下，之后和当前值比，不一样 = 本会话改过。 */
    function slotPrints(v) {
      const persona = String(v?.overrides?.sections?.[PERSONA_SECTION] ?? '')
      const gate = v?.gate === 'pure' || v?.gate === 'replace' ? v.gate : 'pass'
      const ws = v?.workspaceInstructions
      return {
        system: fingerprint(`${persona}\u0000${gate}`),
        everyTurn: fingerprint(JSON.stringify(everyTurnShape(v?.everyTurn))),
        items: fingerprint(JSON.stringify(itemsShape(v?.items))),
        tools: fingerprint(JSON.stringify(Array.isArray(v?.tools) ? v.tools : null)),
        workspace: fingerprint(JSON.stringify(ws && (ws.mode === 'off' || ws.mode === 'rewrite') ? { mode: ws.mode, text: ws.mode === 'rewrite' ? String(ws.text ?? '') : '' } : null)),
      }
    }
    /** 套用时写进 state.slotSource[会话] 的：每格来源 + 指纹。 */
    function slotSourceOf(resolved, from) {
      const prints = slotPrints(resolved)
      const out = {}
      for (const [slot, keys] of Object.entries(SLOT_KEYS)) {
        const sources = keys.map((key) => from[key]).filter(Boolean)
        if (sources.length === 0) continue
        out[slot] = { from: sources.includes('preset') ? 'preset' : 'card', fp: prints[slot] }
      }
      return out
    }
    /** 面板上的来源标签：'card' | 'preset' | 'session' | ''（默认、没动过）。 */
    function slotTag(source, slot, current, hasContent) {
      const entry = source?.[slot]
      if (entry && typeof entry === 'object') return slotPrints(current)[slot] === entry.fp ? entry.from : 'session'
      return hasContent ? 'session' : ''
    }

    /**
     * 唯一的写入路径：把合成后的预设整体写进本会话（预设没有的一格恢复默认，不留上一个的残留）。
     * 返回 state 路由的 patch；开场对话草稿由调用方写（草稿路由）。
     */
    function presetPatch(st, sessionId, resolved, from, activeKey) {
      const put = (map, value) => (value === null || value === undefined ? without(map, sessionId) : { ...(map ?? {}), [sessionId]: value })
      const enabled = resolved.enabled && typeof resolved.enabled === 'object' && Object.keys(resolved.enabled).length > 0 ? resolved.enabled : null
      const overrides = resolved.overrides && typeof resolved.overrides === 'object' ? resolved.overrides : null
      return {
        activePreset: put(st?.activePreset, activeKey || null),
        cardRef: put(st?.cardRef, resolved.card ? { ...resolved.card, ...(resolved.applied ? { applied: resolved.applied } : {}) } : null),
        lore: put(st?.lore, resolved.lore),
        memory: put(st?.memory, resolved.memory),
        overrides: put(st?.overrides, overrides),
        gate: { ...(st?.gate ?? {}), [sessionId]: resolved.gate === 'pure' || resolved.gate === 'replace' ? resolved.gate : 'pass' },
        armed: (st?.armed ?? []).filter((id) => id !== sessionId),
        sessionTools: put(st?.sessionTools, Array.isArray(resolved.tools) ? resolved.tools : null),
        everyTurn: put(st?.everyTurn, resolved.everyTurn),
        enabled: put(st?.enabled, enabled),
        workspaceInstructions: put(st?.workspaceInstructions, presetWorkspace(resolved.workspaceInstructions)),
        slotSource: put(st?.slotSource, activeKey ? slotSourceOf(resolved, from) : null),
      }
    }

    /**
     * 「基于角色卡」的预设只存和卡不一样的格。`session` = 本会话当前值（预设形状），`card` = cardLayer。
     * 和卡一样的格不存（套用时从卡现编译）；卡有、本会话清空了的格存 null（明确用默认）。
     */
    function cardDiff(session, card) {
      const out = {}
      const a = slotPrints(session)
      const b = slotPrints(card)
      const empty = { overrides: { messages: {}, sections: {}, contexts: {} }, gate: 'pass', items: [], tools: null, everyTurn: null, workspaceInstructions: null }
      for (const [slot, keys] of Object.entries(SLOT_KEYS)) {
        if (card && a[slot] === b[slot]) continue
        for (const key of keys) {
          const value = session?.[key]
          out[key] = value === undefined || value === null ? empty[key] : value
        }
      }
      // 改写注入内容（overrides 的 messages / contexts）卡里没有：有就整份存。
      const ov = session?.overrides
      if (out.overrides === undefined && ov && (Object.keys(ov.messages ?? {}).length > 0 || Object.keys(ov.contexts ?? {}).length > 0)) out.overrides = ov
      // 默认值不用存。
      if (out.workspaceInstructions === null) delete out.workspaceInstructions
      for (const key of ['enabled', 'memorySeed']) if (session?.[key] !== undefined && session[key] !== null) out[key] = session[key]
      // 世界书：本会话改过（或来自存过世界书的预设）就整份存；没改 = 不存，套用时照旧从卡现编译。
      const lore = lorePackOf(session?.lore)
      if (lore !== undefined) out.lore = lore
      return out
    }

    /** 开场白 ↔ 开场对话：第一条 AI 回答是第几句开场白（-1 = 没有 AI 回答；-2 = 改过 / 不是开场白）。 */
    function greetingIndex(items, greetings) {
      const first = (Array.isArray(items) ? items : []).find((item) => item?.role === 'assistant')
      if (first === undefined) return -1
      const at = (Array.isArray(greetings) ? greetings : []).indexOf(String(first.text ?? ''))
      return at >= 0 ? at : -2
    }
    /** 选第 k 句开场白：替换第一条 AI 回答（没有就放在最前面）；k < 0 = 去掉第一条（只在它是开场白时）。不改原数组。 */
    function withGreeting(items, greetings, k) {
      const list = Array.isArray(items) ? items.map((item) => ({ ...item })) : []
      const at = list.findIndex((item) => item?.role === 'assistant')
      if (k < 0) {
        if (at >= 0 && (greetings ?? []).includes(String(list[at].text ?? ''))) list.splice(at, 1)
        return list
      }
      const text = String(greetings?.[k] ?? '')
      if (text === '') return list
      if (at >= 0) list[at] = { ...list[at], text }
      else list.unshift({ role: 'assistant', text, reasoning: '' })
      return list
    }

    /** 左栏：世界书 / 故事记忆是角色卡的子项，只在套用的卡带了它们时出现。 */
    function navEntries(nav, cardInfo) {
      return nav
        .filter(([key]) => (key === 'lore' ? cardInfo?.lore === true : key === 'memory' ? cardInfo?.memory === true : true))
        .map(([key, paneId, color]) => [key, paneId, color, key === 'lore' || key === 'memory' ? 'card' : ''])
    }
    // </preset-compose>

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
      hint: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12.5, lineHeight: 1.6, maxWidth: '68ch' },
      popover: {
        position: 'absolute',
        top: 48,
        left: 12,
        zIndex: 5,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: 12,
        boxSizing: 'border-box',
        maxHeight: 'calc(100% - 60px)',
        overflowY: 'auto',
        borderRadius: 12,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-base)',
        boxShadow: '0 10px 30px rgba(0,0,0,0.16)',
      },
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
        maxWidth: '68ch',
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

    /**
     * 悬浮卡片右栏的一节（v0.10）：标题 + 右侧控件 + 内容，不再折叠——左栏选哪项就只渲染哪一节。
     * `data-prefill-section` 保持旧的 id，实测脚本和单测照旧能找到。
     */
    function Section(props) {
      return h(
        'section',
        { style: { display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }, 'data-prefill-section': props.id },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          h('h3', { style: { margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--dsw-alias-label-primary)' } }, props.title),
          props.meta ? h('span', { style: { ...V.sectionMeta, fontSize: 12 } }, props.meta) : null,
          props.tags ?? null,
          h('span', { style: { flex: '1 1 auto' } }),
          props.right ?? null,
        ),
        props.off ? h('div', { style: { ...V.callout('warn'), maxWidth: '68ch' }, 'data-prefill-off-note': props.id }, h('b', null, props.offTitle), props.offBody ? ` ${props.offBody}` : '') : null,
        props.children,
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
      // v0.15：内置积木 / 内置塔（服务端 packs list 返回；旧壳没有就退回 everyTurnList）
      const [everyTurnBlockList, setEveryTurnBlockList] = React.useState([])
      const [everyTurnTowerList, setEveryTurnTowerList] = React.useState([])
      const [everyTurnDraft, setEveryTurnDraft] = React.useState(null)
      // 世界书本会话修改（草稿先显示、去抖后写 state.lore[会话]）；展开 / 编辑中的条目、显示条数只在面板本地。
      const [loreDraft, setLoreDraft] = React.useState(null)
      const [loreOpen, setLoreOpen] = React.useState(() => new Set())
      const [loreEditing, setLoreEditing] = React.useState('')
      const [loreShown, setLoreShown] = React.useState(40)
      const loreTimer = React.useRef(null)
      // 工作台长块折叠：记「展开着的块 key」（只在面板本地，不写 state）。
      const [benchOpen, setBenchOpen] = React.useState(() => new Set())
      const benchFocusNext = React.useRef('')
      // v0.15 工作台：这些 hook 必须放在组件早退之前，否则 hook 数量会变（React #310）。
      const [benchPreview, setBenchPreview] = React.useState(false)
      const [benchMenu, setBenchMenu] = React.useState(null)
      const [benchFocus, setBenchFocus] = React.useState('')
      const [dragKey, setDragKey] = React.useState('')
      const [dropIndex, setDropIndex] = React.useState(-1)
      const [hiddenOpen, setHiddenOpen] = React.useState(false)
      const benchListRef = React.useRef(null)
      const dragInfo = React.useRef(null)
      const benchRects = React.useRef(new Map())
      const benchSig = React.useRef('')
      // 拖动/排序后做 FLIP 滑动。三条约束（否则整屏乱跳）：
      //   ① 只在「工作台顺序真的变了」时动画（切格、套预设、面板重排都不算）；
      //   ② 只比相对列表的位置（卡片被别的格顶上去、面板整体位移不算位移）；
      //   ③ 位移超过一块高度太多 ⇒ 当成布局抖动，不做动画。
      React.useLayoutEffect(() => {
        const list = benchListRef.current
        if (list === null) return
        const nodes = [...list.querySelectorAll('[data-prefill-bench-block]')]
        const listTop = list.getBoundingClientRect().top
        const order = nodes.map((node) => node.getAttribute('data-prefill-bench-block') ?? '')
        const sig = order.join('|')
        const reordered = benchSig.current !== '' && benchSig.current !== sig && dragInfo.current === null
        const next = new Map()
        for (const node of nodes) {
          const key = node.getAttribute('data-prefill-bench-block') ?? ''
          const rect = node.getBoundingClientRect()
          const top = rect.top - listTop
          next.set(key, { top, height: rect.height })
          const before = benchRects.current.get(key)
          if (reordered && before !== undefined) {
            const delta = before.top - top
            if (Math.abs(delta) > 1 && Math.abs(delta) < rect.height * 3) {
              node.animate([{ transform: 'translateY(' + delta + 'px)' }, { transform: 'none' }], {
                duration: 170,
                easing: 'cubic-bezier(.2,.7,.2,1)',
              })
            }
          }
        }
        benchRects.current = next
        benchSig.current = sig
      })

      const everyTurnTimer = React.useRef(0)
      React.useEffect(() => setEveryTurnDraft(null), [sessionId])
      React.useEffect(() => {
        clearTimeout(loreTimer.current)
        setLoreDraft(null)
        setLoreEditing('')
        setLoreOpen(new Set())
        setLoreShown(40)
      }, [sessionId])
      // 工作区说明（AGENTS.md / CLAUDE.md）：改写正文的草稿（700ms 落盘）。
      const [wsDraft, setWsDraft] = React.useState(null)
      const wsTimer = React.useRef(0)
      // 这个会话里，说明已经发出之后用户又改过设置 ⇒ 显示「中途切换」提示。
      const [wsMidChanged, setWsMidChanged] = React.useState(false)
      React.useEffect(() => {
        setWsDraft(null)
        setWsMidChanged(false)
      }, [sessionId])
      const [packName, setPackName] = React.useState('')
      // 另存为：套着角色卡时「基于角色卡」（只存改过的格）默认勾上。
      const [saveOnCard, setSaveOnCard] = React.useState(true)
      // 「从当前会话取」（v0.10.1 起在开场对话里）：取第 N–M 轮的原话和回答，直接放进开场对话列表。
      const [fetchOpts, setFetchOpts] = React.useState({ reasoning: false, fromTurn: '1', toTurn: '' })
      const [fetchBusy, setFetchBusy] = React.useState(false)
      // 列表里已经有东西时先问：替换 / 插在第 k 条后 / 取消；超过 FETCH_WARN_TOK 也先问。
      const [fetchPending, setFetchPending] = React.useState(null)
      const [placeAt, setPlaceAt] = React.useState(0)
      const [undoSnap, setUndoSnap] = React.useState(null)
      // 「取消预设」后的撤销快照（presetSnapshot），8 秒后失效。
      const [presetUndo, setPresetUndo] = React.useState(null)
      // 最近一次放进列表的范围（故事记忆摘要不能晚于它的末轮）。
      const [fetchCut, setFetchCut] = React.useState(null)
      // 故事记忆里「从当前会话取摘要」：保存预设时带上的摘要。
      const [seedDraft, setSeedDraft] = React.useState(null)
      const [seedNote, setSeedNote] = React.useState('')
      // 约束承接：「从当前会话取」时检出的每轮约束（带 on = 勾没勾）；null = 没取过。
      const [carryList, setCarryList] = React.useState(null)
      // 长卡片展开的行（按下标）；分批渲染已画出的条数。
      const [expandedRows, setExpandedRows] = React.useState(() => new Set())
      const [shownRows, setShownRows] = React.useState(ROW_BATCH)
      React.useEffect(() => {
        setFetchPending(null)
        setUndoSnap(null)
        setFetchCut(null)
        setSeedDraft(null)
        setSeedNote('')
        setExpandedRows(new Set())
        setShownRows(ROW_BATCH)
      }, [sessionId])
      const itemCount = Array.isArray(items) ? items.length : 0
      React.useEffect(() => {
        if (shownRows >= itemCount) return undefined
        const timer = setTimeout(() => setShownRows((value) => value + ROW_BATCH), 16)
        return () => clearTimeout(timer)
      }, [shownRows, itemCount])
      React.useEffect(() => {
        if (undoSnap === null) return undefined
        const timer = setTimeout(() => setUndoSnap((current) => (current === undoSnap ? null : current)), 8000)
        return () => clearTimeout(timer)
      }, [undoSnap])
      React.useEffect(() => {
        if (presetUndo === null) return undefined
        const timer = setTimeout(() => setPresetUndo((current) => (current === presetUndo ? null : current)), 8000)
        return () => clearTimeout(timer)
      }, [presetUndo])
      React.useEffect(() => setPresetUndo(null), [sessionId])
      const [everyTurnStatus, setEveryTurnStatus] = React.useState(null)
      // 角色卡（v0.6）：列表、选中、套用选项、编译预览。
      const [cards, setCards] = React.useState([])
      const [cardPick, setCardPick] = React.useState('')
      // 「我的名字」：卡片自己的设置（{{user}} 展开成什么），存在角色卡引用里。
      const [cardUser, setCardUser] = React.useState('')
      const [avatars, setAvatars] = React.useState({})
      const [cardPreview, setCardPreview] = React.useState(null)
      const cardFileRef = React.useRef(null)
      const [envelope, setEnvelope] = React.useState(null)
      const [toast, setToast] = React.useState('')
      const [open, setOpen] = React.useState({ guide: false })
      const [hovered, setHovered] = React.useState('')
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

      // ── 悬浮卡片（v0.10）：开关、钉住、左栏选中项、下拉菜单 ──
      const [cardOpen, setCardOpenLocal] = React.useState(() => cardOpenMap.get(sessionId) === true)
      const [pinned, setPinned] = React.useState(false)
      const [pane, setPane] = React.useState('items')
      const [menu, setMenu] = React.useState('')
      const cardRef = React.useRef(null)
      React.useEffect(() => {
        setCardOpenLocal(cardOpenMap.get(sessionId) === true)
        const onCard = (event) => {
          if (event?.detail?.sessionId !== sessionId || event.detail.open === undefined) return
          setCardOpenLocal(event.detail.open === true)
          if (event.detail.open !== true) setMenu('')
        }
        window.addEventListener(CARD_EVENT, onCard)
        return () => window.removeEventListener(CARD_EVENT, onCard)
      }, [sessionId])
      const closeCard = React.useCallback(() => setCardOpen(sessionId, false), [sessionId])
      // 芯片的摘要：渲染时算好放进 ref，提交后再广播（不在渲染里改别的组件）。
      const summaryRef = React.useRef(null)
      React.useEffect(() => {
        if (summaryRef.current !== null && sessionId !== '') publishSummary(sessionId, summaryRef.current)
      })

      // 卡片外点击 / Esc 关闭（钉住时不关）；Esc 先关下拉菜单 / 放置确认。只监听事件，不改别人的 DOM。
      React.useEffect(() => {
        if (!cardOpen) return undefined
        const onDown = (event) => {
          if (pinned) return
          // 点芯片本身由芯片的 onClick 切换，这里不抢（composedPath：芯片在 shadow DOM 里也认得出）。
          if (pathHas(event, 'data-prefill-chip')) return
          if (pathHas(event, 'data-prefill-card-panel') || pathHas(event, 'data-prefill-marker')) return
          const target = event.target
          if (target instanceof Node && cardRef.current?.contains(target)) return
          autoClosedAt.set(sessionId, Date.now())
          closeCard()
        }
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          if (menu !== '') {
            setMenu('')
            return
          }
          if (fetchPending !== null) {
            setFetchPending(null)
            return
          }
          if (!pinned) closeCard()
        }
        document.addEventListener('pointerdown', onDown, true)
        document.addEventListener('mousedown', onDown, true)
        document.addEventListener('keydown', onKey, true)
        return () => {
          document.removeEventListener('pointerdown', onDown, true)
          document.removeEventListener('mousedown', onDown, true)
          document.removeEventListener('keydown', onKey, true)
        }
      }, [cardOpen, pinned, menu, closeCard, fetchPending, sessionId])

      // 钉住后鼠标离开卡片 ~500ms：缩成一个小标记（预设名 + 彩点），淡出的卡片不挡点击；悬停 / 点标记恢复。
      // 焦点在卡片里（正在打字）、下拉菜单 / 放置确认 / 二次确认开着时不缩。
      const [shrunk, setShrunk] = React.useState(false)
      const hoverRef = React.useRef(false)
      const shrinkTimer = React.useRef(0)
      const holdOpen = menu !== '' || fetchPending !== null || confirming !== '' || presetUndo !== null
      const holdRef = React.useRef(holdOpen)
      holdRef.current = holdOpen
      const scheduleShrink = React.useCallback(() => {
        clearTimeout(shrinkTimer.current)
        shrinkTimer.current = setTimeout(() => {
          if (hoverRef.current || holdRef.current) return
          // 只认「正在输入」的焦点（输入框 / 文本框 / 下拉 / 可编辑）；刚点过的按钮带着焦点不算。
          const active = document.activeElement
          const typing = active instanceof HTMLElement && (active.matches('input:not([type=checkbox]):not([type=radio]):not([type=button]), textarea, select') || active.isContentEditable)
          if (typing && cardRef.current?.contains(active)) return
          setShrunk(true)
        }, 500)
      }, [])
      const restoreCard = React.useCallback(() => {
        clearTimeout(shrinkTimer.current)
        setShrunk(false)
      }, [])
      React.useEffect(() => {
        if (!pinned || !cardOpen) {
          clearTimeout(shrinkTimer.current)
          setShrunk(false)
        }
      }, [pinned, cardOpen])
      React.useEffect(() => {
        if (holdOpen) restoreCard()
      }, [holdOpen, restoreCard])
      React.useEffect(() => () => clearTimeout(shrinkTimer.current), [])
      React.useEffect(() => {
        if (!holdOpen && pinned && cardOpen && !hoverRef.current) scheduleShrink()
        // 只在「菜单 / 确认关上」这一刻补一次：鼠标早已在外面时也会缩。
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [holdOpen])

      // 几何：宽 clamp(560px, 62vw, 920px) 但不超过视口；以输入框为中线、贴在输入框上方 10px；
      // 高度上限 = min(70vh, 输入框上方剩余空间 − 20px)。只读几何。
      React.useEffect(() => {
        if (!cardOpen) return undefined
        const measure = () => {
          const input = document.querySelector('[contenteditable="true"]')
          const vw = window.innerWidth
          const vh = window.innerHeight
          let box = null
          let node = input instanceof HTMLElement ? input : null
          for (let depth = 0; depth < 8 && node instanceof HTMLElement; depth += 1) {
            const rect = node.getBoundingClientRect()
            const radius = Number.parseFloat(window.getComputedStyle(node).borderTopLeftRadius || '0')
            if (rect.width > 300 && Number.isFinite(radius) && radius > 4) {
              box = rect
              break
            }
            node = node.parentElement
          }
          const top = box?.top ?? (input instanceof HTMLElement ? input.getBoundingClientRect().top : vh - 160)
          const center = box ? box.left + box.width / 2 : vw / 2
          const width = Math.round(Math.min(Math.max(560, vw * 0.62), 920, vw - 24))
          const left = Math.round(Math.min(Math.max(12, center - width / 2), vw - 12 - width))
          const bottom = Math.round(vh - top + 10)
          const maxHeight = Math.round(Math.max(200, Math.min(vh * 0.7, top - 20)))
          const narrow = vw < 820
          setBounds((current) =>
            current !== null && current.width === width && current.left === left && current.bottom === bottom && current.maxHeight === maxHeight && current.narrow === narrow && current.vw === vw
              ? current
              : { width, left, bottom, maxHeight, narrow, vw },
          )
        }
        measure()
        window.addEventListener('resize', measure)
        const timer = setInterval(measure, 500)
        return () => {
          window.removeEventListener('resize', measure)
          clearInterval(timer)
        }
      }, [cardOpen])

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
        if (Array.isArray(data?.everyTurnBlocks)) setEveryTurnBlockList(data.everyTurnBlocks)
        if (Array.isArray(data?.everyTurnTowers)) setEveryTurnTowerList(data.everyTurnTowers)
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
      // 已套用的卡（0.14）：按引用现编译一份，开场对话的开场白下拉和每轮注入 / 系统提示里的卡片选项用它。
      const appliedCardId = envelope?.state?.cardRef?.[sessionId]?.id ?? ''
      const appliedUser = String(envelope?.state?.cardRef?.[sessionId]?.opts?.userName ?? '')
      const [appliedCompiled, setAppliedCompiled] = React.useState(null)
      React.useEffect(() => setCardUser(appliedUser), [sessionId, appliedUser])
      React.useEffect(() => {
        if (!enabled || appliedCardId === '') {
          setAppliedCompiled(null)
          return undefined
        }
        let alive = true
        void cardsCall({ op: 'compile', id: appliedCardId, options: cardCompileOptions({ id: appliedCardId, opts: { userName: appliedUser } }, null) })
          .then((data) => {
            if (alive) setAppliedCompiled(data?.compiled ?? null)
          })
          .catch(() => {})
        return () => {
          alive = false
        }
      }, [enabled, appliedCardId, appliedUser, cardsCall])
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
      // 左栏启用开关（缺 = 开）。
      const ownEnabled = state?.enabled?.[sessionId] ?? {}
      const isOn = (key) => (key === 'everyTurn' ? everyTurnSwitchOn(state, sessionId) : ownEnabled[key] !== false)
      // 工作区说明进预设的那一份（只有模式 + 改写正文；原样 = 不存）。
      const wsPreset = presetWorkspace(state?.workspaceInstructions?.[sessionId])
      // 角色卡（已套用的那张）与它留下的指纹。
      const appliedRef = state?.cardRef?.[sessionId] ?? null
      const appliedCardName = appliedRef ? (cards.find((card) => card.id === appliedRef.id)?.name ?? appliedRef.id) : ''
      const appliedCardDesc = appliedRef
        ? [gateMode === 'pure' ? t('cardModePure') : t('cardModeAgent'), appliedUser.trim() !== '' ? `${t('cardUserName')} ${appliedUser.trim()}` : ''].filter((part) => part !== '').join(' · ')
        : ''
      const prints = appliedRef?.applied ?? null
      const storedPersona = state?.overrides?.[sessionId]?.sections?.[PERSONA_SECTION]
      const ownTurnRaw = state?.everyTurn?.[sessionId]
      // 角色卡关着时，仍是套卡原样的系统提示 / 每轮注入随它停用（与 enabled.js 同一规则）。
      const systemFromCardOff = !isOn('card') && prints !== null && typeof storedPersona === 'string' && fingerprint(storedPersona) === prints.system
      const everyTurnFromCardOff =
        !isOn('card') && prints !== null && ownTurnRaw !== undefined && ownTurnRaw !== null && fingerprint(`${String(ownTurnRaw.text ?? '')}\u0000${String(ownTurnRaw.firstText ?? '')}`) === prints.everyTurn
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
        if (!cardOpen || sessionId === '') return undefined
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
      }, [cardOpen, sessionId])

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

      const toggle = (key) => setOpen((current) => ({ ...current, [key]: !current[key] }))
      const edit = (next) => {
        dirty.current = true
        setItems(next)
      }
      const patchAt = (index, patch) => {
        // 正在改的这条算「已展开」：打字打过折叠阈值时不会突然缩成预览。
        if (!expandedRows.has(index)) setExpandedRows((current) => new Set(current).add(index))
        edit(items.map((item, at) => (at === index ? { ...item, ...patch } : item)))
      }
      const move = (index, delta) => {
        const target = index + delta
        if (target < 0 || target >= items.length) return
        setExpandedRows(new Set())
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

      // ── 预设（0.14：内置 / 我的预设 / 角色卡都走 applyLayered 这一条路径，整体替换）──────────
      /**
       * 唯一的套用入口：`card` = 角色卡编译成的稀疏预设（cardLayer），`pack` = 预设本身（内置 / 我的）。
       * 分层：默认 ← 角色卡 ← 预设覆盖；之后本会话手改的部分由来源标签标出来。开场对话只改草稿。
       */
      const applyLayered = async ({ card = null, pack = null, key = '', compiled = null, extraPatch = {} } = {}) => {
        const { resolved, from } = resolveLayers(card, pack)
        if (compiled) resolved.applied = appliedPrints(compiled)
        // 故事记忆摘要：本会话开着故事记忆（预设带了角色卡）⇒ 写成初始记忆；否则作为一条背景放在开场对话最前面。
        const memoryOn = resolved.memory?.enabled === true
        const seed = typeof resolved.memorySeed?.text === 'string' && resolved.memorySeed.text.trim() !== '' ? resolved.memorySeed.text.trim() : ''
        const baseItems = Array.isArray(resolved.items) ? resolved.items : []
        resolved.items = seed !== '' && !memoryOn && !injectMode ? [{ role: 'user', text: memorySeedText(seed) }, ...baseItems] : baseItems
        const fresh = await postJson(STATE_ROUTE, undefined)
        const patch = { ...presetPatch(fresh?.state, sessionId, resolved, from, key), ...extraPatch }
        const overrides = resolved.overrides && typeof resolved.overrides === 'object' ? resolved.overrides : { messages: {}, sections: {}, contexts: {} }
        injectionDrafts.set(sessionId, overrides)
        const text = overrides.sections?.[PERSONA_SECTION]
        systemDirty.current = false
        setSystemDraft(typeof text === 'string' ? text : '')
        setEveryTurnDraft(null)
        clearTimeout(loreTimer.current)
        setLoreDraft(null)
        setWsDraft(null)
        // 开场对话整体替换（只改草稿：会话已经开跑时，写进历史的那几条不动）。
        // 先挡住写状态后的广播刷新（别让 host 的旧草稿盖掉），草稿在写状态之后落盘：草稿路由按新系统提示预热合成轮。
        dirty.current = true
        setItems(resolved.items)
        setExpandedRows(new Set())
        setShownRows(ROW_BATCH)
        setUndoSnap(null)
        setEnvelope(await postJson(STATE_ROUTE, patch))
        await postJson(DRAFT_ROUTE, { sessionId, items: resolved.items })
        dirty.current = false
        setStatus('saved')
        if (seed !== '' && memoryOn) await memoryCall({ op: 'set', text: seed })
        notifyStateChanged()
        return { resolved, seed }
      }

      const applyBuiltin = async (summary) => {
        const data = await packsCall({ op: 'builtin', id: summary.id })
        const preset = data?.pack
        if (preset === null || preset === undefined) throw new Error('missing preset')
        const fresh = await postJson(STATE_ROUTE, undefined)
        // 纯净：系统提示 0、上下文 0、工具 0、只放行你的话（与预填装）；顺手清掉一键注入的记录。
        await applyLayered({ pack: builtinLayer(preset), key: `builtin:${summary.id}`, extraPatch: preset.pure === true ? { injects: without(fresh?.state?.injects, sessionId) } : {} })
        // 套了带系统提示的预设：把左栏切到「系统提示」，让人看见改了什么都不用猜。
        if (preset.takeover === true || preset.replace === true) setPane('system')
        flash(preset.pure === true ? (injectMode ? t('appliedNextTurn') : t('pureApplied')) : injectMode ? t('appliedNextTurn') : t('appliedFirstTurn'))
      }

      /** 左栏开关：关 = 停用但保留内容（state.enabled[会话][项] = false）；开 = 删掉这一键。 */
      const writeEnabled = async (key, on) => {
        const fresh = await postJson(STATE_ROUTE, undefined)
        const all = { ...(fresh?.state?.enabled ?? {}) }
        const own = { ...(all[sessionId] ?? {}) }
        if (on) delete own[key]
        else own[key] = false
        if (Object.keys(own).length === 0) delete all[sessionId]
        else all[sessionId] = own
        const patch = { enabled: all }
        // 每轮注入在 0.11 之前另有一个面板内的「启用」勾选框（写 state.everyTurn[会话].enabled）。
        // 现在开关只剩左栏这一个：打开时把旧值清成 true，否则会出现「开关开着、点也亮着，却一轮都不注入」。
        const ownTurn = fresh?.state?.everyTurn?.[sessionId]
        if (key === 'everyTurn' && on && ownTurn !== null && typeof ownTurn === 'object' && ownTurn.enabled !== true) {
          patch.everyTurn = { ...(fresh?.state?.everyTurn ?? {}), [sessionId]: { ...ownTurn, enabled: true } }
        }
        const data = await postJson(STATE_ROUTE, patch)
        setEnvelope(data)
        notifyStateChanged()
        flash(on ? t('featureOnSaved') : t('featureOffSaved'))
        return data
      }

      /** 取消预设 = 套一个空预设（同一条路径）：全部归位，开场对话草稿也清空；几秒内可撤销。 */
      const clearPreset = async () => {
        const fresh = await postJson(STATE_ROUTE, undefined)
        // 先拍快照（含开场对话），几秒内可撤销。本地有没落盘的编辑时以本地为准，否则读 host 上的草稿。
        const hostDraft = dirty.current ? items : ((await postJson(DRAFT_ROUTE, { sessionId }).catch(() => null))?.draft ?? null)
        const snap = presetSnapshot(fresh?.state, sessionId, items, hostDraft)
        await applyLayered({})
        setPresetUndo(snap)
        flash(t('presetCleared'))
      }
      /** 撤销「取消预设」：系统提示 / 闸门 / 工具 / 角色卡 / 世界书 / 记忆 / 每轮注入 / 开关 / 工作区说明 / 来源标签 / 开场对话全部放回。 */
      const undoClearPreset = async () => {
        const snap = presetUndo
        if (snap === null) return
        setPresetUndo(null)
        const fresh = await postJson(STATE_ROUTE, undefined)
        const patch = presetRestorePatch(fresh?.state, sessionId, snap)
        dirty.current = true
        setItems(snap.items)
        setExpandedRows(new Set())
        const text = snap.maps.overrides?.sections?.[PERSONA_SECTION]
        systemDirty.current = false
        setSystemDraft(typeof text === 'string' ? text : '')
        setEveryTurnDraft(null)
        clearTimeout(loreTimer.current)
        setLoreDraft(null)
        setWsDraft(null)
        injectionDrafts.set(sessionId, snap.maps.overrides ?? { messages: {}, sections: {}, contexts: {} })
        setEnvelope(await postJson(STATE_ROUTE, patch))
        // 只把 host 上本来还没发出的草稿放回去（写状态之后：草稿路由按放回的系统提示预热）。
        if (snap.pending !== null) await postJson(DRAFT_ROUTE, { sessionId, items: snap.pending })
        dirty.current = false
        notifyStateChanged()
        flash(t('presetRestored'))
      }

      /** 按引用现编译一张卡，变成预设形状的稀疏对象（卡片删了 = null）。 */
      const compileCardLayer = async (ref, legacy) => {
        const res = await cardsCall({ op: 'compile', id: ref.id, options: cardCompileOptions(ref, legacy) }).catch(() => null)
        const compiled = res?.compiled ?? null
        return compiled ? { layer: cardLayer(compiled, ref), compiled } : null
      }

      const applyPack = async (name) => {
        const data = await packsCall({ op: 'get', name })
        const pack = data?.pack
        if (pack === null || pack === undefined) throw new Error('missing pack')
        setPackName(name)
        // 角色卡：只存引用，按 id 现编译；预设没写的格从卡来。旧预设 card.opts 里的开场白 / 提醒 / 思考 / 模式 / 白名单
        // 映射成编译选项（效果落到对应的格）；卡片不在了就跳过这一层。
        const parsed = cardRefOf(pack.card)
        const got = parsed ? await compileCardLayer(parsed.ref, parsed.legacy) : null
        const { seed } = await applyLayered({ card: got?.layer ?? null, pack, key: `pack:${name}`, compiled: got?.compiled ?? null })
        flash(parsed && got === null ? t('packCardMissing') : seed !== '' ? t('memorySeedApplied') : injectMode ? t('appliedNextTurn') : t('appliedFirstTurn'))
      }

      // ── 角色卡（v0.6）────────────────────────────────────────────────────────
      /** 套卡时写下的指纹：左栏关掉角色卡时，服务端只停用「仍是套卡时原样」的系统提示 / 每轮注入 / 工具。 */
      const appliedPrints = (compiled) => ({
        system: fingerprint(compiled?.systemText ?? ''),
        everyTurn: fingerprint(`${String(compiled?.everyTurn?.text ?? '')}\u0000${String(compiled?.everyTurn?.firstText ?? '')}`),
        tools: compiled?.mode === 'agent' && Array.isArray(compiled?.tools) ? fingerprint(JSON.stringify(compiled.tools)) : '',
      })
      const previewCard = (id, userName) => {
        if (id === '') {
          setCardPreview(null)
          return
        }
        void cardsCall({ op: 'compile', id, options: cardCompileOptions({ id, opts: { userName } }, null) })
          .then((data) => setCardPreview(data?.compiled ?? null))
          .catch(() => setCardPreview(null))
      }
      /** 卡片面板里点一张卡：只是看它（详情 / 导出 / 删除），套用在头部预设下拉的「角色卡」组里。 */
      const pickCard = (summary) => {
        setCardPick(summary.id)
        previewCard(summary.id, cardUser)
      }
      /** 头部下拉选一张角色卡 = 套一个只有角色卡这一层的预设（整体替换）。 */
      const applyCardPreset = async (summary) => {
        const ref = { id: summary.id, opts: cardUser.trim() !== '' ? { userName: cardUser.trim() } : {} }
        const got = await compileCardLayer(ref, null)
        if (got === null) {
          flash(t('packCardMissing'))
          return
        }
        await applyLayered({ card: got.layer, key: `card:${summary.id}`, compiled: got.compiled })
        setCardPick(summary.id)
        flash(t('cardApplied').replace('{name}', summary.name))
      }
      /**
       * 改了「我的名字」：重新编译已套用的卡，只更新仍是「来自角色卡」原样的格（本会话改过 / 预设覆盖的不动）。
       * 世界书 / 故事记忆跟着卡走。
       */
      const refreshCardLayer = async (userName) => {
        const parsed = cardRefOf(appliedRef)
        if (parsed === null) return
        const ref = { id: parsed.ref.id, opts: { ...parsed.ref.opts } }
        if (userName.trim() !== '') ref.opts.userName = userName.trim()
        else delete ref.opts.userName
        const got = await compileCardLayer(ref, null)
        if (got === null) return
        const fresh = await postJson(STATE_ROUTE, undefined)
        const st = fresh?.state ?? {}
        const source = st.slotSource?.[sessionId] ?? {}
        const current = { overrides: st.overrides?.[sessionId], gate: st.gate?.[sessionId], tools: st.sessionTools?.[sessionId], everyTurn: st.everyTurn?.[sessionId], items }
        const fromCard = (slot) => source[slot]?.from === 'card' && slotTag(source, slot, current, true) === 'card'
        const next = { ...current }
        if (fromCard('system')) {
          next.overrides = { ...(current.overrides ?? { messages: {}, contexts: {} }), sections: { ...(current.overrides?.sections ?? {}), [PERSONA_SECTION]: got.layer.overrides.sections[PERSONA_SECTION] } }
          next.gate = got.layer.gate
        }
        if (fromCard('everyTurn')) next.everyTurn = got.layer.everyTurn
        if (fromCard('items')) next.items = got.layer.items
        const prints = slotPrints(next)
        const nextSource = { ...source }
        for (const slot of ['system', 'everyTurn', 'items']) if (fromCard(slot)) nextSource[slot] = { from: 'card', fp: prints[slot] }
        const put = (map, value) => (value === null || value === undefined ? without(map, sessionId) : { ...(map ?? {}), [sessionId]: value })
        const patch = {
          cardRef: put(st.cardRef, { ...ref, applied: appliedPrints(got.compiled) }),
          // 本会话改过的世界书（或来自预设的）不被重新编译盖掉。
          lore: st.lore?.[sessionId]?.custom === true ? st.lore : put(st.lore, got.layer.lore),
          memory: put(st.memory, got.layer.memory),
          slotSource: put(st.slotSource, nextSource),
        }
        if (fromCard('system')) {
          patch.overrides = put(st.overrides, next.overrides)
          patch.gate = { ...(st.gate ?? {}), [sessionId]: next.gate }
          systemDirty.current = false
          setSystemDraft(next.overrides.sections[PERSONA_SECTION])
        }
        if (fromCard('everyTurn')) {
          patch.everyTurn = put(st.everyTurn, next.everyTurn)
          setEveryTurnDraft(null)
        }
        if (fromCard('items')) {
          dirty.current = true
          setItems(next.items)
        }
        setEnvelope(await postJson(STATE_ROUTE, patch))
        if (fromCard('items')) {
          await postJson(DRAFT_ROUTE, { sessionId, items: next.items })
          dirty.current = false
        }
        notifyStateChanged()
        flash(t('cardUserSaved'))
      }
      /** 角色卡在每轮注入 / 系统提示里的几个选项：按当前选择重新编译这张卡，返回编译结果。 */
      const recompileApplied = async (patch) => {
        const parsed = cardRefOf(appliedRef)
        if (parsed === null) return null
        const zh = patch.thinkZh ?? everyTurn.checks.includes('zh')
        const fp = patch.firstPerson ?? everyTurn.checks.includes('firstPerson')
        const mode = patch.mode ?? (gateMode === 'pure' ? 'pure' : 'agent')
        const res = await cardsCall({ op: 'compile', id: parsed.ref.id, options: { ...cardCompileOptions(parsed.ref, null), mode, thinking: { language: zh ? 'zh' : null, firstPerson: fp }, reinforce: { enabled: true } } }).catch(() => null)
        return res?.compiled ?? null
      }
      /** 每轮注入里的「角色提醒 / 中文思考 / 第一人称思考」：换成角色卡按这些选项编译出的提醒。 */
      const setCardThinking = async (patch) => {
        const compiled = await recompileApplied(patch)
        if (compiled === null) return
        const et = compiled.everyTurn
        editEveryTurn({ enabled: true, text: et.text, firstText: et.firstText, checks: et.checks, mode: et.mode, untilTurn: et.untilTurn }, true)
      }
      /** 系统提示里的「带工具（Agent）/ 纯角色扮演」：换成角色卡按这个模式编译出的人设，闸门 / 工具跟着换。 */
      const setCardMode = async (mode) => {
        const compiled = await recompileApplied({ mode })
        if (compiled === null) return
        systemDirty.current = false
        setSystemDraft(compiled.systemText)
        await writeSystem(compiled.systemText, compiled.systemMode)
        if (compiled.mode === 'agent' && Array.isArray(compiled.tools)) {
          const again = await postJson(STATE_ROUTE, undefined)
          setEnvelope(await postJson(STATE_ROUTE, { sessionTools: { ...(again?.state?.sessionTools ?? {}), [sessionId]: compiled.tools } }))
        }
        flash(injectMode ? t('appliedNextTurn') : t('appliedFirstTurn'))
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

      const savePack = (nameArg) => {
        const name = (typeof nameArg === 'string' ? nameArg : packName).trim()
        if (name === '') {
          flash(t('needName'))
          return
        }
        // 保存 = 面板上挂在预设下的**全部**内容：角色卡（引用）、系统提示、每轮注入（只存配置）、开场对话、改写注入内容、工具权限。
        // 「基于角色卡」（0.14，套着卡时默认勾上）：只存和卡不一样的格，其余套用时从卡现编译（卡更新了也跟着变）。
        let layerFrom = null
        void Promise.all([currentOverrides(), currentTools(), currentCardRef()])
          .then(async ([overrides, tools, rawCard]) => {
            const parsed = cardRefOf(rawCard)
            const card = parsed?.ref ?? null
            const seed = seedDraft !== null ? { memorySeed: seedDraft, ...(cutTo > 0 ? { toTurn: cutTo } : {}) } : {}
            if (card !== null && saveOnCard) {
              const got = await compileCardLayer(card, null)
              if (got !== null) {
                const session = { overrides, gate: gateMode, tools, everyTurn: everyTurnStored, items, enabled: ownEnabled, workspaceInstructions: wsPreset, lore: loreDraft ?? state?.lore?.[sessionId] ?? null }
                const diff = cardDiff(session, got.layer)
                layerFrom = resolveLayers(got.layer, diff)
                return packsCall({ op: 'save', name, layered: true, card, ...diff, ...seed, ...carryPayload() })
              }
            }
            // 世界书改过就整份存进预设（只在带着角色卡时有意义）；角色卡本身不动。
            const lorePack = card ? lorePackOf(loreDraft ?? state?.lore?.[sessionId] ?? null) : undefined
            return packsCall({ op: 'save', name, items, overrides, tools, gate: gateMode, enabled: ownEnabled, ...(wsPreset ? { workspaceInstructions: wsPreset } : {}), ...(everyTurnStored !== null ? { everyTurn: everyTurnStored } : {}), ...(card ? { card } : {}), ...(lorePack !== undefined ? { lore: lorePack } : {}), ...seed, ...carryPayload() })
          })
          .then((data) => {
            adoptPacks(data)
            flash(`${t('savedAs')}「${name}」`)
            // 存完即视为在用这个预设（头部显示它的名字，「保存」直接覆盖它）。
            return postJson(STATE_ROUTE, undefined).then((fresh) =>
              postJson(STATE_ROUTE, {
                activePreset: { ...(fresh?.state?.activePreset ?? {}), [sessionId]: `pack:${name}` },
                // 来源标签跟着变：存下的格 = 来自预设，没存的（基于角色卡时）= 来自角色卡。
                slotSource: { ...(fresh?.state?.slotSource ?? {}), [sessionId]: layerFrom ? slotSourceOf(layerFrom.resolved, layerFrom.from) : slotSourceOf({ overrides: fresh?.state?.overrides?.[sessionId], gate: gateMode, tools: fresh?.state?.sessionTools?.[sessionId] ?? null, everyTurn: fresh?.state?.everyTurn?.[sessionId], items, workspaceInstructions: wsPreset }, { overrides: 'preset', gate: 'preset', tools: 'preset', everyTurn: 'preset', items: 'preset', workspaceInstructions: 'preset' }) },
                // 改过的世界书存进了预设：来源标签改成「来自预设」。
                ...(fresh?.state?.lore?.[sessionId]?.custom === true
                  ? { lore: { ...fresh.state.lore, [sessionId]: { ...fresh.state.lore[sessionId], source: 'preset' } } }
                  : {}),
              }).then((next) => {
                setLoreDraft(null)
                setEnvelope(next)
                setPackName(name)
                setMenu('')
              }),
            )
          })
          .catch(() => setStatus('error'))
      }
      // ── 「从当前会话取」→ 开场对话列表（只改预设的开场对话草稿，不动会话里已经发出的历史）──
      const cutTo = fetchCut !== null && fetchCut.toTurn > 0 ? fetchCut.toTurn : 0
      const commitFetch = (pending, mode, k) => {
        const before = items
        edit(placeFetched(items, pending.items, mode, k))
        setExpandedRows(new Set())
        setShownRows(ROW_BATCH)
        setFetchPending(null)
        setFetchCut({ fromTurn: pending.range.fromTurn, toTurn: pending.range.toTurn, lastTurn: pending.lastTurn })
        setCarryList((pending.constraints ?? []).map((entry) => ({ ...entry, on: entry.checked !== false })))
        if (seedDraft !== null && !seedAllowed(seedDraft, pending.range.toTurn)) {
          setSeedDraft(null)
          setSeedNote(t('seedDropped').replace('{n}', String(seedDraft.throughTurn)).replace('{m}', String(pending.range.toTurn)))
        }
        // 放置后都能撤销一小会儿（空列表直接放进来也算，撤销 = 回到空）。
        setUndoSnap({ items: before, mode })
        flash(t('fetchPlaced').replace('{n}', String(pending.items.length)))
      }
      const fetchFromSession = () => {
        const range = fetchRange(fetchOpts.fromTurn, fetchOpts.toTurn)
        setFetchBusy(true)
        void packsCall({ op: 'from-session', reasoning: fetchOpts.reasoning === true, fromTurn: range.fromTurn, ...(range.toTurn > 0 ? { toTurn: range.toTurn } : {}) })
          .then((data) => {
            const got = Array.isArray(data?.items) ? data.items : []
            if (got.length === 0) {
              flash(t('historyEmpty'))
              return
            }
            const pending = {
              items: got,
              range,
              turnCount: Number(data?.turnCount) || 0,
              lastTurn: Number(data?.lastTurn) || 0,
              toolCalls: Number(data?.toolCalls) || 0,
              constraints: Array.isArray(data?.constraints) ? data.constraints : [],
              tok: itemsTokens(got),
            }
            if (items.length === 0 && pending.tok <= FETCH_WARN_TOK) commitFetch(pending, 'replace')
            else {
              setPlaceAt(items.length)
              setFetchPending(pending)
            }
          })
          .catch(() => setStatus('error'))
          .finally(() => setFetchBusy(false))
      }
      const undoFetch = () => {
        if (undoSnap === null) return
        edit(undoSnap.items)
        setExpandedRows(new Set())
        setUndoSnap(null)
      }
      // 故事记忆：取本会话的摘要，保存预设时带上（不能晚于开场对话取到的末轮 M）。
      const fetchSeed = () => {
        void packsCall({ op: 'from-session', ...(cutTo > 0 ? { toTurn: cutTo } : {}) })
          .then((data) => {
            const memory = data?.memory ?? null
            if (memory === null || typeof memory.text !== 'string' || memory.text.trim() === '') {
              setSeedDraft(null)
              setSeedNote(t('seedNone'))
              return
            }
            if (!seedAllowed(memory, cutTo)) {
              setSeedDraft(null)
              setSeedNote(t('seedLate').replace('{n}', String(memory.throughTurn)).replace('{m}', String(cutTo)))
              return
            }
            setSeedNote('')
            setSeedDraft({ text: memory.text.trim(), throughTurn: Number(memory.throughTurn) || 0 })
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
        // 故事记忆里取过「本会话摘要」就用那一份（它已按开场对话的截取末轮核过）。
        const memorySeed = seedDraft !== null
          ? seedDraft
          : typeof remembered?.memory?.text === 'string' && remembered.memory.text.trim() !== ''
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
          // 改过的世界书跟着导出（只在带角色卡引用时；导入方需要有同一张卡）。
          ...(card === null || card === undefined || lorePackOf(loreDraft ?? state?.lore?.[sessionId] ?? null) === undefined ? {} : { lore: lorePackOf(loreDraft ?? state?.lore?.[sessionId] ?? null) }),
          ...(memorySeed === undefined ? {} : { memorySeed }),
          // 启用开关同样属于「面板下面的东西」：导出不带它，导入后关掉的项会悄悄全开。
          ...(ownEnabled && Object.keys(ownEnabled).length > 0 ? { enabled: ownEnabled } : {}),
          // 工作区说明：只带模式 + 改写正文，从不带 AGENTS.md 原文。
          ...(wsPreset ? { workspaceInstructions: wsPreset } : {}),
          // 约束承接：来自会话的标记 + 勾上的约束（导入时服务端同样编进每轮注入）。
          ...carryPayload(),
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
            // 只有开场条目的裸数组（服务端 `parsed.items ?? parsed` 认它）：不能直接 spread，
            // 否则数组被摊成 { '0': …, '1': … }，服务端就找不到 items[] 了。
            const json = Array.isArray(parsed) ? { name, items: parsed } : { ...parsed, name }
            void packsCall({ op: 'import', name, json })
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
      const hoveredCard = cards.find((card) => `card:${card.id}` === hoveredKey)
      const detail = hoveredBuiltin
        ? [
            h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } }, glyph(hoveredBuiltin), hoveredBuiltin.name),
            hoveredBuiltin.desc,
            hoveredBuiltin.pure ? t('footPure') : hoveredBuiltin.takeover ? t('footTakeover') : hoveredBuiltin.replace ? `${t('footReplace')} ≈${Math.round(hoveredBuiltin.personaChars * 0.7)} tok` : `${t('footSystem')} ≈${Math.round(hoveredBuiltin.personaChars * 0.7)} tok`,
          ]
        : hoveredPack
          ? [withIcon(hoveredPack.card ? 'user' : 'folder', hoveredPack.name), `${t('myPresetDesc')} · ${hoveredPack.count}${t('countSuffix')}`, hoveredPack.card ? t('packOnCard').replace('{name}', cards.find((card) => card.id === hoveredPack.card)?.name ?? hoveredPack.card) : '']
          : hoveredCard
            ? [hoveredCard.name, t('cardPresetDesc'), [hoveredCard.mode === 'pure' ? t('cardModePure') : t('cardModeAgent'), t('cardGreetings').replace('{n}', String(hoveredCard.greetings))].join(' · ')]
            : ['', t('presetsHint'), '']

      // 存预设用：本会话自己那格的配置。开关关着也带 —— 关的状态由 pack.enabled 带走，
      // 不再看条目里的 enabled（那是旧版勾选框留下的字段）。
      const ownEveryTurn = state?.everyTurn?.[sessionId]
      const everyTurnStored =
        (String(ownEveryTurn?.text ?? '').trim() !== '' || String(ownEveryTurn?.firstText ?? '').trim() !== '')
          ? { enabled: true, text: ownEveryTurn.text ?? '', firstText: ownEveryTurn.firstText ?? '', untilTurn: Number(ownEveryTurn.untilTurn) || 0, mode: ownEveryTurn.mode === 'auto' || ownEveryTurn.mode === 'until' || ownEveryTurn.mode === 'always' ? ownEveryTurn.mode : Number(ownEveryTurn.untilTurn) > 0 ? 'until' : 'always', checks: Array.isArray(ownEveryTurn.checks) ? ownEveryTurn.checks : [], auto: ownEveryTurn.auto ?? {}, ...(ownEveryTurn.seam === true ? { seam: true } : {}) }
          : null
      // 约束承接：取过会话 ⇒ 预设标记 fromSession，带上勾选的约束（服务端编成每轮注入，模式沿用 everyTurn）；
      // 没取过但本会话本身就是从这种预设开的 ⇒ 标记照样带上。
      const carryPayload = () =>
        carryList !== null
          ? { fromSession: true, carried: carryList.filter((entry) => entry.on === true).map(({ on: _on, checked: _checked, turns: _turns, lastTurn: _last, id: _id, ...rest }) => rest) }
          : ownEveryTurn?.seam === true
            ? { fromSession: true }
            : {}
      // 预设下拉（头部「当前预设 ▾」点开）：内置 + 我的，点一下即整体套用。
      const presetsMenu = h(
        'div',
        {
          'data-prefill-section': 'presets',
          'data-prefill-menu': 'presets',
          style: { ...V.popover, width: 'min(560px, calc(100% - 24px))' },
          onMouseLeave: () => setHovered(''),
        },
        h(
          'div',
          { style: V.pills },
          h('span', { style: V.pillGroup }, t('groupBuiltin')),
          ...builtins.map((preset) =>
            presetPill(`builtin:${preset.id}`, {
              icon: preset.icon,
              emoji: preset.emoji,
              name: preset.name,
              active: activePreset === `builtin:${preset.id}`,
              tip: preset.desc,
              onHover: () => setHovered(`builtin:${preset.id}`),
              onClick: () => void applyBuiltin(preset).catch(() => setStatus('error')),
            }),
          ),
        ),
        packs.length > 0
          ? h(
              'div',
              { style: V.pills },
              h('span', { style: V.pillGroup }, t('groupMine')),
              ...packs.map((pack) =>
                presetPill(`pack:${pack.name}`, {
                  icon: pack.card ? 'user' : 'folder',
                  name: pack.name,
                  tip: pack.card ? t('packOnCard').replace('{name}', cards.find((card) => card.id === pack.card)?.name ?? pack.card) : undefined,
                  active: activePreset === `pack:${pack.name}`,
                  onHover: () => setHovered(`pack:${pack.name}`),
                  onClick: () => void applyPack(pack.name).catch(() => setStatus('error')),
                }),
              ),
            )
          : null,
        // 角色卡（0.14）：套卡 = 套一个只有角色卡这一层的预设，和上面两组同一条路径、整体替换。
        cards.length > 0
          ? h(
              'div',
              { style: V.pills, 'data-prefill-preset-group': 'cards' },
              h('span', { style: V.pillGroup }, t('groupCards')),
              ...cards.map((card) =>
                h(
                  'button',
                  {
                    key: `card:${card.id}`,
                    type: 'button',
                    title: card.notes || card.name,
                    style: V.pill(activePreset === `card:${card.id}`),
                    onClick: () => void applyCardPreset(card).catch(() => setStatus('error')),
                    onMouseEnter: () => setHovered(`card:${card.id}`),
                    onFocus: () => setHovered(`card:${card.id}`),
                    'data-prefill-preset': `card:${card.id}`,
                    'aria-pressed': activePreset === `card:${card.id}` ? 'true' : 'false',
                  },
                  avatars[card.id]
                    ? h('img', { src: avatars[card.id], alt: '', style: { width: 16, height: 16, borderRadius: '50%', objectFit: 'cover', flex: '0 0 auto' } })
                    : glyph({ icon: card.icon }),
                  card.name,
                ),
              ),
            )
          : null,
        h(
          'div',
          { style: { ...V.detail, maxWidth: '68ch' } },
          detail[0] ? h('span', { style: { fontWeight: 700, color: 'var(--dsw-alias-label-primary)' } }, detail[0]) : null,
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
        h('div', { style: { ...V.hint, maxWidth: '68ch' }, 'data-prefill-preset-content': '' }, t('presetContentHint')),
      )

      // 「另存为…」：起名保存 / 导入导出文件（「从当前会话取」v0.10.1 起挪到开场对话里）。
      const saveAsPanel = h(
        'div',
        { 'data-prefill-section': 'presets', 'data-prefill-menu': 'saveas', style: { ...V.popover, width: 'min(560px, calc(100% - 24px))' } },
        h('div', { style: { ...V.hint, maxWidth: '68ch' } }, t('saveAsHint')),
        h(
          'div',
          { style: V.row },
          h('input', {
            style: { ...V.input, flex: '1 1 180px' },
            value: packName,
            placeholder: t('packNamePlaceholder'),
            spellCheck: false,
            'data-prefill-pack-name': '',
            onChange: (event) => setPackName(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') savePack()
            },
          }),
          h('button', { type: 'button', style: V.btnPrimary, onClick: () => savePack() }, t('savePack')),
        ),
        appliedRef
          ? h(
              'label',
              { style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--dsw-alias-label-secondary)', maxWidth: '68ch' } },
              h('input', { type: 'checkbox', checked: saveOnCard, 'data-prefill-save-on-card': '', onChange: (event) => setSaveOnCard(event.target.checked) }),
              t('saveOnCard').replace('{name}', appliedCardName),
            )
          : null,
        h(
          'div',
          { style: V.row },
          h('button', { type: 'button', style: V.btnGhost, onClick: () => void exportFile() }, withIcon('download', t('exportFile'), 12)),
          h('button', { type: 'button', style: V.btnGhost, onClick: () => fileRef.current?.click() }, withIcon('upload', t('importFile'), 12)),
        ),
        h('input', { ref: fileRef, type: 'file', accept: '.json,application/json', style: { display: 'none' }, onChange: importFile }),
      )

      const pickedCard = cards.find((card) => card.id === cardPick)
      const memoryBlock =
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
          : null

      const cardsSection = h(
        Section,
        {
          id: 'cards',
          title: t('cardsTitle'),
          meta: cards.length > 0 ? t('cardsMeta').replace('{n}', String(cards.length)) : '',
          off: !isOn('card'),
          offTitle: t('offTitle'),
          offBody: t('cardOffBody'),
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
        appliedCardName !== ''
          ? h('div', { style: { ...V.row, fontSize: 12.5 }, 'data-prefill-card-current': '' }, h('span', { style: V.sectionMeta }, t('cardCurrent')), h('b', null, appliedCardName), h('span', { style: V.sectionMeta }, appliedCardDesc))
          : null,
        // 「我的名字」是卡片自己的设置：套用中的卡改了名字 ⇒ 重新编译，只更新仍是卡原样的格。
        h(
          'div',
          { style: V.row },
          h('span', { style: V.sectionMeta }, t('cardUserName')),
          h('input', {
            style: { ...V.input, flex: '0 1 160px' },
            value: cardUser,
            placeholder: t('cardUserNamePlaceholder'),
            spellCheck: false,
            'data-prefill-card-user': '',
            onChange: (event) => setCardUser(event.target.value),
            onBlur: () => {
              previewCard(cardPick, cardUser)
              const was = typeof appliedRef?.opts?.userName === 'string' ? appliedRef.opts.userName : ''
              if (appliedRef && was.trim() !== cardUser.trim()) void refreshCardLayer(cardUser).catch(() => setStatus('error'))
            },
          }),
          h('span', { style: V.hint }, t('cardUserHint')),
        ),
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
                    pickedCard.mode === 'pure' ? t('cardModePure') : t('cardModeAgent'),
                    t('cardGreetings').replace('{n}', String(pickedCard.greetings)),
                    pickedCard.lore > 0 ? t('cardLore').replace('{n}', String(pickedCard.lore)) : '',
                    cardPreview ? `≈${estimateTokens(cardPreview.systemText)} tok` : '',
                  ]
                    .filter((part) => part !== '')
                    .join(' · '),
                ),
              ),
              h('div', { style: V.hint }, activePreset === `card:${pickedCard.id}` ? t('cardInUse') : t('cardApplyHint')),
              h(
                'div',
                { style: V.row },
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

      // ── 来源标签（0.14）：每格标「来自角色卡 / 来自预设 / 本会话改过」──
      const slotSrc = state?.slotSource?.[sessionId] ?? null
      const currentSlots = {
        overrides: state?.overrides?.[sessionId],
        gate: gateMode,
        tools: Array.isArray(state?.sessionTools?.[sessionId]) ? state.sessionTools[sessionId] : null,
        everyTurn: state?.everyTurn?.[sessionId],
        items,
        workspaceInstructions: state?.workspaceInstructions?.[sessionId],
      }
      const slotHas = {
        system: (typeof storedSystem === 'string' && storedSystem.trim() !== '') || gateMode !== 'pass',
        everyTurn: everyTurnShape(currentSlots.everyTurn) !== null,
        items: items.length > 0,
        tools: currentSlots.tools !== null,
        workspace: wsPreset !== null,
      }
      // 会话开跑后开场对话已写进历史、草稿清空：这时不标来源（不是「本会话改过」）。
      const tagOf = (slot) => (slot === 'items' && injectMode && items.length === 0 ? '' : slotTag(slotSrc, slot, currentSlots, slotHas[slot]))
      const TAG_COLOR = { card: 'var(--pf-card)', preset: 'var(--pf-system)', session: 'var(--dsw-alias-state-warn-primary)' }
      const sourceTag = (kind, prefix) =>
        kind === ''
          ? null
          : h(
              'span',
              {
                key: `src-${prefix ?? ''}`,
                'data-prefill-source': kind,
                title: t(`sourceTip_${kind}`),
                style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 7px', borderRadius: 999, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', color: `color-mix(in srgb, ${TAG_COLOR[kind]} 75%, var(--dsw-alias-label-primary))`, background: tint(TAG_COLOR[kind], 12) },
              },
              h('i', { style: { width: 6, height: 6, borderRadius: '50%', background: TAG_COLOR[kind], display: 'inline-block' } }),
              prefix ? `${prefix} · ${t(`source_${kind}`)}` : t(`source_${kind}`),
            )
      // 套着角色卡时，系统提示里多一组「带工具（Agent）/ 纯角色扮演」（原来在角色卡面板里）。
      const cardModeSeg = appliedRef
        ? h(
            'div',
            { style: V.row, 'data-prefill-card-mode-row': '' },
            h('span', { style: V.sectionMeta }, t('cardModeLabel')),
            h(
              'div',
              { style: V.seg, role: 'radiogroup' },
              ...[
                ['agent', t('cardModeAgent'), t('cardModeAgentTip'), 'wrench'],
                ['pure', t('cardModePure'), t('cardModePureTip'), 'message-circle'],
              ].map(([key, label, tip, icon]) => {
                const on = (gateMode === 'pure' ? 'pure' : 'agent') === key
                return h(
                  'button',
                  { key, type: 'button', role: 'radio', title: tip, 'aria-checked': on ? 'true' : 'false', style: V.segBtn(on), 'data-prefill-card-mode': key, onClick: () => (on ? undefined : void setCardMode(key).catch(() => setStatus('error'))) },
                  withIcon(icon, label, 12),
                )
              }),
            ),
            h('span', { style: V.hint }, t('cardModeHint')),
          )
        : null

      const systemSection = h(
        Section,
        {
          id: 'system',
          tags: sourceTag(tagOf('system')),
          title: t('systemTitle'),
          meta: systemMode === 'off' ? t('systemOffMeta') : systemMode === 'append' ? `${t('systemAppendMeta')} · ≈${systemTok} tok` : systemMode === 'replace' ? `${t('systemReplaceMeta')} · ≈${systemTok} tok` : `${t('systemTakeoverMeta')} · ≈${systemTok} tok`,
          off: !isOn('system') || systemFromCardOff,
          offTitle: !isOn('system') ? t('offTitle') : t('offByCardTitle'),
          offBody: !isOn('system') ? t('systemOffBody') : t('offByCardBody'),
        },
        cardModeSeg,
        h(
          'div',
          { style: V.row },
          h(
            'div',
            { style: V.seg, role: 'radiogroup' },
            // 「不改」不再是一种模式：要停用就关左栏开关（正文保留）。
            ...[
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
                  'aria-checked': (systemMode === 'off' ? 'append' : systemMode) === key ? 'true' : 'false',
                  style: V.segBtn((systemMode === 'off' ? 'append' : systemMode) === key),
                  'data-prefill-mode': key,
                  onClick: () => setSystemMode(key),
                },
                label,
              ),
            ),
          ),
          pending ? h('span', { style: { ...V.sectionMeta, color: 'var(--dsw-alias-state-warn-primary)' } }, t('nextTurnNotice')) : null,
        ),
        h('div', { style: V.hint }, systemMode === 'off' ? t('modeAppendHint') : systemMode === 'append' ? t('modeAppendHint') : systemMode === 'replace' ? t('modeReplaceHint') : t('modeTakeoverHint')),
        h('textarea', {
          style: { ...V.textarea, minHeight: 120, maxWidth: '90ch', opacity: isOn('system') ? 1 : 0.7 },
          value: systemText,
          spellCheck: false,
          placeholder: t('systemPlaceholder'),
          'data-prefill-system': '1',
          onChange: (event) => {
            systemDirty.current = true
            setSystemDraft(event.target.value)
          },
        }),
      )

      const itemRow = (item, index) => {
        const isAssistant = item?.role === 'assistant'
        const color = isAssistant ? 'var(--pf-ai)' : 'var(--pf-user)'
        const tok = estimateTokens(item?.text) + estimateTokens(item?.reasoning)
        const bare = { ...V.textarea, background: 'transparent', border: '1px solid transparent', padding: '4px 6px', minHeight: 44, maxWidth: '90ch', resize: 'vertical' }
        const long = isLongText(item?.text) || isLongText(item?.reasoning)
        const collapsed = long && !expandedRows.has(index)
        const setExpanded = (on) =>
          setExpandedRows((current) => {
            const next = new Set(current)
            if (on) next.add(index)
            else next.delete(index)
            return next
          })
        // 折叠的长卡片：只画前几行文字（不画 textarea），点「展开全文」才能编辑。
        const clamp = (lines) => ({ overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical', whiteSpace: 'pre-wrap', wordBreak: 'break-word' })
        const body = collapsed
          ? [
              isAssistant && String(item?.reasoning ?? '').trim() !== ''
                ? h('div', { key: 'r', style: { ...clamp(2), fontSize: 12, color: 'var(--dsw-alias-label-secondary)', background: 'var(--dsw-alias-bg-layer-1)', border: '1px dashed var(--dsw-alias-border-l2)', borderRadius: 8, padding: '4px 6px' } }, item.reasoning)
                : null,
              h('div', { key: 't', style: { ...clamp(3), fontSize: 13, padding: '2px 6px', color: 'var(--dsw-alias-label-primary)' } }, item?.text ?? ''),
              h(
                'button',
                { key: 'x', type: 'button', style: { ...V.btnGhost, alignSelf: 'flex-start', fontSize: 12 }, 'data-prefill-item-expand': '', onClick: () => setExpanded(true) },
                t('rowExpand').replace('{tok}', String(tok)),
              ),
            ]
          : null
        return h(
          'div',
          {
            key: index,
            'data-prefill-item': isAssistant ? 'assistant' : 'user',
            'data-collapsed': collapsed ? 'true' : 'false',
            style: { maxWidth: '90ch', borderRadius: 10, padding: '6px 8px 8px 10px', borderLeft: `3px solid ${color}`, background: tint(color, 10), display: 'flex', flexDirection: 'column', gap: 4, contentVisibility: 'auto', containIntrinsicSize: 'auto 96px' },
          },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h(
              'button',
              {
                type: 'button',
                style: { border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, color: `color-mix(in srgb, ${color} 75%, var(--dsw-alias-label-primary))` },
                title: isAssistant ? t('toUser') : t('toAssistant'),
                onClick: () => patchAt(index, isAssistant ? { role: 'user', reasoning: undefined } : { role: 'assistant', reasoning: '' }),
              },
              isAssistant ? withIcon('bot', t('roleAssistant'), 13) : withIcon('user', t('roleUser'), 13),
            ),
            h('span', { style: V.sectionMeta }, `#${index + 1} · ≈${tok} tok`),
            h('span', { style: { flex: '1 1 auto' } }),
            long && !collapsed ? h('button', { type: 'button', style: { ...V.btnGhost, fontSize: 11.5, padding: '0 6px', height: 22 }, 'data-prefill-item-collapse': '', onClick: () => setExpanded(false) }, t('rowCollapse')) : null,
            h('button', { type: 'button', style: S.dockMini, title: t('moveUp'), onClick: () => move(index, -1) }, '↑'),
            h('button', { type: 'button', style: S.dockMini, title: t('moveDown'), onClick: () => move(index, 1) }, '↓'),
            h('button', { type: 'button', style: S.dockMini, title: t('removeItem'), onClick: () => { setExpandedRows(new Set()); edit(items.filter((_unused, at) => at !== index)) } }, h(Icon, { name: 'x', size: 12 })),
          ),
          ...(body ?? []),
          body !== null
            ? null
            : isAssistant
            ? h('textarea', {
                style: { ...bare, minHeight: 34, fontSize: 12, color: 'var(--dsw-alias-label-secondary)', background: 'var(--dsw-alias-bg-layer-1)', border: '1px dashed var(--dsw-alias-border-l2)' },
                value: item?.reasoning ?? '',
                spellCheck: false,
                placeholder: t('reasoningPh'),
                onChange: (event) => patchAt(index, { reasoning: event.target.value }),
              })
            : null,
          body !== null
            ? null
            : h('textarea', {
                style: bare,
                value: item?.text ?? '',
                spellCheck: false,
                placeholder: isAssistant ? t('textAssistantPh') : t('textUserPh'),
                onChange: (event) => patchAt(index, { text: event.target.value }),
              }),
        )
      }

      // 开场对话头部：「从当前会话取」+ 带上思维链 + 第 N 轮 到 第 M 轮。
      const numInput = (attr, value, placeholder, onChange) =>
        h('input', {
          type: 'number',
          min: 1,
          [attr]: '',
          style: { ...V.input, width: 58, flex: '0 0 auto', padding: '0 6px' },
          value,
          placeholder,
          onChange: (event) => onChange(event.target.value),
        })
      const lastKnownTurn = fetchCut?.lastTurn || turns || 0
      const fetchBar = h(
        'div',
        { style: { ...V.row, gap: 10, rowGap: 6 }, 'data-prefill-fetch-bar': '' },
        h(
          'button',
          { type: 'button', style: { ...V.btn, opacity: fetchBusy ? 0.6 : 1 }, disabled: fetchBusy, 'data-prefill-history-open': '', title: t('historyTip'), onClick: fetchFromSession },
          fetchBusy ? '…' : t('historyOpen'),
        ),
        h(
          'label',
          { style: { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
          h('input', { type: 'checkbox', 'data-prefill-history-reasoning': '', checked: fetchOpts.reasoning === true, onChange: (event) => setFetchOpts({ ...fetchOpts, reasoning: event.target.checked }) }),
          t('historyReasoning'),
        ),
        h(
          'span',
          { style: { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'nowrap' } },
          t('rangeFrom'),
          numInput('data-prefill-history-from', fetchOpts.fromTurn, '1', (value) => setFetchOpts({ ...fetchOpts, fromTurn: value })),
          t('rangeTo'),
          numInput('data-prefill-history-to', fetchOpts.toTurn, lastKnownTurn > 0 ? String(lastKnownTurn) : t('rangeEnd'), (value) => setFetchOpts({ ...fetchOpts, toTurn: value })),
          t('rangeUnit'),
        ),
      )
      const pendingTok = fetchPending?.tok ?? 0
      // 约束承接：取来的会话里生效过的每轮约束，默认勾上，保存预设时编进每轮注入。
      const carrySrcKey = { session: 'carrySrcSession', preset: 'carrySrcPreset', card: 'carrySrcCard', default: 'carrySrcDefault', builtin: 'carrySrcBuiltin', history: 'carrySrcHistory' }
      const carryBox =
        carryList === null || carryList.length === 0
          ? null
          : h(
              'div',
              { style: { ...V.callout('brand'), display: 'flex', flexDirection: 'column', gap: 6, maxWidth: '68ch' }, 'data-prefill-carry-list': '' },
              h('div', null, h('b', null, t('carryTitle'))),
              h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, t('carryHint')),
              ...carryList.map((entry, index) =>
                h(
                  'label',
                  { key: entry.id ?? index, 'data-prefill-carry-item': entry.id ?? String(index), style: { display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12 } },
                  h('input', { type: 'checkbox', checked: entry.on === true, onChange: (event) => setCarryList((list) => (list ?? []).map((item, at) => (at === index ? { ...item, on: event.target.checked } : item))) }),
                  h(
                    'span',
                    { style: { minWidth: 0, flex: '1 1 auto' } },
                    h('b', null, entry.name || t('carryUnnamed')),
                    ' ',
                    h('span', { style: V.sectionMeta }, `${t(carrySrcKey[entry.source] ?? 'carrySrcHistory')} · ${Number(entry.turns) > 0 ? t('carryTurns').replace('{n}', String(entry.turns)) : t('carryNotYet')}`),
                    h(
                      'div',
                      { style: { color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, title: [entry.first, entry.text].filter((part) => String(part ?? '').trim() !== '').join('\n') },
                      String(entry.text || entry.first || '').replace(/\s+/g, ' ').slice(0, 160),
                    ),
                  ),
                ),
              ),
            )
      const fetchConfirm =
        fetchPending === null
          ? null
          : h(
              'div',
              { style: { ...V.callout(pendingTok > FETCH_WARN_TOK ? 'warn' : 'brand'), display: 'flex', flexDirection: 'column', gap: 6, maxWidth: '68ch' }, 'data-prefill-fetch-confirm': '' },
              h(
                'div',
                { 'data-prefill-history-meta': '' },
                h('b', null, t('fetchGot')),
                ' ',
                t('historyMeta').replace('{turns}', String(fetchPending.turnCount)).replace('{n}', String(fetchPending.items.length)).replace('{tok}', num(pendingTok)),
                fetchPending.toolCalls > 0 ? t('historyTools').replace('{n}', String(fetchPending.toolCalls)) : '',
              ),
              pendingTok > FETCH_WARN_TOK ? h('div', { 'data-prefill-fetch-warn': '' }, t('fetchBig').replace('{tok}', num(pendingTok)).replace('{limit}', num(FETCH_WARN_TOK))) : null,
              h(
                'div',
                { style: { ...V.row, gap: 8 } },
                items.length > 0 ? h('button', { type: 'button', style: V.btnPrimary, 'data-prefill-fetch-replace': '', onClick: () => commitFetch(fetchPending, 'replace') }, t('fetchReplace')) : null,
                items.length > 0
                  ? h(
                      'span',
                      { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
                      h('button', { type: 'button', style: V.btn, 'data-prefill-fetch-insert': '', onClick: () => commitFetch(fetchPending, 'insert', placeAt) }, t('fetchInsert')),
                      h(
                        'select',
                        {
                          'data-prefill-fetch-at': '',
                          value: String(placeAt),
                          style: { ...V.input, width: 'auto', flex: '0 0 auto', padding: '0 4px' },
                          onChange: (event) => setPlaceAt(Number(event.target.value)),
                        },
                        h('option', { key: 0, value: '0' }, t('fetchAtTop')),
                        ...items.map((_item, index) => h('option', { key: index + 1, value: String(index + 1) }, t('fetchAfterN').replace('{n}', String(index + 1)) + (index + 1 === items.length ? t('fetchAtEnd') : ''))),
                      ),
                    )
                  : h('button', { type: 'button', style: V.btnPrimary, 'data-prefill-fetch-replace': '', onClick: () => commitFetch(fetchPending, 'replace') }, t('fetchPut')),
                h('button', { type: 'button', style: V.btnGhost, 'data-prefill-fetch-cancel': '', onClick: () => setFetchPending(null) }, t('cancel')),
              ),
            )
      // 开场白（0.14，原来在角色卡面板里）：套着角色卡时放在开场对话最上面。选一句 = 换掉第一条 AI 回答；
      // 反过来，第一条 AI 回答改了，这里显示「已改过」。只改草稿。
      const greetingTexts = Array.isArray(appliedCompiled?.greetingTexts) ? appliedCompiled.greetingTexts : []
      const greetingAt = greetingIndex(items, greetingTexts)
      const greetingBar =
        appliedRef && greetingTexts.length > 0
          ? h(
              'div',
              { style: V.row, 'data-prefill-greeting-bar': '' },
              h('span', { style: V.sectionMeta }, t('cardGreeting')),
              h(
                'select',
                {
                  style: { ...V.input, flex: '0 1 320px', minWidth: 0 },
                  value: String(greetingAt),
                  'data-prefill-card-greeting': '',
                  onChange: (event) => {
                    const k = Number(event.target.value)
                    if (k === -2) return
                    setExpandedRows(new Set())
                    edit(withGreeting(items, greetingTexts, k))
                  },
                },
                ...(appliedCompiled?.greetings ?? []).map((text, index) => h('option', { key: index, value: String(index) }, `${index + 1}. ${text}`)),
                h('option', { key: 'none', value: '-1' }, t('cardNoGreeting')),
                greetingAt === -2 ? h('option', { key: 'custom', value: '-2' }, t('greetingEdited')) : null,
              ),
            )
          : null
      const itemsSection = h(
        Section,
        {
          id: 'items',
          tags: sourceTag(tagOf('items')),
          title: t('itemsTitle'),
          meta: `${countFilled(items)}${t('countSuffix')}${countFilled(items) < items.length ? t('emptyRowsSkipped').replace('%N', String(items.length - countFilled(items))) : ''} · ≈${itemsTok} tok · ${injectMode ? t('modeInject') : t('modeHistory')}${statusText === '' ? '' : ` · ${statusText}`}`,
          off: !isOn('items'),
          offTitle: t('offTitle'),
          offBody: t('itemsOffBody'),
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
                      const before = items
                      edit([])
                      setUndoSnap({ items: before, mode: 'clear' })
                    },
                  },
                  confirming === 'clear' ? t('confirmYes') : t('dockClear'),
                ),
        },
        greetingBar,
        fetchBar,
        fetchPending !== null ? fetchConfirm : null,
        carryBox,
        undoSnap !== null
          ? h(
              'div',
              { style: { ...V.row, ...V.callout('brand'), maxWidth: '68ch' }, 'data-prefill-fetch-undo-bar': '' },
              h('span', { style: { flex: '1 1 auto', minWidth: 0 } }, undoSnap.mode === 'replace' ? t('fetchReplaced') : undoSnap.mode === 'clear' ? t('fetchCleared') : t('fetchInserted')),
              h('button', { type: 'button', style: V.btn, 'data-prefill-fetch-undo': '', onClick: undoFetch }, t('undo')),
            )
          : null,
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
        h(
          'div',
          { ref: listRef, style: { display: 'flex', flexDirection: 'column', gap: 6 }, 'data-prefill-items': '', 'data-rendered': String(Math.min(items.length, shownRows)) },
          // 分批渲染：一次只画 ROW_BATCH 条，之后每帧再加一批（200 条带长思维链也不会一下卡住）。
          ...items.slice(0, shownRows).map(itemRow),
          items.length > shownRows ? h('div', { key: 'more', style: V.hint }, t('rowsLoading').replace('{n}', String(items.length - shownRows))) : null,
        ),
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
      // ── v0.15 积木 / 积木塔 / 工作台 ────────────────────────────────────────
      // <bench-helpers>
      // 与 blocks.js 同一份纯函数（浏览器模块 import 不了插件自己的文件，
      // 照 everyTurnSwitchOn / fetch-helpers 的先例抄一份；tests/blocks.test.mjs 比对两份一致）。
      const PRIORITY_PREFIX = '（以下为用户补充，与上文冲突时以此为准）'
      const CHECK_ORDER = ['zh', 'four', 'noLeak', 'firstPerson']
      function normalizeChecks(raw) {
        const list = Array.isArray(raw) ? raw.filter((id) => CHECK_ORDER.includes(id)) : []
        return CHECK_ORDER.filter((id) => list.includes(id))
      }
      function makeBlock(input) {
        const source = input ?? {}
        const block = {
          id: String(source.id ?? ''),
          name: String(source.name ?? '').trim() || '未命名积木',
          icon: typeof source.icon === 'string' ? source.icon : '',
          desc: typeof source.desc === 'string' ? source.desc : '',
          first: String(source.first ?? ''),
          text: String(source.text ?? ''),
          checks: normalizeChecks(source.checks),
          overlaps: Array.isArray(source.overlaps) ? source.overlaps.filter((id) => typeof id === 'string' && id !== '') : [],
          builtin: source.builtin === true,
        }
        if (typeof source.overrides === 'string' && source.overrides !== '') block.overrides = source.overrides
        if (typeof source.updatedAt === 'string' && source.updatedAt !== '') block.updatedAt = source.updatedAt
        return block
      }
      function blockFromPreset(preset) {
        return makeBlock({
          id: preset.id, name: preset.name, icon: preset.icon, desc: preset.desc,
          first: preset.firstText, text: preset.text, checks: preset.checks, overlaps: preset.overlaps, builtin: true,
        })
      }
      function benchBlockOf(block, key, tower) {
        return {
          key, ref: block.id, tower: tower ?? null, name: block.name, icon: block.icon ?? '',
          first: block.first, text: block.text, checks: [].concat(block.checks ?? []),
          edited: false, priority: false, builtin: block.builtin === true,
        }
      }
      function unionChecks(bench) {
        const list = Array.isArray(bench) ? bench : []
        const seen = new Set()
        for (const block of list) for (const id of normalizeChecks(block && block.checks)) seen.add(id)
        return CHECK_ORDER.filter((id) => seen.has(id))
      }
      function compileBench(bench) {
        const list = Array.isArray(bench) ? bench.filter((block) => block !== null && typeof block === 'object') : []
        const first = []
        const rest = []
        for (const block of list) {
          const text = String(block.text ?? '')
          const head = String(block.first ?? '')
          const wrap = (value) => (String(value).trim() === '' ? '' : block.priority === true ? PRIORITY_PREFIX + value : value)
          const firstBody = head.trim() !== '' ? wrap(head) : wrap(text)
          const restBody = wrap(text)
          if (firstBody.trim() !== '') first.push(firstBody)
          if (restBody.trim() !== '') rest.push(restBody)
        }
        return { firstText: first.join('\n'), text: rest.join('\n'), checks: unionChecks(list) }
      }
      function flattenTower(tower, towers, blocks) {
        const out = []
        const items = Array.isArray(tower && tower.items) ? tower.items : []
        for (const item of items) {
          if (item === null || typeof item !== 'object') continue
          const ref = String(item.ref ?? '')
          const block = (blocks ?? []).find((entry) => entry.id === ref)
          if (block !== undefined) {
            out.push({
              ...block,
              first: typeof item.first === 'string' ? item.first : block.first,
              text: typeof item.text === 'string' ? item.text : block.text,
            })
            continue
          }
          const inner = (towers ?? []).find((entry) => entry.id === ref)
          if (inner !== undefined) out.push(...flattenTower(inner, towers, blocks))
          else if (item.snap !== null && typeof item.snap === 'object') {
            out.push(makeBlock({ id: ref, name: String(item.snap.name ?? ref), first: item.snap.first, text: item.snap.text, checks: item.snap.checks }))
          }
        }
        return out
      }
      function addTowerToBench(bench, tower, towers, blocks, makeKey) {
        const list = Array.isArray(bench) ? [...bench] : []
        const have = new Set(list.map((block) => block.ref))
        for (const block of flattenTower(tower, towers, blocks)) {
          if (have.has(block.id)) continue
          have.add(block.id)
          list.push(benchBlockOf(block, makeKey(), tower.id))
        }
        return list
      }
      function benchSummary(bench) {
        const compiled = compileBench(bench)
        return {
          firstTok: String(compiled.firstText ?? '').length,
          restTok: String(compiled.text ?? '').length,
          blocks: Array.isArray(bench) ? bench.length : 0,
          checks: compiled.checks,
        }
      }
      function migrateEveryTurn(entry, options) {
        const blocks = (options && options.blocks) ?? []
        const towers = (options && options.towers) ?? []
        const key = (options && options.makeKey) ?? (() => 'b1')
        const text = String((entry && entry.text) ?? '')
        const first = String((entry && entry.firstText) ?? '')
        const checks = normalizeChecks(entry && entry.checks)
        if (text.trim() === '' && first.trim() === '') return { bench: [], benchTowers: {} }
        // 旧 checks 是独立勾选的：认出积木时保留旧 checks；塔的 checks 对不上就不认成塔（与 blocks.js 同一份逻辑）。
        const sameChecks = (list) => list.length === checks.length && list.every((id, index) => id === checks[index])
        const block = blocks.find((candidate) => String(candidate.first ?? '') === first && String(candidate.text ?? '') === text)
        if (block !== undefined) {
          const placed = benchBlockOf(block, key())
          if (!sameChecks(placed.checks)) {
            placed.checks = [...checks]
            placed.edited = true
          }
          return { bench: [placed], benchTowers: {} }
        }
        // 旧模型里 firstText === '' 表示「没有首轮专用段」；工作台里如果每块都没有 first，
        // 编译出来的 firstText 会等于 text。两种写法等价，都要认（与 blocks.js 同一份逻辑）。
        const sameFirst = (compiled) => compiled.firstText === first || (first.trim() === '' && compiled.firstText === compiled.text)
        for (const tower of towers) {
          const flat = flattenTower(tower, towers, blocks).map((item, index) => benchBlockOf(item, 't' + index))
          const compiled = compileBench(flat)
          if (compiled.text === text && sameFirst(compiled) && sameChecks(compiled.checks)) {
            return {
              bench: addTowerToBench([], tower, towers, blocks, key),
              benchTowers: { [tower.id]: { ref: tower.id, name: tower.name, collapsed: false } },
            }
          }
        }
        const custom = makeBlock({ id: 'my:' + key(), name: '自定义', first, text, checks })
        return { bench: [benchBlockOf(custom, key())], benchTowers: {} }
      }
      // </bench-helpers>
      const benchSeq = { n: 0 }
      const nextBenchKey = () => 'b' + (benchSeq.n += 1).toString(36) + Math.random().toString(36).slice(2, 5)
      // 读取时迁移每次渲染都会重跑：key 必须确定（同一份旧条目每次得到同样的 key），
      // 否则每次渲染块 key 都变，React 重挂 textarea —— 一聚焦（setBenchFocus 触发重渲染）就丢焦点、打不了字。
      // 'm' 前缀和 nextBenchKey 的 'b' 不会撞。
      const migrateKeys = () => {
        let n = 0
        return () => 'm' + (n += 1).toString(36)
      }
      const builtinBlocks = (Array.isArray(everyTurnBlockList) && everyTurnBlockList.length > 0 ? everyTurnBlockList : everyTurnList).map((preset) => blockFromPreset(preset))
      const builtinTowers = (Array.isArray(everyTurnTowerList) ? everyTurnTowerList : []).map((tower) => ({ ...tower, builtin: true }))
      const myBlocks = Object.values(state?.blocks ?? {}).map((block) => makeBlock(block))
      const myTowers = Object.values(state?.towers ?? {}).map((tower) => ({ ...tower, builtin: false }))
      const allBlocks = [...builtinBlocks, ...myBlocks]
      const allTowers = [...builtinTowers, ...myTowers]
      const hiddenBuiltins = Array.isArray(state?.hiddenBuiltins) ? state.hiddenBuiltins : []
      const visibleBlocks = allBlocks.filter((block) => !hiddenBuiltins.includes(block.id))
      const visibleTowers = allTowers.filter((tower) => !hiddenBuiltins.includes(tower.id))

      const storedEveryTurn = state?.everyTurn?.[sessionId] ?? state?.everyTurn?.['*'] ?? null
      // ── 角色卡塔（0.15.1）：把卡的每轮提醒拆成 1–3 块 ─────────────────
      // 卡编译出的每轮提醒 = 角色提醒 + 中文思考行 + 第一人称行。拆成「角色提醒」「中文思考」
      // 「第一人称思考」三块：块的去留 = 那几行在不在工作台上。
      const CARD_ZH_TEXT = '思维链（reasoning）全程用中文。'
      const CARD_FP_PATTERN = /思维链也用[^。]*第一人称来想，不要把对方称为"用户"(?:，就叫[^。]*)?。/
      const cardChar = String(appliedCardName ?? '')
      const cardUserName = String(appliedRef?.opts?.userName ?? '').trim()
      const CARD_FP_TEXT =
        '思维链也用' + cardChar + '的第一人称来想，不要把对方称为"用户"' + (cardUserName === '' ? '' : '，就叫' + cardUserName) + '。'
      const cardBenchBlocks = (() => {
        const compiled = appliedCompiled
        if (appliedRef === null || appliedRef === undefined || compiled === null || compiled === undefined) return []
        let raw = String(compiled.everyTurn?.text ?? '')
        if (raw.trim() === '') return []
        let zh = ''
        let fp = ''
        const fpMatch = raw.match(CARD_FP_PATTERN)
        if (fpMatch !== null) { fp = fpMatch[0]; raw = raw.replace(fp, '') }
        if (raw.includes(CARD_ZH_TEXT)) { zh = CARD_ZH_TEXT; raw = raw.replace(CARD_ZH_TEXT, '') }
        const base = raw.replace(/[ \t]+\n/g, '\n').trim()
        const firstText = String(compiled.everyTurn?.firstText ?? '')
        const towerName = t('cardTowerName').replace('{name}', cardChar)
        const name = t('cardBlockReinforce')
        const out = []
        if (base !== '') out.push({ ...makeBlock({ id: 'card:reinforce', name, icon: 'user', first: firstText, text: base, checks: [], builtin: false }), towerName })
        if (zh !== '') out.push(makeBlock({ id: 'card:zh', name: t('cardBlockZh'), icon: 'user', first: '', text: zh, checks: ['zh'], builtin: false }))
        if (fp !== '') out.push(makeBlock({ id: 'card:firstPerson', name: t('cardBlockFirstPerson'), icon: 'user', first: '', text: fp, checks: ['firstPerson'], builtin: false }))
        return out
      })()
      const cardTower = cardBenchBlocks.length === 0 ? null : {
        id: 'card',
        name: String(cardBenchBlocks[0].towerName ?? cardChar),
        icon: 'user',
        builtin: false,
        card: true,
        items: cardBenchBlocks.map((block) => ({ ref: block.id, snap: { name: block.name, first: block.first, text: block.text, checks: block.checks } })),
      }
      const storedMode =
        storedEveryTurn?.mode === 'auto' || storedEveryTurn?.mode === 'until' || storedEveryTurn?.mode === 'always'
          ? storedEveryTurn.mode
          : Number(storedEveryTurn?.untilTurn) > 0
            ? 'until'
            : 'always'
      // 卡塔迁移也要用确定的 key：#17 之后迁移 key 必须稳定，否则 textarea 每次渲染被重挂。
      const cardMigrateKeys = migrateKeys()
      // v0.15：条目里有 bench 就用它；旧条目（只有 text/firstText/checks）读取时迁移成工作台。
      const benchMigrated = Array.isArray(storedEveryTurn?.bench)
        ? { bench: storedEveryTurn.bench, benchTowers: storedEveryTurn.benchTowers ?? {} }
        : cardBenchBlocks.length > 0 &&
            String(storedEveryTurn?.text ?? '') === String(appliedCompiled?.everyTurn?.text ?? '') &&
            String(storedEveryTurn?.text ?? '').trim() !== ''
          ? { bench: cardBenchBlocks.map((block) => benchBlockOf(block, cardMigrateKeys(), 'card')), benchTowers: { card: { ref: 'card', name: String(cardBenchBlocks[0].towerName ?? cardChar), collapsed: false } } }
          : migrateEveryTurn(storedEveryTurn, { blocks: allBlocks, towers: allTowers, makeKey: migrateKeys() })
      const everyTurn = everyTurnDraft ?? {
        // 开/关归左栏那一个开关（state.enabled）；条目里的 enabled 只是旧值，由 everyTurnSwitchOn 兜住。
        enabled: true,
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
        bench: benchMigrated.bench,
        benchTowers: benchMigrated.benchTowers,
        asDefault: state?.everyTurn?.['*']?.enabled === true,
        // 约束承接的接缝标记：只认本会话那格，改面板时别丢。
        seam: state?.everyTurn?.[sessionId]?.seam === true,
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
        // v0.15：有工作台时，text / firstText / checks 一律由工作台编译得到（gate 只读这三个）。
        const hasBench = Array.isArray(nextValue.bench) && nextValue.bench.length > 0
        const compiled = hasBench ? compileBench(nextValue.bench) : null
        const entry = {
          // 永远 true：关由左栏开关负责（写 false 会变成「开关开着也不注入」的旧状态）。
          enabled: true,
          text: compiled !== null ? compiled.text : String(nextValue.text ?? ''),
          firstText: compiled !== null ? compiled.firstText : String(nextValue.firstText ?? ''),
          untilTurn: Math.max(0, Math.floor(Number(nextValue.untilTurn) || 0)),
          mode: nextValue.mode === 'auto' || nextValue.mode === 'until' ? nextValue.mode : 'always',
          checks: compiled !== null ? compiled.checks : Array.isArray(nextValue.checks) ? nextValue.checks : [],
          auto,
          ...(hasBench ? { bench: nextValue.bench, benchTowers: nextValue.benchTowers ?? {} } : {}),
          ...(nextValue.seam === true ? { seam: true } : {}),
        }
        map[sessionId] = entry
        if (nextValue.asDefault === true) {
          const { override: _ignored, ...autoForDefault } = auto
          const { seam: _seam, ...forDefault } = entry
          map['*'] = { ...forDefault, auto: autoForDefault }
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
            .then(() => flash(isOn('everyTurn') && (String(nextValue.text).trim() !== '' || String(nextValue.firstText ?? '').trim() !== '') ? t('everyTurnSaved') : t('everyTurnOffSaved')))
            .catch(() => setStatus('error'))
        if (immediate) run()
        else everyTurnTimer.current = setTimeout(run, 700)
      }
      // ── v0.15：工作台（积木 / 积木塔）────────────────────────────────────────
      const benchNarrow = bounds?.narrow === true
      /** 输入框按内容自动增高（展开着的长块、世界书编辑）。 */
      const autoGrow = (node) => {
        if (node === null || node === undefined) return
        node.style.height = 'auto'
        node.style.height = node.scrollHeight + 2 + 'px'
      }
      const bench = Array.isArray(everyTurn.bench) ? everyTurn.bench : []
      const benchTowers = everyTurn.benchTowers ?? {}
      const benchSummaryNow = benchSummary(bench)
      const setBench = (nextBench, nextTowers, immediate = true) => {
        const keep = { ...(nextTowers ?? benchTowers) }
        for (const key of Object.keys(keep)) if (!nextBench.some((block) => block.tower === key)) delete keep[key]
        editEveryTurn({ bench: nextBench, benchTowers: keep }, immediate)
      }
      const addBlockToBench = (block) => setBench([...bench, benchBlockOf(block, nextBenchKey())])
      const removeBlockFromBench = (key) => setBench(bench.filter((block) => block.key !== key))
      const patchBenchBlock = (key, patch, immediate) =>
        // 打字（immediate = false）走 700ms 去抖，别每个键都整份写两趟状态（并发写可能乱序、丢最后几个字）。
        setBench(bench.map((block) => (block.key === key ? { ...block, ...patch, edited: true } : block)), benchTowers, immediate !== false)
      const moveBenchBlock = (key, delta) => {
        const at = bench.findIndex((block) => block.key === key)
        const to = at + delta
        if (at < 0 || to < 0 || to >= bench.length) return
        const next = [...bench]
        const moved = next.splice(at, 1)[0]
        next.splice(to, 0, moved)
        setBench(next)
      }
      /** 拖到第 index 个位置（0..bench.length），顺带决定它属不属于某个塔框。 */
      const moveBlockTo = (key, index, tower) => {
        const at = bench.findIndex((block) => block.key === key)
        if (at < 0) return
        const next = [...bench]
        const moved = { ...next.splice(at, 1)[0], tower: tower ?? null }
        const target = at < index ? index - 1 : index
        next.splice(Math.max(0, Math.min(next.length, target)), 0, moved)
        setBench(next)
      }
      const addTowerToBenchNow = (tower) => {
        const nextBench = addTowerToBench(bench, tower, allTowers, allBlocks, nextBenchKey)
        setBench(nextBench, { ...benchTowers, [tower.id]: { ref: tower.id, name: tower.name, collapsed: false } })
      }
      const removeTowerFromBench = (towerKey) => {
        const next = { ...benchTowers }
        delete next[towerKey]
        setBench(bench.filter((block) => block.tower !== towerKey), next)
      }
      const toggleTowerCollapsed = (towerKey) => {
        const tower = benchTowers[towerKey]
        if (tower === undefined) return
        setBench(bench, { ...benchTowers, [towerKey]: { ...tower, collapsed: tower.collapsed !== true } })
      }
      /** 台上某块和哪些块重叠（双向，按内置积木的 overlaps 定义）。 */
      const benchOverlapsOf = (block) => {
        const refs = new Set(bench.map((item) => item.ref))
        const self = allBlocks.find((item) => item.id === block.ref)
        return ((self && self.overlaps) || []).filter((id) => id !== block.ref && refs.has(id))
      }
      /** 重叠对（去重，按台上顺序）。 */
      const benchOverlapPairs = () => {
        const pairs = []
        const seen = new Set()
        for (const block of bench) {
          for (const other of benchOverlapsOf(block)) {
            const id = [block.ref, other].sort().join('|')
            if (seen.has(id)) continue
            seen.add(id)
            pairs.push({ a: block.ref, b: other })
          }
        }
        return pairs
      }
      // 我的积木 / 塔 / 隐藏项：走 packs 路由的 4 个 op（服务端校验、同一把锁）
      const benchCall = (payload) => postJson(PACKS_ROUTE, { sessionId, ...payload })
      const afterBenchCall = (data) => { adoptPacks(data); setEnvelope(data); notifyStateChanged(); return data }
      const saveAsMyBlock = (block, name) => {
        const entry = makeBlock({
          id: block.builtin === true ? 'my:' + block.ref : block.ref,
          name: String(name ?? block.name + t('benchMySuffix')).trim() || block.name,
          icon: block.icon,
          first: block.first,
          text: block.text,
          checks: block.checks,
          ...(block.builtin === true ? { overrides: block.ref } : {}),
        })
        void benchCall({ op: 'block-save', block: { ...entry, updatedAt: new Date().toISOString() } })
          .then((data) => { afterBenchCall(data); flash(t('blockSaved')) })
          .catch(() => setStatus('error'))
      }
      const deleteMyBlock = (id) => {
        void benchCall({ op: 'block-delete', id })
          .then((data) => { afterBenchCall(data); flash(t('blockDeleted')) })
          .catch(() => setStatus('error'))
      }
      const saveTower = (tower) => {
        void benchCall({ op: 'tower-save', tower })
          .then((data) => { afterBenchCall(data); flash(t('towerSaved')) })
          .catch(() => setStatus('error'))
      }
      const deleteTower = (id) => {
        void benchCall({ op: 'tower-delete', id }).then((data) => afterBenchCall(data)).catch(() => setStatus('error'))
      }
      const setHiddenBuiltins = (ids) => {
        void benchCall({ op: 'hidden-set', ids }).then((data) => afterBenchCall(data)).catch(() => setStatus('error'))
      }
      const hideBuiltin = (id) => setHiddenBuiltins([...new Set([...hiddenBuiltins, id])])
      const unhideBuiltin = (id) => setHiddenBuiltins(hiddenBuiltins.filter((value) => value !== id))
      const cardTowerOnBench = cardTower !== null && bench.some((block) => block.tower === 'card' || block.ref.startsWith('card:'))
      /** 放进 / 换成最新的角色卡塔（卡编译出几块就放几块）。 */
      const applyCardTower = () => {
        if (cardTower === null) return
        const others = bench.filter((block) => !block.ref.startsWith('card:'))
        setBench([...others, ...cardBenchBlocks.map((block) => benchBlockOf(block, nextBenchKey(), 'card'))], {
          ...benchTowers,
          card: { ref: 'card', name: cardTower.name, collapsed: false },
        })
      }
      const removeCardTower = () => {
        const next = { ...benchTowers }
        delete next.card
        setBench(bench.filter((block) => !block.ref.startsWith('card:')), next)
      }
      /** 卡塔里的「中文思考 / 第一人称思考」：只在工作台上加 / 减一块 —— 不动卡本身，
       *  免得卡重编译把整张工作台冲掉。 */
      const toggleCardBlock = (kind) => {
        if (appliedRef === null || appliedRef === undefined) return
        const ref = kind === 'zh' ? 'card:zh' : 'card:firstPerson'
        if (bench.some((block) => block.ref === ref)) {
          setBench(bench.filter((block) => block.ref !== ref))
          return
        }
        const block = makeBlock({
          id: ref,
          name: kind === 'zh' ? t('cardBlockZh') : t('cardBlockFirstPerson'),
          icon: 'user',
          first: '',
          text: kind === 'zh' ? CARD_ZH_TEXT : CARD_FP_TEXT,
          checks: [kind === 'zh' ? 'zh' : 'firstPerson'],
          builtin: false,
        })
        setBench([...bench, benchBlockOf(block, nextBenchKey(), 'card')], {
          ...benchTowers,
          card: benchTowers.card ?? { ref: 'card', name: cardTower?.name ?? String(appliedRef.name ?? ''), collapsed: false },
        })
      }
      /** 台上删掉一块：卡塔的思考块 = 关掉对应开关，角色提醒块 = 整座塔拿走。 */
      const dropBlockFromBench = (block) => {
        if (block.ref === 'card:zh') return toggleCardBlock('zh')
        if (block.ref === 'card:firstPerson') return toggleCardBlock('firstPerson')
        if (block.ref === 'card:reinforce') return removeCardTower()
        removeBlockFromBench(block.key)
      }
      /** 预览分段（状态 B）：每块一段，带来源色；纯首轮块在第 2 轮那栏划掉。 */
      const previewSegments = (round) => {
        const out = []
        for (const block of bench) {
          const text = String(block.text ?? '')
          const first = String(block.first ?? '')
          const gone = round !== 1 && text.trim() === '' && first.trim() !== ''
          const body = round === 1 && first.trim() !== '' ? first : gone ? first : text
          if (body.trim() === '') continue
          const kind = block.ref.startsWith('card:') ? 'card' : block.builtin === true ? 'builtin' : 'mine'
          out.push({ key: block.key, text: block.priority === true ? PRIORITY_PREFIX + body : body, kind, gone })
        }
        return out
      }
      /** 拖动：Pointer Events 自己实现（影子挂 body，落点算插入位置）。 */
      const startDrag = (event, block) => {
        if (event.button !== undefined && event.button !== 0) return
        const list = benchListRef.current
        if (list === null) return
        // 不拦默认行为的话，按住把手往下拖就是一次文字框选：沿途的块名 / 文字被选中（蓝条）。
        event.preventDefault()
        const prevSelect = document.body.style.userSelect
        document.body.style.userSelect = 'none'
        window.getSelection?.()?.removeAllRanges?.()
        const rows = [...list.querySelectorAll('[data-prefill-bench-block]')]
        const rects = rows.map((node) => {
          const rect = node.getBoundingClientRect()
          return { key: node.getAttribute('data-prefill-bench-block') ?? '', top: rect.top, height: rect.height }
        })
        const frames = [...list.querySelectorAll('[data-prefill-bench-tower]')].map((node) => {
          const rect = node.getBoundingClientRect()
          return { key: node.getAttribute('data-prefill-bench-tower') ?? '', top: rect.top, bottom: rect.bottom }
        })
        const startY = event.clientY
        let moved = false
        const ghost = document.createElement('div')
        ghost.textContent = block.name
        ghost.style.cssText =
          'position:fixed;z-index:99999;pointer-events:none;padding:5px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-secondary);box-shadow:0 8px 24px rgba(0,0,0,.22);font-size:12px;transform:translate(-50%,-50%);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'
        ghost.style.left = event.clientX + 'px'
        ghost.style.top = event.clientY + 'px'
        dragInfo.current = { key: block.key }
        const move = (ev) => {
          if (!moved && Math.abs(ev.clientY - startY) < 4) return
          if (!moved) {
            moved = true
            document.body.appendChild(ghost)
            setDragKey(block.key)
          }
          ghost.style.left = ev.clientX + 'px'
          ghost.style.top = ev.clientY + 'px'
          let index = rects.length
          for (let i = 0; i < rects.length; i += 1) {
            const mid = rects[i].top + rects[i].height / 2
            if (ev.clientY < mid) { index = i; break }
          }
          const frame = frames.find((item) => ev.clientY >= item.top && ev.clientY <= item.bottom)
          dragInfo.current = { key: block.key, index, tower: frame ? frame.key : null }
          setDropIndex((current) => (current === index ? current : index))
        }
        const up = () => {
          document.removeEventListener('pointermove', move)
          document.removeEventListener('pointerup', up)
          document.removeEventListener('pointercancel', cancel)
          document.body.style.userSelect = prevSelect
          ghost.remove()
          const info = dragInfo.current
          dragInfo.current = null
          setDragKey('')
          setDropIndex(-1)
          if (moved && info !== null && typeof info.index === 'number') moveBlockTo(block.key, info.index, info.tower ?? null)
        }
        document.addEventListener('pointermove', move)
        document.addEventListener('pointerup', up)
        // 被系统打断（切窗口、触屏手势）：收尾但不落位。
        const cancel = () => {
          moved = false
          up()
        }
        document.addEventListener('pointercancel', cancel)
      }
      // 长块默认收起（只渲染几行预览，降低渲染压力）；展开后输入框按内容增高。
      const benchLong = (block) => {
        const all = String(block.first ?? '') + '\n' + String(block.text ?? '')
        return all.length > 240 || all.split('\n').length > 8
      }
      const setBenchBlockOpen = (key, open) =>
        setBenchOpen((current) => {
          if (current.has(key) === open) return current
          const next = new Set(current)
          if (open) next.add(key)
          else next.delete(key)
          return next
        })
      const benchLongKeys = bench.filter(benchLong).map((block) => block.key)
      const benchAllOpen = benchLongKeys.length > 0 && benchLongKeys.every((key) => benchOpen.has(key))
      /** 展开着的长块：输入框按内容增高；刚从预览点开的那块顺手聚焦。 */
      const benchGrowRef = (key) => (node) => {
        autoGrow(node)
        if (node !== null && benchFocusNext.current === key) {
          benchFocusNext.current = ''
          node.focus()
        }
      }
      const benchCard = (block) => {
        const index = bench.findIndex((item) => item.key === block.key)
        const long = benchLong(block)
        const folded = long && !benchOpen.has(block.key)
        const grow = long ? { maxHeight: 'none', overflow: 'hidden' } : {}
        const overlaps = benchOverlapsOf(block)
        const other = overlaps.length > 0 ? allBlocks.find((item) => item.id === overlaps[0]) : null
        const kind = block.ref.startsWith('card:') ? 'card' : block.builtin === true ? 'builtin' : 'mine'
        const color = benchColor(kind)
        return h(
          'div',
          {
            key: block.key,
            'data-prefill-bench-block': block.key,
            'data-ref': block.ref,
            'data-edited': block.edited ? '1' : '0',
            style: {
              position: 'relative',
              border: '1px solid var(--dsw-alias-border-secondary)',
              borderLeft: '4px solid ' + color,
              borderTop: '1px solid var(--dsw-alias-border-secondary)',
              ...(dropIndex === index && dragKey !== '' ? { boxShadow: 'inset 0 3px 0 var(--pf-turn)' } : {}),
              borderRadius: 10,
              background: 'var(--dsw-alias-bg-layer-1)',
              ...(dragKey === block.key ? { opacity: 0.45 } : {}),
              ...(benchFocus === block.key ? { boxShadow: '0 0 0 3px color-mix(in srgb, var(--pf-turn) 18%, transparent)' } : {}),
            },
          },
          h(
            'div',
            { style: { ...V.row, gap: 6, alignItems: 'center', padding: '5px 8px 0 6px', fontSize: 12 } },
            benchNarrow
              ? null
              : h('span', { style: { cursor: 'grab', color: 'var(--dsw-alias-label-tertiary)', letterSpacing: '-2px', padding: '0 2px', touchAction: 'none' }, 'data-prefill-bench-grip': block.key, onPointerDown: (event) => startDrag(event, block) }, '⋮⋮'),
            h('span', { style: { fontWeight: 700 } }, block.name),
            benchNarrow
              ? null
              : h('span', { style: { ...V.sectionMeta, padding: '0 6px', borderRadius: 999, background: 'color-mix(in srgb, ' + color + ' 14%, transparent)' } }, kind === 'card' ? t('benchFromCard') : block.builtin === true ? t('benchFromBuiltin') : t('benchFromMine')),
            block.edited
              ? h('span', { style: { ...V.sectionMeta, color: 'var(--pf-turn)', display: 'inline-flex', alignItems: 'center', gap: 4 } }, h('span', { style: { width: 7, height: 7, borderRadius: 4, background: 'var(--pf-turn)' } }), t('benchEdited'))
              : null,
            benchNarrow || block.first.trim() === ''
              ? null
              : h('span', { style: { ...V.sectionMeta, border: '1px solid var(--dsw-alias-border-secondary)', borderRadius: 999, padding: '0 7px' } }, t('benchFirstTag')),
            overlaps.length > 0
              ? h('span', { 'data-prefill-overlap-narrow': block.key + ':' + overlaps[0], style: { ...V.sectionMeta, color: 'var(--pf-turn)', border: '1px solid color-mix(in srgb, var(--pf-turn) 50%, var(--dsw-alias-border-secondary))', borderRadius: 999, padding: '0 6px' } }, t('benchOverlapNarrow').replace('{name}', other ? other.name : overlaps[0]))
              : null,
            h(
              'span',
              { style: { marginLeft: 'auto', display: 'flex', gap: 2, alignItems: 'center' } },
              long
                ? h('button', { type: 'button', style: V.btnGhost, 'data-prefill-bench-fold': block.key, 'aria-expanded': folded ? 'false' : 'true', onClick: () => setBenchBlockOpen(block.key, folded), title: folded ? t('benchExpand') : t('benchCollapse') }, folded ? '▸' : '▾')
                : null,
              h('button', { type: 'button', style: V.btnGhost, disabled: index <= 0, title: t('benchMoveUp'), 'data-prefill-bench-up': block.key, onClick: () => moveBenchBlock(block.key, -1) }, '↑'),
              h('button', { type: 'button', style: V.btnGhost, disabled: index >= bench.length - 1, title: t('benchMoveDown'), 'data-prefill-bench-down': block.key, onClick: () => moveBenchBlock(block.key, 1) }, '↓'),
              h('button', { type: 'button', style: V.btnGhost, title: t('benchMenuTitle'), 'data-prefill-bench-menu': block.key, onClick: (event) => openBlockMenu(event, block) }, '⋯'),
              h('button', { type: 'button', style: V.btnGhost, title: t('benchMenuDrop'), 'data-prefill-bench-drop': block.key, onClick: () => dropBlockFromBench(block) }, '×'),
            ),
          ),
          folded
            ? h(
                'div',
                {
                  'data-prefill-bench-folded': block.key,
                  title: t('benchExpand'),
                  onClick: () => {
                    benchFocusNext.current = block.key
                    setBenchBlockOpen(block.key, true)
                  },
                  style: { margin: '4px 8px 8px', padding: '6px 10px', borderRadius: 8, border: '1px dashed var(--dsw-alias-border-secondary)', cursor: 'pointer', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
                },
                h('div', { style: { whiteSpace: 'pre-wrap', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' } }, String(block.first ?? '').trim() !== '' ? block.first : block.text),
                h('div', { style: { ...V.sectionMeta, marginTop: 2 } }, t('benchFoldedMeta').replace('{n}', String(String(block.first ?? '').length + String(block.text ?? '').length))),
              )
            : null,
          !folded && (block.first.trim() !== '' || block.builtin !== true)
            ? h('textarea', {
                style: { ...V.textarea, margin: '4px 8px 2px', minHeight: 38, background: 'color-mix(in srgb, var(--pf-turn) 7%, transparent)', ...grow },
                ...(long ? { ref: benchGrowRef(block.key + ':first'), onInput: (event) => autoGrow(event.target) } : {}),
                value: block.first,
                spellCheck: false,
                placeholder: t('everyTurnFirstPlaceholder'),
                'data-prefill-bench-first': block.key,
                onFocus: () => {
                  setBenchFocus(block.key)
                  // 正在编辑的块不自动收起（打字打到超过阈值也不会突然折叠）。
                  setBenchBlockOpen(block.key, true)
                },
                onBlur: () => setBenchFocus(''),
                onChange: (event) => patchBenchBlock(block.key, { first: event.target.value }, false),
              })
            : null,
          folded
            ? null
            : h('textarea', {
                style: { ...V.textarea, margin: '4px 8px 8px', minHeight: 46, ...grow },
                ...(long ? { ref: benchGrowRef(block.key), onInput: (event) => autoGrow(event.target) } : {}),
                value: block.text,
            spellCheck: false,
            placeholder: t('everyTurnPlaceholder'),
                'data-prefill-bench-text': block.key,
                onFocus: () => {
                  setBenchFocus(block.key)
                  setBenchBlockOpen(block.key, true)
                },
            onBlur: () => setBenchFocus(''),
            onChange: (event) => patchBenchBlock(block.key, { text: event.target.value }, false),
          }),
          block.builtin !== true
            ? h('label', { style: { ...V.row, gap: 6, fontSize: 11.5, padding: '0 10px 8px' } }, h('input', { type: 'checkbox', checked: block.priority === true, 'data-prefill-bench-priority': block.key, onChange: (event) => patchBenchBlock(block.key, { priority: event.target.checked }, true) }), h('span', null, t('benchPriority')))
            : null,
        )
      }
      const benchRows = () => {
        const rows = []
        const groups = new Map()
        for (const block of bench) {
          const key = block.tower ?? ''
          if (!groups.has(key)) groups.set(key, [])
          groups.get(key).push(block)
        }
        for (const [towerKey, list] of groups) {
          const tower = towerKey === '' ? null : benchTowers[towerKey]
          if (tower === null || tower === undefined) {
            rows.push(...list.map((block) => benchCard(block)))
            continue
          }
          const color = benchColor(towerKey === 'card' ? 'card' : 'mine')
          const collapsed = tower.collapsed === true
          rows.push(
            h(
              'div',
              {
                key: 'tf-' + towerKey,
                'data-prefill-bench-tower': towerKey,
                style: { border: '1.5px dashed color-mix(in srgb, ' + color + ' 55%, var(--dsw-alias-border-secondary))', borderRadius: 12, padding: '6px 8px 8px', background: 'color-mix(in srgb, ' + color + ' 4%, transparent)', display: 'flex', flexDirection: 'column', gap: 8 },
              },
              h(
                'div',
                { style: { ...V.row, gap: 6, alignItems: 'center', fontSize: 12, fontWeight: 700 } },
                h('span', { style: { cursor: 'pointer' }, 'data-prefill-tower-collapse': towerKey, onClick: () => toggleTowerCollapsed(towerKey) }, (collapsed ? '▸ ' : '▾ ') + String(tower.name ?? towerKey)),
                h('span', { style: { marginLeft: 'auto', fontWeight: 400 } }, h('button', { type: 'button', style: V.btnGhost, 'data-prefill-tower-remove': towerKey, onClick: () => removeTowerFromBench(towerKey) }, t('benchTowerRemove'))),
              ),
              ...(collapsed ? [] : list.map((block) => benchCard(block))),
            ),
          )
        }
        return rows
      }
      // ── v0.15：工作台的渲染件（按钮行 / 块卡片 / 塔框 / 重叠层 / 右键菜单）──────
      const benchColor = (kind) => (kind === 'card' ? 'var(--pf-card)' : kind === 'mine' ? 'var(--pf-user)' : 'var(--pf-builtin)')
      const towerKind = (tower) => (tower.card === true ? 'card' : tower.builtin === true ? 'builtin' : 'mine')
      const towerState = (tower) => {
        // 角色卡塔的块不来自 allBlocks（ref 形如 card:*），单独按卡编译结果算。
        if (tower.card === true) {
          const on = bench.filter((block) => block.ref.startsWith('card:'))
          if (on.length === 0) return 'off'
          return cardBenchBlocks.every((want) => on.some((block) => block.ref === want.id)) ? 'on' : 'half'
        }
        const mine = bench.filter((block) => block.tower === tower.id)
        const total = flattenTower(tower, allTowers, allBlocks).length
        return mine.length === 0 ? 'off' : mine.length >= total && total > 0 ? 'on' : 'half'
      }
      const towerEdited = (tower) => bench.some((block) => block.tower === tower.id && block.edited)
      const towerOverlaps = (tower) => {
        if (tower.card === true) return bench.some((block) => block.ref.startsWith('card:') && benchOverlapsOf(block).length > 0)
        const refs = new Set(bench.map((block) => block.ref))
        return flattenTower(tower, allTowers, allBlocks).some((block) =>
          ((allBlocks.find((item) => item.id === block.id) || {}).overlaps || []).some((id) => refs.has(id)),
        )
      }
      const stackIcon = (color) =>
        h(
          'span',
          { style: { display: 'inline-flex', flexDirection: 'column', gap: 1, marginRight: 2 } },
          h('i', { style: { display: 'block', width: 10, height: 3, borderRadius: 1, background: color } }),
          h('i', { style: { display: 'block', width: 10, height: 3, borderRadius: 1, background: color } }),
        )
      const towerButton = (tower) => {
        const state = towerState(tower)
        const kind = towerKind(tower)
        const color = benchColor(kind)
        const on = state === 'on'
        return h(
          'button',
          {
            key: 'tw-' + tower.id,
            type: 'button',
            title: tower.desc ?? tower.name,
            style: {
              ...(on ? V.btn : V.btnGhost),
              position: 'relative',
              borderColor: state === 'off' ? undefined : color,
              background: on ? 'color-mix(in srgb, ' + color + ' 14%, transparent)' : undefined,
              ...(state === 'half' ? { borderStyle: 'dashed' } : {}),
              ...(benchFocus === tower.id ? { outline: '2px solid var(--pf-turn)', outlineOffset: 1 } : {}),
            },
            'data-prefill-tower-btn': tower.id,
            'data-state': state,
            'aria-pressed': on ? 'true' : 'false',
            onFocus: () => setBenchFocus(tower.id),
            onBlur: () => setBenchFocus(''),
            onMouseEnter: () => setBenchFocus((current) => (current === tower.id ? current : tower.id)),
            onMouseLeave: () => setBenchFocus((current) => (current === '' ? current : '')),
            onClick: () => (state === 'off' ? (tower.card === true ? applyCardTower() : addTowerToBenchNow(tower)) : tower.card === true ? removeCardTower() : removeTowerFromBench(tower.id)),
            onContextMenu: (event) => openTowerMenu(event, tower),
          },
          stackIcon(color),
          tower.name,
          towerEdited(tower) ? h('span', { style: { position: 'absolute', top: -3, right: -3, width: 8, height: 8, borderRadius: 4, background: 'var(--pf-turn)' } }) : null,
          towerOverlaps(tower) ? h('span', { title: t('benchOverlapIcon'), style: { position: 'absolute', top: -7, right: -7, fontSize: 10, background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-secondary)', borderRadius: '50%', width: 15, height: 15, display: 'flex', alignItems: 'center', justifyContent: 'center' } }, '⇄') : null,
        )
      }
      const blockButton = (block) => {
        const on = bench.some((item) => item.ref === block.id)
        const edited = on && bench.some((item) => item.ref === block.id && item.edited)
        const kind = block.builtin === true ? 'builtin' : 'mine'
        const color = benchColor(kind)
        const overlapOn = benchOverlapsOf({ ref: block.id }).length > 0
        return h(
          'button',
          {
            key: 'bk-' + block.id,
            type: 'button',
            title: block.desc ?? block.name,
            style: {
              ...(on ? V.btn : V.btnGhost),
              position: 'relative',
              borderColor: on ? color : undefined,
              background: on ? 'color-mix(in srgb, ' + color + ' 12%, transparent)' : undefined,
              ...(benchFocus === 'btn:' + block.id ? { outline: '2px solid var(--pf-turn)', outlineOffset: 1 } : {}),
            },
            'data-prefill-block-btn': block.id,
            'aria-pressed': on ? 'true' : 'false',
            onFocus: () => setBenchFocus('btn:' + block.id),
            onBlur: () => setBenchFocus(''),
            onMouseEnter: () => setBenchFocus((current) => (current === 'btn:' + block.id ? current : 'btn:' + block.id)),
            onMouseLeave: () => setBenchFocus((current) => (current === '' ? current : '')),
            onClick: () => (on ? setBench(bench.filter((item) => item.ref !== block.id)) : addBlockToBench(block)),
            onContextMenu: (event) => openBlockMenu(event, block),
          },
          block.name,
          edited ? h('span', { style: { position: 'absolute', top: -3, right: -3, width: 8, height: 8, borderRadius: 4, background: 'var(--pf-turn)' } }) : null,
          overlapOn && !on ? h('span', { title: t('benchOverlapIcon'), style: { position: 'absolute', top: -7, right: -7, fontSize: 10, background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-secondary)', borderRadius: '50%', width: 15, height: 15, display: 'flex', alignItems: 'center', justifyContent: 'center' } }, '⇄') : null,
        )
      }
      const openBlockMenu = (event, target) => {
        event.preventDefault()
        const rect = event.currentTarget.getBoundingClientRect()
        setBenchMenu({
          kind: 'block',
          key: target.key ?? '',
          ref: target.ref ?? target.id ?? '',
          name: target.name ?? '',
          builtin: target.builtin === true,
          x: Math.round(rect.left),
          y: Math.round(rect.bottom + 4),
        })
      }
      const openTowerMenu = (event, tower) => {
        event.preventDefault()
        const rect = event.currentTarget.getBoundingClientRect()
        setBenchMenu({ kind: 'tower', ref: tower.id, name: tower.name, builtin: tower.builtin === true, x: Math.round(rect.left), y: Math.round(rect.bottom + 4) })
      }
      const closeBenchMenu = () => setBenchMenu(null)
      const saveWholeBenchAsTower = () => {
        const name = (window.prompt(t('benchTowerNameAsk'), t('benchTowerDefaultName')) || '').trim()
        if (name === '') return
        saveTower({ id: 'my:' + nextBenchKey(), name, items: bench.map(towerItemOf) })
      }
      const saveFrameAsTower = (towerKey) => {
        const name = (window.prompt(t('benchTowerNameAsk'), String(benchTowers[towerKey]?.name ?? '') + t('benchMySuffix')) || '').trim()
        if (name === '') return
        saveTower({ id: 'my:' + nextBenchKey(), name, items: bench.filter((block) => block.tower === towerKey).map(towerItemOf) })
      }
      const towerItemOf = (block) => ({
        ref: block.ref,
        text: block.text,
        first: block.first,
        snap: { name: block.name, first: block.first, text: block.text, checks: block.checks },
      })
      const renameMyBlock = (def) => {
        const name = (window.prompt(t('benchRenameAsk'), def.name) || '').trim()
        if (name === '' || name === def.name) return
        saveAsMyBlock(def, name)
      }
      const blockMenu = () => {
        const menu = benchMenu
        if (menu === null) return null
        const benchBlock = menu.kind === 'block' && menu.key !== '' ? bench.find((item) => item.key === menu.key) ?? null : null
        const def = allBlocks.find((item) => item.id === menu.ref) ?? null
        const source = benchBlock ?? def
        if (source === null) return null
        const isMine = menu.builtin !== true && def !== null && def.builtin !== true
        const row = (key, label, onClick, sub) =>
          h(
            'div',
            {
              key,
              style: { padding: '6px 10px', borderRadius: 6, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2 },
              onMouseEnter: (event) => { event.currentTarget.style.background = 'var(--dsw-alias-bg-layer-2)' },
              onMouseLeave: (event) => { event.currentTarget.style.background = 'transparent' },
              onClick: () => { closeBenchMenu(); onClick() },
            },
            h('span', null, label),
            sub !== undefined ? h('small', { style: V.sectionMeta }, sub) : null,
          )
        const rows = []
        if (menu.kind === 'block') {
          rows.push(row('save', t('benchMenuSaveTo').replace('{name}', menu.name), () => saveAsMyBlock(source), menu.builtin === true ? t('benchMenuSaveToBuiltin') : t('benchMenuSaveToMine')))
          if (benchBlock !== null && benchBlock.tower !== null && benchBlock.tower !== undefined) {
            rows.push(row('toweronly', t('benchMenuTowerOnly'), () => saveTower({ id: benchBlock.tower, name: String(benchTowers[benchBlock.tower]?.name ?? benchBlock.tower), items: bench.filter((item) => item.tower === benchBlock.tower).map(towerItemOf) }), t('benchMenuTowerOnlySub')))
          }
          rows.push(row('newblock', t('benchMenuSaveNewBlock'), () => {
            const name = (window.prompt(t('benchNewBlockAsk'), menu.name + t('benchMySuffix')) || '').trim()
            if (name !== '') saveAsMyBlock({ ...source, ref: 'my:' + nextBenchKey(), builtin: false, id: '' }, name)
          }))
          if (benchBlock !== null && benchBlock.tower !== null && benchBlock.tower !== undefined) rows.push(row('saveframe', t('benchMenuSaveFrame'), () => saveFrameAsTower(benchBlock.tower)))
          if (bench.length > 0) rows.push(row('savebench', t('benchMenuSaveBench'), () => saveWholeBenchAsTower()))
          rows.push(h('div', { key: 'sep', style: { height: 1, background: 'var(--dsw-alias-border-secondary)', margin: '4px 2px' } }))
          if (benchBlock !== null && benchBlock.edited) rows.push(row('revert', t('benchMenuRevert'), () => patchBenchBlock(benchBlock.key, revertPatch(benchBlock))))
          if (benchBlock !== null) rows.push(row('drop', t('benchMenuDrop'), () => removeBlockFromBench(benchBlock.key)))
          if (isMine && def !== null) rows.push(row('rename', t('benchMenuRename'), () => renameMyBlock(def)))
          if (isMine && def !== null) rows.push(row('delblock', t('benchMenuDeleteBlock'), () => deleteMyBlock(def.id)))
          if (menu.builtin === true) rows.push(row('hide', t('benchMenuHide'), () => hideBuiltin(menu.ref)))
        } else {
          if (isMine && def !== null) rows.push(row('renametower', t('benchMenuRename'), () => { const name = (window.prompt(t('benchRenameAsk'), menu.name) || '').trim(); if (name !== '') saveTower({ ...def, name }) }))
          if (isMine) rows.push(row('deltower', t('benchMenuDeleteTower'), () => deleteTower(menu.ref)))
          if (menu.builtin === true) rows.push(row('hidetower', t('benchMenuHide'), () => hideBuiltin(menu.ref)))
          if (menu.ref !== 'card') rows.push(row('removetower', t('benchMenuRemoveTower'), () => removeTowerFromBench(menu.ref)))
        }
        return h(
          'div',
          {
            key: 'menu',
            'data-prefill-block-menu': '',
            style: {
              position: 'fixed',
              left: benchNarrow ? 10 : menu.x,
              top: menu.y,
              right: benchNarrow ? 10 : undefined,
              zIndex: 30,
              width: benchNarrow ? undefined : 280,
              background: 'var(--dsw-alias-bg-layer-1)',
              border: '1px solid var(--dsw-alias-border-secondary)',
              borderRadius: 10,
              boxShadow: '0 12px 32px rgba(0,0,0,.18)',
              padding: 5,
              fontSize: 12.5,
            },
          },
          ...rows,
          h('div', { key: 'close', style: { ...V.sectionMeta, padding: '4px 10px', cursor: 'pointer' }, onClick: closeBenchMenu }, t('benchMenuClose')),
        )
      }
      /** 放弃修改：把这块恢复成它定义时的内容。 */
      const revertPatch = (benchBlock) => {
        const def = allBlocks.find((block) => block.id === benchBlock.ref)
        return def === undefined ? { edited: false } : { first: def.first, text: def.text, checks: [...def.checks], edited: false }
      }
      /** 重叠层：左侧留白里画虚线连线 + 「重叠」标；窄屏不画（用块头标签）。 */
      const overlapLayer = () => {
        const pairs = benchOverlapPairs()
        if (benchNarrow || pairs.length === 0) return null
        const rows = bench.map((block, index) => ({ key: block.key, index }))
        const at = (ref) => rows.find((row) => row.index === bench.findIndex((block) => block.ref === ref))
        return h(
          'svg',
          { key: 'ov', 'data-prefill-overlap': pairs.map((pair) => pair.a + ':' + pair.b).join(','), style: { position: 'absolute', left: 0, top: 0, width: 34, height: '100%', overflow: 'visible', pointerEvents: 'none' } },
          ...pairs.map((pair) => {
            const a = bench.findIndex((block) => block.ref === pair.a)
            const b = bench.findIndex((block) => block.ref === pair.b)
            const y1 = a * 72 + 36
            const y2 = b * 72 + 36
            return h('path', { key: pair.a + pair.b, d: 'M30 ' + y1 + ' C 8 ' + y1 + ', 8 ' + y2 + ', 30 ' + y2, fill: 'none', stroke: 'var(--pf-turn)', strokeWidth: 2, strokeDasharray: '4 3' })
          }),
          pairs.length > 0 ? h('text', { x: 0, y: 12, fill: 'var(--pf-turn)', fontSize: 10 }, t('benchOverlapTag')) : null,
        )
      }
      // 「开着没」看左栏开关（旧版 entry.enabled 也算关）；有没有内容是另一回事。
      const everyTurnActive = isOn('everyTurn') && (everyTurn.text.trim() !== '' || everyTurn.firstText.trim() !== '')
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
          tags: sourceTag(tagOf('everyTurn')),
          title: t('everyTurnTitle'),
          meta: everyTurnActive
            ? autoStatus !== null
              ? t('everyTurnStateMeta').replace('{state}', autoStateText)
              : `≈${estimateTokens(everyTurn.text)} tok/${t('turnsUnit')}${everyTurn.mode === 'until' && everyTurn.untilTurn > 0 ? ` · ≤${everyTurn.untilTurn}` : ''}`
            : t('everyTurnOffMeta'),
          off: !isOn('everyTurn') || everyTurnFromCardOff,
          offTitle: !isOn('everyTurn') ? t('offTitle') : t('offByCardTitle'),
          offBody: !isOn('everyTurn') ? t('everyTurnOffBody') : t('offByCardBody'),
        },
        h('div', { style: V.hint }, t('everyTurnHint')),
        // v0.15：按钮行（塔在前、积木在后）+ 成本/预览 + 工作台 + 重叠层 + 右键菜单
        h(
          'div',
          {
            style: {
              ...V.row,
              flexWrap: benchNarrow ? 'nowrap' : 'wrap',
              gap: 6,
              alignItems: 'center',
              overflowX: benchNarrow ? 'auto' : 'visible',
              paddingBottom: benchNarrow ? 4 : 0,
            },
            'data-prefill-bench-bar': '',
          },
          visibleTowers.length > 0 || cardTower !== null ? h('span', { style: V.sectionMeta }, t('benchTowerGroup')) : null,
          ...(cardTower !== null ? [towerButton(cardTower)] : []),
          ...visibleTowers.map((tower) => towerButton(tower)),
          (visibleTowers.length > 0 || cardTower !== null) && visibleBlocks.length > 0
            ? h('span', { key: 'sep', style: { width: 1, height: 20, background: 'var(--dsw-alias-border-secondary)', margin: '0 4px' } })
            : null,
          visibleBlocks.length > 0 ? h('span', { style: V.sectionMeta }, t('benchBlockGroup')) : null,
          ...visibleBlocks.map((block) => blockButton(block)),
          h(
            'button',
            {
              type: 'button',
              style: { ...V.btnGhost, borderStyle: 'dashed' },
              'data-prefill-bench-add': '',
              onClick: () => addBlockToBench(makeBlock({ id: 'my:' + nextBenchKey(), name: t('benchCustom'), icon: 'pencil', text: '', first: '', checks: [] })),
            },
            '＋ ' + t('benchCustom'),
          ),
          hiddenBuiltins.length > 0
            ? h('button', { type: 'button', style: V.btnGhost, 'data-prefill-bench-hidden-toggle': '', onClick: () => setHiddenOpen((value) => !value) }, t('benchHiddenToggle').replace('{n}', String(hiddenBuiltins.length)))
            : null,
        ),
        cardTowerOnBench && appliedRef !== null
          ? h(
              'div',
              { style: { ...V.row, gap: 6, flexWrap: 'wrap', marginTop: 6 }, 'data-prefill-everyturn-card': '' },
              h('span', { style: V.sectionMeta }, t('everyTurnCardChips')),
              h('button', { type: 'button', style: appliedCompiled && everyTurn.text === appliedCompiled.everyTurn?.text ? V.btn : V.btnGhost, title: t('cardReinforceTip'), 'data-prefill-card-reinforce': '', onClick: () => applyCardTower() }, withIcon('user', t('cardReinforce'), 12)),
              h('button', { type: 'button', style: everyTurn.checks.includes('zh') ? V.btn : V.btnGhost, 'aria-pressed': everyTurn.checks.includes('zh') ? 'true' : 'false', 'data-prefill-card-zh': '', onClick: () => toggleCardBlock('zh') }, t('cardThinkZh')),
              h('button', { type: 'button', style: everyTurn.checks.includes('firstPerson') ? V.btn : V.btnGhost, 'aria-pressed': everyTurn.checks.includes('firstPerson') ? 'true' : 'false', 'data-prefill-card-firstperson': '', onClick: () => toggleCardBlock('firstPerson') }, t('cardFirstPerson')),
            )
          : null,
        hiddenOpen && hiddenBuiltins.length > 0
          ? h(
              'div',
              { style: { ...V.row, gap: 6, flexWrap: 'wrap', fontSize: 12 }, 'data-prefill-bench-hidden': '' },
              h('span', { style: V.sectionMeta }, t('benchHiddenList')),
              ...hiddenBuiltins.map((id) =>
                h('button', { key: id, type: 'button', style: V.btnGhost, onClick: () => unhideBuiltin(id) }, (allBlocks.find((block) => block.id === id) ?? allTowers.find((tower) => tower.id === id) ?? { name: id }).name + ' ×'),
              ),
            )
          : null,
        h(
          'div',
          { style: { ...V.row, gap: 8, alignItems: 'center', marginTop: 10, padding: '6px 10px', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-2)', fontSize: 12 }, 'data-prefill-bench-cost-row': '' },
          h('span', { 'data-prefill-bench-cost': '' }, t('benchCost').replace('{first}', String(benchSummaryNow.firstTok)).replace('{rest}', String(benchSummaryNow.restTok))),
          benchSummaryNow.checks.length > 0
            ? h('span', { style: V.sectionMeta }, t('benchChecks').replace('{list}', benchSummaryNow.checks.map((id) => t('check_' + id) || id).join('、')))
            : null,
          h(
            'button',
            {
              type: 'button',
              style: { ...V.btnGhost, marginLeft: 'auto' },
              'data-prefill-bench-preview-btn': '',
              onClick: () => setBenchPreview((value) => !value),
            },
            (benchPreview ? '▴ ' : '▾ ') + (benchPreview ? t('benchPreviewHide') : t('benchPreview')),
          ),
        ),
        benchPreview
          ? h(
              'div',
              { style: { display: 'grid', gridTemplateColumns: benchNarrow ? '1fr' : '1fr 1fr', gap: 10, marginTop: 10 }, 'data-prefill-everyturn-preview': '' },
              ...[1, 2].map((round) =>
                h(
                  'div',
                  { key: round, style: { border: '1px solid var(--dsw-alias-border-secondary)', borderRadius: 10, overflow: 'hidden' } },
                  h(
                    'div',
                    { style: { ...V.row, gap: 8, padding: '6px 10px', background: 'var(--dsw-alias-bg-layer-2)', fontSize: 12 } },
                    h('span', { style: { fontWeight: 600 } }, round === 1 ? t('benchPreviewFirst') : t('benchPreviewRest')),
                    h('span', { style: { ...V.sectionMeta, marginLeft: 'auto' } }, '≈' + String(round === 1 ? benchSummaryNow.firstTok : benchSummaryNow.restTok) + ' tok'),
                  ),
                  h('div', { style: { margin: '8px 10px', paddingLeft: 8, borderLeft: '3px solid var(--dsw-alias-border-secondary)', color: 'var(--dsw-alias-label-tertiary)', fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 11.5, whiteSpace: 'pre-wrap' } }, '<background> ' + t('benchPreviewShell')),
                  ...previewSegments(round).map((seg) =>
                    h(
                      'div',
                      {
                        key: seg.key,
                        'data-prefill-preview-seg': seg.key,
                        style: {
                          margin: '8px 10px',
                          padding: '2px 8px',
                          borderLeft: '3px solid ' + benchColor(seg.kind),
                          fontFamily: 'ui-monospace,Menlo,monospace',
                          fontSize: 11.5,
                          whiteSpace: 'pre-wrap',
                          ...(seg.gone ? { opacity: 0.35, textDecoration: 'line-through' } : {}),
                        },
                      },
                      seg.text,
                    ),
                  ),
                  h('div', { style: { margin: '8px 10px', paddingLeft: 8, borderLeft: '3px solid var(--dsw-alias-border-secondary)', color: 'var(--dsw-alias-label-tertiary)', fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 11.5 } }, '</background>'),
                ),
              ),
            )
          : null,
        h(
          'div',
          { ref: benchListRef, style: { position: 'relative', marginTop: 10, paddingLeft: benchNarrow ? 0 : 34, display: 'flex', flexDirection: 'column', gap: 8 }, 'data-prefill-bench': '' },
          overlapLayer(),
          benchLongKeys.length > 0
            ? h(
                'button',
                {
                  type: 'button',
                  style: { ...V.btnGhost, alignSelf: 'flex-end' },
                  'data-prefill-bench-fold-all': benchAllOpen ? 'collapse' : 'expand',
                  onClick: () => setBenchOpen(benchAllOpen ? new Set() : new Set([...benchOpen, ...benchLongKeys])),
                },
                benchAllOpen ? t('benchCollapseAll') : t('benchExpandAll'),
              )
            : null,
          ...benchRows(),
          bench.length === 0 ? h('div', { style: V.sectionMeta }, t('benchEmpty')) : null,
          h(
            'div',
            { style: { border: '1px dashed var(--dsw-alias-border-secondary)', borderRadius: 10, padding: '7px 10px', color: 'var(--dsw-alias-label-tertiary)', fontSize: 12.5, textAlign: 'center', cursor: 'pointer' }, 'data-prefill-bench-add-row': '', onClick: () => addBlockToBench(makeBlock({ id: 'my:' + nextBenchKey(), name: t('benchCustom'), icon: 'pencil', text: '', first: '', checks: [] })) },
            '＋ ' + t('benchCustom'),
          ),
          benchMenu !== null ? blockMenu() : null,
        ),
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
        { id: 'inject', title: t('injectTitle'), meta: t('advanced'), tags: sourceTag(tagOf('tools'), t('toolsTag')), off: !isOn('inject'), offTitle: t('offTitle'), offBody: t('injectOffBody') },
        h('div', { style: V.hint }, t('injectHint')),
        h(InjectionSection, { t, sessionId }),
      )

      const usageSection = h(
        Section,
        {
          id: 'usage',
          title: t('usageTitle'),
          meta: turns > 0 ? `${turns} ${t('turnsUnit')}` : t('usageNoTurns'),
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
      const activeKind = activePreset.startsWith('builtin:') ? t('groupBuiltin') : activePreset.startsWith('pack:') ? t('kindMine') : activePreset.startsWith('card:') ? t('cardsTitle') : ''

      const guideSection = open.guide
        ? h(
            'div',
            { style: V.callout('brand') },
            h('div', { style: { fontWeight: 700, marginBottom: 4, color: 'var(--dsw-alias-label-primary)' } }, t('guideTitle')),
            h('ol', { style: V.steps }, ...[1, 2, 3, 4, 5].map((n) => h('li', { key: n }, t(`guide${n}`)))),
          )
        : null

      // ── 世界书 / 故事记忆（从角色卡拆出来的两项）──
      // 世界书可以本会话修改（0.15+）：改动写 state.lore[会话]，带 custom 标记；「保存为预设」时整份存进预设，角色卡本身不动。
      const loreEntry = loreDraft ?? state?.lore?.[sessionId] ?? null
      const loreEntries = Array.isArray(loreEntry?.entries) ? loreEntry.entries : []
      const loreCustom = loreEntry?.custom === true
      const loreKeyOf = (entry, index) => String(entry?.id ?? 'i' + index)
      const splitLoreKeys = (text) => String(text ?? '').split(/[\/,，、\n]+/).map((key) => key.trim()).filter((key) => key !== '')
      const editLore = (nextEntries) => {
        if (loreEntry === null) return
        const value = { ...loreEntry, entries: nextEntries, custom: true, source: 'session' }
        setLoreDraft(value)
        clearTimeout(loreTimer.current)
        loreTimer.current = setTimeout(() => {
          void postJson(STATE_ROUTE, undefined)
            .then((fresh) => postJson(STATE_ROUTE, { lore: { ...(fresh?.state?.lore ?? {}), [sessionId]: value } }))
            .then((data) => {
              setEnvelope(data)
              notifyStateChanged()
              flash(t('loreSaved'))
            })
            .catch(() => setStatus('error'))
        }, 600)
      }
      const patchLoreEntry = (key, patch) => editLore(loreEntries.map((entry, index) => (loreKeyOf(entry, index) === key ? { ...entry, ...patch } : entry)))
      const deleteLoreEntry = (key) => {
        editLore(loreEntries.filter((entry, index) => loreKeyOf(entry, index) !== key))
        if (loreEditing === key) setLoreEditing('')
      }
      const addLoreEntry = () => {
        const id = 'u' + Date.now().toString(36)
        editLore([...loreEntries, { id, title: t('loreNewTitle'), keys: [], secondary: [], logic: 0, caseSensitive: false, wholeWords: null, probability: 100, order: 0, content: '' }])
        setLoreEditing(id)
        setLoreOpen((current) => new Set([...current, id]))
        setLoreShown((current) => Math.max(current, loreEntries.length + 1))
      }
      /** 还原成角色卡里的：按当前卡引用重新编译，覆盖本会话的世界书。 */
      const revertLore = async () => {
        const parsed = cardRefOf(appliedRef)
        if (parsed === null) return
        const got = await compileCardLayer(parsed.ref, parsed.legacy)
        if (got === null) return
        clearTimeout(loreTimer.current)
        const fresh = await postJson(STATE_ROUTE, undefined)
        const map = { ...(fresh?.state?.lore ?? {}) }
        if (got.layer.lore) map[sessionId] = got.layer.lore
        else delete map[sessionId]
        setLoreDraft(null)
        setLoreEditing('')
        setEnvelope(await postJson(STATE_ROUTE, { lore: map }))
        notifyStateChanged()
      }
      const toggleLoreOpen = (key) =>
        setLoreOpen((current) => {
          const next = new Set(current)
          if (next.has(key)) next.delete(key)
          else next.add(key)
          return next
        })
      const loreCard = (entry, index) => {
        const key = loreKeyOf(entry, index)
        const open = loreOpen.has(key)
        const editing = loreEditing === key
        const keys = Array.isArray(entry.keys) ? entry.keys : []
        return h(
          'div',
          { key, 'data-prefill-lore-entry': key, style: { maxWidth: '90ch', borderRadius: 10, padding: '6px 10px', borderLeft: '3px solid var(--pf-lore)', background: tint('var(--pf-lore)', 9), display: 'flex', flexDirection: 'column', gap: 4 } },
          h(
            'div',
            { style: { display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' } },
            h('b', { style: { fontSize: 12.5 } }, entry.title || `#${index + 1}`),
            // 关键词全部显示（以前只显示前 6 个）。
            h('span', { style: V.sectionMeta, 'data-prefill-lore-keys': key }, keys.length > 0 ? `${t('loreKeys')}：${keys.join(' / ')}` : t('loreNoKeys')),
            h(
              'span',
              { style: { marginLeft: 'auto', display: 'flex', gap: 2 } },
              editing
                ? null
                : h('button', { type: 'button', style: V.btnGhost, 'data-prefill-lore-toggle': key, onClick: () => toggleLoreOpen(key) }, open ? t('benchCollapse') : t('benchExpand')),
              h('button', { type: 'button', style: V.btnGhost, 'data-prefill-lore-edit': key, onClick: () => { setLoreEditing(editing ? '' : key); if (!editing) setLoreOpen((current) => new Set([...current, key])) } }, editing ? t('loreDone') : t('loreEdit')),
              h('button', { type: 'button', style: V.btnGhost, title: t('loreDelete'), 'data-prefill-lore-delete': key, onClick: () => deleteLoreEntry(key) }, '×'),
            ),
          ),
          editing
            ? h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                h('label', { style: V.sectionMeta }, t('loreTitleLabel')),
                h('input', { style: { ...V.textarea, minHeight: 0, maxHeight: 'none' }, value: String(entry.title ?? ''), 'data-prefill-lore-title': key, onChange: (event) => patchLoreEntry(key, { title: event.target.value }) }),
                h('label', { style: V.sectionMeta }, t('loreKeysLabel')),
                h('input', { style: { ...V.textarea, minHeight: 0, maxHeight: 'none' }, defaultValue: keys.join(' / '), 'data-prefill-lore-keys-input': key, onChange: (event) => patchLoreEntry(key, { keys: splitLoreKeys(event.target.value) }) }),
                h('label', { style: V.sectionMeta }, t('loreContentLabel')),
                h('textarea', { style: { ...V.textarea, maxHeight: 'none', overflow: 'hidden' }, value: String(entry.content ?? ''), spellCheck: false, ref: autoGrow, 'data-prefill-lore-content': key, onInput: (event) => autoGrow(event.target), onChange: (event) => patchLoreEntry(key, { content: event.target.value }) }),
              )
            : h(
                'div',
                {
                  'data-prefill-lore-body': key,
                  onClick: open ? undefined : () => toggleLoreOpen(key),
                  style: open
                    ? { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'pre-wrap' }
                    : { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', cursor: 'pointer' },
                },
                entry.content,
              ),
        )
      }
      const loreSection = h(
        Section,
        {
          id: 'lore',
          tags: appliedRef && loreEntries.length > 0 ? sourceTag(loreCustom ? (loreEntry?.source === 'preset' ? 'preset' : 'session') : 'card') : null,
          title: t('loreTitle'),
          meta: loreEntries.length > 0 ? t('loreMeta').replace('{n}', String(loreEntries.length)) : '',
          off: !isOn('lore') || (!isOn('card') && loreEntries.length > 0),
          offTitle: !isOn('lore') ? t('offTitle') : t('offByCardTitle'),
          offBody: !isOn('lore') ? t('loreOffBody') : t('loreByCardBody'),
        },
        h('div', { style: V.hint }, loreEntries.length === 0 && !loreCustom ? t('loreEmpty') : t('loreHint').replace('{depth}', String(loreEntry?.scanDepth ?? '—'))),
        loreEntry !== null ? h('div', { style: V.hint, 'data-prefill-lore-edit-hint': '' }, t('loreEditHint')) : null,
        loreCustom && appliedRef
          ? h(
              'div',
              { style: { ...V.row, gap: 8, alignItems: 'center', fontSize: 12 }, 'data-prefill-lore-custom': '' },
              h('span', null, t('loreCustomBar')),
              h('button', { type: 'button', style: V.btnGhost, 'data-prefill-lore-revert': '', onClick: () => void revertLore().catch(() => setStatus('error')) }, t('loreRevert')),
            )
          : null,
        // 全部条目都能看到：一次先显示 40 条，其余点「再显示」（收起的条目只渲染两行，压力不大）。
        ...loreEntries.slice(0, loreShown).map((entry, index) => loreCard(entry, index)),
        loreEntries.length > loreShown
          ? h('button', { type: 'button', style: V.btnGhost, 'data-prefill-lore-more': '', onClick: () => setLoreShown((current) => current + 40) }, t('loreMore').replace('{n}', String(Math.min(40, loreEntries.length - loreShown))))
          : null,
        loreEntry !== null
          ? h('button', { type: 'button', style: { ...V.btnGhost, alignSelf: 'flex-start' }, 'data-prefill-lore-add': '', onClick: addLoreEntry }, '＋ ' + t('loreAdd'))
          : null,
      )
      const memorySection = h(
        Section,
        {
          id: 'memory',
          tags: appliedRef && memoryOn ? sourceTag('card') : null,
          title: t('memoryTitle'),
          meta: memoryOn ? t('memoryEveryMeta').replace('{n}', String(memoryConfig.every ?? 8)) : '',
          off: !isOn('memory') || (!isOn('card') && memoryOn),
          offTitle: !isOn('memory') ? t('offTitle') : t('offByCardTitle'),
          offBody: !isOn('memory') ? t('memoryOffBody') : t('loreByCardBody'),
        },
        h('div', { style: V.hint }, memoryOn ? t('memoryHint') : t('memoryEmpty')),
        memoryBlock,
        // 预设带上故事记忆摘要（原来在「另存为 → 从当前会话取」里）：不能晚于开场对话截取的末轮。
        h(
          'div',
          { style: { ...V.row, gap: 8 }, 'data-prefill-seed': '' },
          h('button', { type: 'button', style: V.btn, title: t('seedTip'), 'data-prefill-seed-fetch': '', onClick: fetchSeed }, t('seedFetch')),
          seedDraft !== null
            ? h(
                'span',
                { style: { ...V.sectionMeta, fontSize: 12 }, 'data-prefill-seed-status': 'ready' },
                t('seedReady').replace('{n}', String(seedDraft.throughTurn)).replace('{tok}', num(estimateTokens(seedDraft.text))),
              )
            : seedNote !== ''
              ? h('span', { style: { ...V.sectionMeta, fontSize: 12, color: 'var(--dsw-alias-state-warn-primary)' }, 'data-prefill-seed-status': 'note' }, seedNote)
              : null,
          seedDraft !== null ? h('button', { type: 'button', style: V.btnGhost, onClick: () => setSeedDraft(null) }, t('seedDrop')) : null,
        ),
      )

      // ── 工作区说明（state.workspaceInstructions[会话]；缺 = 原样）──
      const storedWs = state?.workspaceInstructions?.[sessionId]
      const wsStored = storedWs?.mode === 'off' ? { mode: 'off', text: '' } : storedWs?.mode === 'rewrite' ? { mode: 'rewrite', text: typeof storedWs.text === 'string' ? storedWs.text : '' } : { mode: 'pass', text: '' }
      const ws = wsDraft ?? { ...wsStored, text: wsStored.text !== '' ? wsStored.text : typeof storedWs?.text === 'string' ? storedWs.text : '' }
      const wsOriginal = envelope?.injections?.sessions?.[sessionId]?.texts?.messages?.['agent-instructions']
      const wsSent = typeof wsOriginal === 'string' && wsOriginal !== ''
      const wsMid = turns > 0 || wsSent
      const writeWs = async (value) => {
        const fresh = await postJson(STATE_ROUTE, undefined)
        const map = { ...(fresh?.state?.workspaceInstructions ?? {}) }
        // 原样不存（缺 = 原样）；改写时留着正文，切回原样 / 关闭也把正文留在草稿里不丢。
        if (value.mode === 'off') map[sessionId] = { mode: 'off', ...(String(value.text ?? '') !== '' ? { text: String(value.text) } : {}) }
        else if (value.mode === 'rewrite') map[sessionId] = { mode: 'rewrite', text: String(value.text ?? '') }
        else if (String(value.text ?? '') !== '') map[sessionId] = { mode: 'pass', text: String(value.text) }
        else delete map[sessionId]
        const data = await postJson(STATE_ROUTE, { workspaceInstructions: map })
        setEnvelope(data)
        notifyStateChanged()
        return data
      }
      const editWs = (patch, immediate) => {
        const value = { ...ws, ...patch }
        if (wsMid) setWsMidChanged(true)
        setWsDraft(value)
        clearTimeout(wsTimer.current)
        const run = () =>
          void writeWs(value)
            .then(() => {
              setWsDraft(null)
              flash(t('wsSaved'))
            })
            .catch(() => setStatus('error'))
        if (immediate) run()
        else wsTimer.current = setTimeout(run, 700)
      }
      const wsActive = ws.mode !== 'pass'
      const workspaceSection = h(
        Section,
        {
          id: 'workspace',
          tags: sourceTag(tagOf('workspace')),
          title: t('wsTitle'),
          meta: t('wsMeta'),
          off: !isOn('workspace'),
          offTitle: t('offTitle'),
          offBody: t('wsOffBody'),
        },
        h('div', { style: V.hint }, t('wsHint')),
        h(
          'div',
          { style: V.row },
          h(
            'div',
            { style: V.seg, role: 'radiogroup' },
            ...[
              ['pass', t('wsModePass')],
              ['off', t('wsModeOff')],
              ['rewrite', t('wsModeRewrite')],
            ].map(([key, label]) =>
              h(
                'button',
                {
                  key,
                  type: 'button',
                  role: 'radio',
                  'aria-checked': ws.mode === key ? 'true' : 'false',
                  style: V.segBtn(ws.mode === key),
                  'data-prefill-ws-mode': key,
                  onClick: () => editWs({ mode: key }, true),
                },
                label,
              ),
            ),
          ),
        ),
        h('div', { style: V.hint }, ws.mode === 'off' ? t('wsOffHint') : ws.mode === 'rewrite' ? t('wsRewriteHint') : t('wsPassHint')),
        // 会话已经发过说明 ⇒ 中途切换的提示；还没发 ⇒ 建议在新会话首条消息前设好。
        wsMid && wsMidChanged
          ? h('div', { style: V.callout('warn'), 'data-prefill-ws-note': 'mid-session' }, t('wsMidSession'))
          : !wsMid
            ? h('div', { style: V.callout(), 'data-prefill-ws-note': 'new-session' }, t('wsNewSessionNote'))
            : null,
        ws.mode === 'rewrite'
          ? h('textarea', {
              style: { ...V.textarea, minHeight: 110, maxWidth: '90ch', opacity: isOn('workspace') ? 1 : 0.7 },
              value: ws.text,
              spellCheck: false,
              placeholder: t('wsRewritePlaceholder'),
              'data-prefill-ws-text': '1',
              onChange: (event) => editWs({ text: event.target.value }, false),
            })
          : null,
        ws.mode === 'rewrite' && ws.text.trim() === '' ? h('div', { style: V.callout('warn') }, t('wsRewriteEmpty')) : null,
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, maxWidth: '90ch' } },
          h(
            'div',
            { style: { ...V.sectionMeta, fontSize: 12, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'baseline' } },
            h('b', { style: { color: 'var(--dsw-alias-label-secondary)' } }, t('wsOriginal')),
            wsSent ? `≈${num(estimateTokens(wsOriginal))} tok` : null,
            wsSent && isOn('workspace') && ws.mode !== 'pass' ? `· ${ws.mode === 'off' || ws.text.trim() === '' ? t('wsOriginalDropped') : t('wsOriginalReplaced')}` : null,
          ),
          wsSent
            ? h(
                'pre',
                {
                  'data-prefill-ws-original': '1',
                  style: { margin: 0, maxHeight: 220, overflow: 'auto', padding: '8px 10px', borderRadius: 8, border: '1px dashed var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-secondary)', fontSize: 11.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)', opacity: ws.mode !== 'pass' && isOn('workspace') ? 0.7 : 1, textDecoration: 'none' },
                },
                wsOriginal,
              )
            : h('div', { style: { ...V.hint, fontSize: 12 }, 'data-prefill-ws-original': 'none' }, t('wsOriginalNone')),
        ),
      )

      // ── 左栏：每项一个色条 + 粗标题 + 开关 + 状态行 ──
      const filledCount = countFilled(items)
      const overrideCount = (() => {
        const entry = state?.overrides?.[sessionId] ?? {}
        let n = Object.keys(entry.messages ?? {}).length + Object.keys(entry.contexts ?? {}).length
        for (const key of Object.keys(entry.sections ?? {})) if (key !== PERSONA_SECTION) n += 1
        return n
      })()
      const everyTurnModeLabel = everyTurn.mode === 'auto' ? t('everyTurnModeAuto') : everyTurn.mode === 'until' ? t('navModeUntil').replace('{n}', String(everyTurn.untilTurn)) : t('navModeAlways')
      const B = (text) => h('b', null, text)
      const navStatus = {
        card: appliedCardName !== '' ? [B(appliedCardName), appliedCardDesc ? ` · ${appliedCardDesc}` : ''] : [t('navNone')],
        lore: loreEntries.length > 0 ? [B(String(loreEntries.length)), t('navLore')] : [t('navWithCard')],
        memory: memoryOn
          ? [typeof memoryView?.memory?.text === 'string' && memoryView.memory.text !== '' ? t('navMemoryThrough').replace('{n}', String(memoryView.memory.throughTurn ?? 0)) : t('navMemoryEvery').replace('{n}', String(memoryConfig.every ?? 8))]
          : [t('navWithCard')],
        system:
          systemMode === 'off' && systemText.trim() === ''
            ? [t('navSystemEmpty')]
            : [B(systemMode === 'replace' ? t('systemReplaceMeta') : systemMode === 'takeover' ? t('systemTakeoverMeta') : t('systemAppendMeta')), ' · ≈', B(num(systemTok)), ' tok'],
        everyTurn: everyTurnActive
          ? [B(everyTurnModeLabel), autoStatus !== null ? ` · ${autoStateText}` : ` · ≈${num(estimateTokens(everyTurn.text))} tok/${t('turnsUnit')}`]
          : [t('everyTurnOffMeta')],
        items: [B(String(filledCount)), t('countSuffix'), ' · ≈', B(num(itemsTok)), ' tok · ', injectMode ? (injectCount > 0 ? t('modeInject') : t('navNotInjected')) : t('modeHistory')],
        workspace: [B(ws.mode === 'off' ? t('navWsOff') : ws.mode === 'rewrite' ? t('navWsRewrite') : t('navWsPass')), ws.mode === 'rewrite' && ws.text.trim() !== '' ? ` · ≈${num(estimateTokens(ws.text))} tok` : '', ws.mode === 'pass' ? ' · AGENTS.md' : ''],
        inject: [t('advanced'), overrideCount > 0 ? [' · ', t('navChanged').replace('{n}', '')] : '', overrideCount > 0 ? B(String(overrideCount)) : '', overrideCount > 0 ? t('navChangedUnit') : ''],
      }
      const offBy = { system: systemFromCardOff, everyTurn: everyTurnFromCardOff, lore: !isOn('card') && loreEntries.length > 0, memory: !isOn('card') && memoryOn }
      const hasContent = {
        card: appliedCardName !== '',
        lore: loreEntries.length > 0,
        memory: memoryOn,
        system: systemText.trim() !== '' || gateMode === 'pure',
        everyTurn: everyTurnActive,
        items: filledCount > 0,
        workspace: wsActive,
        inject: overrideCount > 0,
      }
      const featureTitle = { card: t('cardsTitle'), lore: t('loreTitle'), memory: t('memoryTitle'), system: t('systemTitle'), everyTurn: t('everyTurnTitle'), items: t('itemsNavTitle'), workspace: t('wsTitle'), inject: t('injectTitle') }
      const sections = { cards: cardsSection, lore: loreSection, memory: memorySection, system: systemSection, workspace: workspaceSection, 'every-turn': everyTurnSection, items: itemsSection, inject: injectSection, usage: usageSection }

      // 芯片的摘要：预设名 + 每项一个点（关 = 灰；开但没内容 = 空心）。
      const summaryDots = FEATURE_NAV.map(([key, , color]) => ({ key, color, on: isOn(key) && offBy[key] !== true, filled: hasContent[key] === true }))
      summaryRef.current = {
        name: activeName,
        dots: summaryDots,
        tip: FEATURE_NAV.map(([key]) => `${featureTitle[key]}：${!isOn(key) ? t('chipOff') : offBy[key] ? t('chipOffByCard') : hasContent[key] ? t('chipOn') : t('chipEmpty')}`).join('\n'),
      }

      const switchEl = (key, color) => {
        const on = isOn(key)
        return h('button', {
          type: 'button',
          role: 'switch',
          'aria-checked': on ? 'true' : 'false',
          'aria-label': `${featureTitle[key]} ${on ? t('chipOn') : t('chipOff')}`,
          title: on ? t('switchOffTip') : t('switchOnTip'),
          'data-prefill-enable': key,
          onClick: (event) => {
            event.stopPropagation()
            void writeEnabled(key, !on).catch(() => setStatus('error'))
          },
          style: {
            marginLeft: 'auto',
            flex: '0 0 auto',
            width: 28,
            height: 16,
            borderRadius: 8,
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            position: 'relative',
            background: on ? color : 'var(--pf-off)',
            transition: 'background 120ms ease',
          },
        }, h('span', { style: { position: 'absolute', top: 2, left: on ? 14 : 2, width: 12, height: 12, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.25)', transition: 'left 120ms ease' } }))
      }
      const navItem = (key, paneId, color, parent) => {
        const selected = shownPane === paneId
        const off = key !== 'usage' && (!isOn(key) || offBy[key] === true)
        const stripe = key === 'usage' ? 'var(--dsw-alias-label-tertiary)' : off ? 'var(--pf-off)' : color
        return h(
          'div',
          {
            key: paneId,
            role: 'tab',
            tabIndex: 0,
            'aria-selected': selected ? 'true' : 'false',
            'data-prefill-nav': paneId,
            ...(parent ? { 'data-prefill-nav-parent': parent } : {}),
            'data-off': off ? 'true' : 'false',
            onClick: () => setPane(paneId),
            onKeyDown: (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                setPane(paneId)
              }
            },
            style: {
              position: 'relative',
              display: 'block',
              padding: parent ? '4px 10px 4px 26px' : '6px 10px 6px 14px',
              borderRadius: 8,
              cursor: 'pointer',
              background: selected ? 'var(--dsw-alias-bg-base)' : 'transparent',
              boxShadow: selected ? '0 1px 3px rgba(0,0,0,.08)' : 'none',
            },
          },
          h('span', { style: { position: 'absolute', left: parent ? 16 : 4, top: parent ? 7 : 9, bottom: parent ? 7 : 9, width: 3, borderRadius: 2, background: stripe } }),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13, color: off ? 'var(--dsw-alias-label-tertiary)' : selected ? `color-mix(in srgb, ${color} 70%, var(--dsw-alias-label-primary))` : 'var(--dsw-alias-label-primary)' } },
            h('span', { style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, key === 'usage' ? t('usageTitle') : featureTitle[key]),
            key === 'usage' ? null : switchEl(key, color),
          ),
          h(
            'div',
            { style: { fontSize: 11.5, lineHeight: 1.45, marginTop: 1, color: 'var(--dsw-alias-label-tertiary)', opacity: off ? 0.85 : 1 }, 'data-prefill-nav-status': paneId },
            ...(key === 'usage' ? [turns > 0 ? [B(String(turns)), ` ${t('turnsUnit')}`] : t('usageNoTurns')] : navStatus[key]),
            off ? ` · ${!isOn(key) ? t('navDisabled') : t('navOffByCard')}` : '',
          ),
        )
      }
      const tabItem = (key, paneId, color, parent) => {
        const selected = shownPane === paneId
        const off = key !== 'usage' && (!isOn(key) || offBy[key] === true)
        return h(
          'span',
          { key: paneId, style: { display: 'inline-flex', alignItems: 'center', gap: 6, flex: '0 0 auto', padding: '3px 6px 3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', cursor: 'pointer', color: off ? 'var(--dsw-alias-label-tertiary)' : 'var(--dsw-alias-label-primary)', background: selected ? 'var(--dsw-alias-bg-base)' : 'transparent', boxShadow: selected ? '0 1px 3px rgba(0,0,0,.08)' : 'none' } },
          h('span', { role: 'tab', 'aria-selected': selected ? 'true' : 'false', 'data-prefill-nav': paneId, ...(parent ? { 'data-prefill-nav-parent': parent } : {}), 'data-off': off ? 'true' : 'false', onClick: () => setPane(paneId), style: { display: 'inline-flex', alignItems: 'center', gap: 5 } },
            parent ? h('span', { style: { color: 'var(--dsw-alias-label-tertiary)', fontWeight: 400 } }, '└') : null,
            h('i', { style: { width: 7, height: 7, borderRadius: '50%', display: 'inline-block', background: key === 'usage' ? 'var(--dsw-alias-label-tertiary)' : off ? 'var(--pf-off)' : color } }),
            key === 'usage' ? t('usageShort') : featureTitle[key],
          ),
          key === 'usage' ? null : h('span', { style: { display: 'inline-flex', transform: 'scale(0.85)' } }, switchEl(key, color)),
        )
      }

      // ── 头部：当前预设 ▾ · 保存 / 另存为… / 取消预设 · 用量徽标 · 钉住 / ✕ ──
      const firstTok =
        (isOn('system') && !systemFromCardOff ? systemTok : 0) +
        (isOn('items') && !injectMode ? itemsTok : 0) +
        (everyTurnActive && isOn('everyTurn') && !everyTurnFromCardOff ? estimateTokens(everyTurn.firstText.trim() !== '' ? everyTurn.firstText : everyTurn.text) : 0)
      const perTurnTok =
        (everyTurnActive && isOn('everyTurn') && !everyTurnFromCardOff ? estimateTokens(everyTurn.text) : 0) + (isOn('items') && injectCount > 0 ? itemsTok : 0)
      const usageTotal = usage?.total ?? null
      const usagePrompt = usageTotal ? usageTotal.input + usageTotal.cacheRead : 0
      const cacheHit = usagePrompt > 0 ? Math.round((usageTotal.cacheRead / usagePrompt) * 100) : null
      const badge = (color, label, value, unit, attr) =>
        h('span', { key: attr, 'data-prefill-badge': attr, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999, fontSize: 11.5, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', background: tint(color, 14), color: 'var(--dsw-alias-label-secondary)' } }, label, h('b', { style: { color: 'var(--dsw-alias-label-primary)', fontWeight: 700 } }, value), unit)
      const narrow = bounds?.narrow === true
      const header = h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 6, padding: '9px 12px', borderBottom: '1px solid var(--dsw-alias-border-l1)', flexWrap: 'wrap', rowGap: 6 } },
        h(
          'button',
          {
            type: 'button',
            'data-prefill-preset-select': '',
            'aria-expanded': menu === 'presets' ? 'true' : 'false',
            onClick: () => setMenu(menu === 'presets' ? '' : 'presets'),
            style: { display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: narrow ? 200 : 280, height: 28, padding: '0 10px', borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)', fontFamily: 'inherit', fontSize: 13, cursor: 'pointer' },
          },
          h('b', { style: { fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 } }, activeName || t('presetsNone')),
          h('small', { style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 11, whiteSpace: 'nowrap' } }, `${activeKind || t('presetsTitle')} ▾`),
        ),
        h('button', { type: 'button', style: V.btn, 'data-prefill-save': '', title: activePreset.startsWith('pack:') ? t('saveOverTip') : t('saveAsTip'), onClick: () => (activePreset.startsWith('pack:') ? savePack(activePreset.slice(5)) : setMenu('saveas')) }, t('saveShort')),
        h('button', { type: 'button', style: V.btnGhost, 'data-prefill-save-as': '', 'aria-expanded': menu === 'saveas' ? 'true' : 'false', onClick: () => setMenu(menu === 'saveas' ? '' : 'saveas') }, t('saveAs')),
        activePreset === '' || narrow ? null : h('button', { type: 'button', style: V.btnGhost, 'data-prefill-preset-clear': '', onClick: () => void clearPreset().catch(() => setStatus('error')) }, t('presetClear')),
        h('span', { style: { flex: '1 1 auto' } }),
        // 右侧一组（读数 + ? + 钉住 + 收起 + 关闭）不拆开：窄屏换行时整组挪到第二行靠右，关闭按钮不会单独掉下去。
        h(
          'span',
          { 'data-prefill-header-tools': '', style: { display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'nowrap', marginLeft: 'auto' } },
        h(
          'span',
          { style: { display: 'inline-flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' } },
          badge('var(--pf-system)', t('badgeFirst'), `+${num(firstTok)}`, 'tok', 'first'),
          narrow ? null : badge('var(--pf-turn)', t('badgeTurn'), `+${num(perTurnTok)}`, 'tok', 'turn'),
          narrow ? null : badge('var(--pf-ai)', t('badgeCache'), cacheHit === null ? '—' : `${cacheHit}%`, '', 'cache'),
        ),
        h('button', { type: 'button', style: V.btnGhost, 'aria-expanded': open.guide ? 'true' : 'false', title: t('guideShow'), onClick: () => toggle('guide') }, '?'),
        h(
          'button',
          {
            type: 'button',
            style: { ...V.btnGhost, padding: '0 6px', color: pinned ? 'var(--pf-system)' : V.btnGhost.color, background: pinned ? tint('var(--pf-system)', 14) : 'transparent' },
            'aria-pressed': pinned ? 'true' : 'false',
            'aria-label': pinned ? t('pinOff') : t('pinOn'),
            'data-prefill-pin': '',
            title: `${pinned ? t('pinOff') : t('pinOn')} · ${t('pinTip')}`,
            onClick: () => setPinned(!pinned),
          },
          // Lucide pin：未钉住描边，钉住填色（强调色）；图标缺失时回落 📌。
          ICONS.pin ? h(Icon, { name: 'pin', size: 15, fill: pinned ? 'currentColor' : 'none' }) : h('span', { style: { fontSize: 13, lineHeight: 1, opacity: pinned ? 1 : 0.55 } }, '📌'),
        ),
        h('button', { type: 'button', style: { ...V.btnGhost, padding: '0 6px' }, 'aria-label': t('collapseCard'), title: t('collapseCard'), 'data-prefill-collapse': '', onClick: closeCard }, h(Icon, { name: 'chevron-down', size: 15 })),
        h('button', { type: 'button', style: { ...V.btnGhost, fontSize: 14, padding: '0 6px' }, 'aria-label': t('closeCard'), title: t('closeCard'), 'data-prefill-close': '', onClick: closeCard }, h(Icon, { name: 'x', size: 14 })),
        ),
      )

      // 世界书 / 故事记忆是角色卡的子项（0.14）：只在套用的卡带了它们时出现在左栏，缩进挂在「角色卡」下面。
      const navList = navEntries(FEATURE_NAV, { lore: appliedRef !== null && (loreEntries.length > 0 || loreCustom), memory: appliedRef !== null && memoryConfig !== null && typeof memoryConfig === 'object' })
      const shownPane = (pane === 'lore' || pane === 'memory') && !navList.some(([, paneId]) => paneId === pane) ? 'cards' : pane
      const nav = narrow
        ? h(
            'div',
            { role: 'tablist', style: { display: 'flex', flexWrap: 'wrap', gap: 4, padding: '6px 10px', borderBottom: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-1)', flex: '0 0 auto' } },
            ...navList.map(([key, paneId, color, parent]) => tabItem(key, paneId, color, parent)),
            tabItem('usage', 'usage', 'var(--dsw-alias-label-tertiary)'),
          )
        : h(
            'div',
            { role: 'tablist', 'aria-orientation': 'vertical', style: { width: 214, flex: '0 0 214px', boxSizing: 'border-box', overflowY: 'auto', borderRight: '1px solid var(--dsw-alias-border-l1)', padding: 8, display: 'flex', flexDirection: 'column', gap: 2, background: 'var(--dsw-alias-bg-layer-1)' } },
            ...navList.map(([key, paneId, color, parent]) => navItem(key, paneId, color, parent)),
            h('div', { key: 'sep', style: { height: 1, background: 'var(--dsw-alias-border-l1)', margin: '6px 4px' } }),
            navItem('usage', 'usage', 'var(--dsw-alias-label-tertiary)'),
          )

      const main = h(
        'div',
        { style: { flex: '1 1 auto', minWidth: 0, overflowY: 'auto', padding: narrow ? '12px 14px' : '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 } },
        conflict
          ? h(
              'div',
              { style: S.conflictBanner },
              h('span', { style: { fontWeight: 700 } }, `${t('conflictTitle')}：${conflict.kind === 'complete-section' ? t('conflictCompleteSection') : String(conflict.kind ?? '')}`),
              conflict.advice ? h('span', { style: S.dockHint }, String(conflict.advice)) : null,
            )
          : null,
        guideSection,
        sections[shownPane] ?? itemsSection,
      )

      if (!cardOpen) return h('div', { 'data-prefill-anchor': '1', style: { height: 0, width: '100%' } })
      const reduceMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

      return h(
        'div',
        { 'data-prefill-anchor': '1', style: { height: 0, width: '100%', position: 'relative' } },
        h(
          'div',
          {
            ref: cardRef,
            // 卡片里点下拉菜单以外的地方 = 收起菜单。
            onMouseDown: (event) => {
              if (menu === '') return
              const target = event.target
              if (target instanceof Element && target.closest('[data-prefill-menu],[data-prefill-preset-select],[data-prefill-save-as]') !== null) return
              setMenu('')
            },
            onMouseEnter: () => {
              hoverRef.current = true
              clearTimeout(shrinkTimer.current)
            },
            onMouseLeave: () => {
              hoverRef.current = false
              if (pinned) scheduleShrink()
            },
            // 焦点离开卡片（打完字点到别处）而鼠标也不在卡片上：照样缩。
            onBlur: () => {
              if (pinned && !hoverRef.current) scheduleShrink()
            },
            'data-prefill-dock': '1',
            'data-prefill-card-panel': '1',
            'data-shrunk': shrunk ? 'true' : 'false',
            'aria-hidden': shrunk ? 'true' : undefined,
            role: 'dialog',
            'aria-label': t('dockTitle'),
            style: {
              ...COLOR_VARS,
              // 钉住缩成标记时：淡出、不接收点击（下面的对话照常可点）。
              opacity: shrunk ? 0 : 1,
              transform: shrunk ? 'translateY(6px) scale(0.98)' : 'none',
              transformOrigin: 'bottom right',
              pointerEvents: shrunk ? 'none' : 'auto',
              visibility: shrunk ? 'hidden' : 'visible',
              transition: reduceMotion ? 'none' : shrunk ? 'opacity 150ms ease, transform 150ms ease, visibility 0s linear 150ms' : 'opacity 150ms ease, transform 150ms ease',
              position: 'fixed',
              zIndex: 60,
              left: bounds?.left ?? 12,
              bottom: bounds?.bottom ?? 160,
              width: bounds?.width ?? 'min(920px, calc(100vw - 24px))',
              maxHeight: bounds?.maxHeight ?? '60vh',
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
              background: 'var(--dsw-alias-bg-base)',
              color: 'var(--dsw-alias-label-primary)',
              border: '1px solid var(--dsw-alias-border-l1)',
              borderRadius: 14,
              boxShadow: '0 12px 40px rgba(0,0,0,.14), 0 2px 8px rgba(0,0,0,.06)',
              overflow: 'hidden',
              fontSize: 13,
              lineHeight: 1.55,
            },
          },
          header,
          presetUndo === null
            ? null
            : h(
                'div',
                { 'data-prefill-preset-undo-bar': '', style: { ...V.row, ...V.callout('brand'), margin: '8px 12px 0', flexWrap: 'wrap' } },
                h('span', { style: { flex: '1 1 auto', minWidth: 0 } }, t('presetUndoBar')),
                h('button', { type: 'button', style: V.btn, 'data-prefill-preset-undo': '', onClick: () => void undoClearPreset().catch(() => setStatus('error')) }, t('undo')),
              ),
          h('div', { style: { display: 'flex', flexDirection: narrow ? 'column' : 'row', minHeight: 0, flex: '1 1 auto' } }, nav, main),
          menu === 'presets' ? presetsMenu : menu === 'saveas' ? saveAsPanel : null,
          toast === '' ? null : h('div', { 'data-prefill-toast': '', style: { position: 'absolute', right: 14, bottom: 10, zIndex: 6, padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: 'var(--dsw-alias-label-primary)', color: 'var(--dsw-alias-bg-base)', boxShadow: '0 2px 8px rgba(0,0,0,.15)' } }, toast),
        ),
        shrunk
          ? h(
              'button',
              {
                type: 'button',
                'data-prefill-marker': '1',
                title: t('markerTip'),
                'aria-label': t('markerTip'),
                onMouseEnter: restoreCard,
                onFocus: restoreCard,
                onClick: restoreCard,
                style: {
                  ...COLOR_VARS,
                  position: 'fixed',
                  zIndex: 61,
                  // 停在卡片区域的右下角（紧贴输入框上方、卡片右沿），不挡对话正文。
                  right: bounds ? Math.max(12, (bounds.vw ?? window.innerWidth) - bounds.left - bounds.width) : 12,
                  bottom: bounds?.bottom ?? 160,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  maxWidth: 260,
                  height: 28,
                  padding: '0 10px',
                  borderRadius: 999,
                  border: '1px solid var(--dsw-alias-border-l2)',
                  background: 'var(--dsw-alias-bg-base)',
                  color: 'var(--dsw-alias-label-primary)',
                  boxShadow: '0 4px 14px rgba(0,0,0,.12)',
                  fontFamily: 'inherit',
                  fontSize: 12,
                  cursor: 'pointer',
                  animation: reduceMotion ? 'none' : 'dsh-prefill-pop 150ms ease',
                },
              },
              h('span', { style: { display: 'inline-flex', color: 'var(--pf-system)' } }, h(Icon, { name: 'pin', size: 12, fill: 'currentColor' })),
              h('b', { style: { fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 } }, activeName || t('presetsNone')),
              h(
                'span',
                { style: { display: 'inline-flex', gap: 3, flex: '0 0 auto' } },
                ...summaryDots.map((dot) =>
                  h('i', {
                    key: dot.key,
                    style: { width: 7, height: 7, borderRadius: '50%', display: 'inline-block', boxSizing: 'border-box', background: dot.on && dot.filled ? dot.color : dot.on ? 'transparent' : 'var(--pf-off)', border: `1.5px solid ${dot.on ? dot.color : 'var(--pf-off)'}` },
                  }),
                ),
              ),
              reduceMotion ? null : h('style', null, '@keyframes dsh-prefill-pop{from{opacity:0;transform:scale(.92)}to{opacity:1;transform:none}}'),
            )
          : null,
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

      // ── 疑似未登记注入（宿主审计）+ 本会话阻断 / 全局记住 ───────────────────
      const auditRows = Array.isArray(envelope?.audit?.[sessionId]) ? envelope.audit[sessionId] : []
      const blocksAll = envelope?.state?.injectionBlocks !== null && typeof envelope?.state?.injectionBlocks === 'object' ? envelope.state.injectionBlocks : {}
      const blockListOf = (key, group) => (Array.isArray(blocksAll?.[key]?.[group]) ? blocksAll[key][group] : [])
      const isPureSession = envelope?.state?.gate?.[sessionId] === 'pure'
      const toggleBlock = (key, group, name) => {
        const list = blockListOf(key, group)
        const nextList = list.includes(name) ? list.filter((entry) => entry !== name) : [...list, name]
        const nextEntry = { ...(blocksAll[key] ?? {}), [group]: nextList }
        void call({ injectionBlocks: { ...blocksAll, [key]: nextEntry } })
          .then((data) => setEnvelope(data))
          .catch(() => setStatus('error'))
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
            const injectionBlocks = { ...(env?.state?.injectionBlocks ?? {}) }
            delete overrides[sessionId]
            delete injects[sessionId]
            delete sessionAllowKinds[sessionId]
            delete sessionTools[sessionId]
            delete injectionBlocks[sessionId]
            return call({ overrides, injects, sessionAllowKinds, sessionTools, injectionBlocks })
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
          // 疑似未登记注入：默认放行只记录；可本会话阻断，或全局记住（之后所有会话提前拦）。
          auditRows.length === 0
            ? null
            : h(
                'div',
                { style: S.injectGroupHead, title: t('auditHint') },
                h('span', null, t('auditLabel')),
                h('span', { style: S.chipStatic }, `${auditRows.length}`),
                h('span', { style: S.injectRule }),
              ),
          ...auditRows.map((row) => {
            const inSession = blockListOf(sessionId, row.group).includes(row.name)
            const inGlobal = blockListOf('*', row.group).includes(row.name)
            const groupLabel = row.group === 'sections' ? t('injectSections') : row.group === 'contexts' ? t('injectContexts') : t('injectMessages')
            return h(
              'div',
              { key: `audit-${row.group}-${row.name}`, style: S.chipRow, title: row.preview || row.name },
              h('span', { style: S.chip(inSession || inGlobal) }, row.name),
              h('span', { style: S.chipStatic }, `${groupLabel} · ${t('auditCount').replace('{n}', String(row.count ?? 1))}`),
              isPureSession ? h('span', { style: S.injectStale }, t('auditPureLeak')) : null,
              row.blockable === false
                ? h('span', { style: S.chipStatic }, t('auditDirect'))
                : [
                    inGlobal ? h('span', { key: 'g', style: S.chipStatic }, t('auditBlockedGlobal')) : null,
                    !inGlobal && inSession ? h('span', { key: 's', style: S.chipStatic }, `${t('auditBlockedSession')} · ${t('auditNextTurn')}`) : null,
                    inGlobal
                      ? null
                      : h(
                          'button',
                          { key: 'bs', type: 'button', style: S.gateBtn, onClick: () => toggleBlock(sessionId, row.group, row.name) },
                          inSession ? t('auditUnblockSession') : t('auditBlockSession'),
                        ),
                    h(
                      'button',
                      { key: 'bg', type: 'button', style: S.gateBtn, onClick: () => toggleBlock('*', row.group, row.name) },
                      inGlobal ? t('auditForget') : t('auditRemember'),
                    ),
                  ],
            )
          }),
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
