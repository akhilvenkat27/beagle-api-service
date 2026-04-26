const mongoose = require('mongoose');

const costRateSchema = new mongoose.Schema(
  {
    role: { type: String, required: true, trim: true },
    seniority: { type: String, required: true, trim: true },
    region: { type: String, required: true, trim: true },
    ratePerHour: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR', trim: true },
    effectiveFrom: { type: Date, required: true },
    effectiveTo: { type: Date, default: null },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

costRateSchema.index({ role: 1, seniority: 1, region: 1, effectiveFrom: -1 });

module.exports = mongoose.model('CostRate', costRateSchema);
