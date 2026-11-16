const { Sequelize } = require('sequelize');
const path = require('path');

const storagePath = process.env.SQLITE_STORAGE_PATH
  ? path.resolve(process.env.SQLITE_STORAGE_PATH)
  : path.join(__dirname, '../database.sqlite');

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: storagePath,
  logging: false,
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000
  }
});

async function getExistingColumns(tableName) {
  const rows = await sequelize.query(`PRAGMA table_info(\`${tableName}\`)`, {
    type: sequelize.QueryTypes.SELECT,
  });
  return new Set(rows.map((row) => row.name));
}

async function addColumnIfMissing(tableName, columnName, columnSql) {
  const existing = await getExistingColumns(tableName);
  if (existing.has(columnName)) {
    return false;
  }
  await sequelize.query(
    `ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${columnSql}`
  );
  console.log(`✅ Added column ${tableName}.${columnName}`);
  return true;
}

/**
 * Legacy DBs require email NOT NULL; the User model allows optional email.
 */
async function ensureUsersEmailNullable() {
  const rows = await sequelize.query('PRAGMA table_info(`users`)', {
    type: sequelize.QueryTypes.SELECT,
  });
  const emailColumn = rows.find((row) => row.name === 'email');
  if (!emailColumn || emailColumn.notnull === 0) {
    return;
  }

  console.log('🔧 Migrating users table: allow NULL email');
  await sequelize.query('PRAGMA foreign_keys = OFF');
  try {
    await sequelize.query('BEGIN');
    await sequelize.query(
      `CREATE TABLE users__email_nullable (
        id TEXT NOT NULL UNIQUE PRIMARY KEY,
        username VARCHAR(255) NOT NULL UNIQUE,
        email VARCHAR(255) UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        avatar_url VARCHAR(255),
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        permissions JSON NOT NULL DEFAULT '{"admin":false,"manage_users":false,"request":true,"auto_approve":false,"manage_requests":false}'
      )`
    );
    await sequelize.query(
      `INSERT INTO users__email_nullable (
        id, username, email, password_hash, avatar_url, created_at, updated_at, permissions
      )
       SELECT id, username, email, password_hash, avatar_url, created_at, updated_at, permissions
       FROM users`
    );
    await sequelize.query('DROP TABLE users');
    await sequelize.query('ALTER TABLE users__email_nullable RENAME TO users');
    await sequelize.query('COMMIT');
    console.log('✅ users.email is now nullable');
  } catch (migrationError) {
    try {
      await sequelize.query('ROLLBACK');
    } catch {
      // ignore rollback failures
    }
    throw migrationError;
  } finally {
    await sequelize.query('PRAGMA foreign_keys = ON');
  }
}

/**
 * SQLite cannot reliably use sequelize.sync({ alter: true }) when models drift
 * from legacy tables. Add missing columns explicitly after sync.
 */
async function ensureSQLiteSchemaPatches() {
  const columnPatches = [
    ['Settings', 'preferredQuality', "TEXT NOT NULL DEFAULT '720p'"],
    ['Settings', 'preferSeedersInQualityRange', 'INTEGER NOT NULL DEFAULT 1'],
    ['Settings', 'allowQualityUpgrade', 'INTEGER NOT NULL DEFAULT 1'],
    ['Settings', 'maxGrabsPerCycle', 'INTEGER NOT NULL DEFAULT 5'],
    ['Settings', 'completedDownloadHandlingEnabled', 'INTEGER NOT NULL DEFAULT 1'],
    ['Settings', 'completedDownloadHandlingImportEnabled', 'INTEGER NOT NULL DEFAULT 1'],
    ['Settings', 'completedDownloadCheckInterval', 'INTEGER NOT NULL DEFAULT 60'],
    ['Settings', 'completedDownloadImportMode', 'TEXT NOT NULL DEFAULT \'hardlink\''],
    ['Settings', 'completedDownloadRemoveFromClient', 'INTEGER NOT NULL DEFAULT 0'],
    ['Settings', 'remotePathMappings', 'TEXT DEFAULT \'[]\''],
    ['History', 'downloadClientRecordId', 'INTEGER'],
    ['History', 'clientCategory', 'TEXT'],
    ['History', 'outputPath', 'TEXT'],
    ['History', 'downloadProgress', 'REAL'],
    ['History', 'importStatus', 'TEXT NOT NULL DEFAULT \'none\''],
    ['History', 'importError', 'TEXT'],
    ['Settings', 'movieWatcherDownloadMode', 'TEXT NOT NULL DEFAULT \'saved\''],
    ['Settings', 'movieWatcherMediaMode', 'TEXT NOT NULL DEFAULT \'saved\''],
    ['Settings', 'movieWatcherCustomDownloadDirectory', 'TEXT'],
    ['Settings', 'movieWatcherCustomMediaDirectory', 'TEXT'],
    ['Settings', 'seriesWatcherDownloadMode', 'TEXT NOT NULL DEFAULT \'saved\''],
    ['Settings', 'seriesWatcherMediaMode', 'TEXT NOT NULL DEFAULT \'saved\''],
    ['Settings', 'seriesWatcherCustomDownloadDirectory', 'TEXT'],
    ['Settings', 'seriesWatcherCustomMediaDirectory', 'TEXT'],
    ['Settings', 'movieWatcherEnabled', 'INTEGER NOT NULL DEFAULT 1'],
    ['Settings', 'seriesWatcherEnabled', 'INTEGER NOT NULL DEFAULT 1'],
    ['Settings', 'applyNamingOnWatcherApprove', 'INTEGER NOT NULL DEFAULT 1'],
    ['Settings', 'applyNamingOnAutomaticMove', 'INTEGER NOT NULL DEFAULT 0'],
    ['Settings', 'movieNamingScanTarget', "TEXT NOT NULL DEFAULT 'media'"],
    ['Settings', 'movieNamingUseFolders', 'INTEGER NOT NULL DEFAULT 0'],
    ['Settings', 'movieRenameCleanupReleaseFolder', 'INTEGER NOT NULL DEFAULT 0'],
    ['Settings', 'seriesNamingScanTarget', "TEXT NOT NULL DEFAULT 'media'"],
    ['Settings', 'movieApplyNamingOnWatcherApprove', 'INTEGER NOT NULL DEFAULT 1'],
    ['Settings', 'seriesApplyNamingOnWatcherApprove', 'INTEGER NOT NULL DEFAULT 1'],
    ['Settings', 'movieApplyNamingOnAutomaticMove', 'INTEGER NOT NULL DEFAULT 0'],
    ['indexers', 'cardigann_id', 'TEXT'],
    ['indexers', 'cardigann_settings', 'TEXT'],
    ['indexers', 'api_key', 'TEXT'],
    ['Settings', 'seriesApplyNamingOnAutomaticMove', 'INTEGER NOT NULL DEFAULT 0'],
    ['Settings', 'anomalyDetectorAutoScanEnabled', 'INTEGER NOT NULL DEFAULT 0'],
    ['Settings', 'anomalyDetectorScanInterval', 'INTEGER NOT NULL DEFAULT 1800'],
    ['Settings', 'anomalyDetectorScanDirKey', "TEXT NOT NULL DEFAULT 'movieMedia'"],
    ['Settings', 'anomalyDetectorCustomScanPath', 'TEXT'],
    ['Settings', 'anomalyDetectorCheckDuplicates', 'INTEGER NOT NULL DEFAULT 1'],
    ['Settings', 'anomalyDetectorCheckCorruption', 'INTEGER NOT NULL DEFAULT 0'],
    ['Settings', 'anomalyDetectorCheckLargeFiles', 'INTEGER NOT NULL DEFAULT 0'],
    ['monitored_movies', 'fileQuality', 'TEXT'],
    ['monitored_movies', 'grabAttemptedAt', 'DATETIME'],
    ['monitored_movies', 'lastGrabError', 'TEXT'],
    ['monitored_series', 'episodeStatus', 'TEXT'],
    ['monitored_series', 'lastChecked', 'DATETIME'],
    ['monitored_series', 'fileExists', 'INTEGER NOT NULL DEFAULT 0'],
  ];

  for (const [table, column, sql] of columnPatches) {
    try {
      const tableRows = await sequelize.query(
        `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
        { replacements: [table], type: sequelize.QueryTypes.SELECT }
      );
      if (!tableRows.length) {
        continue;
      }
      await addColumnIfMissing(table, column, sql);
    } catch (patchError) {
      if (!patchError.message.includes('duplicate column name')) {
        console.warn(`⚠️  Schema patch failed for ${table}.${column}:`, patchError.message);
      }
    }
  }
}

const connectDB = async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connected');
    
    // Handle existing data with null userId before syncing
    try {
      const MonitoredMovies = require('../models/MonitoredMovies');
      const MonitoredSeries = require('../models/MonitoredSeries');
      
      // Check if there are any rows with null userId
      const moviesWithNullUserId = await sequelize.query(
        "SELECT COUNT(*) as count FROM monitored_movies WHERE userId IS NULL",
        { type: sequelize.QueryTypes.SELECT }
      );
      
      if (moviesWithNullUserId[0]?.count > 0) {
        console.log(`⚠️  Found ${moviesWithNullUserId[0].count} monitored movies with null userId - deleting them`);
        await sequelize.query("DELETE FROM monitored_movies WHERE userId IS NULL");
      }
      
      const seriesWithNullUserId = await sequelize.query(
        "SELECT COUNT(*) as count FROM monitored_series WHERE userId IS NULL",
        { type: sequelize.QueryTypes.SELECT }
      );
      
      if (seriesWithNullUserId[0]?.count > 0) {
        console.log(`⚠️  Found ${seriesWithNullUserId[0].count} monitored series with null userId - deleting them`);
        await sequelize.query("DELETE FROM monitored_series WHERE userId IS NULL");
      }
    } catch (cleanupError) {
      // If tables don't exist yet, that's fine
      if (!cleanupError.message.includes('no such table')) {
        console.warn('⚠️  Could not clean up null userId values:', cleanupError.message);
      }
    }
    
    // Use alter: true to update existing tables with new columns
    // If alter fails, try without alter
    try {
      await sequelize.sync({ alter: true });
      console.log('✅ Database synchronized');
    } catch (syncError) {
      console.warn('⚠️  Alter sync failed, trying without alter:', syncError.message);
      await sequelize.sync({ alter: false });
      console.log('✅ Database synchronized (without alter)');
    }

    await ensureUsersEmailNullable();
    await ensureSQLiteSchemaPatches();
  } catch (error) {
    console.error('❌ Unable to connect to the database:', error);
    throw error;
  }
};

module.exports = { sequelize, connectDB };