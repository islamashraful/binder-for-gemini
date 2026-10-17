import { describe, expect, test } from 'bun:test';
import {
  chatsIn,
  childrenOf,
  countDeep,
  createFolder,
  deleteFolder,
  descendantIds,
  emptyState,
  exportState,
  fileChat,
  flattenTree,
  folderPath,
  importState,
  isInside,
  moveFolder,
  parseState,
  renameFolder,
  search,
  setCollapsed,
  setFolderColor,
  setSetting,
  unfileChat,
  updateTitles,
  type State,
} from '../src/core/model';

/** Builds:  Research ─┬─ AI ── Papers
 *                     └─ Bio
 *           Personal                          */
function sample() {
  let s = emptyState();
  s = createFolder(s, { name: 'Research' }, 'research', 1).state;
  s = createFolder(s, { name: 'AI', parentId: 'research' }, 'ai', 2).state;
  s = createFolder(s, { name: 'Bio', parentId: 'research' }, 'bio', 3).state;
  s = createFolder(s, { name: 'Papers', parentId: 'ai' }, 'papers', 4).state;
  s = createFolder(s, { name: 'Personal' }, 'personal', 5).state;
  s = fileChat(s, { id: 'c1', title: 'Transformers explained' }, 'ai', 10);
  s = fileChat(s, { id: 'c2', title: 'Attention paper notes' }, 'papers', 11);
  s = fileChat(s, { id: 'c3', title: 'CRISPR basics' }, 'bio', 12);
  s = fileChat(s, { id: 'c4', title: 'Kyoto trip' }, 'personal', 13);
  return s;
}

const names = (s: State, parent: string | null) => childrenOf(s, parent).map((f) => f.name);

describe('folders', () => {
  test('create adds folders in order, with defaults', () => {
    const s = sample();
    expect(names(s, null)).toEqual(['Research', 'Personal']);
    expect(names(s, 'research')).toEqual(['AI', 'Bio']);
    expect(s.folders.ai!.color).toBe('blue');
  });

  test('create cleans the name and falls back to "New folder"', () => {
    let s = emptyState();
    s = createFolder(s, { name: '   lots   of   space  ' }, 'a').state;
    s = createFolder(s, { name: '   ' }, 'b').state;
    s = createFolder(s, { name: 'x'.repeat(200) }, 'c').state;
    expect(s.folders.a!.name).toBe('lots of space');
    expect(s.folders.b!.name).toBe('New folder');
    expect(s.folders.c!.name.length).toBe(80);
  });

  test('create under a missing parent goes to the top level', () => {
    const s = createFolder(emptyState(), { name: 'X', parentId: 'nope' }, 'x').state;
    expect(s.folders.x!.parentId).toBeNull();
  });

  test('create inside a collapsed folder expands it', () => {
    let s = setCollapsed(sample(), 'research', true);
    s = createFolder(s, { name: 'New', parentId: 'research' }).state;
    expect(s.folders.research!.collapsed).toBe(false);
  });

  test('does not modify the input state', () => {
    const s = sample();
    const before = JSON.stringify(s);
    createFolder(s, { name: 'Z' });
    renameFolder(s, 'ai', 'ML');
    deleteFolder(s, 'research');
    moveFolder(s, 'bio', null, 'inside');
    fileChat(s, { id: 'new', title: 'n' }, 'ai');
    expect(JSON.stringify(s)).toBe(before);
  });

  test('rename, color, collapse return the same object when nothing changes', () => {
    const s = sample();
    expect(renameFolder(s, 'ai', 'AI')).toBe(s);
    expect(renameFolder(s, 'ai', '   ')).toBe(s);
    expect(renameFolder(s, 'missing', 'x')).toBe(s);
    expect(setFolderColor(s, 'ai', 'blue')).toBe(s);
    expect(setFolderColor(s, 'ai', 'chartreuse' as never)).toBe(s);
    expect(setCollapsed(s, 'ai', false)).toBe(s);
    expect(renameFolder(s, 'ai', 'ML').folders.ai!.name).toBe('ML');
    expect(setFolderColor(s, 'ai', 'red').folders.ai!.color).toBe('red');
  });

  test('delete removes subfolders and unfiles their chats', () => {
    const s = deleteFolder(sample(), 'research');
    expect(Object.keys(s.folders)).toEqual(['personal']);
    expect(Object.keys(s.chats)).toEqual(['c4']);
  });

  test('tree helpers', () => {
    const s = sample();
    expect(descendantIds(s, 'research').sort()).toEqual(['ai', 'bio', 'papers']);
    expect(isInside(s, 'papers', 'research')).toBe(true);
    expect(isInside(s, 'research', 'papers')).toBe(false);
    expect(countDeep(s, 'research')).toBe(3);
    expect(countDeep(s, 'ai')).toBe(2);
    expect(folderPath(s, 'papers')).toEqual(['Research', 'AI', 'Papers']);
    expect(flattenTree(s).map((x) => `${x.depth}:${x.folder.name}`)).toEqual([
      '0:Research',
      '1:AI',
      '2:Papers',
      '1:Bio',
      '0:Personal',
    ]);
  });
});

describe('moveFolder', () => {
  test('before / after reorders siblings', () => {
    let s = moveFolder(sample(), 'personal', 'research', 'before');
    expect(names(s, null)).toEqual(['Personal', 'Research']);
    s = moveFolder(s, 'personal', 'research', 'after');
    expect(names(s, null)).toEqual(['Research', 'Personal']);
  });

  test('before / after a folder at another level changes parent', () => {
    const s = moveFolder(sample(), 'personal', 'bio', 'before');
    expect(s.folders.personal!.parentId).toBe('research');
    expect(names(s, 'research')).toEqual(['AI', 'Personal', 'Bio']);
  });

  test('inside nests at the end and expands the target', () => {
    let s = setCollapsed(sample(), 'personal', true);
    s = moveFolder(s, 'bio', 'personal', 'inside');
    expect(s.folders.bio!.parentId).toBe('personal');
    expect(s.folders.personal!.collapsed).toBe(false);
    expect(names(s, 'research')).toEqual(['AI']);
  });

  test('null target moves to the end of the top level', () => {
    const s = moveFolder(sample(), 'papers', null, 'inside');
    expect(s.folders.papers!.parentId).toBeNull();
    expect(names(s, null)).toEqual(['Research', 'Personal', 'Papers']);
  });

  test('refuses to move a folder into itself or its descendants', () => {
    const s = sample();
    expect(moveFolder(s, 'research', 'research', 'inside')).toBe(s);
    expect(moveFolder(s, 'research', 'papers', 'inside')).toBe(s);
    expect(moveFolder(s, 'research', 'papers', 'before')).toBe(s);
    expect(moveFolder(s, 'missing', 'ai', 'inside')).toBe(s);
    expect(moveFolder(s, 'ai', 'missing', 'inside')).toBe(s);
  });
});

describe('chats', () => {
  test('file, move, unfile', () => {
    let s = sample();
    expect(chatsIn(s, 'ai').map((c) => c.id)).toEqual(['c1']);
    s = fileChat(s, { id: 'c1', title: 'Transformers explained' }, 'bio', 50);
    expect(s.chats.c1!.folderId).toBe('bio');
    expect(s.chats.c1!.addedAt).toBe(50);
    // newest first
    expect(chatsIn(s, 'bio').map((c) => c.id)).toEqual(['c1', 'c3']);
    s = unfileChat(s, 'c1');
    expect(s.chats.c1).toBeUndefined();
    expect(unfileChat(s, 'c1')).toBe(s);
  });

  test('filing into the same folder again is a no-op', () => {
    const s = sample();
    expect(fileChat(s, { id: 'c1', title: 'Transformers explained' }, 'ai')).toBe(s);
    expect(fileChat(s, { id: 'c1', title: '' }, 'ai')).toBe(s);
  });

  test('filing keeps the old title when the new one is empty', () => {
    const s = fileChat(sample(), { id: 'c1', title: '  ' }, 'bio');
    expect(s.chats.c1!.title).toBe('Transformers explained');
    expect(fileChat(emptyState(), { id: 'x' }, 'nope').chats).toEqual({});
    const t = createFolder(emptyState(), { name: 'A' }, 'a').state;
    expect(fileChat(t, { id: 'x' }, 'a').chats.x!.title).toBe('Untitled chat');
  });

  test('updateTitles only changes what differs', () => {
    const s = sample();
    expect(updateTitles(s, new Map([['c1', 'Transformers explained']]))).toBe(s);
    expect(updateTitles(s, new Map([['unknown', 'x'], ['c1', '  ']]))).toBe(s);
    const t = updateTitles(s, new Map([['c1', 'Transformers, explained simply']]));
    expect(t.chats.c1!.title).toBe('Transformers, explained simply');
    expect(t.chats.c2).toBe(s.chats.c2);
  });

  test('settings', () => {
    const s = sample();
    expect(setSetting(s, 'hideFiled', true)).toBe(s);
    expect(setSetting(s, 'hideFiled', false).settings.hideFiled).toBe(false);
  });
});

describe('search', () => {
  test('empty query means no filter', () => {
    expect(search(sample(), '   ')).toBeNull();
  });

  test('a chat match shows its folders above it', () => {
    const r = search(sample(), 'attention')!;
    expect([...r.chats]).toEqual(['c2']);
    expect([...r.folders].sort()).toEqual(['ai', 'papers', 'research']);
  });

  test('a folder match shows everything inside it', () => {
    const r = search(sample(), 'ai')!;
    expect([...r.folders].sort()).toEqual(['ai', 'papers', 'research']);
    expect([...r.chats].sort()).toEqual(['c1', 'c2']);
  });

  test('all words must match, case-insensitive', () => {
    expect([...search(sample(), 'CRISPR basics')!.chats]).toEqual(['c3']);
    expect(search(sample(), 'crispr kyoto')!.chats.size).toBe(0);
  });
});

describe('parseState', () => {
  test('garbage becomes an empty state', () => {
    for (const raw of [null, undefined, 42, 'x', [], { folders: 'no' }]) {
      expect(parseState(raw)).toEqual(emptyState());
    }
  });

  test('round-trips a valid state', () => {
    const s = sample();
    expect(parseState(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  test('repairs bad records instead of failing', () => {
    const s = parseState({
      folders: {
        a: { name: 'A', color: 'neon', parentId: 'ghost' },
        b: { id: 'b', name: '', parentId: 'c' },
        c: { id: 'c', name: 'C', parentId: 'b' }, // loop b <-> c
        d: 'not a folder',
        e: { id: 'e', name: 'Self', parentId: 'e' },
      },
      chats: {
        x: { folderId: 'a', title: 'X', addedAt: 'soon' },
        y: { id: 'y', folderId: 'ghost', title: 'Y' },
        z: { id: 'z', folderId: 'b' },
      },
      settings: { hideFiled: false, sectionCollapsed: 'yes' },
    });
    expect(s.folders.a).toMatchObject({ name: 'A', color: 'gray', parentId: null, order: 0 });
    expect(s.folders.b!.name).toBe('New folder');
    expect(s.folders.d).toBeUndefined();
    expect(s.folders.e!.parentId).toBeNull();
    // the loop is broken somewhere, so walking up always ends
    for (const id of ['b', 'c']) expect(folderPath(s, id).length).toBeLessThanOrEqual(2);
    expect(s.folders.b!.parentId === null || s.folders.c!.parentId === null).toBe(true);
    expect(s.chats.x).toMatchObject({ id: 'x', folderId: 'a', addedAt: 0 });
    expect(s.chats.y).toBeUndefined();
    expect(s.chats.z!.title).toBe('Untitled chat');
    expect(s.settings).toEqual({ hideFiled: false, sectionCollapsed: false });
  });
});

describe('backup', () => {
  test('export then import gives the same data', () => {
    const s = sample();
    const text = exportState(s, new Date('2026-10-17T00:00:00Z'));
    expect(JSON.parse(text).exportedAt).toBe('2026-10-17T00:00:00.000Z');
    expect(importState(text)).toEqual(s);
  });

  test('import rejects files that are not backups', () => {
    expect(() => importState('{oops')).toThrow("isn't valid JSON");
    expect(() => importState('{"app":"other","data":{}}')).toThrow("isn't a Binder backup");
    expect(() => importState('[]')).toThrow("isn't a Binder backup");
  });
});
