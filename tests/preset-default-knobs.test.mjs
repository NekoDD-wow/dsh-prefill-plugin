// 前缀预设的全量旋钮快照（0.21.6 P2-10）要把「取默认值」的旋钮也存下来：
// fallbackOrder '' / catalogInclude [] / catalogExclude [] / sampling null。
// 否则 ① 套用不恢复它们（还原不出产生那批数据的配置）；② 面板「含 N 项旋钮」随保存时的配置在 10–14 之间漂移。
import assert from 'node:assert/strict'
import test from 'node:test'
import { presetKnobsOf, sanitizePrefixPresets } from '../impl.js'

const KNOB_COUNT = 14
// 保存预设那一刻的配置（reasoningConfigOf() 的形状）：四个旋钮都在默认值。
const savedUnder = { shim: true, textualize: true, catalogRole: 'system', catalogMode: 'each', catalogDetail: 'full', catalogPosition: 'head', fallbackOrder: '', allowPassthrough: true, maxEmittedCalls: 8, failureThreshold: 3, catalogInclude: [], catalogExclude: [], ignoreFailures: false, sampling: null }

test('默认值旋钮进快照：fallbackOrder="" / include=[] / exclude=[] / sampling=null', () => {
  const [preset] = sanitizePrefixPresets([{ name: 'arm-A', prefix: 'p', contentPrefix: '', ...presetKnobsOf(savedUnder) }])
  assert.deepEqual(
    { fallbackOrder: preset.fallbackOrder, catalogInclude: preset.catalogInclude, catalogExclude: preset.catalogExclude, sampling: preset.sampling },
    { fallbackOrder: '', catalogInclude: [], catalogExclude: [], sampling: null },
  )
})

test('套用口径 { ...当前, ...presetKnobsOf(预设) }：改过的回退链 / 清单筛选 / 采样都回到保存时', () => {
  const [preset] = sanitizePrefixPresets([{ name: 'arm-A', prefix: 'p', contentPrefix: '', ...presetKnobsOf(savedUnder) }])
  const current = { ...savedUnder, fallbackOrder: 'user-first', catalogInclude: ['read'], catalogExclude: ['bash'], sampling: { temperature: 0 } }
  const after = { ...current, ...presetKnobsOf(preset) }
  assert.equal(after.fallbackOrder, '')
  assert.deepEqual(after.catalogInclude, [])
  assert.deepEqual(after.catalogExclude, [])
  assert.equal(after.sampling, null)
})

test('全量快照的旋钮数不随保存时的取值漂移：默认 / 非默认都是 14 项', () => {
  const tuned = { ...savedUnder, fallbackOrder: 'user-first', catalogInclude: ['read'], catalogExclude: ['bash'], sampling: { temperature: 0.3 } }
  for (const config of [savedUnder, tuned]) {
    const [preset] = sanitizePrefixPresets([{ name: 'x', prefix: '', contentPrefix: '', ...presetKnobsOf(config) }])
    assert.equal(Object.keys(presetKnobsOf(preset)).length, KNOB_COUNT)
  }
})

test('旧版本存下的全量预设（缺那四项）读盘时补成默认；只有三件套 / 只带部分旋钮的预设不补', () => {
  const legacy = { name: 'legacy', prefix: 'p', contentPrefix: '', shim: true, textualize: true, catalogRole: 'system', catalogMode: 'each', catalogDetail: 'full', catalogPosition: 'head', allowPassthrough: true, maxEmittedCalls: 8, failureThreshold: 3, ignoreFailures: false }
  const [full, prefixOnly, partial] = sanitizePrefixPresets([legacy, { name: 'old', prefix: 'x', contentPrefix: '' }, { name: 'part', prefix: 'y', contentPrefix: '', catalogMode: 'history' }])
  assert.deepEqual(
    { fallbackOrder: full.fallbackOrder, catalogInclude: full.catalogInclude, catalogExclude: full.catalogExclude, sampling: full.sampling },
    { fallbackOrder: '', catalogInclude: [], catalogExclude: [], sampling: null },
  )
  assert.equal(Object.keys(presetKnobsOf(full)).length, KNOB_COUNT)
  assert.deepEqual(prefixOnly, { name: 'old', prefix: 'x', contentPrefix: '' })
  assert.deepEqual(partial, { name: 'part', prefix: 'y', contentPrefix: '', catalogMode: 'history' })
})
