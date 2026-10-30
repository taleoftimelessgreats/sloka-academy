'use strict';

// Copy everything from the former SQLite database into the MySQL/TiDB database in DATABASE_URL.
//   npm run import-sqlite                    reads DB_PATH (default ./data/sloka.db)
//   npm run import-sqlite -- path/to/file.db
//   add --replace to delete what the target database already holds first
// Ids, Student IDs, certificate IDs and download links stay the same. The SQLite file is only read.

const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { loadDotEnv } = require('../src/env');
const { parseDatabaseUrl, resolveDbPath } = require('../src/config');
const { openDatabase } = require('../src/db');
const { assignMissingStudentIds } = require('../src/studentIds');

// Parents before children (foreign keys). Each SQLite column with the same name is copied.
const TABLES = [
  'users',
  'students',
  'certificate_templates',
  'sessions',
  'inquiries',
  'inquiry_notes',
  'certificate_registrations',
  'certificate_events',
  'settings',
  'sheet_sync',
  'id_sequences',
];
const WITH_IDS = TABLES.filter((t) => !['settings', 'sheet_sync', 'id_sequences'].includes(t));
const FILE_PART_BYTES = 2 * 1024 * 1024; // as in certificateTemplates.js
const BATCH = 200;
const LAST_SQLITE_VERSION = 4; // the schema this script reads

async function importSqlite(source, target, { replace = false, studentIdPrefix = 'SLK', log = console.log } = {}) {
  const lite = new DatabaseSync(source, { readOnly: true });
  try {
    const has = (t) => Boolean(lite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t));
    const version = has('schema_migrations') ? lite.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v : 0;
    if (version !== LAST_SQLITE_VERSION) {
      throw new Error(`${source} is at schema version ${version}; this import reads version ${LAST_SQLITE_VERSION}.`);
    }

    const present = TABLES.filter(has);
    const existing = [];
    for (const t of present) {
      const { n } = await target.get(`SELECT COUNT(*) AS n FROM ${t}`);
      if (n) existing.push(`${t} (${n})`);
    }
    if (existing.length && !replace) {
      throw new Error(`The target database already has data: ${existing.join(', ')}. Run with --replace to delete it first.`);
    }

    const counts = {};
    await target.transaction(async () => {
      if (replace) {
        for (const t of ['certificate_template_files', ...present].reverse()) await target.run(`DELETE FROM ${t}`);
      }
      for (const table of present) {
        const targetCols = new Set((await target.all(`SHOW COLUMNS FROM ${table}`)).map((c) => c.Field));
        const cols = lite
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .map((c) => c.name)
          .filter((c) => targetCols.has(c));
        const rows = lite.prepare(`SELECT ${cols.map((c) => `"${c}"`).join(', ')} FROM ${table}`).all();
        const quoted = cols.map((c) => `\`${c}\``).join(', ');
        for (let i = 0; i < rows.length; i += BATCH) {
          const batch = rows.slice(i, i + BATCH).map((r) => cols.map((c) => (r[c] instanceof Uint8Array ? Buffer.from(r[c]) : r[c])));
          await target.run(`INSERT INTO ${table} (${quoted}) VALUES ?`, [batch]);
        }
        counts[table] = rows.length;

        // Template files were one BLOB column in SQLite; here they are stored in parts.
        if (table === 'certificate_templates') {
          for (const { id, file } of lite.prepare('SELECT id, file FROM certificate_templates').all()) {
            const buf = Buffer.from(file);
            for (let part = 0, at = 0; at < buf.length; part++, at += FILE_PART_BYTES) {
              await target.run('INSERT INTO certificate_template_files (template_id, part, data) VALUES (?, ?, ?)', [id, part, buf.subarray(at, at + FILE_PART_BYTES)]);
            }
          }
        }
      }

      // Never hand out a Student ID number that an imported student already has.
      for (const { code } of await target.all('SELECT student_code AS code FROM students WHERE student_code IS NOT NULL')) {
        const m = /-STU-(\d{4})-(\d+)$/.exec(code);
        if (!m) continue;
        await target.run('INSERT INTO id_sequences (name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = GREATEST(value, VALUES(value))', [
          `student:${m[1]}`,
          Number(m[2]),
        ]);
      }
    });

    // New rows continue after the imported ids (ALTER TABLE commits on its own, so it runs after the copy).
    for (const table of WITH_IDS.filter((t) => present.includes(t))) {
      const { maxId } = await target.get(`SELECT COALESCE(MAX(id), 0) AS maxId FROM ${table}`);
      if (maxId) await target.run(`ALTER TABLE ${table} AUTO_INCREMENT = ${Number(maxId) + 1}`);
    }
    const assigned = await assignMissingStudentIds(target, studentIdPrefix);
    for (const [table, n] of Object.entries(counts)) log(`  ${table.padEnd(26)} ${n}`);
    if (assigned) log(`  gave ${assigned} student(s) a Student ID`);
    return counts;
  } finally {
    lite.close();
  }
}

async function main() {
  loadDotEnv();
  const args = process.argv.slice(2);
  const replace = args.includes('--replace');
  const fileArg = args.find((a) => !a.startsWith('--'));
  const source = fileArg ? resolveDbPath(fileArg) : resolveDbPath(process.env.DB_PATH);
  if (!fs.existsSync(source)) throw new Error(`No SQLite database at ${source}.`);
  const settings = parseDatabaseUrl(process.env.DATABASE_URL);
  const prefix = (process.env.STUDENT_ID_PREFIX || 'SLK').trim().toUpperCase();
  console.log(`Importing ${source}\n     into ${settings.host}:${settings.port}/${settings.database}${replace ? ' (replacing its data)' : ''}`);
  const target = await openDatabase(settings);
  try {
    await importSqlite(source, target, { replace, studentIdPrefix: prefix });
    console.log('Done. The SQLite file was not changed.');
  } finally {
    await target.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`import-sqlite failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { importSqlite };
