const express = require('express');
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const { validateProjectTemplateInstantiate } = require('../middleware/validate');
const { getCatalog, instantiateTemplate } = require('../controllers/projectTemplateController');

const router = express.Router();

router.get('/', auth, roleGuard('admin', 'pmo', 'dh', 'pm', 'exec'), getCatalog);
router.post(
  '/:templateId/instantiate',
  auth,
  roleGuard('admin', 'pmo', 'dh', 'pm', 'exec'),
  validateProjectTemplateInstantiate,
  instantiateTemplate
);

module.exports = router;
