const Settings = require('../models/Settings');
const { scanMovieAnomalies } = require('./anomalyDetector');
const {
  recordActivitySafe,
  ActivityCategory,
  listActivities,
} = require('./activityLogService');

const userTimers = new Map();
const userScanning = new Set();
const userCancelRequested = new Set();

const MIN_INTERVAL_SEC = 60;

function resolveScanDirectory(settings) {
  const key = settings.anomalyDetectorScanDirKey || 'movieMedia';
  if (key === 'custom') {
    return settings.anomalyDetectorCustomScanPath || null;
  }
  const map = {
    movieMedia: settings.movieWatcherDestination,
    movieDownload: settings.movieDownloadDirectory,
    seriesMedia: settings.seriesWatcherDestination,
    seriesDownload: settings.seriesDownloadDirectory,
  };
  return map[key] || null;
}

function hasAnyCheck(settings) {
  return (
    settings.anomalyDetectorCheckDuplicates !== false ||
    Boolean(settings.anomalyDetectorCheckCorruption) ||
    Boolean(settings.anomalyDetectorCheckLargeFiles)
  );
}

function buildHighlights(result) {
  const lines = [];
  const summary = result.summary || {};

  if (summary.duplicateGroups > 0) {
    lines.push(
      `${summary.duplicateGroups} duplicate title${summary.duplicateGroups === 1 ? '' : 's'}`,
    );
  }
  if (summary.corruptedFiles > 0) {
    lines.push(
      `${summary.corruptedFiles} corrupt file${summary.corruptedFiles === 1 ? '' : 's'}`,
    );
  }
  if (summary.largeFiles > 0) {
    lines.push(
      `${summary.largeFiles} large file${summary.largeFiles === 1 ? '' : 's'} (10 GB+)`,
    );
  }

  for (const group of (result.anomalies || []).slice(0, 4)) {
    lines.push(
      `Duplicate: ${group.title}${group.year != null ? ` (${group.year})` : ''} — ${group.files.length} copies`,
    );
  }
  for (const file of (result.largeFiles || []).slice(0, 4)) {
    lines.push(`Large: ${file.fileName} (${file.sizeFormatted})`);
  }
  for (const file of (result.corruptFiles || []).slice(0, 4)) {
    lines.push(`Corrupt: ${file.fileName}`);
  }

  if (lines.length === 0) {
    lines.push(`Scanned ${summary.filesScanned ?? 0} files — no issues for selected checks`);
  }

  return lines.slice(0, 15);
}

async function saveScanActivity(userId, entry) {
  const trigger = entry.trigger || 'manual';
  const cancelled = entry.highlights?.[0] === 'Scan cancelled';
  const hasError = Boolean(entry.error);

  let action = `${trigger}_scan_complete`;
  let status = 'success';
  if (cancelled) {
    action = `${trigger}_scan_cancelled`;
    status = 'info';
  } else if (hasError) {
    action = `${trigger}_scan_failed`;
    status = 'failure';
  }

  const summary =
    entry.highlights?.[0] || entry.error || 'Anomaly library scan finished';

  await recordActivitySafe(userId, {
    category: ActivityCategory.ANOMALY_DETECTOR,
    action,
    status,
    summary,
    details: {
      trigger,
      scannedAt: entry.scannedAt,
      mediaDirectory: entry.mediaDirectory ?? null,
      summary: entry.summary ?? null,
      highlights: entry.highlights ?? [],
      error: entry.error ?? null,
    },
  });
}

async function executeScan(userId, trigger = 'scheduled') {
  if (userScanning.has(userId)) {
    return { skipped: true, reason: 'scan_in_progress' };
  }

  userScanning.add(userId);
  const scannedAt = new Date().toISOString();

  try {
    const settings = await Settings.findOne({ where: { userId } });
    if (!settings) {
      throw new Error('Settings not found');
    }

    const row = settings.toJSON();
    const directoryPath = resolveScanDirectory(row);
    if (!directoryPath) {
      throw new Error('No scan folder configured');
    }

    const checkDuplicates = row.anomalyDetectorCheckDuplicates !== false;
    const checkCorruption = Boolean(row.anomalyDetectorCheckCorruption);
    const checkLargeFiles = Boolean(row.anomalyDetectorCheckLargeFiles);

    if (!checkDuplicates && !checkCorruption && !checkLargeFiles) {
      throw new Error('Enable at least one check');
    }

    const result = await scanMovieAnomalies(userId, {
      directoryPath,
      checkDuplicates,
      checkCorruption,
      checkLargeFiles,
      shouldAbort: () => userCancelRequested.has(userId),
    });

    const entry = {
      scannedAt: result.scannedAt || scannedAt,
      trigger,
      mediaDirectory: result.mediaDirectory,
      summary: result.summary,
      highlights: buildHighlights(result),
      error: null,
    };

    await saveScanActivity(userId, entry);
    console.log(
      `[AnomalyScheduler] ${trigger} scan user ${userId}: ${entry.highlights[0]}`,
    );
    return { success: true, entry };
  } catch (err) {
    if (err.code === 'SCAN_CANCELLED') {
      const entry = {
        scannedAt,
        trigger,
        mediaDirectory: null,
        summary: null,
        highlights: ['Scan cancelled'],
        error: null,
      };
      await saveScanActivity(userId, entry);
      console.log(`[AnomalyScheduler] Scan cancelled for user ${userId}`);
      return { success: false, cancelled: true, entry };
    }

    const message = err.message || 'Scan failed';
    const entry = {
      scannedAt,
      trigger,
      mediaDirectory: null,
      summary: null,
      highlights: [message],
      error: message,
    };
    await saveScanActivity(userId, entry);
    console.error(`[AnomalyScheduler] Scan failed for user ${userId}:`, message);
    return { success: false, error: message, entry };
  } finally {
    userCancelRequested.delete(userId);
    userScanning.delete(userId);
  }
}

function stopScheduler(userId) {
  const timer = userTimers.get(userId);
  if (timer) {
    clearInterval(timer);
  }
  userTimers.delete(userId);
}

function startScheduler(userId, settings) {
  stopScheduler(userId);
  const intervalSec = Math.max(
    MIN_INTERVAL_SEC,
    settings.anomalyDetectorScanInterval || 1800,
  );
  const timer = setInterval(() => {
    void executeScan(userId, 'scheduled');
  }, intervalSec * 1000);
  userTimers.set(userId, timer);
  console.log(
    `[AnomalyScheduler] Started for user ${userId} every ${intervalSec}s`,
  );
}

function updateAnomalyScheduler(userId, settings) {
  const enabled = Boolean(settings.anomalyDetectorAutoScanEnabled);
  const directoryPath = resolveScanDirectory(settings);

  if (enabled && hasAnyCheck(settings) && directoryPath) {
    startScheduler(userId, settings);
  } else {
    stopScheduler(userId);
  }
}

async function initializeAllAnomalySchedulers() {
  try {
    const rows = await Settings.findAll({
      where: { anomalyDetectorAutoScanEnabled: true },
    });
    let started = 0;
    for (const row of rows) {
      const json = row.toJSON();
      if (hasAnyCheck(json) && resolveScanDirectory(json)) {
        updateAnomalyScheduler(row.userId, json);
        started += 1;
      }
    }
    console.log(
      `[AnomalyScheduler] Initialized ${started} scheduler(s) (${rows.length} enabled in settings)`,
    );
  } catch (err) {
    console.error('[AnomalyScheduler] Init error:', err);
  }
}

async function getAnomalyDetectorStatus(userId) {
  let lastRun = null;
  let lastError = null;

  try {
    const { data } = await listActivities(userId, {
      category: ActivityCategory.ANOMALY_DETECTOR,
      limit: 1,
      page: 1,
    });
    const latest = data[0];
    if (latest) {
      lastRun = latest.createdAt;
      if (latest.status === 'failure') {
        lastError = latest.details?.error || latest.summary;
      }
    }
  } catch (err) {
    console.warn('[AnomalyScheduler] Could not load activity log:', err.message);
  }

  return {
    isScheduled: userTimers.has(userId),
    scanInProgress: userScanning.has(userId),
    cancelRequested: userCancelRequested.has(userId),
    lastRun,
    lastError,
  };
}

function requestCancelAnomalyScan(userId) {
  if (!userScanning.has(userId)) {
    return { success: false, error: 'No scan is running' };
  }
  userCancelRequested.add(userId);
  return { success: true };
}

function isAnomalyScanInProgress(userId) {
  return userScanning.has(userId);
}

async function recordManualScanResult(userId, result, errorMessage) {
  const scannedAt = result?.scannedAt || new Date().toISOString();
  if (errorMessage) {
    const entry = {
      scannedAt,
      trigger: 'manual',
      mediaDirectory: null,
      summary: null,
      highlights: [errorMessage],
      error: errorMessage,
    };
    await saveScanActivity(userId, entry);
    return;
  }

  const entry = {
    scannedAt,
    trigger: 'manual',
    mediaDirectory: result.mediaDirectory,
    summary: result.summary,
    highlights: buildHighlights(result),
    error: null,
  };
  await saveScanActivity(userId, entry);
}

module.exports = {
  executeScan,
  updateAnomalyScheduler,
  initializeAllAnomalySchedulers,
  getAnomalyDetectorStatus,
  recordManualScanResult,
  requestCancelAnomalyScan,
  isAnomalyScanInProgress,
};