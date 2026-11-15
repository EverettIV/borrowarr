/**
 * Media naming and library paths (manual import now; auto on download later).
 */

const fs = require('fs').promises;
const { constants: fsConstants } = require('fs');
const path = require('path');
const Settings = require('../models/Settings');
const MonitoredMovies = require('../models/MonitoredMovies');
const MonitoredSeries = require('../models/MonitoredSeries');
const { getUserMovieDirectory, getUserSeriesDirectory, getUserNamingScanDirectory } = require('./fileScanner');
const { parseMovieFilename, searchTMDB } = require('./libraryImporter');
const { enrichMetadataForFormat } = require('./videoProbe');
const tmdb = require('./tmdbService');
const episodeTitleCache = new Map(); // `${tmdbId}:${s}:${e}` -> string

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v',
  '.mpg', '.mpeg', '.m2ts', '.ts', '.vob', '.divx', '.xvid',
]);

function extractMetadataFromFilename(filename) {
  const metadata = {
    quality: '',
    source: '',
    codec: '',
    audio: '',
    edition: '',
    releaseGroup: '',
  };
  const lower = filename.toLowerCase();

  if (lower.includes('2160p') || lower.includes('4k') || lower.includes('uhd')) metadata.quality = '2160p';
  else if (lower.includes('1080p')) metadata.quality = '1080p';
  else if (lower.includes('720p')) metadata.quality = '720p';
  else if (lower.includes('480p')) metadata.quality = '480p';

  if (lower.includes('bluray') || lower.includes('bdrip') || lower.includes('brrip')) metadata.source = 'BluRay';
  else if (lower.includes('web-dl') || lower.includes('webdl')) metadata.source = 'WEB-DL';
  else if (lower.includes('webrip')) metadata.source = 'WEBRip';
  else if (lower.includes('hdtv')) metadata.source = 'HDTV';

  if (lower.includes('x265') || lower.includes('hevc') || lower.includes('h265')) metadata.codec = 'x265';
  else if (lower.includes('x264') || lower.includes('h264')) metadata.codec = 'x264';

  if (lower.includes('dts')) metadata.audio = 'DTS';
  else if (lower.includes('aac')) metadata.audio = 'AAC';

  if (lower.includes('extended')) metadata.edition = 'Extended';
  else if (lower.includes('unrated')) metadata.edition = 'Unrated';

  const groupMatch = filename.match(/[-.]([A-Za-z0-9]{2,12})(?:\.[a-z0-9]+)?$/i);
  if (groupMatch) metadata.releaseGroup = groupMatch[1];

  return metadata;
}

function cleanTitle(title) {
  if (!title) return '';
  let t = String(title)
    .replace(/&/g, 'and')
    .replace(/[<>"/\\|?*]/g, '')
    .trim();
  t = t.replace(/\s+/g, ' ');
  return t;
}

/** Strip year/quality/codec junk that leaked into the title string. */
function sanitizeMovieTitleForFormat(title) {
  if (!title) return '';
  let t = cleanTitle(title);

  // Numeric titles (1917, 2012, …) — not release years.
  if (/^(19\d{2}|20\d{2})$/.test(t)) {
    return t;
  }

  // "2001: A Space Odyssey" — keep the leading year as part of the title.
  if (/^(19\d{2}|20\d{2})\s*:\s+/.test(t)) {
    t = t.replace(/:/g, ' ');
    t = t.replace(
      /\s+(1080p|720p|2160p|480p|4k|uhd|bluray|web-?dl|webrip|hdrip|dvdrip|brrip|ts|telesync|cam|x264|x265|hevc|aac|dts|ac3|10bit|ddp|gp|nlsubs)(?:\s|$).*/i,
      '',
    );
    return t.replace(/\s+/g, ' ').trim();
  }

  // Only strip explicit (year) / [year] suffixes, not bare digits in the title.
  t = t.replace(/\s*\(\s*(19\d{2}|20\d{2})\s*\)\s*/g, ' ');
  t = t.replace(/\s*\[\s*(19\d{2}|20\d{2})\s*\]\s*/g, ' ');
  if (t.length > 6) {
    t = t.replace(/\s+(19\d{2}|20\d{2})\s*$/g, '');
  }
  t = t.replace(
    /\s+(1080p|720p|2160p|480p|4k|uhd|bluray|web-?dl|webrip|hdrip|dvdrip|brrip|ts|telesync|cam|x264|x265|hevc|aac|dts|ac3|10bit|ddp|gp|nlsubs)(?:\s|$).*/i,
    '',
  );
  return t.replace(/\s+/g, ' ').trim();
}

/**
 * Conditional tokens: {[Token Name]} omitted when value empty
 */
function applyFormatTemplate(format, tokenMap) {
  let result = format;

  result = result.replace(/\{\[([^\]]+)\]\}/g, (match, tokenName) => {
    const key = tokenName.trim();
    const val = tokenMap[key];
    if (val == null || String(val).trim() === '') return '';
    return String(val);
  });

  for (const [key, val] of Object.entries(tokenMap)) {
    const safe = val == null ? '' : String(val);
    result = result.split(`{${key}}`).join(safe);
  }

  const parts = result.split('/');
  const cleaned = parts.map((part) => {
    let p = part.replace(/\s+/g, ' ').trim();
    p = p.replace(/[<>:"|?*\\]/g, '');
    p = p.replace(/\(\s*\)/g, '').replace(/\[\s*\]/g, '');
    p = p.replace(/\s+([.,\-_])/g, '$1');
    return p;
  }).filter((p) => p.length > 0);

  result = cleaned.join('/');
  return result.replace(/\s{2,}/g, ' ').trim();
}

function getReleaseYear(movie) {
  if (!movie?.releaseDate) return '';
  const m = String(movie.releaseDate).match(/\b(19\d{2}|20\d{2})\b/);
  return m ? m[0] : '';
}

function getSeriesYear(series) {
  if (!series?.firstAirDate) return '';
  const m = String(series.firstAirDate).match(/\b(19\d{2}|20\d{2})\b/);
  return m ? m[0] : '';
}

async function buildMovieBaseName(
  format,
  movie,
  sceneName = '',
  filePath = null,
  probeCache = null,
  options = {},
) {
  let meta = sceneName ? extractMetadataFromFilename(sceneName) : {};
  if (!options.skipFfprobe) {
    meta = await enrichMetadataForFormat(format, filePath, meta, probeCache);
  }
  const parsedFromScene = sceneName ? parseMovieFilename(sceneName) : null;
  let year = getReleaseYear(movie);
  if (!year && parsedFromScene?.year) {
    year = String(parsedFromScene.year);
  }
  const title = sanitizeMovieTitleForFormat(movie.title || '');

  const tokenMap = {
    'Movie Title': title,
    'Movie CleanTitle': title,
    'Release Year': year,
    'Quality': meta.quality || '',
    'Source': meta.source || '',
    'Codec': meta.codec || '',
    'Audio': meta.audio || '',
    'Edition': meta.edition || '',
    'Release Group': meta.releaseGroup || '',
    'Original Title': sceneName ? path.basename(sceneName, path.extname(sceneName)) : '',
    'TmdbId': movie.tmdbId ? String(movie.tmdbId) : '',
  };

  return applyFormatTemplate(format, tokenMap);
}

async function buildSeriesBaseName(
  format,
  series,
  season,
  episode,
  episodeTitle = '',
  sceneName = '',
  filePath = null,
  probeCache = null,
  options = {},
) {
  let meta = sceneName ? extractMetadataFromFilename(sceneName) : {};
  if (!options.skipFfprobe) {
    meta = await enrichMetadataForFormat(format, filePath, meta, probeCache);
  }
  const seasonPadded = String(season).padStart(2, '0');
  const episodePadded = String(episode).padStart(2, '0');
  const seriesYear = getSeriesYear(series);

  const tokenMap = {
    'Series Title': series.title || '',
    'Series CleanTitle': cleanTitle(series.title || ''),
    'Series TitleYear': seriesYear ? `${series.title} (${seriesYear})` : (series.title || ''),
    'Series Year': seriesYear,
    'season:00': seasonPadded,
    season: String(season),
    'Season:00': seasonPadded,
    Season: String(season),
    'episode:00': episodePadded,
    episode: String(episode),
    'Episode:00': episodePadded,
    Episode: String(episode),
    'Episode Title': episodeTitle || '',
    'Episode CleanTitle': cleanTitle(episodeTitle || ''),
    Quality: meta.quality || '',
    Source: meta.source || '',
    Codec: meta.codec || '',
    Audio: meta.audio || '',
    'Release Group': meta.releaseGroup || '',
    'TmdbId': series.tmdbId ? String(series.tmdbId) : '',
  };

  return applyFormatTemplate(format, tokenMap);
}

async function getEpisodeTitle(tmdbId, season, episode) {
  const key = `${tmdbId}:${season}:${episode}`;
  if (episodeTitleCache.has(key)) {
    return episodeTitleCache.get(key);
  }
  try {
    const res = await tmdb.getTVSeasonDetails(tmdbId, season);
    if (res.success && res.season?.episodes) {
      const ep = res.season.episodes.find((e) => e.episode_number === episode);
      const name = ep?.name || '';
      episodeTitleCache.set(key, name);
      return name;
    }
  } catch (e) {
    console.warn(`[MediaOrganizer] Episode title lookup failed: ${e.message}`);
  }
  episodeTitleCache.set(key, '');
  return '';
}

function permissionDeniedTransferMessage(sourcePath, destPath) {
  const srcDir = path.dirname(sourcePath);
  const destDir = path.dirname(destPath);
  return (
    `Permission denied moving "${path.basename(sourcePath)}". ` +
    `Renaming requires write access on both "${srcDir}" and "${destDir}". ` +
    'This often happens on guest or read-only SMB/NAS mounts where the library root is writable but release subfolders are not. ' +
    'Fix share permissions on the server (or remount with a user that can modify those folders), then try again.'
  );
}

async function assertDirectoryWritable(dirPath, label) {
  try {
    await fs.access(dirPath, fsConstants.W_OK);
  } catch {
    const err = new Error(
      `${label} is not writable: ${dirPath}. Renaming needs write permission on both source and destination folders (common with guest/read-only SMB shares).`,
    );
    err.code = 'EACCES';
    throw err;
  }
}

async function transferFile(sourcePath, destPath) {
  const srcDir = path.dirname(sourcePath);
  const destDir = path.dirname(destPath);

  await fs.mkdir(destDir, { recursive: true });
  try {
    await fs.access(destPath);
    const err = new Error('Destination already exists');
    err.code = 'EEXIST';
    throw err;
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }

  await assertDirectoryWritable(srcDir, 'Source folder');
  await assertDirectoryWritable(destDir, 'Destination folder');

  try {
    await fs.rename(sourcePath, destPath);
  } catch (error) {
    if (error.code === 'EXDEV' || String(error.message).includes('cross-device')) {
      await fs.copyFile(sourcePath, destPath);
      await fs.unlink(sourcePath);
    } else if (error.code === 'EACCES') {
      const err = new Error(permissionDeniedTransferMessage(sourcePath, destPath));
      err.code = 'EACCES';
      throw err;
    } else {
      throw error;
    }
  }
}

const MIN_MOVIE_RENAME_BYTES = 50 * 1024 * 1024;

const JUNK_VIDEO_BASENAME = [
  /\bsample\b/i,
  /\btrailer\b/i,
  /\bpreview\b/i,
  /\bteaser\b/i,
  /\bfeaturette\b/i,
  /\bdeleted[\s._-]*scene/i,
  /\bbehind[\s._-]*the[\s._-]*scenes\b/i,
  /\binterview\b/i,
  /\bclip\b/i,
];

function isHiddenOrOsMetadata(name) {
  return name.startsWith('.') || name.startsWith('._');
}

function isJunkVideoBasename(filePath) {
  const base = path.basename(filePath, path.extname(filePath));
  return JUNK_VIDEO_BASENAME.some((re) => re.test(base));
}

async function pickLargestVideoFile(paths) {
  let best = null;
  let bestSize = -1;
  for (const fp of paths) {
    try {
      const st = await fs.stat(fp);
      if (st.size > bestSize) {
        bestSize = st.size;
        best = fp;
      }
    } catch {
      /* skip */
    }
  }
  return best;
}

/**
 * Videos eligible for movie rename: no samples/trailers, minimum size,
 * and at most one file per release subfolder (largest wins).
 */
async function findMovieVideosForRenaming(scanRoot, dirPath) {
  const all = await findVideoFiles(dirPath);
  const scanResolved = scanRoot ? path.resolve(scanRoot) : null;
  const candidates = [];

  for (const fp of all) {
    const name = path.basename(fp);
    if (isHiddenOrOsMetadata(name)) continue;
    if (isJunkVideoBasename(fp)) continue;
    try {
      const st = await fs.stat(fp);
      if (!st.isFile() || st.size < MIN_MOVIE_RENAME_BYTES) continue;
    } catch {
      continue;
    }
    candidates.push(fp);
  }

  const flat = [];
  const byReleaseFolder = new Map();

  for (const fp of candidates) {
    const parent = path.resolve(path.dirname(fp));
    if (scanResolved && parent === scanResolved) {
      flat.push(fp);
      continue;
    }
    if (!byReleaseFolder.has(parent)) byReleaseFolder.set(parent, []);
    byReleaseFolder.get(parent).push(fp);
  }

  for (const group of byReleaseFolder.values()) {
    const primary = await pickLargestVideoFile(group);
    if (primary) flat.push(primary);
  }

  return flat;
}

async function findVideoFiles(dirPath, files = []) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (isHiddenOrOsMetadata(entry.name)) continue;
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        const lower = entry.name.toLowerCase();
        if (['sample', 'subs', 'subtitles', 'extras', 'featurettes'].includes(lower)) {
          continue;
        }
        await findVideoFiles(full, files);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (VIDEO_EXTENSIONS.has(ext)) files.push(full);
      }
    }
  } catch (_) {}
  return files;
}

function normalizeTitle(title) {
  return title.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function movieYearMatches(monitored, parsedYear) {
  if (!parsedYear || !monitored?.releaseDate) return true;
  const y = new Date(monitored.releaseDate).getFullYear();
  return y === parsedYear;
}

const GENERIC_LIBRARY_FOLDER_KEYS = new Set([
  'movies', 'movie', 'films', 'film', 'videos', 'video', 'media', 'sharedmedia',
  'downloads', 'download', 'incoming', 'complete', 'completed', 'incomplete',
  'library', 'storage', 'content', 'entertainment', 'watch', 'rips',
]);

function isGenericLibraryFolderName(name) {
  const key = (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!key) return true;
  if (GENERIC_LIBRARY_FOLDER_KEYS.has(key)) return true;
  if (/^\d+$/.test(key)) return true;
  return false;
}

/**
 * Prefer release-folder name over generic video filenames (e.g. sample.mkv).
 * Files sitting directly in the scan root (e.g. .../movies/Title.mkv) use the filename.
 */
function getMovieSceneName(filePath, scanRoot = null) {
  const fileName = path.basename(filePath);
  const parentDir = path.dirname(filePath);
  const parentName = path.basename(parentDir);
  if (!parentName || parentName === '.' || parentName === '..') {
    return fileName;
  }

  if (scanRoot && path.resolve(parentDir) === path.resolve(scanRoot)) {
    return fileName;
  }

  if (isGenericLibraryFolderName(parentName)) {
    return fileName;
  }

  const parentParsed = parseMovieFilename(parentName);
  const fileParsed = parseMovieFilename(fileName);
  const parentScore =
    (parentParsed.title?.length || 0) + (parentParsed.year ? 12 : 0);
  const fileScore = (fileParsed.title?.length || 0) + (fileParsed.year ? 12 : 0);

  if (parentScore > fileScore) return parentName;
  if (fileScore > parentScore && fileScore >= 4) return fileName;
  if (parentParsed.year) return parentName;
  if (fileScore >= 4) return fileName;
  return fileName;
}

function getMovieRenameReviewReasons({
  currentName,
  newName,
  movieTitle,
  sceneName,
  matchSource,
  tmdbMatchScore = null,
  tmdbId = null,
}) {
  const reasons = [];
  const stem = path.basename(currentName, path.extname(currentName));
  const parsedScene = parseMovieFilename(sceneName || currentName);
  if (!newName || !String(newName).trim()) {
    reasons.push('empty_target_name');
  }

  if (!titlesPlausiblyRelated(stem, movieTitle)) {
    reasons.push('title_mismatch');
  }

  if (
    matchSource === 'tmdb' &&
    parsedScene.title &&
    movieTitle &&
    !titlesPlausiblyRelated(parsedScene.title, movieTitle)
  ) {
    reasons.push('lookup_diverged');
  }

  if (matchSource === 'tmdb' && tmdbMatchScore != null && tmdbMatchScore < 75) {
    reasons.push('low_confidence_match');
  }

  if (matchSource === 'parsed' && (tmdbId == null || tmdbId === '')) {
    reasons.push('no_tmdb_match');
  }

  return [...new Set(reasons)];
}

function titlesPlausiblyRelated(a, b) {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return true;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;

  const wordsA = (a || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2);
  const wordsB = (b || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2);
  if (!wordsA.length) return true;
  if (!wordsB.length) return false;

  let hits = 0;
  for (const w of wordsA) {
    if (wordsB.some((x) => x === w || x.includes(w) || w.includes(x))) hits += 1;
  }
  return hits >= 1 && hits / wordsA.length >= 0.34;
}

function findMonitoredMovieFromLabel(label, monitoredList) {
  const parsed = parseMovieFilename(label);
  if (!parsed.title || parsed.title.length < 2) return null;

  const norm = normalizeTitle(parsed.title);
  let yearMatch = null;
  let exact = null;
  let partial = null;

  for (const m of monitoredList) {
    const n = normalizeTitle(m.title);
    if (n === norm) {
      if (movieYearMatches(m, parsed.year)) return m;
      if (!yearMatch) yearMatch = m;
      exact = m;
    }
    if (norm.length >= 4 && (n.includes(norm) || norm.includes(n))) {
      if (movieYearMatches(m, parsed.year)) partial = m;
    }
  }

  return yearMatch || exact || partial;
}

/**
 * @param {{ useReleaseFolders?: boolean }} options
 *   useReleaseFolders true → `{Title} ({Year}) {Quality}/{file}.ext`
 *   false (default) → flat file in scan root: `{Title} ({Year}) {Quality}.ext`
 */
function resolveMovieTargetPath(scanRoot, currentPath, newBaseName, ext, options = {}) {
  const fileName = `${newBaseName}${ext}`;
  const parentDir = path.dirname(currentPath);
  const inReleaseFolder = path.resolve(parentDir) !== path.resolve(scanRoot);
  const useReleaseFolders = options.useReleaseFolders === true;

  if (inReleaseFolder) {
    if (useReleaseFolders) {
      return path.normalize(path.join(scanRoot, newBaseName, fileName));
    }
    return path.normalize(path.join(scanRoot, fileName));
  }
  return path.normalize(path.join(parentDir, fileName));
}

/**
 * Resolve title/year for naming: monitored library → TMDB → parsed release name.
 */
async function resolveMovieForNaming(userId, filePath, cache = null, scanRoot = null) {
  const fileName = path.basename(filePath);
  const lookupCache = cache || new Map();

  let libraryRoot = scanRoot;
  if (!libraryRoot) {
    libraryRoot = await getUserNamingScanDirectory(userId, 'movie');
  }

  const monitored = await matchMonitoredMovie(userId, filePath, fileName, libraryRoot);
  if (monitored) {
    return {
      movie: monitored,
      sceneName: getMovieSceneName(filePath, libraryRoot),
      matchSource: 'library',
    };
  }

  const sceneName = getMovieSceneName(filePath, libraryRoot);
  const cacheKey = `${fileName.toLowerCase()}::${sceneName.toLowerCase()}`;
  if (lookupCache.has(cacheKey)) {
    return lookupCache.get(cacheKey);
  }

  const parsed = parseMovieFilename(sceneName);
  if (!parsed.title || parsed.title.length < 2) {
    const miss = { movie: null, sceneName, matchSource: null, reason: 'cant_parse_title' };
    lookupCache.set(cacheKey, miss);
    return miss;
  }

  let title = parsed.title;
  let releaseDate = parsed.year ? `${parsed.year}-01-01` : null;
  let tmdbId = null;
  let matchSource = 'parsed';
  let tmdbMatchScore = null;

  try {
    const hit = await searchTMDB(parsed.title, parsed.year);
    if (hit?.title) {
      title = hit.title;
      releaseDate = hit.release_date || releaseDate;
      tmdbId = hit.id;
      tmdbMatchScore = hit.tmdbMatchScore ?? null;
      matchSource = 'tmdb';
    }
  } catch (err) {
    console.warn(`[mediaOrganizer] TMDB lookup failed for "${parsed.title}":`, err.message);
  }

  const movie = {
    id: null,
    tmdbId,
    title,
    releaseDate,
    tmdbMatchScore,
  };

  const result = { movie, sceneName, matchSource, parsedTitle: parsed.title };
  lookupCache.set(cacheKey, result);
  return result;
}

async function matchMonitoredMovie(userId, filePath, fileName, scanRoot = null) {
  const byPath = await MonitoredMovies.findOne({ where: { userId, filePath } });
  if (byPath) return byPath;

  const all = await MonitoredMovies.findAll({ where: { userId } });
  const parentName = path.basename(path.dirname(filePath));
  const labels = [fileName];
  if (parentName && parentName !== fileName) labels.push(parentName);
  labels.push(getMovieSceneName(filePath, scanRoot));

  const seen = new Set();
  for (const label of labels) {
    if (!label || seen.has(label)) continue;
    seen.add(label);
    const found = findMonitoredMovieFromLabel(label, all);
    if (found) return found;
  }
  return null;
}

function extractSeasonEpisode(filename) {
  const base = path.basename(filename, path.extname(filename));
  let m = base.match(/[Ss](\d{1,2})[Ee](\d{1,2})/);
  if (m) return { season: parseInt(m[1], 10), episode: parseInt(m[2], 10) };
  m = base.match(/(\d{1,2})[xX](\d{1,2})/);
  if (m) return { season: parseInt(m[1], 10), episode: parseInt(m[2], 10) };
  return { season: null, episode: null };
}

function extractSeriesTitleFromFilename(filename) {
  const baseName = path.basename(filename, path.extname(filename));
  const patterns = [
    /^(.+?)[.\s\-_][Ss](\d{1,2})[Ee](\d{1,2})/,
    /^(.+?)[.\s\-_](\d{1,2})[xX](\d{1,2})/,
  ];
  for (const pattern of patterns) {
    const match = baseName.match(pattern);
    if (match) {
      return match[1].replace(/[._]/g, ' ').trim().replace(/\s+/g, ' ');
    }
  }
  return baseName.replace(/[._]/g, ' ').trim();
}

function matchMonitoredSeries(fileTitle, monitoredList) {
  const nFile = normalizeTitle(fileTitle);
  for (const s of monitoredList) {
    if (normalizeTitle(s.title) === nFile) return s;
  }
  for (const s of monitoredList) {
    const n = normalizeTitle(s.title);
    if (nFile.includes(n) || n.includes(nFile)) return s;
  }
  return null;
}

/**
 * Resolve final library path for a file entering the media folder (watcher / future auto-import).
 */
async function resolveLibraryDestination(userId, sourcePath, type, options = {}) {
  const settings = await Settings.findOne({ where: { userId } });
  if (!settings) {
    return { destPath: null, reason: 'no_settings' };
  }

  const fileName = path.basename(sourcePath);
  const ext = path.extname(fileName);

  if (type === 'movie') {
    const libraryRoot = await getUserMovieDirectory(userId);
    if (!libraryRoot) return { destPath: null, reason: 'no_movie_library' };

    const resolved = await resolveMovieForNaming(userId, sourcePath, null, libraryRoot);
    if (!resolved.movie) {
      return {
        destPath: path.join(libraryRoot, fileName),
        reason: resolved.reason || 'unresolved_movie',
        organized: false,
      };
    }

    const base = await buildMovieBaseName(
      settings.movieFileFormat,
      resolved.movie,
      resolved.sceneName,
      sourcePath,
    );
    if (!base) {
      return { destPath: path.join(libraryRoot, fileName), reason: 'empty_format', organized: false };
    }

    return {
      destPath: resolveMovieTargetPath(libraryRoot, sourcePath, base, ext, {
        useReleaseFolders: settings.movieNamingUseFolders === true,
      }),
      movieId: resolved.movie.id,
      organized: true,
    };
  }

  const libraryRoot = await getUserSeriesDirectory(userId);
  if (!libraryRoot) return { destPath: null, reason: 'no_series_library' };

  const { season, episode } = extractSeasonEpisode(fileName);
  if (season == null || episode == null) {
    return { destPath: path.join(libraryRoot, fileName), reason: 'no_sxxexx', organized: false };
  }

  const allSeries = await MonitoredSeries.findAll({ where: { userId } });
  const fileTitle = extractSeriesTitleFromFilename(fileName);
  const series = matchMonitoredSeries(fileTitle, allSeries);
  if (!series) {
    return { destPath: path.join(libraryRoot, fileName), reason: 'unmatched_series', organized: false };
  }

  const episodeTitle = await getEpisodeTitle(series.tmdbId, season, episode);
  const relative = await buildSeriesBaseName(
    settings.seriesFileFormat,
    series,
    season,
    episode,
    episodeTitle,
    fileName,
    sourcePath,
  );
  const destRelative = `${relative}${ext}`;
  const destPath = destRelative.includes('/')
    ? path.join(libraryRoot, destRelative)
    : path.join(libraryRoot, destRelative);

  return {
    destPath: path.normalize(destPath),
    seriesId: series.id,
    season,
    episode,
    organized: true,
  };
}

function validateMovieFormat(format) {
  const hasTitle = format.includes('{Movie Title}') || format.includes('{Movie CleanTitle}');
  const hasYear = format.includes('{Release Year}');
  const hasOriginal = format.includes('{Original Title}');
  if (!hasTitle && !hasOriginal) {
    return { valid: false, error: 'Movie format must include {Movie Title} or {Original Title}' };
  }
  if (hasTitle && !hasYear && !hasOriginal) {
    return { valid: false, error: 'Movie format should include {Release Year} or {Original Title}' };
  }
  return { valid: true };
}

function validateSeriesFormat(format) {
  const hasSeries = format.includes('{Series Title}') || format.includes('{Series CleanTitle}');
  const hasEpisodeId =
    format.includes('S{season:00}E{episode:00}') ||
    format.includes('{season') ||
    format.includes('{episode');
  if (!hasSeries) {
    return { valid: false, error: 'Series format must include {Series Title}' };
  }
  if (!hasEpisodeId) {
    return { valid: false, error: 'Series format must include season/episode tokens (e.g. S{season:00}E{episode:00})' };
  }
  return { valid: true };
}

module.exports = {
  extractMetadataFromFilename,
  cleanTitle,
  applyFormatTemplate,
  buildMovieBaseName,
  buildSeriesBaseName,
  getEpisodeTitle,
  transferFile,
  findVideoFiles,
  findMovieVideosForRenaming,
  getMovieSceneName,
  resolveMovieTargetPath,
  resolveMovieForNaming,
  getMovieRenameReviewReasons,
  matchMonitoredMovie,
  matchMonitoredSeries,
  extractSeasonEpisode,
  extractSeriesTitleFromFilename,
  resolveLibraryDestination,
  validateMovieFormat,
  validateSeriesFormat,
  findMonitoredMovieFromLabel,
};