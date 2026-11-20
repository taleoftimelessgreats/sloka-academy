'use strict';

const { PDFDocument } = require('pdf-lib');
const { printable } = require('./certificatePdf');
const { letterhead, letterheadAssets, pageNumbers, drawSpaced, A4, MARGIN_X, COLOURS } = require('./offerLetterPdf');

/**
 * The invoice of a registration, on the academy's letterhead: who it is billed to, every payment received, the
 * total paid and the outstanding balance, and the payment policy. It is drawn from the payment ledger each time,
 * so it is always up to date.
 */

const { INK, ACCENT, MUTED, HAIRLINE, PANEL } = COLOURS;

/** Paise as "Rs. 14,999.00" (the PDF's standard fonts have no rupee sign). */
const money = (paise) => `Rs. ${(Math.round(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * invoice: { number, date, student: { name, code, college, phone, email }, programme, domain, duration, registrationDate,
 *   feePaise, paidPaise, dueDate, payments: [{ date, description, mode, reference, amountPaise }] } (dates as text);
 * head: the letterhead's contacts; policy: [clauses]; termsUrl.
 */
async function renderInvoicePdf(invoice, config, { head, policy = [], termsUrl = '' } = {}) {
  const doc = await PDFDocument.create();
  const assets = await letterheadAssets(doc);
  const { regular, bold } = assets;
  const [W, H] = A4;
  const left = MARGIN_X;
  const right = W - MARGIN_X;
  const width = right - left;
  const contacts = {
    address: (head && head.address) || [],
    email: head && head.email,
    phone: head && head.phone,
    website: String(config.siteUrl || '').replace(/^https?:\/\//, '').replace(/\/$/, ''),
  };
  const meta = { ref: invoice.number, date: invoice.date };
  const pages = [];
  const top = H - H * 0.174;
  const bottom = 74;
  let page;
  let y;
  const newPage = async () => {
    page = await letterhead(doc, assets, contacts, meta);
    pages.push(page);
    y = top - 12;
  };
  const text = (s, x, yy, { size = 9.5, font = regular, color = INK, align = 'left' } = {}) => {
    const t = printable(s ?? '');
    const w = font.widthOfTextAtSize(t, size);
    page.drawText(t, { x: align === 'right' ? x - w : x, y: yy, size, font, color });
    return w;
  };
  /** Text cut with an ellipsis to fit maxWidth. */
  const fit = (s, font, size, maxWidth) => {
    let t = printable(s ?? '');
    while (t.length > 1 && font.widthOfTextAtSize(t, size) > maxWidth) t = `${t.slice(0, -2)}…`;
    return t;
  };
  const heading = (label) => {
    const hw = drawSpaced(page, label, { x: left, y, size: 8.2, font: bold, color: ACCENT, tracking: 0.085 });
    page.drawRectangle({ x: left + hw + 8, y: y + 2.6, width: width - hw - 8, height: 0.5, color: HAIRLINE });
    y -= 17;
  };

  await newPage();

  // Title.
  const title = 'INVOICE';
  const tw = drawSpaced(page, title, { x: 0, y, size: 14, font: bold, color: INK, tracking: 0.085, measure: true });
  drawSpaced(page, title, { x: left + (width - tw) / 2, y, size: 14, font: bold, color: INK, tracking: 0.085 });
  page.drawRectangle({ x: W / 2 - 22, y: y - 9, width: 44, height: 1.6, color: ACCENT });
  y -= 36;

  // Billed to (left) and the registration (right).
  const blockTop = y;
  text('BILLED TO', left, y, { size: 7.5, font: bold, color: MUTED });
  y -= 14;
  text(fit(invoice.student.name, bold, 11, width * 0.46), left, y, { size: 11, font: bold });
  y -= 13.5;
  for (const line of [invoice.student.code && `Student ID: ${invoice.student.code}`, invoice.student.college, invoice.student.phone, invoice.student.email].filter(Boolean)) {
    text(fit(line, regular, 9.2, width * 0.46), left, y, { size: 9.2, color: MUTED });
    y -= 12.5;
  }
  let ry = blockTop;
  const labelX = left + width * 0.5;
  for (const [label, value] of [
    ['Programme', invoice.programme],
    ['Domain', invoice.domain],
    ['Duration', invoice.duration],
    ['Registered on', invoice.registrationDate],
  ]) {
    if (!value) continue;
    text(label, labelX, ry, { size: 8.5, color: MUTED });
    text(fit(value, bold, 9.2, right - labelX - 74), right, ry, { size: 9.2, font: bold, align: 'right' });
    ry -= 14;
  }
  y = Math.min(y, ry) - 12;

  // Payment history.
  heading('PAYMENT HISTORY');
  const cols = { no: left + 8, date: left + 30, desc: left + 122, mode: left + 232, ref: left + 312, amount: right - 8 };
  const header = () => {
    page.drawRectangle({ x: left, y: y - 6, width, height: 19, color: PANEL });
    page.drawRectangle({ x: left, y: y - 6, width: 2.2, height: 19, color: ACCENT });
    for (const [label, x, align] of [['#', cols.no], ['DATE', cols.date], ['DESCRIPTION', cols.desc], ['MODE', cols.mode], ['REFERENCE', cols.ref], ['AMOUNT', cols.amount, 'right']]) {
      text(label, x, y, { size: 7.2, font: bold, color: MUTED, align });
    }
    y -= 22;
  };
  header();
  for (const [i, p] of invoice.payments.entries()) {
    if (y < bottom + 20) {
      await newPage();
      header();
    }
    text(String(i + 1), cols.no, y, { size: 9, color: MUTED });
    text(p.date, cols.date, y, { size: 9 });
    text(fit(p.description, regular, 9, cols.mode - cols.desc - 8), cols.desc, y, { size: 9 });
    text(fit(p.mode, regular, 9, cols.ref - cols.mode - 8), cols.mode, y, { size: 9 });
    text(fit(p.reference || '-', regular, 9, cols.amount - cols.ref - 70), cols.ref, y, { size: 9, color: p.reference ? INK : MUTED });
    text(money(p.amountPaise), cols.amount, y, { size: 9, font: bold, align: 'right' });
    page.drawRectangle({ x: left, y: y - 6.5, width, height: 0.4, color: HAIRLINE });
    y -= 19;
  }
  y -= 8;

  // Summary: fee, total paid, outstanding balance.
  if (y < bottom + 150) await newPage();
  const balance = invoice.feePaise - invoice.paidPaise;
  const boxW = 236;
  const boxX = right - boxW;
  const boxH = 78;
  page.drawRectangle({ x: boxX, y: y - boxH + 12, width: boxW, height: boxH, color: PANEL });
  page.drawRectangle({ x: boxX, y: y - boxH + 12, width: 2.2, height: boxH, color: ACCENT });
  let sy = y - 6;
  for (const [label, value] of [['Programme fee', money(invoice.feePaise)], ['Total amount paid', money(invoice.paidPaise)]]) {
    text(label, boxX + 14, sy, { size: 9.2, color: MUTED });
    text(value, right - 12, sy, { size: 9.5, font: bold, align: 'right' });
    sy -= 18;
  }
  page.drawRectangle({ x: boxX + 14, y: sy + 11, width: boxW - 26, height: 0.5, color: HAIRLINE });
  sy -= 3;
  text('Outstanding balance', boxX + 14, sy, { size: 9.8, font: bold });
  text(money(Math.max(0, balance)), right - 12, sy, { size: 11.5, font: bold, color: balance > 0 ? ACCENT : INK, align: 'right' });
  // Beside the box: what the balance means.
  text(balance > 0 ? 'BALANCE DUE' : 'PAID IN FULL', left, y - 6, { size: 10.5, font: bold, color: balance > 0 ? ACCENT : INK });
  text(
    balance > 0 ? (invoice.dueDate ? `Please pay the balance by ${invoice.dueDate}.` : 'Please pay the balance as agreed.') : 'Thank you. No amount is outstanding.',
    left, y - 21, { size: 9.2, color: MUTED },
  );
  y -= boxH + 14;

  // The payment policy and notes.
  heading('TERMS');
  const notes = [
    ...policy,
    'This invoice is updated after every payment and replaces any earlier copy.',
    'This is a computer-generated document and does not require a signature.',
    termsUrl && `Terms & Conditions: ${termsUrl.replace(/^https?:\/\//, '')}`,
  ].filter(Boolean);
  notes.forEach((note, i) => {
    const strong = i < policy.length;
    page.drawRectangle({ x: left + 2, y: y + 2.4, width: 3, height: 3, color: strong ? ACCENT : HAIRLINE });
    text(note, left + 12, y, { size: 9, font: strong ? bold : regular, color: strong ? INK : MUTED });
    y -= 13.5;
  });

  pageNumbers(pages, assets, invoice.number);
  doc.setTitle(`Invoice ${printable(invoice.number)} - ${printable(invoice.student.name)}`);
  doc.setAuthor('Sloka Academy');
  doc.setSubject(`Invoice ${printable(invoice.number)}`);
  doc.setCreator('Sloka Academy');
  doc.setProducer('Sloka Academy');
  return Buffer.from(await doc.save());
}

module.exports = { renderInvoicePdf, money };
