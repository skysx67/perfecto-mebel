#!/usr/bin/env bash
#
# Перфекто — обновление сайта и бэкенда из GitHub.
# Запускать от root после любых правок в репозитории:
#
#   bash /opt/perfecto/deploy/update.sh
#
# Что делает: забирает свежий код, перепубликовывает статику сайта
# и перезапускает бэкенд заявок. Файл .env и база leads.db не трогаются.

set -euo pipefail

APP_DIR="/opt/perfecto"
WEB_DIR="/var/www/perfecto"
SERVICE="perfecto-lead"

say() { echo -e "\n\033[1;36m▸ $*\033[0m"; }
ok()  { echo -e "  \033[1;32m✓\033[0m $*"; }

[ "$(id -u)" -eq 0 ] || { echo "Запусти от root:  sudo bash update.sh"; exit 1; }

say "Забираю свежий код"
git -C "$APP_DIR" pull --ff-only
ok "Код обновлён"

say "Публикую сайт"
rsync -a --delete \
  --exclude='.*' --exclude='backend' --exclude='deploy' --exclude='tests' \
  --exclude='*.md' --exclude='og-card.html' \
  "$APP_DIR/" "$WEB_DIR/"
chown -R www-data:www-data "$WEB_DIR"
ok "Статика обновлена"

say "Перезапускаю бэкенд"
chown -R perfecto:perfecto "$APP_DIR/backend"
install -m 644 "$APP_DIR/deploy/perfecto-lead.service" "/etc/systemd/system/$SERVICE.service"
systemctl daemon-reload
systemctl restart "$SERVICE"
sleep 2
if systemctl is-active --quiet "$SERVICE" && curl -fsS --max-time 5 http://127.0.0.1:8787/health >/dev/null; then
  ok "Сервис работает"
else
  echo "  ✗ Сервис не поднялся: journalctl -u $SERVICE -n 30"
  exit 1
fi

# Конфигурация Nginx и HTTPS обслуживается отдельно. Certbot меняет боевой файл.

echo -e "\n\033[1;32mГотово.\033[0m Проверка: curl -s http://127.0.0.1:8787/health\n"
