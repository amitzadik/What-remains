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
    photoDataUrl: "",    // depositor photo, until its Drive copy comes back
    photoWidth: 0,       // its true pixel size, for proportional layout
    photoHeight: 0,
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
  // The landing search receives public names plus short-lived opaque handles.
  // Passwords and record identifiers never cross into the landing iframe.
  const landingArchiveHandles = new Map();
  const landingHandleByArchive = new WeakMap();
  function getLandingArchiveMatches(query) {
    return getArchiveMatches(query).map((viewer) => {
      let handle = landingHandleByArchive.get(viewer);
      if (!handle) {
        handle = crypto.randomUUID ? crypto.randomUUID() :
          Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16)).join("-");
        landingHandleByArchive.set(viewer, handle);
      }
      landingArchiveHandles.set(handle, viewer);
      return { name: String(viewer.name || ""), handle };
    });
  }
  window.getLandingArchiveMatches = getLandingArchiveMatches;

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

  // The landing lives in an iframe, so keep its personal-drawer control in
  // sync with the parent session. It is available only to a signed-in owner.
  window.getWhatRemainsAuthState = () => ({ loggedIn: isLoggedIn() });
  function updateHeaderAuthState() {
    try {
      const landingWindow = figmaLanding && figmaLanding.contentWindow;
      if (landingWindow && typeof landingWindow.setWhatRemainsDrawerEnabled === "function") {
        landingWindow.setWhatRemainsDrawerEnabled(isLoggedIn());
      }
    } catch (_) {
      // A cross-origin design preview cannot share the signed-in state.
    }
  }
  if (figmaLanding) figmaLanding.addEventListener("load", updateHeaderAuthState);

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
    // Apps Script can need more than ten seconds on a cold start. Do not report
    // a false communication failure while the valid login response is still
    // on its way.
    const timer = setTimeout(() => {
      cleanup();
      loginErr.textContent = "שגיאת תקשורת, נסו שוב";
    }, 30000);
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
    }
    // Open a specific archive drawer chosen from the landing-v2 inline search.
    // Reuses the same open-by-code path as the archive wall (owner unlocks,
    // everyone else gets the code modal).
    if (action === "openDrawer") {
      const handle = payload && payload.handle != null ? String(payload.handle) : "";
      const v = handle ? landingArchiveHandles.get(handle) : null;
      landingArchiveHandles.delete(handle);
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
    // Carry the exact accumulated background node forward. Moving the existing
    // element preserves its children, positions, layering and rendered state;
    // nothing is cloned, rebuilt or reset between the typed sentence and the
    // legacy question.
    if (cardsMemoryTrace && screens.legacy && cardsMemoryTrace.parentNode !== screens.legacy) {
      screens.legacy.insertBefore(cardsMemoryTrace, screens.legacy.firstChild);
    }
    if (cardsMemoryTrace) cardsMemoryTrace.classList.add("is-continuing");
    // The blurred acknowledgement is part of the accumulated questionnaire
    // background in Figma 808:1677. Move that exact node with the answer
    // fragments so the legacy state keeps the same rendered archive rather
    // than reconstructing an approximation on a fresh screen.
    if (cardsMemoryAck && screens.legacy && cardsMemoryAck.parentNode !== screens.legacy) {
      const stage = screens.legacy.querySelector(".qform-stage");
      screens.legacy.insertBefore(cardsMemoryAck, stage || null);
    }
    if (cardsMemoryAck) cardsMemoryAck.classList.add("is-persisted");
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
  });

  // ============================================================
  // PHASE.CARDS — memory traces before the personal message
  // ============================================================
  const cardsScene   = document.getElementById("cards-scene");
  const cardsBlankType = document.getElementById("cards-blank-typewriter");
  const btnBeginLeaving = document.getElementById("btn-begin-leaving");
  const cardsMemoryTrace = document.getElementById("cards-memory-trace");
  const cardsMemoryAck = document.getElementById("cards-memory-ack");

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // esc() is written for text nodes and leaves quotes alone, which is not safe
  // inside a double-quoted attribute — a description is the depositor's own
  // free text and may contain anything.
  function escAttr(s) {
    return esc(s).replace(/"/g, "&quot;");
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
    // Once a completed form becomes part of a pile it is an archival document,
    // not another copy of the questionnaire UI.
    return cardFormHTML(i);
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
    '</article>';
  }

  function stackRegistrationFormHTML() {
    return '<article class="qform qform--register stack-registration-form">' +
      '<div class="register-head">' +
        '<div class="register-title">פרטי המפקיד</div>' +
      '</div>' +
      '<div class="register-table">' +
        '<div class="register-row"><span class="register-label">*שם מלא:</span><span class="register-input">' + esc(state.name) + '</span></div>' +
        '<div class="register-row"><span class="register-label">*מייל:</span><span class="register-input">' + esc(state.email) + '</span></div>' +
        '<div class="register-row"><span class="register-label">טלפון:</span><span class="register-input">' + esc(state.phone) + '</span></div>' +
      '</div>' +
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
    // Every deposited paper collects into the stack: the registration form, all
    // questions, and the legacy sheet — each animated by its data-sheet index.
    let questionSheets = '';
    for (let i = 0; i < questions.length; i++) {
      questionSheets +=
        '<div class="stack-transition-sheet stack-transition-sheet--question" data-sheet="' + i + '">' +
          stackQuestionFormHTML(i) + '</div>';
    }
    const sheets =
      '<div class="stack-transition-sheet stack-transition-sheet--registration" data-sheet="registration">' +
        stackRegistrationFormHTML() + '</div>' +
      questionSheets +
      '<div class="stack-transition-sheet stack-transition-sheet--legacy" data-sheet="legacy">' +
        stackLegacyFormHTML() + '</div>';
    stackPile.innerHTML = sheets;

    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (run === stackTransitionRun) stackStage.classList.add("is-forming");
    }));

    showScreen("camera");
    initCameraScreen();
  }

  let cardsCopyRun = 0;

  function initCards() {
    // A restarted flow returns the same background node to its original screen
    // before its next set of accumulated memories is rendered.
    if (cardsMemoryTrace && screens.cards && cardsMemoryTrace.parentNode !== screens.cards) {
      const cardsWrap = document.getElementById("cards-wrap");
      screens.cards.insertBefore(cardsMemoryTrace, cardsWrap || screens.cards.firstChild);
    }
    if (cardsMemoryTrace) cardsMemoryTrace.classList.remove("is-continuing");
    if (cardsMemoryAck && cardsScene && cardsMemoryAck.parentNode !== cardsScene) {
      cardsScene.insertBefore(cardsMemoryAck, cardsScene.firstChild);
    }
    if (cardsMemoryAck) cardsMemoryAck.classList.remove("is-persisted");
    if (cardsScene) {
      cardsScene.classList.remove("is-typing", "is-copy-done", "is-ack-visible", "is-ack-receding", "is-copy-visible", "is-sentence-leaving");
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

  let isLegacyTransitioning = false;
  function beginLeaving() {
    if (!cardsScene.classList.contains("is-copy-done") || isLegacyTransitioning) return;
    isLegacyTransitioning = true;

    // Remove only the foreground sentence. The answer fragments and blurred
    // acknowledgement remain untouched until their existing DOM nodes are
    // handed directly to the legacy screen.
    cardsScene.classList.add("is-sentence-leaving");

    window.setTimeout(() => {
      initLegacy();
      // Both screens use the same paper layer and now contain the same
      // persistent background nodes. Suppress the generic screen cross-fade
      // for this one handoff so neither the paper nor the fragments flash.
      screens.legacy.classList.add("is-continuous-entry");
      showScreen("legacy");
      requestAnimationFrame(() => {
        screens.legacy.classList.remove("is-continuous-entry");
        isLegacyTransitioning = false;
      });
    }, reduceMotion ? 0 : 700);
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
  let cameraSequenceRun = 0;

  const CAMERA_PHASE = Object.freeze({
    FORMS_MOVING_OUT: "formsMovingOut",
    FORMS_FULLY_OUTSIDE: "formsFullyOutside",
    SCREEN_FADING: "screenFading",
    FADE_COMPLETE: "fadeComplete",
    FORMS_ENTERING: "formsEntering",
    FORMS_ENTERED: "formsEntered",
    CAPTURING_IMAGE: "capturingImage",
    CAPTURE_COMPLETE: "captureComplete",
    FINAL_BROWN_SCREEN: "finalBrownScreen"
  });

  function setCameraPhase(phase) {
    if (screens.camera) screens.camera.dataset.cameraPhase = phase;
  }

  function afterTwoFrames() {
    return new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  }

  function waitForAnimation(element, animationName, fallbackMs) {
    if (!element || reduceMotion) return afterTwoFrames();
    return new Promise(resolve => {
      let settled = false;
      const finish = event => {
        if (settled || (event && event.animationName !== animationName)) return;
        settled = true;
        element.removeEventListener("animationend", finish);
        window.clearTimeout(fallback);
        resolve();
      };
      const fallback = window.setTimeout(() => finish(), fallbackMs);
      element.addEventListener("animationend", finish);
    });
  }

  function formsAreOutsideViewport() {
    if (!cameraStackPile) return false;
    const sheets = Array.from(cameraStackPile.querySelectorAll(".stack-transition-sheet"));
    return sheets.length > 0 && sheets.every(sheet => {
      const rect = sheet.getBoundingClientRect();
      return rect.right < 0 || rect.left > window.innerWidth ||
        rect.bottom < 0 || rect.top > window.innerHeight;
    });
  }

  // Always release the camera (turns the webcam light off) on any exit
  function stopCameraStream() {
    if (cameraStream) {
      cameraStream.getTracks().forEach(t => t.stop());
      cameraStream = null;
    }
  }

  async function initCameraScreen() {
    const run = ++cameraSequenceRun;
    // Accumulated family-memory background: the previous question traces sit
    // faintly underneath, with the photograph placed on top as the newest layer.
    setMemoryTraceItems(cameraMemoryTrace, buildQuestionMemoryItems(questions.length));
    // Carry the exact completed pile into the camera composition. Keeping the
    // same generated sheets, dimensions and transforms makes the new photo
    // read as the next layer of one continuous physical animation.
    if (cameraStackPile && stackPile) cameraStackPile.innerHTML = stackPile.innerHTML;
    screens.camera.classList.remove("is-fading", "is-entering", "is-ready");
    setCameraPhase(CAMERA_PHASE.FORMS_MOVING_OUT);
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
    btnCameraNext.disabled = true;
    cameraShutter.disabled = true;
    stopCameraStream();
    const startCamera = navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" }, audio: false
    }).then(stream => {
      if (run !== cameraSequenceRun) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      cameraStream = stream;
      cameraVideo.srcObject = cameraStream;
    }).catch(() => {
      if (run !== cameraSequenceRun) return;
      cameraVideo.hidden = true;
      cameraMsg.textContent = "אין גישה למצלמה";
      cameraMsg.hidden = false;
    });

    // The DOM starts with every complete, 80%-scaled form physically beyond
    // a viewport edge. Only after two painted frames and a bounds check may
    // the background fade begin.
    await afterTwoFrames();
    if (run !== cameraSequenceRun) return;
    if (!formsAreOutsideViewport()) {
      screens.camera.classList.add("force-forms-outside");
      await afterTwoFrames();
    }
    if (run !== cameraSequenceRun || !formsAreOutsideViewport()) return;
    setCameraPhase(CAMERA_PHASE.FORMS_FULLY_OUTSIDE);

    setCameraPhase(CAMERA_PHASE.SCREEN_FADING);
    screens.camera.classList.add("is-fading");
    await waitForAnimation(
      screens.camera.querySelector(".camera-screen-shade"),
      "camera-shade-in",
      1100
    );
    if (run !== cameraSequenceRun) return;
    setCameraPhase(CAMERA_PHASE.FADE_COMPLETE);

    setCameraPhase(CAMERA_PHASE.FORMS_ENTERING);
    screens.camera.classList.add("is-entering");
    await waitForAnimation(
      screens.camera.querySelector(".camera-print"),
      "camera-print-settle",
      3900
    );
    if (run !== cameraSequenceRun) return;
    setCameraPhase(CAMERA_PHASE.FORMS_ENTERED);
    screens.camera.classList.add("is-ready");
    await startCamera;
    if (run !== cameraSequenceRun) return;
    cameraShutter.disabled = !cameraStream;
  }

  cameraShutter.addEventListener("click", () => {
    if (!cameraStream || screens.camera.dataset.cameraPhase !== CAMERA_PHASE.FORMS_ENTERED) return;
    setCameraPhase(CAMERA_PHASE.CAPTURING_IMAGE);
    const w = cameraVideo.videoWidth, h = cameraVideo.videoHeight;
    if (!w || !h) {
      setCameraPhase(CAMERA_PHASE.FORMS_ENTERED);
      return;
    }
    cameraCanvas.width = w;
    cameraCanvas.height = h;
    cameraCanvas.getContext("2d").drawImage(cameraVideo, 0, 0, w, h);
    const dataUrl = cameraCanvas.toDataURL("image/jpeg", 0.85);
    state.photoDataUrl = dataUrl;
    // The camera frame is already upright pixels (no EXIF tag on a canvas
    // capture); record its size so the archive lays it out at its true ratio.
    state.photoWidth = w;
    state.photoHeight = h;
    cameraPhoto.src = dataUrl;
    cameraVideo.hidden = true;
    cameraPhoto.hidden = false;
    stopCameraStream();              // freeze + release the camera
    setCameraPhase(CAMERA_PHASE.CAPTURE_COMPLETE);
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

  // Upload the depositor's registration photo into their drawer's Drive folder
  // (so it persists like any other uploaded file, not just in-session). It is
  // an archive item like every other: its own record, its own description.
  const DEPOSITOR_PHOTO_NAME = "depositor-photo.jpg";
  const DEPOSITOR_PHOTO_DESCRIPTION = "דיוקן שצולם בעת ההפקדה";
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
          filename: DEPOSITOR_PHOTO_NAME,
          mimeType: mime,
          description: DEPOSITOR_PHOTO_DESCRIPTION,
          width: state.photoWidth || 0,
          height: state.photoHeight || 0,
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
    if (btnCameraNext.disabled ||
        screens.camera.dataset.cameraPhase !== CAMERA_PHASE.CAPTURE_COMPLETE ||
        !state.photoDataUrl) return;
    uploadDepositorPhoto();
    stopCameraStream();
    initEnvelopeTransition();
    setCameraPhase(CAMERA_PHASE.FINAL_BROWN_SCREEN);
    showScreen("envelope");
  });

  if (btnEnvelopeNext) {
    btnEnvelopeNext.addEventListener("click", () => {
      if (btnEnvelopeNext.disabled) return;
      btnEnvelopeNext.disabled = true;   // the spread cannot be triggered twice
      // Measure the stack while it is still the thing on screen.
      captureStackSource();
      renderLandingDrawers();
      const sess = getSession();
      if (sess && sess.code) {
        openOwnDrawer(sess);
      } else {
        // No archive to spread into — never let the measurement go stale.
        pendingStackSource = null;
        showScreen("landing");
      }
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
  // The archive's own surface belongs in this list too: it is uncovered by the
  // stack → archive spread, and decoding it on the first frame of that spread
  // stalls rendering long enough to hold every paper still at the stack.
  ["images/figma-archive-search-card-v2.jpg",
   "images/figma-archive-add-card-v2.jpg",
   "images/figma-personal-archive-background.jpg",
   "images/figma-stamp-background.jpg",
   "images/paperboard-texture.jpg"].forEach(src => {
    const im = new Image();
    im.src = src;
    if (im.decode) im.decode().catch(() => {});
  });

  // Personal-archive state. The scattered pile is built from THIS depositor's
  // own materials: their answered question cards plus their photos/videos.
  //
  // The archive is a LIST of items, not a set of slots keyed by file type. Each
  // item is one uploaded file with its own id, url, filename, type, description,
  // timestamp and (for images) pixel size — so a drawer can hold any number of
  // photos, and each photo keeps the description that was written for it.
  //
  //   ArchiveItem = { id, fileUrl, fileName, fileType, mimeType,
  //                   description, createdAt, width, height, own?, uploading? }
  let currentDrawerCode = "";
  let pileCardData = null;      // the 7 question cards' data for the open drawer
  let archiveItems = [];        // saved items for this drawer (backend + own photo)
  let pendingArchiveItems = []; // optimistic just-uploaded items, until the reload
  let pendingUploadMetadata = null;
  let archiveTransitionRun = 0;

  // ============================================================
  // Centred stack → personal archive (Figma 751:305)
  // ============================================================
  // The archive is not a second screen that fades in: it is the same sheets the
  // user just watched gather into the middle of the stamping screen, carried
  // outward to their places. Before the screen swaps we MEASURE each of those
  // sheets (FLIP): its real on-screen centre, rotation and visual width, then
  // express them in the archive's own 1920×1080 design space. Because both ends
  // of the motion live in that space, the spread stays correct at any viewport
  // size and survives a later re-render.
  //
  // EVERY sheet in the stack is measured and every one of them travels. Six take
  // the places Figma 751:305 gives them (the answer sheets for questions 1, 2
  // and 6, the legacy page, the portrait and the stamping instructions); the
  // other five have no place in that composition, so they are carried off the
  // surface instead — still the same sheets, still moving, never faded out.
  let pendingStackSource = null;      // measured geometry, awaiting the next open
  let stackSourceGeometry = null;     // geometry in use by the current spread
  let archivePhase = "idle";          // "stack" → "spreading" → "open"
  let pendingPileRender = false;      // a re-render asked for mid-spread
  // Longest delay + duration in the spread table below. Used only to size the
  // guard timer, never as the thing that decides the papers have landed.
  const ARCHIVE_SPREAD_MS = 1440;

  function archiveSceneScale() {
    return Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  }

  // Visual rotation/scale of an element, however it was expressed: the `transform`
  // matrix and the independent `rotate`/`scale` properties (the stack uses both).
  function elVisualTransform(el) {
    const cs = window.getComputedStyle(el);
    let a = 1, b = 0;
    const m = cs.transform;
    if (m && m !== "none") {
      const nums = m.slice(m.indexOf("(") + 1, -1).split(",").map(parseFloat);
      if (nums.length >= 6 && !isNaN(nums[0]) && !isNaN(nums[1])) { a = nums[0]; b = nums[1]; }
    }
    let rot = Math.atan2(b, a) * 180 / Math.PI;
    let scale = Math.hypot(a, b) || 1;
    const ownRot = parseFloat(cs.rotate);
    if (!isNaN(ownRot)) rot += ownRot;
    const ownScale = parseFloat(cs.scale);
    if (!isNaN(ownScale) && ownScale) scale *= ownScale;
    return { rot, scale };
  }

  // One measured source, in 1920×1080 design units — the same units the archive
  // destinations are written in, so the delta between them is scale-independent.
  function measureArchiveSource(el) {
    if (!el || !el.offsetWidth) return null;
    const scale = archiveSceneScale();
    if (!scale) return null;
    const rect = el.getBoundingClientRect();
    const t = elVisualTransform(el);
    return {
      cx: ((rect.left + rect.right) / 2 - window.innerWidth / 2) / scale + 960,
      cy: ((rect.top + rect.bottom) / 2 - window.innerHeight / 2) / scale + 540,
      w: (el.offsetWidth * t.scale) / scale,
      r: t.rot
    };
  }

  function captureStackSource() {
    pendingStackSource = null;
    if (!stampInstructionsPile) return;
    const geo = {};
    // Every sheet on the stack, without exception — each one is a paper that
    // has to travel, so each one needs its true starting geometry.
    stampInstructionsPile.querySelectorAll(".stack-transition-sheet").forEach(sheet => {
      const m = measureArchiveSource(sheet);
      if (m) geo["sheet:" + (sheet.dataset.sheet || "")] = m;
    });
    const photo = measureArchiveSource(document.querySelector(".stamp-instructions-photo"));
    if (photo) geo.photo = photo;
    const instructions = measureArchiveSource(envelopeTransition);
    if (instructions) geo.instructions = instructions;
    pendingStackSource = geo;
  }

  function setArchivePhase(phase) {
    archivePhase = phase;
    if (archiveBox) archiveBox.dataset.archivePhase = phase;
  }

  // Resolves when the last paper has actually finished travelling. A CSS
  // animation's clock does not start when the class is added — it starts on the
  // first frame the browser manages to composite, and this screen's first frame
  // is an expensive one (full-viewport paper textures). So the wait is on the
  // animation's own `finished`, which is immune to that shift; a plain elapsed
  // timer would hand the archive over mid-flight and snap the papers into place.
  // The timeout is only a guard against an animation that never resolves.
  function whenPapersHaveLanded(el) {
    const guard = new Promise(resolve => window.setTimeout(resolve, ARCHIVE_SPREAD_MS + 2000));
    if (!el || !el.getAnimations) return guard;
    const running = el.getAnimations().filter(a => a.animationName === "archive-paper-spread");
    if (!running.length) return guard;
    return Promise.race([
      Promise.all(running.map(a => a.finished)).catch(() => {}),
      guard
    ]);
  }

  // A re-render (an upload landing, a resize) must never restart a spread in
  // flight: hold it until every paper has arrived, then rebuild once.
  function requestArchivePileRender() {
    if (archivePhase === "spreading") { pendingPileRender = true; return; }
    renderArchivePile();
  }

  // One reusable hidden file input drives all drawer uploads.
  //
  // The description is bound to the file HERE, at the moment the file is
  // chosen, and then travels down the upload chain as an argument. It used to
  // be read off a module-level `pendingUploadMetadata` at POST time, several
  // async hops later — so a second pick starting before the first POST landed
  // could hand its description to the wrong file. Nothing downstream reads the
  // shared slot any more.
  const uploadInput = document.createElement("input");
  uploadInput.type = "file";
  uploadInput.multiple = true;
  uploadInput.style.display = "none";
  document.body.appendChild(uploadInput);
  uploadInput.addEventListener("change", () => {
    const files = Array.from(uploadInput.files || []);
    const meta = pendingUploadMetadata || { description: "", format: "" };
    pendingUploadMetadata = null;
    uploadInput.value = ""; // let the same file be re-picked later
    // Nothing chosen (the picker was dismissed) is not a batch and not a
    // success — there is nothing to confirm.
    if (!files.length || !currentDrawerCode) return;
    closePersonalTool();
    const batch = beginUploadBatch(files.length);
    // One file, one archive item, carrying the description written for it.
    files.forEach(file => uploadFileToDrawer(file, currentDrawerCode, meta, batch));
  });

  // ---- upload batch -----------------------------------------------------
  // What "the upload succeeded" actually means here. The POST is fire-and-
  // forget into Apps Script and its response is not CORS-readable, so a
  // resolved fetch proves only that the request left. The real proof is the
  // file coming BACK in the drawer's listing: renderDrawerFiles already
  // matches each optimistic item to the saved record that replaced it, and
  // that match is what counts a file as done. So the window opens on the
  // file's arrival in the archive, never on a timer.
  //
  // A batch is one trip through the picker. It is settled only when every file
  // in it is confirmed; a single failure settles it as failed and it is never
  // celebrated. Settling clears it, so one completed batch opens the window
  // exactly once and the next batch starts clean.
  let uploadBatchSeq = 0;
  let activeUploadBatch = null;

  function beginUploadBatch(expected) {
    if (activeUploadBatch) window.clearTimeout(activeUploadBatch.guard);
    const batch = {
      id: ++uploadBatchSeq,
      expected: expected,
      confirmed: 0,
      failed: false,
      settled: false,
      pending: new Set()   // ids of this batch's items still awaiting the backend
    };
    // An upload that never comes back must not leave the batch open forever:
    // it is abandoned quietly (no window), so a later batch can still succeed.
    batch.guard = window.setTimeout(() => failUploadBatch(batch), 90000);
    activeUploadBatch = batch;
    return batch;
  }

  function failUploadBatch(batch) {
    if (!batch || batch.settled) return;
    batch.failed = true;
    settleUploadBatch(batch);
  }

  function settleUploadBatch(batch) {
    batch.settled = true;
    window.clearTimeout(batch.guard);
    if (activeUploadBatch === batch) activeUploadBatch = null;
  }

  // Drive can take longer than the first 4-second look to publish a file, and
  // one listing that came back too early must not be mistaken for a failure.
  // While a batch still has files outstanding, keep asking — the batch's own
  // guard is what eventually gives up, so this cannot poll forever.
  let awaitUploadsTimer = 0;
  function awaitRemainingUploads() {
    const batch = activeUploadBatch;
    window.clearTimeout(awaitUploadsTimer);
    if (!batch || batch.settled || !batch.pending.size || !currentDrawerCode) return;
    awaitUploadsTimer = window.setTimeout(() => {
      if (activeUploadBatch === batch && !batch.settled) loadDrawerFiles(currentDrawerCode);
    }, 3500);
  }

  // One file of a batch has been confirmed saved by the backend.
  function confirmUploadBatchItem(id) {
    const batch = activeUploadBatch;
    if (!batch || batch.settled || !batch.pending.has(id)) return;
    batch.pending.delete(id);
    batch.confirmed++;
    if (batch.failed || batch.confirmed < batch.expected) return;
    settleUploadBatch(batch);
    openUploadSuccess();   // every file in, and only now
  }

  // A locally-minted id for an item that has not been saved yet. Once the
  // backend listing comes back the saved record replaces it, keyed by Drive id.
  let localItemSeq = 0;
  function newLocalItemId() {
    return "local-" + Date.now().toString(36) + "-" + (++localItemSeq);
  }

  // ---- EXIF orientation -------------------------------------------------
  // Phone photos carry an orientation tag instead of rotated pixels. Only the
  // images whose metadata actually asks for a correction are re-encoded; an
  // already-upright file is uploaded byte-for-byte as the user chose it.

  // Reads the orientation tag AND the stored (unrotated) pixel size from the
  // SOF header. The stored size is what tells us, further down, whether the
  // browser's decoder already honoured the tag — without it we would have to
  // guess, and guessing wrong rotates a photograph twice.
  function readJpegMeta(buffer) {
    const meta = { orientation: 1, width: 0, height: 0 };
    try {
      const view = new DataView(buffer);
      if (view.byteLength < 4 || view.getUint16(0) !== 0xFFD8) return meta;
      let offset = 2;
      while (offset + 4 <= view.byteLength) {
        const marker = view.getUint16(offset);
        if ((marker & 0xFF00) !== 0xFF00) break;
        const size = view.getUint16(offset + 2);
        if (!size) break;
        if (marker === 0xFFE1 && view.getUint32(offset + 4) === 0x45786966) {   // "Exif"
          const tiff = offset + 10;
          const little = view.getUint16(tiff) === 0x4949;
          const ifd = tiff + view.getUint32(tiff + 4, little);
          const count = view.getUint16(ifd, little);
          for (let i = 0; i < count; i++) {
            const entry = ifd + 2 + i * 12;
            if (view.getUint16(entry, little) === 0x0112) {                     // Orientation
              meta.orientation = view.getUint16(entry + 8, little) || 1;
              break;
            }
          }
        } else if (marker >= 0xFFC0 && marker <= 0xFFCF &&
                   marker !== 0xFFC4 && marker !== 0xFFC8 && marker !== 0xFFCC) {
          meta.height = view.getUint16(offset + 5);   // SOFn: precision, height, width
          meta.width  = view.getUint16(offset + 7);
          break;                                      // SOF follows APP1; done
        }
        offset += 2 + size;
      }
    } catch (err) { /* unreadable metadata — treat as upright */ }
    return meta;
  }

  // Decode an image with its EXIF orientation already applied, so the bitmap's
  // width/height are the dimensions the user actually sees.
  function decodeUpright(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: "from-image" })
        .catch(() => decodeUprightViaImg(file));
    }
    return decodeUprightViaImg(file);
  }

  // Fallback for browsers without createImageBitmap's imageOrientation option.
  // An <img> has applied the tag itself for years, so this is normally upright
  // too; where it is not, prepareUpload detects it from the stored dimensions.
  function decodeUprightViaImg(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode failed")); };
      img.src = url;
    });
  }

  // Draw `source` upright on a canvas. `orientation` is only applied when the
  // source still needs it (the createImageBitmap path has already applied it).
  function drawUpright(source, orientation, applyTransform) {
    const w = source.naturalWidth || source.width;
    const h = source.naturalHeight || source.height;
    const swap = applyTransform && orientation >= 5 && orientation <= 8;
    const canvas = document.createElement("canvas");
    canvas.width = swap ? h : w;
    canvas.height = swap ? w : h;
    const ctx = canvas.getContext("2d");
    if (applyTransform) {
      switch (orientation) {
        case 2: ctx.transform(-1, 0, 0, 1, w, 0); break;
        case 3: ctx.transform(-1, 0, 0, -1, w, h); break;
        case 4: ctx.transform(1, 0, 0, -1, 0, h); break;
        case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;
        case 6: ctx.transform(0, 1, -1, 0, h, 0); break;
        case 7: ctx.transform(0, -1, -1, 0, h, w); break;
        case 8: ctx.transform(0, -1, 1, 0, 0, w); break;
      }
    }
    ctx.drawImage(source, 0, 0);
    return canvas;
  }

  // Resolve to { dataUrl, mimeType, filename, width, height } for one picked
  // file. Non-images and upright images pass through untouched — only their
  // pixel size is measured, so the archive can lay them out at their true
  // proportions.
  function prepareUpload(file) {
    const asIs = (extra) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(Object.assign({
        dataUrl: String(reader.result || ""),
        mimeType: file.type || "application/octet-stream",
        filename: file.name || "file",
        width: 0, height: 0
      }, extra || {}));
      reader.onerror = () => reject(new Error("read failed"));
      reader.readAsDataURL(file);
    });

    if ((file.type || "").indexOf("image/") !== 0) return asIs();

    return file.arrayBuffer().then(buffer => {
      const meta = readJpegMeta(buffer);
      return decodeUpright(file).then(source => {
        const dw = source.naturalWidth || source.width;
        const dh = source.naturalHeight || source.height;

        // No tag, or a tag that asks for nothing: the file is already upright.
        // Upload the user's own bytes, untouched — only measure them.
        if (meta.orientation <= 1) {
          if (source.close) source.close();
          return asIs({ width: dw, height: dh });
        }

        // Every decoder in use applies the tag itself, so `source` is normally
        // already upright and only needs re-encoding to make that permanent.
        // The one case we can PROVE otherwise is a quarter-turn tag that came
        // back with the stored dimensions unswapped — then, and only then, is
        // the rotation ours to apply. Anything we cannot prove is left alone,
        // because rotating an upright photograph is the worse failure.
        const quarterTurn = meta.orientation >= 5 && meta.orientation <= 8;
        const decoderIgnoredTag = quarterTurn && !!meta.width && !!meta.height &&
                                  dw === meta.width && dh === meta.height;
        const canvas = drawUpright(source, meta.orientation, decoderIgnoredTag);
        if (source.close) source.close();
        return {
          dataUrl: canvas.toDataURL("image/jpeg", 0.92),
          mimeType: "image/jpeg",
          filename: file.name || "file",
          width: canvas.width,
          height: canvas.height
        };
      });
    }).catch(() => asIs());
  }

  // Upload one file into the drawer's Drive folder (fire-and-forget POST, like
  // submitToSheet — the response isn't CORS-readable), then refresh the archive
  // via the JSONP "files" listing. One call = one new archive item; an upload
  // never touches an item that already exists.
  function uploadFileToDrawer(file, code, meta, batch) {
    if (!SHEET_WEBHOOK_URL) { failUploadBatch(batch); return; }
    const description = (meta && meta.description) || "";
    const format = (meta && meta.format) || "";
    prepareUpload(file).then(prepared => {
      const dataUrl = prepared.dataUrl;
      // Optimistic: show this file, with its own description, straight away.
      // Its id is what the batch waits on — the same id renderDrawerFiles
      // retires once the backend hands the saved record back.
      const localId = showLocalItem(prepared, description);
      if (batch && !batch.settled) batch.pending.add(localId);
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
            filename: prepared.filename,
            mimeType: prepared.mimeType,
            description: description,
            requestedFormat: format,
            width: prepared.width,
            height: prepared.height,
            data: base64
          })
        // The request never leaving the browser is a failure outright; there is
        // nothing to confirm and the batch must not celebrate.
        }).catch(() => failUploadBatch(batch));
      } catch (err) { failUploadBatch(batch); }
      // No readable response — give Drive a moment, then reload the listing.
      // The listing is what confirms the file, and it keeps being asked for
      // until this file is accounted for or the batch's guard gives up.
      setTimeout(() => loadDrawerFiles(code), 4000);
    }).catch(() => { failUploadBatch(batch); loadDrawerFiles(code); });
  }

  // Drop a just-uploaded file straight onto the pile (before the Drive
  // round-trip finishes), dimmed until the archive reloads from the backend.
  // Append semantics: previous items + this one, never a replacement.
  function showLocalItem(prepared, description) {
    const id = newLocalItemId();
    pendingArchiveItems = pendingArchiveItems.concat([{
      id: id,
      fileUrl: prepared.dataUrl,
      fileName: prepared.filename,
      fileType: (prepared.mimeType || "").indexOf("video/") === 0 ? "video"
              : (prepared.mimeType || "").indexOf("image/") === 0 ? "image" : "other",
      mimeType: prepared.mimeType,
      description: description,
      createdAt: new Date().toISOString(),
      width: prepared.width,
      height: prepared.height,
      uploading: true
    }]);
    requestArchivePileRender();
    return id;
  }

  // Fetch the drawer's archive items via JSONP and render them.
  function loadDrawerFiles(code) {
    if (!code || !SHEET_WEBHOOK_URL) return;
    const cbName = "__wrFilesCb" + Date.now();
    let s;
    window[cbName] = function(res) {
      renderDrawerFiles((res && (res.items || res.files)) ? (res.items || res.files) : []);
      delete window[cbName];
      if (s && s.remove) s.remove();
    };
    s = document.createElement("script");
    s.src = SHEET_WEBHOOK_URL + "?action=files&callback=" + cbName +
            "&code=" + encodeURIComponent(code) + "&t=" + Date.now();
    s.onerror = function() { delete window[cbName]; if (s && s.remove) s.remove(); };
    document.body.appendChild(s);
  }

  // One backend record → one archive item. Records saved before this change
  // carry no description, createdAt or pixel size; they are normalized here
  // rather than skipped, so nothing a user ever uploaded disappears.
  function normalizeArchiveItem(rec) {
    const fileId = String(rec.fileId || rec.id || "");
    return {
      id: String(rec.id || fileId),
      fileUrl: "https://drive.google.com/thumbnail?id=" + fileId + "&sz=w1000",
      fileName: String(rec.name || rec.fileName || ""),
      fileType: rec.type || ((rec.mime || "").indexOf("video/") === 0 ? "video"
                          : (rec.mime || "").indexOf("image/") === 0 ? "image" : "other"),
      mimeType: String(rec.mime || rec.mimeType || ""),
      description: String(rec.description || ""),
      createdAt: String(rec.createdAt || ""),
      width: Number(rec.width) || 0,
      height: Number(rec.height) || 0
    };
  }

  function renderDrawerFiles(records) {
    const saved = (records || []).map(normalizeArchiveItem);
    // The session-only registration portrait is kept in front until the copy
    // uploaded to Drive comes back, so it is never shown twice.
    const savedNames = saved.map(x => x.fileName);
    const own = archiveItems.filter(m => m.own && savedNames.indexOf(m.fileName) < 0);
    archiveItems = own.concat(saved);
    // An optimistic item is dropped once ITS saved record has arrived — matched
    // one-for-one, so two uploads of the same file with the same description do
    // not cancel each other. The rest stay on the pile: an upload still in
    // flight must never blink out of the archive.
    const unclaimed = saved.slice();
    const confirmedIds = [];
    pendingArchiveItems = pendingArchiveItems.filter(p => {
      const idx = unclaimed.findIndex(s =>
        s.fileName === p.fileName && s.description === p.description);
      if (idx < 0) return true;
      // The saved record IS the paper already on the desk; it takes over that
      // paper's identity rather than arriving as a new one.
      if (arrivedItemIds) arrivedItemIds.add(unclaimed[idx].id);
      unclaimed.splice(idx, 1);
      // This file is now in the archive for good — the one honest definition
      // of "uploaded successfully" this backend can give us.
      confirmedIds.push(p.id);
      return false;
    });
    requestArchivePileRender();
    confirmedIds.forEach(confirmUploadBatchItem);
    awaitRemainingUploads();
  }

  // Open a depositor's personal archive as a scattered pile of THEIR own
  // materials — the 7 answered question cards plus their photos/videos.
  // The card data is the drawer's own: own drawer uses live state, a DB
  // drawer uses answers fetched from the sheet (empty when unanswered, so we
  // never leak the logged-in user's answers into someone else's cards).
  function openDrawerInterior(viewer) {
    if (!viewer) return;
    if (archivePhase === "spreading") return;   // one spread at a time
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

    // Seed the archive with the depositor's own portrait — the photo taken
    // after the questions. It is uploaded to Drive at registration and comes
    // back as a normal archive item; this session copy only bridges the gap
    // until that listing arrives (see renderDrawerFiles, which drops it then).
    archiveItems = [];
    pendingArchiveItems = [];
    if ((viewer.isUser || ownerView) && state.photoDataUrl) {
      archiveItems.push({
        id: "own-portrait",
        fileUrl: state.photoDataUrl,
        fileName: DEPOSITOR_PHOTO_NAME,
        fileType: "image",
        mimeType: "image/jpeg",
        description: DEPOSITOR_PHOTO_DESCRIPTION,
        createdAt: new Date(0).toISOString(),   // taken before anything uploaded
        width: state.photoWidth || 0,
        height: state.photoHeight || 0,
        own: true
      });
    }

    // Hand over whatever the stamping screen measured on its way out. Only that
    // route arrives with a stack behind it, so only that route cuts straight in
    // (no screen fade) and keeps the stamping surface under the papers — both
    // are what make the swap invisible and the papers read as the same papers.
    stackSourceGeometry = pendingStackSource;
    pendingStackSource = null;
    if (screens.personal) screens.personal.classList.toggle("is-from-stack", !!stackSourceGeometry);

    // An upload still in flight belongs to the drawer that was left behind.
    // Abandon it rather than let its confirmation surface over a drawer the
    // user has since opened; the file itself is unaffected and still arrives.
    failUploadBatch(activeUploadBatch);
    closeUploadSuccess();
    // A search belongs to the drawer it was asked of; opening another one puts
    // the archivist back to the beginning rather than carrying a result over.
    botRequestRun++;
    setBotState("initial");

    pendingPileRender = false;
    arrivedItemIds = null;   // a freshly opened drawer arrives whole, not "new"
    setArchivePhase("stack");
    renderArchivePile();
    loadDrawerFiles(currentDrawerCode); // append this drawer's Drive materials
    showScreen("personal");
    runArchiveOpeningTransition();
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

  function archiveStampInstructionsHTML() {
    return '<article class="archive-stamp-sheet">' +
      '<div class="archive-stamp-code">' + esc(pileCodeLabel()) + '</div>' +
      '<div class="archive-stamp-copy">' +
        '<p>קח מעטפה חומה מהערימה והחתם אותה עם החותמת שנמצאת על השולחן. המספר שהוחתם וכתוב על המסך זהו קוד הגישה שלך לארכיון שיצרת.</p>' +
        '<p>תוכל לשתף קוד זה בעתיד עם כל אדם שתרצה שיהיה חשוף לחומרים שהכנסת או תכניס לארכיון.</p>' +
        '<p>באפשרותך להתחבר לארכיון האישי שלך בעתיד באמצעות המייל שלך וקוד זה כדי להוסיף חומרים משלך לארכיון.</p>' +
      '</div>' +
      '<img class="archive-stamp-next" src="images/next-default.png" alt="" aria-hidden="true">' +
    '</article>';
  }

  // stack → spreading → personalArchive. The papers are already mounted at the
  // stack's exact positions (renderArchivePile wrote every --from-* from the
  // measurement), so one committed frame of "stack" is enough for the screen
  // swap to be invisible; then they travel, staggered, to the Figma layout.
  function runArchiveOpeningTransition() {
    if (!archiveBox) return;
    const run = ++archiveTransitionRun;
    archiveBox.classList.remove("is-archive-spreading", "is-archive-open");
    setArchivePhase("stack");
    void archiveBox.offsetWidth;   // commit the stack frame before anything moves
    const last = archivePile ? archivePile.querySelector('[data-spread-last="1"]') : null;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (run !== archiveTransitionRun) return;
      setArchivePhase("spreading");
      archiveBox.classList.add("is-archive-spreading");
      if (reduceMotion) { finishArchiveSpread(run); return; }
      // The last paper to land ends the phase — not a guessed clock.
      whenPapersHaveLanded(last).then(() => finishArchiveSpread(run));
    }));
  }

  function finishArchiveSpread(run) {
    if (run !== archiveTransitionRun || !archiveBox) return;
    archiveBox.classList.remove("is-archive-spreading");
    archiveBox.classList.add("is-archive-open");
    setArchivePhase("open");
    // The sheets that travelled off the surface have finished travelling; they
    // are outside the frame now, so the DOM can let them go.
    if (archivePile) {
      archivePile.querySelectorAll(".pile-item--exit").forEach(el => el.remove());
    }
    if (pendingPileRender) { pendingPileRender = false; renderArchivePile(); }
  }

  // Proportions an image reported for itself once it had loaded, kept by item id
  // so a reload from the backend does not throw the measurement away. The
  // recorded pixel size is authoritative when there is one; this fills the gap
  // for everything uploaded before that was recorded.
  const learnedPhotoSizes = Object.create(null);
  let learnPhotoRender = 0;

  // An image knows its own shape. Take it, and rebuild the pile once so the
  // frame matches the picture instead of the drawn placeholder ratio.
  function learnPhotoSize(id, width, height) {
    if (!id || !width || !height) return;
    const known = learnedPhotoSizes[id];
    if (known && known.width === width && known.height === height) return;
    learnedPhotoSizes[id] = { width: width, height: height };
    // Several prints usually land together — coalesce them into one rebuild.
    window.clearTimeout(learnPhotoRender);
    learnPhotoRender = window.setTimeout(requestArchivePileRender, 40);
  }

  // Every item this drawer holds, in one consistent order — oldest first — used
  // by both the scattered pile and anything else that lists the archive.
  function sortedArchiveItems() {
    return archiveItems.concat(pendingArchiveItems)
      .map(item => {
        const learned = learnedPhotoSizes[item.id];
        return (learned && !(item.width > 0 && item.height > 0))
          ? Object.assign({}, item, learned)
          : item;
      })
      .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  }

  // Which archive items were already on the desk at the last render. A rebuild
  // must never look like the archive starting over: everything that was here
  // stays, and only a genuinely new print is animated in.
  let arrivedItemIds = null;

  function renderArchivePile() {
    if (!archivePile) return;
    // The pile is a desk of photographs. A document the depositor filed —
    // a Google Doc, a PDF, a recording — is kept in the drawer and listed by
    // the backend, but it is not a print and has no print's place here; Drive
    // renders it as a page of grey text that reads as a blank sheet. Only the
    // pictures (and the videos, which are shown as their own frame) are laid out.
    const media = sortedArchiveItems().filter(
      it => it.fileType === "image" || it.fileType === "video");
    const nextArrivedItemIds = new Set();
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

    // Figma 751:305, direct-layer order. Each visible material has one explicit
    // destination and one matching source in the completed collection pile.
    //
    // Every centre and rotation below is read straight off the node. Each paper
    // is authored there as a portrait frame turned about -90°, so its landscape
    // rotation is (figma angle + 90): 751:192 -109.59 → -19.59, 751:217 -86.43
    // → 3.57, 751:242 -100.92 → -10.92, 751:267 -85.65 → 4.35, 751:291 -98.64 →
    // -8.64, 751:294 -96.03 → -6.03. Centres are the rotation wrapper's AABB
    // centre (left + w/2, top + h/2).
    //
    // `src` names the stack sheet this paper IS (measured live, see
    // captureStackSource); `from` is the fallback source used when the archive
    // is opened without coming through the stack — a drawer browsed from the
    // landing, where there is no pile on screen to measure.
    //
    // `z` is the sheet's depth in the CENTRAL STACK, not its Figma index. The
    // two orders happen to agree (0 < 1 < 5 < legacy < photo < instructions in
    // both), so one set of values keeps the pile stacked correctly while the
    // papers are still bunched in the middle AND lands on the Figma layering —
    // no re-ordering mid-flight, no clipping as they slide past each other.
    //
    // `spread` is the hand-across-the-table motion, in the project's existing
    // paper language (stack-sheet-arrive): the top of the pile leaves first,
    // each paper gets its own duration, easing, curved path and small landing
    // overshoot, and the starts overlap so several are always in the air.
    const E_SETTLE  = "cubic-bezier(0.22, 0.04, 0.18, 1)";
    const E_GLIDE   = "cubic-bezier(0.34, 0.02, 0.2, 1)";
    const E_DRIFT   = "cubic-bezier(0.28, 0.08, 0.24, 1)";
    const E_RELEASE = "cubic-bezier(0.4, 0.05, 0.16, 1)";
    const sceneScale = archiveSceneScale();
    // `open` is where this paper goes when a tool sheet is brought forward and
    // the pile opens across the desk. Both destinations are explicit for every
    // paper — `search` from Figma 507:382, `add` from Figma 508:553 — each read
    // off that frame's rotation wrapper (AABB centre, angle + 90 for the sheets
    // authored portrait). `lead` is how far ahead of the bottom sheet it starts
    // and how long it takes; the top of the pile leaves first, by tens of a
    // second, so the whole stack is seen to unfold.
    //
    // 507:382 has more materials scattered than this pile holds, so each paper
    // takes the slot of its own kind: the question sheets and the stamping page
    // take A6 slots 507:438 / 507:411 / 507:467 / 507:503 / 507:466, the print
    // takes photo slot 507:494. 508:553 scatters only four, so two sheets have
    // no counterpart there and are carried past the nearest free edge instead,
    // cropped by it exactly as that frame crops its own outer papers — the
    // composition that stays on screen is the frame's.
    const docLayout = [
      { cx: 934.797, cy: 704.129, w:1370, r:-19.590, z:2, dataIndex:0, opacity:.90, shadow:"0 -4px 4px rgba(0,0,0,.25)",
        src:"sheet:0", from:{cx:977.000,cy:494.559,w:814,r:4.74},
        spread:{ delay:520, dur:920, ease:E_SETTLE, arc:-1, over:-0.5 },
        open:{ search:{cx: 364.05, cy: 112.56, r: 2.98},   // 507:438 "A6 - 3"
               add:   {cx: 735.86, cy: 143.11, r: 2.32},   // 519:449
               lead:200, dur:940 } },
      { cx: 751.834, cy: 718.205, w:1370, r:  3.570, z:3, dataIndex:1, opacity:.90, shadow:"0 -4px 4px rgba(0,0,0,.25)",
        src:"sheet:1", from:{cx:1084.747,cy:537.532,w:1370,r:-5.28},
        spread:{ delay:450, dur:900, ease:E_GLIDE, arc:1, over:0.45 },
        open:{ search:{cx:1039.51, cy: 249.66, r:-0.30},   // 507:411 "A6 - 7"
               add:   {cx: 238.38, cy:1135.78, r:-9.62},   // 508:674 "A6 - 1"
               lead:160, dur:900 } },
      { cx:1127.374, cy: 804.483, w:1370, r:-10.920, z:7, dataIndex:5, opacity:.80, shadow:"0 -4px 4px rgba(0,0,0,.25)",
        src:"sheet:5", from:{cx:905.421,cy:573.182,w:1370,r:5.95},
        spread:{ delay:250, dur:880, ease:E_RELEASE, arc:-1, over:-0.35 },
        open:{ search:{cx: 960.04, cy: 834.68, r:-1.30},   // 507:467 "A6 - 2"
               add:   {cx:2100.00, cy: 900.00, r:-9.40},   // no slot in 508:553
               lead:120, dur:880 } },
      { cx: 862.766, cy: 869.046, w:1370, r:  4.350, z:9, dataIndex:7, opacity:.90, shadow:"0 4px 5px rgba(0,0,0,.25)",
        src:"sheet:legacy", from:{cx:1038.191,cy:619.008,w:1370,r:-18.40},
        spread:{ delay:150, dur:940, ease:E_DRIFT, arc:1, over:0.4 },
        open:{ search:{cx:1409.32, cy:1408.14, r:-9.62},   // 507:503 "A6 - 1"
               add:   {cx: 700.00, cy:1480.00, r: 4.10},   // no slot in 508:553
               lead:80, dur:920 } }
    ];
    // The print from Figma 751:291 — the first photograph's place on the desk,
    // and the one paper of the set that is FLIP-linked to the portrait measured
    // on the stamping screen (`src:"photo"`).
    const firstPhotoSlot = () => ({
      cx:735.338, cy:873.050, w:1139.487, h:737.315, r:-8.640, z:10,
      src:"photo", from:{cx:938.504,cy:612.497,w:1139.487,r:-10.77}, fallback:"images/figma-photo-wide.png",
      spread:{ delay:70, dur:900, ease:E_GLIDE, arc:-1, over:-0.45 },
      open:{ search:{cx:1433.03, cy: 841.58, r: 28.78},  // 507:494 "IMG_6898 2"
             add:   {cx:1319.74, cy: 444.24, r:  9.75},  // 508:554 "IMG_6898 1"
             lead:40, dur:860 } });

    // Figma composes ONE print, because the drawer it was drawn from held one.
    // A drawer holds as many as its depositor puts in it, so every further
    // photograph gets a place of its own on the same desk rather than taking
    // the first one's: laid around the pile on a golden-angle ring, each with
    // its own size, rotation, depth and travel. Deterministic in the item's
    // index, so a print keeps its place across re-renders and reloads.
    // The ring sits high on the desk: the stamping sheet fills the lower middle
    // (its own Figma place, untouched), and a print whose description landed
    // under it would be a description the page does not actually show. Above it
    // the prints lie over the question sheets, where both read.
    const PHOTO_EASES = [E_GLIDE, E_SETTLE, E_DRIFT, E_RELEASE];
    function extraPhotoSlot(index) {
      const seed = 300 + index * 13;
      const angle = (index * 137.508 + 26) * Math.PI / 180;   // golden angle
      const rx = 520 + pileRand(seed) * 230;
      const ry = 190 + pileRand(seed + 1) * 130;
      const cx = 960 + Math.cos(angle) * rx;
      const cy = 430 + Math.sin(angle) * ry;
      const r  = (pileRand(seed + 2) - 0.5) * 32;
      // Carried out past its own resting place when a tool sheet comes forward,
      // in the same direction it already leans — the scatter the frame shows.
      const outward = (factor) => ({
        cx: 960 + (cx - 960) * factor,
        cy: 430 + (cy - 430) * factor,
        r: r * 1.35
      });
      return {
        // Above the first print, always below the stamping sheet (z 20), so a
        // drawer with many prints never buries the instructions.
        cx: cx, cy: cy, r: r, z: 11 + Math.min(index, 8),
        // A print that arrives after the spread has nothing measured behind it;
        // it comes from where the stack stood, like every other late paper.
        from: { cx: 960 + (pileRand(seed + 3) - 0.5) * 260,
                cy: 560 + (pileRand(seed + 4) - 0.5) * 180,
                w: 620, r: (pileRand(seed + 5) - 0.5) * 30 },
        // Well under the Figma print, so the composition it was drawn for still
        // reads as the composition and the question sheets stay visible behind;
        // varied a little so the desk is a scatter, not a grid.
        area: 1139.487 * 737.315 * (0.19 + pileRand(seed + 6) * 0.09),
        w: 470, h: 313,   // replaced per item by its true proportions
        spread: { delay: 90 + (index % 5) * 60, dur: 860 + (index % 3) * 40,
                  ease: PHOTO_EASES[index % PHOTO_EASES.length],
                  arc: index % 2 ? 1 : -1, over: (pileRand(seed + 7) - 0.5) * 0.9 },
        open: { search: outward(1.85), add: outward(2.1), lead: 40 + (index % 4) * 30, dur: 860 }
      };
    }

    // One slot per archive item — never one slot re-used by whichever file
    // happened to arrive last.
    function buildPhotoSlots(count) {
      const slots = [firstPhotoSlot()];
      for (let i = 1; i < count; i++) slots.push(extraPhotoSlot(i));
      return slots;
    }

    // The frame this item is laid in, at ITS OWN proportions. The archive
    // decides how big a print is; the picture decides its shape. Portrait stays
    // portrait, landscape stays landscape, and nothing is squeezed to fit a
    // rectangle drawn before the picture existed. Items whose pixel size we do
    // not know (uploaded before this was recorded) keep the design frame and
    // are letterboxed inside it by object-fit: contain — never cropped.
    // Figma 480:8191: `border-18`. The same 18 on 751:291, the pile's own
    // print — the matte is one thickness across the whole archive.
    const PHOTO_MATTE = 18;
    const PHOTO_MAX_W = 1240, PHOTO_MAX_H = 880;
    function photoFrameSize(item, slot) {
      const ratio = (item.width > 0 && item.height > 0) ? item.width / item.height : 0;
      if (!ratio) return { w: slot.w, h: slot.h };
      const area = slot.area || (1139.487 * 737.315);
      let w = Math.sqrt(area * ratio), h = Math.sqrt(area / ratio);
      // Scale down proportionally if the frame would outgrow the desk. Both
      // dimensions move by the same factor, so the ratio is untouched.
      const fit = Math.min(1, PHOTO_MAX_W / w, PHOTO_MAX_H / h);
      return { w: w * fit, h: h * fit };
    }

    // A print laid out at its own proportions can reach further than the
    // landscape one Figma drew — a tall portrait most of all. The desk does crop
    // its outer papers, but a picture that is mostly off it is not a picture the
    // archive is showing, so each print's centre is pulled back until no more
    // than a tenth of it hangs over an edge — the description under it included,
    // since a description that has slid off the desk is not a description the
    // page is showing. The frame is moved, never resized unevenly: proportions
    // are already settled by the time this runs.
    const PHOTO_OVERHANG = 0.1;
    function clampPhotoCentre(x, y, w, h, rot, hasCaption) {
      const rad = Math.abs(rot * Math.PI / 180);
      const cos = Math.cos(rad), sin = Math.sin(rad);
      // The whole paper, as the CSS builds it: `w` is the border-box width, so
      // the picture inside it is (w - 2 matte) across and keeps its ratio from
      // there; then the matte again below it, and the description under that.
      const boxW = w;
      const frameH = h * Math.max(w - 2 * PHOTO_MATTE, 1) / w;
      const boxH = frameH + 2 * PHOTO_MATTE +
                   (hasCaption ? PHOTO_MATTE + w * 0.114 : 0);   // ~2 caption lines
      const halfW = (boxW * cos + boxH * sin) / 2;
      const halfH = (boxW * sin + boxH * cos) / 2;
      const insetX = halfW * (1 - 2 * PHOTO_OVERHANG);
      const insetY = halfH * (1 - 2 * PHOTO_OVERHANG);
      const clamp = (v, lo, hi) => lo > hi ? (lo + hi) / 2 : Math.min(Math.max(v, lo), hi);
      return {
        x: clamp(x, insetX, 1920 - insetX),
        y: clamp(y, insetY, 1080 - insetY)
      };
    }
    const instructionLayout = {
      cx:1113.655, cy:1023.765, w:1243.756, r:-6.030, z:20,
      src:"instructions", from:{cx:955.100,cy:671.164,w:1370,r:15.86},
      spread:{ delay:0, dur:980, ease:E_SETTLE, arc:1, over:0.5 },
      open:{ search:{cx: -31.49, cy: 574.87, r:-2.88},     // 507:466
             add:   {cx:1825.29, cy: 750.23, r:-5.10},     // 508:673
             lead:0, dur:840 }
    };

    // The five stack sheets Figma 751:305 gives no place to. They are papers
    // like any other and they animate like any other — same keyframes, same
    // stagger, their own destination each — but their destination is off the
    // archive surface, carried out past the edge they already lean towards.
    // They are never faded and never cut: the composition that remains is
    // exactly the Figma one because these have physically left it.
    const exitLayout = [
      { sheet:"6",            cx: 470, cy:-820, w:1370, r:-24, z:8, dataIndex:6, opacity:.72,
        shadow:"0 -4px 4px rgba(0,0,0,.25)", from:{cx:883.200,cy:475.200,w:1370,r:15.86},
        spread:{ delay:200, dur:860, ease:E_GLIDE, arc:1, over:0 } },
      { sheet:"4",            cx: -700, cy:1180, w:1370, r: 21, z:6, dataIndex:4, opacity:.72,
        shadow:"0 -4px 4px rgba(0,0,0,.25)", from:{cx:787.200,cy:669.600,w:1370,r:-10.96},
        spread:{ delay:300, dur:840, ease:E_DRIFT, arc:-1, over:0 } },
      { sheet:"3",            cx:2760, cy: 960, w:1370, r:-26, z:5, dataIndex:3, opacity:.72,
        shadow:"0 -4px 4px rgba(0,0,0,.25)", from:{cx:1305.600,cy:604.800,w:1370,r:12.94},
        spread:{ delay:350, dur:880, ease:E_RELEASE, arc:1, over:0 } },
      { sheet:"2",            cx:-820, cy: 240, w:1370, r: 17, z:4, dataIndex:2, opacity:.72,
        shadow:"0 -4px 4px rgba(0,0,0,.25)", from:{cx:595.200,cy:550.800,w:1370,r:-3.39},
        spread:{ delay:400, dur:860, ease:E_SETTLE, arc:-1, over:0 } },
      { sheet:"registration", cx: 960, cy:1900, w:1370, r: 11, z:1, dataIndex:"registration", opacity:.72,
        shadow:"0 -4px 4px rgba(0,0,0,.25)", from:{cx:960.000,cy:540.000,w:1370,r:4.74},
        spread:{ delay:580, dur:840, ease:E_GLIDE, arc:1, over:0 } }
    ];

    const items = [];
    if (docCount) docLayout.forEach((slot, i) => items.push({ type:"doc", i:slot.dataIndex, slot, seed:i }));
    // One visual item per archive item, in the archive's own order. An empty
    // drawer still shows the Figma print, as decoration, exactly as before.
    buildPhotoSlots(Math.max(media.length, 1)).forEach((slot, i) => items.push({
      type:"media",
      m: media[i] || { id:"placeholder", fileUrl:slot.fallback, fileType:"image",
                       description:"", decorative:true },
      mediaIndex:i,
      slot,
      seed:20 + i
    }));
    items.push({ type:"instructions", slot:instructionLayout, seed:40 });
    // Only when there really is a stack behind us: these papers exist to carry
    // the rest of that stack away. Opened from the landing there is no stack, so
    // there is nothing extra on screen that needs carrying.
    if (stackSourceGeometry && docCount && archivePhase !== "open") {
      exitLayout.forEach((slot, i) => {
        slot.src = "sheet:" + slot.sheet;
        items.push({ type:"exit", i:slot.dataIndex, slot, seed:60 + i });
      });
    }

    // The paper that lands last ends the spread — its animationend is what
    // hands the archive over to the user (see runArchiveOpeningTransition).
    const spreadEndsAt = items.reduce((end, it) =>
      Math.max(end, it.slot.spread.delay + it.slot.spread.dur), 0);

    archivePile.innerHTML = "";
    items.forEach((it, k) => {
      const el = document.createElement("div");
      if (it.type === "doc" || it.type === "exit") {
        el.className = "pile-item pile-item--doc";
        // Per-sheet width from its size multiplier, so every sheet is a
        // different size (depth) while keeping the exact 1370×969 proportions.
        const docSlot = it.slot;
        const dwItem = docSlot.w * sceneScale;
        el.style.setProperty("--dw", dwItem + "px");
        // Unitless scale factor for .pile-doc's transform: scale() needs a
        // number, and calc() cannot divide a length by a length.
        el.style.setProperty("--pile-scale", (dwItem / 1370).toFixed(5));
        // The leaving sheets carry the very form they carried in the stack —
        // same component, same content, so nothing about a paper changes as it
        // travels. They are decoration on their way out: inert and unannounced.
        const form = it.i === "registration"
          ? stackRegistrationFormHTML()
          : (it.i === questions.length
              ? archiveLegacyFormHTML(pileCardData)
              : cardFormHTML(it.i, pileCardData));
        el.innerHTML = '<div class="pile-doc">' + form + "</div>";
        if (it.type === "exit") {
          el.classList.add("pile-item--exit");
          el.setAttribute("aria-hidden", "true");
        }
      } else if (it.type === "media") {
        el.className = "pile-item pile-item--photo";
        if (it.m.uploading) el.classList.add("is-uploading");
        // Stable per-item identity: this element IS this archive item, across
        // every re-render, so an upload adds a paper instead of recycling one.
        el.dataset.archiveItem = it.m.id || ("media-" + it.mediaIndex);
        const badge = it.m.fileType === "video" ? '<span class="pile-play" aria-hidden="true"></span>' : "";
        const desc = String(it.m.description || "").trim();
        // The description sits on the print it was written for, under it — the
        // archive never collects the descriptions somewhere else and hopes the
        // order still lines up.
        el.innerHTML =
          '<div class="pile-photo-frame">' +
            '<img loading="lazy" alt="' + escAttr(desc) + '" src="' + escAttr(it.m.fileUrl) + '">' +
            badge +
          '</div>' +
          (desc ? '<div class="pile-photo-caption">' + esc(desc) + '</div>' : '');
        // A picture whose pixel size was never recorded reports it here, the
        // moment it decodes, and the pile is rebuilt around its true shape.
        if (!(it.m.width > 0 && it.m.height > 0) && !it.m.decorative) {
          const img = el.querySelector("img");
          const measure = () => learnPhotoSize(it.m.id, img.naturalWidth, img.naturalHeight);
          if (img.complete && img.naturalWidth) measure();
          else img.addEventListener("load", measure, { once: true });
        }
        if (arrivedItemIds && !arrivedItemIds.has(el.dataset.archiveItem)) {
          el.classList.add("is-new-item");   // only the new print is announced
        }
        nextArrivedItemIds.add(el.dataset.archiveItem);
      } else {
        el.className = "pile-item pile-item--instructions";
        el.innerHTML = archiveStampInstructionsHTML();
        el.style.setProperty("--iw", (it.slot.w * sceneScale).toFixed(2) + "px");
      }
      if (it.type !== "instructions" && it.type !== "exit") el.classList.add("pile-item--breathing");
      const seed = it.seed != null ? it.seed : k;
      el.style.setProperty("--breathe-x", ((pileRand(seed + 31) > 0.5 ? 1 : -1) * (1 + pileRand(seed + 37) * 2)).toFixed(2) + "px");
      el.style.setProperty("--breathe-y", ((pileRand(seed + 41) > 0.5 ? 1 : -1) * (1 + pileRand(seed + 43) * 2)).toFixed(2) + "px");
      el.style.setProperty("--breathe-r", ((pileRand(seed + 47) - 0.5) * 1).toFixed(3) + "deg");
      el.style.setProperty("--breathe-duration", (6 + pileRand(seed + 53) * 4).toFixed(2) + "s");
      el.style.setProperty("--breathe-delay", (-pileRand(seed + 59) * 5).toFixed(2) + "s");
      let x, y, rot, z;
      if (it.type === "doc" || it.type === "exit") {
        const slot = it.slot;
        x = slot.cx; y = slot.cy; rot = slot.r; z = slot.z;
        el.style.setProperty("--doc-opacity", slot.opacity);
        el.style.setProperty("--doc-shadow", slot.shadow);
      } else if (it.type === "media") {
        const p = it.slot;
        rot = p.r; z = p.z;
        // The slot's width becomes this picture's own width, so the FLIP scale
        // below (--from-scale) is measured against the frame actually rendered.
        const size = photoFrameSize(it.m, p);
        p.w = size.w; p.h = size.h;
        const centre = clampPhotoCentre(p.cx, p.cy, size.w, size.h, p.r,
                                        !!String(it.m.description || "").trim());
        x = p.cx = centre.x; y = p.cy = centre.y;
        el.style.setProperty("--pw", (size.w * sceneScale).toFixed(2) + "px");
        el.style.setProperty("--par", size.w.toFixed(3) + " / " + size.h.toFixed(3));
        // One matte thickness for every print, however big that print is —
        // Figma 480:8191 / 751:291 both border it at 18. Scaled with the scene
        // rather than the paper, so it never thickens on a large print or
        // thins away to nothing on a small one.
        el.style.setProperty("--matte", (PHOTO_MATTE * sceneScale).toFixed(2) + "px");
      } else {
        x = it.slot.cx; y = it.slot.cy; rot = it.slot.r; z = it.slot.z;
      }
      // Where this paper starts: its measured place in the stack the user is
      // looking at, or the recorded pile position when there was no stack.
      const measured = stackSourceGeometry && stackSourceGeometry[it.slot.src];
      const from = measured || it.slot.from;
      const fromDX = from.cx - x, fromDY = from.cy - y;
      el.style.setProperty("--from-x", (fromDX * sceneScale).toFixed(2) + "px");
      el.style.setProperty("--from-y", (fromDY * sceneScale).toFixed(2) + "px");
      el.style.setProperty("--from-r", from.r.toFixed(2) + "deg");
      el.style.setProperty("--from-scale", (from.w / it.slot.w).toFixed(5));

      // Hands do not push papers along straight lines. Each sheet bows to one
      // side of its own path — perpendicular to its travel, a tenth of the
      // distance, alternating sign — and straightens as it settles.
      const sp = it.slot.spread;
      const len = Math.hypot(fromDX, fromDY) || 1;
      const bow = Math.min(len * 0.11, 54) * sp.arc;
      el.style.setProperty("--arc-x", ((-fromDY / len) * bow * sceneScale).toFixed(2) + "px");
      el.style.setProperty("--arc-y", ((fromDX / len) * bow * sceneScale).toFixed(2) + "px");
      el.style.setProperty("--spread-delay", sp.delay + "ms");
      el.style.setProperty("--spread-dur", sp.dur + "ms");
      el.style.setProperty("--spread-ease", sp.ease);
      el.style.setProperty("--spread-over", sp.over + "deg");
      if (sp.delay + sp.dur >= spreadEndsAt) el.dataset.spreadLast = "1";

      // Both tool-open destinations, written on every paper without exception —
      // the pile can no longer contain a sheet that has nowhere to go. Deltas
      // from this paper's own resting centre, in the same scaled pixels, so the
      // scatter holds its Figma proportions at any viewport size.
      const op = it.slot.open;
      if (op) {
        el.style.setProperty("--sx-search", ((op.search.cx - x) * sceneScale).toFixed(2) + "px");
        el.style.setProperty("--sy-search", ((op.search.cy - y) * sceneScale).toFixed(2) + "px");
        el.style.setProperty("--sr-search", op.search.r.toFixed(2) + "deg");
        el.style.setProperty("--sx-add", ((op.add.cx - x) * sceneScale).toFixed(2) + "px");
        el.style.setProperty("--sy-add", ((op.add.cy - y) * sceneScale).toFixed(2) + "px");
        el.style.setProperty("--sr-add", op.add.r.toFixed(2) + "deg");
        el.style.setProperty("--pile-move-dur", op.dur + "ms");
        el.style.setProperty("--pile-move-delay", op.lead + "ms");
      }

      // How THIS paper is handled while the archive is being searched. Each one
      // is drawn a direction and a distance of its own from its own seed: some
      // are slid outward from the middle of the desk, some nudged across it,
      // and none of them travel the same way or for the same length of time.
      // Distances are in scene pixels, so a paper moves the same amount
      // relative to the composition at any viewport.
      const rgOut = pileRand(seed + 67) > 0.45;     // slid outward, or across
      const rgDist = (11 + pileRand(seed + 71) * 25) * sceneScale;
      const rgDir = rgOut
        ? Math.atan2(y - 850, x - 960) + (pileRand(seed + 73) - 0.5) * 0.9
        : pileRand(seed + 61) * Math.PI * 2;
      el.style.setProperty("--rummage-x", (Math.cos(rgDir) * rgDist).toFixed(2) + "px");
      el.style.setProperty("--rummage-y", (Math.sin(rgDir) * rgDist).toFixed(2) + "px");
      el.style.setProperty("--rummage-r", ((pileRand(seed + 79) - 0.5) * 3.2).toFixed(2) + "deg");
      el.style.setProperty("--rummage-duration", (9 + pileRand(seed + 83) * 7).toFixed(2) + "s");
      // When this paper is first picked up. Purely random starts clump — six of
      // seven papers would lift together and the desk would heave rather than
      // be searched. A golden-ratio walk over the pile index spreads the starts
      // evenly however many papers there are, and the jitter keeps the spacing
      // from reading as a rhythm.
      const rgStart = (((k * 0.6180339887) % 1) * 9 + pileRand(seed + 89) * 1.2).toFixed(2);
      el.style.setProperty("--rummage-delay", rgStart + "s");

      el.style.left = "calc(50% + " + ((x - 960) * sceneScale).toFixed(2) + "px)";
      el.style.top = "calc(50% + " + ((y - 540) * sceneScale).toFixed(2) + "px)";
      el.style.setProperty("--rot", rot.toFixed(2) + "deg");
      el.style.zIndex = String(z);
      archivePile.appendChild(el);
    });
    arrivedItemIds = nextArrivedItemIds;
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
    if (archivePhase !== "open") return;
    if (archiveBox.classList.contains("is-tool-open")) return;
    // A new retrieval sheet is always a fresh bot session. Do not depend on
    // which control dismissed the previous result to release its request lock.
    if (kind === "search") resetArchiveBot(true);
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
    if (!archiveBox) return false;
    const wasOpen = archiveBox.classList.contains("is-tool-open") ||
      (personalSearchPanel && personalSearchPanel.getAttribute("aria-hidden") === "false") ||
      (personalUploadPanel && personalUploadPanel.getAttribute("aria-hidden") === "false");
    // Reverse the identical motion: drop the state classes and the same
    // transition carries the sheet back to its exact pile-peek position.
    archiveBox.classList.remove("is-tool-open", "is-tool-search", "is-tool-upload");
    if (archivePile) archivePile.classList.remove("is-spread");
    if (personalSearchPanel) personalSearchPanel.setAttribute("aria-hidden", "true");
    if (personalUploadPanel) personalUploadPanel.setAttribute("aria-hidden", "true");
    if (personalSearchStatus) personalSearchStatus.textContent = "";
    return wasOpen;
  }

  // ============================================================
  // Upload confirmation — Figma 844:1282
  // ============================================================
  // A record laid over the archive, never a screen of its own: the desk, the
  // pile and the tool sheets stay mounted and untouched underneath, and
  // dismissing it only takes the record away again.
  const uploadSuccess = document.getElementById("upload-success");
  const uploadSuccessOwner = document.getElementById("upload-success-owner");
  const btnUploadSuccessDone = document.getElementById("btn-upload-success-done");

  function openUploadSuccess() {
    if (!uploadSuccess) return;
    if (uploadSuccessOwner) {
      uploadSuccessOwner.textContent = pileCardData ? (pileCardData.name || "") : "";
    }
    uploadSuccess.setAttribute("aria-hidden", "false");
    if (archiveBox) archiveBox.classList.add("is-upload-success");
    // Focus the record itself, not its arrow: a screen reader announces the
    // dialog and Escape has somewhere to land, while the arrow keeps its focus
    // ring for the Tab that actually reaches it — the design stays as drawn.
    window.setTimeout(() => uploadSuccess.focus({ preventScroll: true }),
                      reduceMotion ? 0 : 440);
  }

  // Dismissing returns to the archive exactly as it was left: the uploaded
  // files are already in it, nothing is reloaded, reset or re-fetched.
  function closeUploadSuccess() {
    if (!uploadSuccess || uploadSuccess.getAttribute("aria-hidden") === "true") return false;
    uploadSuccess.setAttribute("aria-hidden", "true");
    if (archiveBox) archiveBox.classList.remove("is-upload-success");
    return true;
  }

  if (btnUploadSuccessDone) {
    btnUploadSuccessDone.addEventListener("click", (e) => {
      e.preventDefault();
      closeUploadSuccess();
    });
  }
  // The record is modal while it is up, so Escape puts it down too.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeUploadSuccess();
  });

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

  // Back arrows close their sheets. The search sheet reuses the arrow as its
  // submit control, so it is intentionally excluded from this close handler.
  document.querySelectorAll(".personal-tool-back:not(.personal-tool-submit)").forEach((btn) => {
    btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); closePersonalTool(); });
  });

  // Re-scatter/re-scale the pile on resize while the personal screen is open.
  // Mid-spread the rebuild is deferred, so a resize can never restart the
  // papers from the middle of the screen; the pile is re-measured once they
  // have all arrived, and the destinations recompute from the new viewport.
  window.addEventListener("resize", () => {
    if (screens.personal && screens.personal.classList.contains("active")) {
      requestArchivePileRender();
    }
  });

  // Gentle "slide a paper aside" interaction: clicking within ~12px of an
  // item's edge nudges it ~18px out of the pile in that direction (toggle).
  if (archivePile) {
    archivePile.addEventListener("click", (e) => {
      if (archivePhase !== "open") return;   // nothing is grabbable until it lands
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

  // ============================================================
  // Archivist bot — the four states of the archive screen
  // ============================================================
  // Figma 507:382 (initial) / 884:134 (searching) / 578:273 (found) /
  // 635:2730 (notFound). One screen, one pile, one set of papers: the state
  // only changes transforms and which record is on the desk.
  //
  //   ArchiveSearchResult = { status: "found", answer: string }
  //                       | { status: "notFound" }

  // The UI talks only to the archive-scoped server endpoint. The archive code
  // comes from the drawer already opened by the user; it is never requested a
  // second time in the retrieval sheet.
  async function searchArchive(request) {
    const response = await fetch("/api/archive/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        archiveCode: request.code,
        query: request.query,
        format: request.format
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Archive retrieval failed.");
    }

    const answer = String(payload.onscreen_response || "").trim();
    return payload.status === "found" && answer
      ? { status: "found", answer: answer }
      : { status: "notFound" };
  }

  const archiveBot = document.getElementById("archive-bot");
  const archiveBotAnswer = document.getElementById("archive-bot-answer-text");
  let botState = "initial";
  let botRequestRun = 0;
  let botRequestPending = false;

  function setBotState(next) {
    botState = next;
    const showing = next === "found" || next === "notFound";
    // Searching and result states own the desk. Normalize the tool sheets here
    // as well as at submit time so no stale open-panel class can cover either
    // the rummage animation or the returned record.
    if (next !== "initial" && archiveBox) {
      archiveBox.classList.remove("is-tool-open", "is-tool-search", "is-tool-upload");
      if (archivePile) archivePile.classList.remove("is-spread");
      if (personalSearchPanel) personalSearchPanel.setAttribute("aria-hidden", "true");
      if (personalUploadPanel) personalUploadPanel.setAttribute("aria-hidden", "true");
    }
    if (archiveBot) {
      archiveBot.dataset.botState = next;
      archiveBot.setAttribute("aria-hidden", showing ? "false" : "true");
    }
    // The pile reads the state too — this is what starts and stops the rummage.
    if (archiveBox) archiveBox.dataset.botState = next;
    if (showing) {
      const card = archiveBot.querySelector(
        next === "found" ? ".archive-bot-card--found" : ".archive-bot-card--empty");
      if (card) {
        window.setTimeout(() => card.focus({ preventScroll: true }), reduceMotion ? 0 : 440);
      }
    }
  }

  // Fill the record with this drawer's own details and the result's answer.
  // The answer is the only text here that comes from the search.
  function renderArchiveBotResult(result) {
    const code = pileCodeLabel();
    const owner = pileCardData ? (pileCardData.name || "") : "";
    ["archive-bot-found-code", "archive-bot-empty-code"].forEach(id => {
      const el = document.getElementById(id); if (el) el.textContent = code;
    });
    ["archive-bot-found-owner", "archive-bot-empty-owner"].forEach(id => {
      const el = document.getElementById(id); if (el) el.textContent = owner;
    });
    if (result.status === "found" && archiveBotAnswer) {
      archiveBotAnswer.textContent = result.answer || "";
    }
  }

  // Leaving the searching state, papers still lifted are set back down instead
  // of snapping home: pin where each one actually is, drop the animation, then
  // release them so the transition carries them to rest.
  function settleRummagedPapers() {
    if (!archiveBox || !archivePile) return;
    const moved = Array.from(archivePile.querySelectorAll(".pile-item--breathing"));
    moved.forEach(el => {
      const cs = window.getComputedStyle(el);
      el.style.translate = cs.translate === "none" ? "0px 0px" : cs.translate;
      el.style.rotate = cs.rotate === "none" ? "0deg" : cs.rotate;
    });
    archiveBox.dataset.botSettling = "1";
    void archivePile.offsetWidth;              // commit the pinned offsets
    moved.forEach(el => { el.style.translate = ""; el.style.rotate = ""; });
    window.setTimeout(() => {
      if (archiveBox.dataset.botSettling === "1") delete archiveBox.dataset.botSettling;
    }, reduceMotion ? 0 : 600);
  }

  function resetArchiveBot(clearFields) {
    botRequestRun++;              // any in-flight search is no longer wanted
    botRequestPending = false;
    setBotState("initial");
    if (archiveBotAnswer) archiveBotAnswer.textContent = "";
    if (clearFields) {
      const queryField = document.getElementById("personal-search-query");
      const formatField = document.getElementById("personal-search-format");
      if (queryField) queryField.value = "";
      if (formatField) formatField.value = "";
    }
    if (personalSearchStatus) personalSearchStatus.textContent = "";
  }

  function closeArchiveBot() {
    const wasActive = botState !== "initial" ||
      (archiveBot && archiveBot.getAttribute("aria-hidden") !== "true") ||
      (archiveBox && archiveBox.dataset.botState &&
       archiveBox.dataset.botState !== "initial");
    if (!wasActive) return false;
    resetArchiveBot(true);
    return true;
  }

  function submitArchiveSearch(query, format) {
    if (!query || botRequestPending) return;
    botRequestPending = true;
    const request = { code: currentDrawerCode, query: query, format: format };
    // Kept so anything already listening to the archive's search keeps working.
    window.dispatchEvent(new CustomEvent("whatremains:archive-search", { detail: request }));
    closePersonalTool();          // the sheet goes back so the pile can be seen
    setBotState("searching");
    // Mint the request token only after every synchronous UI transition above.
    // A listener reacting to the submit event cannot invalidate the request
    // before it has even started.
    const run = ++botRequestRun;
    searchArchive(request)
      .then(result => {
        if (run !== botRequestRun) return;        // superseded or dismissed
        botRequestPending = false;
        settleRummagedPapers();
        renderArchiveBotResult(result);
        setBotState(result.status === "found" ? "found" : "notFound");
      })
      .catch(error => {
        if (run !== botRequestRun) return;
        botRequestPending = false;
        console.error("Archive search failed:", error);
        settleRummagedPapers();
        renderArchiveBotResult({ status: "notFound" });
        setBotState("notFound");
      });
  }

  function submitPersonalSearchForm() {
    if (botRequestPending) return;
    const queryField = document.getElementById("personal-search-query");
    const formatField = document.getElementById("personal-search-format");
    const query = queryField.value.trim();
    const format = formatField.value.trim();
    if (!query) return;
    if (personalSearchStatus) personalSearchStatus.textContent = "";
    submitArchiveSearch(query, format);
  }

  if (personalSearchForm) personalSearchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    submitPersonalSearchForm();
  });

  // The visible arrow calls this directly from the markup. Keeping the native
  // form submit listener above preserves keyboard submission, while the pointer
  // path no longer depends on event delegation or listener ordering.
  window.whatRemainsSubmitArchiveSearch = function(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    submitPersonalSearchForm();
    return false;
  };

  // The not-found record's arrow: back to the archive to ask about something
  // else. The found record has no control of its own in Figma — it is put down
  // with the archive's own close, or Escape.
  const btnArchiveBotBack = document.getElementById("btn-archive-bot-back");
  if (btnArchiveBotBack) {
    btnArchiveBotBack.addEventListener("click", (e) => {
      e.preventDefault();
      closeArchiveBot();
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeArchiveBot();
  });

  // Development handle for inspecting the live archive-bot UI state.
  window.whatRemainsArchiveBot = {
    state: () => botState,
    setState: setBotState,
    ask: (q) => submitArchiveSearch(q || "בדיקה", "")
  };

  if (personalUploadForm) personalUploadForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const descriptionField = document.getElementById("personal-upload-description");
    const formatField = document.getElementById("personal-upload-format");
    const description = descriptionField.value.trim();
    const format = formatField.value.trim();
    if (!description) return;
    pendingUploadMetadata = { description: description, format: format };
    // Emptied now that it has been handed to this upload, so the next file is
    // never offered the previous file's description.
    descriptionField.value = "";
    formatField.value = "";
    uploadInput.accept = "image/*,video/*,.pdf,.doc,.docx,.txt,audio/*";
    uploadInput.click();
  });

  // Bottom-right: back to the archive; re-lock so re-entry needs the code
  btnPersonalRestart.addEventListener("click", () => {
    if (closeUploadSuccess()) return;
    if (closeArchiveBot()) return;
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
