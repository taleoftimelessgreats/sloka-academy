'use strict';

const { renderCertificatePdf, certificateData, verifyLink } = require('./certificatePdf');

const downloadPath = (certId, token) => `/api/public/certificates/${encodeURIComponent(certId)}/pdf?token=${encodeURIComponent(token)}`;

// Mail server errors can echo addresses and credentials hints; keep what staff need to act on.
function shortError(err) {
  const msg = String((err && (err.response || err.message)) || 'Unknown error').replace(/\s+/g, ' ').trim();
  return msg.length > 300 ? `${msg.slice(0, 297)}...` : msg;
}

/**
 * Generates certificate PDFs and emails them to students, recording the delivery state on the
 * registration (pending → sent | failed, or off when email is not configured).
 */
function createCertificateDelivery({ config, certRepo, templateRepo, notifier, logger = console, background = null }) {
  const inFlight = new Set();
  const enabled = () => Boolean(notifier && notifier.studentEmailEnabled && typeof notifier.sendCertificate === 'function');

  /** PDF bytes for a registration row (REG_SELECT), using the template it was issued with. */
  async function render(row) {
    const template = row.template_id ? await templateRepo.forRender(row.template_id) : null;
    return Buffer.from(await renderCertificatePdf(certificateData(row), config, template));
  }

  /**
   * Email the certificate to the address on the registration. `token` is the download token from
   * issuing; without one a fresh link is created (older links stop working). Never throws.
   * Resolves to 'sent' | 'failed' | 'off' | 'skipped'.
   */
  function deliver(regId, opts = {}) {
    const job = attempt(regId, opts).catch((err) => {
      logger.error(`[delivery] registration #${regId}: ${err.message}`);
      return 'failed';
    });
    inFlight.add(job);
    job.then(() => inFlight.delete(job));
    background?.(job); // some callers respond before the email is sent
    return job;
  }

  async function attempt(regId, { token = null, actorId = null, resent = false }) {
    const row = await certRepo.getRegRow(regId);
    if (!row || row.status === 'revoked') return 'skipped';
    if (!enabled()) {
      await certRepo.setEmailStatus(regId, 'off');
      return 'off';
    }
    await certRepo.setEmailStatus(regId, 'pending');
    try {
      const pdf = await render(row);
      const link = token || (await certRepo.rotateToken(regId, actorId));
      await notifier.sendCertificate({
        to: row.email,
        name: row.name,
        certificateId: row.certificate_id,
        studentId: row.student_code,
        sessionTitle: row.session_title,
        pdf,
        downloadUrl: `${config.publicApiUrl}${downloadPath(row.certificate_id, link)}`,
        verifyUrl: verifyLink(config.certVerifyUrl, row.certificate_id),
        resent,
      });
      await certRepo.setEmailStatus(regId, 'sent', { actorId, detail: `Certificate emailed to ${row.email} (PDF attached)` });
      return 'sent';
    } catch (err) {
      const reason = shortError(err);
      logger.error(`[delivery] certificate email failed for ${row.certificate_id}: ${reason}`);
      await certRepo.setEmailStatus(regId, 'failed', { error: reason, actorId });
      return 'failed';
    }
  }

  return {
    enabled,
    render,
    deliver,
    /** Resolves once every delivery started so far has finished (tests, shutdown). */
    idle: () => Promise.allSettled([...inFlight]),
  };
}

module.exports = { createCertificateDelivery, downloadPath };
