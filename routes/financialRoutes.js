const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const {
  getProjectFinancials,
  getPortfolioFinancials,
} = require('../controllers/financialController');

router.get(
  '/project/:projectId',
  auth,
  roleGuard('admin', 'pmo', 'dh', 'pm'),
  getProjectFinancials
);
router.get('/portfolio', auth, roleGuard('admin', 'pmo', 'dh'), getPortfolioFinancials);

module.exports = router;
