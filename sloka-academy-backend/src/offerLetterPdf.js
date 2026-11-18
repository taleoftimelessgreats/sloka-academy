'use strict';

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { printable, getLogo, drawStamp } = require('./certificatePdf');
const { drawMappings } = require('./placeholders');

/**
 * Offer letter PDFs, on the same engine as the certificates (pdf-lib, standard fonts, the Sloka logo).
 * A letter is: a page (the built-in letterhead, or an uploaded background) + the letter text, a body with
 * {{placeholders}} and **bold**, wrapped within the layout's margins + any placeholders mapped in an uploaded
 * document. An uploaded document with no body text is used as the letter itself ("document mode").
 */

const A4 = [595.28, 841.89];
const DARK = rgb(6 / 255, 6 / 255, 8 / 255);
const RED = rgb(227 / 255, 20 / 255, 27 / 255);
const MUTED = rgb(90 / 255, 90 / 255, 99 / 255);

const FONT_PAIRS = {
  helvetica: [StandardFonts.Helvetica, StandardFonts.HelveticaBold],
  times: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold],
};

const hex = (h) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);

/**
 * Body text -> paragraphs of lines of segments { text, bold }, with placeholders filled in. Bold markers are read
 * from the template before values go in, so a value can never switch bold on or off.
 */
function parseBody(body, values) {
  const fill = (s) => s.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, key) => (Object.hasOwn(values, key) ? printable(values[key] ?? '') : m));
  return body
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n/)
    .map((para) =>
      para.split('\n').map((line) => {
        const segments = [];
        line.split('**').forEach((part, i) => {
          if (part) segments.push({ text: fill(part), bold: i % 2 === 1 });
        });
        return segments;
      }),
    );
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

async function letterhead(doc, config) {
  const page = doc.addPage(A4);
  const [W, H] = A4;
  const logo = await doc.embedPng(getLogo());
  const bandH = 86;
  page.drawRectangle({ x: 0, y: H - bandH, width: W, height: bandH, color: DARK });
  const logoH = 58;
  const logoW = (logo.width / logo.height) * logoH;
  page.drawImage(logo, { x: 56, y: H - bandH + (bandH - logoH) / 2, width: logoW, height: logoH });
  page.drawRectangle({ x: 0, y: H - bandH - 3, width: W, height: 3, color: RED });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const site = String(config.siteUrl || '').replace(/^https?:\/\//, '');
  if (site) page.drawText(site, { x: W - 56 - font.widthOfTextAtSize(site, 9), y: H - bandH / 2 - 3, size: 9, font, color: rgb(1, 1, 1) });
  page.drawRectangle({ x: 56, y: 48, width: W - 112, height: 0.6, color: rgb(0.85, 0.84, 0.82) });
  const foot = 'Sloka Academy (a unit of Slifax Private Limited)';
  page.drawText(foot, { x: (W - font.widthOfTextAtSize(foot, 8)) / 2, y: 34, size: 8, font, color: MUTED });
  return page;
}

// The built-in letterhead's text area, in percent of the page (top, right, bottom, left).
const BUILT_IN_MARGINS = { top: 15, right: 9.5, bottom: 9, left: 9.5 };

/**
 * Render a letter. content: { values, body, layout } (the snapshot kept with the letter, or a preview's).
 * template: null (built-in letterhead) or { fileType, file, pageWidth, pageHeight }. preview: stamp it PREVIEW.
 */
async function renderOfferLetterPdf({ values, body, layout }, config, template = null, { preview = false } = {}) {
  const doc = await PDFDocument.create();
  const [regular, bold] = FONT_PAIRS[layout.font] || FONT_PAIRS.helvetica;
  const fonts = { regular: await doc.embedFont(regular), bold: await doc.embedFont(bold) };
  const pages = [];

  // The background of a new page: the letterhead, or the uploaded file's first page.
  let background = null;
  const newPage = async () => {
    let page;
    if (!template || !template.fileType) page = await letterhead(doc, config);
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
      const m = template && template.fileType ? layout.margins : BUILT_IN_MARGINS;
      const left = (W * m.left) / 100;
      const maxWidth = W - left - (W * m.right) / 100;
      const top = H - (H * m.top) / 100;
      const bottom = (H * m.bottom) / 100;
      const size = layout.size;
      const lead = size * layout.lineHeight;
      const color = hex(layout.color);
      let y = top - size;
      for (const para of parseBody(body, values)) {
        for (const line of para) {
          for (const words of wrapLine(line, fonts, size, maxWidth)) {
            if (y < bottom) {
              page = await newPage();
              y = top - size;
            }
            let x = left;
            for (const w of words) {
              if (w.text.trim()) page.drawText(w.text, { x, y, size, font: w.font, color });
              x += w.width;
            }
            y -= lead;
          }
        }
        y -= lead * 0.6; // between paragraphs
      }
    }
  }

  await drawMappings(doc, pages, layout.placeholders, (key) => printable(values[key] ?? ''));
  if (preview) for (const page of pages) await drawStamp(doc, page, { preview: true });

  doc.setTitle(`Offer of Internship - ${printable(values.student_name || '')}`);
  doc.setAuthor('Sloka Academy');
  doc.setSubject(`Offer letter ${printable(values.offer_letter_id || '')}`);
  doc.setCreator('Sloka Academy');
  doc.setProducer('Sloka Academy');
  return Buffer.from(await doc.save());
}

module.exports = { renderOfferLetterPdf, A4, BUILT_IN_MARGINS };
