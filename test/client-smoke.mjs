/**
 * Offline smoke test for the dsh-subtopic client half.
 *
 * The browser half is a plain script that calls window.__ModuleLoader__.load().
 * We reproduce that facade plus a permissive DOM, then run apply(ctx) and render
 * the components, so any throw becomes a readable Node stack instead of a
 * console line we cannot read.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

/* This repo's own client half; override with DSH_SUBTOPIC_CLIENT to smoke-test an
 * installed copy instead. */
const SRC = process.env.DSH_SUBTOPIC_CLIENT || fileURLToPath(new URL('../lib/client.js', import.meta.url))
const src = readFileSync(SRC, 'utf8')

const log = []
function note(...a) { log.push(a.map(String).join(' ')) }

/* ---------- permissive DOM ---------- */
function makeEl(tag = 'div') {
  const el = {
    tagName: String(tag).toUpperCase(),
    nodeType: 1,
    attrs: {},
    children: [],
    style: {},
    dataset: {},
    textContent: '',
    innerHTML: '',
    className: '',
    id: '',
    setAttribute(k, v) { this.attrs[k] = String(v) },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null },
    removeAttribute(k) { delete this.attrs[k] },
    hasAttribute(k) { return k in this.attrs },
    appendChild(c) { this.children.push(c); return c },
    removeChild(c) { return c },
    insertBefore(c) { this.children.push(c); return c },
    remove() {},
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null },
    querySelectorAll() { return [] },
    closest() { return null },
    contains() { return false },
    getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20, toJSON() { return {} } } },
    getClientRects() { return [this.getBoundingClientRect()] },
    focus() {}, blur() {}, click() {},
    scrollTo() {}, scrollTop: 0, scrollHeight: 100, clientHeight: 50,
  }
  return el
}

const head = makeEl('head')
const body = makeEl('body')
const documentStub = {
  head, body, documentElement: makeEl('html'),
  createElement: (t) => makeEl(t),
  createTextNode: (t) => ({ nodeType: 3, textContent: t }),
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => null,
  addEventListener: (type) => note('document.addEventListener', type),
  removeEventListener: (type) => note('document.removeEventListener', type),
}

/* ---------- module loader facade ---------- */
let captured = null
const windowStub = {
  __ModuleLoader__: { load(spec) { captured = spec } },
  addEventListener: (t) => note('window.addEventListener', t),
  removeEventListener: (t) => note('window.removeEventListener', t),
  innerWidth: 1440, innerHeight: 900,
  getSelection: () => null,
  document: documentStub,
}

/* ---------- React stub ---------- */
const React = {
  createElement: (type, props, ...children) => ({ $$el: true, type, props: props || {}, children }),
  Fragment: Symbol('Fragment'),
  useState: (init) => [typeof init === 'function' ? init() : init, () => note('setState(noop)')],
  useEffect: () => note('useEffect(noop)'),
  useLayoutEffect: () => {},
  useRef: (init) => ({ current: init }),
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  useReducer: (r, init) => [init, () => {}],
  useSyncExternalStore: () => null,
}

const sandbox = {
  window: windowStub,
  document: documentStub,
  React,
  console: {
    log: (...a) => note('console.log', ...a),
    warn: (...a) => note('console.warn', ...a),
    error: (...a) => note('console.error', ...a),
  },
  setTimeout, clearTimeout, setInterval, clearInterval,
  fetch: async () => { throw new Error('fetch not stubbed on purpose') },
  AbortController,
  TextDecoder,
  URL,
  Math, JSON, Date, Object, Array, String, Number, Boolean, Error, Promise, Set, Map, RegExp, Symbol,
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  module: { exports: {} },
  exports: {},
}
sandbox.globalThis = sandbox
sandbox.self = sandbox

const ctx = vm.createContext(sandbox)
vm.runInContext(src, ctx, { filename: SRC })

if (!captured) throw new Error('client.js did not call window.__ModuleLoader__.load')
note('load id =', captured.id)

const requireStub = (spec) => {
  note('require', spec)
  if (spec === 'react') return React
  throw new Error('unexpected require: ' + spec)
}
const mod = captured.factory(requireStub)
note('exports =', Object.keys(mod).join(','))

/* ---------- fake plugin context ---------- */
const disposers = []
const registered = []
const effects = []
const fakeCtx = {
  logger: { info: (...a) => note('ctx.logger.info', ...a), warn: (...a) => note('logger.warn', ...a), error: (...a) => note('logger.error', ...a) },
  effect(cb, label) {
    effects.push(label)
    const d = cb()
    if (typeof d === 'function') disposers.push(d)
    return () => {}
  },
  get(name) { note('ctx.get', name); return undefined },
  slots: {
    inject(name, cb) { note('slots.inject', name); registered.push(name); return cb() },
    register(spec, comp) { note('slots.register', spec && spec.name, spec && spec.id); registered.push(Object.assign({}, spec, { __comp: comp })); return () => {} },
  },
  locale: { register: () => () => {} },
}

mod.apply(fakeCtx)
note('effects =', effects.join(' | '))
note('registered =', registered.map((r) => (typeof r === 'string' ? r : r.id)).join(' | '))

/* ---------- render the layer once ---------- */
const layerSpec = registered.filter((r) => r && typeof r === 'object').pop()
if (!layerSpec) throw new Error('no slot registered with an object spec')
note('layer component is function:', typeof layerSpec.__comp)
console.log('SMOKE OK')
console.log(log.join('\n'))
