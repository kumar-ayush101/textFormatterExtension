/**
 * highlighter.js — GitShare Terminal built-in syntax highlighter
 *
 * Produces the same CSS class names as Highlight.js (hljs-keyword, hljs-string,
 * hljs-comment, etc.) so the Atom One Dark theme CSS works unchanged.
 *
 * Exposes a minimal hljs-compatible API:
 *   hljs.highlight(code, { language })  → { value: htmlString, language }
 *   hljs.highlightAuto(code)            → { value: htmlString, language }
 *   hljs.listLanguages()                → string[]
 *   hljs.configure(opts)                → void  (no-op, for compatibility)
 */

(function (global) {
  "use strict";

  // ── Utility ────────────────────────────────────────────────────────────────
  function esc(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function span(cls, text) {
    return `<span class="hljs-${cls}">${esc(text)}</span>`;
  }

  // ── Token types (maps to hljs CSS classes) ─────────────────────────────────
  const T = {
    COMMENT:   "comment",
    STRING:    "string",
    NUMBER:    "number",
    KEYWORD:   "keyword",
    BUILTIN:   "built_in",
    TYPE:      "type",
    FUNCTION:  "title function_",   // hljs uses two classes for function names
    ATTR:      "attr",
    TAG:       "tag",
    NAME:      "name",
    OPERATOR:  "operator",
    PUNCTUATION: "punctuation",
    LITERAL:   "literal",
    VARIABLE:  "variable",
    PARAMS:    "params",
    META:      "meta",
    SELECTOR:  "selector-class",
    PROPERTY:  "property",
  };

  // ── Language definitions ───────────────────────────────────────────────────
  // Each language is an ordered array of { pattern: RegExp, type: string }
  // patterns are tried in order; first match wins for each position.
  // The RegExp MUST have the `d` flag omitted but MUST be sticky (y) or we
  // advance manually. We use a single-pass left-to-right tokenizer.

  const LANGS = {};

  // Shared primitives
  const STR_DQ   = { pattern: /"(?:[^"\\]|\\.)*"/, type: T.STRING };
  const STR_SQ   = { pattern: /'(?:[^'\\]|\\.)*'/, type: T.STRING };
  const STR_BT   = { pattern: /`(?:[^`\\]|\\.)*`/, type: T.STRING };
  const NUM      = { pattern: /\b0x[\da-fA-F]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/, type: T.NUMBER };
  const LINE_CMT = { pattern: /\/\/[^\n]*/, type: T.COMMENT };
  const BLOCK_CMT= { pattern: /\/\*[\s\S]*?\*\//, type: T.COMMENT };
  const HASH_CMT = { pattern: /#[^\n]*/, type: T.COMMENT };

  // ── JavaScript / TypeScript ───────────────────────────────────────────────
  const JS_KW = /\b(break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|finally|for|from|function|if|import|in|instanceof|let|new|of|return|static|super|switch|this|throw|try|typeof|var|void|while|with|yield|async|await|declare|interface|enum|implements|namespace|type|abstract|override|readonly|satisfies|as|keyof|infer|never|unknown|any|undefined)\b/;
  const JS_LIT= /\b(true|false|null|NaN|Infinity|undefined)\b/;
  const JS_BI = /\b(console|Math|JSON|Object|Array|String|Number|Boolean|Promise|Symbol|Map|Set|WeakMap|WeakSet|Date|Error|RegExp|parseInt|parseFloat|setTimeout|setInterval|clearTimeout|clearInterval|fetch|document|window|globalThis|process|require|module|exports|__dirname|__filename)\b/;

  function makeJsLang(extraKw) {
    return [
      LINE_CMT, BLOCK_CMT,
      STR_BT, STR_DQ, STR_SQ,
      NUM,
      { pattern: JS_LIT, type: T.LITERAL },
      { pattern: extraKw || JS_KW, type: T.KEYWORD },
      { pattern: JS_BI, type: T.BUILTIN },
      { pattern: /\b([A-Z][A-Za-z0-9_]*)(?=\s*[<(])/, type: T.TYPE },
      { pattern: /\b([a-z_$][a-zA-Z0-9_$]*)(?=\s*\()/, type: T.FUNCTION },
      { pattern: /[+\-*/%=!<>&|^~?:]+/, type: T.OPERATOR },
    ];
  }

  LANGS.javascript = makeJsLang();
  LANGS.js         = LANGS.javascript;
  LANGS.typescript = makeJsLang(
    /\b(break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|finally|for|from|function|if|import|in|instanceof|let|new|of|return|static|super|switch|this|throw|try|typeof|var|void|while|with|yield|async|await|declare|interface|enum|implements|namespace|type|abstract|override|readonly|satisfies|as|keyof|infer|never|unknown|any|undefined|string|number|boolean|object|symbol|bigint|void)\b/
  );
  LANGS.ts = LANGS.typescript;

  // ── Python ────────────────────────────────────────────────────────────────
  LANGS.python = [
    { pattern: /"""[\s\S]*?"""|'''[\s\S]*?'''/, type: T.STRING },
    HASH_CMT,
    STR_DQ, STR_SQ,
    NUM,
    { pattern: /\b(True|False|None)\b/, type: T.LITERAL },
    { pattern: /\b(and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield)\b/, type: T.KEYWORD },
    { pattern: /\b(print|len|range|type|int|str|float|bool|list|dict|set|tuple|input|open|super|self|cls|object|Exception|ValueError|TypeError|KeyError|IndexError|AttributeError|NotImplementedError|StopIteration|zip|map|filter|sorted|enumerate|reversed|any|all|min|max|sum|abs|round|repr|hash|id|dir|vars|getattr|setattr|hasattr|callable|iter|next)\b/, type: T.BUILTIN },
    { pattern: /\b([A-Z][A-Za-z0-9_]*)/, type: T.TYPE },
    { pattern: /\b([a-z_][a-zA-Z0-9_]*)(?=\s*\()/, type: T.FUNCTION },
    { pattern: /[+\-*/%=!<>&|^~@]+/, type: T.OPERATOR },
    { pattern: /@[a-zA-Z_][a-zA-Z0-9_.]*/, type: T.META },
  ];
  LANGS.py = LANGS.python;

  // ── Rust ──────────────────────────────────────────────────────────────────
  LANGS.rust = [
    LINE_CMT, BLOCK_CMT,
    { pattern: /r#?"(?:[^"\\]|\\.)*"#?/, type: T.STRING },
    STR_SQ,
    NUM,
    { pattern: /\b(true|false)\b/, type: T.LITERAL },
    { pattern: /\b(as|async|await|break|const|continue|crate|dyn|else|enum|extern|false|fn|for|if|impl|in|let|loop|match|mod|move|mut|pub|ref|return|self|Self|static|struct|super|trait|true|type|union|unsafe|use|where|while|abstract|become|box|do|final|macro|override|priv|try|typeof|unsized|virtual|yield)\b/, type: T.KEYWORD },
    { pattern: /\b(Option|Result|Some|None|Ok|Err|Vec|String|str|i8|i16|i32|i64|i128|isize|u8|u16|u32|u64|u128|usize|f32|f64|bool|char|Box|Rc|Arc|Cell|RefCell|HashMap|HashSet|BTreeMap|BTreeSet|println|print|eprintln|panic|assert|assert_eq|assert_ne|todo|unimplemented|unreachable|dbg|format|vec)\b/, type: T.BUILTIN },
    { pattern: /\b([A-Z][A-Za-z0-9_]*)/, type: T.TYPE },
    { pattern: /\b([a-z_][a-zA-Z0-9_]*)(?=\s*\()/, type: T.FUNCTION },
    { pattern: /'[a-z_]+/, type: T.VARIABLE },   // lifetimes
    { pattern: /#\[.*?\]/, type: T.META },
    { pattern: /[+\-*/%=!<>&|^~?:]+/, type: T.OPERATOR },
  ];

  // ── Go ────────────────────────────────────────────────────────────────────
  LANGS.go = [
    LINE_CMT, BLOCK_CMT,
    STR_BT, STR_DQ, STR_SQ,
    NUM,
    { pattern: /\b(true|false|nil|iota)\b/, type: T.LITERAL },
    { pattern: /\b(break|case|chan|const|continue|default|defer|else|fallthrough|for|func|go|goto|if|import|interface|map|package|range|return|select|struct|switch|type|var)\b/, type: T.KEYWORD },
    { pattern: /\b(bool|byte|complex64|complex128|error|float32|float64|int|int8|int16|int32|int64|rune|string|uint|uint8|uint16|uint32|uint64|uintptr|append|cap|close|complex|copy|delete|imag|len|make|new|panic|print|println|real|recover|string|any)\b/, type: T.BUILTIN },
    { pattern: /\b([A-Z][A-Za-z0-9_]*)/, type: T.TYPE },
    { pattern: /\b([a-z_][a-zA-Z0-9_]*)(?=\s*\()/, type: T.FUNCTION },
    { pattern: /[+\-*/%=!<>&|^~:]+/, type: T.OPERATOR },
  ];

  // ── Java ──────────────────────────────────────────────────────────────────
  LANGS.java = [
    LINE_CMT, BLOCK_CMT,
    STR_DQ, STR_SQ,
    NUM,
    { pattern: /\b(true|false|null)\b/, type: T.LITERAL },
    { pattern: /\b(abstract|assert|break|case|catch|class|const|continue|default|do|else|enum|extends|final|finally|for|goto|if|implements|import|instanceof|interface|native|new|package|private|protected|public|return|static|strictfp|super|switch|synchronized|this|throw|throws|transient|try|var|void|volatile|while|record|sealed|permits|yield)\b/, type: T.KEYWORD },
    { pattern: /\b(String|Integer|Long|Double|Float|Boolean|Character|Byte|Short|Object|System|Math|Arrays|ArrayList|HashMap|HashSet|List|Map|Set|Optional|Stream|Collectors|Thread|Runnable|Exception|RuntimeException|NullPointerException|IllegalArgumentException|Override|Deprecated|SuppressWarnings)\b/, type: T.BUILTIN },
    { pattern: /@[A-Z][A-Za-z0-9_]*/, type: T.META },
    { pattern: /\b([A-Z][A-Za-z0-9_]*)/, type: T.TYPE },
    { pattern: /\b([a-z_][a-zA-Z0-9_]*)(?=\s*\()/, type: T.FUNCTION },
    { pattern: /[+\-*/%=!<>&|^~?:]+/, type: T.OPERATOR },
  ];

  // ── C / C++ ───────────────────────────────────────────────────────────────
  const C_KW = /\b(auto|break|case|char|const|continue|default|do|double|else|enum|extern|float|for|goto|if|inline|int|long|register|restrict|return|short|signed|sizeof|static|struct|switch|typedef|union|unsigned|void|volatile|while|_Bool|_Complex|_Imaginary)\b/;
  const CPP_KW = /\b(alignas|alignof|and|and_eq|asm|auto|bitand|bitor|bool|break|case|catch|char|char8_t|char16_t|char32_t|class|compl|concept|const|consteval|constexpr|constinit|const_cast|continue|co_await|co_return|co_yield|decltype|default|delete|do|double|dynamic_cast|else|enum|explicit|export|extern|false|float|for|friend|goto|if|inline|int|long|mutable|namespace|new|noexcept|not|not_eq|nullptr|operator|or|or_eq|private|protected|public|register|reinterpret_cast|requires|return|short|signed|sizeof|static|static_assert|static_cast|struct|switch|template|this|thread_local|throw|true|try|typedef|typeid|typename|union|unsigned|using|virtual|void|volatile|wchar_t|while|xor|xor_eq)\b/;
  LANGS.c = [
    LINE_CMT, BLOCK_CMT,
    STR_DQ, STR_SQ,
    NUM,
    { pattern: /\b(true|false|NULL|nullptr)\b/, type: T.LITERAL },
    { pattern: C_KW, type: T.KEYWORD },
    { pattern: /#\s*(include|define|ifdef|ifndef|endif|if|else|elif|pragma|error|warning|undef|line)\b/, type: T.META },
    { pattern: /\b([A-Z_][A-Z0-9_]{2,})/, type: T.TYPE },  // ALL_CAPS macros
    { pattern: /\b([a-zA-Z_][a-zA-Z0-9_]*)(?=\s*\()/, type: T.FUNCTION },
    { pattern: /[+\-*/%=!<>&|^~?:]+/, type: T.OPERATOR },
  ];
  LANGS.cpp = [
    LINE_CMT, BLOCK_CMT,
    STR_DQ, STR_SQ,
    NUM,
    { pattern: /\b(true|false|NULL|nullptr)\b/, type: T.LITERAL },
    { pattern: CPP_KW, type: T.KEYWORD },
    { pattern: /#\s*(include|define|ifdef|ifndef|endif|if|else|elif|pragma|error|warning)\b/, type: T.META },
    { pattern: /\b(std|cout|cin|cerr|endl|vector|map|set|string|pair|tuple|array|queue|stack|deque|list|shared_ptr|unique_ptr|make_shared|make_unique|move|forward|begin|end|size|push_back|emplace_back)\b/, type: T.BUILTIN },
    { pattern: /\b([A-Z][A-Za-z0-9_]*)/, type: T.TYPE },
    { pattern: /\b([a-zA-Z_][a-zA-Z0-9_]*)(?=\s*\()/, type: T.FUNCTION },
    { pattern: /[+\-*/%=!<>&|^~?:]+/, type: T.OPERATOR },
  ];
  LANGS["c++"] = LANGS.cpp;

  // ── Bash / Shell ──────────────────────────────────────────────────────────
  LANGS.bash = [
    HASH_CMT,
    { pattern: /\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*|\$\d|\$[@*#?$!-]/, type: T.VARIABLE },
    { pattern: /"(?:[^"\\$]|\\.|\$\{[^}]*\}|\$[A-Za-z0-9_]+)*"/, type: T.STRING },
    STR_SQ,
    { pattern: /`[^`]*`/, type: T.STRING },
    NUM,
    { pattern: /\b(if|then|else|elif|fi|for|in|do|done|while|until|case|esac|function|select|time|coproc)\b/, type: T.KEYWORD },
    { pattern: /\b(echo|printf|read|cd|ls|cp|mv|rm|mkdir|rmdir|touch|cat|grep|sed|awk|find|sort|uniq|wc|head|tail|cut|tr|tee|xargs|chmod|chown|export|source|alias|unset|declare|local|return|exit|shift|set|unset|test|true|false|pwd|env|which|type|kill|ps|jobs|bg|fg|wait|trap|getopts|eval|exec|command|builtin|hash|ulimit|umask|readonly|typeset|let|expr|basename|dirname|realpath|date|sleep|curl|wget|ssh|scp|rsync|tar|gzip|gunzip|zip|unzip|git|docker|make|npm|pip|python|python3|node|java|go|cargo|brew|apt|yum|dnf|pacman)\b/, type: T.BUILTIN },
    { pattern: /&&|\|\||>>|<<|[|>&<]/, type: T.OPERATOR },
    { pattern: /--?[a-zA-Z][a-zA-Z0-9_-]*/, type: T.ATTR },
  ];
  LANGS.shell = LANGS.bash;
  LANGS.sh    = LANGS.bash;

  // ── SQL ───────────────────────────────────────────────────────────────────
  LANGS.sql = [
    { pattern: /--[^\n]*/, type: T.COMMENT },
    { pattern: /\/\*[\s\S]*?\*\//, type: T.COMMENT },
    STR_SQ, STR_DQ,
    NUM,
    { pattern: /\b(SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|FULL|CROSS|ON|AS|AND|OR|NOT|IN|BETWEEN|LIKE|IS|NULL|ORDER|BY|GROUP|HAVING|LIMIT|OFFSET|UNION|ALL|DISTINCT|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|VIEW|INDEX|DROP|ALTER|ADD|COLUMN|PRIMARY|KEY|FOREIGN|REFERENCES|UNIQUE|CHECK|DEFAULT|CONSTRAINT|AUTO_INCREMENT|SERIAL|CASCADE|TRUNCATE|EXPLAIN|ANALYZE|WITH|RECURSIVE|CASE|WHEN|THEN|ELSE|END|EXISTS|ANY|SOME|EXCEPT|INTERSECT|RETURNING)\b/i, type: T.KEYWORD },
    { pattern: /\b(COUNT|SUM|AVG|MIN|MAX|COALESCE|NULLIF|IFNULL|CAST|CONVERT|CONCAT|SUBSTRING|LENGTH|TRIM|UPPER|LOWER|NOW|DATE|YEAR|MONTH|DAY|EXTRACT|TO_CHAR|TO_DATE|ROUND|FLOOR|CEIL|ABS|MOD|POWER|SQRT|RANDOM|UUID|ROW_NUMBER|RANK|DENSE_RANK|LEAD|LAG|PARTITION|OVER|FIRST_VALUE|LAST_VALUE)\b/i, type: T.BUILTIN },
    { pattern: /\b(INT|INTEGER|BIGINT|SMALLINT|TINYINT|DECIMAL|NUMERIC|FLOAT|DOUBLE|REAL|CHAR|VARCHAR|TEXT|BLOB|DATE|TIME|DATETIME|TIMESTAMP|BOOLEAN|BOOL|SERIAL|BYTEA|JSON|JSONB|UUID|ARRAY)\b/i, type: T.TYPE },
    { pattern: /[+\-*/%=!<>&|]+/, type: T.OPERATOR },
  ];

  // ── JSON ──────────────────────────────────────────────────────────────────
  LANGS.json = [
    STR_DQ,
    NUM,
    { pattern: /\b(true|false|null)\b/, type: T.LITERAL },
    { pattern: /[{}[\],:]/, type: T.PUNCTUATION },
  ];

  // ── YAML ──────────────────────────────────────────────────────────────────
  LANGS.yaml = [
    HASH_CMT,
    STR_DQ, STR_SQ,
    { pattern: /^\s*---/, type: T.META },
    { pattern: /!![a-zA-Z]+|![a-zA-Z]+/, type: T.TYPE },
    { pattern: /\b(true|false|yes|no|null|~)\b/, type: T.LITERAL },
    NUM,
    { pattern: /&[a-zA-Z_][a-zA-Z0-9_]*|\*[a-zA-Z_][a-zA-Z0-9_]*/, type: T.VARIABLE },
    { pattern: /^[ \t]*[a-zA-Z_][a-zA-Z0-9_\- ]*(?=\s*:)/m, type: T.ATTR },
    { pattern: /:\s*$|^- /m, type: T.PUNCTUATION },
  ];
  LANGS.yml = LANGS.yaml;

  // ── CSS / SCSS ────────────────────────────────────────────────────────────
  LANGS.css = [
    BLOCK_CMT,
    { pattern: /"[^"]*"|'[^']*'/, type: T.STRING },
    { pattern: /#[0-9a-fA-F]{3,8}\b/, type: T.NUMBER },
    NUM,
    { pattern: /\b(important|inherit|initial|unset|revert|auto|none|normal|bold|italic|solid|dashed|dotted|relative|absolute|fixed|sticky|flex|grid|block|inline|hidden|visible|scroll|clip|contain|cover|center|left|right|top|bottom|middle|nowrap|wrap|row|column|space-between|space-around|space-evenly|stretch|start|end|baseline)\b/, type: T.LITERAL },
    { pattern: /@[a-zA-Z-]+/, type: T.META },
    { pattern: /:[a-zA-Z-]+(?=\s*[{(,])/, type: T.SELECTOR },
    { pattern: /\.[a-zA-Z_-][a-zA-Z0-9_-]*(?=\s*[{,])/, type: T.SELECTOR },
    { pattern: /#[a-zA-Z_-][a-zA-Z0-9_-]*(?=\s*[{,])/, type: T.SELECTOR },
    { pattern: /\b([a-zA-Z-]+)(?=\s*:)/, type: T.PROPERTY },
    { pattern: /var\(--[a-zA-Z0-9_-]+\)|--[a-zA-Z0-9_-]+/, type: T.VARIABLE },
    { pattern: /\b(px|em|rem|vh|vw|vmin|vmax|%|deg|rad|ms|s|fr)\b/, type: T.BUILTIN },
  ];
  LANGS.scss = LANGS.css;

  // ── HTML / XML ────────────────────────────────────────────────────────────
  LANGS.html = [
    { pattern: /<!--[\s\S]*?-->/, type: T.COMMENT },
    { pattern: /<!DOCTYPE[^>]*>/i, type: T.META },
    { pattern: /<\/[A-Za-z][A-Za-z0-9.-]*>/, type: T.TAG },
    { pattern: /<[A-Za-z][A-Za-z0-9.-]*(?=[\s/>])/, type: T.TAG },
    { pattern: /\/?>/, type: T.TAG },
    STR_DQ, STR_SQ,
    { pattern: /\b[A-Za-z-]+(?=\s*=)/, type: T.ATTR },
    { pattern: /&[a-zA-Z]+;|&#\d+;/, type: T.LITERAL },
  ];
  LANGS.xml = LANGS.html;
  LANGS.svg = LANGS.html;

  // ── Dockerfile ────────────────────────────────────────────────────────────
  LANGS.dockerfile = [
    HASH_CMT,
    STR_DQ, STR_SQ,
    { pattern: /\$\{[^}]*\}|\$[A-Z_][A-Z0-9_]*/, type: T.VARIABLE },
    { pattern: /^(FROM|RUN|CMD|LABEL|EXPOSE|ENV|ADD|COPY|ENTRYPOINT|VOLUME|USER|WORKDIR|ARG|ONBUILD|STOPSIGNAL|HEALTHCHECK|SHELL)\b/m, type: T.KEYWORD },
    { pattern: /--[a-zA-Z-]+=?/, type: T.ATTR },
    NUM,
  ];

  // ── Markdown ──────────────────────────────────────────────────────────────
  LANGS.markdown = [
    { pattern: /^#{1,6}\s.+$/m, type: T.KEYWORD },
    { pattern: /\*\*[^*]+\*\*|__[^_]+__/, type: T.KEYWORD },
    { pattern: /\*[^*]+\*|_[^_]+_/, type: T.BUILTIN },
    { pattern: /`{3}[\s\S]*?`{3}|`[^`]+`/, type: T.STRING },
    { pattern: /\[([^\]]+)\]\([^)]+\)/, type: T.VARIABLE },
    { pattern: /^>\s.+$/m, type: T.COMMENT },
    { pattern: /^[-*+]\s|^\d+\.\s/m, type: T.PUNCTUATION },
  ];
  LANGS.md = LANGS.markdown;

  // ── HCL / Terraform ───────────────────────────────────────────────────────
  LANGS.hcl = [
    LINE_CMT, BLOCK_CMT,
    { pattern: /<<-?\s*\w+[\s\S]*?\n\s*\w+/, type: T.STRING },  // heredoc
    STR_DQ,
    NUM,
    { pattern: /\b(true|false|null)\b/, type: T.LITERAL },
    { pattern: /\b(resource|data|variable|output|locals|module|provider|terraform|required_providers|required_version|backend|lifecycle|provisioner|connection|dynamic|for_each|count|depends_on|source|version|tags|name|type|default|description|sensitive|validation|condition|error_message)\b/, type: T.KEYWORD },
    { pattern: /\$\{[^}]*\}/, type: T.VARIABLE },
    { pattern: /\b([A-Za-z][A-Za-z0-9_-]*)(?=\s*["{])/, type: T.BUILTIN },
    { pattern: /[+\-*/%=!<>&|?:]+/, type: T.OPERATOR },
  ];
  LANGS.terraform = LANGS.hcl;
  LANGS.tf        = LANGS.hcl;

  // ── GraphQL ───────────────────────────────────────────────────────────────
  LANGS.graphql = [
    { pattern: /#[^\n]*/, type: T.COMMENT },
    STR_DQ,
    { pattern: /\b(query|mutation|subscription|fragment|on|type|input|interface|union|enum|schema|extend|implements|scalar|directive|repeatable)\b/, type: T.KEYWORD },
    { pattern: /\b(String|Int|Float|Boolean|ID)\b/, type: T.TYPE },
    { pattern: /\$[A-Za-z_][A-Za-z0-9_]*/, type: T.VARIABLE },
    { pattern: /@[A-Za-z_][A-Za-z0-9_]*/, type: T.META },
    { pattern: /\b([A-Z][A-Za-z0-9_]*)/, type: T.TYPE },
    { pattern: /\b([a-z_][a-zA-Z0-9_]*)(?=\s*[:(])/, type: T.FUNCTION },
    NUM,
  ];

  // ── Tokenizer ──────────────────────────────────────────────────────────────
  function tokenize(code, rules) {
    let out   = "";
    let pos   = 0;
    const len = code.length;

    while (pos < len) {
      let bestMatch = null;
      let bestIdx   = Infinity;
      let bestRule  = null;

      for (const rule of rules) {
        // Make a fresh copy of the regex with lastIndex reset, anchored to pos
        const re = new RegExp(rule.pattern.source, rule.pattern.flags.replace("g", "") + "g");
        re.lastIndex = pos;
        const m = re.exec(code);
        if (m !== null && m.index < bestIdx) {
          bestIdx   = m.index;
          bestMatch = m;
          bestRule  = rule;
          if (m.index === pos) break; // Can't do better
        }
      }

      if (!bestMatch || bestIdx >= len) {
        // No more matches — emit the rest as plain text
        out += esc(code.slice(pos));
        break;
      }

      // Emit plain text between pos and the match
      if (bestIdx > pos) {
        out += esc(code.slice(pos, bestIdx));
      }

      // Emit the matched token
      out += span(bestRule.type, bestMatch[0]);
      pos  = bestIdx + bestMatch[0].length;

      // Guard against zero-length matches causing infinite loops
      if (bestMatch[0].length === 0) pos++;
    }

    return out;
  }

  // ── Auto-detect ────────────────────────────────────────────────────────────
  // Score each language by how many of its patterns match distinctively
  const HEURISTICS = [
    { lang: "python",     tests: [/^\s*(def |class |import |from .+ import|elif |print\()/m, /:\s*$|\bself\b/m] },
    { lang: "rust",       tests: [/\bfn\s+\w+|let\s+mut\b|impl\s+\w+|\bOption<|\bResult<|\buse\s+\w+::/m] },
    { lang: "go",         tests: [/^package\s+\w|^func\s+\w|\bfmt\.\w+|:=\s/m] },
    { lang: "typescript", tests: [/:\s*(string|number|boolean|any|void|unknown|never)\b|interface\s+\w+|type\s+\w+\s*=/m] },
    { lang: "javascript", tests: [/\b(const|let|var)\s+\w+\s*=|=>\s*[{(]|require\(|console\.|\.then\(|\.catch\(/m] },
    { lang: "java",       tests: [/public\s+(class|interface|enum|record)\s+\w+|@Override|System\.out\.|import\s+java\./m] },
    { lang: "cpp",        tests: [/#include\s*<|std::|cout\s*<<|cin\s*>>|::\w+\(/m] },
    { lang: "c",          tests: [/#include\s*[<"]|printf\s*\(|scanf\s*\(|int\s+main\s*\(/m] },
    { lang: "sql",        tests: [/\b(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b/i, /\bFROM\s+\w+/i] },
    { lang: "html",       tests: [/<(!DOCTYPE|html|head|body|div|span|script|style|link|meta)\b/i] },
    { lang: "css",        tests: [/[.#][\w-]+\s*\{|@media\s|@keyframes\s|:\s*(flex|grid|block)\b/m] },
    { lang: "yaml",       tests: [/^[\w-]+:\s*\S/m, /^\s{2}-\s+\w/m] },
    { lang: "json",       tests: [/^\s*\{[\s\S]*"[\w-]+":\s*["{[\dtf]/m] },
    { lang: "bash",       tests: [/^#!\/bin\/(ba)?sh|^\s*(echo|export|source|apt|brew|npm|pip|git)\s/m] },
    { lang: "dockerfile", tests: [/^FROM\s+\S+/m, /^(RUN|CMD|ENTRYPOINT|COPY|ADD|ENV|ARG)\s/m] },
    { lang: "graphql",    tests: [/^(query|mutation|subscription|type|input|interface|fragment)\s+\w+/m] },
    { lang: "hcl",        tests: [/^(resource|data|variable|output|provider|module)\s+"[\w-]+"/, /\${[\w.]+}/m] },
    { lang: "markdown",   tests: [/^#{1,6}\s\w|^\*\*\w|\[.+\]\(.+\)/m] },
  ];

  function detectLanguage(code) {
    let best = null;
    let bestScore = 0;

    for (const { lang, tests } of HEURISTICS) {
      const score = tests.reduce((acc, re) => acc + (re.test(code) ? 1 : 0), 0);
      if (score > bestScore) {
        bestScore = score;
        best      = lang;
      }
    }

    // Require at least one matching heuristic to avoid false positives
    return bestScore > 0 ? best : null;
  }

  // ── Public API (hljs-compatible surface) ──────────────────────────────────
  const hljs = {
    /**
     * Highlight with an explicit language.
     * @returns {{ value: string, language: string }}
     */
    highlight(code, opts = {}) {
      const lang = (opts.language || "").toLowerCase();
      const rules = LANGS[lang];
      if (!rules) return { value: esc(code), language: "plain" };
      return { value: tokenize(code, rules), language: lang };
    },

    /**
     * Auto-detect language and highlight.
     * @returns {{ value: string, language: string|null }}
     */
    highlightAuto(code) {
      const lang = detectLanguage(code);
      if (!lang) return { value: esc(code), language: null };
      return this.highlight(code, { language: lang });
    },

    listLanguages() {
      return Object.keys(LANGS);
    },

    /** No-op — here for API compatibility with code that calls hljs.configure */
    configure() {},
  };

  global.hljs = hljs;

})(typeof globalThis !== "undefined" ? globalThis : window);
