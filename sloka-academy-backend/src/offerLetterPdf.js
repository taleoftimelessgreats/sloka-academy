'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument, StandardFonts, rgb, setCharacterSpacing } = require('pdf-lib');
const { printable, drawStamp } = require('./certificatePdf');
const { drawMappings } = require('./placeholders');

/**
 * Offer letter PDFs, on the same engine as the certificates (pdf-lib, standard fonts, the Sloka logo).
 * A letter is: a page (the built-in letterhead, or an uploaded background) + the letter text + any placeholders
 * mapped in an uploaded document. An uploaded document with no body text is used as the letter itself ("document
 * mode").
 *
 * The letter text: paragraphs separated by blank lines, with {{placeholders}} and **bold**, and a few line marks:
 *   # Title                  the letter's title, centred, with an accent rule
 *   ## Heading               a section heading
 *   | Label | Value |        consecutive rows make a details panel
 *   ---                      space (e.g. for a signature)
 */

const A4 = [595.28, 841.89];
const INK = rgb(27 / 255, 27 / 255, 32 / 255);
const ACCENT = rgb(190 / 255, 18 / 255, 28 / 255); // the brand red, deep enough for print
const MUTED = rgb(98 / 255, 98 / 255, 108 / 255);
const HAIRLINE = rgb(0.82, 0.81, 0.79);
const PANEL = rgb(0.965, 0.957, 0.945);

const FONT_PAIRS = {
  helvetica: [StandardFonts.Helvetica, StandardFonts.HelveticaBold],
  times: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold],
};

// The Sloka logo for light paper: the red S and "Sloka", the outlined A and "Academy" in ink
// (assets/certificate-logo.png is drawn for dark backgrounds).
const LOGO_PATH = path.join(__dirname, '..', 'assets', 'letterhead-logo.png');
let logoBytes = null;
const getLetterheadLogo = () => (logoBytes ||= fs.readFileSync(LOGO_PATH));

const hex = (h) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);

/** "**a** b" -> [{ text, bold }], placeholders filled in after the bold marks are read (a value cannot switch bold). */
function segmentsOf(text, fill) {
  const segments = [];
  text.split('**').forEach((part, i) => {
    if (part) segments.push({ text: fill(part), bold: i % 2 === 1 });
  });
  return segments;
}

/**
 * Body text -> blocks: { type: 'para', lines: [segments] } | { type: 'title', text } | { type: 'heading', text } |
 * { type: 'table', rows: [{ label: segments, value: segments }] } | { type: 'gap' }.
 */
function parseBody(body, values) {
  const fill = (s) => s.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, key) => (Object.hasOwn(values, key) ? printable(values[key] ?? '') : m));
  const plain = (s) => fill(s.replace(/\*\*/g, ''));
  const blocks = [];
  for (const para of body.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/)) {
    let lines = [];
    let table = null;
    const flush = () => {
      if (lines.length) blocks.push({ type: 'para', lines });
      lines = [];
    };
    for (const raw of para.split('\n')) {
      const t = raw.trim();
      if (/^\|.*\|$/.test(t) && t.length > 2) {
        flush();
        const cells = t.slice(1, -1).split('|').map((c) => c.trim());
        const row = { label: segmentsOf(cells[0], fill), value: segmentsOf(cells.slice(1).join(' | '), fill) };
        if (table) table.rows.push(row);
        else blocks.push((table = { type: 'table', rows: [row] }));
        continue;
      }
      table = null;
      if (/^##\s+/.test(t)) {
        flush();
        blocks.push({ type: 'heading', text: plain(t.replace(/^##\s+/, '')) });
      } else if (/^#\s+/.test(t)) {
        flush();
        blocks.push({ type: 'title', text: plain(t.replace(/^#\s+/, '')) });
      } else if (t === '---') {
        flush();
        blocks.push({ type: 'gap' });
      } else lines.push(segmentsOf(raw, fill));
    }
    flush();
  }
  return blocks;
}

/** Words of a line with their fonts, wrapped to maxWidth. Resolves to lines of [{ text, font, width }]. */
function wrapLine(segments, fonts, size, maxWidth) {
  const words = [];
  for (const seg of segments) {
    const font = seg.bold ? fonts.bold : fonts.regular;
    // Keep where the spaces were, so "Dear {{student_name}}," keeps its comma attached.
    for (const [i, part] of seg.text.split(' ').entries()) {
      if (i > 0) words.push({ space: true });
      if (part) words.push({ text: part, font });
    }
  }
  const lines = [];
  let line = [];
  let width = 0;
  const space = fonts.regular.widthOfTextAtSize(' ', size);
  let pendingSpace = false;
  for (const w of words) {
    if (w.space) {
      pendingSpace = line.length > 0;
      continue;
    }
    let ww = w.font.widthOfTextAtSize(w.text, size);
    const gap = pendingSpace ? space : 0;
    if (line.length && width + gap + ww > maxWidth) {
      lines.push(line);
      line = [];
      width = 0;
    } else if (gap) {
      line.push({ text: ' ', font: fonts.regular, width: space });
      width += space;
    }
    pendingSpace = false;
    // A single word longer than the line: break it.
    let text = w.text;
    while (ww > maxWidth && text.length > 1) {
      let cut = text.length - 1;
      while (cut > 1 && w.font.widthOfTextAtSize(text.slice(0, cut), size) > maxWidth) cut--;
      lines.push([{ text: text.slice(0, cut), font: w.font, width: w.font.widthOfTextAtSize(text.slice(0, cut), size) }]);
      text = text.slice(cut);
      ww = w.font.widthOfTextAtSize(text, size);
    }
    line.push({ text, font: w.font, width: ww });
    width += ww;
  }
  if (line.length || !lines.length) lines.push(line);
  return lines;
}

/**
 * Letter-spaced text (`tracking` as a share of the size), as one piece of text with the PDF's character spacing, so
 * it is copied as words. Kept under a tenth of the size: wider gaps would be read back as spaces. Returns its width.
 */
function drawSpaced(page, text, { x, y, size, font, color, tracking = 0, measure = false }) {
  const tc = Math.min(tracking, 0.085) * size;
  if (!measure) {
    page.pushOperators(setCharacterSpacing(tc));
    page.drawText(text, { x, y, size, font, color });
    page.pushOperators(setCharacterSpacing(0));
  }
  return font.widthOfTextAtSize(text, size) + tc * Math.max(0, [...text].length - 1);
}

const MARGIN_X = 56;

/** The fonts and logo the letterhead draws with, embedded in `doc`. */
const letterheadAssets = async (doc) => ({
  regular: await doc.embedFont(StandardFonts.Helvetica),
  bold: await doc.embedFont(StandardFonts.HelveticaBold),
  logo: await doc.embedPng(getLetterheadLogo()),
});

/**
 * The built-in letterhead on a new page: brand stripe, logo, the academy's address and contacts, the reference
 * and date, a faint logo watermark, and the footer (page numbers are added once all pages exist).
 * head: { address: [lines], email, phone, website }; meta: { ref, date }.
 */
async function letterhead(doc, assets, head, meta) {
  const page = doc.addPage(A4);
  const [W, H] = A4;
  const { regular, bold, logo } = assets;

  // Watermark first, behind everything.
  const wmW = 300;
  const wmH = (logo.height / logo.width) * wmW;
  page.drawImage(logo, { x: (W - wmW) / 2, y: (H - wmH) / 2 - 40, width: wmW, height: wmH, opacity: 0.028 });

  // Brand stripe across the top: ink, with the red accent on the left.
  page.drawRectangle({ x: 0, y: H - 7, width: W, height: 7, color: INK });
  page.drawRectangle({ x: 0, y: H - 7, width: W * 0.34, height: 7, color: ACCENT });

  // Logo on the left; who we are and how to reach us on the right.
  const logoH = 50;
  const logoW = (logo.width / logo.height) * logoH;
  const headTop = H - 30;
  page.drawImage(logo, { x: MARGIN_X, y: headTop - logoH, width: logoW, height: logoH });
  const right = W - MARGIN_X;
  let y = headTop - 9;
  const nameW = drawSpaced(page, 'SLOKA ACADEMY', { x: 0, y, size: 10.5, font: bold, color: INK, tracking: 0.085, measure: true });
  drawSpaced(page, 'SLOKA ACADEMY', { x: right - nameW, y, size: 10.5, font: bold, color: INK, tracking: 0.085 });
  y -= 13;
  const contact = [
    ...head.address,
    [head.email, head.phone].filter(Boolean).join('   |   '),
    head.website,
  ].filter(Boolean);
  for (const line of contact) {
    const text = printable(line);
    page.drawText(text, { x: right - regular.widthOfTextAtSize(text, 8.2), y, size: 8.2, font: regular, color: MUTED });
    y -= 11;
  }

  // A rule under the letterhead, with a red accent where it starts.
  const ruleY = Math.min(headTop - logoH, y + 3) - 12;
  page.drawRectangle({ x: MARGIN_X, y: ruleY, width: W - 2 * MARGIN_X, height: 0.6, color: HAIRLINE });
  page.drawRectangle({ x: MARGIN_X, y: ruleY - 0.7, width: 64, height: 2, color: ACCENT });

  // Reference and date.
  const metaY = ruleY - 20;
  if (meta.ref) {
    const label = 'REF.';
    page.drawText(label, { x: MARGIN_X, y: metaY, size: 7.5, font: bold, color: MUTED });
    page.drawText(printable(meta.ref), { x: MARGIN_X + bold.widthOfTextAtSize(label, 7.5) + 6, y: metaY, size: 9.5, font: bold, color: INK });
  }
  if (meta.date) {
    const value = printable(meta.date);
    const vw = regular.widthOfTextAtSize(value, 9.5);
    page.drawText(value, { x: right - vw, y: metaY, size: 9.5, font: regular, color: INK });
    page.drawText('DATE', { x: right - vw - 6 - bold.widthOfTextAtSize('DATE', 7.5), y: metaY, size: 7.5, font: bold, color: MUTED });
  }

  // Footer.
  page.drawRectangle({ x: MARGIN_X, y: 50, width: W - 2 * MARGIN_X, height: 0.6, color: HAIRLINE });
  page.drawText('Sloka Academy  |  a unit of Slifax Private Limited', { x: MARGIN_X, y: 36, size: 7.5, font: regular, color: MUTED });
  return page;
}

/** "Ref ... | Page 1 of 2" at the foot of every letterhead page. */
function pageNumbers(pages, assets, ref) {
  const [W] = A4;
  pages.forEach((page, i) => {
    const text = `${ref ? `${printable(ref)}   |   ` : ''}Page ${i + 1} of ${pages.length}`;
    page.drawText(text, { x: W - MARGIN_X - assets.regular.widthOfTextAtSize(text, 7.5), y: 36, size: 7.5, font: assets.regular, color: MUTED });
  });
}

// The built-in letterhead's text area, in percent of the page (top, right, bottom, left).
const BUILT_IN_MARGINS = { top: 17.4, right: 9.4, bottom: 8.4, left: 9.4 };

/**
 * Render a letter. content: { values, body, layout, letterhead? } (the snapshot kept with the letter, or a
 * preview's); letterhead: { address: [lines], email, phone, website }, shown on the built-in letterhead.
 * template: null (built-in letterhead) or { fileType, file, pageWidth, pageHeight }. preview: stamp it PREVIEW.
 */
async function renderOfferLetterPdf({ values, body, layout, letterhead: head }, config, template = null, { preview = false } = {}) {
  const doc = await PDFDocument.create();
  const [regular, bold] = FONT_PAIRS[layout.font] || FONT_PAIRS.helvetica;
  const fonts = { regular: await doc.embedFont(regular), bold: await doc.embedFont(bold) };
  const pages = [];
  const builtIn = !template || !template.fileType;
  const assets = builtIn ? await letterheadAssets(doc) : null;
  const contacts = {
    address: (head && head.address) || [],
    email: head && head.email,
    phone: head && head.phone,
    website: (head && head.website) || String(config.siteUrl || '').replace(/^https?:\/\//, '').replace(/\/$/, ''),
  };
  const meta = { ref: values.offer_letter_id, date: values.offer_date };

  // The background of a new page: the letterhead, or the uploaded file's first page.
  let background = null;
  const newPage = async () => {
    let page;
    if (builtIn) page = await letterhead(doc, assets, contacts, meta);
    else if (template.fileType === 'pdf') {
      background ||= (await doc.embedPdf(await PDFDocument.load(template.file, { updateMetadata: false }), [0]))[0];
      page = doc.addPage([background.width, background.height]);
      page.drawPage(background, { x: 0, y: 0, width: background.width, height: background.height });
    } else {
      background ||= template.fileType === 'png' ? await doc.embedPng(template.file) : await doc.embedJpg(template.file);
      page = doc.addPage([template.pageWidth, template.pageHeight]);
      page.drawImage(background, { x: 0, y: 0, width: template.pageWidth, height: template.pageHeight });
    }
    pages.push(page);
    return page;
  };

  if (!body.trim() && template && template.fileType === 'pdf') {
    // Document mode: every page of the uploaded letter, its placeholders filled in.
    const src = await PDFDocument.load(template.file, { updateMetadata: false });
    const count = Math.min(src.getPageCount(), 10);
    const embedded = await doc.embedPdf(src, [...Array(count).keys()]);
    for (const e of embedded) {
      const page = doc.addPage([e.width, e.height]);
      page.drawPage(e, { x: 0, y: 0, width: e.width, height: e.height });
      pages.push(page);
    }
  } else {
    let page = await newPage();
    if (body.trim()) {
      const { width: W, height: H } = page.getSize();
      const m = builtIn ? BUILT_IN_MARGINS : layout.margins;
      const left = (W * m.left) / 100;
      const maxWidth = W - left - (W * m.right) / 100;
      const top = H - (H * m.top) / 100;
      const bottom = (H * m.bottom) / 100;
      const size = layout.size;
      const lead = size * layout.lineHeight;
      const color = hex(layout.color);
      let y = top - size;
      // Room for `height` more points on this page, or a new page.
      const room = async (height) => {
        if (y - height < bottom) {
          page = await newPage();
          y = top - size;
          return true;
        }
        return false;
      };
      // A wrapped line: each run of words in one font is drawn as one piece of text (its spaces included), so
      // readers keep the spacing and copy the words with their spaces.
      const drawWords = (words, x0, yy, sz, col) => {
        let x = x0;
        let run = null;
        const flush = () => {
          if (run && run.text.trim()) page.drawText(run.text, { x: run.x, y: yy, size: sz, font: run.font, color: col });
          run = null;
        };
        for (const w of words) {
          if (run && (w.font === run.font || !w.text.trim())) run.text += w.text;
          else {
            flush();
            run = { x, text: w.text, font: w.font };
          }
          x += w.width;
        }
        flush();
      };

      const blocks = parseBody(body, values);
      for (const [i, block] of blocks.entries()) {
        const next = blocks[i + 1];
        if (block.type === 'title') {
          await room(lead * 3);
          y -= lead * 0.25;
          const ts = size * 1.35;
          const tw = drawSpaced(page, block.text.toUpperCase(), { x: 0, y, size: ts, font: fonts.bold, color, tracking: 0.085, measure: true });
          drawSpaced(page, block.text.toUpperCase(), { x: left + (maxWidth - tw) / 2, y, size: ts, font: fonts.bold, color: INK, tracking: 0.085 });
          page.drawRectangle({ x: left + maxWidth / 2 - 22, y: y - 9, width: 44, height: 1.6, color: ACCENT });
          y -= lead * 1.85;
        } else if (block.type === 'heading') {
          // Keep a heading with what follows it.
          await room(lead * (next && next.type === 'table' ? 4 : 3));
          y -= lead * 0.35;
          const hs = size * 0.82;
          const hw = drawSpaced(page, block.text.toUpperCase(), { x: left, y, size: hs, font: fonts.bold, color: ACCENT, tracking: 0.085 });
          page.drawRectangle({ x: left + hw + 8, y: y + hs * 0.32, width: Math.max(0, maxWidth - hw - 8), height: 0.5, color: HAIRLINE });
          y -= lead * 1.15;
        } else if (block.type === 'table') {
          // A shaded panel: labels on the left, values (bold) on the right, a red accent along its edge.
          const pad = 10;
          const labelW = Math.min(maxWidth * 0.36, 170);
          const valueW = maxWidth - labelW - pad * 2;
          const rowLead = lead * 0.94;
          const rows = block.rows.map((r) => {
            const valueLines = wrapLine(r.value.map((s) => ({ ...s, bold: true })), fonts, size, valueW);
            const labelLines = wrapLine(r.label, fonts, size * 0.92, labelW - 8);
            return { valueLines, labelLines, height: Math.max(valueLines.length, labelLines.length) * rowLead + rowLead * 0.45 };
          });
          let i2 = 0;
          while (i2 < rows.length) {
            await room(rows[i2].height + pad);
            // As many rows as fit on this page, in one panel.
            let h = pad * 0.9;
            let n = 0;
            while (i2 + n < rows.length && y - (h + rows[i2 + n].height) - pad * 0.6 >= bottom) {
              h += rows[i2 + n].height;
              n += 1;
            }
            if (!n) n = 1;
            const panelTop = y + size + pad * 0.4;
            const panelH = rows.slice(i2, i2 + n).reduce((s, r) => s + r.height, 0) + pad;
            page.drawRectangle({ x: left, y: panelTop - panelH, width: maxWidth, height: panelH, color: PANEL });
            page.drawRectangle({ x: left, y: panelTop - panelH, width: 2.2, height: panelH, color: ACCENT });
            let ry = y - pad * 0.15;
            rows.slice(i2, i2 + n).forEach((r, k) => {
              r.labelLines.forEach((ln, j) => drawWords(ln, left + pad + 4, ry - j * rowLead, size * 0.92, MUTED));
              r.valueLines.forEach((ln, j) => drawWords(ln, left + pad + labelW, ry - j * rowLead, size, INK));
              ry -= r.height;
              if (k < n - 1) page.drawRectangle({ x: left + pad + 4, y: ry + rowLead * 0.62, width: maxWidth - pad * 2 - 4, height: 0.4, color: HAIRLINE });
            });
            y = panelTop - panelH - size - pad * 0.2;
            i2 += n;
          }
          y -= lead * 0.5;
        } else if (block.type === 'gap') {
          y -= lead * 1.5;
        } else {
          for (const line of block.lines) {
            for (const words of wrapLine(line, fonts, size, maxWidth)) {
              await room(0);
              drawWords(words, left, y, size, color);
              y -= lead;
            }
          }
          y -= lead * 0.45; // between paragraphs
        }
      }
    }
  }

  if (builtIn) pageNumbers(pages, assets, meta.ref);
  await drawMappings(doc, pages, layout.placeholders, (key) => printable(values[key] ?? ''));
  if (preview) for (const page of pages) await drawStamp(doc, page, { preview: true });

  doc.setTitle(`Offer of Internship - ${printable(values.student_name || '')}`);
  doc.setAuthor('Sloka Academy');
  doc.setSubject(`Offer letter ${printable(values.offer_letter_id || '')}`);
  doc.setCreator('Sloka Academy');
  doc.setProducer('Sloka Academy');
  return Buffer.from(await doc.save());
}

module.exports = {
  renderOfferLetterPdf,
  A4,
  BUILT_IN_MARGINS,
  // The letterhead, shared with invoices (invoicePdf.js).
  letterhead,
  letterheadAssets,
  pageNumbers,
  drawSpaced,
  MARGIN_X,
  COLOURS: { INK, ACCENT, MUTED, HAIRLINE, PANEL },
};
