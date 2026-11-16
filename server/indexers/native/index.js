/**
 * Indexers Prowlarr implements in C# rather than Cardigann YAML.
 * TorrentGalaxy is the Jackett HTML definition, stored here so the
 * Prowlarr YAML updater does not delete it.
 */

const path = require('path');
const CardigannLoader = require('../../cardigann/loader');
const CardigannScraper = require('../../cardigann/scraper');
const { nativeClients, createNativeScraper } = require('./clients');

const extraLoader = new CardigannLoader(path.join(__dirname, 'definitions'));

function extraDefinitions() {
  return [
    ...extraLoader.getAllDefinitions(),
    ...nativeClients().map((client) => client.definition),
  ];
}

function extraDefinition(id) {
  return extraDefinitions().find((definition) => definition.id === id) || null;
}

function createExtraScraper(id) {
  const native = createNativeScraper(id);
  if (native) return native;
  const definition = extraLoader.getDefinition(id);
  if (!definition) return null;
  return new CardigannScraper(definition);
}

module.exports = {
  extraDefinitions,
  extraDefinition,
  createExtraScraper,
};
