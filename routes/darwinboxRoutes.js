const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const { syncProject, getNonSubmitters, getHealth } = require('../controllers/darwinboxController');

router.post('/sync/:projectId', auth, roleGuard('admin', 'dh', 'pm'), syncProject);
router.get('/non-submitters/:projectId', auth, roleGuard('admin', 'dh', 'pm'), getNonSubmitters);
router.get('/health', auth, roleGuard('admin'), getHealth);

module.exports = router;
