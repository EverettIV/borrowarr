/**
 * Native indexer clients ported from Prowlarr's C# indexers.
 * Private trackers are not contacted until the saved account fields are present.
 */

const axios = require('axios');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function setting(name, label, type = 'text', extra = {}) {
  return { name, label, type, ...extra };
}

function info(name, label, text) {
  return { name, type: 'info', label, default: text };
}

function release(fields) {
  const size = Number(fields.size) || 0;
  return {
    title: fields.title,
    protocol: 'torrent',
    size,
    sizeFormatted: '',
    seeders: Number(fields.seeders) || 0,
    leechers: Number(fields.leechers) || 0,
    grabs: Number(fields.grabs) || 0,
    downloadUrl: fields.downloadUrl || '',
    guid: fields.guid || fields.downloadUrl || fields.title,
    infohash: fields.infohash || null,
    description: fields.description || '',
    category: fields.category || '',
    categories: [],
    publishDate: fields.publishDate || new Date().toISOString(),
    age: 0,
  };
}

function parseBytes(text) {
  const match = String(text || '').trim().match(/([\d.]+)\s*(TB|GB|MB|KB|B)/i);
  if (!match) return 0;
  const amount = Number(match[1]);
  const unit = match[2].toUpperCase();
  const multiplier = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 }[unit];
  return Math.round(amount * multiplier);
}

async function request(options) {
  return axios({
    timeout: 20000,
    validateStatus: () => true,
    responseType: 'text',
    transformResponse: [(value) => value],
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    ...options,
    headers: { 'User-Agent': UA, Accept: 'application/json', ...(options.headers || {}) },
  });
}

function ensureOk(response, name) {
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${name} returned HTTP ${response.status}`);
  }
}

function readJson(response, name) {
  try {
    return JSON.parse(response.data || 'null');
  } catch {
    throw new Error(`${name} did not return JSON`);
  }
}

function baseOf(ctx) {
  return String(ctx.baseUrl || ctx.definition.links[0]).replace(/\/$/, '');
}

async function searchKnaben(ctx) {
  const response = await request({
    method: 'POST',
    url: 'https://api.knaben.org/v1',
    headers: { 'Content-Type': 'application/json' },
    data: {
      order_by: 'date',
      order_direction: 'desc',
      from: 0,
      size: 100,
      hide_unsafe: true,
      search_type: '100%',
      search_field: 'title',
      query: ctx.query,
    },
  });
  ensureOk(response, 'Knaben');
  const body = readJson(response, 'Knaben');
  return (body.hits || body.Hits || [])
    .filter((row) => Number(row.seeders || row.Seeders) > 0)
    .map((row) => release({
      title: row.title || row.Title,
      size: row.bytes || row.Size,
      seeders: row.seeders || row.Seeders,
      leechers: row.peers || row.Leechers,
      downloadUrl: row.magnetUrl || row.MagnetUrl || row.link || row.DownloadUrl,
      guid: row.details || row.InfoUrl,
      infohash: row.hash || row.InfoHash,
      publishDate: row.date || row.Date,
    }))
    .filter((row) => row.title);
}

async function searchFileList(ctx) {
  const response = await request({
    url: `${baseOf(ctx)}/api.php`,
    params: { action: 'search-torrents', type: 'name', query: ctx.query },
    auth: { username: ctx.config.username, password: ctx.config.passkey },
  });
  ensureOk(response, 'FileList');
  const body = readJson(response, 'FileList');
  if (body && body.error) throw new Error(body.error);
  const rows = Array.isArray(body) ? body : [];
  return rows
    .filter((row) => !ctx.config.freeleech || row.freeleech)
    .map((row) => release({
      title: row.name,
      size: row.size,
      seeders: row.seeders,
      leechers: row.leechers,
      grabs: row.times_completed,
      downloadUrl: `${baseOf(ctx)}/download.php?id=${row.id}&passkey=${encodeURIComponent(ctx.config.passkey)}`,
      guid: `${baseOf(ctx)}/details.php?id=${row.id}`,
      category: row.category,
      description: row.small_description,
      publishDate: row.upload_date,
    }));
}

async function searchBeyondHD(ctx) {
  const response = await request({
    method: 'POST',
    url: `${baseOf(ctx)}/api/torrents/${encodeURIComponent(ctx.config.apikey)}`,
    headers: { 'Content-Type': 'application/json' },
    data: {
      action: 'search',
      rsskey: ctx.config.rsskey,
      search: ctx.query,
      ...(ctx.config.freeleech ? { freeleech: 1 } : {}),
    },
  });
  ensureOk(response, 'BeyondHD');
  const body = readJson(response, 'BeyondHD');
  if (body.status_code && body.status_code !== 1 && body.status_code !== 0 && body.status_message) {
    throw new Error(body.status_message);
  }
  if (body.status_message && /invalid|error|unauthorized/i.test(body.status_message) && !Array.isArray(body.results)) {
    throw new Error(body.status_message);
  }
  return (body.results || []).map((row) => release({
    title: row.name,
    size: row.size,
    seeders: row.seeders,
    leechers: row.leechers,
    grabs: row.times_completed,
    downloadUrl: row.download_url,
    guid: row.url,
    infohash: row.info_hash,
    category: row.category,
    publishDate: row.created_at,
  }));
}

async function searchHDBits(ctx) {
  const response = await request({
    method: 'POST',
    url: `${baseOf(ctx)}/api/torrents`,
    headers: { 'Content-Type': 'application/json' },
    data: {
      username: ctx.config.username,
      passkey: ctx.config.passkey,
      search: ctx.query,
      limit: 100,
    },
  });
  ensureOk(response, 'HDBits');
  const body = readJson(response, 'HDBits');
  if (body.status && body.status !== 0) throw new Error(body.message || 'HDBits rejected the request');
  const rows = Array.isArray(body.data) ? body.data : [];
  return rows
    .filter((row) => !ctx.config.freeleech || row.freeleech === 'yes')
    .map((row) => release({
      title: ctx.config.filename !== false && row.filename ? String(row.filename).replace(/\.torrent$/i, '') : row.name,
      size: row.size,
      seeders: row.seeders,
      leechers: row.leechers,
      grabs: row.times_completed,
      downloadUrl: `${baseOf(ctx)}/download.php?id=${row.id}&passkey=${encodeURIComponent(ctx.config.passkey)}`,
      guid: `${baseOf(ctx)}/details.php?id=${row.id}`,
      infohash: row.hash,
      publishDate: row.added,
    }));
}

async function searchPassThePopcorn(ctx) {
  const response = await request({
    url: `${baseOf(ctx)}/torrents.php`,
    params: {
      action: 'advanced',
      json: 'noredirect',
      grouping: '0',
      order_by: 'time',
      order_way: 'desc',
      searchstr: ctx.query,
      ...(ctx.config.freeleech ? { freetorrent: '1' } : {}),
      ...(ctx.config.golden ? { scene: '2' } : {}),
    },
    headers: { ApiUser: ctx.config.apiuser, ApiKey: ctx.config.apikey },
  });
  ensureOk(response, 'PassThePopcorn');
  const body = readJson(response, 'PassThePopcorn');
  const movies = body.Movies || body.movies || [];
  const results = [];
  for (const movie of movies) {
    for (const torrent of movie.Torrents || movie.torrents || []) {
      const free = String(torrent.FreeleechType || torrent.freeleechType || '').toUpperCase();
      if (ctx.config.freeleech && free !== 'FREELEECH' && free !== 'NEUTRAL LEECH') continue;
      const id = torrent.Id || torrent.id;
      results.push(release({
        title: torrent.ReleaseName || torrent.releaseName || movie.Title,
        size: torrent.Size || torrent.size,
        seeders: torrent.Seeders || torrent.seeders,
        leechers: torrent.Leechers || torrent.leechers,
        grabs: torrent.Snatched || torrent.snatched,
        downloadUrl: `${baseOf(ctx)}/torrents.php?action=download&id=${id}`,
        guid: `${baseOf(ctx)}/torrents.php?id=${movie.GroupId || movie.groupId}&torrentid=${id}`,
        publishDate: torrent.UploadTime || torrent.uploadTime,
      }));
    }
  }
  return results;
}

async function searchBroadcastheNet(ctx) {
  const response = await request({
    method: 'POST',
    url: 'https://api.broadcasthe.net/',
    headers: { 'Content-Type': 'application/json' },
    data: {
      jsonrpc: '2.0',
      id: 1,
      method: 'getTorrents',
      params: [ctx.config.apikey, { search: String(ctx.query || '').replace(/ /g, '%') }, 100, 0],
    },
  });
  ensureOk(response, 'BroadcasTheNet');
  const body = readJson(response, 'BroadcasTheNet');
  if (body.error) throw new Error(body.error.message || 'BroadcasTheNet rejected the API key');
  const torrents = body.result && body.result.torrents ? Object.values(body.result.torrents) : [];
  return torrents.map((torrent) => release({
    title: torrent.ReleaseName || torrent.GroupName,
    size: torrent.Size,
    seeders: torrent.Seeders,
    leechers: torrent.Leechers,
    grabs: torrent.Snatched,
    downloadUrl: torrent.DownloadURL,
    guid: `https://broadcasthe.net/torrents.php?id=${torrent.GroupID}&torrentid=${torrent.TorrentID}`,
    infohash: torrent.InfoHash,
    category: torrent.Category,
    publishDate: torrent.Time ? new Date(torrent.Time * 1000).toISOString() : undefined,
  }));
}

async function searchPrivateHD(ctx) {
  const base = `${baseOf(ctx)}/`;
  const login = await request({
    method: 'POST',
    url: `${base}api/v1/jackett/auth`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: new URLSearchParams({
      username: ctx.config.username,
      password: ctx.config.password,
      pid: ctx.config.pid,
    }).toString(),
  });
  const auth = readJson(login, 'PrivateHD');
  if (!auth.token) throw new Error(auth.message || `PrivateHD login failed (HTTP ${login.status})`);
  const response = await request({
    url: `${base}api/v1/jackett/torrents`,
    params: { limit: 100, search: ctx.query },
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  ensureOk(response, 'PrivateHD');
  const body = readJson(response, 'PrivateHD');
  return (body.data || [])
    .filter((row) => !ctx.config.freeleech || Number(row.download_multiply) === 0)
    .map((row) => release({
      title: row.file_name || row.release_title,
      size: row.file_size,
      seeders: row.seed,
      leechers: row.leech,
      grabs: row.completed,
      downloadUrl: row.download,
      guid: row.url,
      infohash: row.info_hash,
      category: row.type,
      publishDate: row.created_at_iso,
    }));
}

async function searchIPTorrents(ctx) {
  const cheerio = require('cheerio');
  const params = { q: `+(${ctx.query})` };
  if (ctx.config.freeleech) params.free = 'on';
  const response = await request({
    url: `${baseOf(ctx)}/t`,
    params,
    headers: {
      Accept: 'text/html',
      Cookie: ctx.config.cookie,
      ...(ctx.config.useragent ? { 'User-Agent': ctx.config.useragent } : {}),
    },
  });
  ensureOk(response, 'IPTorrents');
  const $ = cheerio.load(response.data || '');
  const rows = $('table#torrents > tbody > tr').toArray();
  if (!rows.length && /login|passkey|username/i.test(response.data || '')) {
    throw new Error('IPTorrents rejected the cookie. Paste a fresh cookie from a signed-in browser.');
  }
  return rows.map((row) => {
    const titleLink = $(row).find('a.hv').first();
    const download = $(row).find('a[href^="/download.php/"]').first();
    if (!titleLink.length || !download.length) return null;
    const cells = $(row).children('td');
    return release({
      title: titleLink.text().replace(/\s+/g, ' ').trim(),
      size: parseBytes($(cells[5]).text()),
      seeders: Number($(cells[7]).text()) || 0,
      leechers: Number($(cells[8]).text()) || 0,
      downloadUrl: `${baseOf(ctx)}/${download.attr('href').replace(/^\//, '')}`,
      guid: `${baseOf(ctx)}/${titleLink.attr('href').replace(/^\//, '')}`,
    });
  }).filter(Boolean);
}

const CLIENTS = [
  {
    id: 'knaben',
    search: searchKnaben,
    definition: {
      id: 'knaben',
      name: 'Knaben',
      description: 'Knaben is a public torrent meta-search.',
      language: 'en-US',
      type: 'public',
      links: ['https://knaben.org/'],
      settings: [],
      caps: { modes: { search: ['q'], 'movie-search': ['q'], 'tv-search': ['q', 'season', 'ep'] } },
    },
  },
  {
    id: 'iptorrents',
    search: searchIPTorrents,
    definition: {
      id: 'iptorrents',
      name: 'IPTorrents',
      description: 'IPTorrents (IPT) is a private tracker for general releases.',
      language: 'en-US',
      type: 'private',
      links: ['https://iptorrents.com/', 'https://iptorrents.me/'],
      settings: [
        setting('cookie', 'Cookie', 'password', { required: true }),
        info('info_cookie', 'Cookie', 'Copy the cookie header from a browser that is signed in to IPTorrents.'),
        setting('useragent', 'User agent'),
        setting('freeleech', 'Freeleech only', 'checkbox', { default: false }),
      ],
      caps: { modes: { search: ['q'], 'movie-search': ['q', 'imdbid'], 'tv-search': ['q', 'season', 'ep', 'imdbid'] } },
    },
  },
  {
    id: 'filelist',
    search: searchFileList,
    definition: {
      id: 'filelist',
      name: 'FileList',
      description: 'FileList (FL) is a private Romanian tracker.',
      language: 'en-US',
      type: 'private',
      links: ['https://filelist.io/', 'https://thefl.org/'],
      settings: [
        setting('username', 'Username', 'text', { required: true }),
        setting('passkey', 'Passkey', 'password', { required: true }),
        info('info_passkey', 'Passkey', 'Use the passkey from your FileList profile. It is sent as the API password.'),
        setting('freeleech', 'Freeleech only', 'checkbox', { default: false }),
      ],
      caps: { modes: { search: ['q'], 'movie-search': ['q', 'imdbid'], 'tv-search': ['q', 'season', 'ep', 'imdbid'] } },
    },
  },
  {
    id: 'beyondhd',
    search: searchBeyondHD,
    definition: {
      id: 'beyondhd',
      name: 'BeyondHD',
      description: 'BeyondHD (BHD) is a private tracker for HD movies and TV.',
      language: 'en-US',
      type: 'private',
      links: ['https://beyond-hd.me/'],
      settings: [
        setting('apikey', 'API key', 'password', { required: true }),
        setting('rsskey', 'RSS key', 'password', { required: true }),
        info('info_keys', 'Keys', 'Both keys are on your BeyondHD account page. Each one is 32 characters.'),
        setting('freeleech', 'Freeleech only', 'checkbox', { default: false }),
      ],
      caps: { modes: { search: ['q'], 'movie-search': ['q', 'imdbid', 'tmdbid'], 'tv-search': ['q', 'season', 'ep', 'imdbid'] } },
    },
  },
  {
    id: 'privatehd',
    search: searchPrivateHD,
    definition: {
      id: 'privatehd',
      name: 'PrivateHD',
      description: 'PrivateHD (PHD) is a private tracker for HD movies and TV.',
      language: 'en-US',
      type: 'private',
      links: ['https://privatehd.to/'],
      settings: [
        setting('username', 'Username', 'text', { required: true }),
        setting('password', 'Password', 'password', { required: true }),
        setting('pid', 'PID', 'password', { required: true }),
        info('info_pid', 'PID', 'The PID is on your PrivateHD profile. Borrowarr exchanges it for an API token, the same way Prowlarr does.'),
        setting('freeleech', 'Freeleech only', 'checkbox', { default: false }),
      ],
      caps: { modes: { search: ['q'], 'movie-search': ['q', 'imdbid', 'tmdbid'], 'tv-search': ['q', 'season', 'ep', 'imdbid', 'tvdbid'] } },
    },
  },
  {
    id: 'hdbits',
    search: searchHDBits,
    definition: {
      id: 'hdbits',
      name: 'HDBits',
      description: 'HDBits is a private tracker for high-quality movies and TV.',
      language: 'en-US',
      type: 'private',
      links: ['https://hdbits.org/'],
      settings: [
        setting('username', 'Username', 'text', { required: true }),
        setting('passkey', 'Passkey', 'password', { required: true }),
        info('info_passkey', 'Passkey', 'The passkey is on your HDBits profile and is sent with the JSON API.'),
        setting('freeleech', 'Freeleech only', 'checkbox', { default: false }),
      ],
      caps: { modes: { search: ['q'], 'movie-search': ['q', 'imdbid'], 'tv-search': ['q', 'season', 'ep', 'tvdbid'] } },
    },
  },
  {
    id: 'passthepopcorn',
    search: searchPassThePopcorn,
    definition: {
      id: 'passthepopcorn',
      name: 'PassThePopcorn',
      description: 'PassThePopcorn (PTP) is a private tracker for movies.',
      language: 'en-US',
      type: 'private',
      links: ['https://passthepopcorn.me/'],
      settings: [
        setting('apiuser', 'API user', 'text', { required: true }),
        setting('apikey', 'API key', 'password', { required: true }),
        info('info_api', 'API', 'PTP shows the API user and API key on your profile. Both are sent as headers.'),
        setting('freeleech', 'Freeleech only', 'checkbox', { default: false }),
        setting('golden', 'Golden popcorn only', 'checkbox', { default: false }),
      ],
      caps: { modes: { search: ['q'], 'movie-search': ['q', 'imdbid'] } },
    },
  },
  {
    id: 'broadcasthe',
    search: searchBroadcastheNet,
    definition: {
      id: 'broadcasthe',
      name: 'BroadcasTheNet',
      description: 'BroadcasTheNet (BTN) is a private tracker for TV.',
      language: 'en-US',
      type: 'private',
      links: ['https://broadcasthe.net/'],
      settings: [
        setting('apikey', 'API key', 'password', { required: true }),
        info('info_api', 'API', 'The key is on your BTN profile. Searches go to the JSON-RPC API.'),
      ],
      caps: { modes: { search: ['q'], 'tv-search': ['q', 'season', 'ep', 'tvdbid', 'imdbid'] } },
    },
  },
];

class NativeScraper {
  constructor(spec) {
    this.spec = spec;
    this.definition = spec.definition;
    this.config = {};
    this.baseUrl = (spec.definition.links && spec.definition.links[0]) || '';
  }

  applySettings(settings = {}, baseUrl) {
    const chosen = baseUrl || settings.baseUrl || this.baseUrl;
    this.baseUrl = String(chosen || '').replace(/\/$/, '');
    const config = {};
    for (const item of this.definition.settings || []) {
      if (!item || !item.name || String(item.type || '').startsWith('info')) continue;
      const provided = settings[item.name];
      if (provided !== undefined && provided !== null && provided !== '') config[item.name] = provided;
      else if (item.default !== undefined) config[item.name] = item.default;
      else config[item.name] = '';
    }
    if (settings.username && !config.username) config.username = settings.username;
    if (settings.password && !config.password) config.password = settings.password;
    if (settings.apikey && !config.apikey) config.apikey = settings.apikey;
    if (settings.cookie && !config.cookie) config.cookie = settings.cookie;
    this.config = config;
  }

  credentialRequirements() {
    return (this.definition.settings || [])
      .filter((item) => item && item.required)
      .map((item) => ({
        name: item.name,
        label: item.label,
        kind: item.name === 'cookie'
          ? 'cookie'
          : (['apikey', 'api_key', 'passkey', 'rsskey'].includes(item.name) ? 'apikey' : 'login'),
      }));
  }

  missingCredentials() {
    for (const field of this.credentialRequirements()) {
      const value = this.config[field.name];
      if (value === undefined || value === null || value === '') {
        return `${this.definition.name} requires ${field.label} before it can be used`;
      }
    }
    return null;
  }

  async search(query, options = {}) {
    try {
      this.applySettings(options.settings || {}, options.baseUrl);
      const missing = this.missingCredentials();
      if (missing) {
        return { success: false, indexer: this.definition.name, indexerId: this.definition.id, error: missing, results: [] };
      }
      const results = await this.spec.search({
        query,
        options,
        config: this.config,
        baseUrl: this.baseUrl,
        definition: this.definition,
      });
      return {
        success: true,
        indexer: this.definition.name,
        indexerId: this.definition.id,
        results: (results || []).filter((row) => row && row.title),
      };
    } catch (error) {
      return {
        success: false,
        indexer: this.definition.name,
        indexerId: this.definition.id,
        error: error.message,
        results: [],
      };
    }
  }

  async test(options = {}) {
    const result = await this.search(options.query || 'test', options);
    if (!result.success) return { success: false, resultCount: 0, message: result.error };
    if (!result.results.length) {
      return { success: false, resultCount: 0, message: 'Connected, but the test query returned no releases' };
    }
    return {
      success: true,
      resultCount: result.results.length,
      message: `Connection successful (${result.results.length} results)`,
    };
  }
}

function nativeClients() {
  return CLIENTS;
}

function createNativeScraper(id) {
  const spec = CLIENTS.find((item) => item.id === id);
  if (!spec) return null;
  return new NativeScraper(spec);
}

module.exports = { nativeClients, createNativeScraper };
