/**
 * Offline test for the dsh-subtopic HOST half.
 *
 * Loads the real `lib/host.js` (the cordis plugin module), runs `apply()` against
 * a fake harness context, then drives the captured HTTP route handlers exactly
 * like the web server would.
 *
 * The fake `llm` service reproduces the documented contract: failures arrive as
 * a terminal `finish` chunk (`{kind:'error', failure:{message,code,status}}`),
 * never as a throw. That contract is the reason the plugin walks an ordered list
 * of provider routes: the shipped default (`deepseek-official`) has no
 * credential in a signed-in desktop deployment, while `deepseek-account` is the
 * route that actually serves requests.
 *
 * Run: node test/host-half.mjs
 */

const MODULE_URL = new URL('../lib/host.js', import.meta.url).href

let failures = 0
let checks = 0

function check(label, condition, detail) {
  checks += 1
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    failures += 1
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` :: ${JSON.stringify(detail)}`}`)
  }
}

/* ------------------------------------------------------------------ fakes */

const NUL = '\u0000'

function makeRes() {
  const state = { status: 0, headers: null, body: '', ended: false }
  let resolveEnd
  const done = new Promise((resolve) => {
    resolveEnd = resolve
  })
  state.done = done
  state.res = {
    writableEnded: false,
    destroyed: false,
    flushHeaders() {
      state.flushed = true
    },
    writeHead(status, headers) {
      state.status = status
      state.headers = headers
    },
    write(chunk) {
      state.body += String(chunk)
      return true
    },
    end(chunk) {
      if (chunk !== undefined) state.body += String(chunk)
      state.ended = true
      state.res.writableEnded = true
      resolveEnd(state)
    },
    on() {},
    off() {},
  }
  return state
}

function makeReq(body) {
  return { body, on() {}, off() {} }
}

/** Parse the `NUL{json}\n` control frames out of a streamed body. */
function parseFrames(body) {
  const frames = []
  let text = ''
  let rest = body
  while (rest.length) {
    const at = rest.indexOf(NUL)
    if (at === -1) {
      text += rest
      break
    }
    text += rest.slice(0, at)
    const nl = rest.indexOf('\n', at)
    const raw = rest.slice(at + 1, nl === -1 ? rest.length : nl)
    try {
      frames.push(JSON.parse(raw))
    } catch {
      frames.push({ t: 'unparsed', raw })
    }
    rest = nl === -1 ? '' : rest.slice(nl + 1)
  }
  return { frames, text }
}

/* --------------------------------------------------------------- the fake ctx */

function buildHarness(behaviour) {
  const calls = []
  const routes = new Map()

  const llm = {
    stream(call) {
      calls.push({ provider: call.provider, model: call.model, messages: call.messages, system: call.system })
      const plan = behaviour(call.provider)
      return (async function* run() {
        for (const chunk of plan) {
          await Promise.resolve()
          yield chunk
        }
      })()
    },
  }

  const ctx = {
    effect(fn) {
      const disposer = fn()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    get(name) {
      if (name === 'llm') return llm
      if (name === 'agentDefaultModel') {
        return { currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: '' }) }
      }
      if (name === 'clientModules') {
        return {
          graph: () => ({ rev: 'test-rev', entries: [{ id: 'dsh-subtopic' }, { id: 'dsh-subtopic-layer' }], batches: [] }),
          clientPath: () => 'plugins/??dsh-subtopic/client.js',
        }
      }
      return undefined
    },
    webServer: {
      register(route) {
        routes.set(route.path, route)
        return () => routes.delete(route.path)
      },
    },
    logger: { info() {} },
  }

  return { ctx, calls, routes }
}

/* ------------------------------------------------------------------- cases */

const mod = await import(MODULE_URL)

console.log('module exports:', Object.keys(mod).sort().join(','))
check('exports apply', typeof mod.apply === 'function')
check('exports name', mod.name === 'dsh-subtopic')
check('exports inject', Array.isArray(mod.inject) && mod.inject.includes('webServer'))

/* case 1 — the signed-in route answers on the first attempt */
{
  console.log('\ncase 1: deepseek-account answers immediately')
  const { ctx, calls, routes } = buildHarness((provider) => {
    if (provider === 'deepseek-account') {
      return [
        { type: 'block-start', index: 0, blockType: 'text' },
        { type: 'text-delta', index: 0, text: '结论：这是示例。' },
        { type: 'text-delta', index: 0, text: '这是第二段示例文本。' },
        { type: 'block-end', index: 0, block: { type: 'text', text: '' } },
        { type: 'finish', reason: { kind: 'stop' } },
      ]
    }
    return [{ type: 'finish', reason: { kind: 'error', failure: { message: 'should not be reached', code: 'unexpected' } } }]
  })
  await mod.apply(ctx, undefined)

  check('registered info route', routes.has('/ext/subtopic/info'))
  check('registered ask route', routes.has('/ext/subtopic/ask'))
  check('registered graph route', routes.has('/ext/subtopic/graph'))

  const info = makeRes()
  routes.get('/ext/subtopic/info').handler(makeReq(undefined), info.res)
  const infoPayload = JSON.parse(info.body)
  check('info reports the account route first', infoPayload.routes[0] === 'deepseek-account/deepseek-flash', infoPayload.routes)

  const asked = makeRes()
  routes.get('/ext/subtopic/ask').handler(
    makeReq({ selection: 'sample phrase', context: '上文。sample phrase。下文。', turns: [{ role: 'user', text: '请解释我选中的内容。' }] }),
    asked.res,
  )
  await asked.done
  const parsed = parseFrames(asked.body)

  check('single provider attempt', calls.length === 1, calls.map((c) => c.provider))
  check('attempt uses the signed-in route', calls[0].provider === 'deepseek-account', calls[0].provider)
  check('answer text streamed verbatim', parsed.text === '结论：这是示例。这是第二段示例文本。', parsed.text)
  check('one meta frame', parsed.frames.filter((f) => f.t === 'meta').length === 1, parsed.frames)
  check('no error frame', parsed.frames.every((f) => f.t !== 'error'), parsed.frames)
  check('done frame last', parsed.frames[parsed.frames.length - 1].t === 'done', parsed.frames)
  check('status 200', asked.status === 200)

  const message = calls[0].messages[0]
  check('one user message', calls[0].messages.length === 1 && message.role === 'user')
  check('text block shape', message.content[0].type === 'text' && typeof message.content[0].text === 'string')
  check('selection embedded', message.content[0].text.includes('sample phrase'))
  check('context embedded', message.content[0].text.includes('上文。'))
  check('system prompt forwarded', typeof calls[0].system === 'string' && calls[0].system.length > 0)
}

/* case 1b — the signed-in route fails, the configured default rescues the answer */
{
  console.log('\ncase 1b: deepseek-account fails -> deepseek-official answers')
  const { ctx, calls, routes } = buildHarness((provider) => {
    if (provider === 'deepseek-account') {
      return [{ type: 'finish', reason: { kind: 'error', failure: { message: 'no credential for this route', code: 'unauthenticated', status: 401 } } }]
    }
    return [
      { type: 'text-delta', index: 0, text: '回退路线也答完了。' },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
  })
  await mod.apply(ctx, undefined)

  const asked = makeRes()
  routes.get('/ext/subtopic/ask').handler(makeReq({ selection: 'sample phrase' }), asked.res)
  await asked.done
  const parsed = parseFrames(asked.body)

  check('two provider attempts in order', calls.length === 2 && calls[0].provider === 'deepseek-account' && calls[1].provider === 'deepseek-official', calls.map((c) => c.provider))
  check('fallback answer streamed', parsed.text === '回退路线也答完了。', parsed.text)
  check('meta frame per attempt', parsed.frames.filter((f) => f.t === 'meta').length === 2, parsed.frames)
  check('no error frame when a later route answers', parsed.frames.every((f) => f.t !== 'error'), parsed.frames)
  check('done frame last', parsed.frames[parsed.frames.length - 1].t === 'done', parsed.frames)
}

/* case 2 — every route fails: the real failure must reach the card */
{
  console.log('\ncase 2: all routes fail')
  const { ctx, calls, routes } = buildHarness(() => [
    { type: 'finish', reason: { kind: 'error', failure: { message: 'insufficient balance', code: 'quota', status: 402 } } },
  ])
  await mod.apply(ctx, undefined)

  const asked = makeRes()
  routes.get('/ext/subtopic/ask').handler(makeReq({ selection: 'x', context: '', turns: [] }), asked.res)
  await asked.done
  const parsed = parseFrames(asked.body)

  check('tried both routes', calls.length === 2, calls.map((c) => c.provider))
  const error = parsed.frames.find((f) => f.t === 'error')
  check('error frame emitted', Boolean(error), parsed.frames)
  check('failure text is the provider message', Boolean(error) && error.message.includes('insufficient balance'), error)
  check('failure keeps code and status', Boolean(error) && error.message.includes('[quota]') && error.message.includes('HTTP 402'), error)
  check('failure lists the attempted routes', Boolean(error) && error.message.includes('deepseek-official') && error.message.includes('deepseek-account'), error)
  check('still exactly one done frame', parsed.frames.filter((f) => f.t === 'done').length === 1, parsed.frames)
}

/* case 3 — a pinned provider wins and short-circuits the list */
{
  console.log('\ncase 3: pinned provider config')
  const { ctx, calls, routes } = buildHarness(() => [
    { type: 'text-delta', index: 0, text: 'hai' },
    { type: 'finish', reason: { kind: 'stop' } },
  ])
  await mod.apply(ctx, { provider: 'my-pinned-route', model: 'my-model' })

  const info = makeRes()
  routes.get('/ext/subtopic/info').handler(makeReq(undefined), info.res)
  const payload = JSON.parse(info.body)
  check('pinned route first', payload.routes[0] === 'my-pinned-route/my-model', payload.routes)
  check('fallbacks retained, pinned model reused', payload.routes.includes('deepseek-account/my-model'), payload.routes)

  const asked = makeRes()
  routes.get('/ext/subtopic/ask').handler(makeReq({ selection: 'x' }), asked.res)
  await asked.done
  check('only the pinned route called', calls.length === 1 && calls[0].provider === 'my-pinned-route', calls.map((c) => c.provider))
}

/* case 4 — missing selection is rejected before any model call */
{
  console.log('\ncase 4: empty selection')
  const { ctx, calls, routes } = buildHarness(() => [])
  await mod.apply(ctx, undefined)
  const asked = makeRes()
  routes.get('/ext/subtopic/ask').handler(makeReq({ selection: '   ' }), asked.res)
  await asked.done
  check('400 status', asked.status === 400, asked.status)
  check('no model call', calls.length === 0)
  check('json error body', JSON.parse(asked.body).ok === false, asked.body)
}

console.log(`\n${checks - failures}/${checks} host-route checks passed`)
if (failures) {
  console.log(`HOST ROUTES FAILED (${failures})`)
  process.exitCode = 1
} else {
  console.log('HOST ROUTES OK')
}
