/**
 * Darwinbox Timesheets — MOCK API (Module 3).
 * Simulates Darwinbox data flows. Replace with real HTTP clients in production.
 */

const mongoose = require('mongoose');
const Task = require('../models/Task');
const Module = require('../models/Module');
const Workstream = require('../models/Workstream');

/** @type {Array<object>} Simulates rows returned by Darwinbox after approval */
const mockTimesheetEntries = [];

const mockEmployees = [
  {
    employeeId: 'DB001',
    name: 'Rahul Sharma',
    email: 'rahul@beagle.com',
    role: 'Functional Consultant',
    seniority: 'Senior',
    region: 'India',
    costRatePerHour: 2500,
    department: 'Core HR Practice',
    rateVersions: [
      { effectiveFrom: new Date('2024-01-01'), ratePerHour: 2200 },
      { effectiveFrom: new Date('2025-06-01'), ratePerHour: 2500 },
    ],
  },
  {
    employeeId: 'DB002',
    name: 'Priya Nair',
    email: 'priya@beagle.com',
    role: 'Technical Consultant',
    seniority: 'Mid',
    region: 'India',
    costRatePerHour: 1800,
    department: 'Payroll Practice',
    rateVersions: [{ effectiveFrom: new Date('2024-01-01'), ratePerHour: 1800 }],
  },
  {
    employeeId: 'DB003',
    name: 'Amit Verma',
    email: 'amit@beagle.com',
    role: 'Functional Consultant',
    seniority: 'Lead',
    region: 'India',
    costRatePerHour: 3200,
    department: 'Core HR Practice',
    rateVersions: [{ effectiveFrom: new Date('2024-01-01'), ratePerHour: 3200 }],
  },
  {
    employeeId: 'DB004',
    name: 'Sneha Iyer',
    email: 'sneha@beagle.com',
    role: 'Data Consultant',
    seniority: 'Senior',
    region: 'SEA',
    costRatePerHour: 2100,
    department: 'Data Migration',
    rateVersions: [{ effectiveFrom: new Date('2024-01-01'), ratePerHour: 2100 }],
  },
];

/** Approved leave (mock). */
const mockLeave = [
  {
    employeeId: 'DB003',
    fromDate: new Date('2026-04-20'),
    toDate: new Date('2026-04-27'),
    type: 'Annual',
  },
];

/** projectId (string) -> { tags: [...], pushedAt } */
const registeredTagsByProject = new Map();

/** `${projectId}:${employeeId}` -> Date last timesheet submission (mock) */
const lastSubmissionByProjectEmployee = new Map();

function normEmail(e) {
  return (e || '').toLowerCase().trim();
}

function overlapsRange(entryFrom, entryTo, from, to) {
  return entryFrom <= to && entryTo >= from;
}

/**
 * Simulates POST to Darwinbox to register UDIP project/module/workstream tags.
 */
async function pushProjectTags(projectId, modules, workstreams) {
  const pid = projectId.toString();
  const modById = new Map((modules || []).map((m) => [m._id.toString(), m]));
  const tags = (workstreams || []).map((w) => {
    const mod = modById.get(w.moduleId.toString());
    return {
      moduleId: w.moduleId,
      moduleName: mod?.name || 'Module',
      workstreamId: w._id,
      workstreamName: w.name,
    };
  });
  registeredTagsByProject.set(pid, { tags, pushedAt: new Date() });
  // eslint-disable-next-line no-console
  console.log(`[DARWINBOX MOCK] Tags pushed for project ${pid}`, { tagCount: tags.length });

  await seedTimesheetEntriesForProject(pid);
  return { success: true, tagCount: tags.length };
}

async function seedTimesheetEntriesForProject(projectIdStr) {
  const pid = new mongoose.Types.ObjectId(projectIdStr);
  const modules = await Module.find({ projectId: pid });
  if (!modules.length) return;

  const wsList = await Workstream.find({ moduleId: { $in: modules.map((m) => m._id) } });
  const wsIds = wsList.map((w) => w._id);
  const wsById = new Map(wsList.map((w) => [w._id.toString(), w]));
  const modById = new Map(modules.map((m) => [m._id.toString(), m]));

  const tasks = await Task.find({ workstreamId: { $in: wsIds } }).populate('assignedTo', 'email name');
  const mockEmails = new Set(mockEmployees.map((e) => normEmail(e.email)));

  for (const t of tasks) {
    const em = normEmail(t.assignedTo?.email);
    if (!em || !mockEmails.has(em)) continue;
    const emp = mockEmployees.find((e) => normEmail(e.email) === em);
    const ws = wsById.get(t.workstreamId.toString());
    if (!emp || !ws) continue;
    const mod = modById.get(ws.moduleId.toString());
    if (!mod) continue;

    const dup = mockTimesheetEntries.some((e) => e.taskId === t._id.toString() && e.projectId === projectIdStr);
    if (dup) continue;

    const hours = Math.round((4 + Math.random() * 8) * 2) / 2;
    mockTimesheetEntries.push({
      id: `mock-${projectIdStr}-${t._id}`,
      projectId: projectIdStr,
      taskId: t._id.toString(),
      workstreamId: ws._id.toString(),
      moduleId: mod._id.toString(),
      moduleName: mod.name,
      workstreamName: ws.name,
      employeeId: emp.employeeId,
      employeeEmail: emp.email,
      hours,
      billable: Math.random() > 0.12,
      approvedFrom: new Date(Date.now() - 14 * 86400000),
      approvedTo: new Date(),
      status: 'approved',
    });
    lastSubmissionByProjectEmployee.set(`${projectIdStr}:${emp.employeeId}`, new Date());
  }

  // Demo: Priya appears as overdue non-submitter until first sync touches her synthetic row
  const tagInfo = registeredTagsByProject.get(projectIdStr);
  const firstTag = tagInfo?.tags?.[0];
  if (
    firstTag &&
    firstTag.workstreamId &&
    !mockTimesheetEntries.some((e) => e.projectId === projectIdStr && e.employeeId === 'DB002')
  ) {
    mockTimesheetEntries.push({
      id: `mock-${projectIdStr}-demo-db002`,
      projectId: projectIdStr,
      taskId: null,
      workstreamId: firstTag.workstreamId.toString(),
      moduleId: firstTag.moduleId.toString(),
      moduleName: firstTag.moduleName,
      workstreamName: firstTag.workstreamName,
      employeeId: 'DB002',
      employeeEmail: 'priya@beagle.com',
      hours: 0,
      billable: true,
      approvedFrom: new Date(Date.now() - 30 * 86400000),
      approvedTo: new Date(Date.now() - 25 * 86400000),
      status: 'draft',
    });
    lastSubmissionByProjectEmployee.set(`${projectIdStr}:DB002`, new Date(Date.now() - 18 * 86400000));
  }
}

/**
 * Simulates reading approved timesheet hours from Darwinbox for a window.
 * @param {boolean} options.mutate — if true, simulates new approvals (hours bump) for sync runs only.
 */
async function getApprovedHours(projectId, fromDate, toDate, options = {}) {
  const { mutate = false } = options;
  const from = new Date(fromDate);
  const to = new Date(toDate);
  const pid = projectId.toString();

  const flat = [];
  for (const e of mockTimesheetEntries) {
    if (e.projectId !== pid || e.status !== 'approved') continue;
    if (!overlapsRange(e.approvedFrom, e.approvedTo, from, to)) continue;

    let hours = e.hours;
    if (mutate && e.taskId) {
      const delta = Math.round((0.5 + Math.random() * 3.5) * 2) / 2;
      e.hours = Math.round((e.hours + delta) * 10) / 10;
      e.hours = Math.min(e.hours, 120);
      e.approvedTo = new Date();
      hours = e.hours;
      lastSubmissionByProjectEmployee.set(`${pid}:${e.employeeId}`, new Date());
    }

    flat.push({
      id: e.id,
      projectId: e.projectId,
      taskId: e.taskId,
      workstreamId: e.workstreamId,
      moduleId: e.moduleId,
      moduleName: e.moduleName,
      workstreamName: e.workstreamName,
      employeeId: e.employeeId,
      hours,
      billable: e.billable !== false,
    });
  }

  const moduleMap = new Map();
  for (const row of flat) {
    const k = row.moduleId;
    if (!moduleMap.has(k)) {
      moduleMap.set(k, {
        moduleId: row.moduleId,
        moduleName: row.moduleName,
        totalHours: 0,
        workstreams: new Map(),
      });
    }
    const m = moduleMap.get(k);
    m.totalHours += row.hours;
    const wk = row.workstreamId;
    if (!m.workstreams.has(wk)) {
      m.workstreams.set(wk, { workstreamId: wk, workstreamName: row.workstreamName, hours: 0 });
    }
    const ws = m.workstreams.get(wk);
    ws.hours += row.hours;
  }

  const byModule = [...moduleMap.values()].map((m) => ({
    moduleId: m.moduleId,
    moduleName: m.moduleName,
    totalHours: Math.round(m.totalHours * 10) / 10,
    byWorkstream: [...m.workstreams.values()].map((w) => ({
      ...w,
      hours: Math.round(w.hours * 10) / 10,
    })),
  }));

  return { entries: flat, byModule, fromDate: from, toDate: to };
}

/**
 * Approved leave for employees in the date window.
 */
async function getEmployeeLeave(employeeIds, fromDate, toDate) {
  const from = new Date(fromDate);
  const to = new Date(toDate);
  const idSet = new Set((employeeIds || []).map(String));
  return mockLeave
    .filter((L) => idSet.has(L.employeeId) && overlapsRange(L.fromDate, L.toDate, from, to))
    .map((L) => ({
      employeeId: L.employeeId,
      fromDate: L.fromDate,
      toDate: L.toDate,
      type: L.type,
    }));
}

/**
 * Employees who have not submitted timesheets recently for this project (mock rules).
 */
async function getNonSubmitters(projectId) {
  const pid = projectId.toString();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const leaveRows = await getEmployeeLeave(
    mockEmployees.map((e) => e.employeeId),
    today,
    new Date(today.getTime() + 86400000)
  );
  const onLeaveIds = new Set(leaveRows.map((r) => r.employeeId));

  const modules = await Module.find({ projectId: new mongoose.Types.ObjectId(pid) });
  const wsList = await Workstream.find({ moduleId: { $in: modules.map((m) => m._id) } });
  const wsIds = wsList.map((w) => w._id);
  const wsById = new Map(wsList.map((w) => [w._id.toString(), w]));
  const modById = new Map(modules.map((m) => [m._id.toString(), m]));

  const tasks = await Task.find({ workstreamId: { $in: wsIds } }).populate('assignedTo', 'email name');
  const mockByEmail = new Map(mockEmployees.map((e) => [normEmail(e.email), e]));

  const seen = new Set();
  const out = [];

  for (const t of tasks) {
    const em = normEmail(t.assignedTo?.email);
    const emp = mockByEmail.get(em);
    if (!emp) continue;
    const ws = wsById.get(t.workstreamId.toString());
    const mod = modById.get(ws?.moduleId?.toString());
    if (!ws || !mod) continue;

    const key = `${emp.employeeId}:${t._id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const last = lastSubmissionByProjectEmployee.get(`${pid}:${emp.employeeId}`) || new Date(0);
    const daysSince = Math.floor((now - last) / 86400000);
    if (daysSince < 5) continue;

    const onLeave = onLeaveIds.has(emp.employeeId);
    out.push({
      employeeId: emp.employeeId,
      name: emp.name,
      module: mod.name,
      workstream: ws.name,
      lastSubmission: last.getTime() ? last.toISOString().slice(0, 10) : null,
      daysOverdue: Math.max(0, daysSince - 5),
      onLeave,
    });
  }

  // Demo row: synthetic DB002 if still no row
  if (!out.length && registeredTagsByProject.has(pid)) {
    const tag = registeredTagsByProject.get(pid).tags[0];
    out.push({
      employeeId: 'DB002',
      name: 'Priya Nair',
      module: tag.moduleName,
      workstream: tag.workstreamName,
      lastSubmission: new Date(Date.now() - 18 * 86400000).toISOString().slice(0, 10),
      daysOverdue: 7,
      onLeave: false,
    });
  }

  if (registeredTagsByProject.has(pid) && !out.some((r) => r.employeeId === 'DB003')) {
    const tag = registeredTagsByProject.get(pid).tags[0];
    out.push({
      employeeId: 'DB003',
      name: 'Amit Verma',
      module: tag.moduleName,
      workstream: tag.workstreamName,
      lastSubmission: new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10),
      daysOverdue: 3,
      onLeave: onLeaveIds.has('DB003'),
    });
  }

  const onLeaveRows = out.filter((r) => r.onLeave);
  const active = out.filter((r) => !r.onLeave);
  return { nonSubmitters: active, onLeave: onLeaveRows };
}

/**
 * Versioned cost rate active on a given date (mock).
 */
async function getEmployeeCostRate(employeeId, onDate) {
  const emp = mockEmployees.find((e) => e.employeeId === employeeId);
  if (!emp) return { employeeId, ratePerHour: null, currency: 'INR' };

  const d = new Date(onDate);
  const versions = emp.rateVersions || [{ effectiveFrom: new Date('2000-01-01'), ratePerHour: emp.costRatePerHour }];
  let rate = versions[0].ratePerHour;
  for (const v of versions) {
    if (new Date(v.effectiveFrom) <= d) rate = v.ratePerHour;
  }
  return { employeeId, ratePerHour: rate, currency: 'INR', effectiveFrom: versions[0].effectiveFrom };
}

/**
 * Apply approved entry hours to UDIP tasks (used by sync controller).
 */
async function applyApprovedHoursFromEntries(entries) {
  let updatedCount = 0;
  let failedCount = 0;
  for (const row of entries) {
    if (!row.taskId) continue;
    try {
      await Task.findByIdAndUpdate(
        row.taskId,
        {
          loggedHours: Math.max(0, Math.round(row.hours * 10) / 10),
          billable: row.billable !== false,
        },
        { runValidators: true }
      );
      updatedCount += 1;
    } catch {
      failedCount += 1;
    }
  }
  return { updatedCount, failedCount };
}

module.exports = {
  mockTimesheetEntries,
  mockEmployees,
  mockLeave,
  pushProjectTags,
  getApprovedHours,
  getEmployeeLeave,
  getNonSubmitters,
  getEmployeeCostRate,
  applyApprovedHoursFromEntries,
};
