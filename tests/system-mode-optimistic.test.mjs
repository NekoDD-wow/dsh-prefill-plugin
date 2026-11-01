// 系统提示模式切换的卡顿修复：点下去先切高亮（乐观），写状态回来再交给真实状态。
// 根因：writeSystem 先读 fresh 状态再写（两个往返），服务端写完还要重挂闸门 + 预热系统提示，
// 前端以前要等这两个往返回来才 setEnvelope，于是高亮慢 1–2 秒。
import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"

const src = readFileSync(new URL("../client.js", import.meta.url), "utf8")
const cut = (from, to) => {
  const a = src.indexOf(from)
  const b = src.indexOf(to, a)
  return a >= 0 && b > a ? src.slice(a, b) : ""
}

test("模式高亮有乐观值：点了先按点的显示，写回来交回真实状态", () => {
  assert.match(src, /const \[systemModeWant, setSystemModeWant\] = React\.useState\(null\)/)
  assert.match(src, /const systemMode = systemModeWant \?\? systemModeStored/)
  const setMode = cut("      const setSystemMode = (mode) => {", "      // ── 预设（0.14")
  assert.ok(setMode.includes("setSystemModeWant(mode)"), "点下去要先切高亮")
  assert.ok(setMode.indexOf("setSystemModeWant(mode)") < setMode.indexOf("writeSystem(systemText, mode)"), "乐观更新要在写之前")
  assert.match(setMode, /current === mode \? null : current/, "写回来才清乐观值（连点时不误清）")
})

test("写请求串行：连点按顺序落盘，不会两个 patch 互相盖", () => {
  assert.match(src, /const systemWriteChain = React\.useRef\(Promise\.resolve\(\)\)/)
  const setMode = cut("      const setSystemMode = (mode) => {", "      // ── 预设（0.14")
  assert.match(setMode, /systemWriteChain\.current\.then\(run, run\)/)
  assert.match(setMode, /systemWriteChain\.current = next\.catch\(\(\) => \{\}\)/)
})

test("hook 都在组件早退之前（React #310）", () => {
  const dock = src.indexOf("function PrefillDock(props) {")
  const bail = src.indexOf("if (sessionId === '' || !enabled || items === null) return null", dock)
  const next = src.indexOf("function UsagePanel(props) {", dock)
  assert.ok(dock > 0 && bail > dock && next > bail, "找不到 PrefillDock / 早退 / 下一组件")
  const hooksAfterBail = src.slice(bail, next).match(/React\.use(State|Effect|Ref|Callback|Memo|LayoutEffect)/g)
  assert.equal(hooksAfterBail, null, "早退之后不能再有 hook")
})
