(() => {
  const TOTAL_QUESTIONS = 7;
  const CURRENT_QUESTION = 1;

  // Three phrasing levels: original, simpler, even simpler.
  // The "Simpler" buttons step the question down to a friendlier wording.
  const QUESTION_LEVELS = [
    "What is the earliest memory you have of your family?",
    "What is the first thing you remember about your family?",
    "Tell me one early memory of your family."
  ];

  const counterEl  = document.getElementById("counter");
  const questionEl = document.getElementById("question-text");
  const simplerBtn = document.getElementById("simpler-btn");
  const simplerAltBtn = document.getElementById("simpler-alt-btn");
  const lines = Array.from(document.querySelectorAll(".line__text"));

  let currentLevel = 0; // 0 = original, 1 = simpler, 2 = even simpler

  counterEl.textContent = `Question ${CURRENT_QUESTION}/${TOTAL_QUESTIONS}`;

  function renderQuestion() {
    questionEl.textContent = QUESTION_LEVELS[currentLevel];

    // Active state reflects which simplification (if any) is currently shown.
    simplerBtn.classList.toggle("is-active", currentLevel === 1);
    simplerAltBtn.classList.toggle("is-active", currentLevel === 2);

    // The "Simpler" pair stays disabled until the writer has put something
    // on the page — the prompt only steps down once they've started.
    const hasContent = lines.some(l => l.textContent.trim().length > 0);

    // "Simpler" goes to level 1; disabled if no content or already past level 1.
    simplerBtn.disabled    = !hasContent || currentLevel >= 1;
    // "Even simpler" goes to level 2; disabled until at level 1 (or content + level 0 ok too).
    simplerAltBtn.disabled = !hasContent || currentLevel >= 2;
  }

  function updateButtonAvailability() {
    const hasContent = lines.some(l => l.textContent.trim().length > 0);
    simplerBtn.disabled    = !hasContent || currentLevel >= 1;
    simplerAltBtn.disabled = !hasContent || currentLevel >= 2;
  }

  // Typing on any line wakes the Simpler buttons up.
  lines.forEach(line => {
    line.addEventListener("input", updateButtonAvailability);

    // Enter on a line moves to the next line instead of inserting a break.
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

    // Strip pasted formatting so it stays handwritten-looking.
    line.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData("text");
      document.execCommand("insertText", false, text.replace(/\n/g, " "));
    });
  });

  simplerBtn.addEventListener("click", () => {
    if (simplerBtn.disabled) return;
    currentLevel = 1;
    renderQuestion();
  });

  simplerAltBtn.addEventListener("click", () => {
    if (simplerAltBtn.disabled) return;
    currentLevel = 2;
    renderQuestion();
  });

  function placeCaretAtEnd(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // Start with the first line focused so the writer can begin immediately.
  if (lines[0]) lines[0].focus();

  renderQuestion();
})();
