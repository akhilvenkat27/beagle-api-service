const express = require('express');
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const {
  getPeople,
  upsertAllocation,
  deleteAllocation,
  getAvailability,
  getUtilisationSummary,
} = require('../controllers/resourceController');

const router = express.Router();

router.get(
  '/people',
  auth,
  roleGuard('admin', 'pmo', 'dh', 'pm', 'exec'),
  getPeople
);
router.post(
  '/allocate',
  auth,
  roleGuard('admin', 'pmo', 'dh', 'pm', 'exec'),
  upsertAllocation
);
router.delete(
  '/allocate/:id',
  auth,
  roleGuard('admin', 'pmo', 'dh', 'pm', 'exec'),
  deleteAllocation
);
router.get(
  '/availability',
  auth,
  roleGuard('admin', 'pmo', 'dh', 'pm', 'exec'),
  getAvailability
);
router.get(
  '/utilisation-summary',
  auth,
  roleGuard('admin', 'pmo', 'dh', 'pm', 'exec'),
  getUtilisationSummary
);

module.exports = router;
