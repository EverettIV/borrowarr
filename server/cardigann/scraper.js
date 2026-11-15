/**
 * Cardigann scraper.
 * One instance per configured indexer. Definitions describe the site;
 * this class logs in, builds the request, and parses the rows.
 */

const axios = require('axios');
const cheerio = require('cheerio');
const CardigannTemplateEngine = require('./templateEngine');
const CardigannFilterEngine = require('./filterEngine');
const CardigannParser = require('./parser');
const { siteCategoriesFor } = require('./categories');

const CREDENTIAL_SETTINGS = new Set([
  'username',
  'password',
  'cookie',
  'apikey',
  'api_key',
  'passkey',
  'pid',
  'key',
]);

class CardigannScraper {
  constructor(definition) {
    this.definition = definition;
    this.templateEngine = new CardigannTemplateEngine();
    this.filterEngine = new CardigannFilterEngine();
    this.parser = new CardigannParser(definition);
    this.baseUrl = (definition.links && definition.links[0]) || '';
    this.settings = {};
    this.config = {};
    this.cookies = new Map();
    this.lastRequestAt = 0;
  }

  setSettings(settings = {}) {
    this.settings = settings || {};
  }

  applySettings(settings = {}, baseUrl) {
    this.setSettings(settings);
    const chosen = baseUrl || settings.baseUrl || (this.definition.links && this.definition.links[0]) || '';
    this.baseUrl = String(chosen || '').replace(/\/$/, '');

    const config = { sitelink: this.baseUrl };
    for (const setting of this.definition.settings || []) {
      if (!setting || !setting.name) continue;
      if (String(setting.type || '').startsWith('info')) continue;
      const provided = settings[setting.name];
      if (provided !== undefined && provided !== null && provided !== '') {
        config[setting.name] = provided;
      } else if (setting.default !== undefined) {
        config[setting.name] = setting.default;
      } else {
        config[setting.name] = '';
      }
    }

    if (settings.username && !config.username) config.username = settings.username;
    if (settings.password && !config.password) config.password = settings.password;
    if (settings.apikey && !config.apikey) config.apikey = settings.apikey;
    if (settings.cookie && !config.cookie) config.cookie = settings.cookie;

    this.config = config;
    this.templateEngine.setConfig(config);
  }

  credentialRequirements() {
    const required = new Map();
    const remember = (name) => {
      if (!name || required.has(name)) return;
      const setting = (this.definition.settings || []).find((item) => item && item.name === name);
      if (setting && String(setting.type || '').startsWith('info')) return;
      const kind = name === 'apikey' || name === 'api_key' || name === 'passkey'
        ? 'apikey'
        : name === 'cookie'
          ? 'cookie'
          : 'login';
      required.set(name, { name, label: setting?.label || name, kind });
    };

    const login = this.definition.login;
    if (login) {
      const blob = JSON.stringify(login);
      const configRefs = blob.matchAll(/\.Config\.([A-Za-z0-9_-]+)/g);
      for (const match of configRefs) remember(match[1]);
      if (String(login.method || 'form').toLowerCase() === 'cookie') remember('cookie');
      for (const setting of this.definition.settings || []) {
        if (!setting || String(setting.type || '').startsWith('info')) continue;
        if (setting.type === 'password' || CREDENTIAL_SETTINGS.has(setting.name)) remember(setting.name);
      }
    }

    for (const setting of this.definition.settings || []) {
      if (!setting || String(setting.type || '').startsWith('info')) continue;
      if (setting.name === 'apikey' || setting.name === 'api_key' || setting.name === 'passkey') {
        remember(setting.name);
      }
    }

    return [...required.values()];
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
        return this.failure(missing);
      }

      if (this.definition.login) {
        await this.login();
      }

      this.parser.searchKeywords = this.applyKeywordsFilters(query || '', this.definition.search?.keywordsfilters);
      const plans = this.planSearch(query, options);
      const rows = [];
      for (const plan of plans) {
        const isPost = plan.method === 'POST';
        const response = await this.request({
          ...plan,
          params: isPost ? undefined : plan.params,
          data: isPost ? new URLSearchParams(plan.params).toString() : undefined,
          headers: isPost
            ? { ...plan.headers, 'Content-Type': 'application/x-www-form-urlencoded' }
            : plan.headers,
        });
        if (response.status < 200 || response.status >= 300) {
          throw new Error(`Unexpected response status ${response.status} from indexer`);
        }
        if (this.looksLikeCloudflare(response.body)) {
          throw new Error(`Blocked by Cloudflare at ${this.safeHost()}. Configure FlareSolverr or choose another mirror.`);
        }
        const parsed = this.parseResponse(response.body, plan.responseType);
        rows.push(...parsed);
      }

      const formatted = rows
        .map((row) => this.parser.formatResult(row, this.definition))
        .filter(Boolean);

      return {
        success: true,
        indexer: this.definition.name,
        indexerId: this.definition.id,
        results: formatted,
      };
    } catch (error) {
      return this.failure(error.message);
    }
  }

  failure(message) {
    return {
      success: false,
      indexer: this.definition.name,
      indexerId: this.definition.id,
      error: message,
      results: [],
    };
  }

  /**
   * Build the HTTP requests a search would make. No network.
   */
  planSearch(query, options = {}) {
    this.applySettings(options.settings || this.settings || {}, options.baseUrl || this.baseUrl);
    const searchConfig = this.definition.search || {};
    const keywords = this.applyKeywordsFilters(query || '', searchConfig.keywordsfilters);
    const siteCategories = siteCategoriesFor(this.definition, options.categoryIds || (options.categoryId ? [options.categoryId] : []));
    const variables = this.variablesFor(keywords, options, siteCategories);
    const paths = this.selectPaths(searchConfig, siteCategories);

    return paths.map((pathConfig) => {
      const pathTemplate = pathConfig.path || '/';
      let path = this.templateEngine.process(pathTemplate, variables);
      if (keywords) {
        path = path.split(keywords).join(encodeURIComponent(keywords));
      }

      const inputs = {
        ...(searchConfig.inputs || {}),
        ...(pathConfig.inputs || {}),
      };
      const params = {};
      let raw = '';
      for (const [key, value] of Object.entries(inputs)) {
        const rendered = typeof value === 'string'
          ? this.templateEngine.process(value, variables)
          : value;
        if (key === '$raw') {
          raw += rendered || '';
        } else if (rendered !== undefined && rendered !== null && rendered !== '') {
          params[key] = rendered;
        }
      }

      let url = this.resolveUrl(path);
      if (raw) {
        url += (url.includes('?') ? '&' : '?') + raw.replace(/&$/, '');
      }

      const headers = this.buildHeaders(searchConfig.headers, variables);
      return {
        method: this.resolveMethod(pathConfig.method, variables),
        url,
        params,
        headers,
        responseType: pathConfig.response?.type || 'html',
      };
    });
  }

  selectPaths(searchConfig, siteCategories) {
    const paths = searchConfig.paths || (searchConfig.path ? [{ path: searchConfig.path }] : [{ path: '/' }]);
    const categorized = paths.filter((path) => Array.isArray(path.categories) && path.categories.length);
    if (!categorized.length || !siteCategories.length) return paths;

    const wanted = new Set(siteCategories.map(String));
    const matched = paths.filter((path) => {
      if (!Array.isArray(path.categories) || !path.categories.length) return true;
      return path.categories.some((id) => wanted.has(String(id)));
    });
    return matched.length ? matched : paths;
  }

  resolveMethod(method, variables) {
    const rendered = typeof method === 'string' && method.includes('{{')
      ? this.templateEngine.process(method, variables)
      : (method || 'get');
    return String(rendered || 'get').toLowerCase() === 'post' ? 'POST' : 'GET';
  }

  variablesFor(keywords, options, siteCategories) {
    const query = {
      ...(options.query || {}),
      Keywords: keywords || '',
      IMDBID: options.imdbId || options.query?.IMDBID || '',
      TMDBID: options.tmdbId || options.query?.TMDBID || '',
      TVDBID: options.tvdbId || options.query?.TVDBID || '',
      Season: options.season ?? options.query?.Season ?? '',
      Ep: options.episode ?? options.query?.Ep ?? '',
      Year: options.year || options.query?.Year || '',
    };
    return {
      Keywords: keywords || '',
      Query: query,
      Categories: siteCategories,
      Category: siteCategories[0] || '',
      Config: this.config,
    };
  }

  applyKeywordsFilters(query, filtersConfig) {
    if (!filtersConfig || !filtersConfig.length) return query || '';
    const rendered = filtersConfig.map((filter) => {
      const args = Array.isArray(filter.args)
        ? filter.args
        : (filter.args === undefined || filter.args === null ? [] : [filter.args]);
      return {
        ...filter,
        args: args.map((arg) => (
          typeof arg === 'string' ? this.templateEngine.process(arg, { Keywords: query, Config: this.config, Query: { Keywords: query } }) : arg
        )),
      };
    });
    return this.filterEngine.applyFilters(query, rendered);
  }

  async login() {
    const login = this.definition.login;
    const method = String(login.method || 'form').toLowerCase();

    if (method === 'cookie') {
      this.importCookieString(this.config.cookie);
      await this.assertLogin(login, '');
      return;
    }

    const loginPath = login.path || 'login.php';
    const inputs = this.renderInputs(login.inputs || {});

    if (method === 'get') {
      const response = await this.request({
        method: 'GET',
        url: this.resolveUrl(loginPath),
        params: inputs,
      });
      await this.assertLogin(login, response.body);
      return;
    }

    if (method === 'post') {
      const response = await this.request({
        method: 'POST',
        url: this.resolveUrl(loginPath),
        data: new URLSearchParams(inputs).toString(),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      await this.assertLogin(login, response.body);
      return;
    }

    const page = await this.request({ method: 'GET', url: this.resolveUrl(loginPath) });
    const $ = cheerio.load(page.body || '');
    const form = $(login.form || 'form').first();
    if (!form.length) {
      throw new Error(`Login form not found for ${this.definition.name}`);
    }

    const fields = {};
    form.find('input, select, textarea').each((_, element) => {
      const name = $(element).attr('name');
      if (!name) return;
      fields[name] = $(element).attr('value') || '';
    });
    Object.assign(fields, inputs);

    const action = form.attr('action') || loginPath;
    const formMethod = String(form.attr('method') || 'post').toUpperCase() === 'GET' ? 'GET' : 'POST';
    const response = await this.request({
      method: formMethod,
      url: this.resolveUrl(action, page.url || this.resolveUrl(loginPath)),
      data: formMethod === 'POST' ? new URLSearchParams(fields).toString() : undefined,
      params: formMethod === 'GET' ? fields : undefined,
      headers: formMethod === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {},
    });
    await this.assertLogin(login, response.body);
  }

  async assertLogin(login, body) {
    if (login.error && body) {
      const $ = cheerio.load(body);
      const errors = Array.isArray(login.error) ? login.error : [login.error];
      for (const error of errors) {
        if (error?.selector && $(error.selector).length) {
          const message = error.message?.text || error.message || 'Login failed';
          throw new Error(this.templateEngine.process(String(message), { Config: this.config }));
        }
      }
    }

    if (login.test?.selector) {
      const testUrl = this.resolveUrl(login.test.path || '/');
      const testResponse = await this.request({ method: 'GET', url: testUrl });
      const $ = cheerio.load(testResponse.body || '');
      if (!$(login.test.selector).length) {
        throw new Error(`Login to ${this.definition.name} failed. Check the saved credentials.`);
      }
    }
  }

  renderInputs(inputs) {
    const rendered = {};
    for (const [key, value] of Object.entries(inputs || {})) {
      rendered[key] = typeof value === 'string'
        ? this.templateEngine.process(value, { Config: this.config, Keywords: '', Query: {} })
        : value;
    }
    return rendered;
  }

  parseResponse(body, responseType) {
    if (responseType === 'json' || this.looksLikeJson(body)) {
      try {
        const data = typeof body === 'object' ? body : JSON.parse(body);
        return this.parser.parseJSON(data, this.baseUrl, this.config);
      } catch (error) {
        if (responseType === 'json') {
          throw new Error('Indexer returned invalid JSON');
        }
      }
    }
    return this.parser.parseHTML(body, this.baseUrl, this.config, responseType);
  }

  looksLikeJson(body) {
    if (typeof body !== 'string') return false;
    const trimmed = body.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      return false;
    }
  }

  looksLikeCloudflare(body) {
    if (typeof body !== 'string') return false;
    const sample = body.slice(0, 4000).toLowerCase();
    return sample.includes('cf-challenge')
      || sample.includes('just a moment')
      || sample.includes('challenge-platform')
      || sample.includes('cf-browser-verification');
  }

  async request(plan) {
    await this.throttle();
    let url = plan.url;
    let method = plan.method || 'GET';
    let data = plan.data;
    const extraHeaders = plan.headers || {};

    for (let hop = 0; hop < 5; hop += 1) {
      const response = await axios({
        method,
        url,
        params: hop === 0 ? plan.params : undefined,
        data,
        headers: {
          ...this.defaultHeaders(),
          ...extraHeaders,
          ...(this.cookieHeader() ? { Cookie: this.cookieHeader() } : {}),
        },
        timeout: 20000,
        maxRedirects: 0,
        validateStatus: () => true,
        responseType: 'arraybuffer',
      });

      this.absorbCookies(response.headers['set-cookie']);
      const status = response.status;
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
        const nextUrl = new URL(response.headers.location, url).href;
        if ((status === 302 || status === 303) && method !== 'GET') {
          method = 'GET';
          data = undefined;
        }
        url = nextUrl;
        continue;
      }

      return {
        status,
        url,
        headers: response.headers,
        body: this.decodeBody(response.data, response.headers['content-type']),
      };
    }

    throw new Error(`Too many redirects from ${this.definition.name}`);
  }

  decodeBody(buffer, contentType = '') {
    const encoding = String(this.definition.encoding || 'UTF-8');
    const buf = Buffer.from(buffer || []);
    if (/json/i.test(contentType) || /utf-?8/i.test(encoding)) {
      return buf.toString('utf8');
    }
    try {
      return new TextDecoder(encoding).decode(buf);
    } catch {
      return buf.toString('utf8');
    }
  }

  async throttle() {
    const delay = Number(this.definition.requestDelay) || 0;
    if (!delay || !this.lastRequestAt) {
      this.lastRequestAt = Date.now();
      return;
    }
    const wait = delay * 1000 - (Date.now() - this.lastRequestAt);
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    this.lastRequestAt = Date.now();
  }

  defaultHeaders() {
    return {
      'User-Agent': this.config.useragent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    };
  }

  buildHeaders(headersConfig, variables) {
    const headers = {};
    if (!headersConfig) return headers;
    for (const [key, value] of Object.entries(headersConfig)) {
      const raw = Array.isArray(value) ? value[0] : value;
      headers[key] = typeof raw === 'string' ? this.templateEngine.process(raw, variables) : raw;
    }
    return headers;
  }

  resolveUrl(path, base) {
    const root = base || this.baseUrl;
    if (!path) return root;
    if (/^https?:\/\//i.test(path)) return path;
    try {
      return new URL(path, root.endsWith('/') ? root : `${root}/`).href;
    } catch {
      return `${root}/${String(path).replace(/^\//, '')}`;
    }
  }

  importCookieString(cookie) {
    String(cookie || '').split(';').forEach((part) => {
      const trimmed = part.trim();
      const eq = trimmed.indexOf('=');
      if (eq <= 0) return;
      this.cookies.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim());
    });
  }

  absorbCookies(setCookie) {
    const headers = Array.isArray(setCookie) ? setCookie : (setCookie ? [setCookie] : []);
    for (const header of headers) {
      const pair = String(header).split(';')[0];
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  safeHost() {
    try {
      return new URL(this.baseUrl).hostname;
    } catch {
      return this.definition.name;
    }
  }

  async test(options = {}) {
    const result = await this.search('test', options);
    if (!result.success) {
      return { success: false, resultCount: 0, message: result.error };
    }
    if (!result.results.length) {
      return {
        success: false,
        resultCount: 0,
        message: 'Connected, but the test query returned no releases',
      };
    }
    return {
      success: true,
      resultCount: result.results.length,
      message: `Connection successful (${result.results.length} results)`,
    };
  }

  getInfo() {
    return {
      id: this.definition.id,
      name: this.definition.name,
      description: this.definition.description || '',
      language: this.definition.language || 'en-US',
      type: this.definition.type || 'public',
      encoding: this.definition.encoding || 'UTF-8',
      links: this.definition.links || [],
      legacylinks: this.definition.legacylinks || [],
      caps: this.definition.caps || {},
      settings: this.definition.settings || [],
    };
  }
}

module.exports = CardigannScraper;
