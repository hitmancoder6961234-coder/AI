import assert from "node:assert/strict";
import test from "node:test";
import { detectKind, validateSignature } from "../server/upload-validation.js";

const b = (...bytes: number[]) => Buffer.from(bytes);
const pad = (head: Buffer, n = 64) => Buffer.concat([head, Buffer.alloc(Math.max(0, n - head.length), 0x20)]);
const txt = (s: string) => Buffer.from(s, "utf8");

const PDF = pad(txt("%PDF-1.7\n%âãÏÓ\n1 0 obj"));
const ZIP = pad(b(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00));
const OLE = pad(b(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1));
const PNG = pad(b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a));
const JPG = pad(b(0xff, 0xd8, 0xff, 0xe0));
const GIF = pad(txt("GIF89a"));
const WEBP = pad(Buffer.concat([txt("RIFF"), b(0, 0, 0, 0), txt("WEBP")]));
const MP4 = pad(Buffer.concat([b(0, 0, 0, 0x18), txt("ftypmp42")]));
const MP3 = pad(txt("ID3"));
const WAV = pad(Buffer.concat([txt("RIFF"), b(0, 0, 0, 0), txt("WAVE")]));
const GZ = pad(b(0x1f, 0x8b, 0x08));
const ELF = pad(b(0x7f, 0x45, 0x4c, 0x46, 2, 1, 1));
const PE = (() => { const h = Buffer.alloc(256); h.write("MZ", 0); h.writeUInt32LE(0x80, 0x3c); h.write("PE\0\0", 0x80, "latin1"); return h; })();

test("real files of every supported kind are accepted", () => {
  const ok: Array<[string, Buffer]> = [
    ["report.pdf", PDF], ["letter.docx", ZIP], ["sheet.xlsx", ZIP], ["deck.pptx", ZIP], ["notes.odt", ZIP], ["book.epub", ZIP], ["bundle.zip", ZIP],
    ["old.doc", OLE], ["old.xls", OLE], ["old.ppt", OLE], ["pic.png", PNG], ["photo.jpg", JPG], ["photo.JPEG", JPG], ["anim.gif", GIF], ["img.webp", WEBP],
    ["clip.mp4", MP4], ["song.mp3", MP3], ["sound.wav", WAV], ["data.tar.gz", GZ], ["README.md", txt("# Title\n\nbody")], ["main.py", txt("print('hi')\n")],
    ["app.js", txt("export const a = 1;\n")], ["data.json", txt('{"a":1}')], ["table.csv", txt("a,b\n1,2\n")], ["page.html", txt("<!doctype html><p>x")],
    ["logo.svg", txt('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>')], ["Makefile", txt("all:\n\techo hi\n")], ["notes.txt", txt("plain text")],
  ];
  for (const [name, head] of ok) {
    const v = validateSignature(name, head);
    assert.equal(v.ok, true, `${name} should be accepted: ${v.message}`);
  }
});

test("a file whose content is not what its name says is refused", () => {
  const bad: Array<[string, Buffer, string]> = [
    ["fake.pdf", txt("<html>not a pdf</html>"), "INVALID_FILE_SIGNATURE"],
    ["fake.png", txt("just some text"), "INVALID_FILE_SIGNATURE"],
    ["fake.jpg", PNG, "INVALID_FILE_SIGNATURE"],
    ["fake.docx", PDF, "INVALID_FILE_SIGNATURE"],
    ["fake.xlsx", txt("a,b,c\n1,2,3"), "INVALID_FILE_SIGNATURE"],
    ["fake.zip", txt("not an archive"), "INVALID_FILE_SIGNATURE"],
    ["fake.gif", JPG, "INVALID_FILE_SIGNATURE"],
    ["fake.mp3", txt("not audio at all"), "INVALID_FILE_SIGNATURE"],
    ["fake.svg", PNG, "INVALID_FILE_SIGNATURE"],
    ["fake.rtf", txt("plain"), "INVALID_FILE_SIGNATURE"],
  ];
  for (const [name, head, code] of bad) {
    const v = validateSignature(name, head);
    assert.equal(v.ok, false, `${name} must be refused`);
    assert.equal(v.code, code, name);
    assert.match(v.message || "", new RegExp(name.replace(".", "\\.")), "the message names the file");
  }
});

test("binary data in a file that should be text is refused; a real archive or image hiding in one too", () => {
  for (const name of ["code.js", "notes.txt", "data.json", "style.css", "table.csv", "README.md", "script.py"]) {
    const v = validateSignature(name, Buffer.concat([txt("looks fine"), b(0, 1, 2, 3, 0)]));
    assert.equal(v.ok, false, name);
    assert.equal(v.code, "BINARY_IN_TEXT_FILE");
  }
  assert.equal(validateSignature("notes.txt", ZIP).ok, false, "a zip named .txt");
  assert.equal(validateSignature("app.js", PNG).ok, false, "a png named .js");
  // UTF-16 text legitimately contains NUL bytes
  assert.equal(validateSignature("note.txt", Buffer.from([0xff, 0xfe, 0x48, 0x00, 0x69, 0x00])).ok, true);
});

test("executable programs are refused when disguised, and outright on document routes", () => {
  for (const exe of [ELF, PE]) {
    for (const name of ["photo.png", "notes.txt", "report.pdf", "app.js", "data", "weird.xyz"]) {
      const v = validateSignature(name, exe);
      assert.equal(v.ok, false, `${name} disguising an executable`);
      assert.equal(v.code, "EXECUTABLE_CONTENT");
    }
  }
  // a project folder may genuinely contain a real .exe: allowed only where the route permits it
  assert.equal(validateSignature("tool.exe", PE).ok, true);
  assert.equal(validateSignature("tool.exe", PE, { blockExecutables: true }).code, "EXECUTABLE_CONTENT");
  assert.equal(validateSignature("lib.so", ELF).ok, true);
  assert.equal(validateSignature("tool.exe", txt("not really an exe")).ok, false);
});

test("things that must keep working: empty files, unknown extensions, legacy text exports, Java classes", () => {
  assert.equal(validateSignature("empty.png", Buffer.alloc(0)).ok, true, "an empty file has nothing to contradict");
  assert.equal(validateSignature("data.bin", b(0, 1, 2, 3, 0xff)).ok, true, "unknown binary types are allowed on project routes");
  assert.equal(validateSignature("notes.xyz", txt("plain")).ok, true);
  assert.equal(validateSignature("export.xls", txt("<table><tr><td>1</td></tr></table>")).ok, true, "HTML saved as .xls");
  assert.equal(validateSignature("export.doc", txt("plain words")).ok, true);
  assert.equal(validateSignature("Main.class", b(0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 0x34)).ok, true);
  assert.equal(validateSignature("../../etc/passwd", txt("root:x:0:0")).ok, true, "only the base name matters; there is no extension to contradict");
});

test("detectKind recognises the common signatures", () => {
  assert.equal(detectKind(PDF), "pdf");
  assert.equal(detectKind(ZIP), "zip");
  assert.equal(detectKind(PNG), "png");
  assert.equal(detectKind(JPG), "jpeg");
  assert.equal(detectKind(ELF), "elf");
  assert.equal(detectKind(PE), "pe");
  assert.equal(detectKind(txt("hello world")), null);
});
