const Settings = require('../../models/Settings');
const { grabReleaseInternal } = require('../../controllers/DownloadClients');
const {
  filterTorrentsForQualityPrefs,
  pickBestTorrentForDownload,
  detectQualityFromReleaseTitle,
} = require('../../utils/qualitySelection');
const { pickBestMatchingMovieRelease } = require('../../utils/releaseTitleMatch');
const { searchReleasesForMonitoring } = require('./releaseSearch');

async function loadQualitySettings(userId) {
  const settings = await Settings.findOne({ where: { userId } });
  return {
    settings,
    minQuality: settings?.minQuality || '720p',
    maxQuality: settings?.maxQuality || '2160p',
    preferredQuality: settings?.minQuality || '720p',
    preferSeedersInQualityRange: settings?.preferSeedersInQualityRange ?? true,
    autoDownload: settings?.autoDownload ?? true,
    allowQualityUpgrade: settings?.allowQualityUpgrade !== false,
    maxGrabsPerCycle: settings?.maxGrabsPerCycle || 5,
  };
}

async function searchAndGrabMovie(movie, userId, options = {}) {
  const parsedYear = movie.releaseDate ? new Date(movie.releaseDate).getFullYear() : null;
  const year =
    parsedYear && !Number.isNaN(parsedYear) ? String(parsedYear) : '';
  const searchQuery = year ? `${movie.title} ${year}` : movie.title;

  const torrents = await searchReleasesForMonitoring(searchQuery, ['2000']);
  if (torrents.length === 0) {
    throw new Error('No releases found');
  }

  const qs = await loadQualitySettings(userId);
  const filteredTorrents = filterTorrentsForQualityPrefs(torrents, {
    minQuality: qs.minQuality,
    maxQuality: qs.maxQuality,
    preferredQuality: qs.preferredQuality,
    itemQualityProfile: movie.qualityProfile,
  });

  if (filteredTorrents.length === 0) {
    throw new Error(
      `No releases within quality range ${qs.minQuality}–${qs.maxQuality}`,
    );
  }

  const bestTorrent = pickBestMatchingMovieRelease(filteredTorrents, {
    title: movie.title,
    year: year || parsedYear,
    preferredQuality: qs.preferredQuality,
    itemQualityProfile: movie.qualityProfile,
    preferSeedersInQualityRange: qs.preferSeedersInQualityRange,
  });
  if (!bestTorrent) {
    throw new Error(
      `No releases matched "${movie.title}"${year ? ` (${year})` : ''} after filtering`,
    );
  }

  const quality = detectQualityFromReleaseTitle(bestTorrent.title);

  await grabReleaseInternal({
    downloadUrl: bestTorrent.downloadUrl,
    protocol: bestTorrent.protocol,
    releaseName: bestTorrent.title,
    indexer: bestTorrent.indexer,
    indexerId: bestTorrent.indexerId,
    size: bestTorrent.size,
    sizeFormatted: bestTorrent.sizeFormatted,
    seeders: bestTorrent.seeders,
    leechers: bestTorrent.leechers,
    quality,
    source: options.source || 'Monitoring',
    mediaType: 'movies',
    mediaTitle: movie.title,
    tmdbId: movie.tmdbId,
  }, userId);

  return {
    torrentId: bestTorrent.id,
    torrentTitle: bestTorrent.title,
    indexer: bestTorrent.indexer,
    quality,
  };
}

async function searchAndGrabEpisode(series, seasonNumber, episodeNumber, userId, options = {}) {
  const seasonStr = String(seasonNumber).padStart(2, '0');
  const episodeStr = String(episodeNumber).padStart(2, '0');
  const searchQuery = `${series.title} S${seasonStr}E${episodeStr}`;

  const torrents = await searchReleasesForMonitoring(searchQuery, ['5000']);
  if (torrents.length === 0) {
    throw new Error('No releases found for episode');
  }

  const qs = await loadQualitySettings(userId);
  const filteredTorrents = filterTorrentsForQualityPrefs(torrents, {
    minQuality: qs.minQuality,
    maxQuality: qs.maxQuality,
    preferredQuality: qs.preferredQuality,
    itemQualityProfile: series.qualityProfile,
  });

  if (filteredTorrents.length === 0) {
    throw new Error(
      `No releases within quality range ${qs.minQuality}–${qs.maxQuality}`,
    );
  }

  const bestTorrent = pickBestTorrentForDownload(filteredTorrents, {
    preferredQuality: qs.preferredQuality,
    itemQualityProfile: series.qualityProfile,
    preferSeedersInQualityRange: qs.preferSeedersInQualityRange,
  });
  if (!bestTorrent) {
    throw new Error('No suitable release found after quality filtering');
  }

  const quality = detectQualityFromReleaseTitle(bestTorrent.title);

  await grabReleaseInternal({
    downloadUrl: bestTorrent.downloadUrl,
    protocol: bestTorrent.protocol,
    releaseName: bestTorrent.title,
    indexer: bestTorrent.indexer,
    indexerId: bestTorrent.indexerId,
    size: bestTorrent.size,
    sizeFormatted: bestTorrent.sizeFormatted,
    seeders: bestTorrent.seeders,
    leechers: bestTorrent.leechers,
    quality,
    source: options.source || 'Monitoring',
    mediaType: 'tv',
    mediaTitle: series.title,
    tmdbId: series.tmdbId,
    seasonNumber,
    episodeNumber,
  }, userId);

  return {
    torrentId: bestTorrent.id,
    torrentTitle: bestTorrent.title,
    indexer: bestTorrent.indexer,
    quality,
  };
}

module.exports = {
  loadQualitySettings,
  searchAndGrabMovie,
  searchAndGrabEpisode,
};