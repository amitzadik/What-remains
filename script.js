(() => {
  // ============================================================
  // Google Sheets webhook (Apps Script)
  // ============================================================
  const SHEET_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycby2VT25WhYQdVHaDYx0-FflX-iUgXBfE4Pfu4N0bqZNBwp1TXxCrew4fq_QMg58AL80qg/exec";

  // Fire-and-forget submission of the full questionnaire to the sheet.
  // Guarded by state.submitted so a row is written at most once per run.
  function submitToSheet() {
    if (state.submitted || !SHEET_WEBHOOK_URL) return;
    const q = i => state.dontKnow[i] ? "לא יודע/ת" : (state.answers[i] || "");
    const payload = {
      name: state.name || "", email: state.email || "", code: state.userCode || "",
      q1: q(0), q2: q(1), q3: q(2), q4: q(3), q5: q(4), q6: q(5), q7: q(6),
      legacy_text: state.legacyText || ""
    };
    try {
      fetch(SHEET_WEBHOOK_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
      });
      state.submitted = true;
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

  const pastViewers = [
    { name: "נועה",   code: "0001", archive: "שאני אהבתי לצייר ולא הפסקתי אף פעם" },
    { name: "יונתן",  code: "0002", archive: "שהייתי צוחק בקול הכי חזק בחדר" },
    { name: "דנה",    code: "0003", archive: "שפחדתי מהחושך אבל תמיד השארתי את הדלת פתוחה" },
    { name: "עומר",   code: "0004", archive: "שחלמתי ללמוד פסנתר" },
    { name: "מיכל",   code: "0005", archive: "שלא דיברתי מספיק על מה שכאב לי" },
    { name: "איתי",   code: "0006", archive: "שהמשפחה הייתה הדבר הכי חשוב" },
    { name: "שירה",   code: "0007", archive: "שאפיתי עוגת שוקולד בכל יום שישי" },
    { name: "אלון",   code: "0008", archive: "שרציתי לנסוע לים, תמיד" }
  ];

  const state = {
    name: "",
    email: "",
    currentQuestion: 0,
    answers: [],
    dontKnow: [],
    legacyText: "",
    recordMode: "",      // "text" or "audio"
    audioBlob: null,
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
    register:  document.getElementById("screen-register"),
    questions: document.getElementById("screen-questions"),
    cards:     document.getElementById("screen-cards"),
    envelope:  document.getElementById("screen-envelope"),
    legacy:    document.getElementById("screen-legacy"),
    record:    document.getElementById("screen-record"),
    print:     document.getElementById("screen-print"),
    personal:  document.getElementById("screen-personal"),
    general:   document.getElementById("screen-general")
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

  // The landing background shows the same archive drawer wall as the
  // general archive (built with buildDrawerEl, defined with the archive).
  function renderLandingDrawers() {
    if (!landingBg) return;
    landingBg.innerHTML = "";
    const drawers = allDrawers().sort((a, b) => a.name.localeCompare(b.name, "he"));
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

  [stampSearch, stampAdd].forEach(stamp => {
    if (!stamp) return;
    const def = stamp.src;
    const hov = stamp.dataset.hover;
    stamp.addEventListener("mouseenter", () => { if (hov) stamp.src = hov; });
    stamp.addEventListener("mouseleave", () => { stamp.src = def; });
  });

  function dismissLandingPopup() {
    if (landingOverlay) landingOverlay.classList.add("is-hidden");
  }

  if (stampSearch) {
    stampSearch.addEventListener("click", () => {
      dismissLandingPopup();
      archiveSource = "search";
      renderGeneralArchive();
      showScreen("general");
    });
  }
  if (stampAdd) {
    stampAdd.addEventListener("click", () => {
      dismissLandingPopup();
      checkDepositBtn();
      showScreen("register");
      setTimeout(() => nameInput.focus(), 60);
    });
  }

  // ============================================================
  // Register (name + email)
  // ============================================================
  const btnBackWelcome = document.getElementById("btn-back-welcome");
  const nameInput  = document.getElementById("user-name");
  const emailInput = document.getElementById("user-email");
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
    state.name  = nameInput.value.trim();
    state.email = emailInput.value.trim();
    state.userCode = String(pastViewers.length + 1).padStart(4, "0");
    state.currentQuestion = 0;
    state.answers = [];
    state.dontKnow = [];
    state.legacyText = "";
    initQuestions();
    showScreen("questions");
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

  function initQuestions() {
    // Clear any frozen sheets left over from a previous run
    const stage = document.querySelector("#screen-questions .qform-stage");
    if (stage) {
      stage.querySelectorAll(".qform-sheet--stacked").forEach(s => s.remove());
    }
    state.frozenCount = 0;
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
  const STACK_ANGLES = [-1.6, 1.3, -0.9, 1.8, -1.2, 0.7];

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
    frozen.style.setProperty("--stack-x", (angle * 2) + "px");
    frozen.style.setProperty("--stack-y", (4 + idx * 1.5) + "px");

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

    // Swap the live form's content for the next question
    advanceCallback();

    // Live form drops IN from above, landing straight on top of the pile
    liveForm.style.transition = "none";
    liveForm.style.transform = "translateY(-100%)";
    void liveForm.offsetWidth; // commit the jump
    liveForm.style.transition = "transform 300ms ease-in";
    liveForm.style.transform = "translateY(0)";

    setTimeout(() => {
      liveForm.style.transition = "";
      liveForm.style.transform = "";
      isQuestionTransitioning = false;
    }, 320);
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
    initRecordScreen();
    showScreen("record");
  });

  // ============================================================
  // PHASE.CARDS — stacked answer cards
  // ============================================================
  const cardsStack    = document.getElementById("cards-stack");
  const btnCardsNext  = document.getElementById("btn-cards-next");

  function initCards() {
    cardsStack.innerHTML = "";
    questions.forEach((q, i) => {
      const card = document.createElement("div");
      card.className = "stack-card";

      const label = document.createElement("div");
      label.className = "stack-card-label";
      label.textContent = q;

      const answer = document.createElement("div");
      answer.className = "stack-card-answer";
      if (state.dontKnow[i]) {
        answer.classList.add("is-empty");
      } else {
        answer.textContent = state.answers[i] || "";
      }

      card.appendChild(label);
      card.appendChild(answer);
      cardsStack.appendChild(card);
    });
  }

  btnCardsNext.addEventListener("click", () => {
    initEnvelope();
    showScreen("envelope");
  });

  // ============================================================
  // PHASE.ENVELOPE — cards slide into envelope, stamp appears
  // ============================================================
  const envStage      = document.getElementById("env-stage");
  const envCardsHost  = document.getElementById("env-cards");
  const envStamp      = document.getElementById("env-stamp");
  const btnEnvelopeNext = document.getElementById("btn-envelope-next");

  function initEnvelope() {
    envCardsHost.innerHTML = "";
    envStage.classList.remove("is-sealed");
    btnEnvelopeNext.disabled = true;

    const STAGGER = 0.35; // seconds between cards
    const DURATION = 0.55;
    questions.forEach((_, i) => {
      const card = document.createElement("div");
      card.className = "env-card";
      const rot = ((i % 2 === 0) ? -1 : 1) * (1 + Math.random() * 3);
      card.style.setProperty("--rot", rot + "deg");
      card.style.animationDelay = (i * STAGGER) + "s";
      envCardsHost.appendChild(card);
    });

    const answeredCount = state.dontKnow.filter(x => !x).length;
    envStamp.textContent = answeredCount + "/" + questions.length;

    const totalMs = (questions.length * STAGGER + DURATION) * 1000;
    setTimeout(() => {
      envStage.classList.add("is-sealed");
      btnEnvelopeNext.disabled = false;
    }, totalMs);
  }

  btnEnvelopeNext.addEventListener("click", () => {
    if (btnEnvelopeNext.disabled) return;
    initLegacy();
    showScreen("legacy");
  });

  // ============================================================
  // PHASE.RECORD — text or audio choice + recorder
  // ============================================================
  const recordOptions    = document.getElementById("record-options");
  const recordPanel      = document.getElementById("record-panel");
  const btnRecordText    = document.getElementById("btn-record-text");
  const btnRecordAudio   = document.getElementById("btn-record-audio");
  const recordCircleBtn  = document.getElementById("record-circle-btn");
  const recordStatus     = document.getElementById("record-status");
  const recordTimerEl    = document.getElementById("record-timer");
  const btnRecordDone    = document.getElementById("btn-record-done");

  let mediaRecorder = null;
  let audioChunks = [];
  let recordTimerInterval = null;
  let recordStartTime = 0;

  function initRecordScreen() {
    state.recordMode = "";
    state.audioBlob = null;
    recordOptions.style.display = "";
    recordPanel.hidden = true;
    recordStatus.textContent = "לחץ להתחיל";
    recordTimerEl.textContent = "00:00";
    recordCircleBtn.classList.remove("is-recording");
    btnRecordDone.disabled = true;
  }

  btnRecordText.addEventListener("click", () => {
    state.recordMode = "text";
    showScreen("print");
  });

  btnRecordAudio.addEventListener("click", () => {
    state.recordMode = "audio";
    recordOptions.style.display = "none";
    recordPanel.hidden = false;
  });

  function updateRecordTimer() {
    const elapsed = Math.floor((Date.now() - recordStartTime) / 1000);
    const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
    const ss = String(elapsed % 60).padStart(2, "0");
    recordTimerEl.textContent = mm + ":" + ss;
  }

  recordCircleBtn.addEventListener("click", async () => {
    if (!mediaRecorder || mediaRecorder.state === "inactive") {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunks.push(e.data);
        };
        mediaRecorder.onstop = () => {
          state.audioBlob = new Blob(audioChunks, { type: "audio/webm" });
          stream.getTracks().forEach(t => t.stop());
          recordStatus.textContent = "ההקלטה נשמרה";
          btnRecordDone.disabled = false;
        };
        mediaRecorder.start();
        recordStartTime = Date.now();
        recordStatus.textContent = "מקליט… לחץ לעצירה";
        recordCircleBtn.classList.add("is-recording");
        recordTimerInterval = setInterval(updateRecordTimer, 200);
      } catch (err) {
        recordStatus.textContent = "אין הרשאה למיקרופון";
      }
    } else {
      mediaRecorder.stop();
      recordCircleBtn.classList.remove("is-recording");
      clearInterval(recordTimerInterval);
    }
  });

  btnRecordDone.addEventListener("click", () => {
    showScreen("print");
  });

  // ============================================================
  // PHASE.PRINT_INSTRUCTIONS — simple text → ARCHIVE
  // ============================================================
  const btnToArchive = document.getElementById("btn-to-archive");
  btnToArchive.addEventListener("click", () => {
    archiveSource = "questionnaire";
    renderGeneralArchive();
    showScreen("general");
  });

  // ============================================================
  // Personal archive (the user's own drawer)
  // ============================================================
  const pName    = document.getElementById("p-name");
  const pCode    = document.getElementById("p-code");
  const pLegacy  = document.getElementById("p-legacy");
  const pQuestions = document.getElementById("p-questions");
  const btnPersonalToGeneral = document.getElementById("btn-personal-to-general");
  const btnPersonalRestart   = document.getElementById("btn-personal-restart");

  function renderPersonalArchive() {
    pName.textContent = state.name || "(ללא שם)";
    pCode.textContent = state.userCode;
    pLegacy.textContent = state.legacyText || "(אין טקסט מורשת)";
    pQuestions.innerHTML = "";

    questions.forEach((q, i) => {
      const isDk = state.dontKnow[i];
      const ans  = isDk ? "לא יודע/ת" : (state.answers[i] || "(אין תשובה)");
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
  }

  btnPersonalToGeneral.addEventListener("click", () => {
    archiveSource = "questionnaire";
    renderGeneralArchive();
    showScreen("general");
  });

  btnPersonalRestart.addEventListener("click", restartFlow);

  // ============================================================
  // General archive
  // archiveSource: "search" | "questionnaire" — controls home button image
  let archiveSource = "search";
  // ============================================================
  const countText         = document.getElementById("count-text");
  const searchInput       = document.getElementById("drawer-search");
  const btnGeneralRestart = document.getElementById("btn-general-restart");

  const codeModal        = document.getElementById("code-modal");
  const codeModalContent = document.getElementById("code-modal-content");
  const codeTarget       = document.getElementById("code-target");
  const codeInput        = document.getElementById("drawer-code-input");
  const errMsg           = document.getElementById("err-msg");
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

  const archiveDetailDrawers = document.getElementById("archive-detail-drawers");
  const btnBackToLetters     = document.getElementById("btn-back-to-letters");

  // Build one archive drawer element — shared by the general archive
  // grid and the landing background wall.
  function buildDrawerEl(v) {
    const d = document.createElement("div");
    d.className = "wall-drawer" + (v.isUser ? " active-drawer" : "");
    d.setAttribute("data-name", v.name);
    const plate = document.createElement("div");
    plate.className = "wall-plate";
    plate.textContent = v.name;
    d.appendChild(plate);

    d.addEventListener("click", () => {
      if (v.isUser) {
        showContent(v.name, v.archive);
      } else {
        openCodeModal(v, d);
      }
    });
    return d;
  }

  function renderGeneralArchive() {
    // Update home/add-new button based on how user arrived at archive
    if (btnBackToLetters) {
      if (archiveSource === "questionnaire") {
        btnBackToLetters.dataset.default = "images/home-default.png";
        btnBackToLetters.dataset.hover   = "images/home-hover.png";
      } else {
        btnBackToLetters.dataset.default = "images/add-new-default.png";
        btnBackToLetters.dataset.hover   = "images/add-new-hover.png";
      }
      btnBackToLetters.querySelector("img").src = btnBackToLetters.dataset.default;
    }

    const drawers = allDrawers().sort((a, b) => a.name.localeCompare(b.name, "he"));
    if (countText) countText.textContent = drawers.length + " מגירות בארכיון";

    archiveDetailDrawers.innerHTML = "";
    drawers.forEach(v => archiveDetailDrawers.appendChild(buildDrawerEl(v)));
  }

  if (btnBackToLetters) {
    btnBackToLetters.addEventListener("click", () => {
      renderLandingDrawers(); // refresh — the user's drawer may have been added
      showScreen("landing");
    });
  }

  // Search is no longer surfaced in the archive UI; keep a no-op filter
  // so legacy callers (restartFlow, future search) don't throw.
  function applySearchFilter() { /* no-op */ }

  if (searchInput && searchInput.addEventListener) {
    searchInput.addEventListener("input", () => applySearchFilter());
  }

  // Per-drawer code entry — the modal targets a specific viewer and
  // matches only against that drawer's code.
  function openCodeModal(viewer, drawerEl) {
    activeViewer = viewer || null;
    activeDrawerEl = drawerEl || null;
    codeTarget.textContent = viewer ? ("המגירה של " + viewer.name) : "הזינ/י את קוד המגירה";
    codeInput.value = "";
    errMsg.textContent = "";
    codeModal.classList.add("active");
    setTimeout(() => codeInput.focus(), 50);
  }

  function checkCode() {
    if (!activeViewer) return;
    const input = codeInput.value.trim();
    if (input === activeViewer.code) {
      codeModal.classList.remove("active");
      setTimeout(() => showContent(activeViewer.name, activeViewer.archive), 300);
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
    }
  }

  function showContent(name, text) {
    contentName.textContent = "מגירה של " + name;
    contentText.textContent = text || "(אין טקסט)";
    contentModal.classList.add("active");
  }

  btnCloseCode.addEventListener("click", () => codeModal.classList.remove("active"));
  btnSubmitCode.addEventListener("click", checkCode);
  codeInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") checkCode();
  });
  btnCloseContent.addEventListener("click", () => contentModal.classList.remove("active"));

  btnGeneralRestart.addEventListener("click", restartFlow);

  // ============================================================
  // Restart
  // ============================================================
  function restartFlow() {
    state.name = "";
    state.email = "";
    state.currentQuestion = 0;
    state.answers = [];
    state.dontKnow = [];
    state.legacyText = "";
    state.recordMode = "";
    state.audioBlob = null;
    state.userCode = "";
    state.submitted = false;

    nameInput.value = "";
    emailInput.value = "";
    clearLegacyLines();
    if (searchInput) {
      searchInput.value = "";
      applySearchFilter("");
    }
    clearLines();
    checkDepositBtn();
    initRecordScreen();

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
  renderLandingDrawers();
  showScreen("landing");
})();
