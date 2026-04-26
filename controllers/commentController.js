const mongoose = require('mongoose');
const Comment = require('../models/Comment');
const Task = require('../models/Task');
const Workstream = require('../models/Workstream');
const Module = require('../models/Module');

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

/**
 * Get comments for a task
 * GET /api/comments?taskId=xxx (all roles)
 */
exports.getComments = async (req, res) => {
  try {
    const { taskId } = req.query;

    if (!taskId || !isValidId(taskId)) {
      return res.status(400).json({
        success: false,
        message: 'Valid taskId query parameter is required',
      });
    }

    // Verify task exists
    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found',
      });
    }

    // Check permissions for clients
    if (req.user.role === 'client') {
      // Verify the task belongs to one of the client's assigned projects
      // Task → Workstream → Module → Project
      const workstream = await Workstream.findById(task.workstreamId);
      if (!workstream) {
        return res.status(403).json({ success: false, message: 'Not authorized to view these comments' });
      }
      const module = await Module.findById(workstream.moduleId);
      if (!module) {
        return res.status(403).json({ success: false, message: 'Not authorized to view these comments' });
      }
      const assignedProjectIds = (req.user.projectIds || []).map((id) => id.toString());
      if (!assignedProjectIds.includes(module.projectId.toString())) {
        return res.status(403).json({ success: false, message: 'Not authorized to view these comments' });
      }
    }

    const comments = await Comment.find({ taskId })
      .populate('userId', 'name email')
      .sort({ createdAt: -1 });

    // Return array directly for consistency with frontend expectations
    res.status(200).json(comments);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Add comment to task
 * POST /api/comments (all roles)
 */
exports.addComment = async (req, res) => {
  try {
    const { taskId, text } = req.body;

    if (!taskId || !isValidId(taskId) || !text) {
      return res.status(400).json({
        success: false,
        message: 'Valid taskId and text are required',
      });
    }

    // Verify task exists
    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found',
      });
    }

    if (req.user.role === 'client') {
      const workstream = await Workstream.findById(task.workstreamId);
      if (!workstream) {
        return res.status(403).json({ success: false, message: 'Not authorized to comment on this task' });
      }
      const module = await Module.findById(workstream.moduleId);
      if (!module) {
        return res.status(403).json({ success: false, message: 'Not authorized to comment on this task' });
      }
      const assignedProjectIds = (req.user.projectIds || []).map((id) => id.toString());
      if (!assignedProjectIds.includes(module.projectId.toString())) {
        return res.status(403).json({ success: false, message: 'Not authorized to comment on this task' });
      }
    }

    // Create comment
    let comment = await Comment.create({
      taskId,
      userId: req.user._id,
      text,
    });

    comment = await comment.populate('userId', 'name email');

    // Fetch and return all comments for the task (for consistency with GET endpoint)
    const allComments = await Comment.find({ taskId })
      .populate('userId', 'name email')
      .sort({ createdAt: -1 });

    res.status(201).json(allComments);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Delete comment
 * DELETE /api/comments/:id (admin can delete any, others only own)
 */
exports.deleteComment = async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.id);

    if (!comment) {
      return res.status(404).json({
        success: false,
        message: 'Comment not found',
      });
    }

    // Check ownership: admin can delete any, others only their own
    if (req.user.role !== 'admin' && comment.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this comment',
      });
    }

    await Comment.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: 'Comment deleted successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
