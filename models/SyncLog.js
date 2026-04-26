const mongoose = require('mongoose');

const syncLogSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      default: null,
    },
    syncType: {
      type: String,
      enum: ['timesheets', 'leave', 'cost_rates'],
      required: true,
    },
    status: {
      type: String,
      enum: ['success', 'failed', 'partial'],
      required: true,
    },
    recordsProcessed: { type: Number, default: 0 },
    recordsFailed: { type: Number, default: 0 },
    errorMessage: { type: String, default: '' },
    syncedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

syncLogSchema.index({ syncedAt: -1 });
syncLogSchema.index({ projectId: 1, syncedAt: -1 });

module.exports = mongoose.model('SyncLog', syncLogSchema);
