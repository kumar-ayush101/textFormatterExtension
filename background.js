/**
 * background.js — GitShare Terminal Service Worker v3
 *
 * v3 changes:
 *   • sanitizeText() — collapses 3+ consecutive newlines to max 2, while
 *     preserving code indentation (leading whitespace on lines is untouched).
 *   • Text sanitization runs BEFORE storing to session, so sidepanel.js always
 *     receives clean input regardless of the source page's DOM structure.
 */

// ── Side-panel: open on action click ────────────────────────────────────────
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error("setPanelBehavior error:", error));

// ── Storage access: allow side panel (untrusted context) to read session ─────
if (chrome.storage?.session?.setAccessLevel) {
  chrome.storage.session
    .setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" })
    .catch((err) => console.error("setAccessLevel error:", err));
}

// ── Context menu: create only on install/update ──────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.remove("sendToGitShare", () => {
    void chrome.runtime.lastError;
    chrome.contextMenus.create({
      id: "sendToGitShare",
      title: "Send to GitShare Terminal",
      contexts: ["selection"],
    });
  });
});

// ── Text sanitization ────────────────────────────────────────────────────────
//
// Condenses 3 or more consecutive blank lines into exactly 2 (one blank line
// gap), which is the maximum visual separation used in well-formatted prose.
// Code indentation (leading spaces/tabs on non-empty lines) is preserved.
//
// Why here and not in sidepanel.js?
//   The service worker is the single choke-point for all text entering the
//   extension. Sanitizing here keeps sidepanel.js free of preprocessing
//   concerns and ensures the stored value is always clean.
//
function sanitizeText(raw) {
  if (!raw) return "";

  // Normalize Windows-style line endings to Unix
  let text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Collapse runs of 3+ newlines (i.e. 2+ consecutive blank lines) to exactly
  // 2 newlines (1 blank line). This regex matches \n\n\n+ and replaces with \n\n.
  // We use a generous upper bound (no limit) to catch pathological DOM dumps.
  text = text.replace(/\n{3,}/g, "\n\n");

  // Strip trailing whitespace from each line (invisible characters from
  // copy-pasting table cells on GitHub, Notion, etc.) while keeping all
  // leading whitespace so code indentation is never disturbed.
  text = text
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");

  // Trim leading/trailing blank lines from the whole selection
  return text.trim();
}

// ── Content script injected into the page to extract selection precisely ─────
//
// Why not info.selectionText?
//   Chrome normalises the selectionText field by collapsing whitespace and
//   stripping newlines from table-cell-based selections (GitHub uses a <table>
//   for line numbers + code). The injected function runs inside the real page
//   DOM and calls getRangeAt(0).toString() which returns the raw text exactly
//   as the browser serialised it — newlines, tabs, and all indentation intact.
//
function extractSelectionFromPage() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;

  const raw = sel.toString();
  if (!raw || !raw.trim()) return null;

  // Detect the programming language from the page when possible.
  // Strategies (in priority order):
  //   1. GitHub: data-tagsearch-lang attribute on <div class="highlight">
  //   2. GitHub: file extension in the breadcrumb / page title
  //   3. highlight.js-annotated <code> class (class="language-xxx")
  //   4. CodeMirror / Monaco data attributes
  //   5. Fallback: null (auto-detect in the panel)
  let detectedLang = null;

  try {
    // Strategy 1 — GitHub highlight wrapper
    const ghHighlight = document.querySelector(
      '[data-tagsearch-lang], .highlight[lang]'
    );
    if (ghHighlight) {
      detectedLang =
        ghHighlight.getAttribute("data-tagsearch-lang") ||
        ghHighlight.getAttribute("lang");
    }

    // Strategy 2 — GitHub file path title (e.g. "main.py — github.com")
    if (!detectedLang) {
      const titleMatch = document.title.match(/\.([a-zA-Z0-9]+)\s*[·—–]/);
      if (titleMatch) detectedLang = titleMatch[1];
    }

    // Strategy 3 — <code class="language-xxx"> anywhere in selection
    if (!detectedLang) {
      const node = sel.anchorNode?.parentElement?.closest("code, pre");
      if (node) {
        const cls = [...(node.classList || [])].find((c) =>
          c.startsWith("language-")
        );
        if (cls) detectedLang = cls.replace("language-", "");
      }
    }

    // Strategy 4 — CodeMirror / Monaco
    if (!detectedLang) {
      const cm = document.querySelector(".CodeMirror");
      if (cm?.CodeMirror) detectedLang = cm.CodeMirror.getMode()?.name;
    }
  } catch (_) {
    // Language detection is best-effort; never block the text extraction
  }

  // Normalise language aliases to what Highlight.js expects
  const langMap = {
    js: "javascript",
    ts: "typescript",
    py: "python",
    rb: "ruby",
    sh: "bash",
    yml: "yaml",
    md: "markdown",
    tf: "hcl",
    Dockerfile: "dockerfile",
  };
  if (detectedLang) {
    detectedLang = langMap[detectedLang] ?? detectedLang.toLowerCase();
  }

  return { text: raw, lang: detectedLang };
}

// ── Context menu click handler ───────────────────────────────────────────────
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "sendToGitShare") return;
  if (!tab?.id) return;

  chrome.scripting
    .executeScript({
      target: { tabId: tab.id },
      func: extractSelectionFromPage,
    })
    .then((results) => {
      const payload = results?.[0]?.result;

      const rawText = payload?.text ?? info.selectionText ?? "";
      if (!rawText.trim()) return;

      // ✦ Sanitize: collapse excessive blank lines before storing
      const text = sanitizeText(rawText);
      if (!text) return;

      chrome.storage.session
        .set({
          sharedText: text,
          detectedLang: payload?.lang ?? null,
          timestamp: Date.now(),
        })
        .catch((err) => console.error("session.set error:", err));
    })
    .catch((err) => {
      console.warn("executeScript failed, falling back to selectionText:", err);

      const rawText = info.selectionText ?? "";
      if (!rawText.trim()) return;

      const text = sanitizeText(rawText);
      if (!text) return;

      chrome.storage.session
        .set({
          sharedText: text,
          detectedLang: null,
          timestamp: Date.now(),
        })
        .catch((e) => console.error("session.set error:", e));
    });
});