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
let clientId;

before(async () => {
  process.env.JWT_SECRET = 'dl-client-sec-test-jwt';
  process.env.JWT_REFRESH_SECRET = 'dl-client-sec-test-refresh';
  tmpDb = path.join(os.tmpdir(), `borrowarr-dl-sec-${Date.now()}.sqlite`);
  process.env.SQLITE_STORAGE_PATH = tmpDb;

  require('../models/User');
  require('../models/DownloadClients');
  const { connectDB } = require('../config/database');
  await connectDB();

  const User = require('../models/User');
  const DownloadClients = require('../models/DownloadClients');
  const { v4: uuidv4 } = require('uuid');
  const adminId = uuidv4();
  const userId = uuidv4();

  await User.create({
    id: adminId,
    username: 'dl_admin',
    passwordHash: 'passwordpassword',
    permissions: { admin: true, request: true },
  });
  await User.create({
    id: userId,
    username: 'dl_user',
    passwordHash: 'passwordpassword',
    permissions: { admin: false, request: true },
  });

  const client = await DownloadClients.create({
    name: 'Test qBittorrent',
    implementation: 'QBittorrent',
    protocol: 'torrent',
    enabled: true,
    priority: 1,
    settings: { host: '192.168.1.10', password: 'supersecret', username: 'admin' },
    userId: adminId,
  });
  clientId = client.id;

  tokenUser = jwt.sign({ userId, type: 'access' }, process.env.JWT_SECRET, { expiresIn: '1h' });

  delete require.cache[require.resolve('../controllers/DownloadClients')];
  const downloadRoutes = require('../routes/DownloadClients');

  const app = express();
  app.use(express.json());
  app.use('/api/DownloadClients', downloadRoutes);

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

describe('Download client credential redaction', () => {
  test('non-admin read omits client passwords', async () => {
    const res = await requestJson(baseUrl, 'GET', '/api/DownloadClients/read', {
      token: tokenUser,
    });
    assert.equal(res.status, 200);
    const client = res.json.data[0];
    assert.equal(client.settings.host, '192.168.1.10');
    assert.equal(client.settings.password, undefined);
  });

  test('POST /grab rejects private SSRF URL for requesters', async () => {
    const res = await requestJson(baseUrl, 'POST', '/api/DownloadClients/grab', {
      token: tokenUser,
      body: {
        downloadUrl: 'http://127.0.0.1/evil.torrent',
        clientId,
      },
    });
    assert.equal(res.status, 400);
    assert.match(String(res.json.error), /private|restricted|not allowed/i);
  });
});