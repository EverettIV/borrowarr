const Indexers = require("../models/Indexers");
const AvailableIndexers = require("../models/AvailableIndexers");
const { getBaseUrlsForIndexer } = require("../data/indexerBaseUrls");

const canManageIndexerSettings = (user) => Boolean(user?.permissions?.admin);

exports.createIndexer = async (req, res) => {
  try {
    if (!canManageIndexerSettings(req.user)) {
      return res.status(403).json({ error: "Only admins can manage indexers" });
    }

    // Get available base URLs for this indexer and store them
    const availableBaseUrls = getBaseUrlsForIndexer(req.body.name);
    
    // Generate cardigann_id from indexer name if not provided
    // Convert name to lowercase and remove spaces/special chars
    const cardigannId = req.body.cardigannId || null;
    const privacy = req.body.privacy === "Semi-Private" ? "Private" : req.body.privacy;
    const settings = req.body.cardigannSettings || {};

    const newIndexer = await Indexers.create({
      name: req.body.name,
      protocol: req.body.protocol,
      privacy,
      priority: req.body.priority || 25,
      syncProfile: req.body.syncProfile || "Standard",
      enabled: req.body.enabled !== undefined ? req.body.enabled : true,
      redirected: req.body.redirected || false,
      baseUrl: req.body.baseUrl,
      availableBaseUrls: availableBaseUrls,
      seedRatio: req.body.seedRatio,
      username: settings.username || req.body.username,
      password: settings.password || req.body.password,
      apiKey: settings.apikey || req.body.apiKey,
      vipExpiration: req.body.vipExpiration,
      stripCyrillicLetters: req.body.stripCyrillicLetters || false,
      searchFreeleechOnly: req.body.searchFreeleechOnly || false,
      sortRequestedFromSite: req.body.sortRequestedFromSite || "created",
      orderRequestedFromSite: req.body.orderRequestedFromSite || "desc",
      accountInactivity: req.body.accountInactivity,
      tags: req.body.tags,
      categories: req.body.categories || [],
      language: req.body.language || "en-US",
      description: req.body.description,
      indexerType: req.body.indexerType || "Cardigann",
      status: req.body.status || "enabled",
      cardigannId,
      cardigannSettings: settings,
      userId: req.userId, // Keep owner for auditing, but indexers are shared globally
    });
    
    const response = newIndexer.toJSON();
    response.availableBaseUrls = availableBaseUrls;
    
    res.status(201).json(response);
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: err.message });
  }
};

exports.readIndexers = async (req, res) => {
  const page = parseInt(req.query.page) || 0;
  const limit = parseInt(req.query.limit) || 500;
  const offset = page * limit;
  try {
    const result = await Indexers.findAndCountAll({
      where: {}, // Indexers are shared across all users
      limit,
      offset,
      order: [["createdAt", "DESC"]],
    });
    
    // Add available base URLs to each indexer
    const isAdmin = canManageIndexerSettings(req.user);
    const dataWithBaseUrls = result.rows.map((indexer) => {
      try {
        const indexerData = indexer.toJSON();
        indexerData.availableBaseUrls = indexer.name
          ? getBaseUrlsForIndexer(indexer.name)
          : [];
        if (!isAdmin) {
          delete indexerData.password;
          delete indexerData.apiKey;
          delete indexerData.username;
          delete indexerData.cardigannSettings;
        }
        return indexerData;
      } catch (mapErr) {
        console.error("Error mapping indexer:", mapErr);
        // Return indexer data without base URLs if mapping fails
        const indexerData = indexer.toJSON();
        indexerData.availableBaseUrls = [];
        return indexerData;
      }
    });
    
    res.json({
      data: dataWithBaseUrls,
      total: result.count,
      page,
      limit,
    });
  } catch (err) {
    console.error("Error in readIndexers:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
};

exports.readIndexerFromID = async (req, res) => {
  try {
    const result = await Indexers.findOne({
      where: { id: req.params.id },
    });
    if (!result) {
      return res.status(404).json({ error: "Record not found" });
    }
    
    // Get available base URLs for this indexer
    const availableBaseUrls = getBaseUrlsForIndexer(result.name);
    const response = result.toJSON();
    response.availableBaseUrls = availableBaseUrls;
    if (!canManageIndexerSettings(req.user)) {
      delete response.password;
      delete response.apiKey;
      delete response.username;
      delete response.cardigannSettings;
    }

    res.json(response);
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: err.message });
  }
};

exports.updateIndexer = async (req, res) => {
  try {
    if (!canManageIndexerSettings(req.user)) {
      return res.status(403).json({ error: "Only admins can manage indexers" });
    }

    const cardigannId = req.body.cardigannId || null;
    const privacy = req.body.privacy === "Semi-Private" ? "Private" : req.body.privacy;
    const settings = req.body.cardigannSettings || {};

    const [updated] = await Indexers.update(
      {
        name: req.body.name,
        protocol: req.body.protocol,
        privacy,
        priority: req.body.priority,
        syncProfile: req.body.syncProfile,
        enabled: req.body.enabled,
        redirected: req.body.redirected,
        baseUrl: req.body.baseUrl,
        seedRatio: req.body.seedRatio,
        username: settings.username || req.body.username,
        password: settings.password || req.body.password,
        apiKey: settings.apikey || req.body.apiKey,
        vipExpiration: req.body.vipExpiration,
        stripCyrillicLetters: req.body.stripCyrillicLetters,
        searchFreeleechOnly: req.body.searchFreeleechOnly,
        sortRequestedFromSite: req.body.sortRequestedFromSite,
        orderRequestedFromSite: req.body.orderRequestedFromSite,
        accountInactivity: req.body.accountInactivity,
        tags: req.body.tags,
        categories: req.body.categories,
        language: req.body.language,
        description: req.body.description,
        indexerType: req.body.indexerType,
        status: req.body.status,
        ...(req.body.cardigannId ? { cardigannId } : {}),
        ...(req.body.cardigannSettings ? { cardigannSettings: settings } : {}),
      },
      {
        where: { id: req.params.id },
        returning: true,
      }
    );
    if (updated === 0) {
      return res.status(404).json({ error: "Record not found" });
    }
    const result = await Indexers.findOne({
      where: { id: req.params.id },
    });
    res.json(result);
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: err.message });
  }
};

exports.deleteIndexer = async (req, res) => {
  try {
    if (!canManageIndexerSettings(req.user)) {
      return res.status(403).json({ error: "Only admins can manage indexers" });
    }

    const deleted = await Indexers.destroy({
      where: { id: req.params.id },
    });
    if (deleted === 0) {
      return res.status(404).json({ error: "Record not found" });
    }
    res.json({ message: "Record deleted successfully" });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: err.message });
  }
};

exports.syncAppIndexers = async (req, res) => {
  try {
    if (!canManageIndexerSettings(req.user)) {
      return res.status(403).json({ error: "Only admins can manage indexers" });
    }
    res.json({
      message: "Indexer definitions load from the YAML directory. Add a file there and it shows up in Add Indexer.",
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: err.message });
  }
};

exports.testAllIndexers = async (req, res) => {
  try {
    if (!canManageIndexerSettings(req.user)) {
      return res.status(403).json({ error: "Only admins can manage indexers" });
    }

    const indexers = await Indexers.findAll({
      where: { enabled: true },
    });

    const { searchConfiguredIndexers } = require("../services/configuredIndexerSearch");
    const { indexerErrors, results } = await searchConfiguredIndexers(
      indexers.map((indexer) => indexer.toJSON()),
      "test",
      { limit: 5 }
    );
    const counts = {};
    for (const result of results) {
      counts[result.indexerId] = (counts[result.indexerId] || 0) + 1;
    }

    const payload = indexers.map((indexer) => {
      const error = indexerErrors.find((entry) => entry.id === indexer.id);
      const count = counts[indexer.id] || 0;
      const success = !error && count > 0;
      return {
        id: indexer.id,
        indexerId: indexer.id,
        name: indexer.name,
        success,
        error: error?.error || (count ? undefined : "Connected, but the test query returned no releases"),
        message: success ? `Connection successful (${count} results)` : (error?.error || "No releases parsed"),
      };
    });

    res.json({ results: payload });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: err.message });
  }
};

exports.testIndexer = async (req, res) => {
  try {
    if (!canManageIndexerSettings(req.user)) {
      return res.status(403).json({ success: false, error: "Only admins can manage indexers" });
    }

    let indexer;
    
    // If ID is provided, fetch from database
    if (req.params.id) {
      indexer = await Indexers.findOne({
        where: { id: req.params.id },
      });
      if (!indexer) {
        return res.status(404).json({ success: false, error: "Indexer not found" });
      }
    } else if (req.body) {
      // If body is provided, use it for testing (before saving)
      indexer = req.body;
    } else {
      return res.status(400).json({ success: false, error: "No indexer data provided" });
    }
    
    // Check if this is a Cardigann indexer
    if (indexer.indexerType === 'Cardigann') {
      console.log(`[Test] Using Cardigann for: ${indexer.name}`);
      
      const path = require('path');
      const { getCardigannEngine } = require('../cardigann');
      const definitionsPath = path.join(__dirname, '../cardigann-indexer-yamls');
      const cardigann = getCardigannEngine(definitionsPath);
      
      const { definitionIdFor } = require("../services/configuredIndexerSearch");
      const cardigannId = indexer.cardigannId || definitionIdFor(indexer);

      if (cardigannId) {
        try {
          const scraper = cardigann.getScraper(cardigannId);
          const storedSettings = indexer.cardigannSettings || {};
          const testResult = await scraper.test({
            baseUrl: indexer.baseUrl,
            settings: {
              ...(typeof storedSettings === "string" ? JSON.parse(storedSettings) : storedSettings),
              username: indexer.username,
              password: indexer.password,
              apikey: indexer.apiKey,
            },
          });
          
          if (testResult.success) {
            // Mark as verified
            if (req.params.id) {
              await Indexers.update(
                { verified: true, verifiedAt: new Date() },
                { where: { id: req.params.id } }
              );
            }
            
            if (indexer.name) {
              await AvailableIndexers.update(
                { verified: true, verifiedAt: new Date() },
                { where: { name: indexer.name } }
              ).catch(() => {});
            }
            
            return res.json({
              success: true,
              message: `Connection successful (${testResult.resultCount} results)`,
              verified: true,
            });
          } else {
            // Mark as unverified
            if (req.params.id) {
              await Indexers.update(
                { verified: false, verifiedAt: null },
                { where: { id: req.params.id } }
              );
            }
            
            return res.json({
              success: false,
              error: testResult.message || 'Test failed',
              verified: false,
            });
          }
        } catch (error) {
          return res.json({
            success: false,
            error: error.message,
            verified: false,
          });
        }
      } else {
        return res.json({
          success: false,
          error: `Cardigann definition not found for ${indexer.name}`,
          verified: false,
        });
      }
    }
    
    // Check if we have a custom scraper for this indexer
    const scraperManager = require("../scrapers");
    const availableScrapers = scraperManager.getAvailableIndexers();
    let matchedScraper = null;
    
    // Try to match by base URL domain
    if (indexer.baseUrl) {
      try {
        const indexerDomain = new URL(indexer.baseUrl).hostname.toLowerCase();
        matchedScraper = availableScrapers.find(scraper => {
          return scraper.links.some(link => {
            try {
              const scraperDomain = new URL(link).hostname.toLowerCase();
              return indexerDomain.includes(scraperDomain) || scraperDomain.includes(indexerDomain);
            } catch {
              return false;
            }
          });
        });
      } catch (e) {
        // Invalid URL, skip domain matching
      }
    }
    
    // Try to match by name if domain matching failed
    if (!matchedScraper && indexer.name) {
      const indexerNameLower = indexer.name.toLowerCase();
      matchedScraper = availableScrapers.find(scraper => 
        scraper.name.toLowerCase() === indexerNameLower ||
        indexerNameLower.includes(scraper.name.toLowerCase()) ||
        scraper.name.toLowerCase().includes(indexerNameLower)
      );
    }
    
    // If we have a scraper, use it for testing
    if (matchedScraper) {
      console.log(`[Test] Using custom scraper: ${matchedScraper.name}`);
      const testResult = await scraperManager.testScraper(matchedScraper.id);
      
      if (testResult.success) {
        // Mark as verified if test passes and indexer exists in DB
        if (req.params.id) {
          await Indexers.update(
            { verified: true, verifiedAt: new Date() },
            { where: { id: req.params.id } }
          );
        }
        
        // Also update AvailableIndexers if it exists
        if (indexer.name) {
          await AvailableIndexers.update(
            { verified: true, verifiedAt: new Date() },
            { where: { name: indexer.name } }
          ).catch(() => {}); // Ignore errors if not found
        }
        
        return res.json({
          success: true,
          message: "Connection successful",
          verified: true,
        });
      } else {
        // Extract the domain from baseUrl for better error messages
        let domain = "";
        try {
          const url = new URL(indexer.baseUrl || matchedScraper.links[0]);
          domain = url.hostname;
        } catch (e) {
          domain = indexer.baseUrl || matchedScraper.name;
        }
        
        // Format error message
        let errorMessage = testResult.message || "Test failed";
        if (errorMessage.includes("Cloudflare") || errorMessage.includes("CloudFlare")) {
          errorMessage = `Unable to access ${domain}, blocked by CloudFlare Protection. Install FlareSolverr: docker run -d --name=flaresolverr -p 8191:8191 ghcr.io/flaresolverr/flaresolverr:latest`;
        } else if (errorMessage.includes("timeout")) {
          errorMessage = `Unable to access ${domain}, connection timeout.`;
        } else if (errorMessage.includes("404") || errorMessage.includes("Not Found")) {
          errorMessage = `Unable to access ${domain}, page not found.`;
        }
        
        // Mark as unverified if test fails
        if (req.params.id) {
          await Indexers.update(
            { verified: false, verifiedAt: null },
            { where: { id: req.params.id } }
          );
        }
        
        return res.json({
          success: false,
          error: errorMessage,
          verified: false,
        });
      }
    }
    
    // Fall back to API method if no scraper found
    const { searchIndexer } = require("../services/indexerSearch");
    
    if (!indexer.baseUrl) {
      return res.json({
        success: false,
        error: "Base URL is required",
      });
    }
    
    // Perform a test search with a simple query
    const testQuery = "test";
    const result = await searchIndexer(indexer, testQuery, [], 1, 0);
    
    if (result.error) {
      // Extract the domain from baseUrl for better error messages
      let domain = "";
      try {
        const url = new URL(indexer.baseUrl);
        domain = url.hostname;
      } catch (e) {
        domain = indexer.baseUrl;
      }
      
      // Format error message similar to Prowlarr
      let errorMessage = result.error;
      if (result.error.includes("Cloudflare") || result.error.includes("cf-challenge")) {
        errorMessage = `Unable to access ${domain}, blocked by CloudFlare Protection.`;
      } else if (result.error.includes("timeout")) {
        errorMessage = `Unable to access ${domain}, connection timeout.`;
      } else if (result.error.includes("403") || result.error.includes("Forbidden")) {
        errorMessage = `Unable to access ${domain}, blocked by CloudFlare Protection.`;
      } else if (result.error.includes("404") || result.error.includes("Not Found")) {
        errorMessage = `Unable to access ${domain}, API endpoint not found.`;
      } else if (result.error.includes("ECONNREFUSED")) {
        errorMessage = `Unable to access ${domain}, connection refused.`;
      }
      
      return res.json({
        success: false,
        error: errorMessage,
      });
    }
    
    // Mark as verified if test passes and indexer exists in DB
    if (req.params.id) {
      await Indexers.update(
        { verified: true, verifiedAt: new Date() },
        { where: { id: req.params.id } }
      );
    }
    
    // Also update AvailableIndexers if it exists
    if (indexer.name) {
      await AvailableIndexers.update(
        { verified: true, verifiedAt: new Date() },
        { where: { name: indexer.name } }
      ).catch(() => {}); // Ignore errors if not found
    }
    
    res.json({
      success: true,
      message: "Connection successful",
      verified: true,
    });
  } catch (err) {
    console.error("Error testing indexer:", err);
    
    // Mark as unverified if test fails and indexer exists in DB
    if (req.params.id) {
      await Indexers.update(
        { verified: false, verifiedAt: null },
        { where: { id: req.params.id } }
      );
    }
    
    res.status(500).json({ 
      success: false,
      error: err.message || "Test failed" 
    });
  }
};

function privacyLabel(type) {
  if (type === "private") return "Private";
  if (type === "semi-private") return "Semi-Private";
  return "Public";
}

function catalogFromDefinitions() {
  const path = require("path");
  const { getCardigannEngine } = require("../cardigann");
  const engine = getCardigannEngine(path.join(__dirname, "../cardigann-indexer-yamls"));
  return engine.getAllIndexers().map((definition) => {
    const categories = [...new Set((definition.caps?.categorymappings || []).map((mapping) => mapping.cat).filter(Boolean))];
    return {
      id: definition.id,
      name: definition.name,
      description: definition.description || "",
      language: definition.language || "en-US",
      protocol: "torrent",
      privacy: privacyLabel(definition.type),
      indexerType: "Cardigann",
      categories,
      availableBaseUrls: definition.links || [],
      settings: (definition.settings || []).map((setting) => ({
        name: setting.name,
        type: setting.type,
        label: setting.label,
        default: setting.default,
        options: setting.options || null,
      })),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

exports.getAvailableIndexers = async (req, res) => {
  try {
    if (!canManageIndexerSettings(req.user)) {
      return res.status(403).json({ error: "Only admins can add indexers" });
    }

    let availableIndexers = catalogFromDefinitions();

    if (req.query.protocol) {
      availableIndexers = availableIndexers.filter((indexer) => indexer.protocol === req.query.protocol);
    }
    if (req.query.privacy) {
      availableIndexers = availableIndexers.filter((indexer) => indexer.privacy === req.query.privacy);
    }
    if (req.query.language) {
      availableIndexers = availableIndexers.filter((indexer) => indexer.language === req.query.language);
    }
    if (req.query.search) {
      const searchLower = String(req.query.search).toLowerCase();
      availableIndexers = availableIndexers.filter(
        (indexer) =>
          indexer.name.toLowerCase().includes(searchLower) ||
          indexer.description.toLowerCase().includes(searchLower) ||
          indexer.id.toLowerCase().includes(searchLower)
      );
    }

    res.json({
      indexers: availableIndexers,
      total: availableIndexers.length,
    });
  } catch (err) {
    console.error("Error fetching available indexers:", err);
    res.status(500).json({ error: err.message });
  }
};

exports.getDefinitionSync = async (req, res) => {
  const { readState } = require("../services/indexerDefinitionSync");
  res.json(readState());
};

exports.listDefinitionCatalog = async (req, res) => {
  try {
    const { listDefinitions } = require("../services/indexerDefinitionSync");
    res.json(listDefinitions());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.testDefinitionCatalog = async (req, res) => {
  try {
    if (!canManageIndexerSettings(req.user)) {
      return res.status(403).json({ error: "Only admins can test indexer definitions" });
    }
    const { testDefinitions } = require("../services/indexerDefinitionSync");
    res.json(await testDefinitions({ userId: req.user.id }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.testOneDefinition = async (req, res) => {
  try {
    if (!canManageIndexerSettings(req.user)) {
      return res.status(403).json({ error: "Only admins can test indexer definitions" });
    }
    const { testOneDefinition } = require("../services/indexerDefinitionSync");
    res.json(await testOneDefinition(req.params.id, { userId: req.user.id }));
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};

exports.updateDefinitionSync = async (req, res) => {
  try {
    if (!canManageIndexerSettings(req.user)) {
      return res.status(403).json({ error: "Only admins can manage indexer definitions" });
    }
    const { updateSettings } = require("../services/indexerDefinitionSync");
    const { refreshIndexerDefinitionScheduler } = require("../services/indexerDefinitionScheduler");
    const state = updateSettings({
      enabled: req.body.enabled,
      intervalHours: req.body.intervalHours,
    });
    refreshIndexerDefinitionScheduler();
    res.json(state);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.runDefinitionSync = async (req, res) => {
  try {
    if (!canManageIndexerSettings(req.user)) {
      return res.status(403).json({ error: "Only admins can manage indexer definitions" });
    }
    const { syncDefinitions } = require("../services/indexerDefinitionSync");
    const { refreshIndexerDefinitionScheduler } = require("../services/indexerDefinitionScheduler");
    const state = await syncDefinitions();
    refreshIndexerDefinitionScheduler();
    res.json(state);
  } catch (err) {
    const { readState } = require("../services/indexerDefinitionSync");
    res.status(500).json({ error: err.message, ...readState() });
  }
};

exports.getIndexerDefinition = async (req, res) => {
  try {
    if (!canManageIndexerSettings(req.user)) {
      return res.status(403).json({ error: "Only admins can view indexer definitions" });
    }
    const match = catalogFromDefinitions().find((indexer) => indexer.id === req.params.id);
    if (!match) {
      return res.status(404).json({ error: "Definition not found" });
    }
    res.json(match);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

