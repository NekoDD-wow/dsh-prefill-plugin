// 首轮注入保护：/compact（或自动压缩）会把发过首轮段的那几轮遮蔽掉，模型就再也看不到首轮要求。
// 做法：看会话日志里的压缩检查点（user/message + source.kind=compact-checkpoint），检测到新的就把首轮段
// 补发一次（消息带 source.first，和「下一轮发一次」同一条路径，不参与自动模式判定）；只补一次，再压缩再补。
import assert from "node:assert/strict"
import test from "node:test"
import { step } from "../gate.js"
import { compactCheckpointCount, firstPlan } from "../turn-lock.js"

const textOf = (m) => m.content.map((p) => p.text ?? "").join("")
const userMsg = (text) => ({ id: "u-" + text, role: "user", source: { kind: "user" }, content: [{ type: "text", text }] })

function harness({ sid, state = {} } = {}) {
  const log = []
  const notes = []
  const st = { version: 2, armed: [], levers: {}, allowKinds: [], ...state }
  const agent = { id: sid, status: "idle", session: { snapshotEvents: () => log } }
  const writes = []
  const api = {
    readState: () => st,
    note: (e) => notes.push(e),
    latches: new Map(),
    unlatch() {},
    rootCtx: undefined,
    patchState(patch) {
      writes.push(patch)
      for (const [key, value] of Object.entries(patch)) st[key] = value
    },
  }
  let turn = 0
  const requests = []
  async function runTurn(text) {
    turn += 1
    log.push({ type: "turn/start", data: { turn } })
    const claimed = text === undefined ? [] : [userMsg(text)]
    const payload = { agent, turn, step: 1, __seat: "root" }
    const out = await step(api, payload, { kind: "enter", messages: claimed })
    requests.push({ turn, messages: out.messages })
    for (const message of out.messages) log.push({ type: "user/message", data: message })
    log.push({ type: "assistant/message", data: { message: { source: { kind: "model" }, content: [{ type: "text", text: "回答" + turn }] } } })
    log.push({ type: "turn/end", data: { turn, reason: { kind: "completed" } } })
    return out
  }
  return { st, log, notes, writes, agent, requests, runTurn }
}

const everyTurn = (sid) => ({ [sid]: { enabled: true, text: "【每轮提醒】", firstText: "【首轮专用段】", mode: "always" } })
const injected = (messages) => messages.filter((m) => m.source?.kind === "prefill" && m.source?.prefill === "every-turn")
const checkpoint = () => ({
  type: "user/message",
  data: {
    role: "user",
    source: { kind: "compact-checkpoint" },
    content: [{ type: "text", text: "<compacted-summary>摘要</compacted-summary>" }],
    surfaceOp: { op: "replace", startSeq: 1, endSeq: 3 },
    sourceEventSeqs: [1, 2, 3],
  },
})

test("检测：只有 user/message + source.kind=compact-checkpoint 才算压缩检查点", () => {
  assert.equal(compactCheckpointCount([]), 0)
  assert.equal(compactCheckpointCount([checkpoint()]), 1)
  assert.equal(compactCheckpointCount([checkpoint(), { type: "user/message", data: { source: { kind: "user" } } }]), 1)
  assert.equal(compactCheckpointCount([{ type: "assistant/message", data: { source: { kind: "compact-checkpoint" } } }]), 0)
})

test("firstPlan：首轮段在锁住之后默认不发；refirst ⇒ 补发一次（force）；没有首轮段不发", () => {
  const turns = [{ turn: 1, synthetic: false, hasUser: true, injected: true, firstSent: true }]
  assert.equal(firstPlan({ firstText: "首轮" }, { isFirst: false }, { turns, currentTurn: 2 }).useFirst, false)
  const refirst = firstPlan({ firstText: "首轮" }, { isFirst: false }, { turns, currentTurn: 2, refirst: true })
  assert.deepEqual({ useFirst: refirst.useFirst, force: refirst.force, reason: refirst.reason }, { useFirst: true, force: true, reason: "compacted" })
  assert.equal(firstPlan({ firstText: "" }, { isFirst: false }, { turns, currentTurn: 2, refirst: true }).useFirst, false)
})

test("端到端：压缩后下一轮补发首轮段（只一次），再压缩再补发；平时发正常段", async () => {
  const h = harness({ sid: "c1", state: { everyTurn: everyTurn("c1") } })
  await h.runTurn("第一句")
  assert.match(textOf(injected(h.requests[0].messages)[0]), /首轮专用段/)
  await h.runTurn("第二句")
  assert.match(textOf(injected(h.requests[1].messages)[0]), /每轮提醒/)
  h.log.push(checkpoint())
  await h.runTurn("第三句")
  const third = injected(h.requests[2].messages)
  assert.equal(third.length, 1)
  assert.match(textOf(third[0]), /首轮专用段/, "压缩后应该补发首轮段")
  assert.equal(third[0].source.first, true, "补发的首轮段要带 source.first（不参与判定）")
  assert.match(textOf(third[0]), /历史被压缩成摘要/, "补发时带一句说明，告诉模型要求仍有效")
  assert.deepEqual(h.st.compactSeen, { c1: 1 }, "补发到第几个检查点要记进 state（重启不重复补）")
  await h.runTurn("第四句")
  assert.match(textOf(injected(h.requests[3].messages)[0]), /每轮提醒/, "只补一次")
  h.log.push(checkpoint())
  await h.runTurn("第五句")
  assert.match(textOf(injected(h.requests[4].messages)[0]), /首轮专用段/, "再压缩再补一次")
  assert.ok(h.notes.some((e) => e.compact === "refirst-armed") && h.notes.some((e) => e.compact === "refirst-sent"), "诊断日志里要看得到置标记 / 已补发")
})

test("没有压缩时不补发：连发三轮都是正常段", async () => {
  const h = harness({ sid: "c2", state: { everyTurn: everyTurn("c2") } })
  await h.runTurn("第一句")
  await h.runTurn("第二句")
  await h.runTurn("第三句")
  for (const q of h.requests.slice(1)) assert.match(textOf(injected(q.messages)[0]), /每轮提醒/)
})

test("重启后不重复补：state.compactSeen 已经记到第 N 个 ⇒ 同一批压缩不再补；新压缩照旧补", async () => {
  const h = harness({ sid: "c4", state: { everyTurn: everyTurn("c4") } })
  await h.runTurn("第一句")
  await h.runTurn("第二句")
  // 模拟：上一轮进程补发过 1 次（state 里记着 1），日志里也正好 1 个检查点。
  h.st.compactSeen = { c4: 1 }
  h.log.push(checkpoint())
  await h.runTurn("第三句")
  assert.match(textOf(injected(h.requests[2].messages)[0]), /每轮提醒/, "已补过的压缩不该再补")
  // 又压缩了一次（第 2 个检查点）⇒ 重新补发并更新 state。
  h.log.push(checkpoint())
  await h.runTurn("第四句")
  assert.match(textOf(injected(h.requests[3].messages)[0]), /首轮专用段/, "新压缩要再补")
  assert.deepEqual(h.st.compactSeen, { c4: 2 }, "补发到的检查点数目要更新")
})

test("「只注入前 N 轮」已经发完时不硬补：压缩后照旧不再注入", async () => {
  const until = { c3: { enabled: true, text: "【每轮提醒】", firstText: "【首轮专用段】", mode: "until", untilTurn: 1 } }
  const h = harness({ sid: "c3", state: { everyTurn: until } })
  await h.runTurn("第一句")
  assert.match(textOf(injected(h.requests[0].messages)[0]), /首轮专用段/)
  h.log.push(checkpoint())
  await h.runTurn("第二句")
  assert.equal(injected(h.requests[1].messages).length, 0, "只注入前 1 轮：不该因为压缩又冒出来")
})
