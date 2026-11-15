const { addMonitoredMovie, addMonitoredSeries, probeMovieLibrary, probeSeriesEpisodes } = require('./add');
const {
  processMonitoredMovie,
  processMonitoredSeries,
  runUserMonitoringCycle,
} = require('./cycle');
const {
  ensureUserScheduled,
  scheduleUserMonitoring,
  startMonitoringScheduler,
  triggerUserCheck,
} = require('./scheduler');
const { searchAndGrabMovie, searchAndGrabEpisode } = require('./grabRelease');

module.exports = {
  addMonitoredMovie,
  addMonitoredSeries,
  probeMovieLibrary,
  probeSeriesEpisodes,
  processMonitoredMovie,
  processMonitoredSeries,
  runUserMonitoringCycle,
  ensureUserScheduled,
  scheduleUserMonitoring,
  startMonitoringScheduler,
  triggerUserCheck,
  searchAndGrabMovie,
  searchAndGrabEpisode,
  // Legacy names used elsewhere
  checkMonitoredMovie: processMonitoredMovie,
  checkMonitoredSeries: processMonitoredSeries,
  checkUserMonitoredContent: runUserMonitoringCycle,
  checkUserMonitoredMovies: async (userId) => {
    const MonitoredMovies = require('../../models/MonitoredMovies');
    const movies = await MonitoredMovies.findAll({ where: { userId } });
    const results = [];
    for (const movie of movies) {
      results.push(await processMonitoredMovie(movie));
    }
    return results;
  },
  autoDownloadMovie: async (movie, userId) => {
    const { searchAndGrabMovie: grab } = require('./grabRelease');
    return grab(movie, userId);
  },
  autoDownloadEpisode: async (series, s, e, userId) => {
    const { searchAndGrabEpisode: grab } = require('./grabRelease');
    return grab(series, s, e, userId);
  },
};