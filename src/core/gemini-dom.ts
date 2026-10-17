// Everything that depends on how Gemini's page is built lives in this file.
// When Google changes the sidebar and the extension breaks, start here.
//
// Checked against gemini.google.com in October 2026:
//   infinite-scroller
//     expandable-section            (Gems / projects)
//     expandable-section[data-test-id=chats-expandable-section]
//       conversations-list[data-test-id=all-conversations]
//         gem-nav-list-item[data-test-id=conversation]
//           a[href="/app/<16 hex chars>"]
//             span.title-text
//           div.hovered-trailing-content
//             gem-icon-button[data-test-id=actions-menu-button] > button   (the ⋯ menu)
//
//   The ⋯ menu opens in .cdk-overlay-container:
//     [role=menu].conversation-actions-menu
//       button[data-test-id=delete-button]
//   which opens a confirmation dialog (mat-dialog-container).

export const SELECTORS = {
  chatsSection: '[data-test-id="chats-expandable-section"]',
  conversationsList: '[data-test-id="all-conversations"], conversations-list',
  chatLink: 'a[href*="/app/"]',
  chatItem: 'gem-nav-list-item',
  chatTitle: '.title-text',
  scroller: 'infinite-scroller',
  chatActionsButton: '[data-test-id="actions-menu-button"] button, button[data-test-id="actions-menu-button"]',
  menuDelete: '[role="menu"] [data-test-id="delete-button"]',
  dialog: 'mat-dialog-container, [role="dialog"], [role="alertdialog"]',
  dialogConfirm: '[data-test-id="confirm-button"]',
  dialogCancel: '[data-test-id="cancel-button"]',
  overlayBackdrop: '.cdk-overlay-backdrop',
} as const;

const CHAT_ID_RE = /\/app\/([0-9a-f]{8,})(?=[/?#]|$)/i;
const ACCOUNT_RE = /^\/u\/(\d+)(?=\/|$)/;

/** "/app/abc123…" → "abc123…". Works with full URLs and "/u/1/app/…" paths. */
export function parseChatId(href: string | null | undefined): string | null {
  if (!href) return null;
  let path = href;
  try {
    path = new URL(href, 'https://gemini.google.com').pathname;
  } catch {
    /* use as-is */
  }
  return CHAT_ID_RE.exec(path)?.[1]?.toLowerCase() ?? null;
}

/** "/u/1/app/…" → "/u/1", "/app/…" → "". Gemini uses this for signed-in account switching. */
export function accountPrefix(pathname: string): string {
  const m = ACCOUNT_RE.exec(pathname);
  return m && m[1] !== '0' ? `/u/${m[1]}` : '';
}

export function chatPath(chatId: string, pathname: string): string {
  return `${accountPrefix(pathname)}/app/${chatId}`;
}

export interface SidebarChat {
  id: string;
  title: string;
  /** The list row (what gets hidden when the chat is in a folder). */
  item: HTMLElement;
  link: HTMLAnchorElement;
}

export function chatTitleFromLink(link: Element): string {
  const fromTitle = link.querySelector(SELECTORS.chatTitle)?.textContent?.trim();
  return fromTitle || link.getAttribute('aria-label')?.trim() || link.textContent?.trim() || '';
}

/** The chats currently loaded in Gemini's sidebar list. */
export function readSidebarChats(doc: Document | Element): SidebarChat[] {
  const list = doc.querySelector(SELECTORS.conversationsList);
  if (!list) return [];
  const out: SidebarChat[] = [];
  const seen = new Set<string>();
  for (const link of list.querySelectorAll<HTMLAnchorElement>(SELECTORS.chatLink)) {
    const id = parseChatId(link.getAttribute('href'));
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      title: chatTitleFromLink(link),
      item: (link.closest(SELECTORS.chatItem) as HTMLElement | null) ?? link,
      link,
    });
  }
  return out;
}

/** If `target` is (inside) one of Gemini's sidebar chat links, returns that chat. */
export function chatFromEventTarget(target: EventTarget | null): { id: string; title: string } | null {
  if (!target || !(target as Element).closest) return null;
  const link = (target as Element).closest(SELECTORS.chatLink);
  if (!link || !link.closest(SELECTORS.conversationsList)) return null;
  const id = parseChatId(link.getAttribute('href'));
  return id ? { id, title: chatTitleFromLink(link) } : null;
}

/** The element our panel is inserted in front of. */
export function findInsertionAnchor(doc: Document): Element | null {
  const section = doc.querySelector(SELECTORS.chatsSection);
  if (section) return section;
  // Fallback for layouts without the expandable section.
  return doc.querySelector(SELECTORS.conversationsList);
}

/** The chat open right now, with its title from the sidebar or the tab title. */
export function currentChat(doc: Document, loc: Location): { id: string; title: string } | null {
  const id = parseChatId(loc.pathname);
  if (!id) return null;
  const inSidebar = readSidebarChats(doc).find((c) => c.id === id);
  const fromTab = doc.title.replace(/\s*[-|–]\s*(Google )?Gemini\s*$/i, '').trim();
  const title = inSidebar?.title || (fromTab && !/^(Google )?Gemini$/i.test(fromTab) ? fromTab : '');
  return { id, title };
}

export function isDarkTheme(doc: Document): boolean {
  const cls = doc.body?.classList;
  if (cls?.contains('dark-theme')) return true;
  if (cls?.contains('light-theme')) return false;
  return doc.defaultView?.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

// ---------------------------------------------------------------- deleting chats
//
// Gemini has no public API for deleting chats, so we do what a person would:
// open the chat's ⋯ menu in the sidebar, pick Delete, confirm. A chat only
// counts as deleted once it disappears from Gemini's list.

export interface DeleteOptions {
  /** Called after each chat, deleted or not. */
  onProgress?(done: number, total: number): void;
  /** Checked between chats; return true to stop early. */
  shouldStop?(): boolean;
  /** How long to wait for a menu or dialog to appear. */
  stepTimeoutMs?: number;
  /** How long to wait for the chat to leave the list after confirming. */
  removeTimeoutMs?: number;
  /** How long to wait for more chats to load when scrolling the list. */
  loadTimeoutMs?: number;
  /** Pause between chats, so Gemini can settle. */
  pauseMs?: number;
}

export type DeleteFailure = 'not-loaded' | 'no-menu' | 'no-confirm' | 'not-removed';

export interface DeleteResult {
  deleted: string[];
  failed: { id: string; reason: DeleteFailure }[];
  /** Chats that were never tried because shouldStop() said so. */
  skipped: string[];
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function waitFor<T>(find: () => T | null | undefined | false, timeoutMs: number): Promise<T | null> {
  const start = Date.now();
  for (;;) {
    const found = find();
    if (found) return found;
    if (Date.now() - start >= timeoutMs) return null;
    await sleep(Math.min(50, timeoutMs));
  }
}

const findChat = (doc: Document, id: string) => readSidebarChats(doc).find((c) => c.id === id);

/** Scrolls Gemini's list to the bottom so it loads older chats. True if more appeared. */
async function loadMoreChats(doc: Document, timeoutMs: number): Promise<boolean> {
  const list = doc.querySelector(SELECTORS.conversationsList);
  const scroller = list?.closest(SELECTORS.scroller) ?? doc.querySelector(SELECTORS.scroller);
  if (!list || !scroller) return false;
  const before = readSidebarChats(doc).length;
  scroller.scrollTop = scroller.scrollHeight;
  scroller.dispatchEvent(new Event('scroll'));
  return !!(await waitFor(() => readSidebarChats(doc).length > before, timeoutMs));
}

function confirmButton(doc: Document): HTMLElement | null {
  for (const dialog of doc.querySelectorAll(SELECTORS.dialog)) {
    const byId = dialog.querySelector<HTMLElement>(SELECTORS.dialogConfirm);
    if (byId) return byId;
    const byText = [...dialog.querySelectorAll<HTMLElement>('button')].find((b) =>
      /^delete$/i.test(b.textContent?.trim() ?? ''),
    );
    if (byText) return byText;
  }
  return null;
}

/** Closes any menu or dialog we opened, without confirming anything. */
function dismiss(doc: Document) {
  for (const dialog of doc.querySelectorAll(SELECTORS.dialog)) {
    dialog.querySelector<HTMLElement>(SELECTORS.dialogCancel)?.click();
  }
  doc.querySelector<HTMLElement>(SELECTORS.overlayBackdrop)?.click();
  const target = doc.activeElement ?? doc.body;
  target?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
}

async function deleteOne(doc: Document, id: string, o: Required<DeleteOptions>): Promise<DeleteFailure | null> {
  const chat = findChat(doc, id);
  if (!chat) return 'not-loaded';

  const opener = chat.item.querySelector<HTMLElement>(SELECTORS.chatActionsButton);
  if (!opener) return 'no-menu';
  opener.click();
  const del = await waitFor(() => doc.querySelector<HTMLElement>(SELECTORS.menuDelete), o.stepTimeoutMs);
  if (!del) {
    dismiss(doc);
    return 'no-menu';
  }
  del.click();

  const confirm = await waitFor(() => confirmButton(doc), o.stepTimeoutMs);
  if (!confirm) {
    dismiss(doc);
    return 'no-confirm';
  }
  confirm.click();

  const gone = await waitFor(() => !findChat(doc, id), o.removeTimeoutMs);
  if (!gone) {
    dismiss(doc);
    return 'not-removed';
  }
  return null;
}

/** Permanently deletes chats from Gemini, one at a time, through its own sidebar menu. */
export async function deleteChats(doc: Document, ids: string[], opts: DeleteOptions = {}): Promise<DeleteResult> {
  const o: Required<DeleteOptions> = {
    onProgress: () => {},
    shouldStop: () => false,
    stepTimeoutMs: 4000,
    removeTimeoutMs: 10_000,
    loadTimeoutMs: 3000,
    pauseMs: 300,
    ...opts,
  };
  const result: DeleteResult = { deleted: [], failed: [], skipped: [] };
  const todo = [...new Set(ids)];

  // Chats deep in the history only exist once the list is scrolled that far.
  const scroller = doc.querySelector(SELECTORS.scroller);
  const scrollTop = scroller?.scrollTop ?? 0;
  let scrolled = false;
  while (!o.shouldStop() && todo.some((id) => !findChat(doc, id))) {
    scrolled = true;
    if (!(await loadMoreChats(doc, o.loadTimeoutMs))) break;
  }
  if (scroller && scrolled) scroller.scrollTop = scrollTop;

  for (let i = 0; i < todo.length; i++) {
    const id = todo[i]!;
    if (o.shouldStop()) {
      result.skipped.push(...todo.slice(i));
      break;
    }
    const failure = await deleteOne(doc, id, o);
    if (failure) result.failed.push({ id, reason: failure });
    else result.deleted.push(id);
    o.onProgress(i + 1, todo.length);
    if (i < todo.length - 1) await sleep(o.pauseMs);
  }
  return result;
}
