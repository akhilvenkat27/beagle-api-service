/**
 * MOCK HubSpot integration (FR-M1-01, FR-M1-02)
 * ---------------------------------------------------------------------------
 * HubSpot’s real Deals API and webhooks require a paid developer/test portal.
 * This module simulates the payload shape HubSpot sends when a deal moves to
 * “closed won / committed” so UDIP can be exercised end-to-end without HubSpot.
 *
 * In production: replace getMockDeals / helpers with HubSpot client calls and
 * verify webhook signatures (v3 request signatures).
 */

const Project = require('../models/Project');
const PendingHubspotDeal = require('../models/PendingHubspotDeal');

const BASE_URL = 'https://api.hubapi.com';

function authHeaders() {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN || process.env.HUBSPOT_TOKEN;
  if (!token) return null;
  return { Authorization: `Bearer ${token}` };
}

async function hubspotGet(path, params = {}) {
  const headers = authHeaders();
  if (!headers) {
    throw new Error('HUBSPOT_PRIVATE_APP_TOKEN is not configured');
  }
  const url = new URL(`${BASE_URL}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== '') url.searchParams.set(key, value);
  });
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HubSpot request failed (${res.status}): ${body}`);
  }
  return res.json();
}

async function getDeal(dealId) {
  return hubspotGet(`/crm/v3/objects/deals/${dealId}`, {
    properties: [
      'dealname',
      'dealstage',
      'amount',
      'closedate',
      'hubspot_owner_id',
      'notional_arr',
      'implementation_scope',
    ].join(','),
  });
}

async function getCompanyFromDeal(dealId) {
  const assoc = await hubspotGet(`/crm/v3/objects/deals/${dealId}/associations/companies`);
  const companyId = assoc?.results?.[0]?.id;
  if (!companyId) return null;
  return hubspotGet(`/crm/v3/objects/companies/${companyId}`, { properties: 'name' });
}

async function getOwner(ownerId) {
  if (!ownerId) return null;
  return hubspotGet(`/crm/v3/owners/${ownerId}`);
}

function parseScope(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (!value) return [];
  return String(value)
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeDealPayload({ dealId, deal, company, owner, fallback = {} }) {
  const props = deal?.properties || {};
  const clientName =
    fallback.clientName ||
    fallback.client_name ||
    company?.properties?.name ||
    props.client_name ||
    props.dealname ||
    fallback.dealName ||
    fallback.deal_name;
  return {
    dealId: String(dealId || fallback.dealId || fallback.deal_id || ''),
    dealName: props.dealname || fallback.dealName || fallback.deal_name || '',
    clientName: clientName ? String(clientName).trim() : '',
    goLiveDate: fallback.goLiveDate || fallback.go_live_date || props.closedate || null,
    contractValue: Number(fallback.contractValue ?? fallback.contract_value ?? props.amount ?? 0) || 0,
    notionalARR: Number(fallback.notionalARR ?? fallback.notional_arr ?? props.notional_arr ?? 0) || 0,
    implementationScope:
      fallback.implementationScope || fallback.implementation_scope || props.implementation_scope || '',
    scopedModules: parseScope(
      fallback.scopedModules || fallback.scoped_modules || fallback.implementationScope || fallback.implementation_scope || props.implementation_scope
    ),
    accountOwner: fallback.accountOwner || fallback.account_owner || owner?.email || '',
    dealStage: fallback.dealStage || fallback.deal_stage || props.dealstage || '',
  };
}

function isClosedWon(stage) {
  const s = String(stage || '').toLowerCase();
  return s === 'closedwon' || s === 'closed_won' || s === '1489166' || s.includes('closed won');
}

async function upsertPendingDeal(payload, rawPayload = {}) {
  if (!payload.dealId) throw new Error('dealId is required');
  if (!payload.clientName) throw new Error('clientName is required');
  const doc = await PendingHubspotDeal.findOneAndUpdate(
    { dealId: payload.dealId },
    {
      $set: {
        ...payload,
        goLiveDate: payload.goLiveDate ? new Date(payload.goLiveDate) : null,
        rawPayload,
        status: 'Pending',
        rejectedReason: '',
        rejectedAt: null,
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  );
  return doc;
}

async function listPendingDeals() {
  const converted = await getConvertedDealIds();
  const rows = await PendingHubspotDeal.find({ status: 'Pending' }).sort({ updatedAt: -1 }).lean();
  return rows
    .filter((d) => !converted.has(String(d.dealId)))
    .map((d) => ({
      _id: d._id,
      dealId: d.dealId,
      dealName: d.dealName,
      clientName: d.clientName,
      goLiveDate: d.goLiveDate,
      contractValue: d.contractValue,
      notionalARR: d.notionalARR,
      implementationScope: d.implementationScope,
      scopedModules: d.scopedModules || [],
      accountOwner: d.accountOwner,
      dealStage: d.dealStage,
      status: d.status,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    }));
}

// Mock deal data structure aligned with a typical HubSpot deal → webhook payload
const mockDeals = [
  {
    dealId: 'HS-001',
    clientName: 'Acme Corporation',
    goLiveDate: '2025-09-01',
    contractValue: 1500000,
    notionalARR: 450000,
    scopedModules: ['Core HR', 'Payroll', 'Recruitment'],
    accountOwner: 'sales@darwinbox.com',
    dealStage: 'committed',
  },
  {
    dealId: 'HS-002',
    clientName: 'Globex Industries',
    goLiveDate: '2025-11-15',
    contractValue: 890000,
    notionalARR: 267000,
    scopedModules: ['Time & Attendance', 'Leave', 'Core HR'],
    accountOwner: 'sales@darwinbox.com',
    dealStage: 'committed',
  },
  {
    dealId: 'HS-003',
    clientName: 'Initech APAC',
    goLiveDate: '2026-01-10',
    contractValue: 2100000,
    notionalARR: 630000,
    scopedModules: ['Payroll', 'Benefits', 'Onboarding', 'Analytics'],
    accountOwner: 'enterprise@darwinbox.com',
    dealStage: 'committed',
  },
];

/**
 * Deal IDs that already have a UDIP project (mirrors “synced to CRM” in prod).
 */
async function getConvertedDealIds() {
  const ids = await Project.distinct('hubspotDealId', {
    hubspotDealId: { $nin: [null, ''] },
  });
  return new Set(ids.map(String));
}

/**
 * Mock deals not yet represented as a project in UDIP.
 */
async function getPendingDeals() {
  const realPending = await listPendingDeals();
  const converted = await getConvertedDealIds();
  const nonPending = await PendingHubspotDeal.distinct('dealId', { status: { $ne: 'Pending' } });
  const hidden = new Set(nonPending.map(String));
  const mockPending = mockDeals.filter((d) => !converted.has(d.dealId) && !hidden.has(d.dealId));
  return [...realPending, ...mockPending];
}

function getMockDeals() {
  return mockDeals;
}

function findMockDealById(dealId) {
  return mockDeals.find((d) => d.dealId === dealId) || null;
}

module.exports = {
  mockDeals,
  getMockDeals,
  getPendingDeals,
  findMockDealById,
  getConvertedDealIds,
  getDeal,
  getCompanyFromDeal,
  getOwner,
  normalizeDealPayload,
  isClosedWon,
  upsertPendingDeal,
  listPendingDeals,
};
