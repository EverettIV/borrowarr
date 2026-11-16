/**
 * Docker library + download paths from environment.
 *
 * Preferred: BORROWARR_MEDIA=/media and BORROWARR_DOWNLOADS=/downloads
 *   → /media/movies, /media/tv, /downloads/movies, /downloads/tv
 *
 * Override individual paths with BORROWARR_MOVIE_LIBRARY, etc.
 * Legacy: BORROWARR_DATA_ROOT=/data (Servarr-style tree under /data).
 */

const path = require('path');

const PATH_KEYS = [
  'movieDirectory',
  'seriesDirectory',
  'movieDownloadDirectory',
  'seriesDownloadDirectory',
  'movieWatcherDestination',
  'seriesWatcherDestination',
];

function normalizePath(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function joinRoot(root, ...segments) {
  return path.posix.join(root, ...segments);
}

function libraryFromMediaRoot(mediaRoot) {
  if (!mediaRoot) return { movieDirectory: null, seriesDirectory: null };
  return {
    movieDirectory: joinRoot(mediaRoot, 'movies'),
    seriesDirectory: joinRoot(mediaRoot, 'tv'),
  };
}

function downloadsFromDownloadsRoot(downloadsRoot) {
  if (!downloadsRoot) return { movieDownloadDirectory: null, seriesDownloadDirectory: null };
  return {
    movieDownloadDirectory: joinRoot(downloadsRoot, 'movies'),
    seriesDownloadDirectory: joinRoot(downloadsRoot, 'tv'),
  };
}

/**
 * @returns paths used when Settings DB fields are empty
 */
function getMediaPathsFromEnv() {
  const mediaRoot = normalizePath(process.env.BORROWARR_MEDIA);
  const downloadsRoot = normalizePath(process.env.BORROWARR_DOWNLOADS);
  const dataRoot = normalizePath(process.env.BORROWARR_DATA_ROOT);

  const fromMedia = libraryFromMediaRoot(mediaRoot);
  const fromDownloads = downloadsFromDownloadsRoot(downloadsRoot);

  const movieDirectory =
    normalizePath(process.env.BORROWARR_MOVIE_LIBRARY) ||
    fromMedia.movieDirectory ||
    (dataRoot ? joinRoot(dataRoot, 'media', 'movies') : null);

  const seriesDirectory =
    normalizePath(process.env.BORROWARR_SERIES_LIBRARY) ||
    fromMedia.seriesDirectory ||
    (dataRoot ? joinRoot(dataRoot, 'media', 'tv') : null);

  const movieDownloadDirectory =
    normalizePath(process.env.BORROWARR_MOVIE_DOWNLOADS) ||
    fromDownloads.movieDownloadDirectory ||
    (dataRoot ? joinRoot(dataRoot, 'downloads', 'movies') : null);

  const seriesDownloadDirectory =
    normalizePath(process.env.BORROWARR_SERIES_DOWNLOADS) ||
    fromDownloads.seriesDownloadDirectory ||
    (dataRoot ? joinRoot(dataRoot, 'downloads', 'tv') : null);

  const movieWatcherDestination =
    normalizePath(process.env.BORROWARR_MOVIE_WATCHER_DESTINATION) || movieDirectory;

  const seriesWatcherDestination =
    normalizePath(process.env.BORROWARR_SERIES_WATCHER_DESTINATION) || seriesDirectory;

  const hasAny = Boolean(
    movieDirectory ||
      seriesDirectory ||
      movieDownloadDirectory ||
      seriesDownloadDirectory,
  );

  return {
    movieDirectory,
    seriesDirectory,
    movieDownloadDirectory,
    seriesDownloadDirectory,
    movieWatcherDestination,
    seriesWatcherDestination,
    hasAny,
    mediaRoot,
    downloadsRoot,
    dataRoot,
  };
}

function getMediaPathCreateDefaults() {
  const env = getMediaPathsFromEnv();
  if (!env.hasAny) return {};

  return {
    movieDirectory: env.movieDirectory,
    seriesDirectory: env.seriesDirectory,
    movieDownloadDirectory: env.movieDownloadDirectory,
    seriesDownloadDirectory: env.seriesDownloadDirectory,
    movieWatcherDestination: env.movieWatcherDestination,
    seriesWatcherDestination: env.seriesWatcherDestination,
  };
}

function mergeSettingsWithEnvMediaPaths(settings) {
  const env = getMediaPathsFromEnv();
  if (!env.hasAny) {
    return settings?.toJSON ? settings.toJSON() : { ...(settings || {}) };
  }

  const base = settings?.toJSON ? settings.toJSON() : { ...(settings || {}) };

  for (const key of PATH_KEYS) {
    const current = normalizePath(base[key]);
    const fromEnv = normalizePath(env[key]);
    if (!current && fromEnv) {
      base[key] = fromEnv;
    }
  }

  if (!normalizePath(base.movieWatcherDestination) && normalizePath(base.movieDirectory)) {
    base.movieWatcherDestination = base.movieDirectory;
  }
  if (!normalizePath(base.seriesWatcherDestination) && normalizePath(base.seriesDirectory)) {
    base.seriesWatcherDestination = base.seriesDirectory;
  }

  return base;
}

async function ensureMediaDirectoriesFromEnv() {
  if (normalizePath(process.env.BORROWARR_ENSURE_MEDIA_DIRS)?.toLowerCase() !== 'true') {
    return;
  }

  const fs = require('fs').promises;
  const env = getMediaPathsFromEnv();
  if (!env.hasAny) return;

  const unique = new Set(
    [
      ...PATH_KEYS.map((k) => normalizePath(env[k])),
      env.mediaRoot,
      env.downloadsRoot,
    ].filter(Boolean),
  );

  for (const dir of unique) {
    try {
      await fs.mkdir(dir, { recursive: true });
      console.log(`[MediaPaths] Ensured directory exists: ${dir}`);
    } catch (err) {
      console.warn(`[MediaPaths] Could not create ${dir}:`, err.message);
    }
  }
}

function logMediaPathsFromEnvOnStartup() {
  const env = getMediaPathsFromEnv();
  if (!env.hasAny) return;

  console.log('[MediaPaths] Environment path defaults (empty Settings fields use these):');
  if (env.mediaRoot) console.log(`  BORROWARR_MEDIA=${env.mediaRoot}`);
  if (env.downloadsRoot) console.log(`  BORROWARR_DOWNLOADS=${env.downloadsRoot}`);
  if (env.dataRoot) console.log(`  BORROWARR_DATA_ROOT=${env.dataRoot} (legacy fallback)`);
  if (env.movieDirectory) console.log(`  library movies: ${env.movieDirectory}`);
  if (env.seriesDirectory) console.log(`  library tv: ${env.seriesDirectory}`);
  if (env.movieDownloadDirectory) console.log(`  download movies: ${env.movieDownloadDirectory}`);
  if (env.seriesDownloadDirectory) console.log(`  download tv: ${env.seriesDownloadDirectory}`);
}

async function backfillSettingsMediaPathsFromEnv() {
  const defaults = getMediaPathCreateDefaults();
  if (Object.keys(defaults).length === 0) return { updated: 0 };

  const Settings = require('../models/Settings');
  const rows = await Settings.findAll();
  let updated = 0;

  for (const row of rows) {
    const patch = {};
    for (const [key, value] of Object.entries(defaults)) {
      if (!normalizePath(row[key]) && value) {
        patch[key] = value;
      }
    }
    if (Object.keys(patch).length > 0) {
      await row.update(patch);
      updated += 1;
    }
  }

  return { updated };
}

module.exports = {
  PATH_KEYS,
  getMediaPathsFromEnv,
  getMediaPathCreateDefaults,
  mergeSettingsWithEnvMediaPaths,
  ensureMediaDirectoriesFromEnv,
  logMediaPathsFromEnvOnStartup,
  backfillSettingsMediaPathsFromEnv,
};