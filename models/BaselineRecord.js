const mongoose = require('mongoose');

/**
 * Immutable financial baseline snapshot when a project first becomes Active.
 * Version increments when a Change Request flow updates the baseline (future work).
 */
const baselineRecordSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    contractValue: {
      type: Number,
      required: true,
    },
    notionalARR: {
      type: Number,
      required: true,
    },
    lockedAt: {
      type: Date,
      default: Date.now,
    },
    lockedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    version: {
      type: Number,
      default: 1,
      min: 1,
    },
  },
  { timestamps: true }
);

baselineRecordSchema.index({ projectId: 1, version: -1 });

module.exports = mongoose.model('BaselineRecord', baselineRecordSchema);
