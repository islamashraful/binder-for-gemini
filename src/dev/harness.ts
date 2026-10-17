// Dev only: runs the extension on a live Gemini tab without installing it,
// using throwaway in-memory storage (nothing is saved; reload to undo).
// Build with `bun run harness`, then in the DevTools console on
// gemini.google.com run the file's contents through a Trusted Types policy
// (Gemini blocks plain eval):
//   eval(trustedTypes.createPolicy('dev', { createScript: s => s }).createScript(code))
// Set window.__binderSeed to a saved state first to start with some folders.
import { startApp } from '../app';
import { createMemoryStore } from '../core/store';

type HarnessWindow = Window & {
  __binder?: { stop(): void; app: Awaited<ReturnType<typeof startApp>>; mem: ReturnType<typeof createMemoryStore> };
  __binderSeed?: unknown;
  __binderLog?: string[];
};

void (async () => {
  const w = window as HarnessWindow;
  w.__binder?.stop();
  const log: string[] = (w.__binderLog = []);
  const mem = createMemoryStore(w.__binderSeed ?? null);
  const app = await startApp(mem.store, {
    download: (name) => log.push(`download:${name}`),
    navigate: (path) => log.push(`navigate:${path}`),
  });
  w.__binder = { app, mem, stop: () => app.stop() };
  console.log('[Binder] dev harness running');
})();
