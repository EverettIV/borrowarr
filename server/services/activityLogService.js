const { Op } = require('sequelize');
const ActivityLog = require('../models/ActivityLog');

/** Add new categories here as features gain logging. */
const ActivityCategory = {
  FILE_RENAME: 'file_rename',
  ANOMALY_DETECTOR: 'anomaly_detector',
  WATCH_AND_MOVE: 'watch_and_move',
  INDEXER_DEFINITIONS: 'indexer_definitions',
  MONITORING: 'monitoring',
};

function serializeDetails(details) {
  if (details == null) return null;
  try {
    return JSON.stringify(details);
  } catch {
    return JSON.stringify({ raw: String(details) });
  }
}

function parseDetails(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

/**
 * Record one activity row (safe to call fire-and-forget from other services).
 */
async function recordActivity(userId, { category, action, status, summary, details }) {
  if (!userId || !category || !action || !summary) {
    throw new Error('recordActivity: missing userId, category, action, or summary');
  }
  return ActivityLog.create({
    userId,
    category,
    action,
    status: status || 'info',
    summary,
    details: serializeDetails(details),
  });
}

async function recordActivitySafe(userId, payload) {
  try {
    return await recordActivity(userId, payload);
  } catch (err) {
    console.warn('[activityLog] write failed:', err.message);
    return null;
  }
}

async function listActivities(userId, options = {}) {
  const {
    category,
    action,
    actionPrefix,
    status,
    search,
    page = 1,
    limit = 50,
    sortBy = 'createdAt',
    sortDir = 'DESC',
  } = options;

  const where = {};
  if (userId) {
    where.userId = userId;
  }
  if (category) where.category = category;
  if (action) {
    where.action = action;
  } else if (actionPrefix && String(actionPrefix).trim()) {
    where.action = { [Op.like]: `${String(actionPrefix).trim()}%` };
  }
  if (status) where.status = status;

  if (search && String(search).trim()) {
    const q = `%${String(search).trim()}%`;
    where[Op.or] = [
      { summary: { [Op.like]: q } },
      { details: { [Op.like]: q } },
      { action: { [Op.like]: q } },
    ];
  }

  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const offset = (safePage - 1) * safeLimit;

  const orderField = ['createdAt', 'category', 'action', 'status'].includes(sortBy)
    ? sortBy
    : 'createdAt';
  const orderDir = sortDir === 'ASC' ? 'ASC' : 'DESC';

  const { rows, count } = await ActivityLog.findAndCountAll({
    where,
    order: [[orderField, orderDir]],
    limit: safeLimit,
    offset,
  });

  return {
    data: rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      category: row.category,
      action: row.action,
      status: row.status,
      summary: row.summary,
      details: parseDetails(row.details),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
    total: count,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.ceil(count / safeLimit) || 1,
  };
}

module.exports = {
  ActivityCategory,
  recordActivity,
  recordActivitySafe,
  listActivities,
  parseDetails,
};