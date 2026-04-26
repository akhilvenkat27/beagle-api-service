const mongoose = require('mongoose');
const Project = require('../models/Project');
const Module = require('../models/Module');
const Workstream = require('../models/Workstream');
const Task = require('../models/Task');
const ChangeRequest = require('../models/ChangeRequest');
const SyncLog = require('../models/SyncLog');
const User = require('../models/User');
const { calculateProjectFinancials } = require('../services/financialService');
const { computeComplianceForProject } = require('./governanceController');
const { assertUserCanViewProject } = require('./projectController');
const { ON_TRACK, CAUTION, AT_RISK } = require('../utils/healthRag');

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

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

module.exports = { getCommandCentre, getRoleDashboard };
