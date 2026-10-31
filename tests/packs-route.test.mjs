// #18：packs 路由的 block-save / block-delete / tower-save 以前对**未声明变量** extra 赋值
// （ESM 严格模式抛 ReferenceError），而 patchState 已经先执行 ⇒ 界面报错但状态已写。
// 这里用假 ctx 注册真实路由跑一遍，覆盖这三个 op（原来完全没有路由级单测）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'prefill-packs-route-'))
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
const route = routes.get('/api/dsh-prefill/packs')
assert.ok(route, 'packs 路由已注册')

const call = async (body) => {
  const res = await route.fetch({ json: async () => body })
  assert.equal(res.status, 200)
  return res.json()
}

test('block-save：不再抛 ReferenceError，返回 id，块真的写进 state', async () => {
  const data = await call({ op: 'block-save', block: { id: 'b-save', name: '存块', text: 'hello' } })
  assert.equal(data.ok, true)
  assert.equal(data.id, 'b-save')
  assert.ok(data.blocks.some((block) => block.id === 'b-save'))
})

test('tower-save：不再抛 ReferenceError，返回 id，塔写进 state', async () => {
  await call({ op: 'block-save', block: { id: 'b-t', name: '塔块', text: 'y' } })
  const data = await call({ op: 'tower-save', tower: { id: 't-save', name: '存塔', items: [{ ref: 'b-t' }] } })
  assert.equal(data.ok, true)
  assert.equal(data.id, 't-save')
  assert.ok(data.towers.some((tower) => tower.id === 't-save'))
})

test('block-delete：不再抛 ReferenceError，返回 affected，块删掉、塔里留文字快照', async () => {
  await call({ op: 'block-save', block: { id: 'b-del', name: '删块', text: 'x' } })
  await call({ op: 'tower-save', tower: { id: 't-del', name: '挂删块的塔', items: [{ ref: 'b-del' }] } })
  const data = await call({ op: 'block-delete', id: 'b-del' })
  assert.equal(data.ok, true)
  assert.deepEqual(data.affected, ['t-del'])
  assert.equal(data.blocks.some((block) => block.id === 'b-del'), false)
  const tower = data.towers.find((entry) => entry.id === 't-del')
  assert.ok(tower?.items?.[0]?.snap, '塔里保留被删块的名字/文字快照')
  assert.equal(tower.items[0].snap.text, 'x')
})

test('对照：hidden-set 等本来正常的 op 行为不变', async () => {
  const data = await call({ op: 'hidden-set', ids: ['builtin-a'] })
  assert.equal(data.ok, true)
  assert.deepEqual(data.hiddenBuiltins, ['builtin-a'])
})
