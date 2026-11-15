const { recordActivitySafe, ActivityCategory } = require('../activityLogService');

/**
 * Persist monitoring events to the shared ActivityLog store.
 */
async function logMonitoring(userId, { action, status = 'info', summary, details }) {
  if (!userId || !action || !summary) return;
  await recordActivitySafe(userId, {
    category: ActivityCategory.MONITORING,
    action,
    status,
    summary,
    details,
  });
}

module.exports = { logMonitoring };