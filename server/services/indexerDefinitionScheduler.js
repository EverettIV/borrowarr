const { readState, syncDefinitions } = require('./indexerDefinitionSync');

let timer = null;
let started = false;

function clearTimer() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

function scheduleNext() {
  clearTimer();
  const state = readState();
  if (!state.enabled) return;

  const intervalMs = Math.max(1, Number(state.intervalHours) || 24) * 60 * 60 * 1000;
  const last = state.lastSuccessAt ? Date.parse(state.lastSuccessAt) : 0;
  const dueIn = Number.isFinite(last) && last > 0 ? Math.max(0, last + intervalMs - Date.now()) : 0;

  timer = setTimeout(async () => {
    try {
      const updated = await syncDefinitions();
      console.log(`[IndexerDefinitions] Updated ${updated.definitionCount} definitions from ${updated.sourceVersion}`);
    } catch (error) {
      console.error(`[IndexerDefinitions] Update failed: ${error.message}`);
    }
    scheduleNext();
  }, dueIn);
}

function startIndexerDefinitionScheduler() {
  if (started) {
    scheduleNext();
    return;
  }
  started = true;
  scheduleNext();
}

function refreshIndexerDefinitionScheduler() {
  if (!started) return;
  scheduleNext();
}

module.exports = {
  startIndexerDefinitionScheduler,
  refreshIndexerDefinitionScheduler,
};
