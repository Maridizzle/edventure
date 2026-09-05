import { get, set } from 'idb-keyval';

/**
 * His collection, kept on the device.
 *
 * Worth being exact about what this is, because "it saves" is a promise made to
 * a child. IndexedDB is site storage, NOT the HTTP cache -- clearing cached
 * files does not touch it. `navigator.storage.persist()` then asks the browser
 * to mark it exempt from automatic eviction, which Chrome grants for an app
 * installed to the home screen. So it survives closing the app, rebooting the
 * phone, and being offline. It does not survive uninstalling the app or
 * clearing the site's data, and it does not follow him to another phone.
 *
 * Every path here swallows its own failures. A save that cannot be written must
 * never take the game down with it -- he would lose the room he is in as well
 * as the collection, which is strictly worse than not saving at all.
 */

const KEY = 'edventure.save.v1';

/** Writes coalesce: finding four things in one splash is one write, not four. */
const DEBOUNCE_MS = 500;

export interface SaveData {
  /** Collectible ids, oldest find first. */
  found: string[];
}

/**
 * Ask for storage that the browser will not quietly evict.
 *
 * Best called from a user gesture -- some browsers weigh engagement -- and its
 * answer is informational: false is not a failure, just "best effort storage",
 * which is still far better than the nothing we had before.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    const s = navigator.storage;
    if (!s?.persist) return false;
    if (await s.persisted?.()) return true;
    return await s.persist();
  } catch {
    return false;
  }
}

export async function loadSave(): Promise<SaveData | null> {
  try {
    const v = (await get(KEY)) as SaveData | undefined;
    if (!v || !Array.isArray(v.found)) return null;
    return { found: v.found.filter((id) => typeof id === 'string') };
  } catch {
    // Private mode, storage denied, or a first run. None of them is a problem.
    return null;
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;
let pending: SaveData | null = null;

/** Fire and forget. Safe to call on every single find. */
export function queueSave(data: SaveData): void {
  pending = data;
  if (timer !== null) return;
  timer = setTimeout(() => {
    timer = null;
    const d = pending;
    pending = null;
    if (d) void set(KEY, d).catch(() => {});
  }, DEBOUNCE_MS);
}

/** Write immediately, for a page about to be hidden. */
export function flushSave(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  const d = pending;
  pending = null;
  if (d) void set(KEY, d).catch(() => {});
}
