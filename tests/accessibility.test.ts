import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * Static accessibility guards that need no browser:
 *  - the colour tokens the UI draws text with meet WCAG AA contrast on the surfaces they sit on, in every theme;
 *  - message actions stay reachable by keyboard and visible on touch screens.
 * (The full route-by-route audit that found these runs in a browser; see docs/PRODUCT-PLAN.md, feature D.)
 */

const root = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");
const tokens = read("web/css/tokens.css");

/** The declarations of the first rule whose selector line contains `selector`. */
function block(selector: string): Record<string, string> {
  const start = tokens.indexOf(selector);
  assert.ok(start >= 0, "selector not found: " + selector);
  const open = tokens.indexOf("{", start);
  let depth = 0, end = open;
  for (let i = open; i < tokens.length; i++) { if (tokens[i] === "{") depth++; else if (tokens[i] === "}" && --depth === 0) { end = i; break; } }
  const out: Record<string, string> = {};
  for (const m of tokens.slice(open + 1, end).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

function rgb(hex: string): [number, number, number] {
  const h = hex.trim().replace("#", "");
  assert.match(h, /^[0-9a-f]{6}$/i, "not a 6-digit hex colour: " + hex);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test("the contrast function agrees with known WCAG values", () => {
  assert.ok(Math.abs(contrast("#000000", "#ffffff") - 21) < 0.01);
  assert.ok(Math.abs(contrast("#777777", "#ffffff") - 4.48) < 0.02); // the classic "just fails AA" grey
  assert.ok(contrast("#79D3ED", "#FFFFFF") < 2, "the pastel accent really is unreadable as text on white");
});

const themes: Array<[string, Record<string, string>]> = [
  ["light", block(':root,\nhtml[data-theme="light"]')],
  ["dark", block('html[data-theme="dark"] {')],
];

for (const [name, t] of themes) {
  test(`${name} theme: text tokens reach 4.5:1 on every surface they are drawn on`, () => {
    const surfaces = ["--canvas", "--surface", "--surface-muted", "--surface-elev"];
    for (const ink of ["--ink", "--ink-soft", "--ink-muted", "--ink-faint", "--accent-text"]) {
      for (const s of surfaces) {
        const r = contrast(t[ink], t[s]);
        assert.ok(r >= 4.5, `${name}: ${ink} ${t[ink]} on ${s} ${t[s]} is ${r.toFixed(2)}:1 (needs 4.5:1)`);
      }
    }
  });
  test(`${name} theme: the accent's ink is readable on the accent fill, and the accent text on its soft tint`, () => {
    assert.ok(contrast(t["--accent-ink"], t["--accent"]) >= 4.5, `${name}: --accent-ink on --accent is ${contrast(t["--accent-ink"], t["--accent"]).toFixed(2)}:1`);
    if (/^#[0-9a-f]{6}$/i.test(t["--accent-soft"])) assert.ok(contrast(t["--accent-text"], t["--accent-soft"]) >= 4.5, `${name}: --accent-text on --accent-soft`);
  });
}

test("system-dark block keeps readable text tokens too", () => {
  const sys = block("@media (prefers-color-scheme: dark)");
  assert.ok(sys, "found");
  const start = tokens.indexOf('html[data-theme="system"]');
  const open = tokens.indexOf("{", start);
  const decl: Record<string, string> = {};
  for (const m of tokens.slice(open + 1, tokens.indexOf("}", open)).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) decl[m[1]] = m[2].trim();
  for (const ink of ["--ink-muted", "--ink-faint", "--accent-text"]) assert.ok(contrast(decl[ink], decl["--surface"]) >= 4.5, `system dark: ${ink} ${decl[ink]} on ${decl["--surface"]}`);
});

test("no stylesheet sets white text on the accent fill (the light theme's accent is a pastel: use --accent-ink)", () => {
  const files = ["pages.css", "components.css", "manage.css", "builder.css", "layout.css", "code-viewer.css"];
  const offenders: string[] = [];
  for (const f of files) {
    const css = read("web/css/" + f).replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of css.matchAll(/\{([^{}]*)\}/g)) {
      const body = m[1];
      if (/background(?:-color)?:\s*var\(--accent\)\s*(?:!important)?\s*;/.test(body) && /(?<![-\w])color:\s*(?:white|#fff|#ffffff)\s*(?:!important)?\s*;/i.test(body)) offenders.push(f + ": " + body.replace(/\s+/g, " ").slice(0, 80));
    }
  }
  assert.deepEqual(offenders, []);
});

test("message actions are reachable by keyboard and shown on touch screens", () => {
  const css = read("web/css/components.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = /\.message__controls\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, "rule found");
  // visibility:hidden would take the buttons out of the tab order, so ":focus-within" could never reveal them
  assert.ok(!/visibility\s*:\s*hidden/.test(rule![1]), ".message__controls must hide with opacity only");
  assert.match(css, /\.message:focus-within \.message__controls/);
  assert.match(css, /@media \(hover: none\), \(pointer: coarse\)\s*\{[^}]*\.message__controls\s*\{[^}]*opacity:\s*1/);
});
