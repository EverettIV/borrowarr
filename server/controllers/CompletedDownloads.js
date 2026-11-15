const { Op } = require('sequelize');
const History = require('../models/History');
const Settings = require('../models/Settings');
const {
  refreshUserTrackedDownloads,
  runImport,
} = require('../services/completedDownloadHandler');

exports.getStatus = async (req, res) => {
  try {
    const userId = req.userId;
    const settings = await Settings.findOne({ where: { userId } });

    const active = await History.count({
      where: {
        userId,
        status: { [Op.in]: ['grabbed', 'downloading'] },
      },
    });

    const awaitingImport = await History.count({
      where: {
        userId,
        status: 'completed',
        importStatus: { [Op.in]: ['pending', 'importing', 'blocked', 'failed'] },
      },
    });

    const recent = await History.findAll({
      where: { userId },
      order: [['updatedAt', 'DESC']],
      limit: 15,
      attributes: [
        'id', 'mediaTitle', 'releaseName', 'status', 'importStatus',
        'downloadProgress', 'outputPath', 'importError', 'updatedAt',
      ],
    });

    res.json({
      enabled: settings?.completedDownloadHandlingEnabled ?? true,
      importEnabled: settings?.completedDownloadHandlingImportEnabled ?? true,
      checkIntervalSeconds: settings?.completedDownloadCheckInterval ?? 60,
      importMode: settings?.completedDownloadImportMode ?? 'hardlink',
      activeDownloads: active,
      awaitingImport,
      recentTracked: recent,
    });
  } catch (error) {
    console.error('[CDH] getStatus error:', error);
    res.status(500).json({ error: 'Failed to get completed download status' });
  }
};

exports.refresh = async (req, res) => {
  try {
    const result = await refreshUserTrackedDownloads(req.userId);
    res.json({
      success: true,
      message: 'Tracked downloads refreshed from download clients',
      ...result,
    });
  } catch (error) {
    console.error('[CDH] refresh error:', error);
    res.status(500).json({ error: error.message || 'Refresh failed' });
  }
};

exports.retryImport = async (req, res) => {
  try {
    const userId = req.userId;
    const historyId = req.params.id;

    const history = await History.findOne({ where: { id: historyId, userId } });
    if (!history) {
      return res.status(404).json({ error: 'History entry not found' });
    }

    if (history.status !== 'completed' && history.status !== 'imported') {
      return res.status(400).json({ error: 'Download is not complete yet' });
    }

    const settings = await Settings.findOne({ where: { userId } });
    if (!settings) {
      return res.status(400).json({ error: 'User settings not found' });
    }

    await history.update({
      importStatus: 'pending',
      importError: null,
      status: 'completed',
    });

    await runImport(history, settings);
    await history.reload();

    res.json({
      success: history.importStatus === 'imported',
      history,
    });
  } catch (error) {
    console.error('[CDH] retryImport error:', error);
    res.status(500).json({ error: error.message || 'Import retry failed' });
  }
};