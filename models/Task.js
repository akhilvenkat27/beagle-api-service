const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Task title is required'],
      trim: true,
    },
    owner: {
      type: String,
      required: [true, 'Task owner is required'],
      trim: true,
    },
    status: {
      type: String,
      enum: ['Not Started', 'In Progress', 'Done'],
      default: 'Not Started',
    },
    dueDate: {
      type: Date,
      required: [true, 'Due date is required'],
    },
    loggedHours: {
      type: Number,
      default: 0,
      min: 0,
    },
    workstreamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workstream',
      required: true,
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    billable: {
      type: Boolean,
      default: true,
    },
    parentTaskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Task',
      default: null,
      index: true,
    },
    riskLevel: {
      type: String,
      enum: ['Normal', 'At Risk'],
      default: 'Normal',
    },
    day3WarningSent: { type: Boolean, default: false },
    day5WarningSent: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Virtual: is the task overdue?
taskSchema.virtual('isOverdue').get(function () {
  return this.status !== 'Done' && this.dueDate < new Date();
});

taskSchema.set('toJSON', { virtuals: true });
taskSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Task', taskSchema);
