const Project = require('../models/Project');
const ReviewSession = require('../models/ReviewSession');
const Alert = require('../models/Alert');

const DEFAULT_CHECKLIST = [
  { item: 'Delivery health / milestone status reviewed with PM', completed: false },
  { item: 'Financial burn vs plan validated', completed: false },
  { item: 'Risks and dependencies updated', completed: false },
  { item: 'Client comms cadence confirmed', completed: false },
];

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

async function createReviewSession(projectId, scheduledDate, checklist = DEFAULT_CHECKLIST) {
  return ReviewSession.create({
    projectId,
    scheduledDate,
    status: 'Upcoming',
    checklist: checklist.map((c) => ({ ...c })),
  });
}

/** First Tier 1 cadence session (14 days from project creation). */
async function scheduleInitialTier1Review(projectId) {
  const project = await Project.findById(projectId).select('tier createdAt projectManagerId deliveryHeadId name');
  if (!project || project.tier !== 'Tier 1') return null;
  const existing = await ReviewSession.findOne({ projectId }).lean();
  if (existing) return null;
  const base = project.createdAt || new Date();
  const scheduledDate = addDays(base, 14);
  const session = await createReviewSession(projectId, scheduledDate);
  await notifyPmDhReview(
    project,
    `Tier 1 governance review scheduled for ${scheduledDate.toDateString()} — ${project.name}`
  );
  return session;
}

async function notifyPmDhReview(project, message) {
  const recipients = [project.projectManagerId, project.deliveryHeadId].filter(Boolean);
  if (!recipients.length) return;
  await Alert.create({
    type: 'GovernanceReview',
    projectId: project._id,
    severity: 'Warning',
    message,
    data: { kind: 'tier1_review' },
    recipients,
    isRead: false,
  });
}

/**
 * Run on startup + daily: ensure Tier 1 projects have upcoming reviews every ~14 days;
 * mark overdue Upcoming sessions as Missed.
 */
async function runTier1ReviewScheduler() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  await ReviewSession.updateMany(
    { status: 'Upcoming', scheduledDate: { $lt: startOfToday } },
    { $set: { status: 'Missed' } }
  );

  const projects = await Project.find({
    tier: 'Tier 1',
    status: { $nin: ['Completed'] },
  })
    .select('_id createdAt projectManagerId deliveryHeadId name')
    .lean();

  for (const p of projects) {
    const lastAny = await ReviewSession.findOne({ projectId: p._id })
      .sort({ scheduledDate: -1 })
      .lean();

    const lastDate = lastAny ? new Date(lastAny.scheduledDate) : new Date(p.createdAt || Date.now());
    const hasUpcoming = await ReviewSession.findOne({
      projectId: p._id,
      status: 'Upcoming',
    }).lean();

    if (hasUpcoming) continue;

    const daysSince = (Date.now() - lastDate.getTime()) / (24 * 60 * 60 * 1000);
    if (daysSince < 14) continue;

    const scheduledDate = addDays(lastDate, 14);
    await createReviewSession(p._id, scheduledDate);
    const proj = await Project.findById(p._id).select('projectManagerId deliveryHeadId name');
    if (proj) {
      await notifyPmDhReview(
        proj,
        `Tier 1 governance review scheduled for ${scheduledDate.toDateString()} — ${proj.name}`
      );
    }
  }
}

module.exports = {
  DEFAULT_CHECKLIST,
  scheduleInitialTier1Review,
  runTier1ReviewScheduler,
  createReviewSession,
};
