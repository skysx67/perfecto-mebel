# Разворачивание «Перфекто» на своём сервере

Один скрипт поднимает на чистом сервере всё: сайт, бэкенд заявок,
бота MAX с автозапуском, HTTPS и файрвол.

```
Интернет → nginx (80/443) ─┬─→ сайт (статика из /var/www/perfecto)
                           └─→ /lead → бэкенд 127.0.0.1:8787 ─┬─→ SQLite (leads.db)
                                                              └─→ уведомление в MAX
```

## 1. Какой сервер брать

**Timeweb Cloud** (именно Cloud — облачный сервер/VPS, а не обычный хостинг:
на обычном нельзя запускать своих ботов). Аналоги: Selectel, Reg.ru, Amvera.

- **ОС: Ubuntu 24.04** (или 22.04)
- **Минимум:** 1 vCPU / 1 ГБ RAM — лендингу и боту хватит
- **С запасом:** 2 vCPU / 2 ГБ RAM (~300–400 ₽/мес), если добавятся другие проекты
- Обязательно **российский** хостинг: у API мессенджера MAX сертификаты Минцифры

После создания сервера провайдер пришлёт **IP-адрес** и **пароль root**.

## 2. Установка (5 минут)

Подключись к серверу по SSH (Windows: PowerShell или Терминал):

```bash
ssh root@ВАШ_IP
```

Дальше одной командой:

```bash
curl -fsSL https://raw.githubusercontent.com/skysx67/perfecto-mebel/main/deploy/setup.sh -o setup.sh && bash setup.sh
```

Если домен уже куплен и его A-запись направлена на этот сервер — сразу с доменом
(тогда автоматически выпустится бесплатный HTTPS-сертификат):

```bash
bash setup.sh перфекто-мебель.рф
```

Скрипт сам поставит nginx, Node.js 24, сертификаты Минцифры, настроит автозапуск и файрвол.

## 3. Подключить бота (2 минуты)

Скрипт создаст файл настроек, в него нужно вписать токен:

```bash
nano /opt/perfecto/backend/.env
```

Заполнить две строки:
- `MAX_TOKEN=` — токен бота из **@MasterBot** в MAX
- `MANAGER_USER_ID=` — ID того, кому падают заявки

Чтобы узнать ID: менеджер открывает бота в MAX и жмёт «Начать», затем на сервере:

```bash
cd /opt/perfecto/backend && node --env-file=.env capture-id.js
```

Сохранить файл (`Ctrl+O`, `Enter`, `Ctrl+X`) и перезапустить:

```bash
systemctl restart perfecto-lead
```

## 4. Проверка

```bash
curl http://127.0.0.1:8787/health     # → ok
systemctl status perfecto-lead        # → active (running)
```

Открыть сайт в браузере, отправить заявку с формы — она должна прийти в MAX
и лечь в базу. Ничего в коде править не нужно: сайт сам определяет,
что бэкенд находится на том же домене.

## 5. Домен

Когда купишь домен (например `перфекто-мебель.рф`):

1. В панели регистратора создать **A-запись** на IP сервера (и такую же для `www`).
2. Подождать 15–60 минут, пока обновятся DNS.
3. На сервере повторно запустить установщик с доменом — он настроит HTTPS:
   ```bash
   bash /opt/perfecto/deploy/setup.sh перфекто-мебель.рф
   ```
4. В Яндекс.Метрике добавить домен в «Дополнительные адреса» счётчика.

## Обновление сайта

После любых правок в GitHub:

```bash
bash /opt/perfecto/deploy/update.sh
```

Заявки (`leads.db`) и настройки (`.env`) при обновлении не трогаются.

## Полезные команды

| Команда | Что делает |
|---|---|
| `systemctl status perfecto-lead` | состояние бота |
| `systemctl restart perfecto-lead` | перезапустить |
| `journalctl -u perfecto-lead -f` | живой лог (Ctrl+C — выйти) |
| `cd /opt/perfecto/backend && node --env-file=.env export-leads.js > leads.csv` | выгрузить заявки в Excel |
| `nginx -t && systemctl reload nginx` | проверить и применить конфиг nginx |

## Где что лежит

| Путь | Что |
|---|---|
| `/opt/perfecto` | код проекта (git) |
| `/opt/perfecto/backend/.env` | токен и настройки (**секрет**) |
| `/opt/perfecto/backend/leads.db` | база заявок |
| `/var/www/perfecto` | файлы сайта, которые отдаёт nginx |
| `/etc/nginx/sites-available/perfecto` | конфиг nginx |

## Резервная копия заявок

База — один файл, копируется как обычный файл:

```bash
scp root@ВАШ_IP:/opt/perfecto/backend/leads.db ./leads-backup.db
```

## Если что-то не работает

- **Заявка не приходит в MAX** → `journalctl -u perfecto-lead -n 50`.
  Ошибка про сертификат (`unable to get local issuer certificate`) — значит не
  установились сертификаты Минцифры: скачай их вручную с https://www.gosuslugi.ru/crt,
  склей в `/opt/perfecto/backend/russian-ca.pem` и перезапусти сервис.
- **Сайт не открывается** → `systemctl status nginx` и `nginx -t`.
- **Сервис не стартует** → почти всегда незаполненный `.env`.
