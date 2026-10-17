import { parseState, type State } from './model';

/** Where folder data is kept. The extension uses chrome.storage; tests use memory. */
export interface StateStore {
  load(): Promise<State>;
  save(state: State): Promise<void>;
  /** Called when the data changes somewhere else (another tab). */
  watch(cb: (state: State) => void): () => void;
}

/** Shared change-detection: ignores the echo of our own writes. */
export function createStore(backend: {
  read(): Promise<unknown>;
  write(value: State): Promise<void>;
  subscribe(cb: (value: unknown) => void): () => void;
}): StateStore {
  let lastJson = '';
  return {
    async load() {
      const raw = await backend.read();
      const state = parseState(raw);
      lastJson = JSON.stringify(state);
      return state;
    },
    async save(state) {
      lastJson = JSON.stringify(state);
      await backend.write(state);
    },
    watch(cb) {
      return backend.subscribe((raw) => {
        const json = JSON.stringify(raw ?? null);
        if (json === lastJson) return;
        const state = parseState(raw);
        lastJson = JSON.stringify(state);
        cb(state);
      });
    },
  };
}

/** In-memory store for tests and the dev harness. */
export function createMemoryStore(initial: unknown = null) {
  let value: unknown = initial;
  const listeners = new Set<(v: unknown) => void>();
  const store = createStore({
    read: async () => value,
    write: async (v) => {
      value = structuredClone(v);
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  });
  return {
    store,
    peek: () => value as State | null,
    /** Simulates a change made in another tab. */
    external(next: unknown) {
      value = structuredClone(next);
      for (const l of listeners) l(value);
    },
  };
}
