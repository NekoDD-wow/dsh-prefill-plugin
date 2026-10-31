// #21：旧 state.injects 读取时迁移的落盘以前绕过 withLegacyMirror（writeState 才带镜像）。
// 结果：从 0.15.x 升级上来、配过「会话内注入」的用户第一次读状态就把旧字段镜像 + sandboxMirror 抹掉，
// 回退 0.15.2 读同一份 state.json 时系统提示改写 / 工具白名单 / 放行来源 / 严格档全部读不到。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'prefill-state-migration-'))
process.env.DSH_HOME = home
const dataDir = join(home, 'prefill')
mkdirSync(dataDir, { recursive: true })
const stateFile = join(dataDir, 'state.json')

// 0.15.2 形状：旧 injects（会触发读取时迁移）+ 旧字段（overrides / sessionTools / sessionAllowKinds / injectionBlocks / gate pure）。
const OLD = {
  version: 1,
  armed: ['s1'],
  levers: { probeSection: false, probeContext: false, blockSections: false, blockContexts: false, blockTools: false, blockMessages: false, prefillProbe: false },
  allowKinds: ['user'],
  overrides: { s1: { messages: {}, sections: { 'prefill:persona': '你是猫娘' }, contexts: {} } },
  sessionAllowKinds: { s1: ['runtime-context'] },
  sessionTools: { s1: ['read'] },
  injectionBlocks: { s1: { messages: ['model-notice'] } },
  gate: { s1: 'pure' },
  injects: { s1: [{ role: 'user', text: '旧注入' }] },
}
writeFileSync(stateFile, JSON.stringify(OLD, null, 2) + '\n')

// 触发一次读状态（ping 路由的 envelope 会 readState → 迁移 → 落盘）。
const impl = await import('../impl.js')
const routes = new Map()
const scope = {
  get: (name) => (name === 'connection' ? { fetch: { register: (def) => routes.set(def.path, def) } } : undefined),
  effect: (fn) => fn(),
}
const ctx = {
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
}
impl.apply(ctx)
const ping = routes.get('/api/dsh-prefill/ping')
assert.ok(ping, 'ping 路由已注册')
await ping.fetch({ json: async () => ({}) })

const disk = JSON.parse(readFileSync(stateFile, 'utf8'))
test('迁移本身生效：injects 迁成 everyTurn，旧 injects 删掉', () => {
  assert.equal(disk.injects, undefined)
  assert.ok(disk.everyTurn?.s1?.bench?.length > 0, '旧注入迁成工作台里的一块积木')
})

test('落盘带「防降级」镜像：旧字段 + sandboxMirror 都还在（回退 0.15.2 不丢配置）', () => {
  assert.ok(disk.sandboxMirror && typeof disk.sandboxMirror === 'object', 'sandboxMirror 指纹存在')
  assert.deepEqual(disk.overrides?.s1?.sections, { 'prefill:persona': '你是猫娘' })
  assert.deepEqual(disk.sessionTools?.s1, ['read'])
  assert.deepEqual(disk.sessionAllowKinds?.s1, ['runtime-context'])
  assert.deepEqual(disk.injectionBlocks?.s1?.messages, ['model-notice'])
  assert.equal(disk.gate?.s1, 'pure')
})
