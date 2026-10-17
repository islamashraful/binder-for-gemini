import { storage } from '#imports';
import { startApp } from '../app';
import { accountPrefix } from '../core/gemini-dom';
import { createStore } from '../core/store';

export default defineContentScript({
  matches: ['https://gemini.google.com/*'],
  runAt: 'document_idle',

  async main(ctx) {
    // Each signed-in Google account ("/u/1/...") gets its own folders.
    const account = accountPrefix(location.pathname).replace(/\//g, '') || 'u0';
    const item = storage.defineItem<unknown>(`local:folders:${account}`, { fallback: null });

    const store = createStore({
      read: () => item.getValue(),
      write: (value) => item.setValue(value),
      subscribe: (cb) => item.watch(cb),
    });

    const app = await startApp(store);
    ctx.onInvalidated(() => app.stop());
  },
});
