// Accessibility checks for WCAG 2.1 AA (docs/saavutettavuus.md §8.2).
//
//   node tools/a11y-check.mjs [--only axe,tokens,speech,keys,reflow] [--types a,b]
//
// Opens index.html from disk with a seeded Math.random and an empty
// localStorage, as print-snapshot.mjs does, and runs five groups of checks:
//
//   axe     axe-core 4 with the WCAG 2.0/2.1 A and AA tags, in light and
//           dark, at 1280 × 900 and 375 × 740: print mode empty and
//           generated, play mode for every type, and each overlay open
//   tokens  the colour pairs of the audit's contrast table, computed from
//           the :root tokens and their dark overrides in styles/styles.css,
//           so a token change is caught on states axe never renders
//   speech  what #play-sr says while a type is played from the keyboard
//   keys    P pauses from the board only, not from a dock button
//   reflow  no horizontal scroll at 320 px, in print and in play mode
//
// --types limits the play-mode states of axe and speech. The exit code is 1
// when any check fails. axe-core comes from the project, else the global
// install (npm i -g axe-core).

import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {execSync} from "node:child_process";
import {createRequire} from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = ["sudoku9", "sudoku6", "diagonal", "jigsaw", "kropki", "killer",
  "futoshiki", "skyscrapers", "kakuro", "hitori", "hashi", "nonogram"];
const GROUPS = ["axe", "tokens", "speech", "keys", "reflow"];
const SEED = 0x5EED1234;
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

const args = process.argv.slice(2);
const arg = name => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };
const only = arg("--only") ? arg("--only").split(",") : GROUPS;
const types = arg("--types") ? arg("--types").split(",") : TYPES;
if (only.some(g => !GROUPS.includes(g)) || types.some(t => !TYPES.includes(t))) {
  console.error("usage: node tools/a11y-check.mjs [--only axe,tokens,speech,keys,reflow] [--types a,b]");
  process.exit(1);
}

/* a package from the project, else the global install */
async function load(name) {
  try { return await import(name); } catch {}
  const root = execSync("npm root -g", {encoding: "utf8"}).trim();
  return createRequire(join(root, "noop.js"))(name);
}

const fails = [];
const fail = (group, msg) => { fails.push(`${group}: ${msg}`); console.log(`FAIL  ${group}: ${msg}`); };

/* ---------- tokens ---------- */

/* The custom properties of the first rule block that follows `head`. */
function block(css, head) {
  const at = css.indexOf(head);
  if (at < 0) return null;
  const open = css.indexOf("{", at + head.length - 1), close = css.indexOf("}", open);
  const out = {};
  for (const m of css.slice(open + 1, close).matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) out[m[1]] = m[2].trim();
  return out;
}

/* the opacity a rule sets, 1 when it sets none */
function opacityOf(css, selector) {
  const at = css.indexOf(selector + "{");
  if (at < 0) return 1;
  const m = /opacity\s*:\s*([\d.]+)/.exec(css.slice(at, css.indexOf("}", at)));
  return m ? +m[1] : 1;
}

const rgb = hex => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  return m ? [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)) : null;
};
const lum = c => {
  const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
/* a colour at an opacity, over another */
const over = (fg, bg, a) => fg.map((v, i) => Math.round(v * a + bg[i] * (1 - a)));

function checkTokens() {
  const css = readFileSync(join(ROOT, "styles/styles.css"), "utf8");
  const light = block(css, ":root{");
  const darkMedia = block(css, ':root:not([data-theme="light"]){');
  const darkAttr = block(css, ':root[data-theme="dark"]{');
  if (!light || !darkMedia || !darkAttr) { fail("tokens", "cannot find :root or the dark blocks in styles.css"); return; }
  /* both dark blocks must say the same */
  for (const k of new Set([...Object.keys(darkMedia), ...Object.keys(darkAttr)])) {
    if (darkMedia[k] !== darkAttr[k]) fail("tokens", `${k} differs between the two dark blocks (${darkMedia[k]} / ${darkAttr[k]})`);
  }
  const dark = Object.assign({}, light, darkAttr);
  const used = opacityOf(css, ".pad button.used"), done = opacityOf(css, ".play-board .ngram .clue span.done");
  /* [what, foreground, background, minimum, foreground opacity] */
  const PAIRS = [
    ["lede, labels, notes", "--ink-soft", "--surface", 4.5],
    ["play status, key help", "--ink-soft", "--bg", 4.5],
    ["status line, image result", "--blue", "--surface", 4.5],
    ["beta tag, blue chip, active tool", "--blue", "--blue-soft", 4.5],
    ["primary button text", "--on-accent", "--blue", 4.5],
    ["done banner, level chip", "--green-ink", "--green-soft", 4.5],
    ["entered digit on selected cell", "--blue-hl", "--selbg", 4.5],
    ["clashing digit on selected cell", "--red-hl", "--selbg", 4.5],
    ["note digits on peer cell", "--ink-soft", "--peer", 4.5],
    ["kakuro sums on clue cell", "--ink", "--clue-cell", 4.5],
    ["hitori shaded-cell digit", "--shade-ink", "--ink", 4.5],
    ["used-up pad digit", "--ink", "--fill", 4.5, used],
    ["crossed-out nonogram clue", "--ink-soft", "--board", 4.5, done],
    ["focus ring on a surface", "--blue", "--surface", 3],
    ["focus ring on the page", "--blue", "--bg", 3],
    ["selected-cell ring", "--blue", "--selbg", 3],
    ["thick grid lines", "--grid-thick", "--board", 3],
    ["switch, on", "--blue", "--surface-2", 3],
    ["thin grid lines", "--grid-thin", "--board", 3],
    ["input and stepper border", "--grid-thin", "--surface-2", 3],
    ["selected segment edge, track", "--edge", "--fill", 3],
    ["selected segment edge, top-bar track", "--edge", "--fill-strong", 3],
    ["switch, off track", "--edge", "--surface-2", 3]
  ];
  let n = 0;
  for (const [scheme, t] of [["light", light], ["dark", dark]]) {
    for (const [what, f, b, min, alpha = 1] of PAIRS) {
      const fg = rgb(t[f] || ""), bg = rgb(t[b] || "");
      if (!fg || !bg) { fail("tokens", `${scheme} ${what}: ${!fg ? f : b} is not a #rrggbb token`); continue; }
      const r = ratio(alpha < 1 ? over(fg, bg, alpha) : fg, bg);
      n++;
      if (r < min) fail("tokens", `${scheme} ${what}: ${f}${alpha < 1 ? ` at ${alpha}` : ""} on ${b} is ${r.toFixed(2)}:1, needs ${min}:1`);
    }
  }
  console.log(`tokens   ${n} pairs checked`);
}

if (only.includes("tokens")) checkTokens();

/* ---------- the browser ---------- */

const browserGroups = only.filter(g => g !== "tokens");
if (browserGroups.length) {
  const {chromium} = await load("playwright");
  const axeSource = only.includes("axe") ? await load("axe-core").then(m => (m.default || m).source).catch(() => null) : "";
  if (axeSource === null) { console.error("axe-core not found: npm i -g axe-core"); process.exit(1); }

  const proxy = process.env.HTTPS_PROXY ? {server: process.env.HTTPS_PROXY} : undefined;
  const browser = await chromium.launch({proxy});
  const url = pathToFileURL(join(ROOT, "index.html")).href;

  async function newPage(width, height, scheme) {
    const context = await browser.newContext({viewport: {width, height}, deviceScaleFactor: 1, colorScheme: scheme});
    await context.addInitScript(seed => {
      /* mulberry32, as in print-snapshot.mjs */
      let a = seed >>> 0;
      Math.random = () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      /* no saved puzzle reopens, so every state starts the same */
      try { localStorage.clear(); } catch {}
      /* every text #play-sr speaks, in order */
      window.__sr = [];
      addEventListener("DOMContentLoaded", () => {
        const sr = document.getElementById("play-sr");
        if (sr) new MutationObserver(() => { if (sr.textContent) window.__sr.push(sr.textContent); })
          .observe(sr, {childList: true, characterData: true, subtree: true});
      });
    }, SEED);
    return {context, page: await context.newPage()};
  }

  const frames = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

  /* print mode, sheets generated */
  async function printSheets(page) {
    await page.goto(url, {waitUntil: "load"});
    await page.evaluate(async () => { await generate(); });
  }

  /* play mode on a new easy puzzle of a type */
  async function playType(page, type) {
    await page.goto(url, {waitUntil: "load"});
    await page.evaluate(type => {
      const sel = document.getElementById("type");
      sel.value = type;
      sel.dispatchEvent(new Event("change"));
      document.querySelector('#seg-level button[data-value="easy"]').click();
      document.querySelector('#seg-mode button[data-value="play"]').click();
    }, type);
    await page.waitForFunction(() => !document.getElementById("play").classList.contains("no-puzzle") &&
      document.getElementById("play-board").firstElementChild, null, {timeout: 120000});
    await frames(page);
  }

  /* ---------- axe ---------- */

  if (only.includes("axe")) {
    /* rule id → {impact, help, states, nodes, example} */
    const found = new Map();
    let states = 0;
    async function audit(page, label) {
      /* a popover still fading in would read as low contrast */
      await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished)));
      await frames(page);
      if (!await page.evaluate(() => !!window.axe)) await page.addScriptTag({content: axeSource});
      const res = await page.evaluate(tags => axe.run(document, {runOnly: {type: "tag", values: tags}, resultTypes: ["violations"]}), AXE_TAGS);
      states++;
      for (const v of res.violations) {
        const r = found.get(v.id) || {impact: v.impact, help: v.help, states: [], nodes: 0, example: v.nodes[0].target.join(" ")};
        r.states.push(label);
        r.nodes += v.nodes.length;
        found.set(v.id, r);
      }
    }
    async function overlay(page, label, open) {
      await open();
      await page.waitForFunction(() => [...document.querySelectorAll("dialog.overlay")].some(d => d.open));
      await audit(page, label);
      await page.evaluate(() => Overlay.closeAll());
    }

    for (const scheme of ["light", "dark"]) {
      for (const [w, h] of [[1280, 900], [375, 740]]) {
        const tag = `${scheme} ${w}`, t0 = Date.now();
        const {context, page} = await newPage(w, h, scheme);
        await page.goto(url, {waitUntil: "load"});
        await audit(page, `${tag} print empty`);
        await printSheets(page);
        await audit(page, `${tag} print generated`);
        for (const type of types) {
          await playType(page, type);
          await audit(page, `${tag} play ${type}`);
        }
        await playType(page, types[0]);
        await overlay(page, `${tag} Uusi tehtävä`, () => page.click("#title-pill"));
        await overlay(page, `${tag} Jaa ja jatka`, async () => { await page.click("#share-btn"); await page.click("#codes-toggle"); });
        await overlay(page, `${tag} Omat tehtävät`, () => page.click("#menu-btn"));
        await overlay(page, `${tag} Pulmatyyppi`, async () => { await page.click("#title-pill"); await page.click("#type-row"); });
        /* the Säännöt button is hidden on wide screens, where the rules
           sit beside the board */
        if (w < 700) await overlay(page, `${tag} Säännöt`, () => page.click("#rules-btn"));
        await context.close();
        console.log(`axe      ${tag.padEnd(10)} (${Date.now() - t0} ms)`);
      }
    }
    for (const [id, r] of found) {
      fail("axe", `${id} (${r.impact}) – ${r.help}: ${r.nodes} nodes in ${r.states.length} of ${states} states, ` +
        `e.g. ${r.states[0]}: ${r.example}`);
    }
    console.log(`axe      ${states} states, ${found.size} rules violated`);
  }

  /* ---------- speech ---------- */

  /* what #play-sr is expected to say, per type (docs/saavutettavuus.md
     §3–4): on I, somewhere along a sweep across the top row and down the
     last column, and which edits apply */
  const CELL = /Rivi \d+, sarake \d+: /;
  const SPEECH = {
    sudoku9: {i: [CELL], edits: "digits", clash: true},
    sudoku6: {i: [CELL], edits: "digits"},
    diagonal: {i: [/Lävistäjällä\./], move: [/Lävistäjällä\./], edits: "digits"},
    jigsaw: {i: [/Alue \d+: rivi \d+ sarake \d+/], move: [/Alue \d+\./], edits: "digits"},
    killer: {i: [/Häkki \d+, \d+ ruutua: rivi \d+ sarake \d+/], move: [/Häkki \d+, \d+ ruutua\./], edits: "digits"},
    kropki: {i: [/Pallot: |Ei palloja\./], move: [/Pallot: |Ei palloja\./], edits: "digits"},
    futoshiki: {i: [/(Pienempi|Suurempi) kuin|Ei merkkejä\./], move: [/(Pienempi|Suurempi) kuin|Ei merkkejä\./], edits: "digits"},
    skyscrapers: {i: [/Rivin vihjeet: /, /Sarakkeen vihjeet: /], move: [/Rivin vihjeet: /, /Sarakkeen vihjeet: /], edits: "digits"},
    kakuro: {i: [/Vaakasumma \d+, \d+ ruutua\./, /Pystysumma \d+, \d+ ruutua\./], move: [/Vaakasumma|Pystysumma/], edits: "digits"},
    hitori: {i: [CELL], edits: "shading"},
    nonogram: {i: [/Rivin vihje [\d, ]+\.|Rivillä ei väritettäviä\./, /Sarakkeen vihje [\d, ]+\.|Sarakkeessa ei väritettäviä\./],
      move: [/Rivin vihje|Rivillä ei/, /Sarakkeen vihje|Sarakkeessa ei/], edits: "shading"},
    hashi: {edits: "bridges"}
  };

  if (only.includes("speech")) {
    const {context, page} = await newPage(1280, 900, "light");
    for (const type of types) {
      const t0 = Date.now(), want = SPEECH[type];
      await playType(page, type);
      await page.focus("#play-board");
      const said = async (keys, label) => {
        await page.evaluate(() => { window.__sr = []; });
        /* a frame after each key: the board speaks on the next frame, and
           only the last of several texts in one frame */
        for (const k of keys) { await page.keyboard.press(k); await frames(page); }
        const log = await page.evaluate(() => window.__sr);
        return {label, log, text: log.join(" | ")};
      };
      const expect = (got, re) => { if (!re.test(got.text)) fail("speech", `${type}, ${got.label}: expected ${re}, heard "${got.text}"`); };
      const n = await page.evaluate(() => {
        const cells = document.querySelectorAll("#play-board .cell[data-i]");
        return Math.round(Math.sqrt(cells.length)) || 9;
      });

      if (want.edits === "digits") {
        /* the selection starts on the first empty cell */
        expect(await said(["Digit1"], "after a digit"), /Rivi \d+, sarake \d+: 1/);
        expect(await said(["Control+z"], "after Ctrl+Z"), /Kumottu\. Rivi \d+, sarake \d+: /);
        expect(await said(["n"], "after N"), /Muistiinpanot päällä/);
        expect(await said(["n"], "after N again"), /Muistiinpanot pois/);
        if (want.clash) {
          /* a digit given in the selected cell's row or column */
          const d = await page.evaluate(n => {
            const cells = [...document.querySelectorAll("#play-board .cell[data-i]")];
            const at = cells.findIndex(c => c.classList.contains("sel"));
            if (at < 0) return 0;
            const r = (at / n) | 0, c = at % n;
            const g = cells.find((x, i) => x.classList.contains("given") && ((i / n | 0) === r || i % n === c));
            return g ? +g.textContent.trim() : 0;
          }, n);
          if (!d) fail("speech", `${type}: no given digit in the selected cell's row or column to clash with`);
          else {
            expect(await said(["Digit" + d], "after a clashing digit"), /ristiriita/);
            await said(["Control+z"], "undo the clash");
          }
        }
      } else if (want.edits === "shading") {
        /* nothing is selected until the first arrow */
        await said(["ArrowRight"], "first move");
        expect(await said(["Space"], "after a mark"), /Rivi \d+, sarake \d+: .*väritetty/);
        expect(await said(["Control+z"], "after Ctrl+Z"), /Kumottu\. Rivi \d+, sarake \d+: /);
      } else {
        expect(await said(["ArrowRight"], "first move"), /saari \d+, siltoja \d+/);
        const b = await said(["Shift+ArrowRight", "Shift+ArrowDown", "Shift+ArrowLeft", "Shift+ArrowUp"], "after a bridge");
        expect(b, /saari \d+, siltoja [12]/);
      }

      if (want.i || want.move) {
        /* to the top left corner, then a sweep along the top row and down
           the last column */
        const corner = [...Array(n)].flatMap(() => ["ArrowUp", "ArrowLeft"]);
        await said(corner, "to the corner");
        if (want.i) for (const re of want.i) expect(await said(["i"], "on I"), re);
        if (want.move) {
          const sweep = await said([...Array(n - 1).fill("ArrowRight"), ...Array(n - 1).fill("ArrowDown")], "along a sweep");
          for (const re of want.move) expect(sweep, re);
          if (!sweep.log.every(t => CELL.test(t))) fail("speech", `${type}, along a sweep: a move did not start with the cell`);
        }
        expect(await said(["r"], "on R"), /^Rivi \d+: /);
        expect(await said(["s"], "on S"), /^Sarake \d+: /);
      }
      console.log(`speech   ${type.padEnd(12)} (${Date.now() - t0} ms)`);
    }
    await context.close();
  }

  /* ---------- keys ---------- */

  if (only.includes("keys")) {
    const {context, page} = await newPage(1280, 900, "light");
    await playType(page, "sudoku9");
    const paused = () => page.evaluate(() => !document.getElementById("play-paused").hidden);
    await page.focus("#t-check");
    await page.keyboard.press("p");
    if (await paused()) {
      fail("keys", "P with focus on Tarkista pauses the clock");
      await page.click("#resume-btn");
    }
    await page.focus("#play-board");
    await page.keyboard.press("p");
    if (!await paused()) fail("keys", "P on the board does not pause the clock");
    else {
      await page.keyboard.press("p");
      if (await paused()) fail("keys", "P on Jatka does not resume");
    }
    await context.close();
    console.log("keys     done");
  }

  /* ---------- reflow ---------- */

  if (only.includes("reflow")) {
    for (const scheme of ["light", "dark"]) {
      const {context, page} = await newPage(320, 640, scheme);
      const wide = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await printSheets(page);
      let over = await wide();
      if (over > 0) fail("reflow", `${scheme} print mode at 320 px scrolls sideways by ${over} px`);
      await playType(page, "sudoku9");
      over = await wide();
      if (over > 0) fail("reflow", `${scheme} play mode at 320 px scrolls sideways by ${over} px`);
      await context.close();
    }
    console.log("reflow   done");
  }

  await browser.close();
}

console.log(fails.length ? `\n${fails.length} failures` : "\nall checks pass");
process.exit(fails.length ? 1 : 0);
