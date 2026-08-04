// Перфекто — резервная доставка заявок на почту. Без внешних зависимостей:
// минимальный SMTP-клиент поверх TLS (порт 465, шифрование сразу) с AUTH LOGIN.
//
// Настройки в .env:
//   SMTP_HOST (по умолч. smtp.mail.ru), SMTP_PORT (465),
//   SMTP_USER — почтовый ящик, SMTP_PASS — пароль для внешних приложений,
//   MAIL_TO   — куда слать (по умолчанию тот же ящик).
//
// Если SMTP_PASS не заполнен — резервная почта просто выключена,
// заявки всё равно копятся в базе и уходят в MAX при первой возможности.

const tls = require('node:tls');

function cfg() {
  const user = process.env.SMTP_USER || '';
  return {
    host: process.env.SMTP_HOST || 'smtp.mail.ru',
    port: Number(process.env.SMTP_PORT || 465),
    user,
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || user,
    to:   process.env.MAIL_TO   || user
  };
}

// Настроена ли резервная почта
function isEnabled() {
  const c = cfg();
  return !!(c.host && c.user && c.pass && c.to);
}

const b64 = s => Buffer.from(String(s), 'utf8').toString('base64');

// Тема письма с кириллицей — кодируется по RFC 2047
const encodeSubject = s => '=?UTF-8?B?' + b64(s) + '?=';

function buildMessage(c, subject, text) {
  const body = b64(text).replace(/(.{76})/g, '$1\r\n'); // base64 строками по 76 символов
  return [
    'From: ' + c.from,
    'To: ' + c.to,
    'Subject: ' + encodeSubject(subject),
    'Date: ' + new Date().toUTCString(),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    body
  ].join('\r\n');
}

// Отправить письмо. Возвращает Promise.
function sendMail(subject, text) {
  return new Promise((resolve, reject) => {
    const c = cfg();
    if (!isEnabled()) return reject(new Error('SMTP не настроен (заполни SMTP_* в .env)'));

    // Диалог с сервером: «дождались код → отправили команду»
    const steps = [
      { expect: 220, send: 'EHLO perfecto' },
      { expect: 250, send: 'AUTH LOGIN' },
      { expect: 334, send: b64(c.user) },
      { expect: 334, send: b64(c.pass) },
      { expect: 235, send: 'MAIL FROM:<' + c.from + '>' },
      { expect: 250, send: 'RCPT TO:<' + c.to + '>' },
      { expect: 250, send: 'DATA' },
      { expect: 354, send: buildMessage(c, subject, text) + '\r\n.' },
      { expect: 250, send: 'QUIT', accepted: true }, // письмо принято сервером
      { expect: 221, send: null }
    ];

    let i = 0, buf = '', done = false, accepted = false;
    const sock = tls.connect({ host: c.host, port: c.port, servername: c.host });

    const finish = err => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch (e) {}
      err ? reject(err) : resolve();
    };

    sock.setEncoding('utf8');
    sock.setTimeout(20000, () => finish(new Error('SMTP: превышено время ожидания')));
    sock.on('error', e => { accepted ? finish(null) : finish(e); });
    sock.on('close', () => finish(accepted ? null : new Error('SMTP: соединение закрыто раньше времени')));

    sock.on('data', chunk => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n')) !== -1 && !done) {
        const line = buf.slice(0, idx).replace(/\r$/, '');
        buf = buf.slice(idx + 1);
        const m = /^(\d{3})([ -])/.exec(line);
        if (!m || m[2] === '-') continue;   // '-' = промежуточная строка ответа
        const step = steps[i];
        if (!step) continue;
        if (Number(m[1]) !== step.expect) {
          // пароль/логин не подошли и т.п.
          return finish(new Error('SMTP ' + m[1] + ': ' + line));
        }
        i++;
        if (step.accepted) accepted = true;
        if (step.send === null) return finish(null);
        sock.write(step.send + '\r\n');
      }
    });
  });
}

module.exports = { sendMail, isEnabled, cfg };
