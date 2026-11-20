'use strict';

const C = require('./constants');
const { renderInvoicePdf, money } = require('./invoicePdf');
const { longDate } = require('./certificatePdf');
const { localDate } = require('./util');

/**
 * Invoices: one per registration (number SLK/INV/<year>/0001, counted per year, never reused). The PDF is drawn
 * from the payment ledger each time, so it always shows every payment, the total paid and the balance; after a
 * payment the updated invoice is emailed to the student.
 */
function createInvoices({ db, config, offerLetters, notifier }) {
  const now = () => new Date().toISOString();
  const termsUrl = `${String(config.siteUrl || '').replace(/\/+$/, '')}/terms/`;

  /** The registration's invoice number, giving it one first if it has none. Null if there is no such registration. */
  function number(enrollmentId) {
    return db.transaction(async () => {
      const e = await db.get('SELECT invoice_code, registration_date FROM enrollments WHERE id = ? FOR UPDATE', [enrollmentId]);
      if (!e) return null;
      if (e.invoice_code) return e.invoice_code;
      const year = e.registration_date.slice(0, 4);
      await db.run('INSERT INTO id_sequences (name, value) VALUES (?, 1) ON DUPLICATE KEY UPDATE value = value + 1', [`invoice:${year}`]);
      const { value } = await db.get('SELECT value FROM id_sequences WHERE name = ?', [`invoice:${year}`]);
      const code = `${config.certIdPrefix}/INV/${year}/${String(value).padStart(4, '0')}`;
      await db.run('UPDATE enrollments SET invoice_code = ? WHERE id = ?', [code, enrollmentId]);
      return code;
    });
  }

  /** Everything the invoice shows, or null. */
  async function load(enrollmentId) {
    const code = await number(enrollmentId);
    if (!code) return null;
    const [e, payments] = await Promise.all([
      db.get(
        `SELECT e.*, st.name, st.student_code, st.college, st.phone, st.email, c.name AS course_name, c.duration
        FROM enrollments e JOIN students st ON st.id = e.student_id JOIN courses c ON c.id = e.course_id WHERE e.id = ?`,
        [enrollmentId],
      ),
      db.all('SELECT * FROM payments WHERE enrollment_id = ? ORDER BY paid_on, id', [enrollmentId]),
    ]);
    // Dated when the ledger last changed, so the same payments always give the same invoice.
    const changed = payments.reduce((latest, p) => (p.updated_at > latest ? p.updated_at : latest), e.created_at);
    return {
      row: e,
      invoice: {
        number: code,
        date: longDate(localDate(new Date(changed))),
        student: { name: e.name, code: e.student_code, college: e.college, phone: e.phone, email: e.email },
        programme: 'Internship Course Program',
        domain: e.course_name,
        duration: e.duration,
        registrationDate: longDate(e.registration_date),
        feePaise: e.fee_paise,
        paidPaise: e.paid_paise,
        dueDate: e.balance_due_date ? longDate(e.balance_due_date) : null,
        payments: payments.map((p) => ({
          date: longDate(p.paid_on),
          description: p.kind === 'token' ? 'Registration amount' : 'Instalment',
          mode: C.label('paymentMode', p.mode).replace(/\s*\(.*\)$/, ''),
          reference: p.reference,
          amountPaise: p.amount_paise,
        })),
      },
    };
  }

  /** The invoice as a PDF: { pdf, code }, or null. */
  async function render(enrollmentId) {
    const data = await load(enrollmentId);
    if (!data) return null;
    const head = await offerLetters.letterheadInfo();
    const pdf = await renderInvoicePdf(data.invoice, config, {
      head: { ...head, address: head.address.split('\n').map((l) => l.trim()).filter(Boolean) },
      policy: C.PAYMENT_POLICY,
      termsUrl,
    });
    return { pdf, code: data.invoice.number, data };
  }

  const emailEnabled = () => Boolean(notifier && notifier.studentEmailEnabled);

  /**
   * Email the up-to-date invoice to the student. Resolves to 'sent', 'failed' (the reason is kept with the
   * registration) or 'off' (email is not set up: nothing is recorded, staff download the PDF instead).
   */
  async function send(enrollmentId) {
    const made = await render(enrollmentId);
    if (!made) return null;
    if (!emailEnabled()) return 'off';
    const { invoice } = made.data;
    try {
      if (!invoice.student.email) throw new Error('The student has no email address.');
      await notifier.sendInvoice({
        to: invoice.student.email,
        name: invoice.student.name,
        programme: `${invoice.programme} in ${invoice.domain}`,
        invoiceNumber: invoice.number,
        fee: money(invoice.feePaise),
        paid: money(invoice.paidPaise),
        balance: money(Math.max(0, invoice.feePaise - invoice.paidPaise)),
        fullyPaid: invoice.paidPaise >= invoice.feePaise,
        dueDate: invoice.dueDate,
        policy: C.PAYMENT_POLICY,
        termsUrl,
        pdf: made.pdf,
      });
      await db.run("UPDATE enrollments SET invoice_status = 'sent', invoice_error = NULL, invoice_sent_at = ? WHERE id = ?", [now(), enrollmentId]);
      return 'sent';
    } catch (err) {
      await db.run("UPDATE enrollments SET invoice_status = 'failed', invoice_error = ? WHERE id = ?", [String(err.message || err).slice(0, 300), enrollmentId]);
      return 'failed';
    }
  }

  return { number, render, send, emailEnabled };
}

module.exports = { createInvoices };
