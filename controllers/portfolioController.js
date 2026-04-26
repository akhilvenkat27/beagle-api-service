const mongoose = require('mongoose');
const Project = require('../models/Project');
const Module = require('../models/Module');
const Workstream = require('../models/Workstream');
const Task = require('../models/Task');
const User = require('../models/User');
const { calculateProjectFinancials } = require('../services/financialService');
const { ON_TRACK, CAUTION, AT_RISK } = require('../utils/healthRag');
const { getMemberAccessibleProjectIds } = require('./projectController');

async function scopedProjects(user) {
  if (['admin', 'pmo', 'exec'].includes(user.role)) return Project.find({}).lean();
  if (user.role === 'dh') return Project.find({ deliveryHeadId: user._id }).lean();
  if (user.role === 'pm') return Project.find({ projectManagerId: user._id }).lean();
  if (user.role === 'member') {
    const ids = await getMemberAccessibleProjectIds(user._id);
    if (!ids.size) return [];
    return Project.find({
      _id: { $in: [...ids].map((s) => new mongoose.Types.ObjectId(s)) },
    }).lean();
  }
  if (user.role === 'client') {
    const me = await User.findById(user._id).select('projectIds').lean();
    const pids = me?.projectIds || [];
    if (!pids.length) return [];
    return Project.find({ _id: { $in: pids } }).lean();
  }
  return [];
}

function ragFrom(progress, overdue, marginPct) {
  if (marginPct < 15 || overdue > 4 || progress < 40) return AT_RISK;
  if (marginPct >= 25 && overdue <= 1 && progress >= 70) return ON_TRACK;
  return CAUTION;
}

const getPortfolioDrilldown = async (req, res) => {
  try {
    const projects = await scopedProjects(req.user);
    const projectIds = projects.map((p) => p._id);
    const modules = await Module.find({ projectId: { $in: projectIds } }).lean();
    const moduleIds = modules.map((m) => m._id);
    const workstreams = await Workstream.find({ moduleId: { $in: moduleIds } }).lean();
    const wsIds = workstreams.map((w) => w._id);
    const tasks = await Task.find({ workstreamId: { $in: wsIds } }).lean();
    const wsById = new Map(workstreams.map((w) => [w._id.toString(), w]));
    const modById = new Map(modules.map((m) => [m._id.toString(), m]));

    const projRows = [];
    for (const p of projects) {
      let margin = 0;
      try {
        const fin = await calculateProjectFinancials(p._id.toString(), { skipAlerts: true });
        margin = Number(fin.marginPercent) || 0;
      } catch {
        margin = 0;
      }
      const pTasks = tasks.filter((t) => {
        const ws = wsById.get(t.workstreamId.toString());
        const mod = ws ? modById.get(ws.moduleId.toString()) : null;
        return mod && mod.projectId.toString() === p._id.toString();
      });
      const done = pTasks.filter((t) => t.status === 'Done').length;
      const progress = pTasks.length ? Math.round((done / pTasks.length) * 100) : 0;
      const overdue = pTasks.filter((t) => t.status !== 'Done' && new Date(t.dueDate) < new Date()).length;
      const daysToGoLive = p.goLiveDate ? Math.ceil((new Date(p.goLiveDate) - new Date()) / 86400000) : null;
      const milestoneHealth =
        workstreams.filter((w) => modById.get(w.moduleId.toString())?.projectId.toString() === p._id.toString() && w.signOffStatus === 'Signed Off')
          .length || 0;
      const totalWs =
        workstreams.filter((w) => modById.get(w.moduleId.toString())?.projectId.toString() === p._id.toString())
          .length || 0;
      projRows.push({
        projectId: p._id,
        projectName: p.name,
        account: p.clientName,
        region: p.region || 'Other',
        rag: ragFrom(progress, overdue, margin),
        marginPercent: margin,
        milestoneHealth: totalWs ? Math.round((milestoneHealth / totalWs) * 100) : 100,
        daysToGoLive,
      });
    }

    const regionMap = new Map();
    projRows.forEach((p) => {
      if (!regionMap.has(p.region)) regionMap.set(p.region, []);
      regionMap.get(p.region).push(p);
    });

    const regions = Array.from(regionMap.entries()).map(([region, rows]) => {
      const accountMap = new Map();
      rows.forEach((r) => {
        if (!accountMap.has(r.account)) accountMap.set(r.account, []);
        accountMap.get(r.account).push(r);
      });
      const accounts = Array.from(accountMap.entries()).map(([account, ar]) => ({
        account,
        kpis: {
          projects: ar.length,
          avgMargin: Math.round((ar.reduce((s, x) => s + x.marginPercent, 0) / Math.max(1, ar.length)) * 10) / 10,
        },
        projects: ar,
      }));
      return {
        region,
        kpis: {
          projects: rows.length,
          avgMargin: Math.round((rows.reduce((s, x) => s + x.marginPercent, 0) / Math.max(1, rows.length)) * 10) / 10,
        },
        accounts,
      };
    });

    res.json({ regions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { getPortfolioDrilldown };
