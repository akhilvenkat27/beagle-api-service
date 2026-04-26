const mongoose = require('mongoose');
const ReviewSession = require('../models/ReviewSession');
const Project = require('../models/Project');

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

function assertGovernanceAccess(user) {
  return user.role === 'admin' || user.role === 'dh' || user.role === 'pm';
}

async function assertProjectGovernance(user, projectId) {
  const project = await Project.findById(projectId).select('deliveryHeadId projectManagerId name tier');
  if (!project) return { error: 'notfound' };
  if (user.role === 'admin') return { project };
  if (user.role === 'dh' && project.deliveryHeadId?.toString() === user._id.toString()) {
    return { project };
  }
  if (user.role === 'pm' && project.projectManagerId?.toString() === user._id.toString()) {
    return { project };
  }
  return { error: 'forbidden' };
}

const listReviews = async (req, res) => {
  try {
    const { projectId } = req.query;
    if (!projectId || !isValidId(projectId)) {
      return res.status(400).json({ error: 'projectId is required' });
    }
    if (!assertGovernanceAccess(req.user)) return res.status(403).json({ error: 'Access denied' });

    const { error } = await assertProjectGovernance(req.user, projectId);
    if (error === 'notfound') return res.status(404).json({ error: 'Project not found' });
    if (error) return res.status(403).json({ error: 'Access denied' });

    const rows = await ReviewSession.find({ projectId }).sort({ scheduledDate: -1 }).lean();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const completeReview = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ error: 'Invalid id' });
    if (!assertGovernanceAccess(req.user)) return res.status(403).json({ error: 'Access denied' });

    const session = await ReviewSession.findById(id);
    if (!session) return res.status(404).json({ error: 'Review session not found' });

    const { error } = await assertProjectGovernance(req.user, session.projectId.toString());
    if (error) return res.status(403).json({ error: 'Access denied' });

    const { checklist, notes } = req.body;
    if (Array.isArray(checklist)) {
      session.checklist = checklist.map((c) => ({
        item: String(c.item || '').trim() || 'Item',
        completed: !!c.completed,
      }));
    }
    if (notes !== undefined) session.notes = String(notes).trim();
    session.status = 'Completed';
    session.completedBy = req.user._id;
    session.completedAt = new Date();
    await session.save();

    res.json(session);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

module.exports = { listReviews, completeReview };
