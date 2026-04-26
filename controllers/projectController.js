const mongoose = require('mongoose');
const Project = require('../models/Project');
const Module = require('../models/Module');
const Workstream = require('../models/Workstream');
const Task = require('../models/Task');
const User = require('../models/User');
const BaselineRecord = require('../models/BaselineRecord');
const ChangeRequest = require('../models/ChangeRequest');
const ReviewSession = require('../models/ReviewSession');
const Alert = require('../models/Alert');
const { recordAudit } = require('../middleware/audit');
const darwinboxService = require('../services/darwinboxService');
const { scheduleInitialTier1Review } = require('../services/reviewScheduler');

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const BASELINE_LOCK_MSG = 'Baseline is locked. Submit a Change Request to modify.';

const validateTierOneProjectPayload = (data) => {
  if (data.tier !== 'Tier 1') return null;
  const errs = [];
  const sp = (data.sharePointUrl || '').trim();
  const ap = (data.accountPlaybookUrl || '').trim();
  const cs = (data.csResourceName || '').trim();
  if (!sp) errs.push('sharePointUrl is required for Tier 1 projects');
  else if (!sp.startsWith('https://')) errs.push('sharePointUrl must start with https://');
  if (!ap) errs.push('accountPlaybookUrl is required for Tier 1 projects');
  if (!cs) errs.push('csResourceName is required for Tier 1 projects');
  return errs.length ? errs.join('; ') : null;
};

const validateSharePointIfPresent = (url) => {
  if (url == null || url === '') return null;
  const t = String(url).trim();
  if (t && !t.startsWith('https://')) return 'sharePointUrl must start with https://';
  return null;
};

async function assertEligibleDeliveryHead(userId) {
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    return { ok: false, message: 'deliveryHeadId is required when setting status to Active' };
  }
  const u = await User.findById(userId).select('role');
  if (!u) return { ok: false, message: 'Delivery Head user not found' };
  if (u.role !== 'admin' && u.role !== 'dh') {
    return { ok: false, message: 'Delivery Head must be a user with role admin or dh' };
  }
  return { ok: true };
}

async function assertEligibleProjectManager(userId) {
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    return { ok: false, message: 'projectManagerId is required when setting status to Active' };
  }
  const u = await User.findById(userId).select('role');
  if (!u) return { ok: false, message: 'Project Manager user not found' };
  if (u.role !== 'admin' && u.role !== 'member' && u.role !== 'pm') {
    return { ok: false, message: 'Project Manager must be a user with role admin, member, or pm' };
  }
  return { ok: true };
}

async function attachBaselineMeta(projectDoc) {
  const baseline = await BaselineRecord.findOne({ projectId: projectDoc._id }).sort({
    version: -1,
  });
  const obj = projectDoc.toObject ? projectDoc.toObject() : { ...projectDoc };
  obj.baselineLocked = !!baseline;
  if (baseline) {
    obj.baselineVersion = baseline.version;
    obj.baselineLockedAt = baseline.lockedAt;
  }
  return obj;
}

/**
 * Batch stats builder to avoid N+1 module/workstream/task queries per project.
 */
async function buildProjectStatsBatch(projectDocs, { includeBaseline = false } = {}) {
  if (!projectDocs.length) return [];

  const projectIds = projectDocs.map((p) => p._id);
  const modules = await Module.find({ projectId: { $in: projectIds } }).select('_id projectId').lean();
  const moduleIds = modules.map((m) => m._id);
  const moduleProjectById = new Map(modules.map((m) => [m._id.toString(), m.projectId.toString()]));

  const workstreams = await Workstream.find({ moduleId: { $in: moduleIds } }).select('_id moduleId').lean();
  const workstreamIds = workstreams.map((w) => w._id);
  const workstreamProjectById = new Map();
  workstreams.forEach((w) => {
    const pid = moduleProjectById.get(w.moduleId.toString());
    if (pid) workstreamProjectById.set(w._id.toString(), pid);
  });

  const tasks = await Task.find({ workstreamId: { $in: workstreamIds } })
    .select('status dueDate loggedHours workstreamId')
    .lean();

  const now = Date.now();
  const statsByProject = new Map();
  const ensure = (pid) => {
    if (!statsByProject.has(pid)) {
      statsByProject.set(pid, {
        totalTasks: 0,
        completedTasks: 0,
        overdueTasks: 0,
        totalLoggedHours: 0,
      });
    }
    return statsByProject.get(pid);
  };

  tasks.forEach((t) => {
    const pid = workstreamProjectById.get(t.workstreamId.toString());
    if (!pid) return;
    const s = ensure(pid);
    s.totalTasks += 1;
    if (t.status === 'Done') s.completedTasks += 1;
    if (t.status !== 'Done' && t.dueDate && new Date(t.dueDate).getTime() < now) s.overdueTasks += 1;
    s.totalLoggedHours += Number(t.loggedHours) || 0;
  });

  projectIds.forEach((id) => ensure(id.toString()));

  let baselineSet = new Set();
  if (includeBaseline) {
    const baselineRows = await BaselineRecord.find({ projectId: { $in: projectIds } })
      .select('projectId')
      .lean();
    baselineSet = new Set(baselineRows.map((b) => b.projectId.toString()));
  }

  return projectDocs.map((project) => {
    const key = project._id.toString();
    const s = statsByProject.get(key) || {
      totalTasks: 0,
      completedTasks: 0,
      overdueTasks: 0,
      totalLoggedHours: 0,
    };
    const progress = s.totalTasks > 0 ? Math.round((s.completedTasks / s.totalTasks) * 100) : 0;
    return {
      ...project.toObject(),
      ...(includeBaseline ? { baselineLocked: baselineSet.has(key) } : {}),
      stats: { ...s, progress },
    };
  });
}

// GET /api/projects — list all projects with summary stats
const getProjects = async (req, res) => {
  try {
    let query = {};

    if (req.user.role === 'client') {
      query._id = { $in: req.user.projectIds || [] };
    } else if (req.user.role === 'member') {
      const memberProjectIds = await getMemberAccessibleProjectIds(req.user._id);
      if (memberProjectIds.size === 0) {
        query._id = { $in: [] };
      } else {
        query._id = { $in: [...memberProjectIds].map((id) => new mongoose.Types.ObjectId(id)) };
      }
    } else if (req.user.role === 'pm') {
      query.projectManagerId = req.user._id;
    } else if (req.user.role === 'dh') {
      query.deliveryHeadId = req.user._id;
    }
    // admin, pmo, exec: full portfolio

    const projects = await Project.find(query).sort({ createdAt: -1 });
    const projectsWithStats = await buildProjectStatsBatch(projects, { includeBaseline: true });

    res.json(projectsWithStats);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * Projects a member can see: profile projectIds plus any project reached via
 * assigned tasks or workstream membership (memberIds / lead).
 */
async function getMemberAccessibleProjectIds(userId) {
  const user = await User.findById(userId).select('projectIds').lean();
  const fromProfile = (user?.projectIds || []).map((id) => id.toString());

  const assignedWs = await Task.distinct('workstreamId', { assignedTo: userId });
  const teamWsDocs = await Workstream.find({
    $or: [{ memberIds: userId }, { leadId: userId }],
  })
    .select('_id')
    .lean();
  const wsSet = new Set([...assignedWs.map(String), ...teamWsDocs.map((w) => w._id.toString())]);
  const allWs = [...wsSet].map((s) => new mongoose.Types.ObjectId(s));

  let fromActivity = [];
  if (allWs.length) {
    const modIds = await Workstream.find({ _id: { $in: allWs } }).distinct('moduleId');
    if (modIds.length) {
      const projIds = await Module.find({ _id: { $in: modIds } }).distinct('projectId');
      fromActivity = projIds.map(String);
    }
  }
  return new Set([...fromProfile, ...fromActivity]);
}

/** Workstream ids used for GET /tasks/my and execution “All tasks” (team + legacy assigned-only streams). */
async function getMemberMyTasksWorkstreamIds(userId) {
  const fromTeam = await Workstream.find({
    $or: [{ memberIds: userId }, { leadId: userId }],
  }).distinct('_id');
  const assignedWss = await Task.distinct('workstreamId', { assignedTo: userId });
  // Assigned tasks must always appear in member All Tasks, even if older workstreams
  // have stale memberIds that do not include the assignee.
  const set = new Set([...fromTeam.map(String), ...assignedWss.map(String)]);
  return [...set].map((s) => new mongoose.Types.ObjectId(s));
}

/**
 * Project ids a user may see alerts for. `null` = unrestricted (admin / PMO / exec).
 */
async function getUserAlertProjectScope(req) {
  const role = req.user.role;
  if (['admin', 'pmo', 'exec'].includes(role)) return null;
  if (role === 'dh') {
    const rows = await Project.find({ deliveryHeadId: req.user._id }).select('_id').lean();
    return new Set(rows.map((r) => r._id.toString()));
  }
  if (role === 'pm') {
    const rows = await Project.find({ projectManagerId: req.user._id }).select('_id').lean();
    return new Set(rows.map((r) => r._id.toString()));
  }
  if (role === 'client') {
    return new Set((req.user.projectIds || []).map((id) => id.toString()));
  }
  if (role === 'member') {
    return await getMemberAccessibleProjectIds(req.user._id);
  }
  return new Set();
}

// GET /api/projects/my — admin/pmo/exec: full portfolio; client: projectIds; member: profile + activity; PM/DH: portfolio
const getMyProjects = async (req, res) => {
  try {
    const role = req.user.role;

    if (role === 'pm') {
      const projects = await Project.find({ projectManagerId: req.user._id }).sort({ createdAt: -1 });
      const projectsWithStats = await buildProjectStatsBatch(projects, { includeBaseline: false });
      return res.json(projectsWithStats);
    }

    if (role === 'dh') {
      const projects = await Project.find({ deliveryHeadId: req.user._id }).sort({ createdAt: -1 });
      const projectsWithStats = await buildProjectStatsBatch(projects, { includeBaseline: false });
      return res.json(projectsWithStats);
    }

    if (role === 'member') {
      const ids = await getMemberAccessibleProjectIds(req.user._id);
      if (ids.size === 0) return res.json([]);
      const projects = await Project.find({
        _id: { $in: [...ids].map((id) => new mongoose.Types.ObjectId(id)) },
      }).sort({ createdAt: -1 });
      const projectsWithStats = await buildProjectStatsBatch(projects, { includeBaseline: false });
      return res.json(projectsWithStats);
    }

    if (['admin', 'pmo', 'exec'].includes(role)) {
      const projects = await Project.find({}).sort({ createdAt: -1 });
      const projectsWithStats = await buildProjectStatsBatch(projects, { includeBaseline: false });
      return res.json(projectsWithStats);
    }

    if (role === 'client') {
      const user = await User.findById(req.user._id).select('projectIds');
      if (!user) return res.status(404).json({ message: 'User not found' });
      if (!user.projectIds || user.projectIds.length === 0) {
        return res.json([]);
      }
      const projects = await Project.find({
        _id: { $in: user.projectIds },
      }).sort({ createdAt: -1 });
      const projectsWithStats = await buildProjectStatsBatch(projects, { includeBaseline: false });
      return res.json(projectsWithStats);
    }

    return res.status(403).json({ message: 'Unsupported role for this endpoint' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * Shared project visibility for detail-style endpoints (project page, command centre, etc.).
 * @returns {Promise<{ ok: true } | { ok: false, status: number, message: string }>}
 */
const assertUserCanViewProject = async (req, projectId) => {
  if (!isValidId(projectId)) {
    return { ok: false, status: 400, message: 'Invalid project ID format' };
  }
  const project = await Project.findById(projectId).select('projectManagerId deliveryHeadId');
  if (!project) {
    return { ok: false, status: 404, message: 'Project not found' };
  }
  if (req.user.role === 'client') {
    const assignedIds = (req.user.projectIds || []).map((id) => id.toString());
    if (!assignedIds.includes(project._id.toString())) {
      return { ok: false, status: 403, message: 'Access denied' };
    }
  } else if (req.user.role === 'member') {
    const allowed = await getMemberAccessibleProjectIds(req.user._id);
    if (!allowed.has(project._id.toString())) {
      return { ok: false, status: 403, message: 'Access denied' };
    }
  } else if (req.user.role === 'pm') {
    const pmId = project.projectManagerId;
    if (!pmId || String(pmId) !== String(req.user._id)) {
      return { ok: false, status: 403, message: 'Access denied' };
    }
  } else if (req.user.role === 'dh') {
    const dhId = project.deliveryHeadId;
    if (!dhId || String(dhId) !== String(req.user._id)) {
      return { ok: false, status: 403, message: 'Access denied' };
    }
  }
  return { ok: true };
};

// GET /api/projects/:id — single project
const getProjectById = async (req, res) => {
  try {
    const access = await assertUserCanViewProject(req, req.params.id);
    if (!access.ok) {
      return res.status(access.status).json({ message: access.message });
    }
    const project = await Project.findById(req.params.id)
      .populate('deliveryHeadId', 'name email role')
      .populate('projectManagerId', 'name email role')
      .populate('clientUserId', 'name email role');

    if (!project) return res.status(404).json({ message: 'Project not found' });

    const payload = await attachBaselineMeta(project);
    res.json(payload);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/projects — create project
const createProject = async (req, res) => {
  try {
    const { clientUserId, ...projectData } = req.body;

    if (clientUserId) projectData.clientUserId = clientUserId;

    const tierErr = validateTierOneProjectPayload(projectData);
    if (tierErr) return res.status(400).json({ message: tierErr });

    const spErr = validateSharePointIfPresent(projectData.sharePointUrl);
    if (spErr) return res.status(400).json({ message: spErr });

    if (projectData.status === 'Active') {
      const dhCheck = await assertEligibleDeliveryHead(projectData.deliveryHeadId);
      if (!dhCheck.ok) return res.status(400).json({ message: dhCheck.message });
      const pmCheck = await assertEligibleProjectManager(projectData.projectManagerId);
      if (!pmCheck.ok) return res.status(400).json({ message: pmCheck.message });
    }

    const project = await Project.create(projectData);

    if (clientUserId && mongoose.Types.ObjectId.isValid(clientUserId)) {
      await User.findByIdAndUpdate(clientUserId, { $addToSet: { projectIds: project._id } });
    }

    if (project.status === 'Active') {
      await BaselineRecord.create({
        projectId: project._id,
        contractValue: project.contractValue,
        notionalARR: project.notionalARR ?? 0,
        lockedBy: req.user._id,
        version: 1,
      });
      await recordAudit({
        entityType: 'Project',
        entityId: project._id,
        action: 'project_baseline_locked',
        before: null,
        after: {
          contractValue: project.contractValue,
          notionalARR: project.notionalARR ?? 0,
          version: 1,
        },
        actorId: req.user._id,
        actorName: req.user.name,
        projectId: project._id,
      });
    }

    if (project.tier === 'Tier 1') {
      try {
        await scheduleInitialTier1Review(project._id);
      } catch (e) {
        console.error('[Tier1] scheduleInitialTier1Review failed:', e.message);
      }
    }

    res.status(201).json(project);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// POST /api/projects/full — create project + modules + workstreams + tasks in one wizard submit
const createProjectWithStructure = async (req, res) => {
  try {
    const {
      clientUserId,
      modules = [],
      customerTeam = [],
      projectTeam = [],
      ...projectData
    } = req.body || {};

    const cleanModules = Array.isArray(modules) ? modules : [];
    if (!projectData.name || String(projectData.name).trim().length < 2) {
      return res.status(400).json({ message: 'Project name is required' });
    }
    if (!projectData.clientName || String(projectData.clientName).trim().length < 1) {
      return res.status(400).json({ message: 'Customer name is required' });
    }
    const goLive = new Date(projectData.goLiveDate);
    if (Number.isNaN(goLive.getTime())) {
      return res.status(400).json({ message: 'Due date is required' });
    }

    if (clientUserId) projectData.clientUserId = clientUserId;
    projectData.name = String(projectData.name).trim();
    projectData.clientName = String(projectData.clientName).trim();
    projectData.goLiveDate = goLive;
    projectData.contractValue = Number(projectData.contractValue || 0);
    projectData.implementationFee = Number(projectData.implementationFee ?? projectData.contractValue) || 0;
    projectData.notionalARR = Number(projectData.notionalARR || 0);
    projectData.region = projectData.region || 'India';
    projectData.status = projectData.status || 'Draft';
    projectData.tier = projectData.tier || 'Tier 2';
    projectData.deliveryPhase = projectData.deliveryPhase || 'Sales Handover';

    const tierErr = validateTierOneProjectPayload(projectData);
    if (tierErr) return res.status(400).json({ message: tierErr });
    const spErr = validateSharePointIfPresent(projectData.sharePointUrl);
    if (spErr) return res.status(400).json({ message: spErr });

    if (projectData.status === 'Active') {
      const dhCheck = await assertEligibleDeliveryHead(projectData.deliveryHeadId);
      if (!dhCheck.ok) return res.status(400).json({ message: dhCheck.message });
      const pmCheck = await assertEligibleProjectManager(projectData.projectManagerId);
      if (!pmCheck.ok) return res.status(400).json({ message: pmCheck.message });
    }

    const project = await Project.create(projectData);

    if (clientUserId && mongoose.Types.ObjectId.isValid(clientUserId)) {
      await User.findByIdAndUpdate(clientUserId, { $addToSet: { projectIds: project._id } });
    }

    const teamIds = new Set();
    projectTeam.forEach((id) => {
      if (mongoose.Types.ObjectId.isValid(String(id))) teamIds.add(String(id));
    });

    for (const m of cleanModules) {
      const modName = String(m.name || '').trim();
      if (!modName) continue;
      const mod = await Module.create({
        name: modName,
        projectId: project._id,
        budgetHours: Number(m.budgetHours || 0),
        status: 'Not Started',
      });

      for (const w of Array.isArray(m.workstreams) ? m.workstreams : []) {
        const wsName = String(w.name || '').trim();
        if (!wsName) continue;
        const memberIds = (Array.isArray(w.memberIds) ? w.memberIds : [])
          .filter((id) => mongoose.Types.ObjectId.isValid(String(id)));
        memberIds.forEach((id) => teamIds.add(String(id)));
        const leadId = mongoose.Types.ObjectId.isValid(String(w.leadId))
          ? w.leadId
          : projectData.projectManagerId || req.user._id;

        const ws = await Workstream.create({
          name: wsName,
          moduleId: mod._id,
          leadId,
          memberIds,
          budgetHours: Number(w.budgetHours || 0),
          costRate: Number(w.costRate || 0),
          baselinePlannedStartDate: projectData.startDate ? new Date(projectData.startDate) : null,
          baselinePlannedEndDate: goLive,
        });

        for (const t of Array.isArray(w.tasks) ? w.tasks : []) {
          const title = String(t.title || '').trim();
          if (!title) continue;
          const due = t.dueDate ? new Date(t.dueDate) : goLive;
          const assignedTo = mongoose.Types.ObjectId.isValid(String(t.assignedTo)) ? t.assignedTo : null;
          if (assignedTo) teamIds.add(String(assignedTo));
          await Task.create({
            title,
            owner: String(t.owner || req.user.name || 'Project Manager').trim(),
            status: 'Not Started',
            dueDate: Number.isNaN(due.getTime()) ? goLive : due,
            loggedHours: 0,
            workstreamId: ws._id,
            assignedTo,
            billable: t.billable !== false,
          });
        }
      }
    }

    const inviteRecipients = [...teamIds].filter((id) => id && String(id) !== String(req.user._id));
    if (inviteRecipients.length) {
      await Promise.all(
        inviteRecipients.map((recipientId) =>
          Alert.create({
            type: 'ProjectInvite',
            projectId: project._id,
            severity: 'Warning',
            message: `${req.user.name || 'A project owner'} invited you to ${project.name}.`,
            recipients: [recipientId],
            data: {
              status: 'pending',
              invitedBy: req.user._id,
              projectName: project.name,
            },
          })
        )
      );
    }

    if (project.status === 'Active') {
      await BaselineRecord.create({
        projectId: project._id,
        contractValue: project.contractValue,
        notionalARR: project.notionalARR ?? 0,
        lockedBy: req.user._id,
        version: 1,
      });
      await recordAudit({
        entityType: 'Project',
        entityId: project._id,
        action: 'project_baseline_locked',
        before: null,
        after: {
          contractValue: project.contractValue,
          notionalARR: project.notionalARR ?? 0,
          version: 1,
        },
        actorId: req.user._id,
        actorName: req.user.name,
        projectId: project._id,
      });
    }

    if (project.tier === 'Tier 1') {
      try {
        await scheduleInitialTier1Review(project._id);
      } catch (e) {
        console.error('[Tier1] scheduleInitialTier1Review (full create) failed:', e.message);
      }
    }

    const populated = await Project.findById(project._id)
      .populate('deliveryHeadId', 'name email role')
      .populate('projectManagerId', 'name email role')
      .populate('clientUserId', 'name email role');

    res.status(201).json({
      project: populated,
      created: {
        modules: cleanModules.length,
        teamMembers: teamIds.size,
        customerTeam: Array.isArray(customerTeam) ? customerTeam.length : 0,
      },
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// PUT /api/projects/:id — update project
const updateProject = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid project ID format' });
    }

    const { clientUserId, ...projectData } = req.body;
    const oldProject = await Project.findById(req.params.id);
    if (!oldProject) return res.status(404).json({ message: 'Project not found' });

    const baseline = await BaselineRecord.findOne({ projectId: oldProject._id }).sort({
      version: -1,
    });

    if (baseline) {
      if (
        'contractValue' in projectData &&
        Number(projectData.contractValue) !== Number(oldProject.contractValue)
      ) {
        return res.status(403).json({ message: BASELINE_LOCK_MSG });
      }
      if (
        'notionalARR' in projectData &&
        Number(projectData.notionalARR) !== Number(oldProject.notionalARR)
      ) {
        return res.status(403).json({ message: BASELINE_LOCK_MSG });
      }
      if (
        'implementationFee' in projectData &&
        Number(projectData.implementationFee) !== Number(oldProject.implementationFee ?? 0)
      ) {
        return res.status(403).json({ message: BASELINE_LOCK_MSG });
      }
    }

    const merged = {
      ...oldProject.toObject(),
      ...projectData,
    };

    const tierErr = validateTierOneProjectPayload(merged);
    if (tierErr) return res.status(400).json({ message: tierErr });

    const spErr = validateSharePointIfPresent(
      projectData.sharePointUrl !== undefined
        ? projectData.sharePointUrl
        : oldProject.sharePointUrl
    );
    if (spErr) return res.status(400).json({ message: spErr });

    const nextStatus = projectData.status !== undefined ? projectData.status : oldProject.status;
    const activating = nextStatus === 'Active' && oldProject.status !== 'Active';

    const effectiveDh =
      projectData.deliveryHeadId !== undefined
        ? projectData.deliveryHeadId
        : oldProject.deliveryHeadId;
    const effectivePm =
      projectData.projectManagerId !== undefined
        ? projectData.projectManagerId
        : oldProject.projectManagerId;

    if (activating) {
      const dhCheck = await assertEligibleDeliveryHead(effectiveDh);
      if (!dhCheck.ok) return res.status(400).json({ message: dhCheck.message });
      const pmCheck = await assertEligibleProjectManager(effectivePm);
      if (!pmCheck.ok) return res.status(400).json({ message: pmCheck.message });
    }

    if (clientUserId && oldProject.clientUserId?.toString() !== clientUserId) {
      if (oldProject.clientUserId) {
        await User.findByIdAndUpdate(oldProject.clientUserId, {
          $pull: { projectIds: oldProject._id },
        });
      }
      await User.findByIdAndUpdate(clientUserId, { $addToSet: { projectIds: oldProject._id } });
      projectData.clientUserId = clientUserId;
    } else if (clientUserId) {
      projectData.clientUserId = clientUserId;
    }

    const project = await Project.findByIdAndUpdate(req.params.id, projectData, {
      new: true,
      runValidators: true,
    })
      .populate('deliveryHeadId', 'name email role')
      .populate('projectManagerId', 'name email role');

    let createdBaseline = false;
    if (activating) {
      const existingBaseline = await BaselineRecord.findOne({ projectId: project._id });
      if (!existingBaseline) {
        await BaselineRecord.create({
          projectId: project._id,
          contractValue: project.contractValue,
          notionalARR: project.notionalARR ?? 0,
          lockedBy: req.user._id,
          version: 1,
        });
        createdBaseline = true;
      }
    }

    if (projectData.status !== undefined && projectData.status !== oldProject.status) {
      await recordAudit({
        entityType: 'Project',
        entityId: project._id,
        action: 'status_changed',
        before: { status: oldProject.status, name: oldProject.name },
        after: { status: project.status, name: project.name },
        actorId: req.user._id,
        actorName: req.user.name,
        projectId: project._id,
      });
    }

    if (createdBaseline) {
      await recordAudit({
        entityType: 'Project',
        entityId: project._id,
        action: 'project_baseline_locked',
        before: null,
        after: {
          contractValue: project.contractValue,
          notionalARR: project.notionalARR ?? 0,
          version: 1,
        },
        actorId: req.user._id,
        actorName: req.user.name,
        projectId: project._id,
      });
    }

    if (activating) {
      try {
        const mods = await Module.find({ projectId: project._id }).lean();
        const wss = await Workstream.find({ moduleId: { $in: mods.map((m) => m._id) } }).lean();
        await darwinboxService.pushProjectTags(project._id, mods, wss);
        await Project.findByIdAndUpdate(project._id, { darwinboxTagsPushedAt: new Date() });
      } catch (dbxErr) {
        // eslint-disable-next-line no-console
        console.error('[Darwinbox] pushProjectTags on activation failed:', dbxErr.message || dbxErr);
      }
    }

    const projectForPayload = await Project.findById(req.params.id)
      .populate('deliveryHeadId', 'name email role')
      .populate('projectManagerId', 'name email role')
      .populate('clientUserId', 'name email role');

    const payload = await attachBaselineMeta(projectForPayload || project);
    res.json(payload);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// POST /api/projects/:id/clone — copy module + workstream tree only (FR-M1-04)
const cloneProject = async (req, res) => {
  try {
    const sourceId = req.params.id;
    if (!isValidId(sourceId)) {
      return res.status(400).json({ message: 'Invalid project ID format' });
    }

    const {
      name,
      clientName,
      goLiveDate,
      contractValue,
      notionalARR = 0,
      status = 'Draft',
      tier = 'Tier 2',
    } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: 'name is required for the new project' });
    }
    if (!clientName || !String(clientName).trim()) {
      return res.status(400).json({ message: 'clientName is required for the new project' });
    }
    if (!goLiveDate) {
      return res.status(400).json({ message: 'goLiveDate is required for the new project' });
    }
    if (contractValue == null || Number(contractValue) < 0) {
      return res.status(400).json({ message: 'contractValue is required (non-negative) for the new project' });
    }

    const tierErr = validateTierOneProjectPayload({ ...req.body, tier });
    if (tierErr) return res.status(400).json({ message: tierErr });

    const spErr = validateSharePointIfPresent(req.body.sharePointUrl);
    if (spErr) return res.status(400).json({ message: spErr });

    const source = await Project.findById(sourceId);
    if (!source) return res.status(404).json({ message: 'Source project not found' });

    const newProject = await Project.create({
      name: String(name).trim(),
      clientName: String(clientName).trim(),
      goLiveDate: new Date(goLiveDate),
      contractValue: Number(contractValue),
      implementationFee: Number(req.body.implementationFee ?? contractValue) || 0,
      notionalARR: Number(notionalARR) || 0,
      region: req.body.region || source.region || 'India',
      status,
      tier,
      deliveryPhase: source.deliveryPhase || 'Build & Integration',
      sharePointUrl: req.body.sharePointUrl || '',
      accountPlaybookUrl: req.body.accountPlaybookUrl || '',
      csResourceName: req.body.csResourceName || '',
      hubspotDealId: null,
      deliveryHeadId: null,
      projectManagerId: null,
      clientUserId: null,
    });

    const oldModules = await Module.find({ projectId: sourceId }).sort({ createdAt: 1 });
    const moduleIdMap = new Map();

    for (const m of oldModules) {
      const nm = await Module.create({
        name: m.name,
        projectId: newProject._id,
        budgetHours: m.budgetHours,
      });
      moduleIdMap.set(m._id.toString(), nm._id);
    }

    for (const m of oldModules) {
      const newModId = moduleIdMap.get(m._id.toString());
      const wss = await Workstream.find({ moduleId: m._id }).sort({ createdAt: 1 });
      for (const w of wss) {
        await Workstream.create({
          name: w.name,
          moduleId: newModId,
          budgetHours: w.budgetHours ?? 0,
          costRate: w.costRate ?? 0,
        });
      }
    }

    const populated = await Project.findById(newProject._id);
    if (newProject.tier === 'Tier 1') {
      try {
        await scheduleInitialTier1Review(newProject._id);
      } catch (e) {
        console.error('[Tier1] scheduleInitialTier1Review (clone) failed:', e.message);
      }
    }
    res.status(201).json(populated);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// DELETE /api/projects/:id — delete project and cascade
const deleteProject = async (req, res) => {
  try {
    const project = await Project.findByIdAndDelete(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const modules = await Module.find({ projectId: req.params.id });
    const moduleIds = modules.map((m) => m._id);
    const workstreams = await Workstream.find({ moduleId: { $in: moduleIds } });
    const workstreamIds = workstreams.map((w) => w._id);

    await Task.deleteMany({ workstreamId: { $in: workstreamIds } });
    await Workstream.deleteMany({ moduleId: { $in: moduleIds } });
    await Module.deleteMany({ projectId: req.params.id });
    await BaselineRecord.deleteMany({ projectId: req.params.id });
    await ChangeRequest.deleteMany({ projectId: req.params.id });
    await ReviewSession.deleteMany({ projectId: req.params.id });

    res.json({ message: 'Project deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  getProjects,
  getMyProjects,
  getProjectById,
  getMemberAccessibleProjectIds,
  getMemberMyTasksWorkstreamIds,
  getUserAlertProjectScope,
  assertUserCanViewProject,
  createProject,
  createProjectWithStructure,
  updateProject,
  deleteProject,
  cloneProject,
  validateTierOneProjectPayload,
  validateSharePointIfPresent,
  assertEligibleDeliveryHead,
  assertEligibleProjectManager,
};
