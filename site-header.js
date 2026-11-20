// Раскрывающееся меню: доступно с клавиатуры, закрывается по Escape и вне шапки.
(function(){
  var header=document.querySelector('.site-header');
  if(!header) return;
  var toggle=header.querySelector('.menu-toggle'), nav=header.querySelector('nav');
  function close(restoreFocus){
    nav.classList.remove('is-open');
    toggle.setAttribute('aria-expanded','false');
    toggle.setAttribute('aria-label','Открыть меню');
    if(restoreFocus) toggle.focus();
  }
  toggle.addEventListener('click',function(){
    var open=toggle.getAttribute('aria-expanded')!=='true';
    nav.classList.toggle('is-open',open);
    toggle.setAttribute('aria-expanded',String(open));
    toggle.setAttribute('aria-label',open?'Закрыть меню':'Открыть меню');
    if(open) {
      nav.scrollTop = 0;
      nav.querySelector('a').focus({ preventScroll: true });
    }
  });
  nav.addEventListener('click',function(e){if(e.target.closest('a')) close(false);});
  document.addEventListener('keydown',function(e){
    if(e.key==='Escape' && toggle.getAttribute('aria-expanded')==='true') close(true);
  });
  document.addEventListener('click',function(e){if(!header.contains(e.target)) close(false);});
  document.addEventListener('focusin',function(e){if(!header.contains(e.target)) close(false);});
  matchMedia('(max-width:1100px)').addEventListener('change',function(){close(false);});
})();

// Move one visible logo between the hero and the fixed header.
(function(){
  const header = document.querySelector('.site-header--home');
  const heroBrand = document.querySelector('.hero-brand');
  if (!header || !heroBrand) return;

  const slot = header.querySelector('.header-brand-slot');
  const logo = slot.querySelector('.logo');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let moveX = 0, moveY = 0, initialScale = 1, distance = 1, frame = 0;

  function draw(){
    frame = 0;
    const scroll = Math.max(0, window.scrollY);
    const progress = reducedMotion.matches ? Number(scroll >= 30) : Math.min(1, scroll / distance);
    const remaining = (1 - progress) ** 2;
    logo.style.transform = progress === 1 ? '' :
      `translate(${moveX * remaining}px, ${moveY * remaining}px) scale(${1 + (initialScale - 1) * remaining})`;
  }

  function measure(){
    const hero = heroBrand.getBoundingClientRect();
    const dock = slot.getBoundingClientRect();
    moveX = hero.left + hero.width / 2 - (dock.left + dock.width / 2);
    moveY = hero.top + window.scrollY + hero.height / 2 - (dock.top + dock.height / 2);
    initialScale = hero.height / dock.height;
    distance = Math.max(110, Math.min(280, moveY));
    if (frame) cancelAnimationFrame(frame);
    draw();
  }

  measure();
  header.classList.add('brand-motion');
  addEventListener('scroll', () => {
    if (!frame) frame = requestAnimationFrame(draw);
  }, { passive:true });
  addEventListener('resize', measure);
  addEventListener('pageshow', measure);
  reducedMotion.addEventListener('change', draw);
  const resize = new ResizeObserver(measure);
  resize.observe(heroBrand);
  resize.observe(slot);
})();
