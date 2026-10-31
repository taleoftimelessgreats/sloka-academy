'use strict';

const { loadDotEnv } = require('./src/env');
const { loadConfig } = require('./src/config');
const { openDatabase } = require('./src/db');
const { assignMissingStudentIds } = require('./src/studentIds');
const { createApp } = require('./src/app');

loadDotEnv();

let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  console.error(`Refusing to start: ${err.message}`);
  process.exit(1);
}

if (config.production && config.allowedOrigins.some((o) => !o.startsWith('https://'))) {
  console.warn(`[config] ALLOWED_ORIGINS contains non-HTTPS origins in production: ${config.allowedOrigins.join(', ')}`);
}

async function main() {
  const dbLabel = `${config.database.host}:${config.database.port}/${config.database.database}`;
  let db;
  try {
    db = await openDatabase(config.database);
  } catch (err) {
    console.error(`Refusing to start: could not open the database ${dbLabel}: ${err.message}`);
    process.exit(1);
  }
  const assigned = await assignMissingStudentIds(db, config.studentIdPrefix); // e.g. students imported from an older database
  if (assigned) console.log(`Gave ${assigned} existing student(s) a Student ID`);

  const app = createApp({ db, config });
  const { delivery, sheetSync } = app.locals.services;

  const server = app.listen(config.port, () => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    console.log(`Sloka Academy API on http://localhost:${config.port} (db: ${dbLabel}, TZ: ${tz})`);
    console.log(`Website forms accepted from: ${config.allowedOrigins.join(', ')}`);
    console.log(`Certificate emails: ${delivery.enabled() ? `on (from ${config.notifyFrom})` : 'off (SMTP not configured)'}`);
    sheetSync
      .status()
      .then((s) => console.log(`Google Sheets: ${s.configured ? `connected${s.sheetTitle ? ` (${s.sheetTitle})` : ''}` : 'not connected (admin portal → Settings → Google Sheet)'}`))
      .catch(() => {});
    sheetSync.start();
  });

  function shutdown(signal) {
    console.log(`${signal} received, shutting down`);
    sheetSync.stop();
    server.close(async () => {
      await Promise.race([Promise.all([delivery.idle(), sheetSync.idle()]), new Promise((r) => setTimeout(r, 8000))]);
      await db.close().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  }
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
