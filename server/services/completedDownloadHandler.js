/**
 * Completed Download Handling (CDH) — tracked downloads.
 *
 * 1. On grab, History stores client ID + metadata (see DownloadClients.grabRelease).
 * 2. This service polls download clients on an interval.
 * 3. Client API status determines downloading vs completed (not filesystem heuristics).
 * 4. Import runs as a separate step via completedDownloadImporter.
 */

const { Op } = require('sequelize');
const History = require('../models/History');
const Settings = require('../models/Settings');
const DownloadClients = require('../models/DownloadClients');
const { fetchClientDownloadItems } = require('./downloadClients/downloadClientPolling');
const { importCompletedDownload } = require('./completedDownloadImporter');

const ACTIVE_STATUSES = ['grabbed', 'downloading'];
const ITEM_CACHE = new Map();

let globalInterval = null;

function normalizeId(id) {
  return id ? String(id).toLowerCase().trim() : '';
}

function titleSimilarity(a, b) {
  const x = (a || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const y = (b || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!x || !y) return 0;
  if (x.includes(y.slice(0, Math.min(24, y.length))) || y.includes(x.slice(0, Math.min(24, x.length)))) {
    return 0.8;
  }
  return 0;
}

function findMatchingItem(history, items) {
  const targetId = normalizeId(history.downloadClientId);

  if (targetId && targetId !== 'success') {
    const byId = items.find((i) => normalizeId(i.id) === targetId);
    if (byId) return byId;
  }

  let best = null;
  let bestScore = 0;
  for (const item of items) {
    let score = titleSimilarity(history.releaseName, item.title);
    if (history.clientCategory && item.category && history.clientCategory === item.category) {
      score += 0.15;
    }
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }

  return bestScore >= 0.5 ? best : null;
}

async function loadClientForHistory(history) {
  if (history.downloadClientRecordId) {
    const client = await DownloadClients.findByPk(history.downloadClientRecordId);
    if (client) return client;
  }

  if (history.downloadClient) {
    return DownloadClients.findOne({
      where: { name: history.downloadClient, enabled: true },
    });
  }

  return null;
}

async function processTrackedEntry(history, userSettings) {
  if (!userSettings.completedDownloadHandlingEnabled) {
    return;
  }

  if (['imported', 'failed'].includes(history.importStatus) && history.status === 'imported') {
    return;
  }

  if (history.importStatus === 'imported') {
    return;
  }

  const client = await loadClientForHistory(history);
  if (!client) {
    console.warn(`[CDH] No download client for history #${history.id}`);
    return;
  }

  const cacheKey = `${client.id}`;
  let items = ITEM_CACHE.get(cacheKey);
  const cacheTs = ITEM_CACHE.get(`${cacheKey}:ts`);

  if (!items || !cacheTs || Date.now() - cacheTs > 5000) {
    try {
      items = await fetchClientDownloadItems(client.toJSON());
      ITEM_CACHE.set(cacheKey, items);
      ITEM_CACHE.set(`${cacheKey}:ts`, Date.now());
    } catch (err) {
      console.error(`[CDH] Poll failed for client ${client.name}:`, err.message);
      return;
    }
  }

  const item = findMatchingItem(history, items);

  if (!item) {
    if (history.status === 'grabbed') {
      const ageMs = Date.now() - new Date(history.createdAt).getTime();
      if (ageMs > 6 * 60 * 60 * 1000) {
        await history.update({
          status: 'failed',
          importStatus: 'failed',
          importError: 'Download not found in client after 6 hours',
        });
      }
    }
    return;
  }

  const updates = {
    downloadProgress: item.progress,
    outputPath: item.outputPath || history.outputPath,
  };

  if (item.status === 'failed') {
    updates.status = 'failed';
    updates.importStatus = 'failed';
    updates.importError = 'Download client reported failure';
    await history.update(updates);
    return;
  }

  if (!item.isComplete) {
    updates.status = 'downloading';
    await history.update(updates);
    return;
  }

  if (history.status === 'completed' || history.status === 'imported') {
    if (history.importStatus === 'importing') return;
    if (history.importStatus === 'pending' || history.importStatus === 'failed' || history.importStatus === 'blocked') {
      if (userSettings.completedDownloadHandlingImportEnabled !== false) {
        await history.update(updates);
        await runImport(history, userSettings);
      }
    }
    return;
  }

  updates.status = 'completed';
  updates.importStatus = 'pending';
  updates.importError = null;
  await history.update(updates);

  console.log(`[CDH] Download complete for history #${history.id}: ${item.title}`);

  if (userSettings.completedDownloadHandlingImportEnabled !== false) {
    await runImport(history, userSettings);
  }
}

async function runImport(historyRecord, userSettings) {
  const history = await History.findByPk(historyRecord.id);
  if (!history || history.importStatus === 'imported') return;

  await history.update({ importStatus: 'importing' });

  try {
    const result = await importCompletedDownload(history, userSettings);

    if (result.success) {
      await history.update({
        status: 'imported',
        importStatus: 'imported',
        importError: null,
        outputPath: result.importedPath || history.outputPath,
      });
      console.log(`[CDH] Imported history #${history.id} → ${result.importedPath} (${result.method})`);

      if (userSettings.completedDownloadRemoveFromClient) {
        await tryRemoveFromClient(history, userSettings);
      }
      return;
    }

    await history.update({
      importStatus: result.blocked ? 'blocked' : 'failed',
      importError: result.reason || 'Import failed',
      status: 'completed',
    });
    console.warn(`[CDH] Import blocked/failed #${history.id}: ${result.reason}`);
  } catch (err) {
    await history.update({
      importStatus: 'failed',
      importError: err.message,
      status: 'completed',
    });
    console.error(`[CDH] Import error #${history.id}:`, err.message);
  }
}

async function tryRemoveFromClient(history, userSettings) {
  if (history.protocol === 'torrent') {
    return;
  }
  const client = await loadClientForHistory(history);
  if (!client) return;

  try {
    const { getClientProxy } = require('./downloadClients/clientProxyFactory');
    const proxy = getClientProxy(client.implementation, client.settings || {});
    if (client.implementation === 'Sabnzbd' && proxy.makeRequest) {
      await proxy.makeRequest({
        mode: 'history',
        name: 'delete',
        value: history.downloadClientId,
      });
    } else if (client.implementation === 'Nzbget' && proxy.removeDownload) {
      await proxy.removeDownload(history.downloadClientId);
    }
  } catch (err) {
    console.warn(`[CDH] Could not remove completed download from client: ${err.message}`);
  }
}

async function refreshUserTrackedDownloads(userId) {
  const userSettings = await Settings.findOne({ where: { userId } });
  if (!userSettings?.completedDownloadHandlingEnabled) {
    return { processed: 0 };
  }

  const entries = await History.findAll({
    where: {
      userId,
      [Op.or]: [
        { status: { [Op.in]: ['grabbed', 'downloading'] } },
        {
          status: 'completed',
          importStatus: { [Op.in]: ['none', 'pending', 'importing', 'blocked', 'failed'] },
        },
      ],
    },
    order: [['createdAt', 'DESC']],
    limit: 200,
  });

  for (const entry of entries) {
    await processTrackedEntry(entry, userSettings);
  }

  return { processed: entries.length };
}

async function refreshAllTrackedDownloads() {
  const users = await Settings.findAll({
    where: { completedDownloadHandlingEnabled: true },
    attributes: ['userId'],
  });

  let total = 0;
  for (const row of users) {
    const { processed } = await refreshUserTrackedDownloads(row.userId);
    total += processed;
  }

  if (total > 0) {
    console.log(`[CDH] Refresh cycle processed ${total} tracked download(s)`);
  }
}

function getSchedulerIntervalSeconds() {
  return 60;
}

function startCompletedDownloadScheduler() {
  if (globalInterval) return;

  const tick = async () => {
    try {
      const settingsRows = await Settings.findAll({
        where: { completedDownloadHandlingEnabled: true },
      });

      for (const row of settingsRows) {
        const intervalSec = Math.max(30, row.completedDownloadCheckInterval || 60);
        const lastKey = `user:${row.userId}`;
        const lastRun = ITEM_CACHE.get(lastKey) || 0;
        if (Date.now() - lastRun < intervalSec * 1000) continue;

        ITEM_CACHE.set(lastKey, Date.now());
        await refreshUserTrackedDownloads(row.userId);
      }
    } catch (err) {
      console.error('[CDH] Scheduler error:', err.message);
    }
  };

  globalInterval = setInterval(tick, getSchedulerIntervalSeconds() * 1000);
  setTimeout(tick, 8000);
  console.log('[CDH] Completed download handling scheduler started');
}

async function triggerRefreshAfterGrab(userId) {
  try {
    const row = await Settings.findOne({ where: { userId } });
    if (!row?.completedDownloadHandlingEnabled) return;
  } catch {
    return;
  }
  setTimeout(() => {
    refreshUserTrackedDownloads(userId).catch((err) => {
      console.error('[CDH] Post-grab refresh failed:', err.message);
    });
  }, 3000);
}

module.exports = {
  startCompletedDownloadScheduler,
  refreshUserTrackedDownloads,
  refreshAllTrackedDownloads,
  triggerRefreshAfterGrab,
  runImport,
};