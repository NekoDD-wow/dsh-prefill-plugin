// v0.15 工作台：旧条目读取时迁移的块 key 要稳定（否则 textarea 每次渲染被重挂、打不了字），
// 打字要去抖，拖动把手不能触发文字框选。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { blockFromPreset, migrateEveryTurn } from '../blocks.js'
import { everyTurnPresets, everyTurnTowers } from '../builtin-presets.js'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const cut = (from, to) => {
  const at = src.indexOf(from)
  assert.ok(at >= 0, '找不到：' + from)
  return src.slice(at, src.indexOf(to, at))
}

test('迁移：面板每次渲染用的 makeKey 是确定的，同一份旧条目两次渲染得到同样的块 key', () => {
  const blocks = everyTurnPresets().map(blockFromPreset)
  const towers = everyTurnTowers()
  // 面板里的 migrateKeys 切出来跑（每次渲染调一次，得到一个新的计数器）。
  const migrateKeys = new Function(cut('const migrateKeys = ', '\n      }\n') + '\n      }\nreturn migrateKeys')()
  const render = (entry) => migrateEveryTurn(entry, { blocks, towers, makeKey: migrateKeys() }).bench.map((block) => block.key)
  const tower = towers.find((entry) => entry.id === 'rp-pack')
  for (const entry of [
    { text: '自定义的每轮提醒', firstText: '', checks: [] }, // 自定义块
    { text: everyTurnPresets()[0].text, firstText: everyTurnPresets()[0].firstText ?? '', checks: everyTurnPresets()[0].checks }, // 内置积木
  ]) {
    const a = render(entry)
    assert.ok(a.length > 0)
    assert.deepEqual(render(entry), a, '两次渲染 key 不同 ⇒ React 重挂 textarea，一聚焦就丢焦点')
  }
  assert.ok(tower !== undefined)
  // 迁移那一行必须用 migrateKeys()，不能用带随机数的 nextBenchKey。
  const call = cut(': migrateEveryTurn(storedEveryTurn', '\n')
  assert.match(call, /makeKey: migrateKeys\(\)/)
  assert.doesNotMatch(call, /nextBenchKey/)
})

test('打字去抖：patchBenchBlock 把 immediate 传给 setBench（文字框传 false）', () => {
  const setBench = cut('const setBench = (', '\n      }\n')
  assert.match(setBench, /immediate = true\)/)
  // #23 之后 setBench 先组 patch（删空时额外清 text/firstText），immediate 仍原样透传。
  assert.match(setBench, /const patch = /)
  assert.match(setBench, /editEveryTurn\(patch, immediate\)/)
  const patch = cut('const patchBenchBlock = ', '\n      const ')
  assert.match(patch, /immediate !== false\)/)
  assert.match(src, /patchBenchBlock\(block\.key, \{ text: event\.target\.value \}, false\)/)
})

test('拖动把手：pointerdown 拦默认行为、拖动期间禁用文字选择，结束 / 取消时还原', () => {
  const drag = cut('const startDrag = (event, block) => {', '\n      const benchCard = ')
  assert.match(drag, /event\.preventDefault\(\)/)
  assert.match(drag, /document\.body\.style\.userSelect = 'none'/)
  assert.match(drag, /document\.body\.style\.userSelect = prevSelect/)
  assert.match(drag, /addEventListener\('pointercancel', cancel\)/)
  assert.match(drag, /removeEventListener\('pointercancel', cancel\)/)
})
