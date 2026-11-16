const express = require("express");
const router = express.Router();
const monitoredSeriesController = require("../controllers/MonitoredSeries");
const { authenticateToken } = require("../middleware/auth");

router.use(authenticateToken);

router.get("/", monitoredSeriesController.getMonitoredSeries);
router.post("/", monitoredSeriesController.addMonitoredSeries);
router.get("/check", monitoredSeriesController.isSeriesMonitored);
router.post("/check-exists", monitoredSeriesController.checkEpisodesExist);
router.post("/:id/grab", monitoredSeriesController.grabMonitoredSeries);
router.put("/:id", monitoredSeriesController.updateMonitoredSeries);
router.delete("/:id", monitoredSeriesController.removeMonitoredSeries);

module.exports = router;