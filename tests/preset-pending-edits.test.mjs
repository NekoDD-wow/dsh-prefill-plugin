// 每轮注入 / 工作区说明的防抖编辑（700ms）和「整体替换配置」的路径（套用预设、取消预设、撤销取消、恢复开局）：
// 替换前必须作废还没落盘的定时器。否则在工作台改积木文字 / 「只注入前 N 轮」后 700ms 内点套用预设，
// 预设写进去之后旧定时器触发 writeEveryTurn，把旧的每轮注入整格写回 state.everyTurn[会话]，盖掉预设（工作区说明同理）。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const slice = (from, to) => {
  const start = src.indexOf(from)
  assert.ok(start >= 0, `找不到 ${from}`)
  const end = src.indexOf(to, start + from.length)
  assert.ok(end > start, `找不到 ${to}`)
  return src.slice(start, end)
}

const editEveryTurnSrc = slice('const editEveryTurn = (patch, immediate) => {', '// ── v0.15：工作台')
const editWsSrc = slice('const editWs = (patch, immediate) => {', 'const wsActive =')
const paths = {
  applyLayered: slice('const applyLayered = async', 'const appliedFlash ='),
  restoreOpening: slice('const restoreOpening = async () => {', 'const applyBuiltin = async'),
  undoClearPreset: slice('const undoClearPreset = async () => {', '/** 按引用现编译一张卡'),
}
const clearPresetSrc = slice('const clearPreset = async () => {', '/** 撤销「取消预设」')

/** 第一个 await 之前的那段（同步执行、点下去当场跑的部分）。 */
const beforeFirstAwait = (body) => body.slice(0, body.indexOf('await '))

test('防抖定时器就是 editEveryTurn / editWs 用的那两个', () => {
  assert.match(editEveryTurnSrc, /everyTurnTimer\.current = setTimeout\(run, 700\)/)
  assert.match(editEveryTurnSrc, /writeEveryTurn\(nextValue\)/, '定时器写的是编辑当时的整份 everyTurn')
  assert.match(editWsSrc, /wsTimer\.current = setTimeout\(run, 700\)/)
})

for (const [name, body] of Object.entries(paths)) {
  test(`${name}：在第一个 await 之前作废每轮注入 / 工作区说明的防抖编辑`, () => {
    const head = beforeFirstAwait(body)
    assert.match(head, /clearTimeout\(everyTurnTimer\.current\)/, `${name} 没清 everyTurnTimer：旧每轮注入会被写回`)
    assert.match(head, /clearTimeout\(wsTimer\.current\)/, `${name} 没清 wsTimer：旧工作区说明会被写回`)
    // 草稿照旧丢掉（界面显示新配置）。
    assert.match(body, /setEveryTurnDraft\(null\)/)
    assert.match(body, /setWsDraft\(null\)/)
  })
}

test('套用内置 / 自存预设、角色卡、取消预设都走 applyLayered（同一处清定时器）', () => {
  assert.match(clearPresetSrc, /await applyLayered\(\{ clearItems: true \}\)/)
  const callers = [...src.matchAll(/await applyLayered\(\{ ([a-zA-Z]+)/g)].map((match) => match[1])
  for (const first of ['pack', 'card', 'clearItems']) assert.ok(callers.includes(first), `applyLayered 调用里缺 ${first}`)
  // 除了这几处，没有别的地方整份写 everyTurn 时漏掉草稿：applyLayered 之外直接 setEveryTurnDraft(null) 的只有
  // restoreOpening / undoClearPreset（上面已测）、改「我的名字」重编角色卡、勾「下一轮发一次」（写完才清草稿，不是替换）。
})
