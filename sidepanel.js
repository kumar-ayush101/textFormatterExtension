/**
 * sidepanel.js — GitShare Terminal v2
 *
 * Responsibilities:
 *   • Listen for storage updates from the background service worker
 *   • Run Highlight.js on the received text (auto-detect or use hint)
 *   • Render line numbers in the gutter, synced to the code scroll
 *   • Update the status bar (language, line count, char count)
 *   • Animate content transitions and handle the copy button
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

  // Guard: fail gracefully if DOM is broken
  if (!codeEl || !gutter || !placeholder) {
    console.error("GitShare: required DOM elements missing.");
    return;
  }

  // ── State ─────────────────────────────────────────────────────────────────
  let currentRawText = "";
  let copyTimer      = null;

  // ── Highlight.js configuration ────────────────────────────────────────────
  // Limit auto-detection to common languages to avoid false positives on
  // plain prose (hljs.highlightAuto can be overconfident on short snippets).
  hljs.configure({
    languages: [
      "javascript", "typescript", "python", "rust", "go", "java", "cpp", "c",
      "csharp", "php", "ruby", "swift", "kotlin", "bash", "shell", "sql",
      "html", "xml", "css", "scss", "json", "yaml", "dockerfile",
      "markdown", "graphql", "hcl",
    ],
    ignoreUnescapedHTML: true,
  });

  // ── Core render function ──────────────────────────────────────────────────
  /**
   * @param {string} text      — raw source text
   * @param {string|null} lang — language hint from background script (or null)
   */
  function render(text, lang) {
    currentRawText = text;

    // 1. Syntax-highlight ──────────────────────────────────────────────────
    let result;
    let resolvedLang = "plain";

    if (lang) {
      // Use the hint if Highlight.js knows that language
      const knownLangs = hljs.listLanguages();
      if (knownLangs.includes(lang)) {
        try {
          result = hljs.highlight(text, { language: lang, ignoreIllegals: true });
          resolvedLang = lang;
        } catch (_) { /* fall through to auto-detect */ }
      }
    }

    if (!result) {
      // Auto-detect — but only if the snippet is plausibly code (has at
      // least one of: brackets, semicolons, colons, def/function keywords).
      const looksLikeCode = /[{}\[\]();:<>]|^\s*(def |function |class |import |const |let |var |public |private )/m.test(text);
      if (looksLikeCode) {
        result = hljs.highlightAuto(text);
        resolvedLang = result.language ?? "plain";
      } else {
        // Plain text — just escape HTML and show as-is
        result = { value: escapeHtml(text) };
        resolvedLang = "plain";
      }
    }

    // 2. Wrap each line in a <span class="line"> for hover highlighting ─────
    const lines = result.value.split("\n");

    // Trim a trailing empty line that appears when text ends with \n
    if (lines.length > 1 && lines[lines.length - 1].trim() === "") {
      lines.pop();
    }

    codeEl.innerHTML = lines
      .map((line) => `<span class="line">${line || " "}</span>`)
      .join("\n");

    // 3. Build gutter line numbers ─────────────────────────────────────────
    renderGutter(lines.length);

    // 4. Update language badge & status bar ───────────────────────────────
    updateMeta(resolvedLang, lines.length, text.length);

    // 5. Animate in ───────────────────────────────────────────────────────
    placeholder.classList.remove("visible");
    codeScroll.classList.add("animating");
    requestAnimationFrame(() => {
      codeScroll.scrollTop = 0;
      // Remove animation class after it completes so it can re-trigger
      setTimeout(() => codeScroll.classList.remove("animating"), 200);
    });
  }

  // ── Gutter renderer ───────────────────────────────────────────────────────
  function renderGutter(lineCount) {
    if (lineCount < 2) {
      // Single-line snippets don't need a gutter
      gutter.classList.add("hidden");
      gutterInner.innerHTML = "";
      return;
    }

    gutter.classList.remove("hidden");
    gutterInner.innerHTML = Array.from(
      { length: lineCount },
      (_, i) => `<div>${i + 1}</div>`
    ).join("");

    // Sync gutter scroll with code scroll
    codeScroll.onscroll = () => {
      gutter.scrollTop = codeScroll.scrollTop;
    };
  }

  // ── Meta / status bar update ──────────────────────────────────────────────
  function updateMeta(lang, lines, chars) {
    const displayLang = lang === "plain" ? "plain text" : lang;

    // Title bar badge
    langBadge.textContent = lang === "plain" ? "TXT" : lang.toUpperCase();
    langBadge.classList.add("visible");

    // Status bar
    lineCountEl.textContent  = lines;
    charCountEl.textContent  = chars.toLocaleString();
    langLabelEl.textContent  = displayLang;

    statusLines.style.display = "";
    statusChars.style.display = "";
    statusLang.style.display  = "";

    // Briefly flash the live indicator on new content
    liveDot.style.background = "var(--accent-amber)";
    statusLiveEl.textContent = "updated";
    setTimeout(() => {
      liveDot.style.background = "";
      statusLiveEl.textContent = "listening";
    }, 1200);
  }

  // ── Show placeholder (idle state) ─────────────────────────────────────────
  function showPlaceholder() {
    currentRawText = "";
    codeEl.innerHTML = "";
    gutterInner.innerHTML = "";
    gutter.classList.add("hidden");
    langBadge.classList.remove("visible");
    statusLines.style.display = "none";
    statusChars.style.display = "none";
    statusLang.style.display  = "none";
    placeholder.classList.add("visible");
  }

  // ── HTML escape helper ────────────────────────────────────────────────────
  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ── Copy button ───────────────────────────────────────────────────────────
  copyBtn.addEventListener("click", () => {
    if (!currentRawText) return;

    navigator.clipboard.writeText(currentRawText).then(() => {
      copyBtn.textContent = "✓ Copied";
      copyBtn.classList.add("copied");
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => {
        copyBtn.innerHTML = `
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="5" y="5" width="8" height="9" rx="1.5"/>
            <path d="M3 11V3.5A1.5 1.5 0 0 1 4.5 2H11"/>
          </svg>
          Copy`;
        copyBtn.classList.remove("copied");
      }, 2000);
    }).catch(() => {
      copyBtn.textContent = "Failed";
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => {
        copyBtn.textContent = "Copy";
      }, 1500);
    });
  });

  // ── Hydrate from session storage on panel open ────────────────────────────
  chrome.storage.session.get(["sharedText", "detectedLang"], (result) => {
    if (chrome.runtime.lastError) {
      console.error("session.get error:", chrome.runtime.lastError.message);
      showPlaceholder();
      return;
    }
    if (result?.sharedText?.trim()) {
      render(result.sharedText, result.detectedLang ?? null);
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
