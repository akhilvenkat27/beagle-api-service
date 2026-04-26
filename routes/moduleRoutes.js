const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const {
  validateModuleCreate,
  validateModuleUpdate,
  validateModuleDependencies,
} = require('../middleware/validate');
const {
  getModulesByProject,
  createModule,
  updateModule,
  deleteModule,
  setModuleDependencies,
  getModuleDependencyStatus,
} = require('../controllers/moduleController');

router.get('/', auth, getModulesByProject); // ?projectId=xxx
router.post('/', auth, roleGuard('admin', 'dh'), validateModuleCreate, createModule);
router.get('/:id/dependency-status', auth, roleGuard('admin', 'dh'), getModuleDependencyStatus);
router.post('/:id/dependencies', auth, roleGuard('admin'), validateModuleDependencies, setModuleDependencies);
router.put('/:id', auth, roleGuard('admin', 'dh'), validateModuleUpdate, updateModule);
router.delete('/:id', auth, roleGuard('admin', 'dh'), deleteModule);

module.exports = router;
