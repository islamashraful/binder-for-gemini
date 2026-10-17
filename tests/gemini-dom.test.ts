import { beforeEach, describe, expect, test } from 'bun:test';
import {
  accountPrefix,
  chatFromEventTarget,
  chatPath,
  currentChat,
  deleteChats,
  findInsertionAnchor,
  isDarkTheme,
  parseChatId,
  readSidebarChats,
} from '../src/core/gemini-dom';
import { CHATS, fakeGeminiDeletes, mountGemini } from './fixture';

describe('URLs', () => {
  test('parseChatId', () => {
    expect(parseChatId('/app/aaaa1111bbbb2222')).toBe('aaaa1111bbbb2222');
    expect(parseChatId('/u/1/app/AAAA1111BBBB2222')).toBe('aaaa1111bbbb2222');
    expect(parseChatId('https://gemini.google.com/app/aaaa1111bbbb2222?hl=en')).toBe('aaaa1111bbbb2222');
    expect(parseChatId('/app/aaaa1111bbbb2222#x')).toBe('aaaa1111bbbb2222');
    expect(parseChatId('/app')).toBeNull();
    expect(parseChatId('/app/')).toBeNull();
    expect(parseChatId('/app/not-hex-id')).toBeNull();
    expect(parseChatId('/gems/view')).toBeNull();
    expect(parseChatId(null)).toBeNull();
    expect(parseChatId('')).toBeNull();
  });

  test('accountPrefix and chatPath keep the signed-in account', () => {
    expect(accountPrefix('/app/abc')).toBe('');
    expect(accountPrefix('/u/0/app/abc')).toBe('');
    expect(accountPrefix('/u/2/app/abc')).toBe('/u/2');
    expect(accountPrefix('/u/2')).toBe('/u/2');
    expect(accountPrefix('/user/2/app')).toBe('');
    expect(chatPath('abc123', '/u/2/app')).toBe('/u/2/app/abc123');
    expect(chatPath('abc123', '/app')).toBe('/app/abc123');
  });
});

describe('sidebar', () => {
  beforeEach(() => mountGemini());

  test('reads chats with ids, titles, and their list rows', () => {
    const chats = readSidebarChats(document);
    expect(chats.map((c) => c.id)).toEqual(CHATS.map((c) => c.id));
    expect(chats.map((c) => c.title)).toEqual(CHATS.map((c) => c.title));
    expect(chats[0]!.item.tagName).toBe('GEM-NAV-LIST-ITEM');
    expect(chats[0]!.link.tagName).toBe('A');
  });

  test('ignores links outside the chat list (e.g. Gems)', () => {
    document.querySelector('mat-nav-list')!.insertAdjacentHTML('beforeend', '<a href="/app/123456789abc">x</a>');
    expect(readSidebarChats(document).length).toBe(CHATS.length);
  });

  test('falls back to aria-label when the title span is missing', () => {
    document.querySelector('.title-text')!.remove();
    expect(readSidebarChats(document)[0]!.title).toBe(CHATS[0]!.title);
  });

  test('returns nothing when the list is not on the page', () => {
    document.body.innerHTML = '<main></main>';
    expect(readSidebarChats(document)).toEqual([]);
    expect(findInsertionAnchor(document)).toBeNull();
  });

  test('insertion anchor is the Chats section, or the list as a fallback', () => {
    expect(findInsertionAnchor(document)!.getAttribute('data-test-id')).toBe('chats-expandable-section');
    const list = document.querySelector('conversations-list')!;
    document.querySelector('infinite-scroller')!.replaceChildren(list);
    expect(findInsertionAnchor(document)).toBe(list);
  });

  test('chatFromEventTarget finds the chat from any element inside its link', () => {
    const span = document.querySelector('.title-text')!;
    expect(chatFromEventTarget(span)).toEqual(CHATS[0]!);
    expect(chatFromEventTarget(document.body)).toBeNull();
    expect(chatFromEventTarget(null)).toBeNull();
  });

  test('currentChat uses the sidebar title, then the tab title', () => {
    const loc = (pathname: string) => ({ pathname }) as Location;
    expect(currentChat(document, loc('/app'))).toBeNull();
    expect(currentChat(document, loc(`/app/${CHATS[1]!.id}`))).toEqual(CHATS[1]!);
    document.title = 'Old research - Gemini';
    expect(currentChat(document, loc('/app/0123456789abcdef'))).toEqual({
      id: '0123456789abcdef',
      title: 'Old research',
    });
    document.title = 'Google Gemini';
    expect(currentChat(document, loc('/app/0123456789abcdef'))!.title).toBe('');
  });

  test('theme detection', () => {
    expect(isDarkTheme(document)).toBe(true);
    document.body.className = 'light-theme';
    expect(isDarkTheme(document)).toBe(false);
  });
});

describe('deleteChats', () => {
  beforeEach(() => mountGemini());
  const fast = { stepTimeoutMs: 200, removeTimeoutMs: 200, loadTimeoutMs: 100, pauseMs: 0 };
  const ids = () => readSidebarChats(document).map((c) => c.id);

  test('goes through the ⋯ menu and the confirm dialog for each chat', async () => {
    const fake = fakeGeminiDeletes();
    const progress: string[] = [];
    const result = await deleteChats(document, [CHATS[0]!.id, CHATS[2]!.id], {
      ...fast,
      onProgress: (done, total) => progress.push(`${done}/${total}`),
    });
    fake.stop();
    expect(result).toEqual({ deleted: [CHATS[0]!.id, CHATS[2]!.id], failed: [], skipped: [] });
    expect(ids()).toEqual([CHATS[1]!.id]);
    expect(progress).toEqual(['1/2', '2/2']);
    expect(fake.log).toEqual([`menu:${CHATS[0]!.id}`, `confirm:${CHATS[0]!.id}`, `menu:${CHATS[2]!.id}`, `confirm:${CHATS[2]!.id}`]);
  });

  test('scrolls the list to load older chats first', async () => {
    const old = { id: '0123456789abcdef', title: 'Very old chat' };
    const fake = fakeGeminiDeletes({ older: [old] });
    const result = await deleteChats(document, [old.id], fast);
    fake.stop();
    expect(result.deleted).toEqual([old.id]);
  });

  test('reports chats it could not find or that did not go away', async () => {
    const fake = fakeGeminiDeletes({ broken: [CHATS[1]!.id] });
    const result = await deleteChats(document, ['ffffffffffffffff', CHATS[1]!.id], fast);
    fake.stop();
    expect(result.deleted).toEqual([]);
    expect(result.failed).toEqual([
      { id: 'ffffffffffffffff', reason: 'not-loaded' },
      { id: CHATS[1]!.id, reason: 'not-removed' },
    ]);
  });

  test('closes the menu and confirms nothing when there is no delete dialog', async () => {
    // A page with no fake menus: clicking ⋯ does nothing.
    const result = await deleteChats(document, [CHATS[0]!.id], fast);
    expect(result.failed).toEqual([{ id: CHATS[0]!.id, reason: 'no-menu' }]);
    expect(ids()).toHaveLength(3);
  });

  test('stops between chats when asked', async () => {
    const fake = fakeGeminiDeletes();
    let stop = false;
    const result = await deleteChats(document, CHATS.map((c) => c.id), {
      ...fast,
      shouldStop: () => stop,
      onProgress: () => (stop = true),
    });
    fake.stop();
    expect(result.deleted).toEqual([CHATS[0]!.id]);
    expect(result.skipped).toEqual([CHATS[1]!.id, CHATS[2]!.id]);
  });
});
