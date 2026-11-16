const rateLimit = require('express-rate-limit');
const tmdbCache = require('../services/tmdbCache');

function isUsingBundledTmdbKey() {
  return !process.env.TMDB_API && !process.env.TMDB_API_KEY;
}

function tmdbRateLimitKey(req) {
  return req.userId || req.ip || 'unknown';
}

const bundledKeyMultiplier = () => (isUsingBundledTmdbKey() ? 0.5 : 1);

/** Discover and similar pages issue many parallel TMDB proxy calls; relax limits in dev. */
const environmentMultiplier = () =>
  process.env.NODE_ENV === 'production' ? 1 : 4;

const tmdbGeneralLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: () =>
    Math.max(
      30,
      Math.floor(120 * bundledKeyMultiplier() * environmentMultiplier()),
    ),
  message: { success: false, error: 'Too many TMDB requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: tmdbRateLimitKey,
});

const tmdbSearchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: () =>
    Math.max(
      10,
      Math.floor(30 * bundledKeyMultiplier() * environmentMultiplier()),
    ),
  message: { success: false, error: 'Too many TMDB searches. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: tmdbRateLimitKey,
});

/**
 * Cache successful GET JSON responses for repeat catalog browsing.
 */
function tmdbResponseCache(req, res, next) {
  if (req.method !== 'GET') {
    return next();
  }

  const cacheKey = req.originalUrl;
  const cached = tmdbCache.get(cacheKey);
  if (cached) {
    res.setHeader('X-TMDB-Cache', 'HIT');
    return res.json(cached);
  }

  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode < 400 && body && body.success !== false) {
      const ttl = tmdbCache.ttlForTmdbPath(req.path);
      tmdbCache.set(cacheKey, body, ttl);
      res.setHeader('X-TMDB-Cache', 'MISS');
    }
    return originalJson(body);
  };

  next();
}

module.exports = {
  tmdbGeneralLimiter,
  tmdbSearchLimiter,
  tmdbResponseCache,
  isUsingBundledTmdbKey,
};