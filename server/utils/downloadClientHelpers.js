const canManageDownloadClients = (user) => Boolean(user?.permissions?.admin);

const SENSITIVE_SETTING_KEY = /^(password|apikey|api_key|secret|token|rpcsecret|rpc_secret)$/i;

function redactDownloadClientSettings(settings) {
  if (!settings || typeof settings !== 'object') {
    return {};
  }
  const next = { ...settings };
  for (const key of Object.keys(next)) {
    if (SENSITIVE_SETTING_KEY.test(key) || key.toLowerCase().includes('password')) {
      delete next[key];
    }
  }
  return next;
}

function sanitizeDownloadClientForUser(clientJson, user) {
  const plain = typeof clientJson?.toJSON === 'function' ? clientJson.toJSON() : { ...clientJson };
  if (canManageDownloadClients(user)) {
    return plain;
  }
  return {
    ...plain,
    settings: redactDownloadClientSettings(plain.settings),
  };
}

const DEFAULT_DOWNLOAD_CLIENT_CATEGORIES = [
  { category: 'movie', clientCategory: 'movie' },
  { category: 'tv', clientCategory: 'tv' },
];

function defaultDownloadClientCategories() {
  return DEFAULT_DOWNLOAD_CLIENT_CATEGORIES.map((row) => ({ ...row }));
}

/**
 * Canonical keys sent to download clients: `movie` | `tv`.
 */
function normalizeGrabMediaType(mediaType) {
  if (mediaType == null || mediaType === '') return null;
  const value = String(mediaType).toLowerCase().trim();
  if (value === 'movie' || value === 'movies') return 'movie';
  if (value === 'tv' || value === 'series') return 'tv';
  return value;
}

/**
 * Resolve qBittorrent/SAB category label from client config (supports legacy `movies` key).
 */
function resolveClientCategoryLabel(categories, mediaType) {
  const key = normalizeGrabMediaType(mediaType);
  if (!key) return null;

  const list = Array.isArray(categories) ? categories : [];
  const lookupKeys = key === 'movie' ? ['movie', 'movies'] : ['tv', 'series'];
  for (const alias of lookupKeys) {
    const row = list.find((c) => c?.category === alias && c.clientCategory);
    if (row) return row.clientCategory;
  }

  return key;
}

module.exports = {
  canManageDownloadClients,
  sanitizeDownloadClientForUser,
  redactDownloadClientSettings,
  defaultDownloadClientCategories,
  normalizeGrabMediaType,
  resolveClientCategoryLabel,
};