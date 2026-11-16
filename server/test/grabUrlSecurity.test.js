const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { validateGrabDownloadUrl, isBlockedIp } = require('../utils/grabUrlSecurity');

describe('grabUrlSecurity', () => {
  test('isBlockedIp flags private ranges', () => {
    assert.equal(isBlockedIp('127.0.0.1'), true);
    assert.equal(isBlockedIp('10.0.0.1'), true);
    assert.equal(isBlockedIp('192.168.1.1'), true);
    assert.equal(isBlockedIp('169.254.169.254'), true);
    assert.equal(isBlockedIp('8.8.8.8'), false);
  });

  test('allows magnet links', async () => {
    const result = await validateGrabDownloadUrl('magnet:?xt=urn:btih:abc');
    assert.equal(result.ok, true);
    assert.equal(result.mode, 'magnet');
  });

  test('trusted source skips validation', async () => {
    const result = await validateGrabDownloadUrl('http://127.0.0.1/torrent.torrent', {
      trustedSource: true,
    });
    assert.equal(result.ok, true);
    assert.equal(result.mode, 'trusted');
  });

  test('blocks direct private IP http URL', async () => {
    const result = await validateGrabDownloadUrl('http://127.0.0.1/file.torrent');
    assert.equal(result.ok, false);
  });

  test('blocks localhost hostname', async () => {
    const result = await validateGrabDownloadUrl('http://localhost:3013/api');
    assert.equal(result.ok, false);
  });
});