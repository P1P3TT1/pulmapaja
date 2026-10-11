// Builds the single-file artifact preview of the app (docs/ratkaise-ruudulla.md §10).
//
//   node tools/build-preview.mjs --open <type>:<level> [--mode print] [--play-url <url>]
//
// --mode print starts on generated print sheets instead of play mode, and
// --play-url sets PLAY_BASE_URL in script.js, so the sheets carry QR codes.
//
// Writes previews/pulmapaja-preview.html: index.html with the stylesheet and
// every local script inlined, no document wrappers (the artifact host adds
// its own), a starting point for play mode, and the print controls hidden,
// since the artifact frame cannot open the print dialog.

import {readFileSync, writeFileSync, mkdirSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = p => readFileSync(join(ROOT, p), "utf8");

const args = process.argv.slice(2);
const arg = (name, fallback) => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : fallback; };
const open = arg("--open", "sudoku9:easy"), mode = arg("--mode", "play"), playUrl = arg("--play-url", "");
if (!/^[a-z0-9]+:(easy|medium|hard)$/.test(open || "") || !["play", "print"].includes(mode) ||
    (playUrl && !/^https?:\/\/[^\s"\\]+$/.test(playUrl))) {
  console.error("usage: node tools/build-preview.mjs --open <type>:<easy|medium|hard> [--mode play|print] [--play-url <url>]");
  process.exit(1);
}

const html = read("index.html");
const head = /<head>([\s\S]*?)<\/head>/.exec(html)[1];
const body = /<body>([\s\S]*?)<\/body>/.exec(html)[1];

const title = /<title>[\s\S]*?<\/title>/.exec(head)[0];
const fontLinks = [...head.matchAll(/<link [^>]*href="https:\/\/fonts\.(?:googleapis|gstatic)\.com[^"]*"[^>]*>/g)].map(m => m[0]);
const styles = [...head.matchAll(/<link rel="stylesheet" href="(?!https?:)([^"]+)">/g)].map(m => read(m[1]));
const scripts = [...head.matchAll(/<script src="(?!https?:)([^"]+)"[^>]*><\/script>/g)].map(m => m[1]);

/* a literal </script> inside a script would end the inline block early */
const inlineJs = s => s.replace(/<\/script/gi, "<\\/script");

const EMPTY_URL = 'const PLAY_BASE_URL = "";';
const source = p => {
  let js = read(p);
  if (p === "scripts/script.js" && playUrl) {
    if (!js.includes(EMPTY_URL)) { console.error(`${p}: ${EMPTY_URL} not found`); process.exit(1); }
    js = js.replace(EMPTY_URL, `const PLAY_BASE_URL = ${JSON.stringify(playUrl)};`);
  }
  return js;
};

const out = [
  title,
  ...fontLinks,
  "<style>",
  styles.join("\n"),
  "/* preview build: the artifact frame cannot open the print dialog */",
  "#print,#pdf-hint{display:none!important}",
  "</style>",
  body.trim(),
  `<script>window.PULMAPAJA_PREVIEW = ${JSON.stringify({mode, open})};</script>`,
  "<script>",
  scripts.map(p => `/* ---- ${p} ---- */\n` + inlineJs(source(p))).join("\n"),
  "</script>",
  ""
].join("\n");

mkdirSync(join(ROOT, "previews"), {recursive: true});
writeFileSync(join(ROOT, "previews/pulmapaja-preview.html"), out);
console.log(`previews/pulmapaja-preview.html  ${(out.length / 1024).toFixed(0)} kB  ` +
  `${scripts.length} scripts inlined (${scripts.join(", ")})  ${mode} ${open}` + (playUrl ? `  PLAY_BASE_URL ${playUrl}` : ""));
