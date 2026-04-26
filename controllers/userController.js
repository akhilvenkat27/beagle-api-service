const User = require('../models/User');

/**
 * Create new user (admin only)
 * POST /api/users
 */
exports.createUser = async (req, res) => {
  try {
    const { name, email, password, role, projectIds, costRatePerHour, seniority } = req.body;

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
      ...(costRatePerHour != null ? { costRatePerHour: Number(costRatePerHour) } : {}),
      ...(seniority ? { seniority } : {}),
    });

    user = await user.populate('projectIds', 'name');

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      user,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Get all users (admin only)
 * GET /api/users
 */
exports.getAllUsers = async (req, res) => {
  try {
    const filter = {};
    if (req.query.role) {
      filter.role = req.query.role;
    }
    const users = await User.find(filter)
      .select('_id name email role costRatePerHour seniority')
      .populate('projectIds', 'name')
      .sort({ name: 1 });

    // Return array directly for consistency with frontend expectations
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Get single user (admin only)
 * GET /api/users/:id
 */
exports.getUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).populate('projectIds', 'name');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Update user (admin only)
 * PUT /api/users/:id
 */
exports.updateUser = async (req, res) => {
  try {
    const { name, role, projectIds, costRatePerHour, seniority } = req.body;

    let user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Update fields
    if (name) user.name = name;
    if (role) user.role = role;
    if (projectIds) user.projectIds = projectIds;
    if (costRatePerHour != null) user.costRatePerHour = Number(costRatePerHour);
    if (seniority) user.seniority = seniority;

    user = await user.save();
    user = await user.populate('projectIds', 'name');

    res.status(200).json({
      success: true,
      message: 'User updated successfully',
      user,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Delete user (admin only)
 * DELETE /api/users/:id
 */
exports.deleteUser = async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    res.status(200).json({
      success: true,
      message: 'User deleted successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Get all clients (admin only)
 * GET /api/users/clients
 */
exports.getClients = async (req, res) => {
  try {
    const clients = await User.find({ role: 'client' })
      .select('_id name email projectIds')
      .sort({ name: 1 });
    res.json(clients);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
