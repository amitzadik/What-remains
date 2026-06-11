(() => {
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
  // Landing (PHASE.LANDING) — cabinet wall + intro card + stamps
  // ============================================================
  const landingBg = document.getElementById("landing-bg");
  const landingOverlay = document.getElementById("landing-overlay");
  const landingCard    = document.getElementById("landing-card");
  const stampSearch = document.getElementById("stamp-search");
  const stampAdd    = document.getElementById("stamp-add");

  const CABINET_LABELS = [
    "א-ב","ב-ג","ג-ד","ד-ה","ה-ו","ו-ז","ז-ח","ח-ט","ט-י","י-כ",
    "כ-ל","ל-מ","מ-נ","נ-ס","ס-ע","ע-פ","פ-צ","צ-ק","ק-ר","ר-ש","ש-ת"
  ];

  function wheelSVG() {
    return (
      '<svg class="cabinet-wheel" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<circle cx="50" cy="50" r="44" fill="none" stroke="#3D3628" stroke-width="3"/>' +
        '<line x1="50" y1="6"  x2="50" y2="94" stroke="#3D3628" stroke-width="8" stroke-linecap="round"/>' +
        '<line x1="6"  y1="50" x2="94" y2="50" stroke="#3D3628" stroke-width="8" stroke-linecap="round"/>' +
        '<circle cx="50" cy="50" r="9" fill="#3D3628"/>' +
      '</svg>'
    );
  }

  function renderCabinetWall() {
    if (!landingBg || landingBg.childElementCount) return;
    CABINET_LABELS.forEach(label => {
      const col = document.createElement("div");
      col.className = "cabinet-col";
      const tag = document.createElement("div");
      tag.className = "cabinet-label";
      tag.textContent = label;
      col.appendChild(tag);
      col.insertAdjacentHTML("beforeend", wheelSVG());
      landingBg.appendChild(col);

      // Hovering the wheel pushes neighbours apart and spins this wheel
      const wheel = col.querySelector(".cabinet-wheel");
      if (wheel) {
        wheel.addEventListener("mouseenter", () => activateCabinetCol(landingBg, col, LANDING_RIGHT_TEAM_LAST));
        wheel.addEventListener("mouseleave", () => resetCabinetCols(landingBg));
      }
    });

    centerWall(landingBg);
  }

  // On the landing wall the first 11 cabinets are the right team, last 10
  // the left team. On the archive wall the split is computed from the
  // cabinet count (so an even/odd split based on the people present).
  const LANDING_RIGHT_TEAM_LAST = 10;
  const EDGE_SCROLL_SPEED = 2; // px per frame

  function activateCabinetCol(wallEl, targetCol, rightTeamLast) {
    if (!wallEl) return;
    const cols = Array.from(wallEl.children).filter(c => c.classList.contains("cabinet-col"));
    const targetIndex = cols.indexOf(targetCol);
    if (targetIndex < 0) return;
    const splitPoint = (typeof rightTeamLast === "number")
      ? rightTeamLast
      : Math.ceil(cols.length / 2) - 1;
    const isRightTeam = targetIndex <= splitPoint;

    cols.forEach((col, i) => {
      col.classList.remove("is-pushed-right", "is-pushed-left", "is-spinning");
      if (isRightTeam && i <= targetIndex) {
        col.classList.add("is-pushed-right");
      } else if (!isRightTeam && i >= targetIndex) {
        col.classList.add("is-pushed-left");
      }
    });

    void targetCol.offsetWidth; // restart spin animation
    targetCol.classList.add("is-spinning");
  }

  function resetCabinetCols(wallEl) {
    if (!wallEl) return;
    Array.from(wallEl.children).forEach(col => {
      col.classList.remove("is-pushed-right", "is-pushed-left", "is-spinning");
    });
  }

  // Center the strip so middle cabinets sit in the viewport on first render
  function centerWall(wallEl) {
    if (!wallEl) return;
    requestAnimationFrame(() => {
      const maxScroll = wallEl.scrollWidth - wallEl.clientWidth;
      if (maxScroll <= 0) return;
      const isRTL = getComputedStyle(wallEl).direction === "rtl";
      wallEl.scrollLeft = (isRTL ? -1 : 1) * (maxScroll / 2);
    });
  }

  // Hover-driven edge auto-scroll, scoped to a given wall + zones
  function bindEdgeScroll(wallEl, leftZoneEl, rightZoneEl) {
    if (!wallEl) return;
    let raf = null;
    let dir = 0;

    function loop() {
      if (dir === 0) { raf = null; return; }
      wallEl.scrollLeft += dir * EDGE_SCROLL_SPEED;
      raf = requestAnimationFrame(loop);
    }
    function start(direction) {
      if (dir === direction) return;
      dir = direction;
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    }
    function stop() {
      dir = 0;
      if (raf) { cancelAnimationFrame(raf); raf = null; }
    }

    if (rightZoneEl) {
      rightZoneEl.addEventListener("mouseenter", () => start(+1));
      rightZoneEl.addEventListener("mouseleave", stop);
    }
    if (leftZoneEl) {
      leftZoneEl.addEventListener("mouseenter", () => start(-1));
      leftZoneEl.addEventListener("mouseleave", stop);
    }
  }

  const scrollZoneLeft  = document.getElementById("scroll-zone-left");
  const scrollZoneRight = document.getElementById("scroll-zone-right");
  bindEdgeScroll(landingBg, scrollZoneLeft, scrollZoneRight);

  const archiveScrollLeft  = document.getElementById("archive-scroll-zone-left");
  const archiveScrollRight = document.getElementById("archive-scroll-zone-right");
  const archiveWallEl      = document.getElementById("archive-wall");
  bindEdgeScroll(archiveWallEl, archiveScrollLeft, archiveScrollRight);

  // Click outside the card (on the overlay) dismisses it
  if (landingOverlay) {
    landingOverlay.addEventListener("click", (e) => {
      if (e.target === landingOverlay) {
        landingOverlay.classList.add("is-hidden");
      }
    });
  }

  // Flip buttons on both sides of the landing popup card
  const landingCardInner = document.getElementById("landing-card-inner");
  ["btn-card-flip-left", "btn-card-flip-right"].forEach(id => {
    const btn = document.getElementById(id);
    if (btn && landingCardInner) {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        landingCardInner.classList.toggle("is-flipped");
      });
    }
  });

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
    qDate.textContent = state.date;
    qName.textContent = state.name;
    renderQuestion();
  }

  function handleAnswer(isDontKnow) {
    state.answers[state.currentQuestion]  = isDontKnow ? null : getAnswerText();
    state.dontKnow[state.currentQuestion] = isDontKnow;
    state.currentQuestion++;
    if (state.currentQuestion >= questions.length) {
      initCards();
      showScreen("cards");
      return;
    }
    animateNextQuestion(() => renderQuestion());
  }

  // Stack-of-papers transition between questions: the current form is
  // cloned and pinned in place (it never moves), and the next form drops
  // IN from above the stage, landing on top of the clone. The stage's
  // CSS scale fits the pair to the viewport.
  let isQuestionTransitioning = false;
  function animateNextQuestion(advanceCallback) {
    const stage = document.querySelector("#screen-questions .qform-stage");
    const form = stage && stage.querySelector(".qform");
    if (!stage || !form || isQuestionTransitioning) {
      advanceCallback();
      return;
    }
    isQuestionTransitioning = true;

    // Clone the current form and overlay it inside the same stage
    const clone = form.cloneNode(true);
    clone.classList.add("is-departing");
    clone.style.pointerEvents = "none";
    clone.removeAttribute("id");
    clone.querySelectorAll("[id]").forEach(el => el.removeAttribute("id"));
    stage.appendChild(clone);

    // Swap the real form's content for the next question
    advanceCallback();

    // Real form jumps above the stage, no transition
    form.classList.add("is-arriving");
    form.style.transition = "none";
    form.style.transform = "translateY(-100%)";
    void form.offsetWidth; // commit the jump

    // Only the new form animates — the clone stays perfectly still
    // underneath, so the bottom "sheet" never moves.
    form.style.transition = "transform 300ms ease-in";
    form.style.transform = "translateY(0)";

    setTimeout(() => {
      clone.remove();
      form.classList.remove("is-arriving");
      form.style.transition = "";
      form.style.transform = "";
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
    drawers.forEach(v => {
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
      archiveDetailDrawers.appendChild(d);
    });
  }

  if (btnBackToLetters) {
    btnBackToLetters.addEventListener("click", () => showScreen("landing"));
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
    if (btn) btn.querySelector('img').src = btn.dataset.hover;
  });
  document.addEventListener('mouseout', e => {
    const btn = e.target.closest('.img-btn');
    if (btn) btn.querySelector('img').src = btn.dataset.default;
  });

  checkDepositBtn();
  renderCabinetWall();
  showScreen("landing");
})();
