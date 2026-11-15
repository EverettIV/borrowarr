const fs = require('fs').promises;
const path = require('path');
const MonitoredMovies = require('../models/MonitoredMovies');
const Settings = require('../models/Settings');
const {
  getMovieMediaDirectory,
  getSeriesMediaDirectory,
  formatBytes,
} = require('./fileScanner');
const { parseMovieFilename, normalizeTitleKey } = require('./libraryImporter');
const {
  findVideoFiles,
  getMovieSceneName,
  findMonitoredMovieFromLabel,
} = require('./mediaOrganizer');
const {
  isFfprobeAvailable,
  probeMediaIntegrity,
  probeLargeFileAnalysis,
} = require('./videoProbe');

const MIN_MOVIE_BYTES = 50 * 1024 * 1024;
const LARGE_FILE_THRESHOLD_BYTES = 10 * 1024 * 1024 * 1024;
const CORRUPTION_PROBE_CONCURRENCY = 4;

const CORRUPTION_REASON_LABELS = {
  ffprobe_error: 'ffprobe could not read the file',
  no_video_stream: 'no video stream found',
  invalid_duration: 'missing or zero duration',
  file_too_small: 'file is too small to be valid video',
  unreadable: 'file could not be read',
  missing_path: 'invalid path',
  ffprobe_unavailable: 'ffprobe is not installed on the server',
};

function isHiddenOrOsMetadata(name) {
  return name.startsWith('.') || name.startsWith('._');
}

function isPathUnderRoot(targetPath, rootPath) {
  if (!rootPath || !targetPath) return false;
  const resolved = path.resolve(targetPath);
  const root = path.resolve(rootPath);
  if (resolved === root) return true;
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return resolved.startsWith(rootWithSep);
}

function resolveMonitoredFromFile(filePath, scanRoot, monitoredList) {
  const byPath = monitoredList.find((m) => m.filePath === filePath);
  if (byPath) return byPath;

  const fileName = path.basename(filePath);
  const parentName = path.basename(path.dirname(filePath));
  const labels = [fileName];
  if (parentName && parentName !== fileName) labels.push(parentName);
  labels.push(getMovieSceneName(filePath, scanRoot));

  const seen = new Set();
  for (const label of labels) {
    if (!label || seen.has(label)) continue;
    seen.add(label);
    const found = findMonitoredMovieFromLabel(label, monitoredList);
    if (found) return found;
  }
  return null;
}

async function resolveScanDirectory(directoryPath) {
  if (!directoryPath || typeof directoryPath !== 'string') {
    const err = new Error('directoryPath is required');
    err.code = 'NO_MEDIA_DIR';
    throw err;
  }

  const mediaDir = path.resolve(directoryPath.trim());

  try {
    const st = await fs.stat(mediaDir);
    if (!st.isDirectory()) {
      const err = new Error('Scan path is not a directory');
      err.code = 'MEDIA_DIR_INACCESSIBLE';
      throw err;
    }
  } catch (e) {
    if (e.code === 'MEDIA_DIR_INACCESSIBLE') throw e;
    const err = new Error('Folder does not exist or is not accessible');
    err.code = 'MEDIA_DIR_INACCESSIBLE';
    throw err;
  }

  return mediaDir;
}

async function collectMovieVideoFiles(scanRoot) {
  const all = await findVideoFiles(scanRoot);
  const files = [];

  for (const fp of all) {
    const name = path.basename(fp);
    if (isHiddenOrOsMetadata(name)) continue;
    try {
      const st = await fs.stat(fp);
      if (!st.isFile() || st.size < MIN_MOVIE_BYTES) continue;
      files.push({
        path: fp,
        fileName: name,
        size: st.size,
        sizeFormatted: formatBytes(st.size),
        lastModified: st.mtime.toISOString(),
      });
    } catch {
      /* skip inaccessible */
    }
  }

  return files;
}

async function getConfiguredDirectoryRoots(userId) {
  const settings = await Settings.findOne({ where: { userId } });
  if (!settings) return [];
  const roots = [
    settings.movieDownloadDirectory,
    getMovieMediaDirectory(settings),
    settings.seriesDownloadDirectory,
    getSeriesMediaDirectory(settings),
    settings.movieWatcherCustomDownloadDirectory,
    settings.movieWatcherCustomMediaDirectory,
    settings.seriesWatcherCustomDownloadDirectory,
    settings.seriesWatcherCustomMediaDirectory,
  ].filter(Boolean);
  return [...new Set(roots.map((r) => path.resolve(r)))];
}

function formatCorruptionReason(reason) {
  return CORRUPTION_REASON_LABELS[reason] || reason;
}

function throwIfScanAborted(shouldAbort) {
  if (typeof shouldAbort === 'function' && shouldAbort()) {
    const err = new Error('Scan cancelled');
    err.code = 'SCAN_CANCELLED';
    throw err;
  }
}

async function mapWithConcurrency(items, concurrency, fn, shouldAbort) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      throwIfScanAborted(shouldAbort);
      const i = nextIndex++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

async function detectCorruptedMovieFiles(videoFiles, shouldAbort) {
  const ffprobeAvailable = await isFfprobeAvailable();
  if (!ffprobeAvailable) {
    return { corruptFiles: [], ffprobeAvailable: false };
  }

  const corruptFiles = [];

  await mapWithConcurrency(
    videoFiles,
    CORRUPTION_PROBE_CONCURRENCY,
    async (file) => {
      const probe = await probeMediaIntegrity(file.path);
      if (probe.healthy === false) {
        corruptFiles.push({
          type: 'corrupt_file',
          path: file.path,
          fileName: file.fileName,
          size: file.size,
          sizeFormatted: file.sizeFormatted,
          lastModified: file.lastModified,
          reason: probe.reason || 'ffprobe_error',
          reasonLabel: formatCorruptionReason(probe.reason || 'ffprobe_error'),
          detail: probe.detail,
        });
      }
    },
    shouldAbort,
  );

  corruptFiles.sort((a, b) => a.path.localeCompare(b.path));
  return { corruptFiles, ffprobeAvailable: true };
}

async function detectLargeMovieFiles(videoFiles, shouldAbort) {
  const candidates = videoFiles.filter((f) => f.size >= LARGE_FILE_THRESHOLD_BYTES);
  const ffprobeAvailable = await isFfprobeAvailable();
  const largeFiles = [];

  await mapWithConcurrency(
    candidates,
    CORRUPTION_PROBE_CONCURRENCY,
    async (file) => {
      const analysis = await probeLargeFileAnalysis(
        file.path,
        file.fileName,
        file.size,
      );
      largeFiles.push({
        type: 'large_file',
        path: file.path,
        fileName: file.fileName,
        size: file.size,
        sizeFormatted: file.sizeFormatted,
        lastModified: file.lastModified,
        thresholdBytes: LARGE_FILE_THRESHOLD_BYTES,
        probeOk: analysis.probeOk,
        durationFormatted: analysis.durationFormatted,
        bitrateMbps: analysis.bitrateMbps,
        quality: analysis.quality,
        videoCodec: analysis.videoCodec,
        width: analysis.width,
        height: analysis.height,
        audioTrackCount: analysis.audioTrackCount,
        subtitleTrackCount: analysis.subtitleTrackCount,
        streamCount: analysis.streamCount,
        formatName: analysis.formatName,
        filenameHints: analysis.filenameHints,
        explanations: analysis.explanations || [],
        probeError: analysis.probeError,
      });
    },
    shouldAbort,
  );

  largeFiles.sort((a, b) => b.size - a.size);
  return {
    largeFiles,
    largeFileThresholdBytes: LARGE_FILE_THRESHOLD_BYTES,
    ffprobeAvailable,
  };
}

function buildDuplicateAnomalies(videoFiles, mediaDir, monitoredList) {
  const groups = new Map();

  for (const file of videoFiles) {
    const monitored = resolveMonitoredFromFile(file.path, mediaDir, monitoredList);
    let groupKey;
    let title;
    let year = null;
    let tmdbId = null;

    if (monitored) {
      groupKey = `tmdb:${monitored.tmdbId}`;
      title = monitored.title;
      tmdbId = monitored.tmdbId;
      if (monitored.releaseDate) {
        const y = new Date(monitored.releaseDate).getFullYear();
        if (Number.isFinite(y)) year = y;
      }
    } else {
      const sceneName = getMovieSceneName(file.path, mediaDir);
      const parsed = parseMovieFilename(sceneName);
      if (!parsed.title || parsed.title.length < 2) {
        continue;
      }
      title = parsed.title;
      year = parsed.year;
      groupKey = `parsed:${normalizeTitleKey(parsed.title)}:${year ?? '?'}`;
    }

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        type: 'duplicate_movie',
        key: groupKey,
        title,
        year,
        tmdbId,
        files: [],
      });
    }
    groups.get(groupKey).files.push(file);
  }

  return [...groups.values()].filter((g) => g.files.length > 1);
}

/**
 * Detect duplicate movies under a chosen directory (saved media folder or custom path).
 */
async function detectDuplicateMovies(userId, options = {}) {
  const mediaDir = await resolveScanDirectory(options.directoryPath);
  const monitoredList = await MonitoredMovies.findAll({ where: { userId } });
  const videoFiles = await collectMovieVideoFiles(mediaDir);
  const anomalies = buildDuplicateAnomalies(videoFiles, mediaDir, monitoredList);

  return {
    scannedAt: new Date().toISOString(),
    mediaDirectory: mediaDir,
    mediaType: 'movies',
    anomalies,
    corruptFiles: [],
    largeFiles: [],
    summary: {
      filesScanned: videoFiles.length,
      duplicateGroups: anomalies.length,
      duplicateFiles: anomalies.reduce((n, g) => n + g.files.length, 0),
      corruptedFiles: 0,
      largeFiles: 0,
      largeFileThresholdBytes: LARGE_FILE_THRESHOLD_BYTES,
      ffprobeAvailable: null,
    },
  };
}

/**
 * Scan folder for duplicate movies, corruption, and/or oversized files (ffprobe).
 */
async function scanMovieAnomalies(userId, options = {}) {
  const checkDuplicates = options.checkDuplicates !== false;
  const checkCorruption = Boolean(options.checkCorruption);
  const checkLargeFiles = Boolean(options.checkLargeFiles);

  if (!checkDuplicates && !checkCorruption && !checkLargeFiles) {
    const err = new Error('Enable at least one scan: duplicates, corruption, or large files');
    err.code = 'NO_CHECKS';
    throw err;
  }

  const shouldAbort = options.shouldAbort;
  throwIfScanAborted(shouldAbort);

  const mediaDir = await resolveScanDirectory(options.directoryPath);
  const videoFiles = await collectMovieVideoFiles(mediaDir);
  throwIfScanAborted(shouldAbort);

  let anomalies = [];
  let corruptFiles = [];
  let largeFiles = [];
  let ffprobeAvailable = null;

  if (checkDuplicates) {
    throwIfScanAborted(shouldAbort);
    const monitoredList = await MonitoredMovies.findAll({ where: { userId } });
    anomalies = buildDuplicateAnomalies(videoFiles, mediaDir, monitoredList);
    throwIfScanAborted(shouldAbort);
  }

  if (checkCorruption) {
    throwIfScanAborted(shouldAbort);
    const corruption = await detectCorruptedMovieFiles(videoFiles, shouldAbort);
    corruptFiles = corruption.corruptFiles;
    ffprobeAvailable = corruption.ffprobeAvailable;
  }

  if (checkLargeFiles) {
    throwIfScanAborted(shouldAbort);
    const large = await detectLargeMovieFiles(videoFiles, shouldAbort);
    largeFiles = large.largeFiles;
    if (ffprobeAvailable === null) {
      ffprobeAvailable = large.ffprobeAvailable;
    } else if (!large.ffprobeAvailable) {
      ffprobeAvailable = false;
    }
  }

  return {
    scannedAt: new Date().toISOString(),
    mediaDirectory: mediaDir,
    mediaType: 'movies',
    anomalies,
    corruptFiles,
    largeFiles,
    summary: {
      filesScanned: videoFiles.length,
      duplicateGroups: anomalies.length,
      duplicateFiles: anomalies.reduce((n, g) => n + g.files.length, 0),
      corruptedFiles: corruptFiles.length,
      largeFiles: largeFiles.length,
      largeFileThresholdBytes: LARGE_FILE_THRESHOLD_BYTES,
      ffprobeAvailable,
    },
  };
}

async function pruneEmptyParents(filePath, stopDir) {
  let dir = path.dirname(filePath);
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

/**
 * Delete a duplicate media file after verifying it lives under the user's media library.
 */
async function deleteDuplicateMediaFile(userId, filePath, options = {}) {
  if (!filePath || typeof filePath !== 'string') {
    const err = new Error('filePath is required');
    err.code = 'INVALID_PATH';
    throw err;
  }

  const configuredRoots = await getConfiguredDirectoryRoots(userId);
  const scanRoot = options.scanDirectory
    ? path.resolve(String(options.scanDirectory))
    : null;
  const allowedRoots = [...configuredRoots];
  if (scanRoot) {
    allowedRoots.push(scanRoot);
  }

  if (
    allowedRoots.length === 0 ||
    !allowedRoots.some((root) => isPathUnderRoot(filePath, root))
  ) {
    const err = new Error('File path is outside an allowed scan or media directory');
    err.code = 'PATH_NOT_ALLOWED';
    throw err;
  }

  let stat;
  try {
    stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      const err = new Error('Path is not a file');
      err.code = 'NOT_A_FILE';
      throw err;
    }
  } catch (e) {
    if (e.code === 'PATH_NOT_ALLOWED' || e.code === 'NOT_A_FILE') throw e;
    const err = new Error('File does not exist or cannot be accessed');
    err.code = 'ENOENT';
    throw err;
  }

  await fs.unlink(filePath);

  const rootForPrune = allowedRoots.find((root) => isPathUnderRoot(filePath, root));
  if (rootForPrune) {
    await pruneEmptyParents(filePath, rootForPrune);
  }

  const monitored = await MonitoredMovies.findOne({ where: { userId, filePath } });
  if (monitored) {
    await monitored.update({
      filePath: null,
      fileName: null,
      fileSize: null,
      fileExists: false,
      lastChecked: new Date(),
    });
  }

  return {
    success: true,
    deletedPath: filePath,
    freedBytes: stat.size,
    freedFormatted: formatBytes(stat.size),
  };
}

module.exports = {
  detectDuplicateMovies,
  scanMovieAnomalies,
  deleteDuplicateMediaFile,
  isPathUnderRoot,
};