// reasoning 代理测试用桩：上游可按「原始字节分片 + 间隔」回写；代理侧收集结果行 / stats / outcome。
import http from 'node:http'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createReasoningPrefixProxy } from '../reasoning-prefix.js'

export const sse = (obj) => 'data: ' + JSON.stringify(obj) + '\n\n'

/**
 * 起一个假上游。handler(n, body, req) => { status?, headers?, chunks: Array<string|Buffer>, delayMs? }
 * chunks 按原样逐块写出（可以切在帧中间、切在多字节字符中间）。
 */
export const startUpstream = async (handler) => {
  const bodies = []
  const server = http.createServer(async (req, res) => {
    const parts = []
    for await (const part of req) parts.push(part)
    const raw = Buffer.concat(parts).toString('utf8')
    let body = null
    try { body = JSON.parse(raw || '{}') } catch { body = raw }
    bodies.push(body)
    const out = handler(bodies.length, body, req)
    res.writeHead(out.status ?? 200, out.headers ?? { 'content-type': 'text/event-stream' })
    if (typeof res.flushHeaders === 'function') res.flushHeaders()
    for (const chunk of out.chunks ?? []) {
      if (out.delayMs) await new Promise((r) => setTimeout(r, out.delayMs))
      if (res.destroyed) return
      res.write(chunk)
    }
    res.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    bodies,
    port: server.address().port,
    close: async () => {
      server.closeAllConnections?.()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}

/** 起本插件的 reasoning 代理（shim 开），上游指向 upstream（假上游对象或真实 URL 字符串）。 */
export const startProxy = async ({ upstream, config = {} } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'prefill-proxy-'))
  const resultFile = join(dir, 'result.jsonl')
  const outcomes = []
  const proxy = createReasoningPrefixProxy({
    getConfig: () => ({
      enabled: true,
      upstream: typeof upstream === 'string' ? upstream : 'http://127.0.0.1:' + upstream.port,
      reasoningPrefix: '他喵',
      stripTools: true,
      shim: true,
      resultFile,
      ...config,
    }),
    onOutcome: (o) => { outcomes.push(o) },
  })
  const port = await proxy.listen(0)
  const rows = () => (existsSync(resultFile) ? readFileSync(resultFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
  return {
    proxy,
    port,
    rows,
    outcomes,
    url: 'http://127.0.0.1:' + port + '/beta/v1/chat/completions',
    close: async () => {
      await proxy.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

export const post = async (url, body, headers = {}) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer x', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  const text = await response.text()
  return { status: response.status, text, headers: response.headers }
}

/** 解析客户端收到的 SSE：正文 / 思维链 / finish_reason 序列 / 按 index 拼好的 tool_calls / 是否有 [DONE]。 */
export const parseClientSse = (text) => {
  const frames = text.split('\n\n').map((f) => f.trim()).filter(Boolean)
  const payloads = []
  let done = false
  for (const f of frames) {
    if (!f.startsWith('data: ')) continue
    const d = f.slice(6)
    if (d === '[DONE]') { done = true; continue }
    payloads.push(JSON.parse(d))
  }
  const content = payloads.map((p) => p.choices?.[0]?.delta?.content ?? '').join('')
  const reasoning = payloads.map((p) => p.choices?.[0]?.delta?.reasoning_content ?? '').join('')
  const finish = payloads.map((p) => p.choices?.[0]?.finish_reason).filter((x) => typeof x === 'string')
  const toolCalls = {}
  for (const p of payloads) {
    for (const tc of p.choices?.[0]?.delta?.tool_calls ?? []) {
      const slot = (toolCalls[tc.index] ??= { name: '', arguments: '', ids: [] })
      if (tc.id) slot.ids.push(tc.id)
      if (tc.function?.name) slot.name += tc.function.name
      if (typeof tc.function?.arguments === 'string') slot.arguments += tc.function.arguments
    }
  }
  return { payloads, done, content, reasoning, finish, toolCalls }
}

export const BODY = { model: 'deepseek-chat', stream: true, messages: [{ role: 'user', content: '你好' }] }
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
