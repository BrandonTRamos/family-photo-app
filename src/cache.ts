// What the app has already loaded, so screens show instantly and refresh quietly in the background
// (stale-while-revalidate). Kept in memory, and for a few small, often-opened screens also on the phone,
// so the next launch starts with them too.
//
// Media links in the data are signed and stay valid for at least an hour (see the CloudFront adapter),
// so nothing older than MAX_AGE is shown: its pictures might no longer load.

const PREFIX = 'fa1:';
const MAX_AGE_MS = 50 * 60 * 1000;
/** Only these are saved on the phone; the rest live in memory for the session. */
const PERSISTED = new Set(['me', 'timeline', 'albums']);

type Entry = { at: number; data: unknown };

const memory = new Map<string, Entry>();
const inFlight = new Map<string, Promise<unknown>>();
let persist = true;

/** The preview (demo mode) has nothing worth keeping between visits. */
export function disablePersistence(): void {
  persist = false;
}

export function readCache<T>(key: string): T | undefined {
  const entry = memory.get(key) ?? fromStorage(key);
  if (!entry || Date.now() - entry.at > MAX_AGE_MS) return undefined;
  memory.set(key, entry);
  return entry.data as T;
}

export function writeCache<T>(key: string, data: T): void {
  const entry = { at: Date.now(), data };
  memory.set(key, entry);
  if (persist && PERSISTED.has(key)) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(entry));
    } catch {
      // storage full or blocked: memory is enough
    }
  }
}

/** Forget one key, or every key starting with `prefix*`. */
export function dropCache(key: string): void {
  const keys = key.endsWith('*') ? [...memory.keys()].filter((k) => k.startsWith(key.slice(0, -1))) : [key];
  for (const k of keys) {
    memory.delete(k);
    try {
      localStorage.removeItem(PREFIX + k);
    } catch {
      // ignore
    }
  }
}

/** On sign-out: the next person on this phone starts clean. */
export function clearCache(): void {
  memory.clear();
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k);
  } catch {
    // ignore
  }
}

/** Load once at a time per key: a tap's prefetch and the screen it opens share one request. */
export function fetchOnce<T>(key: string, load: () => Promise<T>): Promise<T> {
  const running = inFlight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = load()
    .then((data) => (writeCache(key, data), data))
    .finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

function fromStorage(key: string): Entry | undefined {
  if (!persist || !PERSISTED.has(key)) return undefined;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as Entry) : undefined;
  } catch {
    return undefined;
  }
}

// ---- thumbnails already on screen, so a photo page can open on one instantly ----

const thumbs = new Map<string, string>();

export function rememberThumb(id: string, url: string): void {
  thumbs.set(id, url);
}

export function thumbFor(id: string): string | undefined {
  return thumbs.get(id);
}
