// 卡片的整封 /state（附全局摘要）现在按本会话切一刀喂 summary store，与 summary 路由的响应交替进 store。
// 两份内容指纹必须一致，否则每次交替都会多 emit 一次（芯片 / 徽标白白重渲染）。
// 这里用**真服务端**（impl.js 注册的路由 + 临时 DSH_HOME）各取一份，再用 client.js 的 <summary-store> 段归一比对。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'prefill-summary-parity-'))
process.env.DSH_HOME = HOME
const impl = await import('../impl.js')
const routes = new Map()
const scope = { get: (name) => (name === 'connection' ? { fetch: { register: (def) => routes.set(def.path, def) } } : undefined), effect: (fn) => fn() }
impl.apply({
  effect: (fn) => {
    try {
      fn()
    } catch {
      // 注册失败不影响本用例关心的路由。
    }
  },
  on: () => {},
  inject: (deps, cb) => cb(scope),
  logger: { info() {}, error() {} },
})
test.after(() => rmSync(HOME, { recursive: true, force: true }))

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const storeSrc = src.slice(src.indexOf('    // <summary-store>'), src.indexOf('    // </summary-store>'))

test('真服务端：整封 /state（不带 sessionId）切出来的摘要 == summary 路由的摘要', async () => {
  const SID = 'session-parity'
  const state = {
    prefill: { [SID]: 'default', other: 'x' },
    gate: { [SID]: 'pure', other: 'replace' },
    activePreset: { [SID]: 'builtin:persona', other: 'p' },
    armed: [SID, '*', 'other'],
    ui: { experimental: true, motion: 'lite' },
    overrides: { [SID]: { messages: {}, sections: { 'prefill:persona': '人格' }, contexts: {} }, other: { messages: {}, sections: { 'prefill:persona': 'x' }, contexts: {} } },
    locked: { [SID]: { at: '2026-01-01T00:00:00.000Z', items: [] } },
    noticeSeen: true,
    sandbox: { [SID]: { level: 'controlled', own: [], rules: [] } },
    everyTurn: {},
  }
  mkdirSync(join(HOME, 'prefill'), { recursive: true })
  writeFileSync(join(HOME, 'prefill', 'state.json'), JSON.stringify(state))
  const post = async (path, body) => JSON.parse(await (await routes.get(path).fetch({ json: async () => body })).text())
  const summary = await post('/api/dsh-prefill/summary', { sessionId: SID })
  const envelope = await post('/api/dsh-prefill/state', undefined)
  assert.equal(envelope.summary?.sessionId, '', '卡片的 /state 不带 sessionId ⇒ 附的是全局摘要')
  const React = { useState: (v) => [v, () => {}], useEffect() {}, useCallback: (fn) => fn }
  const mod = new Function('React', 'fetch', 'window', 'document', 'setTimeout', 'clearTimeout', 'AbortSignal', 'STATE_EVENT', `${storeSrc}\nreturn { summaryStore, normalizeSummary, extractSummary, summarySignature }`)(
    React, () => new Promise(() => {}), { addEventListener() {} }, { hidden: false, addEventListener() {} }, setTimeout, clearTimeout, { timeout: () => ({}) }, 'x',
  )
  mod.summaryStore.sessionId = SID
  const fromEnvelope = mod.extractSummary({ ...envelope, summary: undefined })
  const fromRoute = mod.normalizeSummary(summary)
  assert.equal(fromEnvelope.state.gate[SID], 'pure')
  assert.equal(fromEnvelope.persona, true)
  assert.equal(mod.summarySignature(fromEnvelope), mod.summarySignature(fromRoute))
})
