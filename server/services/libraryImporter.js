const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const MonitoredMovies = require('../models/MonitoredMovies');
const { getUserMovieDirectory } = require('./fileScanner');

const TMDB_API_KEY = process.env.TMDB_API || '02ad41cf73db27ff46061d6f52a97342';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w500';

/**
 * Pick release year when filenames contain multiple year-like numbers (e.g. 2001…1968…1080p).
 */
function findYearInMovieFilename(nameWithoutExt) {
  const candidates = [];
  const re = /(?:^|[.\s_\-[(])(19\d{2}|20\d{2})(?=[.\s_\-[\]().,]|$)/g;
  let m;
  while ((m = re.exec(nameWithoutExt)) !== null) {
    const year = parseInt(m[1], 10);
    const index = m.index + m[0].indexOf(m[1]);
    candidates.push({ year, index });
  }

  if (!candidates.length) {
    return { year: null, index: -1 };
  }

  const qualMatch = nameWithoutExt.match(/\b(2160p|1080p|720p|480p|4k|uhd)\b/i);
  const qualIdx = qualMatch ? qualMatch.index : nameWithoutExt.length;
  const beforeQual = candidates.filter((c) => c.index < qualIdx);
  const pool = beforeQual.length ? beforeQual : candidates;

  if (pool.length > 1) {
    return pool[pool.length - 1];
  }
  return pool[0];
}

/**
 * Extract movie title and year from filename
 */
function parseMovieFilename(filename) {
  const nameWithoutExt = filename.replace(/\.(mkv|mp4|avi|mov|wmv|flv|webm|m4v)$/i, '');

  const { year, index: yearIdx } = findYearInMovieFilename(nameWithoutExt);

  let title = nameWithoutExt;

  if (year != null && yearIdx >= 0) {
    title = nameWithoutExt.substring(0, yearIdx);
    title = title.replace(/[(\[]\s*$/g, '').trim();
  } else {
    // Require a release separator before tags so "Nuts" isn't stripped as telesync "ts".
    title = title.replace(
      /(?:[.\s_\-]+(?:1080p|720p|480p|2160p|4k|uhd|bluray|web-?dl|webrip|hdrip|dvdrip|brrip|telesync|x264|x265|hevc|aac|dts|torrent|dvdscr|xvid|divx|repack|proper|internal)\b|[.\s_\-](?:ts|cam)\b).*$/i,
      '',
    );
  }

  title = title
    .replace(/[._]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\(.*?\)/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/[-–]\s*$/g, '')
    .trim();

  return {
    title,
    year,
    originalFilename: filename,
  };
}

function normalizeTitleKey(title) {
  return (title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function titleSimilarityScore(query, candidate) {
  const a = normalizeTitleKey(query);
  const b = normalizeTitleKey(candidate);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.includes(b) || b.includes(a)) {
    return Math.min(92, 55 + Math.min(a.length, b.length));
  }

  const wordsA = (query || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2);
  const wordsB = (candidate || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2);
  if (!wordsA.length || !wordsB.length) return 0;

  let hits = 0;
  for (const w of wordsA) {
    if (wordsB.some((bw) => bw === w || bw.includes(w) || w.includes(bw))) hits += 1;
  }
  return Math.round((hits / wordsA.length) * 75);
}

/**
 * Search TMDB for a movie; picks the best-scoring result instead of the API's first hit.
 */
async function searchTMDB(title, year = null) {
  try {
    const params = {
      api_key: TMDB_API_KEY,
      query: title,
      include_adult: false,
    };

    if (year) {
      params.year = year;
    }

    const response = await axios.get(`${TMDB_BASE_URL}/search/movie`, { params });
    const results = response.data.results || [];
    if (!results.length) return null;

    const normQuery = normalizeTitleKey(title);
    const minScore = normQuery.length <= 6 ? 68 : 48;

    let best = null;
    let bestScore = 0;

    for (const r of results.slice(0, 15)) {
      const candidate = r.title || r.original_title || '';
      let score = titleSimilarityScore(title, candidate);
      if (year && r.release_date) {
        const y = parseInt(String(r.release_date).slice(0, 4), 10);
        if (y === year) score += 22;
        else if (Number.isFinite(y)) score -= 28;
      }
      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    }

    if (!best || bestScore < minScore) return null;

    return { ...best, tmdbMatchScore: bestScore };
  } catch (error) {
    console.error(`Error searching TMDB for "${title}":`, error.message);
    return null;
  }
}

/**
 * Scan directory for movie files
 */
async function scanMovieDirectory(directoryPath, options = {}) {
  const {
    recursive = true,
    maxDepth = 2,
    currentDepth = 0,
  } = options;
  
  const movies = [];
  const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v'];
  
  try {
    const items = await fs.readdir(directoryPath, { withFileTypes: true });
    
    for (const item of items) {
      const itemPath = path.join(directoryPath, item.name);
      
      if (item.isDirectory() && recursive && currentDepth < maxDepth) {
        // Scan subdirectory
        const subMovies = await scanMovieDirectory(itemPath, {
          recursive,
          maxDepth,
          currentDepth: currentDepth + 1,
        });
        movies.push(...subMovies);
      } else if (item.isFile()) {
        const ext = path.extname(item.name).toLowerCase();
        if (videoExtensions.includes(ext)) {
          const stats = await fs.stat(itemPath);
          movies.push({
            filePath: itemPath,
            fileName: item.name,
            fileSize: stats.size,
            lastModified: stats.mtime,
            directory: path.dirname(itemPath),
          });
        }
      }
    }
    
    return movies;
  } catch (error) {
    console.error(`Error scanning directory ${directoryPath}:`, error.message);
    return [];
  }
}

/**
 * Import movies from directory into monitored list
 */
async function importMoviesFromDirectory(userId, options = {}) {
  const {
    dryRun = false,
    qualityProfile = 'any',
    minAvailability = 'released',
    monitor = 'movieOnly',
  } = options;
  
  // Get user's movie directory
  const movieDirectory = await getUserMovieDirectory(userId);
  
  if (!movieDirectory) {
    throw new Error('Movie directory not configured in settings');
  }
  
  console.log(`🔍 Scanning directory: ${movieDirectory}`);
  
  // Scan for movie files
  const movieFiles = await scanMovieDirectory(movieDirectory);
  
  console.log(`📁 Found ${movieFiles.length} video files`);
  
  const results = {
    total: movieFiles.length,
    imported: 0,
    skipped: 0,
    errors: 0,
    alreadyMonitored: 0,
    movies: [],
  };
  
  for (const file of movieFiles) {
    try {
      // Parse filename to extract title and year
      const parsed = parseMovieFilename(file.fileName);
      
      console.log(`\n📽️  Processing: ${file.fileName}`);
      console.log(`   Title: ${parsed.title}, Year: ${parsed.year || 'unknown'}`);
      
      // Search TMDB
      const tmdbMatch = await searchTMDB(parsed.title, parsed.year);
      
      if (!tmdbMatch) {
        console.log(`   ❌ No TMDB match found`);
        results.errors++;
        results.movies.push({
          fileName: file.fileName,
          status: 'error',
          error: 'No TMDB match found',
        });
        continue;
      }
      
      console.log(`   ✅ TMDB match: ${tmdbMatch.title} (${tmdbMatch.release_date?.substring(0, 4)})`);
      
      // Check if already monitored
      const existing = await MonitoredMovies.findOne({
        where: { userId, tmdbId: tmdbMatch.id },
      });
      
      if (existing) {
        console.log(`   ⏭️  Already monitored`);
        results.alreadyMonitored++;
        results.movies.push({
          fileName: file.fileName,
          tmdbId: tmdbMatch.id,
          title: tmdbMatch.title,
          status: 'already_monitored',
        });
        
        // Update file info for existing movie
        if (!dryRun) {
          await existing.update({
            fileExists: true,
            filePath: file.filePath,
            fileName: file.fileName,
            fileSize: file.fileSize,
            status: 'downloaded',
            lastChecked: new Date(),
          });
        }
        
        continue;
      }
      
      if (dryRun) {
        console.log(`   📋 Would import (dry run)`);
        results.imported++;
        results.movies.push({
          fileName: file.fileName,
          tmdbId: tmdbMatch.id,
          title: tmdbMatch.title,
          year: tmdbMatch.release_date?.substring(0, 4),
          status: 'would_import',
        });
        continue;
      }
      
      // Add to monitored list
      const posterUrl = tmdbMatch.poster_path
        ? `${TMDB_IMAGE_BASE_URL}${tmdbMatch.poster_path}`
        : null;
      
      const movie = await MonitoredMovies.create({
        userId,
        tmdbId: tmdbMatch.id,
        title: tmdbMatch.title,
        posterUrl,
        releaseDate: tmdbMatch.release_date || null,
        overview: tmdbMatch.overview || null,
        qualityProfile,
        minAvailability,
        monitor,
        status: 'downloaded',
        fileExists: true,
        filePath: file.filePath,
        fileName: file.fileName,
        fileSize: file.fileSize,
        lastChecked: new Date(),
      });
      
      console.log(`   ✅ Imported to monitored list (ID: ${movie.id})`);
      results.imported++;
      results.movies.push({
        fileName: file.fileName,
        tmdbId: tmdbMatch.id,
        title: tmdbMatch.title,
        year: tmdbMatch.release_date?.substring(0, 4),
        status: 'imported',
        movieId: movie.id,
      });
      
      // Small delay to avoid hammering TMDB API
      await new Promise(resolve => setTimeout(resolve, 250));
      
    } catch (error) {
      console.error(`   ❌ Error processing ${file.fileName}:`, error.message);
      results.errors++;
      results.movies.push({
        fileName: file.fileName,
        status: 'error',
        error: error.message,
      });
    }
  }
  
  console.log(`\n📊 Import Summary:`);
  console.log(`   Total files: ${results.total}`);
  console.log(`   Imported: ${results.imported}`);
  console.log(`   Already monitored: ${results.alreadyMonitored}`);
  console.log(`   Errors: ${results.errors}`);
  
  return results;
}

module.exports = {
  parseMovieFilename,
  normalizeTitleKey,
  searchTMDB,
  scanMovieDirectory,
  importMoviesFromDirectory,
};

