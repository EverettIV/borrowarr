const MonitoredSeries = require("../models/MonitoredSeries");
const {
  addMonitoredSeries,
  probeSeriesEpisodes,
  processMonitoredSeries,
} = require("../services/monitoring");
const { isMonitoringAdmin, withOwnerUsernames } = require("../utils/monitoredListHelpers");

exports.getMonitoredSeries = async (req, res) => {
  try {
    const isAdmin = isMonitoringAdmin(req.user);
    const { userId, scope } = req.query;
    const requesterId = req.userId;

    let series;
    if (scope === "all" && isAdmin) {
      series = await MonitoredSeries.findAll({
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
    const result = await addMonitoredSeries({
      ...req.body,
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
    const updates = { ...req.body };
    const series = await MonitoredSeries.findByPk(id);
    if (!series) {
      return res.status(404).json({ error: "Series not found" });
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
    const { userId } = req.query;
    const series = await MonitoredSeries.findByPk(id);
    if (!series) {
      return res.status(404).json({ error: "Series not found" });
    }
    const isAdmin = isMonitoringAdmin(req.user);
    if (req.user) {
      if (series.userId !== req.userId && !isAdmin) {
        return res.status(403).json({ error: "Not authorized to remove this series" });
      }
    } else if (!userId || series.userId !== userId) {
      return res.status(403).json({ error: "Not authorized to remove this series" });
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
    const { userId, tmdbId } = req.query;
    if (!userId || !tmdbId) {
      return res.status(400).json({ error: "userId and tmdbId are required" });
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
    const { userId, title, episodes } = req.body;
    if (!userId || !title) {
      return res.status(400).json({ error: "userId and title are required" });
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