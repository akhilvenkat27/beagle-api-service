const mongoose = require('mongoose');
const CostRate = require('../models/CostRate');

const listCostRates = async (req, res) => {
  try {
    const { includeExpired } = req.query;
    const q = {};
    if (includeExpired !== 'true') {
      q.$or = [{ effectiveTo: null }, { effectiveTo: { $exists: false } }];
    }
    const rows = await CostRate.find(q).sort({ region: 1, role: 1, effectiveFrom: -1 }).lean();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const createCostRate = async (req, res) => {
  try {
    const body = { ...req.body, createdBy: req.user._id };
    if (!body.effectiveFrom) body.effectiveFrom = new Date();
    const row = await CostRate.create(body);
    res.status(201).json(row);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

/**
 * Close out the current row and create a new active rate from effectiveFrom.
 */
const supersedeCostRate = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid id' });
    }

    const prev = await CostRate.findById(id);
    if (!prev) return res.status(404).json({ message: 'Cost rate not found' });

    const { ratePerHour, effectiveFrom, currency, role, seniority, region } = req.body;
    if (ratePerHour == null || !effectiveFrom) {
      return res.status(400).json({ message: 'ratePerHour and effectiveFrom are required' });
    }

    const fromDate = new Date(effectiveFrom);
    prev.effectiveTo = new Date(fromDate.getTime() - 1);
    await prev.save();

    const next = await CostRate.create({
      role: role || prev.role,
      seniority: seniority || prev.seniority,
      region: region || prev.region,
      ratePerHour: Number(ratePerHour),
      currency: currency || prev.currency || 'INR',
      effectiveFrom: fromDate,
      effectiveTo: null,
      createdBy: req.user._id,
    });

    res.status(201).json({ previous: prev, current: next });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

module.exports = { listCostRates, createCostRate, supersedeCostRate };
