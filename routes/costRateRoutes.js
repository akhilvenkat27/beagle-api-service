const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const { validateCostRateCreate, validateCostRateSupersede } = require('../middleware/validate');
const {
  listCostRates,
  createCostRate,
  supersedeCostRate,
} = require('../controllers/costRateController');

router.get('/', auth, roleGuard('admin'), listCostRates);
router.post('/', auth, roleGuard('admin'), validateCostRateCreate, createCostRate);
router.post('/:id/supersede', auth, roleGuard('admin'), validateCostRateSupersede, supersedeCostRate);

module.exports = router;
