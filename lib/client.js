/**
 * dsh-subtopic — client (browser) half.
 *
 * Loaded verbatim by the harness client module loader; there is no build step,
 * so this file must stay plain ES2020 + React.createElement (no JSX) and must
 * not import anything beyond `react`.
 *
 * Behaviour
 *   - Select text anywhere readable (chat messages, tool output, sidebar).
 *   - A small pill appears next to the selection.
 *   - Tap Ctrl (press and release without touching another key) — or click the
 *     pill — to open a floating "子话题" card that explains the selection.
 *   - Cards are independent, draggable, stackable, and support follow-ups.
 */
window.__ModuleLoader__.load({
  id: 'dsh-subtopic',
  factory: function (require) {
    'use strict'
    /* The client module system calls a factory with `require` only — there is no
     * CommonJS `module` object in the page — so the exports carrier is local. */
    const module = { exports: {} }

    /* -------------------------------------------------------------- telemetry
     * Failures only, into localStorage (`dsh-subtopic-errors`): the renderer has
     * no console we can read from outside, so a broken activation must leave a
     * trace. Never allowed to throw. */
    const ERR_KEY = 'dsh-subtopic-errors'
    function note(stage, detail) {
      try {
        const raw = window.localStorage.getItem(ERR_KEY)
        const list = raw ? JSON.parse(raw) : []
        list.push({
          t: new Date().toISOString(),
          stage: String(stage),
          detail: detail === undefined ? '' : String(detail).slice(0, 1200),
        })
        window.localStorage.setItem(ERR_KEY, JSON.stringify(list.slice(-20)))
      } catch (error) {
        /* telemetry must never break the plugin */
      }
    }
    try {
      window.addEventListener('error', (event) => {
        note('window-error', (event && (event.message || (event.error && event.error.stack))) || 'unknown')
      })
      window.addEventListener('unhandledrejection', (event) => {
        const reason = event && event.reason
        note('unhandled-rejection', (reason && (reason.stack || reason.message)) || String(reason))
      })
    } catch (error) {
      /* ignore */
    }

    const React = require('react')
    const h = React.createElement

    const STYLE_ID = 'dsh-subtopic-style'
    const INFO_URL = '/ext/subtopic/info'
    const ASK_URL = '/ext/subtopic/ask'
    const CARD_WIDTH = 404
    const FIRST_ASK = '请解释我选中的内容。'
    const TREE_KEY = 'dsh-subtopic-tree'
    const UI_KEY = 'dsh-subtopic-ui'
    const TREE_LIMIT = 80
    const ANSWER_LIMIT = 20000
    const TREE_MIN_WIDTH = 240
    /* Preferences (Settings → 子话题): the trigger key and the accent colour of
     * our own chips/cards. Stored separately from the tree so a preference reset
     * never touches the user's subtopics. */
    const PREFS_KEY = 'dsh-subtopic-prefs'
    const ACCENT_STYLE_ID = 'dsh-subtopic-accent'
    const HOTKEY_DEFAULT = 'Control'
    const MODIFIER_KEYS = ['Control', 'Alt', 'Shift', 'Meta']
    const HOTKEY_MAX_HOLD = 1200
    const ACCENT_PRESETS = ['', '#4d6bfe', '#7c5cff', '#06b6d4', '#0ea5a5', '#16a34a', '#f59e0b', '#ec4899', '#ef4444']
    /* The desktop shell runs with `titleBarStyle:'hidden'` + `titleBarOverlay:{height:40}`
     * on Windows, so the OS draws minimise/maximise/close over the top 40px of the
     * content area, top-right. Nothing we render there is clickable: keep our own
     * chrome (panel head, cards, pill) below that strip. Chromium exposes the real
     * height as `titlebar-area-height`; 40 is the shell's configured fallback. */
    const TOP_SAFE = 40

    /* ------------------------------------------------------------------ css */

    const CSS = `
.dsh-subtopic-layer{position:fixed;inset:0;pointer-events:none;z-index:9000;font-family:inherit;font-size:13px;line-height:1.62;color:var(--dsw-alias-label-primary,#1b1b1b)}
.dsh-subtopic-layer *{box-sizing:border-box}

.dsh-subtopic-pill{position:fixed;pointer-events:auto;display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.28));background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1,#fff));color:var(--dsw-alias-label-primary,#1b1b1b);font-size:12px;line-height:1.3;cursor:pointer;user-select:none;white-space:nowrap;box-shadow:0 6px 20px rgba(0,0,0,.16);transition:transform .12s ease,box-shadow .12s ease}
.dsh-subtopic-pill:hover{transform:translateY(-1px);box-shadow:0 10px 26px rgba(0,0,0,.2)}
.dsh-subtopic-kbd{display:inline-block;padding:1px 5px;border-radius:5px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-bottom-width:2px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.12));font-size:10.5px;font-weight:600;letter-spacing:.02em}

.dsh-subtopic-card{position:fixed;pointer-events:auto;display:flex;flex-direction:column;width:${CARD_WIDTH}px;max-width:calc(100vw - 24px);max-height:min(64vh,580px);border-radius:14px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.24));background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1,#fff));color:var(--dsw-alias-label-primary,#1b1b1b);box-shadow:0 18px 52px rgba(0,0,0,.22),0 2px 8px rgba(0,0,0,.08);overflow:hidden;animation:dsh-subtopic-in .16s cubic-bezier(.2,.9,.3,1.2)}
@keyframes dsh-subtopic-in{from{opacity:0;transform:translateY(6px) scale(.975)}to{opacity:1;transform:none}}

.dsh-subtopic-head{display:flex;align-items:center;gap:7px;padding:9px 8px 9px 12px;cursor:grab;user-select:none;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.16));flex:0 0 auto}
.dsh-subtopic-head:active{cursor:grabbing}
.dsh-subtopic-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-brand-primary,#4d6bfe);flex:0 0 auto}
.dsh-subtopic-title{font-size:12.5px;font-weight:600;letter-spacing:.02em}
.dsh-subtopic-model{margin-left:auto;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.85))}
.dsh-subtopic-x{border:0;background:transparent;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.85));width:22px;height:22px;border-radius:6px;font-size:15px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}
.dsh-subtopic-x:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.16));color:var(--dsw-alias-label-primary,#1b1b1b)}

.dsh-subtopic-quote{margin:10px 12px 0;padding:7px 10px;border-radius:9px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.09));border-left:3px solid var(--dsw-alias-brand-primary,#4d6bfe);color:var(--dsw-alias-label-secondary,rgba(128,128,128,.95));font-size:11.5px;line-height:1.55;white-space:pre-wrap;word-break:break-word;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;flex:0 0 auto;cursor:pointer}
.dsh-subtopic-quote.is-open{-webkit-line-clamp:unset;max-height:180px;overflow:auto}

.dsh-subtopic-body{flex:1 1 auto;min-height:52px;padding:10px 12px 12px;overflow:auto;overscroll-behavior:contain}
.dsh-subtopic-body::-webkit-scrollbar{width:8px;height:8px}
.dsh-subtopic-body::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2,rgba(128,128,128,.3));border-radius:8px}
.dsh-subtopic-body::-webkit-scrollbar-track{background:transparent}
.dsh-subtopic-p{margin:0 0 8px}
.dsh-subtopic-p:last-child{margin-bottom:0}
.dsh-subtopic-h{margin:10px 0 6px;font-size:13px;font-weight:600}
.dsh-subtopic-h:first-child{margin-top:0}
.dsh-subtopic-list{margin:0 0 8px;padding-left:19px}
.dsh-subtopic-list li{margin:2px 0}
.dsh-subtopic-code{padding:1px 5px;border-radius:5px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.15));font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
.dsh-subtopic-pre{position:relative;margin:0 0 8px;padding:9px 10px;border-radius:9px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.12));border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.16));overflow:auto;font-size:12px;line-height:1.55}
.dsh-subtopic-pre code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre}
.dsh-subtopic-pre-lang{position:absolute;top:5px;right:8px;font-size:10px;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.8))}
.dsh-subtopic-quote-block{margin:0 0 8px;padding:2px 0 2px 10px;border-left:2px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));color:var(--dsw-alias-label-secondary,rgba(128,128,128,.95))}
.dsh-subtopic-link{color:var(--dsw-alias-brand-primary,#4d6bfe);text-decoration:none;border-bottom:1px solid currentColor}
.dsh-subtopic-error{color:var(--dsw-alias-state-error-primary,#e5484d);white-space:pre-wrap;word-break:break-word}
.dsh-subtopic-warn{margin:0 0 8px;padding:6px 9px;border-radius:8px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.1));color:var(--dsw-alias-label-secondary,rgba(128,128,128,.95));font-size:11.5px}
.dsh-subtopic-thinking{display:inline-flex;align-items:center;gap:5px;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.85))}
.dsh-subtopic-thinking i{width:5px;height:5px;border-radius:50%;background:currentColor;display:inline-block;animation:dsh-subtopic-blink 1.05s infinite ease-in-out}
.dsh-subtopic-thinking i:nth-child(2){animation-delay:.16s}
.dsh-subtopic-thinking i:nth-child(3){animation-delay:.32s}
@keyframes dsh-subtopic-blink{0%,80%,100%{opacity:.28;transform:translateY(0)}40%{opacity:1;transform:translateY(-2px)}}
.dsh-subtopic-caret{display:inline-block;width:6px;height:13px;margin-left:1px;vertical-align:-2px;background:var(--dsw-alias-brand-primary,#4d6bfe);animation:dsh-subtopic-caret 1s steps(2,start) infinite}
@keyframes dsh-subtopic-caret{0%,50%{opacity:.85}50.01%,100%{opacity:0}}

.dsh-subtopic-chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:9px}
.dsh-subtopic-chip{border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.28));background:transparent;color:var(--dsw-alias-label-secondary,rgba(128,128,128,.95));font-size:11.5px;line-height:1;padding:5px 9px;border-radius:999px;cursor:pointer;font-family:inherit}
.dsh-subtopic-chip:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14));color:var(--dsw-alias-label-primary,#1b1b1b)}

.dsh-subtopic-foot{flex:0 0 auto;display:flex;align-items:center;gap:6px;padding:8px 10px;border-top:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.16));background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.05))}
.dsh-subtopic-input{flex:1 1 auto;min-width:0;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.28));background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.05));color:inherit;font-family:inherit;font-size:12.5px;padding:6px 9px;border-radius:8px;outline:none}
.dsh-subtopic-input:focus{border-color:var(--dsw-alias-brand-primary,#4d6bfe)}
.dsh-subtopic-input::placeholder{color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.75))}
.dsh-subtopic-btn{border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.28));background:transparent;color:var(--dsw-alias-label-secondary,rgba(128,128,128,.95));font-family:inherit;font-size:11.5px;padding:6px 9px;border-radius:8px;cursor:pointer;white-space:nowrap}
.dsh-subtopic-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14));color:var(--dsw-alias-label-primary,#1b1b1b)}
.dsh-subtopic-btn:disabled{opacity:.45;cursor:default}

.dsh-subtopic-bar{position:fixed;right:16px;bottom:16px;pointer-events:auto;display:flex;align-items:center;gap:8px;padding:6px 8px 6px 12px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.24));background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1,#fff));box-shadow:0 10px 30px rgba(0,0,0,.2);font-size:12px;color:var(--dsw-alias-label-secondary,rgba(128,128,128,.95))}
.dsh-subtopic-btn.is-on{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.16));color:var(--dsw-alias-label-primary,#1b1b1b)}

/* ---- subtopic tree ---- */
.dsh-subtopic-thandle{position:fixed;right:0;top:50%;transform:translateY(-50%);pointer-events:auto;writing-mode:vertical-rl;display:inline-flex;align-items:center;gap:6px;padding:11px 6px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.28));border-right:0;border-radius:10px 0 0 10px;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1,#fff));color:var(--dsw-alias-label-secondary,rgba(128,128,128,.95));font-family:inherit;font-size:11.5px;letter-spacing:.08em;cursor:pointer;box-shadow:-6px 0 20px rgba(0,0,0,.14)}
.dsh-subtopic-thandle:hover{color:var(--dsw-alias-label-primary,#1b1b1b)}
.dsh-subtopic-thandle-count{font-weight:700;color:var(--dsw-alias-brand-primary,#4d6bfe)}

.dsh-subtopic-tree{position:fixed;top:env(titlebar-area-height,${TOP_SAFE}px);right:0;bottom:0;z-index:9001;pointer-events:auto;display:flex;flex-direction:column;min-width:${TREE_MIN_WIDTH}px;max-width:72vw;border-left:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.24));background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1,#fff));box-shadow:-16px 0 44px rgba(0,0,0,.16);animation:dsh-subtopic-slide .16s ease}
@keyframes dsh-subtopic-slide{from{transform:translateX(14px);opacity:.35}to{transform:none;opacity:1}}
.dsh-subtopic-tree-resize{position:absolute;left:-3px;top:0;bottom:0;width:7px;cursor:col-resize}
.dsh-subtopic-tree-resize:hover{background:linear-gradient(90deg,transparent,var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.2)))}
.dsh-subtopic-tree-head{flex:0 0 auto;display:flex;align-items:center;gap:7px;padding:10px 10px 10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.16))}
.dsh-subtopic-tree-title{font-size:12.5px;font-weight:600;letter-spacing:.02em}
.dsh-subtopic-tree-count{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.85))}
.dsh-subtopic-tree-body{flex:1 1 auto;overflow:auto;overscroll-behavior:contain;padding:8px 8px 14px}
.dsh-subtopic-tree-body::-webkit-scrollbar{width:8px}
.dsh-subtopic-tree-body::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2,rgba(128,128,128,.3));border-radius:8px}
.dsh-subtopic-tree-empty{padding:16px 10px;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.9));font-size:11.5px;line-height:1.75}
.dsh-subtopic-tree-foot{flex:0 0 auto;padding:8px 10px;border-top:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.16));background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.05));color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.9));font-size:11px;line-height:1.55}

.dsh-subtopic-troot + .dsh-subtopic-troot{margin-top:8px}
.dsh-subtopic-tnode{position:relative}
.dsh-subtopic-tkids{margin-left:11px;padding-left:9px;border-left:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.32))}
.dsh-subtopic-tkids > .dsh-subtopic-tnode::before{content:'';position:absolute;left:-9px;top:15px;width:9px;border-top:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.32))}
.dsh-subtopic-trow{position:relative;display:flex;align-items:center;gap:6px;padding:5px 6px 5px 6px;border-radius:9px;cursor:pointer;color:var(--dsw-alias-label-secondary,rgba(128,128,128,.95))}
.dsh-subtopic-trow:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.13));color:var(--dsw-alias-label-primary,#1b1b1b)}
.dsh-subtopic-trow.is-active{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.1));color:var(--dsw-alias-label-primary,#1b1b1b);box-shadow:inset 2px 0 0 var(--dsw-alias-brand-primary,#4d6bfe)}
.dsh-subtopic-tcaret{flex:0 0 auto;width:14px;height:14px;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.9));font-size:9px;line-height:1;font-family:inherit;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.dsh-subtopic-tcaret.is-leaf{cursor:default;font-size:11px}
.dsh-subtopic-tdot{flex:0 0 auto;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-idle-primary,rgba(128,128,128,.6))}
.dsh-subtopic-trow.is-loading .dsh-subtopic-tdot{background:var(--dsw-alias-brand-primary,#4d6bfe);animation:dsh-subtopic-blink 1.05s infinite ease-in-out}
.dsh-subtopic-trow.is-error .dsh-subtopic-tdot{background:var(--dsw-alias-state-error-primary,#e5484d)}
.dsh-subtopic-trow.is-done .dsh-subtopic-tdot{background:var(--dsw-alias-state-success-primary,#3fb950)}
.dsh-subtopic-tlabel{flex:1 1 auto;min-width:0;font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:grab}
.dsh-subtopic-tlabel:active{cursor:grabbing}
.dsh-subtopic-dragover [data-composer-input]{outline:1.5px dashed var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:2px;border-radius:10px}
/* Our own reference chips read as a small card instead of the shell's plain
   blue text: the app's own rule is .mxScHa_reference (transparent background,
   colour only), so this selector carries one extra element to outrank it no
   matter which stylesheet lands first. Scoped by data-composer-chip="subtopic"
   so the app's own @-references keep their native look. */
span[data-composer-chip="subtopic"]{display:inline-flex;align-items:center;gap:2px;margin:0 2px;padding:1px 7px 1px 5px;border-radius:7px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.16));box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2,rgba(128,128,128,.32));color:var(--dsw-alias-label-primary,#1b1b1b);line-height:1.5;vertical-align:baseline}
span[data-composer-chip="subtopic"]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.26));box-shadow:inset 0 0 0 1px var(--dsw-alias-brand-primary,#4d6bfe)}
span[data-composer-chip="subtopic"] svg{color:var(--dsw-alias-brand-primary,#4d6bfe)}
.dsh-subtopic-tmeta{flex:0 0 auto;font-size:10px;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.8))}
.dsh-subtopic-tacts{flex:0 0 auto;display:none;align-items:center;gap:1px}
.dsh-subtopic-trow:hover .dsh-subtopic-tacts{display:inline-flex}
.dsh-subtopic-tacts button{border:0;background:transparent;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.9));font-family:inherit;font-size:12px;line-height:1;width:18px;height:18px;border-radius:5px;cursor:pointer;padding:0}
.dsh-subtopic-tacts button:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.2));color:var(--dsw-alias-label-primary,#1b1b1b)}

.dsh-subtopic-crumb{margin:8px 12px 0;padding:3px 9px;align-self:flex-start;max-width:calc(100% - 24px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:1px dashed var(--dsw-alias-border-l2,rgba(128,128,128,.4));border-radius:999px;background:transparent;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.95));font-family:inherit;font-size:10.5px;cursor:pointer;text-align:left}
.dsh-subtopic-crumb:hover{color:var(--dsw-alias-brand-primary,#4d6bfe);border-color:currentColor}
.dsh-subtopic-card.is-focus{box-shadow:0 0 0 2px var(--dsw-alias-brand-primary,#4d6bfe),0 18px 52px rgba(0,0,0,.24)}

/* Settings → 子话题. The page is rendered inside the app's own settings shell, so it
 * only styles its rows and reuses the layer's text colours. Layout mirrors the
 * shipped settings row recipe: label/description left, control right, hairline
 * separators, group in one rounded card. */
.dsh-subtopic-set{display:flex;flex-direction:column;gap:12px;font-family:inherit;color:var(--dsw-alias-label-primary,#1b1b1b)}
.dsh-subtopic-set-intro{margin:0;font-size:12.5px;line-height:1.6;color:var(--dsw-alias-label-secondary,rgba(128,128,128,.95))}
.dsh-subtopic-set-group{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.24));border-radius:16px;background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-2,rgba(128,128,128,.06)));overflow:hidden}
.dsh-subtopic-set-row{display:flex;align-items:center;gap:16px;padding:12px 14px}
.dsh-subtopic-set-row + .dsh-subtopic-set-row{border-top:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.16))}
.dsh-subtopic-set-lab{flex:1 1 auto;min-width:0}
.dsh-subtopic-set-title{font-size:13px;font-weight:600}
.dsh-subtopic-set-desc{margin-top:3px;font-size:11.5px;line-height:1.55;color:var(--dsw-alias-label-secondary,rgba(128,128,128,.95))}
.dsh-subtopic-set-ctl{flex:0 0 auto;display:flex;align-items:center;gap:8px}
.dsh-subtopic-set-note{margin:7px 2px 0;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.95))}
.dsh-subtopic-set-note.is-warn{color:var(--dsw-alias-state-warn-primary,#d97706)}
.dsh-subtopic-set-key{min-width:92px;justify-content:center;font-variant-numeric:tabular-nums}
.dsh-subtopic-set-swatches{display:flex;align-items:center;gap:6px}
.dsh-subtopic-swatch{width:22px;height:22px;padding:0;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.12));color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.95));font-family:inherit;font-size:9.5px;line-height:1;cursor:pointer}
.dsh-subtopic-swatch.is-on{box-shadow:0 0 0 2px var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1,#fff)),0 0 0 3.5px var(--dsw-alias-brand-primary,#4d6bfe)}
.dsh-subtopic-color{width:30px;height:24px;padding:0;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:7px;background:transparent;cursor:pointer}
.dsh-subtopic-link{border:0;background:transparent;padding:0;color:var(--dsw-alias-brand-primary,#4d6bfe);font-family:inherit;font-size:11.5px;cursor:pointer;text-decoration:underline}
.dsh-subtopic-set-preview{display:flex;align-items:stretch;gap:10px;padding:13px 14px;border:1px dashed var(--dsw-alias-border-l2,rgba(128,128,128,.3));border-radius:16px}
.dsh-subtopic-set-previewlab{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-tertiary,rgba(128,128,128,.95));flex:0 0 auto;max-width:105px}
.dsh-subtopic-set-previewcard{flex:1 1 auto;min-width:0;padding:8px 10px;border-radius:11px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.28));background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1,#fff));display:flex;flex-direction:column;gap:7px}
.dsh-subtopic-set-previewtitle{display:flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600}
.dsh-subtopic-set-previewbody{font-size:11px;line-height:1.55;color:var(--dsw-alias-label-secondary,rgba(128,128,128,.95))}
.dsh-subtopic-set-previewrow{display:flex;align-items:center;gap:6px;padding:4px 7px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.22));font-size:11px;color:var(--dsw-alias-label-secondary,rgba(128,128,128,.95));overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
`

    function installStyle() {
      if (document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`)) {
        /* already in this document (a re-apply, e.g. hot reload or a moved slot):
         * the base sheet is last right now, so push the colour sheet behind it */
        applyAccent()
        return () => {}
      }
      const style = document.createElement('style')
      style.setAttribute('data-plugin', 'dsh-subtopic')
      style.setAttribute('data-plugin-css', STYLE_ID)
      style.textContent = CSS
      document.head.appendChild(style)
      /* The user's colour sheet has to land after this one, otherwise its equal-
       * specificity rules lose the tie: on a cold boot `bootPrefs()` writes it
       * before the base sheet exists. Re-appending moves it to the end. */
      applyAccent()
      return () => {
        style.remove()
      }
    }

    /* ---------------------------------------------------------------- store */

    let zTop = 9100
    const nextZ = () => ++zTop

    const store = {
      cards: [],
      pill: null,
      info: null,
      busy: new Set(),
      listeners: new Set(),
      emit() {
        for (const listener of this.listeners) {
          try {
            listener()
          } catch {
            /* a broken subscriber must not stop the others */
          }
        }
      },
      subscribe(listener) {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
      },
      add(card) {
        this.cards = this.cards.concat([card])
        this.emit()
      },
      update(id, patch) {
        let changed = false
        this.cards = this.cards.map((card) => {
          if (card.id !== id) return card
          changed = true
          return Object.assign({}, card, patch)
        })
        if (changed) this.emit()
      },
      remove(id) {
        const before = this.cards.length
        this.cards = this.cards.filter((card) => card.id !== id)
        if (this.cards.length !== before) this.emit()
      },
      get(id) {
        return this.cards.find((card) => card.id === id) || null
      },
      top() {
        let top = null
        for (const card of this.cards) if (!top || card.z > top.z) top = card
        return top
      },
      setPill(pill) {
        const same =
          (!pill && !this.pill) ||
          (pill && this.pill && pill.selection === this.pill.selection && Math.abs(pill.x - this.pill.x) < 1 && Math.abs(pill.y - this.pill.y) < 1)
        if (same) return
        this.pill = pill
        this.emit()
      },

      /* --- subtopic tree: durable nodes, mirrored from the live cards --- */

      nodes: [],
      ui: { open: false, width: 320, collapsed: {}, everOpened: false },
      addNode(node) {
        this.nodes = this.nodes.concat([node])
        this.trimNodes()
        this.emit()
      },
      nodeOf(id) {
        return this.nodes.find((node) => node.id === id) || null
      },
      patchNode(id, patch) {
        let changed = false
        this.nodes = this.nodes.map((node) => {
          if (node.id !== id) return node
          changed = true
          return Object.assign({}, node, patch, { updatedAt: Date.now() })
        })
        if (changed) this.emit()
        return changed
      },
      childrenOf(id) {
        return this.nodes.filter((node) => node.parentId === id).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
      },
      roots() {
        const ids = new Set(this.nodes.map((node) => node.id))
        return this.nodes
          .filter((node) => !node.parentId || !ids.has(node.parentId))
          .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
      },
      subtree(id) {
        const out = [id]
        for (let i = 0; i < out.length; i += 1) {
          for (const kid of this.childrenOf(out[i])) out.push(kid.id)
        }
        return out
      },
      dropNode(id) {
        const doomed = new Set(this.subtree(id))
        this.nodes = this.nodes.filter((node) => !doomed.has(node.id))
        for (const gone of doomed) {
          const card = this.get(gone)
          if (card) this.remove(gone)
        }
        this.emit()
        return doomed
      },
      trimNodes() {
        while (this.nodes.length > TREE_LIMIT) {
          let oldest = null
          for (const node of this.nodes) if (!oldest || (node.createdAt || 0) < (oldest.createdAt || 0)) oldest = node
          if (!oldest) return
          /* keep the shape: the children of a dropped node hang off its parent */
          this.nodes = this.nodes
            .filter((node) => node.id !== oldest.id)
            .map((node) => (node.parentId === oldest.id ? Object.assign({}, node, { parentId: oldest.parentId || null }) : node))
        }
      },
      setUi(patch) {
        this.ui = Object.assign({}, this.ui, patch)
        saveUi()
        this.emit()
      },
      toggleCollapsed(id) {
        const collapsed = Object.assign({}, this.ui.collapsed)
        if (collapsed[id]) delete collapsed[id]
        else collapsed[id] = true
        this.setUi({ collapsed })
      },

      /* --- preferences: trigger key + accent colour (Settings → 子话题) --- */

      prefs: { v: 1, hotkey: HOTKEY_DEFAULT, accent: '' },
      setPrefs(patch) {
        const next = {
          v: 1,
          hotkey: normalizeHotkey(patch.hotkey === undefined ? this.prefs.hotkey : patch.hotkey) || HOTKEY_DEFAULT,
          accent: normalizeAccent(patch.accent === undefined ? this.prefs.accent : patch.accent),
        }
        if (next.hotkey === this.prefs.hotkey && next.accent === this.prefs.accent) return false
        this.prefs = next
        savePrefs()
        applyAccent()
        this.emit()
        return true
      },
    }

    /* ---------------------------------------------------------- persistence */

    function readJson(key, fallback) {
      try {
        const raw = window.localStorage.getItem(key)
        if (!raw) return fallback
        const value = JSON.parse(raw)
        return value === null || value === undefined ? fallback : value
      } catch (error) {
        return fallback
      }
    }

    function writeJson(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value))
        return true
      } catch (error) {
        return false
      }
    }

    let saveTimer = 0

    function trimNode(node) {
      const out = Object.assign({}, node)
      if (typeof out.answer === 'string' && out.answer.length > ANSWER_LIMIT) out.answer = out.answer.slice(0, ANSWER_LIMIT)
      if (Array.isArray(out.turns)) {
        out.turns = out.turns.map((turn) =>
          turn && typeof turn.text === 'string' && turn.text.length > ANSWER_LIMIT ? Object.assign({}, turn, { text: turn.text.slice(0, ANSWER_LIMIT) }) : turn,
        )
      }
      return out
    }

    function saveTree(now) {
      if (saveTimer) {
        window.clearTimeout(saveTimer)
        saveTimer = 0
      }
      const write = () => {
        saveTimer = 0
        writeJson(TREE_KEY, { v: 1, nodes: store.nodes.map(trimNode) })
      }
      if (now) write()
      else saveTimer = window.setTimeout(write, 700)
    }

    function normalizeNode(raw) {
      if (!raw || typeof raw.id !== 'string' || typeof raw.selection !== 'string') return null
      const busy = raw.status === 'loading' || raw.status === 'streaming'
      return {
        id: raw.id,
        parentId: typeof raw.parentId === 'string' && raw.parentId ? raw.parentId : null,
        selection: raw.selection,
        context: typeof raw.context === 'string' ? raw.context : '',
        label: typeof raw.label === 'string' && raw.label ? raw.label : nodeLabel(raw.selection),
        turns: Array.isArray(raw.turns) ? raw.turns.filter((turn) => turn && typeof turn.text === 'string') : [],
        answer: typeof raw.answer === 'string' ? raw.answer : '',
        status: busy ? (raw.answer ? 'done' : 'error') : typeof raw.status === 'string' ? raw.status : 'idle',
        error: typeof raw.error === 'string' ? raw.error : '',
        model: typeof raw.model === 'string' ? raw.model : '',
        provider: typeof raw.provider === 'string' ? raw.provider : '',
        createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
        updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
      }
    }

    function loadTree() {
      const payload = readJson(TREE_KEY, null)
      const list = payload && Array.isArray(payload.nodes) ? payload.nodes : []
      store.nodes = list.map(normalizeNode).filter(Boolean)
      store.emit()
      return store.nodes.length
    }

    function loadUi() {
      const ui = readJson(UI_KEY, null)
      if (!ui || typeof ui !== 'object') return
      const maxWidth = Math.max(TREE_MIN_WIDTH, (window.innerWidth || 1280) - 320)
      store.ui = {
        open: ui.open === true,
        width: typeof ui.width === 'number' ? Math.min(Math.max(TREE_MIN_WIDTH, ui.width), maxWidth) : 320,
        collapsed: ui.collapsed && typeof ui.collapsed === 'object' ? ui.collapsed : {},
        everOpened: ui.everOpened === true,
      }
    }

    function saveUi() {
      writeJson(UI_KEY, {
        v: 1,
        open: store.ui.open,
        width: store.ui.width,
        collapsed: store.ui.collapsed,
        everOpened: store.ui.everOpened === true,
      })
    }

    /* ------------------------------------------------------------ preferences */

    /* A hotkey is either a single modifier combination ("Control", "Control+Shift")
     * or one function key ("F2"). Plain letters are refused on purpose: a lone
     * letter would fire while the user is typing in the composer. */
    function normalizeHotkey(value) {
      if (typeof value !== 'string') return ''
      const parts = value.split('+').map((part) => part.trim()).filter(Boolean)
      const seen = []
      for (const part of parts) {
        if (MODIFIER_KEYS.indexOf(part) >= 0) {
          if (seen.indexOf(part) < 0) seen.push(part)
          continue
        }
        if (/^F([1-9]|1[0-2])$/.test(part)) return seen.length ? '' : part
        return ''
      }
      return MODIFIER_KEYS.filter((key) => seen.indexOf(key) >= 0).join('+')
    }

    function hotkeyParts(value) {
      const hot = normalizeHotkey(value === undefined ? store.prefs.hotkey : value)
      return hot ? hot.split('+') : []
    }

    function keyName(key) {
      if (key === 'Control') return 'Ctrl'
      if (key === 'Meta') return '⌘'
      return key
    }

    function hotkeyLabel(value) {
      const parts = hotkeyParts(value)
      return parts.length ? parts.map(keyName).join('+') : keyName(HOTKEY_DEFAULT)
    }

    function normalizeAccent(value) {
      if (typeof value !== 'string') return ''
      const trimmed = value.trim().toLowerCase()
      return /^#[0-9a-f]{6}$/.test(trimmed) ? trimmed : ''
    }

    function bootPrefs() {
      const raw = readJson(PREFS_KEY, null)
      store.prefs = {
        v: 1,
        hotkey: normalizeHotkey(raw && raw.hotkey) || HOTKEY_DEFAULT,
        accent: normalizeAccent(raw && raw.accent),
      }
      applyAccent()
    }

    function savePrefs() {
      writeJson(PREFS_KEY, { v: 1, hotkey: store.prefs.hotkey, accent: store.prefs.accent })
    }

    function tintOf(hex, alpha) {
      const value = parseInt(hex.slice(1), 16)
      return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`
    }

    /* The user's colour rides its own stylesheet so a change is one textContent
     * write: no re-render of the layer, no reactivation of the base sheet. Rules
     * repeat the element name (`span[...]`) to keep the same specificity as the
     * card rule in CSS and win by document order. Everything is scoped to our own
     * chip source and to our own classes — the app's @-references keep their look.
     *
     * Surfaces get a translucent gradient layer *over* the theme's own fill rather
     * than a solid colour: the theme keeps deciding how light the base is (so text
     * contrast survives in both light and dark), and the accent only dresses it. */
    function accentCss() {
      const accent = store.prefs.accent
      if (!accent) return ''
      const tint = (alpha) => tintOf(accent, alpha)
      return [
        /* the reference chip that gets dropped into the composer */
        `span[data-composer-chip="subtopic"]{background:${tint(0.18)};box-shadow:inset 0 0 0 1px ${tint(0.55)}}`,
        `span[data-composer-chip="subtopic"]:hover{background:${tint(0.3)}}`,
        `span[data-composer-chip="subtopic"] svg{color:${accent}}`,
        /* the floating answer card */
        `.dsh-subtopic-card{background-image:linear-gradient(${tint(0.22)},${tint(0.22)});border-color:${tint(0.6)}}`,
        `.dsh-subtopic-card.is-focus{box-shadow:0 0 0 2px ${accent},0 18px 52px rgba(0,0,0,.24)}`,
        `.dsh-subtopic-head{border-bottom-color:${tint(0.45)}}`,
        `.dsh-subtopic-quote{background-image:linear-gradient(${tint(0.16)},${tint(0.16)});border-left-color:${accent}}`,
        `.dsh-subtopic-foot{background-image:linear-gradient(${tint(0.12)},${tint(0.12)});border-top-color:${tint(0.35)}}`,
        `.dsh-subtopic-input:focus{border-color:${accent}}`,
        `.dsh-subtopic-dot{background:${accent}}`,
        `.dsh-subtopic-crumb:hover{color:${accent}}`,
        /* the follow-up tree panel */
        `.dsh-subtopic-tree{background-image:linear-gradient(${tint(0.16)},${tint(0.16)});border-left-color:${tint(0.5)}}`,
        `.dsh-subtopic-tree-head{border-bottom-color:${tint(0.4)}}`,
        `.dsh-subtopic-tree-foot{background-image:linear-gradient(${tint(0.12)},${tint(0.12)});border-top-color:${tint(0.35)}}`,
        `.dsh-subtopic-thandle{background-image:linear-gradient(${tint(0.16)},${tint(0.16)});border-color:${tint(0.5)}}`,
        `.dsh-subtopic-thandle-count{color:${accent}}`,
        `.dsh-subtopic-tkids{border-left-color:${tint(0.42)}}`,
        `.dsh-subtopic-tkids > .dsh-subtopic-tnode::before{border-top-color:${tint(0.42)}}`,
        `.dsh-subtopic-trow:hover{background:${tint(0.16)}}`,
        `.dsh-subtopic-trow.is-active{background:${tint(0.26)};box-shadow:inset 2px 0 0 ${accent}}`,
        /* the stack bar and the keyboard hint */
        `.dsh-subtopic-bar{border-color:${tint(0.4)}}`,
        `.dsh-subtopic-pill{border-color:${tint(0.5)}}`,
        `.dsh-subtopic-kbd{color:${accent};border-color:${tint(0.4)}}`,
        /* the settings page preview wears the same surfaces, so the picker shows
         * its result without a round trip to a real card */
        `.dsh-subtopic-set-previewcard{background-image:linear-gradient(${tint(0.22)},${tint(0.22)});border-color:${tint(0.6)}}`,
        `.dsh-subtopic-set-previewrow{background-image:linear-gradient(${tint(0.16)},${tint(0.16)});border-color:${tint(0.5)}}`,
      ].join('\n')
    }

    function applyAccent() {
      let style = document.getElementById(ACCENT_STYLE_ID)
      const css = store.prefs.accent ? accentCss() : ''
      if (!css) {
        if (style) style.remove()
        return
      }
      if (!style) {
        style = document.createElement('style')
        style.id = ACCENT_STYLE_ID
        style.setAttribute('data-plugin', 'dsh-subtopic')
        style.setAttribute('data-plugin-css', ACCENT_STYLE_ID)
      }
      /* Always re-append: this sheet ties on specificity with the base one, so it
       * has to be the last <style> in <head> to win — including on a cold boot
       * where it is written before the base sheet even exists. */
      document.head.appendChild(style)
      style.textContent = css
    }

    /* ---------------------------------------------------------- tree helpers */

    function nodeLabel(text) {
      const flat = String(text || '')
        .replace(/\s+/g, ' ')
        .trim()
      return flat.length > 42 ? flat.slice(0, 42) + '…' : flat || '(空选区)'
    }

    function clockOf(ms) {
      const date = new Date(ms || Date.now())
      const pad = (value) => String(value).padStart(2, '0')
      return `${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    /* Dragging a tree row into the conversation composer. Two channels go on the
     * dataTransfer: a custom MIME that identifies which subtopic is being dropped,
     * and plain text as the fallback for every drop target that ignores it.
     *
     * The drop turns into a real composer chip — the same kind of card the app makes
     * for its own @-references — through the app's own insert primitive
     * (`shell.addFiles([ref])`). A chip stays small in the input box because it only
     * renders a short label, while the prompt serializer replaces it at send time with
     * whatever our reference source's `codec.serialize`/`codec.clipboardText` return,
     * so the assistant still receives the complete quote. */
    const DRAG_LIMIT = 1500
    const CHIP_MIME = 'application/x-dsh-subtopic'
    const CHIP_SOURCE = 'subtopic'
    const CHIP_LIMIT = 42
    const QUOTE_STORE = 'dsh-subtopic-quotes'
    const QUOTE_LIMIT = 40
    const HINT_CLASS = 'dsh-subtopic-dragover'

    function dragPayload(node) {
      const label = (node && node.label) || '(空选区)'
      let body = String((node && node.selection) || '').replace(/[ \t]+$/gm, '').trim()
      if (body.length > DRAG_LIMIT) body = body.slice(0, DRAG_LIMIT) + '…'
      return `【子话题引用｜${label}】\n${body || label}`
    }

    function shortLabelOf(node) {
      const label = ((node && node.label) || '(空选区)').replace(/\s+/g, ' ').trim()
      return label.length > CHIP_LIMIT ? label.slice(0, CHIP_LIMIT) + '…' : label
    }

    /* Quotes are remembered per node id: the composer serializes a chip's model form
     * when the message is sent, which can happen long after the row was dragged — or
     * after the node was pruned from the tree. Send-time serialization must never
     * dead-end, so keep the last quotes around. */
    function loadQuotes() {
      try {
        const raw = window.localStorage.getItem(QUOTE_STORE)
        const data = raw ? JSON.parse(raw) : null
        return data && typeof data === 'object' ? data : {}
      } catch (error) {
        note('quotes-read', error)
        return {}
      }
    }

    function rememberQuote(node) {
      if (!node || !node.id) return
      try {
        const all = loadQuotes()
        all[node.id] = { label: shortLabelOf(node), text: dragPayload(node), at: Date.now() }
        const kept = {}
        Object.keys(all)
          .sort((a, b) => (all[b].at || 0) - (all[a].at || 0))
          .slice(0, QUOTE_LIMIT)
          .forEach((id) => {
            kept[id] = all[id]
          })
        window.localStorage.setItem(QUOTE_STORE, JSON.stringify(kept))
      } catch (error) {
        note('quotes-write', error)
      }
    }

    /** What the model receives in place of the chip. */
    function modelTextOf(ref) {
      const node = store.nodeOf(ref)
      if (node) return dragPayload(node)
      const saved = loadQuotes()[ref]
      if (saved && saved.text) return saved.text
      return `【子话题引用｜${ref}】\n(这段子话题引用已不在树里)`
    }

    /** The composer chip: short label on screen, full quote to the model. */
    function chipRefOf(node) {
      const label = shortLabelOf(node)
      return {
        source: CHIP_SOURCE,
        ref: node.id,
        label,
        appearance: 'session',
        clipboardText: `【子话题｜${label}】`,
      }
    }

    /** The composer facade (SessionInputShell) that owns chip insertion, or null. */
    function inputShell(ctx) {
      try {
        const workspace = ctx.get('uiWorkspace')
        const snapshot =
          workspace && workspace.selection && workspace.selection.getSnapshot ? workspace.selection.getSnapshot() : null
        const id =
          (snapshot && snapshot.sessionId) ||
          (workspace && workspace.mainReference && workspace.mainReference.sessionId) ||
          ''
        if (!id) return null
        const conversation = ctx.get('conversation')
        const hub = conversation && conversation.input
        if (!hub || typeof hub.shell !== 'function') return null
        const shell = hub.shell(id)
        return shell && typeof shell.addFiles === 'function' ? shell : null
      } catch (error) {
        note('chip-shell', error)
        return null
      }
    }

    function insertChipInto(shell, node) {
      try {
        const okay = shell.addFiles([chipRefOf(node)], []) === true
        if (okay) {
          try {
            if (typeof shell.focus === 'function') shell.focus()
          } catch (error) {
            /* focusing is a nicety */
          }
        }
        return okay
      } catch (error) {
        note('chip-insert', error)
        return false
      }
    }

    /** Our reference source: it makes the chip official (that is what resolves
     * `serializeReference` at send time) and adds an @-menu entry per tree row. */
    function triggerSource() {
      return {
        trigger: '@',
        name: CHIP_SOURCE,
        order: 20,
        showGroupTitle: false,
        async candidates(_session, req) {
          const query = String((req && req.query) || '').trim().toLowerCase()
          const rows = store.nodes.slice().sort((a, b) => (b.at || 0) - (a.at || 0))
          const hit = query
            ? rows.filter((node) => `${node.label || ''} ${node.selection || ''}`.toLowerCase().includes(query))
            : rows
          return hit.slice(0, 30).map((node) => ({
            name: shortLabelOf(node),
            description: '插入这条子话题引用',
            icon: 'session',
            section: '子话题',
            value: JSON.stringify({ id: node.id }),
          }))
        },
        onPick({ candidate }) {
          let id = ''
          try {
            id = String((JSON.parse(candidate.value) || {}).id || '')
          } catch (error) {
            note('trigger-pick', error)
          }
          const node = id ? store.nodeOf(id) : null
          if (!node) return undefined
          rememberQuote(node)
          return { insert: chipRefOf(node) }
        },
        /** Clicking the chip in the composer reopens that card. */
        openReference(_session, reference) {
          const ref = reference && reference.ref
          if (!ref || !store.nodeOf(ref)) return false
          openNode(ref)
          return true
        },
        codec: {
          clipboardText: (ref) => `【子话题｜${(store.nodeOf(ref) || {}).label || ref}】`,
          serialize: (ref) => Promise.resolve(modelTextOf(ref)),
        },
      }
    }

    /** `inputTriggers` is real but not in the inspected service catalogue, and it may
     * not exist yet when our apply() runs — keep asking instead of losing the source. */
    function installTriggerSource(ctx) {
      let off = null
      let timer = 0
      let tries = 0
      const stop = () => {
        if (timer) {
          window.clearTimeout(timer)
          timer = 0
        }
        if (off) {
          try {
            off()
          } catch (error) {
            note('trigger-off', error)
          }
          off = null
        }
      }
      const attempt = () => {
        timer = 0
        let service = null
        try {
          service = ctx.get('inputTriggers')
        } catch (error) {
          note('trigger-get', error)
        }
        if (service && typeof service.registerSource === 'function') {
          try {
            off = service.registerSource(triggerSource())
          } catch (error) {
            note('trigger-register', error)
          }
          return
        }
        tries += 1
        if (tries < 12) timer = window.setTimeout(attempt, 500)
      }
      attempt()
      return stop
    }

    /** Document-level drop of a tree row. Only a row drag (our MIME) is touched, and
     * only over the composer, so files and ordinary text drags keep their behaviour. */
    let dragNodeId = ''

    function installChipDrop(ctx) {
      const hasMime = (event) => {
        const types = (event.dataTransfer && event.dataTransfer.types) || null
        if (!types) return false
        for (let i = 0; i < types.length; i += 1) if (types[i] === CHIP_MIME) return true
        return false
      }
      const composerAt = (target) => {
        const el = target && target.nodeType === 1 ? target : (target && target.parentElement) || null
        if (!el) return null
        if (el.closest) {
          const direct = el.closest('[data-composer-input]')
          if (direct) return direct
        }
        for (let cur = el; cur && cur.querySelector; cur = cur.parentElement) {
          const found = cur.querySelector('[data-composer-input]')
          if (found) return found
        }
        return null
      }
      const hint = (on) => {
        try {
          document.body.classList[on ? 'add' : 'remove'](HINT_CLASS)
        } catch (error) {
          /* nothing to hint on */
        }
      }
      const onOver = (event) => {
        if (!hasMime(event)) return
        const inside = composerAt(event.target)
        hint(Boolean(inside))
        if (!inside) return
        event.preventDefault()
        try {
          event.dataTransfer.dropEffect = 'copy'
        } catch (error) {
          /* read-only transfer */
        }
      }
      const onDrop = (event) => {
        if (!hasMime(event)) return
        hint(false)
        if (!composerAt(event.target)) return
        const id = dragNodeId || readDraggedId(event)
        const node = id ? store.nodeOf(id) : null
        const shell = inputShell(ctx)
        if (!node || !shell) return
        event.preventDefault()
        event.stopPropagation()
        rememberQuote(node)
        if (!insertChipInto(shell, node)) {
          try {
            shell.paste(dragPayload(node))
          } catch (error) {
            note('drop-paste', error)
          }
        }
        dragNodeId = ''
      }
      const onEnd = () => {
        dragNodeId = ''
        hint(false)
      }
      document.addEventListener('dragover', onOver, true)
      document.addEventListener('drop', onDrop, true)
      document.addEventListener('dragend', onEnd, true)
      return () => {
        document.removeEventListener('dragover', onOver, true)
        document.removeEventListener('drop', onDrop, true)
        document.removeEventListener('dragend', onEnd, true)
        hint(false)
      }
    }

    function readDraggedId(event) {
      try {
        return String((JSON.parse(event.dataTransfer.getData(CHIP_MIME)) || {}).id || '')
      } catch (error) {
        return ''
      }
    }

    async function writeClipboard(text) {
      try {
        await navigator.clipboard.writeText(text)
        return true
      } catch (error) {
        note('clipboard', error)
        return false
      }
    }

    /** Update the live card and its durable node in one step. */
    function sync(id, patch, persist) {
      store.update(id, patch)
      store.patchNode(id, patch)
      if (persist) saveTree(persist === 'now')
    }

    /** A card that stops mid-flight (closed or aborted) must not stay "busy". */
    function settle(id) {
      const node = store.nodeOf(id)
      if (!node) return
      if (node.status === 'loading' || node.status === 'streaming') {
        const answer = node.answer || ''
        sync(id, { status: answer ? 'done' : 'error', error: answer ? '' : node.error || '已停止生成' }, true)
      }
    }

    /** Where a card opened from the tree lands: a cascade clear of the panel. */
    function cardSlot(index) {
      const reserved = (store.ui.open ? store.ui.width : 0) + 16
      const width = Math.min(CARD_WIDTH, Math.max(280, (window.innerWidth || 1280) - reserved - 24))
      const x = Math.max(12, (window.innerWidth || 1280) - reserved - width - (index % 4) * 20)
      const y = 76 + (index % 6) * 28
      return { x, y }
    }

    function flash(id) {
      if (store.get(id)) store.update(id, { focus: Date.now() })
    }

    /** Open (or re-focus) the card that belongs to a tree node. */
    function openNode(id) {
      const node = store.nodeOf(id)
      if (!node) return null
      if (store.get(id)) {
        bringToFront(id)
        flash(id)
        return id
      }
      const slot = cardSlot(store.cards.length)
      const answer = node.answer || ''
      store.add({
        id: node.id,
        parentId: node.parentId || null,
        selection: node.selection,
        context: node.context || '',
        x: slot.x,
        y: slot.y,
        z: nextZ(),
        model: node.model || '',
        provider: node.provider || '',
        turns: node.turns && node.turns.length ? node.turns : [{ role: 'user', text: FIRST_ASK }],
        answer,
        status: answer ? 'done' : 'error',
        error: answer ? '' : node.error || '这条子话题还没有解答，点「重答」重新生成。',
        expanded: false,
        focus: Date.now(),
      })
      return id
    }

    function dropNode(id) {
      const doomed = store.dropNode(id)
      for (const gone of doomed) {
        const controller = aborts.get(gone)
        if (controller) controller.abort()
        aborts.delete(gone)
        store.busy.delete(gone)
      }
      saveTree(true)
      return doomed
    }

    /* ------------------------------------------------------------ selection */

    function isEditable(el) {
      if (!el || !el.closest) return false
      const hit = el.closest('input, textarea, [contenteditable]')
      if (!hit) return false
      if (hit.tagName === 'INPUT' || hit.tagName === 'TEXTAREA') return true
      return hit.getAttribute('contenteditable') !== 'false'
    }

    function extractContext(range, text) {
      let el = range.commonAncestorContainer
      if (el && el.nodeType !== 1) el = el.parentElement
      let best = ''
      let depth = 0
      while (el && depth < 9) {
        const value = (el.innerText || el.textContent || '').trim()
        if (value.length > text.length + 16) {
          best = value
          if (value.length <= Math.max(text.length * 6, 1400)) break
        }
        el = el.parentElement
        depth += 1
      }
      return best.length > 6000 ? best.slice(0, 6000) : best
    }

    /** The subtopic card whose *content* contains this node, if any. */
    function cardOwnerOf(el) {
      if (!el || !el.closest) return null
      const content = el.closest('.dsh-subtopic-body, .dsh-subtopic-quote')
      if (!content) return null
      const card = content.closest ? content.closest('[data-subtopic-node]') : null
      return card && card.getAttribute ? card.getAttribute('data-subtopic-node') : null
    }

    function readSelection() {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
      const text = String(selection.toString() || '').trim()
      if (text.length < 2) return null
      const range = selection.getRangeAt(0)
      let el = range.commonAncestorContainer
      if (el && el.nodeType !== 1) el = el.parentElement
      if (!el || !el.isConnected) return null
      if (isEditable(el)) return null
      const parentId = cardOwnerOf(el)
      /* A selection inside the plugin's own chrome (pill, tree, stack bar) is not
       * a source; one inside a card's *content* is, and it chains the new
       * subtopic under that card. */
      if (!parentId && el.closest && el.closest('.dsh-subtopic-layer')) return null
      const rects = range.getClientRects()
      const rect = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect()
      if (!rect || (!rect.width && !rect.height)) return null
      return {
        selection: text.length > 4000 ? text.slice(0, 4000) : text,
        context: extractContext(range, text),
        parentId: parentId || null,
        rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height },
      }
    }

    function clampX(x, width) {
      const max = Math.max(8, window.innerWidth - width - 8)
      return Math.min(Math.max(8, x), max)
    }

    function cardPosition(rect) {
      const height = Math.min(window.innerHeight * 0.64, 580)
      const minY = TOP_SAFE + 6
      const x = clampX(rect.left + rect.width / 2 - CARD_WIDTH / 2, CARD_WIDTH)
      let y = rect.bottom + 12
      if (y + height > window.innerHeight - 8) y = rect.top - height - 12
      if (y < minY) y = Math.min(Math.max(minY, rect.bottom + 12), Math.max(minY, window.innerHeight - height - 8))
      return { x, y }
    }

    function pillPosition(rect) {
      const width = 150
      const x = clampX(rect.right - width / 2, width)
      const y = Math.min(rect.bottom + 6, window.innerHeight - 40)
      return { x, y: Math.max(TOP_SAFE + 4, y) }
    }

    /* -------------------------------------------------------------- markdown */

    const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\[[^\]\n]+\]\([^)\s]+\))/g

    function inline(text, base) {
      const nodes = []
      let last = 0
      let index = 0
      let match
      INLINE.lastIndex = 0
      while ((match = INLINE.exec(text)) !== null) {
        if (match.index > last) nodes.push(text.slice(last, match.index))
        const token = match[0]
        const key = `${base}-i${index++}`
        if (token.charCodeAt(0) === 96) nodes.push(h('code', { key, className: 'dsh-subtopic-code' }, token.slice(1, -1)))
        else if (token.startsWith('**')) nodes.push(h('strong', { key }, token.slice(2, -2)))
        else if (token.startsWith('*')) nodes.push(h('em', { key }, token.slice(1, -1)))
        else {
          const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token)
          if (link && /^(https?:|mailto:)/i.test(link[2])) {
            nodes.push(
              h('a', { key, href: link[2], target: '_blank', rel: 'noreferrer noopener', className: 'dsh-subtopic-link' }, link[1]),
            )
          } else {
            nodes.push(token)
          }
        }
        last = match.index + token.length
      }
      if (last < text.length) nodes.push(text.slice(last))
      return nodes
    }

    function markdown(text) {
      const lines = String(text || '').split('\n')
      const out = []
      let index = 0
      let list = null

      const flushList = () => {
        if (!list) return
        const key = `l${index++}`
        out.push(
          h(
            list.type,
            { key, className: 'dsh-subtopic-list' },
            list.items.map((item, itemIndex) => h('li', { key: `${key}-${itemIndex}` }, inline(item, `${key}-${itemIndex}`))),
          ),
        )
        list = null
      }

      let i = 0
      while (i < lines.length) {
        const line = lines[i]

        const fence = /^\s*```([\w+#.-]*)\s*$/.exec(line)
        if (fence) {
          flushList()
          const lang = fence[1] || ''
          const body = []
          i += 1
          while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
            body.push(lines[i])
            i += 1
          }
          i += 1
          const key = `c${index++}`
          out.push(
            h(
              'pre',
              { key, className: 'dsh-subtopic-pre' },
              lang ? h('span', { key: 'lang', className: 'dsh-subtopic-pre-lang' }, lang) : null,
              h('code', { key: 'body' }, body.join('\n')),
            ),
          )
          continue
        }

        const heading = /^(#{1,6})\s+(.*)$/.exec(line)
        if (heading) {
          flushList()
          out.push(h('div', { key: `h${index++}`, className: 'dsh-subtopic-h' }, inline(heading[2], `h${index}`)))
          i += 1
          continue
        }

        if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
          const ordered = /^\s*\d+[.)]\s+/.test(line)
          const type = ordered ? 'ol' : 'ul'
          if (!list || list.type !== type) {
            flushList()
            list = { type, items: [] }
          }
          list.items.push(line.replace(/^\s*([-*+]|\d+[.)])\s+/, ''))
          i += 1
          continue
        }

        if (/^\s*>\s?/.test(line)) {
          flushList()
          const quote = []
          while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
            quote.push(lines[i].replace(/^\s*>\s?/, ''))
            i += 1
          }
          out.push(h('blockquote', { key: `q${index++}`, className: 'dsh-subtopic-quote-block' }, inline(quote.join(' '), `q${index}`)))
          continue
        }

        if (!line.trim()) {
          flushList()
          i += 1
          continue
        }

        flushList()
        const paragraph = [line]
        i += 1
        while (
          i < lines.length &&
          lines[i].trim() &&
          !/^\s*```/.test(lines[i]) &&
          !/^#{1,6}\s/.test(lines[i]) &&
          !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) &&
          !/^\s*>/.test(lines[i])
        ) {
          paragraph.push(lines[i])
          i += 1
        }
        out.push(h('p', { key: `p${index++}`, className: 'dsh-subtopic-p' }, inline(paragraph.join(' '), `p${index}`)))
      }

      flushList()
      return out
    }

    /* ------------------------------------------------------------------ rpc */

    const aborts = new Map()

    function applyStreamChunk(id, raw, sink) {
      // Split the raw text stream on NUL-delimited control frames.
      let buffer = sink.buffer + raw
      let text = ''
      for (;;) {
        const start = buffer.indexOf('\u0000')
        if (start < 0) {
          text += buffer
          buffer = ''
          break
        }
        text += buffer.slice(0, start)
        const end = buffer.indexOf('\n', start)
        if (end < 0) {
          buffer = buffer.slice(start)
          break
        }
        const line = buffer.slice(start + 1, end)
        buffer = buffer.slice(end + 1)
        let frame = null
        try {
          frame = JSON.parse(line)
        } catch {
          frame = null
        }
        if (!frame || typeof frame !== 'object') continue
        if (frame.t === 'meta') sync(id, { model: frame.model || '', provider: frame.provider || '' })
        else if (frame.t === 'error') sync(id, { error: String(frame.message || '模型调用失败'), status: 'error' }, true)
      }
      sink.buffer = buffer
      return text
    }

    async function run(id) {
      const card = store.get(id)
      if (!card) return

      const previous = aborts.get(id)
      if (previous) previous.abort()
      const controller = new AbortController()
      aborts.set(id, controller)
      store.busy.add(id)

      sync(id, { status: 'loading', answer: '', error: '' }, true)
      let answer = ''
      const sink = { buffer: '' }

      try {
        const response = await fetch(ASK_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ selection: card.selection, context: card.context, turns: card.turns }),
          signal: controller.signal,
        })

        if (!response.ok) {
          let detail = ''
          try {
            const payload = await response.json()
            detail = (payload && payload.error) || ''
          } catch {
            detail = ''
          }
          throw new Error(detail || `请求失败（HTTP ${response.status}）`)
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()

        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          const text = applyStreamChunk(id, decoder.decode(value, { stream: true }), sink)
          if (text) {
            answer += text
            sync(id, { answer, status: 'streaming' })
          }
        }
      } catch (error) {
        if (error && error.name === 'AbortError') {
          if (aborts.get(id) === controller) aborts.delete(id)
          store.busy.delete(id)
          settle(id)
          return
        }
        if (aborts.get(id) === controller) aborts.delete(id)
        store.busy.delete(id)
        sync(id, { status: 'error', error: describe(error) }, true)
        return
      }

      if (aborts.get(id) === controller) aborts.delete(id)
      store.busy.delete(id)

      const current = store.get(id)
      if (!current) return
      if (current.error) {
        sync(id, { status: 'error' }, true)
        return
      }
      if (!answer.trim()) {
        sync(id, { status: 'error', error: '模型没有返回任何内容，请重试' }, true)
        return
      }
      sync(
        id,
        {
          status: 'done',
          answer,
          turns: current.turns.concat([{ role: 'assistant', text: answer }]),
        },
        'now',
      )
    }

    function describe(error) {
      if (!error) return '未知错误'
      if (typeof error === 'string') return error
      return String(error.message || error) || '未知错误'
    }

    function ask(id, text) {
      const card = store.get(id)
      if (!card) return
      const question = typeof text === 'string' ? text.trim() : ''
      if (!question) return
      store.update(id, { turns: card.turns.concat([{ role: 'user', text: question }]) })
      void run(id)
    }

    function regenerate(id) {
      if (!store.get(id)) return
      void run(id)
    }

    function closeCard(id) {
      const controller = aborts.get(id)
      if (controller) controller.abort()
      aborts.delete(id)
      store.busy.delete(id)
      settle(id)
      store.remove(id)
    }

    function bringToFront(id) {
      const card = store.get(id)
      if (!card) return
      const z = nextZ()
      if (card.z === z) return
      store.update(id, { z })
    }

    function openCard(info) {
      const id = `subtopic-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
      const position = cardPosition(info.rect)
      const parentId = info.parentId || null
      const turns = [{ role: 'user', text: FIRST_ASK }]
      const model = (store.info && store.info.model) || ''
      const provider = (store.info && store.info.provider) || ''
      store.add({
        id,
        parentId,
        selection: info.selection,
        context: info.context,
        x: position.x,
        y: position.y,
        z: nextZ(),
        model,
        provider,
        turns,
        answer: '',
        status: 'loading',
        error: '',
        expanded: false,
        focus: 0,
      })
      /* Every card is a node: the tree is the durable index, cards are views. */
      const teach = store.nodes.length === 0 && !store.ui.everOpened
      store.addNode({
        id,
        parentId,
        selection: info.selection,
        context: info.context || '',
        label: nodeLabel(info.selection),
        turns,
        answer: '',
        status: 'loading',
        error: '',
        model,
        provider,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      saveTree()
      /* First subtopic ever: show the panel once so the feature is discoverable. */
      if (teach) store.setUi({ open: true, everOpened: true })
      void run(id)
      return id
    }

    async function probeInfo() {
      try {
        const response = await fetch(INFO_URL, { credentials: 'same-origin' })
        if (!response.ok) return
        const payload = await response.json()
        store.info = payload && typeof payload === 'object' ? payload : null
        store.emit()
      } catch {
        /* the host half may not be loaded yet; the ask route will report it */
      }
    }

    /* ------------------------------------------------------------ behaviour */

    function installSelectionWatcher() {
      let timer = 0

      const onSelectionChange = () => {
        if (timer) window.clearTimeout(timer)
        timer = window.setTimeout(() => {
          timer = 0
          const info = readSelection()
          if (!info) {
            store.setPill(null)
            return
          }
          const position = pillPosition(info.rect)
          store.setPill({ selection: info.selection, context: info.context, rect: info.rect, x: position.x, y: position.y })
        }, 170)
      }

      const onMouseDown = (event) => {
        const target = event.target
        if (target && target.closest && target.closest('.dsh-subtopic-layer')) return
        store.setPill(null)
      }

      document.addEventListener('selectionchange', onSelectionChange)
      document.addEventListener('mousedown', onMouseDown, true)

      return () => {
        if (timer) window.clearTimeout(timer)
        document.removeEventListener('selectionchange', onSelectionChange)
        document.removeEventListener('mousedown', onMouseDown, true)
      }
    }

    /* True while the Settings hotkey recorder is waiting for a key: the trigger
     * must not react to the very keys the user is pressing to define it. */
    let prefsRecording = false

    /* Keys pressed while an IME composition is active belong to the input method
     * (arrows move the candidate list, Enter/Space confirm, Escape cancels), so
     * they must never reach the card shortcuts. DSH core enforces this at the
     * document boundary (InputBar's IME guard, issue #535) and IME-aware plugins
     * like dsh-better-sidebar do the same; a bare Ctrl tap mid-composition is no
     * exception. `isComposing` for modern engines, keyCode 229 for the legacy
     * signal engines emit without it. */
    function isComposingEvent(event) {
      return event.isComposing === true || event.keyCode === 229
    }

    function installKeyTrigger() {
      const pressed = new Set()
      let armed = false
      let extra = false
      let stray = false
      let downAt = 0

      const reset = () => {
        pressed.clear()
        armed = false
        extra = false
        stray = false
        downAt = 0
      }

      const onKeyDown = (event) => {
        if (prefsRecording) return
        if (isComposingEvent(event)) return
        if (event.key === 'Escape') {
          const top = store.top()
          if (top) {
            closeCard(top.id)
            event.preventDefault()
            event.stopPropagation()
            return
          }
          if (store.pill) {
            store.setPill(null)
            event.preventDefault()
            return
          }
          if (store.ui.open) {
            store.setUi({ open: false, everOpened: true })
            event.preventDefault()
          }
          return
        }
        const want = hotkeyParts(store.prefs.hotkey)
        if (!want.length || want.indexOf(event.key) < 0) {
          if (pressed.size > 0 || armed) {
            if (MODIFIER_KEYS.indexOf(event.key) >= 0) stray = true
            else extra = true
          }
          return
        }
        if (pressed.size === 0) {
          downAt = Date.now()
          extra = false
          stray = false
        }
        pressed.add(event.key)
        if (want.every((key) => pressed.has(key))) armed = true
      }

      const onKeyUp = (event) => {
        if (prefsRecording) {
          reset()
          return
        }
        if (isComposingEvent(event)) {
          reset()
          return
        }
        const want = hotkeyParts(store.prefs.hotkey)
        if (want.indexOf(event.key) < 0) return
        const fired = armed && !extra && !stray && Date.now() - downAt <= HOTKEY_MAX_HOLD
        pressed.delete(event.key)
        const remaining = Array.from(pressed)
        const exact = remaining.length === want.length - 1 && remaining.every((key) => want.indexOf(key) >= 0)
        if (pressed.size === 0) reset()
        if (!fired || !exact) return
        const info = readSelection() || store.pill
        if (!info || !info.selection) return
        store.setPill(null)
        openCard(info)
      }

      const stop = () => {
        reset()
      }

      window.addEventListener('keydown', onKeyDown, true)
      window.addEventListener('keyup', onKeyUp, true)
      window.addEventListener('blur', stop)
      return () => {
        window.removeEventListener('keydown', onKeyDown, true)
        window.removeEventListener('keyup', onKeyUp, true)
        window.removeEventListener('blur', stop)
      }
    }

    /* ----------------------------------------------------------- components */

    function useStoreSlice(pick) {
      const [value, setValue] = React.useState(pick)
      React.useEffect(() => store.subscribe(() => setValue(pick())), [])
      return value
    }

    function Thinking() {
      return h('span', { className: 'dsh-subtopic-thinking' }, '正在思考', h('i'), h('i'), h('i'))
    }

    function Card(props) {
      const card = props.card
      const [draft, setDraft] = React.useState('')
      const [copied, setCopied] = React.useState('')
      const bodyRef = React.useRef(null)
      const stickRef = React.useRef(true)

      const scrollToEnd = () => {
        const el = bodyRef.current
        if (!el || !stickRef.current) return
        el.scrollTop = el.scrollHeight
      }

      React.useEffect(scrollToEnd, [card.answer, card.status])

      const onBodyScroll = () => {
        const el = bodyRef.current
        if (!el) return
        stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
      }

      const startDrag = (event) => {
        if (event.button !== 0) return
        if (event.target && event.target.closest && event.target.closest('button')) return
        bringToFront(card.id)
        const startX = event.clientX
        const startY = event.clientY
        const originX = card.x
        const originY = card.y
        const onMove = (moveEvent) => {
          store.update(card.id, { x: originX + moveEvent.clientX - startX, y: originY + moveEvent.clientY - startY })
        }
        const onUp = () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        event.preventDefault()
      }

      const copy = async (text, tag) => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(tag)
          window.setTimeout(() => setCopied(''), 1200)
        } catch {
          /* clipboard blocked */
        }
      }

      const submit = () => {
        const value = draft.trim()
        if (!value) return
        setDraft('')
        ask(card.id, value)
      }

      const parent = card.parentId ? store.nodeOf(card.parentId) : null
      const [flash, setFlash] = React.useState(false)
      React.useEffect(() => {
        if (!card.focus) return undefined
        setFlash(true)
        const timer = window.setTimeout(() => setFlash(false), 1400)
        return () => window.clearTimeout(timer)
      }, [card.focus])

      const busy = card.status === 'loading' || card.status === 'streaming'
      const chips = busy || card.status === 'error' ? [] : [
        { label: '展开讲讲', ask: '请展开讲得更详细一些。' },
        { label: '举个例子', ask: '请举一个具体的例子。' },
        { label: '更通俗', ask: '请用更通俗的话再讲一遍，最好打个比方。' },
        { label: '有什么坑', ask: '这里有什么容易踩的坑或风险？' },
      ]

      const warn = store.info && store.info.hasLlm === false ? '宿主端 llm 服务不可用，暂时无法生成解答。' : ''

      return h(
        'div',
        {
          className: `dsh-subtopic-card${flash ? ' is-focus' : ''}`,
          'data-subtopic-node': card.id,
          style: { left: card.x, top: card.y, zIndex: card.z },
          onMouseDown: () => bringToFront(card.id),
        },
        h(
          'div',
          { className: 'dsh-subtopic-head', onPointerDown: startDrag },
          h('span', { className: 'dsh-subtopic-dot' }),
          h('span', { className: 'dsh-subtopic-title' }, '子话题'),
          card.model ? h('span', { className: 'dsh-subtopic-model', title: `${card.provider} / ${card.model}` }, card.model) : null,
          h('button', { className: 'dsh-subtopic-x', title: '关闭（Esc）', onClick: () => closeCard(card.id) }, '×'),
        ),
        parent
          ? h(
              'button',
              {
                className: 'dsh-subtopic-crumb',
                'data-subtopic-action': 'open-parent',
                title: '跳到父级子话题：' + parent.selection,
                onClick: () => openNode(parent.id),
              },
              '↳ 追问自「' + parent.label + '」',
            )
          : null,
        h(
          'div',
          {
            className: `dsh-subtopic-quote${card.expanded ? ' is-open' : ''}`,
            title: '点击展开 / 收起选中内容；Ctrl+C 可复制',
            onClick: () => store.update(card.id, { expanded: !card.expanded }),
          },
          card.selection,
        ),
        h(
          'div',
          { className: 'dsh-subtopic-body', ref: bodyRef, onScroll: onBodyScroll },
          warn ? h('div', { className: 'dsh-subtopic-warn' }, warn) : null,
          card.status === 'loading' && !card.answer ? h(Thinking, { key: 'thinking' }) : null,
          card.answer ? h('div', { key: 'answer' }, markdown(card.answer)) : null,
          card.status === 'streaming' ? h('span', { key: 'caret', className: 'dsh-subtopic-caret' }) : null,
          card.error ? h('div', { key: 'error', className: 'dsh-subtopic-error' }, card.error) : null,
          chips.length
            ? h(
                'div',
                { className: 'dsh-subtopic-chips' },
                chips.map((chip) => h('button', { key: chip.label, className: 'dsh-subtopic-chip', onClick: () => ask(card.id, chip.ask) }, chip.label)),
              )
            : null,
        ),
        h(
          'div',
          { className: 'dsh-subtopic-foot' },
          h('input', {
            className: 'dsh-subtopic-input',
            placeholder: '继续追问…',
            value: draft,
            onChange: (event) => setDraft(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                submit()
              }
            },
          }),
          h(
            'button',
            {
              className: 'dsh-subtopic-btn',
              onClick: () => (busy ? closeCard(card.id) : draft.trim() ? submit() : regenerate(card.id)),
              title: busy ? '停止生成并关闭' : draft.trim() ? '发送追问' : '重新生成',
            },
            busy ? '停止' : draft.trim() ? '发送' : '重答',
          ),
          h(
            'button',
            { className: 'dsh-subtopic-btn', onClick: () => copy(card.answer, 'answer'), disabled: !card.answer },
            copied === 'answer' ? '已复制' : '复制',
          ),
        ),
      )
    }

    function Pill(props) {
      const pill = props.pill
      const hotkey = useStoreSlice(() => store.prefs.hotkey)
      return h(
        'div',
        {
          className: 'dsh-subtopic-pill',
          style: { left: pill.x, top: pill.y },
          onMouseDown: (event) => event.preventDefault(),
          onClick: () => {
            store.setPill(null)
            openCard(pill)
          },
          title: `打开子话题卡片（也可以直接按 ${hotkeyLabel(hotkey)}）`,
        },
        h('span', { className: 'dsh-subtopic-kbd' }, hotkeyLabel(hotkey)),
        h('span', null, '子话题解答'),
      )
    }

    function StackBar(props) {
      const count = props.count
      const nodes = useStoreSlice(() => store.nodes.length)
      const open = useStoreSlice(() => store.ui.open)
      return h(
        'div',
        { className: 'dsh-subtopic-bar' },
        h('span', null, `子话题 ×${count}`),
        h(
          'button',
          {
            className: `dsh-subtopic-btn${open ? ' is-on' : ''}`,
            'data-subtopic-action': 'toggle-tree',
            title: '追问树状图',
            onClick: () => store.setUi({ open: !open, everOpened: true }),
          },
          open ? '收起树状图' : `树状图 ${nodes}`,
        ),
        h(
          'button',
          {
            className: 'dsh-subtopic-btn',
            onClick: () => {
              for (const card of store.cards.slice()) closeCard(card.id)
            },
          },
          '全部关闭',
        ),
      )
    }

    /* ------------------------------------------------------------ tree panel */

    function statusClass(node) {
      if (node.status === 'loading' || node.status === 'streaming') return 'is-loading'
      if (node.status === 'error') return 'is-error'
      if (node.answer) return 'is-done'
      return 'is-idle'
    }

    function TreeNode(props) {
      const id = props.id
      const root = props.root === true
      const node = useStoreSlice(() => store.nodeOf(id))
      const collapsed = useStoreSlice(() => Boolean(store.ui.collapsed[id]))
      const active = useStoreSlice(() => store.cards.some((card) => card.id === id))
      const [copied, setCopied] = React.useState(false)
      if (!node) return null
      const kids = store.childrenOf(id)
      const rounds = (node.turns || []).filter((turn) => turn && turn.role === 'user').length
      const clock = rounds > 1 ? `${rounds} 轮 · ${clockOf(node.createdAt)}` : clockOf(node.createdAt)
      const meta = copied ? '已复制' : clock
      return h(
        'div',
        { className: root ? 'dsh-subtopic-troot' : 'dsh-subtopic-tnode' },
        h(
          'div',
          {
            className: `dsh-subtopic-trow ${statusClass(node)}${active ? ' is-active' : ''}`,
            'data-subtopic-row': id,
            title: `${node.selection}\n\n点击打开子话题卡片；把标题拖到聊天输入框可以引用进对话`,
            onClick: () => openNode(id),
          },
          kids.length
            ? h(
                'button',
                {
                  className: 'dsh-subtopic-tcaret',
                  title: collapsed ? '展开追问' : '收起追问',
                  onClick: (event) => {
                    event.stopPropagation()
                    store.toggleCollapsed(id)
                  },
                },
                collapsed ? '▶' : '▼',
              )
            : h('span', { className: 'dsh-subtopic-tcaret is-leaf' }, '·'),
          h('span', { className: 'dsh-subtopic-tdot' }),
          h(
            'span',
            {
              className: 'dsh-subtopic-tlabel',
              'data-subtopic-drag': id,
              draggable: true,
              title: '拖进聊天输入框＝引用卡片，点 ⧉＝复制全文',
              onDragStart: (event) => {
                const text = dragPayload(node)
                dragNodeId = id
                rememberQuote(node)
                try {
                  event.dataTransfer.setData(CHIP_MIME, JSON.stringify({ id }))
                  event.dataTransfer.setData('text/plain', text)
                  event.dataTransfer.effectAllowed = 'copy'
                } catch (error) {
                  note('dragstart', error)
                }
              },
            },
            node.label || '(空选区)',
          ),
          h('span', { className: 'dsh-subtopic-tmeta' }, meta),
          h(
            'span',
            { className: 'dsh-subtopic-tacts' },
            h(
              'button',
              {
                'data-subtopic-action': 'copy-node',
                title: '复制这段内容（拖不动时用它，再 Ctrl+V）',
                onClick: (event) => {
                  event.stopPropagation()
                  void writeClipboard(dragPayload(node)).then((okay) => {
                    if (!okay) return
                    setCopied(true)
                    window.setTimeout(() => setCopied(false), 1200)
                  })
                },
              },
              '⧉',
            ),
            h(
              'button',
              {
                'data-subtopic-action': 'drop-node',
                title: kids.length ? `删除该子话题及其 ${kids.length} 条追问` : '删除该子话题',
                onClick: (event) => {
                  event.stopPropagation()
                  dropNode(id)
                },
              },
              '×',
            ),
          ),
        ),
        kids.length && !collapsed ? h('div', { className: 'dsh-subtopic-tkids' }, kids.map((kid) => h(TreeNode, { key: kid.id, id: kid.id }))) : null,
      )
    }

    function TreePanel() {
      const open = useStoreSlice(() => store.ui.open)
      const width = useStoreSlice(() => store.ui.width)
      const total = useStoreSlice(() => store.nodes.length)
      const roots = useStoreSlice(() => store.roots().map((node) => node.id))
      if (!open) return null

      const startResize = (event) => {
        if (event.button !== 0) return
        const startX = event.clientX
        const startWidth = store.ui.width
        const onMove = (moveEvent) => {
          const max = Math.max(TREE_MIN_WIDTH, (window.innerWidth || 1280) - 320)
          store.setUi({ width: Math.min(Math.max(TREE_MIN_WIDTH, startWidth + (startX - moveEvent.clientX)), max) })
        }
        const onUp = () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        event.preventDefault()
      }

      return h(
        'div',
        { className: 'dsh-subtopic-tree', style: { width } },
        h('div', { className: 'dsh-subtopic-tree-resize', onPointerDown: startResize, title: '拖动调整宽度' }),
        h(
          'div',
          { className: 'dsh-subtopic-tree-head' },
          h('span', { className: 'dsh-subtopic-dot' }),
          h('span', { className: 'dsh-subtopic-tree-title' }, '子话题树'),
          h('span', { className: 'dsh-subtopic-tree-count' }, `${total} 个 · ${roots.length} 支`),
          h(
            'button',
            {
              className: 'dsh-subtopic-btn dsh-subtopic-tree-close',
              'data-subtopic-action': 'close-tree',
              title: '收起面板（也可以按 Esc）',
              onClick: () => store.setUi({ open: false, everOpened: true }),
            },
            '收起 »',
          ),
        ),
        h(
          'div',
          { className: 'dsh-subtopic-tree-body' },
          roots.length
            ? roots.map((id) => h(TreeNode, { key: id, id, root: true }))
            : h('div', { className: 'dsh-subtopic-tree-empty' }, `还没有子话题。在对话里选中一段文字，按 ${hotkeyLabel()}（或点胶囊）就会开出一支。`),
        ),
        h('div', { className: 'dsh-subtopic-tree-foot' }, `引用：把某一行的标题拖进下面的聊天输入框，会变成一张引用卡片（在输入框里敲 @ 也能选子话题；点行上的 ⧉ 则复制全文）。追问成链：在卡片正文里选中文字再按 ${hotkeyLabel()}，新子话题会挂在它下面。收起：右上角「收起 »」、右下角「收起树状图」或 Esc。热键与卡片颜色可在 设置 → 子话题 里改。`),
      )
    }

    function TreeHandle() {
      const open = useStoreSlice(() => store.ui.open)
      const total = useStoreSlice(() => store.nodes.length)
      if (open || !total) return null
      return h(
        'button',
        { className: 'dsh-subtopic-thandle', 'data-subtopic-action': 'open-tree', title: '展开子话题树', onClick: () => store.setUi({ open: true, everOpened: true }) },
        h('span', null, '子话题树'),
        h('span', { className: 'dsh-subtopic-thandle-count' }, String(total)),
      )
    }

    function Layer() {
      const cards = useStoreSlice(() => store.cards)
      const pill = useStoreSlice(() => store.pill)
      const nodes = useStoreSlice(() => store.nodes.length)
      return h(
        'div',
        { className: 'dsh-subtopic-layer' },
        nodes ? h(TreePanel, { key: 'tree' }) : null,
        nodes ? h(TreeHandle, { key: 'handle' }) : null,
        cards.map((card) => h(Card, { key: card.id, card })),
        pill ? h(Pill, { key: 'pill', pill }) : null,
        cards.length ? h(StackBar, { key: 'bar', count: cards.length }) : null,
      )
    }

    /* ------------------------------------------------- settings → 子话题 page */

    /* Read the hotkey a keydown is asking for. Modifier combinations come from the
     * event's own modifier flags; a lone function key is allowed because it cannot
     * collide with typing. Anything else is refused with an explanation. */
    function hotkeyFromEvent(event) {
      const held = []
      if (event.ctrlKey) held.push('Control')
      if (event.altKey) held.push('Alt')
      if (event.shiftKey) held.push('Shift')
      if (event.metaKey) held.push('Meta')
      if (MODIFIER_KEYS.indexOf(event.key) >= 0) {
        if (held.indexOf(event.key) < 0) held.push(event.key)
        return normalizeHotkey(held.join('+'))
      }
      if (/^F([1-9]|1[0-2])$/.test(event.key)) return normalizeHotkey(event.key)
      return ''
    }

    function SettingsSection() {
      const hotkey = useStoreSlice(() => store.prefs.hotkey)
      const accent = useStoreSlice(() => store.prefs.accent)
      const [recording, setRecording] = React.useState(false)
      const [note, setNote] = React.useState('')

      React.useEffect(() => {
        if (!recording) return undefined
        prefsRecording = true
        const onKey = (event) => {
          event.preventDefault()
          event.stopPropagation()
          if (event.key === 'Escape') {
            setRecording(false)
            setNote('')
            return
          }
          const next = hotkeyFromEvent(event)
          if (!next) {
            setNote('这个键不合适：请按 Ctrl / Alt / Shift / ⌘（可以组合），或 F1–F12。')
            return
          }
          store.setPrefs({ hotkey: next })
          setRecording(false)
          setNote('')
        }
        window.addEventListener('keydown', onKey, true)
        return () => {
          prefsRecording = false
          window.removeEventListener('keydown', onKey, true)
        }
      }, [recording])

      const swatches = ACCENT_PRESETS.map((preset) =>
        h(
          'button',
          {
            key: preset || 'auto',
            className: `dsh-subtopic-swatch${accent === preset ? ' is-on' : ''}`,
            'data-subtopic-accent': preset || 'auto',
            title: preset ? preset : '跟随主题（不覆盖）',
            style: preset ? { background: preset } : null,
            onClick: () => store.setPrefs({ accent: preset }),
          },
          preset ? '' : '自动',
        ),
      )

      return h(
        'div',
        { className: 'dsh-subtopic-set' },
        h(
          'p',
          { className: 'dsh-subtopic-set-intro' },
          '在对话里选中一段文字，按热键就会开出一张子话题卡片（追问的子话题会挂在父卡片下面）。把追问树里的标题拖进聊天输入框，会插进一张只显示短标题的引用卡片 —— 发出去的时候我收到的仍然是完整原文。',
        ),
        h(
          'div',
          { className: 'dsh-subtopic-set-group' },
          h(
            'div',
            { className: 'dsh-subtopic-set-row' },
            h(
              'div',
              { className: 'dsh-subtopic-set-lab' },
              h('div', { className: 'dsh-subtopic-set-title' }, '弹出热键'),
              h(
                'div',
                { className: 'dsh-subtopic-set-desc' },
                `选中文字后轻按一下这个键，子话题卡片就弹出来。当前：${hotkeyLabel(hotkey)}`,
              ),
            ),
            h(
              'div',
              { className: 'dsh-subtopic-set-ctl' },
              h(
                'button',
                {
                  className: `dsh-subtopic-btn dsh-subtopic-set-key${recording ? ' is-on' : ''}`,
                  'data-subtopic-action': 'record-hotkey',
                  onClick: () => {
                    setNote('')
                    setRecording(true)
                  },
                },
                recording ? '按下新键…' : hotkeyLabel(hotkey),
              ),
              hotkey === HOTKEY_DEFAULT
                ? null
                : h(
                    'button',
                    { className: 'dsh-subtopic-link', 'data-subtopic-action': 'reset-hotkey', onClick: () => store.setPrefs({ hotkey: HOTKEY_DEFAULT }) },
                    '恢复默认',
                  ),
            ),
          ),
          h(
            'div',
            { className: 'dsh-subtopic-set-row' },
            h(
              'div',
              { className: 'dsh-subtopic-set-lab' },
              h('div', { className: 'dsh-subtopic-set-title' }, '卡片与树面板颜色'),
              h(
                'div',
                { className: 'dsh-subtopic-set-desc' },
                '这个颜色会铺在子话题卡片、右侧追问树面板、以及输入框里那张引用卡片的底色与描边上（正文文字颜色不动，深浅自动跟随主题）。「自动」表示不覆盖，完全跟随当前主题。',
              ),
            ),
            h(
              'div',
              { className: 'dsh-subtopic-set-ctl' },
              h(
                'div',
                { className: 'dsh-subtopic-set-swatches' },
                swatches,
                h('input', {
                  type: 'color',
                  className: 'dsh-subtopic-color',
                  'data-subtopic-action': 'pick-accent',
                  title: '自定义颜色',
                  value: accent || '#4d6bfe',
                  onChange: (event) => store.setPrefs({ accent: event.target.value }),
                }),
              ),
            ),
          ),
        ),
        recording
          ? h('div', { className: 'dsh-subtopic-set-note' }, '请按 Ctrl / Alt / Shift / ⌘（可组合，例如 Ctrl+Shift），或者 F1–F12；按 Esc 取消。')
          : null,
        note ? h('div', { className: 'dsh-subtopic-set-note is-warn' }, note) : null,
        h(
          'div',
          { className: 'dsh-subtopic-set-preview' },
          h('span', { className: 'dsh-subtopic-set-previewlab' }, '效果预览'),
          h(
            'div',
            { className: 'dsh-subtopic-set-previewcard' },
            h(
              'div',
              { className: 'dsh-subtopic-set-previewtitle' },
              h('span', { className: 'dsh-subtopic-dot' }),
              '子话题',
            ),
            h(
              'div',
              { className: 'dsh-subtopic-set-previewbody' },
              '拖进输入框后是 ',
              h(
                'span',
                { 'data-composer-chip': 'subtopic' },
                h('span', { style: { color: accent || 'var(--dsw-alias-brand-primary,#4d6bfe)', fontWeight: '700' } }, '⧉'),
                '这里显示选中的原文',
              ),
              '（发出去时我收到完整原文）。',
            ),
            h('div', { className: 'dsh-subtopic-set-previewrow' }, '● 这里显示选中的原文'),
            h('div', { className: 'dsh-subtopic-set-previewrow' }, '● 追问：这句话是什么意思'),
          ),
        ),
        h('div', { className: 'dsh-subtopic-set-note' }, '设置只存在本机，也只影响这个插件；子话题树的数据不受影响。'),
      )
    }

    /* ------------------------------------------------------------------ api */

    function apply(ctx) {
      const step = (name, fn) => {
        try {
          return fn()
        } catch (error) {
          note('fail:' + name, (error && (error.stack || error.message)) || String(error))
          return undefined
        }
      }
      /* Preferences first: the trigger key and the accent stylesheet must be in
       * force before the layer renders and before any keydown arrives. */
      step('prefs', () => {
        bootPrefs()
      })
      /* Restore the durable tree before the layer first renders. */
      step('tree', () => {
        loadTree()
        loadUi()
      })
      step('styles', () => ctx.effect(() => installStyle(), 'dsh-subtopic: styles'))
      step('watcher', () => ctx.effect(() => installSelectionWatcher(), 'dsh-subtopic: selection watcher'))
      step('chip', () => ctx.effect(() => installTriggerSource(ctx), 'dsh-subtopic: reference source'))
      step('drop', () => ctx.effect(() => installChipDrop(ctx), 'dsh-subtopic: chip drop'))
      step('keys', () => ctx.effect(() => installKeyTrigger(), 'dsh-subtopic: hotkey trigger'))
      step('settings', () =>
        ctx.effect(
          () =>
            ctx.slots.inject('settings.section', () =>
              ctx.slots.register({ name: 'settings.section', id: 'subtopic', order: 90, label: '子话题' }, SettingsSection),
            ),
          'dsh-subtopic: settings section',
        ),
      )
      step('slot', () =>
        ctx.effect(
          () =>
            ctx.slots.inject('shell.overlay', () =>
              ctx.slots.register(
                { name: 'shell.overlay', id: 'dsh-subtopic-layer', order: 40 },
                Layer,
              ),
            ),
          'dsh-subtopic: overlay slot',
        ),
      )
      step('probe', () => {
        void probeInfo()
      })
    }

    module.exports.apply = apply
    module.exports.inject = ['slots']
    return module.exports
  },
})
