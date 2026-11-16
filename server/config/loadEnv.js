const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SERVER_ROOT = path.join(__dirname, "..");

function resolveEnvPath() {
  if (!isUnset(process.env.BORROWARR_ENV_PATH)) {
    return path.resolve(process.env.BORROWARR_ENV_PATH);
  }
  const sqlitePath = process.env.SQLITE_STORAGE_PATH;
  if (sqlitePath && String(sqlitePath).trim()) {
    return path.join(path.dirname(path.resolve(sqlitePath)), ".env");
  }
  return path.join(SERVER_ROOT, ".env");
}

function isUnset(value) {
  return value === undefined || value === null || String(value).trim() === "";
}

function generateSecret() {
  return crypto.randomBytes(48).toString("base64url");
}

function buildEnvFileContent({ jwtSecret, jwtRefreshSecret, generated }) {
  const header = generated
    ? `# Created by Borrowarr on first start — keep JWT_* stable across redeploys so sessions stay valid.\n# Generated: ${new Date().toISOString()}\n\n`
    : "";

  return `${header}PORT=3013

# Required for authentication (auto-generated if missing)
JWT_SECRET=${jwtSecret}
JWT_REFRESH_SECRET=${jwtRefreshSecret}
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

# SQLite database file (default: server/database.sqlite)
# SQLITE_STORAGE_PATH=

# TMDb metadata (optional; dev defaults exist in code — use your own key for production)
# TMDB_API=
# TMDB_API_KEY=
# TMDB_API_READ=

# Prowlarr indexer sync (optional)
# PROWLARR_URL=
# PROWLARR_API_KEY=

# FlareSolverr / Cloudflare bypass (optional)
FLARESOLVERR_URL=http://localhost:8191
FLARESOLVERR_ENABLED=false

# DEBUG_SCRAPER=false
# LETTERBOXD_HEADLESS=false
`;
}

function writeEnvFile(envPath, content) {
  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  fs.writeFileSync(envPath, content, { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(envPath, 0o600);
  } catch {
    // chmod may fail on some filesystems; write mode is best-effort
  }
}

function patchMissingJwtInFile(envPath, updates) {
  const lines = [];
  if (updates.JWT_SECRET) {
    lines.push(`JWT_SECRET=${updates.JWT_SECRET}`);
  }
  if (updates.JWT_REFRESH_SECRET) {
    lines.push(`JWT_REFRESH_SECRET=${updates.JWT_REFRESH_SECRET}`);
  }
  const block = `\n# Auto-generated JWT values (${new Date().toISOString()})\n${lines.join("\n")}\n`;
  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  fs.appendFileSync(envPath, block, { encoding: "utf8" });
  try {
    fs.chmodSync(envPath, 0o600);
  } catch {
    // ignore
  }
}

/**
 * Ensures server/.env exists with secure JWT secrets, then loads it into process.env.
 * Safe to call on every server boot.
 */
function loadEnv() {
  const envPath = resolveEnvPath();

  if (!fs.existsSync(envPath)) {
    const jwtSecret = generateSecret();
    const jwtRefreshSecret = generateSecret();
    writeEnvFile(
      envPath,
      buildEnvFileContent({
        jwtSecret,
        jwtRefreshSecret,
        generated: true,
      })
    );
    console.log(
      `✅ Created ${envPath} with secure random JWT secrets (permissions 0600).`
    );
  }

  require("dotenv").config({ path: envPath });

  const missingAccess = isUnset(process.env.JWT_SECRET);
  const missingRefresh = isUnset(process.env.JWT_REFRESH_SECRET);

  if (missingAccess || missingRefresh) {
    const updates = {};
    if (missingAccess) {
      updates.JWT_SECRET = generateSecret();
      process.env.JWT_SECRET = updates.JWT_SECRET;
    }
    if (missingRefresh) {
      updates.JWT_REFRESH_SECRET = generateSecret();
      process.env.JWT_REFRESH_SECRET = updates.JWT_REFRESH_SECRET;
    }
    patchMissingJwtInFile(envPath, updates);
    console.log(`✅ Added missing JWT secret(s) to ${envPath}`);
  }
}

module.exports = { loadEnv, resolveEnvPath, SERVER_ROOT };

if (require.main === module) {
  loadEnv();
  console.log(`Environment ready: ${resolveEnvPath()}`);
}