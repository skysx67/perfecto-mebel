// Перфекто — приём заявок с лендинга и уведомление менеджера в MAX.
// Без внешних зависимостей. Требуется Node 18+. Запуск: node server.js
//
// Переменные окружения (см. .env.example):
//   MAX_TOKEN         — токен бота из @MasterBot
//   MANAGER_USER_ID   — user_id менеджера (узнать через capture-id.js)
//   PORT              — порт (по умолчанию 8787)
//   ALLOWED_ORIGIN    — домен сайта для CORS (по умолчанию '*')
//   NODE_EXTRA_CA_CERTS — путь к сертификатам Минцифры (см. README)
//
// API MAX (на июль 2026): база https://platform-api2.max.ru,
// авторизация заголовком "Authorization: <токен>" БЕЗ префикса Bearer,
// отправка в личный диалог по ?user_id=, поле format НЕ используем (шлём текст).

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.MAX_TOKEN || '';
const MANAGER = process.env.MANAGER_USER_ID || '';
const PORT = process.env.PORT || 8787;
const ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const LEADS_FILE = path.join(__dirname, 'leads.jsonl');

// красивые подписи полей + желаемый порядок
const LABELS = {
  'Имя': '👤 Имя', 'Телефон': '📞 Телефон', 'Email': '✉️ Email',
  'Тип мебели': 'Что делаем', 'Замеры': 'Замеры', 'Дизайн': 'Проект/дизайн',
  'Сроки': 'Когда нужно', 'Источник': 'Источник'
};

function formatLead(d) {
  const head = '🔔 Новая заявка с сайта «Перфекто»';
  const order = Object.keys(LABELS).filter(k => d[k]);
  const rest = Object.keys(d).filter(k => !LABELS[k] && k !== 'ts' && d[k]);
  const body = order.concat(rest)
    .map(k => (LABELS[k] || k) + ': ' + d[k])
    .join('\n');
  return head + '\n\n' + body;
}

function sendToMax(text) {
  return new Promise((resolve, reject) => {
    if (!TOKEN || !MANAGER) return reject(new Error('MAX_TOKEN или MANAGER_USER_ID не заданы'));
    const payload = JSON.stringify({ text: text, notify: true });
    const req = https.request({
      hostname: 'platform-api2.max.ru',
      path: '/messages?user_id=' + encodeURIComponent(MANAGER),
      method: 'POST',
      headers: {
        'Authorization': TOKEN,                 // важно: без 'Bearer'
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => res.statusCode < 300
        ? resolve(data)
        : reject(new Error('MAX ' + res.statusCode + ': ' + data)));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (req.method === 'GET' && req.url === '/health') { res.writeHead(200); return res.end('ok'); }
  if (req.method !== 'POST' || req.url !== '/lead') { res.writeHead(404); return res.end('not found'); }

  let raw = '';
  req.on('data', c => { raw += c; if (raw.length > 10000) req.destroy(); });
  req.on('end', () => {
    let data;
    try { data = JSON.parse(raw || '{}'); } catch (e) { res.writeHead(400); return res.end('bad json'); }

    // минимальная защита: телефон обязателен
    const phone = data['Телефон'] || data.phone;
    if (!phone) { res.writeHead(422); return res.end('no phone'); }

    // 1) сохраняем заявку в файл-журнал (это наша «база»)
    const record = Object.assign({ ts: new Date().toISOString() }, data);
    try { fs.appendFileSync(LEADS_FILE, JSON.stringify(record) + '\n'); }
    catch (e) { console.error('Не удалось сохранить лид:', e.message); }

    // 2) шлём уведомление менеджеру в MAX (не роняем ответ, если MAX недоступен)
    sendToMax(formatLead(data)).catch(e => console.error('MAX send failed:', e.message));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
});

server.listen(PORT, () => console.log('Perfecto lead backend слушает :' + PORT));
