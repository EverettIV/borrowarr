const dns = require('dns').promises;
const net = require('net');
const { URL } = require('url');
const Indexers = require('../models/Indexers');

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
]);

function isBlockedIpv4(a, b, c, d) {
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  if (a === 255) return true;
  return false;
}

function isBlockedIp(ip) {
  const version = net.isIP(ip);
  if (version === 4) {
    const parts = ip.split('.').map((n) => parseInt(n, 10));
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
    return isBlockedIpv4(parts[0], parts[1], parts[2], parts[3]);
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fe80:')) return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    if (lower.startsWith('::ffff:')) {
      const mapped = lower.slice('::ffff:'.length);
      if (net.isIP(mapped) === 4) return isBlockedIp(mapped);
    }
    return false;
  }
  return true;
}

async function resolveHostAddresses(hostname) {
  const directIp = net.isIP(hostname);
  if (directIp) {
    return [hostname];
  }

  const results = [];
  try {
    results.push(...(await dns.resolve4(hostname)));
  } catch {
    // ignore
  }
  try {
    results.push(...(await dns.resolve6(hostname)));
  } catch {
    // ignore
  }
  return results;
}

let indexerHostsCache = { at: 0, hosts: new Set() };
const INDEXER_HOST_CACHE_MS = 60 * 1000;

async function getIndexerHostnames() {
  const now = Date.now();
  if (now - indexerHostsCache.at < INDEXER_HOST_CACHE_MS) {
    return indexerHostsCache.hosts;
  }
  const hosts = new Set();
  const indexers = await Indexers.findAll({
    where: { enabled: true },
    attributes: ['baseUrl'],
  });
  for (const row of indexers) {
    const baseUrl = row.baseUrl;
    if (!baseUrl) continue;
    try {
      hosts.add(new URL(baseUrl).hostname.toLowerCase());
    } catch {
      // skip invalid baseUrl
    }
  }
  indexerHostsCache = { at: now, hosts };
  return hosts;
}

function parseHostnameAllowlist() {
  const raw = process.env.GRAB_URL_ALLOWLIST_HOSTS;
  if (!raw || !raw.trim()) return new Set();
  return new Set(
    raw
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Validate user-supplied grab URLs (magnet ok; http(s) must not resolve to private networks).
 * @param {string} downloadUrl
 * @param {{ trustedSource?: boolean }} options
 */
async function validateGrabDownloadUrl(downloadUrl, options = {}) {
  if (options.trustedSource) {
    return { ok: true, mode: 'trusted' };
  }

  if (typeof downloadUrl !== 'string' || !downloadUrl.trim()) {
    return { ok: false, error: 'Download URL or magnet link is required' };
  }

  const trimmed = downloadUrl.trim();

  if (trimmed.startsWith('magnet:')) {
    return { ok: true, mode: 'magnet' };
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'Invalid download URL' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Only http(s) and magnet links are supported' };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { ok: false, error: 'Download URL hostname is not allowed' };
  }

  if (hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    return { ok: false, error: 'Download URL hostname is not allowed' };
  }

  const addresses = await resolveHostAddresses(hostname);
  if (addresses.length === 0) {
    return { ok: false, error: 'Could not resolve download URL hostname' };
  }

  for (const addr of addresses) {
    if (isBlockedIp(addr)) {
      return { ok: false, error: 'Download URL points to a private or restricted network' };
    }
  }

  const strictIndexerHosts = process.env.GRAB_STRICT_INDEXER_HOSTS === 'true';
  if (strictIndexerHosts) {
    const indexerHosts = await getIndexerHostnames();
    const extra = parseHostnameAllowlist();
    const allowed =
      indexerHosts.has(hostname) ||
      extra.has(hostname) ||
      [...indexerHosts].some((h) => hostname === h || hostname.endsWith(`.${h}`));
    if (!allowed) {
      return {
        ok: false,
        error: 'Download URL must come from a configured indexer (or GRAB_URL_ALLOWLIST_HOSTS)',
      };
    }
  }

  return { ok: true, mode: 'http', url: parsed };
}

/** Axios options for server-side grab fetches (limit redirect-based SSRF). */
const GRAB_HTTP_FETCH_OPTIONS = {
  responseType: 'arraybuffer',
  timeout: 30000,
  maxRedirects: 0,
  validateStatus: (status) => status >= 200 && status < 400,
};

module.exports = {
  validateGrabDownloadUrl,
  isBlockedIp,
  GRAB_HTTP_FETCH_OPTIONS,
};