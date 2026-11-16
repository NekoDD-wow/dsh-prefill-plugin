// reasoning 代理（shim 路径）对上游响应的解析：SSE 分帧形态 / 非 SSE 200 转换 / usage 记账。
// 每条断言写的是期望行为；在 0.21.11（6e5a003）上 A1–A9 全部失败。
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { extractResponseText } from '../reasoning-prefix.js'
import { startUpstream, startProxy, post, parseClientSse, sse, BODY, sleep } from './proxy-upstream-harness.mjs'

const T = '\uFF5C\uFF5CDSML\uFF5C\uFF5C'
const invoke = (name, args) => '<' + T + ' invoke name="' + name + '">' + Object.entries(args).map(([k, v]) => '<' + T + ' parameter name="' + k + '"' + (typeof v === 'string' ? ' string="true"' : '') + '>' + v + '</' + T + ' parameter>').join('') + '</' + T + ' invoke>'
const delta = (d) => sse({ choices: [{ index: 0, delta: d }] })
const STOP = sse({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
const go = async (handler, config = {}, body = BODY) => {
  const up = await startUpstream(handler)
  const px = await startProxy({ upstream: up, config })
  try {
    const res = await post(px.url, body)
    await sleep(30)
    return { res, sse: parseClientSse(res.text), rows: px.rows(), stats: px.proxy.stats(), audit: px.proxy.audit(), outcomes: px.outcomes }
  } finally {
    await px.close()
    await up.close()
  }
}

test('A1 上游一帧 `data: null` 不会打崩宿主进程，后面的正文照常转发', () => {
  // 放进子进程跑：修复前是未捕获异常，会把测试 runner 一起带走。
  const script = `
    import { startUpstream, startProxy, post, sse, parseClientSse, BODY } from ${JSON.stringify(new URL('./proxy-upstream-harness.mjs', import.meta.url).href)}
    const up = await startUpstream(() => ({ chunks: ['data: null\\n\\n', 'data: 1\\n\\n', 'data: []\\n\\n', sse({ choices: [{ index: 0, delta: { content: 'ok' } }] }), ${JSON.stringify(STOP)}] }))
    const px = await startProxy({ upstream: up })
    const r = await post(px.url, BODY)
    console.log('CLIENT_STATUS=' + r.status + ' CONTENT=' + parseClientSse(r.text).content)
    await px.close(); await up.close()
    process.exit(0)
  `
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 20000 })
  assert.equal(child.status, 0, '宿主进程被打崩：\n' + child.stderr.split('\n').slice(0, 6).join('\n'))
  assert.match(child.stdout, /CLIENT_STATUS=200 CONTENT=ok/)
})

test('A2 帧里带 `event:` / `id:` 行（SSE 规范合法）⇒ 正文照常转发', async () => {
  const r = await go(() => ({ chunks: ['event: message\nid: 1\n' + delta({ content: '正文A' }), 'event: message\n' + STOP] }))
  assert.equal(r.sse.content, '正文A')
  assert.deepEqual(r.sse.finish, ['stop'])
  assert.equal(r.sse.done, true)
})

test('A3 帧以注释行开头（`: keep-alive\\ndata: …`）⇒ 正文照常转发；单独的注释帧被忽略', async () => {
  const r = await go(() => ({ chunks: [': keep-alive\n\n', ': keep-alive\n' + delta({ content: '正文B' }), STOP] }))
  assert.equal(r.sse.content, '正文B')
  assert.equal(r.rows[0].ok, true)
})

test('A2b 一个事件里多条 `data:` 行按规范用换行拼接后再解析', async () => {
  const json = JSON.stringify({ choices: [{ index: 0, delta: { content: '多行' } }] }, null, 1)
  const frame = json.split('\n').map((line) => 'data: ' + line).join('\n') + '\n\n'
  const r = await go(() => ({ chunks: [frame, STOP] }))
  assert.equal(r.sse.content, '多行')
})

test('A4 content-type 大小写（`Text/Event-Stream`）仍按 SSE 解析', async () => {
  const r = await go(() => ({ headers: { 'content-type': 'Text/Event-Stream; charset=UTF-8' }, chunks: [delta({ content: '大写' }), STOP] }))
  assert.equal(r.sse.content, '大写')
  assert.equal(extractResponseText('TEXT/EVENT-STREAM', delta({ content: '透传' })), '透传')
})

test('A5 非 SSE 200：多字节字符被切在两个 chunk 之间也不出现 U+FFFD', async () => {
  const json = Buffer.from(JSON.stringify({ id: 'x', choices: [{ index: 0, message: { role: 'assistant', content: '你好世界' }, finish_reason: 'stop' }] }), 'utf8')
  const cut = json.indexOf(Buffer.from('好')) + 1
  const r = await go(() => ({ headers: { 'content-type': 'application/json' }, chunks: [json.subarray(0, cut), json.subarray(cut)], delayMs: 20 }))
  assert.equal(r.sse.content, '你好世界')
})

test('A6 非 SSE 200：上游 finish_reason=length 原样透传，不改写成 stop', async () => {
  const r = await go(() => ({ headers: { 'content-type': 'application/json' }, chunks: [JSON.stringify({ choices: [{ index: 0, message: { content: '截断了' }, finish_reason: 'length' }] })] }))
  assert.equal(r.sse.content, '截断了')
  assert.deepEqual(r.sse.finish, ['length'])
})

test('A7 非 SSE 200 但体是错误对象（`{error:…}`）⇒ 结果行记失败、留 stream-error 审计', async () => {
  const r = await go(() => ({ headers: { 'content-type': 'application/json' }, chunks: [JSON.stringify({ error: { message: 'Insufficient Balance', code: 402 } })] }))
  assert.equal(r.rows[0].ok, false, '空回复被记成成功')
  assert.ok(r.audit.some((a) => a.kind === 'stream-error'), JSON.stringify(r.audit))
  assert.equal(r.sse.done, true, '客户端仍应收到 [DONE]，不挂死')
})

test('A8 每帧都带（累计）usage ⇒ 每个请求只记一次，取最后一帧', async () => {
  const u1 = { prompt_tokens: 100, completion_tokens: 1, prompt_cache_hit_tokens: 80, prompt_cache_miss_tokens: 20 }
  const u2 = { prompt_tokens: 100, completion_tokens: 5, prompt_cache_hit_tokens: 80, prompt_cache_miss_tokens: 20 }
  const r = await go(() => ({ chunks: [sse({ choices: [{ index: 0, delta: { content: 'a' } }], usage: u1 }), sse({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: u2 })] }))
  assert.equal(r.stats.usage.requests, 1)
  assert.equal(r.stats.usage.prompt, 100)
  assert.equal(r.stats.usage.completion, 5)
  // usage 帧仍原样转发给客户端（DSH 自己也要记账）
  assert.equal(r.sse.payloads.filter((p) => p.usage).length, 2)
})

test('A9 上游原生 tool_calls 与 DSML 解析出的调用不共用 index ⇒ 客户端拿到两个独立调用', async () => {
  const r = await go(() => ({ chunks: [
    delta({ content: invoke('read', { file_path: 'a.txt' }) }),
    delta({ tool_calls: [{ index: 0, id: 'call_n', type: 'function', function: { name: 'glob', arguments: '{"pattern":' } }] }),
    delta({ tool_calls: [{ index: 0, function: { arguments: '"*"}' } }] }),
    sse({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }),
  ] }))
  const calls = Object.values(r.sse.toolCalls)
  assert.equal(calls.length, 2, JSON.stringify(r.sse.toolCalls))
  assert.deepEqual(calls.map((c) => c.name).sort(), ['glob', 'read'])
  assert.equal(calls.find((c) => c.name === 'glob').arguments, '{"pattern":"*"}')
  assert.deepEqual(r.sse.finish, ['tool_calls'])
})
