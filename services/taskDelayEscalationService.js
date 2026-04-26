const Task = require('../models/Task');
const Workstream = require('../models/Workstream');
const Module = require('../models/Module');
const Alert = require('../models/Alert');
const { recordAudit } = require('../middleware/audit');

const MS_DAY = 86400000;

function daysOverdue(due) {
  const now = new Date();
  const d = new Date(due);
  return Math.floor((now - d) / MS_DAY);
}

const projectByWs = new Map();

async function projectIdForTask(task) {
  const wid = task.workstreamId.toString();
  if (projectByWs.has(wid)) return projectByWs.get(wid);
  const ws = await Workstream.findById(task.workstreamId).lean();
  if (!ws) {
    projectByWs.set(wid, null);
    return null;
  }
  const mod = await Module.findById(ws.moduleId).select('projectId').lean();
  const pid = mod?.projectId || null;
  projectByWs.set(wid, pid);
  return pid;
}

/**
 * Scans not-Done tasks past due date: 3d / 5d warnings, 7d At Risk,
 * with idempotent one-shot alerts and audit.
 */
async function runTaskDelayEscalation() {
  projectByWs.clear();
  const now = new Date();
  const tasks = await Task.find({ status: { $ne: 'Done' } }).lean();
  const overdue = tasks.filter((t) => t.dueDate && new Date(t.dueDate) < now);
  let updated = 0;
  for (const t of overdue) {
    const d = daysOverdue(t.dueDate);
    if (d < 1) continue;

    const projectId = await projectIdForTask(t);
    if (!projectId) continue;

    const patch = {};
    if (d >= 3 && !t.day3WarningSent) {
      patch.day3WarningSent = true;
      await Alert.create({
        type: 'OverdueTask3d',
        projectId,
        severity: 'Warning',
        message: `Task "${t.title}" is ${d} day(s) overdue (3+ day notice).`,
        data: { taskId: t._id.toString(), workstreamId: t.workstreamId.toString(), daysOverdue: d },
      });
      await recordAudit({
        entityType: 'Task',
        entityId: t._id,
        action: 'overdue_3d_warning',
        before: { title: t.title, dueDate: t.dueDate, riskLevel: t.riskLevel || 'Normal' },
        after: { daysOverdue: d },
        actorId: null,
        actorName: 'System (scheduler)',
        projectId,
      });
    }
    if (d >= 5 && !t.day5WarningSent) {
      patch.day5WarningSent = true;
      await Alert.create({
        type: 'OverdueTask5d',
        projectId,
        severity: 'Warning',
        message: `Task "${t.title}" is ${d} day(s) overdue (5+ day notice).`,
        data: { taskId: t._id.toString(), workstreamId: t.workstreamId.toString(), daysOverdue: d },
      });
      await recordAudit({
        entityType: 'Task',
        entityId: t._id,
        action: 'overdue_5d_warning',
        before: { title: t.title, dueDate: t.dueDate, riskLevel: t.riskLevel || 'Normal' },
        after: { daysOverdue: d },
        actorId: null,
        actorName: 'System (scheduler)',
        projectId,
      });
    }
    if (d >= 7) {
      if (t.riskLevel !== 'At Risk') {
        patch.riskLevel = 'At Risk';
        await Alert.create({
          type: 'OverdueTask7d',
          projectId,
          severity: 'Critical',
          message: `Task "${t.title}" marked At Risk (7+ days overdue).`,
          data: { taskId: t._id.toString(), workstreamId: t.workstreamId.toString(), daysOverdue: d },
        });
        await recordAudit({
          entityType: 'Task',
          entityId: t._id,
          action: 'auto_risk_at_risk',
          before: { title: t.title, dueDate: t.dueDate, riskLevel: t.riskLevel || 'Normal' },
          after: { riskLevel: 'At Risk', daysOverdue: d },
          actorId: null,
          actorName: 'System (scheduler)',
          projectId,
        });
      }
    }

    if (Object.keys(patch).length) {
      await Task.findByIdAndUpdate(t._id, { $set: patch });
      updated += 1;
    }
  }
  if (overdue.length && updated) {
    console.log(`[TaskDelay] Processed ${overdue.length} overdue open tasks, updated ${updated}.`);
  }
  return { overdue: overdue.length, patched: updated };
}

module.exports = { runTaskDelayEscalation };
