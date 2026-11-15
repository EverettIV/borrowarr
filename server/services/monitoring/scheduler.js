const MonitoredMovies = require('../../models/MonitoredMovies');
const MonitoredSeries = require('../../models/MonitoredSeries');
const Settings = require('../../models/Settings');
const { runUserMonitoringCycle } = require('./cycle');

const userSchedulers = new Map();
const scheduledUserIds = new Set();

async function getUserCheckInterval(userId) {
  try {
    const settings = await Settings.findOne({ where: { userId } });
    const intervalSeconds = settings?.checkInterval ?? 300;
    return intervalSeconds * 1000;
  } catch (error) {
    console.error(`[Monitoring] Error getting check interval for user ${userId}:`, error);
    return 300 * 1000;
  }
}

async function ensureUserScheduled(userId) {
  if (!userId) return;
  if (scheduledUserIds.has(userId) && userSchedulers.has(userId)) {
    return;
  }
  await scheduleUserMonitoring(userId);
}

async function scheduleUserMonitoring(userId) {
  if (userSchedulers.has(userId)) {
    clearTimeout(userSchedulers.get(userId));
  }

  const intervalMs = await getUserCheckInterval(userId);
  const intervalSeconds = intervalMs / 1000;
  console.log(`[Monitoring] Scheduling user ${userId} every ${intervalSeconds}s`);

  const timerId = setTimeout(async () => {
    try {
      console.log(`🔄 [Monitoring] Scheduled cycle for user ${userId}`);
      await runUserMonitoringCycle(userId);
      console.log(`✅ [Monitoring] Scheduled cycle complete for user ${userId}`);
    } catch (error) {
      console.error(`[Monitoring] Scheduled cycle error for user ${userId}:`, error);
    }
    scheduleUserMonitoring(userId);
  }, intervalMs);

  userSchedulers.set(userId, timerId);
  scheduledUserIds.add(userId);
}

function startMonitoringScheduler() {
  console.log('🔄 [Monitoring] Starting monitoring scheduler...');

  setTimeout(async () => {
    try {
      const movies = await MonitoredMovies.findAll({ attributes: ['userId'], group: ['userId'] });
      const series = await MonitoredSeries.findAll({ attributes: ['userId'], group: ['userId'] });
      const userIdSet = new Set([
        ...movies.map((m) => m.userId),
        ...series.map((s) => s.userId),
      ]);
      const userIds = Array.from(userIdSet);
      console.log(`[Monitoring] Found ${userIds.length} users with monitored content`);

      for (const userId of userIds) {
        try {
          console.log(`🔄 [Monitoring] Initial cycle for user ${userId}`);
          await runUserMonitoringCycle(userId);
          await scheduleUserMonitoring(userId);
        } catch (error) {
          console.error(`[Monitoring] Initial cycle error for user ${userId}:`, error);
        }
        await new Promise((r) => setTimeout(r, 2000));
      }

      console.log('✅ [Monitoring] Monitoring scheduler started');
    } catch (error) {
      console.error('[Monitoring] Error starting monitoring scheduler:', error);
    }
  }, 10000);
}

async function triggerUserCheck(userId, options = {}) {
  console.log(`🔄 [Monitoring] Triggered cycle for user ${userId}`);
  const results = await runUserMonitoringCycle(userId, options);
  await ensureUserScheduled(userId);
  return results;
}

module.exports = {
  ensureUserScheduled,
  scheduleUserMonitoring,
  startMonitoringScheduler,
  triggerUserCheck,
  getUserCheckInterval,
};