'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { csvCell, toCsv, nationalPhone } = require('../src/csv');
const { normalizePhone } = require('../src/validation');
const { escapeChat, inquiryLink } = require('../src/notify');

test('csvCell neutralises formula injection', () => {
  assert.equal(csvCell('=1+1'), "'=1+1");
  assert.equal(csvCell('+91'), "'+91");
  assert.equal(csvCell('-5'), "'-5");
  assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(csvCell('\tx'), "'\tx");
  assert.equal(csvCell('\rx'), `"'\rx"`);
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell(' =not-first-char'), ' =not-first-char');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(12), '12');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=a,"b"'), `"'=a,""b"""`);
});

test('toCsv uses BOM and CRLF', () => {
  assert.equal(toCsv(['a', 'b'], [[1, '=x']]), "\uFEFFa,b\r\n1,'=x\r\n");
});

test('nationalPhone exports +91 numbers as 10 digits (no formula prefix needed)', () => {
  assert.equal(nationalPhone('+919492631715'), '9492631715');
  assert.equal(csvCell(nationalPhone('+919492631715')), '9492631715');
  assert.equal(nationalPhone('=1+1'), '=1+1', 'non-phone values untouched (still guarded by csvCell)');
  assert.equal(csvCell(nationalPhone('=1+1')), "'=1+1");
});

test('normalizePhone', () => {
  assert.equal(normalizePhone('9876543210'), '+919876543210');
  assert.equal(normalizePhone('+91-98765-43210'), '+919876543210');
  assert.equal(normalizePhone('09876543210'), '+919876543210');
  assert.equal(normalizePhone('919876543210'), '+919876543210');
  assert.equal(normalizePhone('5876543210'), null);
  assert.equal(normalizePhone('+1 415 555 0100'), null);
  assert.equal(normalizePhone(9876543210), null);
});

test('chat notification text is escaped and links to the dashboard', () => {
  assert.equal(escapeChat('<!channel> & co'), '&lt;!channel&gt; &amp; co');
  assert.equal(inquiryLink('https://dash.example/', 7), 'https://dash.example/#/enquiries/7');
});
