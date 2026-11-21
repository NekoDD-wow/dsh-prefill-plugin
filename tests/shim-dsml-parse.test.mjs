// reasoning 代理 shim 路径的 DSML 调用解析（createShimStreamParser）与收尾 finish_reason。
// 每条断言写的是期望行为；D1–D3、M1、M1b、M2、M3 在 0.21.12（e62b23f）上失败，D3b、M1c、M2b 是保持原行为的护栏（基线上也通过）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createShimStreamParser } from '../reasoning-prefix.js'
import { startUpstream, startProxy, post, parseClientSse, sse, BODY, sleep } from './proxy-upstream-harness.mjs'

const T = '\uFF5C\uFF5CDSML\uFF5C\uFF5C'
const invoke = (name, args) => '<' + T + ' invoke name="' + name + '">' + Object.entries(args).map(([k, v]) => '<' + T + ' parameter name="' + k + '"' + (typeof v === 'string' ? ' string="true"' : '') + '>' + v + '</' + T + ' parameter>').join('') + '</' + T + ' invoke>'
const run = (pieces) => {
  const parser = createShimStreamParser()
  const events = []
  for (const piece of pieces) events.push(...parser.push(piece))
  events.push(...parser.end())
  return {
    text: events.filter((e) => e.type === 'content').map((e) => e.text).join(''),
    calls: events.filter((e) => e.type === 'calls').flatMap((e) => e.calls),
  }
}
/** 按固定步长切片，模拟上游逐 token 吐字。 */
const chop = (text, step) => {
  const out = []
  for (let i = 0; i < text.length; i += step) out.push(text.slice(i, i + step))
  return out
}

test('D1 同一次 push 里「含 < 的正文」后面跟一个完整 invoke ⇒ invoke 前的正文全部保留', () => {
  // 非 SSE 200 路径会把整段 message.content 一次 push 进来，最容易撞上；流式里一个 chunk 同时含两者也会。
  const out = run(['比较 a<b 之后调用：' + invoke('read', { file_path: 'a.txt' })])
  assert.equal(out.calls.length, 1)
  assert.equal(out.text, '比较 a<b 之后调用：')
})

test('D2 正文里普通 XML 标签名只是「包含」parameter / invoke / calls（如 <parameters>、<recalls>）⇒ 原样保留', () => {
  const text = '配置：<parameters>\n  <x>1</x>\n</parameters>\n<recalls>2</recalls>'
  assert.equal(run([text]).text, text)
})

test('D3 调用过的参数值不再过滤掉之后正文里内容相同的行', () => {
  const out = run([invoke('read', { file_path: 'a.txt', limit: 10 }), '\n结果条数：\n10\n'])
  assert.equal(out.calls.length, 1)
  assert.equal(out.text, '\n结果条数：\n10\n')
})

test('D3b 紧跟在调用后面的参数回显（中间只有空白）照旧过滤', () => {
  const out = run([invoke('read', { file_path: 'E:\\a.txt' }), '\nE:\\a.txt\n', '正文'])
  assert.equal(out.calls.length, 1)
  assert.equal(out.text, '\n正文')
})

// 真实 DeepSeek 流量里见过的形态：先正确吐出一个调用，然后写出畸形的起始标签（多了斜杠），
// 再跟着几个参数标签。上游逐 token 吐字，参数起始标签本身超过 40 个字符。
const MALFORMED =
  invoke('glob', { pattern: 'package.json' }) +
  '\n</' + T + ' invoke name="bash">\n' +
  '<' + T + ' parameter name="command" string="true">cat package.json | head -50</' + T + ' parameter>\n' +
  '<' + T + ' parameter name="description" string="true">Read the package file to see project info</' + T + ' parameter>\n' +
  '</' + T + ' invoke>\n</' + T + ' invoke>\n'

for (const step of [1, 3, 7]) {
  test('M1 畸形起始标签 `</…invoke name=…>` 之后的参数标签不会当正文吐给客户端（每次 ' + step + ' 字）', () => {
    const out = run(chop(MALFORMED, step))
    assert.equal(out.calls.length, 1)
    assert.equal(out.calls[0].name, 'glob')
    assert.doesNotMatch(out.text, /DSML|parameter|cat package|Read the package/)
  })
}

test('M1b 孤立参数标签的值跨三个以上 chunk ⇒ 值整体丢掉，不从中间开始漏出', () => {
  const out = run(['</' + T + ' invoke name="bash">', '<' + T + ' parameter name="command" string="true">', 'cat ', 'package', '.json', '</' + T + ' parameter>', '</' + T + ' invoke>', '尾巴'])
  assert.equal(out.text, '尾巴')
})

test('M1c 很长的普通正文 `<…` 仍按 40 字符兜底吐出（不是 DSML 起头就不长等）', () => {
  const long = '<' + 'x'.repeat(60)
  const parser = createShimStreamParser()
  const early = parser.push(long).filter((e) => e.type === 'content').map((e) => e.text).join('')
  assert.equal(early, long)
})

// 真实 DeepSeek 流量（max_tokens 截断）里抓到的两种收尾形态：停在参数起始标签中间 / 停在参数值中间。
const TRUNC_IN_TAG = '\n\n<' + T + ' invoke name="bash">\n<' + T + ' parameter name="description" string="'
const TRUNC_IN_VALUE = invoke('glob', { pattern: 'package.json' }) + '\n<' + T + ' invoke name="bash">\n<' + T + ' parameter name="description" string="true">确认'
for (const [label, raw] of [['标签中间', TRUNC_IN_TAG], ['参数值中间', TRUNC_IN_VALUE]]) {
  test('M3 流在 DSML 调用' + label + '被截断 ⇒ 半截调用不当正文吐出', () => {
    const out = run(chop(raw, 2))
    assert.doesNotMatch(out.text, /DSML|\uFF5C|parameter|确认/)
    assert.equal(out.text.trim(), '')
  })
}

const go = async (chunks) => {
  const up = await startUpstream(() => ({ chunks }))
  const px = await startProxy({ upstream: up })
  try {
    const res = await post(px.url, BODY)
    await sleep(30)
    return { res, sse: parseClientSse(res.text) }
  } finally {
    await px.close()
    await up.close()
  }
}
const delta = (d) => sse({ choices: [{ index: 0, delta: d }] })
const fin = (reason) => sse({ choices: [{ index: 0, delta: {}, finish_reason: reason }] })

test('M2 上游 finish=length 且已解析出调用 ⇒ 如实报 length（完整的调用照常转发）', async () => {
  const r = await go([delta({ content: invoke('glob', { pattern: 'package.json' }) }), delta({ content: '\n</' + T + ' invoke name="bash">\n</' + T + ' invoke>' }), fin('length')])
  assert.equal(Object.keys(r.sse.toolCalls).length, 1)
  assert.equal(r.sse.toolCalls[0].name, 'glob')
  assert.deepEqual(r.sse.finish, ['length'])
  assert.equal(r.sse.done, true)
})

test('M2b 上游 finish=stop 且有调用 ⇒ 仍报 tool_calls（原行为保持）', async () => {
  const r = await go([delta({ content: invoke('glob', { pattern: 'a' }) }), fin('stop')])
  assert.deepEqual(r.sse.finish, ['tool_calls'])
})
