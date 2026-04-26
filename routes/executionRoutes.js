const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const { getAllTasksVista, getResourceSnapshot } = require('../controllers/executionController');

const staff = roleGuard('admin', 'pmo', 'dh', 'pm', 'exec', 'member');

router.get('/all-tasks', auth, staff, getAllTasksVista);
router.get(
  '/resource-snapshot',
  auth,
  roleGuard('admin', 'pmo', 'dh', 'exec', 'pm', 'member'),
  getResourceSnapshot
);

module.exports = router;
