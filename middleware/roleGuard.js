/**
 * Role Guard Middleware
 * Checks if the authenticated user has one of the allowed roles
 * Usage: router.post('/', auth, roleGuard('admin', 'member'), controller)
 */
const roleGuard = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Not authenticated',
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Allowed roles: ${allowedRoles.join(', ')}`,
      });
    }

    next();
  };
};

module.exports = roleGuard;
