// Одноразовый скрипт: узнать user_id менеджера, чтобы бот слал ему заявки.
//
// Порядок:
//   1) Менеджер открывает бота в MAX и нажимает «Начать» (или пишет любое сообщение).
//   2) Запустить:  npm run capture-id     (или: node --env-file=.env capture-id.js)
//   3) Скрипт покажет user_id тех, кто недавно писал/стартовал бота.
//      Нужный user_id вписать в .env → MANAGER_USER_ID.
//
// Работает через long polling GET /updates. Пока НЕ настроен webhook — можно.

const max = require('./max');

// Достаём человека из события любого типа (bot_started / message_created / message_callback…)
function personFrom(u) {
  const cands = [
    u && u.message && u.message.sender,   // message_created
    u && u.user,                          // bot_started
    u && u.callback && u.callback.user,   // нажатие кнопки
    u,                                    // на всякий: поля на верхнем уровне
  ];
  for (const c of cands) {
    if (c && c.user_id) return { id: c.user_id, name: c.name || c.first_name || c.username || '' };
  }
  return null;
}

(async () => {
  try {
    const me = await max.getMe();
    console.log('Бот: ' + (me.name || me.username) + ' (@' + me.username + '), id ' + me.user_id + '\n');
  } catch (e) {
    console.error('Не удалось обратиться к API MAX:', e.message);
    if (/certificate|issuer|self.signed/i.test(e.message)) {
      console.error('\n⚠ Похоже на проблему с сертификатом Минцифры. На боевом сервере');
      console.error('  установите сертификаты и задайте NODE_EXTRA_CA_CERTS (см. README).');
    }
    process.exit(1);
  }

  try {
    const res = await max.getUpdates({ timeout: 5, limit: 100, types: 'bot_started,message_created' });
    const updates = res.updates || [];
    const seen = {};
    updates.forEach(u => {
      const p = personFrom(u);
      if (p) seen[p.id] = p.name;
    });
    const ids = Object.keys(seen);
    if (!ids.length) {
      console.log('Пока никто не писал боту.');
      console.log('→ Открой бота в MAX, нажми «Начать», затем запусти скрипт снова.');
    } else {
      console.log('Кто взаимодействовал с ботом (user_id → имя):');
      ids.forEach(id => console.log('  ' + id + '   ' + (seen[id] || '')));
      console.log('\nВпиши нужный user_id в .env → MANAGER_USER_ID.');
    }
  } catch (e) {
    console.error('Ошибка получения событий:', e.message);
    process.exit(1);
  }
})();
