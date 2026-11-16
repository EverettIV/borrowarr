/**
 * In-memory TTL cache for TMDB API JSON responses (shared across users).
 */

const MAX_ENTRIES = 2500;

const store = new Map();

function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

function set(key, value, ttlMs) {
  if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function ttlForTmdbPath(path) {
  const p = path || '';
  if (p.includes('/genres')) return 24 * 60 * 60 * 1000;
  if (/\/(?:movie|tv|company|network|person)\/\d+/.test(p)) return 60 * 60 * 1000;
  if (p.includes('/season/')) return 60 * 60 * 1000;
  if (p.includes('/search')) return 5 * 60 * 1000;
  if (p.includes('/discover/')) return 10 * 60 * 1000;
  return 15 * 60 * 1000;
}

function clear() {
  store.clear();
}

module.exports = {
  get,
  set,
  ttlForTmdbPath,
  clear,
};