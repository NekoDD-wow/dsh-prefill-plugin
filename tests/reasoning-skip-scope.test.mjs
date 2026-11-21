// 「清空本轮填装」（experimental/skip）的复位时机与作用域 —— 真实 impl.apply() + 假代理。
//
// 宿主事实（@deepseek-ai/dsh-agent-loop 0.2.2-rc.3，lib/index.js `turn()`）：
//   · `agent/turn-stopping` 只在本轮正常收尾时 serial 派发；
//   · 报错 / 被用户中断（catch 分支）、pre-step reject、首步没有消息，都不派发 turn-stopping；
//   · `turn/end` 写在 finally 里，以上所有情况都一定会写。
// 所以 skip 必须以 turn/end 复位，且按会话记（并发会话互不影响）。
//
// 需要把 createReasoningPrefixProxy 换成假代理才能拿到 impl 交给代理的 getConfig（不占端口、不打上游），
// 这要 `node --experimental-test-module-mocks`。`npm test` 不带这个 flag ⇒ 本文件自己带 flag 再跑一遍自己。
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

if (typeof mock.module !== 'function') {
  test('（本文件需要 --experimental-test-module-mocks：带上 flag 在子进程里重跑）', () => {
    const env = { ...process.env }
    // 父进程是 node --test 时，子进程继承 NODE_TEST_CONTEXT 会改走父子协议输出；去掉它，按普通 TAP 跑。
    delete env.NODE_TEST_CONTEXT
    const child = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--test', '--test-reporter=tap', fileURLToPath(import.meta.url)], { env, encoding: 'utf8', timeout: 60_000 })
    assert.equal(child.status, 0, '子进程用例失败：\n' + child.stdout + child.stderr)
  })
} else {
  await suite()
}

async function suite() {
  const HOME = mkdtempSync(join(tmpdir(), 'prefill-skip-scope-'))
  process.env.DSH_HOME = HOME
  const DATA_DIR = join(HOME, 'prefill')
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(join(DATA_DIR, 'state.json'), JSON.stringify({ ui: { experimental: true, reasoningPrefix: { enabled: true, prefix: '先想：', port: 47101 } } }, null, 2) + '\n', 'utf8')

  const proxies = []
  const fakeProxy = ({ getConfig, onOutcome } = {}) => {
    const proxy = {
      getConfig,
      onOutcome,
      port: null,
      closed: false,
      async listen(port) {
        proxy.port = port
        return port
      },
      async close() {
        proxy.closed = true
      },
      stats: () => ({ requests: 0 }),
      audit: () => [],
      resetStats() {},
    }
    proxies.push(proxy)
    return proxy
  }
  const real = await import('../reasoning-prefix.js?skip-scope-real')
  mock.module('../reasoning-prefix.js', { namedExports: { ...real, createReasoningPrefixProxy: fakeProxy } })
  const impl = await import('../impl.js')

  const routes = new Map()
  const hooks = new Map()
  const scope = {
    get: (name) => (name === 'connection' ? { fetch: { register: (def) => routes.set(def.path, def) } } : undefined),
    effect: (fn) => {
      try {
        fn()
      } catch {
        // 无关
      }
    },
  }
  impl.apply({
    effect: scope.effect,
    on: (name, fn) => {
      if (!hooks.has(name)) hooks.set(name, [])
      hooks.get(name).push(fn)
      return () => {}
    },
    get: (name) => {
      throw new Error('no service ' + name)
    },
    inject: (_deps, cb) => cb(scope),
    logger: { info() {}, warn() {}, error() {} },
  })
  // 启动时 1s 后的 applyReasoningState 先跑完（起假代理），避免与用例竞争。
  await new Promise((resolve) => setTimeout(resolve, 1200))

  const post = async (path, body) => {
    const route = routes.get(path)
    assert.ok(route !== undefined, 'route not registered: ' + path)
    const res = await route.fetch({ json: async () => body ?? {} })
    return JSON.parse(await res.text())
  }
  const preStep = async (sessionId, turn, step) => {
    const decision = { kind: 'enter', messages: [] }
    const agent = { id: sessionId, session: { snapshotEvents: () => [] } }
    await hooks.get('agent/pre-step')[0]({ agent, turn, step, messages: [] }, async () => decision)
  }
  const sessionEvent = (sessionId, event) => {
    for (const fn of hooks.get('session/event') ?? []) fn({ id: sessionId }, event)
  }
  const turnStopping = async (sessionId, turn) => {
    for (const fn of hooks.get('agent/turn-stopping') ?? []) await fn({ agent: { id: sessionId }, turn })
  }
  const turnEnd = (sessionId, turn, kind) => sessionEvent(sessionId, { type: 'turn/end', data: { turn, reason: { kind } } })

  const SKIP = '/api/dsh-prefill/experimental/skip'
  const STATUS = '/api/dsh-prefill/experimental/status'
  const liveConfig = () => {
    const live = proxies.filter((p) => !p.closed)
    assert.equal(live.length, 1, '应有且只有一个活代理')
    return live[0].getConfig()
  }
  /** 代理对「来自 sid 的请求」实际会不会跳过前缀：全局关（enabled:false / skipping:true）或按会话 isSkipping。 */
  const skippingFor = (sid) => {
    const config = liveConfig()
    return config.skipping === true || config.enabled === false || (typeof config.isSkipping === 'function' && config.isSkipping(sid) === true)
  }
  const panelSkipping = async (sid) => (await post(STATUS, { sessionId: sid })).prefill.skipping

  test('前置：代理已起，没人点跳过时不跳过', () => {
    assert.equal(liveConfig().enabled, true)
    assert.equal(skippingFor('sess-any'), false)
  })

  test('正常收尾（turn-stopping）：整轮跳过（含后续工具步），轮结束后恢复', async () => {
    await post(SKIP, { sessionId: 'sess-N', on: true })
    await preStep('sess-N', 1, 1)
    assert.equal(skippingFor('sess-N'), true)
    assert.equal(await panelSkipping('sess-N'), true)
    await preStep('sess-N', 1, 2) // 同一轮的工具步
    assert.equal(skippingFor('sess-N'), true, '多步工具轮的后续步也要跳过')
    await turnStopping('sess-N', 1)
    turnEnd('sess-N', 1, 'completed')
    assert.equal(skippingFor('sess-N'), false)
    assert.equal(await panelSkipping('sess-N'), false)
  })

  for (const kind of ['error', 'aborted', 'blocked']) {
    test(`跳过的那一轮以 ${kind} 结束（不发 agent/turn-stopping，只有 turn/end）：skip 必须复位，不能殃及之后所有会话`, async () => {
      const sid = 'sess-' + kind
      await post(SKIP, { sessionId: sid, on: true })
      await preStep(sid, 1, 1)
      assert.equal(skippingFor(sid), true, '本轮确实在跳过')
      turnEnd(sid, 1, kind)
      await preStep('sess-other-' + kind, 1, 1)
      assert.equal(skippingFor('sess-other-' + kind), false, 'skip 卡住了：之后所有会话的所有请求都被当成「跳过」')
      assert.equal(skippingFor(sid), false, '本会话下一轮也仍被跳过')
      assert.equal(await panelSkipping('sess-other-' + kind), skippingFor('sess-other-' + kind), '面板与代理说法不一致')
    })
  }

  test('A 跳过本轮时，并发会话 B（没点跳过）不被一起跳过；面板对 B 的说法与代理一致', async () => {
    await post(SKIP, { sessionId: 'sess-C', on: true })
    await preStep('sess-C', 1, 1)
    await preStep('sess-D', 1, 1)
    assert.equal(await panelSkipping('sess-D'), false)
    assert.equal(skippingFor('sess-D'), false, '代理对 D 的请求实际在跳过，面板却显示没在跳过')
    assert.equal(skippingFor('sess-C'), true, 'C 自己仍在跳过')
    assert.equal(await panelSkipping('sess-C'), true)
    turnEnd('sess-C', 1, 'completed')
  })

  test('两个会话先后点跳过：后者不把前者正在跳过的这一轮提前结束；各自轮结束各自复位', async () => {
    await post(SKIP, { sessionId: 'sess-E', on: true })
    await post(SKIP, { sessionId: 'sess-F', on: true })
    await preStep('sess-E', 1, 1)
    await preStep('sess-F', 1, 1)
    assert.equal(await panelSkipping('sess-E'), true, 'E 的这一轮还没结束，却已经不再跳过（被 F 覆盖）')
    assert.equal(skippingFor('sess-E'), true)
    assert.equal(skippingFor('sess-F'), true)
    turnEnd('sess-F', 1, 'aborted')
    assert.equal(skippingFor('sess-F'), false)
    assert.equal(skippingFor('sess-E'), true, 'F 的轮结束不应结束 E 的跳过')
    turnEnd('sess-E', 1, 'completed')
    assert.equal(skippingFor('sess-E'), false)
  })
}
