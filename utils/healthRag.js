/** Delivery health bands for API fields (no chromatic names in values). */
const ON_TRACK = 'on_track';
const CAUTION = 'caution';
const AT_RISK = 'at_risk';

const LABELS = {
  [ON_TRACK]: 'On track',
  [CAUTION]: 'Needs attention',
  [AT_RISK]: 'At risk',
};

function label(value) {
  if (value == null) return '—';
  return LABELS[value] || String(value);
}

module.exports = { ON_TRACK, CAUTION, AT_RISK, LABELS, label };
