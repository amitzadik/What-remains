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
    userCode: "",
    date: new Date().toLocaleDateString("he-IL", {
      day: "2-digit", month: "2-digit", year: "2-digit"
    })
  };

  // ============================================================
  // Screen routing
  // ============================================================
  const screens = {
    splash:    document.getElementById("screen-splash"),
    questions: document.getElementById("screen-questions"),
    legacy:    document.getElementById("screen-legacy"),
    print:     document.getElementById("screen-print"),
    personal:  document.getElementById("screen-personal"),
    general:   document.getElementById("screen-general")
  };

  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove("active"));
    if (screens[name]) screens[name].classList.add("active");
  }

  // ============================================================
  // Splash
  // ============================================================
  const nameInput  = document.getElementById("user-name");
  const emailInput = document.getElementById("user-email");
  const btnDeposit = document.getElementById("btn-deposit");
  const btnBrowse  = document.getElementById("btn-browse");

  function emailValid(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }

  function checkDepositBtn() {
    btnDeposit.disabled = !(nameInput.value.trim() !== "" && emailValid(emailInput.value));
  }
  nameInput.addEventListener("input", checkDepositBtn);
  emailInput.addEventListener("input", checkDepositBtn);

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

  btnBrowse.addEventListener("click", () => {
    renderGeneralArchive();
    showScreen("general");
  });

  // ============================================================
  // Questions (contenteditable lines, disabled-until-typed next)
  // ============================================================
  const qNum   = document.getElementById("q-num");
  const qDate  = document.getElementById("q-date");
  const qName  = document.getElementById("q-name");
  const qText  = document.getElementById("q-text");
  const btnNext = document.getElementById("btn-next-q");
  const btnDk   = document.getElementById("btn-dk-q");
  const lines = Array.from(document.querySelectorAll("#lines .line__text"));

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
      initLegacy();
      showScreen("legacy");
      return;
    }
    renderQuestion();
  }

  lines.forEach(line => {
    line.addEventListener("input", updateNextAvailability);
    line.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const idx = Number(line.dataset.line);
        const next = lines[idx + 1];
        if (next) { next.focus(); placeCaretAtEnd(next); }
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
    if (getAnswerText() === "") return;
    handleAnswer(false);
  });
  btnDk.addEventListener("click", () => {
    if (btnDk.disabled) return;
    handleAnswer(true);
  });

  // ============================================================
  // Legacy
  // ============================================================
  const legacyName = document.getElementById("legacy-name");
  const legacyDate = document.getElementById("legacy-date");
  const legacyTextEl = document.getElementById("legacy-text");
  const btnLegacyNext = document.getElementById("btn-legacy-next");

  function initLegacy() {
    legacyName.textContent = state.name;
    legacyDate.textContent = state.date;
    legacyTextEl.value = "";
    btnLegacyNext.disabled = true;
    setTimeout(() => legacyTextEl.focus(), 50);
  }

  legacyTextEl.addEventListener("input", () => {
    btnLegacyNext.disabled = legacyTextEl.value.trim() === "";
  });

  btnLegacyNext.addEventListener("click", () => {
    const txt = legacyTextEl.value.trim();
    if (txt === "") return;
    state.legacyText = txt;
    initPrint();
    showScreen("print");
  });

  // ============================================================
  // Print / envelope instructions
  // ============================================================
  const pcName   = document.getElementById("pc-name");
  const pcCode   = document.getElementById("pc-code");
  const pcLegacy = document.getElementById("pc-legacy");
  const btnToArchive = document.getElementById("btn-to-archive");

  function initPrint() {
    pcName.textContent   = state.name;
    pcCode.textContent   = state.userCode;
    pcLegacy.textContent = state.legacyText;
  }

  btnToArchive.addEventListener("click", () => {
    renderPersonalArchive();
    showScreen("personal");
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
    renderGeneralArchive();
    showScreen("general");
  });

  btnPersonalRestart.addEventListener("click", restartFlow);

  // ============================================================
  // General archive (wall of drawers + code modal + content modal)
  // ============================================================
  const wall       = document.getElementById("wall");
  const countText  = document.getElementById("count-text");
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

  function renderGeneralArchive() {
    wall.innerHTML = "";
    const drawers = allDrawers();
    countText.textContent = drawers.length + " מגירות בארכיון";

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
      wall.appendChild(d);
    });
  }

  function openCodeModal(viewer, drawerEl) {
    activeViewer = viewer;
    activeDrawerEl = drawerEl;
    codeTarget.textContent = "המגירה של " + viewer.name;
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
    state.userCode = "";

    nameInput.value = "";
    emailInput.value = "";
    legacyTextEl.value = "";
    clearLines();
    checkDepositBtn();

    codeModal.classList.remove("active");
    contentModal.classList.remove("active");

    showScreen("splash");
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
  checkDepositBtn();
  showScreen("splash");
})();
