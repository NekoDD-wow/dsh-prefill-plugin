// 手机窄屏适配（2026-11）· cardGeometry 的「触屏门」：
//   1) 手机（≤480）永远是「顶栏之下的全宽浮层」；
//   2) 触屏矮视口（横屏手机 915×412）才是「浮层 + 遮罩（模态）」；
//   3) **桌面把窗口拉矮（如 1440×520）不属于矮视口那类**：只夹 cardTop ≥ 56，形态与版式不变；
//   4) 常规桌面 / 既有窄屏公式与改动前一致。
// 做法照 tests/motion.test.mjs：把 client.js 的 <motion> 段切出来配假 window 直接跑纯函数。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const motionSrc = src.slice(src.indexOf('// <motion>'), src.indexOf('// </motion>'))

function load() {
  const win = { matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {}, removeEventListener() {}, dispatchEvent() {} }
  // eslint-disable-next-line no-new-func
  return new Function('window', 'CustomEvent', `${motionSrc}\nreturn { cardGeometry, PHONE_MAX, NARROW_MAX, PHONE_CARD_TOP, PHONE_CARD_INSET }`)(win, class {})
}
/** 卡片顶边（几何 → 视口坐标）：top = vh − bottom − height。 */
const cardTop = (g, vh) => vh - g.bottom - g.height

test('手机（≤480）：无论触屏参数如何都是「顶栏之下的全宽浮层」', () => {
  const { cardGeometry, PHONE_CARD_TOP, PHONE_CARD_INSET } = load()
  for (const touch of [true, false, undefined]) {
    const g = cardGeometry(412, 839, { top: 400, left: 16, width: 380 }, undefined, touch)
    assert.equal(g.phone, true, 'phone 分支')
    assert.equal(g.short, false, 'phone 不需要 short（本来就是浮层）')
    assert.equal(g.left, PHONE_CARD_INSET)
    assert.equal(g.bottom, PHONE_CARD_INSET)
    assert.equal(g.width, 412 - PHONE_CARD_INSET * 2)
    assert.equal(g.height, 839 - PHONE_CARD_TOP - PHONE_CARD_INSET)
    assert.equal(cardTop(g, 839), PHONE_CARD_TOP, '顶边 = 56（官方顶栏 48 + 8）')
  }
})

test('触屏矮视口（横屏手机 915×412）：切「浮层 + 遮罩」，顶边仍是 56', () => {
  const { cardGeometry, PHONE_CARD_TOP, PHONE_CARD_INSET } = load()
  const g = cardGeometry(915, 412, { top: 300, left: 280, width: 620 }, undefined, true)
  assert.equal(g.short, true, '触屏 + vh<560 ⇒ short（渲染遮罩）')
  assert.equal(g.narrow, true, '矮视口用紧凑版式')
  assert.equal(g.phone, false)
  assert.equal(g.bottom, PHONE_CARD_INSET)
  assert.equal(g.height, 412 - PHONE_CARD_TOP - PHONE_CARD_INSET)
  assert.equal(cardTop(g, 412), PHONE_CARD_TOP)
})

test('桌面矮窗口（1440×520）：只夹 cardTop ≥ 56，不切窄版式、不切模态', () => {
  const { cardGeometry, PHONE_CARD_TOP } = load()
  // 有输入框外框
  const a = cardGeometry(1440, 520, { top: 300, left: 0, width: 1000 }, undefined, false)
  assert.equal(a.short, false, '桌面矮窗口不是 short（不能出遮罩）')
  assert.equal(a.narrow, false, '宽窗口保持宽版式')
  assert.equal(a.phone, false)
  assert.equal(a.bottom, 520 - 300 + 10, '仍贴在输入框上方 10px')
  assert.ok(cardTop(a, 520) >= PHONE_CARD_TOP - 1, `顶边 ${cardTop(a, 520)} ≥ 56`)
  assert.ok(a.height <= Math.round(520 * 0.7), '高度不超过 70vh')
  // 找不到外框（用 inputTop = vh−160 兜底）
  const b = cardGeometry(1440, 520, null, undefined, false)
  assert.equal(b.short, false)
  assert.ok(cardTop(b, 520) >= PHONE_CARD_TOP - 1, `兜底路径顶边 ${cardTop(b, 520)} ≥ 56`)
  // 不传第 5 参（旧调用点 / 单测）也按「非触屏」处理：不能把桌面误伤成模态
  const c = cardGeometry(1440, 520, { top: 300, left: 0, width: 1000 })
  assert.equal(c.short, false)
  assert.equal(c.narrow, false)
  assert.ok(cardTop(c, 520) >= PHONE_CARD_TOP - 1)
})

test('窄屏矮视口（768×500，非触屏）：保持窄版式，只夹顶边', () => {
  const { cardGeometry, PHONE_CARD_TOP, NARROW_MAX } = load()
  const g = cardGeometry(768, 500, { top: 260, left: 20, width: 720 }, undefined, false)
  assert.equal(g.short, false, '非触屏不切模态')
  assert.equal(g.narrow, true)
  assert.equal(g.phone, false)
  assert.ok(g.width <= NARROW_MAX)
  assert.ok(cardTop(g, 500) >= PHONE_CARD_TOP - 1, `顶边 ${cardTop(g, 500)} ≥ 56`)
})

test('常规桌面 / 既有窄屏：公式与改动前一致', () => {
  const { cardGeometry } = load()
  // 桌面 1440×1000：旧公式原样（motion.test.mjs 也钉了同一组值）
  const wide = cardGeometry(1400, 1000, { top: 820, left: 400, width: 880 }, undefined, false)
  assert.equal(wide.width, 868)
  assert.equal(wide.bottom, 190)
  assert.equal(wide.height, 700)
  assert.equal(wide.narrow, false)
  assert.equal(wide.short, false)
  // 窄屏 780×900（不矮）：旧窄屏公式
  const narrow = cardGeometry(780, 900, { top: 700, left: 20, width: 740 }, undefined, false)
  assert.equal(narrow.narrow, true)
  assert.equal(narrow.short, false)
  assert.equal(narrow.height, Math.round(Math.min(900 * 0.7, 700 - 20)))
})
