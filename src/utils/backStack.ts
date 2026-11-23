/**
 * Layered Android / hardware Back navigation stack.
 *
 * `MainActivity.kt` invokes `window.__agyHandleBack()` on every system Back gesture/button.
 * Handlers are checked from highest priority to lowest:
 *   40 — inline popups / menus (e.g. Composer menu, slash suggestions)
 *   30 — BottomSheet inner sub-pages (e.g. Settings subpage, Model thinking sub-level)
 *   20 — Modal overlays (BottomSheet, CommandPalette)
 *   10 — Side drawer (SessionDrawer)
 *
 * Returning `true` consumes the Back press in JS; returning `false` lets Android call
 * `moveTaskToBack(true)` to background the app while keeping it alive in Recents.
 */

type BackHandler = () => boolean;

interface Entry {
  id: number;
  priority: number;
  handler: BackHandler;
}

let nextId = 1;
const entries: Entry[] = [];

declare global {
  interface Window {
    __agyHandleBack?: () => boolean;
  }
}

function dispatchBack(): boolean {
  const ordered = [...entries].sort((a, b) => b.priority - a.priority || b.id - a.id);
  for (const entry of ordered) {
    try {
      if (entry.handler()) {
        return true;
      }
    } catch {
      // Never let a faulty handler break back navigation.
    }
  }
  return false;
}

if (typeof window !== 'undefined') {
  window.__agyHandleBack = dispatchBack;
}

export function registerBackHandler(priority: number, handler: BackHandler): () => void {
  const id = nextId++;
  entries.push({ id, priority, handler });
  if (typeof window !== 'undefined' && !window.__agyHandleBack) {
    window.__agyHandleBack = dispatchBack;
  }
  return () => {
    const idx = entries.findIndex((item) => item.id === id);
    if (idx !== -1) entries.splice(idx, 1);
  };
}
