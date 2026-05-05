/**
 * Reusable recurring task patterns used to seed a workstream with a standard
 * checklist (e.g. "UAT" pattern, "Configuration" pattern). Pure data with no
 * external deps so it can be imported by both controller and frontend.
 *
 * Each preset has:
 *  - key: unique id
 *  - title: display name
 *  - description: short help text
 *  - matchWorkstreamNames: optional [String] of workstream names this preset
 *      is most relevant for (used by UI to suggest "best match" presets)
 *  - tasks: ordered list. Each task has
 *      title (required), owner (default "Project Manager"), offsetDays (from
 *      workstream baseline start — default 0), durationDays (used to compute
 *      dueDate when offsetDays missing — default 5), billable (default true).
 */
const PRESETS = [
  {
    key: 'uat',
    title: 'UAT cycle',
    description: 'Plan, execute, and sign off a User Acceptance Test cycle.',
    matchWorkstreamNames: ['UAT'],
    tasks: [
      { title: 'Draft UAT plan & test scripts', owner: 'Project Manager', offsetDays: 0, durationDays: 3 },
      { title: 'Schedule UAT kickoff with client', owner: 'Project Manager', offsetDays: 2, durationDays: 1 },
      { title: 'Run UAT execution window', owner: 'QA Lead', offsetDays: 5, durationDays: 7 },
      { title: 'Triage UAT defects & re-test', owner: 'QA Lead', offsetDays: 12, durationDays: 5 },
      { title: 'Capture UAT sign-off', owner: 'Project Manager', offsetDays: 17, durationDays: 2 },
    ],
  },
  {
    key: 'config',
    title: 'Configuration setup',
    description: 'Standard configuration playbook for a new module.',
    matchWorkstreamNames: ['Configuration'],
    tasks: [
      { title: 'Confirm requirements & policy options', owner: 'Project Manager', offsetDays: 0, durationDays: 3 },
      { title: 'Configure master data', owner: 'Implementation Consultant', offsetDays: 3, durationDays: 5 },
      { title: 'Configure workflows & approvals', owner: 'Implementation Consultant', offsetDays: 8, durationDays: 5 },
      { title: 'Internal QA on configuration', owner: 'QA Lead', offsetDays: 13, durationDays: 3 },
      { title: 'Walkthrough with client SPOC', owner: 'Project Manager', offsetDays: 16, durationDays: 1 },
    ],
  },
  {
    key: 'data-migration',
    title: 'Data migration cycle',
    description: 'End-to-end data extraction → load → reconciliation.',
    matchWorkstreamNames: ['Data Migration'],
    tasks: [
      { title: 'Receive client source data + schema', owner: 'Project Manager', offsetDays: 0, durationDays: 2 },
      { title: 'Map source to target schema', owner: 'Data Engineer', offsetDays: 2, durationDays: 4 },
      { title: 'Run migration in sandbox', owner: 'Data Engineer', offsetDays: 6, durationDays: 3 },
      { title: 'Reconciliation report (records / totals)', owner: 'Data Engineer', offsetDays: 9, durationDays: 2 },
      { title: 'Client review & sign-off on data', owner: 'Project Manager', offsetDays: 11, durationDays: 2 },
      { title: 'Production cut-over', owner: 'Data Engineer', offsetDays: 14, durationDays: 1 },
    ],
  },
  {
    key: 'training',
    title: 'Training rollout',
    description: 'TTT, end-user training and feedback capture.',
    matchWorkstreamNames: ['Training'],
    tasks: [
      { title: 'Build training collateral', owner: 'Trainer', offsetDays: 0, durationDays: 5 },
      { title: 'Train the trainer (TTT) session', owner: 'Trainer', offsetDays: 5, durationDays: 1 },
      { title: 'Schedule end-user batches', owner: 'Project Manager', offsetDays: 6, durationDays: 2 },
      { title: 'Run end-user training sessions', owner: 'Trainer', offsetDays: 8, durationDays: 7 },
      { title: 'Collect training feedback & nudges', owner: 'Project Manager', offsetDays: 15, durationDays: 3 },
    ],
  },
  {
    key: 'integration',
    title: 'Integration build',
    description: 'API contract, build, and end-to-end test.',
    matchWorkstreamNames: ['Integration'],
    tasks: [
      { title: 'Confirm integration scope & API contract', owner: 'Solution Architect', offsetDays: 0, durationDays: 3 },
      { title: 'Build connectors / endpoints', owner: 'Integration Engineer', offsetDays: 3, durationDays: 7 },
      { title: 'Unit + functional integration tests', owner: 'QA Lead', offsetDays: 10, durationDays: 4 },
      { title: 'End-to-end test with downstream system', owner: 'Integration Engineer', offsetDays: 14, durationDays: 3 },
      { title: 'Cutover plan & runbook', owner: 'Project Manager', offsetDays: 17, durationDays: 2 },
    ],
  },
  {
    key: 'go-live',
    title: 'Go-live readiness',
    description: 'Pre-go-live checks, dress rehearsal, and hypercare.',
    matchWorkstreamNames: ['Go-Live', 'Cutover'],
    tasks: [
      { title: 'Go/no-go checklist with stakeholders', owner: 'Project Manager', offsetDays: 0, durationDays: 2 },
      { title: 'Production deployment dry run', owner: 'Implementation Consultant', offsetDays: 2, durationDays: 1 },
      { title: 'Production deployment', owner: 'Implementation Consultant', offsetDays: 3, durationDays: 1 },
      { title: 'Hypercare day 1 monitoring', owner: 'Project Manager', offsetDays: 4, durationDays: 1 },
      { title: 'Hypercare wrap & retro', owner: 'Project Manager', offsetDays: 11, durationDays: 1 },
    ],
  },
];

const BY_KEY = new Map(PRESETS.map((p) => [p.key, p]));

function getPresetByKey(key) {
  return BY_KEY.get(key) || null;
}

function listPresets() {
  return PRESETS.map((p) => ({
    key: p.key,
    title: p.title,
    description: p.description,
    matchWorkstreamNames: p.matchWorkstreamNames || [],
    taskCount: p.tasks.length,
  }));
}

module.exports = {
  PRESETS,
  getPresetByKey,
  listPresets,
};
