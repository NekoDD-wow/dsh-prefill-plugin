// 动效基础设施（docs/规划-动效.md 落地顺序第 1、2 步）：MOTION 常量、档位（含系统「减少动态效果」监听）、
// play() 包装、presence 延迟卸载、卡片几何（固定高度、绘制前测量）、state.ui.motion 规范化。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { normalizeState, sanitizeUi } from '../impl.js'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const implSrc = readFileSync(new URL('../impl.js', import.meta.url), 'utf8')
// client.js 里 <motion> 那段只依赖 window，切出来配一个假 window 直接跑（和 card-ux 切 <fetch-helpers> 同一做法）。
const motionSrc = src.slice(src.indexOf('// <motion>'), src.indexOf('// </motion>'))

/** 假 window：matchMedia 可切换并派发 change；dispatchEvent 记下事件名。 */
function fakeWindow({ reduce = false, legacyListener = false } = {}) {
  const listeners = []
  const events = []
  const mql = {
    matches: reduce,
    ...(legacyListener ? { addListener: (fn) => listeners.push(fn) } : { addEventListener: (type, fn) => type === 'change' && listeners.push(fn) }),
  }
  return {
    events,
    queries: [],
    matchMedia(query) {
      this.queries.push(query)
      return mql
    },
    dispatchEvent(event) {
      events.push(event.type)
      return true
    },
    flip(next) {
      mql.matches = next
      for (const fn of listeners) fn({ matches: next })
    },
  }
}
class FakeEvent {
  constructor(type) {
    this.type = type
  }
}
function load(win = fakeWindow()) {
  // eslint-disable-next-line no-new-func
  const M = new Function('window', 'CustomEvent', `${motionSrc}\nreturn { MOTION, MOTION_LEVELS, MOTION_EVENT, normalizeMotion, resolveMotion, motionLevel, setMotionPref, liteFrames, play, presenceExit, cardGeometry, sameGeometry, cardOrigin, CARD_ENTER, CARD_EXIT }`)(win, FakeEvent)
  return { M, win }
}

/** 假元素：记下每次 animate 的参数；finished 由测试手动 resolve / reject。 */
function fakeEl() {
  const calls = []
  const el = {
    style: { willChange: '' },
    calls,
    animate(frames, timing) {
      let resolve
      let reject
      const finished = new Promise((res, rej) => {
        resolve = res
        reject = rej
      })
      const anim = {
        frames,
        timing,
        finished,
        cancelled: false,
        finish: () => resolve(anim),
        cancel() {
          anim.cancelled = true
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        },
      }
      calls.push(anim)
      return anim
    },
  }
  return el
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

test('MOTION 常量一处定义（草案数值）', () => {
  const { M } = load()
  assert.deepEqual(M.MOTION, { fast: 120, base: 180, slow: 260, ease: 'cubic-bezier(.2,.7,.2,1)', easeOut: 'cubic-bezier(.4,0,1,1)', spring: 'cubic-bezier(.34,1.56,.64,1)', stagger: 30 })
  assert.deepEqual(M.MOTION_LEVELS, ['full', 'lite', 'off'])
  // 只在 client.js 顶部定义一次；面板里不再有写死的 170ms / 120ms 位移过渡
  assert.equal(src.match(/const MOTION = \{/g)?.length, 1)
  assert.ok(src.indexOf('const MOTION = {') < src.indexOf('const ICONS = '), 'MOTION 在文件顶部')
  assert.doesNotMatch(src, /duration: 170/)
  assert.doesNotMatch(src, /'left 120ms ease'/)
})

test('off：play 不调用 animate、返回 null', () => {
  const { M } = load()
  M.setMotionPref('off')
  const el = fakeEl()
  assert.equal(M.motionLevel(), 'off')
  assert.equal(M.play(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 180 }), null)
  assert.equal(M.play(el, [{ transform: 'translateY(4px)' }, { transform: 'none' }], { kind: 'move', duration: 180 }), null)
  assert.equal(el.calls.length, 0)
  assert.equal(el.style.willChange, '')
  // 没有 animate 的元素 / null 也安全
  M.setMotionPref('full')
  assert.equal(M.play(null, [{ opacity: 0 }]), null)
  assert.equal(M.play({ style: {} }, [{ opacity: 0 }]), null)
})

test('full：照原样播；动画期间 will-change，结束或被 cancel 都摘掉', async () => {
  const { M } = load()
  M.setMotionPref('full')
  const el = fakeEl()
  const frames = [{ opacity: 0, transform: 'translateY(6px) scale(.96)' }, { opacity: 1, transform: 'none' }]
  const anim = M.play(el, frames, { duration: M.MOTION.base, easing: M.MOTION.spring })
  assert.equal(el.calls.length, 1)
  assert.deepEqual(anim.frames, frames)
  assert.equal(anim.timing.easing, M.MOTION.spring)
  assert.equal(anim.timing.kind, undefined, 'kind 不传给 WAAPI')
  assert.equal(el.style.willChange, 'transform, opacity')
  anim.finish()
  await tick()
  assert.equal(el.style.willChange, '')
  const again = M.play(el, frames, { duration: 120 })
  assert.equal(el.style.willChange, 'transform, opacity')
  again.cancel()
  await tick()
  assert.equal(el.style.willChange, '', 'cancel 也不残留 will-change')
})

test('lite：没有 spring、没有 transform / rotate；位移类（FLIP）与装饰类不播', () => {
  const { M } = load()
  M.setMotionPref('lite')
  const el = fakeEl()
  const anim = M.play(
    el,
    [
      { opacity: 0, transform: 'translateY(6px) scale(.96) rotate(-3deg)', rotate: '-3deg', easing: M.MOTION.spring, transformOrigin: '10px 20px' },
      { opacity: 1, transform: 'none' },
    ],
    { duration: 180, easing: M.MOTION.spring },
  )
  assert.ok(anim)
  const text = JSON.stringify([anim.frames, anim.timing])
  assert.doesNotMatch(text, /1\.56|transform"|rotate/, text)
  assert.equal(anim.timing.easing, M.MOTION.ease)
  assert.deepEqual(anim.frames.map((f) => f.opacity), [0, 1])
  // 位移类 / 装饰类 / 只有 transform 的动画：一律不播，也不调 animate
  const before = el.calls.length
  assert.equal(M.play(el, [{ transform: 'translateY(30px)' }, { transform: 'none' }], { kind: 'move', duration: 180 }), null)
  assert.equal(M.play(el, [{ opacity: 0.3 }, { opacity: 1 }], { kind: 'decor', duration: 260 }), null)
  assert.equal(M.play(el, [{ transform: 'scale(.9)' }, { transform: 'none' }], { duration: 120 }), null)
  assert.equal(el.calls.length, before)
  // 卡片入场在 lite 下只剩淡入
  const card = M.play(el, M.CARD_ENTER('1px 2px'), { duration: 180, easing: M.MOTION.ease })
  assert.deepEqual(card.frames.map((f) => Object.keys(f).filter((k) => k !== 'transformOrigin')), [['opacity'], ['opacity']])
})

test('档位：系统「减少动态效果」⇒ 默认 lite；手选优先；非法手选 = 跟随系统；监听系统变化', () => {
  const { M, win } = load(fakeWindow({ reduce: true }))
  assert.equal(M.motionLevel(), 'lite')
  assert.deepEqual(win.queries, ['(prefers-reduced-motion: reduce)'])
  M.setMotionPref('full')
  assert.equal(M.motionLevel(), 'full', '手选优先')
  M.setMotionPref('off')
  assert.equal(M.motionLevel(), 'off')
  M.setMotionPref('auto')
  assert.equal(M.motionLevel(), 'lite', '认不出 ⇒ 跟随系统')
  M.setMotionPref(undefined)
  // 系统里关掉 / 打开「减少动态效果」：不用刷新页面，档位跟着变，并广播给各组件
  win.events.length = 0
  win.flip(false)
  assert.equal(M.motionLevel(), 'full')
  assert.deepEqual(win.events, [M.MOTION_EVENT])
  win.flip(true)
  assert.equal(M.motionLevel(), 'lite')
  // 系统变化时手选仍然优先
  M.setMotionPref('full')
  win.flip(false)
  win.flip(true)
  assert.equal(M.motionLevel(), 'full')
  // reduce 默认档下 FLIP（位移类）不播
  M.setMotionPref(null)
  const el = fakeEl()
  assert.equal(M.play(el, [{ transform: 'translateY(40px)' }, { transform: 'none' }], { kind: 'move', duration: 180 }), null)
  assert.equal(el.calls.length, 0)
  // 只 matchMedia 一次（之后靠监听）；老式 addListener 也认
  M.motionLevel()
  assert.equal(win.queries.length, 1)
  const legacy = load(fakeWindow({ reduce: false, legacyListener: true }))
  assert.equal(legacy.M.motionLevel(), 'full')
  legacy.win.flip(true)
  assert.equal(legacy.M.motionLevel(), 'lite')
  // 手选没变不重复广播
  win.events.length = 0
  M.setMotionPref('lite')
  M.setMotionPref('lite')
  assert.equal(win.events.length, 1)
})

test('resolveMotion / normalizeMotion 纯函数', () => {
  const { M } = load()
  assert.equal(M.resolveMotion(null, false), 'full')
  assert.equal(M.resolveMotion(null, true), 'lite')
  assert.equal(M.resolveMotion('off', false), 'off')
  assert.equal(M.resolveMotion('full', true), 'full')
  assert.equal(M.resolveMotion('LITE', true), 'lite')
  for (const bad of [undefined, '', 'auto', 'none', 1, {}, ['full']]) assert.equal(M.normalizeMotion(bad), null)
})

test('presence：退场动画结束后才卸载；被 cancel 也卸载；没动画当场卸载；abort 不卸载', async () => {
  const { M } = load()
  M.setMotionPref('full')
  // ① 正常结束
  let unmounted = 0
  const el = fakeEl()
  const anim = M.play(el, M.CARD_EXIT('0px 0px'), { duration: 120, easing: M.MOTION.easeOut, fill: 'forwards' })
  M.presenceExit(anim, () => (unmounted += 1), 5000)
  await tick()
  assert.equal(unmounted, 0, '动画没结束前还挂着')
  anim.finish()
  await tick()
  assert.equal(unmounted, 1)
  assert.equal(el.style.willChange, '')
  // ② 被 cancel（别的地方取消了动画）：照样卸载，不残留
  let cancelled = 0
  const a2 = M.play(el, M.CARD_EXIT('0px 0px'), { duration: 120 })
  M.presenceExit(a2, () => (cancelled += 1), 5000)
  a2.cancel()
  await tick()
  assert.equal(cancelled, 1)
  assert.equal(el.style.willChange, '')
  // ③ off 档：play 返回 null ⇒ 当场卸载
  M.setMotionPref('off')
  let instant = 0
  M.presenceExit(M.play(el, M.CARD_EXIT('0px 0px'), { duration: 120 }), () => (instant += 1))
  assert.equal(instant, 1)
  // ④ 退场中又打开：abort ⇒ 取消动画、不卸载（之后动画的 reject 也不会触发卸载）
  M.setMotionPref('full')
  let reopened = 0
  const a4 = M.play(el, M.CARD_EXIT('0px 0px'), { duration: 120 })
  const ctl = M.presenceExit(a4, () => (reopened += 1), 5000)
  ctl.abort()
  await tick()
  assert.equal(a4.cancelled, true)
  assert.equal(reopened, 0)
  // ⑤ finished 永远不落定：兜底计时卸载，且只卸载一次
  let fallback = 0
  const stuck = { finished: new Promise(() => {}), cancel() {} }
  M.presenceExit(stuck, () => (fallback += 1), 20)
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.equal(fallback, 1)
})

test('卡片几何：高度固定（= 上限），与小节内容无关；窄屏同一套；芯片做 transform-origin', () => {
  const { M } = load()
  // 宽屏 1400×1000，输入框外框 top 820
  const wide = M.cardGeometry(1400, 1000, { top: 820, left: 400, width: 880 }, undefined)
  assert.equal(wide.width, 868)
  assert.equal(wide.left, Math.round(400 + 440 - 434))
  assert.equal(wide.bottom, 190)
  assert.equal(wide.height, 700)
  assert.equal(wide.height, wide.maxHeight)
  assert.equal(wide.narrow, false)
  // 窄屏 780×900
  const narrow = M.cardGeometry(780, 900, { top: 700, left: 20, width: 740 }, undefined)
  assert.equal(narrow.narrow, true)
  assert.equal(narrow.height, Math.round(Math.min(900 * 0.7, 700 - 20)))
  assert.ok(narrow.width <= 780 - 24)
  // 输入框很靠上：高度按剩余空间、至少 200
  assert.equal(M.cardGeometry(1400, 1000, { top: 150, left: 0, width: 800 }).height, 200)
  // 找不到外框：用输入框顶；再找不到：视口高 − 160
  assert.equal(M.cardGeometry(1000, 800, null, 600).bottom, 210)
  assert.equal(M.cardGeometry(1000, 800, null, undefined).bottom, 170)
  assert.equal(M.sameGeometry(wide, { ...wide }), true)
  assert.equal(M.sameGeometry(wide, { ...wide, height: 699 }), false)
  assert.equal(M.sameGeometry(null, wide), false)
  // transform-origin：芯片中心相对卡片左上角；x 夹在卡片宽度内
  const cardTop = 1000 - wide.bottom - wide.height
  assert.equal(M.cardOrigin({ left: 420, top: 900, width: 100, height: 28 }, wide, 1000), `${420 + 50 - wide.left}px ${900 + 14 - cardTop}px`)
  assert.match(M.cardOrigin({ left: 0, top: 900, width: 10, height: 10 }, wide, 1000), /^0px /)
  assert.equal(M.cardOrigin(null, wide, 1000), '50% 100%')
})

test('面板接线：绘制前测量、固定高度、presence、档位属性、FLIP / 开关 / 箭头 / 缩标记都走档位', () => {
  // P1-1：几何的第一次测量在 useLayoutEffect（绘制前同步）；没量到时不显示
  const geom = src.slice(src.indexOf('// 几何（cardGeometry）'), src.indexOf('// 入场（P1-3）'))
  assert.match(geom, /React\.useLayoutEffect\(\(\) => \{\s*if \(!cardOpen\) return undefined/)
  assert.match(geom, /cardGeometry\(vw, vh, box,/)
  assert.match(src, /visibility: shrunk \|\| bounds === null \? 'hidden' : 'visible'/)
  // P1-2：卡片高度固定；主体可滚（窄屏纵向 flex 也要 minHeight 0）
  assert.match(src, /height: bounds\?\.height \?\? '60vh'/)
  assert.match(src, /'data-prefill-main': '', style: \{ flex: '1 1 auto', minWidth: 0, minHeight: 0, overflowY: 'auto'/)
  // P1-3：入场在 layout effect 里播；收起 = presence（退场后才卸载）
  const enter = src.slice(src.indexOf('// 入场（P1-3）'), src.indexOf('// 入场（P1-3）') + 700)
  assert.match(enter, /React\.useLayoutEffect/)
  assert.match(enter, /play\(el, CARD_ENTER\(originRef\.current\), \{ duration: MOTION\.base, easing: MOTION\.ease \}\)/)
  assert.match(src, /play\(el, CARD_EXIT\(originRef\.current\), \{ duration: MOTION\.fast, easing: MOTION\.easeOut, fill: 'forwards' \}\)/)
  assert.match(src, /presenceExit\(animation, \(\) => \{\s*exitRef\.current = null\s*setCardMounted\(false\)/)
  assert.match(src, /if \(!cardOpen && !cardMounted\) return h\('div', \{ 'data-prefill-anchor': '1'/)
  assert.match(src, /pointerEvents: shrunk \|\| closing \? 'none' : 'auto'/)
  // 根节点带档位
  assert.match(src, /'data-prefill-motion': motion,/)
  // P1-10：面板里除了 play() 自己，没有直接 el.animate；FLIP 是位移类
  const outside = src.slice(0, src.indexOf('// <motion>')) + src.slice(src.indexOf('// </motion>'))
  assert.doesNotMatch(outside, /\.animate\(/)
  assert.match(src, /play\(node, \[\{ transform: 'translateY\(' \+ delta \+ 'px\)' \}, \{ transform: 'none' \}\], \{ kind: 'move'/)
  // 开关圆点改成 transform，只在 full 档过渡；芯片箭头同理；缩标记 off 不动、lite 只淡
  assert.match(src, /transform: on \? 'translateX\(12px\)' : 'none', transition: motion === 'full' \?/)
  assert.match(src, /transition: motion === 'full' \? `transform \$\{MOTION\.fast\}ms \$\{MOTION\.ease\}` : 'none', transform: cardOpen \? 'none' : 'rotate\(180deg\)'/)
  assert.match(src, /transform: shrunk && motion === 'full' \? 'translateY\(6px\) scale\(0\.98\)' : 'none'/)
  assert.match(src, /motion === 'off'\s*\? 'none'\s*: `opacity 150ms ease/)
  assert.match(src, /animation: motion === 'off' \? 'none' : motion === 'lite' \? 'dsh-prefill-fade 150ms ease' : 'dsh-prefill-pop 150ms ease'/)
  // 不再在渲染里读一次 matchMedia
  assert.doesNotMatch(src, /reduceMotion/)
  // 「⋯」菜单：三档 + 改回跟随系统，写 state.ui.motion
  assert.match(src, /'data-prefill-more': ''/)
  assert.match(src, /'data-prefill-motion-opt': level/)
  assert.match(src, /postJson\(STATE_ROUTE, \{ ui: \{ motion: value \} \}\)/)
  for (const key of ['moreTitle', 'motionTitle', 'motionFull', 'motionLite', 'motionOff', 'motionAuto']) assert.equal(src.match(new RegExp(`\\b${key}:`, 'g'))?.length, 2, key)
})

test('state.ui.motion：只认三档，脏值剔掉；不进预设 / 导出', () => {
  assert.deepEqual(sanitizeUi({ motion: 'lite' }), { motion: 'lite' })
  assert.deepEqual(sanitizeUi({ motion: 'off', junk: 1 }), { motion: 'off' })
  for (const bad of [undefined, null, 'off', ['full'], {}, { motion: 'auto' }, { motion: null }, { motion: 'FULL' }]) assert.equal(sanitizeUi(bad), undefined, JSON.stringify(bad))
  assert.deepEqual(normalizeState({ ui: { motion: 'full' } }).ui, { motion: 'full' })
  assert.equal('ui' in normalizeState({ ui: { motion: 'wobble' } }), false)
  assert.equal('ui' in normalizeState({ ui: 'off' }), false)
  assert.equal('ui' in normalizeState({}), false)
  // 其他字段照旧（未知字段保留）
  const kept = normalizeState({ ui: { motion: 'lite' }, noticeSeen: true })
  assert.equal(kept.noticeSeen, true)
  // patchState 按键合并 ui；`motion: null` 经规范化去掉 = 改回跟随系统
  assert.match(implSrc, /\.\.\.\(patch\?\.ui !== undefined \? \{ ui: mergeUi\(current\.ui, patch\.ui\) \} : \{\}\)/)
  assert.equal('ui' in normalizeState({ ui: { ...{ motion: 'off' }, ...{ motion: null } } }), false)
  // 预设 / 导出只取自己的字段：保存预设、导出文件的代码里不出现 ui
  const exportFn = src.slice(src.indexOf('const exportFile = async () => {'), src.indexOf('const exportFile = async () => {') + 2500)
  assert.doesNotMatch(exportFn, /\bui\b|motion/)
})
