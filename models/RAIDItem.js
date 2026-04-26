const mongoose = require('mongoose');

const TYPE_VALUES = ['Risk', 'Assumption', 'Issue', 'Dependency'];
const PRIORITY_VALUES = ['High', 'Medium', 'Low'];
const STATUS_VALUES = ['Open', 'Mitigated', 'Closed'];
const SOURCE_VALUES = ['AI', 'Manual'];

const raidItemSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: TYPE_VALUES,
      required: true,
    },
    description: { type: String, required: true, trim: true },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    /** AI-suggested owner name before PM links a User */
    suggestedOwnerName: { type: String, default: '', trim: true },
    priority: {
      type: String,
      enum: PRIORITY_VALUES,
      default: 'Medium',
    },
    status: {
      type: String,
      enum: STATUS_VALUES,
      default: 'Open',
    },
    source: {
      type: String,
      enum: SOURCE_VALUES,
      default: 'Manual',
    },
    confirmedByPM: {
      type: Boolean,
      default: false,
    },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

raidItemSchema.index({ projectId: 1, createdAt: -1 });

const RAIDItem = mongoose.model('RAIDItem', raidItemSchema);
RAIDItem.TYPE_VALUES = TYPE_VALUES;
module.exports = RAIDItem;
