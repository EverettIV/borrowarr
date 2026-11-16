const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  sanitizeDownloadClientForUser,
  redactDownloadClientSettings,
  normalizeGrabMediaType,
  resolveClientCategoryLabel,
} = require('../utils/downloadClientHelpers');

describe('downloadClientHelpers', () => {
  test('redactDownloadClientSettings removes secrets', () => {
    const out = redactDownloadClientSettings({
      host: '10.0.0.1',
      port: 8080,
      username: 'admin',
      password: 'secret',
      apiKey: 'abc',
    });
    assert.equal(out.host, '10.0.0.1');
    assert.equal(out.username, 'admin');
    assert.equal(out.password, undefined);
    assert.equal(out.apiKey, undefined);
  });

  test('sanitize keeps settings for admin', () => {
    const admin = { permissions: { admin: true } };
    const client = {
      id: 1,
      name: 'qbit',
      settings: { password: 'pw' },
    };
    const out = sanitizeDownloadClientForUser(client, admin);
    assert.equal(out.settings.password, 'pw');
  });

  test('normalizeGrabMediaType maps aliases to movie and tv', () => {
    assert.equal(normalizeGrabMediaType('movies'), 'movie');
    assert.equal(normalizeGrabMediaType('movie'), 'movie');
    assert.equal(normalizeGrabMediaType('series'), 'tv');
    assert.equal(normalizeGrabMediaType('tv'), 'tv');
  });

  test('resolveClientCategoryLabel prefers configured label and falls back to key', () => {
    assert.equal(
      resolveClientCategoryLabel(
        [{ category: 'movies', clientCategory: 'films' }],
        'movie',
      ),
      'films',
    );
    assert.equal(resolveClientCategoryLabel([], 'movie'), 'movie');
    assert.equal(resolveClientCategoryLabel([], 'series'), 'tv');
  });

  test('sanitize strips secrets for non-admin', () => {
    const user = { permissions: { admin: false, request: true } };
    const client = {
      id: 1,
      name: 'qbit',
      settings: { password: 'pw', host: '192.168.1.5' },
    };
    const out = sanitizeDownloadClientForUser(client, user);
    assert.equal(out.name, 'qbit');
    assert.equal(out.settings.host, '192.168.1.5');
    assert.equal(out.settings.password, undefined);
  });
});