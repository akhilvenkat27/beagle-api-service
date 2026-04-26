const Project = require('../models/Project');
const Module = require('../models/Module');
const PendingHubspotDeal = require('../models/PendingHubspotDeal');
const hubspotService = require('../services/hubspotService');

const DEFAULT_MODULE_BUDGET_HOURS = 100;

/**
 * GET /api/intake/pending-deals — mock HubSpot deals not yet converted to projects
 */
exports.getPendingDeals = async (req, res) => {
  try {
    const deals = await hubspotService.getPendingDeals();
    res.json(deals);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.rejectPendingDeal = async (req, res) => {
  try {
    let deal = await PendingHubspotDeal.findOne({ dealId: req.params.dealId });
    if (!deal) {
      const mock = hubspotService.findMockDealById(req.params.dealId);
      if (!mock) return res.status(404).json({ message: 'Pending deal not found' });
      deal = await PendingHubspotDeal.create({
        dealId: mock.dealId,
        clientName: mock.clientName,
        goLiveDate: mock.goLiveDate,
        contractValue: mock.contractValue,
        notionalARR: mock.notionalARR,
        scopedModules: mock.scopedModules,
        accountOwner: mock.accountOwner,
        dealStage: mock.dealStage,
      });
    }
    deal.status = 'Rejected';
    deal.rejectedReason = req.body?.reason || '';
    deal.rejectedAt = new Date();
    await deal.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.markDealIntaken = async (req, res) => {
  try {
    let deal = await PendingHubspotDeal.findOne({ dealId: req.params.dealId });
    if (!deal) {
      const mock = hubspotService.findMockDealById(req.params.dealId);
      if (!mock) return res.status(404).json({ message: 'Pending deal not found' });
      deal = await PendingHubspotDeal.create({
        dealId: mock.dealId,
        clientName: mock.clientName,
        goLiveDate: mock.goLiveDate,
        contractValue: mock.contractValue,
        notionalARR: mock.notionalARR,
        scopedModules: mock.scopedModules,
        accountOwner: mock.accountOwner,
        dealStage: mock.dealStage,
      });
    }
    deal.status = 'Intaken';
    deal.intakenAt = new Date();
    deal.projectId = req.body?.projectId || deal.projectId || null;
    await deal.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

async function ingestClosedWonPayload(raw) {
  const events = Array.isArray(raw) ? raw : [raw];
  const created = [];
  const ignored = [];

  for (const event of events) {
    const payloadData = event?.data || event;
    const dealId = event?.objectId || payloadData?.dealId || payloadData?.deal_id;
    if (!dealId) {
      ignored.push({ reason: 'missing_deal_id' });
      continue;
    }

    let normalized;
    if (event?.subscriptionType === 'deal.propertyChange' || event?.objectId) {
      let deal = null;
      let company = null;
      let owner = null;
      try {
        deal = await hubspotService.getDeal(dealId);
        const props = deal.properties || {};
        if (!hubspotService.isClosedWon(props.dealstage)) {
          ignored.push({ dealId, reason: 'not_closed_won', dealStage: props.dealstage });
          continue;
        }
        [company, owner] = await Promise.all([
          hubspotService.getCompanyFromDeal(dealId).catch(() => null),
          hubspotService.getOwner(props.hubspot_owner_id).catch(() => null),
        ]);
      } catch (err) {
        // If HubSpot API credentials are absent, still support direct payload testing.
        if (!hubspotService.isClosedWon(payloadData.dealStage || payloadData.deal_stage || payloadData.dealstage)) {
          ignored.push({ dealId, reason: 'hubspot_fetch_failed', message: err.message });
          continue;
        }
      }
      normalized = hubspotService.normalizeDealPayload({
        dealId,
        deal,
        company,
        owner,
        fallback: payloadData,
      });
    } else {
      const stage = payloadData.dealStage || payloadData.deal_stage || payloadData.dealstage || 'closedwon';
      if (!hubspotService.isClosedWon(stage)) {
        ignored.push({ dealId, reason: 'not_closed_won', dealStage: stage });
        continue;
      }
      normalized = hubspotService.normalizeDealPayload({ dealId, fallback: { ...payloadData, dealStage: stage } });
    }

    const existing = await Project.findOne({ hubspotDealId: normalized.dealId }).select('_id').lean();
    if (existing) {
      ignored.push({ dealId: normalized.dealId, reason: 'already_project', projectId: existing._id });
      continue;
    }
    const doc = await hubspotService.upsertPendingDeal(normalized, raw);
    created.push(doc);
  }

  return { created, ignored };
}

exports.hubspotDealWebhook = async (req, res) => {
  try {
    const result = await ingestClosedWonPayload(req.body || {});
    if (!result.created.length) {
      return res.json({ status: 'ignored', ignored: result.ignored });
    }
    res.status(202).json({
      status: 'pending_intake',
      count: result.created.length,
      deals: result.created.map((d) => ({ dealId: d.dealId, clientName: d.clientName })),
      ignored: result.ignored,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/**
 * POST /api/intake/hubspot-webhook — mock webhook: create UDIP project + module shells from deal
 * Body should mirror HubSpot-style deal fields (see hubspotService.mockDeals).
 */
exports.hubspotWebhook = async (req, res) => {
  try {
    const body = req.body || {};
    const dealId = body.dealId;

    if (!dealId || typeof dealId !== 'string') {
      return res.status(400).json({ message: 'dealId is required' });
    }

    const existing = await Project.findOne({ hubspotDealId: dealId });
    if (existing) {
      return res.status(409).json({
        message: 'This deal has already been converted to a UDIP project',
        projectId: existing._id,
      });
    }

    const template = hubspotService.findMockDealById(dealId);
    const clientName = body.clientName ?? template?.clientName;
    const goLiveDate = body.goLiveDate ?? template?.goLiveDate;
    const contractValue = body.contractValue ?? template?.contractValue;
    const notionalARR = body.notionalARR ?? template?.notionalARR ?? 0;
    const scopedModules = Array.isArray(body.scopedModules)
      ? body.scopedModules
      : template?.scopedModules ?? [];

    if (!clientName || !goLiveDate || contractValue == null) {
      return res.status(400).json({
        message:
          'Missing required fields: clientName, goLiveDate, contractValue (or use a known mock dealId)',
      });
    }

    const name =
      body.name?.trim() ||
      `${clientName} — ${dealId}`;

    const implFee =
      body.implementationFee != null ? Number(body.implementationFee) : Number(contractValue) || 0;

    const project = await Project.create({
      name,
      clientName: String(clientName).trim(),
      goLiveDate: new Date(goLiveDate),
      contractValue: Number(contractValue),
      implementationFee: implFee,
      notionalARR: Number(notionalARR) || 0,
      region: body.region || 'India',
      status: 'Draft',
      deliveryPhase: 'Sales Handover',
      hubspotDealId: dealId,
      tier: body.tier || 'Tier 2',
      sharePointUrl: body.sharePointUrl || '',
      accountPlaybookUrl: body.accountPlaybookUrl || '',
      csResourceName: body.csResourceName || '',
    });

    for (const modName of scopedModules) {
      if (!modName || typeof modName !== 'string') continue;
      await Module.create({
        name: modName.trim(),
        projectId: project._id,
        budgetHours: DEFAULT_MODULE_BUDGET_HOURS,
      });
    }

    const populated = await Project.findById(project._id);
    res.status(201).json(populated);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};
