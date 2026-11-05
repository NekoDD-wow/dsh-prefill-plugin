/**
 * 思考前缀（推理预填充）—— 官方 DeepSeek Chat Prefix Completion (Beta) 的最小代理。
 *
 * 官方文档（api-docs.deepseek.com）：
 *   · 必须 base_url="https://api.deepseek.com/beta"；
 *   · messages 最后一条是 assistant，带 prefix: true；
 *   · 思考前缀 = 该条消息里的 reasoning_content（Beta 字段）；
 *   · prefix 与 function calling 互斥（带 tools 会被官方 400）。
 *
 * 所以这一层只做一件事：把 DSH 发出去的 OpenAI 请求改写成「最后一条 assistant
 * 前缀」再转发。认证沿用 DSH 自己发出的 Authorization，代理不持有 key。
 *
 * @module @local/dsh-prefill/reasoning-prefix
 */
import http from 'node:http'
import { appendFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'

/**
 * 取一条消息的文本。同一个函数同时吃两侧的形状：
 *   · DSH 侧：消息对象 `{role, content: [{type:'text',text}]}`（block 数组，也可能直接是 string）；
 *   · wire 侧：OpenAI 的 `content: string | [{type:'text',text}]`。
 * 认不出的部分（图片 / tool_use 等）返回空串，不抛错。
 * @param {unknown} message
 * @returns {string}
 */
export function messageText(message) {
  if (message === null || message === undefined) return ''
  if (typeof message === 'string') return message
  if (Array.isArray(message)) {
    let out = ''
    for (const part of message) out += messageText(part)
    return out
  }
  if (typeof message === 'object') {
    if (typeof message.text === 'string') return message.text
    if (message.content !== undefined) return messageText(message.content)
  }
  return ''
}

/**
 * 最后一条消息的内容指纹（sha1 hex）。关联通道靠它把「宿主侧登记的会话」对上「代理收到的请求」。
 * 没有消息、或最后一条取不出文本 ⇒ 返回 ''（空指纹不参与匹配，避免所有空消息互相撞上）。
 * @param {unknown} messages
 * @returns {string}
 */
export function lastMessageHash(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return ''
  const text = messageText(messages[messages.length - 1])
  if (text === '') return ''
  return createHash('sha1').update(text, 'utf8').digest('hex')
}

/**
 * 从上游响应体里抽「模型正文」（非 shim 转发路径用：结果行的 textHead / textTail）。
 *   · SSE：逐帧取 `choices[0].delta.content` 拼接；
 *   · 非流式 JSON：取 `choices[0].message.content`。
 * 认不出 / 解析失败 ⇒ '' —— 宁可不记，也不把整段 JSON / SSE 原始帧当正文写进结果行。
 * @param {unknown} contentType
 * @param {string} text
 * @returns {string}
 */
export function extractResponseText(contentType, text) {
  if (typeof text !== 'string' || text === '') return ''
  try {
    if (String(contentType).includes('text/event-stream')) {
      let out = ''
      for (const line of text.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (payload === '' || payload === '[DONE]') continue
        let parsed
        try {
          parsed = JSON.parse(payload)
        } catch {
          continue
        }
        const content = parsed?.choices?.[0]?.delta?.content
        if (typeof content === 'string') out += content
      }
      return out
    }
    const parsed = JSON.parse(text)
    const content = parsed?.choices?.[0]?.message?.content
    return typeof content === 'string' ? content : ''
  } catch {
    return ''
  }
}

/**
 * 从宿主侧登记的 pending 表里找出**唯一**匹配本次请求的那条，并消费它。
 * 绝不猜：0 候选 / 超 TTL / ≥2 条同 hash ⇒ null（宁可 sessionId=null，也不填「最可能」的会话）。
 * @param {Array<{sessionId?:string, hash?:string, at?:number, turn?:number, step?:number, confidence?:string}>} pending 会被就地消费（命中那条 splice 掉）
 * @param {{messages?: unknown}} body 代理收到的原始请求体（注入前缀**之前**）
 * @param {number} now 当前毫秒时间戳
 * @param {number} ttlMs 登记的有效期
 * @returns {{sessionId: string, turn: number|null, step: number|null, confidence: 'exact'|'content'} | null}
 */
export function matchPendingTrace(pending, body, now, ttlMs) {
  if (!Array.isArray(pending) || pending.length === 0) return null
  const hash = lastMessageHash(body?.messages)
  if (hash === '') return null
  const ttl = Number.isFinite(ttlMs) ? ttlMs : 0
  const hits = []
  for (let index = 0; index < pending.length; index += 1) {
    const entry = pending[index]
    if (entry === null || typeof entry !== 'object') continue
    if (entry.hash !== hash) continue
    if (!Number.isFinite(entry.at) || now - entry.at > ttl) continue
    hits.push(index)
  }
  // 唯一命中才认：0 条 = 没登记过；≥2 条 = TTL 窗口内有歧义（并发会话 / 重复内容）。
  if (hits.length !== 1) return null
  const [hit] = pending.splice(hits[0], 1)
  return {
    sessionId: typeof hit.sessionId === 'string' ? hit.sessionId : '',
    turn: Number.isInteger(hit.turn) ? hit.turn : null,
    step: Number.isInteger(hit.step) ? hit.step : null,
    confidence: hit.confidence === 'exact' ? 'exact' : 'content',
  }
}

/** 判断一条请求能否加前缀：无工具、有消息、思考前缀 / 内容前缀至少一个非空。 */
export function canInject(body, reasoningPrefix, contentPrefix = '') {
  const reasoning = typeof reasoningPrefix === 'string' ? reasoningPrefix : ''
  const content = typeof contentPrefix === 'string' ? contentPrefix : ''
  if (reasoning.trim() === '' && content.trim() === '') return 'empty-prefix'
  if (!Array.isArray(body?.messages) || body.messages.length === 0) return 'no-messages'
  if (Array.isArray(body.tools) && body.tools.length > 0) return 'has-tools'
  return null
}

/**
 * 把最后一条消息改成 assistant 前缀（官方 beta 的 Chat Prefix Completion）：
 *   · contentPrefix → 回复正文的开头（想让模型「接下来写」的正文）；
 *   · reasoningPrefix → 思维链开头（reasoning_content，beta 字段）。
 * 两个都空时不注入；只有一个时另一个字段不带（官方要求 prefix 消息里字段可省略）。
 */
export function injectReasoningPrefix(body, { reasoningPrefix = '', contentPrefix = '' } = {}) {
  const reason = canInject(body, reasoningPrefix, contentPrefix)
  if (reason !== null) return { body, applied: false, reason }
  const prefixMessage = { role: 'assistant', content: String(contentPrefix ?? ''), prefix: true }
  if (String(reasoningPrefix ?? '').trim() !== '') prefixMessage.reasoning_content = String(reasoningPrefix)
  const messages = [...body.messages, prefixMessage]
  return { body: { ...body, messages }, applied: true, reason: null }
}

/**
 * 从上游 usage 里抽统一口径的缓存 / token 统计。
 * 兼容 DeepSeek（prompt_cache_hit_tokens / prompt_cache_miss_tokens）、
 * OpenAI（prompt_tokens_details.cached_tokens）、Anthropic（cache_read_input_tokens）。
 * @param {unknown} raw 上游返回的 usage 对象
 * @returns {{prompt:number, completion:number, cacheHit:number, cacheMiss:number|undefined}|null}
 */
export function parseUsage(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
  const details = raw.prompt_tokens_details !== null && typeof raw.prompt_tokens_details === 'object' ? raw.prompt_tokens_details : {}
  const prompt = num(raw.prompt_tokens) ?? num(raw.input_tokens)
  const completion = num(raw.completion_tokens) ?? num(raw.output_tokens)
  const cacheHit = num(raw.prompt_cache_hit_tokens) ?? num(details.cached_tokens) ?? num(raw.cache_read_input_tokens)
  const explicitMiss = num(raw.prompt_cache_miss_tokens)
  if (prompt === undefined && completion === undefined && cacheHit === undefined) return null
  return {
    prompt: prompt ?? 0,
    completion: completion ?? 0,
    cacheHit: cacheHit ?? 0,
    cacheMiss: explicitMiss ?? (prompt !== undefined ? Math.max(0, prompt - (cacheHit ?? 0)) : undefined),
  }
}

/**
 * 前缀模板变量（P1）：`{{date}}` / `{{time}}` / `{{model}}` / `{{provider}}` / `{{turn}}` / `{{session}}`。
 * 认不出的变量原样保留（不丢信息，也方便用户发现打错了）。
 * @param {string} text 前缀原文
 * @param {{date?:string,time?:string,model?:string,provider?:string,turn?:number,session?:string}} [context]
 */
export function interpolatePrefixVars(text, context) {
  if (typeof text !== 'string' || text === '') return text
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  const vars = {
    date: context?.date ?? now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()),
    time: context?.time ?? pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds()),
    model: context?.model,
    provider: context?.provider,
    turn: context?.turn,
    session: context?.session,
  }
  return text.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (whole, key) => {
    const value = vars[key]
    return value === undefined || value === null || value === '' ? whole : String(value)
  })
}

function splitBy(text, size) {
  if (typeof text !== 'string' || text === '') return []
  const out = []
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size))
  return out
}

/** 工具调用解析：把 <TAG invoke> 内部拆成参数对象。 */
function parseInvokeArgs(inner) {
  const args = {}
  const paramOpen = new RegExp('<' + escapeRegExp(DSML_TAG) + ' parameter name="([^"]+)"(?: string="(true)")?>([\\s\\S]*?)</' + escapeRegExp(DSML_TAG) + ' parameter>', 'g')
  const coerce = (raw, isString) => {
    const value = raw.trim()
    if (isString === 'true') return value
    try { return JSON.parse(value) } catch { return value }
  }
  let param
  while ((param = paramOpen.exec(inner)) !== null) args[param[1]] = coerce(param[3], param[2])
  return args
}

/**
 * 流式 DSML 解析器：边收边判定。
 * - 不含标记前缀的文本立刻作为 content 事件吐出（首字延迟）；
 * - 只有出现 '<｜｜DSML｜｜' 起始标记时才进入缓冲，凑成一个 invoke 后作为 calls 事件吐出；
 * - end() 把剩余文本当普通文本收尾。
 * @returns {{push:(text:string)=>Array<object>, end:()=>Array<object>, calls: Array<object>}}
 */
export function createShimStreamParser() {
  const TAG_START = '<' + DSML_TAG
  const invokeFull = new RegExp(escapeRegExp(TAG_START) + ' invoke name="([^"]+)">([\\s\\S]*?)</' + escapeRegExp(DSML_TAG) + ' invoke>')
  const BAR = '\uFF5C'
  const calls = []
  const paramValues = new Set()
  let buf = ''
  let skipValue = false
  const DSML_NOISE = /<\/?[^<>]*\uFF5C[^<>]*>/g
  const cleanText = (text) => {
    const stripped = text.replace(DSML_NOISE, '')
    if (paramValues.size === 0) return stripped
    return stripped
      .split('\n')
      .filter((line) => line.trim() === '' || !paramValues.has(line.trim()))
      .join('\n')
  };
  const flushText = (events, text) => {
    const clean = cleanText(text)
    if (clean !== '') events.push({ type: 'content', text: clean })
  };
  /** 跳过一段标记（标准 / 短形式的闭合、参数标签等），参数标签连值一起丢。 */
  const skipTag = () => {
    const generic = /^<[^>]*>/.exec(buf)
    if (generic === null) return false
    const raw = generic[0]
    const inner = raw.slice(1, -1)
    const canonical = raw.startsWith(TAG_START)
    if (canonical && /(invoke|calls)/.test(inner)) return false
    const isTag = canonical || inner.includes(BAR) || /(invoke|calls|parameter)/.test(inner)
    if (!isTag) return false
    buf = buf.slice(raw.length)
    if (/parameter/.test(inner)) {
      const nextLt = buf.indexOf('<')
      if (nextLt > 0) buf = buf.slice(nextLt)
      else if (nextLt < 0) {
        buf = ''
        skipValue = true
      }
    }
    return true
  };
  const push = (text) => {
    const events = []
    if (typeof text !== 'string' || text === '') return events
    buf += text
    for (;;) {
      if (skipValue) {
        if (buf === '') break
        const nextLt = buf.indexOf('<')
        if (nextLt < 0) {
          buf = ''
          skipValue = false
          break
        }
        buf = buf.slice(nextLt)
        skipValue = false
      }
      if (buf === '') break
      if (!buf.startsWith('<')) {
        const at = buf.indexOf('<')
        if (at < 0) {
          flushText(events, buf)
          buf = ''
          break
        }
        flushText(events, buf.slice(0, at))
        buf = buf.slice(at)
        continue
      }
      // buf 从 '<' 开始：先试完整的标准 invoke
      const full = invokeFull.exec(buf)
      if (full !== null) {
        const args = parseInvokeArgs(full[2])
        for (const value of Object.values(args)) {
          if (typeof value === 'string' || typeof value === 'number') paramValues.add(String(value))
        }
        const call = { name: full[1], arguments: JSON.stringify(args) }
        calls.push(call)
        events.push({ type: 'calls', calls: [call] })
        buf = buf.slice(full.index + full[0].length)
        continue
      }
      // 其它标记（坏掉的闭合 / 短形式 / 参数标签）尽量跳过
      if (skipTag()) continue
      // 还凑不齐：可能只是文本里的 '<'，或标记被截断。等到能判断再吐。
      const generic = /^<[^>]*>/.exec(buf)
      if (generic === null) {
        // 第二字符不像标记开头（不是 '/'、不是竖线）⇒ 就是普通文本里的 '<'
        const second = buf.length > 1 ? buf[1] : ''
        const couldBeTag = second === '' || second === '/' || second === BAR || TAG_START.startsWith(buf.slice(0, 2))
        if (!couldBeTag) {
          flushText(events, '<')
          buf = buf.slice(1)
          continue
        }
        if (buf.length >= 40) {
          flushText(events, '<')
          buf = buf.slice(1)
          continue
        }
        break
      }
      if (buf.startsWith(TAG_START) && /(invoke|calls)/.test(generic[0])) break
      // 完整但不是标记：按文本吐出
      flushText(events, generic[0])
      buf = buf.slice(generic[0].length)
    }
    return events
  };
  const end = () => {
    const events = []
    if (buf !== '') flushText(events, buf)
    buf = ''
    return events
  };
  return { push, end, calls }
}
function stripDsmlTags(text) {
  if (typeof text !== 'string' || text === '') return ''
  return text.replace(new RegExp('</?' + escapeRegExp(DSML_TAG) + '[^>]*>', 'g'), '').replace(/\n{3,}/g, '\n\n').trim()
}
export function transformShimSse(rawSse) {
  let id = 'chatcmpl_shim'
  let model = 'deepseek-flash'
  let created = Math.floor(Date.now() / 1000)
  let reasoning = ''
  let content = ''
  let usage = null
  for (const line of String(rawSse ?? '').split('\n')) {
    if (!line.startsWith('data: ')) continue
    const payload = line.slice(6).trim()
    if (payload === '[DONE]') continue
    let chunk
    try { chunk = JSON.parse(payload) } catch { continue }
    if (typeof chunk.id === 'string') id = chunk.id
    if (typeof chunk.model === 'string') model = chunk.model
    if (typeof chunk.created === 'number') created = chunk.created
    if (chunk.usage !== undefined && chunk.usage !== null) usage = chunk.usage
    const delta = chunk.choices?.[0]?.delta ?? {}
    if (typeof delta.reasoning_content === 'string') reasoning += delta.reasoning_content
    if (typeof delta.content === 'string') content += delta.content
  }
  const parsed = parseDsmlToolCalls(content)
  const chunks = []
  const mk = (delta, finish) => ({
    id, object: 'chat.completion.chunk', created, model,
    choices: [{ index: 0, delta, finish_reason: finish ?? null, logprobs: null }],
    ...(finish !== undefined && usage !== null ? { usage } : {}),
  })
  chunks.push(mk({ role: 'assistant' }))
  for (const part of splitBy(reasoning, 200)) chunks.push(mk({ reasoning_content: part }))
  if (parsed === undefined) {
    for (const part of splitBy(content, 200)) chunks.push(mk({ content: part }))
    chunks.push(mk({}, 'stop'))
  } else {
    for (const part of splitBy(stripDsmlTags(parsed.pre), 200)) chunks.push(mk({ content: part }))
    parsed.calls.forEach((call, index) => {
      chunks.push(mk({ tool_calls: [{ index, id: 'call_' + index + '_' + Math.random().toString(36).slice(2, 10), type: 'function', function: { name: call.name, arguments: '' } }] }))
      for (const part of splitBy(call.arguments, 120)) chunks.push(mk({ tool_calls: [{ index, function: { arguments: part } }] }))
    })
    chunks.push(mk({}, 'tool_calls'))
    for (const part of splitBy(stripDsmlTags(parsed.post), 200)) chunks.push(mk({ content: part }))
  }
  const text = chunks.map((chunk) => 'data: ' + JSON.stringify(chunk) + '\n\n').join('') + 'data: [DONE]\n\n'
  return { text, calls: parsed?.calls ?? [] }
}

/**
 * 把 tool 消息 / assistant.tool_calls 改写成普通文本消息。
 *
 * 官方 Chat Prefix Completion 的检查看的是消息结构（历史里出现 function call 就 400），
 * 但工具消息本质也是上下文。所以前缀轮可以先把它们文本化：
 *   · role: tool 的结果 → role: user 「【工具结果】…」；
 *   · assistant.tool_calls → 同一段文本里写「【调用工具】name(args)」。
 * 这样模型照旧看得到历史内容，官方也看不到 function call 结构。
 *
 * @param body - OpenAI 请求体
 * @returns {{ body: object, changed: number }}
 */
export function textualizeToolHistory(body) {
  if (!Array.isArray(body?.messages)) return { body, changed: 0 }
  const messages = []
  let changed = 0
  for (const message of body.messages) {
    if (message?.role === 'tool') {
      const text = typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? '')
      messages.push({ role: 'user', content: '【工具结果】' + text })
      changed += 1
      continue
    }
    if (message?.role === 'assistant' && Array.isArray(message.tool_calls)) {
      const calls = message.tool_calls
        .map((call) => String(call?.function?.name ?? '?') + '(' + String(call?.function?.arguments ?? '') + ')')
        .join('; ')
      const parts = [typeof message.content === 'string' ? message.content : '', '【调用工具】' + calls].filter((part) => part !== '')
      messages.push({ role: 'assistant', content: parts.join('\n') })
      changed += 1
      continue
    }
    messages.push(message)
  }
  return { body: { ...body, messages }, changed }
}

/** DSML 标记片段：<｜｜DSML｜｜ …>（模型在无 schema 时仍会吐的原生调用格式）。 */
const DSML_BAR = '\uFF5C\uFF5C'
const DSML_TAG = DSML_BAR + 'DSML' + DSML_BAR
const DSML_CALLS_OPEN = '<' + DSML_TAG + ' calls>'
const DSML_CALLS_CLOSE = '</' + DSML_TAG + ' calls>'

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function parseDsmlToolCalls(text) {
  if (typeof text !== 'string' || text === '') return undefined
  const invokeOpen = new RegExp('<' + escapeRegExp(DSML_TAG) + ' invoke name="([^"]+)">')
  const invokeClose = '</' + DSML_TAG + ' invoke>'
  const paramOpen = new RegExp('<' + escapeRegExp(DSML_TAG) + ' parameter name="([^"]+)"(?: string="(true)")?>([\\s\\S]*?)</' + escapeRegExp(DSML_TAG) + ' parameter>', 'g')
  const coerce = (raw, isString) => {
    const value = raw.trim()
    if (isString === 'true') return value
    try { return JSON.parse(value) } catch { return value }
  }
  const calls = []
  let firstIndex = -1
  let lastIndex = -1
  let cursor = 0
  for (;;) {
    const rest = text.slice(cursor)
    const invoke = invokeOpen.exec(rest)
    if (invoke === null) break
    const invokeStart = cursor + invoke.index
    const tail = rest.slice(invoke.index + invoke[0].length)
    const closeAt = tail.indexOf(invokeClose)
    const inner = closeAt < 0 ? tail : tail.slice(0, closeAt)
    const args = {}
    let param
    paramOpen.lastIndex = 0
    while ((param = paramOpen.exec(inner)) !== null) args[param[1]] = coerce(param[3], param[2])
    calls.push({ name: invoke[1], arguments: JSON.stringify(args) })
    if (firstIndex < 0) firstIndex = invokeStart
    lastIndex = cursor + invoke.index + invoke[0].length + inner.length + (closeAt < 0 ? 0 : invokeClose.length)
    cursor = lastIndex
  }
  if (calls.length === 0) return undefined
  return { pre: text.slice(0, firstIndex), calls, post: text.slice(lastIndex) }
}

/** 工具清单的固定开头：代理用它判断「清单是否已在历史里」（history 模式不重复注入）。 */
export const TOOL_CATALOG_MARK = '【前缀模式工具说明】'

/** 请求消息里是否已经有工具清单（history 模式注入过一次后就不再注入）。 */
export function hasToolCatalogMessage(messages) {
  if (!Array.isArray(messages)) return false
  return messages.some((message) => {
    const content = message?.content
    if (typeof content === 'string') return content.includes(TOOL_CATALOG_MARK)
    if (Array.isArray(content)) return content.some((part) => typeof part?.text === 'string' && part.text.includes(TOOL_CATALOG_MARK))
    return false
  })
}

/**
 * F15-B：历史里是否已经有**同一份**工具清单（文本逐字相同）⇒ 本轮不再注入。
 *
 * 为什么必须靠文本相等、而不能只靠 `source.prefill === 'tool-catalog'`：
 * 代理拿到的是 wire 请求，而 DSH 的消息投影会重建每条消息
 * （`dsh-llm-pi-ai/lib/index.js` 的 textOnlyContext / toPiContextWithImages 都只 push
 * `{role, content: flattenText(message), timestamp: 0}`）——**source 根本不会出现在 wire 上**。
 * 所以 source 只能当「有则更可信」的提示：带 source 且明确不是清单 ⇒ 排除；
 * 没带 source（wire 的正常情况）⇒ 只能看文本。
 *
 * 工具集变了（文本不同）⇒ 返回 false，仍注入新清单（否则模型会拿着旧清单调不存在的工具）。
 * @param {unknown} messages
 * @param {string} catalogText 本轮要注入的清单原文
 * @returns {boolean}
 */
export function hasSameToolCatalog(messages, catalogText) {
  if (!Array.isArray(messages) || typeof catalogText !== 'string' || catalogText === '') return false
  return messages.some((message) => {
    if (message === null || typeof message !== 'object') return false
    // source 只在 DSH 侧形状上存在；wire 上被投影剥掉了。带 source 时要求它**正面**标明是清单，
    // 否则（比如普通用户消息）一律不认，避免把用户自己写的正文当成清单。
    const source = message.source
    if (source !== null && typeof source === 'object' && source.prefill !== 'tool-catalog') return false
    return messageText(message) === catalogText
  })
}

/**
 * 由工具 registry 的 wire schemas 生成「前缀模式」用的文本清单。
 * @param schemas - [{ name, description, parameters }]（parameters 为 JSON Schema 对象）
 * @param options.detail - 'full' 完整（默认）| 'brief' 精简（描述 60 字 + 仅参数名）| 'names' 仅工具名
 * @returns 注入上下文的纯文本
 */
export function buildToolCatalog(schemas, options) {
  const detail = options?.detail === 'names' ? 'names' : options?.detail === 'brief' ? 'brief' : 'full'
  const list = Array.isArray(schemas) ? schemas : []
  const lines = [
    '【前缀模式工具说明】本轮没有 tools 参数。需要时按下面的格式发起工具调用：',
    '<' + DSML_TAG + ' invoke name="工具名">',
    '<' + DSML_TAG + ' parameter name="字符串参数" string="true">值</' + DSML_TAG + ' parameter>',
    '<' + DSML_TAG + ' parameter name="数字参数">10</' + DSML_TAG + ' parameter>',
    '</' + DSML_TAG + ' invoke>',
    '规则：字符串参数带 string="true"；数字/布尔参数不要带该属性，直接写 JSON 值。可用工具：',
  ]
  const describeParam = (paramName, schema, required) => {
    const type = typeof schema?.type === 'string' ? schema.type : 'any'
    const marks = []
    if (required) marks.push('必填')
    if (Array.isArray(schema?.enum)) marks.push('可选值=' + schema.enum.join('/'))
    const description = typeof schema?.description === 'string' ? schema.description.replace(/\s+/g, ' ').slice(0, 80) : ''
    return paramName + ':' + type + (marks.length > 0 ? '(' + marks.join('，') + ')' : '') + (description !== '' ? '=' + description : '')
  }
  for (const schema of list) {
    if (typeof schema?.name !== 'string' || schema.name === '') continue
    if (detail === 'names') {
      lines.push('- ' + schema.name)
      if (lines.length > 80) break
      continue
    }
    const parameters = schema.parameters !== null && typeof schema.parameters === 'object' ? schema.parameters : {}
    const properties = parameters.properties !== null && typeof parameters.properties === 'object' ? parameters.properties : {}
    const required = Array.isArray(parameters.required) ? new Set(parameters.required) : new Set()
    const params =
      detail === 'brief'
        ? Object.keys(properties)
        : Object.keys(properties).map((key) => describeParam(key, properties[key], required.has(key)))
    const description =
      typeof schema.description === 'string' ? schema.description.replace(/\s+/g, ' ').slice(0, detail === 'brief' ? 60 : 160) : ''
    lines.push('- ' + schema.name + '：' + description + (params.length > 0 ? '；参数：' + params.join('，') : '；无参数'))
    if (lines.length > 80) break
  }
  return lines.join('\n')
}

export function toolCatalogText() {
  const invoke = '<' + DSML_TAG + ' invoke name="工具名">'
  const param = '<' + DSML_TAG + ' parameter name="参数名" string="true">值</' + DSML_TAG + ' parameter>'
  const num = '<' + DSML_TAG + ' parameter name="数字参数">10</' + DSML_TAG + ' parameter>'
  return [
    '【前缀模式工具说明】本轮没有 tools 参数，但你可以按下面的格式发起工具调用（需要时才用）：',
    invoke,
    param,
    num,
    '</' + DSML_TAG + ' invoke>',
    '规则：字符串参数写 string="true"；数字参数不要写 string 属性，直接写数字。可用工具：',
    '- read：读文件；参数 file_path（必填，字符串）、offset（数字，可选）、limit（数字，可选）。',
    '- glob：按通配符找文件；参数 pattern（必填，字符串）、path（可选，字符串）。',
    '- grep：搜内容；参数 pattern（必填，字符串）、path（可选）。',
    '- bash：执行命令；参数 description（必填，字符串）、command（必填，字符串）、timeoutMs（可选，数字）。',
    '- write：写文件；参数 file_path（必填）、content（必填）。',
  ].join('\n')
}

/** 结果行里 reasoningHead 的截断长度。 */
const REASONING_HEAD_CHARS = 200

/**
 * 采样覆盖补丁（P1-5）：只认 temperature / topP / seed 三个合法字段，非法值静默丢弃。
 * 空对象 = 本轮不干预（默认路径零变化）。
 */
function samplingPatchOf(sampling) {
  const patch = {}
  if (sampling === null || typeof sampling !== 'object' || Array.isArray(sampling)) return patch
  if (Number.isFinite(sampling.temperature)) patch.temperature = sampling.temperature
  if (Number.isFinite(sampling.topP)) patch.top_p = sampling.topP
  if (Number.isInteger(sampling.seed)) patch.seed = sampling.seed
  return patch
}

/** 结果行的 usage 口径：四键齐全，上游没给就是 0。 */
function usageRowOf(usage) {
  if (usage === null || typeof usage !== 'object') return null
  return {
    prompt: Number.isFinite(usage.prompt) ? usage.prompt : 0,
    completion: Number.isFinite(usage.completion) ? usage.completion : 0,
    cacheHit: Number.isFinite(usage.cacheHit) ? usage.cacheHit : 0,
    cacheMiss: Number.isFinite(usage.cacheMiss) ? usage.cacheMiss : 0,
  }
}

/**
 * 结果行的 sampling 口径：记**发给上游的值**（覆盖后），不是面板值、也不是"实际生效值"。
 * 三缺一即 null 成员；三者全无 ⇒ 整体 null。
 */
function samplingRowOf(source) {
  const raw = source !== null && typeof source === 'object' ? source : {}
  const temperature = Number.isFinite(raw.temperature) ? raw.temperature : null
  const topP = Number.isFinite(raw.top_p) ? raw.top_p : null
  const seed = Number.isInteger(raw.seed) ? raw.seed : null
  if (temperature === null && topP === null && seed === null) return null
  return { temperature, topP, seed }
}

/**
 * 带轮转的追加写入器（F17）。
 *
 * 为什么用内存字节计数器、而不是每次写前 `statSync`：本机实测 `statSync` ≈ 29 µs/次，
 * append 1.2KB ≈ 241 µs/次 ⇒ 每次写前 stat 等于白花约 12%；而 append 的成本**不随文件大小增长**
 * （24MB 文件仍 228 µs）。所以轮转解决的是**磁盘增长**，不是速度。
 *
 * 三条硬语义：
 *   · 只在**写之前**判断轮转 ⇒ 永远在行边界切换，不写出半行；
 *   · 轮转失败（EPERM / 磁盘满 / 文件被占用）一律吞掉并继续追加 —— 宁可日志长大，
 *     也不能丢行、更不能把异常抛进请求路径；
 *   · 单行本身超过 maxBytes 时不再轮转（空文件不轮转）⇒ 不会无限轮转。
 *
 * 命名：`file`（当前）→ `file.1`（最新历史）→ … → `file.keepFiles`（最旧，先删）；
 * `keepFiles = 0` ⇒ 直接截断当前文件，不留历史。
 *
 * @param {{file?: string, policy?: (() => {maxBytes?: number, keepFiles?: number}) | {maxBytes?: number, keepFiles?: number}}} [options]
 *   `policy` 每次写入时现取（配置可变）；`maxBytes <= 0` = 不轮转。
 * @returns {{write: (text: string|Buffer) => void, size: () => number, path: () => string}}
 */
export function createRotatingLog({ file, policy } = {}) {
  const target = typeof file === 'string' ? file : ''
  /** 内存字节计数器；null = 还没播种（首次写入前 statSync 一次）。 */
  let bytes = null
  const readPolicy = () => {
    let raw = null
    try {
      raw = typeof policy === 'function' ? policy() : policy
    } catch {
      raw = null
    }
    const maxBytes = Number.isFinite(raw?.maxBytes) ? raw.maxBytes : 0
    // keepFiles 缺省按 0 处理（= 只截断）：轮转历史要显式要，免得漏配时反而把磁盘撑起来。
    const keepFiles = Number.isInteger(raw?.keepFiles) && raw.keepFiles >= 0 ? raw.keepFiles : 0
    return { maxBytes, keepFiles }
  }
  const seed = () => {
    if (bytes !== null) return bytes
    try {
      bytes = statSync(target).size
    } catch {
      // 文件还不存在 / 读不到：从 0 起算
      bytes = 0
    }
    return bytes
  }
  /** 轮转一次；返回「当前文件是否真的被挪走/清空」（只有真挪走了计数器才归零）。 */
  const rotate = (keepFiles) => {
    if (keepFiles <= 0) {
      try {
        writeFileSync(target, '')
        return true
      } catch {
        return false
      }
    }
    try {
      rmSync(target + '.' + keepFiles, { force: true })
    } catch {
      // 最旧那份删不掉（被占用等）：不影响后面的搬运
    }
    for (let index = keepFiles - 1; index >= 1; index -= 1) {
      try {
        renameSync(target + '.' + index, target + '.' + (index + 1))
      } catch {
        // 这一代不存在 / 挪不动：跳过
      }
    }
    try {
      renameSync(target, target + '.1')
      return true
    } catch {
      // 当前文件挪不动 ⇒ 计数器保持原值，继续往同一个文件追加（日志长大，但不丢行）
      return false
    }
  }
  return {
    write(text) {
      if (target === '') return
      const { maxBytes, keepFiles } = readPolicy()
      let current = seed()
      const length = Buffer.byteLength(text ?? '')
      // 写之前判断：只有「文件非空 + 加上这行会超」才轮转 ⇒ 行边界切换，且单行超限不会无限轮转。
      if (maxBytes > 0 && current > 0 && current + length > maxBytes) {
        if (rotate(keepFiles)) {
          bytes = 0
          current = 0
        }
      }
      try {
        appendFileSync(target, text)
        bytes = current + length
      } catch {
        // 写不进去（磁盘满 / 路径不存在 / 被占用）不影响调用方；计数器不动，下次继续试
      }
    },
    size() {
      return seed()
    },
    path() {
      return target
    },
  }
}

/**
 * 起一个只绑定 127.0.0.1 的转发代理。
 * @param options.getConfig - 每次请求时读取当前配置（enabled / upstream / reasoningPrefix / contentPrefix / stripTools）。
 * @param options.logger - 可选日志。
 * @returns {{ listen: (port: number) => Promise<number>, close: () => Promise<void>, server: import('node:http').Server }}
 */
export function createReasoningPrefixProxy({ getConfig, logger, onOutcome } = {}) {
  /** 最近 50 条审计（状态路由读它）。 */
  const audit = []
  /** 面板开关控制的 JSONL 日志（写文件；开关/路径来自 state，经 getConfig 传进来）。 */
  let currentLogging = null
  /**
   * F17：轮转写入器**按路径缓存**（代理实例级）—— 字节计数器必须跨请求存活，
   * 否则每次请求都从 statSync 重新播种，等于回到"每次 stat"。
   * policy 每次写入现取（配置可变），所以这里存的是「当前请求读到的策略」。
   */
  const logWriters = new Map()
  let logPolicy = { maxBytes: 0, keepFiles: 0 }
  const logWriterFor = (target) => {
    if (typeof target !== 'string' || target === '') return null
    let writer = logWriters.get(target)
    if (writer === undefined) {
      writer = createRotatingLog({ file: target, policy: () => logPolicy })
      logWriters.set(target, writer)
    }
    return writer
  }
  const proxyLog = (entry) => {
    const logging = currentLogging
    if (logging?.enabled !== true) return
    const target = typeof logging.file === 'string' && logging.file !== '' ? logging.file : ''
    if (target === '') return
    logWriterFor(target)?.write(JSON.stringify(entry) + '\n')
  }
  /**
   * 结构化结果行的独立 sink（F11）。与 record() / audit **完全解耦**：
   *   · 只在 resultFile 非空时写（代理层默认不写文件，默认路径由 impl.js 的 reasoningConfigOf 填，
   *     否则单测会污染用户 DATA_DIR）；
   *   · 「每请求恰好一行」由调用方的 try/finally + wrote 守卫保证，与早退分支数量无关。
   */
  const resultLog = (target, row) => {
    if (typeof target !== 'string' || target === '') return
    logWriterFor(target)?.write(JSON.stringify(row) + '\n')
  }
  const record = (event) => {
    const entry = { at: Date.now(), ...event }
    audit.push(entry)
    if (audit.length > 50) audit.shift()
    proxyLog(entry)
  }
  /** 累计统计（实验面板读它；审计只留最近 50 条，统计不能只靠审计回溯）。 */
  const stats = {
    requests: 0,
    ok: 0,
    failed: 0,
    variants: {},
    // P0-3：按 armId 分桶（臂级实验直接看这里，不用事后切日志）。
    // 用 null 原型：armId 来自用户输入，'__proto__' 这类键不能落到 Object.prototype 上。
    arms: Object.create(null),
    calls: 0,
    firstDeltaMs: { sum: 0, count: 0 },
    ms: { sum: 0, count: 0 },
    lastAt: 0,
    // P0：缓存 / token 统计（上游 usage 口径）+ 首块延迟样本（算 p95）+ 上次请求形态。
    usage: { requests: 0, prompt: 0, completion: 0, cacheHit: 0, cacheMiss: 0 },
    lastUsage: null,
    firstDeltaSamples: [],
    lastRequest: null,
  }
  /** 记录一次上游 usage（同一请求可能多次回调，取最后一次）。 */
  const recordUsage = (raw) => {
    const usage = parseUsage(raw)
    if (usage === null) return null
    stats.lastUsage = usage
    stats.usage.requests += 1
    stats.usage.prompt += usage.prompt
    stats.usage.completion += usage.completion
    stats.usage.cacheHit += usage.cacheHit
    stats.usage.cacheMiss += usage.cacheMiss ?? 0
    return usage
  }
  /** 非流式 / SSE 透传路径的 usage 抽取（转发给客户端的同时顺手记账）。 */
  const collectUsageFromBody = (contentType, text) => {
    if (typeof text !== 'string' || text === '') return null
    try {
      if (String(contentType).includes('text/event-stream')) {
        let last = null
        for (const line of text.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const payload = trimmed.slice(5).trim()
          if (payload === '' || payload === '[DONE]') continue
          const parsed = JSON.parse(payload)
          if (parsed !== null && typeof parsed === 'object' && parsed.usage !== null && parsed.usage !== undefined) last = parsed.usage
        }
        if (last !== null) return recordUsage(last)
      } else {
        const parsed = JSON.parse(text)
        if (parsed !== null && typeof parsed === 'object' && parsed.usage !== null && parsed.usage !== undefined) return recordUsage(parsed.usage)
      }
    } catch {
      // 解析失败不影响转发（只是诊断数字）。
    }
    return null
  }
  /** 首块延迟 p95（只留最近 100 个样本，够诊断用）。 */
  const firstDeltaP95 = () => {
    const list = stats.firstDeltaSamples
    if (list.length === 0) return null
    const sorted = [...list].sort((a, b) => a - b)
    const at = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)
    return sorted[at]
  }
  /** 臂数上限：臂名手抖（或脚本传错）不会撑爆内存，满则丢最旧。 */
  const ARM_LIMIT = 32
  const emptyArmBucket = () => ({
    requests: 0,
    ok: 0,
    failed: 0,
    ms: { sum: 0, count: 0 },
    firstDeltaMs: { sum: 0, count: 0 },
    usage: { requests: 0, prompt: 0, completion: 0, cacheHit: 0, cacheMiss: 0 },
  })
  /**
   * 把一次请求记进它的臂桶。armId 必须由调用方按**请求局部**传入
   * （代理并发处理多会话，闭包层共享会串台）。
   */
  const bucketArm = (armId, { ok, ms, firstDeltaMs, usage } = {}) => {
    if (typeof armId !== 'string' || armId === '') return
    if (!Object.hasOwn(stats.arms, armId)) {
      const keys = Object.keys(stats.arms)
      if (keys.length >= ARM_LIMIT) delete stats.arms[keys[0]]
      stats.arms[armId] = emptyArmBucket()
    }
    const bucket = stats.arms[armId]
    bucket.requests += 1
    if (ok === true) {
      bucket.ok += 1
      if (Number.isFinite(ms)) {
        bucket.ms.sum += ms
        bucket.ms.count += 1
      }
      if (Number.isFinite(firstDeltaMs)) {
        bucket.firstDeltaMs.sum += firstDeltaMs
        bucket.firstDeltaMs.count += 1
      }
    } else bucket.failed += 1
    if (usage !== null && typeof usage === 'object') {
      bucket.usage.requests += 1
      bucket.usage.prompt += usage.prompt ?? 0
      bucket.usage.completion += usage.completion ?? 0
      bucket.usage.cacheHit += usage.cacheHit ?? 0
      bucket.usage.cacheMiss += usage.cacheMiss ?? 0
    }
  }
  const bump = ({ ok, variant, ms, firstDeltaMs, calls, armId, usage } = {}) => {
    stats.requests += 1
    stats.lastAt = Date.now()
    if (ok === true) {
      stats.ok += 1
      stats.variants[String(variant ?? 'none')] = (stats.variants[String(variant ?? 'none')] ?? 0) + 1
      if (Number.isFinite(ms)) {
        stats.ms.sum += ms
        stats.ms.count += 1
      }
      if (Number.isFinite(firstDeltaMs)) {
        stats.firstDeltaMs.sum += firstDeltaMs
        stats.firstDeltaMs.count += 1
      }
      if (Number.isFinite(calls)) stats.calls += calls
    } else stats.failed += 1
    bucketArm(armId, { ok, ms, firstDeltaMs, usage })
  }
  const server = http.createServer(async (req, res) => {
    // 客户端在请求体发完之前断开时 for await(req) 会抛 aborted；漏出去就是 unhandledRejection，
    // Node 默认 --unhandled-rejections=throw ⇒ 宿主进程会被终止。这里就地收口。
    let incoming
    try {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      incoming = Buffer.concat(chunks)
    } catch (error) {
      logger?.warn?.('dsh-prefill: reasoning-prefix 读取请求体失败（客户端可能已断开）: ' + String(error?.message ?? error))
      try { res.destroy() } catch { /* 连接已经没了 */ }
      return
    }
    const config = getConfig?.() ?? {}
    currentLogging = config.logging !== null && typeof config.logging === 'object' ? config.logging : null
    // F17：轮转策略每次请求现取（maxBytes <= 0 = 不轮转）。缓存里的写入器读的就是这个值。
    logPolicy = {
      maxBytes: Number.isFinite(config.logMaxBytes) ? config.logMaxBytes : 0,
      keepFiles: Number.isInteger(config.logKeepFiles) && config.logKeepFiles >= 0 ? config.logKeepFiles : 0,
    }
    // P1：调试文件路径也走 state（面板可开关），环境变量只作兼容兜底。
    const debugPaths = {
      dump: String(currentLogging?.dumpFile ?? '') || process.env.DSH_PREFILL_SPIKE_DUMP || '',
      raw: String(currentLogging?.rawFile ?? '') || process.env.DSH_PREFILL_SPIKE_RAW || '',
      content: String(currentLogging?.contentFile ?? '') || process.env.DSH_PREFILL_SPIKE_CONTENT || '',
    }
    const isChat = req.url?.includes('/chat/completions') === true
    let applied = false
    let shimActive = false
    let reason = 'not-chat'
    let systemBody = null
    let userBody = null
    /** 上次请求的形态（P0 诊断：消息数 / tools / 清单大小 / 前缀），最终变体确定后记账。 */
    let requestShape = null
    const markRequest = (variant) => {
      if (requestShape === null) return
      stats.lastRequest = {
        at: Date.now(),
        variant,
        messages: requestShape.messages,
        tools: requestShape.tools,
        catalogBytes: requestShape.catalogBytes,
        textualized: requestShape.textualized,
        reasoningPrefix: requestShape.reasoningPrefix,
        contentPrefix: requestShape.contentPrefix,
        catalogMode: requestShape.catalogMode,
        catalogDetail: requestShape.catalogDetail,
        catalogPosition: requestShape.catalogPosition,
        catalogInjected: requestShape.catalogInjected,
        catalogHead: requestShape.catalogHead,
        prefixMessage: requestShape.prefixMessage,
      }
    }
    /**
     * ── 结构化结果行（F11）──────────────────────────────────────────────
     * 每请求**恰好一行**（主键 requestId），走独立 sink，不碰 record() / audit 的语义。
     * 行是请求局部变量；写盘由 transport 的 try/finally + wrote 守卫兜底 —— 与早退分支
     * 的数量解耦，所以「一次全失败」不再落多行。
     */
    const resultEnabled = config.resultEnabled !== false
    const resultFile = String(config.resultFile ?? '')
    const snippets = config.snippets !== false
    const reasoningHeadEnabled = config.reasoningHeadEnabled === true
    // armId / runId 在 getConfig 时快照成请求局部量（并发多会话时闭包层共享会串台）。
    const armId = typeof config.armId === 'string' ? config.armId : ''
    const runId = typeof config.runId === 'string' ? config.runId : ''
    const samplingPatch = samplingPatchOf(config.sampling)
    const samplingOverridden = Object.keys(samplingPatch).length > 0
    const row = {
      at: Date.now(),
      requestId: randomUUID(),
      sessionId: null,
      turn: null,
      step: null,
      armId: armId === '' ? null : armId,
      runId: runId === '' ? null : runId,
      ok: false,
      status: 0,
      variant: null,
      attempts: [],
      ms: null,
      firstDeltaMs: null,
      catalogBytes: 0,
      catalogInjected: null,
      catalogMode: null,
      catalogPosition: null,
      catalogDetail: null,
      catalogRole: null,
      prefix: { reasoningLen: 0, contentLen: 0 },
      sampling: null,
      usage: null,
      textHead: '',
      textTail: '',
      reasoningHead: null,
      routeConfidence: 'none',
      autoDisabled: false,
      verdict: 'error',
    }
    let wrote = false
    // 结果行要用到的请求局部中间量。
    let bodyForRow = null // 解析成功的原始请求体（采样覆盖 / 关联指纹用）
    let finalVariantKind = null // 最终生效变体的原始 kind
    let reportedVariantName = null // 对外记账名（system/user/prefixed/skipped/ignored/passthrough/none）
    let okFlag = false
    let collectedText = '' // 模型正文：shim 路径 = 解析后的增量拼接；透传路径 = 原始字节文本
    let collectedReasoning = '' // 思维链正文（能拿到时才非空）
    let reasoningCollectible = false // 本轮是否具备采集 reasoning 的能力（非 shim 透传路径采不到）
    let rowUsage = null
    const writeRow = () => {
      if (wrote) return
      wrote = true
      row.ok = okFlag === true
      row.ms = Date.now() - started
      row.usage = usageRowOf(rowUsage)
      row.textHead = snippets ? collectedText.slice(0, 80) : ''
      row.textTail = snippets ? collectedText.slice(-40) : ''
      row.reasoningHead =
        reasoningHeadEnabled && collectedReasoning !== '' ? collectedReasoning.slice(0, REASONING_HEAD_CHARS) : null
      if (okFlag !== true || finalVariantKind === null) {
        row.verdict = 'error'
      } else if (reportedVariantName === 'passthrough' || reportedVariantName === 'skipped' || reportedVariantName === 'ignored') {
        row.verdict = reportedVariantName
      } else if (reasoningHeadEnabled !== true || reasoningCollectible !== true) {
        // 没采集 ⇒ 不能下结论。'no-reasoning' 只留给"采了但返回里没有 reasoning_content"。
        row.verdict = 'unknown'
      } else if (row.reasoningHead === null) {
        row.verdict = 'no-reasoning'
      } else {
        const probe = String(requestShape?.reasoningPrefix ?? '').slice(0, 8)
        // 没配思考前缀（只配内容前缀 / 都没配）时，reasoningHead 与「思考前缀」无从比较：
        // 拿空探针去比会把「判断不了」说成 prefix-absent（内容前缀的延续落在正文里，不在 reasoning）。
        row.verdict = probe === '' ? 'unknown' : row.reasoningHead.startsWith(probe) ? 'prefix-kept' : 'prefix-absent'
      }
      if (resultEnabled) resultLog(resultFile, row)
    }
    /**
     * onOutcome 的返回值（autoDisabled）必须在写行**之前**取用。
     * 回调异常不得影响转发（它只是记账方）。
     */
    const reportOutcome = (payload) => {
      try {
        const outcome = onOutcome?.(payload)
        if (outcome !== null && typeof outcome === 'object' && outcome.autoDisabled === true) row.autoDisabled = true
      } catch (error) {
        // 记账方抛错不影响转发（以前它会冒泡到 transport catch，在响应已发出后再 writeHead 502）
        logger?.warn?.('dsh-prefill: reasoning-prefix onOutcome 回调抛错: ' + String(error?.message ?? error))
      }
    }
    if (isChat && config.enabled !== false) {
      try {
        const body = JSON.parse(incoming.toString('utf8'))
        bodyForRow = body
        // 采样：记**发给上游的值**（覆盖后）。覆盖对所有变体统一生效，见 prepare / 透传臂。
        row.sampling = samplingRowOf(samplingOverridden ? { ...body, ...samplingPatch } : body)
        // 关联通道：宿主侧登记表唯一命中才认；解析失败绝不影响转发。
        try {
          const trace = typeof config.resolveTrace === 'function' ? config.resolveTrace(body) : null
          if (trace !== null && typeof trace === 'object') {
            row.sessionId = typeof trace.sessionId === 'string' && trace.sessionId !== '' ? trace.sessionId : null
            row.turn = Number.isInteger(trace.turn) ? trace.turn : null
            row.step = Number.isInteger(trace.step) ? trace.step : null
            row.routeConfidence = trace.confidence === 'exact' ? 'exact' : 'content'
          }
        } catch {
          // 关联失败 ⇒ 保持 routeConfidence='none'，sessionId 留 null（安全侧）
        }
        const match = typeof config.match === 'string' && config.match !== '' ? config.match : process.env.DSH_PREFILL_SPIKE_MATCH
        if (typeof match === 'string' && match !== '') {
          const last = Array.isArray(body.messages) ? body.messages[body.messages.length - 1] : undefined
          const text = typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content ?? '')
          if (!text.includes(match)) {
            reason = 'no-match'
            throw { skip: true }
          }
        }
        const catalog = typeof config.catalog === 'string' && config.catalog !== '' ? config.catalog : toolCatalogText()
        const catalogMessages = {
          system: { role: 'system', content: catalog },
          user: { role: 'user', content: '<system-reminder>\n' + catalog + '\n</system-reminder>' },
        }
        const prepare = (catalogRole) => {
          const draft = JSON.parse(JSON.stringify(body))
          if (config.stripTools !== false) {
            delete draft.tools
            delete draft.tool_choice
          }
          // P1-5：采样覆盖对**所有变体**统一生效 —— system / user / prefixed 三个变体共用同一份
          // draft，透传臂单独重序列化（见变体链）。臂间采样不同本身就是一个混淆变量。
          if (samplingOverridden) Object.assign(draft, samplingPatch)
          if (config.textualize === true || process.env.DSH_PREFILL_SPIKE_TEXTUALIZE === '1') {
            const textualized = textualizeToolHistory(draft)
            draft.messages = textualized.body.messages
            applied = true
            reason = null
            if (textualized.changed > 0) logger?.info?.('dsh-prefill: reasoning-prefix 文本化了 ' + textualized.changed + ' 条 tool 消息')
          }
          // P1：前缀模板变量（{{date}}/{{time}}/{{model}} 等）在发请求前展开。
          const interpolatedConfig = {
            ...config,
            reasoningPrefix: interpolatePrefixVars(config.reasoningPrefix, { model: draft.model }),
            contentPrefix: interpolatePrefixVars(config.contentPrefix, { model: draft.model }),
          }
          const result = injectReasoningPrefix(draft, interpolatedConfig)
          if (!result.applied) {
            reason = result.reason
            return null
          }
          applied = true
          reason = null
          requestShape = {
            messages: Array.isArray(draft.messages) ? draft.messages.length : 0,
            tools: Array.isArray(body.tools) ? body.tools.length : 0,
            catalogBytes: catalog.length,
            textualized: config.textualize === true || process.env.DSH_PREFILL_SPIKE_TEXTUALIZE === '1',
            reasoningPrefix: String(interpolatedConfig.reasoningPrefix ?? ''),
            contentPrefix: String(interpolatedConfig.contentPrefix ?? ''),
            catalogMode: config.catalogMode === 'history' ? 'history' : 'each',
            catalogDetail: config.catalogDetail === 'brief' || config.catalogDetail === 'names' ? config.catalogDetail : 'full',
            catalogPosition: config.catalogPosition === 'tail' ? 'tail' : 'head',
            // F15-B：短路不再限定 history 模式 —— 历史里有**同一份**清单（逐字相同）就不重复注入。
            // 「用过 history 又切回 each」的会话以前会拿到两份清单（历史那份 + 每轮这份）。
            catalogInjected: !hasSameToolCatalog(result.body.messages, catalog),
            // P0 预览正文片段：清单前几行 + 实际注入的前缀消息（面板展开看）。
            catalogHead: catalog.split('\n').slice(0, 8).join('\n').slice(0, 900),
            prefixMessage: {
              reasoning: String(interpolatedConfig.reasoningPrefix ?? '').slice(0, 200),
              content: String(interpolatedConfig.contentPrefix ?? '').slice(0, 200),
            },
          }
          // 结果行的清单 / 前缀口径（面板与实验分析同源）。
          row.catalogBytes = requestShape.catalogBytes
          row.catalogInjected = requestShape.catalogInjected
          row.catalogMode = requestShape.catalogMode
          row.catalogPosition = requestShape.catalogPosition
          row.catalogDetail = requestShape.catalogDetail
          row.catalogRole = catalogRole
          row.prefix = {
            reasoningLen: requestShape.reasoningPrefix.length,
            contentLen: requestShape.contentPrefix.length,
          }
          const shim = config.shim === true || process.env.DSH_PREFILL_SPIKE_SHIM === '1'
          if (shim) {
            const messages = result.body.messages
            const prefixMessage = messages[messages.length - 1]
            const base = messages.slice(0, -1)
            // catalogMode=history：插件已把清单一次性注入会话历史（含在 messages 里）⇒ 这里不再重复注入；
            // 万一历史里没有（注入失败 / 被压缩掉），退回每轮注入兜底。
            // F15-B：改成按**文本相同**短路，且不再限定模式（切回 each 后历史那份还在，否则会重复注入）。
            const injectCatalog = !hasSameToolCatalog(messages, catalog)
            if (injectCatalog) {
              if (config.catalogPosition === 'tail') {
                // 老行为：紧贴 prefix 消息。尾部会被后面增长的历史顶开 ⇒ 每轮都不进缓存。
                result.body.messages = [...base, catalogMessages[catalogRole], prefixMessage]
              } else {
                // 默认：插在开头 system 段之后 —— 每轮都一样的大块作为稳定前缀被上游缓存
                // （P0 实测：尾部放置缓存命中 ~51%，挪到开头后第 2 轮起 95–96%）。
                let insertAt = 0
                while (insertAt < base.length && base[insertAt]?.role === 'system') insertAt += 1
                result.body.messages = [...base.slice(0, insertAt), catalogMessages[catalogRole], ...base.slice(insertAt), prefixMessage]
              }
            }
            shimActive = true
          }
          return Buffer.from(JSON.stringify(result.body), 'utf8')
        }
        systemBody = prepare('system')
        userBody = prepare('user')
      } catch (error) {
        if (error?.skip !== true) {
          reason = 'bad-json'
          logger?.warn?.(`dsh-prefill: reasoning-prefix 解析请求失败: ${String(error?.message ?? error)}`)
        }
      }
    }
    const headers = {}
    for (const [key, value] of Object.entries(req.headers)) {
      if (['host', 'content-length', 'accept-encoding', 'connection'].includes(key)) continue
      headers[key] = value
    }
    const upstream = String(config.upstream ?? 'https://api.deepseek.com/beta').replace(/\/+$/, '')
    const target = upstream + String(req.url ?? '').replace(/^\/(?:beta\/)?v1/, '')
    const dumpPath = debugPaths.dump
    if (typeof dumpPath === 'string' && dumpPath !== '' && isChat && systemBody !== null) {
      try {
        const parsed = JSON.parse(systemBody.toString('utf8'))
        logWriterFor(dumpPath)?.write(JSON.stringify({ at: Date.now(), hasTools: Array.isArray(parsed.tools) && parsed.tools.length > 0, messages: parsed.messages.length, catalogRole: parsed.messages[parsed.messages.length - 2]?.role }) + '\n')
      } catch {
        // dump 失败不影响转发
      }
    }
    const variants = [];
    // 回退链顺序（P1 可配）：system-first / user-first；不配时按 catalogRole 偏好。
    // catalogRole=user 表示「清单伪装成 user 消息」，所以它同时决定首选变体。
    const order =
      config.fallbackOrder === 'system-first'
        ? ['system', 'user']
        : config.fallbackOrder === 'user-first'
          ? ['user', 'system']
          : config.catalogRole === 'user'
            ? ['user', 'system']
            : ['system', 'user']
    for (const kind of order) {
      if (kind === 'user' && userBody !== null && shimActive) variants.push({ kind: 'user', body: userBody })
      if (kind === 'system' && systemBody !== null && shimActive) variants.push({ kind: 'system', body: systemBody })
    }
    if (systemBody !== null && !shimActive) variants.push({ kind: 'prefixed', body: systemBody });
    // 是否允许透传（P1 可配）：关掉后只试前缀版本；若本轮没有任何前缀版本（比如「清空填装」），兜底仍透传。
    // P1-5：有采样覆盖时透传臂**必须重新序列化** —— 否则前缀臂带了覆盖、透传臂没带，
    // 臂间采样参数不同本身就成了新的混淆变量。没有覆盖时原样用 incoming 字节（零变化）。
    const passthroughBody =
      samplingOverridden && bodyForRow !== null
        ? Buffer.from(JSON.stringify({ ...bodyForRow, ...samplingPatch }), 'utf8')
        : incoming
    if (config.allowPassthrough !== false || variants.length === 0) variants.push({ kind: 'passthrough', body: passthroughBody });
    /**
     * 透传有三种完全不同的含义，面板与「连续失败自动停用」必须分开看 ——
     * 以前一律叫 passthrough，于是「用户主动跳过」「触发标记未命中」都被算成失败，
     * 几次之后实验自己把自己关掉（还会删掉模型路由）。
     *   · skipped     = 用户点了「清空本轮填装」（config.skipping）；
     *   · ignored     = 本轮本就不该加前缀（非 chat / 标记未命中 / 前缀为空 / 带工具）；
     *   · passthrough = 前缀版被上游拒绝后退回透传 —— 只有这一种算失败。
     */
    const IGNORED_REASONS = ['not-chat', 'no-match', 'empty-prefix', 'no-messages', 'has-tools']
    const outcomeVariant = (kind) => {
      if (kind !== 'passthrough') return kind
      if (config.skipping === true) return 'skipped'
      if (IGNORED_REASONS.includes(reason)) return 'ignored'
      return 'passthrough'
    }
    const started = Date.now()
    try {
      /**
       * F16（P1-7）：shim 分支会**伪造 SSE 帧序列**，非流式客户端拿到的协议是错的
       * （上游即使回 200-JSON，这里也照样吐 `data: ...`）。fail-fast，不做非流式聚合。
       *
       * 判据写 `stream === false`：缺省当流式 —— DSH 自己不带该字段，写成 `stream !== true`
       * 会把所有不带 stream 的请求（含全部现有 shim 用例）误杀。
       * 只在 shim 真的会生效时拦：shim 关掉时是原样转发，非流式客户端本来就能正常工作。
       */
      if (isChat && shimActive && bodyForRow?.stream === false) {
        const message = 'reasoning-prefix proxy: 本代理只支持流式请求（stream:true）。本轮请求带 stream:false，已拒绝且未转发上游。'
        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: { message, type: 'invalid_request_error', code: 'non_streaming_unsupported' } }))
        okFlag = false
        reportedVariantName = 'none'
        row.status = 400
        row.variant = 'none'
        bump({ ok: false, armId })
        logger?.warn?.('dsh-prefill: reasoning-prefix 拒绝非流式请求（shim 只支持 stream:true）')
        return;
      }
      let final = null
      let finalVariant = null
      for (const variant of variants) {
        const attemptStarted = Date.now()
        const response = await fetch(target, {
          method: req.method,
          headers,
          body: req.method === 'GET' || req.method === 'HEAD' ? undefined : variant.body,
        })
        // 结果行逐次记账：一次请求试过谁、各自什么状态、最后谁生效，都在这一行里。
        row.attempts.push({ variant: variant.kind, status: response.status, ok: response.status < 400, ms: Date.now() - attemptStarted })
        if (response.status < 400) {
          final = response
          finalVariant = variant.kind
          break;
        }
        const text = await response.text()
        record({ kind: 'upstream-error', variant: variant.kind, status: response.status, bodyHead: text.slice(0, 300) })
        logger?.warn?.(`dsh-prefill: reasoning-prefix ${variant.kind} 上游 ${response.status}: ${text.slice(0, 300)}`)
        if (variant.kind === 'passthrough') {
          // F7：整条回退链走到透传兜底仍被上游拒绝时，也要记账 —— 与成功路径一致。
          // 以前这里直接 return，stats.lastRequest 会停在更早一次成功请求的形态上，
          // 面板「上次请求形态」显示的是一轮早已过去的请求。
          const reportedPassthrough = outcomeVariant('passthrough')
          markRequest(reportedPassthrough)
          okFlag = false
          reportedVariantName = reportedPassthrough
          row.status = response.status
          row.variant = reportedPassthrough
          res.writeHead(response.status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) }).end(text)
          bump({ ok: false, armId })
          reportOutcome({ ok: false, variant: reportedPassthrough, status: response.status })
          return;
        }
      }
      if (final === null) {
        // F7：所有变体都被上游拒绝（例如关掉透传且前缀版全挂）时同样记账，
        // variant 用 'none'，与 onOutcome / 传输错误路径同名，便于面板区分「一次都没成」。
        markRequest('none')
        okFlag = false
        reportedVariantName = 'none'
        row.status = 502
        row.variant = 'none'
        res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }).end('reasoning-prefix proxy: no variant succeeded')
        bump({ ok: false, armId })
        reportOutcome({ ok: false, variant: 'none', status: 502 })
        return;
      }
      const outHeaders = {}
      for (const [key, value] of final.headers) {
        if (['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key)) continue
        outHeaders[key] = value
      }
      const transformedVariant = finalVariant === 'system' || finalVariant === 'user'
      // 对外记账用的变体名：透传要区分 skipped / ignored / passthrough（见 outcomeVariant）。
      const reportedVariant = outcomeVariant(finalVariant)
      const upstreamIsSse = String(final.headers.get('content-type') ?? '').includes('text/event-stream')
      if (shimActive && transformedVariant) {
        // 流式改写：文本增量立即转发，只有出现 DSML 起始标记时才缓冲成 tool_calls。
        res.writeHead(final.status, {
          ...outHeaders,
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          'x-accel-buffering': 'no',
        })
        const parser = createShimStreamParser()
        let base = null
        let callCount = 0
        const seenCalls = new Set()
        // 流中途断掉时客户端可能已经没了：写响应要包起来；收尾必须走 closeStream（补 finish + [DONE]），
        // 否则 DSH 那边等不到结束标记，我们这边还会把它记成一次成功。
        let streamError = null
        let sawFrame = false
        let sawPayload = false
        const safeWrite = (text) => {
          try {
            if (res.writableEnded !== true && res.destroyed !== true) res.write(text)
          } catch {
            // 客户端断开后写入会抛，忽略即可
          }
        }
        // 一次响应最多吐几个工具调用：面板可调（state.ui.reasoningPrefix.maxEmittedCalls），默认 8。
        const MAX_EMITTED_CALLS = Number.isInteger(config.maxEmittedCalls) ? Math.max(1, Math.min(32, config.maxEmittedCalls)) : 8
        let firstDeltaMs = null
        let finished = false
        const collected = []
        // P2-12：思维链正文以前只转发、不落任何集合 ⇒ 结果行的 reasoningHead / verdict 无从判定。
        const collectedReasoningParts = []
        reasoningCollectible = true
        // P0 审计详情：记下每次工具调用的名字与参数摘要（面板展开看）。
        const callDetails = []
        let requestUsage = null
        const contentLog = debugPaths.content
        const writeChunk = (delta, finishReason) => {
          const payload = {
            id: typeof base?.id === 'string' ? base.id : 'shim',
            object: 'chat.completion.chunk',
            created: typeof base?.created === 'number' ? base.created : Math.floor(Date.now() / 1000),
            model: typeof base?.model === 'string' ? base.model : '',
            choices: [{ index: 0, delta, finish_reason: finishReason === undefined ? null : finishReason }],
          }
          safeWrite('data: ' + JSON.stringify(payload) + '\n\n')
        }
        const writeUsage = (usage) => {
          const parsed = recordUsage(usage)
          if (parsed !== null) requestUsage = parsed
          const payload = {
            id: typeof base?.id === 'string' ? base.id : 'shim',
            object: 'chat.completion.chunk',
            created: typeof base?.created === 'number' ? base.created : Math.floor(Date.now() / 1000),
            model: typeof base?.model === 'string' ? base.model : '',
            choices: [],
            usage,
          }
          safeWrite('data: ' + JSON.stringify(payload) + '\n\n')
        }
        const emitEvents = (events) => {
          for (const event of events) {
            if (event.type === 'content') {
              sawPayload = true
              if (firstDeltaMs === null) firstDeltaMs = Date.now() - started
              writeChunk({ content: event.text })
            } else if (event.type === 'calls') {
              for (const call of event.calls) {
                // 模型偶尔会重复刷同一调用 / 吐出坏名字：去重、校验、限流，避免一次执行几十个工具。
                if (typeof call.name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(call.name)) continue
                if (seenCalls.has(call.name + '\u0000' + call.arguments)) continue
                if (callCount >= MAX_EMITTED_CALLS) continue
                seenCalls.add(call.name + '\u0000' + call.arguments)
                const index = callCount
                callCount += 1
                sawPayload = true
                callDetails.push({ name: call.name, args: call.arguments.slice(0, 160) })
                if (firstDeltaMs === null) firstDeltaMs = Date.now() - started
                writeChunk({ tool_calls: [{ index, id: 'call_' + index + '_' + Math.random().toString(36).slice(2, 10), type: 'function', function: { name: call.name, arguments: '' } }] })
                for (let offset = 0; offset < call.arguments.length; offset += 120) {
                  writeChunk({ tool_calls: [{ index, function: { arguments: call.arguments.slice(offset, offset + 120) } }] })
                }
              }
            }
          }
        }
        const finish = (reason) => {
          if (finished) return
          finished = true
          emitEvents(parser.end())
          writeChunk({}, callCount > 0 ? 'tool_calls' : reason)
        }
        const closeStream = () => {
          if (finished !== true) finish('stop')
          safeWrite('data: [DONE]\n\n')
          try { if (res.writableEnded !== true) res.end() } catch { /* 已经断了 */ }
          if (typeof contentLog === 'string' && contentLog !== '') {
            logWriterFor(contentLog)?.write(JSON.stringify({ at: Date.now(), text: collected.join('') }) + '\n')
          }
        }
        const handleFrame = (raw) => {
          const line = raw.trim()
          if (line === '' || !line.startsWith('data:')) return
          const data = line.slice(5).trim()
          if (data === '[DONE]') return
          let chunk
          try {
            chunk = JSON.parse(data)
          } catch {
            return
          }
          sawFrame = true
          if (base === null) base = chunk
          if (chunk.usage !== undefined && chunk.usage !== null) writeUsage(chunk.usage)
          const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined
          const delta = choice !== null && typeof choice === 'object' ? choice.delta : undefined
          if (delta !== null && typeof delta === 'object') {
            if (typeof delta.reasoning_content === 'string' && delta.reasoning_content !== '') {
              sawPayload = true
              if (firstDeltaMs === null) firstDeltaMs = Date.now() - started
              collectedReasoningParts.push(delta.reasoning_content)
              writeChunk({ reasoning_content: delta.reasoning_content })
            }
            if (typeof delta.content === 'string' && delta.content !== '') {
              collected.push(delta.content)
              emitEvents(parser.push(delta.content))
            }
            if (Array.isArray(delta.tool_calls)) {
              for (const call of delta.tool_calls) writeChunk({ tool_calls: [call] })
            }
          }
          if (choice !== null && typeof choice === 'object' && typeof choice.finish_reason === 'string' && choice.finish_reason !== '') {
            finish(choice.finish_reason)
          }
        }
        if (final.body !== null) {
          const { Readable } = await import('node:stream')
          if (upstreamIsSse !== true) {
            // 上游没按 SSE 回（网关 200-JSON / 忽略了 stream:true）：整段读进来按同一口径吐 SSE。
            // 以前会走进帧切分分支，永远匹配不到 '\n\n' ⇒ 正文被静默丢掉（只剩 finish + [DONE]）。
            let raw = ''
            await new Promise((resolve) => {
              const reader = Readable.fromWeb(final.body)
              reader.on('data', (chunk) => { raw += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk) })
              reader.on('end', resolve)
              reader.on('error', (error) => { streamError = error; resolve() })
            })
            if (streamError === null) {
              try {
                const parsed = JSON.parse(raw)
                base = parsed
                const message = parsed?.choices?.[0]?.message ?? {}
                if (parsed?.usage !== undefined && parsed.usage !== null) writeUsage(parsed.usage)
                if (typeof message.reasoning_content === 'string' && message.reasoning_content !== '') {
                  sawPayload = true
                  if (firstDeltaMs === null) firstDeltaMs = Date.now() - started
                  collectedReasoningParts.push(message.reasoning_content)
                  writeChunk({ reasoning_content: message.reasoning_content })
                }
                if (typeof message.content === 'string' && message.content !== '') {
                  sawPayload = true
                  collected.push(message.content)
                  emitEvents(parser.push(message.content))
                }
              } catch (error) {
                streamError = error
              }
            }
            closeStream()
          } else {
            await new Promise((resolve) => {
              const reader = Readable.fromWeb(final.body)
              const decoder = new TextDecoder()
              let frameBuffer = ''
              reader.on('data', (chunk) => {
                frameBuffer += decoder.decode(chunk, { stream: true })
                // SSE 规范允许 CRLF 分帧；只按 '\n\n' 切会永远匹配不到 ⇒ 整段回复被静默丢掉。
                if (frameBuffer.indexOf('\r') >= 0) frameBuffer = frameBuffer.replace(/\r\n/g, '\n')
                let splitAt
                while ((splitAt = frameBuffer.indexOf('\n\n')) >= 0) {
                  const raw = frameBuffer.slice(0, splitAt)
                  frameBuffer = frameBuffer.slice(splitAt + 2)
                  handleFrame(raw)
                }
              })
              reader.on('end', () => {
                try {
                  handleFrame(frameBuffer)
                } catch {
                  // 尾帧解析失败不影响收尾
                }
                closeStream()
                resolve()
              })
              reader.on('error', (error) => {
                // 以前只 res.end()：没有 finish_reason、没有 [DONE]，parser 缓冲的文本与调用全丢，
                // 而且下游还会记成一次成功。现在补完整收尾，并把这次标成失败。
                streamError = error
                closeStream()
                resolve()
              })
            })
          }
        } else {
          closeStream()
        }
        if (firstDeltaMs !== null && Number.isFinite(firstDeltaMs)) {
          stats.firstDeltaSamples.push(firstDeltaMs)
          if (stats.firstDeltaSamples.length > 100) stats.firstDeltaSamples.shift()
        }
        markRequest(reportedVariant)
        // 结果行口径：无论成功还是流中断，正文 / 思维链 / usage 都已收齐，统一在这里落定。
        finalVariantKind = finalVariant
        reportedVariantName = reportedVariant
        row.status = final.status
        row.variant = reportedVariant
        collectedText = collected.join('')
        collectedReasoning = collectedReasoningParts.join('')
        row.firstDeltaMs = Number.isFinite(firstDeltaMs) ? firstDeltaMs : null
        rowUsage = requestUsage
        if (streamError !== null) {
          // 上游中途断流：尾巴已经尽量补成 finish + [DONE]（不让客户端挂死），但必须记成失败 ——
          // 以前这里 bump ok，面板全绿，用户完全不知道回复被截断了。
          okFlag = false
          record({ kind: 'stream-error', variant: reportedVariant, status: final.status, error: String(streamError?.message ?? streamError), ms: Date.now() - started, firstDeltaMs })
          bump({ ok: false, armId })
          reportOutcome({ ok: false, variant: reportedVariant, status: final.status, error: 'stream' })
          logger?.warn?.('dsh-prefill: reasoning-prefix shim 流中断: ' + String(streamError?.message ?? streamError))
          return;
        }
        if (sawFrame === true && sawPayload !== true && callCount === 0) {
          // 收到过帧却一个增量都没解析出来：不再静默当成功，留一条审计（不判失败，避免误停用）。
          record({ kind: 'no-delta', variant: reportedVariant, status: final.status, bytes: collected.join('').length })
        }
        record({ kind: 'shim', variant: reportedVariant, status: final.status, calls: callCount, callsDetail: callDetails.slice(0, 8), usage: requestUsage, ms: Date.now() - started, firstDeltaMs })
        okFlag = true
        bump({ ok: true, variant: reportedVariant, ms: Date.now() - started, firstDeltaMs, calls: callCount, armId, usage: requestUsage })
        const shimLog = process.env.DSH_PREFILL_SPIKE_LOG
        if (typeof shimLog === 'string' && shimLog !== '') {
          logWriterFor(shimLog)?.write(JSON.stringify({ at: Date.now(), applied: true, shim: true, calls: callCount, status: final.status, firstDeltaMs }) + '\n')
        }
        reportOutcome({ ok: true, variant: reportedVariant, status: final.status, calls: callCount })
        logger?.info?.('dsh-prefill: reasoning-prefix shim 流式转换完成，文本首块 ' + String(firstDeltaMs ?? '-') + 'ms，工具调用 ' + callCount + ' 个')
        return;
      }
      res.writeHead(final.status, outHeaders)
      let forwardUsage = null
      const rawPathForStream = debugPaths.raw
      if (final.body !== null) {
        const { Readable } = await import('node:stream')
        const contentType = String(final.headers.get('content-type') ?? '')
        let collected = ''
        let forwardError = null
        await new Promise((resolve) => {
          const reader = Readable.fromWeb(final.body)
          reader.on('data', (chunk) => {
            if (typeof rawPathForStream === 'string' && rawPathForStream !== '') {
              // F17：这里是**按 chunk 写原始 SSE 字节**，不是按行 JSONL —— 轮转因此可能发生在
              // chunk 边界（半行），这是可接受的：rawFile 只是原始字节留档，不参与解析。
              logWriterFor(rawPathForStream)?.write(chunk)
            }
            if (collected.length < 4 * 1024 * 1024) collected += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
          })
          reader.pipe(res)
          reader.on('end', resolve)
          // 以前只 resolve：pipe 在源出错时不会关目标 ⇒ 客户端响应永不结束（挂死），还记成成功。
          reader.on('error', (error) => { forwardError = error; try { res.destroy() } catch { /* 已经断了 */ } resolve() })
        })
        if (forwardError !== null) {
          markRequest(reportedVariant)
          okFlag = false
          finalVariantKind = finalVariant
          reportedVariantName = reportedVariant
          row.status = final.status
          row.variant = reportedVariant
          collectedText = extractResponseText(contentType, collected)
          record({ kind: 'stream-error', variant: reportedVariant, status: final.status, error: String(forwardError?.message ?? forwardError), ms: Date.now() - started })
          bump({ ok: false, armId })
          reportOutcome({ ok: false, variant: reportedVariant, status: final.status, error: 'stream' })
          logger?.warn?.('dsh-prefill: reasoning-prefix 转发流中断: ' + String(forwardError?.message ?? forwardError))
          return;
        }
        forwardUsage = collectUsageFromBody(contentType, collected)
        collectedText = extractResponseText(contentType, collected)
      } else res.end()
      markRequest(reportedVariant)
      okFlag = true
      finalVariantKind = finalVariant
      reportedVariantName = reportedVariant
      row.status = final.status
      row.variant = reportedVariant
      rowUsage = forwardUsage
      record({ kind: 'forward', variant: reportedVariant, status: final.status, usage: forwardUsage, ms: Date.now() - started })
      bump({ ok: true, variant: reportedVariant, ms: Date.now() - started, armId, usage: forwardUsage })
      const logPath = process.env.DSH_PREFILL_SPIKE_LOG
      if (typeof logPath === 'string' && logPath !== '') {
        logWriterFor(logPath)?.write(JSON.stringify({ at: Date.now(), applied, reason, variant: reportedVariant, status: final.status, target, ms: Date.now() - started }) + '\n')
      }
      reportOutcome({ ok: true, variant: reportedVariant, status: final.status })
      logger?.info?.(`dsh-prefill: reasoning-prefix ${applied ? '已加前缀(' + reportedVariant + ')' : '透传(' + reason + ')'} → ${target} [${final.status}] ${Date.now() - started}ms`)
    } catch (error) {
      logger?.warn?.(`dsh-prefill: reasoning-prefix 转发失败: ${String(error?.message ?? error)}`)
      record({ kind: 'transport-error', error: String(error?.message ?? error) })
      okFlag = false
      reportedVariantName = 'none'
      row.status = 502
      row.variant = 'none'
      bump({ ok: false, armId })
      reportOutcome({ ok: false, variant: 'none', status: 0 })
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }).end('reasoning-prefix proxy error: ' + String(error?.message ?? error))
    } finally {
      // 每请求恰好一行：无论从哪条早退分支离开，都只在这里落一次盘。
      writeRow()
    }
  })
  return {
    server,
    audit: () => [...audit],
    /** 实验面板用的累计统计（深拷贝，调用方改不到内部计数）。 */
    stats: () => ({
      ...stats,
      variants: { ...stats.variants },
      // arms 必须**逐层**展开：调用方拿到的是快照，改它不能影响内部桶。
      arms: Object.fromEntries(
        Object.entries(stats.arms).map(([key, bucket]) => [
          key,
          { ...bucket, ms: { ...bucket.ms }, firstDeltaMs: { ...bucket.firstDeltaMs }, usage: { ...bucket.usage } },
        ]),
      ),
      ms: { ...stats.ms },
      firstDeltaMs: { ...stats.firstDeltaMs },
      usage: { ...stats.usage },
      lastUsage: stats.lastUsage === null ? null : { ...stats.lastUsage },
      firstDeltaSamples: stats.firstDeltaSamples.slice(-20),
      firstDeltaP95: firstDeltaP95(),
      lastRequest: stats.lastRequest === null ? null : { ...stats.lastRequest },
    }),
    resetStats: () => {
      stats.requests = 0
      stats.ok = 0
      stats.failed = 0
      stats.variants = {}
      stats.arms = Object.create(null)
      stats.calls = 0
      stats.firstDeltaMs = { sum: 0, count: 0 }
      stats.ms = { sum: 0, count: 0 }
      stats.lastAt = 0
      stats.usage = { requests: 0, prompt: 0, completion: 0, cacheHit: 0, cacheMiss: 0 }
      stats.lastUsage = null
      stats.firstDeltaSamples = []
      stats.lastRequest = null
    },
    /**
     * 绑定 127.0.0.1 上的端口；被占用时顺序向后找空位（最多 16 个）。
     * 端口冲突在多实例 / 残留进程下很常见，静默失败会让「模型路由指向死端口」，
     * 所以这里直接换端口并把实际端口回给调用方（由调用方写回状态 + 路由 baseURL）。
     */
    listen(port) {
      return new Promise((resolve, reject) => {
        let attempts = 0
        const maxAttempts = 16
        const cleanup = () => {
          server.off('error', onError)
          server.off('listening', onListening)
        }
        const onError = (error) => {
          if (error?.code === 'EADDRINUSE' && attempts < maxAttempts) {
            attempts += 1
            const next = port + attempts
            if (next <= 65535) {
              tryListen(next)
              return
            }
          }
          cleanup()
          reject(error)
        }
        const onListening = () => {
          cleanup()
          resolve(server.address().port)
        }
        const tryListen = (candidate) => {
          server.once('error', onError)
          server.once('listening', onListening)
          server.listen(candidate, '127.0.0.1')
        }
        tryListen(port)
      })
    },
    close() {
      server.closeAllConnections?.()
      return new Promise((resolve) => server.close(() => resolve()))
    },
  }
}
