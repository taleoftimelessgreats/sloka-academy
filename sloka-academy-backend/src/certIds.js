'use strict';

const crypto = require('node:crypto');

// Session codes are read out loud: no 0/O/1/I/L.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
// Crockford base32 (no I, L, O, U).
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function randomString(alphabet, length) {
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[crypto.randomInt(alphabet.length)];
  return out;
}

const generateSessionCode = () => randomString(CODE_ALPHABET, 6);

function generateCertificateId(prefix, year) {
  return `${prefix}-${year}-${randomString(CROCKFORD, 8)}`;
}

/** Normalise a user-typed certificate ID: trim, upper-case, and map Crockford look-alikes in the random part. */
function normalizeCertificateId(raw) {
  if (typeof raw !== 'string') return '';
  const s = raw.trim().toUpperCase();
  if (s.length > 40) return '';
  const parts = s.split('-');
  if (parts.length === 3) parts[2] = parts[2].replace(/O/g, '0').replace(/[IL]/g, '1');
  return parts.join('-');
}

const sha256 = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest();

/** Constant-time string comparison (hashing first makes lengths equal). */
function safeEqual(a, b) {
  return crypto.timingSafeEqual(sha256(a), sha256(b));
}

function normalizeCode(raw) {
  return typeof raw === 'string' ? raw.trim().toUpperCase() : '';
}

function codesMatch(submitted, stored) {
  const a = normalizeCode(submitted);
  const b = normalizeCode(stored);
  // Always run the comparison so timing does not depend on whether a code was submitted.
  return safeEqual(a, b) && a.length > 0;
}

/** Returns { token, hash }: the token goes to the student, only the hash is stored. */
function newDownloadToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: sha256(token).toString('hex') };
}

function tokenMatches(token, storedHashHex) {
  if (typeof token !== 'string' || !token || token.length > 100 || typeof storedHashHex !== 'string') {
    // Still do a comparison so the response time is similar.
    safeEqual('x', 'y');
    return false;
  }
  const got = sha256(token);
  const want = Buffer.from(storedHashHex, 'hex');
  return want.length === got.length && crypto.timingSafeEqual(got, want);
}

module.exports = {
  CODE_ALPHABET,
  CROCKFORD,
  generateSessionCode,
  generateCertificateId,
  normalizeCertificateId,
  normalizeCode,
  codesMatch,
  newDownloadToken,
  tokenMatches,
  safeEqual,
};
