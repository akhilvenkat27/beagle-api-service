const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const {
  validateTaskCreate,
  validateTaskUpdate,
  validateLogHours,
  validateBulkTasks,
} = require('../middleware/validate');
const {
  getMyTasks,
  getTasksByWorkstream,
  createTask,
  updateTask,
  logHours,
  bulkUpdateTasks,
  deleteTask,
  listTaskPresets,
  applyTaskPreset,
} = require('../controllers/taskController');

// GET /api/tasks/my — tasks scoped to logged-in member (BUG 4 FIX — must be before /:id)
router.get('/my', auth, roleGuard('member', 'pm', 'admin', 'dh'), getMyTasks);

// GET /api/tasks/presets — built-in recurring task patterns
router.get('/presets', auth, listTaskPresets);

// POST /api/tasks/apply-preset — instantiate a preset under a workstream
router.post('/apply-preset', auth, roleGuard('admin', 'dh', 'pm'), applyTaskPreset);

// GET tasks by workstream (all roles, filtered by role)
router.get('/', auth, getTasksByWorkstream);

// PATCH bulk (must be before /:id routes). PM is allowed but limited to a
// single project — controller enforces the cross-project restriction.
router.patch('/bulk', auth, roleGuard('admin', 'pmo', 'dh', 'pm'), validateBulkTasks, bulkUpdateTasks);

// POST task (admin, DH, project PM on their projects)
router.post('/', auth, roleGuard('admin', 'dh', 'pm'), validateTaskCreate, createTask);

// PUT task (admin/dh: any task, member: own tasks only)
router.put('/:id', auth, roleGuard('admin', 'dh', 'member'), validateTaskUpdate, updateTask);

// PATCH log hours (admin/dh, member on own tasks)
router.patch('/:id/log-hours', auth, roleGuard('admin', 'dh', 'member'), validateLogHours, logHours);

// DELETE task (admin, dh)
router.delete('/:id', auth, roleGuard('admin', 'dh'), deleteTask);

module.exports = router;
