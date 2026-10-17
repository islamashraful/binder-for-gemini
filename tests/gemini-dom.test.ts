import { beforeEach, describe, expect, test } from 'bun:test';
import {
  accountPrefix,
  chatFromEventTarget,
  chatPath,
  currentChat,
  findInsertionAnchor,
  isDarkTheme,
  parseChatId,
  readSidebarChats,
} from '../src/core/gemini-dom';
import { CHATS, mountGemini } from './fixture';

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
