const path = require('path');
const fs = require('fs').promises;
const Settings = require('../../models/Settings');
const {
  findMovieFile,
  findSeriesEpisodeFile,
  getUserMovieDirectory,
  getUserSeriesDirectory,
} = require('../fileScanner');
const { applyMovieFormat } = require('../fileRenamer');
const {
  getQualityRank,
  detectQualityFromReleaseTitle,
} = require('../../utils/qualitySelection');
const { STALE_DOWNLOAD_MS } = require('./constants');
const { logMonitoring } = require('./activityLog');

function parseEpisodeKeys(series) {
  try {
    const raw = series.selectedEpisodes ? JSON.parse(series.selectedEpisodes) : [];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function parseEpisodeStatus(series) {
  try {
    const raw = series.episodeStatus ? JSON.parse(series.episodeStatus) : {};
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function qualityWantsUpgrade(fileQuality, settings) {
  if (settings.allowQualityUpgrade === false) return false;
  const fileRank = getQualityRank(fileQuality);
  const prefRank = getQualityRank(settings.maxQuality || settings.minQuality || '1080p');
  const maxRank = getQualityRank(settings.maxQuality || '2160p');
  if (fileRank === 0) return false;
  return fileRank < prefRank && fileRank <= maxRank;
}

function movieWantsGrab(movie, hasFile, fileQuality, settings) {
  if (!hasFile) return { wanted: true, reason: 'missing' };
  if (qualityWantsUpgrade(fileQuality, settings)) {
    return { wanted: true, reason: 'upgrade' };
  }
  return { wanted: false, reason: 'satisfied' };
}

async function reconcileStaleDownload(movie) {
  if (movie.status !== 'downloading') return false;
  const attempted = movie.grabAttemptedAt ? new Date(movie.grabAttemptedAt).getTime() : 0;
  if (attempted && Date.now() - attempted > STALE_DOWNLOAD_MS) {
    await movie.update({
      status: 'monitoring',
      lastGrabError: 'Download timed out — will retry on next check',
    });
    return true;
  }
  return false;
}

async function syncMovieFromLibrary(movie, settings) {
  const userId = movie.userId;
  const movieDirectory = await getUserMovieDirectory(userId);

  if (!movieDirectory) {
    return {
      status: 'no_directory',
      message: 'Movie directory not configured',
      hasFile: false,
      wanted: false,
    };
  }

  await reconcileStaleDownload(movie);
  await movie.reload();

  const fileInfo = await findMovieFile(movie, movieDirectory);

  if (fileInfo?.found) {
    let finalFilePath = fileInfo.filePath;
    let finalFileName = fileInfo.fileName;
    const autoRename = settings?.autoRename ?? false;

    if (autoRename && settings?.movieFileFormat) {
      try {
        const currentName = path.basename(fileInfo.filePath);
        const currentExt = path.extname(fileInfo.filePath);
        const directory = path.dirname(fileInfo.filePath);
        const newBaseName = await applyMovieFormat(
          settings.movieFileFormat,
          movie,
          currentName,
          fileInfo.filePath,
        );
        const newName = `${newBaseName}${currentExt}`;
        if (currentName !== newName) {
          const newPath = path.join(directory, newName);
          try {
            await fs.access(newPath);
          } catch {
            await fs.rename(fileInfo.filePath, newPath);
            finalFilePath = newPath;
            finalFileName = newName;
          }
        }
      } catch (err) {
        console.error(`[Monitoring] Auto-rename failed for ${movie.title}:`, err.message);
      }
    }

    const fileQuality = detectQualityFromReleaseTitle(finalFileName);
    const want = movieWantsGrab(movie, true, fileQuality, settings);

    const status = want.wanted ? 'monitoring' : 'downloaded';
    const wasOnDisk = movie.status === 'downloaded' && movie.fileExists;
    await movie.update({
      status,
      fileExists: true,
      filePath: finalFilePath,
      fileName: finalFileName,
      fileSize: fileInfo.fileSize,
      fileQuality,
      lastChecked: new Date(),
    });

    if (!wasOnDisk && status === 'downloaded') {
      await logMonitoring(userId, {
        action: 'movie_on_disk',
        status: 'success',
        summary: `On disk: ${movie.title} (${fileQuality || 'unknown quality'})`,
        details: {
          tmdbId: movie.tmdbId,
          title: movie.title,
          trigger: 'library_sync',
          fileName: finalFileName,
          fileQuality,
        },
      });
    }

    return {
      status: want.wanted ? 'upgrade_wanted' : 'found',
      hasFile: true,
      fileQuality,
      wanted: want.wanted,
      wantedReason: want.reason,
      fileInfo: { ...fileInfo, filePath: finalFilePath, fileName: finalFileName },
    };
  }

  await movie.update({
    fileExists: false,
    filePath: null,
    fileName: null,
    fileSize: null,
    fileQuality: null,
    lastChecked: new Date(),
    status: movie.status === 'downloading' ? 'downloading' : 'missing',
  });

  const want = movieWantsGrab(movie, false, null, settings);
  return {
    status: 'missing',
    hasFile: false,
    wanted: want.wanted,
    wantedReason: want.reason,
  };
}

async function syncSeriesFromLibrary(series, settings) {
  const userId = series.userId;
  const seriesDirectory = await getUserSeriesDirectory(userId);
  const episodeKeys = parseEpisodeKeys(series);
  let episodeStatus = parseEpisodeStatus(series);

  if (!seriesDirectory) {
    await series.update({ lastChecked: new Date() });
    return {
      status: 'no_directory',
      episodeKeys,
      wantedEpisodes: episodeKeys.map((key) => ({ key, reason: 'missing' })),
    };
  }

  if (episodeKeys.length === 0) {
    await series.update({ lastChecked: new Date() });
    return { status: 'no_episodes', episodeKeys: [], wantedEpisodes: [] };
  }

  const wantedEpisodes = [];

  for (const key of episodeKeys) {
    const [seasonNum, episodeNum] = key.split('-').map(Number);
    const fileInfo = await findSeriesEpisodeFile(series, seriesDirectory, seasonNum, episodeNum);
    const prev = episodeStatus[key] || {};

    if (fileInfo?.found) {
      const fileQuality = detectQualityFromReleaseTitle(fileInfo.fileName);
      const upgrade = qualityWantsUpgrade(fileQuality, settings);
      episodeStatus[key] = {
        ...prev,
        status: upgrade ? 'upgrade_wanted' : 'on_disk',
        filePath: fileInfo.filePath,
        fileName: fileInfo.fileName,
        quality: fileQuality,
        lastChecked: new Date().toISOString(),
      };
      if (upgrade) {
        wantedEpisodes.push({ key, season: seasonNum, episode: episodeNum, reason: 'upgrade' });
      } else if (prev.status !== 'on_disk') {
        await logMonitoring(userId, {
          action: 'episode_on_disk',
          status: 'success',
          summary: `On disk: ${series.title} S${seasonNum}E${episodeNum} (${fileQuality || 'unknown'})`,
          details: {
            tmdbId: series.tmdbId,
            title: series.title,
            episode: key,
            trigger: 'library_sync',
            fileName: fileInfo.fileName,
            fileQuality,
          },
        });
      }
    } else if (prev.status === 'downloading') {
      const attempted = prev.grabAttemptedAt ? new Date(prev.grabAttemptedAt).getTime() : 0;
      if (attempted && Date.now() - attempted > STALE_DOWNLOAD_MS) {
        episodeStatus[key] = {
          ...prev,
          status: 'missing',
          lastGrabError: 'Download timed out',
        };
        wantedEpisodes.push({ key, season: seasonNum, episode: episodeNum, reason: 'missing' });
      } else {
        episodeStatus[key] = { ...prev, status: 'downloading' };
      }
    } else {
      episodeStatus[key] = {
        ...prev,
        status: 'missing',
        filePath: null,
        fileName: null,
        quality: null,
      };
      wantedEpisodes.push({ key, season: seasonNum, episode: episodeNum, reason: 'missing' });
    }
  }

  const allOnDisk = wantedEpisodes.length === 0;
  const anyDownloading = Object.values(episodeStatus).some((e) => e.status === 'downloading');

  let seriesStatus = 'monitoring';
  if (allOnDisk) seriesStatus = 'downloaded';
  else if (anyDownloading) seriesStatus = 'downloading';

  await series.update({
    episodeStatus: JSON.stringify(episodeStatus),
    lastChecked: new Date(),
    status: seriesStatus,
    fileExists: allOnDisk,
  });

  return {
    status: seriesStatus,
    episodeKeys,
    wantedEpisodes,
    episodeStatus,
  };
}

async function probeMovieLibrary(userId, { title, releaseDate, tmdbId }) {
  const movieDirectory = await getUserMovieDirectory(userId);
  if (!movieDirectory) {
    return { exists: false, message: 'Movie directory not configured' };
  }
  const mockMovie = { title, releaseDate, tmdbId };
  const fileInfo = await findMovieFile(mockMovie, movieDirectory);
  if (!fileInfo?.found) {
    return { exists: false, message: 'File not found in library' };
  }
  const fileQuality = detectQualityFromReleaseTitle(fileInfo.fileName);
  return {
    exists: true,
    fileQuality,
    fileInfo: {
      fileName: fileInfo.fileName,
      filePath: fileInfo.filePath,
      fileSize: fileInfo.fileSize,
      fileSizeFormatted: fileInfo.fileSizeFormatted,
    },
    message: `File already exists: ${fileInfo.fileName}`,
  };
}

async function probeSeriesEpisodes(userId, { title, episodes }) {
  const seriesDirectory = await getUserSeriesDirectory(userId);
  if (!seriesDirectory) {
    return { results: [], message: 'Series directory not configured' };
  }
  const mockSeries = { title };
  const results = [];
  for (const episode of episodes || []) {
    const { seasonNumber, episodeNumber } = episode;
    const fileInfo = await findSeriesEpisodeFile(
      mockSeries,
      seriesDirectory,
      seasonNumber,
      episodeNumber,
    );
    results.push({
      seasonNumber,
      episodeNumber,
      key: `${seasonNumber}-${episodeNumber}`,
      exists: !!(fileInfo && fileInfo.found),
      fileQuality: fileInfo?.found
        ? detectQualityFromReleaseTitle(fileInfo.fileName)
        : null,
      fileInfo: fileInfo?.found
        ? {
            fileName: fileInfo.fileName,
            filePath: fileInfo.filePath,
            fileSize: fileInfo.fileSize,
            fileSizeFormatted: fileInfo.fileSizeFormatted,
          }
        : null,
    });
  }
  const existingCount = results.filter((r) => r.exists).length;
  return {
    results,
    existingCount,
    totalCount: results.length,
    message:
      existingCount > 0
        ? `${existingCount} of ${results.length} episodes already exist`
        : 'No episodes found in library',
  };
}

function initializeEpisodeStatus(episodeKeys) {
  const status = {};
  for (const key of episodeKeys) {
    status[key] = { status: 'missing' };
  }
  return status;
}

module.exports = {
  syncMovieFromLibrary,
  syncSeriesFromLibrary,
  probeMovieLibrary,
  probeSeriesEpisodes,
  parseEpisodeKeys,
  initializeEpisodeStatus,
};