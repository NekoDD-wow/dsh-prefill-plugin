// #19：DSH 0.2.1 的 agent-loop 只注册 provider / model 两个 prompt variable（{{cwd}} 不是），
// dsh-system-prompt 对未知变量严格抛错。以前 interpolateOk 把 cwd 当合法变量 ⇒ 带 {{cwd}} 的段
// 不设 interpolate:false ⇒ renderPrompt 抛 unknown prompt variable，整轮装配失败。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { interpolateOk } from '../gate.js'
import { ZH_OFFICIAL_PROMPT } from '../builtin-presets.js'

test('interpolateOk：只对 DSH 真实注册的变量开插值（provider / model）', () => {
  assert.equal(interpolateOk('{{model}}'), true)
  assert.equal(interpolateOk('前面 {{ model }} 后面'), true)
  assert.equal(interpolateOk('{{provider}}'), true)
  assert.equal(interpolateOk('{{provider}} / {{model}}'), true)
  assert.equal(interpolateOk('无变量'), true)
  assert.equal(interpolateOk(''), true)
  // 未知变量：整段原样保留（interpolate:false），而不是让 renderPrompt 抛错。
  assert.equal(interpolateOk('{{cwd}}'), false)
  assert.equal(interpolateOk('{{model}} 和 {{cwd}}'), false)
  assert.equal(interpolateOk('{{whatever}}'), false)
})

test('内置「中文版官方系统提示」只用 DSH 真实注册的变量，且不再含 {{cwd}}', () => {
  const refs = [...ZH_OFFICIAL_PROMPT.matchAll(/\{\{([^{}]*)\}\}/g)].map((match) => match[1].trim())
  for (const name of refs) assert.ok(['provider', 'model'].includes(name), `内置预设出现未知变量 {{${name}}}`)
  assert.doesNotMatch(ZH_OFFICIAL_PROMPT, /\{\{cwd\}\}/)
})

test('客户端提示不再教用户写 {{cwd}}', () => {
  const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /\{\{cwd\}\}/)
  assert.match(src, /可以写 \{\{model\}\}/)
})
