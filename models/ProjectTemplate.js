const mongoose = require('mongoose');
const Project = require('./Project');

const TIER_VALUES = Project.TIER_VALUES;
const DELIVERY_PHASES = Project.DELIVERY_PHASES;

const moduleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    budgetHours: { type: Number, default: 240, min: 0 },
    /**
     * If provided, these explicit workstream names are used (and budgetHours is split
     * evenly across them). Otherwise, phaseCount is used to auto-generate phased
     * workstreams (Inception → Hypercare).
     */
    workstreams: {
      type: [
        new mongoose.Schema(
          { name: { type: String, required: true, trim: true } },
          { _id: false }
        ),
      ],
      default: [],
    },
    /** 2-5 phased workstreams when no explicit workstreams are supplied. */
    phaseCount: { type: Number, default: 3, min: 2, max: 5 },
  },
  { _id: false }
);

const projectTemplateSchema = new mongoose.Schema(
  {
    /** URL-safe slug; stable across renames. Unique across user-created templates. */
    templateId: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    desc: { type: String, default: '', trim: true },
    durationLabel: { type: String, default: '', trim: true },
    defaultTier: {
      type: String,
      enum: TIER_VALUES,
      default: 'Tier 2',
    },
    defaultDeliveryPhase: {
      type: String,
      enum: DELIVERY_PHASES,
      default: 'Sales Handover',
    },
    modules: {
      type: [moduleSchema],
      validate: [(v) => Array.isArray(v) && v.length > 0, 'At least one module is required'],
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    createdByName: { type: String, default: '' },
  },
  { timestamps: true }
);

const ProjectTemplate = mongoose.model('ProjectTemplate', projectTemplateSchema);
ProjectTemplate.TIER_VALUES = TIER_VALUES;
ProjectTemplate.DELIVERY_PHASES = DELIVERY_PHASES;
module.exports = ProjectTemplate;
