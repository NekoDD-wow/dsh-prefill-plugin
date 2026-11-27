// M4 设置页信息架构重构 + 样式收口 + summary.model 回归单测（先红后绿）。
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadClient, findAll, textOf } from './client-render-harness.mjs'
import { makeSettingsHarness } from './settings-harness.mjs'

const clientSrc = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

function makeManySessionsEnvelope(count = 15) {
  const sessions = {}
  const turns = {}
  const activePreset = {}
  const everyTurn = { '*': { enabled: false, text: '', firstText: '', mode: 'always', checks: [], auto: { warmup: 3, streak: 3, probation: 2 } } }
  const sandbox = { '*': { level: 'observe' } }
  const sandboxView = {
    '*': {
      level: 'observe',
      levelFrom: 'global',
      packs: [
        { id: 'dsh-core-prompt', label: 'DSH 核心 · 系统提示', locked: false, setting: { global: 'deny' } },
        { id: 'agent-teams', label: 'Agent Teams', locked: false, setting: {} },
      ],
    },
  }
  for (let i = 1; i <= count; i += 1) {
    const sid = `s${String(i).padStart(2, '0')}`
    if (i <= 5) sessions[sid] = ['read']
    if (i <= 3) turns[sid] = i
    if (i === 1 || i === 2) activePreset[sid] = i === 1 ? 'pack:写作搭档' : 'builtin:pure'
    if (i === 2) everyTurn[sid] = { enabled: true, text: '中文思考', firstText: '', mode: 'always', checks: ['zh'] }
    if (i === 3) {
      sandbox[sid] = { level: 'controlled' }
      sandboxView[sid] = { level: 'controlled', levelFrom: 'session', blocked: 4 }
    } else if (i === 4) {
      sandboxView[sid] = { level: 'observe', levelFrom: 'global', blocked: 7 }
    } else {
      sandboxView[sid] = { level: 'observe', levelFrom: 'global', blocked: 0 }
    }
  }
  return {
    ok: true,
    state: {
      version: 2,
      armed: ['s01'],
      levers: { probeSection: false, probeContext: false, blockSections: false, blockContexts: false, blockTools: false, blockMessages: false },
      allowKinds: ['user'],
      tools: null,
      ui: { motion: 'lite', experimental: false },
      activePreset,
      everyTurn,
      sandbox,
    },
    tools: { catalog: ['read', 'bash'], sessions },
    turns,
    sandboxView,
    snapshots: {},
    manualQueued: {},
    injections: { catalog: { messages: ['runtime-context'] } },
  }
}

function makeLibRoutes() {
  return {
    '/api/dsh-prefill/packs': (body) =>
      body?.op === 'list'
        ? {
            ok: true,
            packs: [
              { name: '写作搭档', count: 3 },
              { name: '代码审查', count: 1 },
            ],
            blocks: [{ id: 'b1', name: '中文思维' }],
            towers: [{ id: 't1', name: 'RP 套餐' }],
            builtins: [{ id: 'pure', name: '纯净模式' }],
            everyTurnBlocks: [{ id: 'zh-thinking', name: '中文思考' }],
            hiddenBuiltins: ['zh-thinking'],
          }
        : { ok: true },
    '/api/dsh-prefill/cards': (body) =>
      body?.op === 'list'
        ? { ok: true, cards: [{ id: 'c1', name: '小夏', hasAvatar: true }] }
        : { ok: true },
    '/api/dsh-prefill/reasoning/status': () => ({
      ok: true,
      enabled: false,
      proxyRunning: false,
      hasApiKey: true,
      failures: 0,
      audit: [],
    }),
  }
}

async function renderRealPage(envPayload = makeManySessionsEnvelope(15), extra = {}) {
  const routes = {
    '/api/dsh-prefill/state': (body) => {
      if (body && typeof body === 'object') {
        envPayload = { ...envPayload, state: { ...envPayload.state, ...body } }
      }
      return envPayload
    },
    ...makeLibRoutes(),
    ...(extra.routes ?? {}),
  }
  const env = loadClient({ routes })
  const h = env.React.createElement
  const props = {
    t: (k) => k,
    titleOf: extra.titleOf ?? ((id) => (id === 's01' ? '清晨写作计划' : id === 's02' ? '深度排查脚本' : '')),
    summaryOf:
      extra.summaryOf ??
      ((id) => ({
        updatedAt: Date.now() - 120_000,
        cwd: id === 's01' ? '/workspace/alpha' : '/workspace/beta',
      })),
  }
  const render = () => env.renderer.render(h(env.components.PrefillSection, props))
  let tree = render()
  for (let i = 0; i < 4; i += 1) {
    await env.settle()
    tree = render()
  }
  return { env, tree, render }
}

// ── 1. 页头 + KPI 权重分级、0 值降权、blocked 暖框与点击快筛联动 ────────────

test('[M4-1] 页头 20px/700 + 卡片 14px 圆角 + KPI 0 值降权、blocked 暖微框与点击快筛联动（零新增请求）', async () => {
  const envData = makeManySessionsEnvelope(5)
  // 让 everyTurn 为 0（验证 0 值自动降权为 label-tertiary）
  delete envData.state.everyTurn.s02
  const scrolled = []
  const page = await renderRealPage(envData)
  const { env } = page
  env.document.querySelector = (sel) => ({
    scrollIntoView: (opts) => scrolled.push({ sel, opts }),
  })

  // 页头主标题 20px / 700 / letterSpacing: -0.02em；副说明 13px label-secondary
  const titleNode = findAll(page.tree, (_p, n) => n.type === 'div' && textOf(n) === 'title')[0]
  assert.ok(titleNode, '找到页头主标题')
  assert.equal(titleNode.props.style.fontSize, 20)
  assert.equal(titleNode.props.style.fontWeight, 700)
  assert.equal(titleNode.props.style.letterSpacing, '-0.02em')
  const introNode = findAll(page.tree, (p) => p['data-prefill-intro'] !== undefined)[0]
  assert.equal(introNode.props.style.fontSize, 13)

  // 设置大卡统一 14px 圆角
  const overviewCard = findAll(page.tree, (p) => p['data-prefill-anchor'] === 'overview')[0]
  assert.equal(overviewCard.props.style.borderRadius, 14)

  // 4 格 KPI：按钮可点 + 顶行小标签与微语义点 + 底行大等宽数字（20–22px / 700 / tabular-nums）
  const tiles = findAll(page.tree, (p) => typeof p['data-prefill-kpi'] === 'string')
  assert.deepEqual(tiles.map((t) => t.props['data-prefill-kpi']), ['live', 'preset', 'everyTurn', 'blocked'])
  for (const tile of tiles) {
    assert.equal(tile.type, 'button', 'KPI 格为可点 button')
    const dot = findAll(tile, (p) => p['data-prefill-kpi-dot'] !== undefined)[0]
    const num = findAll(tile, (p) => p['data-prefill-kpi-num'] !== undefined)[0]
    assert.ok(dot, 'KPI 顶行带微语义点')
    assert.ok(num, 'KPI 底行带大数字节点')
    assert.ok(num.props.style.fontSize >= 20 && num.props.style.fontSize <= 22, 'KPI 数字 20–22px')
    assert.equal(num.props.style.fontWeight, 700, 'KPI 数字字重 700')
    assert.equal(num.props.style.fontVariantNumeric, 'tabular-nums', 'KPI 数字 tabular-nums')
  }

  // 数值 0（everyTurn）自动降为 label-tertiary
  const zeroTile = tiles.find((t) => t.props['data-prefill-kpi'] === 'everyTurn')
  assert.equal(zeroTile.props['data-prefill-kpi-value'], '0')
  const zeroNum = findAll(zeroTile, (p) => p['data-prefill-kpi-num'] !== undefined)[0]
  assert.equal(zeroNum.props.style.color, 'var(--dsw-alias-label-tertiary)', 'KPI 为 0 时数字降权为 label-tertiary')

  // blocked > 0 格加暖色微框（mix(warn, 35, ...)）
  const blockedTile = tiles.find((t) => t.props['data-prefill-kpi'] === 'blocked')
  assert.equal(blockedTile.props['data-prefill-kpi-value'], '4')
  assert.match(String(blockedTile.props.style.border ?? blockedTile.props.style.borderColor ?? ''), /state-warn-primary\) 35%/, 'blocked > 0 格带暖色 35% 微框')

  // 点击 KPI「已套预设」：联动筛选下方总览 + 平滑滚至 overview + 零新增网络请求；再次点击取消
  const fetchesBefore = env.fetches.length
  const presetTile = tiles.find((t) => t.props['data-prefill-kpi'] === 'preset')
  presetTile.props.onClick()
  let tree = page.render()
  assert.equal(env.fetches.length, fetchesBefore, 'KPI 点击快筛零新增网络请求')
  assert.ok(scrolled.some((s) => s.sel === '[data-prefill-anchor="overview"]'), '点击 KPI 滚至 overview 锚点')
  const filteredIds = findAll(tree, (p) => typeof p['data-prefill-overview-row'] === 'string').map((n) => n.props['data-prefill-overview-row'])
  assert.deepEqual(filteredIds, ['s01', 's02'], '仅展示已套预设会话')

  // 再次点击同一 KPI 取消筛选
  findAll(tree, (p) => p['data-prefill-kpi'] === 'preset')[0].props.onClick()
  tree = page.render()
  assert.equal(findAll(tree, (p) => typeof p['data-prefill-overview-row'] === 'string').length, 5, '再次点击取消快筛恢复全部')
})

// ── 2. 总览会话列表：分组 + 搜索（含预设名 + 清除）+ 紧凑双行微卡 + 10 条分页 ──

test('[M4-2] 总览：4 分段分组 + 标题/id/预设名搜索与清除 + 10 条稳态分页 + 紧凑双行微卡（默认观察降权）', async () => {
  const page = await renderRealPage(makeManySessionsEnvelope(15))
  let tree = page.tree

  // 顶部 4 分组 tab：全部 / 运行中 / 已自定义 / 跟随默认
  const groupBtns = findAll(tree, (p) => typeof p['data-prefill-overview-group'] === 'string')
  assert.deepEqual(groupBtns.map((b) => b.props['data-prefill-overview-group']), ['all', 'live', 'custom', 'default'])
  assert.equal(groupBtns[0].props['aria-selected'], 'true', '默认选中全部')

  // 默认每页 10 条 + 右下角分页条
  assert.equal(findAll(tree, (p) => typeof p['data-prefill-overview-row'] === 'string').length, 10, '第 1 页默认展示 10 条')
  const pag = findAll(tree, (p) => p['data-prefill-overview-pagination'] !== undefined)[0]
  assert.ok(pag, '多于 10 条显示稳态分页条')
  assert.match(textOf(pag), /15/, '分页条显示总条数')
  assert.match(textOf(pag), /1\s*\/\s*2/, '分页条显示 1/2 页')

  // 翻到第 2 页：剩 5 条
  findAll(tree, (p) => p['data-prefill-overview-next'] !== undefined)[0].props.onClick()
  tree = page.render()
  assert.equal(findAll(tree, (p) => typeof p['data-prefill-overview-row'] === 'string').length, 5, '第 2 页展示剩余 5 条')
  findAll(tree, (p) => p['data-prefill-overview-prev'] !== undefined)[0].props.onClick()
  tree = page.render()
  assert.equal(findAll(tree, (p) => typeof p['data-prefill-overview-row'] === 'string').length, 10, '上一页回到第 1 页')

  // 切分组「运行中」：5 条（s01..s05）
  findAll(tree, (p) => p['data-prefill-overview-group'] === 'live')[0].props.onClick()
  tree = page.render()
  assert.equal(findAll(tree, (p) => typeof p['data-prefill-overview-row'] === 'string').length, 5)
  assert.equal(findAll(tree, (p) => p['data-prefill-overview-pagination'] !== undefined).length, 0, '≤10 条不渲染多余翻页')

  // 切分组「已自定义」：3 条（s01 预设、s02 预设+每轮、s03 受控拦截）
  findAll(tree, (p) => p['data-prefill-overview-group'] === 'custom')[0].props.onClick()
  tree = page.render()
  assert.deepEqual(
    findAll(tree, (p) => typeof p['data-prefill-overview-row'] === 'string').map((n) => n.props['data-prefill-overview-row']),
    ['s01', 's02', 's03'],
  )

  // 切回「全部」，按预设人话名搜索「写作搭档」+ 点清除按钮恢复
  findAll(tree, (p) => p['data-prefill-overview-group'] === 'all')[0].props.onClick()
  tree = page.render()
  findAll(tree, (p) => p['data-prefill-overview-filter'] !== undefined)[0].props.onChange({ target: { value: '写作搭档' } })
  tree = page.render()
  assert.deepEqual(
    findAll(tree, (p) => typeof p['data-prefill-overview-row'] === 'string').map((n) => n.props['data-prefill-overview-row']),
    ['s01'],
    '搜索支持按预设人话名过滤',
  )
  const clearBtn = findAll(tree, (p) => p['data-prefill-overview-filter-clear'] !== undefined)[0]
  assert.ok(clearBtn, '输入关键词后出现清除按钮')
  clearBtn.props.onClick()
  tree = page.render()
  assert.equal(findAll(tree, (p) => typeof p['data-prefill-overview-row'] === 'string').length, 10, '点清除回到分页首屏')

  // 轻量双行微卡：圆角 10px、padding 10px 12px、bg-base + border-l1；默认继承观察档（s04）降权为透明底次文字且不标 warn
  const s04Row = findAll(tree, (p) => p['data-prefill-overview-row'] === 's04')[0]
  assert.equal(s04Row.props.style.borderRadius, 10)
  assert.equal(s04Row.props.style.padding, '10px 12px')
  assert.equal(s04Row.props.style.background, 'var(--dsw-alias-bg-base)')
  const s04Sbx = findAll(s04Row, (p) => p['data-prefill-overview-sandbox'] === 's04')[0]
  assert.equal(s04Sbx.props.style.background, 'transparent', '默认继承的仅观察退为极淡无底次文字')
  assert.doesNotMatch(String(s04Sbx.props.style.color ?? ''), /state-warn-primary/, '观察档绝不标 warn')
})

// ── 3. 表单分组 + 去绿圈 + 未保存高亮底栏 + 沙盒三态分段与两列包表 ───────────

test('[M4-3] 去绿圈中性品牌选中态 + 每轮默认双子区与字数估算 + 脏状态暖色底栏 + 沙盒三态副说明与紧凑包表', async () => {
  const page = await renderRealPage(makeManySessionsEnvelope(3))
  let tree = page.tree

  // S.chip(active) 去绿圈：展开开发者区看 toolsAll（默认选中），不能含 state-success-primary
  findAll(tree, (p) => p['data-prefill-dev-toggle'] !== undefined)[0].props.onClick()
  tree = page.render()
  const toolsAllBtn = findAll(tree, (_p, n) => n.type === 'button' && textOf(n) === 'toolsAll')[0]
  assert.ok(toolsAllBtn, '找到 toolsAll 按钮')
  assert.doesNotMatch(String(toolsAllBtn.props.style.border ?? ''), /state-success-primary/, 'S.chip(active) 不再使用绿色边框')
  assert.match(String(toolsAllBtn.props.style.background ?? ''), /color-mix\(in srgb, var\(--dsw-alias-brand-primary\) 10%, var\(--dsw-alias-bg-base\)\)/)
  assert.match(String(toolsAllBtn.props.style.border ?? ''), /color-mix\(in srgb, var\(--dsw-alias-brand-primary\) 38%, var\(--dsw-alias-border-l2\)\)/)
  assert.equal(toolsAllBtn.props.style.fontWeight, 600)

  // 新会话默认 · 每轮注入：政策/内容两子区 + 显式标签与字数/tok 估算
  assert.equal(findAll(tree, (p) => p['data-prefill-default-turn-section'] === 'policy').length, 1)
  assert.equal(findAll(tree, (p) => p['data-prefill-default-turn-section'] === 'content').length, 1)
  assert.equal(findAll(tree, (p) => p['data-prefill-default-turn-text-metrics'] !== undefined).length, 1)
  assert.equal(findAll(tree, (p) => p['data-prefill-default-turn-first-metrics'] !== undefined).length, 1)
  assert.equal(findAll(tree, (p) => p['data-prefill-default-turn-bar'] === 'clean').length, 1)

  // 修改默认每轮文本：底栏高亮为浅暖色动作条，「保存为默认」升为主按钮（bg: brand-primary, color: bg-base）+ ghost「放弃修改」
  findAll(tree, (p) => p['data-prefill-default-turn-text'] !== undefined)[0].props.onChange({ target: { value: '请保持客观严谨' } })
  tree = page.render()
  const dirtyBar = findAll(tree, (p) => p['data-prefill-default-turn-bar'] === 'dirty')[0]
  assert.ok(dirtyBar, '编辑后出现脏状态高亮底栏')
  assert.match(String(dirtyBar.props.style.background ?? ''), /state-warn-primary/)
  const saveBtn = findAll(dirtyBar, (p) => p['data-prefill-default-turn-save'] !== undefined)[0]
  assert.equal(saveBtn.props.style.background, 'var(--dsw-alias-brand-primary)')
  assert.equal(saveBtn.props.style.color, 'var(--dsw-alias-bg-base)')
  const discardBtn = findAll(dirtyBar, (p) => p['data-prefill-default-turn-discard'] !== undefined)[0]
  assert.equal(discardBtn.props.style.background, 'transparent', '放弃修改为 ghost 按钮')

  // 新会话默认 · 会话沙盒：带副说明三态分段 + 两列紧凑包规则表
  const sbxSeg = findAll(tree, (p) => p['data-prefill-default-sbx-seg'] !== undefined)[0]
  assert.ok(sbxSeg, '沙盒默认档位使用三态分段容器')
  assert.equal(sbxSeg.props.role, 'radiogroup')
  assert.equal(findAll(sbxSeg, (p) => p['data-prefill-default-sbx-sub'] !== undefined).length, 3, '三态均带副说明')
  const packTable = findAll(tree, (p) => p['data-prefill-default-pack-table'] !== undefined)[0]
  assert.ok(packTable, '来源包默认规则使用两列紧凑表')
})

// ── 4. 资源库筛选 + 2 列微卡网格 + 两步删除切红 ──────────────────────────────

test('[M4-4] 资源库：工作区嵌卡头 + 类型筛选（默认全部）+ 2 列微卡网格 + 两步删除 armed 切红', async () => {
  const page = await renderRealPage(makeManySessionsEnvelope(3))
  let tree = page.tree

  // 工作区下拉嵌在卡头容器内
  const libHead = findAll(tree, (p) => p['data-prefill-lib-header'] !== undefined)[0]
  assert.ok(libHead && findAll(libHead, (p) => p['data-prefill-lib-session'] !== undefined).length === 1, '工作区 select 内嵌卡头右侧')

  // 顶部类型筛选条默认选中「全部」，首屏全部数据钩子可见
  const filterTabs = findAll(tree, (p) => typeof p['data-prefill-lib-filter'] === 'string')
  assert.deepEqual(filterTabs.map((n) => n.props['data-prefill-lib-filter']), ['all', 'packs', 'cards', 'bench', 'hidden'])
  assert.equal(filterTabs[0].props['aria-selected'], 'true', '默认选中全部')
  assert.equal(findAll(tree, (p) => typeof p['data-prefill-lib-pack'] === 'string').length, 2)
  assert.equal(findAll(tree, (p) => typeof p['data-prefill-lib-card'] === 'string').length, 1)
  assert.equal(findAll(tree, (p) => typeof p['data-prefill-lib-block'] === 'string').length, 1)
  assert.equal(findAll(tree, (p) => typeof p['data-prefill-lib-tower'] === 'string').length, 1)
  assert.equal(findAll(tree, (p) => typeof p['data-prefill-lib-hidden'] === 'string').length, 1)

  // 2 列微卡网格
  const packGrid = findAll(tree, (p) => p['data-prefill-lib-grid'] === 'packs')[0]
  assert.ok(packGrid)
  assert.equal(packGrid.props.style.display, 'grid')
  assert.equal(packGrid.props.style.gridTemplateColumns, 'repeat(auto-fill, minmax(260px, 1fr))')

  // 切到「角色卡」只看角色卡，不渲染预设组
  findAll(tree, (p) => p['data-prefill-lib-filter'] === 'cards')[0].props.onClick()
  tree = page.render()
  assert.equal(findAll(tree, (p) => typeof p['data-prefill-lib-card'] === 'string').length, 1)
  assert.equal(findAll(tree, (p) => typeof p['data-prefill-lib-pack'] === 'string').length, 0)

  // 切回「全部」，触发删除 armed：ConfirmButton 切醒目红底反色字
  findAll(tree, (p) => p['data-prefill-lib-filter'] === 'all')[0].props.onClick()
  tree = page.render()
  findAll(tree, (p) => p['data-prefill-lib-pack-delete'] === '写作搭档')[0].props.onClick()
  tree = page.render()
  const armedDel = findAll(tree, (p) => p['data-prefill-lib-pack-delete'] === '写作搭档')[0]
  assert.equal(armedDel.props['data-prefill-armed'], 'true')
  assert.equal(armedDel.props.style.background, 'var(--dsw-alias-state-error-primary)')
  assert.equal(armedDel.props.style.color, 'var(--dsw-alias-bg-base)')
})

// ── 5. 偏好行 + 实验药丸开关 + 开发者虚线折页 / armed 限高 / 危险区红虚线 ─────

test('[M4-5] 偏好 Setting Row + 实验药丸 Toggle + 开发者虚线栏 / armed 240px 限高 + 危险区红虚线与红底确认', async () => {
  const page = await renderRealPage(makeManySessionsEnvelope(5))
  let tree = page.tree

  // 实验性功能总开关保留 role="switch" 且视觉改为药丸 Toggle（含轨道 + 圆点）
  const expSwitch = findAll(tree, (p) => p['data-prefill-experimental-toggle'] !== undefined)[0]
  assert.ok(expSwitch)
  assert.equal(expSwitch.props.role, 'switch')
  assert.equal(expSwitch.props.style.width, 38, '药丸 Toggle 轨道宽 38px')
  assert.equal(expSwitch.props.style.borderRadius, 11, '药丸 Toggle 轨道圆角')
  assert.equal(findAll(expSwitch, (_p, n) => n.type === 'span' && n.props.style?.borderRadius === 8).length, 1, '药丸 Toggle 内含圆点 knob')

  // 开发者折叠条：整宽虚线栏 + 旋转 chevron
  const devToggle = findAll(tree, (p) => p['data-prefill-dev-toggle'] !== undefined)[0]
  assert.match(String(devToggle.props.style.border ?? ''), /1px dashed/, '开发者折叠条使用 1px dashed 虚线框')
  assert.equal(devToggle.props.style.width, '100%', '开发者折叠条整宽')
  const chevClosed = findAll(devToggle, (p) => p['data-prefill-dev-chevron'] !== undefined)[0]
  assert.ok(chevClosed)
  assert.equal(chevClosed.props.style.transform, 'none')

  // 展开开发者区
  devToggle.props.onClick()
  tree = page.render()
  const chevOpen = findAll(tree, (p) => p['data-prefill-dev-chevron'] !== undefined)[0]
  assert.equal(chevOpen.props.style.transform, 'rotate(180deg)', '展开后 chevron 旋转 180deg')

  // armed 勾选表限高 maxHeight: 240; overflowY: 'auto'
  const armedList = findAll(tree, (p) => p['data-prefill-armed-list'] !== undefined)[0]
  assert.ok(armedList, '生效会话列表包在限高滚动容器内')
  assert.equal(armedList.props.style.maxHeight, 240)
  assert.equal(armedList.props.style.overflowY, 'auto')

  // 危险区（data-prefill-reset-card）红虚线框隔离 + ConfirmButton armed 切红底反色字
  const resetCard = findAll(tree, (p) => p['data-prefill-reset-card'] !== undefined)[0]
  assert.ok(resetCard)
  assert.match(String(resetCard.props.style.border ?? ''), /1px dashed .*state-error-primary\) 35%/, '危险区独立红虚线框 mix(error, 35)')
  findAll(resetCard, (p) => p['data-prefill-reset'] !== undefined)[0].props.onClick()
  tree = page.render()
  const resetArmedBtn = findAll(tree, (p) => p['data-prefill-reset'] !== undefined)[0]
  assert.equal(resetArmedBtn.props['data-prefill-armed'], 'true')
  assert.equal(resetArmedBtn.props.style.background, 'var(--dsw-alias-state-error-primary)', '危险区 ConfirmButton armed 切醒目红底')
  assert.equal(resetArmedBtn.props.style.color, 'var(--dsw-alias-bg-base)', '危险区 ConfirmButton armed 反色字')
})

// ── 6. summary.model：服务端 impl.js + 客户端两处 Popover 展示真实模型名 ──────

test('[M4-6] summary.model：服务端按活跃 agent > 最近路由 > null 输出顶层只读字段且不改 summary.ui', async () => {
  const HOME = mkdtempSync(join(tmpdir(), 'prefill-m4-model-'))
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = HOME
  try {
    mkdirSync(join(HOME, 'prefill'), { recursive: true })
    writeFileSync(join(HOME, 'prefill', 'state.json'), JSON.stringify({ version: 2, ui: { motion: 'lite', experimental: false } }), 'utf8')
    const impl = await import('../impl.js')
    assert.equal(typeof impl.sessionModelOf, 'function', '导出 sessionModelOf 纯函数')
    assert.equal(impl.sessionModelOf({ session: { requestHeader: () => ({ config: { model: 'deepseek-reasoner' } }) } }, { model: 'fallback-m' }), 'deepseek-reasoner')
    assert.equal(impl.sessionModelOf({ config: { model: 'deepseek-chat' } }, { model: 'fallback-m' }), 'deepseek-chat')
    assert.equal(impl.sessionModelOf(undefined, { model: 'deepseek-v3' }), 'deepseek-v3')
    assert.equal(impl.sessionModelOf(undefined, undefined), null)

    // 真实挂载路由验证 summaryOf(sessionId) 返回顶层 model 且不改 summary.ui 形状
    const routes = new Map()
    const handlers = new Map()
    const scope = {
      get: (name) => (name === 'connection' ? { fetch: { register: (def) => routes.set(def.path, def) } } : undefined),
      effect: (fn) => fn(),
    }
    impl.apply({
      effect: (fn) => {
        try {
          fn()
        } catch {}
      },
      on: (event, fn) => {
        if (!handlers.has(event)) handlers.set(event, [])
        handlers.get(event).push(fn)
      },
      inject: (_deps, cb) => cb(scope),
      logger: { info() {}, error() {} },
    })
    const summaryRoute = routes.get('/api/dsh-prefill/summary')
    const post = async (body) => JSON.parse(await (await summaryRoute.fetch({ json: async () => body })).text())

    // 无活跃 agent 且无路由记录 ⇒ model: null
    const empty = await post({ sessionId: 'sid-none' })
    assert.equal(empty.ok, true)
    assert.equal(empty.model, null)
    assert.deepEqual(empty.ui, { experimental: false, motion: 'lite' }, '绝不修改 summary.ui 形状')

    // 有 request/header 路由记录 ⇒ 返回路由模型
    for (const fn of handlers.get('session/event') ?? []) {
      await fn({ id: 'sid-routed' }, { type: 'request/header', data: { header: { config: { provider: 'deepseek', model: 'deepseek-chat' } } } })
    }
    const routed = await post({ sessionId: 'sid-routed' })
    assert.equal(routed.model, 'deepseek-chat')
    assert.deepEqual(routed.ui, { experimental: false, motion: 'lite' })

    // 有活跃 agent（优先于路由记录）⇒ 返回活跃 agent 模型
    for (const fn of handlers.get('agent/created') ?? []) {
      await fn({ agent: { id: 'sid-routed', session: { id: 'sid-routed', requestHeader: () => ({ config: { model: 'deepseek-reasoner' } }) } } })
    }
    const active = await post({ sessionId: 'sid-routed' })
    assert.equal(active.model, 'deepseek-reasoner')
  } finally {
    if (prevHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prevHome
    rmSync(HOME, { recursive: true, force: true })
  }
})

test('[M4-6] 客户端两处状态 Popover（卡片状态胶囊 + 顶栏 SessionModeBadge）消费 summary.model 展示真实模型名', async () => {
  const routes = {
    '/api/dsh-prefill/summary': () => ({
      ok: true,
      rev: 'r1',
      sessionId: 's1',
      model: 'deepseek-reasoner',
      prefill: { s1: 'default' },
      gate: {},
      activePreset: { s1: 'pack:甲' },
      turns: { s1: 1 },
      sandbox: { s1: { level: 'observe', levelFrom: 'default', blocked: 0 } },
      tools: { s1: 3 },
      ui: { experimental: false, motion: 'full' },
    }),
    '/api/dsh-prefill/state': () => ({
      ok: true,
      state: { prefill: { s1: 'default' }, gate: {}, activePreset: { s1: 'pack:甲' }, everyTurn: {}, ui: { motion: 'full' } },
      turns: { s1: 1 },
      materialized: {},
      sandboxView: { s1: { level: 'observe', levelFrom: 'default', blocked: 0 } },
      tools: { catalog: [], sessions: { s1: ['read', 'write', 'bash'] } },
    }),
    '/api/dsh-prefill/draft': () => ({ ok: true, draft: [] }),
    '/api/dsh-prefill/packs': () => ({ ok: true, packs: [{ name: '甲', count: 0 }], builtins: [], status: { enabled: false } }),
    '/api/dsh-prefill/cards': () => ({ ok: true, cards: [] }),
    '/api/dsh-prefill/usage': () => ({ ok: true }),
  }
  const env = loadClient({ routes })
  const h = env.React.createElement
  const el = () =>
    h(
      'div',
      null,
      h(env.components.PrefillToggle, { sessionId: 's1' }),
      h(env.components.PrefillDock, { sessionId: 's1' }),
      h(env.components.SessionModeBadge, { sessionId: 's1' }),
    )
  let tree = env.renderer.render(el())
  for (let i = 0; i < 4; i += 1) {
    await env.settle()
    tree = env.renderer.render(el())
  }
  // ① 打开卡片 + 点开状态胶囊 Popover
  findAll(tree, (p) => p['data-prefill-chip'] === '1')[0].props.onClick()
  for (let i = 0; i < 4; i += 1) {
    await env.settle()
    tree = env.renderer.render(el())
  }
  findAll(tree, (p) => p['data-prefill-status-pill'] === '')[0].props.onClick()
  await env.settle()
  tree = env.renderer.render(el())
  const statusPop = findAll(tree, (p) => p['data-prefill-menu'] === 'status')[0]
  assert.ok(statusPop, '打开卡片状态 Popover')
  assert.match(textOf(statusPop), /deepseek-reasoner/, '卡片状态 Popover 展示真实模型名')

  // ② 点开顶栏 SessionModeBadge Popover
  findAll(tree, (p) => typeof p['data-prefill-header-badge'] === 'string')[0].props.onClick()
  await env.settle()
  tree = env.renderer.render(el())
  const headerPop = findAll(tree, (p) => p['data-prefill-header-popover'] === '1')[0]
  assert.ok(headerPop, '打开顶栏徽标 Popover')
  assert.match(textOf(headerPop), /deepseek-reasoner/, '顶栏徽标 Popover 展示真实模型名')
})

// ── 7. 静态红线：唯一 scrollMarginTop、切片边界、settings-harness 兼容 ────────

test('[M4-7] 红线自检：唯一 scrollMarginTop、PrefillSection 4 空格切片边界、settings-harness 正常渲染', async () => {
  const margins = [...clientSrc.matchAll(/scrollMarginTop:\s*\d+/g)]
  assert.equal(margins.length, 1, '全文件只能有 1 处 scrollMarginTop')
  assert.ok(clientSrc.includes('    function PrefillSection(props) {'))
  assert.ok(clientSrc.includes('    /** DSH 左侧栏那一行 + 主区设置页共用的 panel id'))

  const h = makeSettingsHarness(makeManySessionsEnvelope(12), { routes: makeLibRoutes() })
  h.render()
  await h.settle()
  h.render()
  await h.settle()
  const tree = h.render()
  assert.equal(h.find(tree, (p) => typeof p['data-prefill-overview-row'] === 'string').length, 10)
  assert.equal(h.find(tree, (p) => p['data-prefill-overview-pagination'] !== undefined).length, 1)
})
