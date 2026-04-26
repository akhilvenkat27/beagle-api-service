const mongoose = require('mongoose');
const Project = require('../models/Project');
const { assertUserCanViewProject } = require('./projectController');
const Module = require('../models/Module');
const Workstream = require('../models/Workstream');
const Task = require('../models/Task');
const ChangeRequest = require('../models/ChangeRequest');
const ReviewSession = require('../models/ReviewSession');
const AuditLog = require('../models/AuditLog');
const darwinboxService = require('../services/darwinboxService');

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

function assertComplianceAccess(user) {
  return user.role === 'admin' || user.role === 'pmo' || user.role === 'dh';
}

async function assertProjectForDh(user, projectId) {
  const project = await Project.findById(projectId).select('deliveryHeadId');
  if (!project) return { error: 'notfound' };
  if (user.role === 'admin' || user.role === 'pmo') return { ok: true };
  if (user.role === 'dh' && project.deliveryHeadId?.toString() === user._id.toString()) return { ok: true };
  return { error: 'forbidden' };
}

async function computeComplianceForProject(projectId) {
  const violations = [];
  const project = await Project.findById(projectId).select('lastSyncAt name');
  if (!project) return null;

  let timesheetSubmissionRate = 75;
  try {
    const { nonSubmitters } = await darwinboxService.getNonSubmitters(projectId);
    const modules = await Module.find({ projectId });
    const wss = await Workstream.find({ moduleId: { $in: modules.map((m) => m._id) } });
    const tasks = await Task.find({ workstreamId: { $in: wss.map((w) => w._id) } });
    const assigneeIds = new Set(
      tasks.map((t) => t.assignedTo?.toString()).filter(Boolean)
    );
    const pool = Math.max(1, assigneeIds.size || 3);
    const ns = Array.isArray(nonSubmitters) ? nonSubmitters.length : 0;
    timesheetSubmissionRate = Math.max(0, Math.min(100, Math.round(100 - (ns / pool) * 100)));
  } catch {
    timesheetSubmissionRate = 70;
  }
  if (project.lastSyncAt) {
    const daysSinceSync = (Date.now() - new Date(project.lastSyncAt).getTime()) / 86400000;
    if (daysSinceSync > 10) {
      violations.push('Timesheet sync is stale (>10 days without Darwinbox pull)');
      timesheetSubmissionRate = Math.min(timesheetSubmissionRate, 55);
    }
  } else {
    violations.push('No Darwinbox timesheet sync recorded for this project');
    timesheetSubmissionRate = Math.min(timesheetSubmissionRate, 50);
  }

  const crs = await ChangeRequest.find({ projectId }).lean();
  const rejected = crs.filter((c) => c.status === 'Rejected').length;
  const approved = crs.filter((c) => c.status === 'Approved').length;
  const pendingOld = crs.filter(
    (c) =>
      c.status === 'Pending Approval' &&
      c.updatedAt &&
      Date.now() - new Date(c.updatedAt).getTime() > 14 * 86400000
  ).length;
  let crProcessAdherence = 100;
  if (rejected + approved > 0) {
    crProcessAdherence = Math.round(100 - (rejected / (rejected + approved)) * 40);
  }
  if (pendingOld > 0) {
    crProcessAdherence = Math.min(crProcessAdherence, 60);
    violations.push(`${pendingOld} change request(s) pending DH approval beyond 14 days`);
  }

  const twoWeeksAgo = new Date(Date.now() - 14 * 86400000);
  const statusAudits = await AuditLog.countDocuments({
    projectId,
    action: 'status_changed',
    timestamp: { $gte: twoWeeksAgo },
  });
  let weeklyStatusSubmission = Math.min(100, 40 + statusAudits * 15);
  if (statusAudits === 0) {
    weeklyStatusSubmission = 45;
    violations.push('No project status transitions logged in the last 2 weeks');
  }

  const modules = await Module.find({ projectId });
  const wss = await Workstream.find({ moduleId: { $in: modules.map((m) => m._id) } });
  const signed = wss.filter((w) => w.signOffStatus === 'Signed Off').length;
  const signOffCompleteness =
    wss.length === 0 ? 100 : Math.round((signed / wss.length) * 100);
  if (signOffCompleteness < 100) {
    violations.push(`${wss.length - signed} workstream(s) without final sign-off`);
  }

  const tasks = await Task.find({
    workstreamId: { $in: wss.map((w) => w._id) },
  });
  const overdue7 = tasks.filter((t) => {
    if (t.status === 'Done') return false;
    const d = new Date(t.dueDate);
    return Date.now() - d.getTime() > 7 * 86400000;
  });
  const overdueTaskRate =
    tasks.length === 0 ? 0 : Math.round((overdue7.length / tasks.length) * 100);
  if (overdue7.length >= 3) {
    violations.push(`${overdue7.length} tasks overdue > 7 days (consider At Risk / CR)`);
  }

  const metrics = {
    timesheetSubmissionRate,
    crProcessAdherence,
    weeklyStatusSubmission,
    signOffCompleteness,
    overdueTaskRate,
  };

  const overallScore = Math.round(
    (metrics.timesheetSubmissionRate +
      metrics.crProcessAdherence +
      metrics.weeklyStatusSubmission +
      metrics.signOffCompleteness +
      (100 - metrics.overdueTaskRate)) /
      5
  );

  return {
    overallScore: Math.max(0, Math.min(100, overallScore)),
    metrics,
    violations,
  };
}

const getCompliance = async (req, res) => {
  try {
    const { projectId } = req.params;
    if (!isValidId(projectId)) return res.status(400).json({ error: 'Invalid project id' });
    const access = await assertUserCanViewProject(req, projectId);
    if (!access.ok) {
      return res.status(access.status).json({ error: access.message || 'Access denied' });
    }

    const data = await computeComplianceForProject(projectId);
    if (!data) return res.status(404).json({ error: 'Project not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const getDashboard = async (req, res) => {
  try {
    if (!assertComplianceAccess(req.user)) return res.status(403).json({ error: 'Access denied' });

    const { region, tier, dh, status } = req.query;
    const q = {};
    if (region) q.region = region;
    if (tier) q.tier = tier;
    if (status) q.status = status;
    if (dh && mongoose.Types.ObjectId.isValid(dh)) q.deliveryHeadId = dh;

    let projects = await Project.find(q)
      .populate('deliveryHeadId', 'name email')
      .populate('projectManagerId', 'name email')
      .sort({ createdAt: -1 })
      .lean();

    if (req.user.role === 'dh') {
      projects = projects.filter((p) => p.deliveryHeadId?._id?.toString() === req.user._id.toString());
    }

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const rows = await Promise.all(
      projects.map(async (p) => {
        const overdueReviews = await ReviewSession.countDocuments({
          projectId: p._id,
          $or: [
            { status: 'Missed' },
            { status: 'Upcoming', scheduledDate: { $lt: startOfToday } },
          ],
        });
        const openCrs = await ChangeRequest.countDocuments({
          projectId: p._id,
          status: { $in: ['Draft', 'Pending Approval'] },
        });
        let nonSubmitters = 0;
        try {
          const ns = await darwinboxService.getNonSubmitters(p._id);
          nonSubmitters = Array.isArray(ns.nonSubmitters) ? ns.nonSubmitters.length : 0;
        } catch {
          nonSubmitters = 0;
        }
        const compliance = await computeComplianceForProject(p._id.toString());
        return {
          projectId: p._id,
          name: p.name,
          clientName: p.clientName,
          region: p.region,
          tier: p.tier,
          status: p.status,
          deliveryHeadName: p.deliveryHeadId?.name || '—',
          overdueReviews,
          nonSubmittedTimesheets: nonSubmitters,
          openCRs: openCrs,
          complianceScore: compliance?.overallScore ?? null,
        };
      })
    );

    res.json({ projects: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { getCompliance, getDashboard, computeComplianceForProject };
