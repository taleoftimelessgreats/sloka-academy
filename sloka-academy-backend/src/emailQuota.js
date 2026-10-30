'use strict';

const { localDate } = require('./util');

/** Thrown instead of sending when every recipient has reached today's limit. */
class EmailLimitError extends Error {
  constructor(recipients, limit) {
    super(`Daily email limit reached for ${recipients.join(', ')} (${limit} emails per day; it resets at midnight).`);
    this.code = 'EMAIL_DAILY_LIMIT';
  }
}

const normalize = (address) => String(address || '').trim().toLowerCase();

/** "a@x.com, B@y.com" or ['a@x.com'] -> ['a@x.com', 'b@y.com'] (deduplicated). */
function recipientsOf(to) {
  const list = Array.isArray(to) ? to : String(to || '').split(',');
  return [...new Set(list.map(normalize).filter(Boolean))];
}

/**
 * At most `limit` emails per recipient address per local day, whatever the email is for. Every email
 * the server sends reserves its place here first (see notify.js), so no module can go over.
 */
function createEmailQuota(db, { limit = 5, retainDays = 30 } = {}) {
  let prunedOn = null;

  async function prune(day) {
    if (prunedOn === day) return;
    prunedOn = day;
    const cutoff = new Date(Date.now() - retainDays * 24 * 60 * 60 * 1000);
    await db.run('DELETE FROM email_quota WHERE day < ?', [localDate(cutoff)]).catch(() => {});
  }

  /**
   * Count one email for each recipient still under today's limit. Resolves to { day, allowed }: the
   * addresses that may be sent to (already counted). Pass the same object to release() if sending fails.
   */
  async function reserve(to) {
    const day = localDate();
    await prune(day);
    const allowed = await db.transaction(async () => {
      const ok = [];
      for (const recipient of recipientsOf(to)) {
        // Creates the row if needed and locks it until the transaction ends.
        await db.run('INSERT INTO email_quota (recipient, day, sent) VALUES (?, ?, 0) ON DUPLICATE KEY UPDATE sent = sent', [recipient, day]);
        const { sent } = await db.get('SELECT sent FROM email_quota WHERE recipient = ? AND day = ?', [recipient, day]);
        if (sent >= limit) continue;
        await db.run('UPDATE email_quota SET sent = sent + 1 WHERE recipient = ? AND day = ?', [recipient, day]);
        ok.push(recipient);
      }
      return ok;
    });
    return { day, allowed };
  }

  /** Give back places taken by reserve() for an email that was not sent. */
  async function release({ day, allowed }) {
    for (const recipient of allowed) {
      await db.run('UPDATE email_quota SET sent = GREATEST(sent - 1, 0) WHERE recipient = ? AND day = ?', [recipient, day]);
    }
  }

  /** Emails that can still be sent to this address today. */
  async function remaining(address) {
    const row = await db.get('SELECT sent FROM email_quota WHERE recipient = ? AND day = ?', [normalize(address), localDate()]);
    return Math.max(limit - (row ? row.sent : 0), 0);
  }

  return { limit, reserve, release, remaining };
}

module.exports = { createEmailQuota, EmailLimitError, recipientsOf };
