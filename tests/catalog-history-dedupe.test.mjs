// catalogMode=history 的工具清单：面板计数如实 + 只往走前缀路由的会话里写（审计 impl #7 / #11）。
//
// 关键事实（dsh-agent-loop preStep）：agent/pre-step 的 decision.messages 只是本步 claim 的消息（+ runtime context），
// **不含会话历史**；历史由 DSH 从会话日志投影进 wire。所以 0.21.6 在 pre-step 出口做的去重永远只看到 0/1 份，
// `prefill.catalogDuplicates` 恒为 0。现在计数改读会话本身；真正去掉旧清单的是代理（见 proxy-catalog-dedupe.test.mjs）。
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { exitIfLeaked, fakeSettings, freePort, mount } from './impl-mount-harness.mjs'

let schemas = [
  { name: 'read', description: '读文件', parameters: { type: 'object', properties: { path: { type: 'string' } } } },
  { name: 'bash', description: '跑命令', parameters: { type: 'object', properties: { cmd: { type: 'string' } } } },
]
const PORT = await freePort()
const h = await mount({
  tag: 'catalog-history',
  settings: fakeSettings({}),
  tools: { schemas: () => schemas },
  state: { ui: { experimental: true, reasoningPrefix: { enabled: true, prefix: '想：', port: PORT, catalogMode: 'history' } } },
})
const STATUS = '/api/dsh-prefill/experimental/status'
const DISABLE = '/api/dsh-prefill/reasoning/disable'
const isCatalog = (m) => m?.source?.prefill === 'tool-catalog'
const userMsg = (text) => ({ role: 'user', content: [{ type: 'text', text }] })
const duplicatesOf = async (sessionId) => (await h.post(STATUS, { sessionId })).prefill.catalogDuplicates

after(async () => {
  await h.post(DISABLE, {})
  exitIfLeaked()
})

test('前置：history 模式第 1 轮把清单注入本步装配；工具集没变的下一轮不再注入，面板计数 0', async () => {
  const SID = 'sess-same'
  const events = []
  const d1 = await h.preStep(SID, 1, 1, { events, claimed: [userMsg('hi')] })
  assert.equal(d1.messages.filter(isCatalog).length, 1)
  for (const m of d1.messages) events.push({ type: 'user/message', data: m })
  assert.equal(await duplicatesOf(SID), 0)
  const d2 = await h.preStep(SID, 2, 1, { events, claimed: [userMsg('again')] })
  assert.equal(d2.messages.filter(isCatalog).length, 0, '同一份清单已在历史里')
  assert.equal(await duplicatesOf(SID), 0, '只有唯一那份 ⇒ 不算重复')
})

test('工具集变化后：历史里的旧清单 + 本轮新注入的 ⇒ 面板 catalogDuplicates 如实为 1（以前恒为 0）', async () => {
  const SID = 'sess-changed'
  const events = []
  const d1 = await h.preStep(SID, 1, 1, { events, claimed: [userMsg('hi')] })
  for (const m of d1.messages) events.push({ type: 'user/message', data: m })
  schemas = schemas.filter((s) => s.name !== 'bash')
  try {
    const d2 = await h.preStep(SID, 2, 1, { events, claimed: [userMsg('again')] })
    const injected = d2.messages.filter(isCatalog)
    assert.equal(injected.length, 1, '工具集变了仍要注入新清单（模型要以新的为准）')
    assert.doesNotMatch(injected[0].content[0].text, /- bash/, '新清单不再列已移除的 bash')
    assert.equal(await duplicatesOf(SID), 1, '历史里那份旧清单还会被投影进 wire —— 面板必须如实提示')
  } finally {
    schemas = [...schemas, { name: 'bash', description: '跑命令', parameters: { type: 'object', properties: { cmd: { type: 'string' } } } }]
  }
})

test('历史里已经有两份清单（history→each 切换遗留）：面板 catalogDuplicates > 0，且不改本步装配', async () => {
  const SID = 'sess-two'
  const mk = (hash, text) => ({ type: 'user/message', data: { id: 'prefill-tool-catalog-' + hash, role: 'user', source: { kind: 'prefill', prefill: 'tool-catalog', catalogHash: hash }, content: [{ type: 'text', text }] } })
  const events = [mk('aaaaaaaaaaaa', '旧清单'), mk('bbbbbbbbbbbb', '新清单')]
  const claimed = [userMsg('x')]
  const d = await h.preStep(SID, 3, 1, { events, claimed })
  // 两份的 hash 都不是当前工具集的 ⇒ 本步还会按当前工具集补一份；历史 2 + 本步 1 ⇒ 多出 2 份
  assert.equal(d.messages.filter(isCatalog).length, 1)
  assert.ok((await duplicatesOf(SID)) > 0, '历史里两份清单，计数却一无所知（catalogDuplicates=0）')
  assert.equal(await duplicatesOf(SID), 2)
  assert.equal(d.messages.filter((m) => !isCatalog(m)).length, 1, '计数不改本步装配里的其它消息')
})

test('history 模式只该影响走前缀路由的会话：已知走普通 provider 的会话不写清单', async () => {
  const SID = 'sess-normal'
  h.sessionEvent(SID, { type: 'request/header', data: { header: { config: { provider: 'deepseek', model: 'deepseek-chat' } } } })
  const status = await h.post(STATUS, { sessionId: SID })
  assert.equal(status.prefill.sessionRoute.matchesPrefix, false, '前置：插件自己知道这个会话没走前缀路由')
  const d = await h.preStep(SID, 1, 1, { events: [], claimed: [userMsg('hello')] })
  assert.equal(d.messages.filter(isCatalog).length, 0, '普通会话的历史里被写进了工具清单（永久，切回也不撤销）')
})

test('路由已知是前缀路由 / 还不知道（没发过请求）⇒ 照旧注入', async () => {
  const PREFIX = 'sess-prefix'
  h.sessionEvent(PREFIX, { type: 'request/header', data: { header: { config: { provider: 'prefill-think', model: 'deepseek-flash' } } } })
  const d1 = await h.preStep(PREFIX, 1, 1, { events: [], claimed: [userMsg('hello')] })
  assert.equal(d1.messages.filter(isCatalog).length, 1, '走前缀路由的会话照常注入')
  const d2 = await h.preStep('sess-unknown', 1, 1, { events: [], claimed: [userMsg('hello')] })
  assert.equal(d2.messages.filter(isCatalog).length, 1, '路由未知时保守：照常注入')
})
