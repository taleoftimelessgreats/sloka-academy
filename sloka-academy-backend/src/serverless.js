'use strict';

const { loadConfig } = require('./config');
const { openDatabase } = require('./db');
const { assignMissingStudentIds } = require('./studentIds');
const { createApp } = require('./app');

/**
 * Request handler for serverless hosting (the Vercel Function in sloka-academy-frontend/api/).
 * It is the same Express app as server.js, created once per instance on the first request.
 * background: receives promises for work that continues after the response (Vercel's waitUntil),
 * so emails and Sheets syncs are not cut off when the function is frozen.
 */
function createHandler({ env = process.env, background = null } = {}) {
  let ready = null;

  async function start() {
    const config = loadConfig(env);
    const db = await openDatabase(config.database);
    await assignMissingStudentIds(db, config.studentIdPrefix);
    return { app: createApp({ db, config, background }), db };
  }

  async function handler(req, res) {
    // A failed start is retried on the next request rather than cached.
    ready ||= start().catch((err) => {
      ready = null;
      throw err;
    });
    let app;
    try {
      ({ app } = await ready);
    } catch (err) {
      console.error(`[api] could not start: ${err.message}`);
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'unavailable' }));
      return;
    }
    app(req, res);
  }

  /** Close the database pool, if the app was started (tests, local shutdown). */
  handler.close = async () => {
    const started = ready && (await ready.catch(() => null));
    ready = null;
    if (started) await started.db.close();
  };

  return handler;
}

module.exports = { createHandler };
