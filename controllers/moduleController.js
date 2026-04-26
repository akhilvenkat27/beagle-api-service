const mongoose = require('mongoose');
const Module = require('../models/Module');
const Workstream = require('../models/Workstream');
const Task = require('../models/Task');
const { recordAudit } = require('../middleware/audit');
const { assertUserCanViewProject } = require('./projectController');

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

async function computeStatsForModule(mod) {
  const workstreams = await Workstream.find({ moduleId: mod._id });
  const workstreamIds = workstreams.map((w) => w._id);
  const tasks = await Task.find({ workstreamId: { $in: workstreamIds } });

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.status === 'Done').length;
  const overdueTasks = tasks.filter((t) => t.status !== 'Done' && t.dueDate < new Date()).length;
  const loggedHours = tasks.reduce((sum, t) => sum + t.loggedHours, 0);
  const remainingHours = Math.max(mod.budgetHours - loggedHours, 0);
  const burnPercent =
    mod.budgetHours > 0 ? Math.round((loggedHours / mod.budgetHours) * 100) : 0;
  const progress =
    totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  return {
    loggedHours,
    remainingHours,
    burnPercent,
    totalTasks,
    completedTasks,
    overdueTasks,
    progress,
    workstreamCount: workstreams.length,
  };
}

async function buildModulePayload(mod) {
  const stats = await computeStatsForModule(mod);
  const dependsOnIds = (mod.dependsOn || []).map((id) => id.toString());
  let dependsOnDocs = [];
  if (dependsOnIds.length) {
    dependsOnDocs = await Module.find({ _id: { $in: mod.dependsOn } }).select(
      'name status projectId'
    );
  }
  const incomplete = dependsOnDocs.filter((d) => (d.status || 'Not Started') !== 'Completed');
  const isBlocked = incomplete.length > 0;
  const blockingWithProgress = await Promise.all(
    incomplete.map(async (d) => {
      const s = await computeStatsForModule(d);
      return {
        _id: d._id,
        name: d.name,
        status: d.status,
        progress: s.progress,
      };
    })
  );

  return {
    ...mod.toObject(),
    dependsOn: dependsOnDocs,
    isBlocked,
    blockingModules: blockingWithProgress,
    stats,
  };
}

// GET /api/modules?projectId=xxx — get modules for a project with burn stats
const getModulesByProject = async (req, res) => {
  try {
    const { projectId } = req.query;
    if (!projectId || !isValidId(projectId)) {
      return res.status(400).json({ message: 'Valid projectId query param required' });
    }

    if (!['admin', 'pmo', 'dh', 'exec'].includes(req.user.role)) {
      const access = await assertUserCanViewProject(req, projectId);
      if (!access.ok) {
        return res.status(access.status).json({ message: access.message });
      }
    }

    const modules = await Module.find({ projectId }).sort({ createdAt: 1 });

    const modulesWithStats = await Promise.all(modules.map((m) => buildModulePayload(m)));

    res.json(modulesWithStats);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/modules/:id/dependencies — replace dependency list (FR-M2-06)
const setModuleDependencies = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ message: 'Invalid module id' });

    const mod = await Module.findById(id);
    if (!mod) return res.status(404).json({ message: 'Module not found' });

    const raw = req.body.dependsOnModuleIds ?? req.body.moduleIds ?? [];
    if (!Array.isArray(raw)) {
      return res.status(400).json({ message: 'dependsOnModuleIds must be an array' });
    }

    const unique = [...new Set(raw.map(String))];
    if (unique.includes(id)) {
      return res.status(400).json({ message: 'A module cannot depend on itself' });
    }

    for (const depId of unique) {
      if (!isValidId(depId)) {
        return res.status(400).json({ message: `Invalid dependency id: ${depId}` });
      }
      const other = await Module.findById(depId);
      if (!other || other.projectId.toString() !== mod.projectId.toString()) {
        return res.status(400).json({
          message: 'All dependencies must be other modules in the same project',
        });
      }
    }

    const allProjectModules = await Module.find({ projectId: mod.projectId });
    const proposed = unique.map((u) => new mongoose.Types.ObjectId(u));

    if (hasDependencyCycle(allProjectModules, id, proposed)) {
      return res.status(400).json({ message: 'These dependencies would create a circular dependency' });
    }

    const beforeDeps = [...(mod.dependsOn || [])].map((x) => x.toString());
    mod.dependsOn = proposed;
    await mod.save();

    await recordAudit({
      entityType: 'Module',
      entityId: mod._id,
      action: 'dependencies_updated',
      before: { dependsOn: beforeDeps },
      after: { dependsOn: unique },
      actorId: req.user._id,
      actorName: req.user.name,
      projectId: mod.projectId,
    });

    const fresh = await Module.findById(id);
    const payload = await buildModulePayload(fresh);
    res.json(payload);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

function hasDependencyCycle(allModules, targetModuleId, newDepsForTarget) {
  const targetStr = targetModuleId.toString();
  const adj = new Map();

  for (const m of allModules) {
    const mid = m._id.toString();
    const deps = mid === targetStr ? newDepsForTarget.map(String) : (m.dependsOn || []).map(String);
    adj.set(mid, deps);
  }

  const visiting = new Set();
  const visited = new Set();

  function dfs(node) {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const next of adj.get(node) || []) {
      if (dfs(next)) return true;
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  }

  for (const m of allModules) {
    const mid = m._id.toString();
    if (!visited.has(mid) && dfs(mid)) return true;
  }
  return false;
}

// GET /api/modules/:id/dependency-status
const getModuleDependencyStatus = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ message: 'Invalid module id' });

    const mod = await Module.findById(id);
    if (!mod) return res.status(404).json({ message: 'Module not found' });

    const dependsOnDocs = await Module.find({ _id: { $in: mod.dependsOn || [] } }).select(
      'name status'
    );
    const incomplete = dependsOnDocs.filter((d) => (d.status || 'Not Started') !== 'Completed');
    const blockingModules = await Promise.all(
      incomplete.map(async (d) => {
        const s = await computeStatsForModule(d);
        return {
          _id: d._id,
          name: d.name,
          status: d.status,
          progress: s.progress,
        };
      })
    );

    res.json({
      moduleId: mod._id,
      isBlocked: blockingModules.length > 0,
      blockingModules,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/modules — create a module
const createModule = async (req, res) => {
  try {
    const module = await Module.create(req.body);
    res.status(201).json(module);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// PUT /api/modules/:id — update a module
const updateModule = async (req, res) => {
  try {
    const prev = await Module.findById(req.params.id);
    if (!prev) return res.status(404).json({ message: 'Module not found' });

    const module = await Module.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (req.body.status !== undefined && req.body.status !== prev.status) {
      await recordAudit({
        entityType: 'Module',
        entityId: module._id,
        action: 'status_changed',
        before: { status: prev.status },
        after: { status: module.status, name: module.name },
        actorId: req.user._id,
        actorName: req.user.name,
        projectId: module.projectId,
      });
    }

    res.json(module);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// DELETE /api/modules/:id — delete module and cascade
const deleteModule = async (req, res) => {
  try {
    const module = await Module.findByIdAndDelete(req.params.id);
    if (!module) return res.status(404).json({ message: 'Module not found' });

    await Module.updateMany({ dependsOn: req.params.id }, { $pull: { dependsOn: req.params.id } });

    const workstreams = await Workstream.find({ moduleId: req.params.id });
    const workstreamIds = workstreams.map((w) => w._id);
    await Task.deleteMany({ workstreamId: { $in: workstreamIds } });
    await Workstream.deleteMany({ moduleId: req.params.id });

    res.json({ message: 'Module deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  getModulesByProject,
  createModule,
  updateModule,
  deleteModule,
  setModuleDependencies,
  getModuleDependencyStatus,
};
