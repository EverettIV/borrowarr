const { listActivities, ActivityCategory } = require('../services/activityLogService');

exports.getActivities = async (req, res) => {
  try {
    const isAdmin = Boolean(req.user?.permissions?.admin);
    const scope = req.query.scope;
    const listUserId = scope === 'all' && isAdmin ? null : req.userId;
    if (scope === 'all' && !isAdmin) {
      return res.status(403).json({ error: 'Not authorized to view all activity logs' });
    }
    const result = await listActivities(listUserId, {
      category: req.query.category,
      action: req.query.action,
      actionPrefix: req.query.actionPrefix,
      status: req.query.status,
      search: req.query.search,
      page: req.query.page,
      limit: req.query.limit,
      sortBy: req.query.sortBy,
      sortDir: req.query.sortDir,
    });
    res.json(result);
  } catch (error) {
    console.error('[ActivityLog] list error:', error);
    res.status(500).json({ error: error.message || 'Failed to load activity log' });
  }
};

exports.getCategories = async (_req, res) => {
  res.json({
    categories: Object.values(ActivityCategory),
  });
};