const mongoose = require('mongoose');
const Workstream = require('../models/Workstream');
const Task = require('../models/Task');
const Module = require('../models/Module');
const Project = require('../models/Project');
const { recordAudit } = require('../middleware/audit');
const { assertUserCanViewProject } = require('./projectController');

const isPmOrAdmin = (user, project) => {
  if (user.role === 'admin') return true;
  const pmId = project.projectManagerId?.toString?.() || project.projectManagerId;
  return pmId && user._id.toString() === pmId;
};

const isLeadOrStaff = (user, workstream) => {
  if (user.role === 'admin' || user.role === 'dh') return true;
  const lid = workstream.leadId?.toString?.() || workstream.leadId;
  return lid && user._id.toString() === lid;
};

function userInWorkstreamTeam(user, ws) {
  if (user.role === 'admin' || user.role === 'dh' || user.role === 'pm' || user.role === 'pmo' || user.role === 'exec') {
    return true;
  }
  if (!ws) return false;
  const uid = user._id.toString();
  const lead = ws.leadId?._id || ws.leadId;
  if (lead && String(lead) === uid) return true;
  const members = ws.memberIds || [];
  for (const m of members) {
    const id = m?._id || m;
    if (id && String(id) === uid) return true;
  }
  return false;
}

function canMemberViewWorkstream(user, ws, assignedStreamIds) {
  if (user.role !== 'member') return true;
  if (userInWorkstreamTeam(user, ws)) return true;
  if (!ws.memberIds || ws.memberIds.length === 0) {
    return assignedStreamIds.has(String(ws._id));
  }
  return false;
}

/** Order tasks: roots (no parent) first, then children under each parent. */
function sortTasksHierarchical(tasks) {
  if (!tasks || !tasks.length) return tasks;
  const byParent = new Map();
  for (const t of tasks) {
    const p = t.parentTaskId ? String(t.parentTaskId) : '';
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(t);
  }
  for (const arr of byParent.values()) {
    arr.sort(
      (a, b) =>
        new Date(a.dueDate) - new Date(b.dueDate) || String(a._id).localeCompare(String(b._id))
    );
  }
  const roots = byParent.get('') || [];
  const out = [];
  const walk = (id) => {
    const ch = byParent.get(String(id)) || [];
    for (const c of ch) {
      out.push(c);
      walk(c._id);
    }
  };
  for (const r of roots) {
    out.push(r);
    walk(r._id);
  }
  return out;
}

// GET /api/workstreams?moduleId=xxx — get workstreams with their tasks
const getWorkstreamsByModule = async (req, res) => {
  try {
    const { moduleId } = req.query;

    if (!moduleId || moduleId === ':moduleId' || !mongoose.Types.ObjectId.isValid(moduleId)) {
      return res.status(400).json({
        message: `Invalid moduleId: "${moduleId}". Must be a valid MongoDB ObjectId.`,
      });
    }

    const modGate = await Module.findById(moduleId).select('projectId');
    if (!modGate) {
      return res.status(404).json({ message: 'Module not found' });
    }

    if (!['admin', 'pmo', 'dh', 'exec'].includes(req.user.role)) {
      const access = await assertUserCanViewProject(req, modGate.projectId);
      if (!access.ok) {
        return res.status(access.status).json({ message: access.message });
      }
    }

    let workstreams = await Workstream.find({ moduleId })
      .sort({ createdAt: 1 })
      .populate('leadId', 'name email role')
      .populate('memberIds', 'name email role');

    if (req.user.role === 'member') {
      const memberTasks = await Task.find({ assignedTo: req.user._id }).select('workstreamId').lean();
      const assignedStreamIds = new Set(memberTasks.map((t) => t.workstreamId.toString()));
      workstreams = workstreams.filter((ws) => canMemberViewWorkstream(req.user, ws, assignedStreamIds));
    }

    const workstreamsWithTasks = await Promise.all(
      workstreams.map(async (ws) => {
        const raw = await Task.find({ workstreamId: ws._id })
          .populate('assignedTo', 'name email')
          .sort({ dueDate: 1 });
        const tasks = sortTasksHierarchical(raw.map((t) => t.toObject()));
        return { ...ws.toObject(), tasks };
      })
    );

    res.json(workstreamsWithTasks);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/workstreams — create a workstream
const createWorkstream = async (req, res) => {
  try {
    const workstream = await Workstream.create(req.body);
    const withLead = await Workstream.findById(workstream._id)
      .populate('leadId', 'name email role')
      .populate('memberIds', 'name email role');
    res.status(201).json(withLead);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// PUT /api/workstreams/:id — update lead, baseline dates, notes (admin/dh)
const updateWorkstream = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid workstream id' });
    }

    const allowed = [
      'leadId',
      'memberIds',
      'baselinePlannedStartDate',
      'baselinePlannedEndDate',
      'actualStartDate',
      'actualEndDate',
      'signOffNotes',
      'budgetHours',
      'costRate',
      'isBlocked',
    ];
    const patch = {};
    for (const k of allowed) {
      if (k in req.body) {
        if (['baselinePlannedStartDate', 'baselinePlannedEndDate', 'actualStartDate', 'actualEndDate'].includes(k)) {
          patch[k] = req.body[k] ? new Date(req.body[k]) : null;
        } else if (k === 'leadId') {
          patch[k] = req.body[k] || null;
        } else if (k === 'memberIds' && Array.isArray(req.body.memberIds)) {
          patch[k] = req.body.memberIds.map((id) => new mongoose.Types.ObjectId(id));
        } else if (k === 'budgetHours' || k === 'costRate') {
          patch[k] = req.body[k] == null || req.body[k] === '' ? 0 : Number(req.body[k]);
        } else if (k === 'isBlocked') {
          patch[k] = Boolean(req.body[k]);
        } else {
          patch[k] = req.body[k];
        }
      }
    }

    const prev = await Workstream.findById(id);
    if (!prev) return res.status(404).json({ message: 'Workstream not found' });

    const ws = await Workstream.findByIdAndUpdate(id, patch, { new: true, runValidators: true })
      .populate('leadId', 'name email role')
      .populate('memberIds', 'name email role');

    const mod = await Module.findById(ws.moduleId);
    await recordAudit({
      entityType: 'Workstream',
      entityId: ws._id,
      action: 'workstream_updated',
      before: {
        leadId: prev.leadId,
        baselinePlannedStartDate: prev.baselinePlannedStartDate,
        baselinePlannedEndDate: prev.baselinePlannedEndDate,
      },
      after: {
        leadId: ws.leadId,
        baselinePlannedStartDate: ws.baselinePlannedStartDate,
        baselinePlannedEndDate: ws.baselinePlannedEndDate,
        name: ws.name,
      },
      actorId: req.user._id,
      actorName: req.user.name,
      projectId: mod?.projectId || null,
    });

    const rawT = await Task.find({ workstreamId: ws._id })
      .populate('assignedTo', 'name email')
      .sort({ dueDate: 1 });
    const tasks = sortTasksHierarchical(rawT.map((t) => t.toObject()));
    res.json({ ...ws.toObject(), tasks });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// PATCH /api/workstreams/:id/request-signoff
const requestSignOff = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid workstream id' });
    }

    const ws = await Workstream.findById(id);
    if (!ws) return res.status(404).json({ message: 'Workstream not found' });

    if (!isLeadOrStaff(req.user, ws)) {
      return res.status(403).json({ message: 'Only the workstream lead (or admin/DH) can request sign-off' });
    }

    const tasks = await Task.find({ workstreamId: id });
    if (tasks.length > 0) {
      const allDone = tasks.every((t) => t.status === 'Done');
      if (!allDone) {
        return res.status(400).json({
          message: 'All tasks in this workstream must be Done before requesting sign-off',
        });
      }
    }

    if (ws.signOffStatus === 'Signed Off') {
      return res.status(400).json({ message: 'Workstream is already signed off' });
    }

    const prevStatus = ws.signOffStatus;
    ws.signOffStatus = 'Requested';
    ws.signOffRequestedAt = new Date();
    if (req.body.notes !== undefined) ws.signOffNotes = String(req.body.notes || '');
    await ws.save();

    const mod = await Module.findById(ws.moduleId);
    const projectId = mod?.projectId;

    await recordAudit({
      entityType: 'Workstream',
      entityId: ws._id,
      action: 'signoff_requested',
      before: { signOffStatus: prevStatus },
      after: { signOffStatus: ws.signOffStatus, name: ws.name },
      actorId: req.user._id,
      actorName: req.user.name,
      projectId,
    });

    const populated = await Workstream.findById(ws._id)
      .populate('leadId', 'name email role')
      .populate('memberIds', 'name email role');
    const rawOut = await Task.find({ workstreamId: id })
      .populate('assignedTo', 'name email')
      .sort({ dueDate: 1 });
    const tasksOut = sortTasksHierarchical(rawOut.map((t) => t.toObject()));
    res.json({ ...populated.toObject(), tasks: tasksOut });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// PATCH /api/workstreams/:id/complete-signoff
const completeSignOff = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid workstream id' });
    }

    const ws = await Workstream.findById(id);
    if (!ws) return res.status(404).json({ message: 'Workstream not found' });

    const mod = await Module.findById(ws.moduleId);
    if (!mod) return res.status(404).json({ message: 'Module not found' });

    const project = await Project.findById(mod.projectId);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const isStaffGovernance =
      req.user.role === 'admin' || req.user.role === 'dh' || req.user.role === 'pmo' || req.user.role === 'exec';
    if (!isStaffGovernance && !isPmOrAdmin(req.user, project)) {
      return res
        .status(403)
        .json({ message: 'Only the project PM, admin, DH, PMO, or Exec can complete sign-off' });
    }

    if (ws.signOffStatus !== 'Requested') {
      return res.status(400).json({ message: 'Sign-off must be in Requested state' });
    }

    const prevStatus = ws.signOffStatus;
    ws.signOffStatus = 'Signed Off';
    ws.signOffCompletedAt = new Date();
    if (req.body.notes !== undefined) ws.signOffNotes = String(req.body.notes || ws.signOffNotes || '');
    await ws.save();

    await recordAudit({
      entityType: 'Workstream',
      entityId: ws._id,
      action: 'signoff_completed',
      before: { signOffStatus: prevStatus },
      after: { signOffStatus: ws.signOffStatus, name: ws.name },
      actorId: req.user._id,
      actorName: req.user.name,
      projectId: project._id,
    });

    const populated = await Workstream.findById(ws._id)
      .populate('leadId', 'name email role')
      .populate('memberIds', 'name email role');
    const rawC = await Task.find({ workstreamId: id })
      .populate('assignedTo', 'name email')
      .sort({ dueDate: 1 });
    const tasksOut = sortTasksHierarchical(rawC.map((t) => t.toObject()));
    res.json({ ...populated.toObject(), tasks: tasksOut });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// DELETE /api/workstreams/:id
const deleteWorkstream = async (req, res) => {
  try {
    const workstream = await Workstream.findByIdAndDelete(req.params.id);
    if (!workstream) return res.status(404).json({ message: 'Workstream not found' });
    await Task.deleteMany({ workstreamId: req.params.id });
    res.json({ message: 'Workstream deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  getWorkstreamsByModule,
  createWorkstream,
  updateWorkstream,
  requestSignOff,
  completeSignOff,
  deleteWorkstream,
};
