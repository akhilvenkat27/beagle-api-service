const mongoose = require('mongoose');

const MODULE_STATUSES = ['Not Started', 'In Progress', 'Completed'];

const moduleSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Module name is required'],
      trim: true,
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
    },
    budgetHours: {
      type: Number,
      required: [true, 'Budget hours are required'],
      min: 0,
    },
    status: {
      type: String,
      enum: MODULE_STATUSES,
      default: 'Not Started',
    },
    /** Upstream modules that must reach status "Completed" before tasks can be created here (FR-M2-06). */
    dependsOn: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Module',
      },
    ],
  },
  { timestamps: true }
);

const Module = mongoose.model('Module', moduleSchema);
Module.MODULE_STATUSES = MODULE_STATUSES;
module.exports = Module;
