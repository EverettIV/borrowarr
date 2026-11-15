const axios = require('axios');

/**
 * qBittorrent Download Client Proxy
 * Implements qBittorrent Web API v2.x
 * @see https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)
 */
class QBittorrentProxy {
  constructor(settings) {
    this.settings = settings;
    this.cookie = null;
  }

  /**
   * Build base URL for qBittorrent API
   */
  getBaseUrl() {
    const protocol = this.settings.useSsl ? 'https' : 'http';
    const host = this.settings.host || 'localhost';
    const port = this.settings.port || 8080;
    const urlBase = this.settings.urlBase || '';
    return `${protocol}://${host}:${port}${urlBase}`;
  }

  /**
   * Authenticate with qBittorrent
   */
  async authenticate() {
    try {
      const response = await axios.post(`${this.getBaseUrl()}/api/v2/auth/login`, 
        `username=${encodeURIComponent(this.settings.username || 'admin')}&password=${encodeURIComponent(this.settings.password || '')}`,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 30000,
        }
      );

      // qBittorrent returns a session cookie on successful login. Older
      // versions may also return "Ok.", while newer versions can return 204.
      const cookies = response.headers['set-cookie'];
      const hasSessionCookie = cookies && cookies.length > 0;
      if (response.data === 'Ok.' || response.status === 200 || (response.status === 204 && hasSessionCookie)) {
        if (hasSessionCookie) {
          this.cookie = cookies[0].split(';')[0];
        }
        return true;
      }
      
      throw new Error('Authentication failed');
    } catch (error) {
      console.error('[QBittorrent] Authentication error:', error.message);
      throw new Error(`Authentication failed: ${error.message}`);
    }
  }

  /**
   * Make authenticated API request
   */
  async request(method, endpoint, data = null) {
    if (!this.cookie) {
      await this.authenticate();
    }

    const config = {
      method,
      url: `${this.getBaseUrl()}${endpoint}`,
      headers: {
        'Cookie': this.cookie,
      },
      timeout: 30000,
    };

    if (data) {
      if (method.toUpperCase() === 'POST') {
        config.headers['Content-Type'] = 'application/x-www-form-urlencoded';
        config.data = data;
      } else {
        config.params = data;
      }
    }

    try {
      const response = await axios(config);
      return response.data;
    } catch (error) {
      // If we get a 403, try re-authenticating
      if (error.response && error.response.status === 403) {
        console.log('[QBittorrent] Re-authenticating...');
        this.cookie = null;
        await this.authenticate();
        config.headers['Cookie'] = this.cookie;
        const response = await axios(config);
        return response.data;
      }
      throw error;
    }
  }

  /**
   * Test connection to qBittorrent
   */
  async testConnection() {
    try {
      await this.authenticate();
      
      // Get API version
      const version = await this.request('GET', '/api/v2/app/webapiVersion');
      console.log('[QBittorrent] API Version:', version);

      // Test getting torrents list
      await this.request('GET', '/api/v2/torrents/info');

      return {
        success: true,
        message: `Successfully connected to qBittorrent (API v${version})`,
      };
    } catch (error) {
      console.error('[QBittorrent] Test connection failed:', error.message);
      return {
        success: false,
        error: `Failed to connect to qBittorrent: ${error.message}`,
      };
    }
  }

  extractInfoHash(magnetOrHash) {
    if (!magnetOrHash) return null;
    const magnetMatch = magnetOrHash.match(/btih:([a-f0-9]{40})/i);
    if (magnetMatch) return magnetMatch[1].toLowerCase();
    if (/^[a-f0-9]{40}$/i.test(magnetOrHash)) return magnetOrHash.toLowerCase();
    return null;
  }

  async torrentExistsByHash(infoHash) {
    if (!infoHash) return false;
    const normalized = infoHash.toLowerCase();
    const torrents = await this.getTorrents();
    return torrents.some(
      (t) => t.hash && String(t.hash).toLowerCase() === normalized,
    );
  }

  /**
   * qBittorrent returns HTTP 409 or body "Fails." when the torrent is already in the client.
   */
  async resolveDuplicateMagnetAdd(magnetLink, error = null) {
    const hash = this.extractInfoHash(magnetLink);
    if (!hash) return null;

    const status = error?.response?.status;
    const body = error?.response?.data;
    const bodyStr =
      typeof body === 'string' ? body : body != null ? String(body) : '';
    const looksLikeDuplicate =
      status === 409 ||
      bodyStr.toLowerCase().includes('fails') ||
      (error?.message && /409/.test(error.message));

    if (!looksLikeDuplicate && error) return null;

    try {
      if (await this.torrentExistsByHash(hash)) {
        console.log('[QBittorrent] Torrent already in client — treating add as success');
        return hash;
      }
    } catch (lookupErr) {
      console.warn('[QBittorrent] Could not verify duplicate torrent:', lookupErr.message);
    }
    return null;
  }

  /**
   * Add torrent from magnet link
   */
  async addTorrentFromMagnet(magnetLink) {
    const hash = this.extractInfoHash(magnetLink);

    try {
      const params = new URLSearchParams();
      params.append('urls', magnetLink);
      
      // Add category if configured
      if (this.settings.category) {
        params.append('category', this.settings.category);
      }

      // Set add paused if configured
      if (this.settings.addPaused) {
        params.append('paused', 'true');
      }

      const response = await this.request('POST', '/api/v2/torrents/add', params.toString());
      const responseStr =
        typeof response === 'string' ? response : response != null ? String(response) : '';

      if (responseStr && responseStr.toLowerCase().includes('fails')) {
        const existing = await this.resolveDuplicateMagnetAdd(magnetLink);
        if (existing) return existing;
        throw new Error('qBittorrent rejected the magnet link');
      }

      console.log('[QBittorrent] Successfully added magnet link');
      return hash;
    } catch (error) {
      const existing = await this.resolveDuplicateMagnetAdd(magnetLink, error);
      if (existing) return existing;

      console.error('[QBittorrent] Failed to add magnet:', error.message);
      throw new Error(`Failed to add magnet link: ${error.message}`);
    }
  }

  /**
   * Add torrent from file
   */
  async addTorrentFromFile(filename, fileContent) {
    try {
      const FormData = require('form-data');
      const form = new FormData();
      
      form.append('torrents', Buffer.from(fileContent), {
        filename: filename,
        contentType: 'application/x-bittorrent',
      });

      // Add category if configured
      if (this.settings.category) {
        form.append('category', this.settings.category);
      }

      // Set add paused if configured
      if (this.settings.addPaused) {
        form.append('paused', 'true');
      }

      if (!this.cookie) {
        await this.authenticate();
      }

      const response = await axios.post(
        `${this.getBaseUrl()}/api/v2/torrents/add`,
        form,
        {
          headers: {
            ...form.getHeaders(),
            'Cookie': this.cookie,
          },
          timeout: 30000,
        }
      );

      console.log('[QBittorrent] Successfully added torrent file');
      
      // Return filename as identifier (we can't easily get hash from response)
      return filename;
    } catch (error) {
      console.error('[QBittorrent] Failed to add torrent file:', error.message);
      throw new Error(`Failed to add torrent file: ${error.message}`);
    }
  }

  /**
   * Get list of torrents
   */
  async getTorrents() {
    try {
      const torrents = await this.request('GET', '/api/v2/torrents/info');
      return torrents;
    } catch (error) {
      console.error('[QBittorrent] Failed to get torrents:', error.message);
      throw new Error(`Failed to get torrents: ${error.message}`);
    }
  }

  /**
   * Get categories
   */
  async getCategories() {
    try {
      const categories = await this.request('GET', '/api/v2/torrents/categories');
      return categories;
    } catch (error) {
      console.error('[QBittorrent] Failed to get categories:', error.message);
      throw new Error(`Failed to get categories: ${error.message}`);
    }
  }

  /**
   * Add category
   */
  async addCategory(category) {
    try {
      const params = new URLSearchParams();
      params.append('category', category);
      await this.request('POST', '/api/v2/torrents/createCategory', params.toString());
      console.log('[QBittorrent] Category created:', category);
      return true;
    } catch (error) {
      console.error('[QBittorrent] Failed to add category:', error.message);
      throw new Error(`Failed to add category: ${error.message}`);
    }
  }
}

module.exports = QBittorrentProxy;
