// 0.21.3「每轮注入缺 enabled = 开、显式 false 才关」口径：gate.everyTurnFor / normalizeState（heal）/
// sanitizeEveryTurn / enabled.everyTurnOn 都已改，唯独 inject-once.js migrateLegacyInjects 仍是 `=== true`。
// 旧版（0.15.x）state.injects 迁移时，若本会话 everyTurn 格只配了模式（无 enabled、无正文），
// heal 不碰它，迁移却写成显式 enabled:false ⇒ 迁过来的旧会话内注入不注入，之后 heal 也救不回来。
import test from 'node:test'
import assert from 'node:assert/strict'
import { migrateLegacyInjects } from '../inject-once.js'
import { normalizeState } from '../impl.js'
import { everyTurnFor } from '../gate.js'
import { everyTurnOn } from '../enabled.js'

test('旧 injects 迁移：本会话格缺 enabled ⇒ 迁移后为开', () => {
  const raw = {
    everyTurn: { 'sess-1': { mode: 'until', untilTurn: 3 } }, // 只配了模式，没有 enabled、没有正文
    injects: { 'sess-1': [{ id: 'a', text: '背景：主角叫小林' }] },
  }
  const state = migrateLegacyInjects(normalizeState(raw), {})
  const entry = state.everyTurn['sess-1']
  assert.notEqual(entry.enabled, false, `迁移把缺省写成了显式 false；gate.everyTurnFor=${JSON.stringify(everyTurnFor(state, 'sess-1'))}`)
  assert.equal(everyTurnOn(state, 'sess-1'), true, '面板口径（everyTurnOn）应为开')
  assert.ok(everyTurnFor(state, 'sess-1'), '闸门应注入迁过来的旧会话内注入')
  assert.equal(entry.mode, 'until', '原有模式保留')
})

test('旧 injects 迁移：本会话格显式 enabled:false ⇒ 仍为关（回归）', () => {
  const raw = {
    everyTurn: { 'sess-1': { mode: 'always', enabled: false } },
    injects: { 'sess-1': [{ id: 'a', text: '背景：主角叫小林' }] },
  }
  const state = migrateLegacyInjects(normalizeState(raw), {})
  assert.equal(state.everyTurn['sess-1'].enabled, false)
})

test('旧 injects 迁移：本会话没有格、通配格 * 缺 enabled ⇒ 按通配格的模式迁（缺 enabled 视为开）', () => {
  const raw = {
    everyTurn: { '*': { mode: 'until', untilTurn: 5 } },
    injects: { 'sess-2': [{ id: 'a', text: '背景：主角叫小林' }] },
  }
  const state = migrateLegacyInjects(normalizeState(raw), {})
  const entry = state.everyTurn['sess-2']
  assert.equal(entry.enabled, true)
  assert.deepEqual({ mode: entry.mode, untilTurn: entry.untilTurn }, { mode: 'until', untilTurn: 5 }, '缺 enabled 的通配格应作为基底')
})

test('旧 injects 迁移：通配格 * 显式 enabled:false ⇒ 不拿它当基底（回归）', () => {
  const raw = {
    everyTurn: { '*': { mode: 'until', untilTurn: 5, enabled: false } },
    injects: { 'sess-2': [{ id: 'a', text: '背景：主角叫小林' }] },
  }
  const state = migrateLegacyInjects(normalizeState(raw), {})
  assert.equal(state.everyTurn['sess-2'].mode, 'always')
})
