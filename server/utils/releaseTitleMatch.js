const { pickBestTorrentForDownload } = require('./qualitySelection');

const MIN_MOVIE_MATCH_SCORE = 45;

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeForMatch(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function titleTokens(movieTitle) {
  const skip = new Set(['the', 'a', 'an', 'and', 'or']);
  return normalizeForMatch(movieTitle)
    .split(/\s+/)
    .filter((token) => token && !skip.has(token));
}

function parseMovieYear(releaseDateOrYear) {
  if (releaseDateOrYear == null || releaseDateOrYear === '') return null;
  if (typeof releaseDateOrYear === 'number' && Number.isFinite(releaseDateOrYear)) {
    return releaseDateOrYear;
  }
  const fromString = String(releaseDateOrYear).match(/\b(19|20)\d{2}\b/);
  return fromString ? parseInt(fromString[0], 10) : null;
}

function yearsInRelease(releaseTitle) {
  const matches = String(releaseTitle || '').match(/\b(19|20)\d{2}\b/g) || [];
  return matches.map((y) => parseInt(y, 10));
}

/**
 * Talk shows, daily episodes, and TV season/episode patterns are never movie grabs.
 */
function isDisallowedMovieRelease(releaseTitle) {
  const raw = String(releaseTitle || '');
  const lower = raw.toLowerCase();

  if (/\bs\d{1,2}\s*e\d{1,2}\b/i.test(raw)) return true;
  if (/\b\d{1,2}x\d{1,2}\b/i.test(raw)) return true;
  if (/\bseason\s+\d+/i.test(raw)) return true;

  // Daily / dated TV (e.g. Jimmy Kimmel 2026 06 02 …)
  if (/\b20\d{2}[\s._-]+\d{1,2}[\s._-]+\d{1,2}\b/.test(raw)) return true;

  const talkShowMarkers = [
    'jimmy kimmel',
    'fallon',
    'colbert',
    'conan ',
    'daily show',
    'late night',
    'ellen ',
    'dr phil',
    'gma ',
    'good morning america',
    'talk show',
    'podcast',
    'interview with',
    'saturday night live',
    'snl ',
  ];
  return talkShowMarkers.some((marker) => lower.includes(marker));
}

function scoreMovieRelease(movieTitle, movieYear, releaseTitle) {
  if (!movieTitle || !releaseTitle) return 0;
  if (isDisallowedMovieRelease(releaseTitle)) return 0;

  const tokens = titleTokens(movieTitle);
  if (tokens.length === 0) return 0;

  const releaseLower = String(releaseTitle).toLowerCase();
  const allTokensAsWords = tokens.every((token) =>
    new RegExp(`\\b${escapeRegex(token)}\\b`, 'i').test(releaseTitle),
  );
  if (!allTokensAsWords) return 0;

  let score = tokens.length * 12;

  const year = parseMovieYear(movieYear);
  const releaseYears = yearsInRelease(releaseTitle);
  if (year) {
    if (releaseYears.includes(year)) {
      score += 40;
    } else if (releaseYears.length > 0) {
      const closeYear = releaseYears.some((y) => Math.abs(y - year) <= 1);
      if (!closeYear) return 0;
      score += 15;
    }
  }

  if (tokens.length === 1) {
    const word = tokens[0];
    const dottedWithYear =
      year &&
      new RegExp(`\\b${escapeRegex(word)}[.\\s_-]+${year}\\b`, 'i').test(releaseTitle);
    const sceneStyle =
      year && releaseLower.includes(`${word}.${year}`);
    const startsWithTitle = new RegExp(
      `^[\\[({\\s]*${escapeRegex(word)}\\b`,
      'i',
    ).test(releaseTitle.trim());

    if (dottedWithYear || sceneStyle) {
      score += 35;
    } else if (startsWithTitle && year && releaseYears.includes(year)) {
      score += 25;
    } else {
      // e.g. "Jeremy Allen White" — title token is only a substring of a name
      score = Math.min(score, 30);
    }
  } else {
    const phrasePattern = tokens.map(escapeRegex).join('[.\\s_-]+');
    if (new RegExp(phrasePattern, 'i').test(releaseTitle)) {
      score += 30;
    }
  }

  return score;
}

function filterReleasesMatchingMovie(releases, { title, year, minScore = MIN_MOVIE_MATCH_SCORE }) {
  const movieYear = parseMovieYear(year);
  return releases
    .map((release) => ({
      release,
      matchScore: scoreMovieRelease(title, movieYear, release.title),
    }))
    .filter((row) => row.matchScore >= minScore)
    .sort((a, b) => b.matchScore - a.matchScore)
    .map((row) => row.release);
}

function pickBestMatchingMovieRelease(releases, {
  title,
  year,
  preferredQuality,
  itemQualityProfile,
  preferSeedersInQualityRange,
}) {
  const matched = filterReleasesMatchingMovie(releases, { title, year });
  if (!matched.length) return null;

  const bestScore = scoreMovieRelease(title, parseMovieYear(year), matched[0].title);
  const topTier = matched.filter(
    (release) =>
      scoreMovieRelease(title, parseMovieYear(year), release.title) >= bestScore - 5,
  );
  return pickBestTorrentForDownload(topTier, {
    preferredQuality,
    itemQualityProfile,
    preferSeedersInQualityRange,
  });
}

module.exports = {
  MIN_MOVIE_MATCH_SCORE,
  scoreMovieRelease,
  filterReleasesMatchingMovie,
  pickBestMatchingMovieRelease,
  isDisallowedMovieRelease,
  parseMovieYear,
};