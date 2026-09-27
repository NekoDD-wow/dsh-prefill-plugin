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
              .then((data) => setState(data.state))
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
      const [state, setState] = React.useState(null)
      const [confirming, setConfirming] = React.useState(false)

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
          .then((data) => setState(data.state))
          .catch(() => {})
      }, [call])

      React.useEffect(() => {
        refresh()
      }, [refresh, sessionId])

      if (sessionId === '') return null
      const gate = state?.gate !== null && typeof state?.gate === 'object' ? state.gate : {}
      const on = gate[sessionId] === 'pure'

      const write = (mode, markSeen) => {
        const patch = { gate: { ...gate, [sessionId]: mode } }
        if (markSeen === true) patch.noticeSeen = true
        void call(patch)
          .then((data) => setState(data.state))
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

      return h(
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
      },
    }
  },
})
