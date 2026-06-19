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
      }
    });
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
  const loginForm        = document.getElementById("login-form");
  const loginStatus      = document.getElementById("login-status");
  const loginStatusEmail = document.getElementById("login-status-email");
  const loginEmail       = document.getElementById("login-email");
  const loginCode        = document.getElementById("login-code");
  const loginErr         = document.getElementById("login-err");
  const btnSubmitLogin   = document.getElementById("btn-submit-login");
  const btnCloseLogin    = document.getElementById("btn-close-login");
  const btnLogout        = document.getElementById("btn-logout");

  function openLoginModal() {
    const sess = getSession();
    if (sess && sess.code) {
      loginForm.hidden = true;
      loginStatus.hidden = false;
      loginStatusEmail.textContent = sess.email || "";
    } else {
      loginForm.hidden = false;
      loginStatus.hidden = true;
      loginEmail.value = "";
      loginCode.value = "";
      loginErr.textContent = "";
    }
    loginModal.classList.add("active");
    if (!(sess && sess.code)) setTimeout(() => loginEmail.focus(), 50);
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
        closeLoginModal();
        updateHeaderAuthState();
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
  if (btnLogout) btnLogout.addEventListener("click", () => {
    clearSession();
    updateHeaderAuthState();
    // Reset the modal back to the (empty) login form so it no longer shows
    // "מחובר כ..." and keeps no stale email/code around.
    loginStatus.hidden = true;
    loginStatusEmail.textContent = "";
    loginForm.hidden = false;
    loginEmail.value = "";
    loginCode.value = "";
    loginErr.textContent = "";
    closeLoginModal();
  });

  // Open the logged-in user's own drawer directly (auto-unlock, owner view)
  function openOwnDrawer(sess) {
    let viewer = allDrawers().find(v => v.code === sess.code);
    if (!viewer) viewer = { name: sess.name || "", code: sess.code, archive: "", answers: null };
    activeViewer = viewer;
    openDrawerInterior(viewer);
  }

  // Header: login + my-drawer stamps
  if (stampLogin) {
    stampLogin.addEventListener("click", () => {
      dismissLandingPopup();
      openLoginModal();   // logged-in → status/logout view; else → form
    });
  }
  if (stampMyDrawer) {
    stampMyDrawer.addEventListener("click", () => {
      dismissLandingPopup();
      const sess = getSession();
      if (sess && sess.code) openOwnDrawer(sess);
      else openLoginModal();
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
    // The filled register card joins the pile; question 1 drops in on top
    freezeRegisterCard();
    initQuestions();
    dropInLiveForm();
  });

  // ============================================================
  // Questions (contenteditable lines, disabled-until-typed next)
  // ============================================================
  const qNum   = document.getElementById("q-num");
  const qDate  = document.getElementById("q-date");
  const qName  = document.getElementById("q-name");
  const qAbout = document.getElementById("q-about");
  const qText  = document.getElementById("q-text");
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

  function renderQuestion() {
    const idx = state.currentQuestion;
    qNum.textContent  = (idx + 1) + "/" + questions.length;
    qText.textContent = questions[idx];
    if (qAbout) qAbout.textContent = questionAbouts[idx] || "";
    clearLines();
    btnNext.disabled = true;
    if (lines[0]) {
      lines[0].focus();
      placeCaretAtEnd(lines[0]);
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
      registerSheet.style.setProperty("--stack-y", (10 + idx * 16) + "px");
      state.frozenCount++;
    }
    if (stage) stage.classList.remove("qform-stage--register");
  }

  // Drop the live question form in from above, landing on the pile
  function dropInLiveForm(onDone) {
    const stage = questionStage();
    const liveSheet = stage && stage.querySelector(".qform-sheet--active");
    const liveForm = liveSheet && liveSheet.querySelector(".qform");
    if (!liveForm) {
      if (onDone) onDone();
      return;
    }
    liveForm.style.transition = "none";
    liveForm.style.transform = "translateY(-100%)";
    void liveForm.offsetWidth; // commit the jump
    liveForm.style.transition = "transform 300ms ease-in";
    liveForm.style.transform = "translateY(0)";
    setTimeout(() => {
      liveForm.style.transition = "";
      liveForm.style.transform = "";
      if (onDone) onDone();
    }, 320);
  }

  function initQuestions() {
    qDate.textContent = state.date;
    qName.textContent = state.name;
    renderQuestion();
  }

  function handleAnswer(isDontKnow) {
    const finishingIndex = state.currentQuestion;
    state.answers[finishingIndex]  = isDontKnow ? null : getAnswerText();
    state.dontKnow[finishingIndex] = isDontKnow;
    state.currentQuestion++;
    if (state.currentQuestion >= questions.length) {
      initCards();
      showScreen("cards");
      return;
    }
    animateNextQuestion(finishingIndex, () => renderQuestion());
  }

  // Gentle, deterministic tilt for each frozen sheet (±2°), alternating.
  const STACK_ANGLES = [-2.6, 2.1, -1.5, 2.8, -1.9, 1.2];

  // Stack-of-papers transition. The live form stays the single interactive
  // sheet; the finished question is frozen into a static, tilted, dimmed
  // sheet that is inserted BEHIND the live one and kept there. The pile
  // therefore accumulates: at question N there are N sheets.
  let isQuestionTransitioning = false;
  function animateNextQuestion(finishingIndex, advanceCallback) {
    const stage = document.querySelector("#screen-questions .qform-stage");
    const liveSheet = stage && stage.querySelector(".qform-sheet--active");
    const liveForm = liveSheet && liveSheet.querySelector(".qform");
    if (!stage || !liveSheet || !liveForm || isQuestionTransitioning) {
      advanceCallback();
      return;
    }
    isQuestionTransitioning = true;

    // Freeze the finishing question into a static sheet behind the live one
    const idx = state.frozenCount;
    const angle = STACK_ANGLES[idx % STACK_ANGLES.length];
    const frozen = document.createElement("div");
    frozen.className = "qform-sheet qform-sheet--stacked";
    frozen.style.zIndex = String(idx + 1); // below the active sheet
    frozen.style.setProperty("--stack-rot", angle + "deg");
    frozen.style.setProperty("--stack-x", (Math.sign(angle) * (28 + idx * 18)) + "px");
    frozen.style.setProperty("--stack-y", (10 + idx * 16) + "px");

    const formClone = liveForm.cloneNode(true);
    formClone.removeAttribute("id");
    formClone.querySelectorAll("[id]").forEach(el => el.removeAttribute("id"));
    formClone.querySelectorAll("[contenteditable]").forEach(el => {
      el.setAttribute("contenteditable", "false");
    });
    // Show "לא יודע/ת" on the frozen page when the question was skipped
    if (state.dontKnow[finishingIndex]) {
      const firstLine = formClone.querySelector(".qform-answer-row .line__text");
      if (firstLine) firstLine.textContent = "לא יודע/ת";
    }
    frozen.appendChild(formClone);
    stage.insertBefore(frozen, liveSheet);
    state.frozenCount++;

    // Swap the live form's content for the next question, then drop it
    // in from above, landing straight on top of the pile
    advanceCallback();
    dropInLiveForm(() => { isQuestionTransitioning = false; });
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
  // PHASE.CARDS — summary pile (qform cards) + envelope seal
  // ============================================================
  const cardsWrap    = document.getElementById("cards-wrap");
  const cardsScene   = document.getElementById("cards-scene");
  const cardsStage   = document.getElementById("cards-stage");
  const cardsHint    = document.getElementById("cards-hint");
  const cardsActions = document.getElementById("cards-actions");
  const cardsStamp   = document.getElementById("cards-env-stamp");
  const btnCardsNext = document.getElementById("btn-cards-next");

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // The five ruled answer lines, filled with the user's answer (split by
  // newline) — or "לא יודע/ת" when the question was skipped.
  function buildAnswerLines(i) {
    const parts = state.dontKnow[i]
      ? ["לא יודע/ת"]
      : String(state.answers[i] || "").split("\n");
    let html = "";
    for (let k = 0; k < 5; k++) {
      const label = k === 0 ? '<span class="qform-label">תשובה</span>' : "";
      html += '<div class="answer-line">' + label +
              '<span class="line__text">' + esc(parts[k] || "") + "</span></div>";
    }
    return html;
  }

  // A single summary card, marked up exactly like the live .qform sheets.
  function cardFormHTML(i) {
    return '' +
      '<article class="qform">' +
        '<div class="qform-grid">' +
          '<div class="qform-row qform-header">' +
            '<div class="qform-cell"><span class="qform-label">שם העונה</span>' +
              '<span class="qform-value">' + esc(state.name) + '</span></div>' +
            '<div class="qform-cell"><span class="qform-label">על</span>' +
              '<span class="qform-value">' + esc(questionAbouts[i] || "") + '</span></div>' +
            '<div class="qform-cell"><span class="qform-label">תאריך</span>' +
              '<span class="qform-value">' + esc(state.date) + '</span></div>' +
            '<div class="qform-cell qform-cell-num"><span class="qform-label">מס׳ שאלה</span>' +
              '<span class="qform-value qform-num">' + (i + 1) + '/' + questions.length + '</span></div>' +
          '</div>' +
          '<div class="qform-row qform-question-row"><span class="qform-label">שאלה</span>' +
            '<div class="qform-question-text">' + esc(questions[i]) + '</div></div>' +
          '<div class="qform-row qform-answer-row">' + buildAnswerLines(i) + '</div>' +
        '</div>' +
      '</article>';
  }

  let cardsSealed = false;

  function initCards() {
    cardsStage.innerHTML = "";
    cardsScene.classList.remove("is-sealing", "is-sealed", "is-stamped");
    cardsHint.classList.remove("is-hidden");
    cardsActions.classList.remove("is-visible");
    btnCardsNext.disabled = true;
    cardsSealed = false;

    // Build the pile: the last question sits crisp on top, the earlier
    // ones fan out behind it (same tilt/offset as the question pile).
    questions.forEach((q, i) => {
      const sheet = document.createElement("div");
      if (i === questions.length - 1) {
        sheet.className = "qform-sheet qform-sheet--active";
        sheet.style.zIndex = "100";
      } else {
        const angle = STACK_ANGLES[i % STACK_ANGLES.length];
        sheet.className = "qform-sheet qform-sheet--stacked";
        sheet.style.zIndex = String(i + 1);
        sheet.style.setProperty("--stack-rot", angle + "deg");
        sheet.style.setProperty("--stack-x", (Math.sign(angle) * (24 + i * 16)) + "px");
        sheet.style.setProperty("--stack-y", (8 + i * 14) + "px");
      }
      sheet.innerHTML = cardFormHTML(i);
      cardsStage.appendChild(sheet);
    });

    const answeredCount = state.dontKnow.filter(x => !x).length;
    cardsStamp.textContent = answeredCount + "/" + questions.length;
  }

  // Scroll-triggered finish: pile shrinks, the open envelope rises from
  // below and closes, a red stamp lands, then the continue button lights up.
  function sealCards() {
    if (cardsSealed) return;
    cardsSealed = true;
    cardsHint.classList.add("is-hidden");
    cardsScene.classList.add("is-sealing");                       // pile shrinks, envelope rises
    setTimeout(() => cardsScene.classList.add("is-sealed"), 850); // flap closes
    setTimeout(() => cardsScene.classList.add("is-stamped"), 1500); // red stamp
    setTimeout(() => {                                            // continue lights up
      cardsActions.classList.add("is-visible");
      btnCardsNext.disabled = false;
    }, 1950);
  }

  function cardsScrollIntent() {
    if (!screens.cards.classList.contains("active")) return;
    sealCards();
  }
  cardsWrap.addEventListener("wheel", cardsScrollIntent, { passive: true });
  cardsWrap.addEventListener("touchmove", cardsScrollIntent, { passive: true });
  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "PageDown" || e.key === " ") {
      cardsScrollIntent();
    }
  });

  btnCardsNext.addEventListener("click", () => {
    if (btnCardsNext.disabled) return;
    initLegacy();
    showScreen("legacy");
  });

  // ============================================================
  // PHASE.CAMERA — depositor photo
  // ============================================================
  const cameraVideo   = document.getElementById("camera-video");
  const cameraCanvas  = document.getElementById("camera-canvas");
  const cameraPhoto   = document.getElementById("camera-photo");
  const cameraMsg     = document.getElementById("camera-msg");
  const cameraShutter = document.getElementById("camera-shutter");
  const cameraRetake  = document.getElementById("camera-retake");
  const btnCameraNext = document.getElementById("btn-camera-next");
  const btnCameraBack = document.getElementById("btn-camera-back");

  let cameraStream = null;

  // Always release the camera (turns the webcam light off) on any exit
  function stopCameraStream() {
    if (cameraStream) {
      cameraStream.getTracks().forEach(t => t.stop());
      cameraStream = null;
    }
  }

  async function initCameraScreen() {
    // reset to live-preview state
    cameraPhoto.hidden = true;
    cameraPhoto.removeAttribute("src");
    cameraVideo.hidden = false;
    cameraMsg.hidden = true;
    cameraMsg.textContent = "";
    cameraRetake.hidden = true;
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
    cameraRetake.hidden = false;
  });

  cameraRetake.addEventListener("click", () => {
    state.photoDataUrl = "";
    initCameraScreen();
  });

  btnCameraNext.addEventListener("click", () => {
    if (btnCameraNext.disabled) return;
    stopCameraStream();
    showScreen("print");
  });

  btnCameraBack.addEventListener("click", () => {
    stopCameraStream();
    showScreen("legacy");
  });

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
  const pCode    = document.getElementById("p-code");
  const pLegacy  = document.getElementById("p-legacy");
  const pQuestions = document.getElementById("p-questions");
  const pPhotos  = document.getElementById("p-photos");
  const pVideos  = document.getElementById("p-videos");
  const btnPersonalToGeneral = document.getElementById("btn-personal-to-general");
  const btnPersonalRestart   = document.getElementById("btn-personal-restart");

  // Drawer-upload state. Only photos (folder 0) and videos (folder 1) are
  // uploadable for now; each maps to an accepted file type.
  let currentDrawerCode = "";
  let activeFolderIdx = 3;
  const FOLDER_CATEGORY = { 0: "image", 1: "video" };

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
      // The depositor's session photo (not on Drive) leads the owner's gallery
      if (state.photoDataUrl && currentDrawerCode === state.userCode) {
        html += '<img class="drawer-file" alt="תמונת המפקיד" src="' + state.photoDataUrl + '">';
      }
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

  // Open the drawer interior (folder dividers) for a given viewer and
  // show the screen. "דברים שכתבתי" = legacy text; "השאלות מההתחלה" =
  // the 7 answers (full data for the user's own drawer via state; for DB
  // drawers only when the sheet returns q1..q7 via viewer.answers).
  function openDrawerInterior(viewer) {
    if (!viewer) return;
    // Owner view = logged-in session whose code matches this drawer's code.
    const _sess = getSession();
    ownerView = !!(_sess && _sess.code && viewer.code && _sess.code === viewer.code);
    currentDrawerCode = viewer.code || "";
    pName.textContent   = viewer.name || "(ללא שם)";
    pCode.textContent   = viewer.code || "";
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

    pQuestions.innerHTML = "";
    if (answers) {
      questions.forEach((q, i) => {
        const isDk = dontKnow && dontKnow[i];
        const ans  = isDk ? "לא יודע/ת" : (answers[i] || "(אין תשובה)");
        const li = document.createElement("li");
        li.className = "q-item";
        const qDiv = document.createElement("div");
        qDiv.className = "q-item-q";
        qDiv.textContent = (i + 1) + ". " + q;
        const aDiv = document.createElement("div");
        aDiv.className = "q-item-a" + (isDk ? " dk" : "");
        aDiv.textContent = ans;
        li.appendChild(qDiv);
        li.appendChild(aDiv);
        pQuestions.appendChild(li);
      });
    } else {
      pQuestions.innerHTML = '<div class="folder-empty">עדיין אין כאן תוכן</div>';
    }

    activateFolder(3); // front divider: "השאלות מההתחלה" (right tab, closest)
    loadDrawerFiles(currentDrawerCode); // populate the photos/videos galleries
    showScreen("personal");
  }

  // Folder dividers: clicking a tab brings its divider to the front
  const folderTabs   = Array.from(document.querySelectorAll("#screen-personal .folder-tab"));
  const folderBodies = Array.from(document.querySelectorAll("#screen-personal .folder-body"));
  // Default front→back order by tab side: right, left, right, left —
  // השאלות(3,R), דברים שכתבתי(2,L), סרטונים(1,R), תמונות(0,L)
  let stackOrder = [3, 2, 1, 0];
  function activateFolder(idx) {
    activeFolderIdx = idx;
    // Bring the clicked divider to the front; the rest keep their order,
    // so the clicked sheet slides forward (animated via the CSS transition).
    stackOrder = [idx].concat(stackOrder.filter(i => i !== idx));
    stackOrder.forEach((folderIndex, rank) => {
      const body = folderBodies[folderIndex];
      if (!body) return;
      body.style.setProperty("--rank", rank);
      body.style.zIndex = String(10 - rank);
      body.classList.toggle("is-active", rank === 0);
    });
    folderTabs.forEach((t, i) => t.classList.toggle("is-active", i === idx));
    // The + (upload) button shows only for the owner, and only on the
    // uploadable folders — תמונות (0) and סרטונים (1). Read-only otherwise.
    if (btnPersonalToGeneral) {
      btnPersonalToGeneral.style.display =
        (ownerView && (idx === 0 || idx === 1)) ? "" : "none";
    }
  }
  folderTabs.forEach((tab, i) => tab.addEventListener("click", () => activateFolder(i)));
  activateFolder(3); // default front divider: "השאלות מההתחלה" (right tab, closest)

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
        isUser: true
      });
    }
    return list;
  }

  // Build one archive drawer element for the landing drawer wall.
  function buildDrawerEl(v) {
    const d = document.createElement("div");
    d.className = "wall-drawer" + (v.isUser ? " active-drawer" : "");
    d.setAttribute("data-name", v.name);
    const plate = document.createElement("div");
    plate.className = "wall-plate";
    const nameEl = document.createElement("span");
    nameEl.className = "wall-plate-name";
    nameEl.textContent = v.name;
    const boxEl = document.createElement("span");
    boxEl.className = "wall-plate-box"; // decorative, stays empty (not the code)
    plate.appendChild(nameEl);
    plate.appendChild(boxEl);
    d.appendChild(plate);

    // Owner (logged-in, code matches) skips the code prompt; everyone
    // else must enter the drawer's code to view it.
    d.addEventListener("click", () => {
      const sess = getSession();
      if (sess && sess.code && sess.code === v.code) {
        activeViewer = v;
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
  loadViewersFromDB();
  showScreen("landing");
})();
