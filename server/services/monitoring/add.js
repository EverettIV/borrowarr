const MonitoredMovies = require('../../models/MonitoredMovies');
const MonitoredSeries = require('../../models/MonitoredSeries');
const Settings = require('../../models/Settings');
const { loadQualitySettings } = require('./grabRelease');
const {
  probeMovieLibrary,
  probeSeriesEpisodes,
  syncMovieFromLibrary,
  initializeEpisodeStatus,
} = require('./librarySync');
const { processMonitoredMovie, processMonitoredSeries } = require('./cycle');
const { ensureUserScheduled, triggerUserCheck } = require('./scheduler');
const { getQualityRank, detectQualityFromReleaseTitle } = require('../../utils/qualitySelection');
const { logMonitoring } = require('./activityLog');

function summarizeMovieAction({ probe, processResult, autoDownload, isUpdate }) {
  if (processResult?.grab) {
    const prefix = isUpdate ? 'Already monitored' : 'Added';
    return {
      action: 'grabbed',
      message: isUpdate
        ? `${prefix}; grab queued in your download client (${processResult.grab.torrentTitle})`
        : `Added and grab started: ${processResult.grab.torrentTitle}`,
    };
  }
  if (probe?.exists && !processResult?.sync?.wanted) {
    return {
      action: 'on_disk',
      message: isUpdate
        ? `Already monitored — on disk (${probe.fileQuality || 'unknown'})`
        : `${isUpdate ? 'Updated' : 'Added'} — already on disk (${probe.fileQuality || 'unknown'})`,
    };
  }
  if (isUpdate) {
    if (processResult?.status === 'downloading') {
      return {
        action: 'monitoring',
        message:
          'Already being monitored; download is in progress in your client.',
      };
    }
    if (processResult?.message === 'already_downloading') {
      return {
        action: 'monitoring',
        message:
          'Already being monitored; download is in progress in your client.',
      };
    }
    return {
      action: 'monitoring',
      message:
        'Already being monitored. If it is not downloaded yet, the next check will search and grab again.',
    };
  }
  if (processResult?.sync?.wanted && autoDownload) {
    if (processResult?.message?.includes('No releases')) {
      return { action: 'no_releases', message: 'On watch list; no matching releases right now' };
    }
    return { action: 'monitoring', message: 'On watch list; will retry automatically' };
  }
  if (!autoDownload) {
    return { action: 'monitoring', message: 'On watch list (Automatic Grab off)' };
  }
  return { action: 'monitoring', message: `${isUpdate ? 'Updated' : 'Added'} to monitoring` };
}

async function upsertMonitoredMovie(body) {
  const {
    userId,
    tmdbId,
    title,
    posterUrl,
    releaseDate,
    overview,
    qualityProfile,
    minAvailability,
    monitor,
    status,
  } = body;

  const existing = await MonitoredMovies.findOne({ where: { userId, tmdbId } });
  const determineStatus = (row) => {
    if (status === 'downloaded') return 'downloaded';
    if (row?.status === 'downloaded') return 'downloaded';
    return 'monitoring';
  };

  if (existing) {
    await existing.update({
      title,
      posterUrl: posterUrl || null,
      releaseDate: releaseDate || null,
      overview: overview || null,
      qualityProfile: qualityProfile || 'any',
      minAvailability: minAvailability || 'released',
      monitor: monitor || 'movieOnly',
      status: determineStatus(existing),
    });
    return { movie: existing, isUpdate: true };
  }

  const movie = await MonitoredMovies.create({
    userId,
    tmdbId,
    title,
    posterUrl: posterUrl || null,
    releaseDate: releaseDate || null,
    overview: overview || null,
    qualityProfile: qualityProfile || 'any',
    minAvailability: minAvailability || 'released',
    monitor: monitor || 'movieOnly',
    status: status === 'downloaded' ? 'downloaded' : 'monitoring',
  });
  return { movie, isUpdate: false };
}

async function addMonitoredMovie(body) {
  const {
    userId,
    tmdbId,
    title,
    releaseDate,
    searchOnAdd = true,
    grabOnAdd,
  } = body;

  const { movie, isUpdate } = await upsertMonitoredMovie(body);
  const qs = await loadQualitySettings(userId);
  const settings = await Settings.findOne({ where: { userId } });

  const probe = await probeMovieLibrary(userId, { title, releaseDate, tmdbId });

  if (probe.exists && probe.fileQuality) {
    const prefRank = getQualityRank(qs.maxQuality || qs.minQuality);
    const fileRank = getQualityRank(probe.fileQuality);
    if (fileRank >= prefRank || !qs.allowQualityUpgrade) {
      await movie.update({
        status: 'downloaded',
        fileExists: true,
        fileName: probe.fileInfo?.fileName,
        filePath: probe.fileInfo?.filePath,
        fileSize: probe.fileInfo?.fileSize,
        fileQuality: probe.fileQuality,
      });
    }
  }

  await ensureUserScheduled(userId);

  const shouldProcess =
    grabOnAdd === true ||
    (grabOnAdd !== false && searchOnAdd && qs.autoDownload);

  let processResult = null;
  if (shouldProcess) {
    await movie.reload();
    processResult = await processMonitoredMovie(movie, { forceSearch: true, grabBudget: { remaining: 1 } });
  } else if (searchOnAdd) {
    await syncMovieFromLibrary(movie, { ...settings?.toJSON?.() ?? settings, ...qs });
    setImmediate(() => {
      triggerUserCheck(userId).catch((err) =>
        console.error('[Monitoring] Background trigger failed:', err.message),
      );
    });
  }

  const summary = summarizeMovieAction({
    probe,
    processResult,
    autoDownload: qs.autoDownload,
    isUpdate,
  });

  const grab = processResult?.grab;
  let logStatus = 'info';
  if (summary.action === 'grabbed' || grab) logStatus = 'success';
  if (summary.action === 'on_disk') logStatus = 'success';
  await logMonitoring(userId, {
    action: isUpdate ? 'movie_updated' : 'movie_added',
    status: logStatus,
    summary: summary.message,
    details: {
      tmdbId,
      title: movie.title,
      trigger: 'add',
      outcome: summary.action,
      ...(grab
        ? {
            highlights: [
              `release: ${grab.torrentTitle}`,
              grab.indexer ? `indexer: ${grab.indexer}` : null,
              grab.quality ? `quality: ${grab.quality}` : null,
            ].filter(Boolean),
          }
        : {}),
    },
  });

  return {
    success: true,
    movie: (await movie.reload(), movie),
    isUpdate,
    autoDownload: qs.autoDownload,
    probe,
    processResult,
    action: summary.action,
    message: summary.message,
  };
}

async function upsertMonitoredSeries(body) {
  const {
    userId,
    tmdbId,
    title,
    posterUrl,
    firstAirDate,
    overview,
    qualityProfile,
    minAvailability,
    monitor,
    selectedSeasons,
    selectedEpisodes,
    status,
  } = body;

  const episodeKeys = Array.isArray(selectedEpisodes)
    ? selectedEpisodes.map((e) =>
        typeof e === 'string' ? e : `${e.seasonNumber ?? e.season}-${e.episodeNumber ?? e.episode}`,
      )
    : [];

  const existing = await MonitoredSeries.findOne({ where: { userId, tmdbId } });

  const determineStatus = (row) => {
    if (status === 'downloaded') return 'downloaded';
    if (row?.status === 'downloaded') return 'downloaded';
    return 'monitoring';
  };

  const baseFields = {
    title,
    posterUrl: posterUrl || null,
    firstAirDate: firstAirDate || null,
    overview: overview || null,
    qualityProfile: qualityProfile || 'any',
    minAvailability: minAvailability || 'released',
    monitor: monitor || 'all',
    selectedSeasons: selectedSeasons ? JSON.stringify(selectedSeasons) : null,
    selectedEpisodes: episodeKeys.length ? JSON.stringify(episodeKeys) : null,
  };

  if (existing) {
    await existing.update({
      ...baseFields,
      status: determineStatus(existing),
    });
    return { series: existing, isUpdate: true, episodeKeys };
  }

  const series = await MonitoredSeries.create({
    userId,
    tmdbId,
    ...baseFields,
    episodeStatus: JSON.stringify(initializeEpisodeStatus(episodeKeys)),
    status: status === 'downloaded' ? 'downloaded' : 'monitoring',
  });
  return { series, isUpdate: false, episodeKeys };
}

async function addMonitoredSeries(body) {
  const { userId, title, searchOnAdd = true, grabOnAdd, selectedEpisodes } = body;

  const episodesForProbe = (Array.isArray(selectedEpisodes) ? selectedEpisodes : []).map((e) =>
    typeof e === 'string'
      ? { seasonNumber: parseInt(e.split('-')[0], 10), episodeNumber: parseInt(e.split('-')[1], 10) }
      : {
          seasonNumber: e.seasonNumber ?? e.season,
          episodeNumber: e.episodeNumber ?? e.episode,
        },
  );

  const { series, isUpdate } = await upsertMonitoredSeries(body);
  const qs = await loadQualitySettings(userId);
  const probe = await probeSeriesEpisodes(userId, { title, episodes: episodesForProbe });

  await ensureUserScheduled(userId);

  const shouldProcess =
    grabOnAdd === true ||
    (grabOnAdd !== false && searchOnAdd && qs.autoDownload);

  let processResult = null;
  if (shouldProcess) {
    await series.reload();
    processResult = await processMonitoredSeries(series, {
      forceSearch: true,
      grabBudget: { remaining: Math.min(3, qs.maxGrabsPerCycle || 5) },
    });
  } else if (searchOnAdd) {
    setImmediate(() => {
      triggerUserCheck(userId).catch((err) =>
        console.error('[Monitoring] Background trigger failed:', err.message),
      );
    });
  }

  const grabbed = processResult?.episodesGrabbed || 0;
  let action = 'monitoring';
  let message = isUpdate ? 'Series monitoring updated' : 'Series added to monitoring';
  if (grabbed > 0) {
    action = 'grabbed';
    message = `Grab started for ${grabbed} episode(s)`;
  } else if (!qs.autoDownload) {
    message += ' (Automatic Grab off)';
  }

  await logMonitoring(userId, {
    action: isUpdate ? 'series_updated' : 'series_added',
    status: grabbed > 0 ? 'success' : 'info',
    summary: message,
    details: {
      tmdbId: series.tmdbId,
      title: series.title,
      trigger: 'add',
      outcome: action,
      episodesGrabbed: grabbed,
    },
  });

  return {
    success: true,
    series: (await series.reload(), series),
    isUpdate,
    autoDownload: qs.autoDownload,
    probe,
    processResult,
    action,
    message,
  };
}

module.exports = {
  addMonitoredMovie,
  addMonitoredSeries,
  probeMovieLibrary,
  probeSeriesEpisodes,
};