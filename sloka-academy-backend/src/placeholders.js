'use strict';

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

/**
 * Placeholders in uploaded templates: text such as {{Student Name}}, <<certificate_id>>, «College» or [Date]
 * in a PDF's text layer. They are found when a template is uploaded (pdf.js reads the text and where it is),
 * each is mapped to a system field (suggested from its name, changed by staff), and when a document is made
 * the placeholder is covered and the field's value printed in its place:
 *  - a placeholder on a line of its own is replaced where it is (and may grow, e.g. a long name);
 *  - a placeholder inside a sentence has its whole line covered and set again with the values in place,
 *    so the sentence reflows instead of the value running into the words after it.
 * The cover is the colour of the design around the placeholder (sampled from a rendering of the page when the
 * template is scanned; white if the page cannot be rendered). Staff can change all of it in the editor.
 * Images (PNG/JPEG) have no text layer: their details are placed with the layout editor instead.
 */

// {{x}} <<x>> «x» [[x]] [x] {x}. Single brackets only around a short name, so ordinary text is left alone.
const PATTERN = /\{\{\s*([^{}]{1,60}?)\s*\}\}|<<\s*([^<>]{1,60}?)\s*>>|«\s*([^«»]{1,60}?)\s*»|\[\[\s*([^[\]]{1,60}?)\s*\]\]|\[\s*([A-Za-z][A-Za-z0-9 _./-]{0,39}?)\s*\]|\{\s*([A-Za-z][A-Za-z0-9 _./-]{0,39}?)\s*\}/g;

const FONTS = {
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
const FONT_IDS = Object.keys(FONTS);
const ALIGNS = ['left', 'center', 'right'];

/** "Student Name", "student_name", "STUDENT-NAME" -> "studentname" (for matching). */
const normalise = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const round = (n) => Math.round(n * 100) / 100;

let pdfjsReady = null;
function loadPdfjs() {
  // The worker module runs in this process (no worker thread); importing it by name lets bundlers find it.
  pdfjsReady ||= (async () => {
    globalThis.pdfjsWorker ||= await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    return import('pdfjs-dist/legacy/build/pdf.mjs');
  })();
  return pdfjsReady;
}

// Helvetica's widths, to estimate where inside a run of text a placeholder starts (pdf.js gives whole runs).
let helvetica = null;
async function proportion(text, upTo) {
  helvetica ||= await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
  const safe = (s) => s.replace(/[^\x20-\x7E -ÿ]/g, 'n');
  const whole = helvetica.widthOfTextAtSize(safe(text), 10);
  return whole > 0 ? helvetica.widthOfTextAtSize(safe(text.slice(0, upTo)), 10) / whole : upTo / Math.max(1, text.length);
}

/** The standard font closest to a PDF font: its family (serif / sans / mono), bold and italic. */
function fontOf(family, { bold = false, italic = false } = {}) {
  const f = family.toLowerCase();
  const base = f.includes('serif') && !f.includes('sans') ? 'times' : f.includes('mono') ? 'courier' : 'helvetica';
  if (base === 'times') return bold && italic ? 'times-bold-italic' : bold ? 'times-bold' : italic ? 'times-italic' : 'times';
  if (base === 'courier') return bold ? 'courier-bold' : 'courier';
  return bold ? 'helvetica-bold' : italic ? 'helvetica-oblique' : 'helvetica';
}

/**
 * Colours on a rendering of the page, for each item { page, box, own } (boxes: { x, y, width, size } in PDF points,
 * y the baseline): `background`, the colour around `box` (the placeholder, or its whole line), and the colour of the
 * letters inside `own` (`text`, the placeholder's) and inside `box` (`lineText`, the line's words). #rrggbb, or null
 * where the page cannot be rendered (no canvas package on this server) or there are no letters to see.
 */
async function sampleColours(pdf, items) {
  const none = () => ({ background: null, text: null, lineText: null });
  let createCanvas;
  try {
    ({ createCanvas } = require('@napi-rs/canvas'));
  } catch {
    return items.map(none);
  }
  const out = items.map(none);
  const pages = [...new Set(items.map((it) => it.page))];
  for (const p of pages) {
    try {
      const page = await pdf.getPage(p + 1);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      const { data, width: cw, height: ch } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      // Similar colours count together (5 bits a channel); the most common wins.
      const tally = () => new Map();
      const take = (counts, x, y, keep = () => true) => {
        if (x < 0 || y < 0 || x >= cw || y >= ch) return;
        const k = ((y | 0) * cw + (x | 0)) * 4;
        if (!keep(data[k], data[k + 1], data[k + 2])) return;
        const key = (data[k] & 0xf8) * 65536 + (data[k + 1] & 0xf8) * 256 + (data[k + 2] & 0xf8);
        const c = counts.get(key) || { n: 0, r: 0, g: 0, b: 0 };
        c.n += 1;
        c.r += data[k];
        c.g += data[k + 1];
        c.b += data[k + 2];
        counts.set(key, c);
      };
      const winner = (counts) => {
        if (!counts.size) return null;
        const best = [...counts.values()].sort((a, c) => c.n - a.n)[0];
        const hex = (sum) => Math.round(sum / best.n).toString(16).padStart(2, '0');
        return { hex: `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`, r: best.r / best.n, g: best.g / best.n, b: best.b / best.n, n: best.n };
      };
      items.forEach((it, i) => {
        if (it.page !== p) return;
        const b = it.box;
        // The background: a band just outside the box, where the letters are not.
        const [x1, y1] = viewport.convertToViewportPoint(b.x - 4, b.y + b.size * 1.1);
        const [x2, y2] = viewport.convertToViewportPoint(b.x + b.width + 4, b.y - b.size * 0.45);
        const around = tally();
        for (let x = Math.floor(x1); x <= x2; x += 2) {
          take(around, x, y1 - 2);
          take(around, x, y2 + 2);
        }
        for (let y = Math.floor(y1); y <= y2; y += 2) {
          take(around, x1 - 2, y);
          take(around, x2 + 2, y);
        }
        const bg = winner(around);
        if (!bg) return;
        out[i].background = bg.hex;
        // The letters: inside a box, the most common colour clearly unlike the background.
        const far = (r, g, bb) => Math.hypot(r - bg.r, g - bg.g, bb - bg.b) > 90;
        const letters = (box) => {
          const [lx1, ly1] = viewport.convertToViewportPoint(box.x, box.y + box.size * 0.75);
          const [lx2, ly2] = viewport.convertToViewportPoint(box.x + box.width, box.y - box.size * 0.05);
          const inside = tally();
          for (let y = Math.floor(ly1); y <= ly2; y += 1) for (let x = Math.floor(lx1); x <= lx2; x += 1) take(inside, x, y, far);
          const w = winner(inside);
          return w && w.n >= 4 ? w.hex : null;
        };
        out[i].text = letters(it.own);
        out[i].lineText = it.own === b ? out[i].text : letters(b);
      });
    } catch {
      /* this page could not be rendered: covers stay white, letters the default colour */
    }
  }
  return out;
}

/**
 * Find the placeholders in a PDF (the first `maxPages` pages). Resolves to
 * [{ text, name, page, x, y, width, size, font, line, background }]: x/y is where the placeholder's text starts on its
 * baseline, in PDF points from the bottom-left of the page; line is { text, x, width, centred } when the placeholder
 * shares its line with other text; background is the colour around it (or null).
 */
async function extractPlaceholders(bytes, { maxPages = 1 } = {}) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    verbosity: 0,
    disableFontFace: true,
    useSystemFonts: false,
    isOffscreenCanvasSupported: false,
    // No standardFontDataUrl: with it, pdf.js no longer reports whether a standard font is bold. The background
    // rendering does not need the letters drawn exactly.
  });
  const found = [];
  try {
    const pdf = await task.promise;
    for (let p = 1; p <= Math.min(pdf.numPages, maxPages); p++) {
      const page = await pdf.getPage(p);
      const [ox, oy] = page.view; // the page's own origin (usually 0, 0)
      const pageWidth = page.view[2] - page.view[0];
      const content = await page.getTextContent();
      // Join the runs of each line, in reading order, so a placeholder split across runs is still found.
      const lines = [];
      for (const item of content.items) {
        // Spaces between blocks come as items of their own (as wide as the gap): the gaps are measured instead.
        if (typeof item.str !== 'string' || !item.str.trim()) continue;
        const [a, b, c, d, x, y] = item.transform;
        // The vertical scale is the font size (text squeezed or stretched across keeps its height).
        const size = Math.hypot(c, d) || Math.hypot(a, b) || item.height || 10;
        let line = lines.find((l) => Math.abs(l.y - y) < size * 0.3);
        if (!line) lines.push((line = { y, runs: [] }));
        line.runs.push({ str: item.str, x, y, width: item.width, size, fontName: item.fontName, family: content.styles[item.fontName]?.fontFamily || '' });
      }
      // Text far apart on the same baseline ("Ref: ...        Date: ...") is separate blocks, not one sentence. Each
      // block knows whether it is alone on its baseline and where the next one starts (its values must stop there).
      const blocks = [];
      for (const line of lines) {
        line.runs.sort((r1, r2) => r1.x - r2.x);
        const own = [];
        let block = null;
        for (const run of line.runs) {
          const prev = block && block.runs[block.runs.length - 1];
          if (!prev || run.x - (prev.x + prev.width) > Math.max(prev.size, run.size) * 2) own.push((block = { y: line.y, runs: [] }));
          block.runs.push(run);
        }
        own.forEach((b, i) => {
          b.alone = own.length === 1;
          b.next = own[i + 1] ? own[i + 1].runs[0].x : null;
        });
        blocks.push(...own);
      }
      // Left edges that several blocks start at (a margin, a table column): text there is left-aligned, not centred.
      const starts = blocks.map((b) => b.runs[0].x);
      const sharedEdge = (x) => starts.filter((sx) => Math.abs(sx - x) < 3).length >= 2;
      // The right edge of the text on the page: values set from a left-aligned position stop there.
      const textRight = Math.max(...blocks.map((b) => b.runs[b.runs.length - 1].x + b.runs[b.runs.length - 1].width));
      const centredOnPage = (left, width, share = 0.06) => Math.abs(left + width / 2 - pageWidth / 2) < pageWidth * share;
      // Whether a font is bold or italic: pdf.js knows once the page's fonts are loaded (with its operators).
      let fontsLoaded = false;
      const fontStyle = async (id) => {
        if (!fontsLoaded) {
          fontsLoaded = true;
          await page.getOperatorList().catch(() => {});
        }
        try {
          const font = page.commonObjs.has(id) ? page.commonObjs.get(id) : null;
          return { bold: Boolean(font && (font.bold || font.black)), italic: Boolean(font && font.italic) };
        } catch {
          return {};
        }
      };
      for (const line of blocks) {
        let text = '';
        const spans = [];
        line.runs.forEach((run, i) => {
          const prev = line.runs[i - 1];
          if (prev && run.x - (prev.x + prev.width) > run.size * 0.15 && !/\s$/.test(text)) text += ' ';
          spans.push({ run, start: text.length });
          text += run.str;
        });
        const first = line.runs[0];
        const last = line.runs[line.runs.length - 1];
        const lineX = first.x - ox;
        const lineWidth = last.x + last.width - first.x;
        const leftAligned = !line.alone || sharedEdge(first.x);
        const limit = round((line.next === null ? Math.max(textRight, last.x + last.width) : line.next - Math.max(4, first.size * 0.5)) - ox);
        let lineFont = null; // the font of most of the line's text (the words around the placeholders keep it)
        const lineFontOf = async () => {
          if (!lineFont) {
            const main = line.runs.reduce((a, b) => (b.str.length > a.str.length ? b : a));
            lineFont = fontOf(main.family, await fontStyle(main.fontName));
          }
          return lineFont;
        };
        const locate = async (offset) => {
          const span = [...spans].reverse().find((s) => s.start <= offset) || spans[0];
          const local = Math.min(offset - span.start, span.run.str.length);
          return { span, x: span.run.x + span.run.width * (await proportion(span.run.str, local)) };
        };
        PATTERN.lastIndex = 0;
        for (let m; (m = PATTERN.exec(text)); ) {
          const name = m.slice(1).find((g) => g !== undefined).trim();
          if (!/[A-Za-z]/.test(name)) continue;
          const start = await locate(m.index);
          const end = await locate(m.index + m[0].length);
          const run = start.span.run;
          const inline = text.trim() !== m[0].trim();
          const x = round(start.x - ox);
          const width = round(Math.max(1, end.x - start.x));
          found.push({
            text: m[0],
            name,
            page: p - 1,
            x,
            y: round(run.y - oy),
            width,
            size: round(run.size),
            font: fontOf(run.family, await fontStyle(run.fontName)),
            centred: !leftAligned && (inline ? centredOnPage(lineX, lineWidth) : centredOnPage(x, width, 0.08)),
            limit,
            line: inline ? { text: text.trim(), x: round(lineX), width: round(lineWidth), font: await lineFontOf(), limit } : null,
          });
        }
      }
    }
    // The cover colour (what is around the placeholder, or its whole line) and the colours of the letters.
    const colours = await sampleColours(
      pdf,
      found.map((f) => ({ page: f.page, own: f, box: f.line ? { x: f.line.x, y: f.y, width: f.line.width, size: f.size } : f })),
    );
    found.forEach((f, i) => {
      f.background = colours[i].background;
      f.color = colours[i].text;
      if (f.line) f.line.color = colours[i].lineText;
    });
  } finally {
    await task.destroy().catch(() => {});
  }
  return found;
}

/**
 * The system field a placeholder most likely means. fields: [{ id, label, aliases }]. Resolves to an id or null.
 */
function suggestField(name, fields) {
  const key = normalise(name);
  if (!key) return null;
  for (const f of fields) if ([f.id, f.label, ...(f.aliases || [])].some((a) => normalise(a) === key)) return f.id;
  // "Name of the Participant" -> name; "Certificate No." -> certificateId: the longest alias inside the placeholder.
  let best = null;
  for (const f of fields) {
    for (const a of [f.id, f.label, ...(f.aliases || [])].map(normalise)) {
      if (a.length >= 4 && key.includes(a) && (!best || a.length > best.length)) best = { id: f.id, length: a.length };
    }
  }
  return best ? best.id : null;
}

/**
 * Turn found placeholders into mappings (the editable part of a layout), with a suggested field each.
 * pageWidth: of the template's first page, to tell whether a lone placeholder is centred.
 */
function toMappings(found, fields, pageWidth) {
  return found.map((p) => {
    const centred = p.centred ?? Math.abs(p.x + p.width / 2 - pageWidth / 2) < pageWidth * 0.08;
    return {
      text: p.text,
      page: p.page,
      x: p.x,
      y: p.y,
      width: p.width,
      size: p.size,
      field: suggestField(p.name, fields),
      font: p.font,
      color: p.color || '#1b1b20', // as the placeholder is printed in the design, when that can be seen
      align: centred ? 'center' : 'left',
      limit: p.limit ?? null, // where a left-aligned value must stop (the next text on its baseline, or the text's right edge)
      // In a sentence: the line is set again with the values in it (see drawMappings).
      fit: Boolean(p.line),
      line: p.line ? { text: p.line.text, x: p.line.x, width: p.line.width, font: p.line.font ?? null, color: p.line.color ?? null, limit: p.line.limit ?? null } : null,
      cover: p.background || '#ffffff',
    };
  });
}

const num = (raw, min, max) => (typeof raw === 'number' && Number.isFinite(raw) && raw >= min && raw <= max ? round(raw) : null);

/** Validate staff-edited mappings. fieldIds: the allowed system fields. Returns { value, errors } (errors keyed placeholders.i.prop). */
function validateMappings(raw, fieldIds, { pages = 50 } = {}) {
  if (raw === undefined) return { value: [], errors: {} };
  if (!Array.isArray(raw) || raw.length > 60) return { value: null, errors: { placeholders: 'Invalid placeholders.' } };
  const errors = {};
  const value = raw.map((m, i) => {
    const bad = (prop, msg) => {
      errors[`placeholders.${i}.${prop}`] = msg;
    };
    if (!m || typeof m !== 'object') {
      bad('field', 'Invalid placeholder.');
      return null;
    }
    const line = m.line && typeof m.line === 'object'
      ? {
          text: typeof m.line.text === 'string' ? m.line.text.slice(0, 400) : '',
          x: num(m.line.x, -100, 5000),
          width: num(m.line.width, 0.5, 5000),
          font: FONT_IDS.includes(m.line.font) ? m.line.font : null,
          color: typeof m.line.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(m.line.color) ? m.line.color.toLowerCase() : null,
          limit: m.line.limit == null ? null : num(m.line.limit, -100, 5000),
        }
      : null;
    const out = {
      text: typeof m.text === 'string' ? m.text.slice(0, 80) : '',
      page: Number.isInteger(m.page) && m.page >= 0 && m.page < pages ? m.page : null,
      x: num(m.x, -100, 5000),
      y: num(m.y, -100, 5000),
      width: num(m.width, 0.5, 5000),
      size: num(m.size, 3, 200),
      field: m.field === null || m.field === '' ? null : fieldIds.includes(m.field) ? m.field : undefined,
      font: FONT_IDS.includes(m.font) ? m.font : null,
      color: typeof m.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(m.color) ? m.color.toLowerCase() : null,
      align: ALIGNS.includes(m.align) ? m.align : null,
      limit: m.limit == null ? null : num(m.limit, -100, 5000),
      fit: typeof m.fit === 'boolean' ? m.fit : null,
      line,
      cover: m.cover === null || m.cover === 'none' ? null : typeof m.cover === 'string' && /^#[0-9a-fA-F]{6}$/.test(m.cover) ? m.cover.toLowerCase() : undefined,
    };
    for (const k of ['page', 'x', 'y', 'width', 'size']) if (out[k] === null) bad(k, 'Invalid position.');
    if (line && (line.x === null || line.width === null || !line.text.includes(out.text))) bad('line', 'Invalid line.');
    if (out.field === undefined) bad('field', 'Choose a field.');
    if (!out.font) bad('font', 'Choose a font.');
    if (!out.color) bad('color', 'Colour must look like #1b1b20.');
    if (!out.align) bad('align', 'Choose an alignment.');
    if (out.fit === null) bad('fit', 'Invalid value.');
    if (out.cover === undefined) bad('cover', 'Cover colour must look like #ffffff, or none.');
    return out;
  });
  return Object.keys(errors).length ? { value: null, errors } : { value, errors };
}

const hex = (h) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);

/** Text at `size` that fits `room` (shrinking to `minSize`, then cut with an ellipsis). Resolves to { text, size }. */
function fitText(font, text, size, minSize, room) {
  let s = size;
  while (s > minSize && font.widthOfTextAtSize(text, s) > room) s -= 0.25;
  let out = text;
  while (out.length > 1 && font.widthOfTextAtSize(out, s) > room) out = `${out.slice(0, -2)}…`;
  return { text: out, size: s };
}

/**
 * Cover the mapped placeholders on `pages` (pdf-lib pages, in order) and print their values.
 * valueOf(fieldId) -> text (already in the fonts' character set). Unmapped placeholders are left as they are.
 */
async function drawMappings(doc, pages, mappings, valueOf) {
  const fonts = new Map();
  const fontFor = async (id) => {
    if (!fonts.has(id)) fonts.set(id, await doc.embedFont(FONTS[id] || StandardFonts.Helvetica));
    return fonts.get(id);
  };
  const lines = new Map(); // placeholders that share a line, set again together
  for (const m of mappings || []) {
    const page = pages[m.page];
    if (!page) continue;
    if (m.fit && m.line) {
      const key = `${m.page}|${m.line.x}|${m.y}`;
      if (!lines.has(key)) lines.set(key, []);
      lines.get(key).push(m);
      continue;
    }
    if (!m.field) continue;
    // A placeholder on its own: replaced where it is, growing up to the page's margin.
    const font = await fontFor(m.font);
    if (m.cover) page.drawRectangle({ x: m.x - 1.5, y: m.y - m.size * 0.3, width: m.width + 3, height: m.size * 1.25, color: hex(m.cover) });
    const value = String(valueOf(m.field) ?? '');
    if (!value) continue;
    const { width: W } = page.getSize();
    const anchor = m.align === 'center' ? m.x + m.width / 2 : m.align === 'right' ? m.x + m.width : m.x;
    const right = m.limit != null && m.limit > anchor ? Math.min(m.limit, W - 20) : W - 20;
    const room = m.align === 'center' ? 2 * Math.min(anchor, W - anchor) - 40 : m.align === 'right' ? anchor - 20 : right - anchor;
    const t = fitText(font, value, m.size, Math.max(4, m.size * 0.5), room);
    const w = font.widthOfTextAtSize(t.text, t.size);
    page.drawText(t.text, { x: m.align === 'center' ? anchor - w / 2 : m.align === 'right' ? anchor - w : anchor, y: m.y, size: t.size, font, color: hex(m.color) });
  }

  // Placeholders inside a sentence: the line set again with the values in place. A centred (or right-aligned) line is
  // set again whole, so it stays centred; in left-aligned text only from the first value on, so the words before it
  // stay as designed. The words keep the line's font; each value has its placeholder's font and colour.
  for (const group of lines.values()) {
    const mapped = group.filter((m) => m.field);
    if (!mapped.length) continue; // nothing to replace: leave the line as designed
    const first = group[0];
    const { line } = first;
    const page = pages[first.page];
    const { width: W } = page.getSize();
    const size = first.size;
    const words = await fontFor(line.font || first.font);
    const whole = first.align !== 'left';
    const from = whole ? null : mapped.reduce((a, b) => (b.x < a.x ? b : a));
    const startX = whole ? line.x : from.x;
    let rest = whole ? line.text : line.text.slice(Math.max(0, line.text.indexOf(from.text)));
    const segments = [];
    for (const m of [...group].sort((a, b) => a.x - b.x)) {
      const i = rest.indexOf(m.text);
      if (i < 0) continue;
      if (i > 0) segments.push({ text: rest.slice(0, i), font: words, color: line.color || first.color });
      segments.push(m.field ? { text: String(valueOf(m.field) ?? ''), font: await fontFor(m.font), color: m.color } : { text: m.text, font: words, color: line.color || first.color });
      rest = rest.slice(i + m.text.length);
    }
    if (rest) segments.push({ text: rest, font: words, color: line.color || first.color });
    const natural = segments.reduce((w, sg) => w + sg.font.widthOfTextAtSize(sg.text, size), 0);
    const centre = line.x + line.width / 2;
    const right = line.limit != null && line.limit > startX ? Math.min(line.limit, W - 20) : W - 20;
    const room = first.align === 'center' ? 2 * Math.min(centre, W - centre) - 40 : first.align === 'right' ? line.x + line.width - 20 : right - startX;
    const scale = natural > room ? Math.max(0.6, room / natural) : 1;
    if (first.cover) page.drawRectangle({ x: startX - 2, y: first.y - size * 0.3, width: line.x + line.width - startX + 4, height: size * 1.25, color: hex(first.cover) });
    let x = first.align === 'center' ? centre - (natural * scale) / 2 : first.align === 'right' ? line.x + line.width - natural * scale : startX;
    for (const sg of segments) {
      if (!sg.text) continue;
      page.drawText(sg.text, { x, y: first.y, size: size * scale, font: sg.font, color: hex(sg.color) });
      x += sg.font.widthOfTextAtSize(sg.text, size * scale);
    }
  }
}

module.exports = { extractPlaceholders, suggestField, toMappings, validateMappings, drawMappings };
