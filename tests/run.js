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
const SCRIPTS = ["scripts/generators.js", "scripts/codec.js"];

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

/* ---------- codec ---------- */

const plain = v => ArrayBuffer.isView(v) ? Array.from(v) : v;
const norm = v => JSON.stringify(v, (_, x) => plain(x));

/* The decoded item must equal what the generator built, field by field,
   derived clues included. Two fields are compared on what they mean: a kakuro
   fill can keep stale digits under cells that were blackened later, and a
   nonogram fill only says filled or not. */
function sameItem(type, gen, dec) {
  for (const key of Object.keys(gen)) {
    let a = gen[key], b = dec[key];
    if (gen.kind === "kakuro" && key === "solution") {
      a = Array.from(a, (d, i) => gen.black[i] ? 0 : d); b = plain(b);
    }
    if (gen.kind === "nonogram" && key === "fill") { a = Array.from(a, x => x ? 1 : 0); b = Array.from(b, x => x ? 1 : 0); }
    assert(norm(a) === norm(b), `field ${key} differs after decoding`);
  }
}

/* Random progress of the right shape: digits (some right, some wrong) and
   notes, shading marks, or bridge counts. */
function randomProgress(type, item) {
  const p = G.emptyProgress(type, item);
  const rnd = m => Math.floor(Math.random() * m);
  if (p.marks) { for (let i = 0; i < p.marks.length; i++) p.marks[i] = rnd(3); return p; }
  if (p.bridges) { for (let i = 0; i < p.bridges.length; i++) p.bridges[i] = rnd(3); return p; }
  const d = G.codeDigitRange(item);
  for (const i of G.codeEditable(item)) {
    const roll = rnd(4);
    if (roll === 1) p.val[i] = 1 + rnd(d);
    if (roll === 2) p.notes[i] = 1 + rnd((1 << d) - 1);
  }
  return p;
}

function decodeFails(code) {
  try { G.decodeCode(code); } catch (e) { return e.message; }
  return null;
}

/* Every single-bit change of any character, and every truncation, must be
   refused. */
function checkTamper(code) {
  for (let k = 0; k < code.length; k++) {
    const v = G.B64.indexOf(code[k]);
    for (let bit = 1; bit < 64; bit <<= 1) {
      const bad = code.slice(0, k) + G.B64[v ^ bit] + code.slice(k + 1);
      assert(decodeFails(bad), `flipping bit ${bit} of character ${k} was accepted`);
    }
  }
  for (let L = 0; L < code.length; L++) assert(decodeFails(code.slice(0, L)), `truncation to ${L} was accepted`);
}

function roundTrip(type, level, gen) {
  const a = G.encodeCode(type, level, gen, null);
  assert(a.code.length >= G.CODE_MIN_LENGTH, `code is ${a.code.length} characters, below CODE_MIN_LENGTH`);
  const da = G.decodeCode(a.code);
  assert(da.type === type && da.level === level && da.progress === null, "type, level or progress flag");
  sameItem(type, gen, da);
  checkItem(type, da);
  assert(G.encodeCode(type, level, da, null).code === a.code, "re-encoding the decoded item changes the code");

  const prog = randomProgress(type, gen);
  const b = G.encodeCode(type, level, gen, prog);
  const db = G.decodeCode("https://example.org/pulmapaja/#" + b.code);
  sameItem(type, gen, db);
  assert(norm(db.progress) === norm(prog), "progress differs after decoding");
  const segBits = b.seg.reduce((s, x) => s + x[1], 0);
  assert(segBits === b.bytes * 8, `segments add up to ${segBits} bits, not ${b.bytes * 8}`);

  checkTamper(a.code);
  checkTamper(b.code);
  return `puzzle ${a.code.length} · with progress ${b.code.length} chars`;
}

for (const type of TYPES) for (const level of LEVELS) {
  test(`codec ${type} ${level}`, () => {
    const gen = G.buildOne(type, level, true);
    assert(gen, "buildOne returned null");
    return roundTrip(type, level, gen);
  });
}

/* A picture nonogram stores the same payload under level "none"; any fill
   the image pipeline lets through must survive, blank edges included. */
test("codec nonogram picture", () => {
  const n = 25, fill = new Uint8Array(n * n);
  for (let r = 3; r < n - 3; r++) for (let c = 2; c < n - 4; c++) fill[r * n + c] = Math.random() < 0.6 ? 1 : 0;
  const {rows, cols} = G.nonogramClues(fill, n);
  return roundTrip("nonogram", "none", {kind: "nonogram", n, fill, rowClues: rows, colClues: cols});
});

test("codec error messages", () => {
  const gen = G.buildOne("sudoku9", "easy", true);
  const {code} = G.encodeCode("sudoku9", "easy", gen, null);
  const bytes = G.fromB64(code);
  const withHeader = (ver, flags) => {
    const h = [ver, flags], body = G.scramble(bytes.slice(2, -1), [bytes[0], bytes[1]]);
    return G.toB64(h.concat(G.scramble(body, h), [G.checksum(h.concat(body))]));
  };
  const expect = (input, msg) => {
    const got = decodeFails(input);
    assert(got === msg, `${JSON.stringify(String(input).slice(0, 30))}: got ${JSON.stringify(got)}`);
  };
  expect("", G.CODE_MSG.empty);
  expect("  #  ", G.CODE_MSG.empty);
  expect(code.slice(0, 20) + "+" + code.slice(21), G.CODE_MSG.chars);
  expect("AQFR", G.CODE_MSG.short);
  expect(withHeader(2, bytes[1]), G.CODE_MSG.version(2));
  expect(withHeader(1, 13), G.CODE_MSG.type);
  expect(withHeader(1, 0), G.CODE_MSG.type);
  /* a single-bit change always breaks the checksum; arbitrary substitutions
     need not (see the sweep below) */
  expect(code.slice(0, 30) + G.B64[G.B64.indexOf(code[30]) ^ 1] + code.slice(31), G.CODE_MSG.damaged);
  /* the right checksum over a body that ends early */
  const h = [1, bytes[1]], body = G.scramble(bytes.slice(2, -1), [bytes[0], bytes[1]]).slice(0, 20);
  expect(G.toB64(h.concat(G.scramble(body, h), [G.checksum(h.concat(body))])), G.CODE_MSG.short);
  /* a well-formed code whose solution breaks the rules */
  const broken = Object.assign({}, gen, {solution: Uint8Array.from(gen.solution)});
  [broken.solution[0], broken.solution[1]] = [broken.solution[1], broken.solution[0]];
  expect(G.encodeCode("sudoku9", "easy", broken, null).code, G.CODE_MSG.invalid);
  /* whitespace and a link around the code are fine */
  assert(!decodeFails(` https://x.example/#${code.slice(0, 10)}\n${code.slice(10)} `), "a wrapped link was refused");
});

/* Codes made by the approved reference preview keep decoding, to the same
   puzzle and progress, and this encoder reproduces them exactly. */
test("codec reference preview codes", () => {
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/preview-codes.json"), "utf8"));
  for (const f of fx.codes) {
    const d = G.decodeCode(f.code);
    assert(d.type === "sudoku9" && d.level === LEVELS[f.level], `${f.code.slice(0, 12)}…: type or level`);
    eqArr(Array.from(d.solution), f.solution, "solution");
    eqArr(Array.from(d.puz, v => v ? 1 : 0), f.givens, "givens");
    assert((d.progress !== null) === f.hasProgress, "progress flag");
    if (f.hasProgress) {
      eqArr(Array.from(d.progress.val), f.val, "entries");
      eqArr(Array.from(d.progress.notes), f.notes, "notes");
    }
    assert(G.encodeCode("sudoku9", d.level, d, d.progress).code === f.code, "re-encoding differs from the reference");
  }
  return `${fx.codes.length} codes`;
});

/* Not a requirement, a measurement: a one-byte checksum cannot catch every
   multi-bit change. Any substitution that slips through must still decode
   to a puzzle that keeps the rules, never to garbage. */
test("codec substitution sweep", () => {
  let tried = 0, passed = 0;
  for (const type of ["sudoku9", "killer", "kakuro", "hashi"]) {
    const gen = G.buildOne(type, "easy", true);
    const {code} = G.encodeCode(type, "easy", gen, randomProgress(type, gen));
    for (let k = 0; k < code.length; k++) for (const ch of G.B64) {
      if (ch === code[k]) continue;
      tried++;
      let d;
      try { d = G.decodeCode(code.slice(0, k) + ch + code.slice(k + 1)); } catch { continue; }
      passed++;
      checkItem(d.type, d);
    }
  }
  return `${passed} of ${tried} one-character substitutions decode, all to valid puzzles`;
});

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
