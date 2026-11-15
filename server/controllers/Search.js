const Indexers = require("../models/Indexers");
const Categories = require("../models/Categories");
const { searchConfiguredIndexers } = require("../services/configuredIndexerSearch");

// In-memory cache with TTL
const cache = new Map();
const CACHE_TTL = 2 * 60 * 1000; // 2 minutes cache

function getCacheKey(query, indexerIds, categoryIds) {
  // Ensure categoryIds and indexerIds are arrays before calling sort
  const indexerArray = Array.isArray(indexerIds) ? indexerIds : (indexerIds ? [indexerIds] : []);
  const categoryArray = Array.isArray(categoryIds) ? categoryIds : (categoryIds ? [categoryIds] : []);
  return `search:${query}:${indexerArray.sort().join(',')}:${categoryArray.sort().join(',')}`;
}

function getCached(key) {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  cache.delete(key);
  return null;
}

function setCached(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
  
  // Clean up old cache entries periodically
  if (cache.size > 100) {
    const now = Date.now();
    for (const [k, v] of cache.entries()) {
      if (now - v.timestamp >= CACHE_TTL) {
        cache.delete(k);
      }
    }
  }
}

// Search indexers using Torznab/Newznab APIs
exports.search = async (req, res) => {
  const startTime = Date.now();
  
  try {
    const {
      query,
      indexerIds,
      categoryIds,
      sortBy = "age",
      sortOrder = "desc",
      limit = 100,
      offset = 0,
      fresh, // If 'true', bypass cache for fresh results
    } = req.query;

    if (!query || query.trim() === "") {
      return res.json({
        results: [],
        total: 0,
        indexers: [],
      });
    }

    // Check cache first (unless fresh=true is passed)
    const cacheKey = getCacheKey(query, indexerIds, categoryIds);
    const skipCache = fresh === 'true';
    
    if (skipCache) {
      // Clear the cache for this query to force fresh results
      cache.delete(cacheKey);
      console.log(`[Search] Fresh search requested for "${query}", cache cleared`);
    }
    
    const cached = getCached(cacheKey);
    if (cached && !skipCache) {
      console.log(`[Search] Cache hit for "${query}" (${Date.now() - startTime}ms)`);
      
      // Still need to sort and paginate cached results
      const { allResults, indexerSummaries } = cached;
      const sortedResults = sortResults(allResults, sortBy, sortOrder);
      const total = sortedResults.length;
      const paginatedResults = sortedResults.slice(
        parseInt(offset),
        parseInt(offset) + parseInt(limit)
      );
      
      return res.json({
        results: paginatedResults,
        total: total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        indexers: indexerSummaries,
        cached: true,
        responseTime: Date.now() - startTime,
      });
    }

    // Get enabled indexers shared across the whole server
    const whereClause = { enabled: true };

    let indexers = await Indexers.findAll({
      where: whereClause,
      attributes: ['id', 'name', 'baseUrl', 'username', 'password', 'apiKey', 'protocol', 'indexerType', 'enabled', 'categories', 'verified', 'priority', 'cardigannId', 'cardigannSettings'],
      raw: true, // Get plain objects instead of Sequelize instances
    });

    // Filter by indexerIds if provided
    if (indexerIds) {
      const ids = Array.isArray(indexerIds) ? indexerIds.map(id => parseInt(id)) : [parseInt(indexerIds)];
      indexers = indexers.filter((idx) => ids.includes(idx.id));
    }

    if (indexers.length === 0) {
      return res.json({
        results: [],
        total: 0,
        indexers: [],
        configured: false,
        message: "No indexers are configured. An admin has to add them before search works.",
      });
    }

    // Parse category IDs
    const parsedCategoryIds = categoryIds
      ? (Array.isArray(categoryIds) ? categoryIds : [categoryIds]).map((id) => parseInt(id)).filter((id) => !isNaN(id))
      : [];

    console.log(`[Search] Query: "${query}", Indexers: ${indexers.length}, Categories: ${parsedCategoryIds.length}`);

    const searchStartTime = Date.now();
    const { results: allResults, indexerErrors } = await searchConfiguredIndexers(
      indexers,
      query,
      { categoryIds: parsedCategoryIds, limit: parseInt(limit), offset: parseInt(offset) }
    );

    console.log(`[Search] Search completed in ${Date.now() - searchStartTime}ms, ${allResults.length} total results`);

    // Create indexer summaries
    const indexerSummaries = indexers.map(idx => ({
      id: idx.id,
      name: idx.name,
      resultCount: allResults.filter(r => r.indexerId === idx.id || r.indexer === idx.name).length,
      error: indexerErrors.find((entry) => entry.id === idx.id)?.error || null,
    }));

    // Cache the raw results before filtering/sorting
    setCached(cacheKey, { allResults, indexerSummaries });

    // Filter results by category if provided
    // Categories use a hierarchical system: 2000=Movies (2000-2999), 5000=TV (5000-5999), etc.
    // When user requests 5000, we should include all TV subcategories (5010, 5020, 5040, etc.)
    let filteredResults = allResults;
    if (parsedCategoryIds.length > 0) {
      // Get the base categories (e.g., 2000, 5000) to match against subcategories
      const baseCategories = parsedCategoryIds.map(catId => Math.floor(catId / 1000) * 1000);
      
      filteredResults = allResults.filter((result) => {
        // If result has no categories, include it (don't filter out)
        if (!result.categories || result.categories.length === 0) {
          return true;
        }
        
        return result.categories.some((catId) => {
          // Exact match
          if (parsedCategoryIds.includes(catId)) return true;
          
          // Check if result category belongs to any of the requested base categories
          // e.g., if user requests 5000, match 5010, 5020, 5040, etc.
          const resultBaseCategory = Math.floor(catId / 1000) * 1000;
          return baseCategories.includes(resultBaseCategory);
        });
      });
    }

    // Sort results
    const sortedResults = sortResults(filteredResults, sortBy, sortOrder);

    // Apply pagination
    const total = sortedResults.length;
    const paginatedResults = sortedResults.slice(
      parseInt(offset),
      parseInt(offset) + parseInt(limit)
    );

    console.log(`[Search] Total response time: ${Date.now() - startTime}ms`);

    res.json({
      results: paginatedResults,
      total: total,
      limit: parseInt(limit),
      offset: parseInt(offset),
      indexers: indexerSummaries,
      responseTime: Date.now() - startTime,
    });
  } catch (err) {
    console.error("Error in search:", err);
    res.status(500).json({ 
      error: err.message || "Internal server error",
      responseTime: Date.now() - startTime,
    });
  }
};

// Optimized sorting function
function sortResults(results, sortBy, sortOrder) {
  const order = sortOrder === "asc" ? 1 : -1;
  
  // Use a sort function that avoids repeated property access
  return results.sort((a, b) => {
    let aVal, bVal;
    
    // Always prioritize by indexer priority first (lower number = higher priority)
    const priorityA = a.indexerPriority ?? 25;
    const priorityB = b.indexerPriority ?? 25;
    if (priorityA !== priorityB) {
      return priorityA - priorityB; // Lower number = higher priority
    }
    
    // If priorities are equal, sort by the requested field
    switch (sortBy) {
      case "protocol":
        return order * a.protocol.localeCompare(b.protocol);
      case "age":
        return order * (a.age - b.age);
      case "title":
        return order * a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
      case "indexer":
        return order * a.indexer.localeCompare(b.indexer, undefined, { sensitivity: 'base' });
      case "size":
        return order * (a.size - b.size);
      case "grabs":
        return order * (a.grabs - b.grabs);
      case "seeders":
        aVal = a.seeders ?? 0;
        bVal = b.seeders ?? 0;
        return order * (aVal - bVal);
      case "leechers":
        aVal = a.leechers ?? 0;
        bVal = b.leechers ?? 0;
        return order * (aVal - bVal);
      case "peers":
        aVal = a.seeders ?? 0;
        bVal = b.seeders ?? 0;
        return order * (aVal - bVal);
      case "category":
        aVal = a.categories[0] ?? 0;
        bVal = b.categories[0] ?? 0;
        return order * (aVal - bVal);
      default:
        return order * (a.age - b.age);
    }
  });
}

exports.getCategories = async (req, res) => {
  try {
    // Cache categories since they rarely change
    const cacheKey = 'categories:all';
    const cached = getCached(cacheKey);
    
    if (cached) {
      return res.json(cached);
    }
    
    const categories = await Categories.findAll({
      order: [["id", "ASC"]],
      raw: true, // Get plain objects for faster JSON serialization
    });
    
    setCached(cacheKey, categories);
    res.json(categories);
  } catch (err) {
    console.error("Error fetching categories:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
};