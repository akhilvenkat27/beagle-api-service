const mongoose = require('mongoose');
const Module = require('../models/Module');
const Workstream = require('../models/Workstream');
const Task = require('../models/Task');

const WORKSTREAM_PHASES = ['Inception', 'Elaboration', 'Configuration', 'Transition', 'Hypercare'];

/** Substrings / tokens that map a workstream name to a standard phase (case-insensitive). */
const PHASE_NAME_HINTS = {
  Inception: ['inception', 'incept', 'discovery', 'kickoff', 'assess', 'align'],
  Elaboration: ['elaboration', 'elab', 'blueprint', 'design', 'workshop', 'requirements', 'req '],
  Configuration: ['configuration', 'config', 'build', 'implement', 'dev', 'develop', 'setup', 'set up'],
  Transition: ['transition', 'trans', 'cutover', 'go-live', 'golive', 'migration', 'data migration', 'uat', 'deploy', 'rollout'],
  Hypercare: ['hypercare', 'hyper', 'stabilization', 'stabilisation', 'warranty', 'handover', 'support', 'training', 'hyper care'],
};

function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

/**
 * Score how well a workstream name matches a phase (0–100). Used for greedy per-phase assignment.
 */
function matchScore(workstreamName, phase) {
  const n = String(workstreamName || '')
    .toLowerCase()
    .trim();
  const p = phase.toLowerCase();
  if (!n) return 0;
  if (n === p) return 100;
  if (n.includes(p)) return 90;

  // Disambiguate common short names that map to a specific phase
  if (phase === 'Transition') {
    if (n === 'uat' || n.startsWith('uat ')) return 95;
    if (n.includes('data migration')) return 82;
  }
  if (phase === 'Elaboration' && (n === 'integration' || n.includes('integration'))) return 80;

  for (const hint of PHASE_NAME_HINTS[phase] || []) {
    if (n.includes(hint)) return 75;
  }
  return 0;
}

/**
 * Map each standard phase to at most one workstream:
 * 1) Greedy: each phase takes its best name match (if score ≥ 35).
 * 2) Workstreams with strong fit to a still-empty phase (score ≥ 30) are assigned by best pair.
 * 3) Remaining: zip by creation order (oldest unassigned → earliest empty column).
 */
function assignWorkstreamsToPhases(workstreams) {
  const empty = () => Object.fromEntries(WORKSTREAM_PHASES.map((ph) => [ph, null]));
  if (!workstreams?.length) return empty();

  const sorted = [...workstreams].sort(
    (a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0)
  );
  const used = new Set();
  const phaseToWs = empty();

  for (const phase of WORKSTREAM_PHASES) {
    let best = null;
    let bestScore = 0;
    for (const w of sorted) {
      if (used.has(String(w._id))) continue;
      const sc = matchScore(w.name, phase);
      if (sc > bestScore) {
        bestScore = sc;
        best = w;
      }
    }
    if (best && bestScore >= 35) {
      phaseToWs[phase] = best;
      used.add(String(best._id));
    }
  }

  let pool = sorted.filter((w) => !used.has(String(w._id)));
  while (pool.length) {
    let bestW = null;
    let bestPh = null;
    let bestSc = -1;
    for (const w of pool) {
      for (const phase of WORKSTREAM_PHASES) {
        if (phaseToWs[phase]) continue;
        const sc = matchScore(w.name, phase);
        if (sc > bestSc) {
          bestSc = sc;
          bestW = w;
          bestPh = phase;
        }
      }
    }
    if (bestW && bestPh && bestSc >= 30) {
      phaseToWs[bestPh] = bestW;
      used.add(String(bestW._id));
      pool = pool.filter((w) => String(w._id) !== String(bestW._id));
      continue;
    }
    break;
  }

  pool = sorted.filter((w) => !used.has(String(w._id)));
  const unmappedPh = WORKSTREAM_PHASES.filter((p) => !phaseToWs[p]);
  for (let j = 0; j < Math.min(unmappedPh.length, pool.length); j += 1) {
    const w = pool[j];
    phaseToWs[unmappedPh[j]] = w;
    used.add(String(w._id));
  }

  return phaseToWs;
}

function countOverdue(tasks) {
  const now = new Date();
  return (tasks || []).filter((t) => t.status !== 'Done' && t.dueDate && new Date(t.dueDate) < now)
    .length;
}

/**
 * @param {object} workstream - lean workstream doc
 * @param {object[]} tasks - tasks in this workstream
 * @returns {'Not Started'|'In Progress'|'Complete'|'Blocked'|'At Risk'}
 */
function computeWorkstreamStatus(workstream, tasks) {
  const t = tasks || [];
  if (t.length === 0) return 'Not Started';

  const allDone = t.every((x) => x.status === 'Done');
  if (allDone) return 'Complete';

  const overdue = countOverdue(t);
  if (overdue >= 2) return 'At Risk';
  if (workstream.isBlocked) return 'Blocked';

  const allNotStarted = t.every((x) => x.status === 'Not Started');
  if (allNotStarted) return 'Not Started';

  const hasInProgress = t.some((x) => x.status === 'In Progress');
  const hasSomeDone = t.some((x) => x.status === 'Done');
  if (hasInProgress || hasSomeDone) return 'In Progress';

  return 'Not Started';
}

/**
 * @param {Array<{ status: string, overdueCount: number }>} phaseDetails
 */
function computeModuleStatus(phaseDetails) {
  const statuses = phaseDetails.map((p) => p.status);

  if (statuses.length && statuses.every((s) => s === 'Complete')) return 'Complete';
  if (statuses.some((s) => s === 'At Risk')) return 'At Risk';
  for (const p of phaseDetails) {
    if (p.status === 'Blocked' && p.overdueCount >= 1) return 'At Risk';
  }
  if (statuses.some((s) => s === 'Blocked')) return 'Blocked';
  if (statuses.length && statuses.every((s) => s === 'Not Started')) return 'Not Started';
  return 'In Progress';
}

/**
 * @param {string|mongoose.Types.ObjectId} projectId
 */
async function buildProjectMatrix(projectId) {
  const modules = await Module.find({ projectId }).sort({ createdAt: 1 }).lean();
  if (!modules.length) {
    return {
      projectId: String(projectId),
      phases: WORKSTREAM_PHASES,
      rows: [],
      generatedAt: new Date().toISOString(),
    };
  }

  const moduleIds = modules.map((m) => m._id);
  const allWs = await Workstream.find({ moduleId: { $in: moduleIds } }).lean();
  const wsByModule = new Map();
  for (const w of allWs) {
    const mid = String(w.moduleId);
    if (!wsByModule.has(mid)) wsByModule.set(mid, []);
    wsByModule.get(mid).push(w);
  }

  const allWsIds = allWs.map((w) => w._id);
  const allTasks = allWsIds.length
    ? await Task.find({ workstreamId: { $in: allWsIds } }).lean()
    : [];

  const tasksByWs = new Map();
  for (const t of allTasks) {
    const wid = String(t.workstreamId);
    if (!tasksByWs.has(wid)) tasksByWs.set(wid, []);
    tasksByWs.get(wid).push(t);
  }

  const rows = modules.map((mod) => {
    const wss = wsByModule.get(String(mod._id)) || [];
    const phaseToWs = assignWorkstreamsToPhases(wss);
    const workstreamStatuses = {};
    const phaseDetails = [];

    for (const phase of WORKSTREAM_PHASES) {
      const ws = phaseToWs[phase];
      if (!ws) {
        workstreamStatuses[phase] = 'Not Started';
        phaseDetails.push({ phase, status: 'Not Started', overdueCount: 0 });
      } else {
        const tasks = tasksByWs.get(String(ws._id)) || [];
        const status = computeWorkstreamStatus(ws, tasks);
        const overdueCount = countOverdue(tasks);
        workstreamStatuses[phase] = status;
        phaseDetails.push({ phase, status, overdueCount });
      }
    }

    const moduleStatus = computeModuleStatus(phaseDetails);
    const allModTasks = wss.flatMap((w) => tasksByWs.get(String(w._id)) || []);
    const progress =
      allModTasks.length > 0
        ? Math.round(
            (allModTasks.filter((t) => t.status === 'Done').length / allModTasks.length) * 100
          )
        : 0;

    return {
      moduleId: String(mod._id),
      moduleName: mod.name,
      workstreamStatuses,
      moduleStatus,
      progress,
    };
  });

  return {
    projectId: String(projectId),
    phases: WORKSTREAM_PHASES,
    rows,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  buildProjectMatrix,
  WORKSTREAM_PHASES,
  computeWorkstreamStatus,
  computeModuleStatus,
  isValidId,
  assignWorkstreamsToPhases,
  matchScore,
};
