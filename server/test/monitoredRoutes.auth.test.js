/**
 * Integration tests for monitored movie/series route auth.
 * Run: node --test test/monitoredListHelpers.test.js test/monitoredRoutes.auth.test.js
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const http = require('http');

const monitoringPath = path.join(__dirname, '../services/monitoring/index.js');
const monitoringDir = path.dirname(monitoringPath);

let lastAddMovieBody = null;
let processMovieCalledFor = null;

const monitoringStub = {
  addMonitoredMovie: async (body) => {
    lastAddMovieBody = body;
    return { success: true, movie: { id: 99, userId: body.userId } };
  },
  addMonitoredSeries: async (body) => ({ success: true, series: { id: 88, userId: body.userId } }),
  probeMovieLibrary: async () => ({ exists: false }),
  probeSeriesEpisodes: async () => ({ episodes: [] }),
  processMonitoredMovie: async (movie) => {
    processMovieCalledFor = movie.userId;
    return { status: 'mocked' };
  },
  processMonitoredSeries: async () => ({ status: 'mocked' }),
  runUserMonitoringCycle: async () => ({ ok: true }),
};

function primeModuleStubs() {
  require.cache[monitoringPath] = {
    id: monitoringPath,
    filename: monitoringPath,
    loaded: true,
    exports: monitoringStub,
  };
  const addPath = path.join(monitoringDir, 'add.js');
  require.cache[addPath] = {
    id: addPath,
    filename: addPath,
    loaded: true,
    exports: {
      addMonitoredMovie: monitoringStub.addMonitoredMovie,
      addMonitoredSeries: monitoringStub.addMonitoredSeries,
    },
  };
}

function clearControllerCache() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes('MonitoredMovies') || key.includes('MonitoredSeries')) {
      if (key.endsWith('controllers/MonitoredMovies.js') || key.endsWith('controllers/MonitoredSeries.js')) {
        delete require.cache[key];
      }
    }
  }
}

function requestJson(baseUrl, method, urlPath, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, baseUrl);
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(payload
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
              }
            : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let json = null;
          try {
            json = data ? JSON.parse(data) : null;
          } catch {
            json = data;
          }
          resolve({ status: res.statusCode, json });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

let server;
let baseUrl;
let tmpDb;
let userA;
let userB;
let tokenA;
let tokenB;
let movieRow;

before(async () => {
  process.env.JWT_SECRET = 'integration-test-jwt-secret';
  process.env.JWT_REFRESH_SECRET = 'integration-test-refresh-secret';
  tmpDb = path.join(os.tmpdir(), `borrowarr-monitored-auth-${Date.now()}.sqlite`);
  process.env.SQLITE_STORAGE_PATH = tmpDb;

  primeModuleStubs();
  clearControllerCache();

  require('../models/User');
  require('../models/MonitoredMovies');
  require('../models/MonitoredSeries');
  const { connectDB } = require('../config/database');
  await connectDB();

  const User = require('../models/User');
  const MonitoredMovies = require('../models/MonitoredMovies');
  const { v4: uuidv4 } = require('uuid');

  userA = await User.create({
    id: uuidv4(),
    username: 'usera_test',
    passwordHash: 'passwordpassword',
    permissions: { admin: false, manage_users: false, request: true },
  });
  userB = await User.create({
    id: uuidv4(),
    username: 'userb_test',
    passwordHash: 'passwordpassword',
    permissions: { admin: false, manage_users: false, request: true },
  });

  movieRow = await MonitoredMovies.create({
    userId: userA.id,
    tmdbId: 550,
    title: 'Fight Club',
  });

  tokenA = jwt.sign({ userId: userA.id, type: 'access' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  tokenB = jwt.sign({ userId: userB.id, type: 'access' }, process.env.JWT_SECRET, { expiresIn: '1h' });

  const monitoredMoviesRoutes = require('../routes/monitoredMovies');
  const monitoredSeriesRoutes = require('../routes/monitoredSeries');

  const app = express();
  app.use(express.json());
  app.use('/api/MonitoredMovies', monitoredMoviesRoutes);
  app.use('/api/MonitoredSeries', monitoredSeriesRoutes);

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  if (tmpDb && fs.existsSync(tmpDb)) {
    fs.unlinkSync(tmpDb);
  }
});

describe('MonitoredMovies route auth', () => {
  test('POST / without token returns 401', async () => {
    const res = await requestJson(baseUrl, 'POST', '/api/MonitoredMovies', {
      body: { userId: userA.id, tmdbId: 1, title: 'X' },
    });
    assert.equal(res.status, 401);
  });

  test('POST / ignores spoofed userId for non-owner token', async () => {
    lastAddMovieBody = null;
    const res = await requestJson(baseUrl, 'POST', '/api/MonitoredMovies', {
      token: tokenB,
      body: { userId: userA.id, tmdbId: 123, title: 'Spoofed' },
    });
    assert.equal(res.status, 200);
    assert.equal(lastAddMovieBody.userId, userB.id);
  });

  test('POST /:id/grab denied for non-owner', async () => {
    processMovieCalledFor = null;
    const res = await requestJson(
      baseUrl,
      'POST',
      `/api/MonitoredMovies/${movieRow.id}/grab`,
      { token: tokenB },
    );
    assert.equal(res.status, 403);
    assert.equal(processMovieCalledFor, null);
  });

  test('POST /:id/grab allowed for owner', async () => {
    processMovieCalledFor = null;
    const res = await requestJson(
      baseUrl,
      'POST',
      `/api/MonitoredMovies/${movieRow.id}/grab`,
      { token: tokenA },
    );
    assert.equal(res.status, 200);
    assert.equal(processMovieCalledFor, userA.id);
  });

  test('PUT /:id denied for non-owner', async () => {
    const res = await requestJson(baseUrl, 'PUT', `/api/MonitoredMovies/${movieRow.id}`, {
      token: tokenB,
      body: { title: 'Hacked' },
    });
    assert.equal(res.status, 403);
    const reloaded = await movieRow.reload();
    assert.equal(reloaded.title, 'Fight Club');
  });

  test('GET /check requires token', async () => {
    const res = await requestJson(
      baseUrl,
      'GET',
      `/api/MonitoredMovies/check?userId=${userA.id}&tmdbId=550`,
    );
    assert.equal(res.status, 401);
  });

  test('POST /check-exists without token returns 401', async () => {
    const res = await requestJson(baseUrl, 'POST', '/api/MonitoredMovies/check-exists', {
      body: { userId: userA.id, title: 'Fight Club' },
    });
    assert.equal(res.status, 401);
  });

  test('POST /check-exists uses authenticated user for library probe', async () => {
    const res = await requestJson(baseUrl, 'POST', '/api/MonitoredMovies/check-exists', {
      token: tokenB,
      body: { userId: userA.id, title: 'Fight Club' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
  });
});

describe('MonitoredSeries route auth', () => {
  test('POST / without token returns 401', async () => {
    const res = await requestJson(baseUrl, 'POST', '/api/MonitoredSeries', {
      body: { userId: userA.id, tmdbId: 1, title: 'X' },
    });
    assert.equal(res.status, 401);
  });

  test('POST /check-exists without token returns 401', async () => {
    const res = await requestJson(baseUrl, 'POST', '/api/MonitoredSeries/check-exists', {
      body: { userId: userA.id, title: 'X' },
    });
    assert.equal(res.status, 401);
  });
});