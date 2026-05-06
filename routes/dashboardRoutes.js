const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const {
  getCommandCentre,
  getRoleDashboard,
  getDashboardConfig,
  saveDashboardConfig,
  createSavedDashboard,
  selectSavedDashboard,
} = require('../controllers/dashboardController');

router.get(
  '/command-centre/:projectId',
  auth,
  roleGuard('admin', 'pmo', 'dh', 'pm', 'exec', 'member', 'client'),
  getCommandCentre
);

router.get('/config/:role', auth, roleGuard('admin', 'pmo', 'dh', 'pm', 'exec'), getDashboardConfig);
router.put('/config/:role', auth, roleGuard('admin', 'pmo', 'dh', 'pm', 'exec'), saveDashboardConfig);
router.post('/config/:role/dashboards', auth, roleGuard('admin', 'pmo', 'dh', 'pm', 'exec'), createSavedDashboard);
router.post(
  '/config/:role/dashboards/:dashboardId/select',
  auth,
  roleGuard('admin', 'pmo', 'dh', 'pm', 'exec'),
  selectSavedDashboard
);
router.get('/:role', auth, roleGuard('admin', 'pmo', 'dh', 'pm', 'exec'), getRoleDashboard);

module.exports = router;
