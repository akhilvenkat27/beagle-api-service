const mongoose = require('mongoose');
const SavedReport = require('../models/SavedReport');
const Project = require('../models/Project');
const Module = require('../models/Module');
const Workstream = require('../models/Workstream');
const Task = require('../models/Task');
const User = require('../models/User');
const SyncLog = require('../models/SyncLog');
const ChangeRequest = require('../models/ChangeRequest');
const { calculateProjectFinancials } = require('../services/financialService');
const { getMemberAccessibleProjectIds } = require('./projectController');

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

function nextRunFrom(now, frequency) {
  const d = new Date(now);
  if (frequency === 'daily') d.setDate(d.getDate() + 1);
  else if (frequency === 'weekly') d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

function csvEscape(val) {
  if (val == null) return '';
  const s = typeof val === 'object' ? JSON.stringify(val) : String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function scopedProjects(user) {
  if (['admin', 'pmo', 'exec'].includes(user.role)) {
    return Project.find({}).lean();
  }
  if (user.role === 'dh') {
    return Project.find({ deliveryHeadId: user._id }).lean();
  }
  if (user.role === 'pm') {
    return Project.find({ projectManagerId: user._id }).lean();
  }
  if (user.role === 'member') {
    const ids = await getMemberAccessibleProjectIds(user._id);
    if (!ids.size) return [];
    return Project.find({
      _id: { $in: [...ids].map((s) => new mongoose.Types.ObjectId(s)) },
    }).lean();
  }
  if (user.role === 'client') {
    const me = await User.findById(user._id).select('projectIds').lean();
    return Project.find({ _id: { $in: me?.projectIds || [] } }).lean();
  }
  return [];
}

async function buildRows(user) {
  const projects = await scopedProjects(user);
  const projectIds = projects.map((p) => p._id);
  const modules = await Module.find({ projectId: { $in: projectIds } }).lean();
  const moduleIds = modules.map((m) => m._id);
  const workstreams = await Workstream.find({ moduleId: { $in: moduleIds } }).lean();
  const wsIds = workstreams.map((w) => w._id);
  const tasks = await Task.find({ workstreamId: { $in: wsIds } }).populate('assignedTo', 'name role seniority').lean();

  const projectById = new Map(projects.map((p) => [p._id.toString(), p]));
  const moduleById = new Map(modules.map((m) => [m._id.toString(), m]));
  const wsById = new Map(workstreams.map((w) => [w._id.toString(), w]));

  const taskHoursByUser = {};
  tasks.forEach((t) => {
    if (!t.assignedTo?._id) return;
    const k = t.assignedTo._id.toString();
    taskHoursByUser[k] = (taskHoursByUser[k] || 0) + (Number(t.loggedHours) || 0);
  });

  const financialByProject = new Map();
  for (const p of projects) {
    try {
      financialByProject.set(
        p._id.toString(),
        await calculateProjectFinancials(p._id.toString(), { skipAlerts: true })
      );
    } catch {
      financialByProject.set(p._id.toString(), { marginPercent: 0 });
    }
  }

  const syncByProject = new Map();
  const syncRows = await SyncLog.find({ projectId: { $in: projectIds }, syncType: 'timesheets' }).lean();
  syncRows.forEach((s) => {
    const k = s.projectId?.toString();
    if (!k) return;
    if (!syncByProject.has(k)) syncByProject.set(k, []);
    syncByProject.get(k).push(s);
  });

  const rows = [];
  tasks.forEach((t) => {
    const ws = wsById.get(t.workstreamId.toString());
    const mod = ws ? moduleById.get(ws.moduleId.toString()) : null;
    const project = mod ? projectById.get(mod.projectId.toString()) : null;
    if (!project || !mod) return;
    const fin = financialByProject.get(project._id.toString()) || { marginPercent: 0 };
    const due = t.dueDate ? new Date(t.dueDate) : null;
    const now = Date.now();
    const progressDen = tasks.filter((x) => {
      const wx = wsById.get(x.workstreamId.toString());
      const mx = wx ? moduleById.get(wx.moduleId.toString()) : null;
      return mx && mx.projectId.toString() === project._id.toString();
    });
    const doneCount = progressDen.filter((x) => x.status === 'Done').length;
    const overdueCount = progressDen.filter((x) => x.status !== 'Done' && x.dueDate && new Date(x.dueDate).getTime() < now).length;
    const progress = progressDen.length ? Math.round((doneCount / progressDen.length) * 100) : 0;
    const approvedHours = Number(t.loggedHours) || 0;
    const submittedHours = Number(t.loggedHours) || 0;
    const nonSubmittedHours = 0;

    rows.push({
      projectName: project.name,
      clientName: project.clientName,
      projectStatus: project.status,
      tier: project.tier,
      goLiveDate: project.goLiveDate,
      contractValue: Number(project.contractValue) || 0,
      margin: Number(fin.marginPercent) || 0,
      progress,
      overdueTasks: overdueCount,
      daysToGoLive: project.goLiveDate ? Math.ceil((new Date(project.goLiveDate) - new Date()) / 86400000) : null,

      moduleName: mod.name,
      moduleBudgetHours: Number(mod.budgetHours) || 0,
      moduleLoggedHours: tasks
        .filter((x) => {
          const wx = wsById.get(x.workstreamId.toString());
          return wx && wx.moduleId.toString() === mod._id.toString();
        })
        .reduce((s, x) => s + (Number(x.loggedHours) || 0), 0),
      moduleBurnPercent: mod.budgetHours
        ? Math.round(
            (tasks
              .filter((x) => {
                const wx = wsById.get(x.workstreamId.toString());
                return wx && wx.moduleId.toString() === mod._id.toString();
              })
              .reduce((s, x) => s + (Number(x.loggedHours) || 0), 0) /
              Number(mod.budgetHours)) *
              100
          )
        : 0,
      moduleProgress: (() => {
        const mt = tasks.filter((x) => {
          const wx = wsById.get(x.workstreamId.toString());
          return wx && wx.moduleId.toString() === mod._id.toString();
        });
        const d = mt.filter((x) => x.status === 'Done').length;
        return mt.length ? Math.round((d / mt.length) * 100) : 0;
      })(),

      taskTitle: t.title,
      taskOwner: t.owner,
      taskStatus: t.status,
      taskDueDate: t.dueDate,
      taskLoggedHours: Number(t.loggedHours) || 0,
      billable: t.billable !== false,
      isOverdue: !!(due && t.status !== 'Done' && due.getTime() < now),

      approvedHours,
      submittedHours,
      nonSubmittedHours,

      memberName: t.assignedTo?.name || t.owner || 'Unassigned',
      memberRole: t.assignedTo?.role || 'member',
      seniority: t.assignedTo?.seniority || 'Mid',
      region: project.region || 'India',
      utilization: t.assignedTo?._id ? Math.round(((taskHoursByUser[t.assignedTo._id.toString()] || 0) / 40) * 100) : 0,
    });
  });

  return rows;
}

function pickField(row, field) {
  const map = {
    projectName: row.projectName,
    clientName: row.clientName,
    status: row.projectStatus,
    tier: row.tier,
    goLiveDate: row.goLiveDate,
    contractValue: row.contractValue,
    margin: row.margin,
    progress: row.progress,
    overdueTasks: row.overdueTasks,
    daysToGoLive: row.daysToGoLive,

    name: row.moduleName,
    budgetHours: row.moduleBudgetHours,
    loggedHours: row.taskLoggedHours,
    burnPercent: row.moduleBurnPercent,

    title: row.taskTitle,
    owner: row.taskOwner,
    dueDate: row.taskDueDate,
    billable: row.billable,
    isOverdue: row.isOverdue,

    approvedHours: row.approvedHours,
    submittedHours: row.submittedHours,
    nonSubmittedHours: row.nonSubmittedHours,

    memberName: row.memberName,
    role: row.memberRole,
    seniority: row.seniority,
    region: row.region,
    utilization: row.utilization,
  };
  return map[field];
}

function applyFilters(rows, filters = []) {
  if (!Array.isArray(filters) || filters.length === 0) return rows;
  return rows.filter((row) =>
    filters.every((f) => {
      const left = pickField(row, f.field);
      const right = f.value;
      const op = (f.operator || 'eq').toLowerCase();
      if (op === 'contains') return String(left || '').toLowerCase().includes(String(right || '').toLowerCase());
      if (op === 'gt') return Number(left) > Number(right);
      if (op === 'gte') return Number(left) >= Number(right);
      if (op === 'lt') return Number(left) < Number(right);
      if (op === 'lte') return Number(left) <= Number(right);
      if (op === 'in') return Array.isArray(right) ? right.includes(left) : false;
      if (op === 'neq') return String(left) !== String(right);
      return String(left) === String(right);
    })
  );
}

function projectReportRows(rows, fields) {
  const selected = Array.isArray(fields) && fields.length > 0 ? fields : ['projectName', 'clientName', 'status'];
  return rows.map((r) => {
    const out = {};
    selected.forEach((f) => {
      out[f] = pickField(r, f);
    });
    return out;
  });
}

async function runConfiguredReport(user, config) {
  const allRows = await buildRows(user);
  const filtered = applyFilters(allRows, config.filters || []);
  const data = projectReportRows(filtered, config.fields || []);
  return { count: data.length, rows: data };
}

const runReport = async (req, res) => {
  try {
    const data = await runConfiguredReport(req.user, req.body || {});
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const saveReport = async (req, res) => {
  try {
    const { name, fields = [], filters = [], isPublic = false } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
    const row = await SavedReport.create({
      name: String(name).trim(),
      createdBy: req.user._id,
      fields,
      filters,
      isPublic: !!isPublic,
    });
    res.status(201).json(row);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

const listReports = async (req, res) => {
  try {
    const rows = await SavedReport.find({
      $or: [{ createdBy: req.user._id }, { isPublic: true }],
    })
      .sort({ createdAt: -1 })
      .populate('createdBy', 'name email role')
      .lean();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

async function getReportForUser(id, user) {
  if (!isValidId(id)) throw new Error('Invalid report id');
  const row = await SavedReport.findById(id);
  if (!row) throw new Error('Report not found');
  if (!row.isPublic && row.createdBy.toString() !== user._id.toString() && user.role !== 'admin') {
    throw new Error('Access denied');
  }
  return row;
}

const runSavedReport = async (req, res) => {
  try {
    const row = await getReportForUser(req.params.id, req.user);
    const data = await runConfiguredReport(req.user, row);
    res.json({ report: row, ...data });
  } catch (err) {
    const status = err.message === 'Access denied' ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
};

const exportSavedReport = async (req, res) => {
  try {
    const row = await getReportForUser(req.params.id, req.user);
    const data = await runConfiguredReport(req.user, row);
    const headers = row.fields || [];
    const lines = [headers.join(',')];
    data.rows.forEach((r) => lines.push(headers.map((h) => csvEscape(r[h])).join(',')));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=\"report-${row._id}.csv\"`);
    res.send(lines.join('\n'));
  } catch (err) {
    const status = err.message === 'Access denied' ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
};

const scheduleReport = async (req, res) => {
  try {
    const row = await getReportForUser(req.params.id, req.user);
    const { frequency = 'weekly', recipients = [], enabled = true } = req.body;
    if (!['daily', 'weekly', 'monthly'].includes(frequency)) {
      return res.status(400).json({ error: 'Invalid frequency' });
    }
    row.schedule = {
      enabled: !!enabled,
      frequency,
      recipients: Array.isArray(recipients) ? recipients.filter((id) => isValidId(id)) : [],
      lastRun: row.schedule?.lastRun || null,
      nextRun: enabled ? nextRunFrom(new Date(), frequency) : null,
    };
    await row.save();
    res.json(row);
  } catch (err) {
    const status = err.message === 'Access denied' ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
};

const scheduledReports = async (req, res) => {
  try {
    const rows = await SavedReport.find({
      'schedule.enabled': true,
      $or: [{ createdBy: req.user._id }, { 'schedule.recipients': req.user._id }, { isPublic: true }],
    })
      .populate('createdBy', 'name email role')
      .populate('schedule.recipients', 'name email role')
      .sort({ 'schedule.nextRun': 1 })
      .lean();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const getPmLeaderboard = async (req, res) => {
  try {
    if (!['admin', 'pmo', 'dh', 'pm'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const projects =
      req.user.role === 'dh'
        ? await Project.find({ deliveryHeadId: req.user._id }).lean()
        : await Project.find({}).lean();
    const pmIds = [...new Set(projects.map((p) => p.projectManagerId?.toString()).filter(Boolean))];
    const pms = await User.find({ _id: { $in: pmIds } }).select('name role').lean();
    const modules = await Module.find({ projectId: { $in: projects.map((p) => p._id) } }).lean();
    const workstreams = await Workstream.find({ moduleId: { $in: modules.map((m) => m._id) } }).lean();
    const tasks = await Task.find({ workstreamId: { $in: workstreams.map((w) => w._id) } }).lean();
    const moduleById = new Map(modules.map((m) => [m._id.toString(), m]));
    const wsById = new Map(workstreams.map((w) => [w._id.toString(), w]));

    const rankings = pms.map((pm) => {
      const mine = projects.filter((p) => p.projectManagerId?.toString() === pm._id.toString());
      const mineIds = new Set(mine.map((p) => p._id.toString()));
      const myTasks = tasks.filter((t) => {
        const ws = wsById.get(t.workstreamId.toString());
        const mod = ws ? moduleById.get(ws.moduleId.toString()) : null;
        return mod && mineIds.has(mod.projectId.toString());
      });
      const total = myTasks.length;
      const done = myTasks.filter((t) => t.status === 'Done').length;
      const onTimeDeliveryRate = total ? Math.round((done / total) * 100) : 0;
      const timesheetAccuracy = Math.max(0, Math.min(100, Math.round(80 + onTimeDeliveryRate * 0.2)));
      const openEsc = mine.length
        ? Math.round(
            (mine.filter((p) => p.status !== 'Completed').length / Math.max(1, mine.length)) * 10
          )
        : 0;
      const escalationRate = openEsc;
      const disciplineScore = Math.max(0, Math.min(100, Math.round(onTimeDeliveryRate * 0.7 + timesheetAccuracy * 0.3 - escalationRate)));
      return {
        pmId: pm._id.toString(),
        pmName: pm.name,
        onTimeDeliveryRate,
        timesheetAccuracy,
        escalationRate,
        disciplineScore,
        projectsManaged: mine.length,
      };
    });

    rankings.sort((a, b) => b.disciplineScore - a.disciplineScore);
    const withRank = rankings.map((r, i) => ({ rank: i + 1, ...r }));

    if (req.user.role === 'pm') {
      const anonymized = withRank.map((r, idx) => {
        if (r.pmId === req.user._id.toString()) return r;
        return { ...r, pmName: `PM #${idx + 1}` };
      });
      return res.json({ rankings: anonymized });
    }
    res.json({ rankings: withRank });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

async function runScheduledReportsJob() {
  const now = new Date();
  const due = await SavedReport.find({
    'schedule.enabled': true,
    'schedule.nextRun': { $lte: now },
  }).populate('createdBy', 'name email role').populate('schedule.recipients', 'name email role');

  for (const report of due) {
    try {
      const createdBy = report.createdBy;
      if (!createdBy) continue;
      const data = await runConfiguredReport(createdBy, report);
      const recips = (report.schedule?.recipients || []).map((u) => u.email || u.name).join(', ');
      // eslint-disable-next-line no-console
      console.log(
        `Scheduled report [${report.name}] delivered to [${recips || 'no recipients'}] rows=${data.count}`
      );
      report.schedule.lastRun = now;
      report.schedule.nextRun = nextRunFrom(now, report.schedule.frequency || 'weekly');
      await report.save();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[reports scheduler] failed:', report.name, err.message);
    }
  }
}

module.exports = {
  runReport,
  saveReport,
  listReports,
  runSavedReport,
  exportSavedReport,
  scheduleReport,
  scheduledReports,
  getPmLeaderboard,
  runScheduledReportsJob,
};
