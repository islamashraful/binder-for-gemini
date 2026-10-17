// Styles for the panel. It lives in a shadow root, so none of this leaks into
// Gemini and Gemini's styles don't leak in. Sizes match Gemini's own sidebar
// (32px pill rows, 13px text).

export const PANEL_CSS = /* css */ `
:host { all: initial; display: block; }
:host([hidden]) { display: none; }

.binder {
  --fg: #1f1f1f;
  --muted: rgba(0, 0, 0, 0.6);
  --hover: rgba(0, 0, 0, 0.06);
  --active: #d3e3fd;
  --active-fg: #041e49;
  --drop: rgba(11, 87, 208, 0.14);
  --accent: #0b57d0;
  --line: rgba(0, 0, 0, 0.12);
  --menu-bg: #ffffff;
  --menu-shadow: 0 2px 6px rgba(0, 0, 0, 0.15), 0 1px 2px rgba(0, 0, 0, 0.3);
  --input-bg: rgba(0, 0, 0, 0.04);
  --danger: #b3261e;
  --c-gray: #5f6368; --c-blue: #1a73e8; --c-green: #188038; --c-yellow: #e37400;
  --c-orange: #e8710a; --c-red: #d93025; --c-pink: #d01884; --c-purple: #9334e6;

  font-family: "Google Sans Flex", "Google Sans", "Helvetica Neue", Arial, sans-serif;
  font-size: 13px;
  line-height: 17px;
  color: var(--fg);
  /* Gemini's rows start 8px in and run to the sidebar's edge. */
  padding: 0 0 8px 8px;
  box-sizing: border-box;
  -webkit-font-smoothing: antialiased;
}
.binder[data-theme="dark"] {
  --fg: #e6e6e6;
  --muted: rgba(255, 255, 255, 0.55);
  --hover: rgba(255, 255, 255, 0.08);
  --active: rgba(168, 199, 250, 0.2);
  --active-fg: #e6e6e6;
  --drop: rgba(168, 199, 250, 0.18);
  --accent: #a8c7fa;
  --line: rgba(255, 255, 255, 0.12);
  --menu-bg: #2a2a2a;
  --menu-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  --input-bg: rgba(255, 255, 255, 0.06);
  --danger: #f2b8b5;
  --c-gray: #9aa0a6; --c-blue: #8ab4f8; --c-green: #81c995; --c-yellow: #fdd663;
  --c-orange: #fcad70; --c-red: #f28b82; --c-pink: #ff8bcb; --c-purple: #c58af9;
}
.binder *, .binder *::before, .binder *::after { box-sizing: border-box; }

button {
  font: inherit; color: inherit; background: none; border: 0; margin: 0; padding: 0;
  cursor: pointer;
}
button:focus-visible, .row:focus-visible, input:focus-visible {
  outline: 2px solid var(--accent); outline-offset: -2px;
}
.icon { width: 18px; height: 18px; fill: currentColor; flex: none; }
.c-gray { color: var(--c-gray); } .c-blue { color: var(--c-blue); }
.c-green { color: var(--c-green); } .c-yellow { color: var(--c-yellow); }
.c-orange { color: var(--c-orange); } .c-red { color: var(--c-red); }
.c-pink { color: var(--c-pink); } .c-purple { color: var(--c-purple); }

/* Section header, styled like Gemini's "Chats" header */
.hdr {
  display: flex; align-items: center; gap: 2px;
  height: 32px; padding: 0 4px 0 0; border-radius: 9999px;
}
.hdr.drop { background: var(--drop); }
.hdr-toggle {
  display: flex; align-items: center; gap: 4px; height: 28px; padding: 0 8px;
  border-radius: 9999px; color: var(--muted); flex: 1; min-width: 0; text-align: left;
}
.hdr-toggle:hover { background: var(--hover); }
.hdr-toggle .icon { width: 16px; height: 16px; transform: rotate(90deg); transition: transform .15s; }
.hdr-toggle[aria-expanded="false"] .icon { transform: rotate(0deg); }
.icon-btn {
  width: 28px; height: 28px; display: grid; place-items: center; border-radius: 9999px;
  color: var(--muted); flex: none;
}
.icon-btn:hover { background: var(--hover); color: var(--fg); }
.icon-btn.on { color: var(--accent); }

/* Search */
.search {
  display: flex; align-items: center; gap: 8px; height: 32px; margin: 2px 0 4px;
  padding: 0 12px; border-radius: 9999px; background: var(--input-bg); color: var(--muted);
}
.search .icon { width: 16px; height: 16px; }
.search input {
  flex: 1; min-width: 0; height: 100%; border: 0; background: none; outline: none;
  font: inherit; color: var(--fg);
}
.search input::placeholder { color: var(--muted); }

/* Rows */
.tree { display: flex; flex-direction: column; }
.row {
  position: relative; display: flex; align-items: center; gap: 6px;
  height: 32px; padding-right: 4px; border-radius: 9999px;
  color: var(--fg); text-decoration: none; cursor: pointer; user-select: none;
}
.row:hover { background: var(--hover); }
.row.active { background: var(--active); color: var(--active-fg); }
.row.drop-inside { background: var(--drop); box-shadow: inset 0 0 0 1px var(--accent); }
.row.drop-before::before, .row.drop-after::after {
  content: ""; position: absolute; left: 12px; right: 12px; height: 2px;
  background: var(--accent); border-radius: 2px; pointer-events: none;
}
.row.drop-before::before { top: -1px; }
.row.drop-after::after { bottom: -1px; }
.row.dragging { opacity: 0.45; }
.caret {
  width: 18px; height: 18px; display: grid; place-items: center; color: var(--muted); flex: none;
}
.caret .icon { width: 16px; height: 16px; transition: transform .15s; }
.caret.open .icon { transform: rotate(90deg); }
.caret.empty { visibility: hidden; }
.label { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.chat .label { padding-left: 4px; }
.count { color: var(--muted); font-size: 12px; padding: 0 4px; }
.row .act {
  width: 24px; height: 24px; display: none; place-items: center; border-radius: 9999px;
  color: var(--muted);
}
.row .act .icon { width: 16px; height: 16px; }
.row .act:hover { background: var(--hover); color: var(--fg); }
.row:hover .act, .row:focus-within .act, .row .act.open { display: grid; }
.row:hover .count, .row:focus-within .count { display: none; }
.row-input {
  flex: 1; min-width: 0; height: 24px; padding: 0 8px; margin-right: 4px;
  border: 1px solid var(--accent); border-radius: 6px; outline: none;
  background: var(--input-bg); color: var(--fg); font: inherit;
}

.empty {
  margin: 2px 0; padding: 10px 12px; border: 1px dashed var(--line); border-radius: 12px;
  color: var(--muted); line-height: 18px;
}
.empty.drop { background: var(--drop); border-color: var(--accent); }
.empty b { color: var(--fg); font-weight: 500; }
.no-results { padding: 6px 12px; color: var(--muted); }
.toast { padding: 6px 12px; color: var(--muted); font-size: 12px; }
.toast.error { color: var(--danger); }

/* Menus */
.layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483000; }
.menu {
  position: fixed; pointer-events: auto; min-width: 200px; max-width: 280px;
  max-height: min(420px, calc(100vh - 16px)); overflow-y: auto;
  padding: 6px 0; border-radius: 12px; background: var(--menu-bg); box-shadow: var(--menu-shadow);
  color: var(--fg); font-family: inherit;
}
.menu-title { padding: 6px 16px 4px; color: var(--muted); font-size: 12px; }
.menu-item {
  display: flex; align-items: center; gap: 12px; width: 100%; min-height: 36px; padding: 0 16px;
  text-align: left;
}
.menu-item:hover:not(:disabled) { background: var(--hover); }
.menu-item:disabled { opacity: 0.45; cursor: default; }
.menu-item .icon { color: var(--muted); }
.menu-item .grow { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.menu-item.danger, .menu-item.danger .icon { color: var(--danger); }
.menu-item .tick { visibility: hidden; color: var(--accent); }
.menu-item.checked .tick { visibility: visible; }
.menu-sep { height: 1px; margin: 6px 0; background: var(--line); }
.swatches { display: flex; flex-wrap: wrap; gap: 6px; padding: 6px 16px; }
.swatch {
  width: 22px; height: 22px; border-radius: 50%; background: currentColor;
  box-shadow: inset 0 0 0 2px var(--menu-bg);
}
.swatch.sel { outline: 2px solid currentColor; outline-offset: 1px; }
.confirm { padding: 8px 16px; max-width: 280px; line-height: 18px; }
.confirm-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
.btn { height: 32px; padding: 0 14px; border-radius: 9999px; font-weight: 500; }
.btn:hover { background: var(--hover); }
.btn.danger { background: var(--danger); color: var(--menu-bg); }
.btn.danger:hover { filter: brightness(1.08); }
.menu-foot { padding: 6px 16px 2px; color: var(--muted); font-size: 12px; }
`;

/** Added to Gemini's page (not the shadow root) to hide chats that are in a folder. */
export const PAGE_CSS = `
html.binder-hide-filed [data-binder-filed] { display: none !important; }
`;
