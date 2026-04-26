const mongoose = require('mongoose');

const ENTITY_TYPES = ['Project', 'Module', 'Workstream', 'Task', 'CR', 'User'];

const auditLogSchema = new mongoose.Schema(
  {
    entityType: {
      type: String,
      enum: ENTITY_TYPES,
      required: true,
      index: true,
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    action: {
      type: String,
      required: true,
      trim: true,
    },
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    actorName: {
      type: String,
      default: '',
      trim: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      default: null,
      index: true,
    },
  },
  { timestamps: false }
);

auditLogSchema.index({ projectId: 1, timestamp: -1 });

const AuditLog = mongoose.model('AuditLog', auditLogSchema);
AuditLog.ENTITY_TYPES = ENTITY_TYPES;
module.exports = AuditLog;
