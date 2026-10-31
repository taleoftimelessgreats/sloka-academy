'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument, StandardFonts, rgb, degrees } = require('pdf-lib');
const { isWinAnsi } = require('./validation');
const { localDate } = require('./util');

const LOGO_PATH = path.join(__dirname, '..', 'assets', 'certificate-logo.png');
let logoBytes = null;
const getLogo = () => (logoBytes ||= fs.readFileSync(LOGO_PATH));

const hex = (h) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const DARK = hex('#060608');
const RED = hex('#e3141b');
const INK = hex('#1b1b20');
const MUTED = hex('#5a5a63');
const FAINT = hex('#d9d6d2');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function longDate(ymd) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

// Replace anything the standard fonts cannot encode (defence in depth; inputs are validated).
function printable(s) {
  return [...String(s ?? '')].map((ch) => (isWinAnsi(ch) ? ch : '?')).join('');
}

function wrap(text, font, size, maxWidth) {
  const words = text.split(' ').filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    // A single word wider than the line: hard-break it.
    let rest = word;
    while (font.widthOfTextAtSize(rest, size) > maxWidth) {
      let cut = rest.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut--;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    line = rest;
  }
  if (line) lines.push(line);
  return lines;
}

/** Largest size in [min,max] at which `text` fits in `maxLines` lines; truncates with an ellipsis at `min`. */
function fitWrapped(text, font, { max, min, maxWidth, maxLines }) {
  for (let size = max; size >= min; size -= 0.5) {
    const lines = wrap(text, font, size, maxWidth);
    if (lines.length <= maxLines) return { size, lines };
  }
  const lines = wrap(text, font, min, maxWidth).slice(0, maxLines);
  let last = lines[maxLines - 1];
  while (last.length > 1 && font.widthOfTextAtSize(`${last}\u2026`, min) > maxWidth) last = last.slice(0, -1);
  lines[maxLines - 1] = `${last.trimEnd()}\u2026`;
  return { size: min, lines };
}

function fitSize(text, font, { max, min, maxWidth }) {
  let size = max;
  while (size > min && font.widthOfTextAtSize(text, size) > maxWidth) size -= 0.5;
  return size;
}

function verifyLink(base, id) {
  try {
    const u = new URL(base);
    u.searchParams.set('id', id);
    return u.toString();
  } catch {
    return `${base}?id=${id}`;
  }
}

const FONT_MAP = {
  helvetica: StandardFonts.Helvetica,
  'helvetica-bold': StandardFonts.HelveticaBold,
  'helvetica-oblique': StandardFonts.HelveticaOblique,
  times: StandardFonts.TimesRoman,
  'times-bold': StandardFonts.TimesRomanBold,
  'times-italic': StandardFonts.TimesRomanItalic,
  'times-bold-italic': StandardFonts.TimesRomanBoldItalic,
  courier: StandardFonts.Courier,
  'courier-bold': StandardFonts.CourierBold,
};

/** The text printed for each template field. */
function fieldText(id, data, config) {
  switch (id) {
    case 'name':
      return data.name;
    case 'college':
      return data.college || '';
    case 'sessionTitle':
      return data.sessionTitle;
    case 'sessionDate':
      return longDate(data.sessionDate);
    case 'venue':
      return data.mode === 'online' || !data.venue ? 'Online' : data.venue;
    case 'issueDate':
      return longDate(localDate(new Date(data.issuedAt)));
    case 'certificateId':
      return data.certificateId;
    case 'verifyUrl':
      return verifyLink(config.certVerifyUrl, data.certificateId);
    default:
      return '';
  }
}

/** Print the student's details onto an uploaded template (PDF page 1, or a PNG/JPEG background). */
async function renderOnTemplate(doc, data, config, template) {
  let page;
  if (template.fileType === 'pdf') {
    const src = await PDFDocument.load(template.file, { updateMetadata: false });
    const [bg] = await doc.embedPdf(src, [0]);
    page = doc.addPage([bg.width, bg.height]);
    page.drawPage(bg, { x: 0, y: 0, width: bg.width, height: bg.height });
  } else {
    const img = template.fileType === 'png' ? await doc.embedPng(template.file) : await doc.embedJpg(template.file);
    page = doc.addPage([template.pageWidth, template.pageHeight]);
    page.drawImage(img, { x: 0, y: 0, width: template.pageWidth, height: template.pageHeight });
  }
  const { width: W, height: H } = page.getSize();
  const fonts = new Map();
  for (const [id, field] of Object.entries(template.layout.fields)) {
    if (!field.show) continue;
    const value = fieldText(id, data, config);
    if (!value) continue;
    const text = printable(`${field.prefix || ''}${value}`);
    if (!fonts.has(field.font)) fonts.set(field.font, await doc.embedFont(FONT_MAP[field.font] || StandardFonts.Helvetica));
    const font = fonts.get(field.font);
    const maxWidth = (W * field.maxWidth) / 100;
    const size = fitSize(text, font, { max: field.size, min: Math.max(4, field.size * 0.4), maxWidth });
    let out = text;
    if (font.widthOfTextAtSize(out, size) > maxWidth) {
      while (out.length > 1 && font.widthOfTextAtSize(`${out}\u2026`, size) > maxWidth) out = out.slice(0, -1);
      out = `${out.trimEnd()}\u2026`;
    }
    const w = font.widthOfTextAtSize(out, size);
    const anchor = (W * field.x) / 100;
    const x = field.align === 'center' ? anchor - w / 2 : field.align === 'right' ? anchor - w : anchor;
    page.drawText(out, { x, y: H - (H * field.y) / 100, size, font, color: hex(field.color) });
  }
  return page;
}

/**
 * Render the certificate for one registration: on an uploaded template when given, otherwise the built-in design.
 * data: { certificateId, name, college?, sessionTitle, sessionDate, venue, mode, issuedAt, revoked?, preview? }
 * A revoked certificate is stamped REVOKED; a preview (before the certificate is issued) is stamped PREVIEW.
 */
async function renderCertificatePdf(data, config, template = null) {
  const doc = await PDFDocument.create();
  const name = printable(data.name);
  const title = printable(data.sessionTitle);
  const id = printable(data.certificateId);
  if (template) {
    const page = await renderOnTemplate(doc, data, config, template);
    await drawStamp(doc, page, data);
    return finish(doc, data, { name, title, id });
  }
  return renderBuiltIn(doc, data, config, { name, title, id });
}

async function drawStamp(doc, page, data) {
  const mark = data.revoked ? 'REVOKED' : data.preview ? 'PREVIEW' : null;
  if (!mark) return;
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const { width: W, height: H } = page.getSize();
  const size = Math.min(110, W / 6.5);
  const w = bold.widthOfTextAtSize(mark, size);
  const angle = 24;
  const rad = (angle * Math.PI) / 180;
  page.drawText(mark, {
    x: W / 2 - (w / 2) * Math.cos(rad) + size * 0.35 * Math.sin(rad),
    y: H / 2 - 60 - (w / 2) * Math.sin(rad),
    size,
    font: bold,
    color: RED,
    opacity: 0.18,
    rotate: degrees(angle),
  });
}

function finish(doc, data, { name, title, id }) {
  doc.setTitle(`Certificate of Participation - ${name}`);
  doc.setAuthor('Sloka Academy');
  doc.setSubject(`${title} (${id})`);
  doc.setCreator('Sloka Academy');
  doc.setProducer('Sloka Academy');
  doc.setKeywords([id]);
  doc.setCreationDate(new Date(data.issuedAt));
  doc.setModificationDate(new Date());
  return doc.save();
}

async function renderBuiltIn(doc, data, config, { name, title, id }) {
  const page = doc.addPage([841.89, 595.28]); // A4 landscape
  const { width: W, height: H } = page.getSize();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = await doc.embedPng(getLogo());

  const venue = printable(data.venue || '');
  const issued = longDate(localDate(new Date(data.issuedAt)));
  const held = data.mode === 'online' || !venue ? `held online on ${longDate(data.sessionDate)}.` : `held at ${venue} on ${longDate(data.sessionDate)}.`;

  const centered = (text, font, size, y, color) => {
    page.drawText(text, { x: (W - font.widthOfTextAtSize(text, size)) / 2, y, size, font, color });
  };

  // --- dark band with logo (the logo has white parts)
  const bandH = 118;
  page.drawRectangle({ x: 0, y: H - bandH, width: W, height: bandH, color: DARK });
  const logoH = 84;
  const logoW = (logo.width / logo.height) * logoH;
  page.drawImage(logo, { x: (W - logoW) / 2, y: H - bandH + (bandH - logoH) / 2, width: logoW, height: logoH });
  page.drawRectangle({ x: 0, y: H - bandH - 3, width: W, height: 3, color: RED });

  // --- frame on the white body
  const frameTop = H - bandH - 3 - 14;
  page.drawRectangle({ x: 20, y: 20, width: W - 40, height: frameTop - 20, borderColor: RED, borderWidth: 0.8 });
  page.drawRectangle({ x: 25, y: 25, width: W - 50, height: frameTop - 30, borderColor: FAINT, borderWidth: 0.5 });

  // --- heading, letter-spaced
  let y = frameTop - 62;
  const heading = 'CERTIFICATE OF PARTICIPATION';
  const hSize = 23;
  const spacing = 3.2;
  const hWidth = [...heading].reduce((w, ch) => w + bold.widthOfTextAtSize(ch, hSize), 0) + spacing * (heading.length - 1);
  let x = (W - hWidth) / 2;
  for (const ch of heading) {
    page.drawText(ch, { x, y, size: hSize, font: bold, color: DARK });
    x += bold.widthOfTextAtSize(ch, hSize) + spacing;
  }
  page.drawRectangle({ x: (W - 56) / 2, y: y - 16, width: 56, height: 2, color: RED });

  y -= 52;
  centered('This is to certify that', regular, 13, y, MUTED);

  // --- name: large, shrink to fit
  const maxWidth = W - 200;
  const nameSize = fitSize(name, bold, { max: 38, min: 14, maxWidth });
  y -= 54;
  centered(name, bold, nameSize, y, INK);
  const nameW = bold.widthOfTextAtSize(name, nameSize);
  const ruleW = Math.min(maxWidth, Math.max(260, nameW + 40));
  page.drawRectangle({ x: (W - ruleW) / 2, y: y - 13, width: ruleW, height: 1, color: RED });

  y -= 48;
  centered('participated in the career guidance session', regular, 13, y, MUTED);

  // --- session title in quotes, max 2 lines
  const t = fitWrapped(`\u201C${title}\u201D`, bold, { max: 19, min: 11, maxWidth: W - 220, maxLines: 2 });
  y -= 34;
  t.lines.forEach((line, i) => centered(line, bold, t.size, y - i * t.size * 1.3, INK));
  y -= (t.lines.length - 1) * t.size * 1.3;

  // --- venue + date, max 2 lines
  const h = fitWrapped(held, regular, { max: 13, min: 9, maxWidth: W - 220, maxLines: 2 });
  y -= 30;
  h.lines.forEach((line, i) => centered(line, regular, h.size, y - i * h.size * 1.35, MUTED));

  // --- footer left: ID, issue date, verification link
  const left = 56;
  const footMax = W / 2 - left - 10;
  const verify = printable(`Verify at ${verifyLink(config.certVerifyUrl, data.certificateId)}`);
  const footLines = [
    [`Certificate ID: ${id}`, bold],
    [`Issued: ${issued}`, regular],
    [verify, regular],
  ];
  const footSize = Math.min(...footLines.map(([s, f]) => fitSize(s, f, { max: 9.5, min: 6, maxWidth: footMax })));
  footLines.forEach(([s, f], i) => page.drawText(s, { x: left, y: 80 - i * 14, size: footSize, font: f, color: i === 0 ? INK : MUTED }));

  // --- footer right: signatory if configured, otherwise the academy name
  const right = W - 56;
  const sigName = printable(config.certSignatoryName || '');
  if (sigName) {
    const sigTitle = printable(config.certSignatoryTitle || '');
    const lineW = 180;
    const cx = right - lineW / 2;
    page.drawRectangle({ x: right - lineW, y: 92, width: lineW, height: 0.8, color: DARK });
    const sSize = fitSize(sigName, bold, { max: 11, min: 7, maxWidth: lineW + 40 });
    page.drawText(sigName, { x: cx - bold.widthOfTextAtSize(sigName, sSize) / 2, y: 76, size: sSize, font: bold, color: INK });
    if (sigTitle) {
      const tSize = fitSize(sigTitle, regular, { max: 9.5, min: 6, maxWidth: lineW + 40 });
      page.drawText(sigTitle, { x: cx - regular.widthOfTextAtSize(sigTitle, tSize) / 2, y: 62, size: tSize, font: regular, color: MUTED });
    }
    page.drawText('Sloka Academy', { x: cx - regular.widthOfTextAtSize('Sloka Academy', 9.5) / 2, y: 48, size: 9.5, font: regular, color: MUTED });
  } else {
    const s = 'Sloka Academy';
    page.drawText(s, { x: right - bold.widthOfTextAtSize(s, 13), y: 66, size: 13, font: bold, color: INK });
  }

  await drawStamp(doc, page, data);
  return finish(doc, data, { name, title, id });
}

/** Certificate data from a registration row (REG_SELECT) or its API shape. */
function certificateData(r) {
  if (r.certificate_id) {
    return {
      certificateId: r.certificate_id,
      name: r.name,
      college: r.college,
      sessionTitle: r.session_title,
      sessionDate: r.session_date,
      venue: r.session_venue,
      mode: r.session_mode,
      issuedAt: r.issued_at,
      revoked: r.status === 'revoked',
    };
  }
  return {
    certificateId: r.certificateId,
    name: r.name,
    college: r.college,
    sessionTitle: r.session.title,
    sessionDate: r.session.sessionDate,
    venue: r.session.venue,
    mode: r.session.mode,
    issuedAt: r.issuedAt,
    revoked: r.status === 'revoked',
  };
}

module.exports = { renderCertificatePdf, certificateData, longDate, verifyLink };
