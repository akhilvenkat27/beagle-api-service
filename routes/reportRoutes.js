const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const { validateReportRun, validateReportSave, validateReportSchedule } = require('../middleware/validate');
const reportController = require('../controllers/reportController');

router.post('/run', auth, roleGuard('admin', 'pmo', 'dh', 'pm', 'exec', 'member'), validateReportRun, reportController.runReport);
router.post('/save', auth, roleGuard('admin', 'pmo', 'dh', 'pm', 'exec', 'member'), validateReportSave, reportController.saveReport);
router.get('/', auth, roleGuard('admin', 'pmo', 'dh', 'pm', 'exec', 'member'), reportController.listReports);
router.post('/:id/run', auth, roleGuard('admin', 'pmo', 'dh', 'pm', 'exec', 'member'), reportController.runSavedReport);
router.post('/:id/export', auth, roleGuard('admin', 'pmo', 'dh', 'pm', 'exec', 'member'), reportController.exportSavedReport);
router.post('/:id/schedule', auth, roleGuard('admin', 'pmo', 'dh', 'pm', 'exec'), validateReportSchedule, reportController.scheduleReport);
router.get('/scheduled', auth, roleGuard('admin', 'pmo', 'dh', 'pm', 'exec'), reportController.scheduledReports);
router.get('/pm-leaderboard', auth, roleGuard('admin', 'pmo', 'dh', 'pm'), reportController.getPmLeaderboard);

module.exports = router;
