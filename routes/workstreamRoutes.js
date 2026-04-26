const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const { validateWorkstreamCreate, validateWorkstreamUpdate } = require('../middleware/validate');
const {
  getWorkstreamsByModule,
  createWorkstream,
  updateWorkstream,
  requestSignOff,
  completeSignOff,
  deleteWorkstream,
} = require('../controllers/workstreamController');

router.get('/', auth, getWorkstreamsByModule); // ?moduleId=xxx
router.post('/', auth, roleGuard('admin', 'dh'), validateWorkstreamCreate, createWorkstream);
router.put('/:id', auth, roleGuard('admin', 'dh'), validateWorkstreamUpdate, updateWorkstream);
router.patch('/:id/request-signoff', auth, roleGuard('admin', 'dh', 'member'), requestSignOff);
router.patch('/:id/complete-signoff', auth, roleGuard('admin', 'pm', 'pmo', 'exec', 'dh'), completeSignOff);
router.delete('/:id', auth, roleGuard('admin', 'dh'), deleteWorkstream);

module.exports = router;
