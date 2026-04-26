const mongoose = require('mongoose');
const User = require('../models/User');
const BaselineRecord = require('../models/BaselineRecord');
const { recordAudit } = require('../middleware/audit');
const { scheduleInitialTier1Review } = require('../services/reviewScheduler');
const { listCatalog, getBlueprint } = require('../services/projectTemplateBlueprints');
const { instantiateFromBlueprint } = require('../services/projectTemplateService');
const {
  validateTierOneProjectPayload,
  validateSharePointIfPresent,
  assertEligibleDeliveryHead,
  assertEligibleProjectManager,
} = require('./projectController');

const getCatalog = async (req, res) => {
  try {
    res.json(listCatalog());
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const instantiateTemplate = async (req, res) => {
  try {
    const templateId = req.params.templateId;
    const blueprint = getBlueprint(templateId);
    if (!blueprint) {
      return res.status(404).json({ message: 'Template not found' });
    }

    const body = req.body || {};
    const { clientUserId, ...rest } = body;
    const merged = {
      ...rest,
      tier: rest.tier || blueprint.defaultTier,
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
  instantiateTemplate,
};
