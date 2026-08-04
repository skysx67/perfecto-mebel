// Перфекто — хранилище заявок в SQLite.
// Используем встроенный модуль node:sqlite (Node 22.5+/24 — внешних зависимостей нет).
// Файл базы: leads.db (в .gitignore). Его можно копировать/переносить на другой сервер.

const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'leads.db');
const db = new DatabaseSync(DB_FILE);

// Таблица заявок. Отдельные колонки под ключевые поля (удобно фильтровать/выгружать),
// плюс raw — полный JSON заявки на случай будущих новых полей.
db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    ts        TEXT NOT NULL,   -- время заявки (ISO, UTC)
    name      TEXT,            -- Имя
    phone     TEXT,            -- Телефон
    email     TEXT,            -- Email
    source    TEXT,            -- Источник: 'квиз' / 'форма контактов'
    furniture TEXT,            -- Тип мебели (из квиза)
    measure   TEXT,            -- Замеры (из квиза)
    design    TEXT,            -- Дизайн/проект (из квиза)
    terms     TEXT,            -- Сроки (из квиза)
    raw       TEXT,            -- полный JSON заявки
    ip        TEXT,            -- IP клиента (для анти-спама)
    ua        TEXT,            -- User-Agent
    notified  INTEGER DEFAULT 0 -- 1, если уведомление в MAX ушло успешно
  );
`);

// Миграция: добавляем недостающие колонки, если база создана более старой версией.
// (SQLite не умеет ADD COLUMN IF NOT EXISTS, поэтому проверяем сами.)
const existing = new Set(db.prepare('PRAGMA table_info(leads)').all().map(c => c.name));
const EXTRA_COLS = {
  emailed:    'INTEGER DEFAULT 0',  // 1, если заявка ушла на резервную почту
  attempts:   'INTEGER DEFAULT 0',  // сколько раз пробовали отправить в MAX
  last_error: 'TEXT'                // текст последней ошибки доставки
};
for (const [col, type] of Object.entries(EXTRA_COLS)) {
  if (!existing.has(col)) db.exec(`ALTER TABLE leads ADD COLUMN ${col} ${type}`);
}

const insertStmt = db.prepare(`
  INSERT INTO leads (ts, name, phone, email, source, furniture, measure, design, terms, raw, ip, ua, notified)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
`);

// Сохранить заявку. Возвращает id новой записи.
function saveLead(d, meta = {}) {
  const info = insertStmt.run(
    new Date().toISOString(),
    d['Имя']       || null,
    d['Телефон']   || null,
    d['Email']     || null,
    d['Источник']  || null,
    d['Тип мебели']|| null,
    d['Замеры']    || null,
    d['Дизайн']    || null,
    d['Сроки']     || null,
    JSON.stringify(d),
    meta.ip || null,
    meta.ua || null
  );
  return Number(info.lastInsertRowid);
}

// Отметить, что уведомление менеджеру доставлено.
const markStmt = db.prepare('UPDATE leads SET notified = 1 WHERE id = ?');
function markNotified(id) { markStmt.run(id); }

// Последние заявки (для выгрузки/проверки).
const listStmt = db.prepare('SELECT * FROM leads ORDER BY id DESC LIMIT ?');
function listLeads(limit = 200) { return listStmt.all(limit); }

// ── очередь недоставленных в MAX ─────────────────────────────────────────────

// Заявки, которые ещё не ушли в MAX (свежие — старше суток не долбим).
const pendingStmt = db.prepare(`
  SELECT * FROM leads
  WHERE notified = 0 AND ts >= ?
  ORDER BY id ASC LIMIT ?
`);
function pendingLeads({ maxAgeHours = 24, limit = 50 } = {}) {
  const since = new Date(Date.now() - maxAgeHours * 3600e3).toISOString();
  return pendingStmt.all(since, limit);
}

// Отметить, что заявка ушла на резервную почту.
const emailedStmt = db.prepare('UPDATE leads SET emailed = 1 WHERE id = ?');
function markEmailed(id) { emailedStmt.run(id); }

// Зафиксировать неудачную попытку доставки в MAX.
const attemptStmt = db.prepare('UPDATE leads SET attempts = attempts + 1, last_error = ? WHERE id = ?');
function bumpAttempt(id, err) { attemptStmt.run(String(err || '').slice(0, 500), id); }

module.exports = {
  saveLead, markNotified, listLeads,
  pendingLeads, markEmailed, bumpAttempt,
  DB_FILE
};
