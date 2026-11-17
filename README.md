# Perfecto mebel

Лендинг Perfecto mebel.

Локальный просмотр: `python -m http.server 8080 --bind 127.0.0.1`, затем открыть
[главную](http://127.0.0.1:8080/). Категории открываются на `raboty.html#kitchen`
(адрес страницы сохранён для старых ссылок).

Браузерная проверка в PowerShell (нужны Node.js, Chrome и запущенный локальный просмотр):

```powershell
npm install --prefix "$env:TEMP\perfecto-browser-check" --no-save --no-package-lock playwright-core
$env:PLAYWRIGHT_MODULE = "$env:TEMP\perfecto-browser-check\node_modules\playwright-core"
node tests/site-smoke.cjs
```

Проверка проходит путь от главной до категории, проверяет мобильное меню,
просмотр фотографий с клавиатуры и форму встречи. Заявки перехватываются тестом
и не отправляются в рабочую систему.
