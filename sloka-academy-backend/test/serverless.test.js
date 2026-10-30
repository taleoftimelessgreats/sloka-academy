'use strict';

// The serverless entry used on Vercel: the same app, started on the first request, with work that
// outlives a response handed to `background`.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createHandler } = require('../src/serverless');
const { openTestDatabase, validInquiry, ALLOWED_ORIGIN, TEST_SECRET } = require('./helpers');

const listen = (server) =>
  new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));

describe('serverless handler', () => {
  let tdb;
  let handler;
  let api;
  let hook;
  let base;
  const handedOver = [];
  const webhookCalls = [];

  before(async () => {
    tdb = await openTestDatabase();
    // Stands in for the Slack/Chat webhook that new enquiries are announced to.
    hook = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        webhookCalls.push(JSON.parse(body));
        res.end('ok');
      });
    });
    const hookUrl = await listen(hook);
    handler = createHandler({
      env: { DATABASE_URL: tdb.url, JWT_SECRET: TEST_SECRET, ALLOWED_ORIGINS: ALLOWED_ORIGIN, NOTIFY_WEBHOOK_URL: hookUrl },
      background: (promise) => handedOver.push(promise),
    });
    api = http.createServer(handler);
    base = await listen(api);
  });

  after(async () => {
    await Promise.allSettled(handedOver);
    await new Promise((resolve) => api.close(resolve));
    await new Promise((resolve) => hook.close(resolve));
    await handler.close();
    await tdb.drop();
  });

  test('starts on the first request and serves the API', async () => {
    const me = await fetch(`${base}/api/auth/me`);
    assert.equal(me.status, 401);
  });

  test('hands the enquiry notification to background and it completes', async () => {
    const before = handedOver.length;
    const res = await fetch(`${base}/api/public/inquiries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN },
      body: JSON.stringify(validInquiry()),
    });
    assert.equal(res.status, 201);
    assert.equal(handedOver.length, before + 1);
    await handedOver.at(-1);
    assert.equal(webhookCalls.length, 1);
    assert.match(webhookCalls[0].text, /enquiry/i);
  });
});
