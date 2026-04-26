const mongoose = require('mongoose');

const SESSION_STATUS = ['Upcoming', 'Completed', 'Missed'];

const checklistItemSchema = new mongoose.Schema(
  {
    item: { type: String, required: true, trim: true },
    completed: { type: Boolean, default: false },
  },
  { _id: false }
);

const reviewSessionSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    scheduledDate: { type: Date, required: true, index: true },
    status: {
      type: String,
      enum: SESSION_STATUS,
      default: 'Upcoming',
      index: true,
    },
    checklist: [checklistItemSchema],
    completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    completedAt: { type: Date, default: null },
    notes: { type: String, default: '', trim: true },
  },
  { timestamps: true }
);

reviewSessionSchema.index({ projectId: 1, scheduledDate: -1 });

const ReviewSession = mongoose.model('ReviewSession', reviewSessionSchema);
ReviewSession.SESSION_STATUS = SESSION_STATUS;
module.exports = ReviewSession;
