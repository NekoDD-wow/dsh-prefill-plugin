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
import { appendFileSync } from 'node:fs'

/** 判断一条请求能否加前缀：无工具、有消息、前缀非空。 */
export function canInject(body, reasoningPrefix) {
  if (typeof reasoningPrefix !== 'string' || reasoningPrefix.trim() === '') return 'empty-prefix'
  if (!Array.isArray(body?.messages) || body.messages.length === 0) return 'no-messages'
  if (Array.isArray(body.tools) && body.tools.length > 0) return 'has-tools'
  return null
}

export function injectReasoningPrefix(body, { reasoningPrefix, contentPrefix = '' } = {}) {
  const reason = canInject(body, reasoningPrefix)
  if (reason !== null) return { body, applied: false, reason }
  const messages = [...body.messages, { role: 'assistant', content: contentPrefix, reasoning_content: reasoningPrefix, prefix: true }]
  return { body: { ...body, messages }, applied: true, reason: null }
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

/**
 * 由工具 registry 的 wire schemas 生成「前缀模式」用的文本清单。
 * @param schemas - [{ name, description, parameters }]（parameters 为 JSON Schema 对象）
 * @returns 注入上下文的纯文本
 */
export function buildToolCatalog(schemas) {
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
    const parameters = schema.parameters !== null && typeof schema.parameters === 'object' ? schema.parameters : {}
    const properties = parameters.properties !== null && typeof parameters.properties === 'object' ? parameters.properties : {}
    const required = Array.isArray(parameters.required) ? new Set(parameters.required) : new Set()
    const params = Object.keys(properties).map((key) => describeParam(key, properties[key], required.has(key)))
    const description = typeof schema.description === 'string' ? schema.description.replace(/\s+/g, ' ').slice(0, 160) : ''
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

/**
 * 起一个只绑定 127.0.0.1 的转发代理。
 * @param options.getConfig - 每次请求时读取当前配置（enabled / upstream / reasoningPrefix / contentPrefix / stripTools）。
 * @param options.logger - 可选日志。
 * @returns {{ listen: (port: number) => Promise<number>, close: () => Promise<void>, server: import('node:http').Server }}
 */
export function createReasoningPrefixProxy({ getConfig, logger, onOutcome } = {}) {
  /** 最近 50 条审计（状态路由读它）。 */
  const audit = []
  const record = (event) => {
    audit.push({ at: Date.now(), ...event })
    if (audit.length > 50) audit.shift()
  }
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const incoming = Buffer.concat(chunks)
    const config = getConfig?.() ?? {}
    const isChat = req.url?.includes('/chat/completions') === true
    let applied = false
    let shimActive = false
    let reason = 'not-chat'
    let systemBody = null
    let userBody = null
    if (isChat && config.enabled !== false) {
      try {
        const body = JSON.parse(incoming.toString('utf8'))
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
          if (config.textualize === true || process.env.DSH_PREFILL_SPIKE_TEXTUALIZE === '1') {
            const textualized = textualizeToolHistory(draft)
            draft.messages = textualized.body.messages
            applied = true
            reason = null
            if (textualized.changed > 0) logger?.info?.('dsh-prefill: reasoning-prefix 文本化了 ' + textualized.changed + ' 条 tool 消息')
          }
          const result = injectReasoningPrefix(draft, config)
          if (!result.applied) {
            reason = result.reason
            return null
          }
          applied = true
          reason = null
          const shim = config.shim === true || process.env.DSH_PREFILL_SPIKE_SHIM === '1'
          if (shim) {
            const messages = result.body.messages
            const prefixMessage = messages[messages.length - 1]
            result.body.messages = [...messages.slice(0, -1), catalogMessages[catalogRole], prefixMessage]
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
    const dumpPath = process.env.DSH_PREFILL_SPIKE_DUMP
    if (typeof dumpPath === 'string' && dumpPath !== '' && isChat && systemBody !== null) {
      try {
        const parsed = JSON.parse(systemBody.toString('utf8'))
        appendFileSync(dumpPath, JSON.stringify({ at: Date.now(), hasTools: Array.isArray(parsed.tools) && parsed.tools.length > 0, messages: parsed.messages.length, catalogRole: parsed.messages[parsed.messages.length - 2]?.role }) + '\n')
      } catch {
        // dump 失败不影响转发
      }
    }
    const variants = [];
    const preferUser = config.catalogRole === 'user';
    if (preferUser) {
      if (userBody !== null && shimActive) variants.push({ kind: 'user', body: userBody });
      if (systemBody !== null && shimActive) variants.push({ kind: 'system', body: systemBody });
    } else {
      if (systemBody !== null && shimActive) variants.push({ kind: 'system', body: systemBody });
      if (userBody !== null && shimActive) variants.push({ kind: 'user', body: userBody });
    }
    if (systemBody !== null && !shimActive) variants.push({ kind: 'prefixed', body: systemBody });
    variants.push({ kind: 'passthrough', body: incoming });
    const started = Date.now()
    try {
      let final = null
      let finalVariant = null
      for (const variant of variants) {
        const response = await fetch(target, {
          method: req.method,
          headers,
          body: req.method === 'GET' || req.method === 'HEAD' ? undefined : variant.body,
        })
        if (response.status < 400) {
          final = response
          finalVariant = variant.kind
          break;
        }
        const text = await response.text()
        record({ kind: 'upstream-error', variant: variant.kind, status: response.status, bodyHead: text.slice(0, 300) })
        logger?.warn?.(`dsh-prefill: reasoning-prefix ${variant.kind} 上游 ${response.status}: ${text.slice(0, 300)}`)
        if (variant.kind === 'passthrough') {
          res.writeHead(response.status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) }).end(text)
          onOutcome?.({ ok: false, variant: 'passthrough', status: response.status })
          return;
        }
      }
      if (final === null) {
        res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }).end('reasoning-prefix proxy: no variant succeeded')
        onOutcome?.({ ok: false, variant: 'none', status: 502 })
        return;
      }
      const outHeaders = {}
      for (const [key, value] of final.headers) {
        if (['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key)) continue
        outHeaders[key] = value
      }
      const transformedVariant = finalVariant === 'system' || finalVariant === 'user'
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
        const MAX_EMITTED_CALLS = 8
        let firstDeltaMs = null
        let finished = false
        const collected = []
        const contentLog = process.env.DSH_PREFILL_SPIKE_CONTENT
        const writeChunk = (delta, finishReason) => {
          const payload = {
            id: typeof base?.id === 'string' ? base.id : 'shim',
            object: 'chat.completion.chunk',
            created: typeof base?.created === 'number' ? base.created : Math.floor(Date.now() / 1000),
            model: typeof base?.model === 'string' ? base.model : '',
            choices: [{ index: 0, delta, finish_reason: finishReason === undefined ? null : finishReason }],
          }
          res.write('data: ' + JSON.stringify(payload) + '\n\n')
        }
        const writeUsage = (usage) => {
          const payload = {
            id: typeof base?.id === 'string' ? base.id : 'shim',
            object: 'chat.completion.chunk',
            created: typeof base?.created === 'number' ? base.created : Math.floor(Date.now() / 1000),
            model: typeof base?.model === 'string' ? base.model : '',
            choices: [],
            usage,
          }
          res.write('data: ' + JSON.stringify(payload) + '\n\n')
        }
        const emitEvents = (events) => {
          for (const event of events) {
            if (event.type === 'content') {
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
          res.write('data: [DONE]\n\n')
          res.end()
          if (typeof contentLog === 'string' && contentLog !== '') {
            try {
              appendFileSync(contentLog, JSON.stringify({ at: Date.now(), text: collected.join('') }) + '\n')
            } catch {
              // 诊断失败不影响转发
            }
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
          if (base === null) base = chunk
          if (chunk.usage !== undefined && chunk.usage !== null) writeUsage(chunk.usage)
          const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined
          const delta = choice !== null && typeof choice === 'object' ? choice.delta : undefined
          if (delta !== null && typeof delta === 'object') {
            if (typeof delta.reasoning_content === 'string' && delta.reasoning_content !== '') {
              if (firstDeltaMs === null) firstDeltaMs = Date.now() - started
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
          await new Promise((resolve) => {
            const reader = Readable.fromWeb(final.body)
            const decoder = new TextDecoder()
            let frameBuffer = ''
            reader.on('data', (chunk) => {
              frameBuffer += decoder.decode(chunk, { stream: true })
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
            reader.on('error', () => {
              try {
                res.end()
              } catch {
                // 客户端已断开
              }
              resolve()
            })
          })
        } else {
          closeStream()
        }
        record({ kind: 'shim', variant: finalVariant, status: final.status, calls: callCount, ms: Date.now() - started, firstDeltaMs })
        const shimLog = process.env.DSH_PREFILL_SPIKE_LOG
        if (typeof shimLog === 'string' && shimLog !== '') {
          try {
            appendFileSync(shimLog, JSON.stringify({ at: Date.now(), applied: true, shim: true, calls: callCount, status: final.status, firstDeltaMs }) + '\n')
          } catch {
            // 日志失败不影响转发
          }
        }
        onOutcome?.({ ok: true, variant: finalVariant, status: final.status, calls: callCount })
        logger?.info?.('dsh-prefill: reasoning-prefix shim 流式转换完成，文本首块 ' + String(firstDeltaMs ?? '-') + 'ms，工具调用 ' + callCount + ' 个')
        return;
      }
      res.writeHead(final.status, outHeaders)
      const rawPathForStream = process.env.DSH_PREFILL_SPIKE_RAW
      if (final.body !== null) {
        const { Readable } = await import('node:stream')
        await new Promise((resolve) => {
          const reader = Readable.fromWeb(final.body)
          if (typeof rawPathForStream === 'string' && rawPathForStream !== '') {
            reader.on('data', (chunk) => { try { appendFileSync(rawPathForStream, chunk) } catch { /* ignore */ } })
          }
          reader.pipe(res)
          reader.on('end', resolve)
          reader.on('error', resolve)
        })
      } else res.end()
      record({ kind: 'forward', variant: finalVariant, status: final.status, ms: Date.now() - started })
      const logPath = process.env.DSH_PREFILL_SPIKE_LOG
      if (typeof logPath === 'string' && logPath !== '') {
        try {
          appendFileSync(logPath, JSON.stringify({ at: Date.now(), applied, reason, variant: finalVariant, status: final.status, target, ms: Date.now() - started }) + '\n')
        } catch {
          // 日志写不进去不影响转发
        }
      }
      onOutcome?.({ ok: true, variant: finalVariant, status: final.status })
      logger?.info?.(`dsh-prefill: reasoning-prefix ${applied ? '已加前缀(' + finalVariant + ')' : '透传(' + reason + ')'} → ${target} [${final.status}] ${Date.now() - started}ms`)
    } catch (error) {
      logger?.warn?.(`dsh-prefill: reasoning-prefix 转发失败: ${String(error?.message ?? error)}`)
      record({ kind: 'transport-error', error: String(error?.message ?? error) })
      onOutcome?.({ ok: false, variant: 'none', status: 0 })
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }).end('reasoning-prefix proxy error: ' + String(error?.message ?? error))
    }
  })
  return {
    server,
    audit: () => [...audit],
    listen(port) {
      return new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, '127.0.0.1', () => resolve(server.address().port))
      })
    },
    close() {
      server.closeAllConnections?.()
      return new Promise((resolve) => server.close(() => resolve()))
    },
  }
}
