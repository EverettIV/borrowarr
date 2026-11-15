const { getClientProxy } = require('./clientProxyFactory');
const {
  normalizeQBittorrent,
  normalizeTransmission,
  normalizeDeluge,
  normalizeSabnzbd,
  normalizeNzbget,
} = require('./downloadItemNormalizer');

/**
 * Fetch normalized download items from a configured client.
 * @param {{ implementation: string, settings: object }} client
 * @returns {Promise<import('./downloadItemNormalizer').NormalizedDownloadItem[]>}
 */
async function fetchClientDownloadItems(client) {
  const implementation = client.implementation;
  const settings = { ...(client.settings || {}) };
  const proxy = getClientProxy(implementation, settings);

  switch (implementation) {
    case 'QBittorrent':
      return normalizeQBittorrent(await proxy.getTorrents());

    case 'Transmission':
    case 'Vuze':
    case 'Flood':
      return normalizeTransmission(await proxy.getTorrents());

    case 'Deluge':
    case 'UTorrent':
    case 'RTorrent':
      return normalizeDeluge(await proxy.getTorrents());

    case 'Sabnzbd': {
      const queue = await proxy.getQueue();
      const history = await proxy.getHistory();
      return normalizeSabnzbd(queue, history);
    }

    case 'Nzbget': {
      const queue = await proxy.getQueue();
      const history = await proxy.getHistory();
      return normalizeNzbget(queue, history);
    }

    default:
      console.warn(`[CDH] Polling not implemented for ${implementation}`);
      return [];
  }
}

module.exports = { fetchClientDownloadItems };