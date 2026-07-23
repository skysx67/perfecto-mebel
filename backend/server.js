// Перфекто — приём заявок с лендинга: сохранение в SQLite + уведомление менеджеру в MAX.
// Без внешних зависимостей. Node 22.5+/24. Запуск: node --env-file=.env server.js
//
// Переменные окружения (.env, см. .env.example):
//   MAX_TOKEN         — токен бота из @MasterBot
//   MANAGER_USER_ID   — user_id менеджера (узнать через: npm run capture-id)
//   PORT              — порт (по умолчанию 8787)
//   ALLOWED_ORIGIN    — домен сайта для CORS (по умолчанию '*')
//   ADMIN_KEY         — ключ для GET /leads?key=... (пусто = эндпоинт выключен)
//   NODE_EXTRA_CA_CERTS — путь к сертификатам Минцифры (нужно на боевом сервере)

const http = require('http');
const { saveLead, markNotified, listLeads } = require('./db');
const max = require('./max');

const PORT = process.env.PORT || 8787;
const ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const MANAGER = process.env.MANAGER_USER_ID || '';

// ── формирование сообщения менеджеру ─────────────────────────────────────────
const QUIZ_LABELS = [
  ['Тип мебели', 'Что делаем'],
  ['Замеры', 'Размеры'],
  ['Дизайн', 'Проект/дизайн'],
  ['Сроки', 'Когда нужно'],
];
const KNOWN = new Set(['Имя', 'Телефон', 'Email', 'Источник', 'Тип мебели', 'Замеры', 'Дизайн', 'Сроки']);

function whenStr() {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Asia/Yekaterinburg', day: '2-digit', month: '2-digit',
    year: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(new Date());
}

function formatLead(d) {
  const L = [];
  L.push('🔔 Новая заявка с сайта «Перфекто»');
  L.push('Источник: ' + (d['Источник'] || '—') + ' · ' + whenStr() + ' (Тюмень)');
  L.push('');
  L.push('👤 Имя: ' + (d['Имя'] || '—'));
  L.push('📞 Телефон: ' + (d['Телефон'] || '—'));
  if (d['Email']) L.push('✉️ Email: ' + d['Email']);

  const quiz = QUIZ_LABELS.filter(([k]) => d[k]);
  if (quiz.length) {
    L.push('');
    L.push('📋 Из квиза:');
    quiz.forEach(([k, label]) => L.push('• ' + label + ': ' + d[k]));
  }
  // прочие поля, которых нет в известном наборе (на будущее)
  Object.keys(d).filter(k => !KNOWN.has(k) && d[k])
    .forEach(k => L.push('• ' + k + ': ' + d[k]));

  L.push('');
  L.push('☎️ Перезвоните клиенту в рабочее время (ежедневно 10:00–20:00).');
  return L.join('\n');
}

// ── простой анти-флуд: не чаще 1 заявки в 2 сек с одного IP ───────────────────
const lastByIp = new Map();
function throttled(ip) {
  const now = Date.now();
  if (now - (lastByIp.get(ip) || 0) < 2000) return true;
  lastByIp.set(ip, now);
  if (lastByIp.size > 5000) lastByIp.clear();
  return false;
}

// ── HTTP-сервер ──────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (req.method === 'GET' && req.url === '/health') { res.writeHead(200); return res.end('ok'); }

  // Просмотр заявок (только если задан ADMIN_KEY и он совпал).
  if (req.method === 'GET' && req.url.startsWith('/leads')) {
    const key = new URL(req.url, 'http://x').searchParams.get('key');
    if (!ADMIN_KEY || key !== ADMIN_KEY) { res.writeHead(403); return res.end('forbidden'); }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(listLeads(500), null, 2));
  }

  if (req.method !== 'POST' || req.url !== '/lead') { res.writeHead(404); return res.end('not found'); }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
  const ua = req.headers['user-agent'] || '';

  let raw = '';
  req.on('data', c => { raw += c; if (raw.length > 10000) req.destroy(); });
  req.on('end', () => {
    let data;
    try { data = JSON.parse(raw || '{}'); } catch (e) { res.writeHead(400); return res.end('bad json'); }

    const phone = data['Телефон'] || data.phone;
    if (!phone) { res.writeHead(422); return res.end('no phone'); }
    if (throttled(ip)) { res.writeHead(429); return res.end('too many'); }

    // 1) сохраняем в SQLite (не теряем заявку, даже если MAX недоступен)
    let id = null;
    try { id = saveLead(data, { ip, ua }); }
    catch (e) { console.error('SQLite save failed:', e.message); }

    // 2) уведомление менеджеру в MAX — асинхронно, ответ клиенту не ждёт MAX
    if (MANAGER) {
      max.sendToUser(MANAGER, formatLead(data))
        .then(() => { if (id) markNotified(id); })
        .catch(e => console.error('MAX send failed:', e.message));
    } else {
      console.warn('MANAGER_USER_ID не задан — заявка сохранена, но в MAX не отправлена. Запусти: npm run capture-id');
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
});

server.listen(PORT, () => {
  console.log('Perfecto lead backend слушает :' + PORT);
  console.log('MAX_TOKEN: ' + (process.env.MAX_TOKEN ? 'задан' : 'НЕ задан') +
    ' · MANAGER_USER_ID: ' + (MANAGER || 'НЕ задан'));
});
