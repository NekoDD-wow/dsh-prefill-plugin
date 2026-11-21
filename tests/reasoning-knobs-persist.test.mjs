// 思考前缀的实验旋钮要能「存得住、还原得回」：
// ① 左栏「保存前缀 / 保存并启用」（POST /reasoning/enable）不能把 ignoreFailures / armId / runId / sampling 丢掉；
// ② 前缀预设在默认旋钮下保存，之后改过回退链 / 清单包含排除 / 采样再套用，这些要回到默认（含已有的旧预设）。
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { exitIfLeaked, fakeSettings, freePort, mount } from './impl-mount-harness.mjs'

const PORT = await freePort()
const h = await mount({
  tag: 'knobs-persist',
  settings: fakeSettings(),
  state: {
    ui: {
      experimental: true,
      reasoningPrefix: {
        enabled: true,
        prefix: '旧前缀',
        port: PORT,
        ignoreFailures: true,
        armId: 'arm-B',
        runId: 'run-7',
        sampling: { temperature: 0.3, seed: 42 },
      },
    },
  },
})
const ENABLE = '/api/dsh-prefill/reasoning/enable'
const DISABLE = '/api/dsh-prefill/reasoning/disable'
const PRESETS = '/api/dsh-prefill/experimental/presets'
const CONFIG = '/api/dsh-prefill/experimental/config'
const STATUS = '/api/dsh-prefill/experimental/status'

after(async () => {
  await h.post(DISABLE, {})
  exitIfLeaked()
})

const defaultsOf = (knobs) => ({ fallbackOrder: knobs.fallbackOrder, catalogInclude: knobs.catalogInclude, catalogExclude: knobs.catalogExclude, sampling: knobs.sampling })
const DEFAULTS = { fallbackOrder: '', catalogInclude: [], catalogExclude: [], sampling: null }

test('左栏「保存前缀」（POST /reasoning/enable）不清掉 ignoreFailures / armId / runId / sampling', async () => {
  assert.equal(h.readStateFile().ui.reasoningPrefix.ignoreFailures, true)
  const res = await h.post(ENABLE, { prefix: '新前缀', contentPrefix: '' })
  assert.equal(res.applied?.ok, true, JSON.stringify(res.applied))
  const after = h.readStateFile().ui.reasoningPrefix
  assert.equal(after.prefix, '新前缀')
  assert.equal(after.enabled, true)
  assert.deepEqual(
    { ignoreFailures: after.ignoreFailures, armId: after.armId, runId: after.runId, sampling: after.sampling },
    { ignoreFailures: true, armId: 'arm-B', runId: 'run-7', sampling: { temperature: 0.3, seed: 42 } },
  )
})

test('默认旋钮下存的预设：改过回退链 / 包含排除 / 采样后套用，这四项回到默认', async () => {
  // 先把采样覆盖清掉，回到四项全默认，再存预设。
  await h.post(CONFIG, { sampling: null })
  assert.deepEqual(defaultsOf((await h.post(STATUS, {})).knobs), DEFAULTS)
  await h.post(PRESETS, { op: 'save', name: 'baseline', prefix: 'P0', contentPrefix: '' })
  await h.post(CONFIG, { fallbackOrder: 'user-first', catalogInclude: ['read'], catalogExclude: ['bash'], sampling: { temperature: 0.3 } })
  const applied = await h.post(PRESETS, { op: 'apply', name: 'baseline' })
  assert.notEqual(applied.ok, false, JSON.stringify(applied))
  assert.deepEqual(defaultsOf((await h.post(STATUS, {})).knobs), DEFAULTS)
})

test('旧版本存下的全量预设（默认旋钮没进快照）：套用同样恢复默认', async () => {
  const raw = h.readStateFile()
  // 0.21.6–0.21.11 在默认旋钮下保存的形状：14 项里只有 10 项。
  const legacy = { name: 'legacy-full', prefix: 'P1', contentPrefix: '', shim: true, textualize: true, catalogRole: 'system', catalogMode: 'each', catalogDetail: 'full', catalogPosition: 'head', allowPassthrough: true, maxEmittedCalls: 8, failureThreshold: 3, ignoreFailures: false }
  h.seed({ ...raw, reasoningPrefixPresets: [legacy] })
  await h.post(CONFIG, { fallbackOrder: 'system-first', catalogInclude: ['write'], sampling: { topP: 0.5 } })
  await h.post(PRESETS, { op: 'apply', name: 'legacy-full' })
  assert.deepEqual(defaultsOf((await h.post(STATUS, {})).knobs), DEFAULTS)
})

test('只有三件套的旧预设：套用只换前缀，旋钮一项不动（防误伤，修复前后都应通过）', async () => {
  const raw = h.readStateFile()
  h.seed({ ...raw, reasoningPrefixPresets: [{ name: 'prefix-only', prefix: 'P2', contentPrefix: '' }] })
  await h.post(CONFIG, { fallbackOrder: 'user-first', catalogInclude: ['read'], catalogExclude: ['bash'], sampling: { temperature: 0.7 } })
  await h.post(PRESETS, { op: 'apply', name: 'prefix-only' })
  const knobs = (await h.post(STATUS, {})).knobs
  assert.equal(knobs.prefix ?? h.readStateFile().ui.reasoningPrefix.prefix, 'P2')
  assert.deepEqual(defaultsOf(knobs), { fallbackOrder: 'user-first', catalogInclude: ['read'], catalogExclude: ['bash'], sampling: { temperature: 0.7 } })
})
