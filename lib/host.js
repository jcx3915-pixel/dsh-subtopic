/**
 * dsh-subtopic — host half.
 *
 * Serves two routes on the harness web server:
 *
 *   GET  /ext/subtopic/info  -> { ok, hasLlm, provider, model }
 *   POST /ext/subtopic/ask   -> chunked `text/plain` stream of an answer
 *
 * The answer is produced by the harness's own `llm` service using the model the
 * user currently has selected in the GUI, so a sub-topic card is priced exactly
 * like an ordinary turn and shows up in the same cost accounting.
 *
 * Wire format of the `/ask` stream (deliberately encode-free so partial text can
 * be rendered the instant it arrives):
 *
 *   plain text ...            answer text, written through verbatim
 *   NUL {"t":"meta",...} \n   one control frame: meta | error | done
 *   plain text ...
 *
 * A literal NUL byte never occurs in model output text, so `\0` is an
 * unambiguous frame marker.
 */

export const name = 'dsh-subtopic'

/** `webServer` is the only hard dependency; `llm` / `agentDefaultModel` are read lazily. */
export const inject = ['webServer']

const ROUTE_INFO = '/ext/subtopic/info'
const ROUTE_ASK = '/ext/subtopic/ask'
const ROUTE_GRAPH = '/ext/subtopic/graph'

const NUL = '\u0000'

const LIMITS = {
  selection: 4000,
  context: 8000,
  turns: 24,
  turnChars: 4000,
  maxTokens: 2000,
}

/** Last-resort model name when neither the config nor the GUI selection names one. */
const DEFAULT_MODEL = 'deepseek-flash'

const SYSTEM_PROMPT = [
  '你是 DeepSeek Harness 里的「子话题」助手。用户在对话中选中了一段内容，就地想弄明白它。',
  '',
  '回答要求：',
  '- 直接回答，先给结论，再给必要的推导、背景或类比。',
  '- 选中内容是代码、报错、命令或配置时，说明它做什么、关键点在哪、有没有坑。',
  '- 选中内容是概念、名词或论断时，用一两句话讲清楚它是什么、为什么成立、和什么容易混淆。',
  '- 简洁优先：默认控制在 200 字以内。用户明确要求展开时才写长。',
  '- 不要复述选中的原文，不要写「好的」「当然可以」这类开场白。',
  '- 使用 Markdown 排版（`行内代码`、**粗体**、列表、围栏代码块）。',
  '- 使用与用户提问相同的语言：用户用中文，你就用中文。',
  '- 如果选中内容残缺、无法判断，就直接说明还缺什么信息，不要硬猜。',
].join('\n')

/* ------------------------------------------------------------------ config */

function normalizeConfig(config) {
  const c = config && typeof config === 'object' ? config : {}
  const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '')
  return {
    provider: str(c.provider),
    model: str(c.model),
    reasoningEffort: str(c.reasoningEffort),
    maxTokens: Number.isFinite(c.maxTokens) && c.maxTokens > 0 ? Math.floor(c.maxTokens) : LIMITS.maxTokens,
    system: str(c.system) || SYSTEM_PROMPT,
  }
}

/* ------------------------------------------------------------- http helpers */

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  try {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(payload)
  } catch {
    /* the socket may already be gone; nothing useful left to do */
  }
}

async function readJson(req) {
  if (req && typeof req === 'object' && req.body !== undefined && req.body !== null) {
    const body = req.body
    if (typeof body === 'string') return body.trim() ? JSON.parse(body) : {}
    if (typeof body === 'object') return body
  }
  const chunks = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'))
  }
  const raw = chunks.join('')
  return raw.trim() ? JSON.parse(raw) : {}
}

function clampText(value, max) {
  if (typeof value !== 'string') return ''
  const text = value.split(NUL).join('').trim()
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n…（内容过长，已截断）`
}

function describeError(error) {
  if (!error) return '未知错误'
  if (typeof error === 'string') return error
  const message = typeof error.message === 'string' && error.message ? error.message : String(error)
  const code = error.code ? ` [${error.code}]` : ''
  return (message + code).slice(0, 600)
}

/* -------------------------------------------------------------- model pick */

function readDefaultSelection(ctx) {
  try {
    const service = ctx.get('agentDefaultModel')
    const selection = service && typeof service.currentSelection === 'function' ? service.currentSelection() : null
    if (selection && typeof selection === 'object') return selection
  } catch {
    /* no default-model service: fall back to whatever the caller supplied */
  }
  return null
}

/**
 * Ordered provider routes for one answer.
 *
 * The shipped `agent-default-model` row names `deepseek-official`, which has no
 * credential in a signed-in desktop deployment: such a call ends as a terminal
 * `finish` error chunk, so the model "says nothing" instead of answering. The
 * signed-in `deepseek-account` route is the one that actually serves requests,
 * so it is tried first unless the operator pinned a provider in the config.
 */
function resolveRoutes(ctx, options) {
  const fallback = readDefaultSelection(ctx)
  const model = options.model || (fallback && fallback.model) || DEFAULT_MODEL
  const effort = options.reasoningEffort || (fallback && fallback.reasoningEffort) || ''
  const routes = []
  const add = (provider, routeModel, routeEffort) => {
    const id = String(provider || '')
    if (!id || routes.some((route) => route.provider === id)) return
    const chosen = String(routeModel || model || '')
    if (!chosen) return
    routes.push({
      provider: id,
      model: chosen,
      reasoningEffort: String(routeEffort || effort || ''),
    })
  }
  add(options.provider, options.model, options.reasoningEffort)
  add('deepseek-account', model, effort)
  if (fallback && fallback.provider) add(fallback.provider, fallback.model, fallback.reasoningEffort)
  return routes
}

function describeLlm(ctx, options) {
  const llm = ctx.get('llm')
  const routes = resolveRoutes(ctx, options)
  const first = routes[0] || {}
  return {
    ok: true,
    hasLlm: Boolean(llm && typeof llm.stream === 'function'),
    provider: first.provider || '',
    model: first.model || '',
    reasoningEffort: first.reasoningEffort || '',
    routes: routes.map((route) => `${route.provider}/${route.model}`),
  }
}

/* ---------------------------------------------------------------- prompting */

function buildMessages(payload, selection, options) {
  const context = clampText(payload && payload.context, LIMITS.context)
  const rawTurns = Array.isArray(payload && payload.turns) ? payload.turns.slice(-LIMITS.turns) : []
  const turns = rawTurns
    .map((turn) => ({
      role: turn && turn.role === 'assistant' ? 'assistant' : 'user',
      text: clampText(turn && turn.text, LIMITS.turnChars),
    }))
    .filter((turn) => turn.text)

  const lines = []
  lines.push('【我在对话里选中的内容】')
  lines.push('<<<')
  lines.push(selection)
  lines.push('>>>')

  if (context && context.length > selection.length) {
    lines.push('')
    lines.push('【选中内容所在的上下文，只用来理解语境，不需要逐句解释】')
    lines.push('<<<')
    lines.push(context)
    lines.push('>>>')
  }

  if (turns.length > 1) {
    lines.push('')
    lines.push('【这张卡片里已经进行过的问答】')
    for (const turn of turns.slice(0, -1)) {
      lines.push(`${turn.role === 'assistant' ? '你' : '我'}：${turn.text}`)
    }
  }

  const latest = turns.length ? turns[turns.length - 1].text : ''
  lines.push('')
  lines.push('【我现在的请求】')
  lines.push(latest || '请解释上面选中的内容。')

  return [{ role: 'user', content: [{ type: 'text', text: lines.join('\n') }] }]
}

/* ---------------------------------------------------------------- the route */

function openStream(res) {
  res.writeHead(200, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store, no-transform',
    'x-accel-buffering': 'no',
  })
  if (typeof res.flushHeaders === 'function') res.flushHeaders()
}

function writeFrame(res, frame) {
  if (res.writableEnded || res.destroyed) return
  try {
    res.write(`${NUL}${JSON.stringify(frame)}\n`)
  } catch {
    /* client vanished mid-stream */
  }
}

function writeText(res, text) {
  if (res.writableEnded || res.destroyed) return
  try {
    res.write(text)
  } catch {
    /* client vanished mid-stream */
  }
}

async function handleAsk(ctx, options, req, res) {
  let payload
  try {
    payload = await readJson(req)
  } catch {
    sendJson(res, 400, { ok: false, error: '请求体不是合法 JSON' })
    return
  }

  const selection = clampText(payload && payload.selection, LIMITS.selection)
  if (!selection) {
    sendJson(res, 400, { ok: false, error: '没有拿到选中的文本' })
    return
  }

  const llm = ctx.get('llm')
  if (!llm || typeof llm.stream !== 'function') {
    sendJson(res, 503, { ok: false, error: 'llm 服务不可用，无法生成解答' })
    return
  }

  const routes = resolveRoutes(ctx, options)
  if (!routes.length) {
    sendJson(res, 409, { ok: false, error: '当前没有可用的模型路由，请先在界面里选一个模型' })
    return
  }

  const messages = buildMessages(payload, selection, options)

  const controller = new AbortController()
  let clientGone = false
  const onClose = () => {
    clientGone = true
    controller.abort()
  }
  if (typeof req.on === 'function') req.on('close', onClose)

  openStream(res)

  let received = ''
  let failure = ''
  const seen = []
  const tried = []
  try {
    for (const route of routes) {
      if (clientGone || controller.signal.aborted) break
      writeFrame(res, { t: 'meta', provider: route.provider, model: route.model })

      const call = {
        provider: route.provider,
        model: route.model,
        system: options.system,
        messages,
        maxTokens: options.maxTokens,
        signal: controller.signal,
      }
      if (route.reasoningEffort) call.reasoningEffort = route.reasoningEffort

      let text = ''
      let routeFailure = ''
      try {
        const stream = llm.stream(call)
        for await (const chunk of stream) {
          if (clientGone) break
          if (!chunk || typeof chunk !== 'object') continue
          if (chunk.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text) {
            text += chunk.text
            received += chunk.text
            writeText(res, chunk.text)
            continue
          }
          /* Adapter selection, dispatch and iteration failures arrive here as a
           * terminal `finish` chunk, never as a throw; without this the caller
           * can only report "the model said nothing". */
          if (chunk.type === 'finish') {
            const reason = chunk.reason || {}
            seen.push('finish:' + String(reason.kind))
            if (reason.kind === 'error' || reason.kind === 'aborted') {
              const fail = reason.failure || {}
              routeFailure = String(fail.message || (reason.kind === 'aborted' ? '模型调用被中断' : '模型调用失败'))
              if (fail.code) routeFailure += ' [' + String(fail.code) + ']'
              if (fail.status) routeFailure += ' (HTTP ' + String(fail.status) + ')'
            }
          } else {
            seen.push(String(chunk.type))
          }
        }
      } catch (error) {
        if (!clientGone && !controller.signal.aborted) routeFailure = describeError(error)
      }

      tried.push(route.provider + (routeFailure ? ' -> ' + routeFailure : ' -> 无输出'))
      if (text.trim() || clientGone || controller.signal.aborted) break
      /* This route produced nothing: remember why and try the next one. */
      if (routeFailure) failure = routeFailure
    }
  } finally {
    if (typeof req.off === 'function') req.off('close', onClose)
    if (!received.trim() && !clientGone && !controller.signal.aborted) {
      const detail = '（provider: ' + tried.join(' | ') + '；chunk: ' + (seen.join(',') || 'none') + '）'
      writeFrame(res, { t: 'error', message: (failure ? failure + ' ' : '模型没有返回任何内容，请重试') + detail })
    }
    if (!controller.signal.aborted) writeFrame(res, { t: 'done' })
    try {
      if (!res.writableEnded) res.end()
    } catch {
      /* already closed */
    }
  }
}

/* ------------------------------------------------------------ diagnostics */

/** JSON that survives functions and cycles inside harness internals. */
function safeJson(value) {
  const seen = new WeakSet()
  return JSON.stringify(value, (key, val) => {
    if (typeof val === 'function') return '[function]'
    if (val && typeof val === 'object') {
      if (seen.has(val)) return '[circular]'
      seen.add(val)
    }
    return val
  })
}

/**
 * Report whether the harness composed this plugin's browser half into the
 * `window.__DSH_BOOT__` graph. A client half that was never composed stays
 * invisible no matter how many times the page reloads.
 */
function describeClientModules(ctx) {
  const registry = ctx.get('clientModules')
  if (!registry || typeof registry.graph !== 'function') {
    return { ok: false, reason: 'clientModules service is unavailable' }
  }
  const graph = registry.graph()
  const entries = Array.isArray(graph && graph.entries) ? graph.entries : []
  const ids = entries.map((e) => (e && typeof e === 'object' && e.id ? String(e.id) : String(e)))
  return {
    ok: true,
    rev: graph && graph.rev,
    total: entries.length,
    hasSubtopic: ids.includes('dsh-subtopic'),
    ids,
    subtopic: entries.filter((e) => e && e.id === 'dsh-subtopic'),
    batches: (Array.isArray(graph && graph.batches) ? graph.batches : []).map((b) => ({
      kind: b && b.kind,
      id: b && b.id,
      url: b && b.url,
    })),
    clientPath: typeof registry.clientPath === 'function' ? registry.clientPath('dsh-subtopic') : undefined,
  }
}

/* --------------------------------------------------------------- plugin api */

export function apply(ctx, config) {
  const options = normalizeConfig(config)

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE_INFO,
        handler: (_req, res) => sendJson(res, 200, describeLlm(ctx, options)),
      }),
    'dsh-subtopic: info route',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE_ASK,
        handler: (req, res) => {
          void handleAsk(ctx, options, req, res)
        },
      }),
    'dsh-subtopic: ask route',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE_GRAPH,
        handler: (_req, res) => {
          let payload
          try {
            payload = safeJson(describeClientModules(ctx))
          } catch (error) {
            payload = JSON.stringify({ ok: false, reason: describeError(error) })
          }
          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          })
          res.end(payload)
        },
      }),
    'dsh-subtopic: graph route',
  )

  try {
    ctx.logger?.info?.(`[dsh-subtopic] ready: ${ROUTE_INFO} , ${ROUTE_ASK}`)
  } catch {
    /* logging is best-effort */
  }
}
