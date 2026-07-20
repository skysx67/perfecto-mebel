// Одноразовый скрипт: узнать user_id менеджера, чтобы бот слал ему заявки.
//
// Порядок:
//   1) Менеджер открывает вашего бота в MAX и нажимает «Начать»
//      (или пишет боту любое сообщение).
//   2) Запустить:  MAX_TOKEN=<токен> node capture-id.js
//   3) Скрипт выведет user_id тех, кто недавно писал боту.
//      Этот user_id вписать в MANAGER_USER_ID (см. .env).
//
// Важно: работает только пока НЕ настроен webhook (updates и webhook
// взаимоисключающие). Для разовой настройки этого достаточно.

const https = require('https');
const TOKEN = process.env.MAX_TOKEN || '';
if (!TOKEN) { console.error('Задайте MAX_TOKEN, например: MAX_TOKEN=xxxx node capture-id.js'); process.exit(1); }

https.get({
  hostname: 'platform-api2.max.ru',
  path: '/updates?limit=100&timeout=10',
  headers: { 'Authorization': TOKEN }
}, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    let j;
    try { j = JSON.parse(d); } catch (e) { console.log('Ответ MAX:', d); return; }
    const seen = {};
    (j.updates || []).forEach(u => {
      const s = u.message && u.message.sender;
      if (s && s.user_id) seen[s.user_id] = s.name || s.username || '';
    });
    const ids = Object.keys(seen);
    if (!ids.length) {
      console.log('Пока пусто. Менеджер должен сначала написать боту в MAX, потом запусти скрипт снова.');
    } else {
      console.log('Кто писал боту (user_id → имя):');
      ids.forEach(id => console.log('  ' + id + '   ' + seen[id]));
      console.log('\nВпиши нужный user_id в переменную MANAGER_USER_ID.');
    }
  });
}).on('error', e => console.error('Ошибка соединения с MAX:', e.message,
  '\nЕсли это TLS/сертификат — установи сертификаты Минцифры (см. README) и задай NODE_EXTRA_CA_CERTS.'));
