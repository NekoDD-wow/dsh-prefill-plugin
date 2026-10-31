// 动效第 3 步「可见性」（docs/规划-动效.md §4.1）：P0-1 头部错误 pill、P0-2 busy(key) 忙碌态 + 开关乐观更新、
// P0-3 新积木滚入视野 + 入场 + 高亮、P1-8 toast 入场退场 / 不挡操作 / aria-live。
// 照 tests/motion.test.mjs 的做法：把 client.js 的 <motion> + <feedback> 两段切出来配假 window 直接跑。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { makeHarness } from './sandbox-harness.mjs'
import { sandboxView } from '../sandbox-view.js'
import { migrateSandbox } from '../sandbox.js'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
// 找不到就给空串：改前（没有 <feedback> 段）每一项各自失败，而不是整个文件加载失败。
const cut = (from, to) => {
  const a = src.indexOf(from)
  const b = src.indexOf(to, a)
  return a >= 0 && b > a ? src.slice(a, b) : ''
}
const motionSrc = cut('// <motion>', '// </motion>')
const feedbackSrc = cut('// <feedback>', '// </feedback>')
const dockSrc = cut('    function PrefillDock(props) {', '    function UsagePanel(props) {')

class FakeEvent {
  constructor(type, init) {
    this.type = type
    this.detail = init?.detail
  }
}
function fakeWindow() {
  const events = []
  return {
    events,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    dispatchEvent(event) {
      events.push(event)
      return true
    },
  }
}
function load(win = fakeWindow()) {
  // eslint-disable-next-line no-new-func
  const M = new Function(
    'window',
    'CustomEvent',
    `${motionSrc}\n${feedbackSrc}\nreturn { MOTION, setMotionPref, motionLevel, play, BUSY_DELAY, createBusy, errorDetail, errorsReduce, ERROR_EVENT, reportError, reportOk, optimistic, nearestScrollTop, toastPlace, revealBlock, PILL_ENTER, PILL_EXIT, TOAST_ENTER, TOAST_EXIT, BLOCK_ENTER, BLOCK_GLOW, SHAKE, SPIN }`,
  )(win, FakeEvent)
  return { M, win }
}
/** 假元素：记下每次 animate；finished 永不落定（这里只看调没调、调的什么）。 */
function fakeEl() {
  const calls = []
  return {
    calls,
    style: { willChange: '' },
    animate(frames, timing) {
      const anim = { frames, timing, finished: new Promise(() => {}), cancel() {} }
      calls.push(anim)
      return anim
    },
  }
}
/** 手动推进的计时器。 */
function fakeTimers() {
  let now = 0
  let seq = 0
  const queue = new Map()
  return {
    setTimer(fn, ms) {
      seq += 1
      queue.set(seq, { fn, at: now + ms })
      return seq
    },
    clearTimer(id) {
      queue.delete(id)
    },
    advance(ms) {
      now += ms
      for (const [id, job] of [...queue]) {
        if (job.at <= now) {
          queue.delete(id)
          job.fn()
        }
      }
    },
    get size() {
      return queue.size
    },
  }
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

test('busy(key)：快于 150ms 不显示忙碌（不闪）；慢于 150ms 才显示；结束即撤', () => {
  const { M } = load()
  assert.equal(M.BUSY_DELAY, 150)
  const timers = fakeTimers()
  let changes = 0
  const busy = M.createBusy({ onChange: () => (changes += 1), setTimer: timers.setTimer, clearTimer: timers.clearTimer })
  // 快：149ms 内结束 ⇒ 从头到尾 shown = false
  const fast = busy.start('save')
  assert.equal(busy.pending('save'), true, '一点下去就算进行中（挡重复点击）')
  assert.equal(busy.shown('save'), false)
  timers.advance(149)
  assert.equal(busy.shown('save'), false)
  fast()
  assert.equal(busy.pending('save'), false)
  timers.advance(500)
  assert.equal(busy.shown('save'), false, '结束后计时器作废，不会迟到地亮起来')
  assert.equal(timers.size, 0)
  // 慢：到 150ms 显示，结束撤掉
  const slow = busy.start('save')
  timers.advance(150)
  assert.equal(busy.shown('save'), true)
  slow()
  assert.equal(busy.shown('save'), false)
  assert.equal(busy.pending('save'), false)
  // done 只生效一次；不同 key 互不影响；anyPending 按前缀
  slow()
  const a = busy.start('apply:builtin:zh')
  assert.equal(busy.anyPending('apply:'), true)
  assert.equal(busy.pending('save'), false)
  a()
  assert.equal(busy.anyPending('apply:'), false)
  assert.ok(changes >= 4, '开始 / 显示 / 结束都通知重渲染')
})

test('busy.run：进行中再点 ⇒ 返回 null、不重复调用；成功 / 失败都结束；失败照样抛出', async () => {
  const { M } = load()
  const busy = M.createBusy()
  let calls = 0
  let release
  const first = busy.run('toggle', () => {
    calls += 1
    return new Promise((resolve) => (release = resolve))
  })
  assert.ok(first && typeof first.then === 'function')
  assert.equal(busy.run('toggle', () => (calls += 1)), null, '重复点击被忽略')
  assert.equal(calls, 1)
  release('ok')
  assert.equal(await first, 'ok')
  assert.equal(busy.pending('toggle'), false)
  // 失败：抛出原错误，状态清掉
  const failing = busy.run('toggle', async () => {
    throw new Error('HTTP 500')
  })
  await assert.rejects(failing, /HTTP 500/)
  assert.equal(busy.pending('toggle'), false)
  assert.equal(busy.shown('toggle'), false)
  // fn 同步抛错也算失败
  await assert.rejects(busy.run('x', () => {
    throw new Error('sync')
  }), /sync/)
  assert.equal(busy.pending('x'), false)
  // 真实计时：慢操作中途 shown，快操作从不 shown
  const real = M.createBusy()
  const slow = real.run('slow', () => new Promise((resolve) => setTimeout(resolve, 230)))
  const quick = real.run('quick', () => new Promise((resolve) => setTimeout(resolve, 40)))
  await new Promise((resolve) => setTimeout(resolve, 190))
  assert.equal(real.shown('slow'), true)
  assert.equal(real.shown('quick'), false)
  await Promise.all([slow, quick])
  assert.equal(real.shown('slow'), false)
})

test('开关乐观更新：先按新值显示；失败 ⇒ 回弹到原状态并报错；成功 ⇒ 停在服务端返回的新状态', async () => {
  const { M } = load()
  // 模拟面板：stored = 服务端状态，override = 乐观值；显示 = override ?? stored
  const panel = (stored) => {
    const ui = { stored, override: undefined, shown: [] }
    ui.view = () => (ui.override !== undefined ? ui.override : ui.stored)
    return ui
  }
  const busy = M.createBusy()
  const ui = panel(true)
  const errors = []
  let release
  const done = M.optimistic({
    apply: () => {
      ui.override = false
      ui.shown.push(ui.view())
    },
    commit: () => busy.run('enable:workspace', () => new Promise((_, reject) => (release = reject))),
    settle: () => {
      ui.override = undefined
    },
    onError: (err) => errors.push(M.errorDetail(err)),
  })
  assert.deepEqual(ui.shown, [false], '点下去立刻显示成关')
  assert.equal(ui.view(), false)
  release(new Error('HTTP 500'))
  assert.equal(await done, false)
  assert.equal(ui.view(), true, '失败：回到原状态（不停在看起来成功的样子）')
  assert.deepEqual(errors, ['HTTP 500'])
  // 成功：服务端已改成新值，撤掉乐观值后仍是新值
  const ok = panel(true)
  let okCalled = 0
  const result = await M.optimistic({
    apply: () => (ok.override = false),
    commit: () =>
      busy.run('enable:workspace', async () => {
        ok.stored = false
        return { ok: true }
      }),
    settle: () => (ok.override = undefined),
    onOk: () => (okCalled += 1),
    onError: () => assert.fail('不该报错'),
  })
  assert.equal(result, true)
  assert.equal(ok.view(), false)
  assert.equal(okCalled, 1)
  // 进行中再点（commit 返回 null）：乐观值撤掉，什么都不发
  let hold
  const pending = busy.run('enable:system', () => new Promise((resolve) => (hold = resolve)))
  const again = panel(true)
  assert.equal(await M.optimistic({ apply: () => (again.override = false), commit: () => busy.run('enable:system', () => assert.fail('不该再发')), settle: () => (again.override = undefined) }), null)
  assert.equal(again.view(), true)
  hold()
  await pending
})

test('错误 pill 状态：哪个操作失败 / 同一操作再失败计数 / 后来成功收起 / 展开详情 / 关闭', () => {
  const { M } = load()
  let s = M.errorsReduce(null, { type: 'fail', key: 'enable:workspace', op: '「工作区说明」开关', detail: 'HTTP 500', at: 1 })
  assert.deepEqual(s, { key: 'enable:workspace', op: '「工作区说明」开关', detail: 'HTTP 500', at: 1, count: 1, open: false })
  s = M.errorsReduce(s, { type: 'toggle' })
  assert.equal(s.open, true)
  s = M.errorsReduce(s, { type: 'fail', key: 'enable:workspace', op: '「工作区说明」开关', detail: 'HTTP 502', at: 2 })
  assert.equal(s.count, 2, '同一操作再失败 ⇒ ×2')
  assert.equal(s.detail, 'HTTP 502')
  assert.equal(s.open, true, '展开着的详情保留')
  assert.equal(M.errorsReduce(s, { type: 'ok', key: 'save' }), s, '别的操作成功不碰')
  assert.equal(M.errorsReduce(s, { type: 'ok', key: 'enable:workspace' }), null, '同一操作后来成功 ⇒ 收起')
  const other = M.errorsReduce(s, { type: 'fail', key: 'save', op: '保存预设', detail: 'Failed to fetch' })
  assert.equal(other.key, 'save')
  assert.equal(other.count, 1)
  assert.equal(other.open, false)
  assert.equal(M.errorsReduce(other, { type: 'close' }).open, false)
  assert.equal(M.errorsReduce(other, { type: 'dismiss' }), null)
  assert.equal(M.errorsReduce(null, { type: 'toggle' }), null)
  assert.equal(M.errorsReduce(undefined, { type: 'nothing' }), null)
  // 原因：Error / 字符串 / 服务端 reason / 没有
  assert.equal(M.errorDetail(new Error('HTTP 500')), 'HTTP 500')
  assert.equal(M.errorDetail('bad'), 'bad')
  assert.equal(M.errorDetail({ reason: 'locked' }), 'locked')
  assert.equal(M.errorDetail(null), '')
})

test('上报走窗口事件：reportError / reportOk 带会话、key、操作名、原因', () => {
  const { M, win } = load()
  M.reportError('s1', 'level', '切换沙盒档位', new Error('HTTP 500'))
  M.reportOk('s1', 'level')
  assert.deepEqual(win.events.map((e) => e.type), [M.ERROR_EVENT, M.ERROR_EVENT])
  const [fail, ok] = win.events.map((e) => e.detail)
  assert.equal(fail.type, 'fail')
  assert.equal(fail.sessionId, 's1')
  assert.equal(fail.key, 'level')
  assert.equal(fail.op, '切换沙盒档位')
  assert.equal(fail.detail, 'HTTP 500')
  assert.ok(fail.at > 0)
  assert.deepEqual(ok, { sessionId: 's1', type: 'ok', key: 'level' })
  // 事件的 detail 直接喂给 reducer
  assert.equal(M.errorsReduce(M.errorsReduce(null, fail), ok), null)
})

test('off：pill / toast / 新积木 / 高亮 / 转圈 / 回弹 都不调 animate；新积木照样滚到看得见（直接跳）', () => {
  const { M } = load()
  M.setMotionPref('off')
  const el = fakeEl()
  for (const [frames, opts] of [
    [M.PILL_ENTER, {}],
    [M.PILL_EXIT, { fill: 'forwards' }],
    [M.TOAST_ENTER, {}],
    [M.TOAST_EXIT, {}],
    [M.BLOCK_ENTER, {}],
    [M.BLOCK_GLOW, {}],
    [M.SHAKE, { kind: 'move' }],
    [M.SPIN, { kind: 'decor', iterations: Infinity }],
  ])
    assert.equal(M.play(el, frames, { duration: 180, ...opts }), null)
  assert.equal(el.calls.length, 0)
  // revealBlock：off 下不平滑滚动、不入场，但 scrollTop 照样到位
  const view = { scrollTop: 100, getBoundingClientRect: () => ({ top: 0, bottom: 400, height: 400 }), scrollTo: () => assert.fail('off 不平滑滚动') }
  const node = { ...fakeEl(), getBoundingClientRect: () => ({ top: 500, bottom: 560, height: 60 }) }
  assert.equal(M.revealBlock(view, node), null)
  assert.equal(view.scrollTop, 100 + 560 - 392)
  assert.equal(node.calls.length, 0)
})

test('简洁：只淡入淡出——pill / toast / 新积木没有位移；回弹（move）与转圈（decor）不播；高亮照样淡入淡出', () => {
  const { M } = load()
  M.setMotionPref('lite')
  const el = fakeEl()
  for (const frames of [M.PILL_ENTER, M.TOAST_ENTER, M.TOAST_EXIT, M.BLOCK_ENTER]) {
    const anim = M.play(el, frames, { duration: 180, easing: M.MOTION.ease })
    assert.ok(anim)
    assert.doesNotMatch(JSON.stringify(anim.frames), /transform|translate/)
    assert.deepEqual(anim.frames.map((f) => Object.keys(f)), [['opacity'], ['opacity']])
  }
  const before = el.calls.length
  assert.equal(M.play(el, M.SHAKE, { duration: 180, kind: 'move' }), null)
  assert.equal(M.play(el, M.SPIN, { duration: 700, kind: 'decor', iterations: Infinity }), null)
  assert.equal(el.calls.length, before)
  const glow = M.play(el, M.BLOCK_GLOW, { duration: 1000 })
  assert.deepEqual(glow.frames.map((f) => f.opacity), [0, 1, 1, 0])
  // 新积木：直接跳到位（不平滑），入场只有透明度
  const view = { scrollTop: 0, getBoundingClientRect: () => ({ top: 0, bottom: 300, height: 300 }), scrollTo: () => assert.fail('简洁不平滑滚动') }
  const node = { ...fakeEl(), getBoundingClientRect: () => ({ top: 320, bottom: 380, height: 60 }) }
  const enter = M.revealBlock(view, node)
  assert.equal(view.scrollTop, 380 - 292)
  assert.deepEqual(enter.frames, [{ opacity: 0 }, { opacity: 1 }])
})

test('完整：pill 淡入 + 上移 4px；新积木 translateY(-6px) 入场并平滑滚动；回弹左右 3px；只动 transform / opacity', () => {
  const { M } = load()
  M.setMotionPref('full')
  assert.deepEqual(M.PILL_ENTER, [{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }])
  assert.deepEqual(M.SHAKE.map((f) => f.transform), ['none', 'translateX(-3px)', 'translateX(3px)', 'none'])
  for (const frames of [M.PILL_ENTER, M.PILL_EXIT, M.TOAST_ENTER, M.TOAST_EXIT, M.BLOCK_ENTER, M.BLOCK_GLOW, M.SHAKE, M.SPIN])
    for (const frame of frames) for (const key of Object.keys(frame)) assert.ok(['opacity', 'transform', 'offset'].includes(key), key)
  const scrolls = []
  const view = { scrollTop: 50, getBoundingClientRect: () => ({ top: 100, bottom: 500, height: 400 }), scrollTo: (opts) => scrolls.push(opts) }
  const node = { ...fakeEl(), getBoundingClientRect: () => ({ top: 600, bottom: 650, height: 50 }) }
  const enter = M.revealBlock(view, node)
  assert.deepEqual(scrolls, [{ top: 50 + 650 - 492, behavior: 'smooth' }])
  assert.deepEqual(enter.frames, M.BLOCK_ENTER)
  assert.equal(enter.timing.duration, M.MOTION.base)
  // 已经看得见：不滚
  const visible = { scrollTop: 0, getBoundingClientRect: () => ({ top: 0, bottom: 500, height: 500 }), scrollTo: () => assert.fail('看得见就不滚') }
  M.revealBlock(visible, { ...fakeEl(), getBoundingClientRect: () => ({ top: 100, bottom: 160, height: 60 }) })
})

test('nearestScrollTop / toastPlace 纯函数', () => {
  const { M } = load()
  const view = { top: 100, bottom: 500, height: 400 }
  assert.equal(M.nearestScrollTop(view, { top: 200, bottom: 260, height: 60 }, 30), null, '在视野里不动')
  assert.equal(M.nearestScrollTop(view, { top: 520, bottom: 580, height: 60 }, 30), 30 + 580 - 492, '在下面 ⇒ 底对齐')
  assert.equal(M.nearestScrollTop(view, { top: 40, bottom: 100, height: 60 }, 300), 300 + 40 - 108, '在上面 ⇒ 顶对齐')
  assert.equal(M.nearestScrollTop(view, { top: 520, bottom: 1520, height: 1000 }, 0), 412, '比视野高 ⇒ 顶对齐')
  assert.equal(M.nearestScrollTop(view, { top: 0, bottom: 50, height: 50 }, 10), 0, '不小于 0')
  assert.equal(M.nearestScrollTop(null, view, 0), null)
  // toast：卡片 (left 100, top 200, 900×700)；内容区从 260 开始
  const card = { left: 100, top: 200, right: 1000, bottom: 900, width: 900, height: 700 }
  const area = { top: 260 }
  // 内容区中间的按钮 ⇒ 放在它上方、右边对齐
  assert.deepEqual(M.toastPlace(card, { top: 600, bottom: 628, right: 940 }, area), { right: 60, bottom: 900 - 600 + 6 })
  // 头部 / 内容区顶部的按钮 ⇒ 上面放不下，放下方
  assert.deepEqual(M.toastPlace(card, { top: 210, bottom: 238, right: 400 }, area), { right: 600, top: 238 - 200 + 6 })
  // 右边距至少 10、最多让 toast 留在卡片里
  assert.equal(M.toastPlace(card, { top: 600, bottom: 628, right: 1100 }, area).right, 10)
  assert.equal(M.toastPlace(card, { top: 600, bottom: 628, right: 120 }, area).right, 900 - 140)
  // 触发点不在卡片里 / 没有 ⇒ null（底部居中兜底）
  assert.equal(M.toastPlace(card, { top: 950, bottom: 980, right: 500 }, area), null)
  assert.equal(M.toastPlace(card, null, area), null)
})

test('面板接线：错误 pill 在头部、失败都报给 pill、开关乐观 + busy、toast 不挡操作、新积木 reveal、芯片 / 沙盒档位忙碌态', () => {
  // P0-1：pill 在头部（不在某一节里），所以所有节都看得见；外层常驻 aria-live
  const header = cut('      const header = h(', '      // 错误详情（P0-1）')
  assert.match(header, /h\(ErrorPill, \{\s*t,\s*error,\s*onToggle: /)
  // 出现时占住 token 读数徽章的位置（不另起一项，头部不折行）
  assert.match(header, /fallback: \[\s*badge\('var\(--pf-system\)', t\('badgeFirst'\)/)
  assert.match(src, /'aria-live': 'assertive', 'aria-atomic': 'true', 'data-prefill-error-live': ''/)
  assert.match(src, /'data-prefill-error-detail': error\.key/)
  // 面板里没有只写 meta 小字的失败处理了：全部经 failed() → reportError
  assert.doesNotMatch(dockSrc, /\.catch\(\(\) => setStatus\('error'\)\)/)
  assert.ok((dockSrc.match(/\.catch\(failed\(/g) ?? []).length >= 30)
  assert.match(dockSrc, /reportError\(sessionId, key, op \?\? t\('errOpSync'\), err\)/)
  assert.match(dockSrc, /window\.addEventListener\(ERROR_EVENT, onError\)/)
  // P0-2：开关 = 乐观更新 + busy；失败回弹（SHAKE 是位移类）
  const sw = cut('      const switchEl = (key, color) => {', '      const navItem = (key, paneId, color, parent) => {')
  assert.match(sw, /\.\.\.busyAttrs\(busyCtl, busyKey\)/)
  assert.match(sw, /if \(busyCtl\.pending\(busyKey\)\) return/)
  assert.match(sw, /void optimistic\(\{/)
  assert.match(sw, /commit: \(\) => busyCtl\.run\(busyKey, \(\) => writeEnabled\(key, next\)\)/)
  assert.match(sw, /play\(node, SHAKE, \{ duration: MOTION\.base, easing: MOTION\.ease, kind: 'move' \}\)/)
  assert.match(dockSrc, /const isOn = \(key\) => \(Object\.hasOwn\(optimisticOn, key\) \? optimisticOn\[key\] === true : isOnStored\(key\)\)/)
  // 保存 / 另存为 / 套预设 / 取消预设 / 撤销 都走 act()（busy + 失败报错）
  for (const re of [/act\('save', t\('errOpSave'\)/, /act\('saveas', t\('errOpSaveAs'\)/, /actApply\(`builtin:\$\{preset\.id\}`/, /actApply\(`pack:\$\{pack\.name\}`/, /actApply\(`card:\$\{card\.id\}`/, /act\('clear', t\('errOpClear'\), clearPreset\)/, /act\('undo', t\('errOpUndo'\), undoClearPreset\)/])
    assert.match(dockSrc, re)
  assert.match(dockSrc, /if \(busyCtl\.anyPending\('apply:'\)\) return/)
  // 转圈是装饰类（只有完整档转）
  assert.match(src, /play\(el, SPIN, \{ duration: 700, iterations: Infinity, easing: 'linear', kind: 'decor' \}\)/)
  // 芯片首次打开：busy + 失败在芯片上说明 + 报错
  const chip = cut('    function PrefillToggle(props) {', '    function fallbackName(')
  assert.match(chip, /chipBusy\.run\('open', \(\) => call\(\{ prefill:/)
  assert.match(chip, /reportError\(sessionId, 'chip', t\('errOpChip'\), err\)/)
  assert.match(chip, /'aria-pressed': on \|\| opening \? 'true' : 'false'/)
  assert.doesNotMatch(chip, /\.catch\(\(\) => \{\}\)\s*return\s*\}\s*setCardOpen/)
  // P0-3：加积木 ⇒ 记下 key，挂上后 revealBlock（只滚卡片内容区）+ 高亮层
  assert.match(dockSrc, /revealRef\.current = key\s*setJustAdded\(key\)\s*setBench\(\[\.\.\.bench, benchBlockOf\(block, key\)\]\)/)
  assert.match(dockSrc, /const view = node\.closest\('\[data-prefill-main\]'\)\s*\/\/[^\n]*\n\s*revealBlock\(view, node, \(target\) => \{/)
  // 随后的 toast 贴着新块滚完之后的位置（触发按钮可能已经滚走）
  assert.match(dockSrc, /revealed\.at >= trigger\.at/)
  assert.match(dockSrc, /justAdded === block\.key \? h\(BlockGlow, \{ key: 'glow' \}\) : null/)
  // P1-8：toast presence + 贴着触发点 + 不接收点击；读屏用常驻 polite 区域
  assert.match(dockSrc, /h\(Toast, \{ text: toast, place: toastAt \}\)/)
  assert.match(dockSrc, /role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true', 'data-prefill-toast-live': ''/)
  const toast = cut('    function Toast(props) {', '    /** 新积木的高亮描边层')
  assert.match(toast, /usePresence\(text, TOAST_ENTER, TOAST_EXIT\)/)
  assert.equal((toast.match(/pointerEvents: 'none'/g) ?? []).length, 2)
  assert.doesNotMatch(dockSrc, /position: 'absolute', right: 14, bottom: 10, zIndex: 6/, '旧的右下角固定 toast 去掉了')
  assert.match(dockSrc, /if \(menu !== ''\) setToast\(''\)/, '打开菜单时收掉旧 toast（不叠在菜单上）')
  // 沙盒档位：busy + 失败报给 pill
  const sbx = cut('    function SandboxSection(props) {', '    function InjectionSection(props) {')
  assert.match(sbx, /busy\.run\('level', \(\) => writeSandbox\(levelMutate\(next\), 'level', t\('errOpLevel'\)\)\)/)
  assert.match(sbx, /reportError\(sessionId, key, op \?\? t\('errOpSandbox'\), error\)/)
  // 文案 zh / en 各一份
  for (const key of ['errPill', 'errDismiss', 'errDetailWhat', 'errOpToggle', 'errOpSave', 'errOpLevel', 'errOpChip', 'chipOpenFailed']) assert.equal(src.match(new RegExp(`\\b${key}:`, 'g'))?.length, 2, key)
})

test('会话沙盒页：切档位进行中再点被忽略；成功报 ok（收起同一操作的错误 pill）', async () => {
  const SID = 'sess-vis'
  const sources = () => ({ injections: { sessions: {} }, registry: {} })
  const envelope = (state) => ({ state, sandboxView: { [SID]: sandboxView(migrateSandbox(state), SID, sources()) }, injections: sources().injections })
  let ui
  try {
    ui = makeHarness(envelope({ sandbox: {} }), { sid: SID, sources })
  } catch (error) {
    assert.fail(`harness: ${error.message}`)
  }
  const tree = ui.render()
  const [controlled] = ui.find(tree, (props) => props['data-prefill-sbx-option'] === 'controlled')
  controlled.props.onClick()
  controlled.props.onClick()
  await ui.settle()
  await tick()
  assert.equal(ui.posts.length, 1, '进行中第二下被忽略')
  assert.equal(ui.posts[0].sandbox[SID].level, 'controlled')
  assert.ok(ui.errors.some((e) => e.type === 'ok' && e.key === 'level'))
  assert.equal(ui.mod.busyCtl.pending('level'), false)
})
