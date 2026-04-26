const express = require('express');
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const {
  validateProjectTemplateInstantiate,
  validateProjectTemplateUpsert,
} = require('../middleware/validate');
const {
  getCatalog,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  instantiateTemplate,
} = require('../controllers/projectTemplateController');

const router = express.Router();

const READ_ROLES = ['admin', 'pmo', 'dh', 'pm', 'exec'];
const WRITE_ROLES = ['admin', 'pmo'];

router.get('/', auth, roleGuard(...READ_ROLES), getCatalog);
router.post('/', auth, roleGuard(...WRITE_ROLES), validateProjectTemplateUpsert, createTemplate);
router.get('/:templateId', auth, roleGuard(...READ_ROLES), getTemplate);
router.put(
  '/:templateId',
  auth,
  roleGuard(...WRITE_ROLES),
  validateProjectTemplateUpsert,
  updateTemplate
);
router.delete('/:templateId', auth, roleGuard(...WRITE_ROLES), deleteTemplate);

router.post(
  '/:templateId/instantiate',
  auth,
  roleGuard(...READ_ROLES),
  validateProjectTemplateInstantiate,
  instantiateTemplate
);

module.exports = router;
