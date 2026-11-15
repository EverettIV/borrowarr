const fs = require('fs').promises;
const path = require('path');
const MonitoredMovies = require('../models/MonitoredMovies');
const MonitoredSeries = require('../models/MonitoredSeries');
const { getUserMovieDirectory, getUserSeriesDirectory, titleMatchesFilename } = require('./fileScanner');
const { applyMovieFormat, applySeriesFormat } = require('./fileRenamer');

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v',
  '.mpg', '.mpeg', '.m2ts', '.ts', '.vob',
]);

const MIN_MOVIE_BYTES = 50 * 1024 * 1024;
const MIN_EPISODE_BYTES = 20 * 1024 * 1024;

function applyRemotePathMappings(filePath, mappings) {
  if (!filePath || !Array.isArray(mappings) || mappings.length === 0) {
    return filePath;
  }
  for (const map of mappings) {
    if (!map?.host || !map?.remote) continue;
    if (filePath.startsWith(map.host)) {
      return map.remote + filePath.slice(map.host.length);
    }
    if (filePath.startsWith(map.remote)) {
      return filePath;
    }
  }
  return filePath;
}

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function collectVideoFiles(rootPath, files = []) {
  const stat = await fs.stat(rootPath);
  if (stat.isFile()) {
    const ext = path.extname(rootPath).toLowerCase();
    if (VIDEO_EXTENSIONS.has(ext)) {
      files.push({ path: rootPath, size: stat.size });
    }
    return files;
  }

  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      const lower = entry.name.toLowerCase();
      if (['sample', 'subs', 'subtitles', 'extras', 'featurettes'].includes(lower)) continue;
      await collectVideoFiles(full, files);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (VIDEO_EXTENSIONS.has(ext)) {
        const st = await fs.stat(full);
        files.push({ path: full, size: st.size });
      }
    }
  }
  return files;
}

async function transferFile(mode, sourcePath, destPath) {
  await fs.mkdir(path.dirname(destPath), { recursive: true });

  if (mode === 'move') {
    try {
      await fs.rename(sourcePath, destPath);
      return { method: 'move' };
    } catch (err) {
      if (err.code !== 'EXDEV' && !String(err.message).includes('cross-device')) {
        throw err;
      }
    }
  }

  if (mode === 'hardlink') {
    try {
      await fs.link(sourcePath, destPath);
      return { method: 'hardlink' };
    } catch (err) {
      if (err.code !== 'EXDEV' && !String(err.message).includes('cross-device')) {
        throw err;
      }
    }
  }

  await fs.copyFile(sourcePath, destPath);
  if (mode === 'move') {
    await fs.unlink(sourcePath);
    return { method: 'move' };
  }
  return { method: mode === 'hardlink' ? 'copy' : 'copy' };
}

function matchesHistoryMedia(history, fileName) {
  if (history.mediaTitle && titleMatchesFilename(history.mediaTitle, fileName, null)) {
    return true;
  }
  const release = (history.releaseName || '').toLowerCase();
  const file = fileName.toLowerCase();
  if (release.length > 10 && (file.includes(release.slice(0, 40)) || release.includes(path.parse(file).name.slice(0, 30)))) {
    return true;
  }
  return false;
}

/**
 * Import a completed download into the user's library (second step after client reports complete).
 */
async function importCompletedDownload(history, userSettings) {
  const userId = history.userId;
  const mappings = userSettings.remotePathMappings || [];
  let outputPath = applyRemotePathMappings(history.outputPath, mappings);

  if (!outputPath || !(await pathExists(outputPath))) {
    return {
      success: false,
      blocked: true,
      reason: `Output path not accessible: ${history.outputPath}`,
    };
  }

  const stat = await fs.stat(outputPath);
  const scanRoot = stat.isDirectory() ? outputPath : path.dirname(outputPath);
  const videos = await collectVideoFiles(outputPath);

  if (videos.length === 0) {
    return { success: false, blocked: true, reason: 'No video files found at output path' };
  }

  const importMode = userSettings.completedDownloadImportMode || 'hardlink';
  const autoRename = userSettings.autoRename === true;

  if (history.mediaType === 'movie') {
    const libraryDir = await getUserMovieDirectory(userId);
    if (!libraryDir) {
      return { success: false, blocked: true, reason: 'Movie library directory not configured' };
    }

    const candidates = videos
      .filter((v) => v.size >= MIN_MOVIE_BYTES)
      .sort((a, b) => b.size - a.size);

    let chosen = candidates.find((v) => matchesHistoryMedia(history, path.basename(v.path)));
    if (!chosen) chosen = candidates[0];

    if (!chosen) {
      return { success: false, blocked: true, reason: 'No sufficiently large movie file found' };
    }

    let movie = null;
    if (history.tmdbId) {
      movie = await MonitoredMovies.findOne({ where: { userId, tmdbId: history.tmdbId } });
    }
    if (!movie && history.mediaTitle) {
      movie = await MonitoredMovies.findOne({ where: { userId, title: history.mediaTitle } });
    }

    const ext = path.extname(chosen.path);
    let destName;
    if (autoRename && movie && userSettings.movieFileFormat) {
      destName = `${await applyMovieFormat(
        userSettings.movieFileFormat,
        movie,
        path.basename(chosen.path),
        chosen.path,
      )}${ext}`;
    } else {
      destName = path.basename(chosen.path);
    }

    const destPath = path.join(libraryDir, destName);
    const transfer = await transferFile(importMode, chosen.path, destPath);

    if (movie) {
      await movie.update({
        status: 'downloaded',
        fileExists: true,
        filePath: destPath,
        fileName: destName,
        downloadedTorrentTitle: history.releaseName,
      });
    }

    return {
      success: true,
      importedPath: destPath,
      method: transfer.method,
      scanRoot,
    };
  }

  if (history.mediaType === 'tv') {
    const libraryDir = await getUserSeriesDirectory(userId);
    if (!libraryDir) {
      return { success: false, blocked: true, reason: 'Series library directory not configured' };
    }

    if (!history.tmdbId || history.seasonNumber == null || history.episodeNumber == null) {
      return { success: false, blocked: true, reason: 'Missing tmdbId/season/episode for TV import' };
    }

    const series = await MonitoredSeries.findOne({ where: { userId, tmdbId: history.tmdbId } });
    if (!series) {
      return { success: false, blocked: true, reason: 'Series not found in monitored library' };
    }

    const candidates = videos
      .filter((v) => v.size >= MIN_EPISODE_BYTES)
      .sort((a, b) => b.size - a.size);

    let chosen = candidates[0];
    for (const v of candidates) {
      const name = path.basename(v.path).toLowerCase();
      const s = String(history.seasonNumber).padStart(2, '0');
      const e = String(history.episodeNumber).padStart(2, '0');
      if (name.includes(`s${s}e${e}`) || name.includes(`${history.seasonNumber}x${e}`)) {
        chosen = v;
        break;
      }
    }

    const ext = path.extname(chosen.path);
    let destRelative;
    if (autoRename && userSettings.seriesFileFormat) {
      destRelative = `${await applySeriesFormat(
        userSettings.seriesFileFormat,
        series,
        history.seasonNumber,
        history.episodeNumber,
        '',
        path.basename(chosen.path),
        chosen.path,
      )}${ext}`;
    } else {
      destRelative = path.basename(chosen.path);
    }

    const destPath = path.join(libraryDir, destRelative);
    const transfer = await transferFile(importMode, chosen.path, destPath);

    await series.update({ status: 'downloaded', fileExists: true });

    return {
      success: true,
      importedPath: destPath,
      method: transfer.method,
      scanRoot,
    };
  }

  return { success: false, blocked: true, reason: `Unsupported mediaType: ${history.mediaType}` };
}

module.exports = {
  importCompletedDownload,
  applyRemotePathMappings,
  collectVideoFiles,
};