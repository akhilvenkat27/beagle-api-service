/**
 * Manual request-body validation (no external schema library).
 * Respond with { errors: string[] } on failure.
 */

const mongoose = require('mongoose');
const Project = require('../models/Project');

const sendErrors = (res, errors) => res.status(400).json({ errors });

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const parseDate = (v) => {
  if (v == null || v === '') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const VALID_PROJECT_STATUS = ['Draft', 'Active', 'Completed'];
const VALID_MODULE_STATUS = ['Not Started', 'In Progress', 'Completed'];
const VALID_TASK_STATUS = ['Not Started', 'In Progress', 'Done'];
const USER_ROLES = ['admin', 'member', 'client', 'dh', 'pm', 'exec', 'pmo'];

/** POST /api/projects */
const validateProjectCreate = (req, res, next) => {
  const b = req.body || {};
  const errors = [];
  if (!isNonEmptyString(b.name) || b.name.trim().length < 2) errors.push('name must be at least 2 characters');
  if (!isNonEmptyString(b.clientName)) errors.push('clientName is required');
  const gl = parseDate(b.goLiveDate);
  if (!gl) errors.push('goLiveDate is invalid or missing');
  if (b.contractValue == null || b.contractValue === '' || Number(b.contractValue) < 0) {
    errors.push('contractValue must be a non-negative number');
  }
  if (b.status != null && b.status !== '' && !VALID_PROJECT_STATUS.includes(b.status)) {
    errors.push(`status must be one of: ${VALID_PROJECT_STATUS.join(', ')}`);
  }
  if (b.notionalARR != null && b.notionalARR !== '' && Number(b.notionalARR) < 0) {
    errors.push('notionalARR must be non-negative');
  }
  if (b.implementationFee != null && b.implementationFee !== '' && Number(b.implementationFee) < 0) {
    errors.push('implementationFee must be non-negative');
  }
  if (
    b.deliveryPhase != null &&
    b.deliveryPhase !== '' &&
    !Project.DELIVERY_PHASES.includes(b.deliveryPhase)
  ) {
    errors.push(`deliveryPhase must be one of: ${Project.DELIVERY_PHASES.join(', ')}`);
  }
  if (errors.length) return sendErrors(res, errors);
  next();
};

/** PUT /api/projects/:id — partial update */
const validateProjectUpdate = (req, res, next) => {
  const b = req.body || {};
  const errors = [];
  if ('name' in b && (!isNonEmptyString(b.name) || b.name.trim().length < 2)) {
    errors.push('name must be at least 2 characters when provided');
  }
  if ('clientName' in b && !isNonEmptyString(b.clientName)) errors.push('clientName cannot be empty when provided');
  if ('goLiveDate' in b && b.goLiveDate != null && b.goLiveDate !== '' && !parseDate(b.goLiveDate)) {
    errors.push('goLiveDate is invalid');
  }
  if ('contractValue' in b && b.contractValue != null && b.contractValue !== '' && Number(b.contractValue) < 0) {
    errors.push('contractValue must be non-negative');
  }
  if ('status' in b && b.status != null && b.status !== '' && !VALID_PROJECT_STATUS.includes(b.status)) {
    errors.push(`status must be one of: ${VALID_PROJECT_STATUS.join(', ')}`);
  }
  if (
    'deliveryPhase' in b &&
    b.deliveryPhase != null &&
    b.deliveryPhase !== '' &&
    !Project.DELIVERY_PHASES.includes(b.deliveryPhase)
  ) {
    errors.push(`deliveryPhase must be one of: ${Project.DELIVERY_PHASES.join(', ')}`);
  }
  if (errors.length) return sendErrors(res, errors);
  next();
};

/** POST /api/project-templates/:templateId/instantiate */
const validateProjectTemplateInstantiate = (req, res, next) => {
  const b = req.body || {};
  const errors = [];
  if (!isNonEmptyString(b.name) || b.name.trim().length < 2) errors.push('name must be at least 2 characters');
  if (!isNonEmptyString(b.clientName)) errors.push('clientName is required');
  const gl = parseDate(b.goLiveDate);
  if (!gl) errors.push('goLiveDate is invalid or missing');
  if (b.contractValue == null || b.contractValue === '' || Number(b.contractValue) < 0) {
    errors.push('contractValue must be a non-negative number');
  }
  if (b.notionalARR != null && b.notionalARR !== '' && Number(b.notionalARR) < 0) {
    errors.push('notionalARR must be non-negative');
  }
  if (b.implementationFee != null && b.implementationFee !== '' && Number(b.implementationFee) < 0) {
    errors.push('implementationFee must be non-negative');
  }
  if (
    b.deliveryPhase != null &&
    b.deliveryPhase !== '' &&
    !Project.DELIVERY_PHASES.includes(b.deliveryPhase)
  ) {
    errors.push(`deliveryPhase must be one of: ${Project.DELIVERY_PHASES.join(', ')}`);
  }
  if (errors.length) return sendErrors(res, errors);
  next();
};

/** POST /api/projects/:id/clone */
const validateProjectClone = (req, res, next) => {
  const b = req.body || {};
  const errors = [];
  if (!isNonEmptyString(b.name) || b.name.trim().length < 2) errors.push('name is required (min 2 chars) for clone');
  if (!isNonEmptyString(b.clientName)) errors.push('clientName is required for clone');
  if (!parseDate(b.goLiveDate)) errors.push('goLiveDate is required and must be valid for clone');
  if (b.contractValue == null || b.contractValue === '' || Number(b.contractValue) < 0) {
    errors.push('contractValue is required (non-negative) for clone');
  }
  if (errors.length) return sendErrors(res, errors);
  next();
};

/** POST /api/modules */
const validateModuleCreate = (req, res, next) => {
  const b = req.body || {};
  const errors = [];
  if (!isNonEmptyString(b.name) || b.name.trim().length < 2) errors.push('name must be at least 2 characters');
  if (!b.projectId || !mongoose.Types.ObjectId.isValid(String(b.projectId))) {
    errors.push('projectId must be a valid Mongo ObjectId');
  }
  if (b.budgetHours == null || b.budgetHours === '' || Number(b.budgetHours) < 0) {
    errors.push('budgetHours must be a non-negative number');
  }
  if (errors.length) return sendErrors(res, errors);
  next();
};

/** PUT /api/modules/:id */
const validateModuleUpdate = (req, res, next) => {
  const b = req.body || {};
  const errors = [];
  if ('name' in b && (!isNonEmptyString(b.name) || b.name.trim().length < 2)) {
    errors.push('name must be at least 2 characters when provided');
  }
  if ('budgetHours' in b && b.budgetHours != null && b.budgetHours !== '' && Number(b.budgetHours) < 0) {
    errors.push('budgetHours must be non-negative');
  }
  if ('status' in b && b.status != null && b.status !== '' && !VALID_MODULE_STATUS.includes(b.status)) {
    errors.push(`status must be one of: ${VALID_MODULE_STATUS.join(', ')}`);
  }
  if (errors.length) return sendErrors(res, errors);
  next();
};

/** POST /api/modules/:id/dependencies */
const validateModuleDependencies = (req, res, next) => {
  const raw = req.body?.dependsOnModuleIds ?? req.body?.moduleIds;
  const errors = [];
  if (!Array.isArray(raw)) errors.push('dependsOnModuleIds must be an array');
  if (errors.length) return sendErrors(res, errors);
  next();
};

/** POST /api/workstreams */
const validateWorkstreamCreate = (req, res, next) => {
  const b = req.body || {};
  const errors = [];
  if (!isNonEmptyString(b.name) || b.name.trim().length < 2) errors.push('name must be at least 2 characters');
  if (!b.moduleId || !mongoose.Types.ObjectId.isValid(String(b.moduleId))) {
    errors.push('moduleId must be a valid Mongo ObjectId');
  }
  if ('budgetHours' in b && b.budgetHours != null && b.budgetHours !== '' && Number(b.budgetHours) < 0) {
    errors.push('budgetHours must be non-negative');
  }
  if ('costRate' in b && b.costRate != null && b.costRate !== '' && Number(b.costRate) < 0) {
    errors.push('costRate must be non-negative');
  }
  if (!b.leadId || !mongoose.Types.ObjectId.isValid(String(b.leadId))) {
    errors.push('leadId is required and must be a valid Mongo ObjectId');
  }
  if (
    'memberIds' in b &&
    b.memberIds != null &&
    b.memberIds !== '' &&
    !Array.isArray(b.memberIds)
  ) {
    errors.push('memberIds must be an array of user ids when provided');
  } else if (Array.isArray(b.memberIds) && b.memberIds.some((id) => !mongoose.Types.ObjectId.isValid(String(id)))) {
    errors.push('each memberIds entry must be a valid Mongo ObjectId');
  }
  if (errors.length) return sendErrors(res, errors);
  next();
};

/** PUT /api/workstreams/:id */
const validateWorkstreamUpdate = (req, res, next) => {
  const b = req.body || {};
  const errors = [];
  if ('name' in b && b.name != null && String(b.name).trim().length < 2) {
    errors.push('name must be at least 2 characters when provided');
  }
  if ('budgetHours' in b && b.budgetHours != null && b.budgetHours !== '' && Number(b.budgetHours) < 0) {
    errors.push('budgetHours must be non-negative');
  }
  if ('costRate' in b && b.costRate != null && b.costRate !== '' && Number(b.costRate) < 0) {
    errors.push('costRate must be non-negative');
  }
  if (
    'leadId' in b &&
    b.leadId != null &&
    b.leadId !== '' &&
    !mongoose.Types.ObjectId.isValid(String(b.leadId))
  ) {
    errors.push('leadId must be a valid Mongo ObjectId when provided');
  }
  if (
    'memberIds' in b &&
    b.memberIds != null &&
    b.memberIds !== '' &&
    !Array.isArray(b.memberIds)
  ) {
    errors.push('memberIds must be an array of user ids when provided');
  } else if (Array.isArray(b.memberIds) && b.memberIds.some((id) => !mongoose.Types.ObjectId.isValid(String(id)))) {
    errors.push('each memberIds entry must be a valid Mongo ObjectId');
  }
  if (errors.length) return sendErrors(res, errors);
  next();
};

/** POST /api/tasks */
const validateTaskCreate = (req, res, next) => {
  const b = req.body || {};
  const errors = [];
  if (!isNonEmptyString(b.title) || b.title.trim().length < 2) errors.push('title must be at least 2 characters');
  if (!isNonEmptyString(b.owner)) errors.push('owner is required');
  if (!b.workstreamId || !mongoose.Types.ObjectId.isValid(String(b.workstreamId))) {
    errors.push('workstreamId must be a valid Mongo ObjectId');
  }
  if (!parseDate(b.dueDate)) errors.push('dueDate is invalid or missing');
  if (b.parentTaskId != null && b.parentTaskId !== '' && !mongoose.Types.ObjectId.isValid(String(b.parentTaskId))) {
    errors.push('parentTaskId must be a valid Mongo ObjectId when provided');
  }
  if ('status' in b && b.status != null && b.status !== '' && !VALID_TASK_STATUS.includes(b.status)) {
    errors.push(`status must be one of: ${VALID_TASK_STATUS.join(', ')}`);
  }
  if ('loggedHours' in b && b.loggedHours != null && b.loggedHours !== '' && Number(b.loggedHours) < 0) {
    errors.push('loggedHours must be non-negative');
  }
  if ('assignedTo' in b && b.assignedTo && !mongoose.Types.ObjectId.isValid(String(b.assignedTo))) {
    errors.push('assignedTo must be a valid Mongo ObjectId when provided');
  }
  if (errors.length) return sendErrors(res, errors);
  next();
};

/** PUT /api/tasks/:id */
const validateTaskUpdate = (req, res, next) => {
  const b = req.body || {};
  const errors = [];
  if ('title' in b && b.title != null && String(b.title).trim().length < 2) {
    errors.push('title must be at least 2 characters when provided');
  }
  if ('dueDate' in b && b.dueDate != null && b.dueDate !== '' && !parseDate(b.dueDate)) {
    errors.push('dueDate is invalid');
  }
  if ('status' in b && b.status != null && b.status !== '' && !VALID_TASK_STATUS.includes(b.status)) {
    errors.push(`status must be one of: ${VALID_TASK_STATUS.join(', ')}`);
  }
  if ('loggedHours' in b && b.loggedHours != null && b.loggedHours !== '' && Number(b.loggedHours) < 0) {
    errors.push('loggedHours must be non-negative');
  }
  if ('assignedTo' in b && b.assignedTo && !mongoose.Types.ObjectId.isValid(String(b.assignedTo))) {
    errors.push('assignedTo must be a valid Mongo ObjectId when provided');
  }
  if (
    'parentTaskId' in b &&
    b.parentTaskId != null &&
    b.parentTaskId !== '' &&
    !mongoose.Types.ObjectId.isValid(String(b.parentTaskId))
  ) {
    errors.push('parentTaskId must be a valid Mongo ObjectId when provided');
  }
  if (errors.length) return sendErrors(res, errors);
  next();
};

/** PATCH /api/tasks/:id/log-hours */
const validateLogHours = (req, res, next) => {
  const b = req.body || {};
  const errors = [];
  if (typeof b.hours !== 'number' || !Number.isFinite(b.hours) || b.hours < 0) {
    errors.push('hours must be a non-negative number');
  }
  if (errors.length) return sendErrors(res, errors);
  next();
};

/** PATCH /api/tasks/bulk */
const validateBulkTasks = (req, res, next) => {
  const { taskIds, operation } = req.body || {};
  const errors = [];
  if (!Array.isArray(taskIds) || taskIds.length === 0) errors.push('taskIds must be a non-empty array');
  else if (taskIds.some((id) => !mongoose.Types.ObjectId.isValid(String(id)))) {
    errors.push('each taskIds entry must be a valid Mongo ObjectId');
  }
  const ops = ['assign', 'date-shift', 'status'];
  if (!operation || !ops.includes(operation)) {
    errors.push(`operation must be one of: ${ops.join(', ')}`);
  }
  if (errors.length) return sendErrors(res, errors);
  next();
};

/** POST /api/users */
const validateUserCreate = (req, res, next) => {
  const b = req.body || {};
  const errors = [];
  if (!isNonEmptyString(b.name) || b.name.trim().length < 2) errors.push('name must be at least 2 characters');
  if (!isNonEmptyString(b.email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email.trim())) {
    errors.push('email must be a valid address');
  }
  if (!isNonEmptyString(b.password) || String(b.password).length < 6) {
    errors.push('password must be at least 6 characters');
  }
  if (b.role != null && b.role !== '' && !USER_ROLES.includes(b.role)) {
    errors.push(`role must be one of: ${USER_ROLES.join(', ')}`);
  }
  if (errors.length) return sendErrors(res, errors);
  next();
};

/** PUT /api/users/:id */
const validateUserUpdate = (req, res, next) => {
  const b = req.body || {};
  const errors = [];
  if ('name' in b && b.name != null && String(b.name).trim().length < 2) {
    errors.push('name must be at least 2 characters when provided');
  }
  if ('email' in b && b.email != null && b.email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.email).trim())) {
    errors.push('email is invalid');
  }
  if ('password' in b && b.password != null && b.password !== '' && String(b.password).length < 6) {
    errors.push('password must be at least 6 characters when provided');
  }
  if ('role' in b && b.role != null && b.role !== '' && !USER_ROLES.includes(b.role)) {
    errors.push(`role must be one of: ${USER_ROLES.join(', ')}`);
  }
  if ('costRatePerHour' in b && b.costRatePerHour != null && b.costRatePerHour !== '' && Number(b.costRatePerHour) < 0) {
    errors.push('costRatePerHour must be non-negative');
  }
  if (errors.length) return sendErrors(res, errors);
  next();
};

/** POST /api/auth/register */
const validateAuthRegister = validateUserCreate;

/** POST /api/auth/login */
const validateLogin = (req, res, next) => {
  const b = req.body || {};
  const errors = [];
  if (!isNonEmptyString(b.email)) errors.push('email is required');
  if (!isNonEmptyString(b.password)) errors.push('password is required');
  if (errors.length) return sendErrors(res, errors);
  next();
};

/** POST /api/cr */
const validateCrCreate = (req, res, next) => {
  const b = req.body || {};
  const errors = [];
  if (!b.projectId || !mongoose.Types.ObjectId.isValid(String(b.projectId))) {
    errors.push('projectId must be a valid Mongo ObjectId');
  }
  if (!isNonEmptyString(b.title) || b.title.trim().length < 2) errors.push('title must be at least 2 characters');
  if ('description' in b && b.description != null && typeof b.description !== 'string') {
    errors.push('description must be a string');
  }
  if (errors.length) return sendErrors(res, errors);
  next();
};

/** POST /api/cost-rates */
const validateCostRateCreate = (req, res, next) => {
  const b = req.body || {};
  const errors = [];
  if (!isNonEmptyString(b.role)) errors.push('role is required');
  if (!isNonEmptyString(b.seniority)) errors.push('seniority is required');
  if (!isNonEmptyString(b.region)) errors.push('region is required');
  if (b.ratePerHour == null || b.ratePerHour === '' || Number(b.ratePerHour) < 0) {
    errors.push('ratePerHour must be a non-negative number');
  }
  if (b.effectiveFrom != null && b.effectiveFrom !== '' && !parseDate(b.effectiveFrom)) {
    errors.push('effectiveFrom is invalid');
  }
  if (errors.length) return sendErrors(res, errors);
  next();
};

/** POST /api/cost-rates/:id/supersede */
const validateCostRateSupersede = (req, res, next) => {
  const b = req.body || {};
  const errors = [];
  if (b.ratePerHour == null || b.ratePerHour === '' || Number(b.ratePerHour) < 0) {
    errors.push('ratePerHour must be a non-negative number');
  }
  if (!parseDate(b.effectiveFrom)) errors.push('effectiveFrom is required and must be valid');
  if (errors.length) return sendErrors(res, errors);
  next();
};

/** POST /api/comments */
const validateCommentCreate = (req, res, next) => {
  const b = req.body || {};
  const errors = [];
  if (!b.taskId || !mongoose.Types.ObjectId.isValid(String(b.taskId))) {
    errors.push('taskId must be a valid Mongo ObjectId');
  }
  if (!isNonEmptyString(b.text) || b.text.trim().length < 1) errors.push('text is required');
  if (errors.length) return sendErrors(res, errors);
  next();
};

/** POST /api/reports/run */
const validateReportRun = (req, res, next) => {
  const b = req.body || {};
  const errors = [];
  if (!Array.isArray(b.fields) || b.fields.length === 0) errors.push('fields must be a non-empty array');
  if (b.filters != null && !Array.isArray(b.filters)) errors.push('filters must be an array when provided');
  if (errors.length) return sendErrors(res, errors);
  next();
};

/** POST /api/reports/save */
const validateReportSave = (req, res, next) => {
  const b = req.body || {};
  const errors = [];
  if (!isNonEmptyString(b.name) || b.name.trim().length < 2) errors.push('name must be at least 2 characters');
  if (!Array.isArray(b.fields) || b.fields.length === 0) errors.push('fields must be a non-empty array');
  if (b.filters != null && !Array.isArray(b.filters)) errors.push('filters must be an array when provided');
  if (errors.length) return sendErrors(res, errors);
  next();
};

/** POST /api/reports/:id/schedule */
const validateReportSchedule = (req, res, next) => {
  const b = req.body || {};
  const errors = [];
  if ('enabled' in b && typeof b.enabled !== 'boolean') errors.push('enabled must be boolean when provided');
  if ('frequency' in b && b.frequency != null && !['daily', 'weekly', 'monthly'].includes(b.frequency)) {
    errors.push('frequency must be daily, weekly, or monthly');
  }
  if ('recipients' in b && b.recipients != null && !Array.isArray(b.recipients)) {
    errors.push('recipients must be an array');
  }
  if (errors.length) return sendErrors(res, errors);
  next();
};

/** POST /api/intake/hubspot-webhook */
const validateHubspotWebhook = (req, res, next) => {
  const b = req.body || {};
  const errors = [];
  if (!isNonEmptyString(b.dealId)) errors.push('dealId is required');
  if (errors.length) return sendErrors(res, errors);
  next();
};

module.exports = {
  validateProjectCreate,
  validateProjectUpdate,
  validateProjectTemplateInstantiate,
  validateProjectClone,
  validateModuleCreate,
  validateModuleUpdate,
  validateModuleDependencies,
  validateWorkstreamCreate,
  validateWorkstreamUpdate,
  validateTaskCreate,
  validateTaskUpdate,
  validateLogHours,
  validateBulkTasks,
  validateUserCreate,
  validateUserUpdate,
  validateAuthRegister,
  validateLogin,
  validateCrCreate,
  validateCostRateCreate,
  validateCostRateSupersede,
  validateCommentCreate,
  validateReportRun,
  validateReportSave,
  validateReportSchedule,
  validateHubspotWebhook,
};
