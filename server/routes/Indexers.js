const express = require("express");
const router = express.Router();
const {
  createIndexer,
  readIndexers,
  readIndexerFromID,
  updateIndexer,
  deleteIndexer,
  syncAppIndexers,
  testAllIndexers,
  testIndexer,
  getAvailableIndexers,
  getIndexerDefinition,
  getDefinitionSync,
  updateDefinitionSync,
  runDefinitionSync,
  listDefinitionCatalog,
  testDefinitionCatalog,
  testOneDefinition,
} = require("../controllers/Indexers");
const { authenticateToken } = require("../middleware/auth");

// Indexers are instance configuration. Nothing here is reachable signed out.
router.use(authenticateToken);

router.route("/definitions").get(listDefinitionCatalog);
router.route("/definitions/test").post(testDefinitionCatalog);
router.route("/definitions/test/:id").post(testOneDefinition);
router.route("/definitions/sync").get(getDefinitionSync).put(updateDefinitionSync);
router.route("/definitions/sync/run").post(runDefinitionSync);
router.route("/available").get(getAvailableIndexers);
router.route("/definition/:id").get(getIndexerDefinition);

router.route("/create").post(createIndexer);
router.route("/read").get(readIndexers);
router.route("/read/:id").get(readIndexerFromID);
router.route("/update/:id").put(updateIndexer);
router.route("/delete/:id").delete(deleteIndexer);
router.route("/sync").post(syncAppIndexers);
router.route("/test-all").post(testAllIndexers);
router.route("/test").post(testIndexer); // Test without ID (for new indexers)
router.route("/test/:id").post(testIndexer);

module.exports = router;

