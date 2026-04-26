const mongoose = require('mongoose');

const STATUS_VALUES = ['Draft', 'Pending Approval', 'Approved', 'Rejected'];

const changeRequestSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    scopeDescription: { type: String, default: '', trim: true },
    affectedWorkstreams: [{ type: String, trim: true }],
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: STATUS_VALUES,
      default: 'Draft',
      index: true,
    },
    impactDays: { type: Number, default: 0 },
    impactCost: { type: Number, default: 0 },
    impactMarginShift: { type: Number, default: 0 },
    aiRecommendation: { type: String, default: '', trim: true },
    dhApprovalBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    dhApprovalAt: { type: Date, default: null },
    dhRejectionReason: { type: String, default: '', trim: true },
    clientNotified: { type: Boolean, default: false },
    clientNotifiedAt: { type: Date, default: null },
    baselineVersionBefore: { type: Number, default: null },
    baselineVersionAfter: { type: Number, default: null },
  },
  { timestamps: true }
);

changeRequestSchema.index({ projectId: 1, createdAt: -1 });

const ChangeRequest = mongoose.model('ChangeRequest', changeRequestSchema);
ChangeRequest.STATUS_VALUES = STATUS_VALUES;
module.exports = ChangeRequest;
