/**
 * Search only the indexers an admin has saved on this Borrowarr instance.
 * Torrent definitions run through Cardigann. Newznab rows stay on the XML client.
 * Nothing here reaches a site that is not in the saved list.
 */

const path = require('path');
const { getCardigannEngine } = require('../cardigann');
const { searchIndexer } = require('./indexerSearch');

const definitionsPath = path.join(__dirname, '../cardigann-indexer-yamls');
const cardigann = getCardigannEngine(definitionsPath);

function readValue(indexer, ...keys) {
  for (const key of keys) {
    if (indexer[key] !== undefined && indexer[key] !== null && indexer[key] !== '') {
      return indexer[key];
    }
  }
  return undefined;
}

function readSettings(indexer) {
  let stored = readValue(indexer, 'cardigannSettings', 'cardigann_settings') || {};
  if (typeof stored === 'string') {
    try {
      stored = JSON.parse(stored);
    } catch {
      stored = {};
    }
  }
  return {
    ...stored,
    username: stored.username || readValue(indexer, 'username') || '',
    password: stored.password || readValue(indexer, 'password') || '',
    apikey: stored.apikey || readValue(indexer, 'apiKey', 'api_key') || '',
    cookie: stored.cookie || '',
  };
}

function definitionIdFor(indexer) {
  const explicit = readValue(indexer, 'cardigannId', 'cardigann_id');
  if (explicit && cardigann.getIndexer(explicit)) return explicit;

  const byName = cardigann.getAllIndexers().find(
    (definition) => definition.name.toLowerCase() === String(indexer.name || '').toLowerCase()
  );
  return byName ? byName.id : null;
}

function isNewznab(indexer) {
  const type = String(indexer.indexerType || '').toLowerCase();
  const protocol = String(indexer.protocol || '').toLowerCase();
  return type === 'newznab' || protocol === 'nzb';
}

function toRelease(result, indexer) {
  const bytes = typeof result.size === 'number' && result.size > 1000 ? result.size : (result.size || 0) * (1024 ** 3);
  return {
    ...result,
    id: `${indexer.id}-${result.guid || result.downloadUrl || result.title}`,
    protocol: result.protocol || (isNewznab(indexer) ? 'nzb' : 'torrent'),
    indexer: indexer.name,
    indexerId: indexer.id,
    indexerPriority: indexer.priority || 25,
    size: bytes / (1024 ** 3),
    sizeFormatted: result.sizeFormatted,
    peers: result.seeders != null ? `${result.seeders}/${result.leechers || 0}` : result.peers || null,
  };
}

async function searchOne(indexer, query, options) {
  if (indexer.enabled === false) {
    return { results: [], error: 'Indexer is disabled' };
  }

  if (isNewznab(indexer)) {
    const apiResult = await searchIndexer(indexer, query, options.categoryIds || [], options.limit || 100, options.offset || 0);
    return {
      results: (apiResult.results || []).map((result) => ({
        ...result,
        indexerId: indexer.id,
        indexerPriority: indexer.priority || 25,
      })),
      error: apiResult.error || null,
    };
  }

  const definitionId = definitionIdFor(indexer);
  if (!definitionId) {
    return {
      results: [],
      error: `No definition file for ${indexer.name}. Add the YAML under cardigann-indexer-yamls and select it again.`,
    };
  }

  const scraper = cardigann.getScraper(definitionId);
  const result = await scraper.search(query, {
    baseUrl: indexer.baseUrl,
    settings: readSettings(indexer),
    categoryIds: options.categoryIds || [],
    imdbId: options.imdbId,
    tmdbId: options.tmdbId,
    tvdbId: options.tvdbId,
    season: options.season,
    episode: options.episode,
    year: options.year,
  });

  if (!result.success) {
    return { results: [], error: result.error || 'Search failed' };
  }

  return {
    results: result.results.map((release) => toRelease(release, indexer)),
    error: null,
  };
}

async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return results;
}

async function searchConfiguredIndexers(indexers, query, options = {}) {
  const configured = (indexers || []).filter((indexer) => indexer && indexer.enabled !== false);
  if (!configured.length) {
    return {
      results: [],
      indexerErrors: [],
      configured: false,
    };
  }

  const searches = await mapPool(configured, 4, async (indexer) => {
    try {
      const outcome = await searchOne(indexer, query, options);
      return { indexer, ...outcome };
    } catch (error) {
      return { indexer, results: [], error: error.message };
    }
  });

  return {
    results: searches.flatMap((search) => search.results),
    indexerErrors: searches
      .filter((search) => search.error)
      .map((search) => ({
        id: search.indexer.id,
        name: search.indexer.name,
        error: search.error,
      })),
    configured: true,
  };
}

module.exports = {
  searchConfiguredIndexers,
  definitionIdFor,
};
