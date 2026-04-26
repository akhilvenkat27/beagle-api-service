const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const { getProjectMatrix } = require('../controllers/matrixController');

/** Senior delivery roles only — members and client portal excluded. */
router.get(
  '/:projectId',
  auth,
  roleGuard('admin', 'pmo', 'dh', 'pm', 'exec'),
  getProjectMatrix
);

module.exports = router;
