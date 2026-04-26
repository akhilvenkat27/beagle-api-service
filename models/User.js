const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const SENIORITY_VALUES = ['Junior', 'Mid', 'Senior', 'Lead'];

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide a name'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Please provide an email'],
      unique: true,
      lowercase: true,
      match: [
        /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/,
        'Please provide a valid email',
      ],
    },
    password: {
      type: String,
      required: [true, 'Please provide a password'],
      minlength: 6,
      select: false, // Don't return password by default
    },
    role: {
      type: String,
      enum: {
        values: ['admin', 'member', 'client', 'dh', 'pm', 'exec', 'pmo'],
        message: 'Role must be admin, pmo, dh, pm, exec, member, or client',
      },
      default: 'member',
    },
    /** Blended cost rate for margin math when this user logs hours on tasks (INR/hr default). */
    costRatePerHour: {
      type: Number,
      default: 2500,
      min: 0,
    },
    seniority: {
      type: String,
      enum: SENIORITY_VALUES,
      default: 'Mid',
    },
    weeklyCapacityHours: {
      type: Number,
      default: 40,
      min: 1,
    },
    department: {
      type: String,
      trim: true,
      default: '',
    },
    region: {
      type: String,
      trim: true,
      default: '',
    },
    // For clients: which projects they can view
    // For members: populated automatically from task assignments
    projectIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Project',
      },
    ],
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Hash password before saving
userSchema.pre('save', async function (next) {
  // Only hash if password is new or modified
  if (!this.isModified('password')) {
    return next();
  }

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare passwords
userSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
