(() => {
  const screen = document.getElementById('landing-v2');
  if (!screen) return;

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const parts = [...screen.querySelectorAll('.landing-v2__copy p')].map((el) => {
    const text = el.textContent || '';
    el.classList.add('typewriter-stable');
    el.innerHTML = '<span class="typewriter-reserve" aria-hidden="true"></span><span class="typewriter-live"></span>';
    el.querySelector('.typewriter-reserve').textContent = text;
    return { el, live: el.querySelector('.typewriter-live'), text };
  });

  function revealAll() {
    parts.forEach((part) => { part.live.textContent = part.text; });
  }

  function typePart(index) {
    const part = parts[index];
    if (!part) return;
    const chars = Array.from(part.text);
    let i = 0;

    function tick() {
      part.live.textContent += chars[i] || '';
      i += 1;
      if (i < chars.length) {
        window.setTimeout(tick, index === 0 ? 42 : 24);
      } else {
        window.setTimeout(() => typePart(index + 1), 110);
      }
    }
    tick();
  }

  window.setTimeout(() => {
    screen.classList.add('is-revealed');
    if (reduceMotion) revealAll();
    else window.setTimeout(() => typePart(0), 260);
  }, 500);

  document.getElementById('landing-v2-add')?.addEventListener('click', () => {
    window.location.href = 'index.html';
  });

  screen.querySelector('[aria-label="חיפוש"]')?.addEventListener('click', () => {
    window.location.href = 'index.html';
  });
})();
