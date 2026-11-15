const express = require("express");
const router = express.Router();
const monitoredSeriesController = require("../controllers/MonitoredSeries");
const { authenticateToken } = require("../middleware/auth");

router.get("/", authenticateToken, monitoredSeriesController.getMonitoredSeries);
router.post("/", monitoredSeriesController.addMonitoredSeries);
router.get("/check", monitoredSeriesController.isSeriesMonitored);
router.post("/check-exists", monitoredSeriesController.checkEpisodesExist); // Check if episodes exist before monitoring
router.post("/:id/grab", monitoredSeriesController.grabMonitoredSeries);
router.put("/:id", monitoredSeriesController.updateMonitoredSeries);
router.delete("/:id", authenticateToken, monitoredSeriesController.removeMonitoredSeries);

module.exports = router;

