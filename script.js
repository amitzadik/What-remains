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
    landing:   document.getElementById("screen-landing"),
    questions: document.getElementById("screen-questions"),
    cards:     document.getElementById("screen-cards"),
    legacy:    document.getElementById("screen-legacy"),
    stack:     document.getElementById("screen-stack"),
    camera:    document.getElementById("screen-camera"),
    envelope:  document.getElementById("screen-envelope"),
    print:     document.getElementById("screen-print"),
    personal:  document.getElementById("screen-personal")
  };

  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove("active"));
    if (screens[name]) screens[name].classList.add("active");
  }

  // ============================================================
  // Landing (PHASE.LANDING) — archive drawer wall + intro card + stamps
  // ============================================================
  const landingBg = document.getElementById("landing-bg");
  const landingOverlay = document.getElementById("landing-overlay");
  const landingCard    = document.getElementById("landing-card");
  const stampSearch = document.getElementById("stamp-search");
  const stampAdd    = document.getElementById("stamp-add");
  const stampLogin    = document.getElementById("stamp-login");
  const stampMyDrawer = document.getElementById("stamp-mydrawer");
  const landingStamps = document.querySelector("#screen-landing .landing-stamps");

  // The landing IS the archive: it shows the full drawer wall, filtered
  // live by the in-place search input when one is open.
  function renderLandingDrawers() {
    if (!landingBg) return;
    landingBg.innerHTML = "";
    const query = (searchInput && searchInput.value ? searchInput.value : "").trim();
    let drawers = allDrawers().sort((a, b) => a.name.localeCompare(b.name, "he"));
    if (query) {
      drawers = drawers.filter(v => (v.name || "").includes(query));
    }
    drawers.forEach(v => landingBg.appendChild(buildDrawerEl(v)));
  }

  // Click outside the card (on the overlay) dismisses it
  if (landingOverlay) {
    landingOverlay.addEventListener("click", (e) => {
      if (e.target === landingOverlay) {
        landingOverlay.classList.add("is-hidden");
      }
    });
  }

  // Popup corner button: first click flips the card, second dismisses
  // the popup and reveals the landing behind it
  const landingCardInner = document.getElementById("landing-card-inner");
  const btnCardFlip = document.getElementById("btn-card-flip");
  if (btnCardFlip && landingCardInner) {
    btnCardFlip.addEventListener("click", (e) => {
      e.stopPropagation();
      if (landingCardInner.classList.contains("is-flipped")) {
        dismissLandingPopup();
      } else {
        landingCardInner.classList.add("is-flipped");
        startLandingTypewriter("back");
      }
    });
  }

  const landingTypewriterState = new WeakMap();
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function prepareTypewriterElement(el, text) {
    if (!el) return null;
    el.classList.add("typewriter-stable");
    el.innerHTML =
      '<span class="typewriter-reserve" aria-hidden="true"></span>' +
      '<span class="typewriter-live"></span>';
    const reserve = el.querySelector(".typewriter-reserve");
    const live = el.querySelector(".typewriter-live");
    if (reserve) reserve.textContent = text || "";
    if (live) live.textContent = "";
    return live;
  }

  function setTypewriterText(el, text) {
    const live = el && el.querySelector ? el.querySelector(".typewriter-live") : null;
    if (live) {
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
    return Number.isFinite(value) ? value : 48;
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
      target.textContent += chars[charIndex] || "";
      charIndex += 1;

      if (charIndex < chars.length) {
        window.setTimeout(tick, speed);
        return;
      }

      part.el.classList.remove("is-typing");
      window.setTimeout(() => typeLandingPart(parts, partIndex + 1), speed);
    }

    tick();
  }

  document.querySelectorAll("#screen-landing .landing-stamp").forEach(stamp => {
    const def = stamp.src;
    const hov = stamp.dataset.hover;
    stamp.addEventListener("mouseenter", () => { if (hov) stamp.src = hov; });
    stamp.addEventListener("mouseleave", () => { stamp.src = def; });
  });

  function dismissLandingPopup() {
    if (landingOverlay) landingOverlay.classList.add("is-hidden");
  }

  // Search stamp toggles the in-place search bar (no navigation)
  if (stampSearch) {
    stampSearch.addEventListener("click", () => {
      dismissLandingPopup();
      if (!searchInput) return;
      searchInput.hidden = !searchInput.hidden;
      if (!searchInput.hidden) {
        searchInput.focus();
      } else {
        searchInput.value = "";
        applySearchFilter();
      }
    });
  }
  if (stampAdd) {
    stampAdd.addEventListener("click", () => {
      dismissLandingPopup();
      startRegistration();
    });
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

  function updateHeaderAuthState() {
    if (landingStamps) landingStamps.classList.toggle("is-authed", isLoggedIn());
  }

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

  // Header: login + my-drawer stamps
  if (stampLogin) {
    stampLogin.addEventListener("click", () => {
      dismissLandingPopup();
      const sess = getSession();
      if (sess && sess.code) openAccountModal();   // logged in → account screen
      else openLoginModal();                        // not logged in → login form
    });
  }
  if (stampMyDrawer) {
    stampMyDrawer.addEventListener("click", () => {
      const sess = getSession();
      if (!sess || !sess.code) return;   // disabled until logged in
      dismissLandingPopup();
      openOwnDrawer(sess);
    });
  }

  // Enter the questionnaire flow with the register card as the active
  // sheet on the questions stage.
  function startRegistration() {
    resetQuestionStage();
    checkDepositBtn();
    showScreen("questions");
    setTimeout(() => nameInput.focus(), 60);
  }

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
      target.textContent += chars[charIndex] || "";
      charIndex += 1;

      if (charIndex < chars.length) {
        const prev = chars[charIndex - 1];
        const delay = /[.,!?;:،.]/.test(prev) ? 150 : 42;
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
      const slot = MEMORY_SLOTS[Math.min(i, MEMORY_SLOTS.length - 1)];
      const age = total - 1 - i;                       // newest word (age 0) is largest
      const vw = (MEMORY_BASE_VW * Math.pow(MEMORY_STEP, age)).toFixed(2);
      const cap = Math.round(350 * Math.pow(MEMORY_STEP, age) * 1.2);
      el.style.right = slot.right + "%";
      el.style.top = slot.top + "%";
      el.style.fontSize = "min(" + vw + "vw, " + cap + "px)";
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
    // Only the answer recedes: push it into the memory background, leave the
    // form in place and swap in the next prompt (or move on to the cards).
    renderMemoryBackground();
    if (state.currentQuestion >= questions.length) {
      initCards();
      showScreen("cards");
    } else {
      renderQuestion(true);
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
    if (legacyLines[0]) {
      setTimeout(() => {
        legacyLines[0].focus();
        placeCaretAtEnd(legacyLines[0]);
      }, 50);
    }
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
  const cardsStamp   = document.getElementById("cards-memory-stamp");
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

    const answeredCount = state.dontKnow.filter(x => !x).length;
    if (cardsStamp) cardsStamp.src = "images/stamp" + answeredCount + ".png";
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
      if (btnBeginLeaving) btnBeginLeaving.disabled = false;
      return;
    }

    const chars = Array.from(text);
    let charIndex = 0;
    const speed = cardsTypeSpeed();

    function tick() {
      if (run !== cardsCopyRun) return;
      const target = cardsLive || cardsBlankType;
      target.textContent += chars[charIndex] || "";
      charIndex += 1;

      if (charIndex < chars.length) {
        window.setTimeout(tick, speed);
      } else {
        cardsScene.classList.remove("is-typing");
        cardsScene.classList.add("is-copy-done");
        if (btnBeginLeaving) btnBeginLeaving.disabled = false;
      }
    }

    tick();
  }

  function beginLeaving() {
    if (!cardsScene.classList.contains("is-copy-done")) return;
    initLegacy();
    showScreen("legacy");
  }
  if (btnBeginLeaving) {
    btnBeginLeaving.addEventListener("click", (e) => {
      e.stopPropagation();
      beginLeaving();
    });
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
      showScreen("print");
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
  const btnToArchive = document.getElementById("btn-to-archive");
  btnToArchive.addEventListener("click", () => {
    renderLandingDrawers(); // refresh — includes the user's new drawer
    // Land the just-created depositor straight inside their own drawer,
    // logged in as the owner; fall back to the archive if no session.
    const sess = getSession();
    if (sess && sess.code) {
      openOwnDrawer(sess);
    } else {
      showScreen("landing");
    }
  });

  // ============================================================
  // Personal archive (the user's own drawer)
  // ============================================================
  const pName    = document.getElementById("p-name");
  const archivePile = document.getElementById("archive-pile");
  const btnPersonalToGeneral = document.getElementById("btn-personal-to-general");
  const btnPersonalArchiveSearch = document.getElementById("btn-personal-archive-search");
  const btnPersonalRestart   = document.getElementById("btn-personal-restart");

  // Personal-archive state. The scattered pile is built from THIS depositor's
  // own materials: their answered question cards plus their photos/videos.
  let currentDrawerCode = "";
  let pileCardData = null;   // the 7 question cards' data for the open drawer
  let pileMedia = [];        // authoritative media {src, kind, own?} (drive + own photo)
  let pileLocalMedia = [];   // optimistic just-picked uploads, until Drive reloads

  // One reusable hidden file input drives all drawer uploads.
  const uploadInput = document.createElement("input");
  uploadInput.type = "file";
  uploadInput.style.display = "none";
  document.body.appendChild(uploadInput);
  uploadInput.addEventListener("change", () => {
    const file = uploadInput.files && uploadInput.files[0];
    uploadInput.value = ""; // let the same file be re-picked later
    if (file && currentDrawerCode) uploadFileToDrawer(file, currentDrawerCode);
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
            data: base64
          })
        });
      } catch (err) { /* לא חוסם */ }
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
      dontKnow: dontKnow || []
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
  function renderArchivePile() {
    if (!archivePile) return;
    const media = pileMedia.concat(pileLocalMedia);
    const docCount = pileCardData ? questions.length : 0;

    // The document sheets form the back of the pile; the depositor's own
    // photos/videos sit on top as the materials laid over the archive.
    const items = [];
    for (let i = 0; i < docCount; i++) items.push({ type: "doc", i: i });
    media.forEach(m => items.push({ type: "media", m: m }));

    // Document-sheet width in px so the qform can scale from its 1500px base.
    // Large, like the Figma — the sheets crop against the screen edges.
    const dw = Math.max(560, Math.min(1120, window.innerWidth * 0.64));

    archivePile.innerHTML = "";
    items.forEach((it, k) => {
      const el = document.createElement("div");
      el.className = "pile-item pile-item--" + (it.type === "doc" ? "doc" : "photo");
      if (it.type === "doc") {
        el.style.setProperty("--dw", dw + "px");
        el.innerHTML = '<div class="pile-doc">' + cardFormHTML(it.i, pileCardData) + "</div>";
      } else {
        if (it.m.uploading) el.classList.add("is-uploading");
        const badge = it.m.kind === "video" ? '<span class="pile-play" aria-hidden="true"></span>' : "";
        el.innerHTML = '<img loading="lazy" alt="" src="' + it.m.src + '">' + badge;
        el.style.setProperty("--w", (0.82 + pileRand(k + 41) * 0.5).toFixed(3));
      }
      // Stable scatter — bottom-weighted like the Figma: the pile begins in
      // the lower half of the page and the large sheets crop past the bottom.
      const rot = (pileRand(k + 1) - 0.5) * 16;          // ~ -8..8deg
      const tx  = (pileRand(k + 7) - 0.5) * 50;           // % of pile, -25..25
      const ty  = (pileRand(k + 13) - 0.5) * 42;          // % of pile, -21..21
      el.style.left = (50 + tx) + "%";
      el.style.top  = (64 + ty) + "%";                    // centred low, not mid-page
      el.style.setProperty("--rot", rot.toFixed(2) + "deg");
      el.style.zIndex = String(10 + k);
      archivePile.appendChild(el);
    });

    // The + (add material) control shows only for the drawer's owner.
    if (btnPersonalToGeneral) {
      btnPersonalToGeneral.style.display = ownerView ? "" : "none";
    }
  }

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

  // Drawer control → browse the full archive (the landing drawer wall).
  if (btnPersonalArchiveSearch) {
    btnPersonalArchiveSearch.addEventListener("click", () => {
      renderLandingDrawers();
      showScreen("landing");
    });
  }

  // + control → the owner adds a new photo/video to their archive.
  btnPersonalToGeneral.addEventListener("click", () => {
    if (!ownerView || !currentDrawerCode) return;
    uploadInput.accept = "image/*,video/*";
    uploadInput.click();
  });

  // Bottom-right: back to the archive; re-lock so re-entry needs the code
  btnPersonalRestart.addEventListener("click", () => {
    activeViewer = null;
    renderLandingDrawers();
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
    d.addEventListener("click", () => {
      const sess = getSession();
      if (sess && sess.code && sess.code === v.code) {
        activeViewer = v;
        activeDrawerEl = d;
        openArchiveStack(d, () => openDrawerInterior(v));
      } else {
        openArchiveStack(d, () => openCodeModal(v, d));
      }
    });
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
