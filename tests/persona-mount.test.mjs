// 人格段丢失（2026-11-06，事故 7668928d）· gate.js 的四处兜底 + 本轮审查修掉的两处副作用。
//
// 这里测不到"真机 end-seed 重装配"，所以按**可观察的不变量**钉住：
//   ① prime 幂等：重复 prime 不报错、不泄漏旧闩锁；
//   ② 空挂载不伪造"已挂载"：挂载失败时宁可留空闩锁，也不塞一份注册已失效的假闩锁；
//   ③ 装配出口兜底只在**有闩锁**时触发：没启用改写、或用户手动撤掉改写之后，绝不凭空补段。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const src = readFileSync(new URL('../gate.js', import.meta.url), 'utf8')
const at = (needle) => {
  const index = src.indexOf(needle)
  assert.ok(index >= 0, '找不到锚点：' + needle)
  return index
}
/** prime() 的函数体（到下一个顶层导出为止）。 */
const primeBody = () => {
  const from = at('export async function prime(api, agent)')
  const to = src.indexOf('\nexport ', from + 10)
  return src.slice(from, to < 0 ? src.length : to)
}

test('F21 · prime 幂等：进门先撤同 id 旧闩锁，且在挂载失败时不会把"已失效的旧闩锁"塞回去', () => {
  const body = primeBody()
  // 幂等：先拿旧闩锁 → 撤 → 记 replaced-existing
  const previous = body.indexOf('const previous = api.latches.get(agent.id)')
  const unlatchAt = body.indexOf('api.unlatch(agent.id)')
  const mountAt = body.indexOf('mountLevers(agent, state, api, disposers)')
  assert.ok(previous >= 0, '必须先取旧闩锁')
  assert.ok(unlatchAt > previous, '必须在挂载之前撤掉旧闩锁')
  assert.ok(mountAt > unlatchAt, '撤旧闩锁必须早于本次挂载（否则撞 already registered）')
  assert.match(body, /prime: 'replaced-existing'/)
  // 关键：回塞旧闩锁要受 previousDisposed 约束 —— 旧闩锁的 disposers 已经跑过，
  // 塞回去只会得到"看着有挂载、其实什么都没挂"的假闩锁。
  assert.match(body, /let previousDisposed = false/, '需要记录"旧闩锁是否真的被撤掉了"')
  assert.match(body, /previousDisposed = true/)
  // v0.21.14 审查 #85 后：旧闩锁被撤掉（disposers 跑过）时**不许**回塞，只有没撤成（旧注册还活着）才保留。
  assert.match(body, /if \(error !== '' && disposers\.length === 0 && previous !== undefined && !previousDisposed\)/, '回塞旧闩锁的分支必须要求「旧闩锁没被撤掉」')
  assert.doesNotMatch(body, /if \(error !== '' && disposers\.length === 0 && previousDisposed\)/, '旧写法（回塞已撤掉的假闩锁）已被审查修掉，不许回退')
})

test('F20 · 改写段挂载逐条兜底：一条抛错不许把后面的 lever 带崩', () => {
  const start = at('for (const [name, text] of Object.entries(overrides.sections)) {')
  // 截到下一个 lever 分组（contexts）为止：再往后就是别的循环，不该一起断言
  const end = src.indexOf('if (overrides.contexts !== null', start)
  const chunk = src.slice(start, end > start ? end : start + 1800)
  assert.match(chunk, /try \{/, '必须包 try')
  assert.match(chunk, /catch \(thrown\)/, '必须捕获并跳过这一条')
  assert.match(chunk, /section_mount_failed/, '跳过要留审计')
  // 关键：撞名就跳过，**不要**改个名字硬塞（确定性后缀必然再撞、且注册者不明 ⇒ 泄漏）
  assert.doesNotMatch(chunk, /name \+ ':recover/, '不许有"改名重挂"的确定性后缀')
  assert.doesNotMatch(chunk, /catch \(second\)/, '不许有第二次尝试')
  // 循环体内不得出现未被 try 包住的裸 sp.section
  const bare = /push\(sp\.section\([^)]*\)\)\s*\}\s*(?!catch)/.test(chunk)
  assert.equal(bare, false, '循环里的 sp.section 必须被 catch 兜住')
})

test('F22 · 人格段兜底只在有闩锁时触发（没启用 / 用户手动关掉都不许凭空补段）', () => {
  assert.match(src, /function ensureOverrideSections\(api, id, assembly\)/, '兜底函数要在')
  // 触发点：装配观察者里，必须以 latch 为门
  const call = src.indexOf('ensureOverrideSections(api, id, filtered)')
  assert.ok(call >= 0, '装配观察者要调用兜底')
  const line = src.slice(src.lastIndexOf('\n', call) + 1, src.indexOf('\n', call))
  assert.match(line, /latch === undefined \? filtered :/, '没闩锁（没启用 / 已停用）⇒ 不兜')
  // 兜底按 name 定位：缺的补、同名正文不一致的**替换**（v0.21.14 审查 #87 前是只追加，会出两版人格）
  const fn = src.slice(at('function ensureOverrideSections'), at('function ensureToolsBlocker'))
  assert.match(fn, /nextSections\[at\] = \{ \.\.\.existing, text \}/, '同名段正文不一致要替换，不能追加同名段')
  assert.match(fn, /const indexByName = new Map\(\)/, '要按 name 建索引判断在不在（不按正文前缀）')
  assert.match(fn, /override_recovered/, '补过 / 替换过要留审计')
})

test('F23 · 空挂载强制重挂（闩锁在但一条都没挂上时不许直接沿用）', () => {
  const start = at('const emptyMount =')
  const chunk = src.slice(start, start + 700)
  assert.match(chunk, /disposers\?\.length \?\? 0\) === 0/, '判据：disposers 为空')
  assert.match(chunk, /hasOverrides \|\| hasInjects/, '只有"本该挂东西"的会话才重挂')
  assert.match(chunk, /const remounted = emptyMount \|\| /, '重挂标志要被空挂载触发')
  assert.match(chunk, /remount: 'empty-latch'/, '要留审计')
})

test('诊断：异常类条目单独列出，不会被常规审计挤出环（面板 / 排查入口）', () => {
  const impl = readFileSync(new URL('../impl.js', import.meta.url), 'utf8')
  assert.match(impl, /issues: diagnostics\.last\.filter\(/, 'diagnostics.issues 必须存在')
  for (const key of ['mountError', 'override_recovered', 'section_mount_failed', 'remount']) {
    assert.ok(impl.includes('entry.' + key), 'issues 要覆盖 ' + key)
  }
  // 原先只给 last 8 条：正常跑起来全是 blocker/assembly 审计，真问题会被挤没。
  assert.match(impl, /last: diagnostics\.last\.slice\(-8\)/)
})
