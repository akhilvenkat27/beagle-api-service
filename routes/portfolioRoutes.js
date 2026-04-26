const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const { getPortfolioDrilldown } = require('../controllers/portfolioController');

router.get(
  '/drilldown',
  auth,
  roleGuard('admin', 'pmo', 'dh', 'pm', 'exec', 'member', 'client'),
  getPortfolioDrilldown
);

module.exports = router;
