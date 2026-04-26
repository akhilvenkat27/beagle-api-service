const mongoose = require('mongoose');

const sentimentHistorySchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    sentiment: { type: String, required: true, trim: true },
    sentimentScore: { type: Number, required: true, min: 0, max: 100 },
    keySignals: [{ type: String, trim: true }],
    silenceRisk: { type: Boolean, default: false },
    recommendation: { type: String, default: '', trim: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

sentimentHistorySchema.index({ projectId: 1, createdAt: -1 });

module.exports = mongoose.model('SentimentHistory', sentimentHistorySchema);
