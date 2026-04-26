const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * Generate JWT token
 */
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
};

const generateBehaveToken = (originalUserId, targetUserId) => {
  return jwt.sign(
    { id: originalUserId, behavingAs: targetUserId, behave: true },
    process.env.JWT_SECRET,
    { expiresIn: process.env.BEHAVE_AS_EXPIRES_IN || '4h' }
  );
};

/**
 * Register a new user (admin only)
 * POST /api/auth/register
 */
exports.register = async (req, res) => {
  try {
    const { name, email, password, role, projectIds } = req.body;

    // Validate required fields
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide name, email, and password',
      });
    }

    // Check if user already exists
    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({
        success: false,
        message: 'Email already in use',
      });
    }

    // Create user
    user = await User.create({
      name,
      email,
      password,
      role: role || 'member',
      projectIds: projectIds || [],
    });

    // Create token
    const token = generateToken(user._id);

    // Return user without password
    const userResponse = user.toObject();
    delete userResponse.password;

    res.status(201).json({
      success: true,
      token,
      user: userResponse,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Login user
 * POST /api/auth/login
 */
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate email and password
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password',
      });
    }

    // Check for user, explicitly select password field
    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      });
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      });
    }

    // Create token
    const token = generateToken(user._id);

    // Return user without password
    const userResponse = user.toObject();
    delete userResponse.password;

    res.status(200).json({
      success: true,
      token,
      user: userResponse,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Get current user
 * GET /api/auth/me
 */
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate('projectIds');
    const userResponse = user.toObject();
    delete userResponse.password;

    let behaveAs = null;
    if (req.isBehavingAs && req.behaveOriginalUserId) {
      const original = await User.findById(req.behaveOriginalUserId).select('name email role');
      if (original) {
        behaveAs = {
          active: true,
          originalUserId: original._id,
          originalName: original.name,
          originalEmail: original.email,
        };
      }
    }

    res.status(200).json({
      success: true,
      user: userResponse,
      behaveAs,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * PMO super-admin: issue read-only token as another user (admin only in this codebase).
 * POST /api/auth/behave-as { targetUserId }
 */
exports.behaveAs = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only administrators can use behave-as' });
    }
    const { targetUserId } = req.body;
    if (!targetUserId || typeof targetUserId !== 'string') {
      return res.status(400).json({ success: false, message: 'targetUserId is required' });
    }
    const target = await User.findById(targetUserId);
    if (!target) {
      return res.status(404).json({ success: false, message: 'Target user not found' });
    }
    if (target._id.equals(req.user._id)) {
      return res.status(400).json({ success: false, message: 'Select a different user than yourself' });
    }

    const token = generateBehaveToken(req.user._id, target._id);
    const userResponse = target.toObject();
    delete userResponse.password;

    res.status(200).json({
      success: true,
      token,
      user: userResponse,
      behaveAs: {
        active: true,
        originalUserId: req.user._id,
        originalName: req.user.name,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
