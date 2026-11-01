// Syntax Highlighter using PrismJS
import Prism from "prismjs";
import "prismjs/components/prism-markup.js";
import "prismjs/components/prism-markup-templating.js";
import "prismjs/components/prism-css.js";
import "prismjs/components/prism-css-extras.js";
import "prismjs/components/prism-c.js";
import "prismjs/components/prism-javascript.js";
import "prismjs/components/prism-js-extras.js";
import "prismjs/components/prism-jsx.js";
import "prismjs/components/prism-typescript.js";
import "prismjs/components/prism-tsx.js";
import "prismjs/components/prism-python.js";
import "prismjs/components/prism-java.js";
import "prismjs/components/prism-cpp.js";
import "prismjs/components/prism-csharp.js";
import "prismjs/components/prism-go.js";
import "prismjs/components/prism-rust.js";
import "prismjs/components/prism-scss.js";
import "prismjs/components/prism-less.js";
import "prismjs/components/prism-json.js";
import "prismjs/components/prism-json5.js";
import "prismjs/components/prism-yaml.js";
import "prismjs/components/prism-sql.js";
import "prismjs/components/prism-markdown.js";
import "prismjs/components/prism-bash.js";
import "prismjs/components/prism-php.js";
import "prismjs/components/prism-php-extras.js";
import "prismjs/components/prism-ruby.js";
import "prismjs/components/prism-dart.js";
import "prismjs/components/prism-kotlin.js";
import "prismjs/components/prism-swift.js";
import "prismjs/components/prism-docker.js";
import "prismjs/components/prism-toml.js";
import "prismjs/components/prism-ini.js";
import "prismjs/components/prism-graphql.js";
import "prismjs/components/prism-diff.js";

if (typeof window !== "undefined") {
  window.Clarity = window.Clarity || {};
  window.Prism = Prism;
}

const LANG_CATALOG = {
  python: { id: "python", name: "Python", ext: ".py", prism: "python", mime: "text/x-python" },
  javascript: { id: "javascript", name: "JavaScript", ext: ".js", prism: "javascript", mime: "application/javascript" },
  typescript: { id: "typescript", name: "TypeScript", ext: ".ts", prism: "typescript", mime: "application/typescript" },
  jsx: { id: "jsx", name: "React JSX", ext: ".jsx", prism: "jsx", mime: "text/jsx" },
  tsx: { id: "tsx", name: "React TSX", ext: ".tsx", prism: "tsx", mime: "text/tsx" },
  html: { id: "html", name: "HTML", ext: ".html", prism: "markup", mime: "text/html", previewable: true },
  svg: { id: "svg", name: "SVG", ext: ".svg", prism: "markup", mime: "image/svg+xml", previewable: true },
  xml: { id: "xml", name: "XML", ext: ".xml", prism: "markup", mime: "application/xml" },
  css: { id: "css", name: "CSS", ext: ".css", prism: "css", mime: "text/css", previewable: true },
  scss: { id: "scss", name: "SCSS", ext: ".scss", prism: "scss", mime: "text/x-scss" },
  sass: { id: "scss", name: "Sass", ext: ".sass", prism: "scss", mime: "text/x-scss" },
  less: { id: "less", name: "Less", ext: ".less", prism: "less", mime: "text/x-less" },
  json: { id: "json", name: "JSON", ext: ".json", prism: "json", mime: "application/json" },
  json5: { id: "json", name: "JSON5", ext: ".json5", prism: "json5", mime: "application/json" },
  java: { id: "java", name: "Java", ext: ".java", prism: "java", mime: "text/x-java" },
  c: { id: "c", name: "C", ext: ".c", prism: "c", mime: "text/x-c" },
  cpp: { id: "cpp", name: "C++", ext: ".cpp", prism: "cpp", mime: "text/x-c++" },
  csharp: { id: "csharp", name: "C#", ext: ".cs", prism: "csharp", mime: "text/plain" },
  sql: { id: "sql", name: "SQL", ext: ".sql", prism: "sql", mime: "application/sql" },
  bash: { id: "bash", name: "Bash", ext: ".sh", prism: "bash", mime: "application/x-sh" },
  shell: { id: "bash", name: "Shell Script", ext: ".sh", prism: "bash", mime: "application/x-sh" },
  sh: { id: "bash", name: "Shell", ext: ".sh", prism: "bash", mime: "application/x-sh" },
  php: { id: "php", name: "PHP", ext: ".php", prism: "php", mime: "application/x-httpd-php" },
  go: { id: "go", name: "Go", ext: ".go", prism: "go", mime: "text/x-go" },
  rust: { id: "rust", name: "Rust", ext: ".rs", prism: "rust", mime: "text/rust" },
  dart: { id: "dart", name: "Dart", ext: ".dart", prism: "dart", mime: "text/x-dart" },
  kotlin: { id: "kotlin", name: "Kotlin", ext: ".kt", prism: "kotlin", mime: "text/x-kotlin" },
  swift: { id: "swift", name: "Swift", ext: ".swift", prism: "swift", mime: "text/x-swift" },
  yaml: { id: "yaml", name: "YAML", ext: ".yaml", prism: "yaml", mime: "text/yaml" },
  toml: { id: "toml", name: "TOML", ext: ".toml", prism: "toml", mime: "text/plain" },
  ini: { id: "ini", name: "INI", ext: ".ini", prism: "ini", mime: "text/plain" },
  markdown: { id: "markdown", name: "Markdown", ext: ".md", prism: "markdown", mime: "text/markdown", previewable: true },
  ruby: { id: "ruby", name: "Ruby", ext: ".rb", prism: "ruby", mime: "text/x-ruby" },
  docker: { id: "docker", name: "Dockerfile", ext: ".dockerfile", prism: "docker", mime: "text/plain" },
  graphql: { id: "graphql", name: "GraphQL", ext: ".graphql", prism: "graphql", mime: "application/graphql" },
  diff: { id: "diff", name: "Diff", ext: ".diff", prism: "diff", mime: "text/plain" },
  plaintext: { id: "plaintext", name: "Plain Text", ext: ".txt", prism: "plaintext", mime: "text/plain" },
};

const EXT_TO_LANG = {
  ".js": LANG_CATALOG.javascript,
  ".mjs": LANG_CATALOG.javascript,
  ".cjs": LANG_CATALOG.javascript,
  ".jsx": LANG_CATALOG.jsx,
  ".ts": LANG_CATALOG.typescript,
  ".mts": LANG_CATALOG.typescript,
  ".cts": LANG_CATALOG.typescript,
  ".tsx": LANG_CATALOG.tsx,
  ".py": LANG_CATALOG.python,
  ".pyw": LANG_CATALOG.python,
  ".java": LANG_CATALOG.java,
  ".c": LANG_CATALOG.c,
  ".h": LANG_CATALOG.c,
  ".cpp": LANG_CATALOG.cpp,
  ".cc": LANG_CATALOG.cpp,
  ".cxx": LANG_CATALOG.cpp,
  ".hpp": LANG_CATALOG.cpp,
  ".hxx": LANG_CATALOG.cpp,
  ".cs": LANG_CATALOG.csharp,
  ".go": LANG_CATALOG.go,
  ".rs": LANG_CATALOG.rust,
  ".dart": LANG_CATALOG.dart,
  ".kt": LANG_CATALOG.kotlin,
  ".kts": LANG_CATALOG.kotlin,
  ".swift": LANG_CATALOG.swift,
  ".html": LANG_CATALOG.html,
  ".htm": LANG_CATALOG.html,
  ".svg": LANG_CATALOG.svg,
  ".xml": LANG_CATALOG.xml,
  ".plist": LANG_CATALOG.xml,
  ".css": LANG_CATALOG.css,
  ".scss": LANG_CATALOG.scss,
  ".sass": LANG_CATALOG.scss,
  ".less": LANG_CATALOG.less,
  ".json": LANG_CATALOG.json,
  ".json5": LANG_CATALOG.json5,
  ".jsonc": LANG_CATALOG.json,
  ".yaml": LANG_CATALOG.yaml,
  ".yml": LANG_CATALOG.yaml,
  ".toml": LANG_CATALOG.toml,
  ".ini": LANG_CATALOG.ini,
  ".sql": LANG_CATALOG.sql,
  ".md": LANG_CATALOG.markdown,
  ".markdown": LANG_CATALOG.markdown,
  ".sh": LANG_CATALOG.bash,
  ".bash": LANG_CATALOG.bash,
  ".zsh": LANG_CATALOG.bash,
  ".env": LANG_CATALOG.bash,
  ".php": LANG_CATALOG.php,
  ".rb": LANG_CATALOG.ruby,
  ".graphql": LANG_CATALOG.graphql,
  ".gql": LANG_CATALOG.graphql,
  ".diff": LANG_CATALOG.diff,
  ".txt": LANG_CATALOG.plaintext,
};

const ALIAS_TO_ID = {
  py: "python",
  python3: "python",
  js: "javascript",
  node: "javascript",
  ts: "typescript",
  htm: "html",
  yml: "yaml",
  rb: "ruby",
  cxx: "cpp",
  "c++": "cpp",
  "c#": "csharp",
  cs: "csharp",
  golang: "go",
  rs: "rust",
  kt: "kotlin",
  kts: "kotlin",
  swift: "swift",
  dart: "dart",
  sh: "bash",
  zsh: "bash",
  shell: "bash",
  md: "markdown",
  dockerfile: "docker",
  toml: "toml",
  ini: "ini",
  gql: "graphql",
};

function getLanguageInfo(pathOrExtOrLang) {
  if (!pathOrExtOrLang) return LANG_CATALOG.plaintext;
  const raw = String(pathOrExtOrLang).trim().toLowerCase();

  // 1. Direct match in catalog or alias
  const aliasResolved = ALIAS_TO_ID[raw] || raw;
  if (LANG_CATALOG[aliasResolved]) {
    return LANG_CATALOG[aliasResolved];
  }

  // 2. Direct extension match (.py)
  if (EXT_TO_LANG[raw]) {
    return EXT_TO_LANG[raw];
  }
  if (EXT_TO_LANG["." + raw]) {
    return EXT_TO_LANG["." + raw];
  }

  // 3. Filename extraction (app.py)
  const baseName = raw.split("/").pop();
  if (baseName === "dockerfile") return LANG_CATALOG.docker;
  if (baseName === "makefile") return LANG_CATALOG.bash;
  if (baseName.startsWith(".env")) return LANG_CATALOG.bash;

  const parts = baseName.split(".");
  if (parts.length > 1) {
    const ext = "." + parts.pop();
    if (EXT_TO_LANG[ext]) {
      return EXT_TO_LANG[ext];
    }
  }

  return {
    id: raw.replace(/^\./, ""),
    name: (raw.replace(/^\./, "") || "Plain Text").toUpperCase(),
    ext: raw.startsWith(".") ? raw : "." + raw,
    prism: "plaintext",
    mime: "text/plain",
  };
}

function detectFilename(rawLang, code, precedingText) {
  // Case 1: Fenced code block tag: ```python:hello.py or ```python filename="hello.py" or ```app.py
  if (rawLang) {
    const tagMatch = rawLang.match(/(?:filename|title)=["']?([^"'\s]+)["']?/i) ||
                     rawLang.match(/:([a-zA-Z0-9_\-\.\/]+)/) ||
                     rawLang.match(/([a-zA-Z0-9_\-]+\.[a-zA-Z0-9]{1,8})/);
    if (tagMatch && tagMatch[1]) {
      return tagMatch[1].trim();
    }
  }

  // Case 2: Preceding text in markdown (e.g. "Python Script ( generate_file.py )", "### index.html", "Create app.py")
  if (precedingText && typeof precedingText === "string") {
    const lines = precedingText.split("\n").filter(Boolean);
    const lastFew = lines.slice(-4).join(" ");
    const fileMatch = lastFew.match(/\b([a-zA-Z0-9_\-]+\.(?:py|js|jsx|ts|tsx|html|htm|css|scss|json|java|c|cpp|h|hpp|cs|sql|sh|bash|php|go|rs|yaml|yml|md|txt|svg))\b/i);
    if (fileMatch && fileMatch[1]) {
      return fileMatch[1].trim();
    }
  }

  // Case 3: First line comment in code (e.g. "# file_name = 'hello.py'", "// app.js", "# generate_file.py")
  if (code && typeof code === "string") {
    const firstLines = code.split("\n").slice(0, 3).join("\n");
    const commentMatch = firstLines.match(/(?:\/\/|#|<!--|\/\*)\s*(?:filename|file)?\s*[:=]?\s*([a-zA-Z0-9_\-]+\.[a-zA-Z0-9]{1,8})/i) ||
                         firstLines.match(/file_name\s*=\s*["']([^"']+)["']/i);
    if (commentMatch && commentMatch[1]) {
      return commentMatch[1].trim();
    }
  }

  // Case 4: Default sensible filename based on detected language
  const langInfo = getLanguageInfo(rawLang);
  const defaults = {
    python: "main.py",
    javascript: "script.js",
    typescript: "app.ts",
    html: "index.html",
    css: "styles.css",
    json: "data.json",
    sql: "query.sql",
    bash: "script.sh",
    java: "Main.java",
    cpp: "main.cpp",
    c: "main.c",
    csharp: "Program.cs",
    php: "index.php",
    go: "main.go",
    rust: "main.rs",
    yaml: "config.yaml",
    markdown: "README.md",
    docker: "Dockerfile",
  };
  return defaults[langInfo.id] || `file${langInfo.ext || ".txt"}`;
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function splitHighlightedHtmlLines(html) {
  const lines = [];
  let currentLine = "";
  const openTags = [];

  // Match tags, newlines, or text segments
  const regex = /(<span[^>]*>|<\/span>|\r?\n|[^\r\n<]+|<)/g;
  let match;

  while ((match = regex.exec(html)) !== null) {
    const part = match[0];
    if (part === "\n" || part === "\r\n") {
      for (let i = openTags.length - 1; i >= 0; i--) {
        currentLine += "</span>";
      }
      lines.push(currentLine);
      currentLine = "";
      for (let i = 0; i < openTags.length; i++) {
        currentLine += openTags[i];
      }
    } else if (part.startsWith("<span")) {
      openTags.push(part);
      currentLine += part;
    } else if (part === "</span>") {
      openTags.pop();
      currentLine += part;
    } else {
      currentLine += part;
    }
  }

  for (let i = openTags.length - 1; i >= 0; i--) {
    currentLine += "</span>";
  }
  lines.push(currentLine);

  return lines;
}

function highlightLines(code, pathOrExt) {
  if (typeof code !== "string") code = "";
  const rawLines = code.split(/\r?\n/);
  const langInfo = getLanguageInfo(pathOrExt);
  const grammar = Prism.languages[langInfo.prism];

  if (!grammar) {
    return rawLines.map(line => escapeHtml(line));
  }

  try {
    const highlighted = Prism.highlight(code, grammar, langInfo.prism);
    return splitHighlightedHtmlLines(highlighted);
  } catch (err) {
    console.warn("Syntax highlight fallback for", langInfo.prism, err);
    return rawLines.map(line => escapeHtml(line));
  }
}

function highlightCode(code, pathOrExt) {
  if (typeof code !== "string") code = "";
  const langInfo = getLanguageInfo(pathOrExt);
  const grammar = Prism.languages[langInfo.prism];
  if (!grammar) {
    return escapeHtml(code);
  }
  try {
    return Prism.highlight(code, grammar, langInfo.prism);
  } catch (err) {
    return escapeHtml(code);
  }
}

function renderLineNumberedHtml(code, pathOrExt) {
  const lines = highlightLines(code, pathOrExt);
  return lines.map((lineHtml, idx) => {
    const lineNum = idx + 1;
    return `<div class="code-line" data-line="${lineNum}"><span class="code-line__num" aria-hidden="true">${lineNum}</span><span class="code-line__code">${lineHtml || "&nbsp;"}</span></div>`;
  }).join("");
}

const highlighterObj = {
  LANG_CATALOG,
  getLanguageInfo,
  detectFilename,
  highlightLines,
  highlightCode,
  renderLineNumberedHtml,
  escapeHtml,
};

if (typeof window !== "undefined") {
  window.Clarity = window.Clarity || {};
  window.Clarity.highlighter = highlighterObj;
}

export default highlighterObj;
export {
  LANG_CATALOG,
  getLanguageInfo,
  detectFilename,
  highlightLines,
  highlightCode,
  renderLineNumberedHtml,
  escapeHtml,
};
