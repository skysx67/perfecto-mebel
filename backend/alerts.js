const titles = {
  DB_SAVE: 'Ошибка сохранения заявки в SQLite',
  QUEUE: 'Ошибка обработки очереди заявок',
  MAX_CONFIG: 'Не настроен получатель или токен MAX',
  MAX_DELIVERY: 'Не удалось передать заявку в MAX',
  MAIL_DELIVERY: 'Не удалось отправить резервное письмо',
  SERVICE_STOP: 'Сервис заявок остановился с ошибкой',
  SERVER_START: 'Не удалось запустить сервер заявок',
};
const lastAlert = new Map();

async function sendAlert(kind, detail = '') {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId || !Object.hasOwn(titles, kind)) return;
  const now = Date.now();
  if (now - (lastAlert.get(kind) || 0) < 10 * 60 * 1000) return;
  lastAlert.set(kind, now);

  // Оставляем только код диагностики. Тексты ошибок могут содержать данные заявки.
  const code = typeof detail === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(detail) ? detail : '';
  const text = `Перфекто · ${titles[kind]}\nКод: ${kind}${code ? ` / ${code}` : ''}`;
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }), signal: AbortSignal.timeout(7000),
    });
    const result = await response.json();
    if (!response.ok || result.ok !== true) console.error('Telegram: уведомление не принято (HTTP %d)', response.status);
  } catch {
    console.error('Telegram: не удалось доставить техническое уведомление');
  }
}

if (require.main === module && process.env.SERVICE_RESULT && process.env.SERVICE_RESULT !== 'success') {
  void sendAlert('SERVICE_STOP', process.env.SERVICE_RESULT);
}

module.exports = { sendAlert };
