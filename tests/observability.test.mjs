// P0-1 前缀实效 / P2-11 前缀轮 step：面板与外部脚本读的就是这几个形状，锁住它们。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { noteSessionRouteFromEvent, parseLastJsonLine, prefixTurnEntry, reasoningProviderIdOf, resultRowSummaryOf, samplingOf, sessionRouteOf } from '../impl.js'

// ── F10 接线守卫：resolveTraceForBody 的作用域（v0.21.6 真机回归）────────────────
// 它被 `ensureReasoningProxy` 的 getConfig 闭包调用；如果被写进 `ctx.inject(['connection'], …)`
// 的路由作用域，闭包拿不到它 ⇒ 每次调用 ReferenceError、被代理侧 catch 吞掉 ⇒ 结果行
// sessionId 永远 null、routeConfidence 永远 none。这条源码守卫防止再被挪回去。
test('F10 接线：resolveTraceForBody 必须定义在 ctx.inject 之前（apply 作用域）', () => {
  const src = readFileSync(new URL('../impl.js', import.meta.url), 'utf8')
  const def = src.indexOf('const resolveTraceForBody')
  // 用带 `(scope)` 的完整形态，避开注释里那句 `ctx.inject(['connection'], …)`
  const inject = src.indexOf("ctx.inject(['connection'], (scope)")
  assert.ok(def > 0, '找不到 resolveTraceForBody 定义')
  assert.ok(inject > 0, "找不到 ctx.inject(['connection'])")
  assert.ok(def < inject, 'resolveTraceForBody 必须在 ctx.inject 之前定义，否则 ensureReasoningProxy 的闭包拿不到')
  assert.match(src, /resolveTrace: \(body\) => resolveTraceForBody\(body\)/)
})

// ── P0-1 sessionRouteOf：三态 ────────────────────────────────────────────────
test('sessionRouteOf：没有 request/header ⇒ null（未知，不得退化成 false）', () => {
  // 新会话、刚重启、或还没发过消息：面板必须显示「未知」而不是「前缀没生效」。
  // 退化成 false 会让每个新会话都稳定误报，这是本函数存在的唯一理由。
  assert.equal(sessionRouteOf(undefined, 'prefill-think'), null)
  assert.equal(sessionRouteOf(null, 'prefill-think'), null)
  assert.equal(sessionRouteOf('nonsense', 'prefill-think'), null)
  assert.equal(sessionRouteOf(42, 'prefill-think'), null)
  // provider 是空串（事件形状不对）同样按未知处理，不要伪造一个 matchesPrefix:false。
  assert.equal(sessionRouteOf({ model: 'x', at: 1 }, 'prefill-think'), null)
  assert.equal(sessionRouteOf({ provider: '', model: 'x' }, 'prefill-think'), null)
})

test('sessionRouteOf：实际路由就是前缀路由 ⇒ matchesPrefix:true', () => {
  const route = sessionRouteOf({ provider: 'prefill-think', model: 'deepseek-flash', at: 1793802485339 }, 'prefill-think')
  assert.deepEqual(route, { provider: 'prefill-think', model: 'deepseek-flash', matchesPrefix: true, at: 1793802485339 })
})

test('sessionRouteOf：实际路由是别的 provider ⇒ matchesPrefix:false（这才是真告警）', () => {
  const route = sessionRouteOf({ provider: 'deepseek-official', model: 'deepseek-chat', at: 7 }, 'prefill-think')
  assert.deepEqual(route, { provider: 'deepseek-official', model: 'deepseek-chat', matchesPrefix: false, at: 7 })
})

test('sessionRouteOf：providerId 改名后旧会话立刻判为不匹配（配置改动要能反映出来）', () => {
  const known = { provider: 'prefill-think', model: 'deepseek-flash', at: 1 }
  assert.equal(sessionRouteOf(known, 'prefill-think').matchesPrefix, true)
  assert.equal(sessionRouteOf(known, 'prefill-think-2').matchesPrefix, false)
})

test('sessionRouteOf：model 缺失 / at 非法时给出稳定默认值', () => {
  assert.deepEqual(sessionRouteOf({ provider: 'p', at: 'x' }, 'p'), { provider: 'p', model: '', matchesPrefix: true, at: 0 })
  assert.equal(sessionRouteOf({ provider: 'p' }, 'p').model, '')
})

// ── P0-1 reasoningProviderIdOf：与 reasoningConfigOf 同一套兜底 ───────────────
test('reasoningProviderIdOf：空 / 非对象 / 空串一律回落到默认路由名', () => {
  assert.equal(reasoningProviderIdOf(undefined, 'prefill-think'), 'prefill-think')
  assert.equal(reasoningProviderIdOf(null, 'prefill-think'), 'prefill-think')
  assert.equal(reasoningProviderIdOf([], 'prefill-think'), 'prefill-think')
  assert.equal(reasoningProviderIdOf({ providerId: '' }, 'prefill-think'), 'prefill-think')
  assert.equal(reasoningProviderIdOf({ providerId: 42 }, 'prefill-think'), 'prefill-think')
  assert.equal(reasoningProviderIdOf({ providerId: 'my-route' }, 'prefill-think'), 'my-route')
})

// ── P2-11 prefixTurnEntry：step 进日志，旧行缺键仍可读 ───────────────────────
test('prefixTurnEntry：带上 sessionId/turn/step，面板与代理日志能对上', () => {
  const entry = prefixTurnEntry({ sessionId: 'session-1', turn: 6, step: 2, at: 123, enabled: true, proxyRunning: true, reasoningPrefix: '他喵', contentPrefix: '好的', skipped: false })
  assert.deepEqual(entry, { sessionId: 'session-1', turn: 6, step: 2, at: 123, enabled: true, proxyRunning: true, reasoningPrefix: '他喵', contentPrefix: '好的', skipped: false })
})

test('prefixTurnEntry：step 缺失 ⇒ 1（每轮第一步是默认），turn/at 非法 ⇒ 0', () => {
  const entry = prefixTurnEntry({ sessionId: 's', turn: 'x', at: 'y' })
  assert.equal(entry.step, 1)
  assert.equal(entry.turn, 0)
  assert.equal(entry.at, 0)
  // 布尔字段严格化：不是 true 就是 false，不会把 undefined / 'yes' 透出去。
  assert.equal(entry.enabled, false)
  assert.equal(entry.proxyRunning, false)
  assert.equal(entry.skipped, false)
})

test('prefixTurnEntry：旧日志行（没有 step 键）解析后仍按「未知」处理，不做历史回填', () => {
  // 模拟从旧 prefix-log.jsonl 读回来的一行：没有 step 键。
  const legacy = { sessionId: 's', turn: 3, at: 9, enabled: true, proxyRunning: false, reasoningPrefix: '', contentPrefix: '', skipped: true }
  assert.equal(Object.hasOwn(legacy, 'step'), false)
  assert.equal(legacy.step, undefined)
  // 面板侧的口径：缺键 = 未知（不是 1，也不是报错）。
  assert.equal(legacy.step ?? null, null)
})

// ── P0-1 noteSessionRouteFromEvent：事件形状是契约，锁住它 ────────────────────
// 真实形状见 .e2e 里录下来的会话日志（request/header → data.header.config.provider/model）。
const headerEvent = (config) => ({ type: 'request/header', data: { header: { config, reason: 'initial' } } })

test('noteSessionRouteFromEvent：按 request/header 的真实形状写入 provider/model', () => {
  const routes = new Map()
  const ok = noteSessionRouteFromEvent(routes, 'session-a', headerEvent({ provider: 'prefill-think', model: 'deepseek-flash' }), 1234)
  assert.equal(ok, true)
  assert.deepEqual(routes.get('session-a'), { provider: 'prefill-think', model: 'deepseek-flash', at: 1234 })
})

test('noteSessionRouteFromEvent：形状不对一律不写（宁可不记，也不要记半个对象）', () => {
  const cases = [
    ['事件类型不对', 'turn/end', headerEvent({ provider: 'p', model: 'm' })],
    ['没有 data', 'request/header', { type: 'request/header' }],
    ['没有 header', 'request/header', { type: 'request/header', data: {} }],
    ['没有 config', 'request/header', { type: 'request/header', data: { header: {} } }],
    ['config 是数组', 'request/header', { type: 'request/header', data: { header: { config: [] } } }],
    ['config 是 null', 'request/header', { type: 'request/header', data: { header: { config: null } } }],
    ['provider 缺失', 'request/header', headerEvent({ model: 'm' })],
    ['provider 不是字符串', 'request/header', headerEvent({ provider: 42, model: 'm' })],
    ['provider 是空串', 'request/header', headerEvent({ provider: '', model: 'm' })],
  ]
  for (const [name, type, event] of cases) {
    const routes = new Map()
    assert.equal(noteSessionRouteFromEvent(routes, 'session-a', { ...event, type }, 1), false, name)
    assert.equal(routes.size, 0, name + '：不应写入任何条目')
  }
  // sessionId 不合法同样不写。
  const routes = new Map()
  assert.equal(noteSessionRouteFromEvent(routes, '', headerEvent({ provider: 'p' }), 1), false)
  assert.equal(noteSessionRouteFromEvent(routes, undefined, headerEvent({ provider: 'p' }), 1), false)
  assert.equal(routes.size, 0)
})

test('noteSessionRouteFromEvent：model 缺失/非字符串补空串，at 非法补 0（仍算记下了一条）', () => {
  const routes = new Map()
  assert.equal(noteSessionRouteFromEvent(routes, 's', headerEvent({ provider: 'prefill-think' }), 'x'), true)
  assert.deepEqual(routes.get('s'), { provider: 'prefill-think', model: '', at: 0 })
  noteSessionRouteFromEvent(routes, 's', headerEvent({ provider: 'prefill-think', model: 7 }), 5)
  assert.equal(routes.get('s').model, '')
})

test('noteSessionRouteFromEvent：同一会话再发请求会覆盖成最新一条（面板看的是「最近一次实际路由」）', () => {
  const routes = new Map()
  noteSessionRouteFromEvent(routes, 's', headerEvent({ provider: 'deepseek-official', model: 'deepseek-chat' }), 1)
  assert.equal(sessionRouteOf(routes.get('s'), 'prefill-think').matchesPrefix, false)
  noteSessionRouteFromEvent(routes, 's', headerEvent({ provider: 'prefill-think', model: 'deepseek-flash' }), 2)
  assert.equal(sessionRouteOf(routes.get('s'), 'prefill-think').matchesPrefix, true)
  assert.equal(routes.size, 1)
})

test('noteSessionRouteFromEvent：多会话互不干扰', () => {
  const routes = new Map()
  noteSessionRouteFromEvent(routes, 'a', headerEvent({ provider: 'prefill-think' }), 1)
  noteSessionRouteFromEvent(routes, 'b', headerEvent({ provider: 'deepseek-official' }), 2)
  assert.equal(sessionRouteOf(routes.get('a'), 'prefill-think').matchesPrefix, true)
  assert.equal(sessionRouteOf(routes.get('b'), 'prefill-think').matchesPrefix, false)
})

// ── F14：结果行尾部读取（面板只回 6 字段） ───────────────────────────────────
test('parseLastJsonLine：取最后一条能解析的行（尾部窗口从行中间切开也要兜住）', () => {
  const full = '{"at":1,"verdict":"error"}\n{"at":2,"verdict":"reasoning-collected"}\n'
  assert.equal(parseLastJsonLine(full).at, 2)
  // 尾部 8KB 窗口的常见形态：第一行是残的，最后一行完整。
  assert.equal(parseLastJsonLine('{残行不能解析\n{"at":3,"verdict":"passthrough"}\n').at, 3)
  // 文件正在被追加：最后一行只写了一半 ⇒ 往前退到上一条完整的。
  assert.equal(parseLastJsonLine('{"at":1}\n{"at":2,"verdi').at, 1)
  // 空 / 全残 ⇒ null，不抛。
  assert.equal(parseLastJsonLine(''), null)
  assert.equal(parseLastJsonLine('不是 JSON\n'), null)
  assert.equal(parseLastJsonLine(null), null)
})

test('resultRowSummaryOf：只回 6 个字段，正文片段绝不带上行', () => {
  const row = {
    at: 1793802485339,
    requestId: 'req-1',
    armId: 'A1',
    runId: 'r-7',
    verdict: 'reasoning-collected',
    status: 200,
    attempts: [{ variant: 'system', status: 200, ok: true, ms: 12 }],
    textHead: '这里是模型正文的前 80 字……',
    textTail: '……尾部',
    reasoningHead: '思考开头',
    usage: { prompt: 1, completion: 2, cacheHit: 0, cacheMiss: 1 },
  }
  const summary = resultRowSummaryOf(row)
  assert.deepEqual(summary, { armId: 'A1', runId: 'r-7', verdict: 'reasoning-collected', status: 200, attemptsLength: 1, at: 1793802485339 })
  // 隐私口径：轮询路由不得把正文/思考片段带回浏览器。
  assert.equal(Object.hasOwn(summary, 'textHead'), false)
  assert.equal(Object.hasOwn(summary, 'textTail'), false)
  assert.equal(Object.hasOwn(summary, 'reasoningHead'), false)
  assert.equal(Object.hasOwn(summary, 'usage'), false)
})

test('resultRowSummaryOf：缺字段 / 形状不对时给稳定默认值，不抛', () => {
  assert.equal(resultRowSummaryOf(null), null)
  assert.equal(resultRowSummaryOf('nope'), null)
  assert.equal(resultRowSummaryOf([]), null)
  assert.deepEqual(resultRowSummaryOf({}), { armId: '', runId: '', verdict: 'unknown', status: null, attemptsLength: 0, at: null })
  // attempts 不是数组 ⇒ 0（不是 undefined）；status/at 非数字 ⇒ null。
  assert.deepEqual(resultRowSummaryOf({ attempts: 'x', status: 'y', at: 'z' }), { armId: '', runId: '', verdict: 'unknown', status: null, attemptsLength: 0, at: null })
})

// ── P1-5 samplingOf：留空 ≠ 0 ────────────────────────────────────────────────
test('samplingOf：留空 / null 成员 = 不干预；0 是合法值，必须能表达', () => {
  assert.equal(samplingOf(null), null)
  assert.equal(samplingOf(undefined), null)
  assert.equal(samplingOf({}), null)
  assert.equal(samplingOf({ temperature: null, topP: null, seed: null }), null)
  // 0 温度是合法且常用的（确定性采样），不能被当成「没设」。
  assert.deepEqual(samplingOf({ temperature: 0 }), { temperature: 0 })
  assert.deepEqual(samplingOf({ topP: 0 }), { topP: 0 })
  assert.deepEqual(samplingOf({ seed: 0 }), { seed: 0 })
})

test('samplingOf：越界 / 非数字 / 非整数一律丢掉该成员', () => {
  assert.equal(samplingOf({ temperature: 5 }), null)
  assert.equal(samplingOf({ temperature: -1 }), null)
  assert.equal(samplingOf({ topP: 1.5 }), null)
  assert.equal(samplingOf({ seed: 1.5 }), null)
  assert.equal(samplingOf({ seed: -1 }), null)
  assert.equal(samplingOf({ temperature: Number.NaN }), null)
  assert.equal(samplingOf({ temperature: '0.5' }), null)
  // 一好一坏 ⇒ 只留好的。
  assert.deepEqual(samplingOf({ temperature: 0.3, topP: 9, seed: 42 }), { temperature: 0.3, seed: 42 })
})
