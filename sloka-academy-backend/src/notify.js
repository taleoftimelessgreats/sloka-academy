'use strict';

const { label } = require('./constants');
const { EmailLimitError } = require('./emailQuota');

// Slack / Google Chat treat <...> as links and mentions (e.g. <!channel>); neutralise them.
const escapeChat = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inquiryLink(dashboardUrl, id) {
  const base = String(dashboardUrl || '').replace(/#.*$/, '');
  return `${base}#/enquiries/${id}`;
}

// Deliberately excludes the enquirer's message, phone and email.
function summaryLines(inquiry) {
  return [
    ['Name', inquiry.name],
    ['Source', label('source', inquiry.source)],
    ['Stream', label('stream', inquiry.stream) || '-'],
    ['Domain', inquiry.domain || '-'],
    ['Plan', label('plan', inquiry.plan) || '-'],
  ];
}

/**
 * Team notifications (email and chat webhook) and student emails.
 * quota: the daily per-recipient email limit (emailQuota.js); every email passes it before sending.
 * transport: a nodemailer-style { sendMail } to use instead of SMTP (tests).
 * background: receives promises for work that outlives the request (serverless.js); optional.
 */
function createNotifier(config, { logger = console, quota = null, transport = null, background = null } = {}) {
  // SMTP + sender are enough to email students; team notifications also need NOTIFY_TO.
  const smtpReady = Boolean(config.smtp && config.smtp.host && config.smtp.port && config.smtp.user && config.smtp.pass && config.notifyFrom);
  const emailEnabled = smtpReady && Boolean(config.notifyTo);
  const webhookUrl = config.notifyWebhookUrl || '';

  if (smtpReady && !transport) {
    const nodemailer = require('nodemailer');
    const secure = config.smtp.port === 465;
    transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure,
      requireTLS: !secure, // never send credentials over plaintext
      auth: { user: config.smtp.user, pass: config.smtp.pass },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
  }

  /**
   * The only place an email leaves the server. Recipients who have had today's emails are dropped;
   * if none are left, rejects with EmailLimitError and nothing is sent.
   */
  async function send(message) {
    if (!quota) return transport.sendMail(message);
    const reservation = await quota.reserve(message.to);
    if (!reservation.allowed.length) throw new EmailLimitError(String(message.to).split(',').map((a) => a.trim()), quota.limit);
    try {
      return await transport.sendMail({ ...message, to: reservation.allowed.join(', ') });
    } catch (err) {
      await quota.release(reservation).catch(() => {});
      throw err;
    }
  }

  async function sendEmail(inquiry) {
    const link = inquiryLink(config.dashboardUrl, inquiry.id);
    const lines = summaryLines(inquiry).map(([k, v]) => `${k}: ${v}`);
    await send({
      from: config.notifyFrom,
      to: config.notifyTo,
      subject: `New enquiry: ${inquiry.name} (${label('source', inquiry.source)})`,
      text: `A new enquiry has arrived.\n\n${lines.join('\n')}\n\nOpen in dashboard: ${link}\n`,
    });
  }

  async function sendWebhook(inquiry) {
    const link = inquiryLink(config.dashboardUrl, inquiry.id);
    const parts = summaryLines(inquiry).map(([k, v]) => `${k}: ${escapeChat(v)}`);
    const text = `New enquiry\n${parts.join('\n')}\n${link}`;
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
    });
    if (!res.ok) throw new Error(`webhook responded ${res.status}`);
  }

  return {
    emailEnabled,
    webhookEnabled: Boolean(webhookUrl),
    // Fire-and-forget: never throws, never delays the caller.
    inquiryCreated(inquiry) {
      if (!emailEnabled && !webhookUrl) {
        logger.log(`[notify] New enquiry #${inquiry.id} (${inquiry.source}); no email or webhook notification configured.`);
        return;
      }
      const work = new Promise((resolve) => setImmediate(resolve)).then(() =>
        Promise.allSettled([
          emailEnabled &&
            sendEmail(inquiry).catch((err) => logger.error(`[notify] email failed for enquiry #${inquiry.id}: ${err.message}`)),
          webhookUrl &&
            sendWebhook(inquiry).catch((err) => logger.error(`[notify] webhook failed for enquiry #${inquiry.id}: ${err.message}`)),
        ]),
      );
      background?.(work);
    },

    // ---- certificates: emails go to the STUDENT only (no team notification for registrations)
    studentEmailEnabled: smtpReady,
    /**
     * Email the certificate PDF as an attachment, plus a personal download link. Resolves when the mail
     * server accepts it; rejects with the reason otherwise.
     * c: { to, name, certificateId, studentId?, sessionTitle, pdf (Buffer), downloadUrl, verifyUrl, resent }
     */
    async sendCertificate(c) {
      if (!smtpReady) throw new Error('Email is not configured on the server.');
      const subject = c.resent
        ? `Your Sloka Academy certificate (${c.certificateId}), sent again`
        : `Your Sloka Academy certificate of participation (${c.certificateId})`;
      const text = [
        `Hi ${c.name},`,
        '',
        c.resent
          ? `As requested, here is your certificate of participation for "${c.sessionTitle}" again. It is attached to this email as a PDF.`
          : `Thank you for attending "${c.sessionTitle}". Your certificate of participation is attached to this email as a PDF.`,
        '',
        `You can also download it here (personal link, please don't share it):`,
        c.downloadUrl,
        '',
        `Certificate ID: ${c.certificateId}`,
        `Anyone can check it is genuine at: ${c.verifyUrl}`,
        ...(c.studentId ? ['', `Your Sloka Academy Student ID: ${c.studentId}`, 'Please keep it for future registrations with us.'] : []),
        '',
        'Sloka Academy',
      ].join('\n');
      await send({
        from: config.notifyFrom,
        to: c.to,
        subject,
        text,
        attachments: [{ filename: `Sloka-Academy-Certificate-${c.certificateId}.pdf`, content: c.pdf, contentType: 'application/pdf' }],
      });
    },

    /**
     * The one-time code that confirms a student's changed details. Goes to the address already on their
     * profile. v: { to, name, code, minutes, what } (what: e.g. "a Career Guidance registration")
     */
    async sendVerificationCode(v) {
      if (!smtpReady) throw new Error('Email is not configured on the server.');
      const text = [
        `Hi ${v.name},`,
        '',
        `Someone, hopefully you, submitted ${v.what} to Sloka Academy with details that differ from your student profile.`,
        '',
        `To confirm it was you and update your profile, enter this code on the form: ${v.code}`,
        '',
        `The code expires in ${v.minutes} minutes.`,
        "If this wasn't you, ignore this email. Your profile will not change.",
        '',
        'Sloka Academy',
      ].join('\n');
      await send({ from: config.notifyFrom, to: v.to, subject: 'Your Sloka Academy verification code', text });
    },

    /**
     * An associate's sign-in details: a new account (kind 'invite') or a password reset ('reset').
     * a: { to, name, password, roleName, loginUrl, kind }. They must choose their own password when they sign in.
     */
    async sendAssociateInvite(a) {
      if (!smtpReady) throw new Error('Email is not configured on the server.');
      const text = [
        `Hi ${a.name},`,
        '',
        a.kind === 'reset'
          ? 'Your password for the Sloka Academy admin portal has been reset.'
          : `An account has been created for you on the Sloka Academy admin portal (role: ${a.roleName}).`,
        '',
        `Sign in at: ${a.loginUrl}`,
        `Email: ${a.to}`,
        `Temporary password: ${a.password}`,
        '',
        'You will be asked to choose your own password when you sign in. Do not share this email.',
        '',
        'Sloka Academy',
      ].join('\n');
      const subject = a.kind === 'reset' ? 'Your Sloka Academy portal password was reset' : 'Your Sloka Academy admin portal account';
      await send({ from: config.notifyFrom, to: a.to, subject, text });
    },

    /**
     * The updated invoice after a payment, as a PDF attachment. i: { to, name, programme, invoiceNumber, fee, paid,
     * balance, fullyPaid, dueDate, policy: [clauses], termsUrl, pdf }
     */
    async sendInvoice(i) {
      if (!smtpReady) throw new Error('Email is not configured on the server.');
      const text = [
        `Dear ${i.name},`,
        '',
        `Thank you for your payment. Your updated invoice (${i.invoiceNumber}) for the ${i.programme} is attached to this email as a PDF, with your full payment history.`,
        '',
        `Programme fee: ${i.fee}`,
        `Total amount paid: ${i.paid}`,
        `Outstanding balance: ${i.balance}${i.fullyPaid ? ' (paid in full)' : i.dueDate ? ` (due by ${i.dueDate})` : ''}`,
        '',
        ...i.policy,
        `Terms & Conditions: ${i.termsUrl}`,
        '',
        'If anything on the invoice is not right, please reply to this email.',
        '',
        'Warm regards,',
        'Sloka Academy',
      ].join('\n');
      await send({
        from: config.notifyFrom,
        to: i.to,
        subject: `Your Sloka Academy invoice ${i.invoiceNumber}: ${i.fullyPaid ? 'paid in full' : `balance ${i.balance}`}`,
        text,
        attachments: [{ filename: `Invoice-${i.invoiceNumber.replace(/\//g, '-')}.pdf`, content: i.pdf, contentType: 'application/pdf' }],
      });
    },

    /** The internship offer letter, as a PDF attachment. o: { to, name, courseDomain, offerLetterId, pdf } */
    async sendOfferLetter(o) {
      if (!smtpReady) throw new Error('Email is not configured on the server.');
      const text = [
        `Dear ${o.name},`,
        '',
        `Congratulations! We are delighted to offer you an internship in ${o.courseDomain} at Sloka Academy${o.startDate ? `, commencing on ${o.startDate}` : ''}.`,
        '',
        `Your offer letter (Ref. ${o.offerLetterId}) is attached to this email as a PDF. Please read it carefully${o.hrEmail ? ` and confirm your acceptance by writing to ${o.hrEmail}, quoting the reference number` : ''}.`,
        '',
        'We look forward to welcoming you.',
        '',
        ...(o.termsUrl ? [`Terms & Conditions: ${o.termsUrl}`] : []),
        '',
        'Warm regards,',
        ...(o.signatory ? [o.signatory] : []),
        ...(o.designation ? [o.designation] : []),
        'Sloka Academy',
      ].join('\n');
      await send({
        from: config.notifyFrom,
        to: o.to,
        subject: `Your offer letter: internship in ${o.courseDomain}, Sloka Academy (${o.offerLetterId})`,
        text,
        attachments: [{ filename: `Offer-Letter-${o.offerLetterId.replace(/\//g, '-')}.pdf`, content: o.pdf, contentType: 'application/pdf' }],
      });
    },
  };
}

module.exports = { createNotifier, inquiryLink, escapeChat };
