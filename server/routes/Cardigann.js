/**
 * Cardigann API Routes
 */

const express = require('express');
const router = express.Router();
const cardigannController = require('../controllers/Cardigann');
const { authenticateToken } = require('../middleware/auth');

router.use(authenticateToken);

router.get('/indexers', cardigannController.getAllIndexers);
router.get('/indexers/:id', cardigannController.getIndexer);
router.get('/indexers/:id/search', cardigannController.searchIndexer);
router.post('/search', cardigannController.searchMultiple);
router.get('/indexers/:id/test', cardigannController.testIndexer);
router.get('/stats', cardigannController.getStats);
router.post('/reload', cardigannController.reload);

module.exports = router;