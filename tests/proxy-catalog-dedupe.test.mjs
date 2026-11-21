// 代理侧清单去重（审计 impl #7）：wire 上只留一份工具清单。
//
// 为什么在代理做：catalogMode=history 的清单写进会话日志后撤不掉（日志只能追加），工具集变化后
// 旧清单永远留在历史里，DSH 每轮把它投影进 wire；插件的 pre-step 看不到历史。只有代理拿得到完整的 messages。
// 约束（0.21.6）：永不删到一份都不剩 —— 清单可能是模型唯一的工具认知来源。
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as rp from '../reasoning-prefix.js'

const { createReasoningPrefixProxy, hasToolCatalogMessage, TOOL_CATALOG_MARK } = rp
const CATALOG = TOOL_CATALOG_MARK + '本轮没有 tools 参数。可用工具：\n- read\n- glob'
const OLD_CATALOG = TOOL_CATALOG_MARK + '本轮没有 tools 参数。可用工具：\n- read\n- glob\n- bash'
const OLDER_CATALOG = TOOL_CATALOG_MARK + '本轮没有 tools 参数。可用工具：\n- read'

const tempDirs = []
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'prefill-catdedupe-'))
  tempDirs.push(dir)
  return dir
}
test.after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

const SSE_OK = [
  'data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: '好' } }] }) + '\n\n',
  'data: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\n',
  'data: [DONE]\n\n',
].join('')

const run = async ({ config, messages }) => {
  const bodies = []
  const upstream = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    bodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end(SSE_OK)
  })
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const proxy = createReasoningPrefixProxy({
    getConfig: () => ({ enabled: true, upstream: 'http://127.0.0.1:' + upstream.address().port, reasoningPrefix: '他喵', stripTools: true, catalog: CATALOG, ...config }),
  })
  const port = await proxy.listen(0)
  try {
    const response = await fetch('http://127.0.0.1:' + port + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify({ model: 'deepseek-flash', stream: true, messages }),
    })
    await response.text()
    return { status: response.status, sent: bodies[0]?.messages ?? [] }
  } finally {
    proxy.server.closeAllConnections?.()
    await proxy.close()
    upstream.closeAllConnections?.()
    await new Promise((resolve) => upstream.close(resolve))
  }
}

const catalogsIn = (messages) => messages.filter((message) => hasToolCatalogMessage([message]))
const textOf = (message) => (typeof message.content === 'string' ? message.content : message.content.map((p) => p.text).join(''))
const readRows = (file) => readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line))

test('history 模式工具集变化后：历史里旧清单 + 新清单 ⇒ 上游只收到新清单一份', async () => {
  const file = join(tempDir(), 'result.jsonl')
  const { status, sent } = await run({
    config: { shim: true, catalogMode: 'history', resultFile: file },
    messages: [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: OLD_CATALOG }, // 第 1 轮 history 注入的（还列着 bash）
      { role: 'user', content: '第一轮' },
      { role: 'assistant', content: '好' },
      { role: 'user', content: CATALOG }, // 工具集变化后补的新清单
      { role: 'user', content: '第二轮' },
    ],
  })
  assert.equal(status, 200)
  const catalogs = catalogsIn(sent)
  assert.equal(catalogs.length, 1, `上游收到 ${catalogs.length} 份清单（旧的那份还列着已移除的 bash）`)
  assert.equal(textOf(catalogs[0]), CATALOG, '留下的必须是新清单')
  assert.equal(sent.filter((m) => m.role === 'user' && textOf(m) === '第二轮').length, 1, '普通消息原样保留')
  const row = readRows(file)[0]
  assert.equal(row.catalogInjected, false, '新清单已在历史里 ⇒ 不再注入')
  assert.equal(row.catalogDropped, 1, '结果行记下去掉了几份')
})

test('历史里只有旧版本清单（shim 会注入新的）⇒ 旧的去掉、只发新注入的一份', async () => {
  const { status, sent } = await run({
    config: { shim: true, catalogMode: 'each' },
    messages: [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: OLD_CATALOG },
      { role: 'user', content: '你好' },
    ],
  })
  assert.equal(status, 200)
  const catalogs = catalogsIn(sent)
  assert.equal(catalogs.length, 1, `上游收到 ${catalogs.length} 份清单`)
  assert.equal(textOf(catalogs[0]), CATALOG)
})

test('永不删除唯一那份：历史里只有本轮这一份 ⇒ 原样保留、不注入、不记 catalogDropped', async () => {
  const file = join(tempDir(), 'result.jsonl')
  const messages = [
    { role: 'system', content: '系统提示' },
    { role: 'user', content: CATALOG },
    { role: 'user', content: '你好' },
  ]
  const { sent } = await run({ config: { shim: true, catalogMode: 'history', resultFile: file }, messages })
  assert.equal(catalogsIn(sent).length, 1)
  assert.deepEqual(sent.slice(0, 3), messages, '历史消息一条不动')
  assert.equal(Object.hasOwn(readRows(file)[0], 'catalogDropped'), false)
})

test('shim 关着（代理不注入清单）：历史里两份旧版本 ⇒ 只留时间序最后一份；只有一份 ⇒ 一份不删', async () => {
  const two = await run({
    config: { shim: false },
    messages: [
      { role: 'user', content: OLDER_CATALOG },
      { role: 'user', content: '一' },
      { role: 'assistant', content: '好' },
      { role: 'user', content: OLD_CATALOG },
      { role: 'user', content: '二' },
    ],
  })
  const kept = catalogsIn(two.sent)
  assert.equal(kept.length, 1, `shim 关着时上游收到 ${kept.length} 份清单`)
  assert.equal(textOf(kept[0]), OLD_CATALOG, '留最新那份（时间序最后）')
  const one = await run({ config: { shim: false }, messages: [{ role: 'user', content: OLD_CATALOG }, { role: 'user', content: '你好' }] })
  assert.equal(catalogsIn(one.sent).length, 1, '唯一那份是模型唯一的工具认知来源，不能删')
})

test('dedupeToolCatalogs：带 source 且不是清单的用户消息不当清单；不制造相邻的两条 assistant', () => {
  assert.equal(typeof rp.dedupeToolCatalogs, 'function', 'reasoning-prefix.js 应导出 dedupeToolCatalogs')
  const userQuoted = { role: 'user', source: { kind: 'user' }, content: OLD_CATALOG }
  const r1 = rp.dedupeToolCatalogs([userQuoted, { role: 'user', content: CATALOG }], CATALOG, { inject: true })
  assert.equal(r1.dropped, 0, '用户自己贴的清单文本不动')
  const sandwiched = [
    { role: 'user', content: '一' },
    { role: 'assistant', content: 'a' },
    { role: 'user', content: OLD_CATALOG },
    { role: 'assistant', content: 'b' },
    { role: 'user', content: CATALOG },
  ]
  const r2 = rp.dedupeToolCatalogs(sandwiched, CATALOG, { inject: true })
  assert.equal(r2.dropped, 0, '夹在两条 assistant 之间的那份留着')
  const r3 = rp.dedupeToolCatalogs([{ role: 'user', content: '<system-reminder>\n' + OLD_CATALOG + '\n</system-reminder>' }, { role: 'user', content: 'x' }], CATALOG, { inject: true })
  assert.equal(r3.dropped, 1, '代理自己 user 变体的包装形状也认')
  assert.deepEqual(rp.dedupeToolCatalogs(undefined, CATALOG), { messages: [], dropped: 0 })
  assert.deepEqual(rp.dedupeToolCatalogs([{ role: 'user', content: OLD_CATALOG }], CATALOG, { inject: false }).dropped, 0, '不注入时唯一那份不删')
})
