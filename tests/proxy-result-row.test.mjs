// reasoning 代理的结果行 / stats 字段要和真实发出去的请求一致：
// catalogRole 写生效变体；shim 关时没注入清单就不能记 catalogInjected:true；
// 前缀模板变量 {{provider}} / {{turn}} / {{session}} 要展开；臂桶满了丢的是最早建的臂；
// parseUsage 按 Anthropic 口径把缓存读 / 写加回总输入。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createReasoningPrefixProxy, parseUsage } from '../reasoning-prefix.js'
import { startUpstream, startProxy, post, sse, BODY, sleep } from './proxy-upstream-harness.mjs'

const CATALOG_MARK = '【前缀模式工具说明】'
const OK = () => ({ chunks: [sse({ choices: [{ index: 0, delta: { content: 'ok' } }] }), sse({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })] })
const REJECT = () => ({ status: 400, headers: { 'content-type': 'application/json' }, chunks: [JSON.stringify({ error: { message: 'bad' } })] })

const go = async (handler, config = {}) => {
  const up = await startUpstream(handler)
  const px = await startProxy({ upstream: up, config })
  try {
    const res = await post(px.url, BODY)
    await sleep(30)
    return { res, rows: px.rows(), stats: px.proxy.stats(), up }
  } finally {
    await px.close()
    await up.close()
  }
}

test('catalogRole 写生效变体：system-first 首个变体成功 ⇒ system（以前永远是 user）', async () => {
  const r = await go(OK, { fallbackOrder: 'system-first' })
  assert.equal(r.rows.length, 1)
  assert.equal(r.rows[0].variant, 'system')
  assert.equal(r.rows[0].catalogRole, 'system')
})

test('catalogRole 写生效变体：system 被拒、退到 user ⇒ user', async () => {
  const r = await go((n) => (n === 1 ? REJECT() : OK()), { fallbackOrder: 'system-first' })
  assert.equal(r.rows[0].variant, 'user')
  assert.equal(r.rows[0].catalogRole, 'user')
})

test('catalogRole：前缀版都被拒、退回透传 ⇒ null（透传没带清单）', async () => {
  const r = await go((n) => (n <= 2 ? REJECT() : OK()), { fallbackOrder: 'system-first' })
  assert.equal(r.rows[0].variant, 'passthrough')
  assert.equal(r.rows[0].catalogRole, null)
})

test('shim 关（prefixed 变体）：上游没收到清单，结果行与 lastRequest 都记 catalogInjected:false', async () => {
  const r = await go(OK, { shim: false })
  assert.ok(!JSON.stringify(r.up.bodies[0].messages).includes(CATALOG_MARK), '前提：上游确实没收到清单')
  assert.equal(r.rows[0].variant, 'prefixed')
  assert.equal(r.rows[0].catalogInjected, false)
  assert.equal(r.rows[0].catalogRole, null)
  assert.equal(r.stats.lastRequest.catalogInjected, false)
})

test('shim 开：上游收到清单，catalogInjected 仍是 true（不回归）', async () => {
  const r = await go(OK)
  assert.ok(JSON.stringify(r.up.bodies[0].messages).includes(CATALOG_MARK))
  assert.equal(r.rows[0].catalogInjected, true)
  assert.equal(r.stats.lastRequest.catalogInjected, true)
})

test('前缀模板变量 {{provider}} / {{turn}} / {{session}} 在发上游前展开', async () => {
  const r = await go(OK, {
    reasoningPrefix: '[{{provider}}|{{turn}}|{{session}}|{{model}}]',
    providerId: 'prefill-think',
    resolveTrace: () => ({ sessionId: 's1', turn: 3, step: 1, confidence: 'content' }),
  })
  const sent = r.up.bodies[0].messages.at(-1).reasoning_content
  assert.equal(sent, '[prefill-think|3|s1|deepseek-chat]', '发出去的思考前缀：' + sent)
  assert.equal(r.stats.lastRequest.reasoningPrefix, '[prefill-think|3|s1|deepseek-chat]')
  assert.equal(r.rows[0].prefix.reasoningLen, sent.length)
})

test('前缀模板变量：关联不上会话时 {{turn}} / {{session}} 原样保留（不填 null）', async () => {
  const r = await go(OK, { reasoningPrefix: '[{{provider}}|{{turn}}|{{session}}]', providerId: 'prefill-think' })
  assert.equal(r.up.bodies[0].messages.at(-1).reasoning_content, '[prefill-think|{{turn}}|{{session}}]')
})

test('臂桶满 32 个时丢最早建的臂，不受数字臂名在 Object.keys 里排前的影响', async () => {
  const up = await startUpstream(OK)
  let arm = ''
  const proxy = createReasoningPrefixProxy({ getConfig: () => ({ enabled: true, upstream: 'http://127.0.0.1:' + up.port, reasoningPrefix: 'p', shim: true, armId: arm }) })
  const port = await proxy.listen(0)
  const url = 'http://127.0.0.1:' + port + '/v1/chat/completions'
  try {
    for (let i = 0; i < 31; i += 1) {
      arm = 'A' + i
      await post(url, BODY)
    }
    arm = '7' // 第 32 个，也是最新的
    await post(url, BODY)
    arm = 'B' // 满了，应丢最早的 A0
    await post(url, BODY)
    let keys = Object.keys(proxy.stats().arms)
    assert.equal(keys.length, 32)
    assert.ok(keys.includes('7'), '最新的臂 "7" 被淘汰')
    assert.ok(!keys.includes('A0'), '最早的 A0 还在')
    // resetStats 后插入顺序一并清空：再建 32 个臂不会去删一个已不存在的旧名
    proxy.resetStats()
    for (let i = 0; i < 33; i += 1) {
      arm = 'C' + i
      await post(url, BODY)
    }
    keys = Object.keys(proxy.stats().arms)
    assert.equal(keys.length, 32)
    assert.ok(!keys.includes('C0') && keys.includes('C32'))
  } finally {
    await proxy.close()
    await up.close()
  }
})

test('parseUsage（Anthropic 口径）：input_tokens 不含缓存读 / 写，总输入 = 三者之和', () => {
  const u = parseUsage({ input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50, output_tokens: 5 })
  assert.deepEqual(u, { prompt: 1060, completion: 5, cacheHit: 1000, cacheMiss: 60 })
  // DeepSeek / OpenAI 口径不受影响
  assert.deepEqual(parseUsage({ prompt_tokens: 100, completion_tokens: 3, prompt_cache_hit_tokens: 64, prompt_cache_miss_tokens: 36 }), { prompt: 100, completion: 3, cacheHit: 64, cacheMiss: 36 })
  assert.deepEqual(parseUsage({ prompt_tokens: 100, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 80 } }), { prompt: 100, completion: 3, cacheHit: 80, cacheMiss: 20 })
})
