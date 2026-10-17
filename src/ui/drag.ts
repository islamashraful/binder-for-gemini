// What is being dragged right now. Browsers hide drag data until the drop,
// so we track it here; Gemini's sidebar and our panel share this module.

export type DragItem =
  | { kind: 'chat'; id: string; title: string }
  | { kind: 'folder'; id: string };

let current: DragItem | null = null;

export const drag = {
  start(item: DragItem, e?: DragEvent) {
    current = item;
    if (e?.dataTransfer) {
      e.dataTransfer.effectAllowed = 'copyMove';
      // Some browsers won't start a drag without data.
      if (item.kind === 'folder') e.dataTransfer.setData('text/plain', item.id);
    }
  },
  get(): DragItem | null {
    return current;
  },
  end() {
    current = null;
  },
};
