const TMDB_POSTER_BASE = 'https://image.tmdb.org/t/p/w500';

function normalizePosterUrl(posterPathOrUrl) {
  if (!posterPathOrUrl || typeof posterPathOrUrl !== 'string') {
    return null;
  }
  const value = posterPathOrUrl.trim();
  if (!value) {
    return null;
  }
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value;
  }
  if (value.startsWith('/')) {
    return `${TMDB_POSTER_BASE}${value}`;
  }
  return value;
}

module.exports = {
  TMDB_POSTER_BASE,
  normalizePosterUrl,
};