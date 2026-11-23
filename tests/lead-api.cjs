// Isolated backend checks. Neither MAX nor Telegram is contacted.
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(check) {
  for (let i = 0; i < 80; i++) {
    if (check()) return;
    await delay(25);
  }
  throw new Error('Timed out awaiting delivery');
}

Object.assign(process.env, {
  HOST: '127.0.0.1', PORT: '0', DB_FILE: join(mkdtempSync(join(tmpdir(), 'perfecto-api-test-')), 'test.sqlite'),
  MAX_TOKEN: 'mock', MANAGER_USER_ID: '123', SMTP_PASS: '', RETRY_MS: '250',
  TELEGRAM_BOT_TOKEN: 'mock', TELEGRAM_CHAT_ID: '123', ALLOWED_ORIGIN: 'http://127.0.0.1:8080',
});
const originalFetch = global.fetch;
const alerts = [];
global.fetch = async (url, options) => {
  assert.equal(new URL(url).hostname, 'api.telegram.org');
  alerts.push(JSON.parse(options.body).text);
  return Response.json({ ok: true });
};

let failMax = false;
let calls = 0;
let releaseMax;
const firstSend = new Promise(resolve => { releaseMax = resolve; });
require('../backend/max').sendToUser = async () => {
  calls++;
  if (calls === 1) await firstSend;
  if (failMax) throw Object.assign(new Error('mock with private details'), { code: 'HTTP_503' });
};

const createServer = http.createServer;
let server;
http.createServer = (...args) => (server = createServer(...args));
require('../backend/server');
http.createServer = createServer;

(async () => {
  await once(server, 'listening');
  const sqlite = new DatabaseSync(process.env.DB_FILE);
  const { listLeads, saveLead } = require('../backend/db');
  const post = body => originalFetch(`http://127.0.0.1:${server.address().port}/lead`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const lead = { name: 'Тест', phone: '8 (000) 000-00-00', consent: true, consentVersion: '2026-11-23', requestId: randomUUID() };
  try {
    assert.equal((await post(null)).status, 400);
    assert.equal((await post({ ...lead, phone: 'abc' })).status, 422);
    assert.equal((await post({ ...lead, consent: false })).status, 422);
    assert.equal(listLeads().length, 0);
    assert.equal((await post(lead)).status, 201);
    assert.equal((await post(lead)).status, 200);
    assert.equal((await post({ ...lead, name: 'Другой' })).status, 409);
    await delay(550);
    assert.equal(calls, 1, 'Pending MAX delivery must not run twice');
    assert.equal(listLeads().length, 1);
    assert.equal(listLeads(1)[0].phone, '+70000000000');
    assert.equal(listLeads(1)[0].consent_version, '2026-11-23');
    releaseMax();
    await waitFor(() => listLeads(1)[0].notified === 1);

    failMax = true;
    const oldId = saveLead({ 'Имя': 'Тест', 'Телефон': '+70000000000' }, randomUUID(), '2026-11-23');
    sqlite.prepare('UPDATE leads SET ts = ? WHERE id = ?').run(new Date(Date.now() - 25 * 3600000).toISOString(), oldId);
    await waitFor(() => listLeads(1)[0].attempts > 0);
    assert.equal(listLeads(1)[0].notified, 0);
    failMax = false;
    await waitFor(() => listLeads(1)[0].notified === 1);

    await delay(1500);
    sqlite.exec("CREATE TRIGGER failed_write BEFORE INSERT ON leads BEGIN SELECT RAISE(ABORT,'mock with private details'); END");
    const failed = await post({ ...lead, requestId: randomUUID() });
    assert.equal(failed.status, 503);
    assert.equal((await failed.json()).code, 'storage_unavailable');
    assert.equal(listLeads().length, 2);
    assert.ok(alerts.some(text => text.includes('MAX_DELIVERY') && text.includes('HTTP_503')));
    assert.ok(alerts.some(text => text.includes('DB_SAVE')));
    assert.equal(alerts.some(text => text.includes('private details') || text.includes(lead.phone)), false);
    console.log('PASS validation, confirmed storage, idempotency, slow MAX, old queued lead, storage failure and sanitized Telegram alerts');
  } finally {
    releaseMax();
    sqlite.close();
    server.close();
    global.fetch = originalFetch;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
