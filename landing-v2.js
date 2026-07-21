(() => {
  const screen = document.getElementById('landing-v2');
  if (!screen) return;

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const parts = [...screen.querySelectorAll('.landing-v2__copy p')].map((el) => {
    const text = [...el.childNodes].map((node) => (
      node.nodeName === 'BR' ? '\n' : (node.textContent || '')
    )).join('');
    el.classList.add('typewriter-stable');
    el.innerHTML = '<span class="typewriter-reserve" aria-hidden="true"></span><span class="typewriter-live"></span>';
    el.querySelector('.typewriter-reserve').textContent = text;
    return { el, live: el.querySelector('.typewriter-live'), text };
  });

  let typingFinished = false;
  let cardFinished = false;

  function beginIdleWhenReady() {
    if (typingFinished && cardFinished) screen.classList.add('is-idle');
  }

  function revealAll() {
    parts.forEach((part) => { part.live.textContent = part.text; });
    typingFinished = true;
    beginIdleWhenReady();
  }

  function typePart(index) {
    const part = parts[index];
    if (!part) {
      typingFinished = true;
      beginIdleWhenReady();
      return;
    }
    const chars = Array.from(part.text);
    let i = 0;
    part.live.classList.add('is-typing');

    function tick() {
      part.live.textContent += chars[i] || '';
      i += 1;
      if (i < chars.length) {
        const char = chars[i - 1];
        const pause = /[.,:;!?\u05C3]/.test(char) ? 105 : (char === ' ' ? 20 : 34);
        window.setTimeout(tick, index === 0 ? pause + 7 : pause);
      } else {
        part.live.classList.remove('is-typing');
        window.setTimeout(() => typePart(index + 1), 110);
      }
    }
    tick();
  }

  window.setTimeout(() => {
    screen.classList.add('is-revealed');
    if (reduceMotion) {
      screen.classList.add('is-card-entered');
      screen.classList.add('is-settled');
      cardFinished = true;
      revealAll();
    } else {
      window.setTimeout(() => typePart(0), 260);
      window.setTimeout(() => {
        screen.classList.add('is-card-entered');
        // once the papers have dealt in, let them settle into the breathing
        // (independent of the typewriter, which finishes much later)
        window.setTimeout(() => screen.classList.add('is-settled'), 2250);
        window.setTimeout(() => {
          cardFinished = true;
          beginIdleWhenReady();
        }, 2450);
      }, 820);
    }
  }, 500);

  function sendAction(action) {
    if (window.parent !== window) {
      window.parent.postMessage({ source: 'what-remains-landing', action }, window.location.origin);
    }
  }

  document.getElementById('landing-v2-add')?.addEventListener('click', () => sendAction('create'));
  screen.querySelector('[aria-label="חיפוש"]')?.addEventListener('click', () => sendAction('search'));
  screen.querySelector('[aria-label="התחברות"]')?.addEventListener('click', () => sendAction('login'));
  screen.querySelector('[aria-label="המגירה שלי"]')?.addEventListener('click', () => sendAction('drawer'));
})();
