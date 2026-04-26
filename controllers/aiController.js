const mongoose = require('mongoose');
const aiService = require('../services/aiService');

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const getProjectRisk = async (req, res) => {
  try {
    const { projectId } = req.params;
    if (!isValidId(projectId)) return res.status(400).json({ error: 'Invalid project id' });
    const riskAnalysis = await aiService.getProjectRisk(projectId);
    res.json(riskAnalysis);
  } catch (err) {
    console.error('Controller error:', err.message);
    res.status(503).json({ error: 'AI unavailable' });
  }
};

const getWeeklySummary = async (req, res) => {
  try {
    const { projectId } = req.params;
    if (!isValidId(projectId)) return res.status(400).json({ error: 'Invalid project id' });
    const summary = await aiService.getWeeklySummary(projectId);
    res.json(summary);
  } catch (err) {
    console.error('Controller error:', err.message);
    res.status(503).json({ error: 'AI unavailable' });
  }
};

const getTaskFlags = async (req, res) => {
  try {
    const { moduleId } = req.params;
    if (!isValidId(moduleId)) return res.status(400).json({ error: 'Invalid module id' });
    const flags = await aiService.getTaskFlags(moduleId);
    res.json(flags);
  } catch (err) {
    console.error('Controller error:', err.message);
    res.status(503).json({ error: 'AI unavailable' });
  }
};

const askQuestion = async (req, res) => {
  try {
    const { projectId } = req.params;
    if (!isValidId(projectId)) return res.status(400).json({ error: 'Invalid project id' });
    const { question } = req.body;

    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return res.status(400).json({ error: 'Question is required' });
    }

    const response = await aiService.askProjectQuestion(projectId, question);
    res.json(response);
  } catch (err) {
    console.error('Controller error:', err.message);
    res.status(503).json({ error: 'AI unavailable' });
  }
};

const getPmScore = async (req, res) => {
  try {
    const { projectId } = req.params;
    if (!isValidId(projectId)) return res.status(400).json({ error: 'Invalid project id' });
    const data = await aiService.getPmScore(projectId);
    res.json(data);
  } catch (err) {
    console.error('Controller error:', err.message);
    res.status(503).json({ error: 'AI unavailable' });
  }
};

const getMarginForecast = async (req, res) => {
  try {
    const { projectId } = req.params;
    if (!isValidId(projectId)) return res.status(400).json({ error: 'Invalid project id' });
    const data = await aiService.getMarginForecast(projectId);
    res.json(data);
  } catch (err) {
    console.error('Controller error:', err.message);
    res.status(503).json({ error: 'AI unavailable' });
  }
};

const getResourceOverload = async (req, res) => {
  try {
    const { projectId } = req.params;
    if (!isValidId(projectId)) return res.status(400).json({ error: 'Invalid project id' });
    const data = await aiService.getResourceOverload(projectId);
    res.json(data);
  } catch (err) {
    console.error('Controller error:', err.message);
    res.status(503).json({ error: 'AI unavailable' });
  }
};

const postClientSentiment = async (req, res) => {
  try {
    const { projectId } = req.params;
    if (!isValidId(projectId)) return res.status(400).json({ error: 'Invalid project id' });
    const { emailContent } = req.body;
    const data = await aiService.postClientSentiment(projectId, emailContent, req.user._id);
    if (req.user.role === 'client') {
      const { sentimentScore, ...rest } = data;
      return res.json(rest);
    }
    res.json(data);
  } catch (err) {
    if (err.message === 'emailContent is required' || err.message === 'Project not found') {
      return res.status(400).json({ error: err.message });
    }
    console.error('Controller error:', err.message);
    res.status(503).json({ error: 'AI unavailable' });
  }
};

const getEscalationRisk = async (req, res) => {
  try {
    const { projectId } = req.params;
    if (!isValidId(projectId)) return res.status(400).json({ error: 'Invalid project id' });
    const data = await aiService.getEscalationRisk(projectId);
    res.json(data);
  } catch (err) {
    console.error('Controller error:', err.message);
    res.status(503).json({ error: 'AI unavailable' });
  }
};

const postScopeCheck = async (req, res) => {
  try {
    const { projectId } = req.params;
    if (!isValidId(projectId)) return res.status(400).json({ error: 'Invalid project id' });
    const { emailContent } = req.body;
    const data = await aiService.postScopeCheck(projectId, emailContent);
    res.json(data);
  } catch (err) {
    if (err.message === 'emailContent is required') {
      return res.status(400).json({ error: err.message });
    }
    console.error('Controller error:', err.message);
    res.status(503).json({ error: 'AI unavailable' });
  }
};

const getNarrative = async (req, res) => {
  try {
    const { projectId } = req.params;
    if (!isValidId(projectId)) return res.status(400).json({ error: 'Invalid project id' });

    if (req.user.role === 'client') {
      const pid = String(projectId);
      const assignedIds = (req.user.projectIds || []).map((id) => id.toString());
      if (!assignedIds.includes(pid)) {
        return res.status(403).json({ error: 'Access denied' });
      }
      const data = await aiService.getClientApprovedNarrative(projectId);
      return res.json(data);
    }

    const audience = (req.query.audience || 'pm').toLowerCase();
    const data = await aiService.getNarrative(projectId, audience);
    res.json(data);
  } catch (err) {
    if (err.message === 'Invalid audience') return res.status(400).json({ error: err.message });
    if (err.message === 'Project not found') return res.status(404).json({ error: err.message });
    console.error('Controller error:', err.message);
    res.status(503).json({ error: 'AI unavailable' });
  }
};

const approveNarrative = async (req, res) => {
  try {
    const { projectId } = req.params;
    if (!isValidId(projectId)) return res.status(400).json({ error: 'Invalid project id' });
    const p = await aiService.approveClientNarrative(projectId);
    res.json({ ok: true, clientNarrativeApprovedAt: p.clientNarrativeApprovedAt });
  } catch (err) {
    if (err.message === 'Project not found') return res.status(404).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
};

const postRaidExtract = async (req, res) => {
  try {
    const { projectId } = req.params;
    if (!isValidId(projectId)) return res.status(400).json({ error: 'Invalid project id' });
    const { notes } = req.body;
    const data = await aiService.postRaidExtract(projectId, notes, req.user._id);
    res.json(data);
  } catch (err) {
    if (err.message === 'notes are required' || err.message === 'Project not found') {
      return res.status(400).json({ error: err.message });
    }
    console.error('Controller error:', err.message);
    res.status(503).json({ error: 'AI unavailable' });
  }
};

const listRaidItems = async (req, res) => {
  try {
    const { projectId } = req.params;
    if (!isValidId(projectId)) return res.status(400).json({ error: 'Invalid project id' });
    const rows = await aiService.listRaidItems(projectId);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const createRaidItem = async (req, res) => {
  try {
    const { projectId } = req.params;
    if (!isValidId(projectId)) return res.status(400).json({ error: 'Invalid project id' });
    const row = await aiService.createManualRaidItem(projectId, req.body);
    res.status(201).json(row);
  } catch (err) {
    if (err.message === 'description is required') return res.status(400).json({ error: err.message });
    res.status(400).json({ error: err.message });
  }
};

const patchRaidItem = async (req, res) => {
  try {
    const { raidItemId } = req.params;
    if (!isValidId(raidItemId)) return res.status(400).json({ error: 'Invalid raid item id' });
    const row = await aiService.updateRaidItem(raidItemId, req.body);
    res.json(row);
  } catch (err) {
    if (err.message === 'RAID item not found') return res.status(404).json({ error: err.message });
    res.status(400).json({ error: err.message });
  }
};

const listSentimentHistory = async (req, res) => {
  try {
    const { projectId } = req.params;
    if (!isValidId(projectId)) return res.status(400).json({ error: 'Invalid project id' });
    const rows = await aiService.listSentimentHistory(projectId, 4);
    res.json({ history: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const getClientSentimentView = async (req, res) => {
  try {
    const { projectId } = req.params;
    if (!isValidId(projectId)) return res.status(400).json({ error: 'Invalid project id' });
    const data = await aiService.getClientVisibleSentiment(projectId, req.user._id);
    res.json(data);
  } catch (err) {
    if (err.message === 'Forbidden') return res.status(403).json({ error: 'Access denied' });
    res.status(500).json({ error: err.message });
  }
};

const postCrImpact = async (req, res) => {
  try {
    const { projectId, title, description, scopeDescription, affectedWorkstreams } = req.body;
    if (!isValidId(projectId)) return res.status(400).json({ error: 'Invalid project id' });
    const data = await aiService.calculateCrImpact(projectId, {
      title,
      description,
      scopeDescription,
      affectedWorkstreams,
    });
    res.json(data);
  } catch (err) {
    console.error('Controller error:', err.message);
    res.status(503).json({ error: 'AI unavailable' });
  }
};

module.exports = {
  getProjectRisk,
  getWeeklySummary,
  getTaskFlags,
  askQuestion,
  getPmScore,
  getMarginForecast,
  getResourceOverload,
  postClientSentiment,
  getEscalationRisk,
  postScopeCheck,
  getNarrative,
  approveNarrative,
  postRaidExtract,
  listRaidItems,
  createRaidItem,
  patchRaidItem,
  listSentimentHistory,
  getClientSentimentView,
  postCrImpact,
};
