// Folder data model. Every function here is pure: it takes a State and
// returns a new one (or the same object when nothing changed), so the UI and
// storage layers can cheaply tell whether anything needs saving.

export const COLORS = [
  'gray',
  'blue',
  'green',
  'yellow',
  'orange',
  'red',
  'pink',
  'purple',
] as const;
export type FolderColor = (typeof COLORS)[number];

export interface Folder {
  id: string;
  name: string;
  color: FolderColor;
  parentId: string | null;
  order: number;
  collapsed: boolean;
  createdAt: number;
}

export interface FiledChat {
  id: string;
  title: string;
  folderId: string;
  addedAt: number;
}

export interface Settings {
  /** Hide chats that are already in a folder from Gemini's own chat list. */
  hideFiled: boolean;
  /** The whole "Folders" section is collapsed. */
  sectionCollapsed: boolean;
}

export interface State {
  version: 1;
  folders: Record<string, Folder>;
  chats: Record<string, FiledChat>;
  settings: Settings;
}

export const MAX_NAME_LENGTH = 80;
export const DEFAULT_FOLDER_NAME = 'New folder';

export function emptyState(): State {
  return {
    version: 1,
    folders: {},
    chats: {},
    settings: { hideFiled: true, sectionCollapsed: false },
  };
}

export function newId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

function clone(state: State): State {
  return {
    version: 1,
    folders: { ...state.folders },
    chats: { ...state.chats },
    settings: { ...state.settings },
  };
}

function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
}

// ---------------------------------------------------------------- queries

export function childrenOf(state: State, parentId: string | null): Folder[] {
  return Object.values(state.folders)
    .filter((f) => f.parentId === parentId)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

/** Chats directly inside a folder, newest first. */
export function chatsIn(state: State, folderId: string): FiledChat[] {
  return Object.values(state.chats)
    .filter((c) => c.folderId === folderId)
    .sort((a, b) => b.addedAt - a.addedAt);
}

/** All folder ids below `folderId` (not including itself). */
export function descendantIds(state: State, folderId: string): string[] {
  const out: string[] = [];
  const stack = [folderId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const f of Object.values(state.folders)) {
      if (f.parentId === id) {
        out.push(f.id);
        stack.push(f.id);
      }
    }
  }
  return out;
}

export function isInside(state: State, folderId: string, ancestorId: string): boolean {
  let cur = state.folders[folderId];
  const seen = new Set<string>();
  while (cur && cur.parentId && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (cur.parentId === ancestorId) return true;
    cur = state.folders[cur.parentId];
  }
  return false;
}

/** Number of chats in a folder, including its subfolders. */
export function countDeep(state: State, folderId: string): number {
  const ids = new Set([folderId, ...descendantIds(state, folderId)]);
  let n = 0;
  for (const c of Object.values(state.chats)) if (ids.has(c.folderId)) n++;
  return n;
}

/** Folders in display order with their depth, for pickers. */
export function flattenTree(state: State): { folder: Folder; depth: number }[] {
  const out: { folder: Folder; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const f of childrenOf(state, parentId)) {
      out.push({ folder: f, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function folderPath(state: State, folderId: string): string[] {
  const names: string[] = [];
  let cur = state.folders[folderId];
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    names.unshift(cur.name);
    cur = cur.parentId ? state.folders[cur.parentId] : undefined!;
  }
  return names;
}

export interface SearchResult {
  folders: Set<string>;
  chats: Set<string>;
}

/**
 * Which folders and chats to show for a search query. Every word in the query
 * must appear in the title (or folder name). A matching folder shows all of
 * its contents; a matching chat shows the folders above it.
 */
export function search(state: State, query: string): SearchResult | null {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return null;
  const matches = (text: string) => {
    const t = text.toLowerCase();
    return terms.every((term) => t.includes(term));
  };

  const folders = new Set<string>();
  const chats = new Set<string>();
  const addAncestors = (folderId: string) => {
    let cur = state.folders[folderId];
    while (cur && !folders.has(cur.id)) {
      folders.add(cur.id);
      cur = cur.parentId ? state.folders[cur.parentId] : undefined!;
    }
  };

  for (const f of Object.values(state.folders)) {
    if (!matches(f.name)) continue;
    addAncestors(f.id);
    for (const id of [f.id, ...descendantIds(state, f.id)]) {
      folders.add(id);
      for (const c of chatsIn(state, id)) chats.add(c.id);
    }
  }
  for (const c of Object.values(state.chats)) {
    if (matches(c.title)) {
      chats.add(c.id);
      addAncestors(c.folderId);
    }
  }
  return { folders, chats };
}

// ---------------------------------------------------------------- folders

export function createFolder(
  state: State,
  opts: { name?: string; parentId?: string | null; color?: FolderColor },
  id: string = newId(),
  now: number = Date.now(),
): { state: State; id: string } {
  const parentId = opts.parentId && state.folders[opts.parentId] ? opts.parentId : null;
  const siblings = childrenOf(state, parentId);
  const next = clone(state);
  next.folders[id] = {
    id,
    name: cleanName(opts.name ?? '') || DEFAULT_FOLDER_NAME,
    color: opts.color ?? 'blue',
    parentId,
    order: siblings.length ? siblings[siblings.length - 1]!.order + 1 : 0,
    collapsed: false,
    createdAt: now,
  };
  if (parentId) next.folders[parentId] = { ...next.folders[parentId]!, collapsed: false };
  return { state: next, id };
}

function patchFolder(state: State, id: string, patch: Partial<Folder>): State {
  const f = state.folders[id];
  if (!f) return state;
  const changed = (Object.keys(patch) as (keyof Folder)[]).some((k) => f[k] !== patch[k]);
  if (!changed) return state;
  const next = clone(state);
  next.folders[id] = { ...f, ...patch };
  return next;
}

export function renameFolder(state: State, id: string, name: string): State {
  const clean = cleanName(name);
  if (!clean) return state;
  return patchFolder(state, id, { name: clean });
}

export function setFolderColor(state: State, id: string, color: FolderColor): State {
  if (!COLORS.includes(color)) return state;
  return patchFolder(state, id, { color });
}

export function setCollapsed(state: State, id: string, collapsed: boolean): State {
  return patchFolder(state, id, { collapsed });
}

/** Deletes a folder and its subfolders. Their chats simply leave the folders. */
export function deleteFolder(state: State, id: string): State {
  if (!state.folders[id]) return state;
  const gone = new Set([id, ...descendantIds(state, id)]);
  const next = clone(state);
  for (const fid of gone) delete next.folders[fid];
  for (const c of Object.values(state.chats)) if (gone.has(c.folderId)) delete next.chats[c.id];
  return next;
}

export type DropPosition = 'before' | 'after' | 'inside';

/**
 * Moves a folder relative to another one. `targetId = null` moves it to the
 * end of the top level. Moving a folder into itself or its own subfolder is
 * ignored.
 */
export function moveFolder(
  state: State,
  id: string,
  targetId: string | null,
  position: DropPosition,
): State {
  const folder = state.folders[id];
  if (!folder) return state;
  if (targetId !== null) {
    if (targetId === id || !state.folders[targetId] || isInside(state, targetId, id)) return state;
  }

  const target = targetId ? state.folders[targetId]! : null;
  const parentId = !target ? null : position === 'inside' ? target.id : target.parentId;
  const siblings = childrenOf(state, parentId).filter((f) => f.id !== id);

  let index = siblings.length;
  if (target && position !== 'inside') {
    index = siblings.findIndex((f) => f.id === target.id) + (position === 'after' ? 1 : 0);
  }
  siblings.splice(index, 0, folder);

  const next = clone(state);
  siblings.forEach((f, i) => {
    next.folders[f.id] = { ...next.folders[f.id]!, order: i };
  });
  next.folders[id] = { ...next.folders[id]!, parentId };
  if (target && position === 'inside') next.folders[target.id]!.collapsed = false;
  return next;
}

// ---------------------------------------------------------------- chats

export function fileChat(
  state: State,
  chat: { id: string; title?: string },
  folderId: string,
  now: number = Date.now(),
): State {
  if (!state.folders[folderId] || !chat.id) return state;
  const existing = state.chats[chat.id];
  const title = (chat.title ?? '').trim() || existing?.title || 'Untitled chat';
  if (existing && existing.folderId === folderId && existing.title === title) return state;
  const next = clone(state);
  next.chats[chat.id] = {
    id: chat.id,
    title,
    folderId,
    addedAt: existing && existing.folderId === folderId ? existing.addedAt : now,
  };
  return next;
}

export function unfileChat(state: State, chatId: string): State {
  if (!state.chats[chatId]) return state;
  const next = clone(state);
  delete next.chats[chatId];
  return next;
}

/** Forgets several chats at once (used after they are deleted from Gemini). */
export function removeChats(state: State, chatIds: Iterable<string>): State {
  let next: State | null = null;
  for (const id of chatIds) {
    if (!state.chats[id]) continue;
    next ??= clone(state);
    delete next.chats[id];
  }
  return next ?? state;
}

/** Ids of the chats in a folder and all its subfolders. */
export function chatIdsDeep(state: State, folderId: string): string[] {
  const ids = new Set([folderId, ...descendantIds(state, folderId)]);
  return Object.values(state.chats)
    .filter((c) => ids.has(c.folderId))
    .map((c) => c.id);
}

/** Keeps stored titles in sync when a chat is renamed in Gemini. */
export function updateTitles(state: State, titles: Map<string, string>): State {
  let next: State | null = null;
  for (const [id, raw] of titles) {
    const title = raw.trim();
    const chat = state.chats[id];
    if (!chat || !title || chat.title === title) continue;
    next ??= clone(state);
    next.chats[id] = { ...chat, title };
  }
  return next ?? state;
}

export function setSetting<K extends keyof Settings>(
  state: State,
  key: K,
  value: Settings[K],
): State {
  if (state.settings[key] === value) return state;
  const next = clone(state);
  next.settings[key] = value;
  return next;
}

// ---------------------------------------------------------------- persistence

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback = 0) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/**
 * Turns anything read from storage or an imported file into a valid State.
 * Bad entries are dropped or repaired instead of throwing, so one broken
 * record never loses the rest.
 */
export function parseState(raw: unknown): State {
  const state = emptyState();
  if (!isObj(raw)) return state;

  if (isObj(raw.folders)) {
    for (const [key, v] of Object.entries(raw.folders)) {
      if (!isObj(v)) continue;
      const id = str(v.id, key);
      if (!id) continue;
      state.folders[id] = {
        id,
        name: cleanName(str(v.name)) || DEFAULT_FOLDER_NAME,
        color: COLORS.includes(v.color as FolderColor) ? (v.color as FolderColor) : 'gray',
        parentId: typeof v.parentId === 'string' ? v.parentId : null,
        order: num(v.order),
        collapsed: v.collapsed === true,
        createdAt: num(v.createdAt),
      };
    }
  }
  // Repair parents that are missing or that form a loop.
  for (const f of Object.values(state.folders)) {
    if (f.parentId && (!state.folders[f.parentId] || f.parentId === f.id)) f.parentId = null;
  }
  for (const f of Object.values(state.folders)) {
    const seen = new Set<string>([f.id]);
    let cur = f.parentId ? state.folders[f.parentId] : undefined;
    while (cur) {
      if (seen.has(cur.id)) {
        f.parentId = null;
        break;
      }
      seen.add(cur.id);
      cur = cur.parentId ? state.folders[cur.parentId] : undefined;
    }
  }

  if (isObj(raw.chats)) {
    for (const [key, v] of Object.entries(raw.chats)) {
      if (!isObj(v)) continue;
      const id = str(v.id, key);
      const folderId = str(v.folderId);
      if (!id || !state.folders[folderId]) continue;
      state.chats[id] = {
        id,
        title: str(v.title).trim() || 'Untitled chat',
        folderId,
        addedAt: num(v.addedAt),
      };
    }
  }

  if (isObj(raw.settings)) {
    if (typeof raw.settings.hideFiled === 'boolean') state.settings.hideFiled = raw.settings.hideFiled;
    if (typeof raw.settings.sectionCollapsed === 'boolean')
      state.settings.sectionCollapsed = raw.settings.sectionCollapsed;
  }
  return state;
}

export const EXPORT_APP_ID = 'binder-for-gemini';

export function exportState(state: State, now: Date = new Date()): string {
  return JSON.stringify(
    { app: EXPORT_APP_ID, exportedAt: now.toISOString(), data: state },
    null,
    2,
  );
}

/** Parses a backup file. Throws an Error with a readable message on bad input. */
export function importState(text: string): State {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  if (!isObj(raw) || raw.app !== EXPORT_APP_ID || !isObj(raw.data)) {
    throw new Error("That file isn't a Binder backup.");
  }
  return parseState(raw.data);
}
