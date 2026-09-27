/**
 * @local/dsh-prefill —— Cordis 入口（**引导层**）。
 *
 * 这一层故意做得极薄：它只做一件事 —— 按 `impl.js` 的 mtime 带 `?rev=` 动态
 * import，然后调用真正的 `apply`。
 *
 * ── 为什么要多这一层 ────────────────────────────────────────────────────────
 * 实测（规划 §9.2-F3 及本轮复测）：替换已安装包的 JS 后，即使 `set_bundle`
 * 关→开、即使改 `exports["."]` 换文件名，**模块代也不会换** —— loader 把该行的
 * 模块实例缓存住了，连"apply 重跑"都是用旧实例跑的（`boot.json` 的 `at` 会更新、
 * 但 `stage` 不变，这就是证据）。
 *
 * 而动态 `import()` 的 URL 由我们自己控制：`?rev=<mtime>` 每变必是新 URL，
 * 不受那份缓存约束。于是：
 *   · 只有改**本文件**需要重启；
 *   · 改 `impl.js`（壳）只需重挂 bundle（改写 profile 的 bundles 列表即可）；
 *   · 改 `gate.js`（内核）连重挂都不用 —— 壳在每次 `agent/pre-step` 时按 mtime
 *     热换。
 *
 * 注意：`apply` 是 async 的。Cordis 不保证 await 本函数的返回值，但壳里的
 * 注册（`ctx.on` / `ctx.inject`）本来就可以在 fiber 存活期内随时进行，所以
 * 这个异步窗口无害。
 *
 * @module @local/dsh-prefill
 */

import { statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Cordis 插件名。 */
export const name = 'dsh-prefill'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 用 mtime 当模块代次：文件一改，URL 就变，缓存必然未命中。 */
function revisionOf(file) {
  try {
    return String(statSync(file).mtimeMs)
  } catch {
    return String(Date.now())
  }
}

/**
 * 引导：动态加载真正的壳并委托。
 * @param ctx - 本插件行的上下文。
 */
export async function apply(ctx) {
  const shellPath = join(HERE, 'impl.js')
  const url = new URL('./impl.js', import.meta.url)
  try {
    const shell = await import(`${url.href}?rev=${revisionOf(shellPath)}`)
    return await shell.apply(ctx)
  } catch (error) {
    ctx.logger?.error?.(`dsh-prefill: 引导层加载 impl.js 失败: ${String(error?.message ?? error)}`)
    throw error
  }
}
