const Groq = require('groq-sdk');
const mongoose = require('mongoose');
const Project = require('../models/Project');
const Module = require('../models/Module');
const Workstream = require('../models/Workstream');
const Task = require('../models/Task');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const Comment = require('../models/Comment');
const SentimentHistory = require('../models/SentimentHistory');
const RAIDItem = require('../models/RAIDItem');
const { calculateProjectFinancials } = require('./financialService');
const offline = require('./aiOffline');

let groq = null;

const PLACEHOLDER_KEYS = new Set(['', 'your_groq_key', 'your-key-here', 'changeme', 'sk-demo', 'demo']);

function hasGroqKey() {
  const k = (process.env.GROQ_API_KEY || '').trim();
  if (!k) return false;
  return !PLACEHOLDER_KEYS.has(k.toLowerCase());
}

const getGroqClient = () => {
  if (!groq) {
    if (!hasGroqKey()) {
      throw new Error('GROQ_API_KEY environment variable is not set');
    }
    groq = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });
  }
  return groq;
};

const MODEL_CANDIDATES = [
  process.env.GROQ_MODEL,
  'llama-3.1-8b-instant',
  'llama-3.3-70b-versatile',
  'llama3-70b-8192',
].filter((m, idx, arr) => m && arr.indexOf(m) === idx);

const MODEL = MODEL_CANDIDATES[0];

const SYSTEM_PROMPT = `You are a Delivery Intelligence Assistant for UDIP, a delivery management platform. 
You analyze project data and provide actionable insights for project managers. 
Always be concise, data-driven, and professional.`;

/**
 * Strip markdown fences and parse JSON; consistent error path for all AI JSON features.
 */
function safeParseJSON(content, context = 'AI') {
  if (content == null || typeof content !== 'string') {
    throw new Error('Empty AI response');
  }
  const jsonMatch = content.match(/```(?:json)?\s?([\s\S]*?)\s?```/) || [null, content];
  const jsonStr = (jsonMatch[1] || content).trim();
  try {
    return JSON.parse(jsonStr);
  } catch (err) {
    console.error(`[AI] JSON parse failed (${context}):`, err.message, jsonStr.slice(0, 280));
    throw new Error('AI unavailable');
  }
}

function isModelUnavailableError(err) {
  const msg = String(err?.message || '').toLowerCase();
  return (
    msg.includes('model') &&
    (msg.includes('decommission') ||
      msg.includes('not found') ||
      msg.includes('does not exist') ||
      msg.includes('invalid'))
  );
}

async function runGroq(userMessage, maxTokens = 700) {
  const client = getGroqClient();
  let lastErr = null;

  for (const model of MODEL_CANDIDATES) {
    try {
      const response = await client.chat.completions.create({
        model,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
      });
      return response.choices[0].message.content;
    } catch (err) {
      lastErr = err;
      if (isModelUnavailableError(err)) {
        console.warn(`[AI] Groq model unavailable: ${model}. Trying next fallback.`);
        continue;
      }
      throw err;
    }
  }

  throw lastErr || new Error('AI unavailable');
}

/**
 * Collects comprehensive project data for AI analysis
 */
async function collectProjectData(projectId) {
  const project = await Project.findById(projectId);
  if (!project) throw new Error('Project not found');

  const modules = await Module.find({ projectId });
  const moduleIds = modules.map((m) => m._id);

  const workstreams = await Workstream.find({ moduleId: { $in: moduleIds } });
  const workstreamIds = workstreams.map((w) => w._id);

  const tasks = await Task.find({ workstreamId: { $in: workstreamIds } });

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.status === 'Done').length;
  const inProgressTasks = tasks.filter((t) => t.status === 'In Progress').length;
  const notStartedTasks = tasks.filter((t) => t.status === 'Not Started').length;
  const overdueTasks = tasks.filter(
    (t) => t.status !== 'Done' && t.dueDate < new Date()
  ).length;
  const totalLoggedHours = tasks.reduce((sum, t) => sum + t.loggedHours, 0);
  const totalBudgetHours = modules.reduce((sum, m) => sum + m.budgetHours, 0);

  const overallProgress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const moduleDetails = modules.map((mod) => {
    const modTasks = tasks.filter((t) =>
      workstreams.some((w) => w._id.equals(t.workstreamId) && w.moduleId.equals(mod._id))
    );
    const modCompleted = modTasks.filter((t) => t.status === 'Done').length;
    const modOverdue = modTasks.filter(
      (t) => t.status !== 'Done' && t.dueDate < new Date()
    ).length;
    const modLoggedHours = modTasks.reduce((sum, t) => sum + t.loggedHours, 0);
    const burnPercent =
      mod.budgetHours > 0 ? Math.round((modLoggedHours / mod.budgetHours) * 100) : 0;
    const modProgress =
      modTasks.length > 0 ? Math.round((modCompleted / modTasks.length) * 100) : 0;

    return {
      name: mod.name,
      budgetHours: mod.budgetHours,
      loggedHours: modLoggedHours,
      burnPercent,
      totalTasks: modTasks.length,
      completedTasks: modCompleted,
      overdueTasks: modOverdue,
      progress: modProgress,
      tasks: modTasks.map((t) => ({
        id: t._id.toString(),
        title: t.title,
        status: t.status,
        owner: t.owner,
        dueDate: t.dueDate.toISOString(),
        loggedHours: t.loggedHours,
        isOverdue: t.status !== 'Done' && t.dueDate < new Date(),
      })),
    };
  });

  const latestDueDate = tasks.reduce((max, t) => (t.dueDate > max ? t.dueDate : max), new Date());
  const daysToGoLive = Math.max(
    0,
    Math.ceil((latestDueDate - new Date()) / (1000 * 60 * 60 * 24))
  );

  return {
    projectId: projectId.toString(),
    projectName: project.name,
    clientName: project.clientName,
    status: project.status,
    totalTasks,
    completedTasks,
    inProgressTasks,
    notStartedTasks,
    overdueTasks,
    totalLoggedHours,
    totalBudgetHours,
    overallProgress,
    daysToGoLive,
    modules: moduleDetails,
  };
}

async function collectPmDisciplineData(projectId) {
  const modules = await Module.find({ projectId });
  const moduleIds = modules.map((m) => m._id);
  const workstreams = await Workstream.find({ moduleId: { $in: moduleIds } });
  const workstreamIds = workstreams.map((w) => w._id);
  const tasks = await Task.find({ workstreamId: { $in: workstreamIds } });

  const tasksNoOwner = tasks.filter((t) => !t.owner || !String(t.owner).trim()).length;
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
  const overdueOver7Days = tasks.filter(
    (t) => t.status !== 'Done' && t.dueDate < sevenDaysAgo
  ).length;

  const wsByModule = new Map();
  workstreams.forEach((w) => {
    const k = w.moduleId.toString();
    wsByModule.set(k, (wsByModule.get(k) || 0) + 1);
  });
  const modulesWithZeroWorkstreams = modules.filter((m) => (wsByModule.get(m._id.toString()) || 0) === 0).length;

  const inProgressZeroHours = tasks.filter(
    (t) => t.status === 'In Progress' && (!t.loggedHours || t.loggedHours === 0)
  ).length;

  const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000);
  const staleTasks = tasks.filter(
    (t) => t.status !== 'Done' && t.updatedAt && t.updatedAt < fourteenDaysAgo
  ).length;

  const statusAuditCount = await AuditLog.countDocuments({
    projectId,
    entityType: 'Task',
    action: 'status_changed',
  });

  const totalWs = workstreams.length;
  const signedWs = workstreams.filter((w) => w.signOffStatus === 'Signed Off').length;
  const signOffRate = totalWs > 0 ? Math.round((signedWs / totalWs) * 1000) / 10 : 0;

  return {
    tasksNoOwner,
    overdueOver7Days,
    modulesWithZeroWorkstreams,
    inProgressZeroHours,
    staleTasksNotUpdated14d: staleTasks,
    taskStatusAuditEvents: statusAuditCount,
    totalTasks: tasks.length,
    workstreamsSignedOff: signedWs,
    workstreamsTotal: totalWs,
    signOffRatePercent: signOffRate,
  };
}

async function getProjectRisk(projectId) {
  const projectData = await collectProjectData(projectId);
  const fallback = () => offline.riskFromProjectData(projectData);
  if (!hasGroqKey()) return fallback();
  try {
    const userMessage = `Analyze this project data and return ONLY valid JSON (no markdown, no explanation):

PROJECT DATA:
${JSON.stringify(projectData, null, 2)}

Return a JSON object with exactly this structure:
{
  "riskScore": <number 0-100>,
  "riskLevel": "<Low|Medium|High|Critical>",
  "topRisks": [<string>, <string>, <string>],
  "recommendation": "<string>"
}

Consider: burn rate vs progress, overdue tasks, task distribution, days to go-live, module criticality.`;

    const content = await runGroq(userMessage, 500);
    return safeParseJSON(content, 'project-risk');
  } catch (err) {
    console.error('AI Risk Analysis Error:', err.message);
    return fallback();
  }
}

async function getWeeklySummary(projectId) {
  const projectData = await collectProjectData(projectId);
  const fallback = () => offline.weeklySummaryFromData(projectData);
  if (!hasGroqKey()) return fallback();
  try {
    const userMessage = `Generate a professional PM-style weekly status update for this project.
Write exactly 3-4 sentences. Be concise and data-driven. Include progress percentage, any blockers, and next steps.

PROJECT DATA:
${JSON.stringify(projectData, null, 2)}

Return ONLY valid JSON with this structure (no markdown, no explanation):
{
  "summary": "<3-4 sentence summary>"
}`;

    const content = await runGroq(userMessage, 800);
    const result = safeParseJSON(content, 'weekly-summary');
    return {
      summary: result.summary,
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error('AI Weekly Summary Error:', err.message);
    return fallback();
  }
}

async function getTaskFlags(moduleId) {
  const module = await Module.findById(moduleId);
  if (!module) throw new Error('Module not found');

  const workstreams = await Workstream.find({ moduleId });
  const workstreamIds = workstreams.map((w) => w._id);
  const tasks = await Task.find({ workstreamId: { $in: workstreamIds } });

  const taskDetails = tasks.map((t) => ({
    id: t._id.toString(),
    title: t.title,
    status: t.status,
    owner: t.owner,
    dueDate: t.dueDate.toISOString(),
    loggedHours: t.loggedHours,
    isOverdue: t.status !== 'Done' && t.dueDate < new Date(),
    daysSinceDue: Math.max(0, Math.ceil((new Date() - t.dueDate) / (1000 * 60 * 60 * 24))),
    daysUntilDue: Math.ceil((t.dueDate - new Date()) / (1000 * 60 * 60 * 24)),
  }));

  const fallback = () => offline.taskFlagsOffline(module.name, tasks);
  if (!hasGroqKey()) return fallback();
  try {
    const userMessage = `Analyze these tasks and flag any that are at health risk. Return ONLY valid JSON (no markdown, no explanation):

MODULE: ${module.name}
TASKS:
${JSON.stringify(taskDetails, null, 2)}

Return JSON with this structure:
{
  "flags": [
    {
      "taskId": "<string>",
      "title": "<string>",
      "flag": "<overdue|at_risk|stalled|approaching_deadline>",
      "suggestion": "<actionable suggestion>"
    }
  ]
}`;

    const content = await runGroq(userMessage, 500);
    return safeParseJSON(content, 'task-flags');
  } catch (err) {
    console.error('AI Task Flags Error:', err.message);
    return fallback();
  }
}

async function askProjectQuestion(projectId, question) {
  const projectData = await collectProjectData(projectId);
  const offlineAns = () => ({
    question,
    answer: offline.chatAnswerOffline(projectData, question),
    askedAt: new Date().toISOString(),
  });
  if (!hasGroqKey()) return offlineAns();
  try {
    const userMessage = `Answer this question about the project based on the data provided. 
Be conversational, concise, and cite specific data points.
Maximum 3 sentences.

QUESTION: ${question}

PROJECT DATA:
${JSON.stringify(projectData, null, 2)}`;

    const response = await getGroqClient().chat.completions.create({
      model: MODEL,
      max_tokens: 1000,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
    });

    const answer = response.choices[0].message.content;
    return {
      question,
      answer: (answer || '').trim(),
      askedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error('AI Chat Error:', err.message);
    return offlineAns();
  }
}

/** GET /api/ai/pm-score/:projectId */
async function getPmScore(projectId) {
  const metrics = await collectPmDisciplineData(projectId);
  const base = offline.pmScoreFromMetrics(metrics);
  const fallback = () => {
    const improvements = [];
    if (metrics.overdueOver7Days > 0)
      improvements.push(`${metrics.overdueOver7Days} tasks overdue more than 7 days — reset dates.`);
    if (metrics.tasksNoOwner > 0) improvements.push(`${metrics.tasksNoOwner} tasks missing owner text.`);
    if (metrics.inProgressZeroHours > 0)
      improvements.push(`${metrics.inProgressZeroHours} in-progress tasks with zero logged hours.`);
    if (metrics.signOffRatePercent < 60)
      improvements.push(`Workstream sign-off rate ${metrics.signOffRatePercent}% — drive formal sign-offs.`);
    if (!improvements.length) improvements.push('Keep audit trail discipline on status changes.');
    return { ...base, improvements };
  };
  if (!hasGroqKey()) return fallback();
  try {
    const userMessage = `You are scoring PM delivery discipline (0-100) and letter grade A-F.

METRICS (JSON):
${JSON.stringify(metrics, null, 2)}

Return ONLY valid JSON:
{
  "disciplineScore": <number 0-100>,
  "grade": "<A|B|C|D|F>",
  "positives": [<string>, ...],
  "improvements": [<string>, ...],
  "summary": "<one paragraph>"
}

Use metrics literally. Penalize overdue tasks, missing owners, empty modules, in-progress with 0 hours, stale tasks, low sign-off rate.`;

    const content = await runGroq(userMessage, 600);
    return safeParseJSON(content, 'pm-score');
  } catch (err) {
    console.error('AI PM Score Error:', err.message);
    return fallback();
  }
}

/** GET /api/ai/margin-forecast/:projectId */
async function getMarginForecast(projectId) {
  const fin = await calculateProjectFinancials(projectId, { skipAlerts: true });
  const ctx = {
    currentMarginPercent: fin.marginPercent,
    marginAmount: fin.marginAmount,
    totalCost: fin.totalCost,
    implementationFee: fin.implementationFee,
    burnRateLabel: fin.burnRate,
    weeksToThreshold: fin.weeksToThreshold,
    eac: fin.eac,
    eacVariance: fin.eacVariance,
  };
  const fallback = () => offline.marginForecastOffline(fin);
  if (!hasGroqKey()) return fallback();
  try {
    const userMessage = `Financial snapshot for margin forecast (JSON):
${JSON.stringify(ctx, null, 2)}

Return ONLY valid JSON:
{
  "currentMargin": <number same as currentMarginPercent>,
  "projectedMargin": <number 0-100, estimate if burn continues>,
  "weeksUntilThreshold": <number or null>,
  "severity": "<Low|Medium|High|Critical>",
  "recommendation": "<string>"
}

projectedMargin must be <= currentMargin if burn is eroding margin. Align weeksUntilThreshold with input weeksToThreshold when sensible.`;

    const content = await runGroq(userMessage, 500);
    const parsed = safeParseJSON(content, 'margin-forecast');
    parsed.currentMargin = Number(parsed.currentMargin ?? ctx.currentMarginPercent);
    return parsed;
  } catch (err) {
    console.error('AI Margin Forecast Error:', err.message);
    return fallback();
  }
}

/** GET /api/ai/resource-overload/:projectId */
async function getResourceOverload(projectId) {
  const modules = await Module.find({ projectId });
  const moduleIds = modules.map((m) => m._id);
  const modNameById = new Map(modules.map((m) => [m._id.toString(), m.name]));
  const workstreams = await Workstream.find({ moduleId: { $in: moduleIds } });
  const modByWs = new Map();
  for (const w of workstreams) {
    modByWs.set(w._id.toString(), modNameById.get(w.moduleId.toString()) || 'Module');
  }
  const wsIds = workstreams.map((w) => w._id);
  const tasks = await Task.find({ workstreamId: { $in: wsIds }, assignedTo: { $ne: null } }).populate(
    'assignedTo',
    'name email'
  );

  const byUser = new Map();
  for (const t of tasks) {
    const uid = t.assignedTo?._id?.toString();
    if (!uid) continue;
    if (!byUser.has(uid)) {
      byUser.set(uid, {
        userId: uid,
        name: t.assignedTo?.name || 'Unknown',
        tasks: [],
        moduleNames: new Set(),
      });
    }
    const row = byUser.get(uid);
    row.tasks.push(t);
    const modName = modByWs.get(t.workstreamId.toString());
    if (modName) row.moduleNames.add(modName);
  }

  const globalAvg =
    tasks.length > 0
      ? tasks.reduce((s, t) => s + (Number(t.loggedHours) || 0), 0) / tasks.length
      : 6;
  const defaultBlock = Math.max(4, Math.round(globalAvg * 10) / 10);

  const overloadedResources = [];
  for (const row of byUser.values()) {
    const n = row.tasks.length;
    const estimatedHours = Math.round(n * defaultBlock * 10) / 10;
    const availableHours = 40;
    const overloadPercent =
      availableHours > 0 ? Math.round((estimatedHours / availableHours) * 1000) / 10 : 0;
    if (overloadPercent >= 85 || n >= 10) {
      overloadedResources.push({
        name: row.name,
        assignedTasks: n,
        estimatedHours,
        availableHours,
        overloadPercent,
        affectedModules: [...row.moduleNames],
      });
    }
  }

  const pack = () => offline.resourceOverloadOffline(overloadedResources);
  if (!hasGroqKey()) return pack();
  try {
    const userMessage = `Team load snapshot (JSON). Summarize overload risk in one recommendation sentence only.

DATA:
${JSON.stringify({ overloadedResources }, null, 2)}

Return ONLY valid JSON:
{
  "overloadedResources": <copy the array from input exactly>,
  "recommendation": "<string>"
}`;

    const content = await runGroq(userMessage, 500);
    const parsed = safeParseJSON(content, 'resource-overload');
    const fromAi = parsed.overloadedResources;
    return {
      overloadedResources:
        Array.isArray(fromAi) && fromAi.length > 0 ? fromAi : overloadedResources,
      recommendation: parsed.recommendation || pack().recommendation,
    };
  } catch (err) {
    console.error('AI Resource Overload Error:', err.message);
    return pack();
  }
}

/** POST /api/ai/client-sentiment/:projectId */
async function postClientSentiment(projectId, emailContent, actorId) {
  if (!emailContent || typeof emailContent !== 'string' || !emailContent.trim()) {
    throw new Error('emailContent is required');
  }
  const project = await Project.findById(projectId).select('name clientName');
  if (!project) throw new Error('Project not found');

  const persist = async (parsed) => {
    await SentimentHistory.create({
      projectId,
      sentiment: parsed.sentiment || 'Neutral',
      sentimentScore: Number(parsed.sentimentScore) || 50,
      keySignals: Array.isArray(parsed.keySignals) ? parsed.keySignals : [],
      silenceRisk: !!parsed.silenceRisk,
      recommendation: parsed.recommendation || '',
      createdBy: actorId || null,
      createdAt: new Date(),
    });
    return parsed;
  };

  if (!hasGroqKey()) {
    const parsed = offline.sentimentOffline(emailContent);
    return persist(parsed);
  }
  try {
    const userMessage = `Analyze this client email for delivery PMs. Return ONLY valid JSON (no markdown).

PROJECT: ${project.name} (${project.clientName})
EMAIL:
${emailContent.slice(0, 12000)}

Return JSON:
{
  "sentiment": "<Positive|Neutral|Negative|Mixed>",
  "sentimentScore": <number 0-100, higher = more positive>,
  "keySignals": [<string>, ...],
  "silenceRisk": <boolean>,
  "recommendation": "<string>"
}`;

    const content = await runGroq(userMessage, 550);
    const parsed = safeParseJSON(content, 'client-sentiment');
    return persist(parsed);
  } catch (err) {
    console.error('AI Client Sentiment Error:', err.message);
    const parsed = offline.sentimentOffline(emailContent);
    return persist(parsed);
  }
}

async function collectEscalationContext(projectId) {
  const projectData = await collectProjectData(projectId);
  const lastSent = await SentimentHistory.findOne({ projectId }).sort({ createdAt: -1 }).lean();

  const modules = await Module.find({ projectId });
  const moduleIds = modules.map((m) => m._id);
  const workstreams = await Workstream.find({ moduleId: { $in: moduleIds } });
  const wsIds = workstreams.map((w) => w._id);
  const tasks = await Task.find({ workstreamId: { $in: wsIds } });
  const taskIds = tasks.map((t) => t._id);

  let lastClientCommentAt = null;
  if (taskIds.length) {
    const clientUsers = await User.find({ role: 'client' }).select('_id').lean();
    const clientIds = clientUsers.map((u) => u._id);
    if (clientIds.length) {
      const lastC = await Comment.findOne({ taskId: { $in: taskIds }, userId: { $in: clientIds } })
        .sort({ createdAt: -1 })
        .lean();
      lastClientCommentAt = lastC?.createdAt || null;
    }
  }
  const daysClientSilence = lastClientCommentAt
    ? Math.floor((Date.now() - new Date(lastClientCommentAt).getTime()) / 86400000)
    : 999;

  let delayScore = 0;
  if (tasks.length) {
    const overdueW = tasks.reduce((s, t) => {
      if (t.status === 'Done') return s;
      const days = Math.ceil((new Date() - t.dueDate) / 86400000);
      return s + (days > 0 ? Math.min(days, 30) : 0);
    }, 0);
    delayScore = Math.min(100, Math.round((overdueW / tasks.length) * 10));
  }

  return {
    projectData,
    lastSentiment: lastSent
      ? {
          sentiment: lastSent.sentiment,
          sentimentScore: lastSent.sentimentScore,
          at: lastSent.createdAt,
        }
      : null,
    daysClientSilence: daysClientSilence === 999 ? null : daysClientSilence,
    taskDelayCompositeScore: delayScore,
  };
}

/** GET /api/ai/escalation-risk/:projectId */
async function getEscalationRisk(projectId) {
  const ctx = await collectEscalationContext(projectId);
  const fallback = () => offline.escalationOffline(ctx);
  if (!hasGroqKey()) return fallback();
  try {
    const userMessage = `Assess escalation risk for this project. Return ONLY valid JSON.

CONTEXT:
${JSON.stringify(ctx, null, 2)}

Return JSON:
{
  "escalationProbability": <number 0-100>,
  "riskLevel": "<Low|Medium|High|Critical>",
  "triggerSignals": [<string>, ...],
  "suggestedActions": [<string>, ...],
  "daysUntilEscalation": <number estimate, 1-30>
}

Incorporate lastSentiment (if any), daysClientSilence (null means no client comments tracked), and taskDelayCompositeScore.`;

    const content = await runGroq(userMessage, 650);
    return safeParseJSON(content, 'escalation-risk');
  } catch (err) {
    console.error('AI Escalation Risk Error:', err.message);
    return fallback();
  }
}

/** POST /api/ai/scope-check/:projectId */
async function postScopeCheck(projectId, emailContent) {
  if (!emailContent || typeof emailContent !== 'string' || !emailContent.trim()) {
    throw new Error('emailContent is required');
  }
  const modules = await Module.find({ projectId }).select('name').lean();
  const moduleIds = modules.map((m) => m._id);
  const workstreams = await Workstream.find({ moduleId: { $in: moduleIds } }).select('name moduleId').lean();
  const scopeSummary = {
    modules: modules.map((m) => m.name),
    workstreams: workstreams.map((w) => w.name),
  };

  const fallback = () => offline.scopeCheckOffline(emailContent, scopeSummary);
  if (!hasGroqKey()) return fallback();
  try {
    const userMessage = `Compare this CLIENT EMAIL to the in-scope work listed. Detect scope creep.

IN-SCOPE (names only):
${JSON.stringify(scopeSummary, null, 2)}

EMAIL:
${emailContent.slice(0, 12000)}

Return ONLY valid JSON:
{
  "scopeCreepDetected": <boolean>,
  "confidence": <number 0-100>,
  "creepDescription": "<string>",
  "affectedModules": [<string>, ...],
  "draftCR": {
    "title": "<string>",
    "description": "<string>",
    "estimatedImpactHours": <number>,
    "estimatedImpactDays": <number>
  }
}

If no creep, scopeCreepDetected false and draftCR can use empty strings and 0.`;

    const content = await runGroq(userMessage, 800);
    return safeParseJSON(content, 'scope-check');
  } catch (err) {
    console.error('AI Scope Check Error:', err.message);
    return fallback();
  }
}

/** GET /api/ai/narrative/:projectId?audience=pm|dh|client|exec */
async function getNarrative(projectId, audience) {
  const allowed = ['pm', 'dh', 'client', 'exec'];
  const aud = (audience || 'pm').toLowerCase();
  if (!allowed.includes(aud)) throw new Error('Invalid audience');

  const projectData = await collectProjectData(projectId);
  const fin = await calculateProjectFinancials(projectId, { skipAlerts: true }).catch(() => null);

  const finalize = async (parsed) => {
    parsed.generatedAt = new Date().toISOString();
    parsed.approvalRequired = aud === 'client';
    if (aud === 'client') {
      await Project.findByIdAndUpdate(projectId, {
        clientNarrativeDraft: parsed.narrative || '',
        clientNarrativeDraftAt: new Date(),
        clientNarrativeApprovedAt: null,
      });
    }
    return parsed;
  };

  const fallback = () => offline.narrativeOffline(projectData, fin, aud);
  if (!hasGroqKey()) return finalize(fallback());
  try {
    const userMessage = `Write a status narrative for audience "${aud}".

PROJECT DATA:
${JSON.stringify(projectData, null, 2)}

FINANCIAL (may be null):
${fin ? JSON.stringify({ marginPercent: fin.marginPercent, burnRate: fin.burnRate, eacVariance: fin.eacVariance }) : 'null'}

Rules:
- pm: task-level detail, risks, blockers, owner names from data.
- dh: module health, financial burn, cross-module view.
- client: milestones, go-live readiness, positive professional tone (no internal blame).
- exec: exactly 2 sentences — health, financial, go-live confidence.

Return ONLY valid JSON:
{
  "audience": "${aud}",
  "narrative": "<string>",
  "generatedAt": "<ISO-8601 string>",
  "approvalRequired": <boolean — true only for audience client>
}`;

    const content = await runGroq(userMessage, aud === 'exec' ? 400 : 900);
    const parsed = safeParseJSON(content, 'narrative');
    return finalize(parsed);
  } catch (err) {
    console.error('AI Narrative Error:', err.message);
    return finalize(fallback());
  }
}

/** Approve client narrative (PM) */
async function approveClientNarrative(projectId) {
  const p = await Project.findByIdAndUpdate(
    projectId,
    { clientNarrativeApprovedAt: new Date() },
    { new: true }
  ).select('clientNarrativeDraft clientNarrativeApprovedAt');
  if (!p) throw new Error('Project not found');
  return p;
}

/** GET client-safe narrative (approved only) */
async function getClientApprovedNarrative(projectId) {
  const p = await Project.findById(projectId).select(
    'clientNarrativeDraft clientNarrativeApprovedAt clientNarrativeDraftAt name'
  );
  if (!p) throw new Error('Project not found');
  if (!p.clientNarrativeApprovedAt) {
    return {
      audience: 'client',
      narrative: null,
      generatedAt: p.clientNarrativeDraftAt,
      approvalRequired: true,
      pendingPMApproval: true,
    };
  }
  return {
    audience: 'client',
    narrative: p.clientNarrativeDraft || '',
    generatedAt: p.clientNarrativeDraftAt,
    approvalRequired: true,
    pendingPMApproval: false,
  };
}

/** POST /api/ai/raid-extract/:projectId */
async function postRaidExtract(projectId, notes, actorId) {
  if (!notes || typeof notes !== 'string' || !notes.trim()) {
    throw new Error('notes are required');
  }
  const project = await Project.findById(projectId).select('name');
  if (!project) throw new Error('Project not found');

  const persistRaidItems = async (items) => {
    const created = [];
    for (const it of items.slice(0, 40)) {
      const type = ['Risk', 'Assumption', 'Issue', 'Dependency'].includes(it.type) ? it.type : 'Issue';
      const priority = ['High', 'Medium', 'Low'].includes(it.priority) ? it.priority : 'Medium';
      const doc = await RAIDItem.create({
        projectId,
        type,
        description: String(it.description || '').slice(0, 2000),
        suggestedOwnerName: it.suggestedOwner ? String(it.suggestedOwner).slice(0, 120) : '',
        priority,
        source: 'AI',
        confirmedByPM: false,
        status: 'Open',
      });
      created.push(doc);
    }
    return {
      raidItems: items,
      insertedIds: created.map((d) => d._id),
      saved: created.map((d) => d.toObject()),
    };
  };

  let items = [];
  if (!hasGroqKey()) {
    const parsed = offline.raidFromNotesOffline(notes);
    items = Array.isArray(parsed.raidItems) ? parsed.raidItems : [];
    return persistRaidItems(items);
  }
  try {
    const userMessage = `Extract RAID items from meeting notes. Return ONLY valid JSON.

PROJECT: ${project.name}
NOTES:
${notes.slice(0, 12000)}

Return JSON:
{
  "raidItems": [
    {
      "type": "Risk|Assumption|Issue|Dependency",
      "description": "<string>",
      "owner": null,
      "suggestedOwner": "<full name or null>",
      "priority": "High|Medium|Low"
    }
  ]
}`;

    const content = await runGroq(userMessage, 900);
    const parsed = safeParseJSON(content, 'raid-extract');
    items = Array.isArray(parsed.raidItems) ? parsed.raidItems : [];
    return persistRaidItems(items);
  } catch (err) {
    console.error('AI RAID Extract Error:', err.message);
    const parsed = offline.raidFromNotesOffline(notes);
    items = Array.isArray(parsed.raidItems) ? parsed.raidItems : [];
    return persistRaidItems(items);
  }
}

async function listRaidItems(projectId) {
  return RAIDItem.find({ projectId }).sort({ createdAt: -1 }).lean();
}

async function createManualRaidItem(projectId, body) {
  const { type, description, priority, owner } = body;
  if (!description || !String(description).trim()) throw new Error('description is required');
  const t = ['Risk', 'Assumption', 'Issue', 'Dependency'].includes(type) ? type : 'Issue';
  const p = ['High', 'Medium', 'Low'].includes(priority) ? priority : 'Medium';
  return RAIDItem.create({
    projectId,
    type: t,
    description: String(description).trim(),
    owner: owner && mongoose.Types.ObjectId.isValid(owner) ? owner : null,
    priority: p,
    source: 'Manual',
    confirmedByPM: true,
    status: 'Open',
  });
}

async function updateRaidItem(raidItemId, body) {
  const patch = {};
  if (body.description != null) patch.description = String(body.description).trim();
  if (body.priority && ['High', 'Medium', 'Low'].includes(body.priority)) patch.priority = body.priority;
  if (body.status && ['Open', 'Mitigated', 'Closed'].includes(body.status)) patch.status = body.status;
  if (body.owner !== undefined) {
    patch.owner =
      body.owner && mongoose.Types.ObjectId.isValid(body.owner) ? body.owner : null;
  }
  if (body.confirmedByPM === true) patch.confirmedByPM = true;
  const doc = await RAIDItem.findByIdAndUpdate(raidItemId, patch, { new: true, runValidators: true });
  if (!doc) throw new Error('RAID item not found');
  return doc;
}

async function listSentimentHistory(projectId, weeks = 4) {
  const since = new Date(Date.now() - weeks * 7 * 86400000);
  return SentimentHistory.find({ projectId, createdAt: { $gte: since } })
    .sort({ createdAt: -1 })
    .select('sentiment sentimentScore keySignals silenceRisk recommendation createdAt')
    .lean();
}

/** Client portal: latest sentiment + trend — no numeric score (FR-M5-06). */
async function getClientVisibleSentiment(projectId, userId) {
  const user = await User.findById(userId).select('projectIds').lean();
  if (!user?.projectIds?.length) throw new Error('Forbidden');
  const allowed = user.projectIds.some((id) => id.toString() === projectId);
  if (!allowed) throw new Error('Forbidden');
  const since = new Date(Date.now() - 4 * 7 * 86400000);
  const rows = await SentimentHistory.find({ projectId, createdAt: { $gte: since } })
    .sort({ createdAt: -1 })
    .select('sentiment keySignals silenceRisk recommendation createdAt')
    .lean();
  const latest = rows[0]
    ? {
        sentiment: rows[0].sentiment,
        keySignals: rows[0].keySignals,
        silenceRisk: rows[0].silenceRisk,
        recommendation: rows[0].recommendation,
        createdAt: rows[0].createdAt,
      }
    : null;
  const trend = rows.map((r) => ({ createdAt: r.createdAt, sentiment: r.sentiment }));
  return { latest, trend };
}

/** POST /api/ai/cr-impact — estimate days, cost, margin shift for a change request. */
async function calculateCrImpact(projectId, crPayload) {
  const ctx = await collectProjectData(projectId);
  const fallback = () => offline.crImpactOffline(crPayload || {});
  if (!hasGroqKey()) return fallback();
  const crJson = JSON.stringify(crPayload || {}).slice(0, 6000);
  const projJson = JSON.stringify(ctx).slice(0, 8000);
  const userMessage = `You estimate delivery impact of a change request. Return ONLY valid JSON (no markdown):
{"impactDays": number, "impactCost": number, "impactMarginShift": number, "recommendation": "string"}
Use reasonable numbers: impactCost in same currency units as project contract (INR). impactMarginShift is percentage points (e.g. -2.5 means margin drops 2.5 points).
PROJECT_CONTEXT:
${projJson}
CHANGE_REQUEST:
${crJson}`;
  try {
    const raw = await runGroq(userMessage, 600);
    const parsed = safeParseJSON(raw, 'cr-impact');
    return {
      impactDays: Number(parsed.impactDays) || 0,
      impactCost: Number(parsed.impactCost) || 0,
      impactMarginShift: Number(parsed.impactMarginShift) || 0,
      recommendation: String(parsed.recommendation || '').trim(),
    };
  } catch (err) {
    console.error('AI CR impact Error:', err.message);
    return fallback();
  }
}

module.exports = {
  getGroqClient,
  MODEL,
  safeParseJSON,
  collectProjectData,
  getProjectRisk,
  getWeeklySummary,
  getTaskFlags,
  askProjectQuestion,
  getPmScore,
  getMarginForecast,
  getResourceOverload,
  postClientSentiment,
  getEscalationRisk,
  postScopeCheck,
  getNarrative,
  approveClientNarrative,
  getClientApprovedNarrative,
  postRaidExtract,
  listRaidItems,
  createManualRaidItem,
  updateRaidItem,
  listSentimentHistory,
  getClientVisibleSentiment,
  calculateCrImpact,
};
