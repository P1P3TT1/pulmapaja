"use strict";

/* Node test runner, built-ins only. Loads the pure scripts into one node:vm
   context the way the page loads them (classic scripts sharing globals), runs
   every case and prints one line per case. Exit code 1 on any failure.

     node tests/run.js              every case once
     node tests/run.js --repeat 20  every case 20 times, for flaky-looking failures
     node tests/run.js smoke        only cases whose name contains "smoke" */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const SCRIPTS = ["scripts/generators.js"];

const ctx = vm.createContext({console, Math});
for (const file of SCRIPTS) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), ctx, {filename: file});
}
/* top-level const and function declarations live in the context's global
   scope, so they are reached by evaluating their names there */
const G = new Proxy({}, {get: (_, name) => vm.runInContext(String(name), ctx)});

const TYPES = ["sudoku9", "sudoku6", "diagonal", "jigsaw", "kropki", "killer",
  "futoshiki", "skyscrapers", "kakuro", "hitori", "hashi", "nonogram"];
const LEVELS = ["easy", "medium", "hard"];

/* ---------- helpers ---------- */

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eqArr(a, b, msg) {
  assert(a.length === b.length, `${msg}: length ${a.length} ≠ ${b.length}`);
  for (let i = 0; i < a.length; i++) assert(a[i] === b[i], `${msg}: differs at ${i} (${a[i]} ≠ ${b[i]})`);
}
function eqJSON(a, b, msg) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  assert(x === y, `${msg}: ${x.slice(0, 120)} ≠ ${y.slice(0, 120)}`);
}

/* Every unit of a digit spec holds each digit once. */
function checkUnits(spec, sol) {
  for (const u of spec.units) {
    let m = 0;
    for (const i of u.cells) m |= 1 << (sol[i] - 1);
    assert(m === spec.FULL, `unit ${u.kind} breaks the rules`);
  }
}
function checkGivens(puz, sol) {
  for (let i = 0; i < sol.length; i++) assert(!puz[i] || puz[i] === sol[i], `given ${i} differs from the solution`);
}

/* What every item must satisfy, whatever made it: the generator or a decoder. */
function checkItem(type, item) {
  const fam = G.TYPE_FAMILY[type];
  assert(item && item.kind === fam, `kind ${item && item.kind} ≠ ${fam}`);
  if (fam === "sudoku" || fam === "kropki" || fam === "killer") {
    checkUnits(item.spec, item.solution);
    checkGivens(item.puz, item.solution);
  }
  if (fam === "kropki") {
    for (const {a, b, type: t} of item.dots) assert(G.kropkiDotType(item.solution[a], item.solution[b]) === t, "kropki dot");
  }
  if (fam === "killer") {
    const seen = new Set();
    item.cages.forEach((cage, k) => {
      let m = 0, s = 0;
      for (const i of cage.cells) {
        assert(!(m & (1 << item.solution[i])), "digit repeats in a cage");
        m |= 1 << item.solution[i]; s += item.solution[i];
        assert(item.cageOf[i] === k, "cageOf");
        seen.add(i);
      }
      assert(s === cage.sum, "cage sum");
    });
    assert(seen.size === 81, "cages cover the grid");
  }
  if (fam === "futoshiki" || fam === "skyscrapers") {
    checkUnits(item.spec, item.solution);
    checkGivens(item.puzzle, item.solution);
  }
  if (fam === "futoshiki") {
    for (const c of item.cons) assert(item.solution[c.a] < item.solution[c.b], "futoshiki sign");
  }
  if (fam === "skyscrapers") {
    const full = G.skyClues(item.solution, item.spec.n);
    for (const side of G.SKY_SIDES) item.clues[side].forEach((v, k) => assert(v === null || v === full[side][k], "sky clue"));
  }
  if (fam === "kakuro") {
    for (const run of item.runs) {
      let m = 0, s = 0;
      for (const i of run.cells) {
        assert(!item.black[i], "run over a black cell");
        const d = item.solution[i];
        assert(d >= 1 && d <= 9 && !(m & (1 << d)), "run digits");
        m |= 1 << d; s += d;
      }
      assert(s === run.sum, "run sum");
    }
  }
  if (fam === "hitori") {
    const n = item.n;
    assert(G.whitesConnected(item.shaded, n, false), "hitori whites connected");
    for (let i = 0; i < n * n; i++) {
      if (item.shaded[i] === G.BLACK) for (const j of G.hNeighbours(i, n)) assert(item.shaded[j] !== G.BLACK, "hitori blacks touch");
    }
    for (let k = 0; k < n; k++) {
      const row = new Set(), col = new Set();
      for (let t = 0; t < n; t++) {
        const a = k * n + t, b = t * n + k;
        if (item.shaded[a] !== G.BLACK) { assert(!row.has(item.values[a]), "hitori row repeats"); row.add(item.values[a]); }
        if (item.shaded[b] !== G.BLACK) { assert(!col.has(item.values[b]), "hitori column repeats"); col.add(item.values[b]); }
      }
    }
  }
  if (fam === "hashi") {
    const k = item.islands.map(() => 0);
    item.edges.forEach((e, j) => { k[e.a] += item.solution[j]; k[e.b] += item.solution[j]; });
    item.islands.forEach((p, i) => assert(p.k === k[i], "hashi island count"));
  }
  if (fam === "nonogram") {
    const c = G.nonogramClues(item.fill, item.n);
    eqJSON(item.rowClues, c.rows, "nonogram row clues");
    eqJSON(item.colClues, c.cols, "nonogram column clues");
  }
}

/* ---------- cases ---------- */

const cases = [];
const test = (name, fn) => cases.push({name, fn});

for (const type of TYPES) for (const level of LEVELS) {
  test(`smoke ${type} ${level}`, () => {
    const item = G.buildOne(type, level, true);
    assert(item, "buildOne returned null");
    checkItem(type, item);
  });
}

/* ---------- run ---------- */

const args = process.argv.slice(2);
let repeat = 1, filter = "";
for (let a = 0; a < args.length; a++) {
  if (args[a] === "--repeat") repeat = Math.max(1, parseInt(args[++a], 10) || 1);
  else filter = args[a];
}

let failed = 0, ran = 0;
const t0 = Date.now();
for (const c of cases) {
  if (filter && !c.name.includes(filter)) continue;
  const start = Date.now();
  let err = null, note = "";
  for (let r = 0; r < repeat && !err; r++) {
    try { note = c.fn() || ""; } catch (e) { err = e; }
  }
  ran++;
  const ms = Date.now() - start;
  if (err) { failed++; console.log(`FAIL  ${c.name}  ${err.message}`); }
  else console.log(`ok    ${c.name}${note ? "  " + note : ""}  (${ms} ms)`);
}
console.log(`\n${ran - failed}/${ran} passed${repeat > 1 ? `, ${repeat} rounds each` : ""}, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(failed ? 1 : 0);
