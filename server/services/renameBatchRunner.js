/**
 * Server-side rename batches so progress survives page reloads (in-memory per user).
 */

const path = require('path');
const { executeMovieRenames, executeSeriesRenames } = require('./fileRenamer');
const { recordActivitySafe, ActivityCategory } = require('./activityLogService');

/** @type {Map<string, object>} */
const jobsByUser = new Map();

const COMPLETE_TTL_MS = 10 * 60 * 1000;

function inferMediaKind(renames) {
  const hasMovie = renames.some(
    (r) => r.type === 'movie' || (r.movieId != null && !r.seriesId),
  );
  const hasSeries = renames.some((r) => r.type === 'series' || r.seriesId != null);
  if (hasSeries && !hasMovie) return 'series';
  return 'movies';
}

function isSeriesRename(item) {
  if (item.type === 'series') return true;
  if (item.type === 'movie') return false;
  return item.seriesId != null;
}

function snapshot(job) {
  return {
    status: job.status,
    mediaKind: job.mediaKind,
    total: job.total,
    done: job.done,
    success: job.success,
    failed: job.failed,
    activeNames: [...(job.activeNames || [])],
    startedAt: job.startedAt,
    finishedAt: job.finishedAt || null,
    error: job.error || null,
  };
}

function scheduleCleanup(userId) {
  setTimeout(() => {
    const job = jobsByUser.get(userId);
    if (job && job.status !== 'running' && job.finishedAt) {
      jobsByUser.delete(userId);
    }
  }, COMPLETE_TTL_MS);
}

function getBatchStatus(userId) {
  const job = jobsByUser.get(userId);
  if (!job) return null;
  return snapshot(job);
}

function dismissBatch(userId) {
  const job = jobsByUser.get(userId);
  if (!job) return true;
  if (job.status === 'running') {
    return false;
  }
  jobsByUser.delete(userId);
  return true;
}

async function runBatchJob(userId, job) {
  try {
    for (const rename of job.queue) {
      if (job.status !== 'running') break;

      const label = rename.currentName || path.basename(rename.currentPath || '');
      job.activeNames = [label];

      const isSeries = isSeriesRename(rename);
      const exec = isSeries ? executeSeriesRenames : executeMovieRenames;

      let result;
      try {
        result = await exec(userId, [rename]);
      } catch (err) {
        result = {
          success: 0,
          failed: 1,
          errors: [{ currentName: label, error: err.message }],
        };
      }

      if (result.success > 0) {
        job.success += 1;
      } else {
        job.failed += 1;
        if (rename.currentPath) {
          job.failedPaths.push(rename.currentPath);
        }
      }
      job.done += 1;
      job.activeNames = [];
    }

    job.status = 'complete';
    job.finishedAt = new Date().toISOString();

    await recordActivitySafe(userId, {
      category: ActivityCategory.FILE_RENAME,
      action: `${job.mediaKind === 'series' ? 'series' : 'movie'}_batch_complete`,
      status:
        job.failed > 0 ? (job.success > 0 ? 'info' : 'failure') : 'success',
      summary: `Rename batch (${job.mediaKind}): ${job.success} succeeded, ${job.failed} failed`,
      details: {
        type: job.mediaKind,
        requested: job.total,
        success: job.success,
        failed: job.failed,
      },
    });

    scheduleCleanup(userId);
  } catch (err) {
    job.status = 'failed';
    job.error = err.message || String(err);
    job.finishedAt = new Date().toISOString();
    scheduleCleanup(userId);
  }
}

function startBatch(userId, renames) {
  if (!Array.isArray(renames) || renames.length === 0) {
    throw new Error('Renames array is required');
  }

  const existing = jobsByUser.get(userId);
  if (existing?.status === 'running') {
    const err = new Error('A rename batch is already in progress');
    err.code = 'BATCH_RUNNING';
    throw err;
  }

  const mediaKind = inferMediaKind(renames);
  const job = {
    status: 'running',
    mediaKind,
    total: renames.length,
    done: 0,
    success: 0,
    failed: 0,
    activeNames: [],
    queue: renames,
    failedPaths: [],
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  };

  jobsByUser.set(userId, job);
  console.log(
    `✏️  Background rename batch: ${renames.length} files for user ${userId}`,
  );
  void runBatchJob(userId, job);

  return snapshot(job);
}

module.exports = {
  startBatch,
  getBatchStatus,
  dismissBatch,
};