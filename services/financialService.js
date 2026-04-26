/**
 * Financial Engine (Module 4) — margin, EAC, portfolio rollups, margin alerts.
 * Currency treated as INR for display math unless project adds multi-currency later.
 */

const mongoose = require('mongoose');
const Project = require('../models/Project');
const Module = require('../models/Module');
const Workstream = require('../models/Workstream');
const Task = require('../models/Task');
const User = require('../models/User');
const Alert = require('../models/Alert');
const { ON_TRACK, CAUTION, AT_RISK } = require('../utils/healthRag');

const DEFAULT_MARGIN_ALERT_THRESHOLD = Number(process.env.FINANCE_MARGIN_THRESHOLD_PCT) || 20;
const DEFAULT_USER_RATE = 2500;

function msWeeks(ms) {
  return ms / (7 * 24 * 60 * 60 * 1000);
}

function taskCost(task, userById) {
  const hrs = Number(task.loggedHours) || 0;
  if (task.assignedTo && typeof task.assignedTo === 'object' && task.assignedTo.costRatePerHour != null) {
    return hrs * (Number(task.assignedTo.costRatePerHour) || DEFAULT_USER_RATE);
  }
  const uid = task.assignedTo?._id?.toString() || task.assignedTo?.toString();
  const rate =
    uid && userById.get(uid) != null
      ? Number(userById.get(uid).costRatePerHour) || DEFAULT_USER_RATE
      : DEFAULT_USER_RATE;
  return hrs * rate;
}

/**
 * Full financial snapshot for one project + optional margin alerts.
 */
async function calculateProjectFinancials(projectId, options = {}) {
  const { skipAlerts = false, marginThresholdPct = DEFAULT_MARGIN_ALERT_THRESHOLD } = options;

  if (!mongoose.Types.ObjectId.isValid(projectId)) {
    throw new Error('Invalid project id');
  }

  const project = await Project.findById(projectId)
    .populate('deliveryHeadId', '_id name email')
    .populate('projectManagerId', '_id name email');

  if (!project) {
    throw new Error('Project not found');
  }

  const modules = await Module.find({ projectId }).sort({ createdAt: 1 });
  const moduleIds = modules.map((m) => m._id);
  const workstreams = await Workstream.find({ moduleId: { $in: moduleIds } }).sort({ createdAt: 1 });
  const wsIds = workstreams.map((w) => w._id);

  const tasks = await Task.find({ workstreamId: { $in: wsIds } }).populate(
    'assignedTo',
    'name email costRatePerHour seniority'
  );

  const userIds = [...new Set(tasks.map((t) => t.assignedTo?._id).filter(Boolean))];
  const users = await User.find({ _id: { $in: userIds } }).select('costRatePerHour seniority name');
  const userById = new Map(users.map((u) => [u._id.toString(), u]));

  let totalCost = 0;
  let billableCost = 0;
  let nonBillableCost = 0;

  const taskMeta = tasks.map((t) => {
    const cost = taskCost(t, userById);
    const bill = t.billable !== false;
    totalCost += cost;
    if (bill) billableCost += cost;
    else nonBillableCost += cost;
    return { task: t, cost, bill };
  });

  const implementationFee =
    Number(project.implementationFee) > 0
      ? Number(project.implementationFee)
      : Number(project.contractValue) || 0;

  const marginAmount = implementationFee - totalCost;
  const marginPercent =
    implementationFee > 0 ? Math.round((marginAmount / implementationFee) * 1000) / 10 : 0;

  const billabilityPercent =
    totalCost > 0 ? Math.round((billableCost / totalCost) * 1000) / 10 : 100;

  const remainingTasks = tasks.filter((t) => t.status !== 'Done').length;
  const completedOrActive = tasks.filter((t) => t.status === 'Done' || (t.loggedHours || 0) > 0).length;
  const avgCostPerTask = totalCost / Math.max(1, completedOrActive || tasks.length);
  const projectedRemainingCost = remainingTasks * avgCostPerTask;
  const eac = totalCost + projectedRemainingCost;
  const contractValue = Number(project.contractValue) || 0;
  const eacVariance = contractValue - eac;

  const projectAgeMs = Date.now() - new Date(project.createdAt || Date.now()).getTime();
  const ageWeeks = Math.max(msWeeks(projectAgeMs), 1 / 7);
  const weeklyCost = totalCost / ageWeeks;
  const burnRate = `${Math.round(weeklyCost).toLocaleString('en-IN')} per week`;

  const thresholdAmount = (implementationFee * marginThresholdPct) / 100;
  let weeksToThreshold = null;
  if (weeklyCost > 0 && marginAmount > thresholdAmount) {
    weeksToThreshold = Math.ceil((marginAmount - thresholdAmount) / weeklyCost);
  } else if (marginPercent < marginThresholdPct) {
    weeksToThreshold = 0;
  }

  const wsByModule = new Map();
  workstreams.forEach((w) => {
    const k = w.moduleId.toString();
    if (!wsByModule.has(k)) wsByModule.set(k, []);
    wsByModule.get(k).push(w);
  });

  const loggedByWs = new Map();
  const costByWs = new Map();
  wsIds.forEach((id) => {
    loggedByWs.set(id.toString(), 0);
    costByWs.set(id.toString(), 0);
  });
  taskMeta.forEach(({ task, cost }) => {
    const wid = task.workstreamId.toString();
    loggedByWs.set(wid, (loggedByWs.get(wid) || 0) + (Number(task.loggedHours) || 0));
    costByWs.set(wid, (costByWs.get(wid) || 0) + cost);
  });

  const blendedRate =
    tasks.reduce((s, t) => s + (Number(t.loggedHours) || 0), 0) > 0
      ? totalCost / tasks.reduce((s, t) => s + (Number(t.loggedHours) || 0), 0)
      : DEFAULT_USER_RATE;

  const byModule = modules.map((mod) => {
    const modWss = wsByModule.get(mod._id.toString()) || [];
    let modLogged = 0;
    let modCost = 0;
    const byWorkstream = modWss.map((ws) => {
      const wid = ws._id.toString();
      const logged = loggedByWs.get(wid) || 0;
      const consumed = costByWs.get(wid) || 0;
      modLogged += logged;
      modCost += consumed;
      const wsBudgetH = Number(ws.budgetHours) > 0 ? Number(ws.budgetHours) : 0;
      const wsRate = Number(ws.costRate) > 0 ? Number(ws.costRate) : blendedRate;
      const budgetValue = wsBudgetH * wsRate;
      const burnPct =
        wsBudgetH > 0 ? Math.min(100, Math.round((logged / wsBudgetH) * 1000) / 10) : mod.budgetHours > 0
          ? Math.min(100, Math.round((logged / Math.max(mod.budgetHours / Math.max(modWss.length, 1), 1)) * 1000) / 10)
          : 0;

      return {
        workstreamId: ws._id,
        name: ws.name,
        budgetHours: wsBudgetH,
        costRate: wsRate,
        loggedHours: logged,
        costConsumed: Math.round(consumed),
        burnPercent: burnPct,
        budgetValue: Math.round(budgetValue),
      };
    });

    const burnPercent =
      mod.budgetHours > 0 ? Math.min(100, Math.round((modLogged / mod.budgetHours) * 1000) / 10) : 0;

    return {
      moduleId: mod._id,
      name: mod.name,
      budgetHours: mod.budgetHours,
      loggedHours: Math.round(modLogged * 10) / 10,
      costConsumed: Math.round(modCost),
      burnPercent,
      byWorkstream,
    };
  });

  if (!skipAlerts && implementationFee > 0 && marginPercent < marginThresholdPct) {
    await maybeCreateMarginAlert(project, {
      marginPercent,
      marginAmount,
      marginThresholdPct,
      weeksToThreshold,
      burnRate,
      totalCost,
      implementationFee,
    });
  }

  return {
    totalCost: Math.round(totalCost),
    implementationFee: Math.round(implementationFee),
    notionalARR: Number(project.notionalARR) || 0,
    marginAmount: Math.round(marginAmount),
    marginPercent,
    billableCost: Math.round(billableCost),
    nonBillableCost: Math.round(nonBillableCost),
    billabilityPercent,
    eac: Math.round(eac),
    eacVariance: Math.round(eacVariance),
    burnRate,
    weeksToThreshold,
    byModule,
  };
}

async function maybeCreateMarginAlert(project, payload) {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const existing = await Alert.findOne({
    type: 'MarginAlert',
    projectId: project._id,
    isRead: false,
    createdAt: { $gte: oneHourAgo },
  });
  if (existing) return;

  const recipients = [];
  if (project.projectManagerId) recipients.push(project.projectManagerId);
  if (project.deliveryHeadId) recipients.push(project.deliveryHeadId);

  const msg = `Margin ${payload.marginPercent}% is below threshold ${payload.marginThresholdPct}%. Burn: ${payload.burnRate}. Weeks to threshold breach: ${payload.weeksToThreshold ?? 'n/a'}.`;

  await Alert.create({
    type: 'MarginAlert',
    projectId: project._id,
    severity: payload.marginPercent < payload.marginThresholdPct / 2 ? 'Critical' : 'Warning',
    message: msg,
    data: payload,
    recipients,
    isRead: false,
    createdAt: new Date(),
  });
}

/**
 * Portfolio rollup by project.region
 * @param {object} [projectQuery] — optional Mongo filter (e.g. `{ deliveryHeadId }` for DH)
 */
async function calculatePortfolioFinancials(projectQuery = {}) {
  const projects = await Project.find(projectQuery).sort({ region: 1, name: 1 });
  const regions = {};

  for (const p of projects) {
    const region = p.region || 'Other';
    if (!regions[region]) {
      regions[region] = { region, projects: [], totalRevenue: 0, totalCost: 0, marginSum: 0, count: 0 };
    }

    let fin;
    try {
      fin = await calculateProjectFinancials(p._id, { skipAlerts: true });
    } catch {
      continue;
    }

    const revenue =
      Number(p.implementationFee) > 0
        ? Number(p.implementationFee)
        : Number(p.contractValue) || 0;
    const marginPct = fin.marginPercent;
    let rag = ON_TRACK;
    if (marginPct < 15) rag = AT_RISK;
    else if (marginPct < 25) rag = CAUTION;

    regions[region].projects.push({
      projectId: p._id,
      name: p.name,
      clientName: p.clientName,
      revenue,
      totalCost: fin.totalCost,
      marginPercent: marginPct,
      rag,
    });
    regions[region].totalRevenue += revenue;
    regions[region].totalCost += fin.totalCost;
    regions[region].marginSum += marginPct;
    regions[region].count += 1;
  }

  const regionList = Object.values(regions).map((r) => ({
    ...r,
    avgMargin:
      r.count > 0 ? Math.round((r.marginSum / r.count) * 10) / 10 : 0,
    portfolioMarginPct:
      r.totalRevenue > 0
        ? Math.round(((r.totalRevenue - r.totalCost) / r.totalRevenue) * 1000) / 10
        : 0,
  }));

  return { regions: regionList };
}

module.exports = {
  calculateProjectFinancials,
  calculatePortfolioFinancials,
  DEFAULT_MARGIN_ALERT_THRESHOLD,
};
