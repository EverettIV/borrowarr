/**
 * Replace the local Cardigann YAML set with the active definitions
 * from https://github.com/Prowlarr/Indexers
 */

const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { getCardigannEngine } = require('../cardigann');

const execFileAsync = promisify(execFile);

const REPO = 'Prowlarr/Indexers';
const ARCHIVE_URL = `https://codeload.github.com/${REPO}/tar.gz/refs/heads/master`;
const COMMIT_URL = `https://api.github.com/repos/${REPO}/commits/master`;
const DEFINITIONS_DIR = path.join(__dirname, '../cardigann-indexer-yamls');
const STATE_PATH = path.join(__dirname, '../data/indexerDefinitionSync.json');
const TESTS_PATH = path.join(__dirname, '../data/indexerDefinitionTests.json');
const LOCK_PATH = path.join(__dirname, '../data/indexerDefinitionSync.lock');
const MIN_DEFINITIONS = 100;

const DEFAULT_STATE = {
  enabled: true,
  intervalHours: 24,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null,
  definitionCount: 0,
  failedCount: 0,
  failures: [],
  sourceRepo: REPO,
  sourceRef: 'master',
  sourceVersion: null,
  sourceCommit: null,
};

function readState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    return { ...DEFAULT_STATE, ...parsed, sourceRepo: REPO };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function writeState(next) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  const state = { ...DEFAULT_STATE, ...next, sourceRepo: REPO };
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  return state;
}

function updateSettings({ enabled, intervalHours }) {
  const current = readState();
  const next = { ...current };
  if (enabled !== undefined) next.enabled = Boolean(enabled);
  if (intervalHours !== undefined) {
    const hours = Number(intervalHours);
    if (!Number.isFinite(hours) || hours < 1 || hours > 24 * 30) {
      throw new Error('Update interval must be between 1 hour and 30 days');
    }
    next.intervalHours = Math.round(hours);
  }
  return writeState(next);
}

function acquireLock() {
  fs.mkdirSync(path.dirname(LOCK_PATH), { recursive: true });
  if (fs.existsSync(LOCK_PATH)) {
    const age = Date.now() - fs.statSync(LOCK_PATH).mtimeMs;
    if (age < 10 * 60 * 1000) {
      throw new Error('An indexer definition update is already running');
    }
  }
  fs.writeFileSync(LOCK_PATH, String(process.pid));
}

function releaseLock() {
  fs.rmSync(LOCK_PATH, { force: true });
}

async function downloadArchive(destination) {
  const response = await fetch(ARCHIVE_URL, {
    headers: { 'User-Agent': 'Borrowarr' },
    redirect: 'follow',
  });
  if (!response.ok || !response.body) {
    throw new Error(`GitHub archive download failed (${response.status})`);
  }
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destination));
}

async function lookupCommit() {
  try {
    const response = await fetch(COMMIT_URL, {
      headers: {
        'User-Agent': 'Borrowarr',
        Accept: 'application/vnd.github+json',
      },
    });
    if (!response.ok) return null;
    const body = await response.json();
    return body.sha || null;
  } catch {
    return null;
  }
}

function findDefinitionDir(extractedRoot) {
  const entries = fs.readdirSync(extractedRoot, { withFileTypes: true });
  const top = entries.find((entry) => entry.isDirectory());
  if (!top) throw new Error('The downloaded archive had no repository folder');
  const definitionsRoot = path.join(extractedRoot, top.name, 'definitions');
  if (!fs.existsSync(definitionsRoot)) {
    throw new Error('The downloaded archive has no definitions folder');
  }

  const versions = fs.readdirSync(definitionsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^v\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));

  const preferred = versions.includes('v11') ? 'v11' : versions[versions.length - 1];
  if (!preferred) throw new Error('The downloaded archive has no versioned definitions');

  const dir = path.join(definitionsRoot, preferred);
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'));
  if (files.length < MIN_DEFINITIONS) {
    throw new Error(`definitions/${preferred} only contained ${files.length} YAML files`);
  }
  return { dir, version: preferred, files };
}

function replaceDefinitions(sourceDir, files) {
  fs.mkdirSync(DEFINITIONS_DIR, { recursive: true });
  for (const name of fs.readdirSync(DEFINITIONS_DIR)) {
    if (name.endsWith('.yml') || name.endsWith('.yaml')) {
      fs.rmSync(path.join(DEFINITIONS_DIR, name));
    }
  }
  for (const name of files) {
    fs.copyFileSync(path.join(sourceDir, name), path.join(DEFINITIONS_DIR, name));
  }
}

async function syncDefinitions() {
  acquireLock();
  const tempRoot = fs.mkdtempSync(path.join(require('os').tmpdir(), 'borrowarr-indexers-'));
  const archivePath = path.join(tempRoot, 'indexers.tar.gz');
  writeState({ ...readState(), lastAttemptAt: new Date().toISOString(), lastError: null });

  try {
    await downloadArchive(archivePath);
    const extracted = path.join(tempRoot, 'extracted');
    fs.mkdirSync(extracted);
    await execFileAsync('tar', ['-xzf', archivePath, '-C', extracted]);

    const { dir, version, files } = findDefinitionDir(extracted);
    replaceDefinitions(dir, files);
    const commit = await lookupCommit();

    const engine = getCardigannEngine(DEFINITIONS_DIR);
    const loaded = engine.reload() || engine.loader.lastLoad || { loaded: files.length, failed: 0, failures: [] };

    return writeState({
      ...readState(),
      lastSuccessAt: new Date().toISOString(),
      lastError: null,
      definitionCount: loaded.loaded,
      failedCount: loaded.failed,
      failures: (loaded.failures || []).slice(0, 20),
      sourceVersion: version,
      sourceCommit: commit,
    });
  } catch (error) {
    writeState({ ...readState(), lastError: error.message });
    throw error;
  } finally {
    releaseLock();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function readTests() {
  try {
    const parsed = JSON.parse(fs.readFileSync(TESTS_PATH, 'utf8'));
    return { testedAt: null, query: 'ubuntu', byId: {}, ...parsed };
  } catch {
    return { testedAt: null, query: 'ubuntu', byId: {} };
  }
}

function writeTests(tests) {
  fs.mkdirSync(path.dirname(TESTS_PATH), { recursive: true });
  fs.writeFileSync(TESTS_PATH, JSON.stringify(tests));
}

function credentialKind(fields) {
  if (fields.some((field) => field.kind === 'apikey')) return 'apikey';
  if (fields.some((field) => field.kind === 'cookie')) return 'cookie';
  if (fields.length) return 'login';
  return 'none';
}

function listDefinitions() {
  const engine = getCardigannEngine(DEFINITIONS_DIR);
  const tests = readTests();
  const definitions = engine.getAllIndexers().map((definition) => {
    const scraper = engine.getScraper(definition.id);
    scraper.applySettings({});
    const fields = scraper.credentialRequirements();
    const missing = fields.filter((field) => {
      const value = scraper.config[field.name];
      return value === undefined || value === null || value === '';
    });
    const test = tests.byId[definition.id] || null;
    const needsCredentials = missing.length > 0;
    return {
      id: definition.id,
      name: definition.name,
      language: definition.language || '',
      privacy: definition.type || 'public',
      credentialKind: credentialKind(fields),
      credentialFields: missing.map((field) => field.label),
      needsCredentials,
      testStatus: test?.status || (needsCredentials ? 'needs-credentials' : 'untested'),
      testError: test?.error || null,
      testCount: test?.count ?? null,
      testedAt: test?.testedAt || null,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  return {
    testedAt: tests.testedAt,
    query: tests.query || 'ubuntu',
    definitions,
  };
}

let testing = false;
const testingIds = new Set();

async function probeDefinition(engine, definition) {
  const testedAt = new Date().toISOString();
  const scraper = engine.getScraper(definition.id);
  scraper.applySettings({});
  const fields = scraper.credentialRequirements();
  const missing = fields.filter((field) => {
    const value = scraper.config[field.name];
    return value === undefined || value === null || value === '';
  });
  if (missing.length) {
    return {
      status: 'needs-credentials',
      error: `Needs ${missing.map((field) => field.label).join(', ')}`,
      count: 0,
      testedAt,
    };
  }

  const started = Date.now();
  try {
    const outcome = await scraper.search('ubuntu');
    const count = (outcome.results || []).length;
    const passed = outcome.success && count > 0;
    return {
      status: passed ? 'passed' : 'failed',
      error: passed ? null : (outcome.error || 'No releases parsed for "ubuntu"'),
      count,
      ms: Date.now() - started,
      testedAt,
    };
  } catch (error) {
    return {
      status: 'failed',
      error: error.message,
      count: 0,
      ms: Date.now() - started,
      testedAt,
    };
  }
}

function saveTestResult(id, result) {
  const tests = readTests();
  tests.byId[id] = result;
  writeTests(tests);
}

async function recordDefinitionTest(userId, { action, status, summary, highlights }) {
  if (!userId) return;
  const { recordActivitySafe, ActivityCategory } = require('./activityLogService');
  await recordActivitySafe(userId, {
    category: ActivityCategory.INDEXER_DEFINITIONS,
    action,
    status,
    summary,
    details: { trigger: 'manual', highlights },
  });
}

async function testDefinitions({ userId } = {}) {
  if (testing || testingIds.size) throw new Error('A definition test is already running');
  testing = true;
  const engine = getCardigannEngine(DEFINITIONS_DIR);
  const definitions = engine.getAllIndexers();
  const testedAt = new Date().toISOString();
  const byId = {};

  try {
    let cursor = 0;
    async function worker() {
      while (cursor < definitions.length) {
        const definition = definitions[cursor];
        cursor += 1;
        byId[definition.id] = await probeDefinition(engine, definition);
      }
    }

    await Promise.all(Array.from({ length: 4 }, () => worker()));
    writeTests({ testedAt, query: 'ubuntu', byId });

    const named = definitions.map((definition) => ({
      name: definition.name,
      ...(byId[definition.id] || {}),
    }));
    const passed = named.filter((row) => row.status === 'passed');
    const failed = named.filter((row) => row.status === 'failed');
    const needsAccount = named.filter((row) => row.status === 'needs-credentials');
    await recordDefinitionTest(userId, {
      action: 'definition_test',
      status: failed.length ? 'failure' : 'success',
      summary: `Indexer test: ${passed.length} passed, ${failed.length} failed, ${needsAccount.length} need an account`,
      highlights: [
        ...failed.map((row) => `${row.name}: ${row.error || 'failed'}`),
        ...passed.map((row) => `${row.name}: ${row.count} releases`),
      ],
    });

    return listDefinitions();
  } finally {
    testing = false;
  }
}

async function testOneDefinition(id, { userId } = {}) {
  if (testing) throw new Error('A definition test is already running');
  if (testingIds.has(id)) throw new Error('That indexer is already being tested');
  const engine = getCardigannEngine(DEFINITIONS_DIR);
  const definition = engine.getAllIndexers().find((item) => item.id === id);
  if (!definition) {
    const error = new Error('Indexer definition not found');
    error.statusCode = 404;
    throw error;
  }

  testingIds.add(id);
  try {
    const result = await probeDefinition(engine, definition);
    saveTestResult(id, result);
    const summary = result.status === 'passed'
      ? `${definition.name}: ${result.count} releases`
      : `${definition.name}: ${result.error || 'failed'}`;
    await recordDefinitionTest(userId, {
      action: 'definition_test_one',
      status: result.status === 'passed' ? 'success' : result.status === 'failed' ? 'failure' : 'info',
      summary,
      highlights: [summary],
    });
    const catalog = listDefinitions();
    return {
      definition: catalog.definitions.find((row) => row.id === id) || null,
    };
  } finally {
    testingIds.delete(id);
  }
}

module.exports = {
  DEFINITIONS_DIR,
  readState,
  updateSettings,
  syncDefinitions,
  listDefinitions,
  testDefinitions,
  testOneDefinition,
};

if (require.main === module) {
  syncDefinitions()
    .then((state) => {
      console.log(`Updated ${state.definitionCount} definitions from ${state.sourceRepo} ${state.sourceVersion} (${state.failedCount} failed to load)`);
      if (state.sourceCommit) console.log(`Commit ${state.sourceCommit}`);
      process.exit(state.failedCount ? 1 : 0);
    })
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
