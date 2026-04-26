const mongoose = require('mongoose');

const pendingHubspotDealSchema = new mongoose.Schema(
  {
    dealId: { type: String, required: true, unique: true, trim: true, index: true },
    dealName: { type: String, trim: true, default: '' },
    clientName: { type: String, trim: true, required: true },
    goLiveDate: { type: Date, default: null },
    contractValue: { type: Number, default: 0, min: 0 },
    notionalARR: { type: Number, default: 0, min: 0 },
    implementationScope: { type: String, trim: true, default: '' },
    scopedModules: [{ type: String, trim: true }],
    accountOwner: { type: String, trim: true, default: '' },
    dealStage: { type: String, trim: true, default: '' },
    rawPayload: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: ['Pending', 'Rejected', 'Intaken'],
      default: 'Pending',
      index: true,
    },
    rejectedReason: { type: String, trim: true, default: '' },
    rejectedAt: { type: Date, default: null },
    intakenAt: { type: Date, default: null },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PendingHubspotDeal', pendingHubspotDealSchema);
