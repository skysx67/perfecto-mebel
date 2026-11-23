// Выгрузка всех заявок из SQLite в CSV (Excel-совместимый, UTF-8 с BOM, разделитель ;).
// Запуск:  node --env-file=.env export-leads.js  >  leads.csv
// (или через npm run leads > leads.csv)

const { listLeads } = require('./db');

const COLS = [
  ['id', 'ID'], ['ts', 'Дата (UTC)'], ['name', 'Имя'], ['phone', 'Телефон'],
  ['email', 'Email'], ['source', 'Источник'], ['furniture', 'Тип мебели'],
  ['measure', 'Замеры'], ['design', 'Дизайн'], ['terms', 'Сроки'],
  ['notified', 'Ушло в MAX']
];

function cell(v) {
  const value = (v === null || v === undefined) ? '' : String(v);
  const s = /^[\s]*[=+@-]/.test(value) ? "'" + value : value;
  // экранируем по правилам CSV
  return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

const rows = listLeads(100000).reverse(); // по возрастанию id
const header = COLS.map(c => c[1]).join(';');
const body = rows.map(r => COLS.map(c => cell(r[c[0]])).join(';')).join('\n');

process.stdout.write('﻿' + header + '\n' + body + '\n');
