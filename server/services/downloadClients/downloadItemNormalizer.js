/**
 * Normalizes download client API responses into a DownloadClientItem.
 *
 * @typedef {Object} NormalizedDownloadItem
 * @property {string} id - Client-specific download ID
 * @property {string} title
 * @property {string|null} category
 * @property {'downloading'|'completed'|'failed'|'queued'|'unknown'} status
 * @property {number} progress - 0..1
 * @property {string|null} outputPath - Folder or file path when known
 * @property {number|null} totalSize
 * @property {boolean} isComplete
 * @property {boolean} canMoveFiles
 */

const path = require('path');

function normalizeQBittorrent(torrents) {
  if (!Array.isArray(torrents)) return [];
  return torrents.map((t) => {
    const progress = typeof t.progress === 'number' ? t.progress : 0;
    const state = (t.state || '').toLowerCase();
    const failedStates = ['error', 'missingfiles'];
    const completeStates = ['uploading', 'stalledup', 'pausedup', 'queuedup', 'forcedup', 'stoppedup', 'moving'];
    const isComplete = progress >= 1 && (completeStates.includes(state) || !failedStates.includes(state));
    const isFailed = failedStates.includes(state);

    let status = 'downloading';
    if (isFailed) status = 'failed';
    else if (isComplete) status = 'completed';
    else if (progress <= 0 && state.includes('queued')) status = 'queued';

    const outputPath = t.content_path || (t.save_path && t.name ? path.join(t.save_path, t.name) : t.save_path || null);

    return {
      id: (t.hash || '').toLowerCase(),
      title: t.name || '',
      category: t.category || null,
      status,
      progress,
      outputPath,
      totalSize: t.size || null,
      isComplete: isComplete && !isFailed,
      canMoveFiles: true,
    };
  });
}

function normalizeTransmission(torrents) {
  if (!Array.isArray(torrents)) return [];
  return torrents.map((t) => {
    const progress = typeof t.percentDone === 'number' ? t.percentDone : 0;
    const isComplete = t.isFinished === true || progress >= 1;
    const status = isComplete ? 'completed' : 'downloading';
    const outputPath = t.downloadDir && t.name ? path.join(t.downloadDir, t.name) : t.downloadDir || null;

    return {
      id: (t.hashString || String(t.id)).toLowerCase(),
      title: t.name || '',
      category: null,
      status,
      progress,
      outputPath,
      totalSize: t.totalSize || null,
      isComplete,
      canMoveFiles: true,
    };
  });
}

function normalizeDeluge(torrents) {
  if (!Array.isArray(torrents)) return [];
  return torrents.map((t) => {
    const progress = typeof t.progress === 'number' ? t.progress : 0;
    const state = (t.state || '').toLowerCase();
    const isComplete = t.is_finished === true || progress >= 100 || state === 'seeding';
    const isFailed = state === 'failed';

    let status = 'downloading';
    if (isFailed) status = 'failed';
    else if (isComplete) status = 'completed';

    const outputPath = t.save_path && t.name ? path.join(t.save_path, t.name) : t.save_path || null;

    return {
      id: (t.hash || '').toLowerCase(),
      title: t.name || '',
      category: null,
      status,
      progress: progress > 1 ? progress / 100 : progress,
      outputPath,
      totalSize: t.total_size || null,
      isComplete: isComplete && !isFailed,
      canMoveFiles: true,
    };
  });
}

function normalizeSabnzbd(queueData, historyData) {
  const items = [];

  const queueSlots = queueData?.queue?.slots || queueData?.slots || [];
  for (const slot of queueSlots) {
    const progress = slot.percentage ? slot.percentage / 100 : 0;
    items.push({
      id: slot.nzo_id,
      title: slot.filename || slot.name || '',
      category: slot.cat || null,
      status: progress >= 1 ? 'completed' : 'downloading',
      progress,
      outputPath: slot.storage ? path.join(slot.storage, slot.filename || '') : null,
      totalSize: slot.mb ? slot.mb * 1024 * 1024 : null,
      isComplete: false,
      canMoveFiles: false,
    });
  }

  const historySlots = historyData?.history?.slots || historyData?.slots || [];
  for (const slot of historySlots) {
    const statusRaw = (slot.status || '').toLowerCase();
    const isComplete = statusRaw === 'completed';
    const isFailed = statusRaw === 'failed' || statusRaw === 'failed';

    items.push({
      id: slot.nzo_id,
      title: slot.name || slot.filename || '',
      category: slot.category || slot.cat || null,
      status: isFailed ? 'failed' : isComplete ? 'completed' : 'unknown',
      progress: isComplete ? 1 : 0,
      outputPath: slot.storage || null,
      totalSize: slot.bytes ? parseInt(slot.bytes, 10) : null,
      isComplete,
      canMoveFiles: isComplete,
    });
  }

  return items;
}

function normalizeNzbget(queueGroups, historyRecords) {
  const items = [];

  if (Array.isArray(queueGroups)) {
    for (const group of queueGroups) {
      const progress = typeof group.Percent === 'number' ? group.Percent / 100 : 0;
      items.push({
        id: String(group.LastID || group.NZBID || group.NZBName),
        title: group.NZBName || '',
        category: group.Category || null,
        status: 'downloading',
        progress,
        outputPath: group.DestDir || null,
        totalSize: group.FileSize || null,
        isComplete: false,
        canMoveFiles: false,
      });
    }
  }

  const records = Array.isArray(historyRecords)
    ? historyRecords
    : historyRecords?.History || historyRecords?.history || [];

  if (Array.isArray(records)) {
    for (const record of records) {
      const status = record.Status || record.ParStatus || '';
      const statusLower = String(status).toLowerCase();
      const isComplete = statusLower.includes('success') || record.Health === 1000;
      const isFailed = statusLower.includes('failure') || statusLower.includes('error');

      items.push({
        id: String(record.NZBID || record.ID),
        title: record.Name || record.Name || '',
        category: record.Category || null,
        status: isFailed ? 'failed' : isComplete ? 'completed' : 'unknown',
        progress: isComplete ? 1 : 0,
        outputPath: record.DestDir || null,
        totalSize: record.FileSize || record.FileSizeMB * 1024 * 1024 || null,
        isComplete,
        canMoveFiles: isComplete,
      });
    }
  }

  return items;
}

module.exports = {
  normalizeQBittorrent,
  normalizeTransmission,
  normalizeDeluge,
  normalizeSabnzbd,
  normalizeNzbget,
};