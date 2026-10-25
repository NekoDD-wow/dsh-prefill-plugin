// 钉标题：按字符（码点）截断，不把 emoji 切成半个代理对。
import test from 'node:test'
import assert from 'node:assert/strict'
import { titleOf } from '../gate.js'

const msg = (...texts) => ({ content: texts.map((text) => ({ type: 'text', text })) })

test('titleOf 取前 24 个字符、压空白', () => {
  assert.equal(titleOf(msg('  读一下   a.js ', '然后\n改个 bug ')), '读一下 a.js 然后 改个 bug')
  assert.equal(titleOf({ content: [{ type: 'image' }] }), '')
  assert.equal(titleOf(undefined), '')
})

test('titleOf 不会在 emoji 中间截断', () => {
  // 前 23 个码元之后紧跟一个代理对：按码元截会留下孤立的高位代理。
  const title = titleOf(msg('帮我看一下这个函数为什么返回undefined😀后面还有'))
  assert.equal(title, '帮我看一下这个函数为什么返回undefined😀')
  assert.doesNotMatch(title, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
})
