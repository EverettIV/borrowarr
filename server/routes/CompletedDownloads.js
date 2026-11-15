const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const controller = require('../controllers/CompletedDownloads');

router.use(authenticateToken);

router.get('/status', controller.getStatus);
router.post('/refresh', controller.refresh);
router.post('/import/:id/retry', controller.retryImport);

module.exports = router;