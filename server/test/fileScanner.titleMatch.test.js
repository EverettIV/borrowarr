const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { titleMatchesFilename } = require('../services/fileScanner');

describe('titleMatchesFilename', () => {
  test('requires release year when known', () => {
    assert.equal(
      titleMatchesFilename('Allen', 'Allen.2024.1080p.mkv', 2026),
      false,
    );
    assert.equal(
      titleMatchesFilename('Allen', 'Allen.2026.1080p.mkv', 2026),
      true,
    );
  });

  test('matches multi-word titles only when year matches', () => {
    assert.equal(
      titleMatchesFilename(
        'Collision Course',
        'Collision.Course.2025.1080p.mkv',
        2026,
      ),
      false,
    );
    assert.equal(
      titleMatchesFilename(
        'Collision Course',
        'Collision.Course.2026.1080p.mkv',
        2026,
      ),
      true,
    );
  });
});