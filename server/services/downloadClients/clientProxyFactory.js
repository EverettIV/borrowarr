/**
 * Shared factory for download client proxy instances.
 */

function getClientProxy(implementation, settings) {
  switch (implementation) {
    case 'Deluge': {
      const DelugeProxy = require('./delugeProxy');
      return new DelugeProxy(settings);
    }
    case 'Sabnzbd': {
      const SabnzbdProxy = require('./sabnzbdProxy');
      return new SabnzbdProxy(settings);
    }
    case 'QBittorrent': {
      const QBittorrentProxy = require('./qbittorrentProxy');
      return new QBittorrentProxy(settings);
    }
    case 'Transmission': {
      const TransmissionProxy = require('./transmissionProxy');
      return new TransmissionProxy(settings);
    }
    case 'RTorrent': {
      const RTorrentProxy = require('./rtorrentProxy');
      return new RTorrentProxy(settings);
    }
    case 'Aria2': {
      const Aria2Proxy = require('./aria2Proxy');
      return new Aria2Proxy(settings);
    }
    case 'UTorrent': {
      const UTorrentProxy = require('./utorrentProxy');
      return new UTorrentProxy(settings);
    }
    case 'Vuze': {
      const VuzeProxy = require('./vuzeProxy');
      return new VuzeProxy(settings);
    }
    case 'Flood': {
      const FloodProxy = require('./floodProxy');
      return new FloodProxy(settings);
    }
    case 'Hadouken': {
      const HadoukenProxy = require('./hadoukenProxy');
      return new HadoukenProxy(settings);
    }
    case 'Nzbget': {
      const NzbgetProxy = require('./nzbgetProxy');
      return new NzbgetProxy(settings);
    }
  case 'NzbVortex': {
      const NzbVortexProxy = require('./nzbvortexProxy');
      return new NzbVortexProxy(settings);
    }
    case 'Pneumatic': {
      const PneumaticProxy = require('./pneumaticProxy');
      return new PneumaticProxy(settings);
    }
    default:
      throw new Error(`Client ${implementation} does not support completed download polling yet`);
  }
}

module.exports = { getClientProxy };