const mongoose = require('mongoose');
const User = require('../models/User');
const Project = require('../models/Project');
const ResourceAllocation = require('../models/ResourceAllocation');
const { assertUserCanViewProject, getMemberAccessibleProjectIds } = require('./projectController');

const startOfWeek = (input) => {
  const d = new Date(input);
  const day = d.getDay();
  const diff = (day + 6) % 7;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
};

const endOfWorkWeek = (start) => {
  const d = new Date(start);
  d.setDate(d.getDate() + 4);
  d.setHours(23, 59, 59, 999);
  return d;
};

const dateKeyLocal = (d) => {
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const getWeeksInRange = (start, end) => {
  const out = [];
  const cur = startOfWeek(start);
  const endWeek = startOfWeek(end);
  while (cur <= endWeek) {
    const wkStart = new Date(cur);
    out.push({
      start: wkStart,
      end: endOfWorkWeek(wkStart),
      key: dateKeyLocal(wkStart),
    });
    cur.setDate(cur.getDate() + 7);
  }
  return out;
};

const getPeople = async (req, res) => {
  try {
    const { startDate, endDate, view } = req.query;
    const start = startDate ? new Date(startDate) : startOfWeek(new Date());
    const end = endDate ? new Date(endDate) : new Date(start.getTime() + 7 * 7 * 86400000);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return res.status(400).json({ message: 'Invalid date range' });
    }
    const weeks = getWeeksInRange(start, end);
    const weekKeys = new Set(weeks.map((w) => w.key));

    const users = await User.find({ role: { $in: ['member', 'pm', 'dh', 'pmo', 'exec'] } })
      .select('name email role seniority weeklyCapacityHours department region')
      .sort({ name: 1 })
      .lean();

    const allocations = await ResourceAllocation.find({
      weekStartDate: {
        $gte: startOfWeek(start),
        $lte: startOfWeek(end),
      },
    })
      .populate('projectId', 'name')
      .lean();

    const allocByUserWeek = new Map();
    const projectsByUser = new Map();
    allocations.forEach((a) => {
      const userId = String(a.userId);
      const wk = dateKeyLocal(startOfWeek(a.weekStartDate));
      if (!weekKeys.has(wk)) return;
      const key = `${userId}:${wk}`;
      if (!allocByUserWeek.has(key)) allocByUserWeek.set(key, []);
      allocByUserWeek.get(key).push(a);

      if (!projectsByUser.has(userId)) projectsByUser.set(userId, new Map());
      const pMap = projectsByUser.get(userId);
      const pid = String(a.projectId?._id || a.projectId);
      if (!pMap.has(pid)) {
        pMap.set(pid, {
          projectId: pid,
          projectName: a.projectId?.name || 'Project',
          totalAllocatedHours: 0,
        });
      }
      pMap.get(pid).totalAllocatedHours += Number(a.allocatedHours) || 0;
    });

    let rows = users.map((u) => {
      const uid = String(u._id);
      const weeklyUtilisation = weeks.map((wk) => {
        const key = `${uid}:${wk.key}`;
        const list = allocByUserWeek.get(key) || [];
        const allocatedHours = list.reduce((sum, x) => sum + (Number(x.allocatedHours) || 0), 0);
        const cap = Number(u.weeklyCapacityHours || 40);
        const utilisationPercent = cap > 0 ? Math.round((allocatedHours / cap) * 100) : 0;
        return {
          weekStart: dateKeyLocal(wk.start),
          weekEnd: dateKeyLocal(wk.end),
          allocatedHours,
          utilisationPercent,
          projectBreakdown: list.map((x) => ({
            allocationId: x._id,
            projectId: String(x.projectId?._id || x.projectId),
            projectName: x.projectId?.name || 'Project',
            hours: Number(x.allocatedHours) || 0,
            allocationType: x.allocationType || 'Hard',
          })),
        };
      });
      return {
        userId: u._id,
        name: u.name,
        email: u.email,
        role: u.role,
        seniority: u.seniority || 'Mid',
        department: u.department || '',
        region: u.region || '',
        avatarUrl: '',
        weeklyCapacity: Number(u.weeklyCapacityHours || 40),
        projects: [...(projectsByUser.get(uid)?.values() || [])],
        weeklyUtilisation,
      };
    });

    if (view === 'active-projects') {
      rows = rows.filter((r) => r.projects.length > 0);
    }

    if (req.user.role === 'member') {
      rows = rows.filter((r) => String(r.userId) === String(req.user._id));
    }

    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const upsertAllocation = async (req, res) => {
  try {
    const { userId, projectId, weekStartDate, allocatedHours, allocationType } = req.body || {};
    if (!userId || !projectId || !weekStartDate) {
      return res.status(400).json({ message: 'userId, projectId, weekStartDate are required' });
    }
    if (!mongoose.Types.ObjectId.isValid(String(userId))) {
      return res.status(400).json({ message: 'Invalid userId' });
    }
    if (!mongoose.Types.ObjectId.isValid(String(projectId))) {
      return res.status(400).json({ message: 'Invalid projectId' });
    }
    const weekStart = startOfWeek(weekStartDate);
    if (Number.isNaN(weekStart.getTime())) {
      return res.status(400).json({ message: 'Invalid weekStartDate' });
    }
    const hours = Number(allocatedHours);
    if (Number.isNaN(hours) || hours < 0) {
      return res.status(400).json({ message: 'allocatedHours must be >= 0' });
    }
    const access = await assertUserCanViewProject(req, projectId);
    if (!access.ok) {
      return res.status(access.status).json({ message: access.message });
    }
    if (req.user.role === 'member' && String(userId) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Members can only plan their own hours' });
    }
    const weekEnd = endOfWorkWeek(weekStart);
    const allocation = await ResourceAllocation.findOneAndUpdate(
      { userId, projectId, weekStartDate: weekStart },
      {
        $set: {
          allocatedHours: hours,
          weekEndDate: weekEnd,
          allocationType: allocationType || 'Hard',
          createdBy: req.user._id,
        },
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );
    res.status(201).json(allocation);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const deleteAllocation = async (req, res) => {
  try {
    const row = await ResourceAllocation.findById(req.params.id);
    if (!row) return res.status(404).json({ message: 'Allocation not found' });
    const access = await assertUserCanViewProject(req, row.projectId);
    if (!access.ok) {
      return res.status(access.status).json({ message: access.message });
    }
    await ResourceAllocation.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const getAvailability = async (req, res) => {
  try {
    const { startDate, endDate, role, department, region } = req.query;
    const start = startDate ? new Date(startDate) : startOfWeek(new Date());
    const end = endDate ? new Date(endDate) : new Date(start.getTime() + 7 * 7 * 86400000);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return res.status(400).json({ message: 'Invalid date range' });
    }
    const weeks = getWeeksInRange(start, end);
    const userQuery = { role: { $in: ['member', 'pm', 'dh', 'pmo', 'exec'] } };
    if (role) userQuery.role = role;
    if (department) userQuery.department = department;
    if (region) userQuery.region = region;

    const users = await User.find(userQuery)
      .select('name email role weeklyCapacityHours department region')
      .lean();

    const allocations = await ResourceAllocation.find({
      weekStartDate: { $gte: startOfWeek(start), $lte: startOfWeek(end) },
      userId: { $in: users.map((u) => u._id) },
    })
      .select('userId allocatedHours')
      .lean();

    const hoursByUser = new Map();
    allocations.forEach((a) => {
      const uid = String(a.userId);
      hoursByUser.set(uid, (hoursByUser.get(uid) || 0) + (Number(a.allocatedHours) || 0));
    });

    const data = users.map((u) => {
      const cap = Number(u.weeklyCapacityHours || 40) * Math.max(1, weeks.length);
      const allocated = hoursByUser.get(String(u._id)) || 0;
      return {
        userId: u._id,
        name: u.name,
        role: u.role,
        department: u.department || '',
        region: u.region || '',
        capacityHours: cap,
        allocatedHours: allocated,
        freeHours: Math.max(0, cap - allocated),
      };
    });

    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getUtilisationSummary = async (req, res) => {
  try {
    const summary = await ResourceAllocation.aggregate([
      {
        $group: {
          _id: '$projectId',
          allocatedHours: { $sum: '$allocatedHours' },
          allocations: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: 'projects',
          localField: '_id',
          foreignField: '_id',
          as: 'project',
        },
      },
      { $unwind: { path: '$project', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          projectId: '$_id',
          projectName: '$project.name',
          allocatedHours: 1,
          allocations: 1,
        },
      },
      { $sort: { allocatedHours: -1 } },
    ]);
    res.json(summary);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  getPeople,
  upsertAllocation,
  deleteAllocation,
  getAvailability,
  getUtilisationSummary,
};
