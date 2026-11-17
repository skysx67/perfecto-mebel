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
    if(open) nav.querySelector('a').focus();
  });
  nav.addEventListener('click',function(e){if(e.target.closest('a')) close(false);});
  document.addEventListener('keydown',function(e){
    if(e.key==='Escape' && toggle.getAttribute('aria-expanded')==='true') close(true);
  });
  document.addEventListener('click',function(e){if(!header.contains(e.target)) close(false);});
  document.addEventListener('focusin',function(e){if(!header.contains(e.target)) close(false);});
  matchMedia('(max-width:1100px)').addEventListener('change',function(){close(false);});
})();
