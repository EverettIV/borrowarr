const MonitoredMovies = require("../models/MonitoredMovies");
const MonitoredSeries = require("../models/MonitoredSeries");
const {
  addMonitoredMovie,
  probeMovieLibrary,
  processMonitoredMovie,
  runUserMonitoringCycle,
} = require("../services/monitoring");
const { isMonitoringAdmin, withOwnerUsernames } = require("../utils/monitoredListHelpers");

exports.getMonitoredMovies = async (req, res) => {
  try {
    const isAdmin = isMonitoringAdmin(req.user);
    const { userId, scope } = req.query;
    const requesterId = req.userId;

    let movies;
    if (scope === "all" && isAdmin) {
      movies = await MonitoredMovies.findAll({
        order: [["createdAt", "DESC"]],
      });
    } else {
      const targetUserId = userId || requesterId;
      if (!targetUserId) {
        return res.status(400).json({ error: "userId is required" });
      }
      if (targetUserId !== requesterId && !isAdmin) {
        return res.status(403).json({ error: "Not authorized to view this monitored list" });
      }
      movies = await MonitoredMovies.findAll({
        where: { userId: targetUserId },
        order: [["createdAt", "DESC"]],
      });
    }

    const enriched = await withOwnerUsernames(movies);
    res.json({
      success: true,
      movies: enriched,
      scope: scope === "all" && isAdmin ? "all" : "user",
    });
  } catch (error) {
    console.error("Error fetching monitored movies:", error);
    res.status(500).json({ error: "Failed to fetch monitored movies" });
  }
};

exports.addMonitoredMovie = async (req, res) => {
  try {
    const result = await addMonitoredMovie({
      ...req.body,
      searchOnAdd: req.body.searchOnAdd !== false,
    });
    res.json(result);
  } catch (error) {
    console.error("Error adding monitored movie:", error);
    res.status(500).json({ error: error.message || "Failed to add monitored movie" });
  }
};

exports.updateMonitoredMovie = async (req, res) => {
  try {
    const { id } = req.params;
    const movie = await MonitoredMovies.findByPk(id);
    if (!movie) {
      return res.status(404).json({ error: "Movie not found" });
    }
    await movie.update(req.body);
    res.json({ success: true, movie });
  } catch (error) {
    console.error("Error updating monitored movie:", error);
    res.status(500).json({ error: "Failed to update monitored movie" });
  }
};

exports.removeMonitoredMovie = async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.query;
    const movie = await MonitoredMovies.findByPk(id);
    if (!movie) {
      return res.status(404).json({ error: "Movie not found" });
    }
    const isAdmin = isMonitoringAdmin(req.user);
    if (req.user) {
      if (movie.userId !== req.userId && !isAdmin) {
        return res.status(403).json({ error: "Not authorized to remove this movie" });
      }
    } else if (!userId || movie.userId !== userId) {
      return res.status(403).json({ error: "Not authorized to remove this movie" });
    }
    await movie.destroy();
    res.json({ success: true, message: "Movie removed from monitoring" });
  } catch (error) {
    console.error("Error removing monitored movie:", error);
    res.status(500).json({ error: "Failed to remove monitored movie" });
  }
};

exports.isMovieMonitored = async (req, res) => {
  try {
    const { userId, tmdbId } = req.query;
    if (!userId || !tmdbId) {
      return res.status(400).json({ error: "userId and tmdbId are required" });
    }
    const movie = await MonitoredMovies.findOne({ where: { userId, tmdbId } });
    res.json({ success: true, isMonitored: !!movie, movie });
  } catch (error) {
    console.error("Error checking if movie is monitored:", error);
    res.status(500).json({ error: "Failed to check movie status" });
  }
};

exports.checkMovieFile = async (req, res) => {
  try {
    const movie = await MonitoredMovies.findByPk(req.params.id);
    if (!movie) {
      return res.status(404).json({ error: "Movie not found" });
    }
    const result = await processMonitoredMovie(movie);
    res.json({ success: true, result });
  } catch (error) {
    console.error("Error checking movie file:", error);
    res.status(500).json({ error: "Failed to check movie file" });
  }
};

/** Full Radarr-style cycle: library sync + optional grabs (respects auto-download budget). */
exports.checkAllMovieFiles = async (req, res) => {
  try {
    const { userId, scope } = req.query;
    const isAdmin = isMonitoringAdmin(req.user);

    if (scope === "all" && isAdmin) {
      const [movieRows, seriesRows] = await Promise.all([
        MonitoredMovies.findAll({ attributes: ["userId"], raw: true }),
        MonitoredSeries.findAll({ attributes: ["userId"], raw: true }),
      ]);
      const userIds = [
        ...new Set([...movieRows, ...seriesRows].map((row) => row.userId).filter(Boolean)),
      ];
      const results = [];
      for (const uid of userIds) {
        results.push({ userId: uid, ...(await runUserMonitoringCycle(uid)) });
      }
      return res.json({ success: true, scope: "all", results });
    }

    const targetUserId = userId || req.userId;
    if (!targetUserId) {
      return res.status(400).json({ error: "userId is required" });
    }
    if (targetUserId !== req.userId && !isAdmin) {
      return res.status(403).json({ error: "Not authorized" });
    }
    const results = await runUserMonitoringCycle(targetUserId);
    res.json({ success: true, results });
  } catch (error) {
    console.error("Error running monitoring cycle:", error);
    res.status(500).json({ error: "Failed to run monitoring cycle" });
  }
};

exports.checkFileExists = async (req, res) => {
  try {
    const { userId, title, releaseDate, tmdbId } = req.body;
    if (!userId || !title) {
      return res.status(400).json({ error: "userId and title are required" });
    }
    const probe = await probeMovieLibrary(userId, { title, releaseDate, tmdbId });
    res.json({ success: true, ...probe, exists: probe.exists });
  } catch (error) {
    console.error("Error checking file existence:", error);
    res.status(500).json({ error: "Failed to check file existence" });
  }
};

/** Manual grab from Monitored UI — same path as automatic monitoring. */
exports.grabMonitoredMovie = async (req, res) => {
  try {
    const movie = await MonitoredMovies.findByPk(req.params.id);
    if (!movie) {
      return res.status(404).json({ error: "Movie not found" });
    }
    const result = await processMonitoredMovie(movie, { forceSearch: true, grabBudget: { remaining: 1 } });
    res.json({ success: true, result });
  } catch (error) {
    console.error("Error grabbing monitored movie:", error);
    res.status(500).json({ error: error.message || "Failed to grab release" });
  }
};