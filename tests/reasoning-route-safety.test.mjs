// 思考前缀的模型路由（llm-pi-ai 里的 provider 条目）只能动本插件自己写的那条：
// ① 路由名撞上用户已有的 provider（如 deepseek）时，启用不能覆盖、停用不能删除；
// ② 启用状态下改路由名，旧路由要删掉，不能留下停用后指向死端口的孤儿 provider。
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { exitIfLeaked, fakeSettings, freePort, mount } from './impl-mount-harness.mjs'

const USER_DEEPSEEK = { displayName: 'DeepSeek', apiKeyEnv: 'DEEPSEEK_API_KEY', api: 'openai-completions', baseURL: 'https://api.deepseek.com/v1', models: [{ id: 'deepseek-chat' }] }
const settings = fakeSettings({ deepseek: USER_DEEPSEEK })
const PORT = await freePort()
const h = await mount({
  tag: 'route-safety',
  settings,
  state: { ui: { experimental: true, reasoningPrefix: { enabled: true, prefix: '想：', port: PORT } } },
})
const CONFIG = '/api/dsh-prefill/experimental/config'
const ENABLE = '/api/dsh-prefill/reasoning/enable'
const DISABLE = '/api/dsh-prefill/reasoning/disable'

after(async () => {
  await h.post(DISABLE, {})
  exitIfLeaked()
})

test('前置：启动后写了 prefill-think 路由，指向本机代理', () => {
  assert.equal(settings.store.providers['prefill-think']?.baseURL, `http://127.0.0.1:${PORT}/beta/v1`)
  assert.deepEqual(settings.store.providers.deepseek, USER_DEEPSEEK)
})

test('启用状态下改路由名：旧路由被删掉，只留新路由', async () => {
  const res = await h.post(CONFIG, { providerId: 'prefill-x' })
  assert.notEqual(res.ok, false, JSON.stringify(res))
  assert.ok(settings.store.providers['prefill-x'], '新路由已写')
  assert.equal(settings.store.providers['prefill-think'], undefined, '旧路由 prefill-think 仍在 llm-pi-ai 配置里（停用后会指向死端口）')
  assert.deepEqual(settings.store.providers.deepseek, USER_DEEPSEEK)
})

test('实验面板把路由名改成已有 provider（deepseek）：拒绝，用户的 provider 原样', async () => {
  const res = await h.post(CONFIG, { providerId: 'deepseek' })
  assert.equal(res.ok, false, '撞名应被拒绝')
  assert.match(String(res.error), /deepseek/)
  assert.equal(h.readStateFile().ui.reasoningPrefix.providerId, 'prefill-x', '被拒绝的路由名不应落盘')
  assert.deepEqual(settings.store.providers.deepseek, USER_DEEPSEEK)
})

test('POST /reasoning/enable 带撞名的 providerId：拒绝，用户的 provider 原样', async () => {
  const res = await h.post(ENABLE, { prefix: '想：', providerId: 'deepseek' })
  assert.equal(res.ok, false, '撞名应被拒绝')
  assert.equal(h.readStateFile().ui.reasoningPrefix.providerId, 'prefill-x')
  assert.deepEqual(settings.store.providers.deepseek, USER_DEEPSEEK)
})

test('状态文件里已经是撞名的路由名（旧版本写进去的）：启用不覆盖、停用不删除用户的 provider', async () => {
  const raw = h.readStateFile()
  h.seed({ ...raw, ui: { ...raw.ui, reasoningPrefix: { ...raw.ui.reasoningPrefix, providerId: 'deepseek', enabled: true } } })
  const enabled = await h.post(ENABLE, { prefix: '想：' })
  assert.equal(enabled.applied?.ok, false, '路由写不进去要如实报失败')
  assert.deepEqual(settings.store.providers.deepseek, USER_DEEPSEEK, '用户的 deepseek provider 被覆盖')
  await h.post(DISABLE, {})
  assert.deepEqual(settings.store.providers.deepseek, USER_DEEPSEEK, '用户的 deepseek provider 被删除')
  assert.equal(settings.store.providers['prefill-x'], undefined, '本插件之前写的 prefill-x 也该清掉')
})

test('settings.describe 形状变化读不到 providers：启用 / 停用都 fail-closed，不覆盖也不删用户 provider', async () => {
  const raw = h.readStateFile()
  h.seed({ ...raw, ui: { ...raw.ui, reasoningPrefix: { ...raw.ui.reasoningPrefix, providerId: 'deepseek', enabled: true } } })
  const original = settings.describe
  settings.describe = () => [{ ns: 'llm-pi-ai', value: { revision: 1 } }]
  try {
    const enabled = await h.post(ENABLE, { prefix: '想：' })
    assert.equal(enabled.applied?.ok, false, '读不到 providers 时不许写路由（会覆盖同名用户 provider）')
    assert.deepEqual(settings.store.providers.deepseek, USER_DEEPSEEK, '用户的 deepseek provider 被覆盖')
    await h.post(DISABLE, {})
    assert.deepEqual(settings.store.providers.deepseek, USER_DEEPSEEK, '读不到 providers 时不许删同名 provider')
  } finally {
    settings.describe = original
  }
})
