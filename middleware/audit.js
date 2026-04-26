/**
 * Audit trail helper (FR-M2-15, FR-M6-05).
 * Controllers call recordAudit() after successful mutations — keeps logging explicit
 * and avoids brittle generic wrappers around every route.
 *
 * CR lifecycle (created / approved / rejected): call recordAudit from CR controllers
 * when that module exists; no CR routes in this codebase yet.
 */

const AuditLog = require('../models/AuditLog');

async function recordAudit({
  entityType,
  entityId,
  action,
  before = null,
  after = null,
  actorId,
  actorName = '',
  projectId = null,
}) {
  try {
    await AuditLog.create({
      entityType,
      entityId,
      action,
      before,
      after,
      actorId: actorId || null,
      actorName: actorName || 'System',
      projectId: projectId || null,
      timestamp: new Date(),
    });
  } catch (err) {
    console.error('[audit] recordAudit failed:', err.message);
  }
}

/**
 * Express middleware factory: runs handler then no-op (placeholder for future
 * automatic wrapping). Prefer calling recordAudit() inside controllers.
 */
function withAudit(_actionLabel) {
  return (req, res, next) => next();
}

module.exports = { recordAudit, withAudit };
