const { buildProjectMatrix, isValidId } = require('../services/matrixService');
const { assertUserCanViewProject } = require('./projectController');

const getProjectMatrix = async (req, res) => {
  try {
    const { projectId } = req.params;
    if (!projectId || !isValidId(projectId)) {
      return res.status(400).json({ message: 'Valid projectId required' });
    }

    if (!['admin', 'pmo', 'exec'].includes(req.user.role)) {
      const access = await assertUserCanViewProject(req, projectId);
      if (!access.ok) {
        return res.status(access.status).json({ message: access.message });
      }
    }

    const matrix = await buildProjectMatrix(projectId);
    res.json(matrix);
  } catch (err) {
    console.error('Matrix build error:', err);
    res.status(500).json({ message: err.message || 'Matrix build failed' });
  }
};

module.exports = { getProjectMatrix };
