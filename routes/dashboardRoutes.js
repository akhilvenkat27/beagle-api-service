const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const { getCommandCentre, getRoleDashboard } = require('../controllers/dashboardController');

router.get(
  '/command-centre/:projectId',
  auth,
  roleGuard('admin', 'pmo', 'dh', 'pm', 'exec', 'member', 'client'),
  getCommandCentre
);

router.get('/:role', auth, roleGuard('admin', 'pmo', 'dh', 'pm', 'exec'), getRoleDashboard);

module.exports = router;
