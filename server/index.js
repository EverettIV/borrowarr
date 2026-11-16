const { loadEnv } = require("./config/loadEnv");
loadEnv();

const { isUsingBundledTmdbKey } = require("./middleware/tmdb");
if (isUsingBundledTmdbKey()) {
  console.log(
    "ℹ️  TMDb: using bundled demo API key (set TMDB_API in server/.env for production / heavier use)."
  );
}

const express = require("express");
const app = express();
const cors = require("cors");
const helmet = require("helmet");
const PORT = process.env.PORT || 3013;
const { connectDB } = require("./config/database");

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP for API
  crossOriginEmbedderPolicy: false,
}));

// Try to enable compression if available (optional optimization)
try {
  const compression = require("compression");
  app.use(compression({
    filter: (req, res) => {
      if (req.headers['x-no-compression']) {
        return false;
      }
      return compression.filter(req, res);
    },
    level: 6,
  }));
  console.log("✅ Response compression enabled");
} catch (e) {
  console.log("⚠️  Compression module not found - install with: npm install compression");
}

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));
app.use(cors({
  origin: [
    "http://localhost:3012",
    "http://127.0.0.1:3012",
    "https://beta.borrowarr.com",
    "http://beta.borrowarr.com"
  ],
  credentials: true
}));

// Ensure all models are loaded BEFORE database sync
require("./models/User");
require("./models/MonitoredMovies");
require("./models/MonitoredSeries");
require("./models/Settings");
require("./models/Favorites");
require("./models/History");
require("./models/PlexConnection");
require("./models/HiddenMedia");
require("./models/ParentalGuide");
require("./models/MediaRequest");
require("./models/ActivityLog");

// Database must be ready before handling API requests (avoids false “not first run” on cold start).
let dbReady = false;
const dbReadyPromise = connectDB()
  .then(async () => {
    dbReady = true;
    const {
      logMediaPathsFromEnvOnStartup,
      ensureMediaDirectoriesFromEnv,
      backfillSettingsMediaPathsFromEnv,
    } = require('./config/mediaPaths');
    logMediaPathsFromEnvOnStartup();
    try {
      const { updated } = await backfillSettingsMediaPathsFromEnv();
      if (updated > 0) {
        console.log(`[MediaPaths] Backfilled media paths from env for ${updated} user(s)`);
      }
      await ensureMediaDirectoriesFromEnv();
    } catch (err) {
      console.warn('[MediaPaths] Startup path setup:', err.message);
    }
  })
  .catch((error) => {
    console.error("❌ Database failed to initialize:", error);
    process.exit(1);
  });

app.use(async (req, res, next) => {
  if (dbReady) {
    return next();
  }
  try {
    await dbReadyPromise;
    return next();
  } catch {
    return res.status(503).json({ error: "Database is not ready" });
  }
});

// Start monitoring service (after database connection)
setTimeout(() => {
  const { startMonitoringScheduler } = require('./services/monitoringService');
  startMonitoringScheduler();
}, 10000); // Wait 10 seconds after server starts

// Start auto-rename service (after database connection)
setTimeout(() => {
  const { startAutoRenameService } = require('./services/autoRenameService');
  startAutoRenameService();
}, 15000); // Wait 15 seconds after server starts

// Start download watcher service (after database connection)
setTimeout(() => {
  const { initializeAllWatchers } = require('./services/downloadWatcher');
  initializeAllWatchers();
}, 20000); // Wait 20 seconds after server starts

setTimeout(() => {
  const {
    initializeAllAnomalySchedulers,
  } = require('./services/anomalyDetectorScheduler');
  initializeAllAnomalySchedulers();
}, 22000);

setTimeout(() => {
  const { startIndexerDefinitionScheduler } = require('./services/indexerDefinitionScheduler');
  startIndexerDefinitionScheduler();
}, 5000);

app.get("/", (req, res) => {
  res.json({ app: "running" });
});

// Routes
app.use("/api/auth", require("./routes/Auth"));
app.use("/api/Users", require("./routes/Users"));
app.use("/api/Indexers", require("./routes/Indexers"));
app.use("/api/Search", require("./routes/Search"));
app.use("/api/DownloadClients", require("./routes/DownloadClients"));
app.use("/api/TMDB", require("./routes/tmdb"));
app.use("/api/MonitoredMovies", require("./routes/monitoredMovies"));
app.use("/api/MonitoredSeries", require("./routes/monitoredSeries"));
app.use("/api/Cardigann", require("./routes/Cardigann"));
app.use("/api/Settings", require("./routes/Settings"));
app.use("/api/Favorites", require("./routes/Favorites"));
app.use("/api/History", require("./routes/History"));
app.use("/api/CompletedDownloads", require("./routes/CompletedDownloads"));
app.use("/api/PlexConnection", require("./routes/PlexConnection"));
app.use("/api/HiddenMedia", require("./routes/HiddenMedia"));
app.use("/api/ParentalGuide", require("./routes/ParentalGuide"));
app.use("/api/MediaRequests", require("./routes/MediaRequests"));
app.use("/api/CuratedLists", require("./routes/CuratedLists"));
app.use("/api/ActivityLog", require("./routes/ActivityLog"));

dbReadyPromise.then(() => {
  app.listen(PORT, () => {
    console.log("✅ Listening on port " + PORT);
  });
});
