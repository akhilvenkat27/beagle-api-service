const mongoose = require('mongoose');
const Project = require('./Project');

const TIER_VALUES = Project.TIER_VALUES;
const DELIVERY_PHASES = Project.DELIVERY_PHASES;

/**
 * Workstream blueprint inside a template's module.
 * Mirrors the "task row" in the Rocketlane-style template editor: each row has
 * a name, a description, an offset/duration relative to project start, an
 * effort budget, an owner placeholder (resolved at instantiation), and a
 * billable flag.
 *
 * All extension fields are optional — older templates that only stored
 * `{ name }` continue to load and round-trip unchanged.
 */
const templateWorkstreamSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    /** Days from project start when this workstream begins. */
    startOffsetDays: { type: Number, default: 0, min: 0 },
    /** Duration in days. */
    durationDays: { type: Number, default: 1, min: 0 },
    /** Effort/budget hours allocated to this workstream. */
    budgetHours: { type: Number, default: 0, min: 0 },
    /**
     * Free-form placeholder describing who should own this when the template
     * is instantiated (e.g. "Project Manager", "Module Lead", "Functional
     * Consultant"). This becomes a hint to the PM during project creation —
     * the actual `leadId` is bound to a real user later.
     */
    ownerPlaceholder: { type: String, default: 'Project Manager', trim: true },
    /**
     * Optional binding to a real user. When present, the instantiator pre-fills
     * `assignedTo` on materialized tasks. Falsy means "use the placeholder
     * string only" — typical for reusable templates that aren't tied to a
     * specific person.
     */
    ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    /** Billable for margin/cost-split calculations once a project is live. */
    billable: { type: Boolean, default: true },
    /** Optional automation hooks (e.g. "Email customer when complete"). */
    automations: { type: [String], default: [] },
    /** Optional milestone events surfaced in stage-gate views. */
    keyEvents: { type: [String], default: [] },
  },
  { _id: false }
);

const moduleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    budgetHours: { type: Number, default: 240, min: 0 },
    /** Days from project start when this module/phase begins. */
    startOffsetDays: { type: Number, default: 0, min: 0 },
    /** Duration in days. */
    durationDays: { type: Number, default: 1, min: 0 },
    /** Owner placeholder (resolved at instantiation). */
    ownerPlaceholder: { type: String, default: 'Project Manager', trim: true },
    /** Optional binding to a real user (mirrors the workstream-level field). */
    ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    /** Optional automation hooks for this phase. */
    automations: { type: [String], default: [] },
    /** Optional key events / milestones. */
    keyEvents: { type: [String], default: [] },
    /**
     * Explicit workstream blueprints. When provided, these win over
     * `phaseCount`; the auto-phase fallback only applies when this list is
     * empty.
     */
    workstreams: {
      type: [templateWorkstreamSchema],
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
