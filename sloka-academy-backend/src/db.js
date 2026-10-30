'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const mysql = require('mysql2/promise');

// utf8mb4_general_ci makes comparisons, LIKE searches and unique keys case-insensitive (TiDB's own
// default, utf8mb4_bin, is case-sensitive). AUTO_ID_CACHE=1 keeps TiDB's auto-increment ids consecutive;
// MySQL reads the TiDB-only comment as a plain comment.
const TABLE = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci /*T![auto_id_cache] AUTO_ID_CACHE=1 */';
const TS = 'VARCHAR(32)'; // ISO 8601 UTC timestamp, e.g. 2026-10-30T09:15:00.000Z (sorts correctly as text)
const DAY = 'VARCHAR(10)'; // local date, YYYY-MM-DD

// Append-only list of migrations. Never edit a shipped migration; add a new one.
// MySQL/TiDB commit every DDL statement on its own, so a migration cannot be rolled back as a whole:
// each statement must be safe to run again (IF NOT EXISTS) in case a migration stops halfway.
const MIGRATIONS = [
  {
    // The schema of the former SQLite database (its migrations 1-4) in MySQL/TiDB form.
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS users (
        id            BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
        name          VARCHAR(255) NOT NULL,
        email         VARCHAR(254) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role          ENUM('counsellor', 'manager', 'admin') NOT NULL,
        active        TINYINT(1)   NOT NULL DEFAULT 1,
        token_version INT          NOT NULL DEFAULT 0,
        created_at    ${TS}        NOT NULL,
        updated_at    ${TS}        NOT NULL,
        last_login_at ${TS},
        UNIQUE KEY uq_users_email (email)
      ) ${TABLE}`,

      // Master student database: one record per person across both programmes.
      // Each email and each mobile number belongs to at most one student (NULLs do not clash).
      `CREATE TABLE IF NOT EXISTS students (
        id            BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
        student_code  VARCHAR(32),            -- e.g. SLK-STU-2026-00042, see studentIds.js; never changes
        name          VARCHAR(255) NOT NULL,
        email         VARCHAR(254),           -- lower-cased
        phone         VARCHAR(20),            -- +91XXXXXXXXXX
        college       VARCHAR(255),
        stream        VARCHAR(40),
        year_of_study VARCHAR(40),
        created_at    ${TS}        NOT NULL,  -- first seen
        updated_at    ${TS}        NOT NULL,
        UNIQUE KEY uq_students_code (student_code),
        UNIQUE KEY uq_students_email (email),
        UNIQUE KEY uq_students_phone (phone)
      ) ${TABLE}`,

      `CREATE TABLE IF NOT EXISTS inquiries (
        id             BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
        name           VARCHAR(255) NOT NULL,
        phone          VARCHAR(20)  NOT NULL,
        email          VARCHAR(254),
        college        VARCHAR(255),
        stream         VARCHAR(40),
        year_of_study  VARCHAR(40),
        domain         VARCHAR(255),
        plan           VARCHAR(40),
        source         VARCHAR(40)  NOT NULL,
        brochure       VARCHAR(255),
        message        TEXT,
        status         VARCHAR(40)  NOT NULL DEFAULT 'new',
        assigned_to    BIGINT,
        next_follow_up ${DAY},
        consent_at     ${TS}        NOT NULL,
        created_by     BIGINT,                -- NULL = public form
        created_at     ${TS}        NOT NULL,
        updated_at     ${TS}        NOT NULL,
        student_id     BIGINT,
        KEY idx_inquiries_status (status),
        KEY idx_inquiries_follow_up (next_follow_up),
        KEY idx_inquiries_created_at (created_at),
        KEY idx_inquiries_assigned (assigned_to),
        KEY idx_inquiries_student (student_id),
        CONSTRAINT fk_inquiries_assigned_to FOREIGN KEY (assigned_to) REFERENCES users (id) ON DELETE SET NULL,
        CONSTRAINT fk_inquiries_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
        CONSTRAINT fk_inquiries_student FOREIGN KEY (student_id) REFERENCES students (id)
      ) ${TABLE}`,

      `CREATE TABLE IF NOT EXISTS inquiry_notes (
        id         BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        inquiry_id BIGINT NOT NULL,
        author_id  BIGINT,
        kind       ENUM('note', 'change') NOT NULL DEFAULT 'note',
        body       TEXT   NOT NULL,
        created_at ${TS}  NOT NULL,
        KEY idx_notes_inquiry (inquiry_id, created_at),
        CONSTRAINT fk_notes_inquiry FOREIGN KEY (inquiry_id) REFERENCES inquiries (id) ON DELETE CASCADE,
        CONSTRAINT fk_notes_author FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE SET NULL
      ) ${TABLE}`,

      `CREATE TABLE IF NOT EXISTS certificate_templates (
        id          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
        name        VARCHAR(255) NOT NULL,
        file_type   ENUM('pdf', 'png', 'jpeg') NOT NULL,
        file_size   INT          NOT NULL,
        page_width  DOUBLE       NOT NULL,   -- PDF points
        page_height DOUBLE       NOT NULL,
        layout      TEXT         NOT NULL,   -- JSON: where each detail is printed
        is_default  TINYINT(1)   NOT NULL DEFAULT 0,
        archived    TINYINT(1)   NOT NULL DEFAULT 0,
        created_by  BIGINT,
        created_at  ${TS}        NOT NULL,
        updated_at  ${TS}        NOT NULL,
        CONSTRAINT fk_templates_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
      ) ${TABLE}`,

      // The uploaded file, in parts: TiDB stores at most 6 MiB in one row.
      `CREATE TABLE IF NOT EXISTS certificate_template_files (
        template_id BIGINT     NOT NULL,
        part        INT        NOT NULL,
        data        MEDIUMBLOB NOT NULL,
        PRIMARY KEY (template_id, part),
        CONSTRAINT fk_template_files_template FOREIGN KEY (template_id) REFERENCES certificate_templates (id) ON DELETE CASCADE
      ) ${TABLE}`,

      `CREATE TABLE IF NOT EXISTS sessions (
        id                BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
        title             VARCHAR(255) NOT NULL,
        session_date      ${DAY}       NOT NULL,
        venue             VARCHAR(255),          -- required for in-person (enforced in app)
        mode              ENUM('in-person', 'online') NOT NULL,
        description       TEXT,
        code              VARCHAR(20)  NOT NULL, -- stored as-is: staff read it out at the session
        registration_open TINYINT(1)   NOT NULL DEFAULT 1,
        closes_at         ${TS},                 -- optional
        template_id       BIGINT,                -- NULL = the default design
        created_by        BIGINT,
        created_at        ${TS}        NOT NULL,
        updated_at        ${TS}        NOT NULL,
        KEY idx_sessions_date (session_date),
        CONSTRAINT fk_sessions_template FOREIGN KEY (template_id) REFERENCES certificate_templates (id),
        CONSTRAINT fk_sessions_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
      ) ${TABLE}`,

      `CREATE TABLE IF NOT EXISTS certificate_registrations (
        id                  BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
        session_id          BIGINT       NOT NULL,
        name                VARCHAR(255) NOT NULL,
        email               VARCHAR(254) NOT NULL, -- lower-cased
        phone               VARCHAR(20)  NOT NULL,
        college             VARCHAR(255) NOT NULL,
        stream              VARCHAR(40),
        year_of_study       VARCHAR(40),
        consent_at          ${TS}        NOT NULL,
        certificate_id      VARCHAR(40)  NOT NULL,
        download_token_hash CHAR(64)     NOT NULL, -- sha256 hex; the token itself is never stored
        status              ENUM('issued', 'revoked') NOT NULL DEFAULT 'issued',
        revoked_reason      VARCHAR(500),
        issued_at           ${TS}        NOT NULL,
        download_count      INT          NOT NULL DEFAULT 0,
        last_downloaded_at  ${TS},
        created_at          ${TS}        NOT NULL,
        updated_at          ${TS}        NOT NULL,
        student_id          BIGINT,
        template_id         BIGINT,                -- NULL = built-in design
        email_status        ENUM('pending', 'sent', 'failed', 'off'),
        email_error         TEXT,
        emailed_at          ${TS},
        UNIQUE KEY uq_certreg_certificate_id (certificate_id),
        UNIQUE KEY uq_certreg_session_email (session_id, email),
        KEY idx_certreg_session_phone (session_id, phone),
        KEY idx_certreg_created (created_at),
        KEY idx_certreg_student (student_id),
        KEY idx_certreg_email_status (email_status),
        CONSTRAINT fk_certreg_session FOREIGN KEY (session_id) REFERENCES sessions (id),
        CONSTRAINT fk_certreg_student FOREIGN KEY (student_id) REFERENCES students (id),
        CONSTRAINT fk_certreg_template FOREIGN KEY (template_id) REFERENCES certificate_templates (id)
      ) ${TABLE}`,

      `CREATE TABLE IF NOT EXISTS certificate_events (
        id              BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        registration_id BIGINT NOT NULL,
        type            ENUM('registered', 'downloaded', 'name_corrected', 'revoked', 'reinstated', 'emailed', 'link_rotated',
                             'email_failed', 'details_corrected') NOT NULL,
        detail          TEXT,
        actor_id        BIGINT,                 -- NULL = the student / public
        created_at      ${TS}  NOT NULL,
        KEY idx_certevents_reg (registration_id, created_at),
        KEY idx_certevents_created (created_at),
        CONSTRAINT fk_certevents_registration FOREIGN KEY (registration_id) REFERENCES certificate_registrations (id) ON DELETE CASCADE,
        CONSTRAINT fk_certevents_actor FOREIGN KEY (actor_id) REFERENCES users (id) ON DELETE SET NULL
      ) ${TABLE}`,

      `CREATE TABLE IF NOT EXISTS settings (
        \`key\`    VARCHAR(64) NOT NULL PRIMARY KEY,
        value      TEXT,
        updated_by BIGINT,
        updated_at ${TS}       NOT NULL,
        CONSTRAINT fk_settings_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
      ) ${TABLE}`,

      // Which registrations have been copied to which Google Sheet (a new sheet receives every registration).
      `CREATE TABLE IF NOT EXISTS sheet_sync (
        registration_id BIGINT       NOT NULL,
        spreadsheet_id  VARCHAR(255) NOT NULL,
        synced_at       ${TS}        NOT NULL,
        PRIMARY KEY (registration_id, spreadsheet_id),
        CONSTRAINT fk_sheet_sync_registration FOREIGN KEY (registration_id) REFERENCES certificate_registrations (id) ON DELETE CASCADE
      ) ${TABLE}`,

      // Last number handed out per counter (e.g. 'student:2026'), so numbers are never reused after an erasure.
      `CREATE TABLE IF NOT EXISTS id_sequences (
        name  VARCHAR(64) NOT NULL PRIMARY KEY,
        value BIGINT      NOT NULL
      ) ${TABLE}`,
    ],
  },
  {
    // Profile verification, and the daily email limit per recipient.
    version: 2,
    statements: [
      // A registration or enquiry whose email or mobile number belongs to an existing student but whose other
      // details differ. Until it is verified (code emailed to the profile's address) or a staff member decides,
      // the record has no student_id and the profile is left unchanged.
      `CREATE TABLE IF NOT EXISTS profile_verifications (
        id              BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
        token           CHAR(32)     NOT NULL,          -- public handle for the website (random)
        registration_id BIGINT,                         -- exactly one of registration_id / inquiry_id
        inquiry_id      BIGINT,
        student_id      BIGINT       NOT NULL,          -- the existing profile it matched
        proposed        TEXT         NOT NULL,          -- JSON: the submitted details
        conflicts       TEXT         NOT NULL,          -- JSON: the profile fields that differ
        status          ENUM('pending', 'failed', 'verified', 'resolved') NOT NULL DEFAULT 'pending',
        sent_to         VARCHAR(254),                   -- where the code went (the profile's email)
        code_hash       CHAR(64),                       -- HMAC of the code; the code itself is never stored
        code_expires_at ${TS},
        attempts        INT          NOT NULL DEFAULT 0, -- wrong codes for the current code
        sends           INT          NOT NULL DEFAULT 0,
        last_sent_at    ${TS},
        resolution      VARCHAR(20),                    -- code | link | update | new_profile
        resolved_by     BIGINT,
        resolved_at     ${TS},
        created_at      ${TS}        NOT NULL,
        updated_at      ${TS}        NOT NULL,
        UNIQUE KEY uq_verifications_token (token),
        KEY idx_verifications_status (status, created_at),
        KEY idx_verifications_student (student_id),
        CONSTRAINT fk_verifications_registration FOREIGN KEY (registration_id) REFERENCES certificate_registrations (id) ON DELETE CASCADE,
        CONSTRAINT fk_verifications_inquiry FOREIGN KEY (inquiry_id) REFERENCES inquiries (id) ON DELETE CASCADE,
        CONSTRAINT fk_verifications_student FOREIGN KEY (student_id) REFERENCES students (id),
        CONSTRAINT fk_verifications_resolved_by FOREIGN KEY (resolved_by) REFERENCES users (id) ON DELETE SET NULL
      ) ${TABLE}`,

      // Emails sent per recipient per local day (all kinds: certificates, codes, team notifications).
      `CREATE TABLE IF NOT EXISTS email_quota (
        recipient VARCHAR(254) NOT NULL,  -- lower-cased address
        day       ${DAY}       NOT NULL,
        sent      INT          NOT NULL DEFAULT 0,
        PRIMARY KEY (recipient, day)
      ) ${TABLE}`,
    ],
  },
];

// Worth running a transaction again for: lock wait timeout, deadlock, and TiDB's write conflicts.
const RETRYABLE_ERRNOS = new Set([1205, 1213, 8002, 8022, 8028, 9007]);
// The connection dropped (network, idle timeout, server restart) before the statement completed.
const CONNECTION_LOST = new Set(['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECONNREFUSED', 'PROTOCOL_CONNECTION_LOST']);

/** True for a unique-key violation, optionally of one named key (e.g. 'uq_users_email'). */
const isDuplicate = (err, key) => Boolean(err && err.code === 'ER_DUP_ENTRY' && (!key || String(err.message).includes(key)));

/**
 * A connection pool with a small query API. Inside db.transaction(fn), every call fn makes (directly or
 * in the functions it calls) runs on the transaction's connection, so repositories can share a
 * transaction without passing it around.
 */
class Database {
  constructor(pool, name) {
    this.pool = pool;
    this.name = name;
    this.current = new AsyncLocalStorage();
  }

  executor() {
    const tx = this.current.getStore();
    return tx && tx.open ? tx.conn : this.pool; // work started in a transaction may outlive it
  }

  /** All rows. `params` fill the ? placeholders (values are escaped by the driver). */
  async all(sql, params = []) {
    const executor = this.executor();
    try {
      const [rows] = await executor.query(sql, params);
      return rows;
    } catch (err) {
      // A read outside a transaction is safe to repeat on a fresh connection.
      if (executor !== this.pool || !CONNECTION_LOST.has(err.code)) throw err;
      const [rows] = await this.pool.query(sql, params);
      return rows;
    }
  }

  /** The first row, or undefined. */
  async get(sql, params = []) {
    return (await this.all(sql, params))[0];
  }

  /** INSERT/UPDATE/DELETE. Resolves to { insertId, changes }. */
  async run(sql, params = []) {
    const [r] = await this.executor().query(sql, params);
    return { insertId: Number(r.insertId), changes: r.affectedRows };
  }

  /**
   * Run fn in a transaction (or as part of the one already in progress) and resolve to its result.
   * After a deadlock, a write conflict, a connection lost before COMMIT (the server rolls back) or an
   * error marked `retryable`, fn runs again from the start, so it must not do anything outside the database.
   */
  async transaction(fn, { attempts = 4 } = {}) {
    if (this.executor() !== this.pool) return fn();
    for (let attempt = 1; ; attempt++) {
      const conn = await this.pool.getConnection();
      const tx = { conn, open: true };
      let committing = false;
      let broken = false;
      try {
        await conn.beginTransaction();
        const result = await this.current.run(tx, fn);
        committing = true;
        await conn.commit();
        return result;
      } catch (err) {
        broken = Boolean(err.fatal) || CONNECTION_LOST.has(err.code);
        if (!broken) await conn.rollback().catch(() => {});
        const lostBeforeCommit = broken && !committing && CONNECTION_LOST.has(err.code);
        if (attempt >= attempts || !(err.retryable || RETRYABLE_ERRNOS.has(err.errno) || lostBeforeCommit)) throw err;
      } finally {
        tx.open = false;
        if (broken) conn.destroy();
        else conn.release();
      }
      await new Promise((resolve) => setTimeout(resolve, 20 * attempt + Math.random() * 30));
    }
  }

  close() {
    return this.pool.end();
  }
}

/** Apply pending migrations. */
async function migrate(db) {
  await db.run(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INT  NOT NULL PRIMARY KEY,
    applied_at ${TS} NOT NULL
  ) ${TABLE}`);
  const applied = new Set((await db.all('SELECT version FROM schema_migrations')).map((r) => r.version));
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    for (const sql of m.statements) await db.run(sql);
    if (m.up) await db.transaction(() => m.up(db));
    await db.run('INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)', [m.version, new Date().toISOString()]);
  }
}

function connectionOptions(settings) {
  return {
    host: settings.host,
    port: settings.port,
    user: settings.user,
    password: settings.password,
    ssl: settings.ssl ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
    charset: 'UTF8MB4_GENERAL_CI',
    decimalNumbers: true, // SUM() etc. as numbers, not strings
    supportBigNumbers: true,
    stringifyObjects: true, // an object passed as a value is a bug; never expand it into SQL
    connectTimeout: 20000,
  };
}

/**
 * Connect to the MySQL/TiDB database described by `settings` (config.database), creating the database
 * if it does not exist yet, and bring its schema up to date.
 */
async function openDatabase(settings, { createIfMissing = true } = {}) {
  const base = connectionOptions(settings);
  if (createIfMissing) {
    const conn = await mysql.createConnection(base);
    try {
      await conn.query(`CREATE DATABASE IF NOT EXISTS ${mysql.escapeId(settings.database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`);
    } finally {
      await conn.end();
    }
  }
  const pool = mysql.createPool({
    ...base,
    database: settings.database,
    connectionLimit: 10,
    maxIdle: 2,
    idleTimeout: 5 * 60 * 1000, // TiDB Cloud drops idle connections; let the pool close them first
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000, // notice a dead connection within seconds (the OS default can be hours)
  });
  // READ COMMITTED: every statement sees the latest committed data, as the single-writer SQLite database
  // did. Code that reads and then writes the same rows locks them first (SELECT ... FOR UPDATE).
  pool.on('connection', (conn) => {
    conn.query("SET SESSION transaction_isolation = 'READ-COMMITTED'", (err) => {
      if (err) console.error(`[db] could not set the isolation level: ${err.message}`);
    });
  });
  const db = new Database(pool, settings.database);
  try {
    await migrate(db);
  } catch (err) {
    await pool.end().catch(() => {});
    throw err;
  }
  return db;
}

module.exports = { openDatabase, migrate, isDuplicate, connectionOptions, MIGRATIONS };
