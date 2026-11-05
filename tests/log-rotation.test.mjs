// F17 轮转写入器：行边界切换（不写半行）+ 失败不抛 + 内存字节计数器。
//
// 设计依据（本机实测）：append 1.2KB ≈ 241 µs/次，statSync ≈ 29 µs/次，且 append 成本**不随文件大小增长**
// （24MB 仍 228 µs）⇒ 轮转解决磁盘增长、不解决速度；计数器必须常驻内存，不能每次写前 stat。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRotatingLog } from '../reasoning-prefix.js'
import { createReasoningPrefixProxy } from '../reasoning-prefix.js'
import http from 'node:http'

const tempDirs = []
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'prefill-rotate-'))
  tempDirs.push(dir)
  return dir
}
test.after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

/** 11 字节一行，方便心算 maxBytes。 */
const line = (i) => 'line-' + String(i).padStart(4, '0') + '\n'
const LINE_BYTES = Buffer.byteLength(line(0))

/** 把当前文件与历史文件里的所有行读出来（轮转文件缺失就跳过）。 */
const readAllLines = (file, keepFiles = 4) => {
  const lines = []
  for (let index = 0; index <= keepFiles; index += 1) {
    const path = index === 0 ? file : file + '.' + index
    if (!existsSync(path)) continue
    const text = readFileSync(path, 'utf8')
    if (text === '') continue
    lines.push(...text.split('\n').filter((item) => item !== ''))
  }
  return lines
}

/** 当前 + 全部历史文件的字节占用。 */
const footprint = (file, keepFiles = 4) => {
  let total = 0
  for (let index = 0; index <= keepFiles; index += 1) {
    const path = index === 0 ? file : file + '.' + index
    if (existsSync(path)) total += statSync(path).size
  }
  return total
}

const sizeOf = (path) => (existsSync(path) ? statSync(path).size : 0)

// ── ① 行边界切换：file + .1 + .2 都在，且每行完整 ─────────────────────────

test('轮转：maxBytes 很小 ⇒ file/.1/.2 都有，且每行完整（绝不半行）', () => {
  const file = join(tempDir(), 'x.jsonl')
  const log = createRotatingLog({ file, policy: () => ({ maxBytes: 30, keepFiles: 2 }) })
  for (let i = 1; i <= 7; i += 1) log.write(line(i))

  assert.ok(existsSync(file), '当前文件必须在')
  assert.ok(existsSync(file + '.1'), '最新历史必须在')
  assert.ok(existsSync(file + '.2'), '第二代历史必须在')
  assert.ok(!existsSync(file + '.3'), 'keepFiles=2 ⇒ 不许有 .3')

  const lines = readAllLines(file, 2)
  assert.ok(lines.length > 0)
  for (const item of lines) {
    assert.match(item, /^line-\d{4}$/, '出现半行 / 残缺行: ' + JSON.stringify(item))
  }
  // 最新的那行一定还在当前文件里
  assert.match(readFileSync(file, 'utf8'), /line-0007/)
})

test('轮转：总占用 ≤ maxBytes × (keepFiles+1) + 单行', () => {
  const file = join(tempDir(), 'x.jsonl')
  const maxBytes = 30
  const keepFiles = 2
  const log = createRotatingLog({ file, policy: () => ({ maxBytes, keepFiles }) })
  for (let i = 1; i <= 40; i += 1) log.write(line(i))
  assert.ok(
    footprint(file, keepFiles) <= maxBytes * (keepFiles + 1) + LINE_BYTES,
    '占用 ' + footprint(file, keepFiles) + ' 超出上限',
  )
})

test('轮转：每一代都不超过 maxBytes（除非单行本身超限）', () => {
  const file = join(tempDir(), 'x.jsonl')
  const log = createRotatingLog({ file, policy: () => ({ maxBytes: 30, keepFiles: 3 }) })
  for (let i = 1; i <= 20; i += 1) log.write(line(i))
  assert.ok(sizeOf(file) <= 30)
  for (let index = 1; index <= 3; index += 1) assert.ok(sizeOf(file + '.' + index) <= 30)
})

// ── ③ keepFiles = 0 ⇒ 只截断，不留历史 ────────────────────────────────────

test('轮转：keepFiles=0 ⇒ 直接截断，不留任何历史文件', () => {
  const file = join(tempDir(), 'x.jsonl')
  const log = createRotatingLog({ file, policy: () => ({ maxBytes: 20, keepFiles: 0 }) })
  for (let i = 1; i <= 5; i += 1) log.write(line(i))
  assert.ok(existsSync(file))
  assert.ok(!existsSync(file + '.1'), 'keepFiles=0 不许留历史')
  const lines = readAllLines(file, 2)
  assert.deepEqual(lines, [line(5).trim()], '只留最后写进去的那行')
})

// ── ④ maxBytes = 0 ⇒ 完全不轮转 ───────────────────────────────────────────

test('轮转：maxBytes=0 ⇒ 完全不轮转，一个历史文件都不产生', () => {
  const file = join(tempDir(), 'x.jsonl')
  const log = createRotatingLog({ file, policy: () => ({ maxBytes: 0, keepFiles: 3 }) })
  for (let i = 1; i <= 100; i += 1) log.write(line(i))
  assert.equal(readAllLines(file, 4).length, 100)
  assert.ok(!existsSync(file + '.1'))
  assert.equal(sizeOf(file), 100 * LINE_BYTES)
})

test('轮转：policy 缺键 / 抛错 ⇒ 都当"不轮转"（默认路径零变化）', () => {
  const file = join(tempDir(), 'x.jsonl')
  const log = createRotatingLog({ file, policy: () => { throw new Error('boom') } })
  for (let i = 1; i <= 20; i += 1) log.write(line(i))
  assert.equal(readAllLines(file, 4).length, 20)
  assert.ok(!existsSync(file + '.1'))
})

// ── ⑤ 单行超 maxBytes ⇒ 不无限轮转 ────────────────────────────────────────

test('轮转：单行就超过 maxBytes ⇒ 每次写最多轮转一次，不会无限轮转', () => {
  const file = join(tempDir(), 'x.jsonl')
  const big = 'X'.repeat(50) + '\n'
  const log = createRotatingLog({ file, policy: () => ({ maxBytes: 5, keepFiles: 3 }) })
  log.write(big)
  log.write(big)
  log.write(big)
  assert.equal(sizeOf(file), Buffer.byteLength(big), '这一行必须完整写出去')
  assert.ok(existsSync(file + '.1'))
  assert.ok(existsSync(file + '.2'))
  assert.ok(!existsSync(file + '.4'), 'keepFiles=3 ⇒ 不许有 .4')
})

test('轮转：空文件永不轮转（哪怕这行超限）', () => {
  const file = join(tempDir(), 'x.jsonl')
  const log = createRotatingLog({ file, policy: () => ({ maxBytes: 5, keepFiles: 2 }) })
  log.write('Y'.repeat(30) + '\n')
  assert.ok(!existsSync(file + '.1'), '第一次写不轮转（没有内容可轮转）')
  assert.equal(sizeOf(file), 31)
})

// ── ⑥ size() 与实际文件大小一致（含播种）────────────────────────────────

test('size()：已有文件按 statSync 播种，之后按写入累加', () => {
  const file = join(tempDir(), 'x.jsonl')
  const seed = 'seed\n'
  writeFileSync(file, seed)
  const log = createRotatingLog({ file, policy: () => ({ maxBytes: 0, keepFiles: 0 }) })
  assert.equal(log.size(), Buffer.byteLength(seed), '首次必须播种已有大小')
  log.write(line(1))
  assert.equal(log.size(), Buffer.byteLength(seed) + LINE_BYTES)
  assert.equal(log.size(), statSync(file).size, 'size() 必须与实际文件大小一致')
})

test('size()：轮转后计数器跟着当前文件归零', () => {
  const file = join(tempDir(), 'x.jsonl')
  const log = createRotatingLog({ file, policy: () => ({ maxBytes: 30, keepFiles: 2 }) })
  for (let i = 1; i <= 7; i += 1) log.write(line(i))
  assert.equal(log.size(), statSync(file).size)
  assert.equal(log.size(), LINE_BYTES, '7 行、每 30 字节轮转一次 ⇒ 当前文件只剩最后一行')
})

test('size()：路径不存在 ⇒ 0，不抛', () => {
  const dir = tempDir()
  const file = join(dir, 'nope', 'x.log')
  const log = createRotatingLog({ file, policy: () => ({ maxBytes: 0, keepFiles: 0 }) })
  assert.equal(log.size(), 0)
  assert.equal(log.path(), file)
})

test('size()：空 file ⇒ 空操作（不抛、不写）', () => {
  const log = createRotatingLog({ file: '', policy: () => ({ maxBytes: 10, keepFiles: 1 }) })
  assert.equal(log.path(), '')
  assert.equal(log.size(), 0)
  assert.doesNotThrow(() => log.write('x\n'))
})

// ── ⑦ 轮转失败不抛、后续写仍尝试 ──────────────────────────────────────────

test('轮转失败：路径非法（目录不存在）⇒ 不抛，后续写仍尝试', () => {
  const file = join(tempDir(), 'missing-dir', 'x.log')
  const log = createRotatingLog({ file, policy: () => ({ maxBytes: 10, keepFiles: 2 }) })
  assert.doesNotThrow(() => {
    for (let i = 1; i <= 5; i += 1) log.write(line(i))
  })
  assert.equal(log.size(), 0, '一行都没写进去 ⇒ 计数器保持 0')
})

test('轮转失败：历史位被目录占住 ⇒ 吞掉异常，继续往当前文件追加', () => {
  const dir = tempDir()
  const file = join(dir, 'x.jsonl')
  const log = createRotatingLog({ file, policy: () => ({ maxBytes: 20, keepFiles: 1 }) })
  log.write(line(1))
  log.write(line(2)) // 已 22 字节，下次写会触发轮转
  mkdirSync(file + '.1') // 把历史位占成目录 ⇒ renameSync / rmSync 都会失败
  assert.doesNotThrow(() => log.write(line(3)), '轮转失败绝不能抛进请求路径')
  assert.match(readFileSync(file, 'utf8'), /line-0003/, '宁可日志长大，也不能丢行')
  assert.equal(log.size(), statSync(file).size)
})

// ── 计数器语义 + policy 现取 ──────────────────────────────────────────────

test('计数器常驻内存：外部改动文件不被察觉（这正是"不每次 stat"的代价）', () => {
  const file = join(tempDir(), 'x.jsonl')
  const log = createRotatingLog({ file, policy: () => ({ maxBytes: 100, keepFiles: 1 }) })
  log.write(line(1))
  assert.equal(log.size(), LINE_BYTES)
  writeFileSync(file, '') // 外部把它清空
  assert.equal(log.size(), LINE_BYTES, '内存计数器不重新 stat（设计如此：省掉每次 29 µs）')
})

test('policy 每次写入现取：中途改配置立刻生效', () => {
  const file = join(tempDir(), 'x.jsonl')
  let maxBytes = 0
  const log = createRotatingLog({ file, policy: () => ({ maxBytes, keepFiles: 1 }) })
  for (let i = 1; i <= 5; i += 1) log.write(line(i))
  assert.ok(!existsSync(file + '.1'), 'maxBytes=0 时不该轮转')
  maxBytes = 20
  log.write(line(6))
  log.write(line(7))
  assert.ok(existsSync(file + '.1'), '改完配置下一次写就该按新阈值轮转')
})

test('轮转：write 接受 Buffer（rawFile 是按 chunk 写原始字节的）', () => {
  const file = join(tempDir(), 'raw.sse')
  const log = createRotatingLog({ file, policy: () => ({ maxBytes: 40, keepFiles: 1 }) })
  log.write(Buffer.from('data: ' + 'A'.repeat(20) + '\n\n', 'utf8'))
  log.write(Buffer.from('data: ' + 'B'.repeat(20) + '\n\n', 'utf8'))
  log.write(Buffer.from('data: ' + 'C'.repeat(20) + '\n\n', 'utf8'))
  assert.equal(log.size(), statSync(file).size)
  assert.ok(existsSync(file + '.1'))
})

// ── 代理侧接线：7 个写入点走同一套（这里用默认开的结果行验证）─────────────

test('代理接线：结果行按 logMaxBytes 轮转，且每条都是完整 JSON', async () => {
  const dir = tempDir()
  const file = join(dir, 'result.jsonl')
  const upstream = http.createServer(async (req, res) => {
    for await (const _chunk of req) { /* 读完 */ }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
  })
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const proxy = createReasoningPrefixProxy({
    getConfig: () => ({
      enabled: true,
      upstream: 'http://127.0.0.1:' + upstream.address().port,
      reasoningPrefix: '他喵',
      stripTools: true,
      resultFile: file,
      // 一条结果行约 630 字节；4000 × (8+1) 的容量足够装下这 12 行，同时一定触发过轮转。
      logMaxBytes: 4000,
      logKeepFiles: 8,
    }),
  })
  const port = await proxy.listen(0)
  try {
    for (let i = 0; i < 12; i += 1) {
      const response = await fetch('http://127.0.0.1:' + port + '/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', connection: 'close' },
        body: JSON.stringify({ model: 'deepseek-flash', messages: [{ role: 'user', content: '你好' + i }] }),
      })
      await response.text()
    }
  } finally {
    proxy.server.closeAllConnections?.()
    await proxy.close()
    upstream.closeAllConnections?.()
    await new Promise((resolve) => upstream.close(resolve))
  }
  assert.ok(existsSync(file + '.1'), '结果行必须真的轮转过（写入器接线生效）')
  const lines = readAllLines(file, 8)
  assert.ok(lines.length >= 12, '轮转不许丢行（容量足够时必须 12 条都在）: ' + lines.length)
  for (const item of lines) {
    const row = JSON.parse(item) // 半行会在这里直接抛
    assert.equal(typeof row.requestId, 'string')
  }
})
