const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const { validateUserCreate, validateUserUpdate } = require('../middleware/validate');
const {
  createUser,
  getAllUsers,
  getUser,
  updateUser,
  deleteUser,
  getClients,
} = require('../controllers/userController');

/**
 * POST /api/users - Create new user (admin only)
 */
router.post('/', auth, roleGuard('admin'), validateUserCreate, createUser);

/**
 * GET /api/users/clients - Get all clients (admin only)
 */
router.get('/clients', auth, roleGuard('admin'), getClients);

/**
 * GET /api/users - Get all users (admin/pmo/dh/pm)
 */
router.get('/', auth, roleGuard('admin', 'pmo', 'dh', 'pm'), getAllUsers);

/**
 * GET /api/users/:id - Get single user (admin only)
 */
router.get('/:id', auth, roleGuard('admin'), getUser);

/**
 * PUT /api/users/:id - Update user (admin only)
 */
router.put('/:id', auth, roleGuard('admin'), validateUserUpdate, updateUser);

/**
 * DELETE /api/users/:id - Delete user (admin only)
 */
router.delete('/:id', auth, roleGuard('admin'), deleteUser);

module.exports = router;
