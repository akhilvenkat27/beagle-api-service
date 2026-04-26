const mongoose = require('mongoose');
const Project = require('../models/Project');
const SyncLog = require('../models/SyncLog');
const darwinboxService = require('../services/darwinboxService');
const { calculateProjectFinancials } = require('../services/financialService');
const { assertUserCanViewProject } = require('./projectController');

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

/**
 * POST /api/darwinbox/sync/:projectId
 * Pulls approved hours from mock Darwinbox, updates tasks, margin alerts, project sync metadata.
 */
const syncProject = async (req, res) => {
  const { projectId } = req.params;
  if (!isValidId(projectId)) {
    return res.status(400).json({ message: 'Invalid project id' });
  }

  const project = await Project.findById(projectId);
  if (!project) return res.status(404).json({ message: 'Project not found' });

  const access = await assertUserCanViewProject(req, projectId);
  if (!access.ok) {
    return res.status(access.status).json({ message: access.message });
  }

  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  let status = 'success';
  let recordsProcessed = 0;
  let recordsFailed = 0;
  let errorMessage = '';

  try {
    const pulled = await darwinboxService.getApprovedHours(projectId, from, to, { mutate: true });
    const applied = await darwinboxService.applyApprovedHoursFromEntries(pulled.entries);
    recordsProcessed = applied.updatedCount;
    recordsFailed = applied.failedCount;
    if (recordsFailed > 0 && recordsProcessed > 0) status = 'partial';
    if (recordsFailed > 0 && recordsProcessed === 0) status = 'failed';

    await calculateProjectFinancials(projectId, { skipAlerts: false });

    await Project.findByIdAndUpdate(projectId, {
      lastSyncAt: new Date(),
      lastSyncRecords: recordsProcessed,
    });

    await SyncLog.create({
      projectId,
      syncType: 'timesheets',
      status,
      recordsProcessed,
      recordsFailed,
      errorMessage,
      syncedAt: new Date(),
    });

    const updated = await Project.findById(projectId).select('lastSyncAt lastSyncRecords darwinboxTagsPushedAt name');

    return res.json({
      ok: true,
      lastSyncAt: updated.lastSyncAt,
      recordsSynced: recordsProcessed,
      totalApprovedLines: pulled.entries.length,
      status,
      recordsFailed,
      project: updated,
    });
  } catch (err) {
    errorMessage = err.message || 'Sync failed';
    await SyncLog.create({
      projectId,
      syncType: 'timesheets',
      status: 'failed',
      recordsProcessed: 0,
      recordsFailed: 0,
      errorMessage,
      syncedAt: new Date(),
    });
    return res.status(500).json({ message: errorMessage });
  }
};

const getNonSubmitters = async (req, res) => {
  try {
    const { projectId } = req.params;
    if (!isValidId(projectId)) {
      return res.status(400).json({ message: 'Invalid project id' });
    }
    const project = await Project.findById(projectId).select('_id');
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const access = await assertUserCanViewProject(req, projectId);
    if (!access.ok) {
      return res.status(access.status).json({ message: access.message });
    }

    const data = await darwinboxService.getNonSubmitters(projectId);
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getHealth = async (req, res) => {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const recentLogs = await SyncLog.find({ syncedAt: { $gte: dayAgo } }).sort({ syncedAt: -1 }).lean();
    const lastLog = await SyncLog.findOne().sort({ syncedAt: -1 }).lean();

    const logsLastHour = recentLogs.filter((l) => new Date(l.syncedAt) >= oneHourAgo);
    const recordsLastHour = logsLastHour.reduce((s, l) => s + (l.recordsProcessed || 0), 0);
    const failedSyncs = logsLastHour.filter((l) => l.status === 'failed').length;
    const successCount = logsLastHour.filter((l) => l.status === 'success').length;
    const totalRecent = logsLastHour.length || 1;
    const successRate = Math.round((successCount / totalRecent) * 1000) / 10;

    const projects = await Project.find({})
      .select('name status lastSyncAt lastSyncRecords darwinboxTagsPushedAt')
      .sort({ name: 1 })
      .lean();

    const fortyEightH = 48 * 60 * 60 * 1000;
    const projectStatuses = projects.map((p) => {
      let st = 'unknown';
      if (p.lastSyncAt && Date.now() - new Date(p.lastSyncAt).getTime() < fortyEightH) st = 'healthy';
      else if (p.status === 'Active' && p.darwinboxTagsPushedAt && !p.lastSyncAt) st = 'pending_sync';
      else if (p.status === 'Active' && p.lastSyncAt) st = 'stale';
      return {
        projectId: p._id,
        name: p.name,
        status: p.status,
        lastSyncAt: p.lastSyncAt,
        lastSyncRecords: p.lastSyncRecords,
        darwinboxTagsPushedAt: p.darwinboxTagsPushedAt,
        integrationStatus: st,
      };
    });

    const overall =
      failedSyncs === 0 && lastLog?.status !== 'failed'
        ? 'healthy'
        : failedSyncs > 2
          ? 'degraded'
          : 'healthy';

    res.json({
      lastSync: lastLog?.syncedAt || null,
      status: overall,
      recordsLastHour,
      failedSyncs,
      successRateLastHour: successRate,
      projectStatuses,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { syncProject, getNonSubmitters, getHealth };
