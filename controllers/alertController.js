const mongoose = require('mongoose');
const Alert = require('../models/Alert');
const { getUserAlertProjectScope } = require('./projectController');

const listAlerts = async (req, res) => {
  try {
    const { projectId, unreadOnly } = req.query;
    const q = {};

    const scope = await getUserAlertProjectScope(req);

    if (projectId) {
      if (!mongoose.Types.ObjectId.isValid(projectId)) {
        return res.status(400).json({ message: 'Invalid projectId' });
      }
      if (scope && !scope.has(String(projectId))) {
        return res.status(403).json({ message: 'Access denied' });
      }
      q.projectId = projectId;
    } else if (scope) {
      if (scope.size === 0) {
        return res.json([]);
      }
      q.projectId = { $in: [...scope].map((s) => new mongoose.Types.ObjectId(s)) };
    }

    if (unreadOnly === 'true' || unreadOnly === '1') {
      q.isRead = false;
    }

    if (!['admin', 'pmo', 'exec'].includes(req.user.role)) {
      q.$or = [{ recipients: req.user._id }, { recipients: { $size: 0 } }];
    }

    const alerts = await Alert.find(q).sort({ createdAt: -1 }).limit(200).lean();
    res.json(alerts);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const markAlertRead = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid alert id' });
    }

    const alert = await Alert.findById(id);
    if (!alert) return res.status(404).json({ message: 'Alert not found' });

    const scope = await getUserAlertProjectScope(req);
    if (scope && !scope.has(alert.projectId.toString())) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (req.user.role !== 'admin') {
      const ok =
        !alert.recipients?.length ||
        alert.recipients.some((r) => r.toString() === req.user._id.toString());
      if (!ok) return res.status(403).json({ message: 'Not a recipient of this alert' });
    }

    alert.isRead = true;
    await alert.save();
    res.json(alert);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const acceptProjectInvite = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid alert id' });
    }

    const alert = await Alert.findById(id);
    if (!alert) return res.status(404).json({ message: 'Alert not found' });
    if (alert.type !== 'ProjectInvite') {
      return res.status(400).json({ message: 'Alert is not a project invite' });
    }
    const ok =
      req.user.role === 'admin' ||
      alert.recipients?.some((r) => r.toString() === req.user._id.toString());
    if (!ok) return res.status(403).json({ message: 'Not a recipient of this invite' });

    alert.data = { ...(alert.data || {}), status: 'accepted', acceptedAt: new Date() };
    alert.message = `${req.user.name || 'Team member'} accepted the project invite.`;
    alert.isRead = true;
    await alert.save();
    res.json(alert);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

module.exports = { listAlerts, markAlertRead, acceptProjectInvite };
