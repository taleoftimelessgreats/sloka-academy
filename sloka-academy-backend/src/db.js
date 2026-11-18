'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const mysql = require('mysql2/promise');
const { DEFAULT_ROLES } = require('./permissions');

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
  {
    // Refer a friend: friends named on a certificate registration become enquiries (source 'referral')
    // pointing back at that registration. Erasing the registration clears the link (done in the app).
    version: 3,
    statements: [
      'ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS referred_by BIGINT',
      'CREATE INDEX IF NOT EXISTS idx_inquiries_referred_by ON inquiries (referred_by)',
    ],
  },
  {
    // Roles & permissions, associates, the audit log, internship registrations (course master, enrollments,
    // payment ledger) and offer letters. See permissions.js, registrationRepo.js and offerLetters.js.
    version: 4,
    statements: [
      // Roles are rows of `roles` now (custom roles), so users.role is the role's key.
      'ALTER TABLE users MODIFY COLUMN role VARCHAR(40) NOT NULL',
      // Associate details. Older accounts have none of them until they are edited.
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_id VARCHAR(40)',
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS mobile VARCHAR(20)',
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS department VARCHAR(40)',
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS designation VARCHAR(100)',
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS reporting_manager_id BIGINT',
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_joining ${DAY}`,
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password TINYINT(1) NOT NULL DEFAULT 0',
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_users_employee_id ON users (employee_id)',
      'CREATE INDEX IF NOT EXISTS idx_users_manager ON users (reporting_manager_id)',

      `CREATE TABLE IF NOT EXISTS roles (
        role_key    VARCHAR(40)  NOT NULL PRIMARY KEY,
        name        VARCHAR(100) NOT NULL,
        description VARCHAR(500),
        scope       ENUM('own', 'team', 'all') NOT NULL DEFAULT 'own', -- which registrations and offer letters it sees
        is_system   TINYINT(1)   NOT NULL DEFAULT 0,                   -- the five roles of the requirements: never deleted
        created_at  ${TS}        NOT NULL,
        updated_at  ${TS}        NOT NULL,
        UNIQUE KEY uq_roles_name (name)
      ) ${TABLE}`,
      `CREATE TABLE IF NOT EXISTS role_permissions (
        role_key   VARCHAR(40) NOT NULL,
        permission VARCHAR(64) NOT NULL, -- '<module>.<action>', see permissions.js
        PRIMARY KEY (role_key, permission),
        CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_key) REFERENCES roles (role_key) ON DELETE CASCADE
      ) ${TABLE}`,
      // Per-associate grants (granted = 1) and revocations (granted = 0) on top of their role.
      `CREATE TABLE IF NOT EXISTS user_permission_overrides (
        user_id    BIGINT      NOT NULL,
        permission VARCHAR(64) NOT NULL,
        granted    TINYINT(1)  NOT NULL,
        PRIMARY KEY (user_id, permission),
        CONSTRAINT fk_overrides_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ${TABLE}`,

      `CREATE TABLE IF NOT EXISTS audit_log (
        id         BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
        actor_id   BIGINT,                 -- NULL = the system
        entity     VARCHAR(40)  NOT NULL,  -- e.g. 'enrollment', 'payment', 'student', 'role', 'associate'
        entity_id  VARCHAR(64),
        action     VARCHAR(40)  NOT NULL,  -- e.g. 'create', 'update', 'delete'
        summary    VARCHAR(500) NOT NULL,
        changes    TEXT,                   -- JSON [{ field, from, to }]
        created_at ${TS}        NOT NULL,
        KEY idx_audit_created (created_at),
        KEY idx_audit_entity (entity, entity_id),
        CONSTRAINT fk_audit_actor FOREIGN KEY (actor_id) REFERENCES users (id) ON DELETE SET NULL
      ) ${TABLE}`,

      // Student master details collected by the registration form.
      'ALTER TABLE students ADD COLUMN IF NOT EXISTS gender VARCHAR(20)',
      `ALTER TABLE students ADD COLUMN IF NOT EXISTS date_of_birth ${DAY}`,
      'ALTER TABLE students ADD COLUMN IF NOT EXISTS qualification VARCHAR(100)',
      'ALTER TABLE students ADD COLUMN IF NOT EXISTS specialization VARCHAR(150)',
      'ALTER TABLE students ADD COLUMN IF NOT EXISTS graduation_year SMALLINT',
      'ALTER TABLE students ADD COLUMN IF NOT EXISTS city VARCHAR(100)',
      'ALTER TABLE students ADD COLUMN IF NOT EXISTS state VARCHAR(100)',

      // Offer letter templates: an optional background (as certificate designs) and the letter's text.
      `CREATE TABLE IF NOT EXISTS offer_templates (
        id          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
        name        VARCHAR(255) NOT NULL,
        file_type   ENUM('pdf', 'png', 'jpeg'),  -- NULL = the built-in Sloka letterhead
        file_size   INT,
        page_width  DOUBLE       NOT NULL,       -- PDF points
        page_height DOUBLE       NOT NULL,
        body        TEXT         NOT NULL,       -- with {{placeholders}} and **bold**
        layout      TEXT         NOT NULL,       -- JSON: margins, font, size, colour, line height
        is_default  TINYINT(1)   NOT NULL DEFAULT 0,
        active      TINYINT(1)   NOT NULL DEFAULT 0,
        created_by  BIGINT,
        created_at  ${TS}        NOT NULL,
        updated_at  ${TS}        NOT NULL,
        CONSTRAINT fk_offer_templates_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
      ) ${TABLE}`,
      `CREATE TABLE IF NOT EXISTS offer_template_files (
        template_id BIGINT     NOT NULL,
        part        INT        NOT NULL,
        data        MEDIUMBLOB NOT NULL,
        PRIMARY KEY (template_id, part),
        CONSTRAINT fk_offer_template_files_template FOREIGN KEY (template_id) REFERENCES offer_templates (id) ON DELETE CASCADE
      ) ${TABLE}`,

      // Course master: the internship course domains a student can register for.
      `CREATE TABLE IF NOT EXISTS courses (
        id                BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
        name              VARCHAR(150) NOT NULL,
        duration          VARCHAR(60)  NOT NULL,  -- as printed on the offer letter, e.g. "2 months"
        active            TINYINT(1)   NOT NULL DEFAULT 1,
        offer_template_id BIGINT,                 -- NULL = the default offer letter template
        created_at        ${TS}        NOT NULL,
        updated_at        ${TS}        NOT NULL,
        UNIQUE KEY uq_courses_name (name),
        CONSTRAINT fk_courses_offer_template FOREIGN KEY (offer_template_id) REFERENCES offer_templates (id)
      ) ${TABLE}`,

      // One internship registration of a student (a student may register for several course domains).
      // Amounts are in paise. paid_paise and payment_status follow the payments (registrationRepo.recalculate).
      `CREATE TABLE IF NOT EXISTS enrollments (
        id               BIGINT  NOT NULL AUTO_INCREMENT PRIMARY KEY,
        student_id       BIGINT  NOT NULL,
        course_id        BIGINT  NOT NULL,
        batch_start_date ${DAY}  NOT NULL,
        fee_paise        BIGINT  NOT NULL,          -- committed program fee, negotiated per student
        paid_paise       BIGINT  NOT NULL DEFAULT 0,
        payment_status   ENUM('slot-confirmed', 'partially-paid', 'fully-paid') NOT NULL DEFAULT 'slot-confirmed',
        balance_due_date ${DAY},                    -- required while a balance remains
        bd_associate_id  BIGINT,
        registration_date ${DAY} NOT NULL,
        remarks          TEXT,
        created_by       BIGINT,
        created_at       ${TS}   NOT NULL,
        updated_at       ${TS}   NOT NULL,
        KEY idx_enrollments_student (student_id),
        KEY idx_enrollments_bd (bd_associate_id),
        KEY idx_enrollments_registered (registration_date),
        KEY idx_enrollments_due (balance_due_date),
        KEY idx_enrollments_course (course_id),
        CONSTRAINT fk_enrollments_student FOREIGN KEY (student_id) REFERENCES students (id),
        CONSTRAINT fk_enrollments_course FOREIGN KEY (course_id) REFERENCES courses (id),
        CONSTRAINT fk_enrollments_bd FOREIGN KEY (bd_associate_id) REFERENCES users (id) ON DELETE SET NULL,
        CONSTRAINT fk_enrollments_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
      ) ${TABLE}`,
      `CREATE TABLE IF NOT EXISTS payments (
        id            BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
        enrollment_id BIGINT      NOT NULL,
        kind          ENUM('token', 'instalment') NOT NULL,
        amount_paise  BIGINT      NOT NULL,
        mode          VARCHAR(30) NOT NULL,
        reference     VARCHAR(100),
        paid_on       ${DAY}      NOT NULL,
        recorded_by   BIGINT,
        created_at    ${TS}       NOT NULL,
        updated_at    ${TS}       NOT NULL,
        KEY idx_payments_enrollment (enrollment_id, paid_on),
        CONSTRAINT fk_payments_enrollment FOREIGN KEY (enrollment_id) REFERENCES enrollments (id) ON DELETE CASCADE,
        CONSTRAINT fk_payments_recorded_by FOREIGN KEY (recorded_by) REFERENCES users (id) ON DELETE SET NULL
      ) ${TABLE}`,

      // The offer letter of an enrollment. `content` is a snapshot (JSON: placeholder values, body, layout), so
      // the letter stays as it was generated until it is regenerated; the PDF is rendered from it on demand.
      `CREATE TABLE IF NOT EXISTS offer_letters (
        id            BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
        offer_code    VARCHAR(40) NOT NULL,   -- SLK/OL/2026/0001
        enrollment_id BIGINT      NOT NULL,
        template_id   BIGINT,                 -- NULL = built-in letterhead
        content       TEXT        NOT NULL,
        offer_date    ${DAY}      NOT NULL,
        status        ENUM('generated', 'sent', 'failed') NOT NULL DEFAULT 'generated',
        email_error   TEXT,
        sent_at       ${TS},
        generated_by  BIGINT,
        generated_at  ${TS}       NOT NULL,
        updated_at    ${TS}       NOT NULL,
        UNIQUE KEY uq_offer_letters_code (offer_code),
        UNIQUE KEY uq_offer_letters_enrollment (enrollment_id),
        CONSTRAINT fk_offer_letters_enrollment FOREIGN KEY (enrollment_id) REFERENCES enrollments (id) ON DELETE CASCADE,
        CONSTRAINT fk_offer_letters_template FOREIGN KEY (template_id) REFERENCES offer_templates (id),
        CONSTRAINT fk_offer_letters_generated_by FOREIGN KEY (generated_by) REFERENCES users (id) ON DELETE SET NULL
      ) ${TABLE}`,
      `CREATE TABLE IF NOT EXISTS offer_letter_events (
        id              BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        offer_letter_id BIGINT NOT NULL,
        type            ENUM('generated', 'regenerated', 'sent', 'failed') NOT NULL,
        detail          TEXT,
        actor_id        BIGINT,
        created_at      ${TS}  NOT NULL,
        KEY idx_offer_events_letter (offer_letter_id, created_at),
        CONSTRAINT fk_offer_events_letter FOREIGN KEY (offer_letter_id) REFERENCES offer_letters (id) ON DELETE CASCADE,
        CONSTRAINT fk_offer_events_actor FOREIGN KEY (actor_id) REFERENCES users (id) ON DELETE SET NULL
      ) ${TABLE}`,

      // A BD Associate said a registration's mobile number or email is NOT the student it belongs to: the
      // registration is blocked and an admin reviews the conflict.
      `CREATE TABLE IF NOT EXISTS registration_flags (
        id              BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
        entered         TEXT         NOT NULL, -- JSON: the details the associate entered
        matched         TEXT         NOT NULL, -- JSON: the student records they matched (ids, codes, names)
        note            VARCHAR(500),
        status          ENUM('open', 'resolved') NOT NULL DEFAULT 'open',
        raised_by       BIGINT,
        resolved_by     BIGINT,
        resolution_note VARCHAR(500),
        resolved_at     ${TS},
        created_at      ${TS}        NOT NULL,
        KEY idx_flags_status (status, created_at),
        CONSTRAINT fk_flags_raised_by FOREIGN KEY (raised_by) REFERENCES users (id) ON DELETE SET NULL,
        CONSTRAINT fk_flags_resolved_by FOREIGN KEY (resolved_by) REFERENCES users (id) ON DELETE SET NULL
      ) ${TABLE}`,
    ],
    async up(db) {
      // The portal's original admins become Super Admins (they managed admins); 'admin' is now the Admin role.
      await db.run("UPDATE users SET role = 'super_admin' WHERE role = 'admin'");
      const now = new Date().toISOString();
      for (const r of DEFAULT_ROLES) {
        await db.run('INSERT IGNORE INTO roles (role_key, name, description, scope, is_system, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
          r.key, r.name, r.description, r.scope, r.system ? 1 : 0, now, now,
        ]);
        for (const p of r.permissions) await db.run('INSERT IGNORE INTO role_permissions (role_key, permission) VALUES (?, ?)', [r.key, p]);
      }
      for (const name of COURSE_SEED) {
        await db.run("INSERT IGNORE INTO courses (name, duration, active, created_at, updated_at) VALUES (?, '2 months', 1, ?, ?)", [name, now, now]);
      }
    },
  },
  {
    // Offer letters are issued once the fee is fully paid, with the internship start date the associate enters.
    // Templates remember the kind of file uploaded (the portal converts Word and PowerPoint files to PDF).
    version: 5,
    statements: [
      `ALTER TABLE offer_letters ADD COLUMN IF NOT EXISTS internship_start_date ${DAY}`,
      'ALTER TABLE certificate_templates ADD COLUMN IF NOT EXISTS source_type VARCHAR(8)',
      'ALTER TABLE offer_templates ADD COLUMN IF NOT EXISTS source_type VARCHAR(8)',
    ],
  },
];

// The website's internship domains (sloka-academy-frontend/src/data/domains.ts) when the course master was added.
const COURSE_SEED = [
  '.NET', 'Java Programming', 'Java Full Stack', 'Python Programming', 'Python Full Stack Development', 'Full Stack',
  'Data Structures', 'Selenium Testing with Java', 'ServiceNow', 'Salesforce', 'SAP', 'UI/UX Design', 'Digital Marketing',
  'AI/ML', 'Agentic AI', 'Data Analytics', 'Data Engineering', 'Data Science', 'Business Analytics', 'AWS', 'DevOps',
  'Cyber Security', 'Blockchain', 'Quantum Computing', 'Generative AI & LLM', 'Embedded Systems', 'Internet of Things (IoT)',
  'Robotics', 'VLSI', 'Hybrid Electric Vehicles', 'AutoCAD', 'Nano Science & Nanotechnology', 'Bioinformatics',
  'Genetic Engineering', 'Clinical SAS', 'Medical Coding', 'Pharmacovigilance', 'Entrepreneurship', 'Finance', 'HR',
  'Investment Banking', 'Supply Chain Management',
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

module.exports = { openDatabase, isDuplicate };
