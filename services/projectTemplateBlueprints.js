/**
 * Three curated delivery blueprints — GET /api/project-templates lists them;
 * POST /api/project-templates/:id/instantiate materializes modules, workstreams, and tasks.
 */

const PHASE_LABELS = ['Inception', 'Elaboration', 'Configuration', 'Transition', 'Hypercare'];

function moduleFromName(name, budgetHours, phaseCount = 3) {
  const n = Math.min(PHASE_LABELS.length, Math.max(2, phaseCount));
  const perWs = Math.max(24, Math.round(budgetHours / n));
  const workstreams = [];
  for (let i = 0; i < n; i += 1) {
    const phase = PHASE_LABELS[i];
    const short = String(name).slice(0, 28);
    workstreams.push({
      name: `${phase} — ${short}`,
      budgetHours: perWs,
      costRate: 0,
      tasks: [
        {
          title: `${phase}: scope & execution — ${short}`,
          owner: 'Project Manager',
          dueOffsetFromGoLive: -90 + i * 18,
        },
        {
          title: `${phase}: checkpoint / sign-off — ${short}`,
          owner: 'Delivery Lead',
          dueOffsetFromGoLive: -84 + i * 18,
        },
      ],
    });
  }
  return { name, budgetHours, workstreams };
}

const ENTERPRISE_HCM_MODULES = [
  'Discovery & blueprinting',
  'Core HR & org design',
  'Payroll & compensation',
  'Time, leave & attendance',
  'Integrations & data migration',
  'Cutover & hypercare',
];

const SMB_MODULES = ['Kickoff & discovery', 'Core configuration', 'UAT & training', 'Go-live support'];

const PAYROLL_SCALE_MODULES = [
  'Program governance & waves',
  'Country / entity configuration',
  'Banking, statutory & interfaces',
  'Parallel payroll & reconciliation',
  'Retro, sign-off & hypercare',
];

const BLUEPRINTS = {
  'enterprise-hcm': {
    meta: {
      name: 'Enterprise HCM',
      desc: 'Full-lifecycle HCM rollout: discovery through cutover, with phased workstreams per module.',
      moduleCount: ENTERPRISE_HCM_MODULES.length,
      durationWeeksLabel: '20-32 wks',
    },
    defaultDeliveryPhase: 'Sales Handover',
    defaultTier: 'Tier 2',
    modules: ENTERPRISE_HCM_MODULES.map((nm, i) => moduleFromName(nm, 400 + i * 45, 4)),
  },
  'smb-quickstart': {
    meta: {
      name: 'SMB quick start',
      desc: 'Lean playbook for smaller customers: fast configuration, UAT, and go-live support.',
      moduleCount: SMB_MODULES.length,
      durationWeeksLabel: '6-10 wks',
    },
    defaultDeliveryPhase: 'Customer Enablement',
    defaultTier: 'Tier 2',
    modules: SMB_MODULES.map((nm, i) => moduleFromName(nm, 180 + i * 35, 2)),
  },
  'payroll-scale': {
    meta: {
      name: 'Payroll at scale',
      desc: 'Multi-entity or multi-country payroll: governance, configuration, parallel runs, and handover.',
      moduleCount: PAYROLL_SCALE_MODULES.length,
      durationWeeksLabel: '16-24 wks',
    },
    defaultDeliveryPhase: 'Design Approval',
    defaultTier: 'Tier 2',
    modules: PAYROLL_SCALE_MODULES.map((nm, i) => moduleFromName(nm, 340 + i * 40, 3)),
  },
};

const CATALOG_ORDER = ['enterprise-hcm', 'smb-quickstart', 'payroll-scale'];

function listCatalog() {
  return CATALOG_ORDER.filter((id) => BLUEPRINTS[id]).map((id) => {
    const bp = BLUEPRINTS[id];
    return {
      id,
      name: bp.meta.name,
      desc: bp.meta.desc,
      modules: bp.meta.moduleCount,
      duration: bp.meta.durationWeeksLabel,
      sampleModuleNames: bp.modules.map((m) => m.name).slice(0, 5),
    };
  });
}

function getBlueprint(templateId) {
  if (!templateId || typeof templateId !== 'string') return null;
  return BLUEPRINTS[templateId.trim()] || null;
}

module.exports = {
  listCatalog,
  getBlueprint,
};
