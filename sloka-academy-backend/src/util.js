'use strict';

const pad = (n) => String(n).padStart(2, '0');

// Server-local calendar date (set TZ=Asia/Kolkata in production).
function localDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Server-local "YYYY-MM-DD HH:mm" for spreadsheets/notifications.
function localDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${localDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isValidDateString(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y >= 2000 && y <= 2100;
}

/**
 * Sliding-window in-memory counter. Keys are kept only in memory (never written to disk)
 * and expire after the window.
 */
class RateLimiter {
  constructor({ max, windowMs, maxKeys = 50000 }) {
    this.max = max;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
    this.hits = new Map();
    this.lastSweep = Date.now();
  }

  _fresh(key, now) {
    const list = this.hits.get(key);
    if (!list) return [];
    const cutoff = now - this.windowMs;
    const kept = list.filter((t) => t > cutoff);
    if (kept.length) this.hits.set(key, kept);
    else this.hits.delete(key);
    return kept;
  }

  _sweep(now) {
    if (now - this.lastSweep < 60000 && this.hits.size < this.maxKeys) return;
    this.lastSweep = now;
    for (const key of [...this.hits.keys()]) this._fresh(key, now);
    // Hard cap against memory exhaustion: drop the oldest keys.
    while (this.hits.size >= this.maxKeys) this.hits.delete(this.hits.keys().next().value);
  }

  isLimited(key) {
    return this._fresh(key, Date.now()).length >= this.max;
  }

  retryAfterSeconds(key) {
    const now = Date.now();
    const list = this._fresh(key, now);
    if (!list.length) return 0;
    return Math.max(1, Math.ceil((list[0] + this.windowMs - now) / 1000));
  }

  hit(key) {
    const now = Date.now();
    this._sweep(now);
    const list = this._fresh(key, now);
    list.push(now);
    this.hits.set(key, list);
  }

  reset(key) {
    this.hits.delete(key);
  }
}

class HttpError extends Error {
  constructor(status, body) {
    super(body && body.error ? body.error : `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

function validationError(fields) {
  return new HttpError(400, { error: 'validation', fields });
}

module.exports = { localDate, localDateTime, isValidDateString, RateLimiter, HttpError, validationError };
