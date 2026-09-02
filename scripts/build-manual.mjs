#!/usr/bin/env node
/*
 * Build the user manual PDF from docs/manual/*.md.
 *
 *   node scripts/build-manual.mjs            -> docs/manual/fpv-sim-manual.pdf
 *   node scripts/build-manual.mjs --html     -> only docs/manual/.build/manual.html
 *
 * Chapters are concatenated in file order (README.md, then NN-*.md, then
 * A-G-*.md), rendered with marked, wrapped in print CSS, and printed to
 * PDF by the bundled Electron (scripts/manual-pdf-main.cjs) — no extra
 * native dependencies. GitHub-style alerts (> [!NOTE] ...) become styled
 * callouts; cross-chapter links (./06-studies.md#anchor) become in-document
 * anchors; heading ids follow GitHub's slug rules so the same links work on
 * GitHub and in the PDF.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { Marked } from "marked";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manualDir = path.join(root, "docs", "manual");
const buildDir = path.join(manualDir, ".build");
const htmlOut = path.join(buildDir, "manual.html");
const pdfOut = path.join(manualDir, "fpv-sim-manual.pdf");
const htmlOnly = process.argv.includes("--html");

function chapterFiles() {
  const names = readdirSync(manualDir).filter((f) => f.endsWith(".md"));
  const numbered = names.filter((f) => /^\d\d-.*\.md$/.test(f)).sort();
  const lettered = names.filter((f) => /^[A-Z]-.*\.md$/.test(f)).sort();
  const front = names.includes("README.md") ? ["README.md"] : [];
  return [...front, ...numbered, ...lettered];
}

/** GitHub-compatible heading slug (lowercase, strip punctuation, spaces -> hyphens). */
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z]+;|&#\d+;/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

const usedIds = new Map();
function uniqueId(base) {
  const n = usedIds.get(base) ?? 0;
  usedIds.set(base, n + 1);
  return n === 0 ? base : `${base}-${n}`;
}

const marked = new Marked({ gfm: true, breaks: false });
marked.use({
  renderer: {
    heading(token) {
      const inner = this.parser.parseInline(token.tokens);
      const id = uniqueId(slugify(token.text));
      return `<h${token.depth} id="${id}">${inner}</h${token.depth}>\n`;
    },
    image(token) {
      const src = token.href.startsWith("images/") ? `../${token.href}` : token.href;
      const title = token.title ? ` title="${token.title}"` : "";
      return `<img src="${src}" alt="${token.text ?? ""}"${title}>`;
    },
    link(token) {
      const inner = this.parser.parseInline(token.tokens);
      let href = token.href;
      const m = href.match(/^(?:\.\/)?([A-Za-z0-9-]+)\.md(#.*)?$/);
      if (m) href = m[2] ? m[2] : `#ch-${m[1].toLowerCase()}`;
      const external = /^https?:/.test(href) ? ` class="ext"` : "";
      return `<a href="${href}"${external}>${inner}</a>`;
    },
  },
});

const ALERT_LABEL = { NOTE: "Note", TIP: "Tip", IMPORTANT: "Important", WARNING: "Warning", CAUTION: "Caution" };
function alerts(html) {
  return html.replace(
    /<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<br>)?\s*/g,
    (_m, kind) => `<blockquote class="alert alert-${kind.toLowerCase()}"><p><span class="alert-label">${ALERT_LABEL[kind]}</span> `,
  );
}

const css = `
  @page { size: A4; margin: 15mm 14mm 16mm 14mm; }
  html { font-size: 10.5pt; }
  body { font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif; color: #1c2410; line-height: 1.45; margin: 0; }
  section.chapter { page-break-before: always; }
  section.chapter:first-of-type { page-break-before: auto; }
  h1 { font-size: 22pt; letter-spacing: 0.02em; border-bottom: 3px solid #a7d129; padding-bottom: 4px; margin: 0 0 14px; }
  h2 { font-size: 15pt; margin: 20px 0 8px; color: #2b3a12; page-break-after: avoid; }
  h3 { font-size: 12pt; margin: 16px 0 6px; page-break-after: avoid; }
  h4 { font-size: 10.5pt; margin: 12px 0 4px; page-break-after: avoid; }
  p, li { orphans: 3; widows: 3; }
  code, pre, kbd { font-family: "Cascadia Mono", Consolas, "Courier New", monospace; font-size: 9pt; }
  code { background: #eef1e8; padding: 1px 4px; border-radius: 3px; }
  pre { background: #10140f; color: #cdd6c4; padding: 9px 11px; border-radius: 5px; overflow-x: auto; white-space: pre-wrap; page-break-inside: avoid; }
  pre code { background: none; padding: 0; color: inherit; }
  kbd { border: 1px solid #b9c2b0; border-bottom-width: 2px; border-radius: 3px; padding: 0 4px; background: #fafbf7; }
  img { max-width: 100%; height: auto; display: block; margin: 8px auto 4px; border: 1px solid #d5dccb; border-radius: 4px; page-break-inside: avoid; }
  em.caption, p.caption { display: block; text-align: center; color: #5b6650; font-size: 9pt; margin: 0 0 12px; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0 12px; font-size: 9.5pt; page-break-inside: avoid; }
  th, td { border: 1px solid #d5dccb; padding: 4px 7px; vertical-align: top; text-align: left; }
  th { background: #eef1e8; }
  blockquote { margin: 10px 0; padding: 8px 12px; border-left: 4px solid #b9c2b0; background: #f6f8f2; page-break-inside: avoid; }
  blockquote p { margin: 0; }
  .alert-label { font-weight: 700; letter-spacing: 0.04em; margin-right: 4px; }
  .alert-note { border-left-color: #4a7bd0; } .alert-note .alert-label { color: #2f5db0; }
  .alert-tip { border-left-color: #5d7a1a; } .alert-tip .alert-label { color: #4a6412; }
  .alert-important { border-left-color: #7d4fc9; } .alert-important .alert-label { color: #63389f; }
  .alert-warning { border-left-color: #d9a400; } .alert-warning .alert-label { color: #9a7300; }
  .alert-caution { border-left-color: #d16a4a; } .alert-caution .alert-label { color: #a8452a; }
  a { color: #2f5db0; text-decoration: none; }
  hr { border: 0; border-top: 1px solid #d5dccb; margin: 16px 0; }
  .toc-note { color: #5b6650; font-size: 9pt; }
`;

function build() {
  mkdirSync(buildDir, { recursive: true });
  const files = chapterFiles();
  if (files.length === 0) throw new Error(`no chapters found in ${manualDir}`);
  let body = "";
  for (const f of files) {
    const md = readFileSync(path.join(manualDir, f), "utf8");
    const id = `ch-${f.replace(/\.md$/, "").toLowerCase()}`;
    let html = marked.parse(md);
    html = alerts(html);
    // Italic caption lines directly under an image become styled captions.
    html = html.replace(/<p><em>(Figure [^<]*)<\/em><\/p>/g, `<p class="caption">$1</p>`);
    body += `<section class="chapter" id="${id}">\n${html}\n</section>\n`;
  }
  const title = "FPV Sim — User Manual";
  const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>${css}</style></head>
<body>
${body}
</body></html>
`;
  writeFileSync(htmlOut, page);
  console.log(`wrote ${path.relative(root, htmlOut)} (${files.length} chapters)`);
  if (htmlOnly) return;
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(electronPath, [path.join(root, "scripts", "manual-pdf-main.cjs"), htmlOut, pdfOut], {
    stdio: "inherit",
    env,
  });
  if (r.status !== 0) throw new Error(`electron printToPDF exited with ${r.status}`);
}

build();
