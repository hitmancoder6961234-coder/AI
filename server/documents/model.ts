/**
 * One neutral document model that every exporter (DOCX, PDF, PPTX, XLSX, ODT, RTF, HTML, MD, TXT, CSV, JSON)
 * renders from, plus a Markdown parser that produces it. The Studio, the chat and the document tools all
 * hand content to the exporters in this shape.
 */

export type Block =
  | { t: "h"; level: 1 | 2 | 3 | 4; text: string }
  | { t: "p"; text: string }
  | { t: "ul"; items: string[] }
  | { t: "ol"; items: string[] }
  | { t: "code"; lang?: string; text: string }
  | { t: "table"; header: string[]; rows: string[][] }
  | { t: "quote"; text: string }
  | { t: "img"; src: string; alt?: string; caption?: string }
  | { t: "hr" }
  | { t: "pagebreak" };

export interface DocModel {
  title: string;
  subtitle?: string;
  author?: string;
  date?: string;
  blocks: Block[];
}

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  link?: string;
}

/** Inline Markdown -> runs. Handles **bold**, *italic*, `code`, [text](url); everything else is literal. */
export function parseInline(src: string): Run[] {
  const runs: Run[] = [];
  const re = /(\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|\[([^\]]+)\]\((https?:[^)\s]+)\)|\*([^*\s][^*]*?)\*|(?<![A-Za-z0-9])_([^_\s][^_]*?)_(?![A-Za-z0-9]))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m.index > last) runs.push({ text: src.slice(last, m.index) });
    if (m[2] !== undefined || m[3] !== undefined) runs.push({ text: m[2] ?? m[3], bold: true });
    else if (m[4] !== undefined) runs.push({ text: m[4], code: true });
    else if (m[5] !== undefined) runs.push({ text: m[5], link: m[6] });
    else runs.push({ text: m[7] ?? m[8], italic: true });
    last = m.index + m[0].length;
  }
  if (last < src.length) runs.push({ text: src.slice(last) });
  return runs.length ? runs : [{ text: "" }];
}

export function stripInline(src: string): string {
  return parseInline(src).map((r) => r.text).join("");
}

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

/** Markdown -> blocks. Supports ATX headings, lists, fenced code, tables, quotes, images, rules. */
export function markdownToBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  const para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ t: "p", text: para.join(" ").trim() });
    para.length = 0;
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) { flush(); i++; continue; }

    const fence = /^(```|~~~)\s*([\w+#-]*)/.exec(trimmed);
    if (fence) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      blocks.push({ t: "code", lang: fence[2] || undefined, text: body.join("\n") });
      continue;
    }

    const h = /^(#{1,6})\s+(.*?)\s*#*$/.exec(trimmed);
    if (h) { flush(); blocks.push({ t: "h", level: Math.min(h[1].length, 4) as 1 | 2 | 3 | 4, text: h[2] }); i++; continue; }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { flush(); blocks.push({ t: "hr" }); i++; continue; }

    const img = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/.exec(trimmed);
    if (img) { flush(); blocks.push({ t: "img", alt: img[1], src: img[2], caption: img[3] || img[1] || undefined }); i++; continue; }

    if (trimmed.includes("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      flush();
      const header = splitRow(trimmed);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().includes("|")) {
        const cells = splitRow(lines[i]);
        while (cells.length < header.length) cells.push("");
        rows.push(cells.slice(0, header.length));
        i++;
      }
      blocks.push({ t: "table", header, rows });
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      flush();
      const q: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push({ t: "quote", text: q.join(" ").trim() });
      continue;
    }

    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      flush();
      const ordered = Boolean(ol);
      const items: string[] = [];
      while (i < lines.length) {
        const m = ordered ? /^\s*\d+[.)]\s+(.*)$/.exec(lines[i]) : /^\s*[-*+]\s+(.*)$/.exec(lines[i]);
        if (m) { items.push(m[1].trim()); i++; }
        else if (/^\s{2,}\S/.test(lines[i]) && items.length) { items[items.length - 1] += " " + lines[i].trim(); i++; }
        else break;
      }
      blocks.push({ t: ordered ? "ol" : "ul", items });
      continue;
    }

    para.push(trimmed);
    i++;
  }
  flush();
  return blocks;
}

export function markdownToDoc(md: string, fallbackTitle = "Document"): DocModel {
  const blocks = markdownToBlocks(md);
  let title = fallbackTitle;
  const first = blocks[0];
  if (first && first.t === "h" && first.level === 1) {
    title = stripInline(first.text);
    blocks.shift();
  }
  return { title, blocks };
}

/** Back to Markdown (used for the .md/.txt exports of structured documents). */
export function docToMarkdown(doc: DocModel): string {
  const out: string[] = [`# ${doc.title}`];
  if (doc.subtitle) out.push(`_${doc.subtitle}_`);
  const meta = [doc.author, doc.date].filter(Boolean).join(" - ");
  if (meta) out.push(`_${meta}_`);
  for (const b of doc.blocks) {
    switch (b.t) {
      case "h": out.push(`${"#".repeat(b.level)} ${b.text}`); break;
      case "p": out.push(b.text); break;
      case "ul": out.push(b.items.map((x) => `- ${x}`).join("\n")); break;
      case "ol": out.push(b.items.map((x, n) => `${n + 1}. ${x}`).join("\n")); break;
      case "code": out.push("```" + (b.lang || "") + "\n" + b.text + "\n```"); break;
      case "quote": out.push(`> ${b.text}`); break;
      case "table":
        out.push([`| ${b.header.join(" | ")} |`, `| ${b.header.map(() => "---").join(" | ")} |`, ...b.rows.map((r) => `| ${r.join(" | ")} |`)].join("\n"));
        break;
      case "img": out.push(`![${b.alt || ""}](${b.src.startsWith("data:") ? "embedded-image" : b.src})${b.caption ? `\n_${b.caption}_` : ""}`); break;
      case "hr": out.push("---"); break;
      case "pagebreak": out.push("\n"); break;
    }
  }
  return out.join("\n\n");
}
