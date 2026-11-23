(() => {
  const counter = 110888206;
  let started = false;

  function start() {
    if (started) return;
    started = true;
    window.ym = window.ym || function () {
      (window.ym.a = window.ym.a || []).push(arguments);
    };
    window.ym.l = Date.now();
    const script = document.createElement('script');
    script.src = 'https://mc.yandex.ru/metrika/tag.js';
    script.async = true;
    document.head.append(script);
    // Запись сессий можно включить после отдельной проверки маскирования полей.
    window.ym(counter, 'init', { clickmap: true, trackLinks: true, accurateTrackBounce: true, webvisor: false });
  }

  function accepted() {
    try { return localStorage.getItem('perfecto_cookie') === 'yes'; }
    catch { return false; }
  }

  if (accepted()) start();
  window.addEventListener('perfecto:analytics-accepted', start);

  const confirmation = document.getElementById('lead-confirmation');
  if (!confirmation) return;
  try {
    const requestId = sessionStorage.getItem('perfecto_accepted_lead');
    if (!requestId) return;
    confirmation.hidden = false;
    document.getElementById('lead-confirmation-fallback').hidden = true;
    document.title = 'Заявка принята — Перфекто';
    if (accepted() && sessionStorage.getItem('perfecto_goal_lead') !== requestId) {
      sessionStorage.setItem('perfecto_goal_lead', requestId);
      window.ym(counter, 'reachGoal', 'zayavka');
    }
  } catch { /* Страница доступна и без хранилища браузера. */ }
})();
