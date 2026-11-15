/**
 * Cardigann Parser
 * Parses HTML/JSON responses using CSS selectors and field definitions
 */

const cheerio = require('cheerio');
const CardigannFilterEngine = require('./filterEngine');

class CardigannParser {
  constructor(definition) {
    this.definition = definition;
    this.filterEngine = new CardigannFilterEngine();
    this.$ = null;
  }

  /**
   * Load HTML content for parsing
   */
  loadHTML(html, xml = false) {
    this.$ = cheerio.load(html, {
      xml: Boolean(xml),
      decodeEntities: true,
    });
  }

  /**
   * Parse HTML response
   */
  parseHTML(html, baseUrl, config = {}, responseType) {
    // Apply preprocessing filters (like Prowlarr lines 240-245)
    const preprocessingFilters = this.definition.search?.preprocessingfilters;
    if (preprocessingFilters && preprocessingFilters.length > 0) {
      html = this.filterEngine.applyFilters(html, preprocessingFilters);
    }

    this.loadHTML(html, responseType === 'xml' || /^\s*<\?xml/i.test(String(html || '')));
    
    const rowsConfig = this.definition.search.rows;
    const fieldsConfig = this.definition.search.fields;
    
    // Find all result rows
    let selector = rowsConfig.selector || rowsConfig;
    
    // Process template syntax in selector if config is provided
    if (typeof selector === 'string') {
      // Always process template syntax (even if config is empty, to remove conditionals)
      // Handle nested templates by processing multiple times
      let maxIterations = 10;
      let iteration = 0;
      let prevSelector = selector;
      
      while (iteration < maxIterations) {
        // Handle {{ if .Config.X }}...{{ else }}...{{ end }}
        selector = selector.replace(/\{\{\s*if\s+\.Config\.(\w+)\s*\}\}([^{}]*?(?:\{[^{}]*\}[^{}]*?)*?)\{\{\s*else\s*\}\}([^{}]*?(?:\{[^{}]*\}[^{}]*?)*?)\{\{\s*end\s*\}\}/gs, 
          (match, configKey, ifBlock, elseBlock) => {
            const hasValue = config && config[configKey];
            return hasValue ? ifBlock : elseBlock;
          });
        
        // Handle {{ .Config.X }}
        selector = selector.replace(/\{\{\s*\.Config\.(\w+)\s*\}\}/g, (match, configKey) => {
          return (config && config[configKey]) || '';
        });
        
        // If no changes, we're done
        if (selector === prevSelector) {
          break;
        }
        prevSelector = selector;
        iteration++;
      }
    }
    
    const rows = this.$(selector);
    
    if (rows.length === 0) {
      return [];
    }
    
    // Handle row merging for "after" config (like Prowlarr lines 258-279)
    const rowsArray = rows.toArray();
    const after = rowsConfig.after || 0;
    
    if (after > 0) {
      for (let i = 0; i < rowsArray.length; i++) {
        const currentRow = this.$(rowsArray[i]);
        
        // Merge the next 'after' rows into this one
        for (let j = 1; j <= after && (i + j) < rowsArray.length; j++) {
          const mergeRow = this.$(rowsArray[i + j]);
          currentRow.append(mergeRow.children());
        }
        
        // Remove merged rows
        for (let j = 1; j <= after && (i + j) < rowsArray.length; j++) {
          this.$(rowsArray[i + j]).remove();
        }
      }
    }
    
    const results = [];
    const variables = {}; // Track variables like Prowlarr (line 63)
    
    rows.each((index, rowElement) => {
      try {
        const row = this.$(rowElement);
        const result = this.parseRow(row, fieldsConfig, baseUrl, config, variables);
        
        // Apply row filters (like Prowlarr lines 340-346)
        if (this.shouldSkipRow(result, rowsConfig.filters, variables)) {
          return; // Skip this row
        }
        
        if (result) {
          results.push(result);
        }
      } catch (error) {
        console.error(`Error parsing row ${index}:`, error.message);
      }
    });
    
    return results;
  }

  /**
   * Parse a single row (with field modifiers like Prowlarr lines 290-338)
   */
  parseRow(row, fieldsConfig, baseUrl, config = {}, variables = {}) {
    const data = {};
    
    for (let [fullFieldName, fieldConfig] of Object.entries(fieldsConfig)) {
      try {
        // Parse field name and modifiers (like Prowlarr lines 290-296)
        const fieldParts = fullFieldName.split('|');
        const fieldName = fieldParts[0];
        const fieldModifiers = fieldParts.slice(1);
        
        // Check if field is optional
        const isOptional = fieldModifiers.includes('optional') || fieldConfig.optional;
        
        // Track variable key for use in templates
        const variablesKey = `.Result.${fieldName}`;
        
        try {
          let value = this.extractField(row, fieldConfig, baseUrl, config, variables);
          
          // If optional and empty, use default value (like Prowlarr lines 306-316)
          if (isOptional && !value) {
            const defaultValue = fieldConfig.default || '';
            // Process template in default value
            const processedDefault = this.processTemplateInValue(defaultValue, config, variables);
            value = processedDefault || null;
            
            if (!value) {
              variables[variablesKey] = null;
              continue; // Skip this field
            }
          }
          
          // Apply field modifiers
          if (fieldModifiers.includes('append') && data[fieldName]) {
            data[fieldName] += value;
          } else {
            data[fieldName] = value;
          }
          
          // Store in variables for later use
          variables[variablesKey] = value;
          
        } catch (error) {
          // If optional, continue without error (like Prowlarr lines 321-331)
          if (isOptional) {
            variables[variablesKey] = null;
            continue;
          }
          
          // For non-optional fields, log but continue
          variables[variablesKey] = null;
          data[fieldName] = null;
        }
      } catch (error) {
        // Skip fields that fail extraction entirely
        data[fieldName] = null;
      }
    }
    
    return data;
  }
  
  /**
   * Process Cardigann template syntax, including if/or/range and .Result fields.
   */
  processTemplateInValue(value, config = {}, variables = {}) {
    if (typeof value !== 'string' || !value.includes('{{')) return value;

    const CardigannTemplateEngine = require('./templateEngine');
    const engine = new CardigannTemplateEngine(config || {});
    const result = {};
    for (const [key, fieldValue] of Object.entries(variables || {})) {
      if (key.startsWith('.Result.')) result[key.slice('.Result.'.length)] = fieldValue;
    }
    return engine.process(value, { Result: result, Config: config || {} });
  }
  
  /**
   * Check if row should be skipped based on filters (like Prowlarr lines 699-723)
   */
  shouldSkipRow(data, filters, variables) {
    if (!filters || filters.length === 0) {
      return false;
    }
    
    for (const filter of filters) {
      if (typeof filter === 'object' && filter.name) {
        switch (filter.name) {
          case 'andmatch':
            if (this.rowMissesKeywords(data)) return true;
            break;
          case 'strdump':
            // Debug filter - log the row
            console.log('[Row Debug]', JSON.stringify(data));
            break;
          default:
            console.warn(`Unsupported row filter: ${filter.name}`);
        }
      }
    }
    
    return false;
  }

  rowMissesKeywords(data) {
    const keywords = String(this.searchKeywords || '').trim();
    if (!keywords) return false;
    const haystack = `${data.title || ''} ${data.description || ''}`.toLowerCase();
    const terms = keywords.toLowerCase().match(/"[^"]+"|\S+/g) || [];
    return terms.some((term) => {
      const word = term.replace(/^"|"$/g, '');
      if (!word) return false;
      if (word.startsWith('-')) return word.length > 1 && haystack.includes(word.slice(1));
      return !haystack.includes(word);
    });
  }

  findInRow(row, selector) {
    const wanted = String(selector || '').trim();
    const empty = () => row.find('___cardigann_none___');
    if (!wanted) return empty();

    try {
      const found = row.find(wanted).first();
      if (found.length) return found;
    } catch {
      // Selector can name an XML element css-select cannot query, such as tv:raw_title.
    }

    if (/^[A-Za-z0-9_:-]+$/.test(wanted)) {
      const lower = wanted.toLowerCase();
      const named = row.find('*').filter((_, el) => {
        const name = String(el.name || '').toLowerCase();
        return name === lower || name.endsWith(`:${lower}`);
      }).first();
      if (named.length) return named;
    }

    return empty();
  }

  /**
   * Extract a single field from a row
   */
  extractField(row, fieldConfig, baseUrl, config = {}, variables = {}) {
    // Handle string selector (shorthand)
    if (typeof fieldConfig === 'string') {
      return row.find(fieldConfig).first().text().trim();
    }
    
    let value = null;
    
    // Handle static text with template processing
    if (fieldConfig.text !== undefined) {
      value = this.processTemplateInValue(fieldConfig.text, config, variables);
    }
    // Handle case selector (Prowlarr lines 164-184) - try multiple selectors
    else if (fieldConfig.case) {
      const selector = fieldConfig.selector
        ? this.processTemplateInValue(fieldConfig.selector, config, variables)
        : '';
      const target = selector ? this.findInRow(row, selector) : row;
      if (!target.length && selector) {
        if (!fieldConfig.optional) {
          throw new Error(`None of the case selectors matched`);
        }
      } else {
        for (const [caseSelector, caseValue] of Object.entries(fieldConfig.case)) {
          let matched = caseSelector === '*';
          if (!matched) {
            try {
              matched = Boolean(target.is(caseSelector) || target.find(caseSelector).length);
            } catch {
              matched = false;
            }
          }
          if (matched) {
            value = this.processTemplateInValue(caseValue, config, variables);
            break;
          }
        }
      }

      if (value === null && !fieldConfig.optional) {
        throw new Error(`None of the case selectors matched`);
      }
    }
    // Handle selector
    else if (fieldConfig.selector) {
      const selector = this.processTemplateInValue(fieldConfig.selector, config, variables);
      const element = this.findInRow(row, selector);
      
      if (element.length === 0) {
        // Element not found
        if (fieldConfig.optional) {
          value = fieldConfig.default || null;
        } else {
          value = fieldConfig.default || null;
        }
      } else {
        // Extract value
        if (fieldConfig.attribute) {
          value = element.attr(fieldConfig.attribute) || '';
        } else if (fieldConfig.remove) {
          // Remove elements before getting text
          const clone = element.clone();
          clone.find(fieldConfig.remove).remove();
          value = clone.text().trim();
        } else {
          // Get text content
          value = element.text().trim();
        }
      }
    }
    
    // Apply default if value is empty
    if ((value === null || value === '') && fieldConfig.default !== undefined) {
      value = fieldConfig.default;
    }
    
    if (value !== null && fieldConfig.filters && fieldConfig.filters.length > 0) {
      value = this.filterEngine.applyFilters(value, this.renderFilterArgs(fieldConfig.filters, config, variables));
    }

    if (value && typeof value === 'string' && value.includes('{{')) {
      value = this.processTemplateInValue(value, config, variables);
    }

    if (this.shouldResolveUrl(fieldConfig, value)) {
      value = this.makeAbsoluteURL(value, baseUrl);
    }

    return value;
  }

  shouldResolveUrl(fieldConfig, value) {
    if (!value || typeof value !== 'string' || !fieldConfig?.attribute) return false;
    if (fieldConfig.attribute !== 'href' && fieldConfig.attribute !== 'src') return false;
    return /^(https?:)?\/\//i.test(value) || value.startsWith('/') || value.startsWith('magnet:');
  }

  renderFilterArgs(filters, config, variables) {
    return filters.map((filter) => {
      if (!filter) return filter;
      const args = Array.isArray(filter.args)
        ? filter.args
        : (filter.args === undefined || filter.args === null ? [] : [filter.args]);
      return {
        ...filter,
        args: args.map((arg) => this.processTemplateInValue(arg, config, variables)),
      };
    });
  }

  /**
   * Parse JSON response
   */
  parseJSON(jsonData, baseUrl, config = {}) {
    const rowsConfig = this.definition.search.rows;
    const fieldsConfig = this.definition.search.fields;
    
    // Process template in rowsConfig.selector if needed
    let selector = rowsConfig.selector || rowsConfig;
    if (typeof selector === 'string' && selector.includes('{{')) {
      // Template processing for selector (e.g., filtering by uploader)
      const TemplateEngine = require('./templateEngine');
      const templateEngine = new TemplateEngine();
      selector = templateEngine.process(selector, { Config: config });
    }
    
    if (rowsConfig.count?.selector) {
      const count = Number(this.getJSONValue(jsonData, rowsConfig.count.selector));
      if (Number.isFinite(count) && count < 1) return [];
    }

    // Extract rows from JSON
    let rows = this.extractJSONRows(jsonData, { ...rowsConfig, selector });
    
    if (!Array.isArray(rows) || rows.length === 0) {
      return [];
    }

    const expanded = [];
    for (const parent of rows) {
      if (!rowsConfig.attribute) {
        expanded.push({ row: parent, parent });
        continue;
      }
      const child = parent && typeof parent === 'object' ? parent[rowsConfig.attribute] : undefined;
      if (child == null) {
        if (rowsConfig.missingAttributeEqualsNoResults) continue;
        expanded.push({ row: parent, parent });
        continue;
      }
      if (rowsConfig.multiple && Array.isArray(child)) {
        for (const item of child) expanded.push({ row: item, parent });
      } else {
        expanded.push({ row: child, parent });
      }
    }
    
    const results = [];
    
    for (let i = 0; i < expanded.length; i++) {
      try {
        const { row, parent } = expanded[i];
        const result = this.parseJSONRow(row, fieldsConfig, baseUrl, config, parent);
        if (result && !this.shouldSkipRow(result, rowsConfig.filters, {})) {
          results.push(result);
        }
      } catch (error) {
        console.error(`Error parsing JSON row ${i}:`, error.message);
      }
    }
    
    return results;
  }

  /**
   * Extract rows from JSON data
   */
  extractJSONRows(jsonData, rowsConfig) {
    // If rowsConfig is a string, it's the selector
    let selector = typeof rowsConfig === 'string' ? rowsConfig : rowsConfig.selector;
    
    if (!selector) {
      // If no selector, assume the data is already an array
      return Array.isArray(jsonData) ? jsonData : [jsonData];
    }
    
    // Handle "$" selector (root array)
    if (selector === '$') {
      return Array.isArray(jsonData) ? jsonData : [jsonData];
    }
    if (selector.startsWith('$.')) {
      selector = selector.slice(2);
    }
    
    // Navigate JSON path
    return this.getJSONValue(jsonData, selector) || [];
  }

  /**
   * Parse a single JSON row
   */
  parseJSONRow(row, fieldsConfig, baseUrl, config = {}, parent = null) {
    const data = {};
    const variables = {};

    for (const [fullFieldName, fieldConfig] of Object.entries(fieldsConfig)) {
      const fieldName = String(fullFieldName).split('|')[0];
      try {
        const value = this.extractJSONField(row, fieldConfig, baseUrl, config, variables, parent);
        data[fieldName] = value;
        variables[`.Result.${fieldName}`] = value;
      } catch (error) {
        console.error(`Error extracting JSON field ${fieldName}:`, error.message);
        data[fieldName] = null;
      }
    }

    return data;
  }

  /**
   * Extract a single field from a JSON row
   */
  jsonTarget(row, parent, selector) {
    const path = String(selector || '');
    if (path.startsWith('..')) {
      return { obj: parent || row, path: path.slice(2) };
    }
    return { obj: row, path };
  }

  extractJSONField(row, fieldConfig, baseUrl, config = {}, variables = {}, parent = null) {
    // Handle string selector (field name)
    if (typeof fieldConfig === 'string') {
      const target = this.jsonTarget(row, parent, fieldConfig);
      return this.getJSONValue(target.obj, target.path);
    }
    
    let value = null;
    
    // Handle static text
    if (fieldConfig.text !== undefined) {
      value = this.processTemplateInValue(fieldConfig.text, config, variables);
    } else if (fieldConfig.case) {
      const target = fieldConfig.selector
        ? this.jsonTarget(row, parent, fieldConfig.selector)
        : { obj: row, path: '' };
      const selected = target.path ? this.getJSONValue(target.obj, target.path) : null;
      const text = selected == null ? '' : String(selected);
      for (const [key, caseValue] of Object.entries(fieldConfig.case)) {
        if (key === '*' || text === key) {
          value = this.processTemplateInValue(caseValue, config, variables);
          break;
        }
      }
    }
    // Handle selector (JSON path)
    else if (fieldConfig.selector) {
      const target = this.jsonTarget(row, parent, fieldConfig.selector);
      value = this.getJSONValue(target.obj, target.path);
      if (Array.isArray(value)) value = value.map((item) => String(item)).join(',');
      
      // Make relative URLs absolute if this is a URL field
      if (value && typeof value === 'string' && fieldConfig.attribute && 
          (fieldConfig.attribute === 'href' || fieldConfig.attribute === 'src')) {
        value = this.makeAbsoluteURL(value, baseUrl);
      }
    }
    
    // Apply default if value is empty
    if ((value === null || value === undefined || value === '') && fieldConfig.default !== undefined) {
      value = this.processTemplateInValue(fieldConfig.default, config, variables);
    }
    
    // Apply filters
    if (value !== null && fieldConfig.filters && fieldConfig.filters.length > 0) {
      value = this.filterEngine.applyFilters(value, this.renderFilterArgs(fieldConfig.filters, config, variables));
    }

    return value;
  }

  /**
   * Get value from JSON object using path notation
   */
  getJSONValue(obj, path) {
    if (obj == null || path == null || path === '') return null;

    let rest = String(path).trim();
    if (rest === '$') return obj;
    if (rest.startsWith('$.')) rest = rest.slice(2);
    else if (rest.startsWith('$')) rest = rest.slice(1);

    let current = obj;
    while (rest) {
      if (rest.startsWith('.')) rest = rest.slice(1);
      const indexMatch = rest.match(/^\[(\d+)\]/);
      if (indexMatch) {
        const index = Number(indexMatch[1]);
        if (!Array.isArray(current) || index >= current.length) return null;
        current = current[index];
        rest = rest.slice(indexMatch[0].length);
      } else {
        const fieldMatch = rest.match(/^([A-Za-z0-9_$-]+)/);
        if (!fieldMatch) return null;
        current = current?.[fieldMatch[1]];
        rest = rest.slice(fieldMatch[0].length);
      }
      if (current === undefined || current === null) return null;
      if (rest && rest[0] !== '.' && rest[0] !== '[') return null;
    }

    return current;
  }

  /**
   * Make relative URLs absolute
   */
  makeAbsoluteURL(url, baseUrl) {
    if (!url) return url;
    
    // Already absolute
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('magnet:')) {
      return url;
    }
    
    // Protocol-relative URL
    if (url.startsWith('//')) {
      return 'https:' + url;
    }
    
    // Absolute path
    if (url.startsWith('/')) {
      try {
        const base = new URL(baseUrl);
        return `${base.protocol}//${base.host}${url}`;
      } catch (e) {
        return baseUrl + url;
      }
    }
    
    // Relative path
    try {
      const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
      return new URL(url, base).href;
    } catch (e) {
      return baseUrl + '/' + url;
    }
  }

  /**
   * Format extracted data into standard result format (following Prowlarr lines 442-697)
   */
  formatResult(data, indexerInfo) {
    // Skip if missing required fields
    if (!data.title) {
      return null;
    }

    // Construct magnet link from infohash if available (Prowlarr lines 418-422)
    // Only for non-private indexers
    if (!data.download && !data.magnet && data.infohash && indexerInfo.type !== 'private') {
      const trackers = [
        'udp://tracker.coppersurfer.tk:6969/announce',
        'udp://tracker.open-internet.nl:6969/announce',
        'udp://tracker.leechers-paradise.org:6969/announce'
      ];
      const trackerParams = trackers.map(t => `&tr=${encodeURIComponent(t)}`).join('');
      data.magnet = `magnet:?xt=urn:btih:${data.infohash}&dn=${encodeURIComponent(data.title)}${trackerParams}`;
    }

    if (!data.download && !data.magnet) {
      return null;
    }

    // Parse size
    let sizeBytes = 0;
    if (data.size) {
      sizeBytes = this.parseSize(data.size);
    }

    // Parse numbers with sanitization (Prowlarr lines 564-591)
    // Cap seeders/leechers at 5M to fix data quality issues
    let seeders = this.parseNumber(data.seeders);
    let leechers = this.parseNumber(data.leechers);
    const grabs = this.parseNumber(data.grabs);
    
    // Sanitize unrealistic values (Prowlarr fix for issue #6558)
    if (seeders > 5000000) seeders = 0;
    if (leechers > 5000000) leechers = 0;

    // Get download URL (prefer magnet over download link)
    const downloadUrl = data.magnet || data.download || '';
    const detailsUrl = data.details || '';

    // Calculate age from date
    let age = 0;
    let publishDate = data.date || new Date().toISOString();

    if (data.date) {
      try {
        const dateObj = new Date(data.date);
        if (!isNaN(dateObj.getTime())) {
          age = Math.floor((Date.now() - dateObj.getTime()) / (1000 * 60 * 60 * 24));
          publishDate = dateObj.toISOString();
        }
      } catch (e) {
        // Ignore date errors
      }
    }

    // Check for Internal flag (Prowlarr lines 431-434)
    const isInternal = data.description && data.description.trim().startsWith('Internal');

    return {
      title: data.title,
      protocol: 'torrent', // Cardigann scrapers are always torrent-based
      size: sizeBytes,
      sizeFormatted: this.formatSize(sizeBytes),
      publishDate: publishDate,
      age: age,
      seeders: seeders,
      leechers: leechers,
      grabs: grabs,
      downloadUrl: downloadUrl,
      guid: detailsUrl || downloadUrl,
      description: data.description || data.category || '',
      category: data.category || '',
      categories: this.mapCategories(data.category, indexerInfo.caps),
      isInternal: isInternal,
      infohash: data.infohash || null,
    };
  }

  /**
   * Parse size string to bytes
   */
  parseSize(sizeStr) {
    if (!sizeStr) return 0;
    if (typeof sizeStr === 'number') return sizeStr;
    
    const str = String(sizeStr).trim();
    
    // First try to parse as plain number (bytes without unit)
    // This handles APIs like TPB that return raw byte counts
    const plainNumber = parseFloat(str.replace(/,/g, ''));
    if (!isNaN(plainNumber) && /^[\d,]+$/.test(str.replace(/,/g, ''))) {
      return Math.round(plainNumber);
    }
    
    // Extract number and unit
    const match = str.match(/([\d.,]+)\s*([KMGT]?i?B)/i);
    if (!match) {
      // Last resort: try parsing as plain number
      return isNaN(plainNumber) ? 0 : Math.round(plainNumber);
    }
    
    const value = parseFloat(match[1].replace(/,/g, ''));
    const unit = match[2].toUpperCase().replace('I', ''); // Handle GiB, MiB etc
    
    const multipliers = {
      'B': 1,
      'KB': 1024,
      'MB': 1024 * 1024,
      'GB': 1024 * 1024 * 1024,
      'TB': 1024 * 1024 * 1024 * 1024,
    };
    
    return value * (multipliers[unit] || 1);
  }

  /**
   * Format bytes to human-readable size
   */
  formatSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + units[i];
  }

  /**
   * Parse number from string
   */
  parseNumber(value) {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') return value;
    if (value === '-' || value === 'N/A' || value === '') return 0;
    
    const cleaned = String(value).replace(/[^0-9]/g, '');
    const parsed = parseInt(cleaned);
    return isNaN(parsed) ? 0 : parsed;
  }

  /**
   * Map site category to Torznab categories
   */
  mapCategories(siteCategory, caps) {
    if (!siteCategory) return [8000]; // Other
    if (!caps || !caps.categorymappings) return [8000];
    
    const mappings = caps.categorymappings;
    
    // Handle numeric categories
    if (typeof siteCategory === 'number' || /^\d+$/.test(siteCategory)) {
      const catId = String(siteCategory);
      const mapping = mappings.find(m => String(m.id) === catId);
      if (mapping) {
        return this.mapCategoryName(mapping.cat);
      }
    }
    
    // Handle string categories
    const catStr = String(siteCategory).toLowerCase();
    const mapping = mappings.find(m => {
      const desc = String(m.desc || '').toLowerCase();
      return desc.includes(catStr) || catStr.includes(desc);
    });
    
    if (mapping) {
      return this.mapCategoryName(mapping.cat);
    }
    
    return [8000]; // Default to Other
  }

  /**
   * Map Cardigann category name to Torznab category ID
   */
  mapCategoryName(catName) {
    const mapping = {
      'TV': [5000],
      'TV/': [5000],
      'TV/Anime': [5070],
      'TV/Documentary': [5080],
      'TV/HD': [5040],
      'TV/SD': [5030],
      'TV/Sport': [5060],
      'Movies': [2000],
      'Movies/': [2000],
      'Movies/DVD': [2030],
      'Movies/HD': [2040],
      'Movies/SD': [2030],
      'Movies/Foreign': [2010],
      'Audio': [3000],
      'Audio/': [3000],
      'Audio/Audiobook': [3030],
      'Audio/Lossless': [3040],
      'Audio/MP3': [3010],
      'Audio/Video': [3020],
      'PC': [4000],
      'PC/Games': [4050],
      'PC/0day': [4010],
      'PC/Mac': [4030],
      'Console': [1000],
      'Console/': [1000],
      'Books': [7000],
      'Books/EBook': [7020],
      'Books/Comics': [7030],
      'XXX': [6000],
      'Other': [8000],
    };
    
    return mapping[catName] || [8000];
  }
}

module.exports = CardigannParser;

