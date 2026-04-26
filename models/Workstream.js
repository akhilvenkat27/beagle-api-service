const mongoose = require('mongoose');

const SIGN_OFF_STATUSES = ['Pending', 'Requested', 'Signed Off'];

const workstreamSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Workstream name is required'],
      trim: true,
    },
    moduleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Module',
      required: true,
    },
    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    /** Team members for this workstream; used to scope “my tasks” / module views for `member` role. */
    memberIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    signOffStatus: {
      type: String,
      enum: SIGN_OFF_STATUSES,
      default: 'Pending',
    },
    signOffRequestedAt: { type: Date, default: null },
    signOffCompletedAt: { type: Date, default: null },
    signOffNotes: { type: String, trim: true, default: '' },
    baselinePlannedStartDate: { type: Date, default: null },
    baselinePlannedEndDate: { type: Date, default: null },
    actualStartDate: { type: Date, default: null },
    actualEndDate: { type: Date, default: null },
    budgetHours: {
      type: Number,
      default: 0,
      min: 0,
    },
    /** Average INR/hr for this workstream’s team (used with budgetHours for budget value). */
    costRate: {
      type: Number,
      default: 0,
      min: 0,
    },
    /** Manual / workflow flag: matrix shows this workstream as Blocked (when not already At Risk for overdue volume). */
    isBlocked: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

const Workstream = mongoose.model('Workstream', workstreamSchema);
Workstream.SIGN_OFF_STATUSES = SIGN_OFF_STATUSES;
module.exports = Workstream;
