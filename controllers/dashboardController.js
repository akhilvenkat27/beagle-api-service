const mongoose = require('mongoose');
const Project = require('../models/Project');
const Module = require('../models/Module');
const Workstream = require('../models/Workstream');
const Task = require('../models/Task');
const ChangeRequest = require('../models/ChangeRequest');
const SyncLog = require('../models/SyncLog');
const User = require('../models/User');
const DashboardConfig = require('../models/DashboardConfig');
const { calculateProjectFinancials } = require('../services/financialService');
const { computeComplianceForProject } = require('./governanceController');
const { assertUserCanViewProject } = require('./projectController');
const { ON_TRACK, CAUTION, AT_RISK } = require('../utils/healthRag');

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const DASHBOARD_ROLES = ['admin', 'pmo', 'dh', 'pm', 'exec'];

function dashboardId() {
  return `dash-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sanitizeWidgets(widgets, role) {
  return Array.isArray(widgets)
    ? widgets.map((w, idx) => ({
        id: String(w.id || `widget-${Date.now()}-${idx}`),
        type: w.type,
        title: String(w.title || 'Untitled widget').trim(),
        description: String(w.description || ''),
        size: w.size || 'md',
        source: w.source || 'projects',
        metric: w.metric || 'count',
        chartType: w.chartType || 'bar',
        xAxis: w.xAxis || 'status',
        yAxis: w.yAxis || 'count',
        groupBy: w.groupBy || '',
        filters: w.filters || {},
        options: w.options || {},
        order: Number.isFinite(Number(w.order)) ? Number(w.order) : idx,
        visible: w.visible !== false,
      }))
    : defaultWidgetsForRole(role);
}

function activeDashboardPayload(doc) {
  const dashboards = Array.isArray(doc.dashboards) ? doc.dashboards : [];
  const active =
    dashboards.find((d) => d.id === doc.activeDashboardId) ||
    dashboards[0] ||
    {
      id: 'default',
      name: doc.name || 'My First Dashboard',
      dateRange: doc.dateRange || 'last_12_months',
      showValues: !!doc.showValues,
      widgets: doc.widgets || [],
      isShared: false,
    };
  const obj = doc.toObject ? doc.toObject() : doc;
  return {
    ...obj,
    activeDashboardId: active.id,
    name: active.name,
    dateRange: active.dateRange,
    showValues: active.showValues,
    widgets: active.widgets || [],
    dashboards: dashboards.map((d) => ({
      id: d.id,
      name: d.name,
      isShared: !!d.isShared,
      isActive: d.id === active.id,
      widgetCount: (d.widgets || []).filter((w) => w.visible !== false).length,
      updatedAt: d.updatedAt,
    })),
  };
}

function defaultWidgetsForRole(role) {
  const portfolio = [
    { id: 'section-portfolio', type: 'section', title: 'Portfolio health overview', description: 'Live project, delivery, task, governance, finance, and people analytics in one saved dashboard.', size: 'full', order: 1 },
    { id: 'card-total-projects', type: 'card', title: 'Total Projects', source: 'projects', metric: 'totalProjects', size: 'sm', order: 2, options: { caption: 'All projects in your portfolio' } },
    { id: 'card-active-projects', type: 'card', title: 'Projects In-Progress', source: 'projects', metric: 'activeProjects', size: 'sm', order: 3, options: { caption: 'Currently active projects' } },
    { id: 'card-overdue-projects', type: 'card', title: 'Projects Overdue', source: 'projects', metric: 'overdueProjects', size: 'sm', order: 4, options: { caption: 'Go-live date has passed' } },
    { id: 'card-running-late', type: 'card', title: 'Projects Running Late', source: 'projects', metric: 'runningLateProjects', size: 'sm', order: 5, options: { caption: 'At-risk or overdue task signals' } },
    { id: 'chart-project-status', type: 'chart', title: 'Projects by Status', source: 'projects', chartType: 'bar', xAxis: 'status', yAxis: 'count', size: 'md', order: 10 },
    { id: 'chart-project-phase', type: 'chart', title: 'Projects by Current Phase', source: 'projects', chartType: 'bar', xAxis: 'deliveryPhase', yAxis: 'count', size: 'md', order: 11 },
    { id: 'chart-project-region', type: 'chart', title: 'Regional Project Breakdown', source: 'projects', chartType: 'donut', xAxis: 'region', yAxis: 'count', size: 'md', order: 12 },
    { id: 'chart-project-tier', type: 'chart', title: 'Project Tier Mix', source: 'projects', chartType: 'bar', xAxis: 'tier', yAxis: 'count', size: 'md', order: 13 },
  ];

  const execution = [
    { id: 'section-execution', type: 'section', title: 'Execution and delivery', description: 'Track task completion, overdue work, ownership, and module progress.', size: 'full', order: 20 },
    { id: 'card-total-tasks', type: 'card', title: 'Total Tasks', source: 'tasks', metric: 'totalTasks', size: 'sm', order: 21 },
    { id: 'card-completed-tasks', type: 'card', title: 'Completed Tasks', source: 'tasks', metric: 'completedTasks', size: 'sm', order: 22 },
    { id: 'card-overdue-tasks', type: 'card', title: 'Overdue Tasks', source: 'tasks', metric: 'overdueTasks', size: 'sm', order: 23 },
    { id: 'chart-task-status', type: 'chart', title: 'Tasks by Status', source: 'tasks', chartType: 'bar', xAxis: 'status', yAxis: 'count', size: 'md', order: 24 },
    { id: 'chart-status-phase', type: 'chart', title: 'Task Status by Module', source: 'tasks', chartType: 'bar', xAxis: 'moduleName', groupBy: 'status', yAxis: 'count', size: 'lg', order: 25 },
    { id: 'chart-task-owner', type: 'chart', title: 'Tasks by Assignee', source: 'tasks', chartType: 'bar', xAxis: 'assigneeName', yAxis: 'count', size: 'md', order: 26 },
    { id: 'table-milestones', type: 'table', title: 'Upcoming Milestones', source: 'tasks', metric: 'milestones', size: 'lg', order: 27 },
  ];

  const controls = [
    { id: 'section-controls', type: 'section', title: 'Risks, governance, and financials', description: 'Surface risk hotspots, compliance follow-ups, margins, ARR, and integration failures.', size: 'full', order: 40 },
    { id: 'card-policy-violations', type: 'card', title: 'Policy Violations', source: 'governance', metric: 'policyViolations', size: 'sm', order: 41 },
    { id: 'card-failed-integrations', type: 'card', title: 'Failed Integrations', source: 'integrations', metric: 'failedIntegrations', size: 'sm', order: 42 },
    { id: 'card-arr', type: 'card', title: 'Notional ARR', source: 'finance', metric: 'totalARR', size: 'sm', order: 43 },
    { id: 'card-margin', type: 'card', title: 'Average Margin', source: 'finance', metric: 'avgMargin', size: 'sm', order: 44 },
    { id: 'table-risk', type: 'table', title: 'Top At-Risk Projects', source: 'projects', metric: 'riskProjects', size: 'lg', order: 45 },
    { id: 'table-compliance', type: 'table', title: 'Compliance Scores', source: 'governance', metric: 'complianceScores', size: 'lg', order: 46 },
    { id: 'table-crs', type: 'table', title: 'Open CRs Requiring Action', source: 'projects', metric: 'openCRs', size: 'lg', order: 47 },
  ];

  const people = [
    { id: 'section-people', type: 'section', title: 'People and performance', description: 'Monitor PM discipline, capacity signals, and ownership patterns.', size: 'full', order: 60 },
    { id: 'table-pm-performance', type: 'table', title: 'PM Performance Comparison', source: 'people', metric: 'pmPerformance', size: 'lg', order: 61 },
    { id: 'table-pm-discipline', type: 'table', title: 'PM Discipline Scores', source: 'people', metric: 'pmScores', size: 'lg', order: 62 },
    { id: 'table-escalations', type: 'table', title: 'Escalation Risk Alerts', source: 'projects', metric: 'escalations', size: 'full', order: 63 },
  ];

  if (role === 'pm') {
    return [...portfolio, ...execution, ...controls.filter((w) => !['table-pm-discipline'].includes(w.id))];
  }
  if (role === 'exec') {
    return [...portfolio, ...controls, ...people.filter((w) => w.id !== 'table-pm-discipline')];
  }
  return [...portfolio, ...execution, ...controls, ...people];
}

function firstDashboardForRole(role) {
  return {
    id: 'first-required-analytics',
    name: 'My First Dashboard',
    dateRange: 'last_12_months',
    showValues: true,
    widgets: defaultWidgetsForRole(role),
    isShared: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function ensureFirstDashboard(doc, role) {
  const dashboards = Array.isArray(doc.dashboards) ? doc.dashboards : [];
  const first = firstDashboardForRole(role);
  const existingIdx = dashboards.findIndex((d) => d.id === first.id);
  const shouldUpgradeOldStarter =
    dashboards.length === 0 ||
    (dashboards.length === 1 && dashboards[0].id === 'default' && (dashboards[0].widgets || []).length <= 8);

  if (existingIdx >= 0 && (dashboards[existingIdx].widgets || []).length >= first.widgets.length) {
    return false;
  }

  if (existingIdx >= 0) dashboards[existingIdx] = { ...first, createdAt: dashboards[existingIdx].createdAt || first.createdAt };
  else dashboards.unshift(first);

  if (shouldUpgradeOldStarter || !doc.activeDashboardId) {
    doc.activeDashboardId = first.id;
    doc.name = first.name;
    doc.dateRange = first.dateRange;
    doc.showValues = first.showValues;
    doc.widgets = first.widgets;
  }
  doc.dashboards = dashboards;
  await doc.save();
  return true;
}

async function getOrCreateDashboardConfig(ownerId, role) {
  const effectiveRole = role === 'admin' ? 'pmo' : role;
  const query = { ownerId, role: effectiveRole };
  let doc = await DashboardConfig.findOne(query);
  if (!doc) {
    const first = firstDashboardForRole(effectiveRole);
    doc = await DashboardConfig.create({
      ...query,
      name: first.name,
      dateRange: first.dateRange,
      showValues: first.showValues,
      widgets: first.widgets,
      activeDashboardId: first.id,
      dashboards: [first],
    });
  } else if (!doc.dashboards || doc.dashboards.length === 0) {
    const first = firstDashboardForRole(effectiveRole);
    doc.activeDashboardId = first.id;
    doc.name = first.name;
    doc.dateRange = first.dateRange;
    doc.showValues = first.showValues;
    doc.widgets = first.widgets;
    doc.dashboards = [first];
    await doc.save();
  }
  await ensureFirstDashboard(doc, effectiveRole);
  return doc;
}

function computeModuleRag(progress, burnPercent, overdueCount) {
  if (progress < 40 || burnPercent >= 90 || overdueCount > 3) return AT_RISK;
  if (progress >= 70 && burnPercent < 80) return ON_TRACK;
  if (progress >= 40 || burnPercent < 90) return CAUTION;
  return CAUTION;
}

async function moduleStats(mod) {
  const workstreams = await Workstream.find({ moduleId: mod._id });
  const workstreamIds = workstreams.map((w) => w._id);
  const tasks = await Task.find({ workstreamId: { $in: workstreamIds } });

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.status === 'Done').length;
  const overdueTasks = tasks.filter((t) => t.status !== 'Done' && t.dueDate < new Date()).length;
  const loggedHours = tasks.reduce((sum, t) => sum + t.loggedHours, 0);
  const burnPercent =
    mod.budgetHours > 0 ? Math.round((loggedHours / mod.budgetHours) * 100) : 0;
  const progress =
    totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  return { progress, burnPercent, overdueTasks, tasks, workstreams };
}

async function resolveProjectsForRole(user) {
  if (['admin', 'pmo', 'exec'].includes(user.role)) {
    return Project.find({}).sort({ createdAt: -1 }).lean();
  }
  if (user.role === 'dh') {
    return Project.find({ deliveryHeadId: user._id }).sort({ createdAt: -1 }).lean();
  }
  if (user.role === 'pm') {
    return Project.find({ projectManagerId: user._id }).sort({ createdAt: -1 }).lean();
  }
  return [];
}

async function collectProjectUniverse(projects) {
  const projectIds = projects.map((p) => p._id);
  const modules = await Module.find({ projectId: { $in: projectIds } }).lean();
  const moduleIds = modules.map((m) => m._id);
  const moduleById = new Map(modules.map((m) => [m._id.toString(), m]));

  const workstreams = await Workstream.find({ moduleId: { $in: moduleIds } }).lean();
  const workstreamIds = workstreams.map((w) => w._id);
  const wsById = new Map(workstreams.map((w) => [w._id.toString(), w]));

  const tasks = await Task.find({ workstreamId: { $in: workstreamIds } }).lean();
  return { modules, workstreams, tasks, moduleById, wsById };
}

function buildProjectStats(projects, universe) {
  const now = Date.now();
  const byProject = new Map();
  projects.forEach((p) => {
    byProject.set(p._id.toString(), {
      projectId: p._id,
      name: p.name,
      clientName: p.clientName,
      region: p.region,
      tier: p.tier,
      status: p.status,
      goLiveDate: p.goLiveDate,
      contractValue: Number(p.contractValue) || 0,
      totalTasks: 0,
      done: 0,
      overdue: 0,
      loggedHours: 0,
      budgetHours: 0,
    });
  });

  universe.modules.forEach((m) => {
    const st = byProject.get(m.projectId.toString());
    if (st) st.budgetHours += Number(m.budgetHours) || 0;
  });

  universe.tasks.forEach((t) => {
    const ws = universe.wsById.get(t.workstreamId.toString());
    if (!ws) return;
    const mod = universe.moduleById.get(ws.moduleId.toString());
    if (!mod) return;
    const st = byProject.get(mod.projectId.toString());
    if (!st) return;
    st.totalTasks += 1;
    if (t.status === 'Done') st.done += 1;
    if (t.status !== 'Done' && t.dueDate && new Date(t.dueDate).getTime() < now) st.overdue += 1;
    st.loggedHours += Number(t.loggedHours) || 0;
  });

  return Array.from(byProject.values()).map((s) => {
    const progress = s.totalTasks > 0 ? Math.round((s.done / s.totalTasks) * 100) : 0;
    const burnPercent = s.budgetHours > 0 ? Math.round((s.loggedHours / s.budgetHours) * 100) : 0;
    const rag =
      s.overdue > 3 || progress < 40 || burnPercent > 95 ? AT_RISK : progress >= 75 ? ON_TRACK : CAUTION;
    return { ...s, progress, burnPercent, rag };
  });
}

async function buildDashboardRows(projects, universe, stats) {
  const projectStatsById = new Map(stats.map((s) => [s.projectId.toString(), s]));
  const projectsForDashboard = projects.map((p) => {
    const st = projectStatsById.get(p._id.toString()) || {};
    return {
      _id: p._id,
      projectName: p.name,
      name: p.name,
      clientName: p.clientName,
      region: p.region,
      tier: p.tier,
      status: p.status,
      deliveryPhase: p.deliveryPhase || '',
      goLiveDate: p.goLiveDate,
      createdAt: p.createdAt,
      notionalARR: p.notionalARR,
      contractValue: p.contractValue,
      rag: st.rag,
      progress: st.progress || 0,
      burnPercent: st.burnPercent || 0,
      overdueTasks: st.overdue || 0,
    };
  });

  const assigneeIds = [
    ...new Set(universe.tasks.map((t) => t.assignedTo?.toString()).filter(Boolean)),
  ];
  const assignees = assigneeIds.length
    ? await User.find({ _id: { $in: assigneeIds } }).select('name email').lean()
    : [];
  const assigneeById = new Map(assignees.map((u) => [u._id.toString(), u]));
  const tasksForDashboard = universe.tasks.map((t) => {
    const ws = universe.wsById.get(t.workstreamId?.toString());
    const mod = ws ? universe.moduleById.get(ws.moduleId?.toString()) : null;
    const project = mod ? projects.find((p) => p._id.toString() === mod.projectId?.toString()) : null;
    const assignee = t.assignedTo ? assigneeById.get(t.assignedTo.toString()) : null;
    return {
      _id: t._id,
      title: t.title,
      status: t.status,
      dueDate: t.dueDate,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      loggedHours: Number(t.loggedHours) || 0,
      moduleName: mod?.name || '',
      workstreamName: ws?.name || '',
      projectName: project?.name || '',
      assignee: assignee
        ? { _id: assignee._id, name: assignee.name, email: assignee.email }
        : null,
    };
  });

  return { dashboardProjects: projectsForDashboard, dashboardTasks: tasksForDashboard };
}

function groupBy(arr, keyFn) {
  const m = new Map();
  arr.forEach((x) => {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  });
  return m;
}

// GET /api/dashboard/command-centre/:projectId
const getCommandCentre = async (req, res) => {
  try {
    const { projectId } = req.params;
    const access = await assertUserCanViewProject(req, projectId);
    if (!access.ok) {
      return res.status(access.status).json({ message: access.message });
    }

    const modules = await Module.find({ projectId }).sort({ createdAt: 1 });

    const ragHeatmap = [];
    const allOverdueTasks = [];
    const now = new Date();
    const weekEnd = new Date(now.getTime() + 7 * 86400000);
    const upcomingMilestones = [];

    for (const mod of modules) {
      const { progress, burnPercent, overdueTasks, tasks, workstreams } = await moduleStats(mod);
      const rag = computeModuleRag(progress, burnPercent, overdueTasks);
      ragHeatmap.push({
        moduleId: mod._id,
        name: mod.name,
        rag,
        progress,
        burnPercent,
        overdueTasks,
      });

      const wsNameById = new Map(workstreams.map((w) => [w._id.toString(), w.name]));
      for (const t of tasks) {
        if (t.status === 'Done') continue;
        const due = new Date(t.dueDate);
        if (due >= now) continue;
        const daysOverdue = Math.ceil((now - due) / 86400000);
        const owner = t.owner || '';
        allOverdueTasks.push({
          taskId: t._id,
          title: t.title,
          daysOverdue,
          owner,
          module: mod.name,
          workstreamName: wsNameById.get(t.workstreamId.toString()) || '',
        });
      }

      for (const ws of workstreams) {
        if (!ws.baselinePlannedEndDate) continue;
        const end = new Date(ws.baselinePlannedEndDate);
        if (end < now || end > weekEnd) continue;
        const daysUntilDue = Math.ceil((end - now) / 86400000);
        upcomingMilestones.push({
          workstreamId: ws._id,
          name: ws.name,
          moduleId: mod._id,
          moduleName: mod.name,
          daysUntilDue,
          plannedEnd: end,
        });
      }
    }

    allOverdueTasks.sort((a, b) => b.daysOverdue - a.daysOverdue);
    const top5Overdue = allOverdueTasks.slice(0, 5);
    upcomingMilestones.sort((a, b) => a.daysUntilDue - b.daysUntilDue);

    res.json({ ragHeatmap, top5Overdue, upcomingMilestones });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/dashboard/:role (role from auth; :role is routing convenience)
const getRoleDashboard = async (req, res) => {
  try {
    const user = req.user;
    const effectiveRole = user.role === 'admin' ? 'pmo' : user.role;
    const projects = await resolveProjectsForRole({ ...user, role: effectiveRole });
    const universe = await collectProjectUniverse(projects);
    const stats = buildProjectStats(projects, universe);
    const dashboardRows = await buildDashboardRows(projects, universe, stats);
    const projectIds = projects.map((p) => p._id.toString());

    if (effectiveRole === 'pm') {
      const now = new Date();
      const weekEnd = new Date(now.getTime() + 7 * 86400000);
      const upcomingMilestones = universe.workstreams
        .filter((w) => w.baselinePlannedEndDate)
        .map((w) => {
          const mod = universe.moduleById.get(w.moduleId.toString());
          return { w, mod };
        })
        .filter(({ mod }) => mod && projectIds.includes(mod.projectId.toString()))
        .map(({ w, mod }) => ({
          name: w.name,
          module: mod.name,
          date: w.baselinePlannedEndDate,
        }))
        .filter((x) => new Date(x.date) >= now && new Date(x.date) <= weekEnd)
        .sort((a, b) => new Date(a.date) - new Date(b.date))
        .slice(0, 8);

      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const teamCompletionToday = universe.tasks.filter(
        (t) => t.status === 'Done' && t.updatedAt && new Date(t.updatedAt) >= start
      ).length;

      const openCrs = await ChangeRequest.find({
        projectId: { $in: projects.map((p) => p._id) },
        status: { $in: ['Draft', 'Pending Approval'] },
      })
        .select('title status projectId')
        .lean();

      const complianceRows = await Promise.all(
        projects.map(async (p) => ({
          projectId: p._id,
          projectName: p.name,
          ...(await computeComplianceForProject(p._id.toString())),
        }))
      );

      return res.json({
        role: 'pm',
        ...dashboardRows,
        myProjects: stats.map((s) => ({
          projectId: s.projectId,
          name: s.name,
          rag: s.rag,
          burnPercent: s.burnPercent,
          overdueTasks: s.overdue,
        })),
        upcomingMilestones,
        teamTaskCompletionToday: teamCompletionToday,
        openCRsRequiringAction: openCrs,
        complianceByProject: complianceRows.map((c) => ({
          projectId: c.projectId,
          projectName: c.projectName,
          overallScore: c.overallScore || 0,
        })),
      });
    }

    if (effectiveRole === 'dh') {
      const financialRows = await Promise.all(
        projects.map(async (p) => ({ projectId: p._id, ...(await calculateProjectFinancials(p._id, { skipAlerts: true })) }))
      );
      const totalRevenue = projects.reduce((s, p) => s + (Number(p.contractValue) || 0), 0);
      const avgMargin =
        financialRows.length > 0
          ? Math.round(
              (financialRows.reduce((s, r) => s + (Number(r.marginPercent) || 0), 0) / financialRows.length) * 10
            ) / 10
          : 0;
      const atRiskProjects = financialRows
        .filter((f) => Number(f.marginPercent) < 20)
        .map((f) => projects.find((p) => p._id.toString() === f.projectId.toString())?.name)
        .filter(Boolean);

      const assigneeCount = {};
      universe.tasks.forEach((t) => {
        if (!t.assignedTo) return;
        const k = t.assignedTo.toString();
        assigneeCount[k] = (assigneeCount[k] || 0) + 1;
      });
      const userIds = Object.keys(assigneeCount);
      const assignees = await User.find({ _id: { $in: userIds } }).select('name').lean();
      const overloadedMembers = assignees
        .map((u) => ({ name: u.name, assignedTasks: assigneeCount[u._id.toString()] || 0 }))
        .filter((x) => x.assignedTasks > 10);

      const pendingEscalations = stats
        .filter((s) => s.overdue > 4 || s.rag === AT_RISK)
        .map((s) => ({ projectName: s.name, trigger: 'High overdue/risk pattern' }));

      const pmGroups = groupBy(projects.filter((p) => p.projectManagerId), (p) => p.projectManagerId.toString());
      const pmIds = Array.from(pmGroups.keys());
      const pms = await User.find({ _id: { $in: pmIds } }).select('name').lean();
      const pmDisciplineScores = pms.map((pm) => {
        const mine = stats.filter((s) =>
          pmGroups.get(pm._id.toString()).some((p) => p._id.toString() === s.projectId.toString())
        );
        const avg = mine.length
          ? Math.round(
              mine.reduce((sum, s) => sum + Math.max(0, 100 - s.overdue * 6 - Math.max(0, s.burnPercent - 100)), 0) /
                mine.length
            )
          : 0;
        return { pmName: pm.name, score: avg };
      });

      return res.json({
        role: 'dh',
        ...dashboardRows,
        ragHeatmap: stats.map((s) => ({ projectName: s.name, rag: s.rag, overdueTasks: s.overdue, burnPercent: s.burnPercent })),
        financialSummary: {
          totalRevenue,
          avgMargin,
          atRiskProjects,
        },
        resourceUtilization: { overloadedMembers },
        escalationRiskAlerts: pendingEscalations,
        pmDisciplineScores,
      });
    }

    if (effectiveRole === 'exec') {
      const financialRows = await Promise.all(
        projects.map(async (p) => ({ projectId: p._id, ...(await calculateProjectFinancials(p._id, { skipAlerts: true })) }))
      );
      const totalArr = projects.reduce((s, p) => s + (Number(p.notionalARR) || 0), 0);
      const avgMargin =
        financialRows.length > 0
          ? Math.round(
              (financialRows.reduce((s, r) => s + (Number(r.marginPercent) || 0), 0) / financialRows.length) * 10
            ) / 10
          : 0;
      const goLiveRate =
        projects.length > 0
          ? Math.round((projects.filter((p) => p.status === 'Completed').length / projects.length) * 100)
          : 0;
      const regional = {};
      stats.forEach((s) => {
        if (!regional[s.region]) regional[s.region] = { region: s.region, projects: 0, avgMargin: 0 };
        regional[s.region].projects += 1;
      });
      Object.values(regional).forEach((r) => {
        const ids = stats.filter((s) => s.region === r.region).map((s) => s.projectId.toString());
        const rows = financialRows.filter((f) => ids.includes(f.projectId.toString()));
        r.avgMargin = rows.length
          ? Math.round((rows.reduce((x, y) => x + (Number(y.marginPercent) || 0), 0) / rows.length) * 10) / 10
          : 0;
      });
      const topAtRiskProjects = stats
        .slice()
        .sort((a, b) => b.overdue - a.overdue || a.progress - b.progress)
        .slice(0, 3)
        .map((s) => ({ projectName: s.name, rag: s.rag, marginHint: avgMargin, goLiveDate: s.goLiveDate }));

      return res.json({
        role: 'exec',
        ...dashboardRows,
        portfolioKpis: {
          totalARR: totalArr,
          totalProjects: projects.length,
          avgMargin,
          goLiveRate,
        },
        regionalBreakdown: Object.values(regional),
        topAtRiskProjects,
        aiPortfolioNarrative:
          'Portfolio momentum is stable with targeted attention required on the top at-risk projects and margin-sensitive accounts.',
      });
    }

    // pmo/admin
    const complianceRows = await Promise.all(
      projects.map(async (p) => ({
        projectId: p._id,
        projectName: p.name,
        region: p.region,
        ...(await computeComplianceForProject(p._id.toString())),
      }))
    );
    const syncLogs = await SyncLog.find({ syncType: 'timesheets' }).sort({ syncedAt: -1 }).limit(200).lean();
    const violations = complianceRows.flatMap((c) =>
      (c.violations || []).map((v) => ({ projectName: c.projectName, violation: v }))
    );

    const pmGroups = groupBy(projects.filter((p) => p.projectManagerId), (p) => p.projectManagerId.toString());
    const pmIds = Array.from(pmGroups.keys());
    const pms = await User.find({ _id: { $in: pmIds } }).select('name').lean();
    const pmPerformance = pms.map((pm) => {
      const mine = stats.filter((s) =>
        pmGroups.get(pm._id.toString()).some((p) => p._id.toString() === s.projectId.toString())
      );
      const avgScore = mine.length
        ? Math.round(mine.reduce((sum, s) => sum + Math.max(0, 100 - s.overdue * 5), 0) / mine.length)
        : 0;
      return { pmName: pm.name, score: avgScore, projectsManaged: mine.length };
    });

    return res.json({
      role: 'pmo',
      ...dashboardRows,
      fullPortfolio: stats.map((s) => ({
        projectId: s.projectId,
        projectName: s.name,
        region: s.region,
        rag: s.rag,
        progress: s.progress,
      })),
      governanceComplianceScores: complianceRows.map((c) => ({
        projectId: c.projectId,
        projectName: c.projectName,
        region: c.region,
        score: c.overallScore || 0,
      })),
      nonSubmissionStats: {
        syncEvents: syncLogs.length,
        failedSyncs: syncLogs.filter((l) => l.status === 'failed').length,
      },
      integrationHealth: {
        lastTimesheetSyncAt: syncLogs[0]?.syncedAt || null,
        failingIntegrations: syncLogs.filter((l) => l.status === 'failed').length,
      },
      policyViolations: violations.slice(0, 30),
      pmPerformanceComparison: pmPerformance.sort((a, b) => b.score - a.score),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/dashboard/config/:role
const getDashboardConfig = async (req, res) => {
  try {
    const role = req.params.role === 'admin' ? 'pmo' : req.params.role;
    if (!DASHBOARD_ROLES.includes(role)) {
      return res.status(400).json({ message: 'Invalid dashboard role' });
    }
    const config = await getOrCreateDashboardConfig(req.user._id, role);
    res.json(activeDashboardPayload(config));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// PUT /api/dashboard/config/:role
const saveDashboardConfig = async (req, res) => {
  try {
    const role = req.params.role === 'admin' ? 'pmo' : req.params.role;
    if (!DASHBOARD_ROLES.includes(role)) {
      return res.status(400).json({ message: 'Invalid dashboard role' });
    }
    const body = req.body || {};
    const config = await getOrCreateDashboardConfig(req.user._id, role);
    const activeId = body.activeDashboardId || config.activeDashboardId || 'default';
    const dashboards = config.dashboards || [];
    const idx = dashboards.findIndex((d) => d.id === activeId);
    const nextDashboard = {
      id: activeId,
      name: String(body.name || 'My First Dashboard').trim(),
      dateRange: String(body.dateRange || 'last_12_months'),
      showValues: !!body.showValues,
      widgets: sanitizeWidgets(body.widgets, role),
      isShared: !!body.isShared,
      updatedAt: new Date(),
      createdAt: idx >= 0 ? dashboards[idx].createdAt : new Date(),
    };
    if (idx >= 0) dashboards[idx] = nextDashboard;
    else dashboards.push(nextDashboard);
    config.activeDashboardId = activeId;
    config.name = nextDashboard.name;
    config.dateRange = nextDashboard.dateRange;
    config.showValues = nextDashboard.showValues;
    config.widgets = nextDashboard.widgets;
    config.dashboards = dashboards;
    await config.save();
    res.json(activeDashboardPayload(config));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// POST /api/dashboard/config/:role/dashboards
const createSavedDashboard = async (req, res) => {
  try {
    const role = req.params.role === 'admin' ? 'pmo' : req.params.role;
    if (!DASHBOARD_ROLES.includes(role)) {
      return res.status(400).json({ message: 'Invalid dashboard role' });
    }
    const config = await getOrCreateDashboardConfig(req.user._id, role);
    const name = String(req.body?.name || 'Untitled dashboard').trim();
    const source =
      (config.dashboards || []).find((d) => d.id === config.activeDashboardId) ||
      (config.dashboards || [])[0];
    const id = dashboardId();
    const newDash = {
      id,
      name,
      dateRange: source?.dateRange || 'last_12_months',
      showValues: source?.showValues || false,
      widgets: req.body?.copyCurrent === false ? [] : sanitizeWidgets(source?.widgets, role),
      isShared: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    config.dashboards = [...(config.dashboards || []), newDash];
    config.activeDashboardId = id;
    config.name = newDash.name;
    config.dateRange = newDash.dateRange;
    config.showValues = newDash.showValues;
    config.widgets = newDash.widgets;
    await config.save();
    res.status(201).json(activeDashboardPayload(config));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// POST /api/dashboard/config/:role/dashboards/:dashboardId/select
const selectSavedDashboard = async (req, res) => {
  try {
    const role = req.params.role === 'admin' ? 'pmo' : req.params.role;
    const { dashboardId: id } = req.params;
    const config = await getOrCreateDashboardConfig(req.user._id, role);
    const selected = (config.dashboards || []).find((d) => d.id === id);
    if (!selected) return res.status(404).json({ message: 'Dashboard not found' });
    config.activeDashboardId = selected.id;
    config.name = selected.name;
    config.dateRange = selected.dateRange;
    config.showValues = selected.showValues;
    config.widgets = selected.widgets || [];
    await config.save();
    res.json(activeDashboardPayload(config));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

module.exports = {
  getCommandCentre,
  getRoleDashboard,
  getDashboardConfig,
  saveDashboardConfig,
  createSavedDashboard,
  selectSavedDashboard,
};
