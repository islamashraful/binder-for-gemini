// A small copy of Gemini's sidebar markup (structure checked October 2026).

export interface FixtureChat {
  id: string;
  title: string;
}

export const CHATS: FixtureChat[] = [
  { id: 'aaaa1111bbbb2222', title: 'Protein folding papers' },
  { id: 'cccc3333dddd4444', title: 'Battery chemistry overview' },
  { id: 'eeee5555ffff6666', title: 'Trip ideas for Kyoto' },
];

function chatItem(c: FixtureChat): string {
  return `<gem-nav-list-item data-test-id="conversation">
      <a class="mat-mdc-list-item gem-nav-list-item" href="/app/${c.id}" aria-label="${c.title}">
        <span class="mdc-list-item__content"><span class="title-text gds-body-s">${c.title}</span></span>
      </a>
      <div class="hovered-trailing-content">
        <gem-icon-button data-test-id="actions-menu-button" aria-haspopup="menu">
          <button aria-label="Open menu for conversation actions."></button>
        </gem-icon-button>
      </div>
    </gem-nav-list-item>`;
}

export function mountGemini(chats: FixtureChat[] = CHATS, theme: 'dark' | 'light' = 'dark') {
  document.body.className = `${theme}-theme`;
  document.body.innerHTML = `
    <bard-sidenav>
      <infinite-scroller>
        <mat-nav-list><a href="/gems/view">Gems</a></mat-nav-list>
        <expandable-section><project-sidenav-list></project-sidenav-list></expandable-section>
        <expandable-section data-test-id="chats-expandable-section">
          <conversations-list data-test-id="all-conversations">
            <mat-nav-list class="gds-sidenav-list">${chats.map(chatItem).join('')}</mat-nav-list>
          </conversations-list>
        </expandable-section>
      </infinite-scroller>
    </bard-sidenav>
    <main><chat-window></chat-window></main>`;
}

export function addSidebarChat(c: FixtureChat) {
  document
    .querySelector('[data-test-id="all-conversations"] mat-nav-list')!
    .insertAdjacentHTML('beforeend', chatItem(c));
}

export function nativeItem(id: string): HTMLElement {
  return document.querySelector<HTMLElement>(`a[href="/app/${id}"]`)?.closest('gem-nav-list-item')!;
}

/**
 * Makes the fake page behave like Gemini's delete flow: ⋯ opens a menu,
 * Delete opens a confirmation dialog, confirming removes the chat.
 *   broken: chats whose delete never goes through
 *   older:  chats that only load after scrolling the list
 */
export function fakeGeminiDeletes(opts: { broken?: string[]; older?: FixtureChat[] } = {}) {
  const log: string[] = [];
  const older = [...(opts.older ?? [])];
  const overlay = document.createElement('div');
  overlay.className = 'cdk-overlay-container';
  document.body.appendChild(overlay);
  const later = (fn: () => void) => setTimeout(fn, 5);

  const onClick = (e: Event) => {
    const t = e.target as Element;
    const opener = t.closest?.('[data-test-id="actions-menu-button"]');
    if (opener) {
      const id = opener.closest('gem-nav-list-item')!.querySelector('a')!.getAttribute('href')!.split('/').pop()!;
      log.push(`menu:${id}`);
      later(() => {
        overlay.innerHTML = `<div class="cdk-overlay-backdrop"></div>
          <div class="cdk-overlay-pane"><div role="menu" class="conversation-actions-menu">
            <button data-test-id="share-button">Share conversation</button>
            <button data-test-id="delete-button" data-chat="${id}">Delete</button>
          </div></div>`;
      });
    } else if (t.closest?.('.cdk-overlay-backdrop')) {
      overlay.replaceChildren();
    } else if (t.closest?.('[data-test-id="delete-button"]')) {
      const id = (t.closest('[data-test-id="delete-button"]') as HTMLElement).dataset.chat!;
      overlay.replaceChildren();
      later(() => {
        overlay.innerHTML = `<mat-dialog-container role="dialog">
          <h2>Delete chat?</h2>
          <button data-test-id="cancel-button">Cancel</button>
          <button data-test-id="confirm-button" data-chat="${id}">Delete</button>
        </mat-dialog-container>`;
      });
    } else if (t.closest?.('[data-test-id="cancel-button"]')) {
      log.push('cancel');
      overlay.replaceChildren();
    } else if (t.closest?.('[data-test-id="confirm-button"]')) {
      const id = (t.closest('[data-test-id="confirm-button"]') as HTMLElement).dataset.chat!;
      overlay.replaceChildren();
      log.push(`confirm:${id}`);
      if (!opts.broken?.includes(id)) later(() => nativeItem(id)?.remove());
    }
  };
  const onScroll = () => {
    const next = older.shift();
    if (next) later(() => addSidebarChat(next));
  };
  document.addEventListener('click', onClick);
  document.querySelector('infinite-scroller')!.addEventListener('scroll', onScroll);
  return {
    log,
    stop() {
      document.removeEventListener('click', onClick);
      overlay.remove();
    },
  };
}
