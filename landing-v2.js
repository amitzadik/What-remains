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
        // once the ~7.8s deal finishes, let the papers settle into the breathing
        // (independent of the typewriter, which finishes much later)
        window.setTimeout(() => screen.classList.add('is-settled'), 7950);
        window.setTimeout(() => {
          cardFinished = true;
          beginIdleWhenReady();
        }, 2450);
      }, 820);
    }
  }, 500);

  function sendAction(action, payload) {
    if (window.parent === window) return;
    // Same-origin is the normal production path and gives immediate, reliable
    // button behaviour. postMessage remains the fallback for isolated previews.
    try {
      if (typeof window.parent.handleWhatRemainsLandingAction === 'function') {
        window.parent.handleWhatRemainsLandingAction(action, payload);
        return;
      }
    } catch (_) {
      // Cross-origin preview: fall through to the message bridge.
    }
    window.parent.postMessage({ source: 'what-remains-landing', action, payload }, '*');
  }

  // Same-origin bridge to the archive's single search source of truth. Returns
  // an array of matches, or null when the direct call isn't available (e.g. a
  // cross-origin preview) so the UI can show a "connecting" state.
  function fetchMatches(query) {
    if (window.parent === window) return null;
    try {
      if (typeof window.parent.getArchiveMatches === 'function') {
        return window.parent.getArchiveMatches(query);
      }
    } catch (_) {
      // Cross-origin preview: no direct access to the archive data.
    }
    return null;
  }

  // ----- inline archive search (stays entirely inside landing-v2) -----
  const searchField = document.getElementById('landing-v2-search-input');
  const resultsList = document.getElementById('landing-v2-results');
  let currentMatches = [];   // codes live here in JS, never in the DOM
  let searchDebounce = 0;

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderResults() {
    if (!resultsList) return;
    const matches = fetchMatches(searchField ? searchField.value : '');
    if (matches === null) {
      currentMatches = [];
      resultsList.innerHTML = '<li class="landing-v2__results-note">מתחבר…</li>';
      return;
    }
    currentMatches = matches;
    if (!matches.length) {
      resultsList.innerHTML = '<li class="landing-v2__results-note">לא נמצאו תוצאות</li>';
      return;
    }
    resultsList.innerHTML = matches.map((v, i) => (
      '<li><button type="button" class="landing-v2__result" data-index="' + i + '">' +
      escapeHtml(v && v.name ? v.name : '(ללא שם)') + '</button></li>'
    )).join('');
  }

  function openSearch() {
    screen.classList.add('is-searching');
    if (searchField) {
      searchField.value = '';
      window.setTimeout(() => searchField.focus(), 40);
    }
    renderResults();
  }
  function closeSearch() {
    screen.classList.remove('is-searching');
    window.clearTimeout(searchDebounce);
    currentMatches = [];
    if (resultsList) resultsList.innerHTML = '';
  }
  function toggleSearch() {
    if (screen.classList.contains('is-searching')) closeSearch();
    else openSearch();
  }

  if (searchField) {
    searchField.addEventListener('input', () => {
      window.clearTimeout(searchDebounce);
      searchDebounce = window.setTimeout(renderResults, 150);
    });
    searchField.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeSearch();
    });
  }
  if (resultsList) {
    resultsList.addEventListener('click', (e) => {
      const btn = e.target.closest('.landing-v2__result');
      if (!btn) return;
      const v = currentMatches[parseInt(btn.getAttribute('data-index'), 10)];
      if (v && v.code != null) {
        // Opening a drawer is a distinct screen — this deliberately leaves
        // landing-v2, reusing the archive wall's open-by-code path.
        sendAction('openDrawer', { code: String(v.code) });
        closeSearch();
      }
    });
  }

  // Mirror the form stamp-button interaction inside the isolated landing
  // iframe, including the pressed state on touch screens.
  screen.querySelectorAll('.icon-btn.img-btn').forEach((button) => {
    const image = button.querySelector('img');
    const source = button.dataset.default || image?.getAttribute('src');
    if (source) button.style.setProperty('--stamp-src', `url("${source}")`);
    button.addEventListener('touchstart', () => {
      if (!button.disabled) button.classList.add('is-pressing');
    }, { passive: true });
    const release = () => button.classList.remove('is-pressing');
    button.addEventListener('touchend', release);
    button.addEventListener('touchcancel', release);
  });

  document.getElementById('landing-v2-add')?.addEventListener('click', () => sendAction('create'));
  screen.querySelector('[aria-label="חיפוש"]')?.addEventListener('click', toggleSearch);
  screen.querySelector('[aria-label="התחברות"]')?.addEventListener('click', () => sendAction('login'));
  screen.querySelector('[aria-label="המגירה שלי"]')?.addEventListener('click', () => sendAction('drawer'));
})();
