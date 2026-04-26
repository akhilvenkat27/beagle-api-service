const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const { getAuditByProject, exportAuditCsv } = require('../controllers/auditController');

router.get('/export', auth, roleGuard('admin'), exportAuditCsv);
router.get('/', auth, roleGuard('admin'), getAuditByProject);

module.exports = router;
