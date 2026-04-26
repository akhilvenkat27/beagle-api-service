const mongoose = require('mongoose');
const AuditLog = require('../models/AuditLog');

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

function csvEscape(val) {
  if (val == null) return '';
  const s = typeof val === 'object' ? JSON.stringify(val) : String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// GET /api/audit?projectId=xxx (optional; if omitted returns global recent audit)
const getAuditByProject = async (req, res) => {
  try {
    const { projectId } = req.query;
    if (projectId && !isValidId(projectId)) {
      return res.status(400).json({ message: 'projectId query param must be a valid id' });
    }
    const filter = projectId ? { projectId } : {};

    const logs = await AuditLog.find(filter)
      .sort({ timestamp: -1 })
      .limit(500)
      .lean();

    res.json(logs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/audit/export?projectId=xxx (optional: export global if omitted)
const exportAuditCsv = async (req, res) => {
  try {
    const { projectId } = req.query;
    if (projectId && !isValidId(projectId)) {
      return res.status(400).json({ message: 'projectId query param must be a valid id' });
    }
    const filter = projectId ? { projectId } : {};

    const logs = await AuditLog.find(filter).sort({ timestamp: -1 }).limit(2000).lean();

    const headers = [
      'timestamp',
      'entityType',
      'entityId',
      'action',
      'actorName',
      'before',
      'after',
    ];
    const lines = [headers.join(',')];
    for (const row of logs) {
      lines.push(
        [
          csvEscape(row.timestamp?.toISOString?.() || row.timestamp),
          csvEscape(row.entityType),
          csvEscape(row.entityId),
          csvEscape(row.action),
          csvEscape(row.actorName),
          csvEscape(row.before),
          csvEscape(row.after),
        ].join(',')
      );
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${projectId ? `audit-${projectId}` : 'audit-all'}.csv"`
    );
    res.send(lines.join('\n'));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { getAuditByProject, exportAuditCsv };
