const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const {
  validateProjectCreate,
  validateProjectUpdate,
  validateProjectClone,
} = require('../middleware/validate');
const {
  getProjects,
  getMyProjects,
  getProjectById,
  createProject,
  createProjectWithStructure,
  updateProject,
  deleteProject,
  cloneProject,
} = require('../controllers/projectController');

router.get(
  '/',
  auth,
  roleGuard('admin', 'pmo', 'dh', 'pm', 'exec', 'member', 'client'),
  getProjects
);
router.get('/my', auth, roleGuard('admin', 'pmo', 'dh', 'pm', 'exec', 'member', 'client'), getMyProjects);
router.post('/:id/clone', auth, roleGuard('admin'), validateProjectClone, cloneProject);
router.post('/full', auth, roleGuard('admin'), createProjectWithStructure);
router.get(
  '/:id',
  auth,
  roleGuard('admin', 'pmo', 'dh', 'pm', 'exec', 'member', 'client'),
  getProjectById
);
router.post('/', auth, roleGuard('admin'), validateProjectCreate, createProject);
router.put('/:id', auth, roleGuard('admin'), validateProjectUpdate, updateProject);
router.delete('/:id', auth, roleGuard('admin'), deleteProject);

module.exports = router;
