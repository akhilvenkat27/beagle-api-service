const Task = require('../models/Task');
const Project = require('../models/Project');
const User = require('../models/User');
const { getMemberMyTasksWorkstreamIds } = require('./projectController');

/**
 * Cross-project task vista (Rocketlane-style "All tasks").
 * Respects RBAC: admin/pmo/exec see org-wide; DH/PM see their portfolio; members see team streams (same as GET /tasks/my).
 */
const getAllTasksVista = async (req, res) => {
  try {
    const role = req.user.role;
    if (role === 'client') {
      return res.status(403).json({ message: 'Not available for client role' });
    }

    const { view } = req.query;

    let allowedProjectIds = null;
    if (role === 'dh') {
      const rows = await Project.find({ deliveryHeadId: req.user._id }).select('_id').lean();
      allowedProjectIds = new Set(rows.map((r) => r._id.toString()));
    } else if (role === 'pm') {
      const rows = await Project.find({ projectManagerId: req.user._id }).select('_id').lean();
      allowedProjectIds = new Set(rows.map((r) => r._id.toString()));
    }

    let taskQuery = {};
    if (role === 'member') {
      const wsIds = await getMemberMyTasksWorkstreamIds(req.user._id);
      taskQuery = wsIds.length ? { workstreamId: { $in: wsIds } } : { assignedTo: req.user._id };
    }

    const tasks = await Task.find(taskQuery)
      .populate('assignedTo', 'name email')
      .populate({
        path: 'workstreamId',
        select: 'name moduleId isBlocked',
        populate: {
          path: 'moduleId',
          select: 'name projectId',
          populate: {
            path: 'projectId',
            select:
              'name clientName status deliveryPhase goLiveDate projectManagerId deliveryHeadId',
          },
        },
      })
      .sort({ dueDate: 1 })
      .limit(5000)
      .lean();

    // Collect every task referenced as a dependency so we can surface blocker
    // metadata (status, project) without a per-task round trip.
    const allDepIds = [...new Set(
      tasks.flatMap((t) => (t.dependsOnTaskIds || []).map((d) => String(d)))
    )];
    let depMap = new Map();
    if (allDepIds.length) {
      const depTasks = await Task.find({ _id: { $in: allDepIds } })
        .select('title status workstreamId')
        .populate({
          path: 'workstreamId',
          select: 'moduleId',
          populate: {
            path: 'moduleId',
            select: 'projectId',
            populate: { path: 'projectId', select: 'name' },
          },
        })
        .lean();
      depMap = new Map(
        depTasks.map((d) => [
          String(d._id),
          {
            id: String(d._id),
            title: d.title,
            status: d.status,
            projectId: d.workstreamId?.moduleId?.projectId?._id
              ? String(d.workstreamId.moduleId.projectId._id)
              : null,
            projectName: d.workstreamId?.moduleId?.projectId?.name || '',
          },
        ])
      );
    }

    const now = Date.now();
    let rows = tasks.map((t) => {
      const ws = t.workstreamId;
      const mod = ws && typeof ws === 'object' ? ws.moduleId : null;
      const proj = mod && typeof mod === 'object' ? mod.projectId : null;
      const ownProjId = proj && proj._id ? String(proj._id) : null;
      const deps = (t.dependsOnTaskIds || [])
        .map((d) => depMap.get(String(d)))
        .filter(Boolean);
      const openDeps = deps.filter((d) => d.status !== 'Done');
      return {
        _id: t._id,
        title: t.title,
        status: t.status,
        dueDate: t.dueDate,
        loggedHours: t.loggedHours || 0,
        owner: t.owner,
        assignee: t.assignedTo
          ? { _id: t.assignedTo._id, name: t.assignedTo.name, email: t.assignedTo.email }
          : null,
        workstreamName: ws && typeof ws === 'object' ? ws.name : '',
        moduleName: mod && typeof mod === 'object' ? mod.name : '',
        projectId: proj && proj._id ? proj._id : null,
        projectName: proj && typeof proj === 'object' ? proj.name : '',
        clientName: proj && typeof proj === 'object' ? proj.clientName : '',
        projectStatus: proj && typeof proj === 'object' ? proj.status : '',
        deliveryPhase: proj && typeof proj === 'object' ? proj.deliveryPhase || '' : '',
        goLiveDate: proj && typeof proj === 'object' ? proj.goLiveDate : null,
        isOverdue: t.status !== 'Done' && t.dueDate && new Date(t.dueDate).getTime() < now,
        riskLevel: t.riskLevel || 'Normal',
        workstreamBlocked: !!(ws && typeof ws === 'object' && ws.isBlocked),
        dependsOnTaskIds: (t.dependsOnTaskIds || []).map((d) => String(d)),
        openDependencies: openDeps,
        hasOpenDependencies: openDeps.length > 0,
        hasCrossProjectDependency: openDeps.some(
          (d) => d.projectId && ownProjId && d.projectId !== ownProjId
        ),
      };
    });

    if (allowedProjectIds) {
      rows = rows.filter((r) => r.projectId && allowedProjectIds.has(r.projectId.toString()));
    }

    if (view === 'mine') {
      rows = rows.filter(
        (r) => r.assignee && String(r.assignee._id) === String(req.user._id)
      );
    }
    if (view === 'created') {
      const meName = String(req.user.name || '').trim().toLowerCase();
      const meEmail = String(req.user.email || '').trim().toLowerCase();
      const meId = String(req.user._id || '');
      rows = rows.filter((r) => {
        const owner = String(r.owner || '').trim().toLowerCase();
        return owner === meName || owner === meEmail || owner === meId;
      });
    }
    if (view === 'overdue') rows = rows.filter((r) => r.isOverdue);
    if (view === 'atrisk') {
      rows = rows.filter((r) => r.isOverdue || r.riskLevel === 'At Risk');
    }
    if (view === 'unassigned') rows = rows.filter((r) => !r.assignee);
    if (view === 'nodue') rows = rows.filter((r) => !r.dueDate);
    if (view === 'in_progress') rows = rows.filter((r) => r.status === 'In Progress');
    if (view === 'done') rows = rows.filter((r) => r.status === 'Done');
    if (view === 'blocked') {
      rows = rows.filter(
        (r) => r.riskLevel === 'At Risk' || r.workstreamBlocked || r.hasOpenDependencies
      );
    }
    if (view === 'depblocked') {
      rows = rows.filter((r) => r.hasOpenDependencies);
    }
    if (view === 'crossproject') {
      rows = rows.filter((r) => r.hasCrossProjectDependency);
    }
    if (view === 'milestones') {
      const t = (s) => String(s || '').toLowerCase();
      rows = rows.filter((r) => {
        const title = t(r.title);
        return title.includes('go-live') || title.includes('golive') || title.includes('milestone');
      });
    }

    res.json({ tasks: rows });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * Lightweight capacity-style snapshot (M3B reference — UDIP reads aggregates; Darwinbox is source for time).
 */
const getResourceSnapshot = async (req, res) => {
  try {
    if (!['admin', 'pmo', 'dh', 'exec', 'pm', 'member'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const users = await User.find({ role: { $in: ['member', 'pm'] } })
      .select('name role seniority')
      .sort({ name: 1 })
      .lean();

    const tasks = await Task.find({ assignedTo: { $ne: null } })
      .select('assignedTo loggedHours status')
      .lean();

    const hoursByUser = {};
    tasks.forEach((t) => {
      const id = t.assignedTo?.toString();
      if (!id) return;
      hoursByUser[id] = (hoursByUser[id] || 0) + (Number(t.loggedHours) || 0);
    });

    const rows = users.map((u) => ({
      userId: u._id,
      name: u.name,
      role: u.role,
      seniority: u.seniority,
      totalLoggedHours: hoursByUser[u._id.toString()] || 0,
      openTaskCount: tasks.filter(
        (t) => t.assignedTo?.toString() === u._id.toString() && t.status !== 'Done'
      ).length,
    }));

    res.json({ rows });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { getAllTasksVista, getResourceSnapshot };
