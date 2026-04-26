const mongoose = require('mongoose');

const ALERT_TYPES = [
  'MarginAlert',
  'ResourceOverload',
  'Escalation',
  'ClientSilence',
  'GovernanceReview',
  'ProjectInvite',
  'OverdueTask3d',
  'OverdueTask5d',
  'OverdueTask7d',
];
const SEVERITIES = ['Warning', 'Critical'];

const alertSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ALERT_TYPES,
      required: true,
      index: true,
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    severity: {
      type: String,
      enum: SEVERITIES,
      default: 'Warning',
    },
    message: { type: String, required: true, trim: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    recipients: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    isRead: { type: Boolean, default: false, index: true },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false }
);

alertSchema.index({ projectId: 1, isRead: 1, createdAt: -1 });

const Alert = mongoose.model('Alert', alertSchema);
Alert.ALERT_TYPES = ALERT_TYPES;
module.exports = Alert;
