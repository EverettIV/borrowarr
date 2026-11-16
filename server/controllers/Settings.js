const Settings = require('../models/Settings');
const { clampQualityPair } = require('../utils/qualitySelection');
const User = require("../models/User");
const fs = require('fs').promises;
const path = require('path');
const { importMoviesFromDirectory } = require('../services/libraryImporter');
const { importSeriesFromDirectory } = require('../services/seriesImporter');
const { previewMovieRenames, executeMovieRenames, previewSeriesRenames, executeSeriesRenames } = require('../services/fileRenamer');
const {
  scanMovieAnomalies,
  deleteDuplicateMediaFile,
} = require('../services/anomalyDetector');

// Lazy load auto-rename service to avoid circular dependency issues
let autoRenameService = null;
const getAutoRenameService = () => {
  if (!autoRenameService) {
    autoRenameService = require('../services/autoRenameService');
  }
  return autoRenameService;
};

// Lazy load download watcher service
let downloadWatcherService = null;
const getDownloadWatcherService = () => {
  if (!downloadWatcherService) {
    downloadWatcherService = require('../services/downloadWatcher');
  }
  return downloadWatcherService;
};

let anomalySchedulerService = null;
const getAnomalySchedulerService = () => {
  if (!anomalySchedulerService) {
    anomalySchedulerService = require('../services/anomalyDetectorScheduler');
  }
  return anomalySchedulerService;
};

// Lazy load monitoring service
let monitoringService = null;
const getMonitoringService = () => {
  if (!monitoringService) {
    monitoringService = require('../services/monitoringService');
  }
  return monitoringService;
};

/**
 * Get user settings
 */
exports.getSettings = async (req, res) => {
  try {
    const userId = req.userId;

    let settings = await Settings.findOne({ where: { userId } });

    // If no settings exist, create default settings
    if (!settings) {
      settings = await Settings.create({ userId });
    }

    res.json(settings);
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
};

/**
 * Get public registration status (no auth required)
 */
exports.getPublicRegistrationStatus = async (req, res) => {
  try {
    const userCount = await User.count();
    const isFirstRun = userCount === 0;

    if (isFirstRun) {
      return res.json({ enabled: true });
    }

    // Get the first user's settings (admin settings) or default
    const settings = await Settings.findOne({ order: [['createdAt', 'ASC']] });
    
    res.json({ 
      enabled: settings ? settings.publicRegistrationEnabled : false,
    });
  } catch (error) {
    console.error('Error fetching registration status:', error);
    res.status(500).json({ error: 'Failed to fetch registration status' });
  }
};

/**
 * Update user settings
 */
exports.updateSettings = async (req, res) => {
  try {
    const userId = req.userId;
    const updates = req.body;

    if (
      Object.prototype.hasOwnProperty.call(updates, "publicRegistrationEnabled") &&
      !req.user?.permissions?.admin
    ) {
      return res.status(403).json({ error: "Only admins can change public registration" });
    }

    if (updates.checkInterval !== undefined) {
      const sec = Number(updates.checkInterval);
      if (!Number.isFinite(sec) || sec < 60) {
        return res.status(400).json({
          error: "Check interval must be at least 60 seconds",
          field: "checkInterval",
        });
      }
      updates.checkInterval = Math.round(sec);
    }

    const qualityFields = ["minQuality", "maxQuality"];
    const touchesQuality = qualityFields.some((key) => updates[key] !== undefined);
    if (touchesQuality) {
      const existing = await Settings.findOne({ where: { userId } });
      const clamped = clampQualityPair(
        updates.minQuality ?? existing?.minQuality ?? "720p",
        updates.maxQuality ?? existing?.maxQuality ?? "1080p",
      );
      updates.minQuality = clamped.minQuality;
      updates.maxQuality = clamped.maxQuality;
      updates.preferredQuality = clamped.preferredQuality;
    }

    // Validate media directories if provided (skip if null, undefined, or empty)
    // These are separate from download watcher directories
    // Only validate if a non-empty value is being set
    if (updates.movieDirectory !== undefined && updates.movieDirectory !== null && String(updates.movieDirectory).trim() !== '') {
      try {
        await fs.access(updates.movieDirectory);
      } catch (error) {
        console.error('Movie directory validation error:', error);
        // Don't fail if it's just for download watcher - only fail if user is actually setting media directory
        // Check if this is a download watcher-only update
        const isDownloadWatcherOnly = updates.movieDownloadDirectory !== undefined || 
                                     updates.seriesDownloadDirectory !== undefined ||
                                     updates.movieWatcherDestination !== undefined ||
                                     updates.seriesWatcherDestination !== undefined;
        
        if (!isDownloadWatcherOnly) {
          return res.status(400).json({ 
            error: 'Movie directory does not exist or is not accessible',
            field: 'movieDirectory',
            message: error.message
          });
        }
        // If it's a download watcher update, just log the warning but don't fail
        console.warn('Movie directory validation failed but continuing (download watcher update)');
      }
    }

    if (updates.seriesDirectory !== undefined && updates.seriesDirectory !== null && String(updates.seriesDirectory).trim() !== '') {
      try {
        await fs.access(updates.seriesDirectory);
      } catch (error) {
        console.error('Series directory validation error:', error);
        // Don't fail if it's just for download watcher - only fail if user is actually setting media directory
        const isDownloadWatcherOnly = updates.movieDownloadDirectory !== undefined || 
                                     updates.seriesDownloadDirectory !== undefined ||
                                     updates.movieWatcherDestination !== undefined ||
                                     updates.seriesWatcherDestination !== undefined;
        
        if (!isDownloadWatcherOnly) {
          return res.status(400).json({ 
            error: 'Series directory does not exist or is not accessible',
            field: 'seriesDirectory',
            message: error.message
          });
        }
        // If it's a download watcher update, just log the warning but don't fail
        console.warn('Series directory validation failed but continuing (download watcher update)');
      }
    }

    // Validate download watcher directories if provided
    // Only validate if the directory is being set (not null/empty)
    // For download watcher, you need BOTH source and destination for each type, but you can configure just movies OR just series
    
    // Movie download watcher: if either is set, both should be set
    const hasMovieDownloadSource = updates.movieDownloadDirectory !== undefined && updates.movieDownloadDirectory !== null && String(updates.movieDownloadDirectory).trim() !== '';
    const hasMovieDownloadDest = updates.movieWatcherDestination !== undefined && updates.movieWatcherDestination !== null && String(updates.movieWatcherDestination).trim() !== '';
    
    if (hasMovieDownloadSource || hasMovieDownloadDest) {
      // If one is set, the other should also be set
      if (!hasMovieDownloadSource || !hasMovieDownloadDest) {
        return res.status(400).json({ 
          error: 'Movie download watcher requires both download directory and destination directory',
          field: hasMovieDownloadSource ? 'movieWatcherDestination' : 'movieDownloadDirectory'
        });
      }
      
      // Validate both exist
      try {
        await fs.access(updates.movieDownloadDirectory);
      } catch (error) {
        return res.status(400).json({ 
          error: 'Movie download directory does not exist or is not accessible',
          field: 'movieDownloadDirectory',
          message: error.message
        });
      }
      
      try {
        await fs.access(updates.movieWatcherDestination);
      } catch (error) {
        return res.status(400).json({ 
          error: 'Movie watcher destination does not exist or is not accessible',
          field: 'movieWatcherDestination',
          message: error.message
        });
      }
    }
    
    // Series download watcher: if either is set, both should be set
    const hasSeriesDownloadSource = updates.seriesDownloadDirectory !== undefined && updates.seriesDownloadDirectory !== null && String(updates.seriesDownloadDirectory).trim() !== '';
    const hasSeriesDownloadDest = updates.seriesWatcherDestination !== undefined && updates.seriesWatcherDestination !== null && String(updates.seriesWatcherDestination).trim() !== '';
    
    if (hasSeriesDownloadSource || hasSeriesDownloadDest) {
      // If one is set, the other should also be set
      if (!hasSeriesDownloadSource || !hasSeriesDownloadDest) {
        return res.status(400).json({ 
          error: 'Series download watcher requires both download directory and destination directory',
          field: hasSeriesDownloadSource ? 'seriesWatcherDestination' : 'seriesDownloadDirectory'
        });
      }
      
      // Validate both exist
      try {
        await fs.access(updates.seriesDownloadDirectory);
      } catch (error) {
        return res.status(400).json({ 
          error: 'Series download directory does not exist or is not accessible',
          field: 'seriesDownloadDirectory',
          message: error.message
        });
      }
      
      try {
        await fs.access(updates.seriesWatcherDestination);
      } catch (error) {
        return res.status(400).json({ 
          error: 'Series watcher destination does not exist or is not accessible',
          field: 'seriesWatcherDestination',
          message: error.message
        });
      }
    }

    // Find or create settings
    let settings = await Settings.findOne({ where: { userId } });
    
    // Track if auto-rename settings changed
    const autoRenameChanged = settings && (
      updates.autoRename !== undefined && settings.autoRename !== updates.autoRename ||
      updates.autoRenameInterval !== undefined && settings.autoRenameInterval !== updates.autoRenameInterval
    );
    
    if (!settings) {
      settings = await Settings.create({ userId, ...updates });
    } else {
      // Only update fields that are provided in the request
      const fieldsToUpdate = {};
      Object.keys(updates).forEach(key => {
        if (updates[key] !== undefined) {
          fieldsToUpdate[key] = updates[key];
        }
      });
      await settings.update(fieldsToUpdate);
      // Reload to get updated values
      await settings.reload();
    }

    // Update auto-rename service if settings changed
    if (autoRenameChanged || (!settings && updates.autoRename)) {
      try {
        const { updateUserAutoRename } = getAutoRenameService();
        await updateUserAutoRename(
          userId, 
          settings.autoRename, 
          settings.autoRenameInterval || 60
        );
        console.log(`🔄 [Settings] Auto-rename service updated for user ${userId}: enabled=${settings.autoRename}, interval=${settings.autoRenameInterval}min`);
      } catch (autoRenameError) {
        console.error('Error updating auto-rename service:', autoRenameError);
        // Don't fail the request, just log the error
      }
    }

    // Update download watcher if settings changed
    const watcherSettingsChanged = (
      updates.downloadWatcherEnabled !== undefined ||
      updates.movieDownloadDirectory !== undefined ||
      updates.seriesDownloadDirectory !== undefined ||
      updates.movieWatcherDestination !== undefined ||
      updates.seriesWatcherDestination !== undefined ||
      updates.watcherInterval !== undefined ||
      updates.watcherAutoApprove !== undefined ||
      updates.movieWatcherDownloadMode !== undefined ||
      updates.movieWatcherMediaMode !== undefined ||
      updates.movieWatcherCustomDownloadDirectory !== undefined ||
      updates.movieWatcherCustomMediaDirectory !== undefined ||
      updates.seriesWatcherDownloadMode !== undefined ||
      updates.seriesWatcherMediaMode !== undefined ||
      updates.seriesWatcherCustomDownloadDirectory !== undefined ||
      updates.seriesWatcherCustomMediaDirectory !== undefined ||
      updates.movieWatcherEnabled !== undefined ||
      updates.seriesWatcherEnabled !== undefined ||
      updates.applyNamingOnWatcherApprove !== undefined ||
      updates.applyNamingOnAutomaticMove !== undefined ||
      updates.movieApplyNamingOnWatcherApprove !== undefined ||
      updates.seriesApplyNamingOnWatcherApprove !== undefined ||
      updates.movieApplyNamingOnAutomaticMove !== undefined ||
      updates.seriesApplyNamingOnAutomaticMove !== undefined
    );

    if (watcherSettingsChanged) {
      try {
        const { updateWatcher } = getDownloadWatcherService();
        updateWatcher(userId, settings.toJSON());
        console.log(`👁️ [Settings] Download watcher updated for user ${userId}: enabled=${settings.downloadWatcherEnabled}`);
      } catch (watcherError) {
        console.error('Error updating download watcher:', watcherError);
        // Don't fail the request, just log the error
      }
    }

    const anomalySchedulerChanged =
      updates.anomalyDetectorAutoScanEnabled !== undefined ||
      updates.anomalyDetectorScanInterval !== undefined ||
      updates.anomalyDetectorScanDirKey !== undefined ||
      updates.anomalyDetectorCustomScanPath !== undefined ||
      updates.anomalyDetectorCheckDuplicates !== undefined ||
      updates.anomalyDetectorCheckCorruption !== undefined ||
      updates.anomalyDetectorCheckLargeFiles !== undefined ||
      updates.movieDownloadDirectory !== undefined ||
      updates.movieWatcherDestination !== undefined ||
      updates.seriesDownloadDirectory !== undefined ||
      updates.seriesWatcherDestination !== undefined;

    if (anomalySchedulerChanged) {
      try {
        const { updateAnomalyScheduler } = getAnomalySchedulerService();
        updateAnomalyScheduler(userId, settings.toJSON());
        console.log(
          `[Settings] Anomaly auto-scan updated for user ${userId}: enabled=${settings.anomalyDetectorAutoScanEnabled}`,
        );
      } catch (anomalySchedulerError) {
        console.error('Error updating anomaly scheduler:', anomalySchedulerError);
      }
    }

    // Update monitoring scheduler if checkInterval or autoDownload changed
    const monitoringSettingsChanged = (
      updates.checkInterval !== undefined ||
      updates.autoDownload !== undefined
    );

    if (monitoringSettingsChanged) {
      try {
        const { scheduleUserMonitoring } = getMonitoringService();
        await scheduleUserMonitoring(userId);
        console.log(`🔄 [Settings] Monitoring scheduler updated for user ${userId}: checkInterval=${settings.checkInterval}s, autoDownload=${settings.autoDownload}`);
      } catch (monitoringError) {
        console.error('Error updating monitoring scheduler:', monitoringError);
        // Don't fail the request, just log the error
      }
    }

    res.json(settings);
  } catch (error) {
    console.error('Error updating settings:', error);
    // Provide more detailed error information
    const errorMessage = error.message || 'Failed to update settings';
    const statusCode = error.name === 'SequelizeValidationError' ? 400 : 500;
    res.status(statusCode).json({ 
      error: errorMessage,
      details: error.errors || undefined
    });
  }
};

const canBrowseServerFilesystem = (user) => Boolean(user?.permissions?.admin);

/**
 * Test directory access (admin only)
 */
exports.testDirectory = async (req, res) => {
  try {
    if (!canBrowseServerFilesystem(req.user)) {
      return res.status(403).json({ error: 'Only admins can test server directories' });
    }

    const { directory } = req.body;

    if (!directory) {
      return res.status(400).json({ error: 'Directory path is required' });
    }

    // Check if directory exists and is accessible
    try {
      const stats = await fs.stat(directory);
      
      if (!stats.isDirectory()) {
        return res.status(400).json({ 
          error: 'Path is not a directory',
          accessible: false
        });
      }

      // Try to read the directory
      await fs.readdir(directory);

      res.json({ 
        accessible: true,
        exists: true,
        writable: true, // We could add a more sophisticated check here
        path: directory
      });
    } catch (error) {
      if (error.code === 'ENOENT') {
        return res.status(404).json({ 
          error: 'Directory does not exist',
          accessible: false,
          exists: false
        });
      } else if (error.code === 'EACCES') {
        return res.status(403).json({ 
          error: 'Permission denied',
          accessible: false,
          exists: true
        });
      } else {
        throw error;
      }
    }
  } catch (error) {
    console.error('Error testing directory:', error);
    res.status(500).json({ error: 'Failed to test directory' });
  }
};

/**
 * Browse directories (for directory picker — admin only)
 * Supports network shares on Windows (UNC paths), macOS, and Linux
 */
exports.browseDirectories = async (req, res) => {
  try {
    if (!canBrowseServerFilesystem(req.user)) {
      return res.status(403).json({ error: 'Only admins can browse server directories' });
    }

    const { currentPath } = req.query;
    let browsePath = currentPath || '/';

    // Handle Windows UNC paths (\\server\share)
    const isWindowsUNC = browsePath.startsWith('\\\\') || browsePath.startsWith('//');
    
    // Security: Prevent path traversal attacks
    // For UNC paths, normalize but preserve the UNC format
    if (isWindowsUNC) {
      // Normalize UNC path (convert // to \\, remove redundant separators)
      browsePath = browsePath.replace(/[/\\]+/g, '\\');
      // Ensure it starts with \\
      if (!browsePath.startsWith('\\\\')) {
        browsePath = '\\' + browsePath;
      }
    } else {
      // For regular paths, use path.resolve but handle network mounts
      // On macOS, network mounts are often in /Volumes
      // On Linux, they might be in /mnt or /media
      const normalized = path.resolve(browsePath);
      
      // Check if the resolved path is still accessible (network paths might resolve differently)
      try {
        await fs.access(normalized);
        browsePath = normalized;
      } catch {
        // If resolved path doesn't exist, try the original (might be a network path)
        try {
          await fs.access(browsePath);
          // Keep original path
        } catch {
          browsePath = normalized;
        }
      }
    }

    try {
      const entries = await fs.readdir(browsePath, { withFileTypes: true });

      const directories = [];
      const symlinksToResolve = [];

      for (const entry of entries) {
        const entryPath = isWindowsUNC
          ? path.win32.join(browsePath, entry.name)
          : path.join(browsePath, entry.name);

        if (entry.isDirectory()) {
          directories.push({
            name: entry.name,
            path: entryPath,
            isSymlink: entry.isSymbolicLink(),
          });
        } else if (entry.isSymbolicLink()) {
          symlinksToResolve.push({ entry, entryPath });
        }
      }

      if (symlinksToResolve.length > 0) {
        const resolved = await Promise.all(
          symlinksToResolve.map(async ({ entry, entryPath }) => {
            try {
              const stats = await fs.stat(entryPath);
              if (stats.isDirectory()) {
                return {
                  name: entry.name,
                  path: entryPath,
                  isSymlink: true,
                };
              }
            } catch {
              // Ignore broken symlinks or inaccessible entries
            }
            return null;
          }),
        );

        for (const dir of resolved) {
          if (dir) {
            directories.push(dir);
          }
        }
      }

      directories.sort((a, b) => a.name.localeCompare(b.name));

      // Add parent directory option if not at root
      let parentPath = null;
      let isRoot = false;
      
      if (isWindowsUNC) {
        // For UNC paths, check if we're at the share root (\\server\share)
        const parts = browsePath.split('\\').filter(p => p);
        if (parts.length <= 2) {
          isRoot = true;
        } else {
          parentPath = parts.slice(0, -1).join('\\');
          if (!parentPath.startsWith('\\\\')) {
            parentPath = '\\\\' + parentPath;
          }
        }
      } else {
        parentPath = path.dirname(browsePath);
        const parsed = path.parse(browsePath);
        isRoot = browsePath === parsed.root || browsePath === '/';
      }

      res.json({
        currentPath: browsePath,
        parentPath: isRoot ? null : parentPath,
        directories,
      });
    } catch (error) {
      if (error.code === 'ENOENT') {
        return res.status(404).json({ error: 'Directory does not exist' });
      } else if (error.code === 'EACCES') {
        return res.status(403).json({ error: 'Permission denied' });
      } else {
        throw error;
      }
    }
  } catch (error) {
    console.error('Error browsing directories:', error);
    res.status(500).json({ error: 'Failed to browse directories' });
  }
};

/**
 * Import movies from directory into monitored list
 */
exports.importMovies = async (req, res) => {
  try {
    const userId = req.userId;
    const { dryRun = false } = req.body;

    console.log(`📥 Starting movie import for user ${userId} (dryRun: ${dryRun})`);

    const results = await importMoviesFromDirectory(userId, {
      dryRun,
      qualityProfile: 'any',
      minAvailability: 'released',
      monitor: 'movieOnly',
    });

    res.json({
      success: true,
      results,
      message: dryRun 
        ? `Dry run complete. Would import ${results.imported} movies.`
        : `Import complete! Imported ${results.imported} movies.`,
    });
  } catch (error) {
    console.error('Error importing movies:', error);
    res.status(500).json({ error: error.message || 'Failed to import movies' });
  }
};

/**
 * Import series from directory into monitored list
 */
exports.importSeries = async (req, res) => {
  try {
    const userId = req.userId;
    const { dryRun = false } = req.body;

    console.log(`📺 Starting series import for user ${userId} (dryRun: ${dryRun})`);

    const results = await importSeriesFromDirectory(userId, {
      dryRun,
      qualityProfile: 'any',
      minAvailability: 'released',
      monitor: 'all',
    });

    res.json({
      success: true,
      results,
      message: dryRun 
        ? `Dry run complete. Would import ${results.imported} series.`
        : `Import complete! Imported ${results.imported} series.`,
    });
  } catch (error) {
    console.error('Error importing series:', error);
    res.status(500).json({ error: error.message || 'Failed to import series' });
  }
};

/**
 * Preview file renames based on naming format
 */
exports.previewRenames = async (req, res) => {
  try {
    const userId = req.userId;
    const { movieFileFormat, seriesFileFormat } = req.body;

    console.log(`🔍 Previewing renames for user ${userId}`);

    const results = {
      movies: [],
      series: [],
      stats: { movies: null, series: null },
      total: 0,
    };

    if (movieFileFormat) {
      const moviePreview = await previewMovieRenames(userId, movieFileFormat);
      results.movies = moviePreview.renames || moviePreview;
      results.stats.movies = moviePreview.stats || null;
    }

    if (seriesFileFormat) {
      const seriesPreview = await previewSeriesRenames(userId, seriesFileFormat);
      results.series = seriesPreview.renames || seriesPreview;
      results.stats.series = seriesPreview.stats || null;
    }

    results.total = results.movies.length + results.series.length;

    const { validateMovieFormat, validateSeriesFormat } = require('../services/mediaOrganizer');
    const formatHints = {
      movie: movieFileFormat ? validateMovieFormat(movieFileFormat) : null,
      series: seriesFileFormat ? validateSeriesFormat(seriesFileFormat) : null,
    };

    res.json({
      success: true,
      renames: results.movies,
      movies: results.movies,
      series: results.series,
      count: results.total,
      stats: results.stats,
      formatHints,
    });
  } catch (error) {
    console.error('Error previewing renames:', error);
    res.status(500).json({ error: error.message || 'Failed to preview renames' });
  }
};

/**
 * Apply a manual TMDB pick to one movie rename preview row
 */
exports.applyMovieTmdbMatch = async (req, res) => {
  try {
    const userId = req.userId;
    const { currentPath, movieFileFormat, tmdbId } = req.body;
    if (!currentPath || !movieFileFormat || !tmdbId) {
      return res.status(400).json({
        error: 'currentPath, movieFileFormat, and tmdbId are required',
      });
    }
    const { recomputeMovieRenameWithTmdb } = require('../services/fileRenamer');
    const row = await recomputeMovieRenameWithTmdb(
      userId,
      currentPath,
      movieFileFormat,
      Number(tmdbId),
    );
    res.json({ success: true, rename: row });
  } catch (error) {
    console.error('Error applying TMDB match for rename:', error);
    res.status(500).json({ error: error.message || 'Failed to apply TMDB match' });
  }
};

/**
 * Start a background rename batch (progress survives page reload).
 */
exports.startRenameBatch = async (req, res) => {
  try {
    const userId = req.userId;
    const { renames } = req.body;
    const { startBatch } = require('../services/renameBatchRunner');
    const batch = startBatch(userId, renames);
    res.json({ success: true, batch });
  } catch (error) {
    const status = error.code === 'BATCH_RUNNING' ? 409 : 400;
    res.status(status).json({ error: error.message || 'Failed to start rename batch' });
  }
};

exports.getRenameBatchStatus = async (req, res) => {
  const { getBatchStatus } = require('../services/renameBatchRunner');
  const batch = getBatchStatus(req.userId);
  res.json({ batch });
};

exports.dismissRenameBatch = async (req, res) => {
  const { dismissBatch } = require('../services/renameBatchRunner');
  const ok = dismissBatch(req.userId);
  if (!ok) {
    return res.status(409).json({ error: 'Batch is still running' });
  }
  res.json({ success: true });
};

/**
 * Execute file renames
 */
exports.executeRenames = async (req, res) => {
  try {
    const userId = req.userId;
    const { renames, type } = req.body; // type can be 'movies' or 'series'

    if (!renames || !Array.isArray(renames)) {
      return res.status(400).json({ error: 'Renames array is required' });
    }

    console.log(`✏️  Executing ${renames.length} ${type || 'file'} renames for user ${userId}`);

    let results;

    // Detect type from first item if not specified
    const actualType = type || (renames[0]?.seriesId ? 'series' : 'movies');

    if (actualType === 'series') {
      results = await executeSeriesRenames(userId, renames);
    } else {
      results = await executeMovieRenames(userId, renames);
    }

    const { recordActivitySafe, ActivityCategory } = require('../services/activityLogService');
    await recordActivitySafe(userId, {
      category: ActivityCategory.FILE_RENAME,
      action: `${actualType === 'series' ? 'series' : 'movie'}_batch_complete`,
      status:
        results.failed > 0
          ? results.success > 0
            ? 'info'
            : 'failure'
          : 'success',
      summary: `Rename batch (${actualType}): ${results.success} succeeded, ${results.failed} failed`,
      details: {
        type: actualType,
        requested: renames.length,
        success: results.success,
        failed: results.failed,
        errors: results.errors,
      },
    });

    res.json({
      success: true,
      results,
      message: `Renamed ${results.success} file(s). Failed: ${results.failed}`,
    });
  } catch (error) {
    console.error('Error executing renames:', error);
    res.status(500).json({ error: error.message || 'Failed to execute renames' });
  }
};

/**
 * Get auto-rename service status for user
 */
exports.getAutoRenameStatus = async (req, res) => {
  try {
    const userId = req.userId;
    const { getUserAutoRenameStatus } = getAutoRenameService();
    const status = getUserAutoRenameStatus(userId);
    
    res.json({
      success: true,
      ...status,
    });
  } catch (error) {
    console.error('Error getting auto-rename status:', error);
    res.status(500).json({ error: 'Failed to get auto-rename status' });
  }
};

/**
 * Trigger manual auto-rename run for user
 */
exports.triggerAutoRename = async (req, res) => {
  try {
    const userId = req.userId;
    
    console.log(`🔄 [Settings] Manual auto-rename trigger for user ${userId}`);
    
    const { triggerManualRun } = getAutoRenameService();
    const results = await triggerManualRun(userId);
    
    res.json({
      success: results.success,
      results: results.results,
      duration: results.duration,
      error: results.error,
    });
  } catch (error) {
    console.error('Error triggering auto-rename:', error);
    res.status(500).json({ error: error.message || 'Failed to trigger auto-rename' });
  }
};

/**
 * Get download watcher status for user
 */
exports.getDownloadWatcherStatus = async (req, res) => {
  try {
    const userId = req.userId;
    const { getWatcherStatus } = getDownloadWatcherService();
    const status = getWatcherStatus(userId);
    
    res.json({
      success: true,
      ...status,
    });
  } catch (error) {
    console.error('Error getting download watcher status:', error);
    res.status(500).json({ error: 'Failed to get download watcher status' });
  }
};

/**
 * Trigger manual download watcher scan for user
 */
exports.triggerDownloadWatcherScan = async (req, res) => {
  try {
    const userId = req.userId;

    console.log(`👁️ [Settings] Manual download watcher scan for user ${userId}`);

    const { triggerScan } = getDownloadWatcherService();
    const result = await triggerScan(userId, req.body || {});

    res.json(result);
  } catch (error) {
    console.error('Error triggering download watcher scan:', error);
    res.status(500).json({ error: error.message || 'Failed to trigger scan' });
  }
};

/**
 * Preview what the download watcher would move (dry run)
 */
exports.previewDownloadWatcher = async (req, res) => {
  try {
    const userId = req.userId;
    const { previewMoves } = getDownloadWatcherService();
    const result = await previewMoves(userId, req.body || {});
    res.json(result);
  } catch (error) {
    console.error('Error previewing download watcher:', error);
    res.status(500).json({ error: error.message || 'Failed to preview moves' });
  }
};

/**
 * Get pending files waiting for approval
 */
exports.getPendingFiles = async (req, res) => {
  try {
    const userId = req.userId;
    const { getPendingFiles } = getDownloadWatcherService();
    const files = getPendingFiles(userId);
    
    res.json({ success: true, files });
  } catch (error) {
    console.error('Error getting pending files:', error);
    res.status(500).json({ error: 'Failed to get pending files' });
  }
};

/**
 * Approve a pending file (move it)
 */
exports.approveFile = async (req, res) => {
  try {
    const userId = req.userId;
    const { fileId } = req.body;
    
    if (!fileId) {
      return res.status(400).json({ error: 'File ID is required' });
    }
    
    const { approveFile } = getDownloadWatcherService();
    const result = await approveFile(userId, fileId);
    
    res.json(result);
  } catch (error) {
    console.error('Error approving file:', error);
    res.status(500).json({ error: error.message || 'Failed to approve file' });
  }
};

/**
 * Reject a pending file (ignore it)
 */
exports.rejectFile = async (req, res) => {
  try {
    const userId = req.userId;
    const { fileId } = req.body;
    
    if (!fileId) {
      return res.status(400).json({ error: 'File ID is required' });
    }
    
    const { rejectFile } = getDownloadWatcherService();
    const result = await rejectFile(userId, fileId);
    
    res.json(result);
  } catch (error) {
    console.error('Error rejecting file:', error);
    res.status(500).json({ error: error.message || 'Failed to reject file' });
  }
};

/**
 * Scan media library for anomalies (starting with duplicate movies).
 */
exports.scanAnomalies = async (req, res) => {
  try {
    const userId = req.userId;
    const { isAnomalyScanInProgress } = getAnomalySchedulerService();
    if (isAnomalyScanInProgress(userId)) {
      return res.status(409).json({
        error: 'An automatic scan is already running. Cancel it or wait for it to finish.',
      });
    }

    const mediaType = req.body?.mediaType || 'movies';

    if (mediaType !== 'movies') {
      return res.status(400).json({
        error: 'Only movie duplicate detection is supported for now',
      });
    }

    const directoryPath = req.body?.directoryPath;
    if (!directoryPath) {
      return res.status(400).json({ error: 'directoryPath is required' });
    }

    const checkDuplicates = req.body?.checkDuplicates !== false;
    const checkCorruption = Boolean(req.body?.checkCorruption);
    const checkLargeFiles = Boolean(req.body?.checkLargeFiles);

    const result = await scanMovieAnomalies(userId, {
      directoryPath,
      checkDuplicates,
      checkCorruption,
      checkLargeFiles,
    });
    const { recordManualScanResult } = getAnomalySchedulerService();
    await recordManualScanResult(userId, result);
    res.json({ success: true, ...result });
  } catch (error) {
    if (
      error.code === 'NO_MEDIA_DIR' ||
      error.code === 'MEDIA_DIR_INACCESSIBLE' ||
      error.code === 'NO_CHECKS'
    ) {
      const { recordManualScanResult } = getAnomalySchedulerService();
      await recordManualScanResult(userId, null, error.message);
      return res.status(400).json({ error: error.message });
    }
    console.error('Error scanning anomalies:', error);
    const message = error.message || 'Failed to scan for anomalies';
    const { recordManualScanResult } = getAnomalySchedulerService();
    await recordManualScanResult(userId, null, message);
    res.status(500).json({ error: message });
  }
};

/**
 * Anomaly detector scheduler status (auto-scan logs).
 */
exports.getAnomalyDetectorStatus = async (req, res) => {
  try {
    const userId = req.userId;
    const { getAnomalyDetectorStatus } = getAnomalySchedulerService();
    res.json({ success: true, ...(await getAnomalyDetectorStatus(userId)) });
  } catch (error) {
    console.error('Error getting anomaly detector status:', error);
    res.status(500).json({ error: 'Failed to get anomaly detector status' });
  }
};

exports.cancelAnomalyScan = async (req, res) => {
  try {
    const userId = req.userId;
    const { requestCancelAnomalyScan } = getAnomalySchedulerService();
    const result = requestCancelAnomalyScan(userId);
    if (!result.success) {
      return res.status(409).json({ error: result.error });
    }
    res.json({ success: true, message: 'Cancellation requested' });
  } catch (error) {
    console.error('Error cancelling anomaly scan:', error);
    res.status(500).json({ error: 'Failed to cancel scan' });
  }
};

/**
 * Delete a duplicate media file from disk (under configured media directories).
 */
exports.deleteAnomalyMediaFile = async (req, res) => {
  try {
    const userId = req.userId;
    const { filePath, scanDirectory } = req.body;

    if (!filePath) {
      return res.status(400).json({ error: 'filePath is required' });
    }

    const result = await deleteDuplicateMediaFile(userId, filePath, {
      scanDirectory,
    });
    res.json(result);
  } catch (error) {
    if (
      error.code === 'INVALID_PATH' ||
      error.code === 'PATH_NOT_ALLOWED' ||
      error.code === 'NOT_A_FILE' ||
      error.code === 'ENOENT'
    ) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Error deleting anomaly media file:', error);
    res.status(500).json({ error: error.message || 'Failed to delete file' });
  }
};

