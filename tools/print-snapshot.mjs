// Screenshots every printed sheet, to prove a style change leaves print
// output alone (docs/ui-uudistus.md §9).
//
//   node tools/print-snapshot.mjs [--out <dir>] [--compare <dir>] [--types a,b] [--scheme dark]
//
// For every type, at level medium, 2 per page, with solutions: opens
// index.html from disk with a seeded Math.random, generates, and screenshots
// each .sheet under print media to <out>/<type>-<n>.png (default
// previews/print). The seed restarts on every page load, so each type gets
// the same puzzles on every run, whatever the code around it.
//
// With --compare, every sheet is checked pixel by pixel against the PNG of
// the same name in that directory, and each difference is reported. Every run
// also checks that nothing prints above the first sheet. The exit
// code is 1 when any sheet differs or is missing on either side.
//
// --scheme dark runs it with the system in dark mode, which must not reach
// paper either: compare that run against the same light baseline.
//
// Make the baseline on main first:
//   node tools/print-snapshot.mjs --out previews/print-main
// then, on the branch:
//   node tools/print-snapshot.mjs --compare previews/print-main

import {readFileSync, readdirSync, mkdirSync, rmSync, existsSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {execSync} from "node:child_process";
import {createRequire} from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = ["sudoku9", "sudoku6", "diagonal", "jigsaw", "kropki", "killer",
  "futoshiki", "skyscrapers", "kakuro", "hitori", "hashi", "nonogram"];
const SEED = 0x5EED1234;

const args = process.argv.slice(2);
const arg = name => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };
const out = resolve(ROOT, arg("--out") || "previews/print");
const compare = arg("--compare") && resolve(ROOT, arg("--compare"));
const only = arg("--types") ? arg("--types").split(",") : TYPES;
const scheme = arg("--scheme") || "light";
if (only.some(t => !TYPES.includes(t)) || (compare && !existsSync(compare)) || !["light", "dark"].includes(scheme)) {
  console.error("usage: node tools/print-snapshot.mjs [--out <dir>] [--compare <dir>] [--types a,b] [--scheme dark]");
  process.exit(1);
}

/* Playwright from the project, else the global install */
async function loadPlaywright() {
  try { return await import("playwright"); } catch {}
  const root = execSync("npm root -g", {encoding: "utf8"}).trim();
  return createRequire(join(root, "noop.js"))("playwright");
}

const {chromium} = await loadPlaywright();
const proxy = process.env.HTTPS_PROXY ? {server: process.env.HTTPS_PROXY} : undefined;
const browser = await chromium.launch({proxy});
/* 182 mm, the width of an A4 page inside the @page margins */
const context = await browser.newContext({viewport: {width: 688, height: 1000}, deviceScaleFactor: 1, colorScheme: scheme});
await context.addInitScript(seed => {
  /* mulberry32 */
  let a = seed >>> 0;
  Math.random = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}, SEED);

rmSync(out, {recursive: true, force: true});
mkdirSync(out, {recursive: true});
const page = await context.newPage();
const url = pathToFileURL(join(ROOT, "index.html")).href;
const written = [];
let bad = 0;

for (const type of only) {
  const t0 = Date.now();
  await page.emulateMedia({media: "screen"});
  await page.goto(url, {waitUntil: "load"});
  await page.evaluate(async type => {
    const sel = document.getElementById("type");
    sel.value = type;
    sel.dispatchEvent(new Event("change"));
    document.querySelector('#seg-level button[data-value="medium"]').click();
    document.querySelector('#seg-layout button[data-value="2"]').click();
    document.getElementById("opt-solutions").checked = true;
    await generate();
  }, type);
  await page.emulateMedia({media: "print"});
  await page.evaluate(() => document.fonts.ready);
  /* nothing but the sheets may print: the first one starts the page */
  const top = await page.evaluate(() => document.querySelector(".sheet").getBoundingClientRect().top + scrollY);
  if (top !== 0) { console.log(`DIFF  ${type}: something prints above the first sheet (${top} px)`); bad++; }
  const sheets = page.locator(".sheet");
  const n = await sheets.count();
  for (let i = 0; i < n; i++) {
    const file = `${type}-${i + 1}.png`;
    await sheets.nth(i).screenshot({path: join(out, file)});
    written.push(file);
  }
  console.log(`${type.padEnd(12)} ${n} sheets  (${Date.now() - t0} ms)`);
}

if (compare) {
  /* both PNGs decoded by the browser and compared pixel by pixel */
  const diff = async (a, b) => page.evaluate(async ([a, b]) => {
    const load = src => new Promise((ok, fail) => { const im = new Image(); im.onload = () => ok(im); im.onerror = fail; im.src = src; });
    const [x, y] = await Promise.all([load(a), load(b)]);
    if (x.width !== y.width || x.height !== y.height) return `size ${y.width} × ${y.height}, was ${x.width} × ${x.height}`;
    const px = im => {
      const c = document.createElement("canvas");
      c.width = im.width; c.height = im.height;
      const g = c.getContext("2d");
      g.drawImage(im, 0, 0);
      return g.getImageData(0, 0, im.width, im.height).data;
    };
    const p = px(x), q = px(y);
    let n = 0;
    for (let i = 0; i < p.length; i += 4) {
      if (p[i] !== q[i] || p[i + 1] !== q[i + 1] || p[i + 2] !== q[i + 2] || p[i + 3] !== q[i + 3]) n++;
    }
    return n ? `${n} pixels differ` : "";
  }, [a, b]);
  const dataUrl = f => "data:image/png;base64," + readFileSync(f).toString("base64");
  await page.goto("about:blank");
  const base = new Set(readdirSync(compare).filter(f => f.endsWith(".png") &&
    only.includes(f.replace(/-\d+\.png$/, ""))));
  for (const f of written) {
    if (!base.has(f)) { console.log(`DIFF  ${f}: not in the baseline`); bad++; continue; }
    base.delete(f);
    const a = readFileSync(join(compare, f)), b = readFileSync(join(out, f));
    if (a.equals(b)) continue;
    const why = await diff(dataUrl(join(compare, f)), dataUrl(join(out, f)));
    if (why) { console.log(`DIFF  ${f}: ${why}`); bad++; }
  }
  for (const f of base) { console.log(`DIFF  ${f}: missing from this run`); bad++; }
  console.log(bad ? `${bad} differences from ${compare}` : `all ${written.length} sheets match ${compare}`);
}

await browser.close();
console.log(`${written.length} sheets written to ${out}`);
process.exit(bad ? 1 : 0);
