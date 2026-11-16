const User = require('../models/User');
const { normalizePosterUrl } = require('./tmdbImages');

function isMonitoringAdmin(user) {
  return Boolean(user?.permissions?.admin);
}

/**
 * Non-admins may only act on their own user id; admins may pass an explicit userId.
 */
function resolveMonitoredUserId(req, explicitUserId) {
  if (explicitUserId && explicitUserId !== req.userId) {
    if (isMonitoringAdmin(req.user)) {
      return explicitUserId;
    }
    return req.userId;
  }
  return req.userId;
}

/** @returns {boolean} true when the request was denied (response already sent) */
function denyUnlessOwnerOrAdmin(req, res, ownerUserId, message = 'Not authorized') {
  if (ownerUserId !== req.userId && !isMonitoringAdmin(req.user)) {
    res.status(403).json({ error: message });
    return true;
  }
  return false;
}

/** Strip userId from updates unless the actor is a monitoring admin. */
function applyMonitoredOwnerUpdates(req, updates) {
  const next = { ...updates };
  if (!isMonitoringAdmin(req.user)) {
    delete next.userId;
  }
  return next;
}

async function withOwnerUsernames(rows) {
  if (!rows?.length) {
    return [];
  }
  const userIds = [...new Set(rows.map((row) => row.userId))];
  const users = await User.findAll({
    where: { id: userIds },
    attributes: ['id', 'username'],
  });
  const nameById = new Map(users.map((u) => [u.id, u.username]));
  return rows.map((row) => {
    const plain = typeof row.toJSON === 'function' ? row.toJSON() : row;
    return {
      ...plain,
      posterUrl: normalizePosterUrl(plain.posterUrl),
      ownerUsername: nameById.get(plain.userId) || null,
    };
  });
}

module.exports = {
  isMonitoringAdmin,
  withOwnerUsernames,
  resolveMonitoredUserId,
  denyUnlessOwnerOrAdmin,
  applyMonitoredOwnerUpdates,
};