const Z = 2147483640;

/** The pill's height, which popovers are placed against (`popoverStyle`). */
export const PILL_HEIGHT = 36;

/** A pin sits on its rectangle's top-left corner, which its pointed bottom-left corner marks. */
export const PIN_HEIGHT = 28;

/** Widths the popovers are placed with (`popoverStyle`). */
export const PANEL_WIDTH = 340;
export const THREAD_WIDTH = 340;

/**
 * Every colour is a variable, set on the widget's host element, so a site can
 * retheme it from its own CSS:
 *
 *     [data-reviewapp-annotate-widget] { --ra-accent: #0d9488; }
 *
 * (Styles from the page win over the defaults below.)
 */
export const STYLES = `
  :host {
    all: initial;
    --ra-ink: #1c1917;
    --ra-paper: #ffffff;
    --ra-paper-2: #faf6ea;
    --ra-line: #ece3c8;
    --ra-muted: #78716c;
    --ra-accent: #d4a83a;
    --ra-accent-hover: #c0952b;
    --ra-accent-ink: #1c1917;
    --ra-sticky: #d4a83a;
    --ra-sticky-hover: #c0952b;
    --ra-sticky-ink: #1c1917;
    --ra-resolved: #5f8a3e;
    --ra-resolved-ink: #ffffff;
    --ra-danger: #dc2626;
    --ra-pill: #1c1917;
    --ra-pill-hover: #2e2a26;
    --ra-pill-ink: #f6edd2;
    --ra-shadow: 0 8px 28px rgba(28, 25, 23, .26);
  }
  * { box-sizing: border-box; font: 13px/1.4 system-ui, sans-serif; }
  button { font: inherit; color: inherit; }
  textarea { font: inherit; }

  /* --- the pill: an add-comment button and a comment count, in one draggable shape --- */
  .bar { position: fixed; z-index: ${Z + 6}; display: flex; align-items: stretch; height: ${PILL_HEIGHT}px; overflow: hidden;
    white-space: nowrap; border: 1px solid rgba(255,255,255,.18); border-radius: 999px; background: var(--ra-pill);
    color: var(--ra-pill-ink); cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none;
    box-shadow: var(--ra-shadow); }
  .bar:active { cursor: grabbing; }
  .seg { display: flex; align-items: center; gap: 6px; border: 0; background: none; color: inherit; cursor: pointer; }
  .seg:hover:not(:disabled) { background: var(--ra-pill-hover); }
  .seg:disabled { opacity: .6; cursor: default; }
  .seg.icon { padding: 0 9px 0 12px; }
  .seg.icon.active { background: var(--ra-accent); color: var(--ra-accent-ink); }
  .seg.meta.active { background: var(--ra-accent); color: var(--ra-accent-ink); }
  .seg.meta.active .sub { opacity: .8; }
  .seg.meta { flex-direction: column; align-items: flex-start; justify-content: center; gap: 0; padding: 0 14px 0 10px;
    border-left: 1px solid rgba(255,255,255,.18); line-height: 1.15; text-align: left; }
  .seg .label { font-weight: 600; line-height: 1.15; }
  .seg .sub { display: inline-flex; align-items: center; gap: 4px; opacity: .65; font-size: 11px; line-height: 1.15; }

  /* saving: a spinner in the pill's second line */
  .spinner { width: 9px; height: 9px; border: 1.5px solid currentColor; border-right-color: transparent; border-radius: 50%;
    animation: ra-spin .7s linear infinite; }
  @keyframes ra-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 2s; } }

  /* something didn't save: retry or dismiss it here */
  .seg.problem { flex-direction: column; align-items: flex-start; justify-content: center; gap: 0; padding: 0 14px 0 10px;
    background: var(--ra-danger); color: #fff; line-height: 1.15; }
  .seg.problem:hover { background: color-mix(in srgb, var(--ra-danger) 85%, black); }
  .seg.problem .sub { opacity: .85; }

  /* --- selecting a region --- */
  .hint { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: ${Z + 6}; padding: 8px 14px;
    border-radius: 999px; background: var(--ra-accent); color: var(--ra-accent-ink); pointer-events: none;
    box-shadow: var(--ra-shadow); }
  .catcher { position: fixed; inset: 0; z-index: ${Z + 4}; cursor: crosshair; touch-action: none; }
  /* a white hairline and a soft halo around the border, so it stands out on any background */
  .region { position: fixed; z-index: ${Z + 5}; pointer-events: none; border: 2px solid var(--ra-accent);
    background: color-mix(in srgb, var(--ra-accent) 10%, transparent); border-radius: 4px;
    box-shadow: 0 0 0 1px #fff, 0 0 0 5px color-mix(in srgb, var(--ra-accent) 28%, transparent); }
  .region.hover { border-color: var(--ra-sticky); background: color-mix(in srgb, var(--ra-sticky) 16%, transparent);
    box-shadow: 0 0 0 1px #fff, 0 0 0 5px color-mix(in srgb, var(--ra-sticky) 35%, transparent); z-index: ${Z + 2}; }

  /* --- shared by the composer, thread, preview and list --- */
  .card { background: var(--ra-paper); color: var(--ra-ink); border: 1px solid var(--ra-line); border-radius: 12px;
    box-shadow: var(--ra-shadow); }
  .muted { color: var(--ra-muted); font-size: 12px; }
  .avatar { flex: none; border-radius: 50%; object-fit: cover; background: var(--ra-muted); color: #fff;
    display: inline-flex; align-items: center; justify-content: center; font-weight: 600; font-size: 11px; overflow: hidden; }
  .icon-button { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px;
    padding: 0; border: 0; border-radius: 6px; background: none; color: var(--ra-muted); cursor: pointer; }
  .icon-button:hover:not(:disabled) { background: var(--ra-paper-2); color: var(--ra-ink); }
  .icon-button:disabled { opacity: .45; cursor: default; }
  .icon-button.on { color: var(--ra-resolved); }
  .link-danger { padding: 0; border: 0; background: none; color: var(--ra-danger); cursor: pointer; text-decoration: underline; }
  textarea.field { width: 100%; resize: none; padding: 8px 0; border: 0; outline: 0; background: none; color: var(--ra-ink); }
  textarea.field::placeholder { color: var(--ra-muted); opacity: .75; }
  .primary { padding: 6px 12px; border-radius: 6px; border: 1px solid var(--ra-accent); background: var(--ra-accent);
    color: var(--ra-accent-ink); cursor: pointer; }
  .primary:hover:not(:disabled) { background: var(--ra-accent-hover); border-color: var(--ra-accent-hover); }
  .secondary { padding: 6px 12px; border-radius: 6px; border: 1px solid var(--ra-line); background: none; color: var(--ra-ink);
    cursor: pointer; }
  .secondary:hover:not(:disabled) { background: var(--ra-paper-2); }
  .primary:disabled, .secondary:disabled { opacity: .5; cursor: default; }

  /* --- composer --- */
  .composer { position: fixed; z-index: ${Z + 7}; width: 320px; padding: 12px; }
  .composer textarea.field { height: 76px; resize: vertical; }
  .composer label { display: block; margin-top: 8px; color: var(--ra-muted); }
  .composer .row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 10px; }
  .composer .draw-hint { display: flex; align-items: center; gap: 8px; margin-top: 8px; color: var(--ra-muted); font-size: 12px; }
  .composer .draw-hint .pen { width: 10px; height: 10px; border-radius: 50%; background: #ef4444; }
  .composer .link { padding: 0; border: 0; background: none; color: #0969da; font-size: 12px; cursor: pointer; }
  .composer .link:hover { text-decoration: underline; }

  /* the selection while composing: draw on it */
  .region.drawing { pointer-events: auto; cursor: crosshair; touch-action: none; }
  .region.drawing svg { position: absolute; left: -2px; top: -2px; overflow: visible; }

  .attachments { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .attachment { position: relative; width: 84px; height: 64px; border-radius: 6px; overflow: hidden;
    border: 1px solid var(--ra-line); background: var(--ra-paper-2); display: flex; align-items: center;
    justify-content: center; color: var(--ra-muted); font-size: 11px; }
  .attachment img { width: 100%; height: 100%; object-fit: cover; }
  a.attachment { cursor: zoom-in; }
  .thread .attachments { margin-top: 8px; }
  /* in a thread, an image is the point: as wide as the card allows */
  .thread .attachment { width: auto; max-width: 100%; height: auto; min-height: 48px; min-width: 84px; background: var(--ra-paper-2); }
  .thread .attachment img { width: auto; max-width: 100%; height: auto; max-height: 200px; display: block; object-fit: contain; }
  .attachment .remove { position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; padding: 0;
    display: flex; align-items: center; justify-content: center; border: 0; border-radius: 50%;
    background: color-mix(in srgb, var(--ra-ink) 78%, transparent); color: #fff; cursor: pointer; }

  /* --- pins: a count (a sticky note), then up to three avatars behind it, each half hidden by the one before --- */
  .pin { position: fixed; z-index: ${Z + 3}; display: flex; align-items: center; padding: 0; border: 0;
    background: none; cursor: pointer; touch-action: none; }
  .pin.dragging { cursor: grabbing; z-index: ${Z + 4}; }
  .pin.dragging .count { transform: scale(1.12); box-shadow: 0 6px 16px rgba(28,25,23,.35); }
  .pin .count { position: relative; z-index: 10; min-width: ${PIN_HEIGHT}px; height: ${PIN_HEIGHT}px; padding: 0 8px; display: flex;
    align-items: center; justify-content: center; border-radius: 8px 8px 8px 2px; border: 2px solid #fff;
    background: var(--ra-sticky); color: var(--ra-sticky-ink); font-weight: 700;
    box-shadow: 0 2px 8px rgba(28,25,23,.3); transform-origin: bottom left; transition: background .12s, transform .12s; }
  .pin:hover .count { background: var(--ra-sticky-hover); transform: scale(1.12); }
  .pin .stack { display: flex; margin-left: -12px; }
  .pin .stack .avatar { position: relative; border: 2px solid #fff; margin-left: -12px; box-shadow: 0 1px 4px rgba(28,25,23,.3); }
  .pin .stack .avatar:first-child { margin-left: 0; }
  .pin.open .count { background: var(--ra-pill); color: var(--ra-pill-ink); }
  .pin.open:hover .count { background: var(--ra-pill-hover); }
  .pin.resolved { opacity: .75; }
  .pin.resolved .count { background: var(--ra-resolved); color: var(--ra-resolved-ink); }
  .pin.resolved:hover .count { background: var(--ra-resolved); filter: brightness(1.12); }
  .pin.pending { opacity: .6; }

  /* --- the hover preview --- */
  .preview { position: fixed; z-index: ${Z + 7}; width: 260px; padding: 10px; cursor: pointer; }
  .preview .head { display: flex; align-items: center; gap: 8px; }
  .preview .who { font-weight: 600; }
  .preview .text { margin-top: 6px; white-space: pre-wrap; word-break: break-word; }
  .preview .actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; }
  .preview .resolve { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border: 1px solid var(--ra-line);
    border-radius: 6px; background: none; color: var(--ra-ink); cursor: pointer; }
  .preview .resolve:hover { background: var(--ra-paper-2); }
  .preview .resolve.on { color: var(--ra-resolved); border-color: color-mix(in srgb, var(--ra-resolved) 45%, transparent); }
  .preview .resolve svg { width: 14px; height: 14px; }

  /* --- the open thread --- */
  .thread { position: fixed; z-index: ${Z + 7}; width: ${THREAD_WIDTH}px; max-height: calc(100vh - 16px); overflow: auto; }
  .thread .msg { padding: 12px 14px; }
  .thread .msg + .msg { border-top: 1px solid var(--ra-line); }
  .thread .msg-head { display: flex; align-items: center; gap: 8px; }
  .thread .who { font-weight: 600; }
  .thread .spacer { flex: 1; }
  .thread .text { margin-top: 6px; white-space: pre-wrap; word-break: break-word; }
  .thread .menu-wrap { position: relative; }
  .thread .menu { position: absolute; right: 0; top: 30px; z-index: 1; min-width: 110px; padding: 4px;
    background: var(--ra-paper); border: 1px solid var(--ra-line); border-radius: 8px; box-shadow: var(--ra-shadow); }
  .thread .menu button { display: block; width: 100%; padding: 6px 10px; border: 0; border-radius: 6px; background: none;
    text-align: left; cursor: pointer; }
  .thread .menu button:hover { background: var(--ra-paper-2); }
  .thread .menu button.danger { color: var(--ra-danger); }
  .thread .edit .row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 6px; }
  .thread .edit textarea.field { min-height: 56px; max-height: 160px; overflow-y: auto; padding: 6px 8px;
    border: 1px solid var(--ra-line); border-radius: 6px; }
  .thread .reply-box { display: flex; align-items: flex-end; gap: 6px; padding: 8px 10px 8px 14px;
    border-top: 1px solid var(--ra-line); }
  .thread .reply-box textarea.field { flex: 1; min-height: 34px; max-height: 120px; overflow-y: auto; }

  /* --- the list --- */
  .panel { position: fixed; z-index: ${Z + 6}; width: ${PANEL_WIDTH}px; max-height: 60vh; overflow: auto; padding: 6px; }
  .panel .item { display: flex; gap: 8px; width: 100%; padding: 8px; border: 0; border-radius: 6px; background: none;
    text-align: left; cursor: pointer; }
  .panel .item:hover { background: var(--ra-paper-2); }
  .panel .item.resolved .body, .panel .item.resolved .avatar { opacity: .6; }
  .panel .section { margin: 6px 8px 2px; padding-top: 8px; border-top: 1px solid var(--ra-line); color: var(--ra-muted);
    font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
  .panel .badge { display: inline-flex; align-items: center; margin-right: 4px; vertical-align: -2px; color: var(--ra-resolved); }
  .panel .badge svg { width: 13px; height: 13px; }
  .panel .item .body { word-break: break-word; }
  .panel .empty { padding: 8px; color: var(--ra-muted); }
  .panel .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 8px 8px; }
  .panel .head a { color: #0969da; text-decoration: none; }
  .panel .head a:hover { text-decoration: underline; }

`;
