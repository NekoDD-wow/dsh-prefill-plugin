// 测试 harness：在临时 DSH_HOME 里挂一份真实 impl.apply()，拿到它注册的 fetch 路由，
// 并给 impl 一个可观测的假 settings（llm-pi-ai 命名空间）。代理用真的（createReasoningPrefixProxy），
// 只监听 127.0.0.1，不打上游；端口由调用方用 freePort() 挑空闲的。
// 不依赖 mock.module，`npm test`（node --test）直接能跑。
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 找一个当前空闲、且后面 `span` 个端口也空闲的端口（代理端口被占时会顺序往后找）。 */
export async function freePort(span = 4) {
  // 跨测试进程并发时不能复用 Windows 临时端口（两个测试文件可能先后拿到同一个端口；
  // 且「刚关掉探测 socket 再 connect 相邻端口」会假成功）。改成：随机挑 20000–39999 的起点，
  // 同时绑定 start..start+span，绑满即真空闲；两个进程撞同一随机起点的概率极低。
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const start = 20000 + Math.floor(Math.random() * 20000)
    if (start + span > 65535) continue
    const held = []
    let ok = true
    for (let i = 0; i <= span; i += 1) {
      try {
        held.push(await new Promise((resolve, reject) => {
          const s = net.createServer()
          s.once('error', reject)
          s.listen(start + i, '127.0.0.1', () => resolve(s))
        }))
      } catch {
        ok = false
        break
      }
    }
    await Promise.all(held.map((s) => new Promise((resolve) => s.close(resolve))))
    if (ok) return start
  }
  throw new Error('找不到空闲端口')
}

/** 127.0.0.1:port 上有没有人在监听。 */
export function isListening(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

/** 假 settings（llm-pi-ai 命名空间）：describe / update / mutate，providers 可观测。 */
export function fakeSettings(initialProviders = {}) {
  const store = { providers: JSON.parse(JSON.stringify(initialProviders)), revision: 1 }
  return {
    store,
    describe: () => [{ ns: 'llm-pi-ai', value: { providers: store.providers }, revision: store.revision }],
    async update(key, patch) {
      store.providers = { ...store.providers, ...(patch?.providers ?? {}) }
      store.revision += 1
    },
    async mutate(key, ops) {
      for (const op of ops) {
        if (op.op === 'unset' && op.path[0] === 'providers') {
          const next = { ...store.providers }
          delete next[op.path[1]]
          store.providers = next
        }
      }
      store.revision += 1
    },
  }
}

/**
 * 挂一份 impl。impl.js 是模块单例（一个测试文件只 mount 一次）。
 * 可选 `tools`（假 tools 服务，`schemas()` 给工具清单用）；impl 注册的钩子都记下来，
 * 用 `preStep` / `sessionEvent` 模拟 DSH 调它们。
 * @param {{ state?: object, settings?: object, tools?: { schemas: () => any[] }, tag?: string }} opts
 */
export async function mount(opts = {}) {
  const HOME = mkdtempSync(join(tmpdir(), `prefill-${opts.tag ?? 'impl'}-`))
  process.env.DSH_HOME = HOME
  const DATA_DIR = join(HOME, 'prefill')
  const STATE_FILE = join(DATA_DIR, 'state.json')
  if (opts.state !== undefined) {
    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(STATE_FILE, JSON.stringify(opts.state, null, 2) + '\n', 'utf8')
  }
  const impl = await import('../impl.js')
  const routes = new Map()
  const hooks = new Map()
  const scope = {
    get: (name) => (name === 'connection' ? { fetch: { register: (def) => routes.set(def.path, def) } } : undefined),
    effect: (fn) => {
      try {
        fn()
      } catch {
        // 注册失败不影响本用例关心的路由。
      }
    },
  }
  impl.apply({
    effect: (fn) => {
      try {
        fn()
      } catch {
        // 同上。
      }
    },
    on: (name, fn) => {
      if (!hooks.has(name)) hooks.set(name, [])
      hooks.get(name).push(fn)
      return () => {}
    },
    get: (name) => {
      if (name === 'settings' && opts.settings !== undefined) return opts.settings
      if (name === 'tools' && opts.tools !== undefined) return opts.tools
      throw new Error('no service ' + name)
    },
    inject: (deps, cb) => cb(scope),
    logger: { info() {}, warn() {}, error() {} },
  })
  // 启动后 1s 有一次 applyReasoningState（按盘上状态自启）；等它跑完，避免和用例抢。
  await new Promise((resolve) => setTimeout(resolve, 1300))

  const post = async (path, body) => {
    const route = routes.get(path)
    if (route === undefined) throw new Error('route not registered: ' + path)
    const res = await route.fetch({ json: async () => body ?? {} })
    const text = await res.text()
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  const readStateFile = () => JSON.parse(readFileSync(STATE_FILE, 'utf8'))
  let bump = 0
  /** 直接写 state.json（模拟宿主 / 另一个进程改了状态），mtime 推到未来让 readState 的缓存失效。 */
  const seed = (state) => {
    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n', 'utf8')
    const t = new Date(Date.UTC(2032, 0, 1) + ++bump * 1000)
    utimesSync(STATE_FILE, t, t)
  }
  /**
   * 模拟一步 `agent/pre-step`：decision.messages 只有本步 claim 的消息（与 dsh-agent-loop 一致，**不含历史**），
   * 历史由 `events` 经 `agent.session.snapshotEvents()` 给出。返回（被 impl 原地改过的）decision。
   */
  const preStep = async (sessionId, turn, step, { events = [], claimed = [] } = {}) => {
    const decision = { kind: 'enter', messages: [...claimed] }
    const agent = { id: sessionId, session: { snapshotEvents: () => events } }
    const hook = hooks.get('agent/pre-step')?.[0]
    if (hook === undefined) throw new Error('agent/pre-step not registered')
    await hook({ agent, turn, step, messages: claimed }, async () => decision)
    return decision
  }
  /** 模拟一条 `session/event`（例如 request/header）。 */
  const sessionEvent = (sessionId, event) => {
    for (const fn of hooks.get('session/event') ?? []) fn({ id: sessionId }, event)
  }
  return { impl, HOME, DATA_DIR, STATE_FILE, routes, hooks, post, readStateFile, seed, preStep, sessionEvent }
}

/**
 * 兜底退出：被测代码若泄漏了监听中的代理（正是并发用例要抓的问题），进程会一直挂着，
 * 测试运行器只能等到超时。用例都跑完后给一个 unref 的定时器，泄漏时 2s 后强制退出（结果已上报）。
 */
export function exitIfLeaked(ms = 2000) {
  setTimeout(() => process.exit(process.exitCode ?? 0), ms).unref()
}
