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

let server;
let baseUrl;
let tmpDb;
let tokenUser;
let tokenAdmin;

before(async () => {
  process.env.JWT_SECRET = 'settings-browse-test-jwt';
  process.env.JWT_REFRESH_SECRET = 'settings-browse-test-refresh';
  tmpDb = path.join(os.tmpdir(), `borrowarr-settings-browse-${Date.now()}.sqlite`);
  process.env.SQLITE_STORAGE_PATH = tmpDb;

  require('../models/User');
  const { connectDB } = require('../config/database');
  await connectDB();

  const User = require('../models/User');
  const { v4: uuidv4 } = require('uuid');
  const user = await User.create({
    id: uuidv4(),
    username: 'path_user',
    passwordHash: 'passwordpassword',
    permissions: { admin: false, request: true },
  });
  const admin = await User.create({
    id: uuidv4(),
    username: 'path_admin',
    passwordHash: 'passwordpassword',
    permissions: { admin: true, request: true },
  });

  tokenUser = jwt.sign({ userId: user.id, type: 'access' }, process.env.JWT_SECRET, {
    expiresIn: '1h',
  });
  tokenAdmin = jwt.sign({ userId: admin.id, type: 'access' }, process.env.JWT_SECRET, {
    expiresIn: '1h',
  });

  const settingsRoutes = require('../routes/Settings');

  const app = express();
  app.use(express.json());
  app.use('/api/Settings', settingsRoutes);

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

describe('Settings directory browse (admin only)', () => {
  test('GET /browse forbidden for non-admin', async () => {
    const res = await requestJson(baseUrl, 'GET', '/api/Settings/browse?currentPath=/', {
      token: tokenUser,
    });
    assert.equal(res.status, 403);
  });

  test('POST /test-directory forbidden for non-admin', async () => {
    const res = await requestJson(baseUrl, 'POST', '/api/Settings/test-directory', {
      token: tokenUser,
      body: { directory: '/tmp' },
    });
    assert.equal(res.status, 403);
  });

  test('GET /browse allowed for admin', async () => {
    const res = await requestJson(baseUrl, 'GET', '/api/Settings/browse?currentPath=/', {
      token: tokenAdmin,
    });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json.directories));
  });
});