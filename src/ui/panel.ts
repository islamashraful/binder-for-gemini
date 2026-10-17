import {
  COLORS,
  DEFAULT_FOLDER_NAME,
  MAX_NAME_LENGTH,
  childrenOf,
  chatsIn,
  countDeep,
  descendantIds,
  emptyState,
  flattenTree,
  folderPath,
  isInside,
  search,
  type DropPosition,
  type FiledChat,
  type Folder,
  type FolderColor,
  type Settings,
  type State,
} from '../core/model';
import { chatPath } from '../core/gemini-dom';
import { drag } from './drag';
import { append, h, icon, type Child, type IconName } from './dom';

export interface ChatRef {
  id: string;
  title: string;
}

export interface PanelContext {
  /** Chat open in the page right now (highlighted in the tree). */
  currentChat: ChatRef | null;
  pathname: string;
}

/** Everything the panel can ask for. The controller applies it and re-renders. */
export interface PanelActions {
  createFolder(name: string, parentId: string | null): string;
  renameFolder(id: string, name: string): void;
  setColor(id: string, color: FolderColor): void;
  setCollapsed(id: string, collapsed: boolean): void;
  deleteFolder(id: string): void;
  moveFolder(id: string, targetId: string | null, position: DropPosition): void;
  fileChat(chat: ChatRef, folderId: string): void;
  unfileChat(chatId: string): void;
  openChat(chatId: string, e: MouseEvent): void;
  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void;
  exportData(): void;
  /** Returns an error message, or null when it worked. */
  importData(text: string): string | null;
}

type Menu =
  | { kind: 'folder'; id: string; confirmDelete?: boolean }
  | { kind: 'more' }
  | { kind: 'picker' };
type OpenMenu = Menu & { x: number; y: number; top: number };

type Editing =
  | { kind: 'rename'; id: string }
  | { kind: 'create'; parentId: string | null; fileChat?: ChatRef };

const menuKey = (m: Menu) => (m.kind === 'folder' ? `folder:${m.id}` : m.kind);
const DROP_CLASSES = ['drop-before', 'drop-after', 'drop-inside'];

export interface Panel {
  render(state: State, ctx: PanelContext): void;
  setTheme(dark: boolean): void;
  clearDrop(): void;
  closeMenu(): void;
  destroy(): void;
}

/**
 * @param root  where the folder tree goes (inside Gemini's sidebar)
 * @param layerRoot  where menus go (a full-page overlay, so the sidebar can't clip them)
 */
export function createPanel(root: Node, layerRoot: Node, actions: PanelActions): Panel {
  let state: State = emptyState();
  let ctx: PanelContext = { currentChat: null, pathname: '/app' };

  const ui = {
    query: '',
    editing: null as Editing | null,
    draft: '',
    focusEditor: false,
    menu: null as OpenMenu | null,
  };
  let rendering = false;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let marked: HTMLElement | null = null;

  // ---------------------------------------------------------------- skeleton

  const searchInput = h('input', {
    type: 'text',
    placeholder: 'Search folders',
    'aria-label': 'Search folders and filed chats',
    spellcheck: 'false',
    autocomplete: 'off',
    onInput: () => {
      ui.query = searchInput.value;
      renderTree();
    },
    onKeydown: (e: KeyboardEvent) => {
      if (e.key === 'Escape' && searchInput.value) {
        searchInput.value = '';
        ui.query = '';
        renderTree();
      }
    },
  });
  const searchBox = h('label', { class: 'search' }, icon('search'), searchInput);
  const tree = h('div', { class: 'tree', role: 'tree', 'aria-label': 'Folders' });
  const toast = h('div', { class: 'toast', role: 'status', hidden: true });
  const fileInput = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    hidden: true,
    onChange: onImportFile,
  });

  const header = h('div', {
    class: 'hdr',
    onDragover: (e: DragEvent) => {
      // Dropping a folder on the header moves it to the top level.
      if (drag.get()?.kind !== 'folder') return;
      e.preventDefault();
      clearDrop();
      header.classList.add('drop');
    },
    onDragleave: (e: DragEvent) => {
      if (!header.contains(e.relatedTarget as Node)) header.classList.remove('drop');
    },
    onDrop: (e: DragEvent) => {
      const d = drag.get();
      clearDrop();
      if (d?.kind !== 'folder') return;
      e.preventDefault();
      drag.end();
      actions.moveFolder(d.id, null, 'inside');
    },
  });
  const body = h('div', { class: 'body' }, searchBox, tree, toast);
  const wrap = h('div', { class: 'binder' }, header, body, fileInput);
  const layer = h('div', { class: 'binder layer' });

  // Keep typing in our inputs from reaching Gemini's page-wide shortcuts.
  for (const type of ['keydown', 'keyup', 'keypress']) {
    wrap.addEventListener(type, (e) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') e.stopPropagation();
    });
  }

  root.appendChild(wrap);
  layerRoot.appendChild(layer);

  const onPointerDown = (e: PointerEvent) => {
    if (!ui.menu) return;
    const key = menuKey(ui.menu);
    for (const node of e.composedPath()) {
      if (node === layer.firstChild) return;
      if (node instanceof HTMLElement && node.dataset.opener === key) return;
    }
    closeMenu();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && ui.menu) closeMenu();
  };
  const panelHost = (root as ShadowRoot).host ?? root;
  const onViewportChange = (e: Event) => {
    if (!ui.menu) return;
    // Only scrolling the sidebar moves our buttons. The chat area scrolls
    // constantly while Gemini is answering, and the menu can scroll itself.
    if (e.type === 'scroll') {
      const t = e.target;
      const movesPanel = t === document || (t instanceof Node && t.contains(panelHost));
      if (!movesPanel) return;
    }
    closeMenu();
  };
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('resize', onViewportChange);
  document.addEventListener('scroll', onViewportChange, true);

  // ---------------------------------------------------------------- render

  function render() {
    renderHeader();
    const collapsed = state.settings.sectionCollapsed;
    body.hidden = collapsed;
    searchBox.hidden = Object.keys(state.folders).length === 0;
    renderTree();
    renderMenu();
  }

  function renderHeader() {
    const collapsed = state.settings.sectionCollapsed;
    const cur = ctx.currentChat;
    const filed = cur ? state.chats[cur.id] : undefined;
    const pickerOpen = ui.menu?.kind === 'picker';
    header.replaceChildren();
    append(header, [
      h(
        'button',
        {
          class: 'hdr-toggle',
          'aria-expanded': String(!collapsed),
          title: collapsed ? 'Show folders' : 'Hide folders',
          onClick: () => actions.setSetting('sectionCollapsed', !collapsed),
        },
        h('span', null, 'Folders'),
        icon('chevron'),
      ),
      cur
        ? h(
            'button',
            {
              class: `icon-btn${filed || pickerOpen ? ' on' : ''}`,
              title: filed
                ? `This chat is in “${folderPath(state, filed.folderId).join(' / ')}”`
                : 'Add this chat to a folder',
              'aria-label': filed ? 'Move this chat to another folder' : 'Add this chat to a folder',
              dataset: { opener: 'picker' },
              onClick: (e: MouseEvent) => toggleMenu({ kind: 'picker' }, e.currentTarget as HTMLElement),
            },
            icon('fileInto'),
          )
        : null,
      h(
        'button',
        { class: 'icon-btn', title: 'New folder', 'aria-label': 'New folder', onClick: () => startCreate(null) },
        icon('newFolder'),
      ),
      h(
        'button',
        {
          class: 'icon-btn',
          title: 'More options',
          'aria-label': 'More options',
          dataset: { opener: 'more' },
          onClick: (e: MouseEvent) => toggleMenu({ kind: 'more' }, e.currentTarget as HTMLElement),
        },
        icon('more'),
      ),
    ]);
  }

  const pad = (depth: number) => ({ paddingLeft: `${8 + depth * 16}px` });

  function renderTree() {
    const active = (root as ShadowRoot).activeElement ?? document.activeElement;
    const editorHadFocus = active instanceof HTMLInputElement && active.classList.contains('row-input');
    const selection = editorHadFocus
      ? [active.selectionStart ?? ui.draft.length, active.selectionEnd ?? ui.draft.length]
      : null;

    rendering = true;
    const result = search(state, ui.query);
    const rows: Node[] = [];
    const creatingIn = ui.editing?.kind === 'create' ? ui.editing.parentId : undefined;

    if (creatingIn === null) rows.push(newFolderRow(0));
    const walk = (parentId: string | null, depth: number) => {
      for (const f of childrenOf(state, parentId)) {
        if (result && !result.folders.has(f.id)) continue;
        const open = result ? true : !f.collapsed;
        rows.push(folderRow(f, depth, open));
        if (!open) continue;
        if (creatingIn === f.id) rows.push(newFolderRow(depth + 1));
        walk(f.id, depth + 1);
        for (const c of chatsIn(state, f.id)) {
          if (result && !result.chats.has(c.id)) continue;
          rows.push(chatRow(c, depth + 1));
        }
      }
    };
    walk(null, 0);

    if (!Object.keys(state.folders).length && !ui.editing) rows.push(emptyHint());
    else if (result && !rows.length) rows.push(h('div', { class: 'no-results' }, 'No matching folders or chats'));

    marked = null;
    tree.replaceChildren(...rows);
    rendering = false;

    const editor = tree.querySelector<HTMLInputElement>('.row-input');
    if (editor && (ui.focusEditor || editorHadFocus)) {
      editor.focus();
      if (ui.focusEditor) editor.select();
      else if (selection) editor.setSelectionRange(selection[0]!, selection[1]!);
      ui.focusEditor = false;
    }
  }

  function folderRow(f: Folder, depth: number, open: boolean): HTMLElement {
    const count = countDeep(state, f.id);
    const hasContent = count > 0 || childrenOf(state, f.id).length > 0;
    const renaming = ui.editing?.kind === 'rename' && ui.editing.id === f.id;
    const menuOpen = ui.menu?.kind === 'folder' && ui.menu.id === f.id;

    const row: HTMLElement = h(
      'div',
      {
        class: 'row folder',
        role: 'treeitem',
        'aria-level': depth + 1,
        'aria-expanded': hasContent ? String(open) : undefined,
        tabIndex: 0,
        draggable: !renaming,
        style: pad(depth),
        dataset: { folderId: f.id },
        onClick: () => {
          if (!renaming && !ui.query) actions.setCollapsed(f.id, open);
        },
        onDblclick: (e: MouseEvent) => {
          e.preventDefault();
          startRename(f.id);
        },
        onKeydown: (e: KeyboardEvent) => {
          if (e.target !== row) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            actions.setCollapsed(f.id, open);
          } else if (e.key === 'ArrowRight' && !open) actions.setCollapsed(f.id, false);
          else if (e.key === 'ArrowLeft' && open) actions.setCollapsed(f.id, true);
          else if (e.key === 'F2') startRename(f.id);
        },
        onDragstart: (e: DragEvent) => {
          drag.start({ kind: 'folder', id: f.id }, e);
          row.classList.add('dragging');
        },
        onDragend: () => row.classList.remove('dragging'),
        onDragover: (e: DragEvent) => {
          const pos = folderDropPosition(e, row, f);
          if (!pos) return;
          e.preventDefault();
          markDrop(row, pos);
        },
        onDragleave: (e: DragEvent) => {
          if (!row.contains(e.relatedTarget as Node)) unmark(row);
        },
        onDrop: (e: DragEvent) => {
          const pos = folderDropPosition(e, row, f);
          const d = drag.get();
          clearDrop();
          if (!pos || !d) return;
          e.preventDefault();
          drag.end();
          if (d.kind === 'chat') actions.fileChat(d, f.id);
          else actions.moveFolder(d.id, f.id, pos);
        },
      },
      h('span', { class: `caret${open ? ' open' : ''}${hasContent ? '' : ' empty'}` }, icon('chevron')),
      icon('folder', `c-${f.color}`),
      renaming ? editor(`Rename ${f.name}`) : h('span', { class: 'label', title: f.name }, f.name),
      renaming ? null : h('span', { class: 'count' }, count ? String(count) : ''),
      renaming
        ? null
        : h(
            'button',
            {
              class: `act${menuOpen ? ' open' : ''}`,
              title: 'Folder options',
              'aria-label': `Options for ${f.name}`,
              'aria-haspopup': 'menu',
              dataset: { opener: `folder:${f.id}` },
              onClick: (e: MouseEvent) => {
                e.stopPropagation();
                toggleMenu({ kind: 'folder', id: f.id }, e.currentTarget as HTMLElement);
              },
              onDblclick: (e: MouseEvent) => e.stopPropagation(),
            },
            icon('more'),
          ),
    );
    return row;
  }

  function chatRow(c: FiledChat, depth: number): HTMLElement {
    const active = ctx.currentChat?.id === c.id;
    const row: HTMLElement = h(
      'a',
      {
        class: `row chat${active ? ' active' : ''}`,
        href: chatPath(c.id, ctx.pathname),
        role: 'treeitem',
        'aria-level': depth + 1,
        'aria-current': active ? 'page' : undefined,
        title: c.title,
        draggable: true,
        style: pad(depth),
        onClick: (e: MouseEvent) => actions.openChat(c.id, e),
        onDragstart: (e: DragEvent) => {
          drag.start({ kind: 'chat', id: c.id, title: c.title }, e);
          row.classList.add('dragging');
        },
        onDragend: () => row.classList.remove('dragging'),
        // Dropping a chat on another chat puts it in that chat's folder.
        onDragover: (e: DragEvent) => {
          const d = drag.get();
          if (d?.kind !== 'chat' || d.id === c.id) return;
          e.preventDefault();
          markDrop(row, 'inside');
        },
        onDragleave: (e: DragEvent) => {
          if (!row.contains(e.relatedTarget as Node)) unmark(row);
        },
        onDrop: (e: DragEvent) => {
          const d = drag.get();
          clearDrop();
          if (d?.kind !== 'chat' || d.id === c.id) return;
          e.preventDefault();
          drag.end();
          actions.fileChat(d, c.folderId);
        },
      },
      h('span', { class: 'caret empty' }),
      h('span', { class: 'label' }, c.title),
      h(
        'button',
        {
          class: 'act',
          title: 'Remove from folder',
          'aria-label': `Remove ${c.title} from folder`,
          onClick: (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            actions.unfileChat(c.id);
          },
        },
        icon('close'),
      ),
    );
    return row;
  }

  function newFolderRow(depth: number): HTMLElement {
    return h(
      'div',
      { class: 'row editing', style: pad(depth) },
      h('span', { class: 'caret empty' }),
      icon('folder', 'c-blue'),
      editor('New folder name'),
    );
  }

  function emptyHint(): HTMLElement {
    const el: HTMLElement = h(
      'div',
      {
        class: 'empty',
        onDragover: (e: DragEvent) => {
          if (drag.get()?.kind !== 'chat') return;
          e.preventDefault();
          el.classList.add('drop');
        },
        onDragleave: () => el.classList.remove('drop'),
        onDrop: (e: DragEvent) => {
          const d = drag.get();
          el.classList.remove('drop');
          if (d?.kind !== 'chat') return;
          e.preventDefault();
          drag.end();
          const id = actions.createFolder(DEFAULT_FOLDER_NAME, null);
          actions.fileChat(d, id);
          startRename(id);
        },
      },
      h('b', null, 'Organize your chats.'),
      ' Create a folder with the + button, then drag chats from the list below into it. ',
      'Or drop a chat right here.',
    );
    return el;
  }

  function editor(label: string): HTMLInputElement {
    const input: HTMLInputElement = h('input', {
      class: 'row-input',
      type: 'text',
      value: ui.draft,
      maxlength: MAX_NAME_LENGTH,
      placeholder: DEFAULT_FOLDER_NAME,
      'aria-label': label,
      spellcheck: 'false',
      autocomplete: 'off',
      onInput: () => {
        ui.draft = input.value;
      },
      onKeydown: (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitEdit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancelEdit();
        }
      },
      onBlur: () => {
        if (!rendering) commitEdit();
      },
      onClick: (e: MouseEvent) => e.stopPropagation(),
      onDblclick: (e: MouseEvent) => e.stopPropagation(),
    });
    return input;
  }

  // ---------------------------------------------------------------- editing

  function startCreate(parentId: string | null, fileChat?: ChatRef) {
    ui.menu = null;
    clearSearch();
    if (state.settings.sectionCollapsed) actions.setSetting('sectionCollapsed', false);
    if (parentId && state.folders[parentId]?.collapsed) actions.setCollapsed(parentId, false);
    ui.editing = { kind: 'create', parentId, fileChat };
    ui.draft = '';
    ui.focusEditor = true;
    render();
  }

  function startRename(id: string) {
    const f = state.folders[id];
    if (!f) return;
    ui.menu = null;
    clearSearch();
    if (state.settings.sectionCollapsed) actions.setSetting('sectionCollapsed', false);
    ui.editing = { kind: 'rename', id };
    ui.draft = f.name;
    ui.focusEditor = true;
    render();
  }

  function commitEdit() {
    const editing = ui.editing;
    if (!editing) return;
    ui.editing = null;
    const name = ui.draft.trim();
    if (editing.kind === 'rename') {
      if (name) actions.renameFolder(editing.id, name);
    } else if (name || editing.fileChat) {
      const id = actions.createFolder(name || DEFAULT_FOLDER_NAME, editing.parentId);
      if (editing.fileChat) actions.fileChat(editing.fileChat, id);
    }
    render();
  }

  function cancelEdit() {
    ui.editing = null;
    render();
  }

  function clearSearch() {
    if (!ui.query) return;
    ui.query = '';
    searchInput.value = '';
  }

  // ---------------------------------------------------------------- drag & drop

  function folderDropPosition(e: DragEvent, row: HTMLElement, f: Folder): DropPosition | null {
    const d = drag.get();
    if (!d) return null;
    if (d.kind === 'chat') return 'inside';
    if (d.id === f.id || isInside(state, f.id, d.id)) return null;
    const r = row.getBoundingClientRect();
    const y = e.clientY - r.top;
    if (y < r.height * 0.25) return 'before';
    if (y > r.height * 0.75) return 'after';
    return 'inside';
  }

  function markDrop(el: HTMLElement, pos: DropPosition) {
    if (marked && marked !== el) unmark(marked);
    header.classList.remove('drop');
    el.classList.remove(...DROP_CLASSES);
    el.classList.add(`drop-${pos}`);
    marked = el;
  }

  function unmark(el: HTMLElement) {
    el.classList.remove(...DROP_CLASSES);
    if (marked === el) marked = null;
  }

  function clearDrop() {
    if (marked) unmark(marked);
    header.classList.remove('drop');
    tree.querySelector('.empty.drop')?.classList.remove('drop');
  }

  // ---------------------------------------------------------------- menus

  function toggleMenu(menu: Menu, opener: HTMLElement) {
    if (ui.menu && menuKey(ui.menu) === menuKey(menu)) {
      closeMenu();
      return;
    }
    const r = opener.getBoundingClientRect();
    ui.menu = { ...menu, x: r.left, y: r.bottom + 4, top: r.top };
    render();
  }

  function closeMenu() {
    if (!ui.menu) return;
    ui.menu = null;
    render();
  }

  function menuItem(
    iconName: IconName,
    label: string,
    onClick: () => void,
    opts: { disabled?: boolean; danger?: boolean; keepOpen?: boolean } = {},
  ): HTMLElement {
    return h(
      'button',
      {
        class: `menu-item${opts.danger ? ' danger' : ''}`,
        role: 'menuitem',
        disabled: opts.disabled ?? false,
        onClick: () => {
          if (!opts.keepOpen) ui.menu = null;
          onClick();
          render();
        },
      },
      icon(iconName),
      h('span', { class: 'grow' }, label),
    );
  }

  const sep = () => h('div', { class: 'menu-sep', role: 'separator' });

  function renderMenu() {
    const m = ui.menu;
    if (!m) {
      layer.replaceChildren();
      return;
    }
    let items: Child[] = [];
    if (m.kind === 'folder') {
      const f = state.folders[m.id];
      if (!f) {
        ui.menu = null;
        layer.replaceChildren();
        return;
      }
      items = m.confirmDelete ? deleteConfirm(f) : folderMenu(f);
    } else if (m.kind === 'more') {
      items = moreMenu();
    } else {
      if (!ctx.currentChat) {
        ui.menu = null;
        layer.replaceChildren();
        return;
      }
      items = pickerMenu(ctx.currentChat);
    }

    const el = h('div', { class: 'menu', role: 'menu' }, items);
    layer.replaceChildren(el);

    // Keep the menu on screen: flip above the button if there's no room below.
    const w = el.offsetWidth;
    const ht = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(8, Math.min(m.x, vw - w - 8));
    let top = m.y;
    if (top + ht > vh - 8) top = Math.max(8, m.top - ht - 4);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  function folderMenu(f: Folder): Child[] {
    const cur = ctx.currentChat;
    const curHere = cur ? state.chats[cur.id]?.folderId === f.id : false;
    return [
      cur
        ? menuItem('fileInto', curHere ? 'Current chat is in here' : 'Add current chat here', () =>
            actions.fileChat(cur, f.id),
          { disabled: curHere })
        : null,
      menuItem('newFolder', 'New subfolder', () => startCreate(f.id)),
      menuItem('edit', 'Rename', () => startRename(f.id)),
      sep(),
      h('div', { class: 'menu-title' }, 'Color'),
      h(
        'div',
        { class: 'swatches' },
        COLORS.map((c) =>
          h('button', {
            class: `swatch c-${c}${f.color === c ? ' sel' : ''}`,
            title: c[0]!.toUpperCase() + c.slice(1),
            'aria-label': `Color ${c}`,
            'aria-pressed': String(f.color === c),
            onClick: () => actions.setColor(f.id, c),
          }),
        ),
      ),
      sep(),
      menuItem(
        'delete',
        'Delete folder',
        () => {
          if (ui.menu?.kind === 'folder') ui.menu = { ...ui.menu, confirmDelete: true };
        },
        { danger: true, keepOpen: true },
      ),
    ];
  }

  function deleteConfirm(f: Folder): Child[] {
    const subs = descendantIds(state, f.id).length;
    const chats = countDeep(state, f.id);
    const what = subs ? `“${f.name}” and its ${subs} subfolder${subs > 1 ? 's' : ''}` : `“${f.name}”`;
    const detail = chats
      ? `${chats} chat${chats > 1 ? 's' : ''} will go back to your chat list. Nothing is deleted from Gemini.`
      : 'Nothing is deleted from Gemini.';
    return [
      h(
        'div',
        { class: 'confirm' },
        h('div', null, `Delete ${what}?`),
        h('div', { class: 'menu-foot', style: { padding: '6px 0 0' } }, detail),
        h(
          'div',
          { class: 'confirm-actions' },
          h('button', { class: 'btn', onClick: () => closeMenu() }, 'Cancel'),
          h(
            'button',
            {
              class: 'btn danger',
              onClick: () => {
                ui.menu = null;
                actions.deleteFolder(f.id);
                render();
              },
            },
            'Delete',
          ),
        ),
      ),
    ];
  }

  function moreMenu(): Child[] {
    const hide = state.settings.hideFiled;
    const folders = Object.keys(state.folders).length;
    const chats = Object.keys(state.chats).length;
    return [
      h(
        'button',
        {
          class: `menu-item${hide ? ' checked' : ''}`,
          role: 'menuitemcheckbox',
          'aria-checked': String(hide),
          onClick: () => actions.setSetting('hideFiled', !hide),
        },
        icon('check', 'tick'),
        h('span', { class: 'grow' }, 'Hide filed chats from the list'),
      ),
      sep(),
      menuItem('download', 'Export backup', () => actions.exportData()),
      menuItem('upload', 'Restore from backup…', () => fileInput.click()),
      h(
        'div',
        { class: 'menu-foot' },
        `${folders} folder${folders === 1 ? '' : 's'} · ${chats} chat${chats === 1 ? '' : 's'} filed`,
      ),
    ];
  }

  function pickerMenu(cur: ChatRef): Child[] {
    const filed = state.chats[cur.id];
    return [
      h('div', { class: 'menu-title' }, filed ? 'Move this chat to' : 'Add this chat to'),
      flattenTree(state).map(({ folder, depth }) =>
        h(
          'button',
          {
            class: `menu-item${filed?.folderId === folder.id ? ' checked' : ''}`,
            role: 'menuitemradio',
            'aria-checked': String(filed?.folderId === folder.id),
            style: { paddingLeft: `${16 + depth * 16}px` },
            onClick: () => {
              ui.menu = null;
              actions.fileChat(cur, folder.id);
              render();
            },
          },
          icon('folder', `c-${folder.color}`),
          h('span', { class: 'grow' }, folder.name),
          icon('check', 'tick'),
        ),
      ),
      Object.keys(state.folders).length ? sep() : null,
      menuItem('newFolder', 'New folder…', () => startCreate(null, cur)),
      filed ? menuItem('remove', 'Remove from folder', () => actions.unfileChat(cur.id)) : null,
    ];
  }

  // ---------------------------------------------------------------- import

  async function onImportFile() {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    const error = actions.importData(await file.text());
    showToast(error ?? 'Backup restored.', !!error);
  }

  function showToast(text: string, error = false) {
    clearTimeout(toastTimer);
    toast.textContent = text;
    toast.className = `toast${error ? ' error' : ''}`;
    toast.hidden = false;
    toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, 5000);
  }

  // ---------------------------------------------------------------- public

  return {
    render(nextState, nextCtx) {
      state = nextState;
      ctx = nextCtx;
      if (ui.editing?.kind === 'rename' && !state.folders[ui.editing.id]) ui.editing = null;
      render();
    },
    setTheme(dark) {
      const theme = dark ? 'dark' : 'light';
      wrap.dataset.theme = theme;
      layer.dataset.theme = theme;
    },
    clearDrop,
    closeMenu,
    destroy() {
      clearTimeout(toastTimer);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', onViewportChange);
      document.removeEventListener('scroll', onViewportChange, true);
      wrap.remove();
      layer.remove();
    },
  };
}
