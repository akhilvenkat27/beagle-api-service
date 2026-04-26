const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const { validateCommentCreate } = require('../middleware/validate');
const {
  getComments,
  addComment,
  deleteComment,
} = require('../controllers/commentController');

/**
 * GET /api/comments?taskId=xxx - Get comments for a task (all roles)
 */
router.get('/', auth, getComments);

/**
 * POST /api/comments - Add comment to task (all roles)
 */
router.post('/', auth, validateCommentCreate, addComment);

/**
 * DELETE /api/comments/:id - Delete comment (admin can delete any, others only own)
 */
router.delete('/:id', auth, deleteComment);

module.exports = router;
