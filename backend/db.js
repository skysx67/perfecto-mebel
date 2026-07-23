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

module.exports = { saveLead, markNotified, listLeads, DB_FILE };
