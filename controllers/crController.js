const mongoose = require('mongoose');
const ChangeRequest = require('../models/ChangeRequest');
const Project = require('../models/Project');
const Module = require('../models/Module');
const Workstream = require('../models/Workstream');
const Task = require('../models/Task');
const User = require('../models/User');
const BaselineRecord = require('../models/BaselineRecord');
const AuditLog = require('../models/AuditLog');
const { recordAudit } = require('../middleware/audit');
const aiService = require('../services/aiService');
const { calculateProjectFinancials } = require('../services/financialService');
const { getMemberAccessibleProjectIds } = require('./projectController');

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

async function assertProjectAccess(user, projectId) {
  const project = await Project.findById(projectId)
    .populate('deliveryHeadId', 'name email')
    .populate('projectManagerId', 'name email');
  if (!project) return { error: 'notfound' };
  if (user.role === 'admin' || user.role === 'pmo' || user.role === 'exec') return { project };
  if (user.role === 'dh') {
    const dhId = project.deliveryHeadId?._id?.toString?.() || project.deliveryHeadId?.toString?.();
    if (dhId === user._id.toString()) return { project };
    return { error: 'forbidden' };
  }
  if (user.role === 'pm') {
    const pmId = project.projectManagerId?._id?.toString?.() || project.projectManagerId?.toString?.();
    if (pmId === user._id.toString()) return { project };
    return { error: 'forbidden' };
  }
  if (user.role === 'member') {
    const ids = await getMemberAccessibleProjectIds(user._id);
    if (!ids.has(String(projectId))) return { error: 'forbidden' };
    return { project };
  }
  return { error: 'forbidden' };
}

async function assertDhForProject(user, project) {
  if (user.role === 'admin') return true;
  const dhId = project.deliveryHeadId?._id?.toString?.() || project.deliveryHeadId?.toString?.();
  if (user.role === 'dh' && dhId === user._id.toString()) return true;
  return false;
}

const createCr = async (req, res) => {
  try {
    const {
      projectId,
      title,
      description = '',
      scopeDescription = '',
      affectedWorkstreams = [],
    } = req.body;
    if (!isValidId(projectId)) return res.status(400).json({ error: 'Invalid project id' });
    if (!title || !String(title).trim()) return res.status(400).json({ error: 'title is required' });

    const { project, error } = await assertProjectAccess(req.user, projectId);
    if (error === 'notfound') return res.status(404).json({ error: 'Project not found' });
    if (error) return res.status(403).json({ error: 'Access denied' });

    const cr = await ChangeRequest.create({
      projectId,
      title: String(title).trim(),
      description: String(description).trim(),
      scopeDescription: String(scopeDescription).trim(),
      affectedWorkstreams: Array.isArray(affectedWorkstreams)
        ? affectedWorkstreams.map((s) => String(s).trim()).filter(Boolean)
        : [],
      requestedBy: req.user._id,
      status: 'Draft',
    });

    await recordAudit({
      entityType: 'CR',
      entityId: cr._id,
      action: 'cr_created',
      before: null,
      after: { title: cr.title, status: cr.status },
      actorId: req.user._id,
      actorName: req.user.name,
      projectId: cr.projectId,
    });

    res.status(201).json(cr);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

const listCrs = async (req, res) => {
  try {
    const { projectId } = req.query;
    if (!projectId || !isValidId(projectId)) {
      return res.status(400).json({ error: 'projectId query is required' });
    }
    const { error } = await assertProjectAccess(req.user, projectId);
    if (error === 'notfound') return res.status(404).json({ error: 'Project not found' });
    if (error) return res.status(403).json({ error: 'Access denied' });

    const rows = await ChangeRequest.find({ projectId })
      .sort({ createdAt: -1 })
      .populate('requestedBy', 'name email')
      .populate('dhApprovalBy', 'name email')
      .lean();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const getCr = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ error: 'Invalid id' });
    const cr = await ChangeRequest.findById(id)
      .populate('requestedBy', 'name email role')
      .populate('dhApprovalBy', 'name email role');
    if (!cr) return res.status(404).json({ error: 'Change request not found' });

    const { error } = await assertProjectAccess(req.user, cr.projectId.toString());
    if (error === 'notfound') return res.status(404).json({ error: 'Project not found' });
    if (error) return res.status(403).json({ error: 'Access denied' });

    const history = await AuditLog.find({ entityType: 'CR', entityId: cr._id })
      .sort({ timestamp: -1 })
      .limit(100)
      .lean();

    res.json({ cr, history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const submitCr = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ error: 'Invalid id' });
    const cr = await ChangeRequest.findById(id);
    if (!cr) return res.status(404).json({ error: 'Change request not found' });

    const { project, error } = await assertProjectAccess(req.user, cr.projectId.toString());
    if (error) return res.status(403).json({ error: 'Access denied' });

    if (cr.status !== 'Draft') {
      return res.status(400).json({ error: 'Only Draft CRs can be submitted' });
    }
    const pmOk =
      cr.requestedBy.toString() === req.user._id.toString() ||
      project.projectManagerId?._id?.toString() === req.user._id.toString() ||
      req.user.role === 'admin' ||
      req.user.role === 'dh';
    if (!pmOk) return res.status(403).json({ error: 'Only the requester or PM can submit' });

    let impact = { impactDays: 0, impactCost: 0, impactMarginShift: 0, recommendation: '' };
    try {
      impact = await aiService.calculateCrImpact(cr.projectId.toString(), {
        title: cr.title,
        description: cr.description,
        scopeDescription: cr.scopeDescription,
        affectedWorkstreams: cr.affectedWorkstreams,
      });
    } catch (aiErr) {
      console.error('[CR submit] AI impact failed:', aiErr.message);
    }

    const latestBaseline = await BaselineRecord.findOne({ projectId: cr.projectId }).sort({ version: -1 }).lean();

    cr.status = 'Pending Approval';
    cr.impactDays = impact.impactDays;
    cr.impactCost = impact.impactCost;
    cr.impactMarginShift = impact.impactMarginShift;
    cr.aiRecommendation = impact.recommendation;
    cr.baselineVersionBefore = latestBaseline?.version ?? null;
    await cr.save();

    await recordAudit({
      entityType: 'CR',
      entityId: cr._id,
      action: 'cr_submitted',
      before: { status: 'Draft' },
      after: {
        status: cr.status,
        impactDays: cr.impactDays,
        impactCost: cr.impactCost,
        impactMarginShift: cr.impactMarginShift,
      },
      actorId: req.user._id,
      actorName: req.user.name,
      projectId: cr.projectId,
    });

    res.json(cr);
  } catch (err) {
    if (err.message === 'AI unavailable') return res.status(503).json({ error: 'AI unavailable' });
    res.status(400).json({ error: err.message });
  }
};

const approveCr = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ error: 'Invalid id' });
    const cr = await ChangeRequest.findById(id);
    if (!cr) return res.status(404).json({ error: 'Change request not found' });

    const project = await Project.findById(cr.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    if (!(await assertDhForProject(req.user, project))) {
      return res.status(403).json({ error: 'Only Delivery Head or admin can approve' });
    }

    if (cr.status !== 'Pending Approval') {
      return res.status(400).json({ error: 'CR is not pending approval' });
    }

    const prev = await BaselineRecord.findOne({ projectId: cr.projectId }).sort({ version: -1 }).lean();
    const nextVersion = (prev?.version || 0) + 1;

    await BaselineRecord.create({
      projectId: cr.projectId,
      contractValue: project.contractValue,
      notionalARR: project.notionalARR ?? 0,
      lockedBy: req.user._id,
      version: nextVersion,
    });

    cr.status = 'Approved';
    cr.dhApprovalBy = req.user._id;
    cr.dhApprovalAt = new Date();
    cr.dhRejectionReason = '';
    cr.baselineVersionAfter = nextVersion;
    await cr.save();

    await recordAudit({
      entityType: 'CR',
      entityId: cr._id,
      action: 'cr_approved',
      before: { status: 'Pending Approval', baselineVersion: prev?.version },
      after: { status: 'Approved', baselineVersionAfter: nextVersion },
      actorId: req.user._id,
      actorName: req.user.name,
      projectId: cr.projectId,
    });

    try {
      await calculateProjectFinancials(cr.projectId.toString(), { skipAlerts: false });
    } catch (finErr) {
      console.error('[CR approve] financial recalc:', finErr.message);
    }

    res.json(cr);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

const rejectCr = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    if (!isValidId(id)) return res.status(400).json({ error: 'Invalid id' });
    const cr = await ChangeRequest.findById(id);
    if (!cr) return res.status(404).json({ error: 'Change request not found' });

    const project = await Project.findById(cr.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!(await assertDhForProject(req.user, project))) {
      return res.status(403).json({ error: 'Only Delivery Head or admin can reject' });
    }
    if (cr.status !== 'Pending Approval') {
      return res.status(400).json({ error: 'CR is not pending approval' });
    }
    if (!reason || !String(reason).trim()) return res.status(400).json({ error: 'reason is required' });

    cr.status = 'Rejected';
    cr.dhRejectionReason = String(reason).trim();
    cr.dhApprovalBy = req.user._id;
    cr.dhApprovalAt = new Date();
    await cr.save();

    await recordAudit({
      entityType: 'CR',
      entityId: cr._id,
      action: 'cr_rejected',
      before: { status: 'Pending Approval' },
      after: { status: 'Rejected', reason: cr.dhRejectionReason },
      actorId: req.user._id,
      actorName: req.user.name,
      projectId: cr.projectId,
    });

    res.json(cr);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

const notifyClient = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ error: 'Invalid id' });
    const cr = await ChangeRequest.findById(id);
    if (!cr) return res.status(404).json({ error: 'Change request not found' });

    const { error } = await assertProjectAccess(req.user, cr.projectId.toString());
    if (error) return res.status(403).json({ error: 'Access denied' });

    if (!['Approved', 'Pending Approval'].includes(cr.status)) {
      return res.status(400).json({ error: 'Client notification allowed for pending or approved CRs' });
    }

    cr.clientNotified = true;
    cr.clientNotifiedAt = new Date();
    await cr.save();

    await recordAudit({
      entityType: 'CR',
      entityId: cr._id,
      action: 'cr_client_notified',
      before: { clientNotified: false },
      after: { clientNotified: true },
      actorId: req.user._id,
      actorName: req.user.name,
      projectId: cr.projectId,
    });

    res.json(cr);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

module.exports = {
  createCr,
  listCrs,
  getCr,
  submitCr,
  approveCr,
  rejectCr,
  notifyClient,
};
