const fs = require('fs').promises;
const path = require('path');
const MonitoredMovies = require('../models/MonitoredMovies');
const MonitoredSeries = require('../models/MonitoredSeries');
const Settings = require('../models/Settings');
const { getUserNamingScanDirectory } = require('./fileScanner');
const {
  extractMetadataFromFilename,
  buildMovieBaseName,
  buildSeriesBaseName,
  getEpisodeTitle,
  transferFile,
  findVideoFiles,
  findMovieVideosForRenaming,
  resolveMovieTargetPath,
  resolveMovieForNaming,
  getMovieSceneName,
  getMovieRenameReviewReasons,
  matchMonitoredSeries,
  extractSeasonEpisode,
  extractSeriesTitleFromFilename,
} = require('./mediaOrganizer');
const { formatNeedsFfprobe, resetProbeFailureLogLimit } = require('./videoProbe');
const { recordActivitySafe, ActivityCategory } = require('./activityLogService');
const { mapPool } = require('../utils/asyncPool');

const PREVIEW_CONCURRENCY = 8;

async function logFileRename(userId, mediaType, outcome, payload) {
  const action = `${mediaType}_rename_${outcome}`;
  const status = outcome === 'success' ? 'success' : 'failure';
  await recordActivitySafe(userId, {
    category: ActivityCategory.FILE_RENAME,
    action,
    status,
    summary: payload.summary,
    details: payload.details,
  });
}

async function applyMovieFormat(
  format,
  movie,
  currentFilename = '',
  filePath = null,
  probeCache = null,
  options = {},
) {
  return buildMovieBaseName(format, movie, currentFilename, filePath, probeCache, options);
}

async function pruneEmptyReleaseDirs(startDir, stopDir) {
  let dir = startDir;
  const stop = path.resolve(stopDir);
  while (dir && path.resolve(dir) !== stop) {
    try {
      const entries = await fs.readdir(dir);
      if (entries.length > 0) break;
      await fs.rmdir(dir);
      dir = path.dirname(dir);
    } catch {
      break;
    }
  }
}

function isInsideScanRoot(dir, scanRoot) {
  const resolved = path.resolve(dir);
  const root = path.resolve(scanRoot);
  if (resolved === root) return false;
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return resolved.startsWith(rootWithSep);
}

/**
 * Remove everything left in the release folder after the video file was moved out.
 */
async function cleanupReleaseFolderJunk(oldDir, scanRoot) {
  if (!scanRoot || !oldDir) return;
  if (!isInsideScanRoot(oldDir, scanRoot)) return;
  try {
    await fs.rm(oldDir, { recursive: true, force: true });
    await pruneEmptyReleaseDirs(path.dirname(oldDir), scanRoot);
  } catch (err) {
    console.warn(`[fileRenamer] Release folder cleanup failed for ${oldDir}:`, err.message);
  }
}

async function computeMovieRenameRow(userId, currentPath, movieFileFormat, options = {}) {
  const libraryDir = await getUserNamingScanDirectory(userId, 'movie');
  if (!libraryDir) {
    return { type: 'error', reason: 'no_scan_directory' };
  }

  const settings = await Settings.findOne({ where: { userId } });
  const pathOptions = {
    useReleaseFolders: settings?.movieNamingUseFolders === true,
  };
  const currentName = path.basename(currentPath);
  const currentExt = path.extname(currentPath);
  const probeCache = options.probeCache || new Map();

  let movie;
  let sceneName;
  let matchSource;

  if (options.manualMovie) {
    movie = options.manualMovie;
    sceneName = getMovieSceneName(currentPath, libraryDir);
    matchSource = options.matchSource || 'tmdb_manual';
  } else {
    const lookupCache = options.lookupCache || new Map();
    const resolved = await resolveMovieForNaming(userId, currentPath, lookupCache, libraryDir);
    if (!resolved.movie) {
      return {
        type: 'skipped',
        name: currentName,
        reason: resolved.reason || 'cant_parse_title',
      };
    }
    ({ movie, sceneName, matchSource } = resolved);
  }

  const sceneMeta = extractMetadataFromFilename(sceneName || currentName);
  const needsProbe = formatNeedsFfprobe(movieFileFormat, sceneMeta);

  const build = (skipFfprobe) =>
    applyMovieFormat(
      movieFileFormat,
      movie,
      sceneName,
      currentPath,
      probeCache,
      { skipFfprobe },
    );

  let newBaseName = await build(true);
  if (!newBaseName) {
    return { type: 'skipped', name: currentName, reason: 'empty_format_result' };
  }

  const targetPath = (baseName) =>
    resolveMovieTargetPath(libraryDir, currentPath, baseName, currentExt, pathOptions);

  let newPath = targetPath(newBaseName);

  if (path.resolve(currentPath) === path.resolve(newPath)) {
    return { type: 'alreadyNamed' };
  }

  if (needsProbe) {
    newBaseName = await build(false);
    if (!newBaseName) {
      return { type: 'skipped', name: currentName, reason: 'empty_format_result' };
    }
    newPath = targetPath(newBaseName);
    if (path.resolve(currentPath) === path.resolve(newPath)) {
      return { type: 'alreadyNamed' };
    }
  }

  const newName = path.basename(newPath);
  const reviewReasons = getMovieRenameReviewReasons({
    currentName,
    newName,
    movieTitle: movie.title,
    sceneName,
    matchSource,
    tmdbMatchScore: movie.tmdbMatchScore ?? null,
    tmdbId: movie.tmdbId ?? null,
  });

  return {
    type: 'rename',
    movieId: movie.id || null,
    tmdbId: movie.tmdbId ?? null,
    matchSource,
    resolvedTitle: movie.title,
    currentPath,
    currentName,
    sceneName,
    newName,
    newPath,
    directory: path.dirname(newPath),
    needsReview: reviewReasons.length > 0,
    reviewReasons,
  };
}

async function recomputeMovieRenameWithTmdb(userId, currentPath, movieFileFormat, tmdbId) {
  const tmdbService = require('./tmdbService');
  const details = await tmdbService.getMovieDetails(tmdbId);
  if (!details.success || !details.movie) {
    throw new Error(details.error || 'TMDB movie not found');
  }
  const m = details.movie;
  const manualMovie = {
    id: null,
    tmdbId: m.id,
    title: m.title,
    releaseDate: m.release_date || null,
    tmdbMatchScore: 100,
  };
  const row = await computeMovieRenameRow(userId, currentPath, movieFileFormat, {
    manualMovie,
    matchSource: 'tmdb_manual',
  });
  if (row.type !== 'rename') {
    throw new Error(row.reason || 'Could not build rename for this file');
  }
  return row;
}

async function previewMovieRenames(userId, movieFileFormat) {
  resetProbeFailureLogLimit();
  const stats = {
    scanned: 0,
    matched: 0,
    toRename: 0,
    alreadyNamed: 0,
    skipped: [],
  };
  const renames = [];

  const libraryDir = await getUserNamingScanDirectory(userId, 'movie');
  if (!libraryDir) {
    return { renames, stats };
  }

  const files = await findMovieVideosForRenaming(libraryDir, libraryDir);
  stats.scanned = files.length;
  const lookupCache = new Map();
  const probeCache = new Map();

  const outcomes = await mapPool(files, PREVIEW_CONCURRENCY, async (currentPath) =>
    computeMovieRenameRow(userId, currentPath, movieFileFormat, { lookupCache, probeCache }),
  );

  for (const outcome of outcomes) {
    if (!outcome) continue;
    if (outcome.type === 'skipped') {
      stats.skipped.push({ name: outcome.name, reason: outcome.reason });
      continue;
    }
    if (outcome.type === 'alreadyNamed') {
      stats.matched++;
      stats.alreadyNamed++;
      continue;
    }
    if (outcome.type === 'rename') {
      stats.matched++;
      stats.toRename++;
      renames.push({
        movieId: outcome.movieId,
        matchSource: outcome.matchSource,
        resolvedTitle: outcome.resolvedTitle,
        currentPath: outcome.currentPath,
        currentName: outcome.currentName,
        sceneName: outcome.sceneName,
        newName: outcome.newName,
        newPath: outcome.newPath,
        directory: outcome.directory,
        needsReview: outcome.needsReview,
        reviewReasons: outcome.reviewReasons,
        tmdbId: outcome.tmdbId,
      });
    }
  }

  return { renames, stats };
}

/**
 * Execute file renames
 * @param {string} userId - The user ID
 * @param {Array<{movieId, currentPath, newName, directory}>} renames - Array of rename operations
 * @returns {Promise<{success: number, failed: number, errors: Array}>}
 */
async function executeMovieRenames(userId, renames) {
  const results = {
    success: 0,
    failed: 0,
    errors: [],
  };

  const scanRoot = await getUserNamingScanDirectory(userId, 'movie');
  const settings = await Settings.findOne({ where: { userId } });
  const cleanupReleaseJunk = settings?.movieRenameCleanupReleaseFolder === true;

  for (const rename of renames) {
    try {
      const { movieId, currentPath, newName, directory, newPath: presetPath } = rename;

      const newPath = presetPath || path.join(directory, newName);

      // Check if source file exists
      try {
        await fs.access(currentPath);
      } catch (error) {
        const errMsg = 'Source file not found';
        results.failed++;
        results.errors.push({
          movieId,
          currentName: path.basename(currentPath),
          error: errMsg,
        });
        await logFileRename(userId, 'movie', 'failure', {
          summary: `Movie rename failed: ${path.basename(currentPath)} — ${errMsg}`,
          details: { currentPath, newPath, newName, movieId, error: errMsg },
        });
        continue;
      }

      // Check if destination already exists
      try {
        await fs.access(newPath);
        const errMsg = 'Destination file already exists';
        results.failed++;
        results.errors.push({
          movieId,
          currentName: path.basename(currentPath),
          error: errMsg,
        });
        await logFileRename(userId, 'movie', 'failure', {
          summary: `Movie rename failed: ${path.basename(currentPath)} — ${errMsg}`,
          details: { currentPath, newPath, newName, movieId, error: errMsg },
        });
        continue;
      } catch (error) {
        // Good, destination doesn't exist
      }

      const oldDir = path.dirname(currentPath);
      const wasInReleaseFolder =
        scanRoot && isInsideScanRoot(oldDir, scanRoot);
      await transferFile(currentPath, newPath);
      if (scanRoot) {
        if (cleanupReleaseJunk && wasInReleaseFolder) {
          await cleanupReleaseFolderJunk(oldDir, scanRoot);
        } else {
          await pruneEmptyReleaseDirs(oldDir, scanRoot);
        }
      }

      if (movieId) {
        const movie = await MonitoredMovies.findByPk(movieId);
        if (movie && movie.userId === userId) {
          await movie.update({
            filePath: newPath,
            fileName: newName,
          });
        }
      }

      results.success++;
      console.log(`✅ Renamed: ${path.basename(currentPath)} → ${newName}`);
      await logFileRename(userId, 'movie', 'success', {
        summary: `${path.basename(currentPath)} → ${path.basename(newPath)}`,
        details: {
          currentPath,
          newPath,
          newName,
          movieId,
          releaseFolderCleaned: Boolean(cleanupReleaseJunk && wasInReleaseFolder),
        },
      });
    } catch (error) {
      results.failed++;
      results.errors.push({
        movieId: rename.movieId,
        currentName: path.basename(rename.currentPath),
        error: error.message,
      });
      console.error(`❌ Failed to rename ${path.basename(rename.currentPath)}:`, error);
      await logFileRename(userId, 'movie', 'failure', {
        summary: `Movie rename failed: ${path.basename(rename.currentPath)} — ${error.message}`,
        details: {
          currentPath: rename.currentPath,
          newPath: rename.newPath || rename.directory,
          newName: rename.newName,
          movieId: rename.movieId,
          error: error.message,
        },
      });
    }
  }

  return results;
}

async function applySeriesFormat(
  format,
  series,
  season,
  episode,
  episodeTitle = '',
  currentFilename = '',
  filePath = null,
  probeCache = null,
  options = {},
) {
  return buildSeriesBaseName(
    format,
    series,
    season,
    episode,
    episodeTitle,
    currentFilename,
    filePath,
    probeCache,
    options,
  );
}

async function previewSeriesRenames(userId, seriesFileFormat) {
  const stats = {
    scanned: 0,
    matched: 0,
    toRename: 0,
    alreadyNamed: 0,
    skipped: [],
  };
  const renames = [];

  const seriesDirectory = await getUserNamingScanDirectory(userId, 'series');
  if (!seriesDirectory) {
    return { renames, stats };
  }

  const allSeries = await MonitoredSeries.findAll({ where: { userId } });
  if (allSeries.length === 0) {
    return { renames, stats };
  }

  const allVideoFiles = await findVideoFiles(seriesDirectory);
  stats.scanned = allVideoFiles.length;
  const probeCache = new Map();

  const outcomes = await mapPool(allVideoFiles, PREVIEW_CONCURRENCY, async (currentPath) => {
    const currentName = path.basename(currentPath);
    const currentExt = path.extname(currentPath);
    const { season, episode } = extractSeasonEpisode(currentName);

    if (season == null || episode == null) {
      return { type: 'skipped', name: currentName, reason: 'no_sxxexx_in_filename' };
    }

    const fileSeriesTitle = extractSeriesTitleFromFilename(currentName);
    const matchedSeries = matchMonitoredSeries(fileSeriesTitle, allSeries);
    if (!matchedSeries) {
      return { type: 'skipped', name: currentName, reason: 'not_in_monitored_library' };
    }

    const episodeTitle = await getEpisodeTitle(matchedSeries.tmdbId, season, episode);
    const sceneMeta = extractMetadataFromFilename(currentName);
    const needsProbe = formatNeedsFfprobe(seriesFileFormat, sceneMeta);

    const build = (skipFfprobe) =>
      applySeriesFormat(
        seriesFileFormat,
        matchedSeries,
        season,
        episode,
        episodeTitle,
        currentName,
        currentPath,
        probeCache,
        { skipFfprobe },
      );

    let newBaseName = await build(true);
    const withExt = (base) => `${base}${currentExt}`;
    let newFileName = withExt(newBaseName);
    let newPath = newFileName.includes('/') || newFileName.includes('\\')
      ? path.normalize(path.join(seriesDirectory, newFileName))
      : path.join(path.dirname(currentPath), newFileName);

    if (currentPath === newPath) {
      return { type: 'alreadyNamed' };
    }

    if (needsProbe) {
      newBaseName = await build(false);
      newFileName = withExt(newBaseName);
      newPath = newFileName.includes('/') || newFileName.includes('\\')
        ? path.normalize(path.join(seriesDirectory, newFileName))
        : path.join(path.dirname(currentPath), newFileName);
      if (currentPath === newPath) {
        return { type: 'alreadyNamed' };
      }
    }

    const includesFolders = newFileName.includes('/');
    return {
      type: 'rename',
      seriesId: matchedSeries.id,
      currentPath,
      currentName,
      newName: includesFolders ? newFileName : path.basename(newPath),
      newPath,
      directory: path.dirname(newPath),
      season,
      episode,
    };
  });

  for (const outcome of outcomes) {
    if (!outcome) continue;
    if (outcome.type === 'skipped') {
      stats.skipped.push({ name: outcome.name, reason: outcome.reason });
      continue;
    }
    if (outcome.type === 'alreadyNamed') {
      stats.matched++;
      stats.alreadyNamed++;
      continue;
    }
    if (outcome.type === 'rename') {
      stats.matched++;
      stats.toRename++;
      renames.push({
        seriesId: outcome.seriesId,
        currentPath: outcome.currentPath,
        currentName: outcome.currentName,
        newName: outcome.newName,
        newPath: outcome.newPath,
        directory: outcome.directory,
        season: outcome.season,
        episode: outcome.episode,
      });
    }
  }

  return { renames, stats };
}

/**
 * Execute series file renames
 * @param {string} userId - The user ID
 * @param {Array<{seriesId, currentPath, newName, directory}>} renames - Array of rename operations
 * @returns {Promise<{success: number, failed: number, errors: Array}>}
 */
async function executeSeriesRenames(userId, renames) {
  const results = {
    success: 0,
    failed: 0,
    errors: [],
  };

  const Settings = require('../models/Settings');
  const settings = await Settings.findOne({ where: { userId } });
  const { getSeriesMediaDirectory } = require('./fileScanner');
  const seriesDirectory = getSeriesMediaDirectory(settings);

  if (!seriesDirectory) {
    results.failed = renames.length;
    results.errors.push({
      error: 'Series directory not configured',
    });
    return results;
  }

  for (const rename of renames) {
    try {
      const { seriesId, currentPath, newName, directory, newPath: presetPath } = rename;

      let finalPath = presetPath;
      if (!finalPath) {
        if (newName.includes('/') || newName.includes(path.sep)) {
          finalPath = path.join(seriesDirectory, newName);
        } else {
          finalPath = path.join(directory, newName);
        }
      }

      // Check if source file exists
      try {
        await fs.access(currentPath);
      } catch (error) {
        const errMsg = 'Source file not found';
        results.failed++;
        results.errors.push({
          seriesId,
          currentName: path.basename(currentPath),
          error: errMsg,
        });
        await logFileRename(userId, 'series', 'failure', {
          summary: `Series rename failed: ${path.basename(currentPath)} — ${errMsg}`,
          details: { currentPath, newPath: finalPath, newName, seriesId, error: errMsg },
        });
        continue;
      }

      // Check if destination already exists
      try {
        await fs.access(finalPath);
        const errMsg = 'Destination file already exists';
        results.failed++;
        results.errors.push({
          seriesId,
          currentName: path.basename(currentPath),
          error: errMsg,
        });
        await logFileRename(userId, 'series', 'failure', {
          summary: `Series rename failed: ${path.basename(currentPath)} — ${errMsg}`,
          details: { currentPath, newPath: finalPath, newName, seriesId, error: errMsg },
        });
        continue;
      } catch (error) {
        // Good, destination doesn't exist
      }

      await fs.mkdir(path.dirname(finalPath), { recursive: true });
      await transferFile(currentPath, finalPath);

      results.success++;
      console.log(`✅ Organized series file: ${path.basename(currentPath)} → ${finalPath}`);
      await logFileRename(userId, 'series', 'success', {
        summary: `${path.basename(currentPath)} → ${path.basename(finalPath)}`,
        details: {
          currentPath,
          newPath: finalPath,
          newName,
          seriesId,
          season: rename.season,
          episode: rename.episode,
        },
      });
    } catch (error) {
      results.failed++;
      results.errors.push({
        seriesId: rename.seriesId,
        currentName: path.basename(rename.currentPath),
        error: error.message,
      });
      console.error(`❌ Failed to rename series file ${path.basename(rename.currentPath)}:`, error);
      await logFileRename(userId, 'series', 'failure', {
        summary: `Series rename failed: ${path.basename(rename.currentPath)} — ${error.message}`,
        details: {
          currentPath: rename.currentPath,
          newName: rename.newName,
          seriesId: rename.seriesId,
          error: error.message,
        },
      });
    }
  }

  return results;
}

module.exports = {
  extractMetadataFromFilename,
  extractSeasonEpisode,
  extractSeriesTitleFromFilename,
  applyMovieFormat,
  applySeriesFormat,
  computeMovieRenameRow,
  recomputeMovieRenameWithTmdb,
  previewMovieRenames,
  previewSeriesRenames,
  executeMovieRenames,
  executeSeriesRenames,
};


