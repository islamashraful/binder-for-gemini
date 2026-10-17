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

export const SELECTORS = {
  chatsSection: '[data-test-id="chats-expandable-section"]',
  conversationsList: '[data-test-id="all-conversations"], conversations-list',
  chatLink: 'a[href*="/app/"]',
  chatItem: 'gem-nav-list-item',
  chatTitle: '.title-text',
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
