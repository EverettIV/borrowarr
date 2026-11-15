const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/Settings');
const { authenticateToken } = require('../middleware/auth');

// Public route - no authentication required
router.get('/public-registration-status', settingsController.getPublicRegistrationStatus);

// All routes below require authentication
router.use(authenticateToken);

// Get user settings
router.get('/', settingsController.getSettings);

// Update user settings
router.put('/', settingsController.updateSettings);

// Test directory access
router.post('/test-directory', settingsController.testDirectory);

// Browse directories (for directory picker)
router.get('/browse', settingsController.browseDirectories);

// Import movies from directory
router.post('/import-movies', settingsController.importMovies);

// Import series from directory
router.post('/import-series', settingsController.importSeries);

// Preview file renames
router.post('/preview-renames', settingsController.previewRenames);

// Manual TMDB match for one preview row
router.post('/rename-apply-tmdb', settingsController.applyMovieTmdbMatch);

// Execute file renames
router.post('/execute-renames', settingsController.executeRenames);

// Background rename batch (resumable progress)
router.post('/rename-batch/start', settingsController.startRenameBatch);
router.get('/rename-batch/status', settingsController.getRenameBatchStatus);
router.post('/rename-batch/dismiss', settingsController.dismissRenameBatch);

// Auto-rename service status
router.get('/auto-rename/status', settingsController.getAutoRenameStatus);

// Trigger manual auto-rename
router.post('/auto-rename/trigger', settingsController.triggerAutoRename);

// Download watcher status
router.get('/download-watcher/status', settingsController.getDownloadWatcherStatus);

// Trigger manual download watcher scan
router.post('/download-watcher/trigger', settingsController.triggerDownloadWatcherScan);

// Preview moves without changing files (dry run)
router.post('/download-watcher/preview', settingsController.previewDownloadWatcher);

// Get pending files for manual approval
router.get('/download-watcher/pending', settingsController.getPendingFiles);

// Approve a pending file
router.post('/download-watcher/approve', settingsController.approveFile);

// Reject a pending file
router.post('/download-watcher/reject', settingsController.rejectFile);

// Anomaly detector (library health)
router.get('/anomaly-detector/status', settingsController.getAnomalyDetectorStatus);
router.post('/anomaly-detector/scan', settingsController.scanAnomalies);
router.post('/anomaly-detector/cancel', settingsController.cancelAnomalyScan);
router.post('/anomaly-detector/delete', settingsController.deleteAnomalyMediaFile);

module.exports = router;
