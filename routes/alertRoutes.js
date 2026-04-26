const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const { listAlerts, markAlertRead, acceptProjectInvite } = require('../controllers/alertController');

router.get('/', auth, roleGuard('admin', 'pmo', 'dh', 'pm', 'exec', 'member'), listAlerts);
router.patch('/:id/accept', auth, roleGuard('admin', 'pmo', 'dh', 'pm', 'exec', 'member'), acceptProjectInvite);
router.patch('/:id/read', auth, roleGuard('admin', 'pmo', 'dh', 'pm', 'exec', 'member'), markAlertRead);

module.exports = router;
