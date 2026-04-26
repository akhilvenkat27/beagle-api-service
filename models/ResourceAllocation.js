const mongoose = require('mongoose');

const resourceAllocationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    weekStartDate: {
      type: Date,
      required: true,
      index: true,
    },
    weekEndDate: {
      type: Date,
      required: true,
    },
    allocatedHours: {
      type: Number,
      required: true,
      min: 0,
    },
    allocationType: {
      type: String,
      enum: ['Hard', 'Soft', 'Placeholder'],
      default: 'Hard',
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true }
);

resourceAllocationSchema.index({ userId: 1, projectId: 1, weekStartDate: 1 }, { unique: true });

module.exports = mongoose.model('ResourceAllocation', resourceAllocationSchema);
