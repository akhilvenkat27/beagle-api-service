const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const { validateHubspotWebhook } = require('../middleware/validate');
const {
  getPendingDeals,
  rejectPendingDeal,
  markDealIntaken,
  hubspotDealWebhook,
  hubspotWebhook,
} = require('../controllers/intakeController');

router.get('/pending-deals', auth, roleGuard('admin'), getPendingDeals);
router.post('/pending-deals/:dealId/reject', auth, roleGuard('admin'), rejectPendingDeal);
router.post('/pending-deals/:dealId/intaken', auth, roleGuard('admin'), markDealIntaken);
router.post('/hubspot-deal-webhook', hubspotDealWebhook);
router.post('/hubspot-webhook', auth, roleGuard('admin'), validateHubspotWebhook, hubspotWebhook);

module.exports = router;
