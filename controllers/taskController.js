const mongoose = require('mongoose');
const Task = require('../models/Task');
const Workstream = require('../models/Workstream');
const Module = require('../models/Module');
const Project = require('../models/Project');
const { recordAudit } = require('../middleware/audit');
const {
  getMemberMyTasksWorkstreamIds,
  assertUserCanViewProject,
} = require('./projectController');
const { getPresetByKey, listPresets } = require('../services/taskPresets');

const TASK_STATUSES = ['Not Started', 'In Progress', 'Done'];

async function getProjectIdForTaskDoc(task) {
  const ws = await Workstream.findById(task.workstreamId);
  if (!ws) return null;
  const mod = await Module.findById(ws.moduleId);
  return mod?.projectId || null;
}

function userInWorkstreamTeam(user, ws) {
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

/** Member may update / log on task if assignee, or in workstream team (memberIds / lead). */
function canMemberActOnTask(user, task, ws) {
  if (task.assignedTo?.toString() === user._id.toString()) return true;
  if (userInWorkstreamTeam(user, ws)) return true;
  return false;
}

async function assertCanCreateTaskInWorkstream(req, workstreamId) {
  if (['admin', 'dh'].includes(req.user.role)) return { ok: true };
  if (req.user.role === 'pm') {
    const ws = await Workstream.findById(workstreamId);
    if (!ws) return { ok: false, message: 'Workstream not found' };
    const mod = await Module.findById(ws.moduleId);
    if (!mod) return { ok: false, message: 'Module not found' };
    const project = await Project.findById(mod.projectId);
    if (!project) return { ok: false, message: 'Project not found' };
    const pmId = project.projectManagerId?.toString();
    if (pmId && pmId === req.user._id.toString()) return { ok: true };
    return { ok: false, message: 'Only the project PM or admin can create tasks here' };
  }
  return { ok: false, message: 'Not authorized' };
}

async function assertModuleAllowsNewTasks(workstreamId) {
  const ws = await Workstream.findById(workstreamId);
  if (!ws) return { ok: false, message: 'Workstream not found' };
  const mod = await Module.findById(ws.moduleId);
  if (!mod) return { ok: false, message: 'Module not found' };
  const deps = await Module.find({ _id: { $in: mod.dependsOn || [] } });
  const incomplete = deps.filter((d) => (d.status || 'Not Started') !== 'Completed');
  if (incomplete.length) {
    return {
      ok: false,
      message: `Cannot create tasks until dependency modules are Completed: ${incomplete
        .map((d) => d.name)
        .join(', ')}`,
    };
  }
  return { ok: true };
}

// GET /api/tasks/my
const getMyTasks = async (req, res) => {
  try {
    let filter = {};
    if (req.user.role === 'member') {
      const wsIds = await getMemberMyTasksWorkstreamIds(req.user._id);
      filter = wsIds.length ? { workstreamId: { $in: wsIds } } : { assignedTo: req.user._id };
    } else if (req.user.role === 'pm') {
      const pids = await Project.find({ projectManagerId: req.user._id }).distinct('_id');
      const mids = await Module.find({ projectId: { $in: pids } }).distinct('_id');
      const wids = await Workstream.find({ moduleId: { $in: mids } }).distinct('_id');
      filter = { workstreamId: { $in: wids } };
    } else if (req.user.role === 'dh') {
      const pids = await Project.find({ deliveryHeadId: req.user._id }).distinct('_id');
      if (!pids.length) {
        return res.json([]);
      }
      const mids = await Module.find({ projectId: { $in: pids } }).distinct('_id');
      if (!mids.length) {
        return res.json([]);
      }
      const wids = await Workstream.find({ moduleId: { $in: mids } }).distinct('_id');
      filter = wids.length ? { workstreamId: { $in: wids } } : { _id: { $in: [] } };
    }

    const tasks = await Task.find(filter)
      .populate('workstreamId', 'name')
      .populate('assignedTo', 'name email')
      .sort({ dueDate: 1 });

    res.json(tasks);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/tasks?workstreamId=xxx
const getTasksByWorkstream = async (req, res) => {
  try {
    const { workstreamId } = req.query;

    if (!workstreamId || !mongoose.Types.ObjectId.isValid(workstreamId)) {
      return res.status(400).json({ message: 'workstreamId query param required and must be a valid ObjectId' });
    }

    const ws = await Workstream.findById(workstreamId);
    if (!ws) {
      return res.status(404).json({ message: 'Workstream not found' });
    }

    const modGate = await Module.findById(ws.moduleId).select('projectId');
    if (!modGate) {
      return res.status(404).json({ message: 'Module not found' });
    }
    if (!['admin', 'pmo', 'exec'].includes(req.user.role)) {
      const access = await assertUserCanViewProject(req, modGate.projectId);
      if (!access.ok) {
        return res.status(access.status).json({ message: access.message });
      }
    }

    if (req.user.role === 'member') {
      const assigned = await Task.exists({ workstreamId, assignedTo: req.user._id });
      const inTeam = userInWorkstreamTeam(req.user, ws);
      const legacy = (!ws.memberIds || ws.memberIds.length === 0) && assigned;
      if (!inTeam && !legacy) {
        return res.status(403).json({ message: 'Not a member of this workstream' });
      }
    }

    const query = { workstreamId };
    const tasks = await Task.find(query).populate('assignedTo', 'name email').sort({ dueDate: 1 });
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/tasks
const createTask = async (req, res) => {
  try {
    const { workstreamId, parentTaskId } = req.body;
    if (!workstreamId) {
      return res.status(400).json({ message: 'workstreamId is required' });
    }

    const authz = await assertCanCreateTaskInWorkstream(req, workstreamId);
    if (!authz.ok) return res.status(403).json({ message: authz.message });

    const gate = await assertModuleAllowsNewTasks(workstreamId);
    if (!gate.ok) return res.status(400).json({ message: gate.message });

    if (parentTaskId) {
      const parent = await Task.findById(parentTaskId);
      if (!parent) return res.status(400).json({ message: 'Parent task not found' });
      if (parent.workstreamId.toString() !== String(workstreamId)) {
        return res.status(400).json({ message: 'Subtask must belong to the same workstream as its parent' });
      }
    }

    const task = await Task.create(req.body);
    const populated = await Task.findById(task._id).populate('assignedTo', 'name email');
    const projectId = await getProjectIdForTaskDoc(task);

    await recordAudit({
      entityType: 'Task',
      entityId: task._id,
      action: 'task_created',
      before: null,
      after: {
        title: task.title,
        status: task.status,
        workstreamId: task.workstreamId.toString(),
      },
      actorId: req.user._id,
      actorName: req.user.name,
      projectId,
    });

    res.status(201).json(populated);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// PUT /api/tasks/:id
const updateTask = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ message: 'Task not found' });

    const projectId = await getProjectIdForTaskDoc(task);

    const updateData = { ...req.body };
    if (req.body.assignedTo === '' || req.body.assignedTo === 'null' || req.body.assignedTo === null) {
      updateData.assignedTo = null;
    }

    if (req.user.role === 'member') {
      const ws = await Workstream.findById(task.workstreamId);
      if (!canMemberActOnTask(req.user, task, ws)) {
        return res.status(403).json({ message: 'Not authorized' });
      }

      const { status } = req.body;
      const updatedTask = await Task.findByIdAndUpdate(
        req.params.id,
        { status },
        { new: true, runValidators: true }
      ).populate('assignedTo', 'name email');

      if (status !== undefined && status !== task.status) {
        await recordAudit({
          entityType: 'Task',
          entityId: task._id,
          action: 'status_changed',
          before: { status: task.status, title: task.title },
          after: { status, title: task.title },
          actorId: req.user._id,
          actorName: req.user.name,
          projectId,
        });
      }

      return res.json(updatedTask);
    }

    const prevAssigned = task.assignedTo?.toString() || null;
    const prevStatus = task.status;

    if (Array.isArray(updateData.dependsOnTaskIds)) {
      const cleanedIds = [...new Set(
        updateData.dependsOnTaskIds
          .map((d) => String(d))
          .filter((d) => d && mongoose.Types.ObjectId.isValid(d))
      )];
      const selfRef = cleanedIds.find((id) => id === String(task._id));
      if (selfRef) {
        return res.status(400).json({ message: 'A task cannot depend on itself' });
      }
      // Reject if any dependency does not exist.
      const validCount = await Task.countDocuments({ _id: { $in: cleanedIds } });
      if (validCount !== cleanedIds.length) {
        return res.status(400).json({ message: 'One or more dependsOnTaskIds do not match existing tasks' });
      }
      updateData.dependsOnTaskIds = cleanedIds;
    }

    const updatedTask = await Task.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
    }).populate('assignedTo', 'name email');

    if (req.body.status !== undefined && req.body.status !== prevStatus) {
      await recordAudit({
        entityType: 'Task',
        entityId: task._id,
        action: 'status_changed',
        before: { status: prevStatus, title: task.title },
        after: { status: updatedTask.status, title: task.title },
        actorId: req.user._id,
        actorName: req.user.name,
        projectId,
      });
    }

    if (req.body.assignedTo !== undefined) {
      const nextAssigned = updatedTask.assignedTo?._id?.toString() || updatedTask.assignedTo?.toString() || null;
      if (nextAssigned !== prevAssigned) {
        await recordAudit({
          entityType: 'Task',
          entityId: task._id,
          action: 'assigned_to',
          before: { assignedTo: prevAssigned, title: task.title },
          after: { assignedTo: nextAssigned, title: task.title },
          actorId: req.user._id,
          actorName: req.user.name,
          projectId,
        });
      }
    }

    res.json(updatedTask);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// PATCH /api/tasks/:id/log-hours
const logHours = async (req, res) => {
  try {
    const { hours } = req.body;
    if (typeof hours !== 'number' || hours < 0) {
      return res.status(400).json({ message: 'hours must be a non-negative number' });
    }

    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ message: 'Task not found' });

    if (req.user.role === 'member') {
      const ws = await Workstream.findById(task.workstreamId);
      if (!canMemberActOnTask(req.user, task, ws)) {
        return res.status(403).json({ message: 'Not authorized to log hours on this task' });
      }
    }

    const beforeHours = task.loggedHours;
    const projectId = await getProjectIdForTaskDoc(task);

    const updatedTask = await Task.findByIdAndUpdate(
      req.params.id,
      { $inc: { loggedHours: hours } },
      { new: true }
    ).populate('assignedTo', 'name');

    await recordAudit({
      entityType: 'Task',
      entityId: task._id,
      action: 'hours_logged',
      before: { loggedHours: beforeHours, title: task.title },
      after: { loggedHours: updatedTask.loggedHours, added: hours, title: task.title },
      actorId: req.user._id,
      actorName: req.user.name,
      projectId,
    });

    res.json(updatedTask);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// PATCH /api/tasks/bulk
const bulkUpdateTasks = async (req, res) => {
  try {
    const { taskIds, operation, value } = req.body;
    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      return res.status(400).json({ message: 'taskIds must be a non-empty array' });
    }
    for (const tid of taskIds) {
      if (!mongoose.Types.ObjectId.isValid(tid)) {
        return res.status(400).json({ message: `Invalid task id: ${tid}` });
      }
    }

    const tasks = await Task.find({ _id: { $in: taskIds } });
    if (tasks.length !== taskIds.length) {
      return res.status(400).json({ message: 'One or more task IDs were not found' });
    }

    // Map taskId → projectId so audits land on the correct project even when
    // bulk operations span projects (only admin/pmo/dh are permitted to cross
    // projects; PM is restricted via the route guard below).
    const projectIdByTask = new Map();
    for (const t of tasks) {
      const pid = await getProjectIdForTaskDoc(t);
      projectIdByTask.set(String(t._id), pid ? String(pid) : null);
    }
    const projectIds = new Set([...projectIdByTask.values()].filter(Boolean));
    if (projectIds.size > 1 && !['admin', 'pmo', 'dh'].includes(req.user.role)) {
      return res.status(400).json({
        message: 'Only admin / PMO / DH can bulk-edit tasks across multiple projects',
      });
    }
    const projectId = projectIds.size === 1 ? [...projectIds][0] : null;

    const updated = [];

    if (operation === 'assign') {
      const userId = value === '' || value == null ? null : String(value);
      if (userId && !mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(400).json({ message: 'value must be a valid user id for assign' });
      }
      for (const t of tasks) {
        const prev = t.assignedTo?.toString() || null;
        const next = userId;
        const doc = await Task.findByIdAndUpdate(
          t._id,
          { assignedTo: next },
          { new: true, runValidators: true }
        ).populate('assignedTo', 'name email');
        updated.push(doc);
        await recordAudit({
          entityType: 'Task',
          entityId: t._id,
          action: 'assigned_to',
          before: { assignedTo: prev, title: t.title },
          after: { assignedTo: next, title: t.title },
          actorId: req.user._id,
          actorName: req.user.name,
          projectId: projectId || projectIdByTask.get(String(t._id)) || null,
        });
      }
    } else if (operation === 'date-shift') {
      const days = Number(value);
      if (!Number.isFinite(days)) {
        return res.status(400).json({ message: 'value must be a number of days for date-shift' });
      }
      const ms = days * 24 * 60 * 60 * 1000;
      for (const t of tasks) {
        const prevDue = t.dueDate;
        const newDue = new Date(prevDue.getTime() + ms);
        const doc = await Task.findByIdAndUpdate(
          t._id,
          { dueDate: newDue },
          { new: true, runValidators: true }
        ).populate('assignedTo', 'name email');
        updated.push(doc);
        await recordAudit({
          entityType: 'Task',
          entityId: t._id,
          action: 'due_date_shifted',
          before: { dueDate: prevDue, title: t.title },
          after: { dueDate: newDue, days, title: t.title },
          actorId: req.user._id,
          actorName: req.user.name,
          projectId: projectId || projectIdByTask.get(String(t._id)) || null,
        });
      }
    } else if (operation === 'status') {
      const status = String(value || '');
      if (!TASK_STATUSES.includes(status)) {
        return res.status(400).json({ message: `Invalid status. Allowed: ${TASK_STATUSES.join(', ')}` });
      }
      for (const t of tasks) {
        const prevStatus = t.status;
        const doc = await Task.findByIdAndUpdate(
          t._id,
          { status },
          { new: true, runValidators: true }
        ).populate('assignedTo', 'name email');
        updated.push(doc);
        await recordAudit({
          entityType: 'Task',
          entityId: t._id,
          action: 'status_changed',
          before: { status: prevStatus, title: t.title },
          after: { status, title: t.title },
          actorId: req.user._id,
          actorName: req.user.name,
          projectId: projectId || projectIdByTask.get(String(t._id)) || null,
        });
      }
    } else {
      return res.status(400).json({ message: 'operation must be assign, date-shift, or status' });
    }

    res.json({ updated: updated.length, tasks: updated });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// DELETE /api/tasks/:id
const deleteTask = async (req, res) => {
  try {
    const hasChildren = await Task.exists({ parentTaskId: req.params.id });
    if (hasChildren) {
      return res.status(400).json({ message: 'Remove or re-parent subtasks before deleting this task' });
    }
    const task = await Task.findByIdAndDelete(req.params.id);
    if (!task) return res.status(404).json({ message: 'Task not found' });
    res.json({ message: 'Task deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/tasks/presets — built-in recurring task patterns
const listTaskPresets = async (req, res) => {
  try {
    res.json({ presets: listPresets() });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/tasks/apply-preset — instantiate a preset under a workstream
const applyTaskPreset = async (req, res) => {
  try {
    const { workstreamId, presetKey, anchorDate } = req.body || {};
    if (!workstreamId || !mongoose.Types.ObjectId.isValid(workstreamId)) {
      return res.status(400).json({ message: 'workstreamId is required' });
    }
    if (!presetKey) return res.status(400).json({ message: 'presetKey is required' });
    const preset = getPresetByKey(presetKey);
    if (!preset) return res.status(404).json({ message: 'Unknown preset' });

    const authz = await assertCanCreateTaskInWorkstream(req, workstreamId);
    if (!authz.ok) return res.status(403).json({ message: authz.message });

    const gate = await assertModuleAllowsNewTasks(workstreamId);
    if (!gate.ok) return res.status(400).json({ message: gate.message });

    const ws = await Workstream.findById(workstreamId);
    const anchorRaw =
      anchorDate ||
      ws?.actualStartDate ||
      ws?.baselinePlannedStartDate ||
      new Date().toISOString();
    const anchor = new Date(anchorRaw);
    if (Number.isNaN(anchor.getTime())) {
      return res.status(400).json({ message: 'Invalid anchorDate' });
    }

    const created = [];
    for (const tDef of preset.tasks) {
      const offsetDays = Number.isFinite(tDef.offsetDays) ? Number(tDef.offsetDays) : 0;
      const durationDays = Number.isFinite(tDef.durationDays) ? Number(tDef.durationDays) : 5;
      const dueDate = new Date(anchor.getTime() + (offsetDays + durationDays) * 86400000);
      const taskDoc = await Task.create({
        title: tDef.title,
        owner: tDef.owner || 'Project Manager',
        status: 'Not Started',
        dueDate,
        workstreamId,
        billable: tDef.billable !== false,
      });
      created.push(taskDoc);
    }

    const projectId = await getProjectIdForTaskDoc(created[0]);
    await recordAudit({
      entityType: 'Task',
      entityId: created[0]?._id || null,
      action: 'preset_applied',
      before: null,
      after: {
        presetKey,
        workstreamId: String(workstreamId),
        taskCount: created.length,
      },
      actorId: req.user._id,
      actorName: req.user.name,
      projectId,
    });

    res.status(201).json({ created: created.length, tasks: created });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

module.exports = {
  getMyTasks,
  getTasksByWorkstream,
  createTask,
  updateTask,
  logHours,
  bulkUpdateTasks,
  deleteTask,
  listTaskPresets,
  applyTaskPreset,
};
