/**
 * 每轮注入的「自动收放」（v0.9，设计见 docs/规划-每轮注入自动收放与预设带注入设置.md §B）。
 *
 * 这里全是纯函数，不碰 IO：
 * - `splitTurns(events)`：把会话事件切成一轮一轮（是否注入过、思维链、回答正文、是否完成）；
 * - `scoreTurn(turn, checks)`：用规则给一轮打分（pass / weak / fail / skip）；
 * - `replay(turns, config, currentTurn)`：把历史从头喂给状态机，决定本轮发不发。
 *
 * 状态**不落盘**：每次都从会话事件重算 ⇒ 插件重载、DSH 重启不丢，双座位 / 旁路请求多次经过同一轮结果一致。
 * 规则与离线分析脚本（analyze.py）保持同一口径（中文占比公式、四段标题判定、旁观者词）。
 */

export const CHECK_IDS = ['zh', 'four', 'noLeak', 'firstPerson']

export const AUTO_DEFAULTS = Object.freeze({
  warmup: 3, // W：至少注入几轮（有效判定）才可能停
  streak: 3, // K：连续几轮 pass 才试停
  probation: 2, // P：试停期要求连续几轮 pass
  maxStreak: 12, // 退避上限
  maxResumes: 3, // R：恢复几次后转常开
  trialFailsForBackoff: 2, // 试停累计失败几次也让 K 翻倍
})

export const THRESHOLDS = Object.freeze({
  zhPass: 0.8,
  zhFail: 0.6,
  fourPass: 2 / 3,
  fourFail: 1 / 3,
  outsiderFail: 2,
  minChars: 60, // 汉字 + 拉丁字母的个数；少于这个数的思维链样本太小，不判
})

const TAGS = ['【理解】', '【拆解】', '【验证】', '【结论】']
const OUTSIDER = /用户|the user|\bUser\b/gi
const BREAK = /扮演|角色设定|设定要求|人设|in character|role-?play|persona|playing the role/gi

/** 去掉代码、路径、URL：讨论代码的一轮思维链里英文天然多，不该算跑偏。 */
export function stripCode(text) {
  return String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/(?:[A-Za-z]:)?(?:[\w.-]*[/\\])+[\w.-]+/g, ' ')
    .replace(/\b[a-z]+(?:[A-Z][a-z0-9]*)+\b/g, ' ') // camelCase 标识符
    .replace(/\b\w+_\w+\b/g, ' ') // snake_case 标识符
}

function counts(text) {
  const han = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  const latin = (text.match(/[A-Za-z]/g) ?? []).length
  return { han, latin, weight: han + latin / 4 }
}

/** 中文占比：汉字 /（汉字 + 拉丁字母/4），与 analyze.py 一致；没有字 ⇒ null。 */
export function zhRatio(text) {
  const { han, weight } = counts(String(text ?? ''))
  return weight > 0 ? han / weight : null
}

function hasFour(text) {
  return TAGS.every((tag) => new RegExp(`(^|\\n)\\s*${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(text))
}

function combine(results) {
  // noLeak 只能否决、不能单独成立：其余检查都判不了（思维链太短 / 没有）时，
  // 只凭「回答里没漏四段」不算达标，整轮按 skip 处理。
  const { noLeak, ...rest } = results
  const values = Object.values(rest)
  if (noLeak === 'fail') return 'fail'
  if (values.length === 0 || values.every((value) => value === 'skip')) return 'skip'
  if (values.includes('fail')) return 'fail'
  if (values.filter((value) => value !== 'skip').every((value) => value === 'pass')) return 'pass'
  return 'weak'
}

/**
 * 给一轮打分。
 * @param turn { reasoning: string[]（每步一段）, answer: string }
 * @param checks 检查项 id 列表
 * @returns { verdict, results: {id: verdict}, scores }
 */
export function scoreTurn(turn, checks, thresholds = THRESHOLDS) {
  const steps = (Array.isArray(turn?.reasoning) ? turn.reasoning : []).filter((step) => typeof step === 'string' && step.trim() !== '')
  const all = steps.join('\n')
  const answer = String(turn?.answer ?? '')
  const stripped = stripCode(all)
  const { han, latin } = counts(stripped)
  const scores = { chars: han + latin, steps: steps.length }
  const results = {}
  const tooShort = steps.length === 0 || han + latin < thresholds.minChars
  for (const id of Array.isArray(checks) ? checks : []) {
    if (id === 'zh') {
      const z = tooShort ? null : zhRatio(stripped)
      scores.zh = z === null ? null : Math.round(z * 100) / 100
      results.zh = z === null ? 'skip' : z >= thresholds.zhPass ? 'pass' : z < thresholds.zhFail ? 'fail' : 'weak'
    } else if (id === 'four') {
      const ok = steps.filter(hasFour).length
      const share = steps.length > 0 ? ok / steps.length : 0
      scores.four = `${ok}/${steps.length}`
      results.four = tooShort ? 'skip' : share >= thresholds.fourPass ? 'pass' : share < thresholds.fourFail ? 'fail' : 'weak'
    } else if (id === 'noLeak') {
      // 回答正文四段齐全 = 漏进回答（D1）；和思维链长短无关，有回答就能判。
      const leak = answer.trim() !== '' && hasFour(answer)
      scores.leak = leak
      results.noLeak = answer.trim() === '' ? 'skip' : leak ? 'fail' : 'pass'
    } else if (id === 'firstPerson') {
      const outsider = (all.match(OUTSIDER) ?? []).length
      const breakChar = (all.match(BREAK) ?? []).length
      scores.outsider = outsider
      scores.breakChar = breakChar
      const total = outsider + breakChar
      results.firstPerson = tooShort ? 'skip' : total === 0 ? 'pass' : total >= thresholds.outsiderFail ? 'fail' : 'weak'
    }
  }
  return { verdict: combine(results), results, scores }
}

function textOf(message) {
  const content = message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((part) => (part?.type === 'text' && typeof part.text === 'string' ? part.text : '')).join('')
}

/**
 * 会话事件 → 轮列表。
 * @returns [{ turn, completed, synthetic, injected, reasoning: string[], answer }]
 *   synthetic：预填装写进历史的开场合成轮（不调模型）；injected：这一轮发过每轮注入。
 */
export function splitTurns(events) {
  const turns = new Map()
  let current = 0
  const at = (turn) => {
    if (!turns.has(turn)) turns.set(turn, { turn, completed: false, synthetic: false, injected: false, hasUser: false, reasoning: [], answer: '' })
    return turns.get(turn)
  }
  for (const event of Array.isArray(events) ? events : []) {
    const type = event?.type
    const data = event?.data ?? {}
    if (type === 'turn/start') {
      current = Number.isFinite(data.turn) ? data.turn : current + 1
      at(current)
    } else if (type === 'turn/end') {
      const turn = at(Number.isFinite(data.turn) ? data.turn : current)
      turn.completed = (data?.reason?.kind ?? 'completed') === 'completed'
    } else if (current > 0 && type === 'user/message') {
      const source = data?.source ?? {}
      const turn = at(current)
      if (source.kind === 'prefill' && source.prefill === 'every-turn') turn.injected = true
      if (source.kind === 'user') {
        if (typeof source.prefill === 'string') turn.synthetic = true
        else turn.hasUser = true
      }
    } else if (current > 0 && type === 'assistant/message') {
      const message = data?.message ?? {}
      const turn = at(current)
      if (message?.source?.provider === 'prefill-probe') {
        turn.synthetic = true
        continue
      }
      if (message?.source?.kind !== undefined && message.source.kind !== 'model') continue
      for (const part of Array.isArray(message.content) ? message.content : []) {
        if (part?.type === 'reasoning' && typeof part.text === 'string') turn.reasoning.push(part.text)
      }
      const text = textOf(message)
      if (text.trim() !== '') turn.answer = turn.answer === '' ? text : `${turn.answer}\n\n${text}`
    }
  }
  return [...turns.values()].sort((a, b) => a.turn - b.turn)
}

/** 规范化自动模式参数（缺省 / 越界取默认）。 */
export function autoParams(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const int = (value, fallback, min, max) => {
    const n = Math.floor(Number(value))
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback
  }
  return {
    warmup: int(source.warmup, AUTO_DEFAULTS.warmup, 0, 50),
    streak: int(source.streak, AUTO_DEFAULTS.streak, 1, 50),
    probation: int(source.probation, AUTO_DEFAULTS.probation, 1, 20),
    maxStreak: AUTO_DEFAULTS.maxStreak,
    maxResumes: int(source.maxResumes, AUTO_DEFAULTS.maxResumes, 1, 20),
    trialFailsForBackoff: AUTO_DEFAULTS.trialFailsForBackoff,
  }
}

/** 旧数据兼容：没有 mode 时按 untilTurn 推断。 */
export function modeOf(entry) {
  if (entry?.mode === 'auto' || entry?.mode === 'until' || entry?.mode === 'always') return entry.mode
  return Number(entry?.untilTurn) > 0 ? 'until' : 'always'
}

export function checksOf(entry) {
  return Array.isArray(entry?.checks) ? CHECK_IDS.filter((id) => entry.checks.includes(id)) : []
}

/**
 * 从历史重放，决定第 currentTurn 轮发不发。
 * @param turns splitTurns 的结果（可含 currentTurn 及之后，会被忽略）
 * @param entry 每轮注入配置 { mode, untilTurn, firstText, checks, auto: {warmup, streak, probation, override}, since }
 * @returns {
 *   inject, isFirst, nth（若注入，这是第几次）,
 *   state: 'injecting'|'trial'|'paused'|'always'|'until-done'|'until',
 *   streak, need, resumes, history: [{turn, injected, verdict, state, scores}], reason
 * }
 */
export function replay(turns, entry, currentTurn) {
  const list = (Array.isArray(turns) ? turns : []).filter((turn) => turn.turn < currentTurn)
  const injectedSoFar = list.filter((turn) => turn.injected).length
  const isFirst = injectedSoFar === 0
  const mode = modeOf(entry)
  const base = { isFirst, nth: injectedSoFar + 1, mode }
  if (mode === 'always') return { ...base, inject: true, state: 'always', history: [], reason: 'always' }
  if (mode === 'until') {
    const until = Math.max(0, Math.floor(Number(entry?.untilTurn) || 0))
    const inject = until === 0 || injectedSoFar < until
    return { ...base, inject, state: inject ? 'until' : 'until-done', history: [], reason: `until ${injectedSoFar}/${until}` }
  }

  const checks = checksOf(entry)
  const params = autoParams(entry?.auto)
  const since = Math.max(0, Math.floor(Number(entry?.since) || 0))
  const override = entry?.auto?.override
  const overrideAt = Number.isFinite(Number(override?.atTurn)) ? Number(override.atTurn) : undefined
  const hasFirstText = typeof entry?.firstText === 'string' && entry.firstText.trim() !== ''

  let state = 'injecting'
  let streak = 0
  let need = params.streak
  let evaluated = 0 // 注入中且非 skip 的轮数（warmup 用）
  let trialPass = 0
  let trialFails = 0
  let resumes = 0
  let window = []
  let overrideDone = false
  let reason = 'warmup'
  const history = []
  let seenInjected = list.filter((turn) => turn.turn < since && turn.injected).length

  const applyOverride = () => {
    if (overrideDone || overrideAt === undefined) return
    overrideDone = true
    if (override.action === 'resume') {
      state = 'injecting'
      streak = 0
      need = params.streak
      resumes = 0
      trialFails = 0
      window = []
      reason = 'manual resume'
    } else if (override.action === 'pause') {
      state = 'paused'
      window = []
      reason = 'manual pause'
    }
  }

  if (checks.length > 0) {
    for (const turn of list) {
      if (turn.turn < since) continue
      if (overrideAt !== undefined && turn.turn >= overrideAt) applyOverride()
      if (turn.synthetic) continue
      const injectedNow = state === 'injecting' || state === 'always'
      let verdict = 'skip'
      let scored
      // 首轮专用段那一轮不参与判定（它和后续段不是同一句提醒）。
      const firstSpecial = turn.injected && hasFirstText && seenInjected === 0
      if (turn.injected) seenInjected += 1
      if (turn.completed && turn.hasUser && !firstSpecial) {
        scored = scoreTurn(turn, checks)
        verdict = scored.verdict
      }
      const before = state
      if (verdict !== 'skip') {
        if (state === 'injecting') {
          evaluated += 1
          streak = verdict === 'pass' ? streak + 1 : 0
          reason = verdict === 'pass' ? `pass ${streak}/${need}` : `${verdict} resets streak`
          if (evaluated >= params.warmup && streak >= need) {
            state = 'trial'
            trialPass = 0
            reason = `stable ${streak} turns`
          }
        } else if (state === 'trial') {
          if (verdict === 'pass') {
            trialPass += 1
            reason = `trial ${trialPass}/${params.probation}`
            if (trialPass >= params.probation) {
              state = 'paused'
              window = []
              reason = 'held without inject'
            }
          } else {
            state = 'injecting'
            streak = 0
            trialFails += 1
            if (trialFails % params.trialFailsForBackoff === 0) need = Math.min(need * 2, params.maxStreak)
            reason = `trial ${verdict}`
          }
        } else if (state === 'paused') {
          window = [...window, verdict].slice(-3)
          const fails = window.filter((v) => v === 'fail').length
          const weaks = window.filter((v) => v === 'weak').length
          if (fails >= 2 || (fails >= 1 && weaks >= 1)) {
            resumes += 1
            need = Math.min(need * 2, params.maxStreak)
            streak = 0
            window = []
            state = resumes >= params.maxResumes ? 'always' : 'injecting'
            reason = state === 'always' ? 'unstable, always on' : `drift (${verdict})`
          } else reason = verdict === 'pass' ? 'holding' : `${verdict}, watching`
        }
      }
      history.push({ turn: turn.turn, injected: turn.injected, expected: injectedNow, verdict, state: before, next: state, scores: scored?.scores, results: scored?.results })
    }
  } else reason = 'no checks'
  if (overrideAt !== undefined && overrideAt <= currentTurn) applyOverride()

  const inject = state === 'injecting' || state === 'always'
  return { ...base, inject, state, streak, need, resumes, evaluated, history, reason, checks }
}
