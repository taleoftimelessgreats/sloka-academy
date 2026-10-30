'use strict';

const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function parseTrustProxy(value) {
  if (value == null) return false;
  const v = String(value).trim();
  if (v === '' || v.toLowerCase() === 'false' || v === '0') return false;
  if (v.toLowerCase() === 'true') return true;
  if (/^\d+$/.test(v)) return Number(v); // number of proxy hops
  return v; // e.g. "loopback", "uniquelocal" or a comma-separated list of IPs/CIDRs
}

function parseOrigins(value) {
  const raw = value == null || String(value).trim() === '' ? 'http://localhost:3000' : String(value);
  return raw
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

// The former SQLite database file, read by scripts/import-sqlite.js.
function resolveDbPath(value) {
  const p = value && String(value).trim() ? String(value).trim() : './data/sloka.db';
  return path.resolve(PROJECT_ROOT, p);
}

const SYSTEM_SCHEMAS = ['sys', 'mysql', 'information_schema', 'performance_schema', 'metrics_schema'];

/**
 * DATABASE_URL: mysql://user:password@host:port/database (TiDB Cloud: port 4000).
 * TLS is required unless the URL ends in ?ssl=false (for a database server on this machine).
 */
function parseDatabaseUrl(value) {
  const raw = value == null ? '' : String(value).trim();
  const example = 'mysql://USER:PASSWORD@gateway01.ap-northeast-1.prod.aws.tidbcloud.com:4000/sloka_academy';
  if (!raw) throw new Error(`DATABASE_URL must be set, e.g. ${example}`);
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`DATABASE_URL is not a valid URL. Expected e.g. ${example}`);
  }
  if (u.protocol !== 'mysql:') throw new Error('DATABASE_URL must start with mysql://');
  const database = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (!/^[A-Za-z0-9_]{1,64}$/.test(database)) {
    throw new Error(`DATABASE_URL must end with the database name (letters, digits and _), e.g. ${example}`);
  }
  if (SYSTEM_SCHEMAS.includes(database.toLowerCase())) {
    throw new Error(`DATABASE_URL points at the built-in "${database}" database. Use one of its own, e.g. .../sloka_academy (it is created on first start).`);
  }
  const ssl = (u.searchParams.get('ssl') || '').toLowerCase();
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database,
    ssl: !(ssl === 'false' || ssl === '0'),
  };
}

function loadConfig(env = process.env) {
  const jwtSecret = env.JWT_SECRET || '';
  if (jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be set and at least 32 characters long (e.g. `node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"`).');
  }

  const port = Number.parseInt(env.PORT || '4000', 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be a valid port number.');

  const smtpPort = env.SMTP_PORT ? Number.parseInt(env.SMTP_PORT, 10) : undefined;

  const certIdPrefix = (env.CERT_ID_PREFIX || 'SLK').trim().toUpperCase();
  if (!/^[A-Z0-9]{2,8}$/.test(certIdPrefix)) throw new Error('CERT_ID_PREFIX must be 2-8 letters or digits.');
  const studentIdPrefix = (env.STUDENT_ID_PREFIX || 'SLK').trim().toUpperCase();
  if (!/^[A-Z0-9]{2,8}$/.test(studentIdPrefix)) throw new Error('STUDENT_ID_PREFIX must be 2-8 letters or digits.');
  const dashboardUrl = (env.DASHBOARD_URL || `http://localhost:${port}/`).trim();
  const urlOrigin = (u) => {
    try {
      return new URL(u).origin;
    } catch {
      throw new Error(`Invalid URL in configuration: ${u}`);
    }
  };

  return {
    port,
    database: parseDatabaseUrl(env.DATABASE_URL),
    jwtSecret,
    production: env.NODE_ENV === 'production',
    allowedOrigins: parseOrigins(env.ALLOWED_ORIGINS),
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    dashboardUrl,
    // Public base URL of THIS server, used in emailed certificate download links.
    // Defaults to DASHBOARD_URL's origin (same server); set it if students should see a different hostname.
    publicApiUrl: urlOrigin((env.PUBLIC_API_URL || dashboardUrl).trim()),
    siteUrl: (env.SITE_URL || 'https://www.slokaacademy.com').trim().replace(/\/+$/, ''),
    certIdPrefix,
    studentIdPrefix, // Student IDs: <PREFIX>-STU-<year>-<number>
    certVerifyUrl: (env.CERT_VERIFY_URL || 'https://www.slokaacademy.com/verify/').trim(),
    certSignatoryName: (env.CERT_SIGNATORY_NAME || '').trim(),
    certSignatoryTitle: (env.CERT_SIGNATORY_TITLE || '').trim(),
    smtp: {
      host: env.SMTP_HOST || '',
      port: smtpPort,
      user: env.SMTP_USER || '',
      pass: env.SMTP_PASS || '',
    },
    notifyFrom: env.NOTIFY_FROM || '',
    notifyTo: env.NOTIFY_TO || '',
    notifyWebhookUrl: env.NOTIFY_WEBHOOK_URL || '',
    // Google service account used to write registrations to the Google Sheet chosen in the dashboard.
    // Either a path to the downloaded JSON key (relative to this folder) or the JSON itself.
    googleServiceAccountFile: env.GOOGLE_SERVICE_ACCOUNT_FILE ? path.resolve(PROJECT_ROOT, env.GOOGLE_SERVICE_ACCOUNT_FILE.trim()) : '',
    googleServiceAccountJson: (env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim(),
    sheetSyncIntervalMs: 60 * 1000, // retry pending rows this often
    templateMaxBytes: 10 * 1024 * 1024, // uploaded certificate templates
    // Rate limits (per client IP). Not exposed via env on purpose; tests override these.
    // Students at a college often share ONE public IP, so the success-path limits are generous.
    publicRateLimit: { max: 20, windowMs: 10 * 60 * 1000 }, // enquiry form submissions
    certRegisterRateLimit: { max: 300, windowMs: 10 * 60 * 1000 }, // certificate registration attempts
    // Wrong session codes (brute-force guard). A whole college shares one IP and some students mistype;
    // with 31^6 possible codes, 100 tries per 15 minutes is still hopeless for guessing.
    certCodeFailLimit: { max: 100, windowMs: 15 * 60 * 1000 },
    certVerifyRateLimit: { max: 60, windowMs: 60 * 1000 }, // certificate verification lookups
    certPdfRateLimit: { max: 300, windowMs: 10 * 60 * 1000 }, // public PDF downloads (CPU-bound)
    certResendCooldownMs: 10 * 60 * 1000, // at most one "already registered" re-send email per certificate per 10 min
    emailDailyLimit: 5, // emails per recipient address per local day, of every kind (emailQuota.js)
    // Profile verification codes (profileVerification.js).
    verificationCodeMinutes: 10,
    verificationMaxWrongCodes: 5, // then the record waits for staff
    verificationMaxCodes: 3, // codes sent per verification
    verificationResendAfterMs: 60 * 1000,
    verificationRateLimit: { max: 30, windowMs: 10 * 60 * 1000 }, // code checks and resends per IP
    loginRateLimit: { max: 5, windowMs: 15 * 60 * 1000 },
    loginIpRateLimit: { max: 30, windowMs: 15 * 60 * 1000 },
    bcryptRounds: 12,
    sessionHours: 8,
  };
}

module.exports = { loadConfig, parseTrustProxy, parseOrigins, parseDatabaseUrl, resolveDbPath, PROJECT_ROOT };
