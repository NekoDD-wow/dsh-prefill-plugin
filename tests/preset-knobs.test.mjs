// 阶段 C：预设携带全量旋钮（P2-10）+ 装配出口清单去重（F15-A）。
// 这两条都是「数据/提示词完整性」类修复，出错的后果是静默的（配置没还原 / 提示词里两份清单），
// 所以形状与边界都要锁住。
import test from 'node:test'
import assert from 'node:assert/strict'
import { keepLatestToolCatalog, presetKnobsOf, sanitizePrefixPresets } from '../impl.js'

const catalog = (text) => ({ role: 'user', source: { kind: 'prefill', prefill: 'tool-catalog' }, content: [{ type: 'text', text }] })
const user = (text) => ({ role: 'user', content: [{ type: 'text', text }] })

// ── F17 presetKnobsOf：存哪些、不存哪些 ──────────────────────────────────────
test('presetKnobsOf：带上实验旋钮，排除 port / logging / armId / runId / enabled', () => {
  const config = {
    enabled: true,
    port: 46321,
    armId: 'A1',
    runId: 'r-7',
    prefix: '他喵',
    contentPrefix: '',
    logging: { enabled: true, file: '/tmp/x.jsonl' },
    shim: true,
    textualize: false,
    catalogRole: 'user',
    catalogMode: 'history',
    catalogDetail: 'brief',
    catalogPosition: 'tail',
    fallbackOrder: 'user-first',
    allowPassthrough: false,
    maxEmittedCalls: 4,
    failureThreshold: 5,
    catalogInclude: ['read', 'write'],
    catalogExclude: ['bash'],
    ignoreFailures: true,
    sampling: { temperature: 0.3, topP: 0.9, seed: 42 },
  }
  const knobs = presetKnobsOf(config)
  // 该带的都在
  assert.deepEqual(knobs, {
    shim: true,
    textualize: false,
    catalogRole: 'user',
    catalogMode: 'history',
    catalogDetail: 'brief',
    catalogPosition: 'tail',
    fallbackOrder: 'user-first',
    allowPassthrough: false,
    maxEmittedCalls: 4,
    failureThreshold: 5,
    catalogInclude: ['read', 'write'],
    catalogExclude: ['bash'],
    ignoreFailures: true,
    sampling: { temperature: 0.3, topP: 0.9, seed: 42 },
  })
  // 不该带的绝不能出现：port 换机器就不同、logging 是调试、armId/runId 是运行身份、enabled 是开关本身。
  for (const key of ['enabled', 'port', 'armId', 'runId', 'logging', 'prefix', 'contentPrefix']) {
    assert.equal(Object.hasOwn(knobs, key), false, key + ' 不该进预设')
  }
})

test('presetKnobsOf：有才写 —— 缺键就不放进结果（套用旧预设时不会把旋钮清成 undefined）', () => {
  assert.deepEqual(presetKnobsOf({}), {})
  assert.deepEqual(presetKnobsOf(null), {})
  assert.deepEqual(presetKnobsOf('nope'), {})
  assert.deepEqual(presetKnobsOf([]), {})
  assert.deepEqual(presetKnobsOf({ shim: false }), { shim: false })
  // sampling 全空 ⇒ 不落键（不是落一个 {}）。
  assert.deepEqual(presetKnobsOf({ sampling: {} }), {})
  assert.deepEqual(presetKnobsOf({ sampling: null }), {})
})

test('presetKnobsOf：非法值一律丢掉该键，不留坏值', () => {
  const knobs = presetKnobsOf({
    shim: 'yes',
    catalogRole: 'assistant',
    catalogMode: 'sometimes',
    catalogDetail: 'tiny',
    catalogPosition: 'middle',
    fallbackOrder: 'random',
    maxEmittedCalls: 99,
    failureThreshold: 0,
    catalogInclude: [],
    catalogExclude: [42],
    sampling: { temperature: 9 },
  })
  assert.deepEqual(knobs, {})
})

// ── F17 sanitizePrefixPresets：往返与向后兼容 ────────────────────────────────
test('sanitizePrefixPresets：前缀三件套照旧，旋钮跟着存', () => {
  const out = sanitizePrefixPresets([
    { name: '甲', prefix: '他喵', contentPrefix: '好的', match: '【甲】', catalogMode: 'history', failureThreshold: 5, sampling: { seed: 7 } },
  ])
  assert.equal(out.length, 1)
  assert.equal(out[0].name, '甲')
  assert.equal(out[0].prefix, '他喵')
  assert.equal(out[0].contentPrefix, '好的')
  assert.equal(out[0].match, '【甲】')
  assert.equal(out[0].catalogMode, 'history')
  assert.equal(out[0].failureThreshold, 5)
  assert.deepEqual(out[0].sampling, { seed: 7 })
})

test('sanitizePrefixPresets：旧预设（只有三件套）读进来照旧，不多出任何键', () => {
  const out = sanitizePrefixPresets([{ name: '旧', prefix: 'x', contentPrefix: '' }])
  assert.deepEqual(out, [{ name: '旧', prefix: 'x', contentPrefix: '' }])
})

test('sanitizePrefixPresets：往返稳定（sanitize ∘ sanitize = sanitize）', () => {
  const input = [
    { name: '甲', prefix: 'p', contentPrefix: 'c', match: 'm', catalogMode: 'history', shim: false, catalogInclude: ['a', ' b '], sampling: { temperature: 0 } },
    { name: '乙', prefix: '', contentPrefix: '', catalogMode: '乱填', failureThreshold: 99 },
  ]
  const once = sanitizePrefixPresets(input)
  assert.deepEqual(sanitizePrefixPresets(once), once)
  // 乙 的非法旋钮被丢掉，但条目本身要留着（名字与前缀是主数据）。
  assert.deepEqual(once[1], { name: '乙', prefix: '', contentPrefix: '' })
  // 工具名清单 trim 且丢空。
  assert.deepEqual(once[0].catalogInclude, ['a', 'b'])
  // temperature:0 是合法值，必须保住（不能当成「没设」）。
  assert.deepEqual(once[0].sampling, { temperature: 0 })
})

test('sanitizePrefixPresets：重名去重 / 上限 30 / 非数组，行为与本次改动前一致', () => {
  assert.deepEqual(sanitizePrefixPresets('nope'), [])
  const dup = sanitizePrefixPresets([{ name: 'a', prefix: '1' }, { name: 'a', prefix: '2' }])
  assert.equal(dup.length, 1)
  assert.equal(dup[0].prefix, '1')
  const many = sanitizePrefixPresets(Array.from({ length: 40 }, (_v, index) => ({ name: 'p' + index, prefix: 'x' })))
  assert.equal(many.length, 30)
})

// ── F15-A keepLatestToolCatalog：只去重、永不删最后一份 ───────────────────────
// 顺序口径：会话历史是**追加**的，所以时间序最后那份才是最新；能走到去重说明本轮没有新注入
// （ensureCatalogInjected 只在装配里一份都没有时才注入），所以必须留**最后**一份，不能留第一份。
test('keepLatestToolCatalog：两份清单 ⇒ 只留时间序最后一份（最新那份），返回丢弃数', () => {
  const messages = [catalog('旧清单'), user('你好'), catalog('新清单')]
  const result = keepLatestToolCatalog(messages)
  assert.equal(result.dropped, 1)
  assert.equal(result.messages.length, 2)
  assert.equal(result.messages[0].content[0].text, '你好')
  assert.equal(result.messages[1].content[0].text, '新清单')
})

test('keepLatestToolCatalog：三份 ⇒ 留最后一份、丢两份；非清单消息顺序不变', () => {
  const messages = [catalog('a'), user('u1'), catalog('b'), user('u2'), catalog('c')]
  const result = keepLatestToolCatalog(messages)
  assert.equal(result.dropped, 2)
  assert.deepEqual(result.messages.map((message) => message.content[0].text), ['u1', 'u2', 'c'])
})

test('keepLatestToolCatalog：0 份 / 1 份 ⇒ 原样返回（永不删除最后一份）', () => {
  const none = [user('u1'), user('u2')]
  const r0 = keepLatestToolCatalog(none)
  assert.equal(r0.dropped, 0)
  assert.equal(r0.messages, none)
  const one = [catalog('唯一的清单'), user('u')]
  const r1 = keepLatestToolCatalog(one)
  assert.equal(r1.dropped, 0)
  // 关键：唯一那份必须留下 —— 代理没在跑时它是模型唯一的工具认知来源。
  assert.equal(r1.messages.length, 2)
  assert.equal(r1.messages[0].content[0].text, '唯一的清单')
})

test('keepLatestToolCatalog：非数组 / 畸形输入不抛，也不误删', () => {
  assert.deepEqual(keepLatestToolCatalog(null), { messages: [], dropped: 0 })
  assert.deepEqual(keepLatestToolCatalog('nope'), { messages: [], dropped: 0 })
  const weird = [{ source: { prefill: 'tool-catalog' } }, { source: { prefill: 'other' } }]
  // 第一条算清单（形状够用即可），第二条不是 ⇒ 没有重复可删。
  assert.equal(keepLatestToolCatalog(weird).dropped, 0)
})
