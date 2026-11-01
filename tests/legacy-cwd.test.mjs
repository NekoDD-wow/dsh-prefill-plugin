// 0.17.0 去掉了 `{{cwd}}` 插值（DSH 0.2.1 的 agent-loop 只注册 provider / model，工作目录走 working-directory
// 运行时上下文），内置「中文版官方系统提示」最后一行改成「你的工作目录由运行时上下文提供。」。
// 但已经存进 state.json / 预设文件的旧文本（最后一行是「你的工作目录是 {{cwd}}。」）没有迁移：
// interpolateOk 因为 {{cwd}} 返回 false ⇒ 整段 interpolate:false ⇒ 模型看到字面的 {{model}} / {{cwd}}。
// 这里覆盖两种来源：state（旧字段形状 + 规则表形状）与预设（packs.json 读出 + 套用写回 state）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'prefill-legacy-cwd-'))
process.env.DSH_HOME = home
const dataDir = join(home, 'prefill')
mkdirSync(dataDir, { recursive: true })
const stateFile = join(dataDir, 'state.json')

const { ZH_OFFICIAL_PROMPT } = await import('../builtin-presets.js')
const { interpolateOk } = await import('../gate.js')

const NEW_LINE = '你的工作目录由运行时上下文提供。'
const OLD_LINE = '你的工作目录是 {{cwd}}。'
// ≤ 0.16.0 内置文本：与新版只差最后一行（逐字）。
const OLD_PROMPT = ZH_OFFICIAL_PROMPT.replace(NEW_LINE, OLD_LINE)
const PERSONA = 'prefill:persona'
const USER_OWN = '我自己写的段：请把产物放到 {{cwd}}/out 下。'

test('前提：旧文本确实含 {{model}} 与 {{cwd}}，且改前 interpolateOk 判它整段不插值', () => {
  assert.notEqual(OLD_PROMPT, ZH_OFFICIAL_PROMPT)
  assert.match(OLD_PROMPT, /\{\{model\}\}/)
  assert.match(OLD_PROMPT, /\{\{cwd\}\}/)
  assert.equal(interpolateOk(OLD_PROMPT), false)
  assert.equal(interpolateOk(ZH_OFFICIAL_PROMPT), true)
})

// 0.16.0 形状的 state.json：旧字段 overrides（读取时被 migrateSandbox 吸收进规则表）。
writeFileSync(
  stateFile,
  `${JSON.stringify(
    {
      version: 1,
      armed: [],
      levers: { probeSection: false, probeContext: false, blockSections: false, blockContexts: false, blockTools: false, blockMessages: false, prefillProbe: false },
      allowKinds: ['user'],
      overrides: {
        s1: { messages: {}, sections: { [PERSONA]: OLD_PROMPT }, contexts: {} },
        s2: { messages: {}, sections: { [PERSONA]: `${OLD_PROMPT}\n\n另外：回答用简体中文。` }, contexts: {} },
        s3: { messages: {}, sections: { [PERSONA]: USER_OWN }, contexts: {} },
      },
      gate: { s1: 'replace', s2: 'replace', s3: 'pass' },
    },
    null,
    2,
  )}\n`,
)

// 预设文件（会话不在册 ⇒ 全局包目录）：旧版存下的「中文版官方系统提示」整份。
const packDir = join(dataDir, 'global', '.dsh-prefill')
mkdirSync(packDir, { recursive: true })
writeFileSync(
  join(packDir, 'packs.json'),
  `${JSON.stringify({ version: 1, packs: [{ id: 'p-old', name: '旧中文官方', updatedAt: 1, items: [], overrides: { messages: {}, sections: { [PERSONA]: OLD_PROMPT }, contexts: {} }, gate: 'replace', tools: null }] }, null, 2)}\n`,
)

const impl = await import('../impl.js')
const routes = new Map()
const scope = {
  get: (name) => (name === 'connection' ? { fetch: { register: (def) => routes.set(def.path, def) } } : undefined),
  effect: (fn) => fn(),
}
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
const post = async (path, body) => {
  const route = routes.get(path)
  assert.ok(route, `${path} 已注册`)
  const res = await route.fetch({ json: async () => body })
  assert.equal(res.status, 200)
  return res.json()
}
const sectionOf = (envelope, sid) => envelope?.state?.overrides?.[sid]?.sections?.[PERSONA]

test('state 来源（0.16 旧字段形状）：旧内置文本读出来就是新版内置文本，能正常插值 {{model}}', async () => {
  const env = await post('/api/dsh-prefill/ping', {})
  const text = sectionOf(env, 's1')
  assert.equal(text, ZH_OFFICIAL_PROMPT)
  assert.equal(interpolateOk(text), true)
})

test('state 来源：改过的旧文本只换掉 {{cwd}} 那一行，其余用户改动保留', async () => {
  const env = await post('/api/dsh-prefill/ping', {})
  const text = sectionOf(env, 's2')
  assert.equal(text, `${ZH_OFFICIAL_PROMPT}\n\n另外：回答用简体中文。`)
  assert.equal(interpolateOk(text), true)
})

test('state 来源：用户自写的 {{cwd}}（不是旧内置那一行）原样不动', async () => {
  const env = await post('/api/dsh-prefill/ping', {})
  assert.equal(sectionOf(env, 's3'), USER_OWN)
})

test('state 来源（规则表形状）：normalizeState 把 section 改写规则里的旧行换掉，幂等', () => {
  const raw = { version: 1, armed: [], levers: {}, sandbox: { s9: { own: ['rewrite'], rules: [{ match: { section: PERSONA, exact: true }, action: 'rewrite', text: OLD_PROMPT }] } } }
  const once = impl.normalizeState(raw)
  const rule = once.sandbox.s9.rules.find((entry) => entry.action === 'rewrite')
  assert.equal(rule.text, ZH_OFFICIAL_PROMPT)
  assert.deepEqual(impl.normalizeState(once), once)
  // 原始对象不被改写。
  assert.equal(raw.sandbox.s9.rules[0].text, OLD_PROMPT)
})

test('预设来源：packs.json 里的旧文本读出（get）时已是新版内置文本', async () => {
  const data = await post('/api/dsh-prefill/packs', { op: 'get', name: '旧中文官方' })
  const text = data?.pack?.overrides?.sections?.[PERSONA]
  assert.equal(text, ZH_OFFICIAL_PROMPT)
})

test('预设来源：套用时写进 state 的旧文本（旧面板 / 旧导出直接带过来）也被迁移', async () => {
  const env = await post('/api/dsh-prefill/state', { overrides: { p1: { messages: {}, sections: { [PERSONA]: OLD_PROMPT }, contexts: {} } }, gate: { p1: 'replace' } })
  const text = sectionOf(env, 'p1')
  assert.equal(text, ZH_OFFICIAL_PROMPT)
  assert.equal(interpolateOk(text), true)
  // 落盘的规则表也是新文本（之后每轮装配读到的就是它）。
  const disk = JSON.parse(readFileSync(stateFile, 'utf8'))
  const rule = disk.sandbox?.p1?.rules?.find((entry) => entry.action === 'rewrite' && entry.match?.section === PERSONA)
  assert.equal(rule?.text, ZH_OFFICIAL_PROMPT)
  assert.doesNotMatch(JSON.stringify(disk.overrides?.p1 ?? {}), /\{\{cwd\}\}/)
})
