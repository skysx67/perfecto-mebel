// Перфекто — минимальный клиент Bot API мессенджера MAX. Без внешних зависимостей.
//
// API (сверено с dev.max.ru/docs-api, июль 2026):
//   база          https://platform-api2.max.ru
//   авторизация   заголовок  Authorization: <токен>   (БЕЗ префикса 'Bearer')
//   кто я         GET  /me
//   отправка в ЛС POST /messages?user_id=<id>   тело {text, notify[, format]}
//   входящие      GET  /updates?marker=&timeout=&types=message_created,bot_started
//
// ВАЖНО (TLS): platform-api2.max.ru отдаёт сертификат с корнем Минцифры, которому
// Node по умолчанию НЕ доверяет. На сервере задать NODE_EXTRA_CA_CERTS=/путь/ca.pem
// (см. README), иначе любые запросы падают с UNABLE_TO_VERIFY_LEAF_SIGNATURE.
//
// Вся специфика API собрана здесь: при переезде/смене бота меняется только .env,
// а не код.

const https = require('https');

const HOST = process.env.MAX_API_HOST || 'platform-api2.max.ru';

function api(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const TOKEN = process.env.MAX_TOKEN || '';
    if (!TOKEN) return reject(new Error('MAX_TOKEN не задан (см. .env)'));
    const payload = body ? JSON.stringify(body) : null;
    const headers = { 'Authorization': TOKEN };
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = https.request({ hostname: HOST, path: urlPath, method, headers, timeout: 30000 }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let json = null;
        try { json = data ? JSON.parse(data) : {}; } catch (e) { /* не JSON — вернём как текст */ }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(json !== null ? json : data);
        else reject(new Error('MAX ' + res.statusCode + ': ' + data));
      });
    });
    req.on('timeout', () => req.destroy(new Error('MAX API timeout')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Информация о боте — проверка, что токен валиден и API достижим.
function getMe() { return api('GET', '/me'); }

// Отправить текст пользователю (менеджеру). По умолчанию — простой текст (без markdown),
// чтобы спецсимволы в имени/почте гарантированно не ломали разметку.
function sendToUser(userId, text, opts = {}) {
  const body = { text: text, notify: opts.notify !== false };
  if (opts.format) body.format = opts.format;
  return api('POST', '/messages?user_id=' + encodeURIComponent(userId), body);
}

// Входящие события (long polling). marker — курсор с прошлого запроса.
function getUpdates({ marker, timeout = 20, limit = 100, types } = {}) {
  const q = new URLSearchParams();
  q.set('limit', String(limit));
  q.set('timeout', String(timeout));
  if (marker) q.set('marker', String(marker));
  if (types) q.set('types', types);
  return api('GET', '/updates?' + q.toString());
}

module.exports = { getMe, sendToUser, getUpdates, HOST };
