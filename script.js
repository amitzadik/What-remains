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
    "באיזו שפה סבא וסבתא דיברו בבית?",
    "מה סבא אהב לעשות?",
    "מה גרם לסבתא לצחוק?",
    "ממה סבא פחד?",
    "על מה סבתא חלמה ולא הגשימה?",
    "על מה סבא לא דיבר?",
    "מתי נולד סבא?"
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
      day: "2-digit", month: "2-digit", year: "2-digit"
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

  function setupLandingTypewriter() {
    document.querySelectorAll(".landing-card-face").forEach(face => {
      const parts = [...face.querySelectorAll(".landing-label, .landing-body p")];
      landingTypewriterState.set(face, {
        parts: parts.map(el => ({ el, text: el.textContent })),
        started: false
      });
      parts.forEach(el => {
        const box = el.getBoundingClientRect();
        if (box.height) el.style.minHeight = box.height + "px";
        el.textContent = "";
      });
    });
  }

  function startLandingTypewriter(faceName) {
    const face = document.querySelector(`.landing-card-${faceName}`);
    const state = face && landingTypewriterState.get(face);
    if (!state || state.started) return;
    state.started = true;

    if (reduceMotion) {
      state.parts.forEach(part => { part.el.textContent = part.text; });
      return;
    }

    typeLandingPart(state.parts, 0);
  }

  function typeLandingPart(parts, partIndex) {
    const part = parts[partIndex];
    if (!part) return;

    const chars = Array.from(part.text);
    let charIndex = 0;
    part.el.classList.add("is-typing");

    function tick() {
      part.el.textContent += chars[charIndex] || "";
      charIndex += 1;

      if (charIndex < chars.length) {
        const prev = chars[charIndex - 1];
        const delay = /[.,!?;:،.]/.test(prev) ? 165 : 45;
        window.setTimeout(tick, delay);
        return;
      }

      part.el.classList.remove("is-typing");
      window.setTimeout(() => typeLandingPart(parts, partIndex + 1), 180);
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
    let viewer = allDrawers().find(v => v.code === sess.code);
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
  const qMemoryTrace = document.getElementById("question-memory-trace");
  const btnNext = document.getElementById("btn-next-q");
  const btnDk   = document.getElementById("btn-dk-q");
  const lines = Array.from(document.querySelectorAll("#lines .line__text"));

  // Maps each of the 7 questions to its "about" value shown in the
  // header cell ("על").
  const questionAbouts = [
    "סבא וסבתא", // Q1: באיזו שפה סבא וסבתא דיברו בבית?
    "סבא",        // Q2: מה סבא אהב לעשות?
    "סבתא",       // Q3: מה גרם לסבתא לצחוק?
    "סבא",        // Q4: ממה סבא פחד?
    "סבתא",       // Q5: על מה סבתא חלמה ולא הגשימה?
    "סבא",        // Q6: על מה סבא לא דיבר?
    "סבא"         // Q7: מתי נולד סבא?
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
      items.push(questions[i]);
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
    qText.textContent = "";

    if (reduceMotion || instant) {
      qText.textContent = activeQuestionText;
      qText.classList.remove("is-typing");
      return;
    }

    const chars = Array.from(activeQuestionText);
    let charIndex = 0;
    qText.classList.add("is-typing");

    function tick() {
      if (run !== questionTypewriterRun) return;
      qText.textContent += chars[charIndex] || "";
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
      qText.textContent = activeQuestionText;
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
    if (stage) {
      stage.querySelectorAll(".qform-sheet--stacked").forEach(s => {
        if (s !== registerSheet) s.remove();
      });
      stage.classList.add("qform-stage--register");
    }
    setQuestionMemoryTrace("");
    if (registerSheet) {
      registerSheet.classList.remove("qform-sheet--stacked");
      registerSheet.style.zIndex = "";
      registerSheet.style.removeProperty("--stack-rot");
      registerSheet.style.removeProperty("--stack-x");
      registerSheet.style.removeProperty("--stack-y");
    }
    state.frozenCount = 0;
  }

  // The filled register card becomes the first frozen sheet of the pile
  // (same tilt/dim treatment as a finished question).
  function freezeRegisterCard() {
    const stage = questionStage();
    if (registerSheet) {
      const idx = state.frozenCount;
      const angle = STACK_ANGLES[idx % STACK_ANGLES.length];
      registerSheet.classList.add("qform-sheet--stacked");
      registerSheet.style.zIndex = String(idx + 1);
      registerSheet.style.setProperty("--stack-rot", angle + "deg");
      registerSheet.style.setProperty("--stack-x", (Math.sign(angle) * (28 + idx * 18)) + "px");
      registerSheet.style.setProperty("--stack-y", ((10 + idx * 16) - 50) + "px");
      state.frozenCount++;
    }
    if (stage) stage.classList.remove("qform-stage--register");
  }

  function initQuestions() {
    qDate.textContent = state.date;
    qName.textContent = state.name;
    renderQuestion();
  }

  function handleAnswer(isDontKnow) {
    if (isQuestionTransitioning) return;
    const finishingIndex = state.currentQuestion;
    finishQuestionTypewriter();
    state.answers[finishingIndex]  = isDontKnow ? null : getAnswerText();
    state.dontKnow[finishingIndex] = isDontKnow;
    state.currentQuestion++;
    const memoryItems = buildQuestionMemoryItems(state.currentQuestion);
    if (state.currentQuestion >= questions.length) {
      animateNextQuestion(finishingIndex, memoryItems, () => {
        initCards();
        showScreen("cards");
      });
      return;
    }
    animateNextQuestion(finishingIndex, memoryItems, () => renderQuestion(true));
  }

  // Gentle, deterministic tilt for each frozen sheet (±2°), alternating.
  const STACK_ANGLES = [-2.6, 2.1, -1.5, 2.8, -1.9, 1.2];

  // Question transition. The finished prompt dissolves into the memory field;
  // the live form stays still and the next prompt appears sharp.
  let isQuestionTransitioning = false;
  function animateNextQuestion(finishingIndex, memoryItems, advanceCallback) {
    if (!qMemoryTrace || !qText || isQuestionTransitioning) {
      advanceCallback();
      return;
    }
    isQuestionTransitioning = true;

    if (reduceMotion) {
      setQuestionMemoryTrace(memoryItems);
      advanceCallback();
      isQuestionTransitioning = false;
      return;
    }

    qMemoryTrace.classList.add("is-visible");
    qMemoryTrace.querySelectorAll(".question-memory-trace__item").forEach(trace => {
      const i = Number(trace.dataset.questionIndex);
      if (Number.isFinite(i) && i < memoryItems.length) trace.dataset.age = String(memoryItems.length - i);
    });

    const screenRect = screens.questions.getBoundingClientRect();
    const sourceRect = qText.getBoundingClientRect();
    const sourceStyle = getComputedStyle(qText);
    const liveSheet = document.querySelector("#screen-questions .qform-sheet--active");
    const sheetRect = liveSheet ? liveSheet.getBoundingClientRect() : sourceRect;
    const formGhost = document.createElement("div");
    formGhost.className = "question-memory-form-ghost";
    formGhost.dataset.slot = String(finishingIndex % 7);
    formGhost.style.left = (sheetRect.left - screenRect.left) + "px";
    formGhost.style.top = (sheetRect.top - screenRect.top) + "px";
    formGhost.style.width = sheetRect.width + "px";
    formGhost.style.height = sheetRect.height + "px";
    const ghostQuestion = document.createElement("span");
    ghostQuestion.className = "question-memory-form-ghost__question";
    ghostQuestion.textContent = questions[finishingIndex] || "";
    ghostQuestion.style.top = (sourceRect.top - sheetRect.top) + "px";
    ghostQuestion.style.right = (sheetRect.right - sourceRect.right) + "px";
    ghostQuestion.style.width = sourceRect.width + "px";
    ghostQuestion.style.fontSize = sourceStyle.fontSize;
    ghostQuestion.style.lineHeight = sourceStyle.lineHeight;
    ghostQuestion.style.fontWeight = sourceStyle.fontWeight;
    formGhost.appendChild(ghostQuestion);
    screens.questions.appendChild(formGhost);

    const dissolvingTraces = [];
    function addDissolvingTrace(text, rect, style, slotOffset) {
      if (!text || !rect) return;
      const trace = document.createElement("span");
      trace.className = "question-memory-trace__item question-memory-trace__item--dissolving";
      trace.dataset.questionIndex = String(finishingIndex) + "-" + String(slotOffset);
      trace.dataset.slot = String((finishingIndex + slotOffset) % 7);
      trace.dataset.age = "1";
      trace.textContent = text;
      trace.style.left = (rect.left - screenRect.left) + "px";
      trace.style.right = "auto";
      trace.style.top = (rect.top - screenRect.top) + "px";
      trace.style.width = rect.width + "px";
      trace.style.transform = "translateY(0) scale(1)";
      trace.style.fontSize = style.fontSize;
      trace.style.lineHeight = style.lineHeight;
      trace.style.fontWeight = style.fontWeight;
      trace.style.filter = "blur(0)";
      trace.style.opacity = "1";
      trace.style.zIndex = "6";
      screens.questions.appendChild(trace);
      dissolvingTraces.push(trace);
    }
    addDissolvingTrace(questions[finishingIndex] || "", sourceRect, sourceStyle, 0);
    const answerText = String(state.answers[finishingIndex] || "").replace(/\s+/g, " ").trim();
    const firstAnswerLine = lines.find(line => line.textContent.trim());
    if (answerText && firstAnswerLine) {
      addDissolvingTrace(answerText, firstAnswerLine.getBoundingClientRect(), getComputedStyle(firstAnswerLine), 3);
    }

    requestAnimationFrame(() => {
      formGhost.classList.add("is-receding");
      dissolvingTraces.forEach(trace => {
        trace.style.left = "";
        trace.style.right = "";
        trace.style.top = "";
        trace.style.width = "";
        trace.style.transform = "";
        trace.style.fontSize = "";
        trace.style.lineHeight = "";
        trace.style.fontWeight = "";
        trace.style.filter = "";
        trace.style.opacity = "";
      });
    });

    window.setTimeout(() => {
      advanceCallback();
      dissolvingTraces.forEach(trace => { trace.style.zIndex = "0"; });
    }, 260);

    window.setTimeout(() => {
      formGhost.remove();
    }, 980);

    window.setTimeout(() => {
      dissolvingTraces.forEach(trace => trace.remove());
      setQuestionMemoryTrace(memoryItems);
      isQuestionTransitioning = false;
    }, 1180);
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
    initCameraScreen();
    showScreen("camera");
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
  // newline) — or "לא יודע/ת" when the question was skipped.
  function buildAnswerLines(i, src) {
    const ans = (src && src.answers) || state.answers;
    const dk  = (src && src.dontKnow) || state.dontKnow;
    const parts = dk[i]
      ? ["לא יודע/ת"]
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
    const raw = getComputedStyle(screens.cards).getPropertyValue("--blank-type-speed").trim();
    const value = parseFloat(raw);
    return Number.isFinite(value) ? value : 48;
  }

  function typeBlankCopy() {
    if (!cardsBlankType) return;
    cardsCopyRun += 1;
    const run = cardsCopyRun;
    const text = cardsBlankType.dataset.text || "";
    if (!cardsBlankType.style.minHeight) {
      const originalText = cardsBlankType.textContent;
      cardsBlankType.textContent = text;
      const box = cardsBlankType.getBoundingClientRect();
      if (box.height) cardsBlankType.style.minHeight = box.height + "px";
      cardsBlankType.textContent = originalText;
    }
    cardsBlankType.textContent = "";
    cardsScene.classList.remove("is-copy-done");
    cardsScene.classList.add("is-typing");
    if (btnBeginLeaving) btnBeginLeaving.disabled = true;

    if (reduceMotion) {
      cardsBlankType.textContent = text;
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
      cardsBlankType.textContent += chars[charIndex] || "";
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
  const cameraDocName = document.getElementById("camera-doc-name");
  const cameraDocDate = document.getElementById("camera-doc-date");
  const cameraDocLines = Array.from(document.querySelectorAll(".camera-document .line__text"));
  const cameraShutter = document.getElementById("camera-shutter");
  const cameraRetake  = document.getElementById("camera-retake");
  const btnCameraNext = document.getElementById("btn-camera-next");
  const btnCameraBack = document.getElementById("btn-camera-back");
  const envelopeTransition = document.getElementById("memory-envelope-transition");
  const btnEnvelopeNext = document.getElementById("btn-envelope-next");

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
    envelopeTransition.classList.remove("is-closing", "is-sealed");
    if (btnEnvelopeNext) btnEnvelopeNext.disabled = true;
    void envelopeTransition.offsetWidth;
    envelopeTransition.classList.add("is-closing");
    setTimeout(() => {
      envelopeTransition.classList.add("is-sealed");
      if (btnEnvelopeNext) btnEnvelopeNext.disabled = false;
    }, reduceMotion ? 0 : 2300);
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
  const pLegacy  = document.getElementById("p-legacy");
  const pQuestions = document.getElementById("p-questions");
  const qfolderStamp = document.getElementById("qfolder-stamp");
  const pPhotos  = document.getElementById("p-photos");
  const pVideos  = document.getElementById("p-videos");
  const btnPersonalToGeneral = document.getElementById("btn-personal-to-general");
  const btnPersonalArchiveSearch = document.getElementById("btn-personal-archive-search");
  const btnPersonalRestart   = document.getElementById("btn-personal-restart");

  // Drawer-upload state. Only photos (folder 0) and videos (folder 1) are
  // uploadable for now; each maps to an accepted file type.
  let currentDrawerCode = "";
  let activeFolderIdx = 3;
  const FOLDER_CATEGORY = { 0: "image", 1: "video" };

  function openArchiveSearch() {
  }

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

  // Render a just-picked file into its folder right away (before the Drive
  // round-trip finishes), dimmed until the gallery reloads from Drive.
  function showLocalPreview(file, dataUrl) {
    const isVideo = (file.type || "").indexOf("video/") === 0;
    const targetEl = isVideo ? pVideos : pPhotos;
    if (!targetEl) return;
    let grid = targetEl.querySelector(".drawer-files");
    if (!grid) {
      targetEl.innerHTML = '<div class="drawer-files"></div>';
      grid = targetEl.querySelector(".drawer-files");
    }
    let el;
    if (isVideo) {
      el = document.createElement("video");
      el.className = "drawer-file-video is-uploading";
      el.controls = true;
      el.src = dataUrl;
    } else {
      el = document.createElement("img");
      el.className = "drawer-file is-uploading";
      el.alt = "";
      el.src = dataUrl;
    }
    grid.appendChild(el);
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
    const images = files.filter(f => f.type === "image");
    const videos = files.filter(f => f.type === "video");
    if (pPhotos) {
      let html = "";
      images.forEach(f => {
        html += '<img class="drawer-file" loading="lazy" alt="" ' +
                'src="https://drive.google.com/thumbnail?id=' + f.id + '&sz=w1000">';
      });
      pPhotos.innerHTML = html
        ? '<div class="drawer-files">' + html + '</div>'
        : '<div class="folder-empty">עדיין אין כאן תוכן</div>';
    }
    if (pVideos) {
      let vhtml = "";
      videos.forEach(f => {
        vhtml += '<iframe class="drawer-file-video" loading="lazy" allow="autoplay" ' +
                 'src="https://drive.google.com/file/d/' + f.id + '/preview"></iframe>';
      });
      pVideos.innerHTML = vhtml
        ? '<div class="drawer-files">' + vhtml + '</div>'
        : '<div class="folder-empty">עדיין אין כאן תוכן</div>';
    }
  }

  // Size the "השאלות מההתחלה" cards so 3 per row fill the whole content width
  // (from the right edge to the red stamp on the left) — no wasted space.
  // Content width = 100% - 12% (right) - (10% + 8rem) (left, to the stamp).
  function sizeQuestionCards() {
    if (!pQuestions) return;
    const gap = 10;
    // .folder-body is inset 20px each side, and .folder-content is 4% left / 6%
    // right of it, with a vertical scrollbar — so the real card band is:
    const bandW = (window.innerWidth - 40) * 0.90 - 20;
    let scale = (bandW - 2 * gap) / 3 / 1500;               // 3 columns fill the width
    scale = Math.max(0.12, Math.min(1, scale));
    pQuestions.style.setProperty("--qf-scale", String(scale));
  }
  window.addEventListener("resize", sizeQuestionCards);

  // Open the drawer interior (folder dividers) for a given viewer and
  // show the screen. "דברים שכתבתי" = legacy text; "השאלות מההתחלה" =
  // the 7 answers (full data for the user's own drawer via state; for DB
  // drawers only when the sheet returns q1..q7 via viewer.answers).
  function openDrawerInterior(viewer) {
    if (!viewer) return;
    if (activeDrawerEl) activeDrawerEl.classList.add("is-opened");
    // Owner view = logged-in session whose code matches this drawer's code.
    const _sess = getSession();
    ownerView = !!(_sess && _sess.code && viewer.code && _sess.code === viewer.code);
    currentDrawerCode = viewer.code || "";
    pName.textContent   = viewer.name || "(ללא שם)";
    pLegacy.textContent = viewer.archive || "(אין טקסט מורשת)";

    // "תמונות" — show the depositor photo for the user's own drawer
    // (session only; not persisted to the DB)
    if (pPhotos) {
      if (viewer.isUser && state.photoDataUrl) {
        pPhotos.innerHTML = '<img class="drawer-photo" alt="תמונת המפקיד">';
        pPhotos.querySelector("img").src = state.photoDataUrl;
      } else {
        pPhotos.innerHTML = '<div class="folder-empty">עדיין אין כאן תוכן</div>';
      }
    }

    let answers = null, dontKnow = null;
    if (viewer.isUser) {
      answers  = state.answers;
      dontKnow = state.dontKnow;
    } else if (Array.isArray(viewer.answers) && viewer.answers.some(a => a && String(a).trim())) {
      answers  = viewer.answers;
      dontKnow = viewer.answers.map(a => String(a).trim() === "לא יודע/ת");
    }

    // "השאלות מההתחלה" shows the exact 7 opening question cards (reused
    // verbatim via cardFormHTML), each scaled to 30% inside a footprint wrap.
    // The card data for THIS drawer: own drawer uses live state, a DB drawer
    // uses the answers fetched from the sheet (empty arrays when unanswered,
    // so we never leak the logged-in user's answers into someone else's cards).
    const cardData = {
      name: viewer.name || state.name,
      date: viewer.isUser ? state.date : "",
      answers: answers || [],
      dontKnow: dontKnow || []
    };

    pQuestions.innerHTML = "";
    questions.forEach((q, i) => {
      const wrap = document.createElement("div");
      wrap.className = "qfolder-card-wrap";
      wrap.innerHTML =
        '<div class="qfolder-card"><div class="qform-sheet">' + cardFormHTML(i, cardData) + '</div></div>';
      pQuestions.appendChild(wrap);
    });
    sizeQuestionCards();

    // Answered-count stamp — pick stampN.png by THIS drawer's answered count.
    if (qfolderStamp) {
      const answeredCount = cardData.dontKnow.filter(x => !x).length;
      qfolderStamp.src = "images/stamp" + answeredCount + ".png";
    }

    closeAllFolders(); // open the drawer showing the closed folder stack
    loadDrawerFiles(currentDrawerCode); // populate the photos/videos galleries
    showScreen("personal");
  }

  // Folder dividers: clicking a tab brings its divider to the front
  const folderTabs   = Array.from(document.querySelectorAll("#screen-personal .folder-tab"));
  const folderBodies = Array.from(document.querySelectorAll("#screen-personal .folder-body"));
  // Fixed stack order is set in CSS by data-folder (brown "השאלות" at the back,
  // the others zigzag right/left). The order never changes — not on click, not
  // on hover; opening a folder just makes it dominate (is-open) over the rest.
  function activateFolder(idx) {
    activeFolderIdx = idx;
    // The + (upload) button shows only for the owner, and only on the
    // uploadable folders — תמונות (0) and סרטונים (1). Read-only otherwise.
    if (btnPersonalToGeneral) {
      btnPersonalToGeneral.style.display =
        (ownerView && (idx === 0 || idx === 1)) ? "" : "none";
    }
  }
  if (btnPersonalArchiveSearch) {
    btnPersonalArchiveSearch.addEventListener("click", openArchiveSearch);
  }
  const folderBodiesEl = document.querySelector("#screen-personal .folder-bodies");
  // Open one folder (bring it forward + reveal); opening one closes any other.
  function openFolder(idx) {
    activateFolder(idx);
    folderBodies.forEach((b, i) => b.classList.toggle("is-open", i === idx));
    if (folderBodiesEl) folderBodiesEl.classList.add("has-open"); // others recede to tabs
  }
  // Show the closed folder stack (no divider pre-opened); hide the upload +.
  function closeAllFolders() {
    folderBodies.forEach(b => b.classList.remove("is-open"));
    if (folderBodiesEl) folderBodiesEl.classList.remove("has-open");
    if (btnPersonalToGeneral) btnPersonalToGeneral.style.display = "none";
  }
  // Clicking a folder toggles it; clicking the open one closes it back in.
  function toggleFolder(idx) {
    const body = folderBodies[idx];
    if (!body) return;
    if (body.classList.contains("is-open")) {
      body.classList.remove("is-open");
      if (folderBodiesEl) folderBodiesEl.classList.remove("has-open"); // back to the large stack
    } else {
      openFolder(idx);
    }
  }
  folderTabs.forEach((tab, i) => tab.addEventListener("click", () => toggleFolder(i)));
  // Close stamp on the open tab → close the folder back into the stack
  document.querySelectorAll("#screen-personal .folder-close").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const body = btn.closest(".folder-body");
      if (body) body.classList.remove("is-open");
      if (folderBodiesEl) folderBodiesEl.classList.remove("has-open");
    });
  });
  closeAllFolders(); // default: closed folder stack until a tab is clicked

  // Bottom-left +: pick a file for the active folder (photos/videos only)
  btnPersonalToGeneral.addEventListener("click", () => {
    if (!ownerView || !currentDrawerCode) return;
    const cat = FOLDER_CATEGORY[activeFolderIdx];
    if (!cat) return; // only תמונות / סרטונים are uploadable for now
    uploadInput.accept = cat === "image" ? "image/*" : "video/*";
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
    memoryAnswers.slice(0, 4).forEach(() => layers.push("memory"));
    if (!layers.length) layers.push("quiet");
    return layers.slice(0, 6);
  }

  function envelopeLayerHTML(v) {
    return envelopeLayerTypes(v).map((type, i) =>
      '<span class="envelope-card__memory-layer envelope-card__memory-layer--' +
      type + '" data-layer="' + (i + 1) + '"></span>'
    ).join("");
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
        openDrawerInterior(v);
      } else {
        openCodeModal(v, d);
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
    codeTarget.textContent = viewer ? ("המגירה של " + viewer.name) : "הזינ/י את קוד המגירה";
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
      setTimeout(() => openDrawerInterior(activeViewer), 300);
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
    contentName.textContent = "מגירה של " + name;
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

  // Hover swap for all .img-btn buttons (data-default/data-hover on the button)
  document.addEventListener('mouseover', e => {
    const btn = e.target.closest('.img-btn');
    if (btn && !btn.disabled) btn.querySelector('img').src = btn.dataset.hover;
  });
  document.addEventListener('mouseout', e => {
    const btn = e.target.closest('.img-btn');
    if (btn) btn.querySelector('img').src = btn.dataset.default;
  });

  checkDepositBtn();
  updateHeaderAuthState();
  renderLandingDrawers();
  setupLandingTypewriter();
  startLandingTypewriter("front");
  loadViewersFromDB();
  showScreen("landing");
})();
