const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const { validateAuthRegister, validateLogin } = require('../middleware/validate');
const {
  register,
  login,
  getMe,
  behaveAs,
} = require('../controllers/authController');

/**
 * POST /api/auth/register - Register new user (admin only)
 */
router.post('/register', auth, roleGuard('admin'), validateAuthRegister, register);

/**
 * POST /api/auth/login - Login user
 */
router.post('/login', validateLogin, login);

/**
 * GET /api/auth/me - Get current user
 */
router.get('/me', auth, getMe);

router.post('/behave-as', auth, roleGuard('admin'), behaveAs);

module.exports = router;
