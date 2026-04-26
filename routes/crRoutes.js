const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const { validateCrCreate } = require('../middleware/validate');
const crController = require('../controllers/crController');

/** Read-only portfolio oversight (exec); create/submit/notify remain delivery roles. */
const crRead = roleGuard('admin', 'pmo', 'exec', 'dh', 'member', 'pm');
const crWrite = roleGuard('admin', 'pmo', 'dh', 'member', 'pm');

router.post('/', auth, crWrite, validateCrCreate, crController.createCr);
router.get('/', auth, crRead, crController.listCrs);
router.get('/:id', auth, crRead, crController.getCr);
router.post('/:id/submit', auth, crWrite, crController.submitCr);
router.post('/:id/approve', auth, roleGuard('admin', 'dh'), crController.approveCr);
router.post('/:id/reject', auth, roleGuard('admin', 'dh'), crController.rejectCr);
router.post('/:id/notify-client', auth, crWrite, crController.notifyClient);

module.exports = router;
