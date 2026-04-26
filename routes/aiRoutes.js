const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const aiController = require('../controllers/aiController');

/** Delivery + leadership roles that use Module 5 AI (excludes client-only routes). */
const staff = roleGuard('admin', 'pmo', 'dh', 'pm', 'exec', 'member');

router.get(
  '/client-sentiment-view/:projectId',
  auth,
  roleGuard('client'),
  aiController.getClientSentimentView
);

router.post('/cr-impact', auth, staff, aiController.postCrImpact);

router.get('/project-risk/:projectId', auth, staff, aiController.getProjectRisk);
router.get('/weekly-summary/:projectId', auth, staff, aiController.getWeeklySummary);
router.get('/task-flags/:moduleId', auth, staff, aiController.getTaskFlags);
router.post('/chat/:projectId', auth, staff, aiController.askQuestion);

router.get('/pm-score/:projectId', auth, roleGuard('admin'), aiController.getPmScore);
router.get(
  '/margin-forecast/:projectId',
  auth,
  roleGuard('admin', 'pmo', 'dh', 'pm'),
  aiController.getMarginForecast
);
router.get(
  '/resource-overload/:projectId',
  auth,
  roleGuard('admin', 'pmo', 'dh', 'pm'),
  aiController.getResourceOverload
);
router.post('/client-sentiment/:projectId', auth, staff, aiController.postClientSentiment);
router.get('/escalation-risk/:projectId', auth, staff, aiController.getEscalationRisk);
router.post('/scope-check/:projectId', auth, staff, aiController.postScopeCheck);
router.get(
  '/narrative/:projectId',
  auth,
  roleGuard('admin', 'pmo', 'dh', 'pm', 'exec', 'member', 'client'),
  aiController.getNarrative
);
router.patch(
  '/narrative-approve/:projectId',
  auth,
  roleGuard('admin', 'pmo', 'dh', 'pm'),
  aiController.approveNarrative
);
router.post('/raid-extract/:projectId', auth, staff, aiController.postRaidExtract);
router.get('/raid-items/:projectId', auth, staff, aiController.listRaidItems);
router.post('/raid-items/:projectId', auth, staff, aiController.createRaidItem);
router.patch('/raid-item/:raidItemId', auth, staff, aiController.patchRaidItem);
router.get('/sentiment-history/:projectId', auth, staff, aiController.listSentimentHistory);

module.exports = router;
