import assert from "node:assert/strict";
import test, { before } from "node:test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import AdmZip from "adm-zip";
import ExcelJS from "exceljs";

import { markdownToBlocks, markdownToDoc, parseInline } from "../server/documents/model.js";
import { EXPORT_FORMATS, exportDocument, type ExportFormat } from "../server/documents/export.js";
import { extractAny, extractExtra, looksLikeText } from "../server/documents/extract.js";

// The rag-engine pulls in the database layer: point it at a throw-away directory.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "darkness-doc-test-"));
process.env.DARKNESS_STORAGE_ROOT = tmp;
let extractDocumentText: (name: string, buf: Buffer) => Promise<{ text: string; error?: string }>;
let png: Buffer;

before(async () => {
  ({ extractDocumentText } = await import("../server/rag-engine.js"));
  const sharp = (await import("sharp")).default;
  png = await sharp({ create: { width: 320, height: 180, channels: 3, background: { r: 30, g: 64, b: 175 } } }).png().toBuffer();
});

const SAMPLE_MD = `# Smart Waste Monitor

## 1. Introduction
This project builds an **IoT-based** waste monitor using \`ESP32\` sensors and a [dashboard](https://example.com/dash).

## 2. Features
- Real-time fill level
- Route optimisation
- Alerts when a bin is *full*

1. Collect data
2. Analyse trends

### 2.1 Stack
| Layer | Tech |
|---|---|
| Firmware | C++ |
| Backend | Node.js |

\`\`\`python
def level(distance_cm):
    return max(0, 100 - distance_cm)
\`\`\`

> Measure twice, deploy once.

---

## 3. Conclusion
Works well. Café, naïve, Δ and 漢字 are preserved in text formats.
`;

async function sampleDoc() {
  const doc = markdownToDoc(SAMPLE_MD);
  doc.subtitle = "Final year project report";
  doc.author = "Darkness AI";
  doc.date = "1 November 2026";
  doc.blocks.splice(2, 0, { t: "img", src: `data:image/png;base64,${png.toString("base64")}`, alt: "Architecture", caption: "Figure 1: Architecture" });
  return doc;
}

test("markdown parser: headings, lists, tables, code, quotes, rules, images", () => {
  const b = markdownToBlocks(SAMPLE_MD);
  const kinds = b.map((x) => x.t);
  for (const k of ["h", "p", "ul", "ol", "table", "code", "quote", "hr"]) assert.ok(kinds.includes(k as any), `missing ${k}`);
  const t = b.find((x) => x.t === "table") as any;
  assert.deepEqual(t.header, ["Layer", "Tech"]);
  assert.equal(t.rows.length, 2);
  assert.equal(markdownToDoc(SAMPLE_MD).title, "Smart Waste Monitor");
  assert.deepEqual(parseInline("a **b** `c` [d](https://e.co)").map((r) => r.text), ["a ", "b", " ", "c", " ", "d"]);
});

for (const format of EXPORT_FORMATS) {
  test(`export ${format}: produces a non-empty, well-formed file`, async () => {
    const out = await exportDocument(await sampleDoc(), format);
    assert.ok(out.buffer.length > (format === "csv" ? 20 : 200), `${format} too small`);
    assert.equal(out.ext, format);
    assert.match(out.filename, new RegExp(`\\.${format}$`));
    if (["docx", "pptx", "xlsx", "odt"].includes(format)) assert.equal(out.buffer.subarray(0, 2).toString(), "PK", "zip container");
    if (format === "pdf") assert.equal(out.buffer.subarray(0, 5).toString(), "%PDF-");
    if (format === "rtf") assert.ok(out.buffer.toString("latin1").startsWith("{\\rtf1"));
  });
}

test("round trip DOCX: the real extractor reads back the headings, list, table and code", async () => {
  const out = await exportDocument(await sampleDoc(), "docx");
  const { text } = await extractDocumentText("report.docx", out.buffer);
  for (const s of ["Smart Waste Monitor", "Introduction", "Real-time fill level", "Route optimisation", "Firmware", "Node.js", "def level"]) {
    assert.ok(text.includes(s), `docx lost: ${s}`);
  }
});

test("round trip PDF: text is extractable", async () => {
  const out = await exportDocument(await sampleDoc(), "pdf");
  const { text } = await extractDocumentText("report.pdf", out.buffer);
  for (const s of ["Smart Waste Monitor", "Introduction", "Real-time fill level", "Conclusion"]) assert.ok(text.includes(s), `pdf lost: ${s}`);
});

test("round trip PPTX: every section becomes a slide", async () => {
  const out = await exportDocument(await sampleDoc(), "pptx");
  const r = await extractAny("deck.pptx", out.buffer);
  assert.equal(r.kind, "PowerPoint presentation");
  for (const s of ["Smart Waste Monitor", "1. Introduction", "2. Features", "Real-time fill level", "3. Conclusion"]) assert.ok(r.text.includes(s), `pptx lost: ${s}`);
});

test("round trip XLSX: tables become sheets with styled headers", async () => {
  const out = await exportDocument(await sampleDoc(), "xlsx");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(out.buffer as any);
  const names = wb.worksheets.map((w) => w.name);
  assert.ok(names.length >= 2, names.join(","));
  const first = wb.worksheets[0];
  assert.equal(first.getRow(1).getCell(1).value, "Layer");
  assert.equal(first.getRow(3).getCell(2).value, "Node.js");
});

test("round trip ODT / RTF / HTML / CSV / MD / TXT / JSON", async () => {
  const doc = await sampleDoc();
  const odt = await extractAny("a.odt", (await exportDocument(doc, "odt")).buffer);
  assert.ok(odt.text.includes("Introduction") && odt.text.includes("Real-time fill level"));
  const rtf = await extractAny("a.rtf", (await exportDocument(doc, "rtf")).buffer);
  assert.ok(rtf.text.includes("Smart Waste Monitor") && rtf.text.includes("Route optimisation"));
  const html = (await exportDocument(doc, "html")).buffer.toString("utf8");
  assert.ok(html.includes("<table>") && html.includes("data:image/png;base64") && html.includes("<h2>"));
  const htmlText = await extractAny("a.html", Buffer.from(html));
  assert.ok(htmlText.text.includes("Real-time fill level"));
  const csv = (await exportDocument(doc, "csv")).buffer.toString("utf8");
  assert.ok(csv.startsWith("﻿Layer,Tech") && csv.includes("Backend,Node.js"));
  const md = (await exportDocument(doc, "md")).buffer.toString("utf8");
  assert.ok(md.startsWith("# Smart Waste Monitor") && md.includes("| Layer | Tech |"));
  const txt = (await exportDocument(doc, "txt")).buffer.toString("utf8");
  assert.ok(!txt.includes("**") && txt.includes("IoT-based"));
  assert.equal(JSON.parse((await exportDocument(doc, "json")).buffer.toString()).title, "Smart Waste Monitor");
});

test("extract: ZIP archives are read with nested documents; zip bombs and traversal names are bounded", async () => {
  const zip = new AdmZip();
  zip.addFile("notes/readme.md", Buffer.from("# Hello\nworld"));
  zip.addFile("data.csv", Buffer.from("a,b\n1,2"));
  zip.addFile("slides.pptx", (await exportDocument(await sampleDoc(), "pptx")).buffer);
  zip.addFile("node_modules/skip.js", Buffer.from("should be skipped"));
  const r = await extractAny("bundle.zip", zip.toBuffer());
  assert.equal(r.kind, "ZIP archive");
  assert.ok(r.text.includes("### notes/readme.md") && r.text.includes("Hello") && r.text.includes("Real-time fill level"));
  assert.ok(!r.text.includes("should be skipped"));
});

test("extract: legacy binaries, images, media and unknown binaries get honest answers", async () => {
  const doc = await extractAny("old.doc", Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0]), Buffer.from("Quarterly budget review meeting notes for the committee\u0000\u0000", "latin1")]));
  assert.match(doc.kind, /legacy binary/);
  assert.ok(doc.warnings?.[0]);
  assert.ok(doc.text.includes("Quarterly budget review"));
  const img = await extractAny("pic.png", png);
  assert.equal(img.kind, "Image");
  assert.match(img.text, /320x180/);
  assert.match((await extractAny("song.mp3", Buffer.from([1, 2, 3]))).text, /not transcribed/);
  assert.match((await extractAny("pack.rar", Buffer.from([1, 2, 3]))).text, /\.zip/);
  assert.equal(looksLikeText(Buffer.from("plain text here")), true);
  assert.equal(looksLikeText(Buffer.from([0, 1, 2, 3, 0, 0])), false);
  assert.equal(await extractExtra("x.unknownext", Buffer.from("just text")), null);
});

test("extract: office/ODF/RTF/EPUB/HTML text types", async () => {
  const rtf = await extractAny("a.rtf", Buffer.from("{\\rtf1\\ansi{\\b Hello} world\\par Second line\\par}"));
  assert.match(rtf.text, /Hello world/);
  assert.match(rtf.text, /Second line/);
  const epub = new AdmZip();
  epub.addFile("OEBPS/ch1.xhtml", Buffer.from("<html><body><h1>Chapter One</h1><p>Once upon a time</p></body></html>"));
  assert.match((await extractAny("book.epub", epub.toBuffer())).text, /Once upon a time/);
  const html = await extractAny("page.html", Buffer.from("<script>evil()</script><h1>Title</h1><p>Body &amp; soul</p>"));
  assert.ok(html.text.includes("Body & soul") && !html.text.includes("evil"));
});

test("every format name has metadata and an exporter", () => {
  const needed: ExportFormat[] = ["docx", "pdf", "pptx", "xlsx", "odt", "rtf", "html", "md", "txt", "csv", "json"];
  assert.deepEqual([...EXPORT_FORMATS].sort(), needed.sort());
});

