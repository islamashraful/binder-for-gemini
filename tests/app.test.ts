// End-to-end tests: the real controller and panel running on a copy of
// Gemini's sidebar markup, driven through clicks, typing, and drag events.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { startApp, type App } from '../src/app';
import { createFolder, emptyState, fileChat } from '../src/core/model';
import { createMemoryStore } from '../src/core/store';
import { CHATS, addSidebarChat, mountGemini, nativeItem } from './fixture';

let app: App;
let mem: ReturnType<typeof createMemoryStore>;
let log: string[];

async function start(seed: unknown = null) {
  mem = createMemoryStore(seed);
  log = [];
  app = await startApp(mem.store, {
    pollMs: 60_000,
    debounceMs: 0,
    download: (name, text) => log.push(`download:${name}:${text.length > 0}`),
    navigate: (path) => log.push(`navigate:${path}`),
  });
}

const panel = () => document.querySelector('binder-for-gemini')!.shadowRoot!;
const layer = () => document.querySelector('binder-for-gemini-layer')!.shadowRoot!;
const $ = (sel: string) => panel().querySelector<HTMLElement>(sel);
const $$ = (sel: string) => [...panel().querySelectorAll<HTMLElement>(sel)];
const labels = () => $$('.row .label').map((el) => el.textContent);
const button = (label: string) => $(`button[aria-label="${label}"]`)!;
const menuItem = (text: string) =>
  [...layer().querySelectorAll<HTMLElement>('.menu-item, .btn')].find((el) =>
    el.textContent?.includes(text),
  )!;
const folderRow = (name: string) =>
  $$('.row.folder').find((r) => r.querySelector('.label')?.textContent === name)!;

function type(input: HTMLInputElement, text: string, key?: string) {
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  if (key) input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

function dragEvent(type: string, target: EventTarget) {
  const e = new Event(type, { bubbles: true, cancelable: true, composed: true });
  target.dispatchEvent(e);
  return e;
}

/** Drags one of Gemini's own sidebar chats onto a folder row in our panel. */
function dragNativeChatTo(chatId: string, target: HTMLElement) {
  const link = document.querySelector(`a[href="/app/${chatId}"]`)!;
  dragEvent('dragstart', link);
  const over = dragEvent('dragover', target);
  dragEvent('drop', target);
  dragEvent('dragend', link);
  return over.defaultPrevented; // true = the target accepted the drop
}

function seeded() {
  let s = emptyState();
  s = createFolder(s, { name: 'Research' }, 'research', 1).state;
  s = createFolder(s, { name: 'Biology', parentId: 'research' }, 'bio', 2).state;
  s = createFolder(s, { name: 'Travel' }, 'travel', 3).state;
  s = fileChat(s, CHATS[0]!, 'bio', 10);
  return s;
}

beforeEach(() => {
  history.replaceState(null, '', '/app');
  mountGemini();
});
afterEach(() => app?.stop());

describe('mounting', () => {
  test('inserts the panel right above Gemini’s Chats section', async () => {
    await start();
    const host = document.querySelector('binder-for-gemini')!;
    expect(host.nextElementSibling?.getAttribute('data-test-id')).toBe('chats-expandable-section');
    expect($('.binder')!.dataset.theme).toBe('dark');
    expect($('.empty')!.textContent).toContain('Organize your chats');
  });

  test('re-inserts itself when Gemini re-renders the sidebar', async () => {
    await start(seeded());
    mountGemini(); // wipes the sidebar, like a re-render
    expect(document.querySelector('binder-for-gemini')).toBeNull();
    app.sync();
    expect(document.querySelector('binder-for-gemini')?.nextElementSibling?.getAttribute('data-test-id')).toBe(
      'chats-expandable-section',
    );
    expect(nativeItem(CHATS[0]!.id).hasAttribute('data-binder-filed')).toBe(true);
  });

  test('stop() removes everything it added', async () => {
    await start(seeded());
    app.stop();
    expect(document.querySelector('binder-for-gemini')).toBeNull();
    expect(document.querySelector('binder-for-gemini-layer')).toBeNull();
    expect(document.getElementById('binder-page-css')).toBeNull();
    expect(document.querySelector('[data-binder-filed]')).toBeNull();
    expect(document.documentElement.classList.contains('binder-hide-filed')).toBe(false);
  });
});

describe('folders', () => {
  test('create a folder with the + button', async () => {
    await start();
    button('New folder').click();
    const input = $('.row-input') as HTMLInputElement;
    expect(input).toBeTruthy();
    type(input, '  Climate research ', 'Enter');
    expect(labels()).toEqual(['Climate research']);
    expect(Object.values(mem.peek()!.folders).map((f) => f.name)).toEqual(['Climate research']);
  });

  test('Escape or an empty name cancels creating', async () => {
    await start();
    button('New folder').click();
    type($('.row-input') as HTMLInputElement, 'Nope', 'Escape');
    expect($('.row-input')).toBeNull();
    button('New folder').click();
    type($('.row-input') as HTMLInputElement, '   ', 'Enter');
    expect(Object.keys(app.getState().folders)).toEqual([]);
  });

  test('shows nested folders, counts, and collapses on click', async () => {
    await start(seeded());
    expect(labels()).toEqual(['Research', 'Biology', CHATS[0]!.title, 'Travel']);
    expect(folderRow('Research').querySelector('.count')!.textContent).toBe('1');
    folderRow('Research').click();
    expect(labels()).toEqual(['Research', 'Travel']);
    expect(mem.peek()!.folders.research!.collapsed).toBe(true);
    folderRow('Research').click();
    expect(labels()).toContain('Biology');
  });

  test('rename from the folder menu', async () => {
    await start(seeded());
    button('Options for Travel').click();
    menuItem('Rename').click();
    type($('.row-input') as HTMLInputElement, 'Trips', 'Enter');
    expect(labels()).toContain('Trips');
    expect(app.getState().folders.travel!.name).toBe('Trips');
  });

  test('change color from the folder menu', async () => {
    await start(seeded());
    button('Options for Travel').click();
    layer().querySelector<HTMLElement>('[aria-label="Color green"]')!.click();
    expect(app.getState().folders.travel!.color).toBe('green');
    expect(folderRow('Travel').querySelector('.icon.c-green')).toBeTruthy();
  });

  test('new subfolder from the folder menu', async () => {
    await start(seeded());
    button('Options for Travel').click();
    menuItem('New subfolder').click();
    type($('.row-input') as HTMLInputElement, 'Japan', 'Enter');
    const japan = Object.values(app.getState().folders).find((f) => f.name === 'Japan')!;
    expect(japan.parentId).toBe('travel');
  });

  test('delete asks first, then unfiles the chats', async () => {
    await start(seeded());
    button('Options for Research').click();
    menuItem('Delete folder').click();
    expect(layer().textContent).toContain('Delete “Research” and its 1 subfolder?');
    expect(layer().textContent).toContain('1 chat will go back to your chat list');
    menuItem('Cancel').click();
    expect(app.getState().folders.research).toBeTruthy();

    button('Options for Research').click();
    menuItem('Delete folder').click();
    [...layer().querySelectorAll<HTMLElement>('.btn.danger')][0]!.click();
    expect(Object.keys(app.getState().folders)).toEqual(['travel']);
    expect(app.getState().chats).toEqual({});
    expect(nativeItem(CHATS[0]!.id).hasAttribute('data-binder-filed')).toBe(false);
  });

  test('drag a folder onto another to nest it, onto the header to un-nest', async () => {
    await start(seeded());
    const travel = folderRow('Travel');
    dragEvent('dragstart', travel);
    dragEvent('dragover', folderRow('Research'));
    dragEvent('drop', folderRow('Research'));
    expect(app.getState().folders.travel!.parentId).toBe('research');

    dragEvent('dragstart', folderRow('Travel'));
    dragEvent('dragover', $('.hdr')!);
    dragEvent('drop', $('.hdr')!);
    expect(app.getState().folders.travel!.parentId).toBeNull();
  });

  test('cannot drop a folder into its own subfolder', async () => {
    await start(seeded());
    dragEvent('dragstart', folderRow('Research'));
    const over = dragEvent('dragover', folderRow('Biology'));
    expect(over.defaultPrevented).toBe(false);
  });
});

describe('filing chats', () => {
  test('drag a chat from Gemini’s list into a folder; it is hidden from the list', async () => {
    await start(seeded());
    const chat = CHATS[2]!;
    expect(dragNativeChatTo(chat.id, folderRow('Travel'))).toBe(true);
    expect(app.getState().chats[chat.id]).toMatchObject({ title: chat.title, folderId: 'travel' });
    expect(nativeItem(chat.id).hasAttribute('data-binder-filed')).toBe(true);
    expect(document.documentElement.classList.contains('binder-hide-filed')).toBe(true);
    expect(labels()).toContain(chat.title);
  });

  test('dropping a chat on the empty hint creates a folder for it', async () => {
    await start();
    dragNativeChatTo(CHATS[1]!.id, $('.empty')!);
    const folders = Object.values(app.getState().folders);
    expect(folders.length).toBe(1);
    expect(app.getState().chats[CHATS[1]!.id]!.folderId).toBe(folders[0]!.id);
    // goes straight to naming the new folder
    expect(($('.row-input') as HTMLInputElement).value).toBe('New folder');
  });

  test('drag a filed chat to another folder', async () => {
    await start(seeded());
    const row = $$('.row.chat')[0]!;
    dragEvent('dragstart', row);
    dragEvent('dragover', folderRow('Travel'));
    dragEvent('drop', folderRow('Travel'));
    expect(app.getState().chats[CHATS[0]!.id]!.folderId).toBe('travel');
  });

  test('remove a chat from its folder with the × button', async () => {
    await start(seeded());
    button(`Remove ${CHATS[0]!.title} from folder`).click();
    expect(app.getState().chats).toEqual({});
    expect(nativeItem(CHATS[0]!.id).hasAttribute('data-binder-filed')).toBe(false);
  });

  test('file the open chat with the header button', async () => {
    history.replaceState(null, '', `/app/${CHATS[2]!.id}`);
    await start(seeded());
    button('Add this chat to a folder').click();
    expect(layer().textContent).toContain('Add this chat to');
    menuItem('Travel').click();
    expect(app.getState().chats[CHATS[2]!.id]!.folderId).toBe('travel');
    // now it's highlighted in the tree and the button offers to move it
    expect($('.row.chat.active')!.textContent).toContain(CHATS[2]!.title);
    expect(button('Move this chat to another folder')).toBeTruthy();
  });

  test('file the open chat into a brand-new folder', async () => {
    history.replaceState(null, '', `/app/${CHATS[2]!.id}`);
    await start(seeded());
    button('Add this chat to a folder').click();
    menuItem('New folder').click();
    type($('.row-input') as HTMLInputElement, 'Japan', 'Enter');
    const japan = Object.values(app.getState().folders).find((f) => f.name === 'Japan')!;
    expect(app.getState().chats[CHATS[2]!.id]!.folderId).toBe(japan.id);
  });

  test('“Hide filed chats” can be turned off', async () => {
    await start(seeded());
    button('More options').click();
    menuItem('Hide filed chats').click();
    expect(app.getState().settings.hideFiled).toBe(false);
    expect(document.documentElement.classList.contains('binder-hide-filed')).toBe(false);
  });
});

describe('keeping in sync with Gemini', () => {
  test('picks up renamed chats', async () => {
    await start(seeded());
    nativeItem(CHATS[0]!.id).querySelector('.title-text')!.textContent = 'Protein folding, part 2';
    app.sync();
    expect(app.getState().chats[CHATS[0]!.id]!.title).toBe('Protein folding, part 2');
    expect(labels()).toContain('Protein folding, part 2');
  });

  test('marks chats that load later as you scroll', async () => {
    let s = seeded();
    s = fileChat(s, { id: '9999888877776666', title: 'Older chat' }, 'travel', 20);
    await start(s);
    addSidebarChat({ id: '9999888877776666', title: 'Older chat' });
    app.sync();
    expect(nativeItem('9999888877776666').hasAttribute('data-binder-filed')).toBe(true);
  });

  test('highlights the open chat after navigating', async () => {
    await start(seeded());
    expect($('.row.chat.active')).toBeNull();
    history.pushState(null, '', `/app/${CHATS[0]!.id}`);
    app.sync();
    expect($('.row.chat.active')).toBeTruthy();
  });

  test('applies changes made in another tab', async () => {
    await start(seeded());
    const next = structuredClone(mem.peek()!);
    next.folders.travel!.name = 'Holidays';
    mem.external(next);
    expect(labels()).toContain('Holidays');
  });
});

describe('opening chats', () => {
  test('clicks Gemini’s own link so the page does not reload', async () => {
    await start(seeded());
    let clicked = '';
    document.querySelector(`a[href="/app/${CHATS[0]!.id}"]`)!.addEventListener('click', (e) => {
      clicked = CHATS[0]!.id;
      e.preventDefault();
    });
    $$('.row.chat')[0]!.click();
    expect(clicked).toBe(CHATS[0]!.id);
    expect(log).toEqual([]);
  });

  test('navigates directly when the chat is not loaded in the sidebar', async () => {
    history.replaceState(null, '', '/u/1/app');
    const s = fileChat(seeded(), { id: '9999888877776666', title: 'Old' }, 'travel', 20);
    await start(s);
    const row = $$('.row.chat').find((r) => r.textContent?.includes('Old'))!;
    expect(row.getAttribute('href')).toBe('/u/1/app/9999888877776666');
    row.click();
    expect(log).toEqual(['navigate:/u/1/app/9999888877776666']);
  });

  test('cmd/ctrl-click is left to the browser (new tab)', async () => {
    await start(seeded());
    const e = new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true });
    $$('.row.chat')[0]!.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });
});

describe('search and backup', () => {
  test('search filters the tree and Escape clears it', async () => {
    await start(seeded());
    const input = $('.search input') as HTMLInputElement;
    type(input, 'protein');
    expect(labels()).toEqual(['Research', 'Biology', CHATS[0]!.title]);
    type(input, 'zzz');
    expect($('.no-results')).toBeTruthy();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(labels()).toContain('Travel');
  });

  test('typing in our inputs does not reach Gemini’s keyboard shortcuts', async () => {
    await start(seeded());
    let reached = false;
    const listener = () => (reached = true);
    document.addEventListener('keydown', listener);
    ($('.search input') as HTMLInputElement).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'a', bubbles: true, composed: true }),
    );
    document.removeEventListener('keydown', listener);
    expect(reached).toBe(false);
  });

  test('export downloads a backup file', async () => {
    await start(seeded());
    button('More options').click();
    menuItem('Export backup').click();
    expect(log[0]).toMatch(/^download:binder-backup-\d{4}-\d{2}-\d{2}\.json:true$/);
  });

  test('menus close on outside click and Escape', async () => {
    await start(seeded());
    button('More options').click();
    expect(layer().querySelector('.menu')).toBeTruthy();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
    expect(layer().querySelector('.menu')).toBeNull();
    button('More options').click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(layer().querySelector('.menu')).toBeNull();
  });
});
