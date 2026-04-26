const mongoose = require('mongoose');
const {
  calculateProjectFinancials,
  calculatePortfolioFinancials,
} = require('../services/financialService');
const { assertUserCanViewProject } = require('./projectController');

const getProjectFinancials = async (req, res) => {
  try {
    const { projectId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(projectId)) {
      return res.status(400).json({ message: 'Invalid project id' });
    }
    const access = await assertUserCanViewProject(req, projectId);
    if (!access.ok) {
      return res.status(access.status).json({ message: access.message });
    }
    const data = await calculateProjectFinancials(projectId, { skipAlerts: false });
    res.json(data);
  } catch (err) {
    const code = err.message === 'Project not found' ? 404 : 400;
    res.status(code).json({ message: err.message });
  }
};

const getPortfolioFinancials = async (req, res) => {
  try {
    let projectQuery = {};
    if (req.user.role === 'dh') {
      projectQuery = { deliveryHeadId: req.user._id };
    }
    const data = await calculatePortfolioFinancials(projectQuery);
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { getProjectFinancials, getPortfolioFinancials };
