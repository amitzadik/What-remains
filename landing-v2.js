(() => {
  const screen = document.getElementById('landing-v2');
  if (!screen) return;

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Stable typewriter: the full text is laid out from the first frame (hidden
  // reserve fixes the block; the absolute live layer holds every character as a
  // hidden span). Typing only flips per-character visibility, so nothing
  // reflows — words never jump between lines and lines never move.
  const parts = [...screen.querySelectorAll('.landing-v2__copy p')].map((el) => {
    const text = [...el.childNodes].map((node) => (
      node.nodeName === 'BR' ? '\n' : (node.textContent || '')
    )).join('');
    el.classList.add('typewriter-stable');
    el.innerHTML = '<span class="typewriter-reserve" aria-hidden="true"></span><span class="typewriter-live" aria-hidden="true"></span>';
    el.querySelector('.typewriter-reserve').textContent = text;
    const live = el.querySelector('.typewriter-live');
    const spans = Array.from(text).map((ch) => {
      const span = document.createElement('span');
      span.className = 'tw-char';
      span.textContent = ch;   // a "\n" span still forces its break under pre-wrap
      live.appendChild(span);
      return span;
    });
    return { el, live, text, spans, cursor: -1 };
  });

  // Reveal characters [0, count) in reading order and park the caret on the last
  // one. Visibility-only — never touches layout.
  function revealPartUpTo(part, count) {
    const upto = Math.max(0, Math.min(count, part.spans.length));
    for (let i = 0; i < upto; i++) part.spans[i].classList.add('tw-shown');
    const cursorIdx = upto - 1;
    if (part.cursor !== cursorIdx) {
      if (part.cursor >= 0 && part.spans[part.cursor]) part.spans[part.cursor].classList.remove('tw-cursor');
      if (cursorIdx >= 0 && part.spans[cursorIdx]) part.spans[cursorIdx].classList.add('tw-cursor');
      part.cursor = cursorIdx;
    }
  }

  let typingFinished = false;
  let cardFinished = false;

  function beginIdleWhenReady() {
    if (typingFinished && cardFinished) screen.classList.add('is-idle');
  }

  function revealAll() {
    parts.forEach((part) => {
      part.spans.forEach((s) => s.classList.add('tw-shown'));
      if (part.cursor >= 0 && part.spans[part.cursor]) part.spans[part.cursor].classList.remove('tw-cursor');
      part.cursor = -1;
    });
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
      i += 1;
      revealPartUpTo(part, i);
      if (i < chars.length) {
        const char = chars[i - 1];
        const pause = /[.,:;!?\u05C3]/.test(char) ? 124 : (char === ' ' ? 24 : 40);
        window.setTimeout(tick, index === 0 ? pause + 8 : pause);
      } else {
        part.live.classList.remove('is-typing');
        window.setTimeout(() => typePart(index + 1), 130);
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

  const myDrawerButton = screen.querySelector('[aria-label="המגירה שלי"]');
  function setDrawerEnabled(enabled) {
    if (myDrawerButton) myDrawerButton.disabled = !enabled;
  }
  window.setWhatRemainsDrawerEnabled = setDrawerEnabled;
  try {
    const authState = typeof window.parent.getWhatRemainsAuthState === 'function'
      ? window.parent.getWhatRemainsAuthState()
      : null;
    setDrawerEnabled(!!(authState && authState.loggedIn));
  } catch (_) {
    setDrawerEnabled(false);
  }

  // Same-origin bridge to the archive's public search projection. Only owner
  // names and short-lived opaque handles cross into this frame.
  function fetchMatches(query) {
    if (window.parent === window) return null;
    try {
      if (typeof window.parent.getLandingArchiveMatches === 'function') {
        return window.parent.getLandingArchiveMatches(query);
      }
    } catch (_) {
      // Cross-origin preview: no direct access to the archive data.
    }
    return null;
  }

  // ----- inline archive search (stays entirely inside landing-v2) -----
  const searchField = document.getElementById('landing-v2-search-input');
  const resultsList = document.getElementById('landing-v2-results');
  let searchDebounce = 0;
  let resultSignature = '';
  let shuffledMatches = [];
  const cardSlots = [
    { x: 14.2, y: 27.4, r: -7.92 },
    { x: 37.4, y: 23.0, r:  6.06 },
    { x: 58.3, y: 21.2, r: -7.22 },
    { x: 78.2, y: 17.6, r:  7.19 },
    { x: 34.5, y: 48.6, r: -22.04 },
    { x: 55.2, y: 55.6, r: 15.06 },
    { x: 74.1, y: 45.1, r: -19.43 },
    { x: 36.2, y: 68.0, r: -7.71 },
    { x: 59.9, y: 68.0, r:  8.80 },
    { x: 81.5, y: 67.0, r:  7.17 }
  ];

  function shuffleOnce(items) {
    const copy = items.slice();
    const random = new Uint32Array(Math.max(copy.length, 1));
    crypto.getRandomValues(random);
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = random[i] % (i + 1);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function fittingSlotCount() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    if (width < 760 || height < 560) return 3;
    if (width < 1050 || height < 700) return 5;
    if (width < 1380 || height < 820) return 7;
    return cardSlots.length;
  }

  function renderResults() {
    if (!resultsList) return;
    const query = searchField ? searchField.value.trim() : '';
    const matches = fetchMatches(query);
    resultsList.replaceChildren();
    if (matches === null) {
      shuffledMatches = [];
      resultSignature = '';
      return;
    }
    const signature = query + '\u0000' + matches.map(v => v.handle).join('\u0001');
    if (signature !== resultSignature) {
      resultSignature = signature;
      shuffledMatches = shuffleOnce(matches);
    }
    shuffledMatches.slice(0, fittingSlotCount()).forEach((archive, index) => {
      const slot = cardSlots[index];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'landing-v2__result';
      button.style.setProperty('--slot-x', slot.x + 'vw');
      button.style.setProperty('--slot-y', slot.y + 'vh');
      button.style.setProperty('--slot-r', slot.r + 'deg');
      const name = document.createElement('span');
      name.className = 'landing-v2__result-name';
      name.textContent = archive.name;
      button.appendChild(name);
      button.addEventListener('click', () => {
        sendAction('openDrawer', { handle: archive.handle });
        closeSearch();
      }, { once: true });
      resultsList.appendChild(button);
    });
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
    shuffledMatches = [];
    resultSignature = '';
    if (resultsList) resultsList.innerHTML = '';
  }
  function toggleSearch() {
    if (screen.classList.contains('is-searching')) closeSearch();
    else openSearch();
  }

  // ----- credit paper + modal (Figma 794:1668 / 779:1396) -----
  const creditOpen = document.getElementById('landing-v2-credit-open');
  const creditOverlay = document.getElementById('landing-v2-credit-overlay');
  const creditClose = document.getElementById('landing-v2-credit-close');
  let creditReturnFocus = null;

  function openCredits() {
    if (!creditOverlay || !creditClose) return;
    if (screen.classList.contains('is-credit-open')) return;
    creditReturnFocus = document.activeElement;
    closeSearch();
    creditOverlay.hidden = false;
    screen.classList.add('is-credit-open');
    creditOpen?.setAttribute('role', 'dialog');
    creditOpen?.setAttribute('aria-modal', 'true');
    window.requestAnimationFrame(() => {
      creditOverlay.classList.add('is-open');
      window.setTimeout(() => creditClose.focus(), 460);
    });
  }

  function closeCredits() {
    if (!creditOverlay || creditOverlay.hidden) return;
    creditOverlay.classList.remove('is-open');
    screen.classList.remove('is-credit-open');
    creditOpen?.setAttribute('role', 'button');
    creditOpen?.removeAttribute('aria-modal');
    window.setTimeout(() => {
      creditOverlay.hidden = true;
      if (creditReturnFocus && typeof creditReturnFocus.focus === 'function') creditReturnFocus.focus();
      creditReturnFocus = null;
    }, 760);
  }

  creditOpen?.addEventListener('click', (event) => {
    if (event.target.closest('.corner-credit-card__close')) return;
    openCredits();
  });
  creditOpen?.addEventListener('keydown', (event) => {
    if ((event.key === 'Enter' || event.key === ' ') && !screen.classList.contains('is-credit-open')) {
      event.preventDefault();
      openCredits();
    }
  });
  creditClose?.addEventListener('click', (event) => {
    event.stopPropagation();
    closeCredits();
  });
  creditOverlay?.addEventListener('click', (event) => {
    if (event.target === creditOverlay) closeCredits();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && creditOverlay && !creditOverlay.hidden) {
      event.preventDefault();
      closeCredits();
    }
  });

  if (searchField) {
    searchField.addEventListener('input', () => {
      window.clearTimeout(searchDebounce);
      searchDebounce = window.setTimeout(renderResults, 150);
    });
    searchField.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeSearch();
    });
  }
  window.addEventListener('resize', () => {
    if (screen.classList.contains('is-searching')) renderResults();
  });

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
  myDrawerButton?.addEventListener('click', () => sendAction('drawer'));
})();
