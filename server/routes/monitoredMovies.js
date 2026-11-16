const express = require("express");
const router = express.Router();
const monitoredMoviesController = require("../controllers/MonitoredMovies");
const { authenticateToken } = require("../middleware/auth");

router.use(authenticateToken);

router.get("/", monitoredMoviesController.getMonitoredMovies);
router.post("/", monitoredMoviesController.addMonitoredMovie);
router.get("/check", monitoredMoviesController.isMovieMonitored);
router.post("/check-all", monitoredMoviesController.checkAllMovieFiles);
router.post("/check-exists", monitoredMoviesController.checkFileExists);
router.post("/:id/check-file", monitoredMoviesController.checkMovieFile);
router.post("/:id/grab", monitoredMoviesController.grabMonitoredMovie);
router.put("/:id", monitoredMoviesController.updateMonitoredMovie);
router.delete("/:id", monitoredMoviesController.removeMonitoredMovie);

module.exports = router;