/**
 * Session-scoped, in-memory cache for Firestore reads.
 *
 * Firestore round trips dominate the perceived latency when switching pages,
 * selecting a routine, or adding an exercise — and the app re-reads the same
 * small collections on every mount. Entries hold the fetch *promise* (so
 * concurrent callers share one in-flight request), expire after a short TTL
 * (bounds staleness from edits on another device), and are invalidated by the
 * write paths in the services. Scale is 1–5 users: simplicity over
 * sophistication.
 */

const DEFAULT_TTL_MS = 5 * 60 * 1000;

type CacheEntry = {
  promise: Promise<unknown>;
  expiresAt: number;
};

const store = new Map<string, CacheEntry>();

/**
 * Returns the cached promise for `key`, or runs `fetcher` and caches its
 * promise. Rejected fetches are evicted so the next caller retries the
 * network instead of replaying an error.
 */
export function cachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.promise as Promise<T>;
  }

  const promise = fetcher();
  store.set(key, { promise, expiresAt: Date.now() + ttlMs });

  promise.catch(() => {
    if (store.get(key)?.promise === promise) {
      store.delete(key);
    }
  });

  return promise;
}

/** Removes every cached entry whose key starts with `keyPrefix`. */
export function invalidateCache(keyPrefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(keyPrefix)) {
      store.delete(key);
    }
  }
}
