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
  return document.querySelector<HTMLElement>(`a[href="/app/${id}"]`)!.closest('gem-nav-list-item')!;
}
