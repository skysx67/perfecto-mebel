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
  last_error: 'TEXT',
  next_retry_at: 'TEXT',
  request_id: 'TEXT',
  consent_version: 'TEXT'
};
for (const [col, type] of Object.entries(EXTRA_COLS)) {
  if (!existing.has(col)) db.exec(`ALTER TABLE leads ADD COLUMN ${col} ${type}`);
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS leads_request_id ON leads(request_id)');

const insertStmt = db.prepare(`
  INSERT INTO leads (ts, name, phone, source, raw, request_id, consent_version, notified)
  VALUES (?, ?, ?, ?, ?, ?, ?, 0)
`);

// Сохранить заявку. Возвращает id новой записи.
function saveLead(d, requestId, consentVersion) {
  const info = insertStmt.run(
    new Date().toISOString(),
    d['Имя']       || null,
    d['Телефон']   || null,
    d['Источник']  || null,
    JSON.stringify(d),
    requestId,
    consentVersion
  );
  return Number(info.lastInsertRowid);
}
const requestStmt = db.prepare('SELECT id, name, phone FROM leads WHERE request_id = ?');
function findRequest(requestId) { return requestStmt.get(requestId); }

// Отметить, что уведомление менеджеру доставлено.
const markStmt = db.prepare('UPDATE leads SET notified = 1, next_retry_at = NULL, last_error = NULL WHERE id = ?');
function markNotified(id) { markStmt.run(id); }

// Последние заявки (для выгрузки/проверки).
const listStmt = db.prepare('SELECT * FROM leads ORDER BY id DESC LIMIT ?');
function listLeads(limit = 200) { return listStmt.all(limit); }

// ── очередь недоставленных в MAX ─────────────────────────────────────────────

// Заявка остаётся в очереди, пока MAX её не примет.
const pendingStmt = db.prepare(`
  SELECT * FROM leads
  WHERE notified = 0 AND (next_retry_at IS NULL OR next_retry_at <= ?)
  ORDER BY id ASC LIMIT ?
`);
function pendingLeads(limit = 20) {
  return pendingStmt.all(new Date().toISOString(), limit);
}

// Отметить, что заявка ушла на резервную почту.
const emailedStmt = db.prepare('UPDATE leads SET emailed = 1 WHERE id = ?');
function markEmailed(id) { emailedStmt.run(id); }

// Зафиксировать неудачную попытку доставки в MAX.
const attemptStmt = db.prepare('UPDATE leads SET attempts = attempts + 1, last_error = ?, next_retry_at = ? WHERE id = ?');
function bumpAttempt(id, code, delay) { attemptStmt.run(code, new Date(Date.now() + delay).toISOString(), id); }

module.exports = {
  saveLead, findRequest, markNotified, listLeads,
  pendingLeads, markEmailed, bumpAttempt,
  DB_FILE
};
