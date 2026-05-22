/**
 * sidepanel.js — GitShare Terminal v3
 *
 * v3 changes:
 *   • Stricter language auto-detection: requires a meaningful "code signal
 *     score" before attempting hljs auto-detect; low-confidence results fall
 *     back to plaintext so prose is never mis-labelled as SQL/Bash.
 *   • Copy button: copies raw text (no line numbers), shows "✓ Copied!" with
 *     green accent for 2 s then reverts — full SVG icon restored on reset.
 *   • Badge styling: plaintext uses a neutral grey palette vs the blue used
 *     for real languages, making the distinction visually obvious.
 */

document.addEventListener("DOMContentLoaded", () => {

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const placeholder   = document.getElementById("placeholder");
  const codeScroll    = document.getElementById("code-scroll");
  const codeBody      = document.getElementById("code-body");
  const codeEl        = document.getElementById("code-el");
  const gutter        = document.getElementById("gutter");
  const gutterInner   = document.getElementById("gutter-inner");
  const langBadge     = document.getElementById("lang-badge");
  const copyBtn       = document.getElementById("copy-btn");
  const statusLines   = document.getElementById("status-lines");
  const statusChars   = document.getElementById("status-chars");
  const statusLang    = document.getElementById("status-lang");
  const lineCountEl   = document.getElementById("line-count");
  const charCountEl   = document.getElementById("char-count");
  const langLabelEl   = document.getElementById("lang-label");
  const liveDot       = document.getElementById("live-dot");
  const statusLiveEl  = document.getElementById("status-live");

  if (!codeEl || !gutter || !placeholder) {
    console.error("GitShare: required DOM elements missing.");
    return;
  }

  // ── State ─────────────────────────────────────────────────────────────────
  let currentRawText = "";
  let copyTimer      = null;

  // ── hljs configuration ────────────────────────────────────────────────────
  hljs.configure({ ignoreUnescapedHTML: true });

  // ── Code-signal scoring — stricter than before ────────────────────────────
  //
  // Each rule carries a weight. We accumulate a score; auto-detection is only
  // attempted when the score clears CONFIDENCE_THRESHOLD. This prevents prose
  // sentences that happen to contain colons or dashes from triggering hljs.
  //
  // Rules are tuned so that:
  //   • A single {  }  or  () scores enough to attempt detection
  //   • SQL / Bash false-positives (caused by plain English words like "select",
  //     "from", "export", "echo") require an additional structural signal
  //   • Short prose with no brackets/operators never crosses the threshold
  //
  const CODE_SIGNALS = [
    // Strong structural signals (rare in prose)
    { pattern: /[{}]/, weight: 3 },                          // curly braces
    { pattern: /\(.*\)/, weight: 2 },                        // parentheses pair
    { pattern: /\[.*\]/, weight: 2 },                        // square-bracket pair
    { pattern: /;$|;\s*$/m, weight: 3 },                     // line-ending semicolons
    { pattern: /^\s*(def |function |class |import |const |let |var |pub |fn |func )/m, weight: 4 }, // declaration keywords
    { pattern: /^\s*(if|else|for|while|switch|return|yield)\s*[\(\{]/m, weight: 3 },  // control flow
    { pattern: /=>|->|::|<<|>>/, weight: 2 },                // operator combos
    { pattern: /^\s{4,}/m, weight: 1 },                      // 4-space indent (mild)
    { pattern: /\t\t/, weight: 1 },                          // double-tab indent (mild)
    // Markup
    { pattern: /<[a-zA-Z][^>]*>[\s\S]*?<\/[a-zA-Z]+>/, weight: 4 }, // HTML tag pairs
    { pattern: /^\s*[\w-]+:\s+\S/m, weight: 1 },             // YAML-style key: value
    // Data formats
    { pattern: /^\s*"[\w-]+":\s*["{[\d]/, weight: 3 },      // JSON key-value
    // Operators
    { pattern: /[+\-*\/%]=|===|!==|&&|\|\|/, weight: 2 },   // compound operators
  ];

  const CONFIDENCE_THRESHOLD = 4;

  /**
   * Returns a numeric confidence score indicating how likely the text is code.
   * Scoring is additive; first match per rule contributes its weight once.
   */
  function codeConfidenceScore(text) {
    return CODE_SIGNALS.reduce(
      (score, { pattern, weight }) => score + (pattern.test(text) ? weight : 0),
      0
    );
  }

  // Languages that are especially prone to false-positives on prose.
  // Even when hljs detects one of these, we require a higher confidence score
  // before accepting the result.
  const PRONE_TO_FP = new Set(["sql", "bash", "shell", "markdown", "yaml"]);
  const HIGH_CONFIDENCE_THRESHOLD = 7; // stricter gate for FP-prone langs

  // ── Core render function ──────────────────────────────────────────────────
  function render(text, lang) {
    currentRawText = text;

    let result;
    let resolvedLang = "plain";

    // ── 1. Explicit lang hint from the page (highest trust) ───────────────
    if (lang) {
      const knownLangs = hljs.listLanguages();
      if (knownLangs.includes(lang)) {
        try {
          result = hljs.highlight(text, { language: lang, ignoreIllegals: true });
          resolvedLang = lang;
        } catch (_) { /* fall through */ }
      }
    }

    // ── 2. Auto-detection with confidence gating ───────────────────────────
    if (!result) {
      const score = codeConfidenceScore(text);

      if (score >= CONFIDENCE_THRESHOLD) {
        const detected = hljs.highlightAuto(text);
        const detectedLang = detected.language ?? null;

        if (detectedLang) {
          // Extra gate: FP-prone languages need a higher confidence bar
          const isFpProne = PRONE_TO_FP.has(detectedLang);
          if (!isFpProne || score >= HIGH_CONFIDENCE_THRESHOLD) {
            result = detected;
            resolvedLang = detectedLang;
          }
        }
      }

      // Fall back to plain text if detection failed or was rejected
      if (!result) {
        result = { value: escapeHtml(text) };
        resolvedLang = "plain";
      }
    }

    // ── 3. Wrap each line in a hover-able <span class="line"> ─────────────
    const lines = result.value.split("\n");
    // Trim trailing phantom empty line when text ends with \n
    if (lines.length > 1 && lines[lines.length - 1].trim() === "") {
      lines.pop();
    }

    codeEl.innerHTML = lines
      .map((line) => `<span class="line">${line || " "}</span>`)
      .join("\n");

    // ── 4. Gutter ─────────────────────────────────────────────────────────
    renderGutter(lines.length);

    // ── 5. Meta ───────────────────────────────────────────────────────────
    updateMeta(resolvedLang, lines.length, text.length);

    // ── 6. Animate in ─────────────────────────────────────────────────────
    placeholder.classList.remove("visible");
    codeScroll.classList.add("animating");
    requestAnimationFrame(() => {
      codeScroll.scrollTop = 0;
      setTimeout(() => codeScroll.classList.remove("animating"), 200);
    });
  }

  // ── Gutter renderer ───────────────────────────────────────────────────────
  function renderGutter(lineCount) {
    if (lineCount < 2) {
      gutter.classList.add("hidden");
      gutterInner.innerHTML = "";
      return;
    }
    gutter.classList.remove("hidden");
    gutterInner.innerHTML = Array.from(
      { length: lineCount },
      (_, i) => `<div>${i + 1}</div>`
    ).join("");

    codeScroll.onscroll = () => { gutter.scrollTop = codeScroll.scrollTop; };
  }

  // ── Meta / status bar update ──────────────────────────────────────────────
  function updateMeta(lang, lines, chars) {
    const isPlain = lang === "plain";
    const displayLang = isPlain ? "plain text" : lang;

    // Badge: neutral grey for plaintext, blue for a detected language
    langBadge.textContent = isPlain ? "TXT" : lang.toUpperCase();
    langBadge.classList.toggle("plain", isPlain);
    langBadge.classList.add("visible");

    lineCountEl.textContent = lines;
    charCountEl.textContent = chars.toLocaleString();
    langLabelEl.textContent = displayLang;

    statusLines.style.display = "";
    statusChars.style.display = "";
    statusLang.style.display  = "";

    // Flash live indicator amber on new content, return to green after 1.2 s
    liveDot.style.background    = "var(--accent-amber)";
    liveDot.style.boxShadow     = "0 0 4px var(--accent-amber)";
    statusLiveEl.textContent    = "updated";
    setTimeout(() => {
      liveDot.style.background  = "";
      liveDot.style.boxShadow   = "";
      statusLiveEl.textContent  = "listening";
    }, 1200);
  }

  // ── Show placeholder (idle state) ─────────────────────────────────────────
  function showPlaceholder() {
    currentRawText = "";
    codeEl.innerHTML = "";
    gutterInner.innerHTML = "";
    gutter.classList.add("hidden");
    langBadge.classList.remove("visible", "plain");
    statusLines.style.display = "none";
    statusChars.style.display = "none";
    statusLang.style.display  = "none";
    placeholder.classList.add("visible");
  }

  // ── HTML escape ───────────────────────────────────────────────────────────
  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ── Copy button — full UX: instant copy, 2 s feedback, clean revert ───────
  const COPY_ICON_SVG = `
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
      <rect x="5" y="5" width="8" height="9" rx="1.5"/>
      <path d="M3 11V3.5A1.5 1.5 0 0 1 4.5 2H11"/>
    </svg>`;

  function resetCopyBtn() {
    copyBtn.innerHTML = `${COPY_ICON_SVG} Copy`;
    copyBtn.classList.remove("copied", "copy-error");
  }

  copyBtn.addEventListener("click", () => {
    if (!currentRawText) return;

    // Instant optimistic UI update — don't wait for the async clipboard call
    clearTimeout(copyTimer);

    navigator.clipboard.writeText(currentRawText).then(() => {
      copyBtn.innerHTML = "✓&nbsp;Copied!";
      copyBtn.classList.add("copied");
      copyBtn.classList.remove("copy-error");
      copyTimer = setTimeout(resetCopyBtn, 2000);
    }).catch(() => {
      copyBtn.innerHTML = "✗&nbsp;Failed";
      copyBtn.classList.add("copy-error");
      copyBtn.classList.remove("copied");
      copyTimer = setTimeout(resetCopyBtn, 1500);
    });
  });

  // ── Hydrate from session storage on panel open ────────────────────────────
  chrome.storage.session.get(["sharedText", "detectedLang"], (res) => {
    if (chrome.runtime.lastError) {
      console.error("session.get error:", chrome.runtime.lastError.message);
      showPlaceholder();
      return;
    }
    if (res?.sharedText?.trim()) {
      render(res.sharedText, res.detectedLang ?? null);
    } else {
      showPlaceholder();
    }
  });

  // ── Real-time updates from background service worker ──────────────────────
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "session") return;
    if ("sharedText" in changes) {
      const text = changes.sharedText.newValue ?? "";
      const lang = changes.detectedLang?.newValue ?? null;
      if (text.trim()) {
        render(text, lang);
      } else {
        showPlaceholder();
      }
    }
  });
});