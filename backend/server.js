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
const { saveLead, markNotified, listLeads, pendingLeads, markEmailed, bumpAttempt } = require('./db');
const max = require('./max');
const mailer = require('./mailer');

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

function formatLead(d, opts = {}) {
  const L = [];
  L.push(opts.delayed
    ? '🔔 Заявка с сайта «Перфекто» (доставлена с задержкой)'
    : '🔔 Новая заявка с сайта «Перфекто»');
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

// ── доставка уведомления менеджеру ───────────────────────────────────────────
// Сначала MAX. Если бот/сеть недоступны — дублируем заявку на резервную почту,
// а сама заявка остаётся в очереди и будет повторяться автоматически.
// Возвращает true, если уведомление ушло именно в MAX.
async function deliver(id, data, opts = {}) {
  const text = formatLead(data, opts);

  if (MANAGER) {
    try {
      await max.sendToUser(MANAGER, text);
      if (id) markNotified(id);
      if (opts.delayed) console.log('Заявка #' + id + ' доставлена в MAX с задержкой');
      return true;
    } catch (e) {
      if (id) bumpAttempt(id, e.message);
      console.error('MAX недоступен (заявка #' + id + '): ' + e.message);
    }
  } else {
    if (id) bumpAttempt(id, 'MANAGER_USER_ID не задан');
    console.warn('MANAGER_USER_ID не задан — заявка сохранена, но в MAX не отправлена');
  }

  // резерв: письмо (шлём один раз на заявку, чтобы не спамить)
  if (!opts.alreadyEmailed && mailer.isEnabled()) {
    try {
      await mailer.sendMail('Новая заявка с сайта «Перфекто»',
        text + '\n\n— — —\nЭто резервное письмо: уведомление в MAX не доставлено.\n' +
        'Заявка сохранена и уйдёт в MAX автоматически, как только бот заработает.');
      if (id) markEmailed(id);
      console.log('Заявка #' + id + ' продублирована на резервную почту');
    } catch (e) {
      console.error('Резервная почта не сработала (заявка #' + id + '): ' + e.message);
    }
  }
  return false;
}

// ── автоповтор недоставленных заявок ─────────────────────────────────────────
// Раз в RETRY_MS проверяем очередь: как только MAX оживёт, всё накопленное уйдёт туда.
const RETRY_MS = Number(process.env.RETRY_MS || 120000); // по умолчанию 2 минуты
let retrying = false;

async function retryPending() {
  if (retrying || !MANAGER) return;
  retrying = true;
  try {
    const rows = pendingLeads({ maxAgeHours: 24, limit: 20 });
    if (rows.length) console.log('Очередь недоставленных: ' + rows.length + ' — пробую отправить');
    for (const row of rows) {
      let data;
      try { data = JSON.parse(row.raw || '{}'); } catch (e) { continue; }
      const ok = await deliver(row.id, data, { delayed: true, alreadyEmailed: row.emailed === 1 });
      if (!ok) break; // MAX всё ещё недоступен — ждём следующего круга
    }
  } catch (e) {
    console.error('Ошибка обработки очереди: ' + e.message);
  } finally {
    retrying = false;
  }
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

    // 2) уведомление менеджеру: MAX, при сбое — резервная почта.
    //    Асинхронно: ответ клиенту не ждёт ни MAX, ни почту.
    deliver(id, data).catch(e => console.error('Ошибка доставки: ' + e.message));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
});

// Слушаем только localhost: наружу запросы пускает nginx (см. deploy/).
// Переопределить можно переменной HOST (например HOST=0.0.0.0).
const HOST = process.env.HOST || '127.0.0.1';

server.listen(PORT, HOST, () => {
  console.log('Perfecto lead backend слушает ' + HOST + ':' + PORT);
  console.log('MAX_TOKEN: ' + (process.env.MAX_TOKEN ? 'задан' : 'НЕ задан') +
    ' · MANAGER_USER_ID: ' + (MANAGER || 'НЕ задан') +
    ' · резервная почта: ' + (mailer.isEnabled() ? 'вкл (' + mailer.cfg().to + ')' : 'выкл'));

  // очередь: первый прогон через 10 секунд, дальше — раз в RETRY_MS
  setTimeout(retryPending, 10000);
  setInterval(retryPending, RETRY_MS).unref?.();
});
