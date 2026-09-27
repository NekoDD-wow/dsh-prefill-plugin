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
      gateOff: '放行',
      gateOn: '纯净',
      gateTitleOff: '当前：全部放行（harness 注入照常）——点击开启纯净预注入',
      gateTitleOn: '当前：纯净预注入 ON —— 本轮阻断全部 harness 注入；点击关闭',
      gateNoticeTitle: '开启纯净预注入？',
      gateNoticeBody:
        '该轮系统提示会被渲染为空并重写头部 ⇒ 开新 series、前缀缓存失效、这一轮变贵。此说明只弹一次。',
      gateConfirm: '开启',
      gateCancel: '取消',
      prefillOff: '预填装',
      prefillOn: '预填装·开',
      prefillTitleOff: '本会话未使用预填装——点击启用（进入预填装模式，预渲染填装内容）',
      prefillTitleOn: '本会话已使用预填装——预渲染内容将在首轮发出时写成真实会话；点击关闭',
      title: '会话预填装 · 注入闸门',
      intro:
        'M1 四通道闸门：sections / contexts / tools / 注入消息，各自「能写」与「能关」。默认不干预任何会话——只有把会话 id 填进「武装目标」才会生效。',
      cardTitle: '通道开关',
      writeGroup: '写通道（预填装）',
      blockGroup: '关通道（闸门 ON）',
      probeSection: '写入探针 section',
      probeContext: '写入探针 context',
      blockSections: '清空 sections（complete 空段）',
      blockContexts: '清空 contexts（suppressRuntimeContext）',
      blockTools: '清空 tools（restrict allow:[]）',
      blockMessages: '过滤注入消息（pre-step）',
      armedLabel: '武装目标（会话 id，空格或逗号分隔；空 = 不干预任何会话）',
      allowLabel: '放行 kind（逗号分隔；user 恒放行）',
      apply: '应用',
      applyArmed: '应用武装目标',
      saved: '已保存',
      saveFailed: '保存失败',
      stateTitle: '闸门状态',
      stateFileLabel: '状态文件',
      hostLabel: 'Host 半',
      routeLabel: '自有路由',
      reachable: '通',
      unreachable: '不通',
      busy: '探测中…',
      idle: '未探测',
      m1Note:
        'M1 验收：四通道各自可写可关，且能按轮次闩锁、中途插话不重置。状态文件可被外部脚本直接改写，便于在不污染当前会话的前提下做端到端验证。',
      // ── 草稿区（conversation.input.dock）──
      dockTitle: '预填装草稿',
      dockHint:
        '按顺序任意写：用户消息与 AI 回答都可以连续出现，思维链挂在 AI 回答里（不是单独一轮）。首轮发出时它们会变成真实会话历史。',
      dockEmpty: '还没有内容——点下面的按钮加一条。',
      addUser: '＋ 用户消息',
      addAssistant: '＋ AI 回答',
      dockClear: '清空',
      roleUser: '用户',
      roleAssistant: 'AI',
      textUser: '用户消息',
      textAssistant: 'AI 回答',
      reasoning: '思维链（可选）',
      toUser: '改成用户消息',
      toAssistant: '改成 AI 回答',
      moveUp: '上移',
      moveDown: '下移',
      removeItem: '删除这条',
      syncIdle: '未改动',
      syncSaving: '同步中…',
      syncSaved: '已同步',
      syncFailed: '同步失败（检查 host 路由）',
      countSuffix: ' 条',
      // ── Q9 角标 ──
      statePure: '纯净',
      statePass: '全放行',
      stateFilter: '白名单',
      nextTurn: '下一轮生效',
      badgeTip: '本轮生效的闸门快照（本轮已冻结；改开关只影响下一轮）',
    }

    const en = {
      nav: 'Prefill',
      gateOff: 'Admit',
      gateOn: 'Pure',
      gateTitleOff: 'Current: everything admitted — click to enable the pure prefill gate',
      gateTitleOn: 'Current: pure prefill ON — this turn blocks every harness injection; click to disable',
      gateNoticeTitle: 'Enable pure prefill?',
      gateNoticeBody:
        'This turn renders the system prompt empty and rewrites the head ⇒ a new series starts, the prefix cache is void, and the turn costs more. Shown once.',
      gateConfirm: 'Enable',
      gateCancel: 'Cancel',
      prefillOff: 'Prefill',
      prefillOn: 'Prefill·on',
      prefillTitleOff: 'This session does not use prefill — click to enable prefill mode (draft is pre-rendered)',
      prefillTitleOn: 'This session uses prefill — the pre-rendered content becomes real conversation on first send',
      title: 'Session prefill · injection gate',
      intro:
        'M1 four-channel gate: sections / contexts / tools / injected messages, each writable and blockable. Nothing is touched by default — only session ids listed under "Armed targets" are affected.',
      cardTitle: 'Channel switches',
      writeGroup: 'Write channels (prefill)',
      blockGroup: 'Block channels (gate ON)',
      probeSection: 'Write probe section',
      probeContext: 'Write probe context',
      blockSections: 'Empty sections (complete empty section)',
      blockContexts: 'Empty contexts (suppressRuntimeContext)',
      blockTools: 'Empty tools (restrict allow:[])',
      blockMessages: 'Filter injected messages (pre-step)',
      armedLabel: 'Armed targets (session ids, space or comma separated; empty touches nothing)',
      allowLabel: 'Allowed kinds (comma separated; user always passes)',
      apply: 'Apply',
      applyArmed: 'Apply armed targets',
      saved: 'Saved',
      saveFailed: 'Save failed',
      stateTitle: 'Gate state',
      stateFileLabel: 'State file',
      hostLabel: 'Host half',
      routeLabel: 'Own route',
      reachable: 'reachable',
      unreachable: 'unreachable',
      busy: 'probing…',
      idle: 'not probed',
      m1Note:
        'M1 acceptance: each of the four channels can be written and blocked, latched per turn, with mid-turn interjections not resetting the latch. The state file can be edited by external scripts, so end-to-end verification needs no session pollution.',
      // ── draft dock (conversation.input.dock) ──
      dockTitle: 'Prefill draft',
      dockHint:
        'Write rounds in any order: consecutive user messages and consecutive AI answers are both fine, and reasoning belongs to the AI answer (not a round of its own). They become real history on the first send.',
      dockEmpty: 'Nothing yet — add a row with the buttons below.',
      addUser: '+ User message',
      addAssistant: '+ AI answer',
      dockClear: 'Clear',
      roleUser: 'User',
      roleAssistant: 'AI',
      textUser: 'User message',
      textAssistant: 'AI answer',
      reasoning: 'Reasoning (optional)',
      toUser: 'Make it a user message',
      toAssistant: 'Make it an AI answer',
      moveUp: 'Move up',
      moveDown: 'Move down',
      removeItem: 'Remove this row',
      syncIdle: 'unchanged',
      syncSaving: 'syncing…',
      syncSaved: 'synced',
      syncFailed: 'sync failed (check the host route)',
      countSuffix: ' rows',
      // ── Q9 badge ──
      statePure: 'Pure',
      statePass: 'Admit all',
      stateFilter: 'Allow-list',
      nextTurn: 'next turn',
      badgeTip: 'Effective gate snapshot for this turn (frozen for the turn; toggling affects the next one)',
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
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 12,
        background: 'var(--dsw-alias-bg-layer-1)',
        fontSize: 12,
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
        padding: '5px 9px',
        borderRadius: 8,
        border: '1px dashed var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: 11,
        fontFamily: 'inherit',
        resize: 'vertical',
      },
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
      const [ping, setPing] = React.useState({ phase: 'idle' })
      const [note, setNote] = React.useState('')
      const [armedDraft, setArmedDraft] = React.useState('')
      const [allowDraft, setAllowDraft] = React.useState('')

      const adopt = React.useCallback((next) => {
        setState(next)
        setArmedDraft((next?.armed ?? []).join(' '))
        setAllowDraft((next?.allowKinds ?? []).join(', '))
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
            adopt(data.state)
            setPing({ phase: 'ok', data })
          })
          .catch((error) => setPing({ phase: 'error', message: String(error) }))
      }, [call, adopt])

      const mutate = React.useCallback(
        async (body) => {
          try {
            const data = await call(body)
            adopt(data.state)
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
          h(Field, {
            label: t('allowLabel'),
            value: allowDraft,
            onChange: setAllowDraft,
          }),
          h(
            'button',
            {
              type: 'button',
              style: S.button,
              onClick: () => void mutate({ allowKinds: splitList(allowDraft) }),
            },
            t('apply'),
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
      const [state, setState] = React.useState(null)

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
          .then((data) => setState(data.state))
          .catch(() => {})
      }, [call, sessionId])

      if (sessionId === '') return null
      const map = state?.prefill !== null && typeof state?.prefill === 'object' ? state.prefill : {}
      const on = typeof map[sessionId] === 'string' && map[sessionId] !== ''

      return h(
        'button',
        {
          type: 'button',
          'aria-pressed': on ? 'true' : 'false',
          title: on ? t('prefillTitleOn') : t('prefillTitleOff'),
          style: S.gatePill(on),
          onClick: () => {
            void call({ prefill: { ...map, [sessionId]: on ? '' : 'default' } })
              .then((data) => {
                setState(data.state)
                notifyStateChanged()
              })
              .catch(() => {})
          },
        },
        h('span', { style: S.gateDot(on) }),
        on ? t('prefillOn') : t('prefillOff'),
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
      const dirty = React.useRef(false)
      const staged = React.useRef(false)

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

      const statusKind = status === 'error' ? 'error' : status === 'saved' ? 'saved' : 'idle'
      const statusText =
        status === 'error' ? t('syncFailed') : status === 'saving' ? t('syncSaving') : status === 'saved' ? t('syncSaved') : t('syncIdle')

      return h(
        'div',
        { style: S.dock },
        h(
          'div',
          { style: S.dockHead },
          h('span', { style: S.dockTitle }, t('dockTitle')),
          h('span', { style: S.label }, `${items.length}${t('countSuffix')}`),
          h('span', { style: S.dockStatus(statusKind) }, statusText),
          h('span', { style: { flex: '1 1 auto' } }),
          h(
            'button',
            { type: 'button', style: S.gateBtn, onClick: () => edit([]) },
            t('dockClear'),
          ),
        ),
        h('div', { style: S.dockHint }, t('dockHint')),

        items.length === 0 ? h('div', { style: S.dockHint }, t('dockEmpty')) : null,

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
      },
    }
  },
})
