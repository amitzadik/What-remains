(() => {
  const questions = [
    "באיזו שפה סבא וסבתא דיברו בבית?",
    "מה סבא אהב לעשות?",
    "מה גרם לסבתא לצחוק?",
    "ממה סבא פחד?",
    "על מה סבתא חלמה ולא הגשימה?",
    "על מה סבא לא דיבר?",
    "מתי נולד סבא?"
  ];

  const state = {
    name: "",
    currentQuestion: 0,
    answers: [],
    dontKnow: [],
    date: new Date().toLocaleDateString("he-IL", {
      day: "2-digit", month: "2-digit", year: "2-digit"
    })
  };

  const qNum   = document.getElementById("q-num");
  const qDate  = document.getElementById("q-date");
  const qName  = document.getElementById("q-name");
  const qText  = document.getElementById("q-text");
  const linesEl = document.getElementById("lines");
  const btnNext = document.getElementById("btn-next-q");
  const btnDk   = document.getElementById("btn-dk-q");

  const lines = Array.from(linesEl.querySelectorAll(".line__text"));

  qDate.textContent = state.date;
  qName.textContent = state.name;

  function getAnswerText() {
    return lines
      .map(l => l.textContent.trim())
      .filter(Boolean)
      .join("\n");
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

  function handleAnswer(isDontKnow) {
    state.answers[state.currentQuestion]  = isDontKnow ? null : getAnswerText();
    state.dontKnow[state.currentQuestion] = isDontKnow;
    state.currentQuestion = (state.currentQuestion + 1) % questions.length;
    renderQuestion();
  }

  lines.forEach(line => {
    line.addEventListener("input", updateNextAvailability);

    line.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const idx = Number(line.dataset.line);
        const next = lines[idx + 1];
        if (next) {
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
    if (getAnswerText() === "") return;
    handleAnswer(false);
  });

  btnDk.addEventListener("click", () => {
    if (btnDk.disabled) return;
    handleAnswer(true);
  });

  function placeCaretAtEnd(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  renderQuestion();
})();
