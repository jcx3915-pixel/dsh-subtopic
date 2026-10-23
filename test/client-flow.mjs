/**
 * Offline flow test for the dsh-subtopic client half.
 *
 * Drives the real code path with a stubbed DOM:
 *   select text -> selectionchange -> pill -> clean Ctrl tap -> card -> streamed answer
 *   select text *inside* a card -> child node (追问串联)
 *   stack bar -> tree panel -> row click reopens the card -> node delete
 * and then walks the rendered element tree to assert the Markdown renderer, the
 * stream framing and the tree all produced the right nodes.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

// 默认读本仓库自己的 lib/client.js，clone 下来即可跑；
// 要测别处的副本就设 DSH_SUBTOPIC_CLIENT=<绝对路径>。
const SRC = process.env.DSH_SUBTOPIC_CLIENT
  || fileURLToPath(new URL('../lib/client.js', import.meta.url))
const src = readFileSync(SRC, 'utf8')

const problems = []
function check(name, ok, extra) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${extra ? ' :: ' + extra : ''}`)
  if (!ok) problems.push(name + (extra ? ' :: ' + extra : ''))
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ---------------- DOM ---------------- */
const CONTEXT_TEXT = '第一行上下文。The sample shows a 1.76x speed gap because the sample phrase is static. 第三行。'

function matches(node, selector) {
  return String(selector)
    .split(',')
    .some((raw) => {
      const part = raw.trim()
      if (!part) return false
      if (part.startsWith('.')) return String(node.className || '').split(/\s+/).includes(part.slice(1))
      if (part.startsWith('[')) {
        const name = part.slice(1, -1).split('=')[0].trim()
        return typeof node.hasAttribute === 'function' ? node.hasAttribute(name) : false
      }
      return node.tagName === part.toUpperCase()
    })
}
function closest(selector) {
  let node = this
  while (node) {
    if (node.nodeType === 1 && matches(node, selector)) return node
    node = node.parentElement
  }
  return null
}

function el(tag, opts = {}) {
  const node = {
    tagName: String(tag).toUpperCase(),
    nodeType: 1,
    isConnected: true,
    attrs: {}, children: [], style: {}, dataset: {},
    textContent: '', innerText: opts.innerText || '', className: opts.className || '',
    parentElement: opts.parentElement || null,
    setAttribute(k, v) { this.attrs[k] = String(v) },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null },
    removeAttribute(k) { delete this.attrs[k] },
    hasAttribute(k) { return k in this.attrs },
    appendChild(c) {
      /* the real DOM moves an existing child to the end instead of duplicating it */
      const at = this.children.indexOf(c)
      if (at >= 0) this.children.splice(at, 1)
      c.parentElement = this
      this.children.push(c)
      return c
    },
    insertBefore(c) { c.parentElement = this; this.children.push(c); return c },
    removeChild(c) { return c },
    remove() {
      const parent = this.parentElement
      if (!parent || !Array.isArray(parent.children)) return
      const at = parent.children.indexOf(this)
      if (at >= 0) parent.children.splice(at, 1)
    },
    addEventListener() {}, removeEventListener() {},
    querySelector() { return null }, querySelectorAll() { return [] },
    closest,
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c) },
      remove(c) { this._set.delete(c) },
      contains(c) { return this._set.has(c) },
      toggle(c) { if (this._set.has(c)) this._set.delete(c); else this._set.add(c); return this._set.has(c) },
    },
    contains() { return false },
    focus() {}, blur() {}, click() {}, scrollTo() {}, scrollTop: 0,
    scrollHeight: 400, clientHeight: 200,
    getBoundingClientRect() { return rect(100, 100, 200, 20) },
    getClientRects() { return [rect(100, 100, 200, 20)] },
  }
  return node
}
function rect(x, y, w, h) {
  return { x, y, left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, toJSON() { return {} } }
}

const contextLeaf = el('span', { innerText: 'sample phrase' })
const contextP = el('p', { innerText: CONTEXT_TEXT })
const contextDiv = el('div', { innerText: CONTEXT_TEXT + '\n' + CONTEXT_TEXT })
contextLeaf.parentElement = contextP
contextP.parentElement = contextDiv

const SELECTED = 'sample phrase'

/* The live selection is swapped per scenario (chat text vs. text inside a card). */
let selState = { text: SELECTED, container: contextLeaf, box: rect(100, 100, 130, 20) }
const range = {
  collapsed: false,
  get commonAncestorContainer() { return selState.container },
  get startContainer() { return selState.container },
  get endContainer() { return selState.container },
  toString: () => selState.text,
  getClientRects: () => [selState.box],
  getBoundingClientRect: () => selState.box,
}
const selection = {
  isCollapsed: false,
  rangeCount: 1,
  toString: () => selState.text,
  getRangeAt: () => range,
  removeAllRanges() {},
}
function setSelection(next) { selState = Object.assign({}, selState, next) }

const head = el('head'), body = el('body')
const listeners = { document: new Map(), window: new Map() }
function record(scope) {
  return (type, fn) => {
    if (!listeners[scope].has(type)) listeners[scope].set(type, [])
    listeners[scope].get(type).push(fn)
  }
}
function fire(scope, type, event) {
  const fns = listeners[scope].get(type) || []
  for (const fn of fns) fn(event || {})
}

/* Enough of a selector engine for what the plugin asks the document: a plain
 * tag plus attribute filters, searched over <head> and <body>. Without it the
 * "already installed?" guards in the plugin always answer no, and a re-applied
 * effect would stack a second copy of the same sheet. */
function matchSelector(node, selector) {
  const m = String(selector).trim().match(/^([a-zA-Z]*)((?:\[[^\]]+\])*)$/)
  if (!m) return false
  const [, tag, attrs] = m
  if (tag && String(node.tagName || '').toLowerCase() !== tag.toLowerCase()) return false
  for (const part of attrs.match(/\[[^\]]+\]/g) || []) {
    const am = part.slice(1, -1).match(/^([^=]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?$/)
    if (!am) return false
    const name = am[1].trim()
    const want = am[2] !== undefined ? am[2] : am[3] !== undefined ? am[3] : am[4]
    const got = node.getAttribute(name)
    if (want === undefined ? got === null || got === undefined : String(got) !== want) return false
  }
  return true
}
function queryAll(selector) {
  const out = []
  const visit = (node) => {
    if (matchSelector(node, selector)) out.push(node)
    for (const kid of node.children || []) visit(kid)
  }
  visit(head)
  visit(body)
  return out
}

const documentStub = {
  head, body, documentElement: el('html'),
  createElement: (t) => el(t),
  createTextNode: (t) => ({ nodeType: 3, textContent: t }),
  querySelector: (sel) => queryAll(sel)[0] || null, querySelectorAll: (sel) => queryAll(sel), getElementById: (id) => head.children.find((c) => c.id === id || c.getAttribute('id') === id) || null,
  addEventListener: record('document'), removeEventListener() {},
  getSelection: () => selection,
}

/* ---------------- module loader facade ---------------- */
let captured = null
const memory = new Map()
const localStorageStub = {
  getItem: (k) => (memory.has(String(k)) ? memory.get(String(k)) : null),
  setItem: (k, v) => { memory.set(String(k), String(v)) },
  removeItem: (k) => { memory.delete(String(k)) },
  key: (i) => Array.from(memory.keys())[i],
  get length() { return memory.size },
}
const windowStub = {
  __ModuleLoader__: { load(spec) { captured = spec } },
  addEventListener: record('window'), removeEventListener() {},
  innerWidth: 1440, innerHeight: 900,
  localStorage: localStorageStub,
  setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  cancelAnimationFrame: () => {},
  getSelection: () => selection,
  document: documentStub,
}

/* ---------------- React stub ---------------- */
const hookLog = []
const React = {
  createElement: (type, props, ...children) => ({ $$el: true, type, props: props || {}, children }),
  Fragment: 'Fragment',
  useState: (init) => [typeof init === 'function' ? init() : init, (v) => hookLog.push(['setState', v])],
  useEffect: (fn) => { hookLog.push(['useEffect']) },
  useLayoutEffect: () => {},
  useRef: (init) => ({ current: init }),
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  useReducer: (r, init) => [init, () => {}],
  useSyncExternalStore: () => null,
}

/* ---------------- fetch stub: a real framed stream ---------------- */
const ANSWER_TEXT = '这是示例答案的第一段。\n\n' +
  '- 要点一：列表项甲\n' +
  '- 要点二：**加粗文字** 与正文\n\n' +
  '```js\nconst a = 1\n```\n\n' +
  '详情见 [文档](https://example.com/doc)。\n'
const FRAME_META = '\u0000{"t":"meta","provider":"deepseek-account","model":"deepseek-flash"}\n'
const FRAME_DONE = '\u0000{"t":"done"}\n'
const all = FRAME_META + ANSWER_TEXT + FRAME_DONE
const CHUNKS = []
for (let i = 0; i < all.length; i += 17) CHUNKS.push(all.slice(i, i + 17))

let fetchCalls = []
const askCalls = () => fetchCalls.filter((c) => String(c.url).indexOf('/ext/subtopic/ask') >= 0)
const clipboard = []
function responseFrom(chunks) {
  let i = 0
  return {
    ok: true, status: 200, headers: { get: () => 'text/plain' },
    body: {
      getReader() {
        return {
          async read() {
            await new Promise((r) => setTimeout(r, 1))
            if (i >= chunks.length) return { value: undefined, done: true }
            return { value: new TextEncoder().encode(chunks[i++]), done: false }
          },
          releaseLock() {}, cancel() {},
        }
      },
    },
  }
}

/* ---------------- sandbox ---------------- */
const sandbox = {
  window: windowStub, document: documentStub, React,
  console: { log: () => {}, warn: () => {}, error: (...a) => problems.push('console.error ' + a.join(' ')) },
  setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
  fetch: async (url, init) => { fetchCalls.push({ url, init }); return responseFrom(CHUNKS) },
  AbortController, TextDecoder, TextEncoder, URL, Promise, Math, JSON, Date, Object, Array, String,
  Number, Boolean, Error, Set, Map, RegExp, Symbol, Uint8Array,
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  navigator: { clipboard: { writeText: async (text) => { clipboard.push(String(text)) } } },
  /* Deliberately NO `module` / `exports`: the real client module system calls a
   * factory with `require` only (client-modules.client.js:683), so a factory that
   * leans on a CommonJS global must fail here exactly as it fails in the page. */
}
sandbox.globalThis = sandbox
sandbox.self = sandbox

const ctx = vm.createContext(sandbox)
vm.runInContext(src, ctx, { filename: SRC })
check('client.js registers a module', !!captured, captured && captured.id)

const React2 = React
const mod = captured.factory((spec) => {
  if (spec === 'react') return React2
  throw new Error('unexpected require: ' + spec)
})
check('exports apply+inject', typeof mod.apply === 'function' && Array.isArray(mod.inject), JSON.stringify(Object.keys(mod)))

/* ---------------- fake plugin ctx ---------------- */
let layerComp = null
let settingsComp = null
let settingsSpec = null
/* Runtime services the chip path asks for. The composer shell stands in for the real
 * SessionInputShell: `addFiles` is the app's own "insert a reference chip" primitive. */
const addFilesCalls = []
const pasteCalls = []
let addFilesResult = true
let focused = 0
let registeredSource = null
/* every ctx.effect() the plugin installs, kept so the suite can re-run one of
 * them (what a hot reload does to an already-styled document) */
const effectRuns = []
const shellStub = {
  addFiles(refs, ids) { addFilesCalls.push({ refs, ids }); return addFilesResult },
  paste(text) { pasteCalls.push(text); return true },
  focus() { focused += 1 },
}
const services = new Map()
services.set('uiWorkspace', { selection: { getSnapshot: () => ({ sessionId: 'sess-1' }) } })
services.set('conversation', { input: { shell: (id) => { if (id !== 'sess-1') throw new Error('conversation.input: session "' + id + '" resolved no binding'); return shellStub } } })
services.set('inputTriggers', { registerSource(src) { registeredSource = src; return () => { registeredSource = null } } })

const fakeCtx = {
  logger: { info: () => {}, warn: (...a) => problems.push('logger.warn ' + a.join(' ')), error: (...a) => problems.push('logger.error ' + a.join(' ')) },
  effect(cb, label) { effectRuns.push([label, cb]); const d = cb(); return () => { if (typeof d === 'function') d() } },
  get(name) { return services.get(name) },
  slots: {
    inject(name, cb) { cb() },
    register(spec, comp) { if (spec && spec.name === 'shell.overlay' && spec.id === 'dsh-subtopic-layer') layerComp = comp; if (spec && spec.name === 'settings.section') { settingsSpec = spec; settingsComp = comp } return () => {} },
  },
  locale: { register: () => () => {} },
}
mod.apply(fakeCtx)
check('apply registered the shell.overlay layer', typeof layerComp === 'function')
if (!layerComp) { console.log(problems.join('\n')); process.exit(1) }

/* ---------------- tree walk ---------------- */
function walk(node, out = [], seen = new Set()) {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (typeof node === 'string' || typeof node === 'number') { out.push({ kind: 'text', text: String(node) }); return out }
  if (Array.isArray(node)) { for (const n of node) walk(n, out, seen); return out }
  if (typeof node !== 'object') return out
  if (node.$$el) {
    let rendered
    if (typeof node.type === 'function') {
      rendered = node.type(Object.assign({}, node.props, { children: node.children }))
    } else {
      rendered = node.children
    }
    out.push({ kind: 'el', type: typeof node.type === 'function' ? node.type.name : node.type, props: node.props, children: node.children })
    walk(rendered, out, seen)
    return out
  }
  return out
}
function renderLayer() {
  hookLog.length = 0
  return walk(layerComp({}))
}
function texts(nodes) { return nodes.filter((n) => n.kind === 'text').map((n) => n.text).join('') }
function els(nodes, type) { return nodes.filter((n) => n.kind === 'el' && n.type === type) }
function byAction(nodes, action) {
  return nodes.filter((n) => n.kind === 'el' && n.props && n.props['data-subtopic-action'] === action)
}
function byClass(nodes, cls) {
  return nodes.filter((n) => n.kind === 'el' && String((n.props && n.props.className) || '').split(/\s+/).includes(cls))
}
function rows(nodes) { return nodes.filter((n) => n.kind === 'el' && n.props && typeof n.props['data-subtopic-row'] === 'string') }
function textOfSubtree(node, out = []) {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out }
  if (Array.isArray(node)) { for (const n of node) textOfSubtree(n, out); return out }
  if (typeof node !== 'object') return out
  if (node.$$el) {
    const rendered = typeof node.type === 'function' ? node.type(Object.assign({}, node.props, { children: node.children })) : node.children
    textOfSubtree(rendered, out)
  }
  return out
}

let tree = renderLayer()
check('no pill before any selection', !tree.some((n) => n.kind === 'el' && String(n.type).includes('Pill') && n.props && n.props.pill))
check('empty tree renders no panel and no handle', byClass(tree, 'dsh-subtopic-tree').length === 0 && byAction(tree, 'open-tree').length === 0)

/* ---------------- 1. selection -> pill ---------------- */
fire('document', 'selectionchange', {})
await sleep(260)
tree = renderLayer()
const pillNode = tree.find((n) => n.kind === 'el' && n.type === 'Pill')
check('selectionchange produced a pill', !!pillNode, pillNode ? JSON.stringify(pillNode.props && { ...pillNode.props, pill: undefined }) : '')
const pillText = texts(tree)
check('pill shows the Ctrl hint', /Ctrl/i.test(pillText), JSON.stringify(pillText.slice(0, 120)))

/* ---------------- 2. clean Ctrl tap -> card ---------------- */
fire('window', 'keydown', { key: 'Control', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false })
await sleep(40)
fire('window', 'keyup', { key: 'Control', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false })
await sleep(60)
check('Ctrl tap issued a request', askCalls().length === 1, JSON.stringify(fetchCalls.map((c) => c.url)))
if (askCalls()[0]) {
  const body = JSON.parse(askCalls()[0].init.body)
  check('request carries the selected text', body.selection === SELECTED, JSON.stringify(body.selection))
  check('request carries surrounding context', typeof body.context === 'string' && body.context.includes('1.76x speed gap'), JSON.stringify(String(body.context).slice(0, 80)))
  check('request carries the first turn', Array.isArray(body.turns) && body.turns.length === 1 && typeof body.turns[0].text === 'string', JSON.stringify(body.turns))
}

await sleep(400)
tree = renderLayer()
let cardText = texts(tree)
check('card renders the streamed answer', cardText.includes('这是示例答案'), JSON.stringify(cardText.slice(0, 200)))
check('meta frame used the real provider/model', /deepseek-flash/.test(cardText), JSON.stringify(cardText.slice(0, 200)))
check('control frame bytes never leak into the text', !cardText.includes('"t":"meta"') && !cardText.includes('"t":"done"') && !cardText.includes('\u0000'))
check('markdown: list items rendered', cardText.includes('要点一') && cardText.includes('要点二'))
const pre = els(tree, 'pre')
check('markdown: fenced code block rendered as <pre class=dsh-subtopic-pre>', pre.length === 1 && pre[0].props.className === 'dsh-subtopic-pre', JSON.stringify(pre.map((p) => p.props)))
const code = els(tree, 'code')
check('markdown: code wrapper carries the language tag', JSON.stringify(code.map((c) => c.props)) !== '[]', JSON.stringify(code.map((c) => c.props)))
check('markdown: code body preserved verbatim', cardText.includes('const a = 1') && cardText.includes('jsconst a = 1'), JSON.stringify(cardText.slice(cardText.indexOf('与正文'), cardText.indexOf('与正文') + 60)))
check('markdown: bold text present', cardText.includes('加粗文字'))

/* ---------------- 3. Ctrl+C does not open anything ---------------- */
let before = askCalls().length
fire('window', 'keydown', { key: 'Control', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false })
fire('window', 'keydown', { key: 'c', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false })
fire('window', 'keyup', { key: 'c', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false })
fire('window', 'keyup', { key: 'Control', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false })
await sleep(80)
check('Ctrl+C does NOT open another card', askCalls().length === before, 'ask calls=' + askCalls().length)

/* ---------------- 4. the card is a tree node ---------------- */
const rootRow = byClass(tree, 'dsh-subtopic-troot').length
const firstCardProps = els(tree, 'Card').map((c) => c.props.card)
const rootId = firstCardProps.length ? firstCardProps[0].id : null
check('the first card became a durable tree root', !!rootId && firstCardProps[0].parentId === null, JSON.stringify(rootId))
const stored = JSON.parse(localStorageStub.getItem('dsh-subtopic-tree') || 'null')
check('root is persisted', !!stored && Array.isArray(stored.nodes) && stored.nodes.length === 1 && stored.nodes[0].id === rootId, JSON.stringify(stored && stored.nodes && stored.nodes.map((n) => ({ id: n.id, parentId: n.parentId, status: n.status }))))
check('persisted node carries the answer', !!stored && /这是示例答案/.test(stored.nodes[0].answer || ''))

/* ---------------- 5. text selected inside a card -> child node ---------------- */
const parentSelection = '这是示例的追问选中文字'
const cardBody = el('div', { className: 'dsh-subtopic-body', innerText: parentSelection + ' —— 所以长上下文退化。' })
const bodyLeaf = el('span', { innerText: parentSelection })
bodyLeaf.parentElement = cardBody
const fakeCardEl = el('div', { className: 'dsh-subtopic-card' })
fakeCardEl.setAttribute('data-subtopic-node', rootId)
cardBody.parentElement = fakeCardEl

setSelection({ text: parentSelection, container: bodyLeaf, box: rect(320, 260, 150, 20) })
fire('document', 'selectionchange', {})
await sleep(260)
tree = renderLayer()
check('a selection inside a card still offers the pill', tree.some((n) => n.kind === 'el' && n.type === 'Pill'), JSON.stringify(texts(tree).slice(-60)))
before = askCalls().length
fire('window', 'keydown', { key: 'Control', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false })
await sleep(40)
fire('window', 'keyup', { key: 'Control', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false })
await sleep(500)
check('the in-card selection opened a second card', askCalls().length === before + 1, 'ask calls=' + askCalls().length)
const secondCall = askCalls()[askCalls().length - 1]
if (secondCall) {
  const body2 = JSON.parse(secondCall.init.body)
  check('the child request carries the inner selection', body2.selection === parentSelection, JSON.stringify(body2.selection))
}
tree = renderLayer()
const cards = els(tree, 'Card').map((c) => c.props.card)
const child = cards.find((c) => c.id !== rootId)
check('the new card is chained to its parent', !!child && child.parentId === rootId, JSON.stringify(cards.map((c) => ({ id: c.id, parentId: c.parentId }))))
check('the child card shows a breadcrumb back to the parent', byAction(tree, 'open-parent').length === 1, JSON.stringify(texts(tree).slice(-120)))
const childText = texts(tree)
check('the child card renders its own answer', childText.includes('这是示例答案'))

/* ---------------- 6. the tree panel ---------------- */
setSelection({ text: SELECTED, container: contextLeaf, box: rect(100, 100, 130, 20) })
fire('document', 'selectionchange', {})
await sleep(220)
const toggle = byAction(renderLayer(), 'toggle-tree')
check('the stack bar offers the tree toggle', toggle.length === 1, JSON.stringify(toggle.map((t) => t.props.className)))
tree = renderLayer()
check('the first subtopic ever auto-opened the panel', byClass(tree, 'dsh-subtopic-tree').length === 1)
const rootRows = rows(tree)
check('the tree shows both nodes', rootRows.length === 2, JSON.stringify(rootRows.map((r) => r.props['data-subtopic-row'])))
const kids = byClass(tree, 'dsh-subtopic-tkids')
check('the child hangs under its parent (串联)', kids.length === 1, JSON.stringify(kids.map((k) => k.props.className)))
check('the panel counts nodes and branches', /2 个 · 1 支/.test(texts(tree)), JSON.stringify(texts(tree).slice(0, 120)))
const handleWhenOpen = byAction(tree, 'open-tree')
check('no edge handle while the panel is open', handleWhenOpen.length === 0)
check('the toggle now offers to collapse', String(byAction(tree, 'toggle-tree')[0].children[0]) === '收起树状图', JSON.stringify(byAction(tree, 'toggle-tree')[0].children))
byAction(tree, 'toggle-tree')[0].props.onClick()
tree = renderLayer()
check('collapsing the panel leaves the edge handle', byClass(tree, 'dsh-subtopic-tree').length === 0 && byAction(tree, 'open-tree').length === 1)
byAction(tree, 'open-tree')[0].props.onClick()
tree = renderLayer()
check('the edge handle reopens the panel', byClass(tree, 'dsh-subtopic-tree').length === 1)
check('the panel head offers its own collapse control', byAction(tree, 'close-tree').length === 1 && String(byAction(tree, 'close-tree')[0].children[0]) === '收起 »', JSON.stringify(byAction(tree, 'close-tree').map((c) => c.children)))

/* ---------------- 7. Escape closes the top card, the node survives ---------------- */
fire('window', 'keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} })
await sleep(60)
tree = renderLayer()
check('Escape closed one card', els(tree, 'Card').length === 1, 'cards=' + els(tree, 'Card').length)
check('the closed card kept its tree node', rows(tree).length === 2)

/* ---------------- 8. clicking a row brings the card back ---------------- */
const childRow = rows(tree).find((r) => r.props['data-subtopic-row'] !== rootId)
const childId = childRow && childRow.props['data-subtopic-row']
childRow.props.onClick()
tree = renderLayer()
const reopened = els(tree, 'Card').map((c) => c.props.card).find((c) => c.id === childId)
check('clicking a tree row reopens that card', !!reopened, JSON.stringify(els(tree, 'Card').map((c) => c.props.card.id)))
check('the reopened card still has its answer', !!reopened && /这是示例答案/.test(reopened.answer))
check('the reopened card is focused', !!reopened && reopened.focus > 0)

/* ---------------- 9. a follow-up question stays in the same node ---------------- */
const cardsBeforeAsk = els(tree, 'Card').length
const childCard = els(tree, 'Card').map((c) => c.props.card).find((c) => c.id === childId)
check('the reopened card kept its parent link', !!childCard && childCard.parentId === rootId)
check('the card still offers its follow-up input', els(tree, 'input').some((i) => i.props.className === 'dsh-subtopic-input'))
before = askCalls().length
const chip = els(tree, 'button').find((b) => String(b.children[0] || '') === '展开讲讲')
chip.props.onClick()
await sleep(500)
check('a follow-up question issued one request', askCalls().length === before + 1, 'ask calls=' + askCalls().length)
tree = renderLayer()
check('a follow-up keeps one card (no new node)', els(tree, 'Card').length === cardsBeforeAsk, 'cards=' + els(tree, 'Card').length)
check('the followed-up node shows its round count', /2 轮/.test(texts(tree)), JSON.stringify(texts(tree).slice(0, 200)))

/* ---------------- 10. panel state round-trip ---------------- */
const ui = JSON.parse(localStorageStub.getItem('dsh-subtopic-ui') || 'null')
check('panel state is persisted', !!ui && ui.open === true && typeof ui.width === 'number' && ui.everOpened === true, JSON.stringify(ui))

/* ---------------- 11. delete a subtree ---------------- */
const beforeRows = rows(tree).length
const drop = byAction(tree, 'drop-node')
check('every row offers a delete action', drop.length === 2, 'drop buttons=' + drop.length)
drop[0].props.onClick({ stopPropagation() {} })
tree = renderLayer()
check('deleting the root removed the whole branch', rows(tree).length === beforeRows - 2, 'rows=' + rows(tree).length)
const stored2 = JSON.parse(localStorageStub.getItem('dsh-subtopic-tree') || 'null')
check('the delete is persisted', !!stored2 && stored2.nodes.length === 0, JSON.stringify(stored2 && stored2.nodes.length))
check('an empty tree shows no panel and no handle', byClass(tree, 'dsh-subtopic-tree').length === 0 && byAction(tree, 'open-tree').length === 0)

/* ---------------- 12. unrelated subtopics stand side by side (并联) ---------------- */
async function newRootSubtopic(text, container) {
  setSelection({ text, container, box: rect(120, 140, 160, 20) })
  fire('document', 'selectionchange', {})
  await sleep(240)
  before = askCalls().length
  fire('window', 'keydown', { key: 'Control', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false })
  await sleep(40)
  fire('window', 'keyup', { key: 'Control', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false })
  await sleep(420)
  const mine = els(renderLayer(), 'Card').map((c) => c.props.card)
  return mine[mine.length - 1]
}
const rootA = await newRootSubtopic('The sample shows', contextLeaf)
check('a fresh selection outside any card became its own root', !!rootA && rootA.parentId === null, JSON.stringify(rootA && { id: rootA.id, parentId: rootA.parentId }))
const rootB = await newRootSubtopic('speed gap', contextP)
check('a second unrelated subtopic is a second root', !!rootB && rootB.parentId === null && rootB.id !== rootA.id, JSON.stringify(rootB && { id: rootB.id, parentId: rootB.parentId }))
tree = renderLayer()
const rootRowsAll = byClass(tree, 'dsh-subtopic-troot')
check('both roots render as parallel roots (并联)', rootRowsAll.length === 2, JSON.stringify(rows(tree).map((r) => r.props['data-subtopic-row'])))
check('they are siblings, not a chain', byClass(tree, 'dsh-subtopic-tkids').length === 0)
check('the panel counts two branches', /2 个 · 2 支/.test(texts(tree)), JSON.stringify(texts(tree).slice(0, 90)))

/* nest one level deeper: 串联 at depth 3 */
const body3 = el('div', { className: 'dsh-subtopic-body', innerText: '深度三追问' })
const leaf3 = el('span', { innerText: '深度三追问' })
leaf3.parentElement = body3
const card3 = el('div', { className: 'dsh-subtopic-card' })
card3.setAttribute('data-subtopic-node', rootB.id)
body3.parentElement = card3
const grand = await newRootSubtopic('深度三追问', leaf3)
check('a selection inside the second card chains onto it', !!grand && grand.parentId === rootB.id, JSON.stringify(grand && { id: grand.id, parentId: grand.parentId }))
tree = renderLayer()
check('only the branching root gets a children container', byClass(tree, 'dsh-subtopic-tkids').length === 1, 'kids rows=' + byClass(tree, 'dsh-subtopic-tkids').length)
const kidBoxIndex = tree.findIndex((n) => n.kind === 'el' && String((n.props && n.props.className) || '') === 'dsh-subtopic-tkids')
const grandIndex = tree.findIndex((n) => n.kind === 'el' && n.props && n.props['data-subtopic-row'] === grand.id)
check('the grandchild row is nested under it (depth-first)', kidBoxIndex >= 0 && grandIndex > kidBoxIndex, `kids box @${kidBoxIndex}, grandchild @${grandIndex}`)
check('the branching root shows a collapse caret', byClass(tree, 'dsh-subtopic-tcaret').some((c) => String(c.children[0]) === '▼'), JSON.stringify(byClass(tree, 'dsh-subtopic-tcaret').map((c) => c.children)))
check('the panel now counts three nodes and two branches', /3 个 · 2 支/.test(texts(tree)), JSON.stringify(texts(tree).slice(0, 90)))

/* ---------------- 13. closing the panel: bar toggle, head button, Escape ---------------- */
const closeAll = els(tree, 'button').find((b) => String(b.children[0] || '') === '全部关闭')
closeAll.props.onClick()
await sleep(60)
tree = renderLayer()
check('全部关闭 closes every card', els(tree, 'Card').length === 0, 'cards=' + els(tree, 'Card').length)
check('the tree keeps its nodes while the panel is open', rows(tree).length === 3, 'rows=' + rows(tree).length)
fire('window', 'keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} })
tree = renderLayer()
check('Escape with no cards open collapses the panel', byClass(tree, 'dsh-subtopic-tree').length === 0 && byAction(tree, 'open-tree').length === 1)
check('the collapse is persisted', JSON.parse(localStorageStub.getItem('dsh-subtopic-ui') || 'null').open === false, localStorageStub.getItem('dsh-subtopic-ui'))

/* ---------------- 14. drag a tree row into the composer (and the ⧉ fallback) ---------------- */
byAction(renderLayer(), 'open-tree')[0].props.onClick()
tree = renderLayer()
const dragLabels = tree.filter((n) => n.kind === 'el' && n.props && typeof n.props['data-subtopic-drag'] === 'string')
check('every tree row exposes a draggable label', dragLabels.length === 3, 'labels=' + dragLabels.length)
const dragLabel = dragLabels[0].props
const draggedNodeId = dragLabel['data-subtopic-drag']
const transfers = []
dragLabel.onDragStart({ dataTransfer: { setData: (k, v) => transfers.push([k, v]), effectAllowed: '' } })
check('dragging a row offers the chip MIME and text/plain', transfers.length === 2 && transfers[0][0] === 'application/x-dsh-subtopic' && transfers[1][0] === 'text/plain', JSON.stringify(transfers.map((t) => t[0])))
check('the chip MIME names the dragged node', JSON.parse(transfers[0][1]).id === draggedNodeId, transfers[0][1])
const payload = transfers[1][1]
check('the payload carries the full selection, not the truncated label', payload.includes('The sample shows'), JSON.stringify(payload))
check('the payload is labelled as a subtopic quote', payload.indexOf('【子话题引用｜') === 0, JSON.stringify(payload.slice(0, 40)))
const dragEvent = { dataTransfer: { setData: () => {}, effectAllowed: '' } }
dragLabel.onDragStart(dragEvent)
check('the drag advertises itself as a copy', dragEvent.dataTransfer.effectAllowed === 'copy', JSON.stringify(dragEvent.dataTransfer.effectAllowed))
const copyButtons = byAction(tree, 'copy-node')
check('every tree row offers the copy fallback', copyButtons.length === 3, 'copy buttons=' + copyButtons.length)
copyButtons[0].props.onClick({ stopPropagation() {} })
await sleep(40)
check('the ⧉ fallback copies the very same payload', clipboard.length === 1 && clipboard[0] === payload, JSON.stringify(clipboard[0] || null).slice(0, 90))

/* ---------------- 15. the drop becomes a real composer chip ---------------- */
const CHIP_MIME = 'application/x-dsh-subtopic'
const composer = el('div', { className: 'dsh-composer' })
composer.setAttribute('data-composer-input', '')
const composerInner = el('span', { innerText: 'draft' })
composerInner.parentElement = composer
const outside = el('div', { className: 'dsh-conversation' })

function chipTransfer(id, text) {
  return {
    types: [CHIP_MIME, 'text/plain'],
    dropEffect: '',
    getData: (k) => (k === CHIP_MIME ? JSON.stringify({ id }) : text || ''),
  }
}
function fireDrag(type, target, transfer) {
  const event = {
    target, dataTransfer: transfer || chipTransfer(draggedNodeId, payload),
    defaultPrevented: false, stopped: false,
    preventDefault() { this.defaultPrevented = true },
    stopPropagation() { this.stopped = true },
  }
  fire('document', type, event)
  return event
}

const fileOver = fireDrag('dragover', composerInner, { types: ['Files'], dropEffect: '' })
check('a file drag over the composer is left alone', fileOver.defaultPrevented === false && body.classList.contains('dsh-subtopic-dragover') === false)
const textOver = fireDrag('dragover', composerInner, { types: ['text/plain'], dropEffect: '' })
check('a plain text drag is left alone too', textOver.defaultPrevented === false)
const chipOver = fireDrag('dragover', composerInner)
check('our row drag over the composer is accepted', chipOver.defaultPrevented === true && chipOver.dataTransfer.dropEffect === 'copy', JSON.stringify(chipOver.dataTransfer.dropEffect))
check('the composer is highlighted while the row hovers it', body.classList.contains('dsh-subtopic-dragover') === true)
const outsideOver = fireDrag('dragover', outside)
check('the same drag outside the composer is not accepted', outsideOver.defaultPrevented === false)

fire('document', 'dragend', {})
addFilesCalls.length = 0
const dropped = fireDrag('drop', composerInner)
check('the drop reaches the app composer instead of Lexical', dropped.defaultPrevented === true && dropped.stopped === true)
check('the drop inserts exactly one chip', addFilesCalls.length === 1 && addFilesCalls[0].refs.length === 1 && addFilesCalls[0].ids.length === 0, JSON.stringify(addFilesCalls.map((c) => c.refs.length)))
const chipRef = addFilesCalls[0].refs[0]
check('the chip is a subtopic reference carrying the node id', chipRef.source === 'subtopic' && chipRef.ref === draggedNodeId, JSON.stringify(chipRef))
check('the chip looks like an app reference (session glyph)', chipRef.appearance === 'session')
check('the chip shows a short label, not the whole quote', chipRef.label.length <= 43 && chipRef.clipboardText.indexOf(chipRef.label) > 0 && chipRef.clipboardText.length < 60, JSON.stringify(chipRef.clipboardText))

/* The chip must read as a small card, not the shell's plain blue text: the
   plugin ships its own rule for its own chips only. */
const styleTags = head.children.filter((c) => c.tagName === 'STYLE')
const styleText = styleTags.map((c) => c.textContent || '').join('\n')
check('the plugin injects its stylesheet', styleTags.length >= 1 && styleText.indexOf('dsh-subtopic-layer') > 0, String(styleTags.length))
check('our chips get a card look, scoped to the subtopic source', styleText.indexOf('span[data-composer-chip="subtopic"]') > 0 && styleText.indexOf('border-radius:7px') > 0)
check('the app\'s own @-references are left alone', styleText.indexOf('data-composer-chip="reference"') === -1)
check('the composer got focus after the insert', focused >= 1, 'focused=' + focused)
check('the drag hint is cleared after the drop', body.classList.contains('dsh-subtopic-dragover') === false)

/* the chip payload is recovered from the dataTransfer when the row drag already ended */
addFilesCalls.length = 0
const dropped2 = fireDrag('drop', composerInner, chipTransfer(draggedNodeId, ''))
check('a drop without the in-memory drag id still resolves the node', addFilesCalls.length === 1 && addFilesCalls[0].refs[0].ref === draggedNodeId, JSON.stringify(addFilesCalls.map((c) => c.refs[0] && c.refs[0].ref)))

/* a shell that refuses the insert falls back to plain text, never to nothing */
addFilesResult = false
pasteCalls.length = 0
const dropped3 = fireDrag('drop', composerInner)
check('a refused chip insert degrades to the plain payload', dropped3.defaultPrevented === true && pasteCalls.length === 1 && pasteCalls[0] === payload, JSON.stringify(pasteCalls[0] || null).slice(0, 60))
addFilesResult = true

/* no composer service at all: hand the drop back to the editor */
services.delete('conversation')
addFilesCalls.length = 0
pasteCalls.length = 0
const dropped4 = fireDrag('drop', composerInner)
check('without a shell the editor keeps the drop (no interception)', dropped4.defaultPrevented === false && addFilesCalls.length === 0 && pasteCalls.length === 0)
services.set('conversation', { input: { shell: (id) => { if (id !== 'sess-1') throw new Error('no binding'); return shellStub } } })

/* drop outside the composer changes nothing */
addFilesCalls.length = 0
const dropped5 = fireDrag('drop', outside)
check('a drop on the conversation body is ignored', dropped5.defaultPrevented === false && addFilesCalls.length === 0)

/* ---------------- 16. the @-menu source: model form, reopen, candidates ---------------- */
check('our reference source is registered on inputTriggers', !!registeredSource && registeredSource.trigger === '@' && registeredSource.name === 'subtopic', JSON.stringify(registeredSource && { trigger: registeredSource.trigger, name: registeredSource.name }))
check('the source is what the prompt serializer will find', typeof registeredSource.codec.serialize === 'function')
const serialized = await registeredSource.codec.serialize(draggedNodeId, undefined)
check('the model receives the full quote, not the chip label', serialized === payload, JSON.stringify(serialized).slice(0, 60))
check('codec.clipboardText stays short', registeredSource.codec.clipboardText(draggedNodeId).length < 60, registeredSource.codec.clipboardText(draggedNodeId))
const ghost = await registeredSource.codec.serialize('ghost-node', undefined)
check('an unknown node still serializes (a send never dead-ends)', typeof ghost === 'string' && ghost.length > 0, JSON.stringify(ghost))

const cardsBefore = els(renderLayer(), 'Card').length
const reopenedFromChip = registeredSource.openReference(null, { ref: draggedNodeId, appearance: 'session' })
const reopenedCards = els(renderLayer(), 'Card')
check('clicking the chip reopens that card', reopenedFromChip === true && reopenedCards.length === cardsBefore + 1, 'cards ' + cardsBefore + '->' + reopenedCards.length)
check('the reopened card is the referenced node', reopenedCards[reopenedCards.length - 1].props.card.id === draggedNodeId)
check('clicking a chip of a vanished node declines', registeredSource.openReference(null, { ref: 'ghost-node' }) === false)

const picked = registeredSource.onPick({ candidate: { value: JSON.stringify({ id: draggedNodeId }) } })
check('picking the @ entry yields the same chip reference', !!picked && picked.insert.source === 'subtopic' && picked.insert.ref === draggedNodeId, JSON.stringify(picked && picked.insert))
check('picking a stale entry yields nothing', registeredSource.onPick({ candidate: { value: JSON.stringify({ id: 'ghost-node' }) } }) === undefined)
check('a malformed candidate value is survivable', registeredSource.onPick({ candidate: { value: 'not json' } }) === undefined)

const candidates = await registeredSource.candidates(null, { query: '' })
check('the @ menu lists the tree rows', candidates.length === 3, 'candidates=' + candidates.length)
check('every entry carries a JSON value and a section', candidates.every((c) => c.section === '子话题' && typeof JSON.parse(c.value).id === 'string'))
const filtered = await registeredSource.candidates(null, { query: 'sample' })
check('the @ menu filters by what was typed', filtered.length >= 1 && filtered.length < candidates.length, 'filtered=' + filtered.length)
check('a query that matches nothing lists nothing', (await registeredSource.candidates(null, { query: 'zzz-nope' })).length === 0)

/* ---------------- 17. settings page: hotkey + card colour ---------------- */
check('a settings page is registered under 子话题', !!settingsSpec && settingsSpec.name === 'settings.section' && settingsSpec.id === 'subtopic', JSON.stringify(settingsSpec))
check('the settings page sorts ahead of the third-party pages', !!settingsSpec && settingsSpec.order === 90, String(settingsSpec && settingsSpec.order))
const accentTag = () => head.children.find((c) => c.id === 'dsh-subtopic-accent' || c.getAttribute('id') === 'dsh-subtopic-accent') || null
const accentText = () => String((accentTag() || {}).textContent || '')
check('no accent stylesheet while the colour follows the theme', accentTag() === null)

let setTree = walk(settingsComp({}))
const setText = texts(setTree)
check('the settings page names the current hotkey', setText.includes('弹出热键') && setText.includes('当前：Ctrl'), JSON.stringify(setText.slice(0, 140)))
const recordBtn = byAction(setTree, 'record-hotkey')
check('the recorder button shows the key to press', recordBtn.length === 1 && String(recordBtn[0].children[0]) === 'Ctrl', JSON.stringify(recordBtn.map((b) => b.children)))
check('auto plus every preset is offered as a swatch', byClass(setTree, 'dsh-subtopic-swatch').length === 9, 'swatches=' + byClass(setTree, 'dsh-subtopic-swatch').length)
check('auto is the selected swatch by default', byClass(setTree, 'dsh-subtopic-swatch').filter((n) => n.props['data-subtopic-accent'] === 'auto' && String(n.props.className).includes('is-on')).length === 1, JSON.stringify(byClass(setTree, 'dsh-subtopic-swatch').map((n) => [n.props['data-subtopic-accent'], n.props.className])))
check('the default hotkey offers no reset link', byAction(setTree, 'reset-hotkey').length === 0)
check('the settings page previews our own chip', setTree.some((n) => n.kind === 'el' && n.props && n.props['data-composer-chip'] === 'subtopic'))
check('the preview also mocks a card and its tree rows', byClass(setTree, 'dsh-subtopic-set-previewcard').length === 1 && byClass(setTree, 'dsh-subtopic-set-previewrow').length === 2)

const tealSwatch = byClass(setTree, 'dsh-subtopic-swatch').find((n) => n.props['data-subtopic-accent'] === '#0ea5a5')
tealSwatch.props.onClick()
const prefsStored = JSON.parse(localStorageStub.getItem('dsh-subtopic-prefs') || 'null')
check('picking a colour is persisted', !!prefsStored && prefsStored.accent === '#0ea5a5' && prefsStored.hotkey === 'Control', JSON.stringify(prefsStored))
check('the accent gets a stylesheet of its own', !!accentTag() && accentText().includes('#0ea5a5') && accentText().includes('rgba(14,165,165,0.18)'), accentText().slice(0, 120))
check('the accent is scoped to our chip and our classes', accentText().includes('span[data-composer-chip="subtopic"]') && accentText().includes('.dsh-subtopic-card'), accentText().slice(0, 120))
check('the accent tints the answer card surface', accentText().includes('.dsh-subtopic-card{background-image:linear-gradient(') && accentText().includes('rgba(14,165,165,0.22)'))
check('the accent tints the follow-up tree panel too', accentText().includes('.dsh-subtopic-tree{background-image:linear-gradient(') && accentText().includes('.dsh-subtopic-tree-foot{background-image'))
check('the accent tints the stack bar, the handle and the rows', accentText().includes('.dsh-subtopic-thandle{background-image') && accentText().includes('.dsh-subtopic-trow.is-active{background:rgba(14,165,165,0.26)'))
check('the accent never restyles the app-owned chip', accentText().indexOf('"reference"') === -1 && accentText().indexOf('.mxScHa') === -1)

setTree = walk(settingsComp({}))
check('the chosen swatch now reads as selected', byClass(setTree, 'dsh-subtopic-swatch').some((n) => n.props['data-subtopic-accent'] === '#0ea5a5' && String(n.props.className).includes('is-on')))
byClass(setTree, 'dsh-subtopic-swatch').find((n) => n.props['data-subtopic-accent'] === '#0ea5a5').props.onClick()
check('repainting reuses the one accent stylesheet', head.children.filter((c) => c.id === 'dsh-subtopic-accent').length === 1, 'tags=' + head.children.length)
check('the accent sheet wins the tie by being the last one in <head>', head.children[head.children.length - 1] === accentTag(), 'last=' + String((head.children[head.children.length - 1] || {}).id))

/* A hot reload re-runs the styles effect in a document that already has both
 * sheets: the base sheet then early-returns, and only re-appending the colour
 * sheet keeps it winning the equal-specificity tie. */
const stylesRun = effectRuns.find(([label]) => String(label).includes('styles'))
check('the styles effect is installed with a label', !!stylesRun, JSON.stringify(effectRuns.map(([l]) => l)))
if (stylesRun) {
  stylesRun[1]()
  const stylesheets = head.children.filter((c) => c.getAttribute('data-plugin-css'))
  check('a re-applied styles effect keeps the colour sheet last', head.children[head.children.length - 1] === accentTag(), 'last=' + String((head.children[head.children.length - 1] || {}).id))
  check('a re-applied styles effect does not duplicate sheets', stylesheets.length === 2, 'sheets=' + stylesheets.length + ' ' + JSON.stringify(stylesheets.map((c) => c.getAttribute('data-plugin-css'))))
}

const strayBefore = askCalls().length
fire('window', 'keydown', { key: 'Control', ctrlKey: true, preventDefault() {} })
fire('window', 'keydown', { key: 'Shift', shiftKey: true, preventDefault() {} })
fire('window', 'keyup', { key: 'Control', preventDefault() {} })
fire('window', 'keyup', { key: 'Shift', preventDefault() {} })
check('an extra modifier suppresses the hotkey', askCalls().length === strayBefore, 'ask calls=' + askCalls().length)
const cleanBefore = askCalls().length
fire('window', 'keydown', { key: 'Control', ctrlKey: true, preventDefault() {} })
fire('window', 'keyup', { key: 'Control', preventDefault() {} })
check('a clean tap still fires after a spoiled one', askCalls().length === cleanBefore + 1, 'ask calls=' + askCalls().length)

/* An IME composition owns the keyboard: while the candidate window is open a
 * bare Ctrl tap and even Escape belong to the input method, so neither may reach
 * the card shortcuts. DSH core enforces this at the document boundary
 * (InputBar's IME guard, issue #535); dsh-better-sidebar guards it the same way. */
const imeBefore = askCalls().length
const cardsBeforeIme = byClass(renderLayer(), 'dsh-subtopic-card').length
fire('window', 'keydown', { key: 'Control', ctrlKey: true, isComposing: true, preventDefault() {} })
fire('window', 'keyup', { key: 'Control', ctrlKey: true, isComposing: true, preventDefault() {} })
check('a Ctrl tap during IME composition opens nothing', askCalls().length === imeBefore, 'ask calls=' + askCalls().length)
fire('window', 'keydown', { key: 'Escape', keyCode: 229, preventDefault() {}, stopPropagation() {} })
check('Escape during IME composition closes nothing', byClass(renderLayer(), 'dsh-subtopic-card').length === cardsBeforeIme, 'cards=' + byClass(renderLayer(), 'dsh-subtopic-card').length)
fire('window', 'keydown', { key: 'Control', ctrlKey: true, preventDefault() {} })
fire('window', 'keyup', { key: 'Control', preventDefault() {} })
check('the hotkey still works right after a composition', askCalls().length === imeBefore + 1, 'ask calls=' + askCalls().length)

console.log('')
console.log(problems.length ? `FAILURES (${problems.length}):\n - ` + problems.join('\n - ') : 'ALL CLIENT-FLOW CHECKS PASSED')
process.exit(problems.length ? 1 : 0)
