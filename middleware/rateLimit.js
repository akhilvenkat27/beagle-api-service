/**
 * Simple sliding-window rate limiter (in-memory). Suitable for single-instance demos;
 * use Redis-backed limits in multi-instance production.
 *
 * Important for local development:
 * - Disabled by default outside production to avoid blocking reload-heavy UI flows.
 * - You can force-enable in non-prod with RATE_LIMIT_FORCE=1.
 */

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX_PER_MINUTE) || 1200;

const buckets = new Map();

function isDevLike() {
  return process.env.NODE_ENV !== 'production';
}

function isRateLimitDisabled() {
  if (process.env.RATE_LIMIT_DISABLED === '1') return true;
  if (isDevLike() && process.env.RATE_LIMIT_FORCE !== '1') return true;
  return false;
}

function isExemptPath(path = '') {
  return (
    path.startsWith('/auth/login') ||
    path.startsWith('/auth/me') ||
    path.startsWith('/auth/register') ||
    path.startsWith('/health')
  );
}

function key(req) {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const userId = req.user?._id ? String(req.user._id) : 'anon';
  const bucket = req.path.split('/').slice(1, 2).join('/') || 'misc';
  return `${ip}:${userId}:${bucket}`;
}

function rateLimitApi(req, res, next) {
  if (isRateLimitDisabled()) return next();
  if (isExemptPath(req.path)) return next();

  const k = key(req);
  const now = Date.now();
  let arr = buckets.get(k) || [];
  arr = arr.filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  buckets.set(k, arr);

  if (arr.length > MAX_REQUESTS) {
    return res.status(429).json({
      message: 'Too many requests, try again shortly.',
      retryAfterSeconds: Math.ceil(WINDOW_MS / 1000),
    });
  }
  next();
}

module.exports = { rateLimitApi, WINDOW_MS, MAX_REQUESTS };
