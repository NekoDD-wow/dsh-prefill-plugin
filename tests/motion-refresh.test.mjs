// 动效第 4 步「刷」（docs/规划-动效.md §4.2 / §5）：流式 busy 队列、P0-4 连带变化扫光、P1-4 撤销条、
// P1-9 后台状态变化提示、P2-3 数字滚动、P2-4 来源标签闪。
// 照 tests/motion-visibility.test.mjs 的做法：把 client.js 的 <motion> + <feedback> + <refresh> 段切出来配假 window 直接跑。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
// 找不到就给空串：改前（没有 <refresh> 段）每一项各自失败，而不是整个文件加载失败。
const cut = (from, to) => {
  const a = src.indexOf(from)
  const b = src.indexOf(to, a)
  return a >= 0 && b > a ? src.slice(a, b) : ''
}
const motionSrc = cut('// <motion>', '// </motion>')
const feedbackSrc = cut('// <feedback>', '// </feedback>')
const refreshSrc = cut('// <refresh>', '// </refresh>')
const dockSrc = cut('    function PrefillDock(props) {', '    function UsagePanel(props) {')
const chipSrc = cut('    function PrefillToggle(props) {', '    function fallbackName(')

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
const NAMES = [
  'MOTION', 'setMotionPref', 'motionLevel', 'play', 'flushCues', 'pendingCues', 'STREAM_BUSY', 'CUE_MAX', 'CUE_STAGGER',
  'navSignature', 'diffSigs', 'linkedText', 'nodeText', 'changeCause', 'CAUSE_MS', 'CUE_SETTLE_MS', 'BADGE_FLASH', 'NAV_FLASH', 'DOT_FLASH', 'SWEEP', 'flashOrSweep',
  'UNDO_MS', 'undoLeft', 'UNDO_ENTER', 'UNDO_EXIT', 'UNDO_COUNTDOWN', 'rollFrames', 'rollDir', 'FLASH_MS', 'SOURCE_FLASH',
]
function load(win = fakeWindow()) {
  const body = `${motionSrc}\n${feedbackSrc}\n${refreshSrc}\nreturn { ${NAMES.map((n) => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ')} }`
  // eslint-disable-next-line no-new-func
  const M = new Function('window', 'CustomEvent', body)(win, FakeEvent)
  return { M, win }
}
/** 假的根节点（卡片 / 标记 / 芯片）：data-prefill-busy 可以改。 */
function fakeRoot(busy = undefined) {
  const attrs = { 'data-prefill-busy': busy }
  return {
    isConnected: true,
    attrs,
    getAttribute: (name) => attrs[name] ?? null,
    set busy(value) {
      attrs['data-prefill-busy'] = value
    },
  }
}
/** 假元素：记下每次 animate；closest 找挂着的根节点（只认 stream 这个值）。 */
function fakeEl(root = null) {
  const calls = []
  return {
    calls,
    isConnected: true,
    style: { willChange: '' },
    closest(selector) {
      if (root === null) return null
      const want = /data-prefill-busy="([^"]+)"/.exec(selector)?.[1]
      return want !== undefined && root.getAttribute('data-prefill-busy') === want ? root : null
    },
    animate(frames, timing) {
      const anim = { frames, timing, finished: new Promise(() => {}), cancel() {} }
      calls.push(anim)
      return anim
    },
  }
}
const props = (frames) => new Set(frames.flatMap((frame) => Object.keys(frame).filter((key) => !['offset', 'easing', 'composite', 'transformOrigin'].includes(key))))

// ── 0. 流式 busy 队列 ──────────────────────────────────────────────────────────

test('流式中：自动提示（cue auto）和装饰类排队，不调 animate；按压 / 直接反馈照常播', () => {
  const { M } = load()
  M.setMotionPref('full')
  assert.equal(M.STREAM_BUSY, 'stream')
  const root = fakeRoot('stream')
  const badge = fakeEl(root)
  const sweep = fakeEl(root)
  const enter = fakeEl(root)
  const press = fakeEl(root)
  assert.equal(M.play(badge, [{ opacity: 0.13 }, { opacity: 0.35 }, { opacity: 0.13 }], { duration: 520, cue: 'auto' }), null)
  assert.equal(M.play(sweep, [{ transform: 'translateX(-100%)' }, { transform: 'translateX(260%)' }], { duration: 260, kind: 'decor' }), null)
  assert.equal(badge.calls.length + sweep.calls.length, 0, '自动提示 / 扫光攒着')
  assert.equal(M.pendingCues(), 2)
  assert.ok(M.play(enter, [{ opacity: 0 }, { opacity: 1 }], { duration: 180 }), '用户点出来的入场照播')
  assert.ok(M.play(press, [{ transform: 'scale(.96)' }, { transform: 'none' }], { duration: 120, kind: 'decor', cue: 'press' }), '按压反馈照播')
  assert.equal(enter.calls.length + press.calls.length, 2)
  // 按钮自己的忙碌态（data-prefill-busy="true"）不算流式
  const btnRoot = fakeRoot('true')
  const b = fakeEl(btnRoot)
  assert.ok(M.play(b, [{ opacity: 0.13 }, { opacity: 0.35 }], { duration: 520, cue: 'auto' }))
  // 不在输出：自动提示直接播
  const idle = fakeEl(fakeRoot(undefined))
  assert.ok(M.play(idle, [{ opacity: 0.13 }, { opacity: 0.35 }], { duration: 520, cue: 'auto' }))
})

test('回合结束：最多 3 个、依次错开 60ms；同一处去重；已卸载的跳过；还在输出的根节点不放', () => {
  const { M } = load()
  M.setMotionPref('full')
  assert.equal(M.CUE_MAX, 3)
  assert.equal(M.CUE_STAGGER, 60)
  const root = fakeRoot('stream')
  const els = Array.from({ length: 5 }, () => fakeEl(root))
  for (const el of els) M.play(el, [{ opacity: 0.13 }, { opacity: 0.35 }, { opacity: 0.13 }], { duration: 520, cue: 'auto' })
  // 同一个元素又排一次：只留最后一次
  M.play(els[0], [{ opacity: 0.13 }, { opacity: 0.5 }, { opacity: 0.13 }], { duration: 520, cue: 'auto' })
  assert.equal(M.pendingCues(), 5)
  // 还在输出 ⇒ flush 什么都不放
  assert.deepEqual(M.flushCues(), [])
  assert.equal(M.pendingCues(), 5)
  root.busy = undefined
  els[1].isConnected = false
  const played = M.flushCues()
  assert.equal(played.length, 3, '最多 3 个')
  assert.deepEqual(played.map((a) => a.timing.delay), [0, 60, 120])
  assert.equal(els[1].calls.length, 0, '卸载了的不播')
  assert.equal(els[0].calls.length, 0, 'els[0] 去重后排在最后')
  assert.equal(M.pendingCues(), 0, '其余丢掉，不留到下一回合')
  for (const anim of played) assert.equal(anim.timing.cue, undefined, 'cue / cueKey / prio 不传给 WAAPI')
  // prio 高的先
  const r2 = fakeRoot('stream')
  const low = fakeEl(r2)
  const high = fakeEl(r2)
  M.play(low, [{ opacity: 0 }, { opacity: 1 }], { duration: 100, cue: 'auto' })
  M.play(high, [{ opacity: 0 }, { opacity: 1 }], { duration: 100, cue: 'auto', prio: 2 })
  r2.busy = undefined
  const order = M.flushCues()
  assert.equal(order[0], high.calls[0])
  assert.equal(order[1], low.calls[0])
})

test('defer：回合结束这一刻才出现的变化也进队列，和攒着的一起按 3 个上限放；off 档不排队', () => {
  const { M } = load()
  M.setMotionPref('full')
  const els = Array.from({ length: 4 }, () => fakeEl(null))
  for (const el of els) assert.equal(M.play(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 100, cue: 'auto', defer: true }), null)
  assert.equal(M.flushCues().length, 3)
  M.setMotionPref('off')
  const root = fakeRoot('stream')
  const el = fakeEl(root)
  assert.equal(M.play(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 100, cue: 'auto' }), null)
  assert.equal(M.pendingCues(), 0, 'off 档：不动画也不排队')
  root.busy = undefined
  assert.deepEqual(M.flushCues(), [])
  assert.equal(el.calls.length, 0)
})

test('面板接线：卡片根节点 / 标记 / 芯片在输出时标 data-prefill-busy="stream"；跑完 flushCues；宿主 envelope 带 running', () => {
  assert.match(dockSrc, /'data-prefill-busy': streaming \? STREAM_BUSY : undefined/)
  assert.ok((dockSrc.match(/'data-prefill-busy': streaming \? STREAM_BUSY/g) ?? []).length >= 2, '卡片 + 标记')
  assert.match(dockSrc, /envelope\?\.running/)
  assert.match(dockSrc, /if \(ended\) flushCues\(\)/)
  assert.match(chipSrc, /chipStreaming \? STREAM_BUSY/)
  assert.match(chipSrc, /if \(ended\) flushCues\(\)/)
  const impl = readFileSync(new URL('../impl.js', import.meta.url), 'utf8')
  assert.match(impl, /running: \[\.\.\.liveAgents\]\.filter\(\(\[, agent\]\) => isRunning\(agent\)\)/)
})

// ── 1. P0-4 连带变化：状态签名对比 + 扫光 + toast ─────────────────────────────

/** 假的左栏项：里面有扫光带和底色闪层。 */
function fakeNavHost(root = null) {
  const band = fakeEl(root)
  const layer = fakeEl(root)
  return {
    band,
    layer,
    querySelector: (sel) => (sel === '[data-prefill-sweep-band]' ? band : sel === '[data-prefill-flash]' ? layer : null),
  }
}
const el = (children) => ({ props: { children } })

test('状态签名：状态行文字（摊平 React 子节点）+ 开关 + 随角色卡停用；只标出变了的项', () => {
  const { M } = load()
  assert.equal(M.nodeText(['', el('唐团团'), ' · ', el(['纯角色扮演', 3]), null, false]), '唐团团 · 纯角色扮演3')
  const keys = ['card', 'system', 'everyTurn', 'inject']
  const before = M.navSignature(keys, (key) => ({ card: [el('唐团团'), ' · 带工具'], system: [el('追加'), ' · ≈', el('120'), ' tok'], everyTurn: ['关'], inject: [el('观察')] })[key], () => true, { system: false })
  // 切「严格」：角色卡模式、系统提示模式、沙盒档位变了；每轮注入没变
  const after = M.navSignature(keys, (key) => ({ card: [el('唐团团'), ' · 纯角色扮演'], system: [el('接管'), ' · ≈', el('120'), ' tok'], everyTurn: ['关'], inject: [el('严格'), ' · 拦 5'] })[key], () => true, { system: false })
  assert.deepEqual(M.diffSigs(before, after), ['card', 'system', 'inject'])
  // 只是开关 / offBy 变了也算
  const off = M.navSignature(keys, (key) => ({ card: [el('唐团团'), ' · 带工具'], system: [el('追加'), ' · ≈', el('120'), ' tok'], everyTurn: ['关'], inject: [el('观察')] })[key], (key) => key !== 'card', { system: true })
  assert.deepEqual(M.diffSigs(before, off), ['card', 'system'])
  // 没有上一份（刚挂上 / 换会话）⇒ 什么都不算变；同一份 ⇒ 空
  assert.deepEqual(M.diffSigs(null, after), [])
  assert.deepEqual(M.diffSigs(after, after), [])
})

test('谁引起的：点控件 = user（扫光 + toast）；打字 = typing（不提示）；左栏切节 / 很久以前 / 没有 = background', () => {
  const { M } = load()
  const now = 100000
  assert.equal(M.changeCause({ at: now - 500 }, now), 'user')
  assert.equal(M.changeCause({ at: now - 500, enable: 'card' }, now), 'user')
  assert.equal(M.changeCause({ at: now - 500, typing: true }, now), 'typing')
  assert.equal(M.changeCause({ at: now - 500, nav: true }, now), 'background')
  assert.equal(M.changeCause({ at: now - M.CAUSE_MS - 1 }, now), 'background')
  assert.equal(M.changeCause(null, now), 'background')
  assert.equal(M.linkedText('连带改了：{list}', ['角色卡', '系统提示', '']), '连带改了：角色卡、系统提示')
  assert.equal(M.linkedText('连带改了：{list}', []), '')
})

test('扫光：完整 = 渐变带扫过（装饰类，slow，按序错开 stagger）；简洁 = 底色层只闪透明度；off = 不调 animate', () => {
  const { M } = load()
  M.setMotionPref('full')
  const a = fakeNavHost()
  const b = fakeNavHost()
  M.flashOrSweep(a, 0)
  M.flashOrSweep(b, 2)
  assert.equal(a.band.calls.length, 1)
  assert.equal(a.layer.calls.length, 0)
  assert.equal(a.band.calls[0].timing.duration, M.MOTION.slow)
  assert.equal(b.band.calls[0].timing.delay, 2 * M.MOTION.stagger)
  assert.deepEqual([...props(a.band.calls[0].frames)].sort(), ['opacity', 'transform'], '只动 transform / opacity')
  M.setMotionPref('lite')
  const c = fakeNavHost()
  M.flashOrSweep(c, 1)
  assert.equal(c.band.calls.length, 0, '简洁不扫（位移）')
  assert.equal(c.layer.calls.length, 1)
  assert.deepEqual([...props(c.layer.calls[0].frames)], ['opacity'], '简洁只动透明度')
  M.setMotionPref('off')
  const d = fakeNavHost()
  assert.equal(M.flashOrSweep(d, 0), null)
  assert.equal(d.band.calls.length + d.layer.calls.length, 0)
  // 流式中：扫光（装饰类）攒到回合结束
  M.setMotionPref('full')
  const root = fakeRoot('stream')
  const e = fakeNavHost(root)
  assert.equal(M.flashOrSweep(e, 0), null)
  assert.equal(e.band.calls.length, 0)
  root.busy = undefined
  assert.equal(M.flushCues().length, 1)
  assert.equal(e.band.calls.length, 1)
})

test('面板接线（P0-4）：渲染时算签名、提交后按原因提示；每个左栏项 / 窄屏标签垫扫光层；黄色说明 grid-template-rows 展开', () => {
  assert.match(dockSrc, /navSignature\(FEATURE_NAV\.map\(\(\[key\]\) => key\), \(key\) => navStatus\[key\], isOn, offBy\)/)
  assert.match(dockSrc, /cause: changeCause\(trigger, Date\.now\(\)\)/)
  assert.match(dockSrc, /if \(info\.cause === 'user'\)/)
  assert.match(dockSrc, /flashOrSweep\(host, index\)/)
  assert.match(dockSrc, /announceLinked\(linkedText\(/)
  assert.match(dockSrc, /key !== info\.directKey/, '刚点的开关自己不扫')
  assert.equal((dockSrc.match(/sweepLayer\(key, color, /g) ?? []).length, 2, '宽屏左栏 + 窄屏标签')
  const off = cut('    function OffNote(props) {', '    function ManualInject(props) {')
  assert.match(off, /gridTemplateRows: props\.off \? '1fr' : '0fr'/)
  assert.match(off, /motion === 'off' \? 'none' : motion === 'lite' \? `opacity/)
  assert.match(src, /h\(OffNote, \{ id: props\.id, off: props\.off === true/)
  assert.equal(src.match(/\blinkedChanged:/g)?.length, 2, '中英文案')
})

// ── 2. P1-4 套用后收菜单；撤销条底部滑入 + 8s 倒计时 ─────────────────────────

test('撤销条倒计时：8 秒，剩余秒数向上取整到 0；倒计时线从满宽缩到 0（只动 transform）', () => {
  const { M } = load()
  assert.equal(M.UNDO_MS, 8000)
  assert.equal(M.undoLeft(1000, 1000), 8)
  assert.equal(M.undoLeft(1000, 1001), 8)
  assert.equal(M.undoLeft(1000, 2000), 7)
  assert.equal(M.undoLeft(1000, 8999), 1)
  assert.equal(M.undoLeft(1000, 9000), 0)
  assert.equal(M.undoLeft(1000, 20000), 0)
  assert.deepEqual([...props(M.UNDO_COUNTDOWN)], ['transform'])
  assert.deepEqual([...props(M.UNDO_ENTER)].sort(), ['opacity', 'transform'])
  // 完整：滑入 + 倒计时线（装饰类，但 cue: 'press' ⇒ 流式中也照走）；简洁：只淡入、没有线；off：都不动
  M.setMotionPref('full')
  const root = fakeRoot('stream')
  const line = fakeEl(root)
  assert.ok(M.play(line, M.UNDO_COUNTDOWN, { duration: 8000, easing: 'linear', fill: 'forwards', kind: 'decor', cue: 'press' }), '倒计时线不排队')
  M.setMotionPref('lite')
  const bar = fakeEl()
  const enter = M.play(bar, M.UNDO_ENTER, { duration: 180 })
  assert.deepEqual([...props(enter.frames)], ['opacity'])
  assert.equal(M.play(fakeEl(), M.UNDO_COUNTDOWN, { duration: 8000, kind: 'decor', cue: 'press' }), null)
  M.setMotionPref('off')
  const b2 = fakeEl()
  assert.equal(M.play(b2, M.UNDO_ENTER, { duration: 180 }), null)
  assert.equal(b2.calls.length, 0)
})

test('面板接线（P1-4）：套用成功后收起预设菜单；撤销条绝对定位在卡片底部（不占文档流），8s 用同一个常量', () => {
  assert.match(dockSrc, /act\(`apply:\$\{key\}`, t\('errOpApply'\), async \(\) => \{\s+await fn\(\)\s+setMenu\(\(current\) => \(current === 'presets' \? '' : current\)\)/)
  assert.match(dockSrc, /h\(UndoBar, \{\s+token: presetUndo,/)
  assert.match(dockSrc, /setPresetUndo\(\(current\) => \(current === presetUndo \? null : current\)\), UNDO_MS\)/)
  const bar = cut('    function UndoBar(props) {', '    const ICONS = ')
  assert.match(bar, /position: 'absolute', zIndex: 5, left: 12, right: 12, bottom: 12/)
  assert.match(bar, /usePresence\(token, UNDO_ENTER, UNDO_EXIT\)/)
  assert.match(bar, /play\(lineRef\.current, UNDO_COUNTDOWN, \{ duration: Math\.max\(0, startedAt\.current \+ UNDO_MS - Date\.now\(\)\), easing: 'linear', fill: 'forwards', kind: 'decor', cue: 'press' \}\)/)
  // 倒计时线要等条真的画出来（presence 第二次提交）才开始；只看 token 会在第一次提交时拿到 null（实测踩到）
  assert.match(bar, /if \(!token \|\| !visible \|\| lineAnim\.current\?\.token === token\) return/)
  assert.match(bar, /\}, \[token, visible\]\)/)
  assert.match(bar, /data-prefill-undo-seconds/)
  // 撤销条在底部时，回落到底部居中的 toast 让到它上面（实测两条叠在一起）
  assert.match(dockSrc, /'--pf-toast-bottom': presetUndo !== null \? '64px' : '10px'/)
  assert.match(src, /bottom: 'var\(--pf-toast-bottom, 10px\)'/)
  // 撤销条不再插在头部下面（旧写法 margin: '8px 12px 0'）
  assert.doesNotMatch(dockSrc, /'data-prefill-preset-undo-bar': '', style: \{ \.\.\.V\.row, \.\.\.V\.callout\('brand'\), margin: '8px 12px 0'/)
})
