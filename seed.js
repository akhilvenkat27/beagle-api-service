/**
 * UDIP Beagle — comprehensive demo seed
 * Run: node seed.js   or   npm run seed
 *
 * Covers: three client users (each 3 Active projects), multi-project portfolio, Tier 1 governance,
 * modules/workstreams/tasks with member1/member2/memberHeavy rotation + quarter-hour logged hours,
 * member projectIds, client narrative + sentiment history, change requests (all states),
 * RAID (all types), alerts (all types), audit (incl. status_changed), sync logs (Darwinbox health),
 * saved reports + schedule, module dependencies, workstream sign-offs, HubSpot intake linkage sample.
 *
 * Each module has five HCM workstreams (Inception → Hypercare) so the Module Delivery Status matrix
 * matches real workstreams. NorthStar also gets: Payroll/Elaboration blocked, Core HR/Transition
 * at-risk (overdues), Recruitment Inception+Elaboration all complete.
 */

const mongoose = require('mongoose');
require('dotenv').config();

const User = require('./models/User');
const Project = require('./models/Project');
const Module = require('./models/Module');
const Workstream = require('./models/Workstream');
const Task = require('./models/Task');
const Comment = require('./models/Comment');
const CostRate = require('./models/CostRate');
const BaselineRecord = require('./models/BaselineRecord');
const ChangeRequest = require('./models/ChangeRequest');
const RAIDItem = require('./models/RAIDItem');
const AuditLog = require('./models/AuditLog');
const Alert = require('./models/Alert');
const SavedReport = require('./models/SavedReport');
const ReviewSession = require('./models/ReviewSession');
const SyncLog = require('./models/SyncLog');
const SentimentHistory = require('./models/SentimentHistory');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/beagle';

const DEMO_PASSWORD = 'UdipDemo2026!';

const daysFromNow = (d) => new Date(Date.now() + d * 86400000);

/** Extra rows for the Module Delivery Status API (blocked / at-risk / all-done phases) */
async function applyModuleMatrixDemos(pm, member1) {
  const northStar = await Project.findOne({ name: /NorthStar Retail/ });
  if (!northStar) return;
  // Blocked: Payroll → Elaboration
  const payroll = await Module.findOne({ projectId: northStar._id, name: /Payroll/i });
  if (payroll) {
    const elab = await Workstream.findOne({ moduleId: payroll._id, name: /^Elaboration/ });
    if (elab) await Workstream.findByIdAndUpdate(elab._id, { isBlocked: true });
  }
  // At Risk (≥2 overdue, not done): Core HR → Transition
  const coreHr = await Module.findOne({ projectId: northStar._id, name: /Core HR/i });
  if (coreHr) {
    const trans = await Workstream.findOne({ moduleId: coreHr._id, name: /^Transition/ });
    if (trans) {
      await Task.create([
        {
          title: 'Overdue gate item A (matrix demo)',
          owner: member1.name,
          status: 'In Progress',
          dueDate: daysFromNow(-12),
          loggedHours: 0,
          workstreamId: trans._id,
          assignedTo: member1._id,
          billable: true,
        },
        {
          title: 'Overdue gate item B (matrix demo)',
          owner: member1.name,
          status: 'In Progress',
          dueDate: daysFromNow(-8),
          loggedHours: 0,
          workstreamId: trans._id,
          assignedTo: member1._id,
          billable: true,
        },
      ]);
    }
  }
  // Complete: Inception + Elaboration on Recruitment
  const recruit = await Module.findOne({ projectId: northStar._id, name: /Recruitment/i });
  if (recruit) {
    for (const ph of ['Inception', 'Elaboration']) {
      const w = await Workstream.findOne({ moduleId: recruit._id, name: new RegExp(`^${ph}`) });
      if (!w) continue;
      const tasks = await Task.find({ workstreamId: w._id });
      for (const t of tasks) {
        await Task.findByIdAndUpdate(t._id, {
          status: 'Done',
          dueDate: daysFromNow(-2),
          loggedHours: Math.max(2.5, Number(t.loggedHours) || 0),
        });
      }
    }
  }
}

const HCM_MODULES_ACTIVE = [
  'Core HR & Org',
  'Payroll & Compensation',
  'Time, Leave & Attendance',
  'Recruitment & Onboarding',
];

const HCM_MODULES_DRAFT = ['Core HR', 'Payroll', 'Benefits'];

/** Workstream names aligned to Module Delivery Status matrix (5 phases) */
const HCM_PHASE_WORKSTREAMS = ['Inception', 'Elaboration', 'Configuration', 'Transition', 'Hypercare'];

/** Quarter-hour realistic day slices for burn / margin demos */
const SAMPLE_WORK_HOURS = [1.5, 2, 3.25, 4, 5.5, 6, 7.5, 8, 2.25, 3.5, 4.75, 6.25, 1.25, 5, 6.5];

function sampleLoggedHours(taskIndex, status) {
  if (status === 'Not Started') return 0;
  const slot = SAMPLE_WORK_HOURS[taskIndex % SAMPLE_WORK_HOURS.length];
  const jitter = ((taskIndex * 3) % 8) * 0.25;
  let h = slot + jitter;
  if (status === 'Done') h += 1.5;
  if (status === 'In Progress') h *= 0.85;
  return Math.round(Math.min(24, Math.max(0, h)) * 4) / 4;
}

function pickStatusAndDue(i) {
  const r = i % 5;
  if (r === 0) return { status: 'Done', due: daysFromNow(-14), hours: sampleLoggedHours(i, 'Done') };
  if (r === 1) return { status: 'Done', due: daysFromNow(-3), hours: sampleLoggedHours(i, 'Done') };
  if (r === 2) return { status: 'In Progress', due: daysFromNow(7), hours: sampleLoggedHours(i, 'In Progress') };
  if (r === 3) return { status: 'Not Started', due: daysFromNow(21), hours: sampleLoggedHours(i, 'Not Started') };
  return { status: 'Not Started', due: daysFromNow(-5), hours: sampleLoggedHours(i, 'Not Started') };
}

async function wipe() {
  await Promise.all([
    Comment.deleteMany({}),
    Task.deleteMany({}),
    Alert.deleteMany({}),
    AuditLog.deleteMany({}),
    RAIDItem.deleteMany({}),
    ChangeRequest.deleteMany({}),
    ReviewSession.deleteMany({}),
    BaselineRecord.deleteMany({}),
    SavedReport.deleteMany({}),
    Workstream.deleteMany({}),
    Module.deleteMany({}),
    Project.deleteMany({}),
    SyncLog.deleteMany({}),
    SentimentHistory.deleteMany({}),
    CostRate.deleteMany({}),
    User.deleteMany({}),
  ]);
  console.log('Cleared all collections');
}

async function seed() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('MongoDB connected');
    await wipe();

    const admin = await User.create({
      name: 'Asha Rao',
      email: 'admin@udip.demo',
      password: DEMO_PASSWORD,
      role: 'admin',
      seniority: 'Lead',
      costRatePerHour: 4200,
    });

    await User.create({
      name: 'Darwinbox Admin',
      email: 'admin@darwinbox.io',
      password: DEMO_PASSWORD,
      role: 'admin',
      seniority: 'Lead',
      costRatePerHour: 4200,
    });

    /**
     * Demo accounts — one primary role per user; the API scopes data by role + project membership.
     * admin/pmo: org-wide portfolio; admin-only routes for users/costs/integration.
     * dh: projects where they are delivery head.
     * pm: projects where they are project manager; PM dashboard and tasks scoped accordingly.
     * exec: org-wide read (projects list/detail, CR read); executive dashboard; no CR create/submit.
     * member: tasks assigned to them; home uses member area for “Projects” in the shell.
     * client: `projectIds` list — portal shows only those projects (kept disjoint below so demos don’t cross).
     */
    const pmo = await User.create({
      name: 'Vikram PMO',
      email: 'pmo@udip.demo',
      password: DEMO_PASSWORD,
      role: 'pmo',
      seniority: 'Senior',
      costRatePerHour: 3800,
    });

    const dh = await User.create({
      name: 'Neha DeliveryHead',
      email: 'dh@udip.demo',
      password: DEMO_PASSWORD,
      role: 'dh',
      seniority: 'Lead',
      costRatePerHour: 4500,
    });

    const pm = await User.create({
      name: 'Arjun PM',
      email: 'pm@udip.demo',
      password: DEMO_PASSWORD,
      role: 'pm',
      seniority: 'Senior',
      costRatePerHour: 3200,
    });

    const member1 = await User.create({
      name: 'Rahul Kumar',
      email: 'member1@udip.demo',
      password: DEMO_PASSWORD,
      role: 'member',
      seniority: 'Mid',
      costRatePerHour: 2400,
    });

    const member2 = await User.create({
      name: 'Priya Sharma',
      email: 'member2@udip.demo',
      password: DEMO_PASSWORD,
      role: 'member',
      seniority: 'Senior',
      costRatePerHour: 3000,
    });

    /** Many assigned tasks — see bulk create after NorthStar module graph. */
    const memberHeavy = await User.create({
      name: 'Kavya Task-Heavy',
      email: 'member-heavy@udip.demo',
      password: DEMO_PASSWORD,
      role: 'member',
      seniority: 'Mid',
      costRatePerHour: 2600,
    });

    const exec = await User.create({
      name: 'Sanjay Executive',
      email: 'exec@udip.demo',
      password: DEMO_PASSWORD,
      role: 'exec',
      seniority: 'Lead',
      costRatePerHour: 5000,
    });

    const client = await User.create({
      name: 'Client — NorthStar Retail',
      email: 'client@udip.demo',
      password: DEMO_PASSWORD,
      role: 'client',
      seniority: 'Mid',
    });

    const client2 = await User.create({
      name: 'Client — FinServe APAC',
      email: 'client2@udip.demo',
      password: DEMO_PASSWORD,
      role: 'client',
      seniority: 'Mid',
    });

    const client3 = await User.create({
      name: 'Client — Atlas Healthcare',
      email: 'client3@udip.demo',
      password: DEMO_PASSWORD,
      role: 'client',
      seniority: 'Mid',
    });

    console.log(
      'Users:',
      [admin, pmo, dh, pm, exec, member1, member2, memberHeavy, client, client2, client3]
        .map((u) => u.email)
        .join(', ')
    );

    const now = new Date();
    await CostRate.create([
      {
        role: 'Consultant',
        seniority: 'Senior',
        region: 'India',
        ratePerHour: 3200,
        currency: 'INR',
        effectiveFrom: now,
        effectiveTo: null,
        createdBy: admin._id,
      },
      {
        role: 'Consultant',
        seniority: 'Mid',
        region: 'India',
        ratePerHour: 2200,
        currency: 'INR',
        effectiveFrom: now,
        effectiveTo: null,
        createdBy: admin._id,
      },
      {
        role: 'Consultant',
        seniority: 'Senior',
        region: 'SEA',
        ratePerHour: 3800,
        currency: 'INR',
        effectiveFrom: now,
        effectiveTo: null,
        createdBy: admin._id,
      },
    ]);
    console.log('Cost rates: India Senior, India Mid, SEA Senior');

    /** Rotate assignments so each member (incl. heavy) has many tasks with sample hours */
    const taskAssignees = () => [member1, member2, memberHeavy];

    async function buildProjectTree({
      name,
      clientName,
      status,
      contractValue,
      implementationFee,
      notionalARR,
      goLiveOffsetDays,
      moduleNames,
      sponsorClientId = null,
      deliveryPhase = 'Build & Integration',
      tier = 'Tier 2',
      sharePointUrl = '',
      accountPlaybookUrl = '',
      csResourceName = '',
      hubspotDealId = null,
      region = 'India',
    }) {
      const isTier1 = tier === 'Tier 1';
      const proj = await Project.create({
        name,
        clientName,
        goLiveDate: daysFromNow(goLiveOffsetDays),
        contractValue,
        implementationFee,
        notionalARR,
        region,
        status,
        tier,
        deliveryPhase,
        deliveryHeadId: dh._id,
        projectManagerId: pm._id,
        clientUserId: sponsorClientId || null,
        hubspotDealId: hubspotDealId || null,
        sharePointUrl: isTier1 ? sharePointUrl || 'https://contoso.sharepoint.com/sites/ns-hcm' : sharePointUrl,
        accountPlaybookUrl: isTier1
          ? accountPlaybookUrl || 'https://contoso.sharepoint.com/sites/ns-playbook'
          : accountPlaybookUrl,
        csResourceName: isTier1 ? csResourceName || 'CS — NorthStar' : csResourceName,
      });

      const mods = [];
      for (const modName of moduleNames) {
        const mod = await Module.create({
          name: modName,
          projectId: proj._id,
          budgetHours: 480 + moduleNames.indexOf(modName) * 40,
          status: status === 'Draft' ? 'Not Started' : 'In Progress',
        });
        mods.push(mod);
      }

      let taskCounter = 0;
      for (let mi = 0; mi < mods.length; mi += 1) {
        const mod = mods[mi];
        const modShort = String(mod.name).slice(0, 36);
        for (let wi = 0; wi < HCM_PHASE_WORKSTREAMS.length; wi += 1) {
          const phaseName = HCM_PHASE_WORKSTREAMS[wi];
          const teamMembers = (wi + mi) % 2 === 0 ? [member1._id, member2._id] : [member1._id];
          const ws = await Workstream.create({
            name: `${phaseName} — ${modShort}`,
            moduleId: mod._id,
            leadId: wi % 2 === 0 ? pm._id : member1._id,
            memberIds: teamMembers,
            budgetHours: 120,
            costRate: 2800,
            baselinePlannedStartDate: daysFromNow(-30 + mi * 10 + wi * 3),
            baselinePlannedEndDate: daysFromNow(45 + mi * 8 + wi * 5),
          });

          const numTasks = 3; /* 5 matrix phases / module — keep per-ws count modest for fast seed */
          const assignees = taskAssignees();
          for (let ti = 0; ti < numTasks; ti += 1) {
            const { status: st, due, hours } = pickStatusAndDue(taskCounter);
            const assignee = assignees[taskCounter % assignees.length];
            taskCounter += 1;
            await Task.create({
              title: `Task ${ti + 1}: ${ws.name.slice(0, 40)}`,
              owner: assignee.name,
              status: st,
              dueDate: due,
              loggedHours: hours,
              workstreamId: ws._id,
              assignedTo: assignee._id,
              billable: true,
            });
          }
        }
      }

      return proj;
    }

    console.log('Building project trees (modules, workstreams, tasks)…');
    const pActive1 = await buildProjectTree({
      name: 'NorthStar Retail — HCM Transformation',
      clientName: 'NorthStar Retail Pvt Ltd',
      status: 'Active',
      contractValue: 4_200_000,
      implementationFee: 3_600_000,
      notionalARR: 1_200_000,
      goLiveOffsetDays: 120,
      moduleNames: HCM_MODULES_ACTIVE,
      sponsorClientId: client._id,
      deliveryPhase: 'Build & Integration',
    });

    const pActive2 = await buildProjectTree({
      name: 'FinServe APAC — Payroll Modernization',
      clientName: 'FinServe APAC Ltd',
      status: 'Active',
      contractValue: 2_850_000,
      implementationFee: 2_400_000,
      notionalARR: 900_000,
      goLiveOffsetDays: 90,
      moduleNames: HCM_MODULES_ACTIVE.slice(0, 3),
      sponsorClientId: client2._id,
      deliveryPhase: 'UAT',
    });

    const pActive3 = await buildProjectTree({
      name: 'Riverdale Logistics — Workforce & Time',
      clientName: 'Riverdale Logistics India',
      status: 'Active',
      contractValue: 1_650_000,
      implementationFee: 1_380_000,
      notionalARR: 520_000,
      goLiveOffsetDays: 75,
      moduleNames: ['Time, Leave & Attendance', 'Payroll & Compensation'],
      sponsorClientId: client2._id,
      deliveryPhase: 'Build & Integration',
    });

    const pDraft = await buildProjectTree({
      name: 'Manufacturing EU — Phase 0 Blueprint',
      clientName: 'EuroManufacturing AG',
      status: 'Draft',
      contractValue: 5_500_000,
      implementationFee: 4_800_000,
      notionalARR: 1_800_000,
      goLiveOffsetDays: 200,
      moduleNames: HCM_MODULES_DRAFT,
      deliveryPhase: 'Sales Handover',
      hubspotDealId: 'HS-001',
    });
    console.log('Projects: NorthStar, FinServe, Riverdale, EU Draft (HS-001), Atlas Tier 1');

    const pTier1 = await buildProjectTree({
      name: 'Atlas Healthcare — Tier 1 Global HCM',
      clientName: 'Atlas Healthcare Group',
      status: 'Active',
      contractValue: 6_200_000,
      implementationFee: 5_400_000,
      notionalARR: 2_100_000,
      goLiveOffsetDays: 150,
      moduleNames: ['Core HR & Org', 'Payroll & Compensation', 'Time, Leave & Attendance'],
      sponsorClientId: client3._id,
      deliveryPhase: 'Customer Enablement',
      tier: 'Tier 1',
    });

    await applyModuleMatrixDemos(pm, member1);
    console.log('Module matrix demo: 5 phase workstreams per module; NorthStar — Payroll Elaboration blocked, Core HR Transition at-risk, Recruitment Inception+Elaboration all Done');

    try {
      const ns = await Project.findOne({ name: /NorthStar Retail/ });
      if (ns) {
        const firstMod = await Module.findOne({ projectId: ns._id }).sort({ createdAt: 1 });
        if (firstMod) {
          const firstWs = await Workstream.findOne({ moduleId: firstMod._id }).sort({ createdAt: 1 });
          if (firstWs) {
            const parentT = await Task.findOne({ workstreamId: firstWs._id, parentTaskId: null }).sort({
              createdAt: 1,
            });
            if (parentT) {
              const { status: st, due, hours } = pickStatusAndDue(900);
              await Task.create({
                title: 'Subtask: detail follow-up (seed demo)',
                owner: member1.name,
                status: st,
                dueDate: due,
                loggedHours: hours,
                workstreamId: firstWs._id,
                parentTaskId: parentT._id,
                assignedTo: member1._id,
                billable: true,
              });
            }
          }
        }
      }
    } catch (e) {
      console.warn('Subtask seed:', e.message);
    }

    /** Client portal scoping: disjoint project sets so demo accounts do not see each other’s projects. */
    client.projectIds = [pActive1._id];
    client2.projectIds = [pActive2._id, pActive3._id];
    client3.projectIds = [pTier1._id];
    await client.save();
    await client2.save();
    await client3.save();

    member1.projectIds = [pActive1._id, pActive2._id, pActive3._id, pTier1._id];
    member2.projectIds = [pActive1._id, pActive2._id, pActive3._id];
    memberHeavy.projectIds = [pActive1._id, pActive2._id, pActive3._id, pTier1._id];
    await member1.save();
    await member2.save();
    await memberHeavy.save();

    for (const p of [pActive1, pActive2, pActive3, pTier1]) {
      await BaselineRecord.create({
        projectId: p._id,
        contractValue: p.contractValue,
        notionalARR: p.notionalARR ?? 0,
        lockedBy: admin._id,
        version: 1,
        lockedAt: daysFromNow(-14),
      });
    }
    console.log('Baselines locked for Active projects (incl. Tier 1 Atlas)');

    const sampleTasks = await Task.find({}).sort({ createdAt: 1 }).limit(5).lean();
    if (sampleTasks.length) {
      await Comment.create([
        {
          taskId: sampleTasks[0]._id,
          userId: client._id,
          text: 'Thanks team — please keep milestone dates visible in the client view.',
        },
        {
          taskId: sampleTasks[1]?._id || sampleTasks[0]._id,
          userId: pm._id,
          text: 'We will publish the UAT window by Friday — client portal will reflect progress.',
        },
        {
          taskId: sampleTasks[2]?._id || sampleTasks[0]._id,
          userId: member1._id,
          text: 'Integration test pack v2 uploaded to SharePoint.',
        },
      ]);
    }

    const cr = await ChangeRequest.create({
      projectId: pActive1._id,
      title: 'Add off-cycle payroll run for acquisition entity',
      description: 'Legal entity closing requires parallel payroll for 6 weeks.',
      scopeDescription: 'Payroll module + one integration workstream',
      affectedWorkstreams: ['Payroll & Compensation'],
      requestedBy: pm._id,
      status: 'Pending Approval',
      impactDays: 12,
      impactCost: 180000,
      impactMarginShift: -1.2,
      aiRecommendation: 'Approve with phased cutover; monitor margin on Tier-2 burn.',
    });

    const crStale = await ChangeRequest.create({
      projectId: pActive1._id,
      title: 'Legacy accrual engine — parallel run window',
      description: 'Extend parallel payroll validation by 3 weeks.',
      scopeDescription: 'Payroll',
      affectedWorkstreams: ['Payroll & Compensation'],
      requestedBy: member1._id,
      status: 'Pending Approval',
      impactDays: 5,
      impactCost: 45000,
      impactMarginShift: -0.3,
      aiRecommendation: 'Review with finance.',
    });
    await ChangeRequest.collection.updateOne(
      { _id: crStale._id },
      { $set: { updatedAt: daysFromNow(-20) } }
    );

    await ChangeRequest.create([
      {
        projectId: pActive1._id,
        title: 'Enable mobile clock-in for field staff',
        description: 'Rollout to 200 stores.',
        scopeDescription: 'Time module',
        affectedWorkstreams: ['Time, Leave & Attendance'],
        requestedBy: pm._id,
        status: 'Approved',
        impactDays: 8,
        impactCost: 120000,
        impactMarginShift: -0.8,
        aiRecommendation: 'Approved baseline path.',
        dhApprovalBy: dh._id,
        dhApprovalAt: daysFromNow(-10),
      },
      {
        projectId: pActive2._id,
        title: 'Defer benefits module to phase 2',
        description: 'Client budget freeze.',
        scopeDescription: 'Benefits',
        affectedWorkstreams: [],
        requestedBy: pm._id,
        status: 'Rejected',
        impactDays: 0,
        impactCost: 0,
        impactMarginShift: 0,
        aiRecommendation: 'Reject — contractual scope locked.',
        dhRejectionReason: 'Out of current SOW; capture as phase-2 CR.',
      },
      {
        projectId: pTier1._id,
        title: 'Tier 1 — add regional statutory pack',
        description: 'MEA pack for 3 countries.',
        scopeDescription: 'Core HR',
        affectedWorkstreams: ['Core HR & Org'],
        requestedBy: pm._id,
        status: 'Draft',
        impactDays: 18,
        impactCost: 220000,
        impactMarginShift: -1.5,
        aiRecommendation: 'Size with Atlas legal before submit.',
      },
    ]);
    console.log('Change requests: pending, stale pending, approved, rejected, draft');

    await RAIDItem.create([
      {
        projectId: pActive1._id,
        type: 'Risk',
        description: 'Data quality in legacy attendance feeds may delay UAT sign-off.',
        owner: pm._id,
        priority: 'High',
        status: 'Open',
        source: 'Manual',
        confirmedByPM: true,
      },
      {
        projectId: pActive1._id,
        type: 'Issue',
        description: 'Sandbox SSO cert expires in 14 days — renewal in progress.',
        owner: member1._id,
        priority: 'Medium',
        status: 'Open',
        source: 'Manual',
        confirmedByPM: true,
      },
      {
        projectId: pActive2._id,
        type: 'Assumption',
        description: 'Client IT will provide VPN profiles by week 6.',
        owner: pm._id,
        priority: 'Low',
        status: 'Open',
        source: 'Manual',
        confirmedByPM: true,
      },
      {
        projectId: pTier1._id,
        type: 'Dependency',
        description: 'Global payroll calendar locked by corporate HQ.',
        owner: dh._id,
        priority: 'High',
        status: 'Open',
        source: 'Manual',
        confirmedByPM: true,
      },
    ]);
    console.log('RAID items: Risk, Issue, Assumption, Dependency');

    await Alert.create([
      {
        type: 'MarginAlert',
        projectId: pActive1._id,
        severity: 'Warning',
        message: 'Burn approaching 85% on Payroll module — review scope with DH.',
        recipients: [dh._id, pm._id],
        isRead: false,
      },
      {
        type: 'ResourceOverload',
        projectId: pActive1._id,
        severity: 'Critical',
        message: 'Two workstreams share the same integration SME — sequencing risk.',
        recipients: [pm._id],
        isRead: false,
      },
      {
        type: 'ClientSilence',
        projectId: pActive2._id,
        severity: 'Warning',
        message: 'No client comments on FinServe tasks in 10 days — nudge sponsor.',
        recipients: [pm._id, exec._id],
        isRead: false,
      },
      {
        type: 'Escalation',
        projectId: pTier1._id,
        severity: 'Critical',
        message: 'Atlas statutory pack dependency flagged by DH — exec visibility.',
        recipients: [exec._id, pmo._id],
        isRead: false,
      },
      {
        type: 'GovernanceReview',
        projectId: pTier1._id,
        severity: 'Warning',
        message: 'Tier 1 governance review window — checklist due this week.',
        data: { kind: 'tier1_review' },
        recipients: [pm._id, dh._id],
        isRead: false,
      },
      {
        type: 'MarginAlert',
        projectId: pActive1._id,
        severity: 'Warning',
        message: 'Member action: log remaining hours on assigned UAT tasks before Friday.',
        recipients: [member1._id, member2._id, memberHeavy._id],
        isRead: false,
      },
    ]);
    console.log('Alerts: margin, overload, client silence, escalation, governance, member');

    await AuditLog.create([
      {
        entityType: 'Project',
        entityId: pActive1._id,
        action: 'project_activated',
        before: { status: 'Draft' },
        after: { status: 'Active', name: pActive1.name },
        actorId: admin._id,
        actorName: admin.name,
        projectId: pActive1._id,
        timestamp: daysFromNow(-20),
      },
      {
        entityType: 'Project',
        entityId: pActive1._id,
        action: 'project_baseline_locked',
        before: null,
        after: { contractValue: pActive1.contractValue, version: 1 },
        actorId: admin._id,
        actorName: admin.name,
        projectId: pActive1._id,
        timestamp: daysFromNow(-14),
      },
      {
        entityType: 'Project',
        entityId: pActive1._id,
        action: 'status_changed',
        before: { deliveryPhase: 'Build & Integration' },
        after: { deliveryPhase: 'UAT' },
        actorId: pm._id,
        actorName: pm.name,
        projectId: pActive1._id,
        timestamp: daysFromNow(-4),
      },
      {
        entityType: 'CR',
        entityId: cr._id,
        action: 'cr_submitted',
        before: { status: 'Draft' },
        after: { status: 'Pending Approval', title: cr.title },
        actorId: pm._id,
        actorName: pm.name,
        projectId: pActive1._id,
        timestamp: daysFromNow(-2),
      },
    ]);
    console.log('Audit entries (incl. status_changed for compliance scoring)');

    const nextWeekly = new Date(Date.now() + 7 * 86400000);
    await SavedReport.create([
      {
        name: 'Portfolio — Active projects margin',
        createdBy: pmo._id,
        fields: ['projectName', 'clientName', 'status', 'margin', 'contractValue'],
        filters: [{ field: 'status', operator: 'eq', value: 'Active' }],
        schedule: {
          enabled: true,
          frequency: 'weekly',
          recipients: [pmo._id, exec._id],
          lastRun: daysFromNow(-7),
          nextRun: nextWeekly,
        },
        isPublic: false,
      },
      {
        name: 'Delivery — Overdue tasks (all)',
        createdBy: admin._id,
        fields: ['projectName', 'title', 'owner', 'dueDate', 'status', 'loggedHours'],
        filters: [{ field: 'isOverdue', operator: 'eq', value: 'true' }],
        isPublic: false,
      },
      {
        name: 'Executive — Tier 1 burn snapshot',
        createdBy: exec._id,
        fields: ['projectName', 'clientName', 'tier', 'margin', 'loggedHours'],
        filters: [{ field: 'tier', operator: 'eq', value: 'Tier 1' }],
        isPublic: true,
      },
    ]);
    console.log('Saved reports: 3 (1 with weekly schedule)');

    const nsMods = await Module.find({ projectId: pActive1._id }).sort({ createdAt: 1 });
    if (nsMods.length >= 2) {
      await Module.findByIdAndUpdate(nsMods[1]._id, { dependsOn: [nsMods[0]._id], status: 'In Progress' });
      if (nsMods[2]) {
        await Module.findByIdAndUpdate(nsMods[2]._id, { dependsOn: [nsMods[0]._id] });
      }
      await Module.findByIdAndUpdate(nsMods[0]._id, { status: 'Completed' });
    }

    const allWs = await Workstream.find({})
      .populate({ path: 'moduleId', select: 'projectId' })
      .sort({ createdAt: 1 })
      .lean();
    let wsIdx = 0;
    for (const w of allWs) {
      const pid = w.moduleId?.projectId?.toString();
      if (!pid) continue;
      const patch = {};
      if (wsIdx < 6) {
        patch.signOffStatus = 'Signed Off';
        patch.signOffCompletedAt = daysFromNow(-8 + wsIdx);
        patch.signOffNotes = 'Demo sign-off';
      } else if (wsIdx < 10) {
        patch.signOffStatus = 'Requested';
        patch.signOffRequestedAt = daysFromNow(-2);
      }
      wsIdx += 1;
      if (Object.keys(patch).length) await Workstream.findByIdAndUpdate(w._id, patch);
    }

    const poolWs = await Workstream.findOne({ moduleId: nsMods[0]?._id });
    if (poolWs) {
      await Task.create([
        {
          title: 'Unassigned — vendor credential exchange',
          owner: 'Pool',
          status: 'Not Started',
          dueDate: daysFromNow(12),
          loggedHours: 0,
          workstreamId: poolWs._id,
          assignedTo: null,
          billable: true,
        },
        {
          title: 'Unassigned — dry-run calendar validation',
          owner: 'Pool',
          status: 'In Progress',
          dueDate: daysFromNow(5),
          loggedHours: 0,
          workstreamId: poolWs._id,
          assignedTo: null,
          billable: true,
        },
      ]);
    }

    if (poolWs && memberHeavy) {
      for (let hi = 0; hi < 48; hi += 1) {
        const { status: st, due, hours } = pickStatusAndDue(500 + hi);
        await Task.create({
          title: `Member-heavy backlog ${hi + 1}: UAT / config / sign-off checklist`,
          owner: memberHeavy.name,
          status: st,
          dueDate: due,
          loggedHours: hours,
          workstreamId: poolWs._id,
          assignedTo: memberHeavy._id,
          billable: true,
        });
      }
      console.log('Member-heavy: 48 tasks on NorthStar first workstream → member-heavy@udip.demo');
    }

    await Project.findByIdAndUpdate(pActive1._id, {
      lastSyncAt: daysFromNow(-1),
      lastSyncRecords: 52,
      darwinboxTagsPushedAt: daysFromNow(-45),
      clientNarrativeDraft:
        'NorthStar HCM is progressing on plan: core modules are in UAT, payroll parallel run is scheduled, and go-live readiness reviews are weekly with the client sponsor.',
      clientNarrativeDraftAt: daysFromNow(-5),
      clientNarrativeApprovedAt: daysFromNow(-3),
    });
    await Project.findByIdAndUpdate(pActive2._id, {
      lastSyncAt: daysFromNow(-3),
      lastSyncRecords: 28,
      darwinboxTagsPushedAt: daysFromNow(-40),
      clientNarrativeDraft:
        'FinServe payroll modernization is in UAT: parallel payroll runs are stable and the client sponsor has visibility in the portal.',
      clientNarrativeDraftAt: daysFromNow(-4),
      clientNarrativeApprovedAt: daysFromNow(-2),
    });
    await Project.findByIdAndUpdate(pActive3._id, {
      lastSyncAt: daysFromNow(-2),
      lastSyncRecords: 19,
      darwinboxTagsPushedAt: daysFromNow(-25),
      clientNarrativeDraft:
        'Riverdale logistics: time and attendance pilots are green in two distribution centers; payroll cutover is next.',
      clientNarrativeDraftAt: daysFromNow(-3),
      clientNarrativeApprovedAt: daysFromNow(-1),
    });
    await Project.findByIdAndUpdate(pTier1._id, {
      lastSyncAt: daysFromNow(-0.5),
      lastSyncRecords: 64,
      darwinboxTagsPushedAt: daysFromNow(-20),
      clientNarrativeDraft: 'Atlas Tier 1 program: design approvals complete; build phase on track.',
      clientNarrativeDraftAt: daysFromNow(-2),
      clientNarrativeApprovedAt: daysFromNow(-1),
    });

    const sentimentNow = Date.now();
    await SentimentHistory.create([
      {
        projectId: pActive1._id,
        sentiment: 'Positive',
        sentimentScore: 72,
        keySignals: ['Responsive client', 'Milestones green'],
        silenceRisk: false,
        recommendation: 'Maintain weekly steering.',
        createdBy: pm._id,
        createdAt: new Date(sentimentNow - 21 * 86400000),
      },
      {
        projectId: pActive1._id,
        sentiment: 'Neutral',
        sentimentScore: 58,
        keySignals: ['UAT load'],
        silenceRisk: false,
        recommendation: 'Watch payroll cutover dates.',
        createdBy: pm._id,
        createdAt: new Date(sentimentNow - 14 * 86400000),
      },
      {
        projectId: pActive1._id,
        sentiment: 'Mixed',
        sentimentScore: 52,
        keySignals: ['Scope questions on benefits'],
        silenceRisk: true,
        recommendation: 'Schedule client workshop.',
        createdBy: dh._id,
        createdAt: new Date(sentimentNow - 7 * 86400000),
      },
      {
        projectId: pActive1._id,
        sentiment: 'Positive',
        sentimentScore: 68,
        keySignals: ['Client portal engagement up'],
        silenceRisk: false,
        recommendation: 'Continue transparent reporting.',
        createdBy: pm._id,
        createdAt: new Date(sentimentNow - 2 * 86400000),
      },
      {
        projectId: pActive2._id,
        sentiment: 'Positive',
        sentimentScore: 64,
        keySignals: ['UAT cycle on schedule'],
        silenceRisk: false,
        recommendation: 'Keep weekly client demos.',
        createdBy: pm._id,
        createdAt: new Date(sentimentNow - 5 * 86400000),
      },
      {
        projectId: pActive2._id,
        sentiment: 'Neutral',
        sentimentScore: 55,
        keySignals: ['Holiday blackout approaching'],
        silenceRisk: false,
        recommendation: 'Plan cutover communications.',
        createdBy: pm._id,
        createdAt: new Date(sentimentNow - 1 * 86400000),
      },
      {
        projectId: pTier1._id,
        sentiment: 'Positive',
        sentimentScore: 70,
        keySignals: ['Tier 1 governance cadence met'],
        silenceRisk: false,
        recommendation: 'Sustain steering rhythm through go-live.',
        createdBy: dh._id,
        createdAt: new Date(sentimentNow - 3 * 86400000),
      },
      {
        projectId: pActive3._id,
        sentiment: 'Positive',
        sentimentScore: 66,
        keySignals: ['Pilot DCs stable'],
        silenceRisk: false,
        recommendation: 'Lock payroll cutover date with finance.',
        createdBy: pm._id,
        createdAt: new Date(sentimentNow - 6 * 86400000),
      },
      {
        projectId: pActive3._id,
        sentiment: 'Neutral',
        sentimentScore: 56,
        keySignals: ['Warehouse shift patterns TBD'],
        silenceRisk: false,
        recommendation: 'Confirm Ramadan shift rules with HR.',
        createdBy: pm._id,
        createdAt: new Date(sentimentNow - 1 * 86400000),
      },
    ]);
    console.log('Sentiment history (NorthStar, FinServe, Riverdale, Atlas)');

    await ReviewSession.create([
      {
        projectId: pTier1._id,
        scheduledDate: daysFromNow(-35),
        status: 'Completed',
        checklist: [
          { item: 'Delivery health / milestone status reviewed with PM', completed: true },
          { item: 'Financial burn vs plan validated', completed: true },
          { item: 'Risks and dependencies updated', completed: true },
          { item: 'Client comms cadence confirmed', completed: true },
        ],
        completedBy: dh._id,
        completedAt: daysFromNow(-34),
        notes: 'Initial Tier 1 review complete.',
      },
      {
        projectId: pTier1._id,
        scheduledDate: daysFromNow(-8),
        status: 'Missed',
        checklist: [
          { item: 'Delivery health / milestone status reviewed with PM', completed: false },
          { item: 'Financial burn vs plan validated', completed: false },
          { item: 'Risks and dependencies updated', completed: false },
          { item: 'Client comms cadence confirmed', completed: false },
        ],
      },
      {
        projectId: pTier1._id,
        scheduledDate: daysFromNow(10),
        status: 'Upcoming',
        checklist: [
          { item: 'Delivery health / milestone status reviewed with PM', completed: false },
          { item: 'Financial burn vs plan validated', completed: false },
          { item: 'Risks and dependencies updated', completed: false },
          { item: 'Client comms cadence confirmed', completed: false },
        ],
      },
    ]);
    console.log('Tier 1 review sessions: Completed, Missed, Upcoming');

    const syncNow = new Date();
    await SyncLog.create([
      {
        projectId: pActive1._id,
        syncType: 'timesheets',
        status: 'success',
        recordsProcessed: 24,
        recordsFailed: 0,
        syncedAt: new Date(syncNow.getTime() - 25 * 60 * 1000),
      },
      {
        projectId: pActive2._id,
        syncType: 'timesheets',
        status: 'partial',
        recordsProcessed: 18,
        recordsFailed: 2,
        syncedAt: new Date(syncNow.getTime() - 3 * 60 * 60 * 1000),
      },
      {
        projectId: pTier1._id,
        syncType: 'timesheets',
        status: 'success',
        recordsProcessed: 31,
        recordsFailed: 0,
        syncedAt: new Date(syncNow.getTime() - 50 * 60 * 1000),
      },
      {
        projectId: pActive1._id,
        syncType: 'timesheets',
        status: 'success',
        recordsProcessed: 12,
        recordsFailed: 0,
        syncedAt: new Date(syncNow.getTime() - 20 * 60 * 1000),
      },
      {
        projectId: pActive3._id,
        syncType: 'timesheets',
        status: 'success',
        recordsProcessed: 14,
        recordsFailed: 0,
        syncedAt: new Date(syncNow.getTime() - 40 * 60 * 1000),
      },
    ]);
    console.log('Sync logs (integration health + last hour activity)');

    console.log('\n✅ Seed complete\n');
    console.log('Demo password (all accounts):', DEMO_PASSWORD);
    console.log('Accounts:');
    console.log('  admin@udip.demo (admin)');
    console.log('  admin@darwinbox.io (admin)');
    console.log('  pmo@udip.demo (pmo)');
    console.log('  dh@udip.demo (dh)');
    console.log('  pm@udip.demo (pm)');
    console.log('  member1@udip.demo, member2@udip.demo (members — projectIds set)');
    console.log('  member-heavy@udip.demo (member — many tasks + all Active projectIds)');
    console.log('  exec@udip.demo (exec)');
    console.log('  client@udip.demo — NorthStar Retail (1 project)');
    console.log('  client2@udip.demo — FinServe + Riverdale (2 projects)');
    console.log('  client3@udip.demo — Atlas Healthcare Tier 1 (1 project)');
    console.log('  (members rotate on tasks with quarter-hour sample logged hours)\n');

    await mongoose.connection.close();
  } catch (err) {
    console.error('Seed failed:', err);
    process.exit(1);
  }
}

seed();
