#!/usr/bin/env bash
#
# Перфекто — установка сайта и бэкенда заявок на ЧИСТЫЙ сервер Ubuntu 22.04/24.04.
# Запускать от root на новом VPS:
#
#   curl -fsSL https://raw.githubusercontent.com/skysx67/perfecto-mebel/main/deploy/setup.sh -o setup.sh
#   bash setup.sh                       # без домена (доступ по IP)
#   bash setup.sh перфекто-мебель.рф    # сразу с доменом (+ бесплатный HTTPS)
#
# Скрипт идемпотентный: повторный запуск ничего не ломает.

set -euo pipefail

REPO_URL="https://github.com/skysx67/perfecto-mebel.git"
APP_DIR="/opt/perfecto"
WEB_DIR="/var/www/perfecto"
SERVICE="perfecto-lead"
APP_USER="perfecto"
DOMAIN="${1:-}"

say()  { echo -e "\n\033[1;36m▸ $*\033[0m"; }
ok()   { echo -e "  \033[1;32m✓\033[0m $*"; }
warn() { echo -e "  \033[1;33m!\033[0m $*"; }

[ "$(id -u)" -eq 0 ] || { echo "Запусти от root:  sudo bash setup.sh"; exit 1; }

# ── 1. Системные пакеты ──────────────────────────────────────────────────────
say "Устанавливаю системные пакеты"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nginx git curl ca-certificates rsync ufw >/dev/null
ok "nginx, git, curl, rsync, ufw"

# ── 2. Node.js 24 ────────────────────────────────────────────────────────────
# Нужен именно 24: встроенный модуль node:sqlite работает без доп. флагов
# (на 22.x пришлось бы запускать с --experimental-sqlite).
say "Проверяю Node.js"
NEED_NODE=1
if command -v node >/dev/null 2>&1; then
  CUR="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$CUR" -ge 24 ] && NEED_NODE=0 && ok "Node $(node -v) уже подходит"
fi
if [ "$NEED_NODE" -eq 1 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs >/dev/null
  ok "Установлен Node $(node -v)"
fi

# ── 3. Пользователь для сервиса ──────────────────────────────────────────────
say "Пользователь сервиса"
if id "$APP_USER" >/dev/null 2>&1; then
  ok "Пользователь $APP_USER уже есть"
else
  useradd --system --shell /usr/sbin/nologin --home-dir "$APP_DIR" "$APP_USER"
  ok "Создан пользователь $APP_USER (без входа в систему)"
fi

# ── 4. Код проекта ───────────────────────────────────────────────────────────
say "Код проекта"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only && ok "Обновлён из GitHub"
else
  git clone --depth 1 "$REPO_URL" "$APP_DIR" >/dev/null 2>&1
  ok "Склонирован в $APP_DIR"
fi

# ── 5. Сертификаты Минцифры (нужны для API мессенджера MAX) ──────────────────
say "Сертификаты Минцифры"
CA_FILE="$APP_DIR/backend/russian-ca.pem"
if [ -s "$CA_FILE" ]; then
  ok "Уже установлены"
else
  TMP_ROOT=$(mktemp); TMP_SUB=$(mktemp)
  if curl -fsSL "https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt" -o "$TMP_ROOT" \
  && curl -fsSL "https://gu-st.ru/content/lending/russian_trusted_sub_ca_pem.crt" -o "$TMP_SUB"; then
    cat "$TMP_ROOT" "$TMP_SUB" > "$CA_FILE"
    ok "Скачаны и собраны в russian-ca.pem"
  else
    warn "Не удалось скачать автоматически."
    warn "Скачай вручную с https://www.gosuslugi.ru/crt (корневой + выпускающий),"
    warn "склей в один файл и положи в $CA_FILE"
  fi
  rm -f "$TMP_ROOT" "$TMP_SUB"
fi

# ── 6. Настройки бэкенда (.env) ──────────────────────────────────────────────
say "Настройки бэкенда"
ENV_FILE="$APP_DIR/backend/.env"
if [ -f "$ENV_FILE" ]; then
  ok ".env уже есть — не трогаю"
else
  cp "$APP_DIR/backend/.env.example" "$ENV_FILE"
  {
    echo ""
    echo "# --- добавлено установщиком ---"
    echo "HOST=127.0.0.1"
    echo "NODE_EXTRA_CA_CERTS=$CA_FILE"
    [ -n "$DOMAIN" ] && echo "ALLOWED_ORIGIN=https://$DOMAIN"
  } >> "$ENV_FILE"
  warn "Создан $ENV_FILE — впиши в него MAX_TOKEN и MANAGER_USER_ID!"
fi
chown -R "$APP_USER":"$APP_USER" "$APP_DIR/backend"
chmod 600 "$ENV_FILE"

# ── 7. Публикация статики сайта ──────────────────────────────────────────────
say "Публикую сайт"
mkdir -p "$WEB_DIR"
rsync -a --delete \
  --exclude='.*' --exclude='backend' --exclude='deploy' \
  --exclude='*.md' --exclude='og-card.html' \
  "$APP_DIR/" "$WEB_DIR/"
chown -R www-data:www-data "$WEB_DIR"
ok "Файлы сайта в $WEB_DIR"

# ── 8. Автозапуск бэкенда ────────────────────────────────────────────────────
say "Сервис бэкенда (автозапуск 24/7)"
cp "$APP_DIR/deploy/perfecto-lead.service" "/etc/systemd/system/$SERVICE.service"
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1
systemctl restart "$SERVICE"
sleep 2
if systemctl is-active --quiet "$SERVICE"; then
  ok "Сервис $SERVICE запущен и добавлен в автозагрузку"
else
  warn "Сервис не поднялся — смотри: journalctl -u $SERVICE -n 30"
fi

# ── 9. nginx ─────────────────────────────────────────────────────────────────
say "Настраиваю nginx"
SRV_NAME="${DOMAIN:-_}"
sed "s/__DOMAIN__/$SRV_NAME/" "$APP_DIR/deploy/nginx-perfecto.conf" \
  > /etc/nginx/sites-available/perfecto
ln -sf /etc/nginx/sites-available/perfecto /etc/nginx/sites-enabled/perfecto
rm -f /etc/nginx/sites-enabled/default
nginx -t >/dev/null 2>&1 && systemctl reload nginx && ok "nginx настроен и перезагружен"

# ── 10. Файрвол ──────────────────────────────────────────────────────────────
say "Файрвол"
ufw allow OpenSSH >/dev/null 2>&1 || true
ufw allow 'Nginx Full' >/dev/null 2>&1 || true
ufw --force enable >/dev/null 2>&1 || true
ok "Открыты только SSH, 80 и 443"

# ── 11. HTTPS ────────────────────────────────────────────────────────────────
if [ -n "$DOMAIN" ]; then
  say "Бесплатный HTTPS-сертификат для $DOMAIN"
  apt-get install -y -qq certbot python3-certbot-nginx >/dev/null
  if certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --non-interactive --agree-tos \
       --register-unsafely-without-email --redirect >/dev/null 2>&1; then
    ok "HTTPS включён, автопродление настроено"
  else
    warn "Certbot не смог выпустить сертификат — проверь, что домен уже указывает на этот сервер (A-запись),"
    warn "потом повтори:  certbot --nginx -d $DOMAIN"
  fi
else
  warn "Домен не указан — сайт работает по IP, без HTTPS."
  warn "Когда купишь домен и направишь его на этот сервер, запусти:"
  warn "  bash $APP_DIR/deploy/setup.sh твой-домен.рф"
fi

# ── Итог ─────────────────────────────────────────────────────────────────────
IP=$(hostname -I | awk '{print $1}')
cat <<INFO

────────────────────────────────────────────────────────────
 Готово.

 Сайт:      http://${DOMAIN:-$IP}
 Проверка:  curl http://127.0.0.1:8787/health   → должно быть ok

 ЧТО СДЕЛАТЬ ДАЛЬШЕ:
   1) Впиши токен и свой ID:  nano $ENV_FILE
        MAX_TOKEN=...        (из @MasterBot)
        MANAGER_USER_ID=...  (узнать: см. п.2)
   2) Узнать ID менеджера:
        cd $APP_DIR/backend && node --env-file=.env capture-id.js
   3) Перезапустить:  systemctl restart $SERVICE
   4) Отправь заявку с сайта — должна прийти в MAX.

 Полезное:
   systemctl status $SERVICE        — состояние
   journalctl -u $SERVICE -f        — живой лог
   bash $APP_DIR/deploy/update.sh   — обновить сайт из GitHub
────────────────────────────────────────────────────────────
INFO
