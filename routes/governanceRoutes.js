const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const governanceController = require('../controllers/governanceController');

const gov = roleGuard('admin', 'pmo', 'dh');

router.get(
  '/compliance/:projectId',
  auth,
  roleGuard('admin', 'pmo', 'dh', 'pm'),
  governanceController.getCompliance
);
router.get('/dashboard', auth, gov, governanceController.getDashboard);

module.exports = router;
