const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * JWT Authentication Middleware
 * Supports behave-as tokens: { id: originalUserId, behave: true, behavingAs: targetUserId }
 */
const auth = async (req, res, next) => {
  try {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.slice(7);
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized to access this route',
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.behave && decoded.behavingAs) {
      const target = await User.findById(decoded.behavingAs);
      if (!target) {
        return res.status(401).json({
          success: false,
          message: 'Behave-as target user not found',
        });
      }
      req.user = target;
      req.isBehavingAs = true;
      req.behaveOriginalUserId = decoded.id;
    } else {
      const user = await User.findById(decoded.id);
      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'User not found',
        });
      }
      req.user = user;
    }

    if (req.isBehavingAs && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      return res.status(403).json({
        success: false,
        message: 'Read-only mode: exit behave-as to make changes',
      });
    }

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this route',
      error: error.message,
    });
  }
};

module.exports = auth;
