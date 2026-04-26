const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const reviewController = require('../controllers/reviewController');

const gov = roleGuard('admin', 'dh', 'pm');

router.get('/', auth, gov, reviewController.listReviews);
router.patch('/:id/complete', auth, gov, reviewController.completeReview);

module.exports = router;
