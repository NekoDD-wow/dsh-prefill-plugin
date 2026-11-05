// 实验性功能总开关 + 实验面板：状态白名单 / 代理累计统计（v0.20.2）。
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { normalizeState, sanitizePrefixPresets, sanitizeUi } from '../impl.js'
import { TOOL_CATALOG_MARK, buildToolCatalog, createReasoningPrefixProxy, hasToolCatalogMessage, interpolatePrefixVars, parseUsage } from '../reasoning-prefix.js'

test('sanitizeUi：实验性功能默认关，只有 true 才落盘', () => {
  assert.deepEqual(sanitizeUi({ experimental: true }), { experimental: true })
  assert.equal(sanitizeUi({ experimental: false }), undefined)
  assert.equal(sanitizeUi({ experimental: 'yes' }), undefined)
  assert.equal(sanitizeUi({ experimental: 1 }), undefined)
})

test('sanitizeUi：内容前缀按字符串收，超长截到 2000', () => {
  assert.equal(sanitizeUi({ reasoningPrefix: { contentPrefix: '好的' } }).reasoningPrefix.contentPrefix, '好的')
  assert.equal(sanitizeUi({ reasoningPrefix: { contentPrefix: 'x'.repeat(3000) } }).reasoningPrefix.contentPrefix.length, 2000)
  assert.equal(sanitizeUi({ reasoningPrefix: { contentPrefix: 1 } }).reasoningPrefix.contentPrefix, undefined)
})

test('sanitizeUi：实验面板暴露的两个硬编码参数有范围校验', () => {
  const ok = sanitizeUi({ reasoningPrefix: { enabled: true, maxEmittedCalls: 12, failureThreshold: 5 } })
  assert.equal(ok.reasoningPrefix.maxEmittedCalls, 12)
  assert.equal(ok.reasoningPrefix.failureThreshold, 5)
  assert.equal(sanitizeUi({ reasoningPrefix: { maxEmittedCalls: 99 } }).reasoningPrefix.maxEmittedCalls, undefined)
  assert.equal(sanitizeUi({ reasoningPrefix: { maxEmittedCalls: 0 } }).reasoningPrefix.maxEmittedCalls, undefined)
  assert.equal(sanitizeUi({ reasoningPrefix: { failureThreshold: 11 } }).reasoningPrefix.failureThreshold, undefined)
  assert.equal(sanitizeUi({ reasoningPrefix: { failureThreshold: 1.5 } }).reasoningPrefix.failureThreshold, undefined)
})

test('sanitizeUi：shim / textualize 能往返（白名单漏了就会「保存提示成功、值不落盘、复选框回弹」）', () => {
  const off = sanitizeUi({ reasoningPrefix: { enabled: true, prefix: 'p', shim: false, textualize: false } })
  assert.equal(off.reasoningPrefix.shim, false)
  assert.equal(off.reasoningPrefix.textualize, false)
  // 归一化（写盘 → 读盘）之后仍然在：这正是修复前丢掉这两个键的那一步
  const roundTrip = normalizeState({ ui: { experimental: true, reasoningPrefix: { enabled: true, prefix: 'p', shim: false, textualize: false } } })
  assert.equal(roundTrip.ui.reasoningPrefix.shim, false)
  assert.equal(roundTrip.ui.reasoningPrefix.textualize, false)
  const on = normalizeState({ ui: { reasoningPrefix: { shim: true, textualize: true } } })
  assert.equal(on.ui.reasoningPrefix.shim, true)
  assert.equal(on.ui.reasoningPrefix.textualize, true)
  // 非布尔仍然丢掉
  assert.equal(sanitizeUi({ reasoningPrefix: { shim: 'no' } }).reasoningPrefix.shim, undefined)
})

test('工具清单详略：full > brief > names；history 模式靠固定标记判断是否已在历史里', () => {
  const schemas = [
    {
      name: 'read',
      description: '读取文件内容的工具，支持偏移与长度限制，返回带行号的文本。'.repeat(6),
      parameters: { type: 'object', properties: { file_path: { type: 'string', description: '路径' }, limit: { type: 'number' } }, required: ['file_path'] },
    },
    { name: 'glob', description: '按通配符找文件', parameters: { type: 'object', properties: { pattern: { type: 'string' } }, required: ['pattern'] } },
  ]
  const full = buildToolCatalog(schemas)
  const brief = buildToolCatalog(schemas, { detail: 'brief' })
  const names = buildToolCatalog(schemas, { detail: 'names' })
  assert.ok(full.length > brief.length, 'full 应比 brief 长')
  assert.ok(brief.length > names.length, 'brief 应比 names 长')
  assert.match(full, /file_path:string\(必填/)
  assert.match(brief, /；参数：file_path，limit/)
  assert.match(names, /^- read$/m)
  assert.match(names, /^- glob$/m)
  assert.ok(names.includes(TOOL_CATALOG_MARK))
  assert.equal(hasToolCatalogMessage([{ role: 'user', content: '你好' }]), false)
  assert.equal(hasToolCatalogMessage([{ role: 'user', content: [{ type: 'text', text: '前言\n' + TOOL_CATALOG_MARK }] }]), true)
})

test('sanitizeUi：清单三个口径（注入方式 / 详略 / 位置）取值校验', () => {
  const good = sanitizeUi({ reasoningPrefix: { catalogMode: 'history', catalogDetail: 'names', catalogPosition: 'tail' } })
  assert.deepEqual(good, { reasoningPrefix: { catalogMode: 'history', catalogDetail: 'names', catalogPosition: 'tail' } })
  const bad = sanitizeUi({ reasoningPrefix: { catalogMode: 'x', catalogDetail: 'y', catalogPosition: 'z' } })
  assert.deepEqual(bad, { reasoningPrefix: {} })
})

test('sanitizeUi：代理日志开关 / 路径白名单校验（P0）', () => {
  const good = sanitizeUi({ reasoningPrefix: { logging: { enabled: true, file: 'D:/x/proxy.jsonl' } } })
  assert.deepEqual(good, { reasoningPrefix: { logging: { enabled: true, file: 'D:/x/proxy.jsonl' } } })
  // F5：显式 false 必须落盘 —— 以前只放行 true，于是「打开过日志再想关掉」做不到
  // （面板提交的 false 被丢弃，盘上留着 true）。读侧语义不变：缺省仍是关。
  const off = sanitizeUi({ reasoningPrefix: { logging: { enabled: false, file: 'D:/x/proxy.jsonl' } } })
  assert.deepEqual(off, { reasoningPrefix: { logging: { enabled: false, file: 'D:/x/proxy.jsonl' } } })
  const bad = sanitizeUi({ reasoningPrefix: { logging: { enabled: 'yes', file: 42 } } })
  assert.deepEqual(bad, { reasoningPrefix: {} })
})

test('sanitizeUi：实验模式（ignoreFailures）可持久，非布尔值被丢', () => {
  assert.deepEqual(sanitizeUi({ reasoningPrefix: { ignoreFailures: true } }), { reasoningPrefix: { ignoreFailures: true } })
  assert.deepEqual(sanitizeUi({ reasoningPrefix: { ignoreFailures: false } }), { reasoningPrefix: { ignoreFailures: false } })
  assert.deepEqual(sanitizeUi({ reasoningPrefix: { ignoreFailures: 'yes' } }), { reasoningPrefix: {} })
})

// ── 阶段 B：结果行 / 分桶 / 采样 的白名单（漏一个就是「保存提示成功、值不落盘」） ──
test('sanitizeUi：结果行开关默认开、显式 false 可持久（否则重演「打开过就关不掉」）', () => {
  assert.deepEqual(sanitizeUi({ reasoningPrefix: { logging: { resultEnabled: false } } }), { reasoningPrefix: { logging: { resultEnabled: false } } })
  assert.deepEqual(sanitizeUi({ reasoningPrefix: { logging: { resultEnabled: true } } }), { reasoningPrefix: { logging: { resultEnabled: true } } })
  assert.deepEqual(sanitizeUi({ reasoningPrefix: { logging: { resultEnabled: 'yes' } } }), { reasoningPrefix: {} })
})

test('sanitizeUi：结果行路径 / reasoning 收集 / 正文片段三个键可往返', () => {
  const out = sanitizeUi({ reasoningPrefix: { logging: { resultFile: 'D:/x/result.jsonl', reasoningHead: true, snippets: false } } })
  assert.deepEqual(out, { reasoningPrefix: { logging: { resultFile: 'D:/x/result.jsonl', reasoningHead: true, snippets: false } } })
  // 非布尔 / 非字符串被丢，不会写坏状态。
  assert.deepEqual(sanitizeUi({ reasoningPrefix: { logging: { reasoningHead: 1, snippets: 'no', resultFile: 42 } } }), { reasoningPrefix: {} })
})

test('sanitizeUi：armId / runId 截到 60 字；非字符串被丢', () => {
  assert.deepEqual(sanitizeUi({ reasoningPrefix: { armId: 'A1', runId: 'r-7' } }), { reasoningPrefix: { armId: 'A1', runId: 'r-7' } })
  assert.deepEqual(sanitizeUi({ reasoningPrefix: { armId: 'x'.repeat(80) } }), { reasoningPrefix: { armId: 'x'.repeat(60) } })
  assert.deepEqual(sanitizeUi({ reasoningPrefix: { armId: 7, runId: [] } }), { reasoningPrefix: {} })
  // 空串 = 显式清空，要落盘（不然「取消分臂」做不到）。
  assert.deepEqual(sanitizeUi({ reasoningPrefix: { armId: '' } }), { reasoningPrefix: { armId: '' } })
})

test('sanitizeUi：采样覆盖只留合法成员；null / 全非法 ⇒ 存成 {}（= 不干预，且能覆盖掉旧值）', () => {
  assert.deepEqual(sanitizeUi({ reasoningPrefix: { sampling: { temperature: 0.3, topP: 0.9, seed: 42 } } }), { reasoningPrefix: { sampling: { temperature: 0.3, topP: 0.9, seed: 42 } } })
  // 0 是合法温度：不能被当成「没设」而丢掉。
  assert.deepEqual(sanitizeUi({ reasoningPrefix: { sampling: { temperature: 0 } } }), { reasoningPrefix: { sampling: { temperature: 0 } } })
  // 越界成员被丢；剩下的仍然保留。
  assert.deepEqual(sanitizeUi({ reasoningPrefix: { sampling: { temperature: 5, seed: 7 } } }), { reasoningPrefix: { sampling: { seed: 7 } } })
  // 整体 null / 成员全非法 ⇒ {}（显式清空覆盖，而不是「键不存在导致旧值留在盘上」）。
  assert.deepEqual(sanitizeUi({ reasoningPrefix: { sampling: null } }), { reasoningPrefix: { sampling: {} } })
  assert.deepEqual(sanitizeUi({ reasoningPrefix: { sampling: { temperature: 99 } } }), { reasoningPrefix: { sampling: {} } })
  assert.deepEqual(sanitizeUi({ reasoningPrefix: { sampling: [] } }), { reasoningPrefix: {} })
})

// ── 日志轮转（单文件上限 + 保留历史数） ──────────────────────────────────────
test('sanitizeUi：轮转两个键可往返；0 是合法值（= 不轮转 / 不留历史）', () => {
  assert.deepEqual(sanitizeUi({ reasoningPrefix: { logging: { maxBytes: 8388608, keepFiles: 3 } } }), {
    reasoningPrefix: { logging: { maxBytes: 8388608, keepFiles: 3 } },
  })
  // 0 = 不轮转（maxBytes）/ 不留历史（keepFiles）：必须能表达，不能被当成「没设」。
  assert.deepEqual(sanitizeUi({ reasoningPrefix: { logging: { maxBytes: 0 } } }), { reasoningPrefix: { logging: { maxBytes: 0 } } })
  assert.deepEqual(sanitizeUi({ reasoningPrefix: { logging: { keepFiles: 0 } } }), { reasoningPrefix: { logging: { keepFiles: 0 } } })
})

test('sanitizeUi：轮转两个键越界 / 非整数一律丢掉该键（不写坏状态）', () => {
  // 上限：0..1GB
  assert.deepEqual(sanitizeUi({ reasoningPrefix: { logging: { maxBytes: -1 } } }), { reasoningPrefix: {} })
  assert.deepEqual(sanitizeUi({ reasoningPrefix: { logging: { maxBytes: 1073741825 } } }), { reasoningPrefix: {} })
  assert.deepEqual(sanitizeUi({ reasoningPrefix: { logging: { maxBytes: 1.5 } } }), { reasoningPrefix: {} })
  assert.deepEqual(sanitizeUi({ reasoningPrefix: { logging: { maxBytes: '8' } } }), { reasoningPrefix: {} })
  // 保留数：0..9
  assert.deepEqual(sanitizeUi({ reasoningPrefix: { logging: { keepFiles: -1 } } }), { reasoningPrefix: {} })
  assert.deepEqual(sanitizeUi({ reasoningPrefix: { logging: { keepFiles: 10 } } }), { reasoningPrefix: {} })
  assert.deepEqual(sanitizeUi({ reasoningPrefix: { logging: { keepFiles: 2.5 } } }), { reasoningPrefix: {} })
})

test('前缀模板变量：date/time/model 展开，认不出的原样保留', () => {
  assert.equal(interpolatePrefixVars('{{date}} 今天 {{time}}', { date: '2026-11-03', time: '12:00:00' }), '2026-11-03 今天 12:00:00')
  assert.equal(interpolatePrefixVars('模型={{model}}', { model: 'deepseek-flash' }), '模型=deepseek-flash')
  assert.equal(interpolatePrefixVars('保留 {{unknown}}', {}), '保留 {{unknown}}')
  assert.equal(interpolatePrefixVars('无变量', {}), '无变量')
  assert.equal(interpolatePrefixVars(undefined, {}), undefined)
})

test('sanitizeUi：P1 回退顺序 / 允许透传 / 清单包含排除', () => {
  const good = sanitizeUi({
    reasoningPrefix: {
      fallbackOrder: 'user-first',
      allowPassthrough: false,
      catalogInclude: ['read', ' write ', ''],
      catalogExclude: ['bash'],
    },
  })
  assert.deepEqual(good, {
    reasoningPrefix: { fallbackOrder: 'user-first', allowPassthrough: false, catalogInclude: ['read', 'write'], catalogExclude: ['bash'] },
  })
  const bad = sanitizeUi({ reasoningPrefix: { fallbackOrder: 'nope', catalogInclude: 'read' } })
  assert.deepEqual(bad, { reasoningPrefix: {} })
})

test('parseUsage：DeepSeek / OpenAI / Anthropic 三种口径都能读', () => {
  assert.deepEqual(parseUsage({ prompt_tokens: 1000, completion_tokens: 20, prompt_cache_hit_tokens: 900, prompt_cache_miss_tokens: 100 }), {
    prompt: 1000,
    completion: 20,
    cacheHit: 900,
    cacheMiss: 100,
  })
  assert.deepEqual(parseUsage({ prompt_tokens: 1000, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 800 } }), {
    prompt: 1000,
    completion: 5,
    cacheHit: 800,
    cacheMiss: 200,
  })
  assert.deepEqual(parseUsage({ input_tokens: 50, output_tokens: 7, cache_read_input_tokens: 30 }), {
    prompt: 50,
    completion: 7,
    cacheHit: 30,
    cacheMiss: 20,
  })
  assert.equal(parseUsage(null), null)
  assert.equal(parseUsage('x'), null)
  assert.equal(parseUsage({}), null)
})

test('前缀预设：名字必填 / 去重 / 截断 / 上限', () => {
  assert.deepEqual(sanitizePrefixPresets(undefined), [])
  assert.deepEqual(sanitizePrefixPresets([null, 1, 'x', { prefix: '只有前缀' }]), [])
  const list = sanitizePrefixPresets([
    { name: ' 中文思维链 ', prefix: '先想一下：', contentPrefix: '好的，' },
    { name: '中文思维链', prefix: '重复名字丢掉' },
    { name: 'x'.repeat(80), prefix: 'p'.repeat(3000) },
  ])
  assert.equal(list.length, 2)
  assert.equal(list[0].name, '中文思维链')
  assert.equal(list[0].prefix, '先想一下：')
  assert.equal(list[0].contentPrefix, '好的，')
  assert.equal(list[1].name.length, 60)
  assert.equal(list[1].prefix.length, 2000)
  const many = sanitizePrefixPresets(Array.from({ length: 40 }, (_, i) => ({ name: 'p' + String(i) })))
  assert.equal(many.length, 30)
})

test('代理统计：成功计数 / 回退分布 / 耗时，可清零', async () => {
  const upstream = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
  })
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const proxy = createReasoningPrefixProxy({ getConfig: () => ({ enabled: false, upstream: 'http://127.0.0.1:' + upstream.address().port }) })
  const port = await proxy.listen(0)
  try {
    const response = await fetch('http://127.0.0.1:' + port + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
    })
    assert.equal(response.status, 200)
    const stats = proxy.stats()
    assert.equal(stats.requests, 1)
    assert.equal(stats.ok, 1)
    assert.equal(stats.failed, 0)
    // enabled:false ⇒ 本轮本就不该加前缀，口径是 ignored（不再是 passthrough：那会把「跳过」算成失败）
    assert.equal(stats.variants.ignored, 1)
    assert.equal(stats.ms.count, 1)
    assert.ok(stats.lastAt > 0)
    // 统计是深拷贝：外面改了不影响内部
    stats.variants.ignored = 999
    assert.equal(proxy.stats().variants.ignored, 1)
    proxy.resetStats()
    const cleared = proxy.stats()
    assert.equal(cleared.requests, 0)
    assert.deepEqual(cleared.variants, {})
    assert.deepEqual(cleared.firstDeltaMs, { sum: 0, count: 0 })
  } finally {
    proxy.server.closeAllConnections?.()
    await proxy.close()
    upstream.closeAllConnections?.()
    await new Promise((resolve) => upstream.close(resolve))
  }
})

test('代理统计：上游拒连记失败', async () => {
  const proxy = createReasoningPrefixProxy({ getConfig: () => ({ enabled: false, upstream: 'http://127.0.0.1:9' }) })
  const port = await proxy.listen(0)
  try {
    const response = await fetch('http://127.0.0.1:' + port + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
    })
    assert.equal(response.status, 502)
    const stats = proxy.stats()
    assert.equal(stats.requests, 1)
    assert.equal(stats.ok, 0)
    assert.equal(stats.failed, 1)
  } finally {
    proxy.server.closeAllConnections?.()
    await proxy.close()
  }
})
