const mongoose = require('mongoose');
const User = require('../models/User');
const ProjectTemplate = require('../models/ProjectTemplate');
const BaselineRecord = require('../models/BaselineRecord');
const { recordAudit } = require('../middleware/audit');
const { scheduleInitialTier1Review } = require('../services/reviewScheduler');
const {
  listBuiltInCatalog,
  getBuiltInBlueprint,
  builtInCatalogEntry,
  customCatalogEntry,
  isBuiltInId,
  slugify,
} = require('../services/projectTemplateBlueprints');
const { instantiateFromBlueprint } = require('../services/projectTemplateService');
const {
  validateTierOneProjectPayload,
  validateSharePointIfPresent,
  assertEligibleDeliveryHead,
  assertEligibleProjectManager,
} = require('./projectController');

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

const TIER_VALUES = ProjectTemplate.TIER_VALUES;
const DELIVERY_PHASES = ProjectTemplate.DELIVERY_PHASES;
const PHASE_MIN = 2;
const PHASE_MAX = 5;

const isAuthor = (role) => role === 'admin' || role === 'pmo';

function toNonNegNumber(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function toStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((s) => String(s || '').trim()).filter(Boolean);
}

/** Returns a clean ObjectId-shaped string or null. */
function toObjectIdOrNull(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^[a-fA-F0-9]{24}$/.test(trimmed)) return null;
  return trimmed;
}

function sanitizeModules(rawModules) {
  if (!Array.isArray(rawModules) || rawModules.length === 0) {
    return { errors: ['At least one module is required'], modules: [] };
  }
  const errors = [];
  const modules = [];
  rawModules.forEach((m, idx) => {
    const name = typeof m?.name === 'string' ? m.name.trim() : '';
    if (name.length < 2) {
      errors.push(`module #${idx + 1}: name must be at least 2 characters`);
      return;
    }
    const budget = Number(m?.budgetHours);
    if (!Number.isFinite(budget) || budget < 0) {
      errors.push(`module #${idx + 1}: budgetHours must be a non-negative number`);
      return;
    }

    const rawWs = Array.isArray(m?.workstreams) ? m.workstreams : [];
    const workstreams = [];
    const seen = new Set();
    rawWs.forEach((w) => {
      const wsName =
        typeof w === 'string' ? w.trim() : typeof w?.name === 'string' ? w.name.trim() : '';
      if (!wsName) return;
      const key = wsName.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);

      if (typeof w === 'string') {
        workstreams.push({ name: wsName });
        return;
      }

      workstreams.push({
        name: wsName,
        description: typeof w?.description === 'string' ? w.description.trim() : '',
        startOffsetDays: toNonNegNumber(w?.startOffsetDays, 0),
        durationDays: toNonNegNumber(w?.durationDays, 1),
        budgetHours: toNonNegNumber(w?.budgetHours, 0),
        ownerPlaceholder:
          typeof w?.ownerPlaceholder === 'string' && w.ownerPlaceholder.trim()
            ? w.ownerPlaceholder.trim()
            : 'Project Manager',
        ownerUserId: toObjectIdOrNull(w?.ownerUserId),
        billable: typeof w?.billable === 'boolean' ? w.billable : true,
        automations: toStringArray(w?.automations),
        keyEvents: toStringArray(w?.keyEvents),
      });
    });

    let phaseCount = Number(m?.phaseCount);
    if (!Number.isFinite(phaseCount)) phaseCount = 3;
    phaseCount = Math.max(PHASE_MIN, Math.min(PHASE_MAX, Math.round(phaseCount)));

    modules.push({
      name,
      description: typeof m?.description === 'string' ? m.description.trim() : '',
      budgetHours: budget,
      startOffsetDays: toNonNegNumber(m?.startOffsetDays, 0),
      durationDays: toNonNegNumber(m?.durationDays, 1),
      ownerPlaceholder:
        typeof m?.ownerPlaceholder === 'string' && m.ownerPlaceholder.trim()
          ? m.ownerPlaceholder.trim()
          : 'Project Manager',
      ownerUserId: toObjectIdOrNull(m?.ownerUserId),
      automations: toStringArray(m?.automations),
      keyEvents: toStringArray(m?.keyEvents),
      workstreams,
      phaseCount,
    });
  });
  return { errors, modules };
}

function sanitizeTemplateBody(body) {
  const errors = [];
  const out = {};
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (name.length < 2) errors.push('name must be at least 2 characters');
  out.name = name;

  out.desc = typeof body?.desc === 'string' ? body.desc.trim() : '';
  out.durationLabel = typeof body?.durationLabel === 'string' ? body.durationLabel.trim() : '';

  const tier = body?.defaultTier || 'Tier 2';
  if (!TIER_VALUES.includes(tier)) {
    errors.push(`defaultTier must be one of: ${TIER_VALUES.join(', ')}`);
  }
  out.defaultTier = tier;

  const phase = body?.defaultDeliveryPhase || 'Sales Handover';
  if (!DELIVERY_PHASES.includes(phase)) {
    errors.push(`defaultDeliveryPhase must be one of: ${DELIVERY_PHASES.join(', ')}`);
  }
  out.defaultDeliveryPhase = phase;

  const { errors: modErrors, modules } = sanitizeModules(body?.modules);
  errors.push(...modErrors);
  out.modules = modules;

  return { errors, payload: out };
}

/** Generate a slug that doesn't collide with built-ins or existing custom templates. */
async function generateUniqueSlug(name) {
  const base = slugify(name) || `template-${Date.now()}`;
  let slug = base;
  let suffix = 2;
  // eslint-disable-next-line no-await-in-loop
  while (isBuiltInId(slug) || (await ProjectTemplate.findOne({ templateId: slug }).lean())) {
    slug = `${base}-${suffix}`;
    suffix += 1;
    if (suffix > 50) {
      slug = `${base}-${Date.now()}`;
      break;
    }
  }
  return slug;
}

/* ------------------------------------------------------------------ */
/* Read endpoints                                                     */
/* ------------------------------------------------------------------ */

const getCatalog = async (req, res) => {
  try {
    const builtIns = listBuiltInCatalog();
    const customDocs = await ProjectTemplate.find({}).sort({ updatedAt: -1 }).lean();
    const customs = customDocs.map(customCatalogEntry).filter(Boolean);
    res.json([...builtIns, ...customs]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getTemplate = async (req, res) => {
  try {
    const id = String(req.params.templateId || '').trim();
    if (!id) return res.status(400).json({ message: 'templateId is required' });

    if (isBuiltInId(id)) {
      const bp = getBuiltInBlueprint(id);
      if (!bp) return res.status(404).json({ message: 'Template not found' });
      const summary = builtInCatalogEntry(id);
      return res.json({
        ...summary,
        readOnly: true,
        defaultTier: bp.defaultTier,
        defaultDeliveryPhase: bp.defaultDeliveryPhase,
        moduleDetails: bp.modules.map((m) => ({
          name: m.name,
          description: '',
          budgetHours: m.budgetHours,
          startOffsetDays: 0,
          durationDays: 1,
          ownerPlaceholder: 'Project Manager',
          ownerUserId: null,
          automations: [],
          keyEvents: [],
          phaseCount: (m.workstreams || []).length || 3,
          workstreams: (m.workstreams || []).map((w) => ({
            name: typeof w === 'string' ? w : w?.name,
            description: '',
            startOffsetDays: 0,
            durationDays: 1,
            budgetHours: 0,
            ownerPlaceholder: 'Project Manager',
            ownerUserId: null,
            billable: true,
            automations: [],
            keyEvents: [],
          })),
        })),
      });
    }

    const doc = await ProjectTemplate.findOne({ templateId: id }).lean();
    if (!doc) return res.status(404).json({ message: 'Template not found' });
    res.json({
      ...customCatalogEntry(doc),
      readOnly: false,
      defaultTier: doc.defaultTier,
      defaultDeliveryPhase: doc.defaultDeliveryPhase,
      moduleDetails: (doc.modules || []).map((m) => ({
        name: m.name,
        description: m.description || '',
        budgetHours: m.budgetHours ?? 0,
        startOffsetDays: m.startOffsetDays ?? 0,
        durationDays: m.durationDays ?? 1,
        ownerPlaceholder: m.ownerPlaceholder || 'Project Manager',
        ownerUserId: m.ownerUserId ? String(m.ownerUserId) : null,
        automations: Array.isArray(m.automations) ? m.automations : [],
        keyEvents: Array.isArray(m.keyEvents) ? m.keyEvents : [],
        phaseCount: m.phaseCount,
        workstreams: (m.workstreams || []).map((w) => {
          if (typeof w === 'string') {
            return {
              name: w,
              description: '',
              startOffsetDays: 0,
              durationDays: 1,
              budgetHours: 0,
              ownerPlaceholder: 'Project Manager',
              ownerUserId: null,
              billable: true,
              automations: [],
              keyEvents: [],
            };
          }
          return {
            name: w?.name || '',
            description: w?.description || '',
            startOffsetDays: w?.startOffsetDays ?? 0,
            durationDays: w?.durationDays ?? 1,
            budgetHours: w?.budgetHours ?? 0,
            ownerPlaceholder: w?.ownerPlaceholder || 'Project Manager',
            ownerUserId: w?.ownerUserId ? String(w.ownerUserId) : null,
            billable: typeof w?.billable === 'boolean' ? w.billable : true,
            automations: Array.isArray(w?.automations) ? w.automations : [],
            keyEvents: Array.isArray(w?.keyEvents) ? w.keyEvents : [],
          };
        }),
      })),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* ------------------------------------------------------------------ */
/* Write endpoints (admin / pmo only)                                 */
/* ------------------------------------------------------------------ */

const createTemplate = async (req, res) => {
  try {
    if (!isAuthor(req.user?.role)) {
      return res.status(403).json({ message: 'Only admin or PMO can create templates' });
    }

    const { errors, payload } = sanitizeTemplateBody(req.body || {});
    if (errors.length) return res.status(400).json({ message: errors.join('; '), errors });

    const templateId = await generateUniqueSlug(payload.name);

    const doc = await ProjectTemplate.create({
      templateId,
      ...payload,
      createdBy: req.user._id,
      createdByName: req.user.name || '',
    });

    await recordAudit({
      entityType: 'ProjectTemplate',
      entityId: doc._id,
      action: 'project_template_created',
      before: null,
      after: { templateId: doc.templateId, name: doc.name, modules: doc.modules.length },
      actorId: req.user._id,
      actorName: req.user.name,
    });

    res.status(201).json(customCatalogEntry(doc.toObject ? doc.toObject() : doc));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const updateTemplate = async (req, res) => {
  try {
    if (!isAuthor(req.user?.role)) {
      return res.status(403).json({ message: 'Only admin or PMO can update templates' });
    }
    const id = String(req.params.templateId || '').trim();
    if (!id) return res.status(400).json({ message: 'templateId is required' });
    if (isBuiltInId(id)) {
      return res.status(400).json({ message: 'Built-in templates are read-only' });
    }

    const existing = await ProjectTemplate.findOne({ templateId: id });
    if (!existing) return res.status(404).json({ message: 'Template not found' });

    const { errors, payload } = sanitizeTemplateBody(req.body || {});
    if (errors.length) return res.status(400).json({ message: errors.join('; '), errors });

    const before = {
      name: existing.name,
      modules: existing.modules.length,
      defaultTier: existing.defaultTier,
      defaultDeliveryPhase: existing.defaultDeliveryPhase,
    };

    Object.assign(existing, payload);
    await existing.save();

    await recordAudit({
      entityType: 'ProjectTemplate',
      entityId: existing._id,
      action: 'project_template_updated',
      before,
      after: {
        name: existing.name,
        modules: existing.modules.length,
        defaultTier: existing.defaultTier,
        defaultDeliveryPhase: existing.defaultDeliveryPhase,
      },
      actorId: req.user._id,
      actorName: req.user.name,
    });

    res.json(customCatalogEntry(existing.toObject ? existing.toObject() : existing));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const deleteTemplate = async (req, res) => {
  try {
    if (!isAuthor(req.user?.role)) {
      return res.status(403).json({ message: 'Only admin or PMO can delete templates' });
    }
    const id = String(req.params.templateId || '').trim();
    if (!id) return res.status(400).json({ message: 'templateId is required' });
    if (isBuiltInId(id)) {
      return res.status(400).json({ message: 'Built-in templates cannot be deleted' });
    }

    const existing = await ProjectTemplate.findOne({ templateId: id });
    if (!existing) return res.status(404).json({ message: 'Template not found' });

    const before = {
      templateId: existing.templateId,
      name: existing.name,
      modules: existing.modules.length,
    };
    await existing.deleteOne();

    await recordAudit({
      entityType: 'ProjectTemplate',
      entityId: existing._id,
      action: 'project_template_deleted',
      before,
      after: null,
      actorId: req.user._id,
      actorName: req.user.name,
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

/* ------------------------------------------------------------------ */
/* Instantiate (built-in OR custom)                                   */
/* ------------------------------------------------------------------ */

const instantiateTemplate = async (req, res) => {
  try {
    const templateId = req.params.templateId;
    const body = req.body || {};
    const { clientUserId, ...rest } = body;

    let defaultTier = 'Tier 2';
    if (isBuiltInId(templateId)) {
      const bp = getBuiltInBlueprint(templateId);
      if (!bp) return res.status(404).json({ message: 'Template not found' });
      defaultTier = bp.defaultTier;
    } else {
      const doc = await ProjectTemplate.findOne({ templateId }).lean();
      if (!doc) return res.status(404).json({ message: 'Template not found' });
      defaultTier = doc.defaultTier || 'Tier 2';
    }

    const merged = {
      ...rest,
      tier: rest.tier || defaultTier,
    };

    const tierErr = validateTierOneProjectPayload(merged);
    if (tierErr) return res.status(400).json({ message: tierErr });

    const spErr = validateSharePointIfPresent(merged.sharePointUrl);
    if (spErr) return res.status(400).json({ message: spErr });

    if (merged.status === 'Active') {
      const dhCheck = await assertEligibleDeliveryHead(merged.deliveryHeadId);
      if (!dhCheck.ok) return res.status(400).json({ message: dhCheck.message });
      const pmCheck = await assertEligibleProjectManager(merged.projectManagerId);
      if (!pmCheck.ok) return res.status(400).json({ message: pmCheck.message });
    }

    const project = await instantiateFromBlueprint({
      actor: req.user,
      body: merged,
      templateId,
    });

    if (clientUserId && mongoose.Types.ObjectId.isValid(clientUserId)) {
      await User.findByIdAndUpdate(clientUserId, { $addToSet: { projectIds: project._id } });
    }

    if (project.status === 'Active') {
      await BaselineRecord.create({
        projectId: project._id,
        contractValue: project.contractValue,
        notionalARR: project.notionalARR ?? 0,
        lockedBy: req.user._id,
        version: 1,
      });
      await recordAudit({
        entityType: 'Project',
        entityId: project._id,
        action: 'project_baseline_locked',
        before: null,
        after: {
          contractValue: project.contractValue,
          notionalARR: project.notionalARR ?? 0,
          version: 1,
        },
        actorId: req.user._id,
        actorName: req.user.name,
        projectId: project._id,
      });
    }

    if (project.tier === 'Tier 1') {
      try {
        await scheduleInitialTier1Review(project._id);
      } catch (e) {
        console.error('[Tier1] scheduleInitialTier1Review (template) failed:', e.message);
      }
    }

    res.status(201).json(project);
  } catch (err) {
    if (err.code === 'UNKNOWN_TEMPLATE') {
      return res.status(404).json({ message: 'Template not found' });
    }
    res.status(400).json({ message: err.message });
  }
};

module.exports = {
  getCatalog,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  instantiateTemplate,
};
