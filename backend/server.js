const http = require('node:http');
const { saveLead, findRequest, markNotified, pendingLeads, markEmailed, bumpAttempt } = require('./db');
const max = require('./max');
const mailer = require('./mailer');
const { sendAlert } = require('./alerts');

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '127.0.0.1';
const allowedOrigin = process.env.ALLOWED_ORIGIN;
const manager = process.env.MANAGER_USER_ID;
const retryMs = Number(process.env.RETRY_MS) || 120000;
const consentVersion = '2026-11-23';
const maxBody = 8192;
const lastByIp = new Map();
let draining = false;

function report(kind, error) {
  const code = error && typeof error.code === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(error.code) ? error.code : '';
  console.error(kind, code);
  void sendAlert(kind, code);
  return code || kind;
}

function formatLead(lead) {
  const date = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Asia/Yekaterinburg', dateStyle: 'short', timeStyle: 'short',
  }).format(new Date(lead.ts));
  return [
    `🔔 Заявка #${lead.id} с сайта «Перфекто»`,
    `Получена: ${date} (Тюмень)`,
    `👤 Имя: ${lead.name || '—'}`,
    `📞 Телефон: ${lead.phone || '—'}`,
    'Перезвоните в рабочее время (ежедневно 10:00–20:00).',
  ].join('\n');
}

async function drainQueue() {
  if (draining) return;
  draining = true;
  try {
    if (!manager || !process.env.MAX_TOKEN) {
      if (pendingLeads(1).length) report('MAX_CONFIG');
      return;
    }
    let batch;
    do {
      batch = pendingLeads();
      for (const lead of batch) {
        const text = formatLead(lead);
        try {
          await max.sendToUser(manager, text);
        } catch (error) {
          const code = report('MAX_DELIVERY', error);
          const delay = Math.min(retryMs * 2 ** Math.min(lead.attempts, 8), Math.max(retryMs, 3600000));
          bumpAttempt(lead.id, code, delay);
          if (!lead.emailed && mailer.isEnabled()) {
            try {
              await mailer.sendMail('Новая заявка с сайта «Перфекто»', text);
              markEmailed(lead.id);
            } catch (mailError) {
              report('MAIL_DELIVERY', mailError);
            }
          }
          // Во время сбоя MAX ждём следующего запуска вместо пачки запросов подряд.
          return;
        }
        markNotified(lead.id);
        console.log('Заявка #%d доставлена в MAX', lead.id);
      }
    } while (batch.length);
  } catch (error) {
    report('QUEUE', error);
  } finally {
    draining = false;
  }
}

function normalizePhone(value) {
  if (typeof value !== 'string' || !/^\+?[\d ()-]{10,26}$/.test(value.trim())) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length === 10) return '+7' + digits;
  if (/^[78]\d{10}$/.test(digits)) return '+7' + digits.slice(1);
  return null;
}

function reply(res, status, code) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(code ? { ok: false, code } : { ok: true }));
}

const server = http.createServer({ requestTimeout: 20000, headersTimeout: 10000 }, (req, res) => {
  const origin = req.headers.origin;
  if (origin && (!allowedOrigin || origin === allowedOrigin || allowedOrigin === '*')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    return res.end('ok');
  }
  if (req.url !== '/lead') return reply(res, 404, 'not_found');
  if (origin && allowedOrigin && allowedOrigin !== '*' && origin !== allowedOrigin) return reply(res, 403, 'origin');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }
  if (req.method !== 'POST') return reply(res, 405, 'method');
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') return reply(res, 415, 'content_type');
  if (Number(req.headers['content-length']) > maxBody) return reply(res, 413, 'too_large');

  const ip = req.headers['x-real-ip'] || req.socket.remoteAddress || '';
  const chunks = [];
  let bytes = 0;
  req.on('error', () => {});
  req.on('data', chunk => {
    bytes += chunk.length;
    if (bytes <= maxBody) chunks.push(chunk);
  });
  req.on('end', () => {
    if (bytes > maxBody) return reply(res, 413, 'too_large');
    let input;
    try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { return reply(res, 400, 'invalid_json'); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return reply(res, 400, 'invalid_body');
    const phone = normalizePhone(input.phone);
    if (!phone) return reply(res, 422, 'bad_phone');
    if (typeof input.name !== 'string' || input.name.length > 100 || /[\r\n\u0000-\u001f]/.test(input.name)) return reply(res, 422, 'bad_name');
    if (input.consent !== true || input.consentVersion !== consentVersion) return reply(res, 422, 'consent_required');
    if (typeof input.requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.requestId)) return reply(res, 422, 'bad_request_id');
    const name = input.name.trim();
    try {
      const existing = findRequest(input.requestId);
      if (existing) return existing.phone === phone && (existing.name || '') === name ? reply(res, 200) : reply(res, 409, 'request_conflict');
      const now = Date.now();
      if (now - (lastByIp.get(ip) || 0) < 2000) return reply(res, 429, 'rate_limit');
      saveLead({ 'Имя': name, 'Телефон': phone, 'Источник': 'запись на встречу в студии' }, input.requestId, consentVersion);
      if (lastByIp.size >= 5000) lastByIp.clear();
      lastByIp.set(ip, now);
    } catch (error) {
      report('DB_SAVE', error);
      return reply(res, 503, 'storage_unavailable');
    }
    reply(res, 201);
    void drainQueue();
  });
});

server.on('error', error => {
  report('SERVER_START', error);
  process.exitCode = 1;
});
server.listen(port, host, () => {
  console.log('Perfecto слушает http://%s:%d', host, server.address().port);
  console.log('MAX: %s · Telegram: %s · резервная почта: %s',
    manager && process.env.MAX_TOKEN ? 'настроен' : 'выключен',
    process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID ? 'настроен' : 'выключен',
    mailer.isEnabled() ? 'включена' : 'выключена');
  void drainQueue();
  setInterval(drainQueue, Math.min(retryMs, 120000)).unref();
});
