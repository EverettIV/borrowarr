const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const activityLogController = require('../controllers/ActivityLog');

router.use(authenticateToken);

router.get('/categories', activityLogController.getCategories);
router.get('/', activityLogController.getActivities);

module.exports = router;