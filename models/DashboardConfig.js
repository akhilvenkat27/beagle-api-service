const mongoose = require('mongoose');

const widgetSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ['card', 'chart', 'table', 'section'],
      required: true,
    },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    size: {
      type: String,
      enum: ['sm', 'md', 'lg', 'xl', 'full'],
      default: 'md',
    },
    source: {
      type: String,
      enum: ['projects', 'tasks', 'governance', 'finance', 'integrations', 'people', 'custom'],
      default: 'projects',
    },
    metric: { type: String, default: 'count', trim: true },
    chartType: {
      type: String,
      enum: ['bar', 'line', 'donut'],
      default: 'bar',
    },
    xAxis: { type: String, default: 'status', trim: true },
    yAxis: { type: String, default: 'count', trim: true },
    groupBy: { type: String, default: '', trim: true },
    filters: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    options: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    order: { type: Number, default: 0 },
    visible: { type: Boolean, default: true },
  },
  { _id: false }
);

const savedDashboardSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    dateRange: { type: String, default: 'last_12_months', trim: true },
    showValues: { type: Boolean, default: false },
    widgets: { type: [widgetSchema], default: [] },
    isShared: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const dashboardConfigSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role: {
      type: String,
      enum: ['admin', 'pmo', 'dh', 'pm', 'exec'],
      required: true,
      index: true,
    },
    name: { type: String, default: 'My First Dashboard', trim: true },
    dateRange: { type: String, default: 'last_12_months', trim: true },
    showValues: { type: Boolean, default: false },
    widgets: { type: [widgetSchema], default: [] },
    activeDashboardId: { type: String, default: 'default', trim: true },
    dashboards: { type: [savedDashboardSchema], default: [] },
  },
  { timestamps: true }
);

dashboardConfigSchema.index({ ownerId: 1, role: 1 }, { unique: true });

module.exports = mongoose.model('DashboardConfig', dashboardConfigSchema);
