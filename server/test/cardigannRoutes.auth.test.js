/**
 * Cardigann route auth tests.
 * Run: npm test
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const http = require('http');

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

function stubCardigannController() {
  const controllerPath = require.resolve('../controllers/Cardigann');
  require.cache[controllerPath] = {
    id: controllerPath,
    filename: controllerPath,
    loaded: true,
    exports: {
      getAllIndexers: async (req, res) => res.json({ success: true, indexers: [] }),
      getIndexer: async (req, res) => res.json({ success: true, indexer: { id: req.params.id } }),
      searchIndexer: async (req, res) => res.json({ success: true, results: [] }),
      searchMultiple: async (req, res) => res.json({ success: true, results: [] }),
      testIndexer: async (req, res) => res.json({ success: true }),
      getStats: async (req, res) => res.json({ count: 0 }),
      reload: async (req, res) => {
        if (!req.user?.permissions?.admin) {
          return res.status(403).json({
            success: false,
            error: 'Only admins can reload Cardigann definitions',
          });
        }
        res.json({ success: true, message: 'Definitions reloaded successfully' });
      },
    },
  };
}

let server;
let baseUrl;
let tmpDb;
let tokenUser;
let tokenAdmin;

before(async () => {
  process.env.JWT_SECRET = 'cardigann-auth-test-jwt';
  process.env.JWT_REFRESH_SECRET = 'cardigann-auth-test-refresh';
  tmpDb = path.join(os.tmpdir(), `borrowarr-cardigann-auth-${Date.now()}.sqlite`);
  process.env.SQLITE_STORAGE_PATH = tmpDb;

  stubCardigannController();

  require('../models/User');
  const { connectDB } = require('../config/database');
  await connectDB();

  const User = require('../models/User');
  const { v4: uuidv4 } = require('uuid');

  const user = await User.create({
    id: uuidv4(),
    username: 'cardigann_user',
    passwordHash: 'passwordpassword',
    permissions: { admin: false, request: true },
  });
  const admin = await User.create({
    id: uuidv4(),
    username: 'cardigann_admin',
    passwordHash: 'passwordpassword',
    permissions: { admin: true, request: true },
  });

  tokenUser = jwt.sign({ userId: user.id, type: 'access' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  tokenAdmin = jwt.sign({ userId: admin.id, type: 'access' }, process.env.JWT_SECRET, { expiresIn: '1h' });

  delete require.cache[require.resolve('../routes/Cardigann')];
  const cardigannRoutes = require('../routes/Cardigann');

  const app = express();
  app.use(express.json());
  app.use('/api/Cardigann', cardigannRoutes);

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

describe('Cardigann route auth', () => {
  test('GET /indexers without token returns 401', async () => {
    const res = await requestJson(baseUrl, 'GET', '/api/Cardigann/indexers');
    assert.equal(res.status, 401);
  });

  test('POST /search without token returns 401', async () => {
    const res = await requestJson(baseUrl, 'POST', '/api/Cardigann/search', {
      body: { indexers: ['yts'], query: 'test' },
    });
    assert.equal(res.status, 401);
  });

  test('GET /indexers with token succeeds', async () => {
    const res = await requestJson(baseUrl, 'GET', '/api/Cardigann/indexers', { token: tokenUser });
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
  });

  test('POST /reload returns 403 for non-admin', async () => {
    const res = await requestJson(baseUrl, 'POST', '/api/Cardigann/reload', { token: tokenUser });
    assert.equal(res.status, 403);
  });

  test('POST /reload succeeds for admin', async () => {
    const res = await requestJson(baseUrl, 'POST', '/api/Cardigann/reload', { token: tokenAdmin });
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
  });
});