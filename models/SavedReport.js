const mongoose = require('mongoose');

const SCHEDULE_FREQUENCIES = ['daily', 'weekly', 'monthly'];

const scheduleSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    frequency: { type: String, enum: SCHEDULE_FREQUENCIES, default: 'weekly' },
    recipients: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    lastRun: { type: Date, default: null },
    nextRun: { type: Date, default: null },
  },
  { _id: false }
);

const filterSchema = new mongoose.Schema(
  {
    field: { type: String, required: true, trim: true },
    operator: { type: String, required: true, trim: true },
    value: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const savedReportSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    fields: [{ type: String, trim: true }],
    filters: [filterSchema],
    schedule: { type: scheduleSchema, default: () => ({}) },
    isPublic: { type: Boolean, default: false },
  },
  { timestamps: true }
);

savedReportSchema.index({ createdBy: 1, createdAt: -1 });

const SavedReport = mongoose.model('SavedReport', savedReportSchema);
SavedReport.SCHEDULE_FREQUENCIES = SCHEDULE_FREQUENCIES;
module.exports = SavedReport;
