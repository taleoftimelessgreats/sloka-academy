// Converts a Word (.docx) or PowerPoint (.pptx) template to PDF in the browser, so that it is uploaded like any PDF
// template and its placeholders are found. The portal opens this page in a hidden frame and posts it the file
// (settings.js, officeToPdf). It is a page of its own because the renderers use inline styles, which the portal's
// Content-Security-Policy refuses; vercel.json gives this page a policy that allows them (scripts stay 'self' only).
//
// Every page (Word) or slide (PowerPoint) is laid out by the browser: docx-preview renders Word documents; slides are
// drawn here from pptxtojson's description of them. Each is then drawn as an image (html2canvas) and placed on a PDF
// page of the same size (pdf-lib), with an invisible text layer: each line of text where it is on the page, in a
// standard PDF font of the same size and width. The server reads that text to find placeholders such as
// {{Student Name}} and covers them, in the colour around them, with the details.

import { parse as parsePptx } from '../vendor/pptxtojson.js';

const PDFLib = window.PDFLib;
const PT_PER_PX = 0.75; // CSS pixels are 1/96 inch, PDF points 1/72
// Image resolution (× CSS pixels) and JPEG quality, finest first: the first that fits the upload limit is used.
const RENDERINGS = [
  { scale: 2.5, quality: 0.92 },
  { scale: 2, quality: 0.88 },
  { scale: 1.5, quality: 0.82 },
];

class ConvertError extends Error {}

const stage = document.getElementById('stage');

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

// ------------------------------------------------------------------ messages from the portal

window.addEventListener('message', async (event) => {
  if (event.origin !== window.location.origin || event.source !== window.parent) return;
  const msg = event.data || {};
  if (msg.type !== 'convert') return;
  try {
    const { pdf, pages } = await convert(msg);
    window.parent.postMessage({ type: 'result', id: msg.id, pdf, pages }, window.location.origin, [pdf]);
  } catch (err) {
    console.error(err);
    const message = err instanceof ConvertError ? err.message : `The file could not be converted (${err.message || err}). Save it as PDF and upload that.`;
    window.parent.postMessage({ type: 'error', id: msg.id, message }, window.location.origin);
  } finally {
    stage.replaceChildren();
  }
});
window.parent.postMessage({ type: 'ready' }, window.location.origin);

/** { kind: 'docx' | 'pptx', buffer, maxPages, maxBytes } → { pdf: ArrayBuffer, pages } */
async function convert({ kind, buffer, maxPages = 10, maxBytes = 4 * 1024 * 1024 }) {
  stage.replaceChildren();
  let pages;
  if (kind === 'docx') pages = await renderDocx(buffer);
  else if (kind === 'pptx') pages = await renderPptx(buffer);
  else throw new ConvertError('Only Word (.docx) and PowerPoint (.pptx) files are converted.');
  if (!pages.length) throw new ConvertError('The file has no pages.');
  await settled();
  const sheets = pages.flatMap(paginate).slice(0, maxPages);
  for (const rendering of RENDERINGS) {
    const bytes = await buildPdf(sheets, rendering);
    if (bytes.byteLength <= maxBytes) return { pdf: bytes.slice().buffer, pages: sheets.length };
  }
  throw new ConvertError(`The converted PDF is over ${Math.round(maxBytes / 1048576)} MB. Use smaller pictures in the file, or save it as PDF and upload that.`);
}

/** Fonts and pictures loaded, so what is drawn is what the browser shows. */
async function settled() {
  await Promise.all(
    [...stage.querySelectorAll('img')].map((img) =>
      img.complete ? null : new Promise((resolve) => {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
      }),
    ),
  );
  await document.fonts.ready;
}

// ------------------------------------------------------------------ Word

async function renderDocx(buffer) {
  const host = el('div', 'docx-host');
  stage.append(host);
  try {
    await window.docx.renderAsync(buffer, host, host, {
      inWrapper: true,
      breakPages: true, // at page breaks, and where Word last broke the pages (it saves that in the file)
      useBase64URL: true, // pictures as data: URLs, which html2canvas can draw
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true,
      renderComments: false,
      renderChanges: false,
      experimental: true, // tab stops
    });
  } catch {
    throw new ConvertError('This Word file could not be read. Open it in Word, save it again as .docx and try again, or save it as PDF.');
  }
  return [...host.querySelectorAll('section.docx')].map((section) => ({
    el: section,
    paperPx: cssPx(section.style.minHeight) || section.getBoundingClientRect().height,
  }));
}

/** "841.9pt" → CSS pixels (pt, px, in, cm, mm), or 0. */
function cssPx(value) {
  const m = /^([\d.]+)(pt|px|in|cm|mm)$/.exec(String(value || '').trim());
  if (!m) return 0;
  const n = Number(m[1]);
  return { pt: n / PT_PER_PX, px: n, in: n * 96, cm: (n * 96) / 2.54, mm: (n * 96) / 25.4 }[m[2]];
}

// ------------------------------------------------------------------ PowerPoint (slides drawn from pptxtojson's data)

async function renderPptx(buffer) {
  let data;
  try {
    data = await parsePptx(buffer, { imageMode: 'base64', videoMode: 'none', audioMode: 'none' });
  } catch {
    throw new ConvertError('This PowerPoint file could not be read. Open it in PowerPoint, save it again as .pptx and try again, or save it as PDF.');
  }
  const { width, height } = data.size; // points
  return data.slides.map((slide) => {
    const page = el('div', 'slide');
    page.style.width = pt(width);
    page.style.height = pt(height);
    applyFill(page, slide.fill);
    for (const e of [...byOrder(slide.layoutElements), ...byOrder(slide.elements)]) {
      const node = renderElement(e);
      if (node) page.append(node);
    }
    stage.append(page);
    return { el: page, paperPx: page.getBoundingClientRect().height };
  });
}

const pt = (n) => `${Number(n) || 0}pt`;
const byOrder = (list) => [...(list || [])].sort((a, b) => (a.order || 0) - (b.order || 0));

function renderElement(e) {
  switch (e.type) {
    case 'text': {
      const box = frame(e);
      applyFill(box, e.fill);
      applyBorder(box, e);
      box.append(textBody(e));
      return box;
    }
    case 'shape': {
      const box = frame(e);
      if (e.fill && e.fill.type === 'image') applyFill(box, e.fill);
      box.append(shapeSvg(e));
      if (e.content) box.append(textBody(e));
      return box;
    }
    case 'image':
      return e.base64 ? picture(e, e.base64) : null;
    case 'math':
      return e.picBase64 ? picture(e, e.picBase64) : null;
    case 'table':
      return table(e);
    case 'group':
    case 'diagram': {
      const box = frame(e); // children are placed relative to the group
      for (const child of byOrder(e.elements)) {
        const node = renderElement(child);
        if (node) box.append(node);
      }
      return box;
    }
    default:
      return null; // charts, video, audio: not part of a certificate or letter
  }
}

/** A positioned box for an element (points), rotated and flipped like it. */
function frame(e) {
  const box = el('div', 'el');
  Object.assign(box.style, { left: pt(e.left), top: pt(e.top), width: pt(e.width), height: pt(e.height) });
  const t = [];
  if (e.rotate) t.push(`rotate(${e.rotate}deg)`);
  if (e.isFlipH) t.push('scaleX(-1)');
  if (e.isFlipV) t.push('scaleY(-1)');
  if (t.length) box.style.transform = t.join(' ');
  return box;
}

function applyFill(node, fill) {
  if (!fill || !fill.value) return;
  if (fill.type === 'color') node.style.backgroundColor = fill.value;
  else if (fill.type === 'image' && fill.value.base64) {
    Object.assign(node.style, { backgroundImage: `url("${fill.value.base64}")`, backgroundSize: '100% 100%' });
  } else if (fill.type === 'gradient' && fill.value.colors && fill.value.colors.length) {
    const stops = fill.value.colors.map((c) => `${c.color} ${c.pos}`).join(', ');
    node.style.backgroundImage = fill.value.path === 'line' ? `linear-gradient(${(fill.value.rot || 0) + 90}deg, ${stops})` : `radial-gradient(${stops})`;
  } else if (fill.type === 'pattern') node.style.backgroundColor = fill.value.backgroundColor || fill.value.foregroundColor || '';
}

function applyBorder(node, e) {
  if (e.borderWidth && e.borderColor) node.style.border = `${pt(e.borderWidth)} ${e.borderType || 'solid'} ${e.borderColor}`;
}

/** A shape's outline and fill, as SVG stretched over its box. */
function shapeSvg(e) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'shape');
  const vb = e.pathViewBox;
  svg.setAttribute('viewBox', vb ? `${vb.x} ${vb.y} ${vb.width} ${vb.height}` : `0 0 ${e.width || 1} ${e.height || 1}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', e.path || `M0 0H${e.width}V${e.height}H0Z`);
  let fill = 'none';
  if (!e.strokeOnly && e.fill) {
    if (e.fill.type === 'color') fill = e.fill.value;
    else if (e.fill.type === 'gradient' && e.fill.value && e.fill.value.colors && e.fill.value.colors.length) fill = e.fill.value.colors[0].color;
    else if (e.fill.type === 'pattern' && e.fill.value) fill = e.fill.value.foregroundColor || 'none';
  }
  path.setAttribute('fill', fill || 'none');
  if (e.borderWidth && e.borderColor) {
    path.setAttribute('stroke', e.borderColor);
    path.setAttribute('stroke-width', String(e.borderWidth / PT_PER_PX)); // screen pixels (non-scaling)
    path.setAttribute('vector-effect', 'non-scaling-stroke');
    if (e.borderStrokeDasharray && e.borderStrokeDasharray !== '0') path.setAttribute('stroke-dasharray', e.borderStrokeDasharray);
  }
  svg.append(path);
  return svg;
}

/** The text of a text box or shape: pptxtojson's HTML (paragraphs and runs with their own styles). */
function textBody(e) {
  const box = el('div', 'text');
  const inset = e.textInset || { l: 7.2, t: 3.6, r: 7.2, b: 3.6 };
  box.style.padding = `${pt(inset.t)} ${pt(inset.r)} ${pt(inset.b)} ${pt(inset.l)}`;
  box.style.justifyContent = e.vAlign === 'mid' ? 'center' : e.vAlign === 'down' ? 'flex-end' : 'flex-start';
  if (e.wrap === false) box.classList.add('nowrap');
  if (e.isVertical) box.classList.add('vertical');
  const inner = el('div');
  // Markup that pptxtojson builds from the slide's text runs. No script can run from it: this page's policy only
  // allows its own script files.
  inner.innerHTML = e.content || '';
  box.append(inner);
  return box;
}

/** A picture, cropped as on the slide (crop edges are percentages of the picture). */
function picture(e, src) {
  const box = frame(e);
  const crop = el('div', 'crop');
  if (e.geom === 'ellipse') crop.style.borderRadius = '50%';
  const img = el('img');
  img.alt = '';
  img.src = src;
  const r = e.rect || {};
  const l = r.l || 0;
  const t = r.t || 0;
  const w = Math.max(1, 100 - l - (r.r || 0));
  const h = Math.max(1, 100 - t - (r.b || 0));
  Object.assign(img.style, { width: `${(100 / w) * 100}%`, height: `${(100 / h) * 100}%`, left: `${(-l / w) * 100}%`, top: `${(-t / h) * 100}%` });
  crop.append(img);
  box.append(crop);
  applyBorder(box, e);
  return box;
}

function table(e) {
  const box = frame(e);
  const t = el('table');
  if (Array.isArray(e.colWidths) && e.colWidths.length) {
    const cols = el('colgroup');
    for (const w of e.colWidths) {
      const col = el('col');
      col.style.width = pt(w);
      cols.append(col);
    }
    t.append(cols);
  }
  (e.data || []).forEach((row, i) => {
    const tr = el('tr');
    if (e.rowHeights && e.rowHeights[i]) tr.style.height = pt(e.rowHeights[i]);
    for (const cell of row) {
      if (cell.hMerge || cell.vMerge) continue;
      const td = el('td');
      if (cell.colSpan) td.colSpan = cell.colSpan;
      if (cell.rowSpan) td.rowSpan = cell.rowSpan;
      td.innerHTML = cell.text || ''; // pptxtojson's markup, as for text boxes
      if (cell.fillColor) td.style.backgroundColor = cell.fillColor;
      if (cell.fontColor) td.style.color = cell.fontColor;
      if (cell.fontBold) td.style.fontWeight = 'bold';
      td.style.verticalAlign = cell.vAlign === 'mid' ? 'middle' : cell.vAlign === 'down' ? 'bottom' : 'top';
      for (const side of ['top', 'right', 'bottom', 'left']) {
        const b = cell.borders && cell.borders[side];
        if (b && b.borderWidth) td.style[`border${side[0].toUpperCase()}${side.slice(1)}`] = `${pt(b.borderWidth)} ${b.borderType || 'solid'} ${b.borderColor}`;
      }
      tr.append(td);
    }
    t.append(tr);
  });
  box.append(t);
  return box;
}

// ------------------------------------------------------------------ pages, text layer and the PDF

/**
 * The PDF pages of a rendered page: one, or (for a Word page that came out taller than its paper because the file
 * has no page-break hints) several, cut between lines of text. Each: { el, top, height, widthPx, paperPx, lines }.
 */
function paginate(page) {
  const { width, height } = page.el.getBoundingClientRect();
  const lines = textLines(page.el);
  const paper = page.paperPx || height;
  const sheets = [];
  for (let top = 0; top < height - 1; ) {
    let bottom = Math.min(height, top + paper);
    if (bottom < height) {
      // Move the cut up, above any line of text it would go through.
      for (let moved = true; moved; ) {
        moved = false;
        for (const l of lines) {
          if (l.top < bottom && l.bottom > bottom && l.top > top + paper * 0.5) {
            bottom = l.top - 1;
            moved = true;
          }
        }
      }
    }
    sheets.push({ el: page.el, top, height: bottom - top, widthPx: width, paperPx: paper, lines: lines.filter((l) => l.top >= top - 1 && l.bottom <= bottom + 1) });
    top = bottom;
  }
  return sheets;
}

/**
 * The text in an element where the browser put it: [{ text, left, top, bottom, width (CSS px from the element's
 * top-left), px (font size), family, bold, italic }], one entry per line of each run of text.
 */
function textLines(root) {
  const origin = root.getBoundingClientRect();
  const lines = [];
  const range = document.createRange();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.data.trim() && !n.parentElement.closest('svg, style, script') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const rectOf = (node, start, end) => {
    range.setStart(node, start);
    range.setEnd(node, end);
    return [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
  };
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const style = window.getComputedStyle(node.parentElement);
    if (style.visibility !== 'visible' || style.display === 'none') continue;
    const font = {
      px: parseFloat(style.fontSize) || 12,
      family: style.fontFamily || '',
      bold: style.fontWeight === 'bold' || Number(style.fontWeight) >= 600,
      italic: /italic|oblique/.test(style.fontStyle),
    };
    const push = (text, r) => {
      const t = text.replace(/\s+/g, ' ').trim();
      if (t) lines.push({ text: t, left: r.left - origin.left, top: r.top - origin.top, bottom: r.bottom - origin.top, width: r.right - r.left, ...font });
    };
    // From the first to the last letter (spaces around them may be collapsed away).
    const data = node.data;
    const first = data.search(/\S/);
    const last = data.length - (data.length - data.trimEnd().length) - 1;
    const whole = rectOf(node, first, last + 1);
    // All on one line (the browser may still give several boxes, e.g. for italics): one run.
    if (whole.length && whole.every((r) => Math.abs(r.top - whole[0].top) < whole[0].height * 0.5)) {
      const left = Math.min(...whole.map((r) => r.left));
      const right = Math.max(...whole.map((r) => r.right));
      push(data.slice(first, last + 1), { left, right, top: Math.min(...whole.map((r) => r.top)), bottom: Math.max(...whole.map((r) => r.bottom)) });
      continue;
    }
    // The run wraps over lines: find which letters are on which line (italic letters overlap: only a new line, or a
    // jump back to the left, starts a new piece).
    let current = null;
    for (let i = first; i <= last; i++) {
      const ch = data[i];
      const r = /\s/.test(ch) ? null : rectOf(node, i, i + 1)[0];
      if (!r) {
        if (current) current.text += ch;
        continue;
      }
      if (current && Math.abs(r.top - current.r.top) < current.r.height * 0.5 && r.left >= current.r.left) {
        current.text += ch;
        current.r = { left: current.r.left, top: Math.min(current.r.top, r.top), right: r.right, bottom: Math.max(current.r.bottom, r.bottom), height: current.r.height };
      } else {
        if (current) push(current.text, current.r);
        current = { text: ch, r: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, height: r.height } };
      }
    }
    if (current) push(current.text, current.r);
  }
  return lines;
}

/** The standard PDF font closest to a CSS font. */
function standardFont({ family, bold, italic }) {
  const first = family.split(',')[0].replace(/["']/g, '').trim().toLowerCase();
  let base = 'Helvetica';
  if (/courier|consolas|mono/.test(first)) base = 'Courier';
  else if (/times|georgia|garamond|cambria|palatino|book antiqua|baskerville|^serif$/.test(first)) base = 'TimesRoman';
  const slant = base === 'TimesRoman' ? 'Italic' : 'Oblique';
  if (base === 'TimesRoman' && !bold && !italic) return 'TimesRoman';
  return `${base}${bold ? 'Bold' : ''}${italic ? slant : ''}`;
}

async function buildPdf(sheets, { scale, quality }) {
  const { PDFDocument, StandardFonts } = PDFLib;
  const doc = await PDFDocument.create();
  doc.setCreator('Sloka Academy portal: converted from Word or PowerPoint');
  doc.setProducer('pdf-lib');
  const fonts = new Map();
  const fontFor = async (name) => {
    if (!fonts.has(name)) {
      const font = await doc.embedFont(StandardFonts[name]);
      fonts.set(name, { font, chars: new Set(font.getCharacterSet()) });
    }
    return fonts.get(name);
  };
  const drawings = new Map(); // one drawing of each page, shared by the PDF pages cut from it
  for (const sheet of sheets) {
    if (!drawings.has(sheet.el)) drawings.set(sheet.el, await window.html2canvas(sheet.el, { scale, backgroundColor: '#ffffff', logging: false }));
    const drawing = drawings.get(sheet.el);
    const ratio = drawing.width / sheet.widthPx;
    const slice = el('canvas');
    slice.width = drawing.width;
    slice.height = Math.max(1, Math.round(sheet.height * ratio));
    slice.getContext('2d').drawImage(drawing, 0, Math.round(sheet.top * ratio), slice.width, slice.height, 0, 0, slice.width, slice.height);
    const jpeg = await new Promise((resolve) => slice.toBlob(resolve, 'image/jpeg', quality));
    const image = await doc.embedJpg(await jpeg.arrayBuffer());
    const widthPt = sheet.widthPx * PT_PER_PX;
    const heightPt = sheet.paperPx * PT_PER_PX;
    const page = doc.addPage([widthPt, heightPt]);
    const drawnHeight = sheet.height * PT_PER_PX;
    page.drawImage(image, { x: 0, y: heightPt - drawnHeight, width: widthPt, height: drawnHeight });
    for (const line of sheet.lines) drawInvisible(page, await fontFor(standardFont(line)), line, sheet, heightPt);
  }
  return doc.save();
}

/**
 * A line of text, invisible, exactly over where it is drawn in the picture: same size, and squeezed or stretched to
 * the same width (letter spacing would make PDF readers see gaps between the letters as spaces).
 */
function drawInvisible(page, { font, chars }, line, sheet, heightPt) {
  const { pushGraphicsState, popGraphicsState, beginText, endText, setFontAndSize, setTextMatrix, showText, setTextRenderingMode, TextRenderingMode, setCharacterSqueeze } = PDFLib;
  // Letters the standard fonts cannot write (e.g. ₹) become "?": they are only for finding placeholders.
  const text = [...line.text].map((c) => (chars.has(c.codePointAt(0)) ? c : '?')).join('');
  const size = line.px * PT_PER_PX;
  const natural = font.widthOfTextAtSize(text, size);
  const squeeze = natural > 0 ? Math.min(400, Math.max(25, (100 * line.width * PT_PER_PX) / natural)) : 100;
  const baseline = line.top - sheet.top + (line.bottom - line.top) * 0.8; // most fonts: 80% of the line box is above the baseline
  const key = page.node.newFontDictionary(font.name, font.ref);
  page.pushOperators(
    pushGraphicsState(),
    beginText(),
    setFontAndSize(key, size),
    setTextRenderingMode(TextRenderingMode.Invisible),
    setCharacterSqueeze(squeeze),
    setTextMatrix(1, 0, 0, 1, line.left * PT_PER_PX, heightPt - baseline * PT_PER_PX),
    showText(font.encodeText(text)),
    endText(),
    popGraphicsState(),
  );
}
