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
 * Build a module blueprint from explicit workstream specs.
 *
 * Each entry may be either a string (just the workstream name) or an object
 * with { name, budgetHours?, ownerPlaceholder?, billable?, startOffsetDays?,
 * durationDays? } as produced by the template editor. When budgetHours is not
 * provided per workstream, the module's total budget is split evenly. Due
 * offsets default to a -90→-10 spread relative to go-live, but explicit
 * startOffsetDays + durationDays will be used when present.
 */
function moduleFromExplicit(name, budgetHours, rawWorkstreams) {
  const items = (rawWorkstreams || [])
    .map((w) => {
      if (typeof w === 'string') return { name: w.trim() };
      if (w && typeof w === 'object' && typeof w.name === 'string') {
        return { ...w, name: w.name.trim() };
      }
      return null;
    })
    .filter((w) => w && w.name.length > 0);

  if (items.length === 0) return moduleFromName(name, budgetHours, 3);

  const total = Math.max(0, Number(budgetHours) || 0);
  const totalExplicit = items.reduce(
    (sum, w) => sum + (Number.isFinite(Number(w.budgetHours)) ? Number(w.budgetHours) : 0),
    0
  );
  const perWsFallback = items.length > 0 ? Math.max(24, Math.round(total / items.length)) : 0;

  const span = Math.max(items.length - 1, 1);
  const startOffset = -90;
  const endOffset = -10;
  const step = (endOffset - startOffset) / span;

  const workstreams = items.map((spec, i) => {
    const wsName = spec.name;
    const owner =
      typeof spec.ownerPlaceholder === 'string' && spec.ownerPlaceholder.trim()
        ? spec.ownerPlaceholder.trim()
        : 'Project Manager';
    const billable = typeof spec.billable === 'boolean' ? spec.billable : true;

    const explicitBudget = Number(spec.budgetHours);
    const wsBudget =
      Number.isFinite(explicitBudget) && explicitBudget > 0 ? explicitBudget : perWsFallback;

    const startOff = Number(spec.startOffsetDays);
    const durDays = Number(spec.durationDays);
    let due = Math.round(startOffset + step * i);
    let dueLate = Math.min(due + 6, -1);
    if (Number.isFinite(startOff) && Number.isFinite(durDays) && durDays >= 0) {
      due = -Math.max(0, Math.round(90 - startOff));
      dueLate = -Math.max(0, Math.round(90 - startOff - durDays));
    }

    return {
      name: wsName,
      budgetHours: wsBudget,
      costRate: 0,
      ownerUserId: spec.ownerUserId || null,
      tasks: [
        {
          title: `${wsName}: scope & execution`,
          owner,
          billable,
          ownerUserId: spec.ownerUserId || null,
          dueOffsetFromGoLive: due,
        },
        {
          title: `${wsName}: checkpoint / sign-off`,
          owner: 'Delivery Lead',
          billable,
          ownerUserId: null,
          dueOffsetFromGoLive: dueLate,
        },
      ],
    };
  });

  // If the user assigned per-workstream effort explicitly, prefer that as the
  // module budget (so totals match what they entered in the editor). Otherwise
  // fall back to whatever budget was passed in.
  const moduleBudget = totalExplicit > 0 ? totalExplicit : total;
  return { name, budgetHours: moduleBudget, workstreams };
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
    const rawWs = Array.isArray(m.workstreams) ? m.workstreams : [];
    const richWs = rawWs
      .map((w) => {
        if (typeof w === 'string') return { name: w };
        if (w && typeof w === 'object' && typeof w.name === 'string') {
          return {
            name: w.name,
            budgetHours: w.budgetHours,
            ownerPlaceholder: w.ownerPlaceholder,
            ownerUserId: w.ownerUserId ? String(w.ownerUserId) : null,
            billable: w.billable,
            startOffsetDays: w.startOffsetDays,
            durationDays: w.durationDays,
          };
        }
        return null;
      })
      .filter(Boolean);

    if (richWs.length > 0) {
      return moduleFromExplicit(m.name, Number(m.budgetHours) || 240, richWs);
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
