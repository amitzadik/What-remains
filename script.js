(() => {
  // ============================================================
  // Google Sheets webhook (Apps Script)
  // ============================================================
  const SHEET_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbwzfQC60mmo7ROG443VpIRcHPkD3RVp3dVrHDuYqVQKSMA84WKPZxw_xWWp_KFBIsWNxw/exec";

  // Fire-and-forget submission of the full questionnaire to the sheet.
  // Guarded by state.submitted so a row is written at most once per run.
  function submitToSheet() {
    if (state.submitted || !SHEET_WEBHOOK_URL) return;
    const q = i => state.dontKnow[i] ? "לא יודע/ת" : (state.answers[i] || "");
    const payload = {
      name: state.name || "", email: state.email || "", code: state.userCode || "",
      q1: q(0), q2: q(1), q3: q(2), q4: q(3), q5: q(4), q6: q(5), q7: q(6),
      legacy_text: state.legacyText || "",
      phone: state.phone || ""
    };
    try {
      fetch(SHEET_WEBHOOK_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
      });
      state.submitted = true;
      // Log in the just-created depositor so the session persists across a
      // page refresh (and the header reflects the logged-in state).
      setSession({ email: state.email || "", code: state.userCode || "", name: state.name || "" });
      updateHeaderAuthState();
    } catch (err) { /* לא חוסם את חוויית המשתמש */ }
  }

  // ============================================================
  // Data
  // ============================================================
  const questions = [
    "באיזה שפה סבא וסבתא דיברו בבית?",
    "מה סבא הכי אהב לעשות?",
    "מה גרם לסבתא לצחוק?",
    "ממה סבא פחד?",
    "מה סבתא חלמה לעשות ולא הצליחה?",
    "על מה סבא לא דיבר?",
    "מה תאריך הלידה של סבא?"
  ];

  // Real archive entries, loaded from the DB (Google Sheets) at boot.
  let pastViewers = [];

  // Load the archive entries via JSONP (a plain fetch to Apps Script is
  // blocked by CORS). The landing wall re-renders when the data arrives.
  function loadViewersFromDB() {
    if (!SHEET_WEBHOOK_URL) return;
    const cbName = "__wrViewersCb";
    window[cbName] = function(res) {
      pastViewers = (res && res.entries ? res.entries : []).map(function(e){
        return {
          name: e.name,
          code: String(e.code).padStart(4, "0"),
          archive: e.legacy_text,
          answers: [e.q1, e.q2, e.q3, e.q4, e.q5, e.q6, e.q7]
        };
      });
      renderLandingDrawers();
      delete window[cbName];
      if (s && s.remove) s.remove();
    };
    var s = document.createElement("script");
    s.src = SHEET_WEBHOOK_URL + "?callback=" + cbName + "&t=" + Date.now();
    document.body.appendChild(s);
  }

  const state = {
    name: "",
    email: "",
    phone: "",
    currentQuestion: 0,
    answers: [],
    dontKnow: [],
    legacyText: "",
    photoDataUrl: "",    // depositor photo (session only, not persisted)
    userCode: "",
    submitted: false,    // guards against a double webhook submission
    frozenCount: 0,      // stacked (frozen) sheets behind the live question
    date: new Date().toLocaleDateString("he-IL", {
      day: "numeric", month: "numeric", year: "2-digit"
    })
  };

  // ============================================================
  // Screen routing
  // ============================================================
  const screens = {
    archive:   document.getElementById("screen-landing"),
    questions: document.getElementById("screen-questions"),
    cards:     document.getElementById("screen-cards"),
    legacy:    document.getElementById("screen-legacy"),
    stack:     document.getElementById("screen-stack"),
    camera:    document.getElementById("screen-camera"),
    envelope:  document.getElementById("screen-envelope"),
    personal:  document.getElementById("screen-personal")
  };
  const figmaLanding = document.getElementById("figma-landing");

  function showScreen(name) {
    Object.values(screens).forEach(s => { if (s) s.classList.remove("active"); });
    if (figmaLanding) figmaLanding.classList.toggle("is-dismissed", name !== "landing");
    if (name === "landing") return;
    if (screens[name]) screens[name].classList.add("active");
  }

  // ============================================================
  // Landing (PHASE.LANDING) — archive drawer wall + intro card + stamps
  // ============================================================
  const landingBg = document.getElementById("landing-bg");

  // Single source of truth for "search the archive by name": the same name
  // filter + Hebrew sort used by both the archive wall and the landing-v2
  // inline search. An empty query returns the whole archive, sorted.
  function getArchiveMatches(query) {
    const q = (query || "").trim();
    let drawers = allDrawers().sort((a, b) => a.name.localeCompare(b.name, "he"));
    if (q) drawers = drawers.filter(v => (v.name || "").includes(q));
    return drawers;
  }
  // Exposed to the landing-v2 iframe (same-origin direct call, mirroring
  // window.handleWhatRemainsLandingAction) so search runs without leaving it.
  window.getArchiveMatches = getArchiveMatches;

  // The landing IS the archive: it shows the full drawer wall, filtered
  // live by the in-place search input when one is open.
  function renderLandingDrawers() {
    if (!landingBg) return;
    landingBg.innerHTML = "";
    const drawers = getArchiveMatches(searchInput && searchInput.value ? searchInput.value : "");
    drawers.forEach(v => landingBg.appendChild(buildDrawerEl(v)));
  }

  // Popup corner button: click flips the card to its back face.
  const landingCardInner = document.getElementById("landing-card-inner");
  const btnCardFlip = document.getElementById("btn-card-flip");
  if (btnCardFlip && landingCardInner) {
    btnCardFlip.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!landingCardInner.classList.contains("is-flipped")) {
        landingCardInner.classList.add("is-flipped");
        startLandingTypewriter("back");
      }
    });
  }

  const landingTypewriterState = new WeakMap();
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Split into reveal units. Array.from keeps surrogate pairs (emoji) whole and
  // is index-aligned with the per-site `chars` arrays that drive the rhythm.
  function typewriterUnits(text) {
    return Array.from(text || "");
  }

  // Stable typewriter: the FINAL text is laid out from the very first frame so
  // the element already occupies its final width, height, line breaks, wrapping
  // and alignment. A hidden full-text reserve fixes the block's box; an absolute
  // "live" layer holds the same text as per-character spans, all starting
  // hidden. Typing only flips per-character visibility — no reflow, so words
  // never jump between lines and lines never move. Characters are revealed in
  // logical (reading) order, which the browser lays out correctly for RTL.
  function prepareTypewriterElement(el, text) {
    if (!el) return null;
    el.classList.add("typewriter-stable");
    const norm = text || "";
    el.innerHTML =
      '<span class="typewriter-reserve" aria-hidden="true"></span>' +
      '<span class="typewriter-live" aria-hidden="true"></span>';
    const reserve = el.querySelector(".typewriter-reserve");
    const live = el.querySelector(".typewriter-live");
    if (reserve) reserve.textContent = norm;
    if (live) {
      const units = typewriterUnits(norm);
      const frag = document.createDocumentFragment();
      const spans = [];
      units.forEach(ch => {
        const span = document.createElement("span");
        span.className = "tw-char";
        // A "\n" span still forces its line break under pre-wrap even while
        // hidden, so the final line structure is present from the first frame.
        span.textContent = ch;
        frag.appendChild(span);
        spans.push(span);
      });
      live.appendChild(frag);
      live.__twSpans = spans;
      live.__twCursorIndex = -1;
    }
    return live;
  }

  // Reveal characters [0, count) on a prepared live layer and park the caret on
  // the last revealed character. Visibility-only — never touches layout.
  function revealTypewriterUpTo(live, count) {
    if (!live || !live.__twSpans) return;
    const spans = live.__twSpans;
    const upto = Math.max(0, Math.min(count, spans.length));
    for (let i = 0; i < upto; i++) {
      if (spans[i]) spans[i].classList.add("tw-shown");
    }
    const cursorIdx = upto - 1;
    if (live.__twCursorIndex !== cursorIdx) {
      if (live.__twCursorIndex >= 0 && spans[live.__twCursorIndex]) {
        spans[live.__twCursorIndex].classList.remove("tw-cursor");
      }
      if (cursorIdx >= 0 && spans[cursorIdx]) {
        spans[cursorIdx].classList.add("tw-cursor");
      }
      live.__twCursorIndex = cursorIdx;
    }
  }

  // Instantly reveal every character (reduced motion / "finish now" paths) and
  // clear the caret, since typing is complete.
  function setTypewriterText(el, text) {
    const live = el && el.querySelector ? el.querySelector(".typewriter-live") : null;
    if (live && live.__twSpans) {
      live.__twSpans.forEach(s => { if (s) s.classList.add("tw-shown"); });
      if (live.__twCursorIndex >= 0 && live.__twSpans[live.__twCursorIndex]) {
        live.__twSpans[live.__twCursorIndex].classList.remove("tw-cursor");
      }
      live.__twCursorIndex = -1;
    } else if (live) {
      live.textContent = text || "";
    } else if (el) {
      el.textContent = text || "";
    }
  }

  function setupLandingTypewriter() {
    document.querySelectorAll(".landing-card-face").forEach(face => {
      const parts = [...face.querySelectorAll(".landing-label, .landing-body p")];
      landingTypewriterState.set(face, {
        parts: parts.map(el => {
          const text = el.textContent;
          return { el, live: prepareTypewriterElement(el, text), text };
        }),
        started: false
      });
    });
  }

  function startLandingTypewriter(faceName) {
    const face = document.querySelector(`.landing-card-${faceName}`);
    const state = face && landingTypewriterState.get(face);
    if (!state || state.started) return;
    state.started = true;

    if (reduceMotion) {
      state.parts.forEach(part => { setTypewriterText(part.el, part.text); });
      return;
    }

    typeLandingPart(state.parts, 0);
  }

  function typewriterSpeedFor(screenEl) {
    const raw = getComputedStyle(screenEl).getPropertyValue("--blank-type-speed").trim();
    const value = parseFloat(raw);
    return Number.isFinite(value) ? value : 57;
  }

  function typeLandingPart(parts, partIndex) {
    const part = parts[partIndex];
    if (!part) return;

    const chars = Array.from(part.text);
    let charIndex = 0;
    part.el.classList.add("is-typing");
    const speed = typewriterSpeedFor(screens.landing);

    function tick() {
      const target = part.live || part.el;
      charIndex += 1;
      revealTypewriterUpTo(target, charIndex);

      if (charIndex < chars.length) {
        window.setTimeout(tick, speed);
        return;
      }

      part.el.classList.remove("is-typing");
      window.setTimeout(() => typeLandingPart(parts, partIndex + 1), speed);
    }

    tick();
  }

  // ============================================================
  // Auth / session — shared contract: localStorage "wr_session"
  //   { email, code, name }. "logged in" = session exists with a code.
  // ============================================================
  const WR_SESSION_KEY = "wr_session";
  function getSession() {
    try { return JSON.parse(localStorage.getItem(WR_SESSION_KEY) || "null"); }
    catch (e) { return null; }
  }
  function isLoggedIn() {
    const s = getSession();
    return !!(s && s.code);
  }
  function setSession(sess) { localStorage.setItem(WR_SESSION_KEY, JSON.stringify(sess)); }
  function clearSession() { localStorage.removeItem(WR_SESSION_KEY); }

  // True while viewing a drawer the logged-in user owns (gates the edit UI)
  let ownerView = false;

  // The old in-page header stamps were removed; the new landing (landing-v2)
  // owns login/my-drawer entry, so there is no in-page auth chrome to sync.
  // Kept as a stable no-op hook for the existing call sites.
  function updateHeaderAuthState() {}

  // --- Login modal ---
  const loginModal       = document.getElementById("login-modal");
  const loginModalContent = document.getElementById("login-modal-content");
  const loginFlip        = document.getElementById("login-flip");
  const loginBackCode    = document.getElementById("login-back-code");
  const btnBackLogout    = document.getElementById("btn-back-logout");
  const loginEmail       = document.getElementById("login-email");
  const loginCode        = document.getElementById("login-code");
  const loginErr         = document.getElementById("login-err");
  const btnSubmitLogin   = document.getElementById("btn-submit-login");
  const btnCloseLogin    = document.getElementById("btn-close-login");

  function openLoginModal() {
    const sess = getSession();
    const loggedIn = !!(sess && sess.code);
    loginEmail.value = "";
    loginCode.value = "";
    loginErr.textContent = "";
    if (loginFlip) loginFlip.classList.remove("is-flipped");
    loginModal.classList.add("active");
    if (!loggedIn) setTimeout(() => loginEmail.focus(), 50);
  }
  function closeLoginModal() { loginModal.classList.remove("active"); }

  function submitLogin() {
    const email = (loginEmail.value || "").trim();
    const rawCode = (loginCode.value || "").trim();
    loginErr.textContent = "";
    if (!email || !rawCode) { loginErr.textContent = "יש למלא מייל וקוד"; return; }
    const code = rawCode.padStart(4, "0");   // zero-pad to 4 digits before sending
    if (!SHEET_WEBHOOK_URL) { loginErr.textContent = "שגיאת תקשורת, נסו שוב"; return; }
    btnSubmitLogin.disabled = true;

    // JSONP (GET) — same proven pattern as loadViewersFromDB. A plain
    // cross-origin fetch to Apps Script is CORS-blocked, and a GET never
    // writes a row to the sheet.
    const cbName = "__wrLoginCb" + Date.now();
    let s;
    function cleanup() {
      delete window[cbName];
      if (s && s.remove) s.remove();
      btnSubmitLogin.disabled = false;
    }
    const timer = setTimeout(() => { cleanup(); loginErr.textContent = "שגיאת תקשורת, נסו שוב"; }, 10000);
    window[cbName] = function(data) {
      clearTimeout(timer);
      if (data && data.ok) {
        setSession({ email: email, code: data.code, name: data.name });
        // Don't keep the typed email/code lying around after logging in
        loginEmail.value = "";
        loginCode.value = "";
        loginErr.textContent = "";
        // Flip 180° to the connected card; it stays ~2s, then the modal closes.
        updateHeaderAuthState();
        if (loginBackCode) loginBackCode.textContent = data.code || "";
        if (loginFlip) loginFlip.classList.add("is-flipped");
        setTimeout(() => {
          closeLoginModal();
          if (loginFlip) loginFlip.classList.remove("is-flipped");
        }, 2700);   // 0.7s flip + 2s visible
      } else {
        loginErr.textContent = "מייל או קוד שגויים";
      }
      cleanup();
    };
    s = document.createElement("script");
    s.src = SHEET_WEBHOOK_URL + "?action=login&callback=" + cbName +
            "&email=" + encodeURIComponent(email) +
            "&code=" + encodeURIComponent(code) +
            "&t=" + Date.now();
    s.onerror = function() { clearTimeout(timer); cleanup(); loginErr.textContent = "שגיאת תקשורת, נסו שוב"; };
    document.body.appendChild(s);
  }

  if (btnSubmitLogin) btnSubmitLogin.addEventListener("click", submitLogin);
  if (btnCloseLogin)  btnCloseLogin.addEventListener("click", closeLoginModal);
  if (loginEmail) loginEmail.addEventListener("keydown", (e) => { if (e.key === "Enter") submitLogin(); });
  if (loginCode)  loginCode.addEventListener("keydown", (e) => { if (e.key === "Enter") submitLogin(); });
  if (btnBackLogout) btnBackLogout.addEventListener("click", () => {
    clearSession();
    updateHeaderAuthState();
    closeLoginModal();
    if (loginFlip) loginFlip.classList.remove("is-flipped");
  });

  // Account screen — shown when a logged-in user clicks the person icon.
  const accountModal     = document.getElementById("account-modal");
  const accountCode      = document.getElementById("account-code");
  const btnAccountLogout = document.getElementById("btn-account-logout");
  function openAccountModal() {
    const sess = getSession();
    if (accountCode) accountCode.textContent = (sess && sess.code) ? sess.code : "";
    if (accountModal) accountModal.classList.add("active");
  }
  function closeAccountModal() { if (accountModal) accountModal.classList.remove("active"); }
  if (accountModal) accountModal.addEventListener("click", (e) => {
    if (e.target === accountModal) closeAccountModal();   // click outside the card closes it
  });
  if (btnAccountLogout) btnAccountLogout.addEventListener("click", () => {
    clearSession();
    updateHeaderAuthState();
    closeAccountModal();
  });

  // Open the logged-in user's own drawer directly (auto-unlock, owner view)
  function openOwnDrawer(sess) {
    const drawers = allDrawers();
    // Prefer the live (this-session) drawer so the owner's own materials —
    // the portrait captured after the questions, plus the live date/answers —
    // come from session state, even once the DB listing echoes the row back.
    let viewer = drawers.find(v => v.isUser && v.code === sess.code)
              || drawers.find(v => v.code === sess.code);
    if (!viewer) viewer = { name: sess.name || "", code: sess.code, archive: "", answers: null };
    activeViewer = viewer;
    activeDrawerEl = document.querySelector('.wall-drawer[data-name="' + CSS.escape(viewer.name || "") + '"]') || null;
    openDrawerInterior(viewer);
  }

  // Login / my-drawer entry now lives on the landing-v2 nav, routed through
  // handleWhatRemainsLandingAction ("login" / "drawer"). No in-page stamps.

  // Enter the questionnaire flow with the register card as the active
  // sheet on the questions stage.
  function startRegistration() {
    closeLoginModal();
    closeAccountModal();
    resetQuestionStage();
    checkDepositBtn();
    showScreen("questions");
    setTimeout(() => nameInput.focus(), 60);
  }

  // Actions from the new Figma landing. These call the real application
  // functions directly; the removed legacy landing is no longer used as a
  // hidden proxy layer.
  window.handleWhatRemainsLandingAction = (action, payload) => {
    if (action === "create") startRegistration();
    if (action === "search") {
      renderLandingDrawers();
      showScreen("archive");
      if (searchInput) window.setTimeout(() => searchInput.focus(), 60);
    }
    if (action === "login") {
      const sess = getSession();
      if (sess && sess.code) openAccountModal();
      else openLoginModal();
    }
    if (action === "drawer") {
      const sess = getSession();
      if (sess && sess.code) openOwnDrawer(sess);
      else openLoginModal();
    }
    // Open a specific archive drawer chosen from the landing-v2 inline search.
    // Reuses the same open-by-code path as the archive wall (owner unlocks,
    // everyone else gets the code modal).
    if (action === "openDrawer") {
      const code = payload && payload.code != null ? String(payload.code) : "";
      const v = code ? getArchiveMatches("").find(x => x.code === code) : null;
      if (v) openViewerDrawer(v, null);
    }
  };

  // ============================================================
  // Register card (name + email + phone) — first sheet of the pile
  // ============================================================
  const btnBackWelcome = document.getElementById("btn-back-welcome");
  const nameInput  = document.getElementById("user-name");
  const emailInput = document.getElementById("user-email");
  const phoneInput = document.getElementById("user-phone");
  const btnDeposit = document.getElementById("btn-deposit");

  function emailValid(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }

  function checkDepositBtn() {
    btnDeposit.disabled = !(nameInput.value.trim() !== "" && emailValid(emailInput.value));
  }
  nameInput.addEventListener("input", checkDepositBtn);
  emailInput.addEventListener("input", checkDepositBtn);

  btnBackWelcome.addEventListener("click", () => {
    showScreen("landing");
  });

  btnDeposit.addEventListener("click", () => {
    if (btnDeposit.disabled) return;
    state.name  = nameInput.value.trim();
    state.email = emailInput.value.trim();
    state.phone = phoneInput ? phoneInput.value.trim() : "";
    state.userCode = String(pastViewers.length + 1).padStart(4, "0");
    state.currentQuestion = 0;
    state.answers = [];
    state.dontKnow = [];
    state.legacyText = "";
    // The filled register card joins the flow; question 1 appears stable.
    freezeRegisterCard();
    initQuestions();
  });

  // ============================================================
  // Questions (contenteditable lines, disabled-until-typed next)
  // ============================================================
  const qNum   = document.getElementById("q-num");
  const qDate  = document.getElementById("q-date");
  const qName  = document.getElementById("q-name");
  const qAbout = document.getElementById("q-about");
  const qText  = document.getElementById("q-text");
  const qNameGhost = document.getElementById("question-name-ghost");
  const qMemoryTrace = document.getElementById("question-memory-trace");
  const btnNext = document.getElementById("btn-next-q");
  const btnDk   = document.getElementById("btn-dk-q");
  const lines = Array.from(document.querySelectorAll("#lines .line__text"));

  // ── Live question sheet drift ──────────────────────────────────────────
  // The questionnaire is a single live sheet. It is not frozen: it settles
  // into a slightly different position/angle for each question so the page
  // reads as being handled, matching the gently tilted form in Figma. The
  // distributed answer traces behind it (see renderMemoryBackground) drift
  // through the space separately — the sheets are never collected into a pile.
  const activeQuestionSheet = document.querySelector("#screen-questions .qform-sheet--active");

  const Q_ACTIVE_SHIFT = [
    { x: 0,  y: 0,  r: 0 },
    { x: -9, y: 6,  r: -0.9 },
    { x: 8,  y: -5, r: 0.8 },
    { x: -6, y: 8,  r: -0.7 },
    { x: 10, y: 4,  r: 1.1 },
    { x: -8, y: -6, r: -0.9 },
    { x: 6,  y: 7,  r: 0.6 }
  ];

  function applyActiveSheetShift() {
    if (!activeQuestionSheet) return;
    const s = Q_ACTIVE_SHIFT[Math.min(state.currentQuestion, Q_ACTIVE_SHIFT.length - 1)];
    activeQuestionSheet.style.transform =
      "translate(" + s.x + "px," + s.y + "px) rotate(" + s.r + "deg)";
  }

  function resetActiveSheetShift() {
    if (activeQuestionSheet) activeQuestionSheet.style.transform = "";
  }

  // Maps each of the 7 questions to its "about" value shown in the
  // header cell ("על").
  const questionAbouts = [
    "סבא וסבתא",
    "סבא וסבתא",
    "סבא וסבתא",
    "סבא וסבתא",
    "סבא וסבתא",
    "סבא וסבתא",
    "סבא וסבתא"
  ];

  function getAnswerText() {
    return lines.map(l => l.textContent.trim()).filter(Boolean).join("\n");
  }

  function clearLines() {
    lines.forEach(l => { l.textContent = ""; });
  }

  function updateNextAvailability() {
    btnNext.disabled = getAnswerText() === "";
  }

  function renderQuestion(instantQuestionText) {
    const idx = state.currentQuestion;
    qNum.textContent  = (idx + 1) + "/" + questions.length;
    applyActiveSheetShift();
    typeQuestionText(questions[idx], instantQuestionText);
    if (qAbout) qAbout.textContent = questionAbouts[idx] || "";
    clearLines();
    btnNext.disabled = true;
    if (lines[0]) {
      lines[0].focus();
      placeCaretAtEnd(lines[0]);
    }
  }

  function setQuestionMemoryTrace(items) {
    setMemoryTraceItems(qMemoryTrace, items);
  }

  function buildQuestionMemoryItems(count) {
    const items = [];
    const limit = Math.min(count, questions.length);
    for (let i = 0; i < limit; i++) {
      const answer = String(state.answers[i] || "").replace(/\s+/g, " ").trim();
      if (state.dontKnow[i]) {
        items.push("לא יודע/ת");
      } else if (answer) {
        items.push(answer);
      }
    }
    return items;
  }

  // The ghost field behind the live questions accumulates only the answers
  // given so far. Each answer enters at full size on the next question and
  // shrinks one step (−20%) on every screen after that, so the newest answer
  // is always the largest. Skipped ("לא יודע/ת") answers leave no trace.
  function buildAnswerMemoryItems(count) {
    const items = [];
    const limit = Math.min(count, questions.length);
    for (let i = 0; i < limit; i++) {
      const answer = String(state.answers[i] || "").replace(/\s+/g, " ").trim();
      if (answer && !state.dontKnow[i]) items.push(answer);
    }
    return items;
  }

  function setMemoryTraceItems(container, items, options) {
    if (!container) return;
    const traces = Array.isArray(items) ? items : (items ? [items] : []);
    const isQuestionTrace = container === qMemoryTrace;
    if (!traces.length) {
      container.innerHTML = "";
      container.classList.remove("is-visible");
      return;
    }
    container.querySelectorAll(".question-memory-trace__item").forEach(trace => {
      const i = Number(trace.dataset.questionIndex);
      if (!Number.isFinite(i) || i >= traces.length) trace.remove();
    });
    traces.forEach((text, i) => {
      let trace = container.querySelector('[data-question-index="' + i + '"]');
      if (!trace) {
        trace = document.createElement("span");
        trace.className = "question-memory-trace__item";
        trace.dataset.questionIndex = String(i);
        trace.dataset.slot = String(i % 7);
        const inner = document.createElement("span");
        inner.className = "question-memory-trace__item-inner";
        trace.appendChild(inner);
        container.appendChild(trace);
      }
      const inner = trace.querySelector(".question-memory-trace__item-inner");
      if (inner) inner.textContent = text;
      const age = isQuestionTrace ? traces.length - i : traces.length - i - 1;
      trace.dataset.age = String(age);
      trace.removeAttribute("data-dissolving");
    });
    container.classList.toggle("is-visible", traces.length > 0);
  }

  let questionTypewriterRun = 0;
  let activeQuestionText = "";

  function typeQuestionText(text, instant) {
    activeQuestionText = text || "";
    questionTypewriterRun += 1;
    const run = questionTypewriterRun;

    if (!qText) return;
    const questionLive = prepareTypewriterElement(qText, activeQuestionText);

    if (reduceMotion || instant) {
      setTypewriterText(qText, activeQuestionText);
      qText.classList.remove("is-typing");
      return;
    }

    const chars = Array.from(activeQuestionText);
    let charIndex = 0;
    qText.classList.add("is-typing");

    function tick() {
      if (run !== questionTypewriterRun) return;
      const target = questionLive || qText;
      charIndex += 1;
      revealTypewriterUpTo(target, charIndex);

      if (charIndex < chars.length) {
        const prev = chars[charIndex - 1];
        const delay = /[.,!?;:،.]/.test(prev) ? 177 : 50;
        window.setTimeout(tick, delay);
        return;
      }

      qText.classList.remove("is-typing");
    }

    tick();
  }

  function finishQuestionTypewriter() {
    questionTypewriterRun += 1;
    if (qText) {
      qText.classList.remove("is-typing");
      setTypewriterText(qText, activeQuestionText);
    }
  }

  const registerSheet = document.getElementById("register-sheet");

  function questionStage() {
    return document.querySelector("#screen-questions .qform-stage");
  }

  // Fresh entry into the flow: clear frozen question sheets from a
  // previous run, un-freeze the register card and put it back on top.
  function resetQuestionStage() {
    const stage = questionStage();
    if (stage) stage.classList.add("qform-stage--register");
    if (qMemoryTrace) {
      qMemoryTrace.querySelectorAll(".qmem-word").forEach(el => el.remove());
      qMemoryTrace.classList.remove("is-visible");
    }
    if (registerSheet) registerSheet.removeAttribute("aria-hidden");
    resetActiveSheetShift();
  }

  // Leaving the register card: the form stays put and question 1 appears; the
  // depositor's name is the first word to recede into the memory background.
  function freezeRegisterCard() {
    const stage = questionStage();
    if (stage) stage.classList.remove("qform-stage--register");
    if (registerSheet) registerSheet.setAttribute("aria-hidden", "true");
    renderMemoryBackground();
  }

  function initQuestions() {
    qDate.textContent = state.date;
    qName.textContent = state.name;
    if (qNameGhost) {
      qNameGhost.textContent = (state.name || "").trim().split(/\s+/)[0] || "";
    }
    renderQuestion();
  }

  // ── Memory background ──────────────────────────────────────────────
  // The form itself never recedes — only the answers do. The depositor's
  // name and every answer (or "לא יודע/ת") drift behind the live form as
  // soft blurred words. Per Figma: Mandatory Variable Bold, blur 20px,
  // opacity 0.3, multiply. The newest word is the largest (350px at the
  // 1920px base) and each older word steps down 20%; every chronological
  // word keeps its own fixed scatter slot, so the blurred mass of past
  // answers spreads and grows as the questionnaire advances.
  const MEMORY_SLOTS = [
    { right: -1.0, top: -3.4 },  // 0 — depositor name
    { right: 27.8, top: 1.4 },   // 1
    { right: 52.6, top: 22.1 },  // 2
    { right: -4.3, top: 34.7 },  // 3
    { right: 34.7, top: 50.5 },  // 4
    { right: -5.9, top: 74.7 },  // 5
    { right: 56.0, top: 77.4 }   // 6
  ];
  const MEMORY_BASE_VW = 18.23;  // 350px / 1920px
  const MEMORY_STEP = 0.8;       // each older word is 20% smaller
  // Each distributed trace keeps its scatter slot but drifts a little further
  // through the space as it ages, so the whole composition slowly shifts
  // between questions instead of sitting frozen (never collected into a pile).
  // Fixed per-slot direction (vw / vh / deg per step); capped so the traces
  // stay in their distributed positions throughout the sequence.
  const MEMORY_DRIFT = [
    { dx: -0.55, dy: -0.42, dr: -0.34 },  // 0 — depositor name
    { dx: 0.48,  dy: 0.5,   dr: 0.3 },    // 1
    { dx: -0.5,  dy: 0.46,  dr: -0.28 },  // 2
    { dx: 0.52,  dy: -0.4,  dr: 0.32 },   // 3
    { dx: -0.46, dy: 0.5,   dr: -0.3 },   // 4
    { dx: 0.5,   dy: -0.48, dr: 0.28 },   // 5
    { dx: -0.4,  dy: 0.44,  dr: -0.26 }   // 6
  ];
  const MEMORY_DRIFT_MAX = 5;    // stop accumulating drift after this many steps

  function memoryWords() {
    const words = [];
    const firstName = (state.name || "").trim().split(/\s+/)[0];
    if (firstName) words.push(firstName);
    const answered = Math.min(state.currentQuestion, questions.length);
    for (let i = 0; i < answered; i++) {
      if (state.dontKnow[i]) { words.push("לא יודע/ת"); continue; }
      const a = String(state.answers[i] || "").replace(/\s+/g, " ").trim();
      words.push(a || "לא יודע/ת");
    }
    return words;
  }

  function renderMemoryBackground() {
    if (!qMemoryTrace) return;
    const words = memoryWords();
    const total = words.length;
    const existing = new Map();
    qMemoryTrace.querySelectorAll(".qmem-word").forEach(el => existing.set(el.dataset.mem, el));
    const keep = new Set();
    words.forEach((text, i) => {
      const key = String(i);
      keep.add(key);
      let el = existing.get(key);
      if (!el) {
        el = document.createElement("span");
        el.className = "qmem-word";
        el.dataset.mem = key;
        qMemoryTrace.appendChild(el);
      }
      if (el.textContent !== text) el.textContent = text;
      const slotIndex = Math.min(i, MEMORY_SLOTS.length - 1);
      const slot = MEMORY_SLOTS[slotIndex];
      const age = total - 1 - i;                       // newest word (age 0) is largest
      const vw = (MEMORY_BASE_VW * Math.pow(MEMORY_STEP, age)).toFixed(2);
      const cap = Math.round(350 * Math.pow(MEMORY_STEP, age) * 1.2);
      el.style.right = slot.right + "%";
      el.style.top = slot.top + "%";
      el.style.fontSize = "min(" + vw + "vw, " + cap + "px)";
      // Slow drift through the space, growing with age but capped so the
      // trace never leaves its distributed region.
      const drift = MEMORY_DRIFT[slotIndex];
      const steps = Math.min(age, MEMORY_DRIFT_MAX);
      el.style.transform =
        "translate(" + (drift.dx * steps).toFixed(2) + "vw," +
        (drift.dy * steps).toFixed(2) + "vh) rotate(" +
        (drift.dr * steps).toFixed(2) + "deg)";
    });
    existing.forEach((el, key) => { if (!keep.has(key)) el.remove(); });
    qMemoryTrace.classList.toggle("is-visible", total > 0);
  }

  let isQuestionTransitioning = false;
  function handleAnswer(isDontKnow) {
    if (isQuestionTransitioning) return;
    const finishingIndex = state.currentQuestion;
    finishQuestionTypewriter();
    state.answers[finishingIndex]  = isDontKnow ? null : getAnswerText();
    state.dontKnow[finishingIndex] = isDontKnow;
    state.currentQuestion++;

    isQuestionTransitioning = true;
    // The answer recedes into the distributed memory background, and every
    // existing trace drifts a little further through the space.
    renderMemoryBackground();
    if (state.currentQuestion >= questions.length) {
      initCards();
      showScreen("cards");
    } else {
      // Every question types itself in — the typewriter is not limited to the
      // first prompt. questionTypewriterRun guards against a replay once done.
      renderQuestion();
    }
    window.setTimeout(() => { isQuestionTransitioning = false; }, reduceMotion ? 0 : 450);
  }

  // No JS scaling — the stage is sized responsively in CSS.

  lines.forEach(line => {
    line.addEventListener("input", updateNextAvailability);
    line.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const idx = Number(line.dataset.line);
        const next = lines[idx + 1];
        if (next) {
          e.preventDefault();
          next.focus();
          placeCaretAtEnd(next);
        }
      }
    });
    line.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData("text");
      document.execCommand("insertText", false, text.replace(/\n/g, " "));
    });
  });

  btnNext.addEventListener("click", () => {
    if (btnNext.disabled) return;
    handleAnswer(false);
  });
  btnDk.addEventListener("click", () => {
    if (btnDk.disabled) return;
    handleAnswer(true);
  });

  // ============================================================
  // Legacy (uses the same .qform card as questions 1-7)
  // ============================================================
  const legacyName    = document.getElementById("legacy-name");
  const legacyDate    = document.getElementById("legacy-date");
  const legacyLines   = Array.from(document.querySelectorAll("#legacy-lines .line__text"));
  const btnLegacyNext = document.getElementById("btn-legacy-next");
  const legacyMemoryTrace = document.getElementById("legacy-memory-trace");
  const legacyQText   = document.querySelector("#screen-legacy .qform-question-text");
  const LEGACY_QUESTION_TEXT = legacyQText ? legacyQText.textContent : "";
  let legacyTypewriterRun = 0;

  // Keep the answer lines inert while the prompt is still typing, so the
  // depositor reads the question before writing — mirrors the questionnaire's
  // motion language without adding a noticeable wait.
  function setLegacyInputEnabled(on) {
    legacyLines.forEach(l => l.setAttribute("contenteditable", on ? "true" : "false"));
  }
  function focusLegacyStart() {
    if (legacyLines[0]) {
      legacyLines[0].focus();
      placeCaretAtEnd(legacyLines[0]);
    }
  }

  // Same typewriter as the seven questionnaire prompts, applied to the legacy
  // question. The input opens once the prompt is sufficiently visible.
  function typeLegacyQuestion() {
    if (!legacyQText) { focusLegacyStart(); return; }
    legacyTypewriterRun += 1;
    const run = legacyTypewriterRun;
    const text = LEGACY_QUESTION_TEXT;
    const live = prepareTypewriterElement(legacyQText, text);
    setLegacyInputEnabled(false);

    if (reduceMotion) {
      setTypewriterText(legacyQText, text);
      legacyQText.classList.remove("is-typing");
      setLegacyInputEnabled(true);
      focusLegacyStart();
      return;
    }

    const chars = Array.from(text);
    let charIndex = 0;
    legacyQText.classList.add("is-typing");
    const enableAt = Math.min(chars.length, Math.ceil(chars.length * 0.55));

    function tick() {
      if (run !== legacyTypewriterRun) return;
      const target = live || legacyQText;
      charIndex += 1;
      revealTypewriterUpTo(target, charIndex);

      if (charIndex === enableAt) {
        setLegacyInputEnabled(true);
        focusLegacyStart();
      }

      if (charIndex < chars.length) {
        const prev = chars[charIndex - 1];
        const delay = /[.,!?;:،.]/.test(prev) ? 177 : 50;
        window.setTimeout(tick, delay);
      } else {
        legacyQText.classList.remove("is-typing");
        setLegacyInputEnabled(true);
      }
    }
    tick();
  }

  function getLegacyText() {
    return legacyLines.map(l => l.textContent.trim()).filter(Boolean).join("\n");
  }
  function clearLegacyLines() {
    legacyLines.forEach(l => { l.textContent = ""; });
  }
  function updateLegacyNextAvailability() {
    btnLegacyNext.disabled = getLegacyText() === "";
  }

  function initLegacy() {
    legacyName.textContent = state.name;
    legacyDate.textContent = state.date;
    setMemoryTraceItems(legacyMemoryTrace, buildQuestionMemoryItems(questions.length));
    clearLegacyLines();
    btnLegacyNext.disabled = true;
    // Settle the legacy page onto the preserved background as a new layer,
    // rather than cutting to a fresh screen.
    screens.legacy.classList.remove("is-entering");
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (screens.legacy.classList.contains("active")) {
        screens.legacy.classList.add("is-entering");
      }
    }));
    setTimeout(typeLegacyQuestion, 50);
  }

  legacyLines.forEach(line => {
    line.addEventListener("input", updateLegacyNextAvailability);
    line.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const idx = Number(line.dataset.line);
        const next = legacyLines[idx + 1];
        if (next) {
          e.preventDefault();
          next.focus();
          placeCaretAtEnd(next);
        }
      }
    });
    line.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData("text");
      document.execCommand("insertText", false, text.replace(/\n/g, " "));
    });
  });

  btnLegacyNext.addEventListener("click", () => {
    if (btnLegacyNext.disabled) return;
    const txt = getLegacyText();
    if (txt === "") return;
    state.legacyText = txt;
    submitToSheet(); // all 12 fields are now filled — fire-and-forget
    initStackTransition();
    showScreen("stack");
  });

  // ============================================================
  // PHASE.CARDS — memory traces before the personal message
  // ============================================================
  const cardsScene   = document.getElementById("cards-scene");
  const cardsBlankType = document.getElementById("cards-blank-typewriter");
  const btnBeginLeaving = document.getElementById("btn-begin-leaving");
  const cardsMemoryTrace = document.getElementById("cards-memory-trace");

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // The five ruled answer lines, filled with the user's answer (split by
  // newline). When the question was skipped ("לא יודע/ת"), the answer area
  // stays blank — the empty ruled lines are the record that it went unanswered.
  function buildAnswerLines(i, src) {
    const ans = (src && src.answers) || state.answers;
    const dk  = (src && src.dontKnow) || state.dontKnow;
    const parts = dk[i]
      ? []
      : String(ans[i] || "").split("\n");
    let html = "";
    for (let k = 0; k < 5; k++) {
      const label = k === 0 ? '<span class="qform-label">תשובה</span>' : "";
      html += '<div class="answer-line">' + label +
              '<span class="line__text">' + esc(parts[k] || "") + "</span></div>";
    }
    return html;
  }

  // A single summary card, marked up exactly like the live .qform sheets.
  // `src` (optional) supplies the viewer's name/date/answers; without it the
  // card falls back to the logged-in user's own state (the live flow).
  function cardFormHTML(i, src) {
    const nm = (src && src.name != null) ? src.name : state.name;
    const dt = (src && src.date != null) ? src.date : state.date;
    return '' +
      '<article class="qform">' +
        '<div class="qform-grid">' +
          '<div class="qform-row qform-header">' +
            '<div class="qform-cell"><span class="qform-label">שם העונה</span>' +
              '<span class="qform-value">' + esc(nm) + '</span></div>' +
            '<div class="qform-cell"><span class="qform-label">על</span>' +
              '<span class="qform-value">' + esc(questionAbouts[i] || "") + '</span></div>' +
            '<div class="qform-cell"><span class="qform-label">תאריך</span>' +
              '<span class="qform-value">' + esc(dt) + '</span></div>' +
            '<div class="qform-cell qform-cell-num"><span class="qform-label">מס׳ שאלה</span>' +
              '<span class="qform-value qform-num">' + (i + 1) + '/' + questions.length + '</span></div>' +
          '</div>' +
          '<div class="qform-row qform-question-row"><span class="qform-label">שאלה</span>' +
            '<div class="qform-question-text">' + esc(questions[i]) + '</div></div>' +
          '<div class="qform-row qform-answer-row">' + buildAnswerLines(i, src) + '</div>' +
        '</div>' +
      '</article>';
  }

  function stackQuestionFormHTML(i) {
    const action = '<div class="stack-sheet-actions">' +
      (state.dontKnow[i] ? '<span class="stack-sheet-dk">לא יודע/ת</span>' : '') +
      '<img src="images/next-default.png" alt="" width="160" height="160">' +
      '</div>';
    return cardFormHTML(i).replace('</article>', action + '</article>');
  }

  function stackLegacyFormHTML() {
    const parts = String(state.legacyText || '').split('\n');
    let answerRows = '';
    for (let i = 0; i < 5; i++) {
      answerRows += '<div class="answer-line">' +
        (i === 0 ? '<span class="qform-label">תשובה</span>' : '') +
        '<span class="line__text">' + esc(parts[i] || '') + '</span></div>';
    }
    return '<article class="qform stack-legacy-form">' +
      '<div class="qform-grid">' +
        '<div class="qform-row qform-header">' +
          '<div class="qform-cell"><span class="qform-label">שם העונה</span><span class="qform-value">' + esc(state.name) + '</span></div>' +
          '<div class="qform-cell"><span class="qform-label">על</span><span class="qform-value">עליי</span></div>' +
          '<div class="qform-cell"><span class="qform-label">תאריך</span><span class="qform-value">' + esc(state.date) + '</span></div>' +
          '<div class="qform-cell qform-cell-num"><span class="qform-label">סוג מסמך</span><span class="qform-value qform-num">מורשת</span></div>' +
        '</div>' +
        '<div class="qform-row qform-question-row"><span class="qform-label">שאלה</span>' +
          '<div class="qform-question-text">מה היית רוצה שהנכדים שלך ידעו עליך?</div></div>' +
        '<div class="qform-row qform-answer-row">' + answerRows + '</div>' +
      '</div>' +
      '<div class="stack-sheet-actions"><img src="images/next-default.png" alt="" width="160" height="160"></div>' +
    '</article>';
  }

  const stackStage = document.getElementById("stack-transition-stage");
  const stackPile = document.getElementById("stack-transition-pile");
  const stackMemoryTrace = document.getElementById("stack-memory-trace");
  let stackTransitionRun = 0;

  function initStackTransition() {
    if (!stackStage || !stackPile) return;
    const run = ++stackTransitionRun;
    setMemoryTraceItems(stackMemoryTrace, buildQuestionMemoryItems(questions.length));
    stackStage.classList.remove("is-forming");
    let sheets = '';
    for (let i = 0; i < questions.length; i++) {
      sheets += '<div class="stack-transition-sheet stack-transition-sheet--question" data-sheet="' + i + '">' +
        stackQuestionFormHTML(i) + '</div>';
    }
    sheets += '<div class="stack-transition-sheet stack-transition-sheet--legacy" data-sheet="legacy">' +
      stackLegacyFormHTML() + '</div>';
    stackPile.innerHTML = sheets;

    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (run === stackTransitionRun) stackStage.classList.add("is-forming");
    }));

    window.setTimeout(() => {
      if (run !== stackTransitionRun || !screens.stack.classList.contains("active")) return;
      initCameraScreen();
      showScreen("camera");
    }, reduceMotion ? 200 : 4300);
  }

  let cardsCopyRun = 0;

  function initCards() {
    if (cardsScene) {
      cardsScene.classList.remove("is-typing", "is-copy-done", "is-ack-visible", "is-ack-receding", "is-copy-visible");
    }
    if (btnBeginLeaving) btnBeginLeaving.disabled = true;
    if (cardsBlankType) cardsBlankType.textContent = "";
    cardsCopyRun += 1;
    setMemoryTraceItems(cardsMemoryTrace, buildQuestionMemoryItems(questions.length));

    window.setTimeout(runCardsAcknowledgement, reduceMotion ? 0 : 180);
  }

  function runCardsAcknowledgement() {
    if (!cardsScene) return;
    cardsCopyRun += 1;
    const run = cardsCopyRun;
    cardsScene.classList.add("is-ack-visible");

    if (reduceMotion) {
      cardsScene.classList.add("is-ack-receding", "is-copy-visible");
      typeBlankCopy();
      return;
    }

    window.setTimeout(() => {
      if (run !== cardsCopyRun) return;
      cardsScene.classList.add("is-ack-receding");
    }, 2200);

    window.setTimeout(() => {
      if (run !== cardsCopyRun) return;
      cardsScene.classList.add("is-copy-visible");
      typeBlankCopy();
    }, 3100);
  }

  function cardsTypeSpeed() {
    return typewriterSpeedFor(screens.cards);
  }

  function typeBlankCopy() {
    if (!cardsBlankType) return;
    cardsCopyRun += 1;
    const run = cardsCopyRun;
    const text = cardsBlankType.dataset.text || "";
    const cardsLive = prepareTypewriterElement(cardsBlankType, text);
    cardsScene.classList.remove("is-copy-done");
    cardsScene.classList.add("is-typing");
    if (btnBeginLeaving) btnBeginLeaving.disabled = true;

    if (reduceMotion) {
      setTypewriterText(cardsBlankType, text);
      cardsScene.classList.remove("is-typing");
      cardsScene.classList.add("is-copy-done");
      window.setTimeout(() => { if (run === cardsCopyRun) beginLeaving(); }, 600);
      return;
    }

    const chars = Array.from(text);
    let charIndex = 0;
    const speed = cardsTypeSpeed();

    function tick() {
      if (run !== cardsCopyRun) return;
      const target = cardsLive || cardsBlankType;
      charIndex += 1;
      revealTypewriterUpTo(target, charIndex);

      if (charIndex < chars.length) {
        window.setTimeout(tick, speed);
      } else {
        cardsScene.classList.remove("is-typing");
        cardsScene.classList.add("is-copy-done");
        // Hold the finished line for a beat, then continue on its own — no
        // button, no click required.
        window.setTimeout(() => { if (run === cardsCopyRun) beginLeaving(); }, 2500);
      }
    }

    tick();
  }

  function beginLeaving() {
    if (!cardsScene.classList.contains("is-copy-done")) return;
    initLegacy();
    showScreen("legacy");
  }

  // ============================================================
  // PHASE.CAMERA — depositor photo
  // ============================================================
  const cameraVideo   = document.getElementById("camera-video");
  const cameraCanvas  = document.getElementById("camera-canvas");
  const cameraPhoto   = document.getElementById("camera-photo");
  const cameraMsg     = document.getElementById("camera-msg");
  const cameraMemoryTrace = document.getElementById("camera-memory-trace");
  const cameraStackPile = document.getElementById("camera-stack-pile");
  const cameraDocName = document.getElementById("camera-doc-name");
  const cameraDocDate = document.getElementById("camera-doc-date");
  const cameraDocLines = Array.from(document.querySelectorAll(".camera-document .line__text"));
  const cameraShutter = document.getElementById("camera-shutter");
  const cameraRetake  = document.getElementById("camera-retake");
  const btnCameraNext = document.getElementById("btn-camera-next");
  const btnCameraBack = document.getElementById("btn-camera-back");
  const envelopeTransition = document.getElementById("memory-envelope-transition");
  const btnEnvelopeNext = document.getElementById("btn-envelope-next");
  const stampInstructionsPile = document.getElementById("stamp-instructions-pile");
  const stampInstructionsTrace = document.getElementById("stamp-instructions-trace");
  const stampInstructionsCode = document.getElementById("stamp-instructions-code");
  const stampInstructionsPhoto = document.getElementById("stamp-instructions-photo-preview");

  let cameraStream = null;

  // Always release the camera (turns the webcam light off) on any exit
  function stopCameraStream() {
    if (cameraStream) {
      cameraStream.getTracks().forEach(t => t.stop());
      cameraStream = null;
    }
  }

  async function initCameraScreen() {
    // Accumulated family-memory background: the previous question traces sit
    // faintly underneath, with the photograph placed on top as the newest layer.
    setMemoryTraceItems(cameraMemoryTrace, buildQuestionMemoryItems(questions.length));
    // Carry the exact completed pile into the camera composition. Keeping the
    // same generated sheets, dimensions and transforms makes the new photo
    // read as the next layer of one continuous physical animation.
    if (cameraStackPile && stackPile) cameraStackPile.innerHTML = stackPile.innerHTML;
    screens.camera.classList.remove("is-entering");
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (screens.camera.classList.contains("active")) {
        screens.camera.classList.add("is-entering");
      }
    }));
    // Reflect the real deposit on the heritage document shown under the photo.
    if (cameraDocName) cameraDocName.textContent = state.name || "";
    if (cameraDocDate) cameraDocDate.textContent = state.date || "";
    const legacyParts = String(state.legacyText || "").split("\n");
    cameraDocLines.forEach((line, index) => {
      line.textContent = legacyParts[index] || "";
    });
    // reset to live-preview state
    cameraPhoto.hidden = true;
    cameraPhoto.removeAttribute("src");
    cameraVideo.hidden = false;
    cameraMsg.hidden = true;
    cameraMsg.textContent = "";
    if (cameraRetake) cameraRetake.hidden = true;
    btnCameraNext.disabled = false; // photo is optional — continue always allowed
    cameraShutter.disabled = false;
    stopCameraStream();
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" }, audio: false
      });
      cameraVideo.srcObject = cameraStream;
    } catch (err) {
      // Soft fallback — no camera / no permission: let the user continue
      cameraVideo.hidden = true;
      cameraMsg.textContent = "אין גישה למצלמה";
      cameraMsg.hidden = false;
      cameraShutter.disabled = true;
      btnCameraNext.disabled = false;
    }
  }

  cameraShutter.addEventListener("click", () => {
    if (!cameraStream) return;
    const w = cameraVideo.videoWidth, h = cameraVideo.videoHeight;
    if (!w || !h) return;
    cameraCanvas.width = w;
    cameraCanvas.height = h;
    cameraCanvas.getContext("2d").drawImage(cameraVideo, 0, 0, w, h);
    const dataUrl = cameraCanvas.toDataURL("image/jpeg", 0.85);
    state.photoDataUrl = dataUrl;
    cameraPhoto.src = dataUrl;
    cameraVideo.hidden = true;
    cameraPhoto.hidden = false;
    stopCameraStream();              // freeze + release the camera
    btnCameraNext.disabled = false;
    cameraShutter.disabled = true;
    if (cameraRetake) cameraRetake.hidden = false;
  });

  if (cameraRetake) {
    cameraRetake.addEventListener("click", () => {
      state.photoDataUrl = "";
      initCameraScreen();
    });
  }

  // Upload the depositor's registration photo into their drawer's Drive
  // folder (so it persists like any other uploaded file, not just in-session).
  function uploadDepositorPhoto() {
    if (!state.photoDataUrl || !state.userCode || !SHEET_WEBHOOK_URL) return;
    const dataUrl = state.photoDataUrl;
    const comma = dataUrl.indexOf(",");
    const mime = (dataUrl.slice(5, comma).split(";")[0]) || "image/jpeg";
    const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
    try {
      fetch(SHEET_WEBHOOK_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          action: "upload",
          code: state.userCode,
          filename: "depositor-photo.jpg",
          mimeType: mime,
          data: base64
        })
      });
    } catch (err) { /* לא חוסם */ }
  }

  function initEnvelopeTransition() {
    if (!envelopeTransition) return;
    setMemoryTraceItems(stampInstructionsTrace, buildQuestionMemoryItems(questions.length));
    if (stampInstructionsPile && cameraStackPile) {
      stampInstructionsPile.innerHTML = cameraStackPile.innerHTML;
    }
    if (stampInstructionsCode) {
      stampInstructionsCode.textContent = String(state.userCode || "0001").padStart(4, "0");
    }
    if (stampInstructionsPhoto) {
      if (state.photoDataUrl) {
        stampInstructionsPhoto.src = state.photoDataUrl;
        stampInstructionsPhoto.hidden = false;
      } else {
        stampInstructionsPhoto.hidden = true;
        stampInstructionsPhoto.removeAttribute("src");
      }
    }
    envelopeTransition.classList.remove("is-visible");
    if (btnEnvelopeNext) btnEnvelopeNext.disabled = false;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (screens.envelope.classList.contains("active")) {
        envelopeTransition.classList.add("is-visible");
      }
    }));
  }

  btnCameraNext.addEventListener("click", () => {
    if (btnCameraNext.disabled) return;
    uploadDepositorPhoto();
    stopCameraStream();
    initEnvelopeTransition();
    showScreen("envelope");
  });

  if (btnEnvelopeNext) {
    btnEnvelopeNext.addEventListener("click", () => {
      if (btnEnvelopeNext.disabled) return;
      renderLandingDrawers();
      const sess = getSession();
      if (sess && sess.code) openOwnDrawer(sess);
      else showScreen("landing");
    });
  }

  if (btnCameraBack) {
    btnCameraBack.addEventListener("click", () => {
      stopCameraStream();
      showScreen("legacy");
    });
  }

  // ============================================================
  // PHASE.PRINT_INSTRUCTIONS — simple text → back home (the archive)
  // ============================================================
  // ============================================================
  // Personal archive (the user's own drawer)
  // ============================================================
  const pName    = document.getElementById("p-name");
  const archivePile = document.getElementById("archive-pile");
  const btnPersonalRestart   = document.getElementById("btn-personal-restart");
  const archiveBox = document.querySelector("#screen-personal .archive-box");
  const personalSearchPanel = document.getElementById("personal-search-panel");
  const personalUploadPanel = document.getElementById("personal-upload-panel");
  const personalSearchForm = document.getElementById("personal-search-form");
  const personalUploadForm = document.getElementById("personal-upload-form");
  const personalSearchStatus = document.getElementById("personal-search-status");

  // Pre-decode the large record-card textures (~12MP each). Otherwise the browser
  // decodes them lazily the first time the panel is shown, janking the main thread
  // and freezing the shared-element open animation for that first frame batch.
  ["images/figma-archive-search-card.jpg", "images/figma-archive-add-card.jpg"].forEach(src => {
    const im = new Image();
    im.src = src;
    if (im.decode) im.decode().catch(() => {});
  });

  // Personal-archive state. The scattered pile is built from THIS depositor's
  // own materials: their answered question cards plus their photos/videos.
  let currentDrawerCode = "";
  let pileCardData = null;   // the 7 question cards' data for the open drawer
  let pileMedia = [];        // authoritative media {src, kind, own?} (drive + own photo)
  let pileLocalMedia = [];   // optimistic just-picked uploads, until Drive reloads
  let pendingUploadMetadata = null;

  // One reusable hidden file input drives all drawer uploads.
  const uploadInput = document.createElement("input");
  uploadInput.type = "file";
  uploadInput.style.display = "none";
  document.body.appendChild(uploadInput);
  uploadInput.addEventListener("change", () => {
    const file = uploadInput.files && uploadInput.files[0];
    uploadInput.value = ""; // let the same file be re-picked later
    if (file && currentDrawerCode) {
      closePersonalTool();
      uploadFileToDrawer(file, currentDrawerCode);
    }
  });

  // Upload a file into the drawer's Drive folder (fire-and-forget POST, like
  // submitToSheet — the response isn't CORS-readable), then refresh the
  // gallery via the JSONP "files" listing.
  function uploadFileToDrawer(file, code) {
    if (!SHEET_WEBHOOK_URL) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      // Optimistic: show the picked file on the page immediately.
      showLocalPreview(file, dataUrl);
      const comma = dataUrl.indexOf(",");
      const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
      try {
        fetch(SHEET_WEBHOOK_URL, {
          method: "POST",
          mode: "no-cors",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify({
            action: "upload",
            code: code,
            filename: file.name || "file",
            mimeType: file.type || "application/octet-stream",
            description: pendingUploadMetadata ? pendingUploadMetadata.description : "",
            requestedFormat: pendingUploadMetadata ? pendingUploadMetadata.format : "",
            data: base64
          })
        });
      } catch (err) { /* לא חוסם */ }
      pendingUploadMetadata = null;
      // No readable response — give Drive a moment, then reload the listing.
      setTimeout(() => loadDrawerFiles(code), 4000);
    };
    reader.onerror = () => loadDrawerFiles(code);
    reader.readAsDataURL(file);
  }

  // Drop a just-picked file straight onto the pile (before the Drive
  // round-trip finishes), dimmed until the pile reloads from Drive.
  function showLocalPreview(file, dataUrl) {
    const isVideo = (file.type || "").indexOf("video/") === 0;
    pileLocalMedia.push({ src: dataUrl, kind: isVideo ? "video" : "image", uploading: true });
    renderArchivePile();
  }

  // Fetch the drawer's files via JSONP and render them into the folders.
  function loadDrawerFiles(code) {
    if (!code || !SHEET_WEBHOOK_URL) return;
    const cbName = "__wrFilesCb" + Date.now();
    let s;
    window[cbName] = function(res) {
      renderDrawerFiles((res && res.files) ? res.files : []);
      delete window[cbName];
      if (s && s.remove) s.remove();
    };
    s = document.createElement("script");
    s.src = SHEET_WEBHOOK_URL + "?action=files&callback=" + cbName +
            "&code=" + encodeURIComponent(code) + "&t=" + Date.now();
    s.onerror = function() { delete window[cbName]; if (s && s.remove) s.remove(); };
    document.body.appendChild(s);
  }

  function renderDrawerFiles(files) {
    // Rebuild the pile media from Drive, keeping the session-only own photo
    // (marked own) at the front. Drive thumbnails work for videos too.
    const own = pileMedia.filter(m => m.own);
    const driveMedia = (files || []).map(f => ({
      src: "https://drive.google.com/thumbnail?id=" + f.id + "&sz=w1000",
      kind: f.type
    }));
    pileMedia = own.concat(driveMedia);
    pileLocalMedia = [];
    renderArchivePile();
  }

  // Open a depositor's personal archive as a scattered pile of THEIR own
  // materials — the 7 answered question cards plus their photos/videos.
  // The card data is the drawer's own: own drawer uses live state, a DB
  // drawer uses answers fetched from the sheet (empty when unanswered, so we
  // never leak the logged-in user's answers into someone else's cards).
  function openDrawerInterior(viewer) {
    if (!viewer) return;
    if (activeDrawerEl) activeDrawerEl.classList.add("is-opened");
    // Owner view = logged-in session whose code matches this drawer's code.
    const _sess = getSession();
    ownerView = !!(_sess && _sess.code && viewer.code && _sess.code === viewer.code);
    currentDrawerCode = viewer.code || "";
    pName.textContent = viewer.name || "(ללא שם)";

    let answers = null, dontKnow = null;
    if (viewer.isUser) {
      answers  = state.answers;
      dontKnow = state.dontKnow;
    } else if (Array.isArray(viewer.answers) && viewer.answers.some(a => a && String(a).trim())) {
      answers  = viewer.answers;
      dontKnow = viewer.answers.map(a => String(a).trim() === "לא יודע/ת");
    }
    pileCardData = {
      name: viewer.name || state.name,
      date: viewer.isUser ? state.date : "",
      answers: answers || [],
      dontKnow: dontKnow || [],
      legacyText: viewer.isUser ? state.legacyText : (viewer.archive || "")
    };

    // Seed the pile media with the depositor's own portrait — the photo taken
    // after the questions (session state, not persisted). Show it on the
    // owner's own drawer, whether resolved as the live drawer or a DB echo.
    pileMedia = [];
    pileLocalMedia = [];
    if ((viewer.isUser || ownerView) && state.photoDataUrl) {
      pileMedia.push({ src: state.photoDataUrl, kind: "image", own: true });
    }

    renderArchivePile();
    loadDrawerFiles(currentDrawerCode); // append this drawer's Drive materials
    showScreen("personal");
  }

  // Deterministic pseudo-random in [0,1) so each pile item keeps a stable
  // scattered position/rotation across re-renders (no jitter on reload).
  function pileRand(seed) {
    const x = Math.sin(seed * 99.13 + seed * seed * 0.729) * 43758.5453;
    return x - Math.floor(x);
  }

  // Build the scattered pile from the open drawer's own materials: the
  // question document sheets behind the depositor's photos/videos, each laid
  // at a stable pseudo-random position, rotation and size.
  // The viewer's drawer code as a stable 4-digit label (e.g. "0001") for the
  // faint number printed across the kraft envelope cards.
  function pileCodeLabel() {
    const c = String(currentDrawerCode || "");
    return /^\d+$/.test(c) ? c.padStart(4, "0") : (c || "0001");
  }

  function archiveLegacyFormHTML(src) {
    const data = src || {};
    const parts = String(data.legacyText || "").split("\n");
    let answerRows = "";
    for (let i = 0; i < 5; i++) {
      answerRows += '<div class="answer-line">' +
        (i === 0 ? '<span class="qform-label">תשובה</span>' : '') +
        '<span class="line__text">' + esc(parts[i] || '') + '</span></div>';
    }
    return '<article class="qform stack-legacy-form">' +
      '<div class="qform-grid">' +
        '<div class="qform-row qform-header">' +
          '<div class="qform-cell"><span class="qform-label">שם העונה</span><span class="qform-value">' + esc(data.name || '') + '</span></div>' +
          '<div class="qform-cell"><span class="qform-label">על</span><span class="qform-value">עליי</span></div>' +
          '<div class="qform-cell"><span class="qform-label">תאריך</span><span class="qform-value">' + esc(data.date || '') + '</span></div>' +
          '<div class="qform-cell qform-cell-num"><span class="qform-label">סוג מסמך</span><span class="qform-value qform-num">מורשת</span></div>' +
        '</div>' +
        '<div class="qform-row qform-question-row"><span class="qform-label">שאלה</span>' +
          '<div class="qform-question-text">מה היית רוצה שהנכדים שלך ידעו עליך?</div></div>' +
        '<div class="qform-row qform-answer-row">' + answerRows + '</div>' +
      '</div>' +
    '</article>';
  }

  function renderArchivePile() {
    if (!archivePile) return;
    const media = pileMedia.concat(pileLocalMedia);
    // Every personal archive begins with the seven answers, the legacy page,
    // and the portrait taken afterwards (when it is available).
    const docCount = pileCardData ? questions.length + 1 : 0;

    // The search/add papers are no longer separate kraft "envelope" cards in the
    // pile — each is the actual tool sheet (.personal-tool-card) tucked at the
    // bottom of the pile, peeking up, and it is that same sheet that slides
    // forward when clicked (see openPersonalTool). Fill in its printed
    // owner/code and reveal the papers this drawer is allowed to show.
    setPersonalToolText();
    if (archiveBox) {
      archiveBox.classList.add("is-pile-ready");
      archiveBox.classList.toggle("is-owner", ownerView);
    }

    // The document sheets form the back of the pile; the depositor's own
    // photos/videos sit on top as the materials laid over the archive.
    const items = [];
    for (let i = 0; i < docCount; i++) items.push({ type: "doc", i: i });
    media.forEach(m => items.push({ type: "media", m: m }));

    // Keep the archive sheets at the same real responsive dimensions used by
    // the questionnaire itself (1370×969 at the 1920×1080 Figma canvas).
    const dw = Math.min(1370, window.innerWidth * 0.71354, window.innerHeight * 0.8972 * 1.41383);

    const docLayout = [
      { x: 48, y: 77, r: -9.6, z: 36 },
      { x: 47, y: 61, r: -0.4, z: 24 },
      { x: 43, y: 50, r: -4.7, z: 20 },
      { x: 52, y: 43, r: 5.1, z: 18 },
      { x: 55, y: 36, r: -2.1, z: 16 },
      { x: 44, y: 31, r: 2.6, z: 14 },
      { x: 51, y: 25, r: 0.8, z: 12 },
      { x: 50, y: 20, r: 11.3, z: 10 }
    ];

    archivePile.innerHTML = "";
    items.forEach((it, k) => {
      const el = document.createElement("div");
      if (it.type === "doc") {
        el.className = "pile-item pile-item--doc";
        el.style.setProperty("--dw", dw + "px");
        // Unitless scale factor for .pile-doc's transform: scale() needs a
        // number, and calc() cannot divide a length by a length.
        el.style.setProperty("--pile-scale", (dw / 1370).toFixed(5));
        const form = it.i === questions.length
          ? archiveLegacyFormHTML(pileCardData)
          : cardFormHTML(it.i, pileCardData);
        el.innerHTML = '<div class="pile-doc">' + form + "</div>";
        // Decorative "next" arrow tucked into a corner of some sheets (Figma).
        if (pileRand(it.i + 200) > 0.45) {
          el.insertAdjacentHTML("beforeend",
            '<img class="pile-doc-next" src="images/next-default.png" alt="" aria-hidden="true">');
        }
      } else {
        el.className = "pile-item pile-item--photo";
        if (it.m.uploading) el.classList.add("is-uploading");
        const badge = it.m.kind === "video" ? '<span class="pile-play" aria-hidden="true"></span>' : "";
        el.innerHTML = '<img loading="lazy" alt="" src="' + it.m.src + '">' + badge;
        el.style.setProperty("--w", (0.82 + pileRand(k + 41) * 0.5).toFixed(3));
      }
      el.classList.add("pile-item--breathing");
      const seed = it.seed != null ? it.seed : k;
      el.style.setProperty("--breathe-x", ((pileRand(seed + 31) > 0.5 ? 1 : -1) * (1 + pileRand(seed + 37) * 2)).toFixed(2) + "px");
      el.style.setProperty("--breathe-y", ((pileRand(seed + 41) > 0.5 ? 1 : -1) * (1 + pileRand(seed + 43) * 2)).toFixed(2) + "px");
      el.style.setProperty("--breathe-r", ((pileRand(seed + 47) - 0.5) * 1).toFixed(3) + "deg");
      el.style.setProperty("--breathe-duration", (6 + pileRand(seed + 53) * 4).toFixed(2) + "s");
      el.style.setProperty("--breathe-delay", (-pileRand(seed + 59) * 5).toFixed(2) + "s");
      let x, y, rot, z;
      if (it.type === "doc") {
        const slot = docLayout[it.i];
        x = slot.x; y = slot.y; rot = slot.r; z = slot.z;
      } else {
        const mediaIndex = k - docCount;
        x = mediaIndex === 0 ? 66 : 50 + (pileRand(seed + 7) - 0.5) * 52;
        y = mediaIndex === 0 ? 22 : 54 + (pileRand(seed + 13) - 0.5) * 45;
        rot = mediaIndex === 0 ? -9.75 : (pileRand(seed + 1) - 0.5) * 16;
        z = 70 + k;
      }
      el.style.left = x + "%";
      el.style.top = y + "%";
      el.style.setProperty("--rot", rot.toFixed(2) + "deg");
      el.style.zIndex = String(z);
      archivePile.appendChild(el);
    });
  }

  function setPersonalToolText() {
    const code = pileCodeLabel();
    ["personal-search-code", "personal-upload-code"].forEach(id => {
      const el = document.getElementById(id); if (el) el.textContent = code;
    });
    ["personal-search-owner", "personal-upload-owner"].forEach(id => {
      const el = document.getElementById(id); if (el) el.textContent = pileCardData ? pileCardData.name : "";
    });
  }

  // One physical sheet, start to finish. The paper the user clicks in the pile
  // *is* the paper that opens: opening only toggles state classes, and a single
  // CSS transform transition carries the exact same sheet (identical size,
  // typography, padding and rotation) between its pile-peek position and the
  // centred open position. Closing removes the same classes, so the transition
  // runs in reverse and the sheet returns to the very position, rotation and
  // stacking order it started from. No second element, no layout swap.
  function openPersonalTool(kind) {
    if (!archiveBox) return;
    if (archiveBox.classList.contains("is-tool-open")) return;
    setPersonalToolText();

    archiveBox.classList.add("is-tool-open", "is-tool-" + kind);
    if (archivePile) archivePile.classList.add("is-spread");   // the rest of the pile disperses (unchanged)
    if (personalSearchPanel) personalSearchPanel.setAttribute("aria-hidden", kind === "search" ? "false" : "true");
    if (personalUploadPanel) personalUploadPanel.setAttribute("aria-hidden", kind === "upload" ? "false" : "true");

    const focusTarget = document.getElementById(kind === "search" ? "personal-search-query" : "personal-upload-description");
    // Focus only once the sheet has settled, so the field never scrolls it away.
    window.setTimeout(() => { if (focusTarget) focusTarget.focus({ preventScroll: true }); }, reduceMotion ? 0 : 760);
  }

  function closePersonalTool() {
    if (!archiveBox || !archiveBox.classList.contains("is-tool-open")) return false;
    // Reverse the identical motion: drop the state classes and the same
    // transition carries the sheet back to its exact pile-peek position.
    archiveBox.classList.remove("is-tool-open", "is-tool-search", "is-tool-upload");
    if (archivePile) archivePile.classList.remove("is-spread");
    if (personalSearchPanel) personalSearchPanel.setAttribute("aria-hidden", "true");
    if (personalUploadPanel) personalUploadPanel.setAttribute("aria-hidden", "true");
    if (personalSearchStatus) personalSearchStatus.textContent = "";
    return true;
  }

  // Clicking a peeking tool sheet brings that exact sheet forward. Interior
  // controls are inert until it is open (see CSS), so a closed-sheet click can
  // only ever mean "open me".
  function wireToolOpen(form, panel, kind, guard) {
    if (!form || !panel) return;
    form.addEventListener("click", (e) => {
      if (panel.getAttribute("aria-hidden") !== "false") {
        if (guard && !guard()) return;
        e.preventDefault();
        openPersonalTool(kind);
      }
    });
  }
  wireToolOpen(personalSearchForm, personalSearchPanel, "search", null);
  wireToolOpen(personalUploadForm, personalUploadPanel, "upload", () => ownerView && !!currentDrawerCode);

  // Back arrow on each open sheet closes it (returns it to the pile).
  document.querySelectorAll(".personal-tool-back").forEach((btn) => {
    btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); closePersonalTool(); });
  });

  // Re-scatter/re-scale the pile on resize while the personal screen is open.
  window.addEventListener("resize", () => {
    if (screens.personal && screens.personal.classList.contains("active")) {
      renderArchivePile();
    }
  });

  // Gentle "slide a paper aside" interaction: clicking within ~12px of an
  // item's edge nudges it ~18px out of the pile in that direction (toggle).
  if (archivePile) {
    archivePile.addEventListener("click", (e) => {
      const item = e.target.closest(".pile-item");
      if (!item) return;
      const r = item.getBoundingClientRect();
      const edge = 12;
      const nl = e.clientX - r.left <= edge, nr = r.right - e.clientX <= edge;
      const nt = e.clientY - r.top  <= edge, nb = r.bottom - e.clientY <= edge;
      if (!(nl || nr || nt || nb)) return;   // interior clicks do nothing
      const on = item.classList.toggle("is-nudged");
      const d = 18;
      let nx = 0, ny = 0;
      if (nl) nx = -d; else if (nr) nx = d;
      if (nt) ny = -d; else if (nb) ny = d;
      item.style.setProperty("--nx", on ? nx + "px" : "0px");
      item.style.setProperty("--ny", on ? ny + "px" : "0px");
    });
  }

  // The archive-box always crops (overflow:hidden) and must never scroll — the
  // tool sheets peek below the fold, and focusing an input could otherwise
  // scroll the whole desk to chase it, shifting the opened sheet off-centre.
  // Pin it at the origin so the sheet's position stays exactly as designed.
  if (archiveBox) {
    archiveBox.addEventListener("scroll", () => {
      if (archiveBox.scrollTop || archiveBox.scrollLeft) {
        archiveBox.scrollTop = 0;
        archiveBox.scrollLeft = 0;
      }
    }, { passive: true });
  }

  if (personalSearchForm) personalSearchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const query = document.getElementById("personal-search-query").value.trim();
    const format = document.getElementById("personal-search-format").value.trim();
    if (!query) return;
    window.dispatchEvent(new CustomEvent("whatremains:archive-search", {
      detail: { code: currentDrawerCode, query: query, format: format }
    }));
    if (personalSearchStatus) personalSearchStatus.textContent = "הבקשה התקבלה";
  });

  if (personalUploadForm) personalUploadForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const description = document.getElementById("personal-upload-description").value.trim();
    const format = document.getElementById("personal-upload-format").value.trim();
    if (!description) return;
    pendingUploadMetadata = { description: description, format: format };
    uploadInput.accept = "image/*,video/*,.pdf,.doc,.docx,.txt,audio/*";
    uploadInput.click();
  });

  // Bottom-right: back to the archive; re-lock so re-entry needs the code
  btnPersonalRestart.addEventListener("click", () => {
    if (closePersonalTool()) return;
    activeViewer = null;
    showScreen("landing");
  });

  // ============================================================
  // Archive (lives on the landing screen) — search + drawer modals
  // ============================================================
  const searchInput = document.getElementById("landing-search");

  const codeModal        = document.getElementById("code-modal");
  const codeModalContent = document.getElementById("code-modal-content");
  const codeTarget       = document.getElementById("code-target");
  const codeBoxes        = Array.from(document.querySelectorAll("#code-boxes .code-box"));
  const errMsg           = document.getElementById("err-msg");

  // The displayed value is masked (*) while the real digit lives in
  // dataset.real, so checkCode reads the actual code, not the asterisks.
  function getCodeValue() {
    return codeBoxes.map(b => b.dataset.real || "").join("");
  }
  function clearCodeBoxes() {
    codeBoxes.forEach(b => { b.dataset.real = ""; b.value = ""; });
  }
  const btnSubmitCode    = document.getElementById("btn-submit-code");
  const btnCloseCode     = document.getElementById("btn-close-code");

  const contentModal = document.getElementById("content-modal");
  const contentName  = document.getElementById("content-name");
  const contentText  = document.getElementById("content-text");
  const btnCloseContent = document.getElementById("btn-close-content");

  let activeViewer = null;
  let activeDrawerEl = null;

  function allDrawers() {
    const list = pastViewers.slice();
    if (state.userCode && state.name) {
      list.push({
        name: state.name,
        code: state.userCode,
        archive: state.legacyText,
        answers: state.answers,
        isUser: true
      });
    }
    return list;
  }

  function envelopeLayerTypes(v) {
    const layers = [];
    const archiveText = String(v.archive || "").trim();
    const answers = Array.isArray(v.answers) ? v.answers : [];
    const memoryAnswers = answers.filter(a => {
      const txt = String(a || "").trim();
      return txt && txt !== "לא יודע/ת";
    });

    if (archiveText) layers.push("text");
    if (v.isUser && state.photoDataUrl) layers.push("photo");
    memoryAnswers.forEach(() => layers.push("memory"));
    if (!layers.length) layers.push("quiet");
    return layers.slice(0, 10);
  }

  function envelopeLayerHTML(v) {
    return envelopeLayerTypes(v).map((type, i) =>
      '<span class="envelope-card__memory-layer envelope-card__memory-layer--' +
      type + '" data-layer="' + (i + 1) + '"></span>'
    ).join("");
  }

  function openArchiveStack(drawerEl, afterOpen) {
    if (!drawerEl) {
      afterOpen();
      return;
    }
    drawerEl.classList.add("is-opening");
    window.setTimeout(() => {
      afterOpen();
      drawerEl.classList.remove("is-opening");
    }, 430);
  }

  // Open a specific viewer's drawer, exactly like clicking it on the archive
  // wall: the owner (matching session code) skips the code prompt; everyone
  // else must enter that drawer's own code. drawerEl may be null when opened
  // from a context with no wall element (e.g. the landing-v2 search results).
  function openViewerDrawer(v, drawerEl) {
    if (!v) return;
    const sess = getSession();
    if (sess && sess.code && sess.code === v.code) {
      activeViewer = v;
      activeDrawerEl = drawerEl || null;
      openArchiveStack(drawerEl || null, () => openDrawerInterior(v));
    } else {
      openArchiveStack(drawerEl || null, () => openCodeModal(v, drawerEl || null));
    }
  }

  // Build one archive envelope element for the landing archive wall.
  function buildDrawerEl(v) {
    const d = document.createElement("div");
    d.className = "wall-drawer envelope-card";
    d.setAttribute("data-name", v.name);
    d.setAttribute("data-layer-count", String(envelopeLayerTypes(v).length));
    d.innerHTML =
      '<img class="envelope-card__image envelope-card__image--base envelope-card__image--closed" src="images/closed-envelope.png" alt="">' +
      '<img class="envelope-card__image envelope-card__image--base envelope-card__image--opened" src="images/opened-envelope.png" alt="">' +
      '<div class="envelope-card__memory-layers" aria-hidden="true">' + envelopeLayerHTML(v) + '</div>' +
      '<img class="envelope-card__image envelope-card__image--front envelope-card__image--closed" src="images/wenvelope-closed.png" alt="">' +
      '<img class="envelope-card__image envelope-card__image--front envelope-card__image--opened" src="images/wenvelope-opened.png" alt="">';
    const plate = document.createElement("div");
    plate.className = "wall-plate";
    const nameEl = document.createElement("span");
    nameEl.className = "wall-plate-name";
    nameEl.textContent = v.name;
    const metaEl = document.createElement("span");
    metaEl.className = "wall-plate-meta";
    metaEl.textContent = envelopeLayerTypes(v).length + " שכבות";
    plate.appendChild(nameEl);
    plate.appendChild(metaEl);
    d.appendChild(plate);

    // Owner (logged-in, code matches) skips the code prompt; everyone
    // else must enter the drawer's code to view it.
    d.addEventListener("click", () => openViewerDrawer(v, d));
    return d;
  }

  // Re-render the drawer wall with the current search query applied
  function applySearchFilter() {
    renderLandingDrawers();
  }

  if (searchInput && searchInput.addEventListener) {
    searchInput.addEventListener("input", () => applySearchFilter());
  }

  // Per-drawer code entry — the modal targets a specific viewer and
  // matches only against that drawer's code.
  function openCodeModal(viewer, drawerEl) {
    activeViewer = viewer || null;
    activeDrawerEl = drawerEl || null;
    codeTarget.textContent = viewer ? ("הארכיון של " + viewer.name) : "הזינ/י את קוד הארכיון";
    clearCodeBoxes();
    errMsg.textContent = "";
    codeModal.classList.add("active");
    setTimeout(() => { if (codeBoxes[0]) codeBoxes[0].focus(); }, 50);
  }

  function checkCode() {
    if (!activeViewer) return;
    const input = getCodeValue().trim();
    if (input === activeViewer.code) {
      codeModal.classList.remove("active");
      setTimeout(() => openArchiveStack(activeDrawerEl, () => openDrawerInterior(activeViewer)), 120);
    } else {
      errMsg.textContent = "קוד שגוי";
      codeModalContent.classList.remove("shake");
      void codeModalContent.offsetWidth;
      codeModalContent.classList.add("shake");
      if (activeDrawerEl) {
        activeDrawerEl.classList.remove("shake");
        void activeDrawerEl.offsetWidth;
        activeDrawerEl.classList.add("shake");
      }
      clearCodeBoxes();
      if (codeBoxes[0]) codeBoxes[0].focus();
    }
  }

  function showContent(name, text) {
    contentName.textContent = "הארכיון של " + name;
    contentText.textContent = text || "(אין טקסט)";
    contentModal.classList.add("active");
  }

  btnCloseCode.addEventListener("click", () => codeModal.classList.remove("active"));
  btnSubmitCode.addEventListener("click", checkCode);

  // 4-box code entry: type a digit → mask as * and advance; Backspace
  // clears/steps back; Enter or a full code submits.
  codeBoxes.forEach((box, i) => {
    box.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { checkCode(); return; }
      if (e.key === "Backspace") {
        e.preventDefault();
        if (box.dataset.real) {
          box.dataset.real = "";
          box.value = "";
        } else {
          const prev = codeBoxes[i - 1];
          if (prev) { prev.dataset.real = ""; prev.value = ""; prev.focus(); }
        }
        return;
      }
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        box.dataset.real = e.key;
        box.value = "*";
        const next = codeBoxes[i + 1];
        if (next) next.focus();
        else if (getCodeValue().length === 4) checkCode();
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        e.preventDefault(); // block non-digits
      }
    });
  });

  btnCloseContent.addEventListener("click", () => contentModal.classList.remove("active"));

  // ============================================================
  // Restart
  // ============================================================
  function restartFlow() {
    state.name = "";
    state.email = "";
    state.phone = "";
    state.currentQuestion = 0;
    state.answers = [];
    state.dontKnow = [];
    state.legacyText = "";
    state.photoDataUrl = "";
    state.userCode = "";
    state.submitted = false;

    nameInput.value = "";
    emailInput.value = "";
    if (phoneInput) phoneInput.value = "";
    clearLegacyLines();
    if (searchInput) {
      searchInput.value = "";
      searchInput.hidden = true;
    }
    clearLines();
    checkDepositBtn();
    stopCameraStream();

    codeModal.classList.remove("active");
    contentModal.classList.remove("active");
    if (landingCardInner) landingCardInner.classList.remove("is-flipped");

    renderLandingDrawers(); // back to the base drawer list (state cleared)
    showScreen("landing");
  }

  // ============================================================
  // Utilities
  // ============================================================
  function placeCaretAtEnd(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // ============================================================
  // Boot
  // ============================================================

  // Stamp buttons use a CSS "emboss" press effect instead of a hover image
  // swap. Give each button its own texture (for the ink-soak multiply layer)
  // and mirror the pressed state on touch devices, where there is no hover.
  document.querySelectorAll('.img-btn').forEach(btn => {
    const img = btn.querySelector('img');
    const src = btn.dataset.default || (img && img.getAttribute('src'));
    if (src) btn.style.setProperty('--stamp-src', 'url("' + src + '")');
    btn.addEventListener('touchstart', () => {
      if (!btn.disabled) btn.classList.add('is-pressing');
    }, { passive: true });
    const release = () => btn.classList.remove('is-pressing');
    btn.addEventListener('touchend', release);
    btn.addEventListener('touchcancel', release);
  });

  checkDepositBtn();
  updateHeaderAuthState();
  renderLandingDrawers();
  setupLandingTypewriter();
  startLandingTypewriter("front");
  loadViewersFromDB();
  showScreen("landing");
})();
