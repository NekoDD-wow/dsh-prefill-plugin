import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'

const dir = new URL('../', import.meta.url)
const pkg = JSON.parse(readFileSync(new URL('package.json', dir), 'utf8'))
const files = Array.isArray(pkg.files) ? pkg.files : []
const onDisk = readdirSync(dir).filter((name) => name.endsWith('.js'))

/** 白名单里的通配（locale/*.json）不算具体文件。 */
const concrete = files.filter((name) => !name.includes('*'))

test('package.json files 白名单覆盖插件目录里所有 .js', () => {
  // 漏了会打出残缺包：impl.js 引用了不在白名单里的文件，装上去直接加载失败。
  const missing = onDisk.filter((name) => !concrete.includes(name))
  assert.deepEqual(missing, [], '这些文件不在 files 白名单里：' + missing.join(', '))
})

test('files 白名单里写的文件都在目录里', () => {
  const missing = concrete.filter((name) => !existsSync(new URL(name, dir)))
  assert.deepEqual(missing, [], '白名单里有、目录里没有：' + missing.join(', '))
})

test('files 里没有重复项', () => {
  assert.equal(new Set(files).size, files.length)
})
