const mongoose = require('mongoose');

const TIER_VALUES = ['Tier 1', 'Tier 2', 'Tier 3'];
const REGION_VALUES = ['India', 'SEA', 'MEA', 'Americas', 'Other'];

/** Rocketlane / PRD delivery lifecycle — single current phase per project */
const DELIVERY_PHASES = [
  'Deal Commit',
  'Sales Handover',
  'Customer Enablement',
  'Design Approval',
  'Build & Integration',
  'UAT',
  'Go-Live',
  'Closure',
];

const projectSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Project name is required'],
      trim: true,
    },
    clientName: {
      type: String,
      required: [true, 'Client name is required'],
      trim: true,
    },
    goLiveDate: {
      type: Date,
      required: [true, 'Go-live date is required'],
    },
    contractValue: {
      type: Number,
      required: [true, 'Contract value is required'],
      min: 0,
    },
    /** SOW implementation fee (currency-neutral); margin is vs this, not contractValue. */
    implementationFee: {
      type: Number,
      default: 0,
      min: 0,
    },
    notionalARR: {
      type: Number,
      default: 0,
      min: 0,
    },
    region: {
      type: String,
      enum: REGION_VALUES,
      default: 'India',
    },
    status: {
      type: String,
      enum: ['Draft', 'Active', 'Completed'],
      default: 'Draft',
    },
    clientUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    hubspotDealId: {
      type: String,
      trim: true,
      default: null,
      sparse: true,
    },
    sharePointUrl: {
      type: String,
      trim: true,
      default: '',
    },
    deliveryHeadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    projectManagerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    tier: {
      type: String,
      enum: {
        values: TIER_VALUES,
        message: `Tier must be one of: ${TIER_VALUES.join(', ')}`,
      },
      default: 'Tier 2',
    },
    deliveryPhase: {
      type: String,
      enum: {
        values: DELIVERY_PHASES,
        message: `deliveryPhase must be one of: ${DELIVERY_PHASES.join(', ')}`,
      },
      default: 'Build & Integration',
    },
    accountPlaybookUrl: {
      type: String,
      trim: true,
      default: '',
    },
    csResourceName: {
      type: String,
      trim: true,
      default: '',
    },
    /** Darwinbox mock: tags pushed at activation. */
    darwinboxTagsPushedAt: { type: Date, default: null },
    /** Last successful timesheet sync from Darwinbox mock. */
    lastSyncAt: { type: Date, default: null },
    lastSyncRecords: { type: Number, default: 0 },
    /** Client-facing narrative (Module 5): draft until PM approves. */
    clientNarrativeDraft: { type: String, default: '' },
    clientNarrativeDraftAt: { type: Date, default: null },
    clientNarrativeApprovedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

const Project = mongoose.model('Project', projectSchema);
Project.TIER_VALUES = TIER_VALUES;
Project.REGION_VALUES = REGION_VALUES;
Project.DELIVERY_PHASES = DELIVERY_PHASES;
module.exports = Project;
