const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveMonitoredUserId,
  denyUnlessOwnerOrAdmin,
  applyMonitoredOwnerUpdates,
} = require('../utils/monitoredListHelpers');

const userA = { id: 'user-a', permissions: { admin: false } };
const admin = { id: 'admin-1', permissions: { admin: true } };

describe('resolveMonitoredUserId', () => {
  test('uses req.userId when no explicit id', () => {
    assert.equal(
      resolveMonitoredUserId({ userId: 'user-a', user: userA }, undefined),
      'user-a',
    );
  });

  test('ignores spoofed userId for non-admin', () => {
    assert.equal(
      resolveMonitoredUserId({ userId: 'user-a', user: userA }, 'user-b'),
      'user-a',
    );
  });

  test('allows admin to target another user', () => {
    assert.equal(
      resolveMonitoredUserId({ userId: 'admin-1', user: admin }, 'user-b'),
      'user-b',
    );
  });
});

describe('denyUnlessOwnerOrAdmin', () => {
  test('allows owner', () => {
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; } };
    assert.equal(denyUnlessOwnerOrAdmin({ userId: 'user-a', user: userA }, res, 'user-a'), false);
  });

  test('denies other user', () => {
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; } };
    assert.equal(denyUnlessOwnerOrAdmin({ userId: 'user-a', user: userA }, res, 'user-b'), true);
    assert.equal(res.statusCode, 403);
  });

  test('allows admin for any owner', () => {
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; } };
    assert.equal(denyUnlessOwnerOrAdmin({ userId: 'admin-1', user: admin }, res, 'user-b'), false);
  });
});

describe('applyMonitoredOwnerUpdates', () => {
  test('strips userId for non-admin', () => {
    const out = applyMonitoredOwnerUpdates({ user: userA }, { title: 'X', userId: 'evil' });
    assert.equal(out.title, 'X');
    assert.equal(out.userId, undefined);
  });

  test('keeps userId for admin', () => {
    const out = applyMonitoredOwnerUpdates({ user: admin }, { title: 'X', userId: 'user-b' });
    assert.equal(out.userId, 'user-b');
  });
});