const MonitoredSeries = require("../models/MonitoredSeries");
const {
  addMonitoredSeries,
  probeSeriesEpisodes,
  processMonitoredSeries,
} = require("../services/monitoring");
const {
  isMonitoringAdmin,
  withOwnerUsernames,
  resolveMonitoredUserId,
  denyUnlessOwnerOrAdmin,
  applyMonitoredOwnerUpdates,
} = require("../utils/monitoredListHelpers");

exports.getMonitoredSeries = async (req, res) => {
  try {
    const isAdmin = isMonitoringAdmin(req.user);
    const { userId, scope } = req.query;

    let series;
    if (scope === "all" && isAdmin) {
      series = await MonitoredSeries.findAll({
        order: [["createdAt", "DESC"]],
      });
    } else {
      const targetUserId = resolveMonitoredUserId(req, userId);
      if (!targetUserId) {
        return res.status(400).json({ error: "userId is required" });
      }
      series = await MonitoredSeries.findAll({
        where: { userId: targetUserId },
        order: [["createdAt", "DESC"]],
      });
    }

    const enriched = await withOwnerUsernames(series);
    res.json({
      success: true,
      series: enriched,
      scope: scope === "all" && isAdmin ? "all" : "user",
    });
  } catch (error) {
    console.error("Error fetching monitored series:", error);
    res.status(500).json({ error: "Failed to fetch monitored series" });
  }
};

exports.addMonitoredSeries = async (req, res) => {
  try {
    const userId = resolveMonitoredUserId(req, req.body?.userId);
    const result = await addMonitoredSeries({
      ...req.body,
      userId,
      searchOnAdd: req.body.searchOnAdd !== false,
    });
    res.json(result);
  } catch (error) {
    console.error("Error adding monitored series:", error);
    res.status(500).json({ error: error.message || "Failed to add monitored series" });
  }
};

exports.updateMonitoredSeries = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = applyMonitoredOwnerUpdates(req, req.body);
    const series = await MonitoredSeries.findByPk(id);
    if (!series) {
      return res.status(404).json({ error: "Series not found" });
    }
    if (denyUnlessOwnerOrAdmin(req, res, series.userId, "Not authorized to update this series")) {
      return;
    }
    if (updates.selectedSeasons && typeof updates.selectedSeasons !== "string") {
      updates.selectedSeasons = JSON.stringify(updates.selectedSeasons);
    }
    if (updates.selectedEpisodes && typeof updates.selectedEpisodes !== "string") {
      updates.selectedEpisodes = JSON.stringify(updates.selectedEpisodes);
    }
    await series.update(updates);
    res.json({ success: true, series });
  } catch (error) {
    console.error("Error updating monitored series:", error);
    res.status(500).json({ error: "Failed to update monitored series" });
  }
};

exports.removeMonitoredSeries = async (req, res) => {
  try {
    const { id } = req.params;
    const series = await MonitoredSeries.findByPk(id);
    if (!series) {
      return res.status(404).json({ error: "Series not found" });
    }
    if (denyUnlessOwnerOrAdmin(req, res, series.userId, "Not authorized to remove this series")) {
      return;
    }
    await series.destroy();
    res.json({ success: true, message: "Series removed from monitoring" });
  } catch (error) {
    console.error("Error removing monitored series:", error);
    res.status(500).json({ error: "Failed to remove monitored series" });
  }
};

exports.isSeriesMonitored = async (req, res) => {
  try {
    const { tmdbId } = req.query;
    const userId = resolveMonitoredUserId(req, req.query.userId);
    if (!tmdbId) {
      return res.status(400).json({ error: "tmdbId is required" });
    }
    const series = await MonitoredSeries.findOne({ where: { userId, tmdbId } });
    res.json({ success: true, isMonitored: !!series, series });
  } catch (error) {
    console.error("Error checking if series is monitored:", error);
    res.status(500).json({ error: "Failed to check series status" });
  }
};

exports.checkEpisodesExist = async (req, res) => {
  try {
    const { title, episodes } = req.body;
    const userId = resolveMonitoredUserId(req, req.body?.userId);
    if (!title) {
      return res.status(400).json({ error: "title is required" });
    }
    const probe = await probeSeriesEpisodes(userId, { title, episodes: episodes || [] });
    res.json({ success: true, ...probe });
  } catch (error) {
    console.error("Error checking episodes existence:", error);
    res.status(500).json({ error: "Failed to check episodes existence" });
  }
};

exports.grabMonitoredSeries = async (req, res) => {
  try {
    const series = await MonitoredSeries.findByPk(req.params.id);
    if (!series) {
      return res.status(404).json({ error: "Series not found" });
    }
    if (denyUnlessOwnerOrAdmin(req, res, series.userId, "Not authorized to grab for this series")) {
      return;
    }
    const result = await processMonitoredSeries(series, {
      forceSearch: true,
      grabBudget: { remaining: 3 },
    });
    res.json({ success: true, result });
  } catch (error) {
    console.error("Error grabbing monitored series:", error);
    res.status(500).json({ error: error.message || "Failed to grab episodes" });
  }
};