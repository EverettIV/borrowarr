const MonitoredMovies = require('../../models/MonitoredMovies');
const MonitoredSeries = require('../../models/MonitoredSeries');
const Settings = require('../../models/Settings');
const { syncMovieFromLibrary, syncSeriesFromLibrary } = require('./librarySync');
const { searchAndGrabMovie, searchAndGrabEpisode, loadQualitySettings } = require('./grabRelease');
const {
  INTER_ITEM_DELAY_MS,
  INTER_EPISODE_GRAB_DELAY_MS,
  MAX_EPISODE_GRABS_PER_SERIES_PER_CYCLE,
  DEFAULT_MAX_GRABS_PER_CYCLE,
} = require('./constants');
const { logMonitoring } = require('./activityLog');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tryGrabMovie(movie, settings, grabBudget) {
  if (grabBudget.remaining <= 0) return { grabbed: false, reason: 'grab_budget' };
  if (movie.status === 'downloading') {
    return { grabbed: false, reason: 'already_downloading' };
  }

  try {
    const grab = await searchAndGrabMovie(movie, movie.userId, { source: 'Monitoring' });
    await movie.update({
      status: 'downloading',
      grabAttemptedAt: new Date(),
      downloadedTorrentId: grab.torrentId,
      downloadedTorrentTitle: grab.torrentTitle,
      lastGrabError: null,
    });
    grabBudget.remaining -= 1;
    await logMonitoring(movie.userId, {
      action: 'movie_grab_queued',
      status: 'success',
      summary: `Download queued: ${movie.title} — ${grab.torrentTitle}`,
      details: {
        tmdbId: movie.tmdbId,
        title: movie.title,
        trigger: 'monitoring_cycle',
        highlights: [
          `release: ${grab.torrentTitle}`,
          grab.indexer ? `indexer: ${grab.indexer}` : null,
          grab.quality ? `quality: ${grab.quality}` : null,
        ].filter(Boolean),
      },
    });
    return { grabbed: true, grab };
  } catch (error) {
    await movie.update({
      status: 'missing',
      lastGrabError: error.message,
      lastChecked: new Date(),
    });
    await logMonitoring(movie.userId, {
      action: 'movie_grab_failed',
      status: 'failure',
      summary: `Could not queue download: ${movie.title}`,
      details: {
        tmdbId: movie.tmdbId,
        title: movie.title,
        trigger: 'monitoring_cycle',
        error: error.message,
      },
    });
    return { grabbed: false, error: error.message };
  }
}

async function processMonitoredMovie(movie, options = {}) {
  const settings = await Settings.findOne({ where: { userId: movie.userId } });
  const qs = await loadQualitySettings(movie.userId);
  const sync = await syncMovieFromLibrary(movie, { ...settings?.toJSON?.() ?? settings, ...qs });

  const grabBudget = options.grabBudget || { remaining: qs.maxGrabsPerCycle || DEFAULT_MAX_GRABS_PER_CYCLE };
  const forceSearch = options.forceSearch === true;
  const autoDownload = qs.autoDownload;

  if (!sync.wanted) {
    return {
      movieId: movie.id,
      title: movie.title,
      status: sync.status === 'found' ? 'downloaded' : sync.status,
      message: sync.status === 'upgrade_wanted' ? 'Unexpected upgrade state' : 'Satisfied on disk',
      sync,
    };
  }

  if (!autoDownload && !forceSearch) {
    return {
      movieId: movie.id,
      title: movie.title,
      status: sync.hasFile ? 'monitoring' : 'missing',
      message: 'Wanted but auto-download is disabled',
      sync,
    };
  }

  const grabResult = await tryGrabMovie(movie, settings, grabBudget);
  const stillDownloading =
    grabResult.reason === 'already_downloading' || movie.status === 'downloading';
  return {
    movieId: movie.id,
    title: movie.title,
    status: grabResult.grabbed || stillDownloading ? 'downloading' : 'missing',
    message: grabResult.grabbed
      ? 'Auto-download initiated'
      : grabResult.error || grabResult.reason || 'Grab skipped',
    sync,
    grab: grabResult.grab || null,
  };
}

async function processMonitoredSeries(series, options = {}) {
  const qs = await loadQualitySettings(series.userId);
  const settings = await Settings.findOne({ where: { userId: series.userId } });
  const sync = await syncSeriesFromLibrary(series, { ...settings?.toJSON?.() ?? settings, ...qs });

  const grabBudget = options.grabBudget || { remaining: qs.maxGrabsPerCycle || DEFAULT_MAX_GRABS_PER_CYCLE };
  const forceSearch = options.forceSearch === true;
  const autoDownload = qs.autoDownload;
  let grabbed = 0;
  const grabResults = [];

  if (!sync.wantedEpisodes?.length) {
    return {
      seriesId: series.id,
      title: series.title,
      status: sync.status,
      message: 'All selected episodes on disk',
      sync,
    };
  }

  if (!autoDownload && !forceSearch) {
    return {
      seriesId: series.id,
      title: series.title,
      status: sync.status,
      message: 'Episodes wanted but auto-download is disabled',
      sync,
    };
  }

  let episodeStatus = sync.episodeStatus || {};
  const toGrab = sync.wantedEpisodes.slice(0, MAX_EPISODE_GRABS_PER_SERIES_PER_CYCLE);

  for (const ep of toGrab) {
    if (grabBudget.remaining <= 0) break;
    const state = episodeStatus[ep.key];
    if (state?.status === 'downloading') continue;

    try {
      const grab = await searchAndGrabEpisode(
        series,
        ep.season,
        ep.episode,
        series.userId,
        { source: 'Monitoring' },
      );
      episodeStatus[ep.key] = {
        ...(episodeStatus[ep.key] || {}),
        status: 'downloading',
        grabAttemptedAt: new Date().toISOString(),
        lastGrabError: null,
        grabbedTitle: grab.torrentTitle,
      };
      grabbed += 1;
      grabBudget.remaining -= 1;
      grabResults.push({ ...ep, grab });
      await logMonitoring(series.userId, {
        action: 'episode_grab_queued',
        status: 'success',
        summary: `Download queued: ${series.title} S${ep.season}E${ep.episode} — ${grab.torrentTitle}`,
        details: {
          tmdbId: series.tmdbId,
          title: series.title,
          episode: ep.key,
          trigger: 'monitoring_cycle',
          highlights: [`release: ${grab.torrentTitle}`],
        },
      });
      await delay(INTER_EPISODE_GRAB_DELAY_MS);
    } catch (error) {
      if (!String(error.message).includes('No torrents found')) {
        console.error(`[Monitoring] Episode grab failed ${series.title} ${ep.key}:`, error.message);
      }
      if (!String(error.message).includes('No torrents found')) {
        await logMonitoring(series.userId, {
          action: 'episode_grab_failed',
          status: 'failure',
          summary: `Could not queue ${series.title} S${ep.season}E${ep.episode}`,
          details: {
            tmdbId: series.tmdbId,
            title: series.title,
            episode: ep.key,
            trigger: 'monitoring_cycle',
            error: error.message,
          },
        });
      }
      episodeStatus[ep.key] = {
        ...(episodeStatus[ep.key] || {}),
        lastGrabError: error.message,
      };
    }
  }

  const anyDownloading = Object.values(episodeStatus).some((e) => e.status === 'downloading');
  await series.update({
    episodeStatus: JSON.stringify(episodeStatus),
    status: anyDownloading || grabbed > 0 ? 'downloading' : series.status,
    lastChecked: new Date(),
  });

  return {
    seriesId: series.id,
    title: series.title,
    status: grabbed > 0 ? 'downloading' : sync.status,
    episodesGrabbed: grabbed,
    grabResults,
    sync,
  };
}

async function runUserMonitoringCycle(userId, options = {}) {
  const qs = await loadQualitySettings(userId);
  const grabBudget = { remaining: qs.maxGrabsPerCycle || DEFAULT_MAX_GRABS_PER_CYCLE };

  const movieResults = [];
  const movies = await MonitoredMovies.findAll({ where: { userId } });

  for (const movie of movies) {
    const result = await processMonitoredMovie(movie, {
      ...options,
      grabBudget,
    });
    movieResults.push(result);
    await delay(INTER_ITEM_DELAY_MS);
  }

  const seriesResults = [];
  const allSeries = await MonitoredSeries.findAll({ where: { userId } });

  for (const series of allSeries) {
    const result = await processMonitoredSeries(series, {
      ...options,
      grabBudget,
    });
    seriesResults.push(result);
    await delay(INTER_ITEM_DELAY_MS);
  }

  return { movies: movieResults, series: seriesResults, grabsRemaining: grabBudget.remaining };
}

module.exports = {
  processMonitoredMovie,
  processMonitoredSeries,
  runUserMonitoringCycle,
};