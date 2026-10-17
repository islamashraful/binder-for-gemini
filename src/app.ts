// Connects the three parts: stored folder data, Gemini's page, and our panel.

import * as model from './core/model';
import type { State } from './core/model';
import type { StateStore } from './core/store';
import {
  chatFromEventTarget,
  chatPath,
  currentChat,
  findInsertionAnchor,
  isDarkTheme,
  readSidebarChats,
} from './core/gemini-dom';
import { createPanel, type PanelActions, type PanelContext } from './ui/panel';
import { drag } from './ui/drag';
import { PAGE_CSS, PANEL_CSS } from './ui/styles';

export interface AppOptions {
  /** How often to check for URL changes (Gemini is a single-page app). */
  pollMs?: number;
  /** How long to wait after page changes before re-scanning the sidebar. */
  debounceMs?: number;
  download?: (filename: string, text: string) => void;
  /** Navigation for chats that aren't loaded in the sidebar. */
  navigate?: (path: string) => void;
}

export interface App {
  stop(): void;
  getState(): State;
  /** Re-scan the page right away instead of waiting for the debounce. */
  sync(): void;
}

const FILED_ATTR = 'data-binder-filed';
const HIDE_CLASS = 'binder-hide-filed';

export async function startApp(store: StateStore, opts: AppOptions = {}): Promise<App> {
  const pollMs = opts.pollMs ?? 500;
  const debounceMs = opts.debounceMs ?? 150;
  const download = opts.download ?? downloadFile;
  const navigate = opts.navigate ?? ((path: string) => location.assign(path));

  let state = await store.load();
  let ctx: PanelContext = readContext();
  let stopped = false;

  // Panel host inside Gemini's sidebar, and a separate overlay for menus.
  const host = document.createElement('binder-for-gemini');
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.appendChild(styleEl(PANEL_CSS));

  const layerHost = document.createElement('binder-for-gemini-layer');
  const layerShadow = layerHost.attachShadow({ mode: 'open' });
  layerShadow.appendChild(styleEl(PANEL_CSS));
  document.body.appendChild(layerHost);

  const pageStyle = styleEl(PAGE_CSS);
  pageStyle.id = 'binder-page-css';
  (document.head ?? document.documentElement).appendChild(pageStyle);

  const actions: PanelActions = {
    createFolder(name, parentId) {
      const result = model.createFolder(state, { name, parentId });
      commit(result.state);
      return result.id;
    },
    renameFolder: (id, name) => commit(model.renameFolder(state, id, name)),
    setColor: (id, color) => commit(model.setFolderColor(state, id, color)),
    setCollapsed: (id, collapsed) => commit(model.setCollapsed(state, id, collapsed)),
    deleteFolder: (id) => commit(model.deleteFolder(state, id)),
    moveFolder: (id, targetId, pos) => commit(model.moveFolder(state, id, targetId, pos)),
    fileChat: (chat, folderId) => commit(model.fileChat(state, chat, folderId)),
    unfileChat: (id) => commit(model.unfileChat(state, id)),
    setSetting: (key, value) => commit(model.setSetting(state, key, value)),
    openChat(id, e) {
      // Let cmd/ctrl/shift/middle click open a new tab as usual.
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      // Clicking Gemini's own link switches chats without reloading the page.
      const native = readSidebarChats(document).find((c) => c.id === id);
      if (native) native.link.click();
      else navigate(chatPath(id, location.pathname));
    },
    exportData() {
      const date = new Date().toISOString().slice(0, 10);
      download(`binder-backup-${date}.json`, model.exportState(state));
    },
    importData(text) {
      try {
        const imported = model.importState(text);
        commit(imported);
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    },
  };

  const panel = createPanel(shadow, layerShadow, actions);
  panel.setTheme(isDarkTheme(document));
  panel.render(state, ctx);

  // ---------------------------------------------------------------- core loop

  function commit(next: State) {
    if (stopped || next === state) return;
    state = next;
    applyToPage();
    panel.render(state, ctx);
    store.save(state).catch((err) => console.warn('[Binder] Could not save:', err));
  }

  function readContext(): PanelContext {
    return { currentChat: currentChat(document, location), pathname: location.pathname };
  }

  function ensureMounted() {
    const anchor = findInsertionAnchor(document);
    if (!anchor?.parentNode) return;
    if (host.parentNode !== anchor.parentNode || host.nextSibling !== anchor) {
      anchor.parentNode.insertBefore(host, anchor);
    }
  }

  /** Marks filed chats in Gemini's list (CSS hides them) and returns their current titles. */
  function applyToPage(): Map<string, string> {
    document.documentElement.classList.toggle(HIDE_CLASS, state.settings.hideFiled);
    const titles = new Map<string, string>();
    for (const chat of readSidebarChats(document)) {
      const filed = chat.id in state.chats;
      if (filed !== chat.item.hasAttribute(FILED_ATTR)) chat.item.toggleAttribute(FILED_ATTR, filed);
      if (filed && chat.title) titles.set(chat.id, chat.title);
    }
    return titles;
  }

  function sync() {
    if (stopped) return;
    ensureMounted();
    const titles = applyToPage();
    const next = readContext();
    const ctxChanged =
      next.pathname !== ctx.pathname ||
      next.currentChat?.id !== ctx.currentChat?.id ||
      next.currentChat?.title !== ctx.currentChat?.title;
    ctx = next;
    const renamed = model.updateTitles(state, titles);
    if (renamed !== state) commit(renamed);
    else if (ctxChanged) panel.render(state, ctx);
  }

  let syncTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleSync = () => {
    if (syncTimer !== undefined) return;
    syncTimer = setTimeout(() => {
      syncTimer = undefined;
      sync();
    }, debounceMs);
  };

  // ---------------------------------------------------------------- watchers

  // Sidebar items load lazily and Angular re-renders parts of the page.
  const pageObserver = new MutationObserver(scheduleSync);
  pageObserver.observe(document.body, { childList: true, subtree: true, characterData: true });

  const themeObserver = new MutationObserver(() => panel.setTheme(isDarkTheme(document)));
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });

  let lastHref = location.href;
  const poll = setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      sync();
    }
  }, pollMs);

  const unwatch = store.watch((next) => {
    state = next;
    applyToPage();
    panel.render(state, ctx);
  });

  // Dragging chats out of Gemini's own list.
  const onDragStart = (e: DragEvent) => {
    const chat = chatFromEventTarget(e.target);
    if (chat) drag.start({ kind: 'chat', ...chat });
    else drag.end(); // our panel sets its own drag right after this
  };
  const onDragFinish = () => {
    drag.end();
    panel.clearDrop();
  };
  document.addEventListener('dragstart', onDragStart, true);
  document.addEventListener('dragend', onDragFinish, true);
  document.addEventListener('drop', onDragFinish); // bubble phase: after our drop handlers

  sync();

  return {
    getState: () => state,
    sync,
    stop() {
      if (stopped) return;
      stopped = true;
      clearTimeout(syncTimer);
      clearInterval(poll);
      pageObserver.disconnect();
      themeObserver.disconnect();
      unwatch();
      document.removeEventListener('dragstart', onDragStart, true);
      document.removeEventListener('dragend', onDragFinish, true);
      document.removeEventListener('drop', onDragFinish);
      panel.destroy();
      host.remove();
      layerHost.remove();
      pageStyle.remove();
      document.documentElement.classList.remove(HIDE_CLASS);
      for (const el of document.querySelectorAll(`[${FILED_ATTR}]`)) el.removeAttribute(FILED_ATTR);
    },
  };
}

function styleEl(css: string): HTMLStyleElement {
  const el = document.createElement('style');
  el.textContent = css;
  return el;
}

function downloadFile(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
