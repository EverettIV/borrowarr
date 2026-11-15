const User = require('../models/User');
const { normalizePosterUrl } = require('./tmdbImages');

function isMonitoringAdmin(user) {
  return Boolean(user?.permissions?.admin);
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
};