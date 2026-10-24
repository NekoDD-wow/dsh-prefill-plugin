/**
 * 从会话事件里取出「真实对话」，转成预设的开场条目（items）。
 *
 * 用途：把聊到一半的会话存成预设，新会话套用后从同一个起点接着聊（类似分支，但能编辑、能反复用）。
 *
 * 取什么：
 * - 用户原话（source.kind === 'user'，含套预设时首轮写进历史的开场条目）；
 * - 模型回答正文（同一轮多个步骤的正文合成一条），可选带思维链。
 * 不取什么：
 * - 插件注入（每轮注入 / 世界书 / 故事记忆 / 会话内注入，source.kind === 'prefill'）、
 *   runtime-context、系统提示 —— 这些由预设的其他字段或新会话自己重新生成；
 * - 工具调用和工具结果：开场条目只有纯文本，写回去会变成「AI 说自己调了工具」，默认丢掉，只计数。
 */

/** 一条消息里的纯文本（只取 text 段）。 */
function textOf(message) {
  const content = message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((part) => (part?.type === 'text' && typeof part.text === 'string' ? part.text : '')).join('')
}

function partsOf(message, type) {
  const content = Array.isArray(message?.content) ? message.content : []
  return content.filter((part) => part?.type === type)
}

/**
 * @param events 会话事件（snapshotEvents 或落盘日志解码结果）
 * @param opts { reasoning?: boolean, fromTurn?: number, toTurn?: number }
 *   fromTurn / toTurn：只取这几轮（含两端）；不给 = 全部。
 * @returns { items, turnCount, lastTurn, toolCalls, skipped }
 *   items：[{ role:'user', text } | { role:'assistant', text, reasoning }]，已去掉空条目；
 *   turnCount：实际取到的轮数（不叫 turns，免得和路由 envelope 的 turns 撞名）；lastTurn：会话里最后一轮的轮号；toolCalls：丢掉的工具调用数；
 *   skipped：丢掉的注入消息数。
 */
export function historyToItems(events, opts = {}) {
  const withReasoning = opts.reasoning === true
  const from = Number.isFinite(Number(opts.fromTurn)) && Number(opts.fromTurn) > 0 ? Math.floor(Number(opts.fromTurn)) : 1
  const to = Number.isFinite(Number(opts.toTurn)) && Number(opts.toTurn) > 0 ? Math.floor(Number(opts.toTurn)) : Infinity
  const items = []
  const taken = new Set()
  let turn = 0
  let lastTurn = 0
  let toolCalls = 0
  let skipped = 0
  // 同一轮的回答：多个步骤（中间夹着工具调用）合成一条。
  let answer = null
  const flush = () => {
    if (answer === null) return
    const text = answer.texts.filter((part) => part.trim() !== '').join('\n\n').trim()
    const reasoning = withReasoning ? answer.reasoning.filter((part) => part.trim() !== '').join('\n\n').trim() : ''
    if (text !== '' || reasoning !== '') {
      items.push({ role: 'assistant', text, reasoning })
      taken.add(answer.turn)
    }
    answer = null
  }
  const inRange = () => turn >= from && turn <= to

  for (const event of Array.isArray(events) ? events : []) {
    const type = event?.type
    const data = event?.data ?? {}
    if (type === 'turn/start') {
      flush()
      turn = Number.isFinite(data.turn) ? data.turn : turn + 1
      if (turn > lastTurn) lastTurn = turn
    } else if (type === 'user/message') {
      const kind = data?.source?.kind
      if (kind !== 'user') {
        if (kind === 'prefill' && inRange()) skipped += 1
        continue
      }
      if (!inRange()) continue
      flush()
      const text = textOf(data).trim()
      if (text !== '') {
        items.push({ role: 'user', text })
        taken.add(turn)
      }
    } else if (type === 'assistant/message') {
      const message = data?.message
      if (message?.source?.kind !== undefined && message.source.kind !== 'model') continue
      if (!inRange()) continue
      if (answer !== null && answer.turn !== turn) flush()
      if (answer === null) answer = { turn, texts: [], reasoning: [] }
      answer.texts.push(textOf(message))
      for (const part of partsOf(message, 'reasoning')) if (typeof part.text === 'string') answer.reasoning.push(part.text)
      toolCalls += partsOf(message, 'tool-call').length
    }
  }
  flush()
  return { items, turnCount: taken.size, lastTurn, toolCalls, skipped }
}

/**
 * from-session 的轮次范围：{ fromTurn, toTurn } → 规整后的 { from, to }（to = 0 表示到最后）。
 * 兼容旧调用（只给 toTurn）；from 缺省 1；to < from 时对调。
 */
export function turnRange(body) {
  const num = (raw) => {
    const value = Math.floor(Number(raw))
    return Number.isFinite(value) && value > 0 ? value : 0
  }
  let from = num(body?.fromTurn) || 1
  let to = num(body?.toTurn)
  if (to > 0 && to < from) [from, to] = [to, from]
  return { from, to }
}
