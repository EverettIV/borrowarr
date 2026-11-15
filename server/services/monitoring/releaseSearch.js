const Indexers = require('../../models/Indexers');
const { searchConfiguredIndexers } = require('../configuredIndexerSearch');

async function searchReleasesForMonitoring(query, categoryIds) {
  const indexers = await Indexers.findAll({
    where: { enabled: true },
    attributes: [
      'id', 'name', 'baseUrl', 'username', 'password', 'apiKey',
      'protocol', 'indexerType', 'enabled', 'categories', 'verified', 'priority', 'cardigannId', 'cardigannSettings',
    ],
    raw: true,
  });

  if (indexers.length === 0) {
    throw new Error('No enabled indexers are configured');
  }

  const parsedCategoryIds = (Array.isArray(categoryIds) ? categoryIds : [categoryIds])
    .map((id) => parseInt(id, 10))
    .filter((id) => !Number.isNaN(id));

  const { results } = await searchConfiguredIndexers(indexers, query, { categoryIds: parsedCategoryIds });
  return results || [];
}

module.exports = { searchReleasesForMonitoring };