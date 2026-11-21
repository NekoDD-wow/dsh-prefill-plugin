// 设置页目录（0.21 sticky TOC + scroll-spy）：点目录跳到某节后，高亮应仍是这一节。
// 卡片 scrollMarginTop（给吸顶目录让位）让 scrollIntoView({ block: 'start' }) 把节顶停在可视区顶下方 margin px；
// tocActiveAt 的 lead 若小于 margin，随之而来的 scroll 事件会把高亮（及 aria-current）改回上一节。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const fnSrc = (head) => {
  const at = src.indexOf(head)
  assert.ok(at >= 0, '找不到 ' + head.trim())
  return src.slice(at, src.indexOf('\n    }\n', at) + 7)
}
const { tocActiveOf } = new Function(`${fnSrc('    function tocActiveAt(')}\n${fnSrc('    function tocActiveOf(')}\nreturn { tocActiveOf }`)()
const margins = [...src.matchAll(/scrollMarginTop: (\d+)/g)].map((m) => Number(m[1]))

/** 假滚动容器：各小节在内容区里的绝对位置（px），scrollTop 可设。 */
function scroller(sections, scrollTop) {
  return {
    scrollTop,
    clientHeight: 800,
    scrollHeight: 6000,
    getBoundingClientRect: () => ({ top: 100 }),
    querySelectorAll: () => sections.map(([anchor, top]) => ({ getAttribute: () => anchor, getBoundingClientRect: () => ({ top: 100 + top - scrollTop }) })),
  }
}
const SECTIONS = [['overview', 60], ['default-everyturn', 700], ['default-sandbox', 1300], ['library', 1700], ['prefs', 2600], ['experimental', 3000], ['reasoning', 3300], ['dev', 4200]]

test('点目录任一节 ⇒ 按 scroll-margin-top 落点后，scroll-spy 仍高亮这一节（不跳回上一节）', () => {
  assert.equal(margins.length, 1, '卡片上只有一处 scrollMarginTop')
  const margin = margins[0]
  // 最后一节（dev）在本假容器里会触发「贴底 ⇒ 高亮最后一项」，与本用例无关，不测。
  for (const [anchor, top] of SECTIONS.slice(1, -1)) {
    const scrollTop = top - margin // scrollIntoView({block:'start'}) + scroll-margin-top ⇒ 节顶落在可视区顶下方 margin px
    assert.equal(tocActiveOf(scroller(SECTIONS, scrollTop)), anchor, `点「${anchor}」后落点 ${margin}px，高亮却不是它`)
  }
})

test('节顶还在 scroll-margin 下方较远处时，仍高亮上一节（lead 不能放得过大）', () => {
  const margin = margins[0]
  assert.equal(tocActiveOf(scroller(SECTIONS, 1700 - margin - 40)), 'default-sandbox')
})
