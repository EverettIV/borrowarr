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
          resolve({ status: res.statusCode, headers: res.headers, json });
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

before(async () => {
  process.env.JWT_SECRET = 'tmdb-auth-test-jwt';
  process.env.JWT_REFRESH_SECRET = 'tmdb-auth-test-refresh';
  tmpDb = path.join(os.tmpdir(), `borrowarr-tmdb-auth-${Date.now()}.sqlite`);
  process.env.SQLITE_STORAGE_PATH = tmpDb;

  const tmdbControllerPath = require.resolve('../controllers/TMDB');
  require.cache[tmdbControllerPath] = {
    id: tmdbControllerPath,
    filename: tmdbControllerPath,
    loaded: true,
    exports: {
      searchMovies: async (req, res) =>
        res.json({ success: true, results: [], query: req.query.query }),
      getPopularMovies: async (req, res) =>
        res.json({ success: true, results: [{ id: 1, title: 'Cached Movie' }] }),
      getPopularTVShows: async () => {},
      getTrendingMovies: async () => {},
      getTrendingTVShows: async () => {},
      getTopRatedMovies: async () => {},
      getTopRatedTVShows: async () => {},
      getUpcomingMovies: async () => {},
      getUpcomingTVShows: async () => {},
      getMoviesByGenre: async () => {},
      getTVShowsByGenre: async () => {},
      discoverMovies: async () => {},
      discoverTVShows: async () => {},
      getGenres: async (req, res) => res.json({ success: true, genres: [] }),
      getWatchProviders: async () => {},
      getPopularTVShowsWithProviders: async () => {},
      getPopularMoviesWithProviders: async () => {},
      getMovieDetails: async () => {},
      getTVShowDetails: async () => {},
      getCompanyDetails: async () => {},
      getNetworkDetails: async () => {},
      getTVSeasonDetails: async () => {},
      getMoviesByPerson: async () => {},
      getTVShowsByPerson: async () => {},
      searchTorrentsForMovie: async (req, res) =>
        res.json({ success: true, torrents: true }),
      searchTorrentsForTVEpisode: async () => {},
    },
  };

  require('../models/User');
  const { connectDB } = require('../config/database');
  await connectDB();

  const User = require('../models/User');
  const { v4: uuidv4 } = require('uuid');
  const user = await User.create({
    id: uuidv4(),
    username: 'tmdb_user',
    passwordHash: 'passwordpassword',
    permissions: { admin: false, request: true },
  });

  tokenUser = jwt.sign({ userId: user.id, type: 'access' }, process.env.JWT_SECRET, {
    expiresIn: '1h',
  });

  delete require.cache[require.resolve('../routes/tmdb')];
  const tmdbRoutes = require('../routes/tmdb');

  const app = express();
  app.use(express.json());
  app.use('/api/TMDB', tmdbRoutes);

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

describe('TMDB route auth', () => {
  test('GET /popular/movies without token returns 401', async () => {
    const res = await requestJson(baseUrl, 'GET', '/api/TMDB/popular/movies');
    assert.equal(res.status, 401);
  });

  test('GET /search without token returns 401', async () => {
    const res = await requestJson(baseUrl, 'GET', '/api/TMDB/search?query=test');
    assert.equal(res.status, 401);
  });

  test('GET /popular/movies with token succeeds', async () => {
    const res = await requestJson(baseUrl, 'GET', '/api/TMDB/popular/movies', {
      token: tokenUser,
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
  });

  test('response cache returns HIT on repeat request', async () => {
    const first = await requestJson(baseUrl, 'GET', '/api/TMDB/popular/movies?page=2', {
      token: tokenUser,
    });
    assert.equal(first.headers['x-tmdb-cache'], 'MISS');

    const second = await requestJson(baseUrl, 'GET', '/api/TMDB/popular/movies?page=2', {
      token: tokenUser,
    });
    assert.equal(second.status, 200);
    assert.equal(second.headers['x-tmdb-cache'], 'HIT');
    assert.equal(second.json.results[0].title, 'Cached Movie');
  });
});