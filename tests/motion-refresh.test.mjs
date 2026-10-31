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
  'navSignature', 'diffSigs', 'linkedText', 'statusText', 'userCaused', 'BADGE_FLASH', 'NAV_FLASH', 'DOT_FLASH', 'SWEEP', 'flashOrSweep',
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
