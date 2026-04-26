/**
 * Built-in blueprints + helpers to combine them with user-created templates.
 *
 * GET /api/project-templates merges built-ins with stored ProjectTemplate docs.
 * POST /api/project-templates/:id/instantiate resolves the blueprint from either
 * the built-in catalog or the database, then materializes modules, workstreams, tasks.
 */

const PHASE_LABELS = ['Inception', 'Elaboration', 'Configuration', 'Transition', 'Hypercare'];

const SLUG_RE = /[^a-z0-9]+/g;

function slugify(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(SLUG_RE, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

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

/**
 * Build a module blueprint from explicit workstream names.
 * Budget is split evenly across the provided workstreams; each gets 2 starter tasks.
 */
function moduleFromExplicit(name, budgetHours, workstreamNames) {
  const cleaned = (workstreamNames || [])
    .map((s) => String(s || '').trim())
    .filter((s) => s.length > 0);
  if (cleaned.length === 0) return moduleFromName(name, budgetHours, 3);

  const total = Math.max(0, Number(budgetHours) || 0);
  const perWs = cleaned.length > 0 ? Math.max(24, Math.round(total / cleaned.length)) : 0;
  const span = Math.max(cleaned.length - 1, 1);
  const startOffset = -90;
  const endOffset = -10;
  const step = (endOffset - startOffset) / span;

  const workstreams = cleaned.map((wsName, i) => {
    const due = Math.round(startOffset + step * i);
    return {
      name: wsName,
      budgetHours: perWs,
      costRate: 0,
      tasks: [
        {
          title: `${wsName}: scope & execution`,
          owner: 'Project Manager',
          dueOffsetFromGoLive: due,
        },
        {
          title: `${wsName}: checkpoint / sign-off`,
          owner: 'Delivery Lead',
          dueOffsetFromGoLive: Math.min(due + 6, -1),
        },
      ],
    };
  });

  return { name, budgetHours: total, workstreams };
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

const BUILT_IN_BLUEPRINTS = {
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

const BUILT_IN_ORDER = ['enterprise-hcm', 'smb-quickstart', 'payroll-scale'];
const BUILT_IN_IDS = new Set(BUILT_IN_ORDER);

/** Catalog summary entry for the listing endpoint (works for both built-in and custom). */
function builtInCatalogEntry(id) {
  const bp = BUILT_IN_BLUEPRINTS[id];
  if (!bp) return null;
  return {
    id,
    name: bp.meta.name,
    desc: bp.meta.desc,
    modules: bp.meta.moduleCount,
    duration: bp.meta.durationWeeksLabel,
    sampleModuleNames: bp.modules.map((m) => m.name).slice(0, 5),
    isCustom: false,
    canEdit: false,
  };
}

function customCatalogEntry(doc) {
  if (!doc) return null;
  const sample = (doc.modules || []).map((m) => m.name).slice(0, 5);
  return {
    id: doc.templateId,
    name: doc.name,
    desc: doc.desc || '',
    modules: (doc.modules || []).length,
    duration: doc.durationLabel || '',
    sampleModuleNames: sample,
    isCustom: true,
    canEdit: true,
    createdByName: doc.createdByName || '',
    updatedAt: doc.updatedAt,
  };
}

/** Lists ONLY built-ins. Combine with DB results in the controller. */
function listBuiltInCatalog() {
  return BUILT_IN_ORDER.filter((id) => BUILT_IN_BLUEPRINTS[id]).map(builtInCatalogEntry);
}

function getBuiltInBlueprint(templateId) {
  if (!templateId || typeof templateId !== 'string') return null;
  return BUILT_IN_BLUEPRINTS[templateId.trim()] || null;
}

/** Convert a stored ProjectTemplate doc into the blueprint shape used by the instantiator. */
function blueprintFromCustomDoc(doc) {
  if (!doc) return null;
  const modules = (doc.modules || []).map((m) => {
    const wsNames = Array.isArray(m.workstreams)
      ? m.workstreams.map((w) => (typeof w === 'string' ? w : w?.name)).filter(Boolean)
      : [];
    if (wsNames.length > 0) {
      return moduleFromExplicit(m.name, Number(m.budgetHours) || 240, wsNames);
    }
    return moduleFromName(m.name, Number(m.budgetHours) || 240, Number(m.phaseCount) || 3);
  });
  return {
    meta: {
      name: doc.name,
      desc: doc.desc || '',
      moduleCount: modules.length,
      durationWeeksLabel: doc.durationLabel || '',
    },
    defaultTier: doc.defaultTier || 'Tier 2',
    defaultDeliveryPhase: doc.defaultDeliveryPhase || 'Sales Handover',
    modules,
  };
}

function isBuiltInId(templateId) {
  return BUILT_IN_IDS.has(String(templateId || '').trim());
}

module.exports = {
  // Public surface
  listBuiltInCatalog,
  getBuiltInBlueprint,
  blueprintFromCustomDoc,
  builtInCatalogEntry,
  customCatalogEntry,
  isBuiltInId,
  slugify,
  // Back-compat aliases (older callers may use these names)
  listCatalog: listBuiltInCatalog,
  getBlueprint: getBuiltInBlueprint,
};
