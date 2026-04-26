const Project = require('../models/Project');
const Module = require('../models/Module');
const Workstream = require('../models/Workstream');
const Task = require('../models/Task');
const { getBlueprint } = require('./projectTemplateBlueprints');

function dueDateFromGoLive(goLive, offsetDays) {
  const d = new Date(goLive);
  if (Number.isNaN(d.getTime())) return new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + Number(offsetDays) || 0);
  return d;
}

/**
 * Creates a Draft (or requested status) project plus module / workstream / task tree from a blueprint.
 */
async function instantiateFromBlueprint({ actor, body, templateId }) {
  const blueprint = getBlueprint(templateId);
  if (!blueprint) {
    const err = new Error('UNKNOWN_TEMPLATE');
    err.code = 'UNKNOWN_TEMPLATE';
    throw err;
  }

  const goLiveDate = new Date(body.goLiveDate);
  const projectPayload = {
    name: String(body.name).trim(),
    clientName: String(body.clientName).trim(),
    goLiveDate,
    contractValue: Number(body.contractValue),
    implementationFee: Number(body.implementationFee ?? body.contractValue) || 0,
    notionalARR: Number(body.notionalARR) || 0,
    region: body.region || 'India',
    status: ['Draft', 'Active', 'Completed'].includes(body.status) ? body.status : 'Draft',
    tier: body.tier || blueprint.defaultTier,
    deliveryPhase: body.deliveryPhase || blueprint.defaultDeliveryPhase,
    sharePointUrl: body.sharePointUrl || '',
    accountPlaybookUrl: body.accountPlaybookUrl || '',
    csResourceName: body.csResourceName || '',
    hubspotDealId: null,
    deliveryHeadId: body.deliveryHeadId || null,
    projectManagerId: body.projectManagerId || null,
    clientUserId: body.clientUserId || null,
  };

  if (actor.role === 'pm') {
    projectPayload.projectManagerId = actor._id;
  } else if (actor.role === 'dh') {
    projectPayload.deliveryHeadId = actor._id;
  }

  const project = await Project.create(projectPayload);

  for (const modDef of blueprint.modules) {
    const mod = await Module.create({
      name: modDef.name,
      projectId: project._id,
      budgetHours: Number(modDef.budgetHours) || 240,
      status: project.status === 'Draft' ? 'Not Started' : 'In Progress',
    });

    for (const wsDef of modDef.workstreams || []) {
      const ws = await Workstream.create({
        name: wsDef.name,
        moduleId: mod._id,
        budgetHours: Number(wsDef.budgetHours) || 0,
        costRate: Number(wsDef.costRate) || 0,
      });

      for (const tDef of wsDef.tasks || []) {
        await Task.create({
          title: String(tDef.title).trim(),
          owner: String(tDef.owner || 'Project Manager').trim(),
          status: 'Not Started',
          dueDate: dueDateFromGoLive(goLiveDate, tDef.dueOffsetFromGoLive ?? -30),
          loggedHours: 0,
          workstreamId: ws._id,
          assignedTo: null,
          billable: true,
        });
      }
    }
  }

  return Project.findById(project._id);
}

module.exports = {
  instantiateFromBlueprint,
};
