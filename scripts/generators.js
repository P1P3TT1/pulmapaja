"use strict";

/* Pure puzzle logic: every generator, solver and counter, the picture
   processing and the level configs. Nothing here touches the DOM when the
   file loads (imageToGray uses a canvas, but only when the UI calls it), so
   tests/run.js can load it into a node:vm context. */

/* Generic grid engine: sudoku 9x9, 6x6, diagonal, jigsaw, futoshiki */

const bitOf = d => 1 << (d - 1);
function popcount(x) { let c = 0; while (x) { x &= x - 1; c++; } return c; }
function lowDigit(m) { return 32 - Math.clz32(m & -m); }
function highDigit(m) { return 32 - Math.clz32(m); }
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function combos(arr, k, fn) {
  const n = arr.length, idx = [];
  (function rec(start) {
    if (idx.length === k) { fn(idx.map(i => arr[i])); return; }
    for (let i = start; i < n; i++) { idx.push(i); rec(i + 1); idx.pop(); }
  })(0);
}

/* ---------- jigsaw regions ---------- */

function neighbours(i, n) {
  const r = (i / n) | 0, c = i % n, out = [];
  if (r > 0) out.push(i - n);
  if (r < n - 1) out.push(i + n);
  if (c > 0) out.push(i - 1);
  if (c < n - 1) out.push(i + 1);
  return out;
}

function jigsawRegions() {
  const n = 9, total = 81;
  const freeNbrs = (reg, i) => neighbours(i, n).filter(j => reg[j] === -1).length;

  for (let attempt = 0; attempt < 400; attempt++) {
    const reg = new Int8Array(total).fill(-1);
    let ok = true;

    /* Regions are built one at a time. The starting cell is always the
       free cell with the fewest free neighbours – this way tight corners
       fill in first and no cell gets stranded on its own. */
    for (let k = 0; k < 9 && ok; k++) {
      let start = -1, fewest = 99;
      for (const i of shuffle([...Array(total).keys()])) {
        if (reg[i] !== -1) continue;
        const f = freeNbrs(reg, i);
        if (f < fewest) { fewest = f; start = i; }
      }
      if (start === -1) { ok = false; break; }
      reg[start] = k;

      for (let grown = 1; grown < 9; grown++) {
        const frontier = [];
        for (let i = 0; i < total; i++) {
          if (reg[i] !== k) continue;
          for (const j of neighbours(i, n)) {
            if (reg[j] === -1 && !frontier.includes(j)) frontier.push(j);
          }
        }
        if (!frontier.length) { ok = false; break; }
        let pick = frontier[0], few = 99;
        for (const j of shuffle(frontier)) {
          const f = freeNbrs(reg, j);
          if (f < few) { few = f; pick = j; }
        }
        reg[pick] = k;
      }
    }

    if (!ok) continue;
    const sizes = new Array(9).fill(0);
    for (let i = 0; i < total; i++) {
      if (reg[i] === -1) { ok = false; break; }
      sizes[reg[i]]++;
    }
    if (ok && sizes.every(s => s === 9)) return reg;
  }

  const reg = new Int8Array(total);
  for (let i = 0; i < total; i++) reg[i] = Math.floor(i / 27) * 3 + Math.floor((i % 9) / 3);
  return reg;
}

/* ---------- spec building ---------- */

function buildSpec(kind) {
  let n, regionOf = null, diagonals = false, regionMap = null;
  if (kind === "sudoku9")  { n = 9; regionOf = i => Math.floor(i / 27) * 3 + Math.floor((i % 9) / 3); }
  if (kind === "sudoku6")  { n = 6; regionOf = i => Math.floor(i / 12) * 2 + Math.floor((i % 6) / 3); }
  if (kind === "diagonal") { n = 9; regionOf = i => Math.floor(i / 27) * 3 + Math.floor((i % 9) / 3); diagonals = true; }
  if (kind === "jigsaw")   { n = 9; regionMap = jigsawRegions(); regionOf = i => regionMap[i]; }
  /* plain Latin squares, rows and columns only: "latin4" … "latin9".
     Futoshiki keeps its own names for the 5 × 5 and 6 × 6 squares. */
  if (kind === "futoshiki"){ n = 5; }
  if (kind === "futoshiki6"){ n = 6; }
  const latin = /^latin([4-9])$/.exec(kind);
  if (latin) n = Number(latin[1]);

  const N = n * n, FULL = (1 << n) - 1;
  const units = [];
  for (let r = 0; r < n; r++) units.push({kind: "row", cells: Array.from({length: n}, (_, c) => r * n + c)});
  for (let c = 0; c < n; c++) units.push({kind: "col", cells: Array.from({length: n}, (_, r) => r * n + c)});
  if (regionOf) {
    const buckets = {};
    for (let i = 0; i < N; i++) (buckets[regionOf(i)] ||= []).push(i);
    for (const k of Object.keys(buckets)) units.push({kind: "region", cells: buckets[k]});
  }
  if (diagonals) {
    units.push({kind: "diag", cells: Array.from({length: n}, (_, k) => k * n + k)});
    units.push({kind: "diag", cells: Array.from({length: n}, (_, k) => k * n + (n - 1 - k))});
  }

  const peers = Array.from({length: N}, () => new Set());
  for (const u of units) for (const i of u.cells) for (const j of u.cells) if (i !== j) peers[i].add(j);
  const peerList = peers.map(s => [...s]);

  /* intersection pairs for locked-candidate elimination */
  const pairs = [];
  for (let a = 0; a < units.length; a++) {
    for (let b = 0; b < units.length; b++) {
      if (a === b) continue;
      const sa = new Set(units[a].cells), sb = new Set(units[b].cells);
      const inter = units[a].cells.filter(i => sb.has(i));
      if (inter.length < 2 || inter.length === units[a].cells.length) continue;
      const outside = units[b].cells.filter(i => !sa.has(i));
      const aOnly = units[a].cells.filter(i => !sb.has(i));
      if (outside.length && aOnly.length) pairs.push({aOnly, inter, outside});
    }
  }

  const rowUnits = units.filter(u => u.kind === "row").map(u => u.cells);
  const colUnits = units.filter(u => u.kind === "col").map(u => u.cells);

  return {kind, n, N, FULL, units, peers: peerList, pairs, rowUnits, colUnits, regionMap, diagonals};
}

/* ---------- full solution ---------- */

function generateSolution(spec, extraOk) {
  const {N, n, peers} = spec;
  const v = new Uint8Array(N);
  let steps = 0;
  function go(filled) {
    if (++steps > 15000) return false;
    if (filled === N) return true;
    let best = -1, bestOpts = null;
    for (let i = 0; i < N; i++) {
      if (v[i]) continue;
      let used = 0;
      for (const p of peers[i]) if (v[p]) used |= bitOf(v[p]);
      const opts = [];
      for (let d = 1; d <= n; d++) if (!(used & bitOf(d))) opts.push(d);
      if (opts.length === 0) return false;
      if (!bestOpts || opts.length < bestOpts.length) { best = i; bestOpts = opts; }
      if (opts.length === 1) break;
    }
    for (const d of shuffle(bestOpts)) {
      v[best] = d;
      if ((!extraOk || extraOk(v, best, d)) && go(filled + 1)) return true;
      v[best] = 0;
    }
    return false;
  }
  return go(0) ? v : null;
}

/* ---------- logical solver ---------- */

function logicSolve(spec, puzzle, level, propagate) {
  const {N, n, FULL, units, peers, pairs, rowUnits, colUnits} = spec;
  const v = Uint8Array.from(puzzle);
  const cand = new Uint16Array(N);
  let empty = 0;
  for (let i = 0; i < N; i++) { cand[i] = v[i] ? 0 : FULL; if (!v[i]) empty++; }
  for (let i = 0; i < N; i++) if (v[i]) { const m = ~bitOf(v[i]); for (const p of peers[i]) cand[p] &= m; }

  const place = (i, d) => {
    v[i] = d; cand[i] = 0; empty--;
    const m = ~bitOf(d);
    for (const p of peers[i]) cand[p] &= m;
  };
  const elim = (i, mask) => {
    if (v[i]) return false;
    const after = cand[i] & ~mask;
    if (after === cand[i]) return false;
    cand[i] = after;
    return true;
  };

  function nakedSingles() {
    let ch = false;
    for (let i = 0; i < N; i++) if (!v[i] && popcount(cand[i]) === 1) { place(i, lowDigit(cand[i])); ch = true; }
    return ch;
  }
  function hiddenSingles() {
    let ch = false;
    for (const u of units) for (let d = 1; d <= n; d++) {
      const bt = bitOf(d);
      let cnt = 0, pos = -1, placed = false;
      for (const i of u.cells) {
        if (v[i] === d) { placed = true; break; }
        if (cand[i] & bt) { cnt++; pos = i; }
      }
      if (!placed && cnt === 1) { place(pos, d); ch = true; }
    }
    return ch;
  }
  /* Locked candidates in general form: if all positions for digit d in
     unit A fall inside the intersection A∩B, d can be eliminated from the
     rest of B. Covers both pointing pairs and box/line reductions, also
     for jigsaw regions and diagonals.                                     */
  function lockedCandidates() {
    let ch = false;
    for (const {aOnly, inter, outside} of pairs) {
      for (let d = 1; d <= n; d++) {
        const bt = bitOf(d);
        let inside = false;
        for (const i of inter) if (cand[i] & bt) { inside = true; break; }
        if (!inside) continue;
        let leaks = false;
        for (const i of aOnly) if (cand[i] & bt) { leaks = true; break; }
        if (leaks) continue;
        for (const i of outside) if (elim(i, bt)) ch = true;
      }
    }
    return ch;
  }
  function nakedSubsets(size) {
    let ch = false;
    for (const u of units) {
      const cells = u.cells.filter(i => !v[i] && popcount(cand[i]) >= 2 && popcount(cand[i]) <= size);
      if (cells.length <= size) continue;
      combos(cells, size, combo => {
        let m = 0;
        for (const i of combo) m |= cand[i];
        if (popcount(m) !== size) return;
        for (const i of u.cells) if (!combo.includes(i) && elim(i, m)) ch = true;
      });
    }
    return ch;
  }
  function hiddenSubsets(size) {
    let ch = false;
    for (const u of units) {
      const digs = [], posMap = {};
      for (let d = 1; d <= n; d++) {
        const bt = bitOf(d);
        const pos = u.cells.filter(i => cand[i] & bt);
        if (pos.length >= 2 && pos.length <= size) { digs.push(d); posMap[d] = pos; }
      }
      if (digs.length < size) continue;
      combos(digs, size, combo => {
        const s = new Set();
        let m = 0;
        for (const d of combo) { posMap[d].forEach(i => s.add(i)); m |= bitOf(d); }
        if (s.size !== size) return;
        for (const i of s) if (elim(i, FULL & ~m)) ch = true;
      });
    }
    return ch;
  }
  function xWing() {
    let ch = false;
    const fish = (lines, cross, idxOf, cellAt) => {
      for (let d = 1; d <= n; d++) {
        const bt = bitOf(d), pos = [];
        for (let a = 0; a < lines.length; a++) {
          const p = lines[a].filter(i => cand[i] & bt);
          pos[a] = p.length === 2 ? p.map(idxOf) : null;
        }
        for (let a = 0; a < lines.length; a++) {
          if (!pos[a]) continue;
          for (let b = a + 1; b < lines.length; b++) {
            if (!pos[b] || pos[a][0] !== pos[b][0] || pos[a][1] !== pos[b][1]) continue;
            for (const k of pos[a]) for (let m = 0; m < lines.length; m++) {
              if (m !== a && m !== b && elim(cellAt(m, k), bt)) ch = true;
            }
          }
        }
      }
    };
    fish(rowUnits, colUnits, i => i % n, (r, c) => r * n + c);
    fish(colUnits, rowUnits, i => (i / n) | 0, (c, r) => r * n + c);
    return ch;
  }

  for (;;) {
    for (let i = 0; i < N; i++) if (!v[i] && cand[i] === 0) return false;
    if (empty === 0) return true;
    if (propagate && propagate(cand, v, elim, place)) continue;
    if (nakedSingles()) continue;
    if (hiddenSingles()) continue;
    if (level >= 2) {
      if (lockedCandidates()) continue;
      if (nakedSubsets(2)) continue;
      if (hiddenSubsets(2)) continue;
    }
    if (level >= 3) {
      if (nakedSubsets(3)) continue;
      if (hiddenSubsets(3)) continue;
      if (xWing()) continue;
    }
    return false;
  }
}






/* Independent solution counting, does not use the logic solver. Stops at
   `limit` solutions or at the step cap, whichever comes first. A capped search
   has not seen the whole tree, so its count proves nothing: callers must treat
   aborted=true as a failed check, never as "unique".
   extraOk(v, i, d, free) is asked with d already written into v[i]; free[j]
   holds the digits the units of each empty cell j still leave it, as they
   stood before d went in. It filters every empty cell's options before the
   branch cell is picked, so a variant's own rules steer the search and not
   just the plain row/column/box ones. */
function countSolutions(spec, puzzle, limit, extraOk, maxSteps = 2000000) {
  const {N, n, peers, units} = spec;
  const v = Uint8Array.from(puzzle);
  const FULL = (1 << n) - 1;
  const freeAt = [];
  let count = 0, steps = 0, aborted = false;
  function go(depth) {
    if (++steps > maxSteps) { aborted = true; return true; }
    const free = freeAt[depth] ||= new Uint16Array(N);
    for (let i = 0; i < N; i++) {
      if (v[i]) continue;
      let used = 0;
      for (const p of peers[i]) if (v[p]) used |= bitOf(v[p]);
      free[i] = FULL & ~used;
      if (!free[i]) return false;
    }
    /* every unit holds every digit, so each must still have a place for each */
    for (const u of units) {
      let room = 0;
      for (const i of u.cells) room |= v[i] ? bitOf(v[i]) : free[i];
      if (room !== FULL) return false;
    }
    let best = -1, bestMask = 0, bestN = n + 1;
    for (let i = 0; i < N; i++) {
      if (v[i]) continue;
      let mask = free[i];
      if (extraOk) {
        for (let d = 1; d <= n; d++) {
          if (!(mask & bitOf(d))) continue;
          v[i] = d;
          if (!extraOk(v, i, d, free)) mask &= ~bitOf(d);
        }
        v[i] = 0;
      }
      const c = popcount(mask);
      if (c === 0) return false;
      if (c < bestN) { bestN = c; best = i; bestMask = mask; if (c === 1) break; }
    }
    if (best === -1) { count++; return count >= limit; }
    for (let d = 1; d <= n; d++) {
      if (!(bestMask & bitOf(d))) continue;
      v[best] = d;
      if (go(depth + 1)) return true;
      v[best] = 0;
    }
    return false;
  }
  go(0);
  return {count, aborted, steps};
}

const TARGETS = {
  sudoku9:  {easy: 38, medium: 30, hard: 0},
  sudoku6:  {easy: 22, medium: 17, hard: 0},
  diagonal: {easy: 34, medium: 27, hard: 0},
  jigsaw:   {easy: 34, medium: 27, hard: 0}
};

function digOnce(spec, level, symmetric) {
  const {N} = spec;
  const target = TARGETS[spec.kind][level];
  const tier = level === "hard" ? 3 : 1;
  const solution = generateSolution(spec);
  if (!solution) return null;
  const puz = Uint8Array.from(solution);
  let givens = N;
  const passes = (level === "hard" && symmetric) ? [true, false] : [symmetric];

  for (const useSym of passes) {
    for (const i of shuffle([...Array(N).keys()])) {
      const j = useSym ? N - 1 - i : i;
      if (!puz[i] && !puz[j]) continue;
      const a = puz[i], b = puz[j];
      const removed = (a ? 1 : 0) + (i !== j && b ? 1 : 0);
      puz[i] = 0; puz[j] = 0;
      let ok = logicSolve(spec, puz, 1);
      if (!ok && tier >= 2) ok = logicSolve(spec, puz, 2);
      if (!ok && tier >= 3) ok = logicSolve(spec, puz, 3);
      if (!ok) { puz[i] = a; puz[j] = b; continue; }
      givens -= removed;
      if (level !== "hard" && givens <= target) return {puz, solution, givens, exact: true};
    }
    if (level === "hard" && !logicSolve(spec, puz, 1)) return {puz, solution, givens, exact: true};
  }
  return {puz, solution, givens, exact: level !== "hard"};
}

/* Not all jigsaw partitions are usable: some of them have no solution
   at all. So we search for a partition that does have one. */
function jigsawSpec() {
  for (let t = 0; t < 60; t++) {
    const spec = buildSpec("jigsaw");
    if (generateSolution(spec)) return spec;
  }
  return buildSpec("sudoku9");
}

function makePuzzle(kind, level, symmetric) {
  let spec = kind === "jigsaw" ? jigsawSpec() : buildSpec(kind);
  let best = null;
  for (let a = 0; a < 8; a++) {
    if (kind === "jigsaw" && a > 0) spec = jigsawSpec();
    const r = digOnce(spec, level, symmetric);
    if (!r) continue;
    r.spec = spec;
    if (r.exact) return r;
    if (!best || r.givens < best.givens) best = r;
  }
  return best;
}


/* ---------- futoshiki ---------- */






const N_SIZE = 5;

function allAdjacentPairs(n) {
  const out = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const i = r * n + c;
    if (c < n - 1) out.push([i, i + 1, "h"]);
    if (r < n - 1) out.push([i, i + n, "v"]);
  }
  return out;
}

/* Inequality propagation: a < b */
function makePropagator(cons, FULL) {
  return (cand, v, elim) => {
    let ch = false;
    for (const {a, b} of cons) {
      const ma = v[a] ? bitOf(v[a]) : cand[a];
      const mb = v[b] ? bitOf(v[b]) : cand[b];
      if (!ma || !mb) continue;
      const maxB = highDigit(mb);
      if (elim(a, FULL & ~((1 << (maxB - 1)) - 1))) ch = true;
      const minA = lowDigit(ma);
      if (elim(b, (1 << minA) - 1)) ch = true;
    }
    return ch;
  };
}

/* independent check: counts solutions via brute-force search, where
   lower/upper bounds derived from the inequalities prune the search tree */
function countFutoshiki(spec, puzzle, cons, limit) {
  const {N, n, peers} = spec;
  const FULL = (1 << n) - 1;
  const v = Uint8Array.from(puzzle);
  const cand = new Uint16Array(N).fill(FULL);
  const byCell = Array.from({length: N}, () => []);
  for (const c of cons) { byCell[c.a].push(c); byCell[c.b].push(c); }

  for (let i = 0; i < N; i++) if (v[i]) cand[i] = 0;
  for (let i = 0; i < N; i++) if (v[i]) for (const p of peers[i]) cand[p] &= ~bitOf(v[i]);

  /* prunes until nothing changes; returns false on contradiction */
  function propagate() {
    for (;;) {
      let ch = false;
      for (const {a, b} of cons) {
        const ma = v[a] ? bitOf(v[a]) : cand[a];
        const mb = v[b] ? bitOf(v[b]) : cand[b];
        if (!ma || !mb) return false;
        let up = 0;
        for (let d = highDigit(mb); d <= n; d++) up |= bitOf(d);
        let lo = 0;
        for (let d = 1; d <= lowDigit(ma); d++) lo |= bitOf(d);
        if (!v[a] && (cand[a] & up)) { cand[a] &= ~up; ch = true; if (!cand[a]) return false; }
        if (!v[b] && (cand[b] & lo)) { cand[b] &= ~lo; ch = true; if (!cand[b]) return false; }
      }
      if (!ch) return true;
    }
  }

  let count = 0, steps = 0;
  function go() {
    if (++steps > 3000000) return true;
    if (!propagate()) return false;
    let best = -1, bestN = n + 1;
    for (let i = 0; i < N; i++) {
      if (v[i]) continue;
      const c = popcount(cand[i]);
      if (c === 0) return false;
      if (c < bestN) { bestN = c; best = i; if (c === 1) break; }
    }
    if (best === -1) { count++; return count >= limit; }
    const saved = cand.slice();
    for (let d = 1; d <= n; d++) {
      if (!(cand[best] & bitOf(d))) continue;
      v[best] = d; cand[best] = 0;
      for (const p of peers[best]) cand[p] &= ~bitOf(d);
      if (go()) { v[best] = 0; cand.set(saved); return true; }
      v[best] = 0; cand.set(saved);
    }
    return false;
  }
  go();
  return count;
}

const FUTOSHIKI_CFG = {
  easy:   {kind: "futoshiki",  signs: 22},
  medium: {kind: "futoshiki",  signs: 15},
  hard:   {kind: "futoshiki6", signs: 0}
};

function makeFutoshiki(level) {
  const cfg = FUTOSHIKI_CFG[level];
  const spec = buildSpec(cfg.kind);
  const n = spec.n, N = spec.N;
  for (let attempt = 0; attempt < 20; attempt++) {
    const sol = generateSolution(spec);
    if (!sol) continue;
    const pairs = allAdjacentPairs(n);
    const cons = pairs.map(([x, y, dir]) =>
      sol[x] < sol[y] ? {a: x, b: y, dir, lo: x} : {a: y, b: x, dir, lo: x});
    const active = cons.map(() => true);
    const puz = new Uint8Array(N);
    const live = () => cons.filter((_, k) => active[k]);
    const solves = () => logicSolve(spec, puz, 2, makePropagator(live(), spec.FULL));

    if (!solves()) continue;
    let count = cons.length;
    for (const k of shuffle([...cons.keys()])) {
      active[k] = false;
      if (!solves()) { active[k] = true; continue; }
      count--;
      if (count <= cfg.signs) break;
    }
    return {spec, solution: sol, puzzle: puz, cons: live(), signs: count};
  }
  return null;
}

/* ---------- kropki ---------- */

/* black dot: one value is double the other. white dot: consecutive values.
   1 and 2 satisfy both, so that pair gets a combined dot. Absence of a dot
   is itself informative -- it proves neither relation holds there. */
function kropkiDotType(x, y) {
  const dbl = x === 2 * y || y === 2 * x;
  const con = Math.abs(x - y) === 1;
  if (dbl && con) return "both";
  if (dbl) return "black";
  if (con) return "white";
  return "none";
}

const KROPKI_FULL = 511;
const KROPKI_ALLOW = {black: [0], white: [0], both: [0], none: [0]};
for (let x = 1; x <= 9; x++) {
  let black = 0, white = 0;
  for (let y = 1; y <= 9; y++) {
    if (x === 2 * y || y === 2 * x) black |= bitOf(y);
    if (Math.abs(x - y) === 1) white |= bitOf(y);
  }
  KROPKI_ALLOW.black[x] = black;
  KROPKI_ALLOW.white[x] = white;
  KROPKI_ALLOW.both[x] = black & white;
  KROPKI_ALLOW.none[x] = KROPKI_FULL & ~(black | white);
}
const kropkiAllowed = (x, type) => KROPKI_ALLOW[type][x];

/* Every adjacent pair propagates, dotted or not: a value survives in one
   cell only if some remaining candidate in its neighbour is compatible
   with that pair's relation (or lack of one). */
function makeKropkiPropagator(dots) {
  return (cand, v, elim) => {
    let ch = false;
    for (const {a, b, type} of dots) {
      const ma = v[a] ? bitOf(v[a]) : cand[a];
      const mb = v[b] ? bitOf(v[b]) : cand[b];
      if (!ma || !mb) continue;
      let allowB = 0, allowA = 0;
      for (let x = 1; x <= 9; x++) if (ma & bitOf(x)) allowB |= kropkiAllowed(x, type);
      for (let y = 1; y <= 9; y++) if (mb & bitOf(y)) allowA |= kropkiAllowed(y, type);
      if (elim(a, KROPKI_FULL & ~allowA)) ch = true;
      if (elim(b, KROPKI_FULL & ~allowB)) ch = true;
    }
    return ch;
  };
}

/* independent check: brute-force count using the same dot relations,
   to guard the propagator above against silently under-constraining.
   Returns {count, aborted}, like countSolutions. */
function countKropkiSolutions(spec, dots, puzzle, limit) {
  const {N, n, peers} = spec;
  const v = Uint8Array.from(puzzle);
  const cand = new Uint16Array(N).fill(KROPKI_FULL);
  for (let i = 0; i < N; i++) if (v[i]) cand[i] = 0;
  for (let i = 0; i < N; i++) if (v[i]) for (const p of peers[i]) cand[p] &= ~bitOf(v[i]);

  function propagate() {
    for (;;) {
      let ch = false;
      for (const {a, b, type} of dots) {
        const ma = v[a] ? bitOf(v[a]) : cand[a];
        const mb = v[b] ? bitOf(v[b]) : cand[b];
        if (!ma || !mb) return false;
        let allowB = 0, allowA = 0;
        for (let x = 1; x <= 9; x++) if (ma & bitOf(x)) allowB |= kropkiAllowed(x, type);
        for (let y = 1; y <= 9; y++) if (mb & bitOf(y)) allowA |= kropkiAllowed(y, type);
        if (!v[a] && (cand[a] & ~allowA)) { cand[a] &= allowA; ch = true; if (!cand[a]) return false; }
        if (!v[b] && (cand[b] & ~allowB)) { cand[b] &= allowB; ch = true; if (!cand[b]) return false; }
      }
      if (!ch) return true;
    }
  }

  let count = 0, steps = 0, aborted = false;
  function go() {
    if (++steps > 2000000) { aborted = true; return true; }
    if (!propagate()) return false;
    let best = -1, bestN = n + 1;
    for (let i = 0; i < N; i++) {
      if (v[i]) continue;
      const c = popcount(cand[i]);
      if (c === 0) return false;
      if (c < bestN) { bestN = c; best = i; if (c === 1) break; }
    }
    if (best === -1) { count++; return count >= limit; }
    const saved = cand.slice();
    for (let d = 1; d <= n; d++) {
      if (!(cand[best] & bitOf(d))) continue;
      v[best] = d; cand[best] = 0;
      for (const p of peers[best]) cand[p] &= ~bitOf(d);
      if (go()) { v[best] = 0; cand.set(saved); return true; }
      v[best] = 0; cand.set(saved);
    }
    return false;
  }
  go();
  return {count, aborted};
}

const KROPKI_TARGETS = {easy: 24, medium: 12, hard: 0};

function digKropkiOnce(spec, propagate, sol, level) {
  const {N} = spec;
  const target = KROPKI_TARGETS[level];
  const tier = level === "hard" ? 3 : 1;
  const puz = Uint8Array.from(sol);
  let givens = N;
  for (const i of shuffle([...Array(N).keys()])) {
    const saved = puz[i];
    puz[i] = 0;
    let ok = logicSolve(spec, puz, 1, propagate);
    if (!ok && tier >= 2) ok = logicSolve(spec, puz, 2, propagate);
    if (!ok && tier >= 3) ok = logicSolve(spec, puz, 3, propagate);
    if (!ok) { puz[i] = saved; continue; }
    givens--;
    if (level !== "hard" && givens <= target) return {puz, givens, exact: true};
  }
  return {puz, givens, exact: level === "hard" ? givens <= target : false};
}

function makeKropki(level) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const spec = buildSpec("sudoku9");
    const sol = generateSolution(spec);
    if (!sol) continue;

    const dots = allAdjacentPairs(spec.n).map(([a, b]) => ({a, b, type: kropkiDotType(sol[a], sol[b])}));
    const propagate = makeKropkiPropagator(dots);

    /* the dot layout alone (zero givens) must be fully logic-solvable,
       otherwise this solution can never support a puzzle at any level */
    if (!logicSolve(spec, new Uint8Array(spec.N), 3, propagate)) continue;
    const check = countKropkiSolutions(spec, dots, new Uint8Array(spec.N), 2);
    if (check.aborted || check.count !== 1) continue;

    let best = null;
    for (let d = 0; d < 8; d++) {
      const r = digKropkiOnce(spec, propagate, sol, level);
      if (r.exact) { best = r; break; }
      if (!best || r.givens < best.givens) best = r;
    }
    if (!best) continue;
    return {spec, solution: sol, puz: best.puz, dots, givens: best.givens};
  }
  return null;
}




/* all combinations of L distinct digits that sum to S */
const COMBOS = [];
for (let L = 1; L <= 9; L++) {
  COMBOS[L] = [];
  for (let m = 0; m < 512; m++) {
    if (popcount(m) !== L) continue;
    let s = 0;
    for (let d = 1; d <= 9; d++) if (m & (1 << (d - 1))) s += d;
    (COMBOS[L][s] ||= []).push(m);
  }
}

function buildPattern(size, density) {
  const N = size * size;
  const black = new Uint8Array(N);
  for (let c = 0; c < size; c++) black[c] = 1;
  for (let r = 0; r < size; r++) black[r * size] = 1;
  for (let r = 1; r < size; r++) for (let c = 1; c < size; c++) {
    if (Math.random() < density) black[r * size + c] = 1;
  }
  for (let pass = 0; pass < 40; pass++) {
    let changed = false;
    for (let r = 1; r < size; r++) for (let c = 1; c < size; c++) {
      const i = r * size + c;
      if (black[i]) continue;
      let h = 1, k = c - 1;
      while (k >= 0 && !black[r * size + k]) { h++; k--; }
      k = c + 1;
      while (k < size && !black[r * size + k]) { h++; k++; }
      let v = 1; k = r - 1;
      while (k >= 0 && !black[k * size + c]) { v++; k--; }
      k = r + 1;
      while (k < size && !black[k * size + c]) { v++; k++; }
      if (h < 2 || v < 2) { black[i] = 1; changed = true; }
    }
    if (!changed) break;
  }
  return black;
}

function buildRuns(black, size) {
  const runs = [];
  for (let r = 0; r < size; r++) {
    let cur = null;
    for (let c = 0; c < size; c++) {
      const i = r * size + c;
      if (black[i]) { cur = null; continue; }
      if (!cur) { cur = {dir: "h", clue: i - 1, cells: []}; runs.push(cur); }
      cur.cells.push(i);
    }
  }
  for (let c = 0; c < size; c++) {
    let cur = null;
    for (let r = 0; r < size; r++) {
      const i = r * size + c;
      if (black[i]) { cur = null; continue; }
      if (!cur) { cur = {dir: "v", clue: i - size, cells: []}; runs.push(cur); }
      cur.cells.push(i);
    }
  }
  return runs.filter(x => x.cells.length >= 2);
}

function fillGrid(runs, black, size) {
  const N = size * size;
  const val = new Uint8Array(N);
  const runsOf = Array.from({length: N}, () => []);
  for (const run of runs) for (const i of run.cells) runsOf[i].push(run);
  const white = [];
  for (let i = 0; i < N; i++) if (!black[i]) white.push(i);
  let steps = 0;
  function go(k) {
    if (++steps > 200000) return false;
    if (k === white.length) return true;
    const i = white[k];
    let used = 0;
    for (const run of runsOf[i]) for (const j of run.cells) if (val[j]) used |= 1 << (val[j] - 1);
    const opts = [];
    for (let d = 1; d <= 9; d++) if (!(used & (1 << (d - 1)))) opts.push(d);
    for (const d of shuffle(opts)) {
      val[i] = d;
      if (go(k + 1)) return true;
      val[i] = 0;
    }
    return false;
  }
  return go(0) ? val : null;
}

/* ---------- solver: pruning + search based on sum combinations ---------- */

/* Prunes candidates until nothing changes.
   Returns false if the grid is contradictory. */
function propagate(cand, runs, runsOf, white) {
  for (let round = 0; round < 100; round++) {
    let changed = false;
    for (const run of runs) {
      const L = run.cells.length;
      const list = (COMBOS[L] && COMBOS[L][run.sum]) || [];
      const allow = new Array(L).fill(0);
      for (const m of list) {
        let ok = true;
        for (let k = 0; k < L && ok; k++) if (!(cand[run.cells[k]] & m)) ok = false;
        for (let d = 1; d <= 9 && ok; d++) {
          if (!(m & (1 << (d - 1)))) continue;
          let seen = false;
          for (let k = 0; k < L && !seen; k++) if (cand[run.cells[k]] & (1 << (d - 1))) seen = true;
          if (!seen) ok = false;
        }
        if (!ok) continue;
        for (let k = 0; k < L; k++) allow[k] |= m;
      }
      for (let k = 0; k < L; k++) {
        const i = run.cells[k];
        const next = cand[i] & allow[k];
        if (next === 0) return false;
        if (next !== cand[i]) { cand[i] = next; changed = true; }
      }
    }
    for (const i of white) {
      if (popcount(cand[i]) !== 1) continue;
      const m = cand[i];
      for (const run of runsOf[i]) for (const j of run.cells) {
        if (j === i) continue;
        const next = cand[j] & ~m;
        if (next === 0) return false;
        if (next !== cand[j]) { cand[j] = next; changed = true; }
      }
    }
    if (!changed) break;
  }
  return true;
}

function prepare(runs, black, size) {
  const N = size * size;
  const runsOf = Array.from({length: N}, () => []);
  for (const run of runs) for (const i of run.cells) runsOf[i].push(run);
  const white = [];
  for (let i = 0; i < N; i++) if (!black[i]) white.push(i);
  return {runsOf, white, N};
}

/* Returns at most `limit` solutions. aborted=true if the search was cut off. */
function solveKakuro(runs, black, size, limit) {
  const {runsOf, white, N} = prepare(runs, black, size);
  const found = [];
  let steps = 0, aborted = false;

  function search(cand) {
    if (aborted) return true;
    if (++steps > 20000) { aborted = true; return true; }
    if (!propagate(cand, runs, runsOf, white)) return false;
    let best = -1, bestN = 10;
    for (const i of white) {
      const c = popcount(cand[i]);
      if (c > 1 && c < bestN) { bestN = c; best = i; if (c === 2) break; }
    }
    if (best === -1) {
      const sol = new Uint8Array(N);
      for (const i of white) sol[i] = lowDigit(cand[i]);
      found.push(sol);
      return found.length >= limit;
    }
    for (let d = 1; d <= 9; d++) {
      const m = 1 << (d - 1);
      if (!(cand[best] & m)) continue;
      const next = Int16Array.from(cand);
      next[best] = m;
      if (search(next)) return true;
    }
    return false;
  }

  const cand = new Int16Array(N);
  for (const i of white) cand[i] = 511;
  search(cand);
  found.aborted = aborted;
  return found;
}

/* Does it solve by pruning alone, without branching?
   If so, the solution is thereby provably unique. */
function propagationSolves(runs, black, size) {
  const {runsOf, white, N} = prepare(runs, black, size);
  const cand = new Int16Array(N);
  for (const i of white) cand[i] = 511;
  if (!propagate(cand, runs, runsOf, white)) return false;
  return white.every(i => popcount(cand[i]) === 1);
}

/* ---------- pattern tightening ---------- */

function blacken(black, size, cell) {
  black[cell] = 1;
  for (let pass = 0; pass < 40; pass++) {
    let changed = false;
    for (let r = 1; r < size; r++) for (let c = 1; c < size; c++) {
      const i = r * size + c;
      if (black[i]) continue;
      let h = 1, k = c - 1;
      while (k >= 0 && !black[r * size + k]) { h++; k--; }
      k = c + 1;
      while (k < size && !black[r * size + k]) { h++; k++; }
      let vv = 1; k = r - 1;
      while (k >= 0 && !black[k * size + c]) { vv++; k--; }
      k = r + 1;
      while (k < size && !black[k * size + c]) { vv++; k++; }
      if (h < 2 || vv < 2) { black[i] = 1; changed = true; }
    }
    if (!changed) break;
  }
}

const KAKURO_CFG = {
  easy:   {size: 8,  density: 0.30, minWhite: 13},
  medium: {size: 9,  density: 0.26, minWhite: 20},
  hard:   {size: 10, density: 0.26, minWhite: 24}
};

/* The fill is fixed once, and the grid is tightened at the points where
   an alternative solution differs from it. The fill remains a valid
   solution throughout, so the loop keeps narrowing the solution set. */
function makeKakuro(level) {
  const cfg = KAKURO_CFG[level];
  const {size, density} = cfg;

  for (let attempt = 0; attempt < 200; attempt++) {
    const black = buildPattern(size, density);
    let runs = buildRuns(black, size);
    if (!runs.length) continue;
    const val = fillGrid(runs, black, size);
    if (!val) continue;

    for (let repair = 0; repair < 80; repair++) {
      runs = buildRuns(black, size);
      if (!runs.length) break;
      const white = new Set();
      for (const r of runs) r.cells.forEach(i => white.add(i));
      if (white.size < cfg.minWhite) break;
      for (const run of runs) run.sum = run.cells.reduce((s, i) => s + val[i], 0);

      if (propagationSolves(runs, black, size)) {
        return {black, runs, size, solution: val, white: white.size, logic: true};
      }
      const sols = solveKakuro(runs, black, size, 2);
      if (sols.aborted) break;
      if (sols.length === 1) {
        return {black, runs, size, solution: val, white: white.size, logic: false};
      }
      const diff = [...white].filter(i => sols[0][i] !== sols[1][i]);
      if (!diff.length) break;
      /* pick the cut point that eats away at the grid the least */
      let pick = -1, lost = 1e9;
      for (const c of shuffle(diff.slice())) {
        const trial = Uint8Array.from(black);
        blacken(trial, size, c);
        let n = 0;
        for (let i = 0; i < trial.length; i++) if (trial[i] && !black[i]) n++;
        if (n < lost) { lost = n; pick = c; if (n === 1) break; }
      }
      blacken(black, size, pick);
    }
  }
  return null;
}

/* ---------- killer-sudoku ---------- */

/* Runs the logic solver tier by tier, cheapest first, the way the sudoku and
   kropki diggers do: most removals settle at tier 1 and never pay for more. */
function logicSolveUpTo(spec, puz, tier, propagate) {
  for (let t = 1; t <= tier; t++) if (logicSolve(spec, puz, t, propagate)) return true;
  return false;
}

/* Cages are grown from a finished solution, so the sums and the no-repeat
   rule hold for it by construction. They are built one at a time in the
   jigsaw style: each starts from the free cell with the fewest free
   neighbours, so tight corners are claimed first and no cell gets stranded.
   A cage only grows into a cell whose digit it does not already hold. */
function killerCages(sol, sizes) {
  const n = 9, total = 81;
  const freeNbrs = (cageOf, i) => neighbours(i, n).filter(j => cageOf[j] === -1).length;

  for (let attempt = 0; attempt < 200; attempt++) {
    const cageOf = new Int16Array(total).fill(-1);
    const groups = [];
    for (;;) {
      let start = -1, fewest = 99;
      for (const i of shuffle([...Array(total).keys()])) {
        if (cageOf[i] !== -1) continue;
        const f = freeNbrs(cageOf, i);
        if (f < fewest) { fewest = f; start = i; }
      }
      if (start === -1) break;
      const k = groups.length, cells = [start];
      let used = bitOf(sol[start]);
      cageOf[start] = k;
      const target = sizes[Math.floor(Math.random() * sizes.length)];
      while (cells.length < target) {
        const frontier = [];
        for (const i of cells) for (const j of neighbours(i, n)) {
          if (cageOf[j] === -1 && !(used & bitOf(sol[j])) && !frontier.includes(j)) frontier.push(j);
        }
        if (!frontier.length) break;
        let pick = -1, few = 99;
        for (const j of shuffle(frontier)) {
          const f = freeNbrs(cageOf, j);
          if (f < few) { few = f; pick = j; }
        }
        cageOf[pick] = k; cells.push(pick); used |= bitOf(sol[pick]);
      }
      groups.push({cells, used});
    }

    /* A one-cell cage is just a given in disguise. Fold each into the
       smallest neighbouring cage that lacks its digit; at most one may stay. */
    let ok = true, singles = 0;
    for (const g of shuffle(groups.filter(g => g.cells.length === 1))) {
      if (g.cells.length !== 1) continue;
      const i = g.cells[0], bt = bitOf(sol[i]);
      let into = -1;
      for (const j of neighbours(i, n)) {
        const h = groups[cageOf[j]];
        if (h === g || (h.used & bt)) continue;
        if (into === -1 || h.cells.length < groups[into].cells.length) into = cageOf[j];
      }
      if (into === -1) {
        if (++singles > 1) { ok = false; break; }
        continue;
      }
      groups[into].cells.push(i); groups[into].used |= bt;
      g.cells = [];
      cageOf[i] = into;
    }
    if (!ok) continue;

    const cages = groups.filter(g => g.cells.length)
      .map(g => g.cells.sort((a, b) => a - b))
      .sort((a, b) => a[0] - b[0])
      .map(cells => ({cells, sum: cells.reduce((s, i) => s + sol[i], 0)}));
    const out = new Int16Array(total);
    cages.forEach((c, k) => { for (const i of c.cells) out[i] = k; });
    return {cages, cageOf: out};
  }
  return null;
}

/* Kakuro's sum logic applied to cages: a combination of digits survives only
   if every cell can hold one of its digits and every one of its digits fits
   some cell. A cell keeps only digits from surviving combinations, minus any
   digit already placed in the cage. A digit common to every surviving
   combination that only one cell can still take goes in that cell.
   Cages are deliberately not units: hiddenSingles and lockedCandidates
   assume every unit holds all n digits, which a cage does not. */
function makeKillerPropagator(cages, extra) {
  /* hard level only: the 45-rule cages, and for every cage (real or virtual)
     the units it lies wholly inside, where a digit the cage must hold can be
     struck from the rest of the unit */
  const all = extra ? cages.concat(extra.virtual) : cages;
  const homes = all.map(c => extra
    ? extra.spec.units.map(u => u.cells).filter(u => c.cells.every(i => u.includes(i)))
    : []);
  return (cand, v, elim, place) => {
    let ch = false;
    for (let q = 0; q < all.length; q++) {
      const {cells, sum} = all[q];
      const L = cells.length;
      let any = 0, placed = 0;
      const masks = cells.map(i => {
        const m = v[i] ? bitOf(v[i]) : cand[i];
        any |= m;
        if (v[i]) placed |= m;
        return m;
      });
      const allow = new Array(L).fill(0);
      let common = 511;
      for (const m of (COMBOS[L] && COMBOS[L][sum]) || []) {
        if ((any & m) !== m) continue;
        let fits = true;
        for (let k = 0; k < L && fits; k++) if (!(masks[k] & m)) fits = false;
        if (!fits) continue;
        common &= m;
        for (let k = 0; k < L; k++) allow[k] |= m;
      }
      for (let k = 0; k < L; k++) {
        if (!v[cells[k]] && elim(cells[k], 511 & ~(allow[k] & ~placed))) ch = true;
      }
      if (!allow[0]) continue;
      for (let d = 1; d <= 9; d++) {
        const bt = bitOf(d);
        if (!(common & bt) || (placed & bt)) continue;
        let pos = -1, cnt = 0;
        for (const i of cells) if (!v[i] && (cand[i] & bt)) { cnt++; pos = i; }
        if (cnt === 1) { place(pos, d); placed |= bt; ch = true; }
        else for (const u of homes[q]) for (const i of u) {
          if (!cells.includes(i) && elim(i, bt)) ch = true;
        }
      }
    }
    return ch;
  };
}

/* The 45 rule. Every row, column and box holds 1–9 once and so sums to 45,
   and a run of whole rows or columns to a multiple of it. The cages lying
   wholly inside such a region leave a few cells over whose total is then
   known (innies); the cages poking out of it leave a few cells outside whose
   total is known too (outies). Either set becomes a virtual cage, provided its
   digits are bound to differ: one cell, or cells that all see each other. */
function killerVirtualCages(spec, cages, cageOf) {
  const regions = spec.units.map(u => u.cells);
  for (let w = 2; w <= 4; w++) {
    for (let a = 0; a + w <= 9; a++) {
      const rows = [], cols = [];
      for (let r = a; r < a + w; r++) for (let c = 0; c < 9; c++) { rows.push(r * 9 + c); cols.push(c * 9 + r); }
      regions.push(rows, cols);
    }
  }
  const sees = (a, b) => cageOf[a] === cageOf[b] || spec.peers[a].includes(b);
  const distinct = cells => cells.every((a, x) => cells.every((b, y) => x <= y || sees(a, b)));

  const out = [], seen = new Set();
  const add = (cells, sum) => {
    if (!cells.length || cells.length > 4 || !distinct(cells)) return;
    cells.sort((a, b) => a - b);
    const key = cells.join(",") + "=" + sum;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({cells, sum});
  };
  for (const region of regions) {
    const inside = new Set(region);
    const total = 45 * region.length / 9;
    let innerSum = 0, outerSum = 0;
    const covered = new Set(), outside = [];
    for (const k of new Set(region.map(i => cageOf[i]))) {
      const {cells, sum} = cages[k];
      outerSum += sum;
      if (cells.every(i => inside.has(i))) { innerSum += sum; cells.forEach(i => covered.add(i)); }
      else for (const i of cells) if (!inside.has(i)) outside.push(i);
    }
    add(region.filter(i => !covered.has(i)), total - innerSum);
    add(outside, outerSum - total);
  }
  return out;
}

/* independent check: plain backtracking from countSolutions, with the cage
   rules as its only extra knowledge. Never touches the logic solver. A cage
   stays open while some set of distinct digits still adds up to its sum,
   holds every digit already placed in it, and can be spread over its empty
   cells using only digits their rows, columns and boxes leave free. */
function countKillerSolutions(spec, cages, cageOf, puzzle) {
  const cageOk = (v, i, d, free) => {
    const {cells, sum} = cages[cageOf[i]];
    let used = 0;
    for (const j of cells) {
      if (!v[j]) continue;
      if (j !== i && v[j] === d) return false;
      used |= bitOf(v[j]);
    }
    for (const m of COMBOS[cells.length][sum] || []) {
      if ((m & used) !== used) continue;
      const rest = m & ~used;
      let union = 0, fits = true;
      for (const j of cells) {
        if (v[j]) continue;
        if (!(free[j] & rest)) { fits = false; break; }
        union |= free[j];
      }
      if (fits && (union & rest) === rest) return true;
    }
    return false;
  };
  /* a few hundred thousand steps is seconds here; a layout that needs more
     is cheaper to replace than to prove */
  return countSolutions(spec, puzzle, 2, cageOk, 250000);
}

/* Smaller cages admit fewer digit combinations, so they make for an easier
   puzzle. targetGivens is where digging stops.
   Hard aims for no givens at all. Random cages pin down the whole grid on
   their own only rarely (about one layout in thirty with these sizes), but
   testing a layout takes a few milliseconds, so hard simply tries many
   (zeroTries) before settling for the fewest givens that digging reaches. */
const KILLER_CFG = {
  easy:   {sizes: [2, 2, 2, 3, 3],    tier: 1, targetGivens: 10, layouts: 12},
  medium: {sizes: [2, 2, 3, 3, 4],    tier: 1, targetGivens: 2,  layouts: 24},
  hard:   {sizes: [2, 2, 3, 3, 4, 5], tier: 3, targetGivens: 0,  layouts: 160, zeroTries: 150, rule45: true}
};

function digKillerOnce(spec, propagate, sol, cfg) {
  const puz = Uint8Array.from(sol);
  let givens = spec.N;
  for (const i of shuffle([...Array(spec.N).keys()])) {
    const saved = puz[i];
    puz[i] = 0;
    if (!logicSolveUpTo(spec, puz, cfg.tier, propagate)) { puz[i] = saved; continue; }
    if (--givens <= cfg.targetGivens) break;
  }
  return {puz, givens};
}

/* Each try is a fresh solution with a fresh cage layout. Whatever is kept
   passes the independent count first; an aborted count is a failed try. */
function makeKiller(level) {
  const cfg = KILLER_CFG[level];
  const spec = buildSpec("sudoku9");
  let best = null;
  for (let l = 0; l < cfg.layouts; l++) {
    const sol = generateSolution(spec);
    if (!sol) continue;
    const layout = killerCages(sol, cfg.sizes);
    if (!layout) continue;
    const propagate = makeKillerPropagator(layout.cages, cfg.rule45 ? {
      spec, virtual: killerVirtualCages(spec, layout.cages, layout.cageOf)} : null);

    /* the cages alone may already settle the grid at this tier; if they
       don't, dig anyway and take the fewest givens the layout allows */
    let r;
    const empty = new Uint8Array(spec.N);
    if (cfg.targetGivens === 0 && logicSolveUpTo(spec, empty, cfg.tier, propagate)) {
      r = {puz: empty, givens: 0};
    } else if (l >= (cfg.zeroTries || 0)) {
      r = digKillerOnce(spec, propagate, sol, cfg);
    } else continue;
    if (best && r.givens >= best.givens) continue;

    const check = countKillerSolutions(spec, layout.cages, layout.cageOf, r.puz);
    if (check.aborted || check.count !== 1) continue;
    best = {spec, solution: sol, puz: r.puz, givens: r.givens, ...layout};
    if (best.givens <= cfg.targetGivens) break;
  }
  return best;
}



const UNKNOWN = 0, WHITE = 1, BLACK = 2;

function hNeighbours(i, n) {
  const r = (i / n) | 0, c = i % n, out = [];
  if (r > 0) out.push(i - n);
  if (r < n - 1) out.push(i + n);
  if (c > 0) out.push(i - 1);
  if (c < n - 1) out.push(i + 1);
  return out;
}

/* White cells must form a single connected region. */
function whitesConnected(state, n, treatUnknownAsWhite) {
  const N = n * n;
  const passable = i => treatUnknownAsWhite ? state[i] !== BLACK : state[i] === WHITE;
  let start = -1;
  for (let i = 0; i < N; i++) if (state[i] === WHITE) { start = i; break; }
  if (start === -1) return true;
  const seen = new Uint8Array(N);
  const q = [start];
  seen[start] = 1;
  while (q.length) {
    const i = q.pop();
    for (const j of hNeighbours(i, n)) if (!seen[j] && passable(j)) { seen[j] = 1; q.push(j); }
  }
  for (let i = 0; i < N; i++) if (state[i] === WHITE && !seen[i]) return false;
  return true;
}

/* ---------- puzzle construction ---------- */

/* Maximal independent set: black cells never touch each other, and every
   white cell touches some black one. That way no extra black cell could
   be added to the solution. */
function shadingPattern(n) {
  const N = n * n;
  const black = new Uint8Array(N);
  const state = new Uint8Array(N).fill(WHITE);
  for (const i of shuffle([...Array(N).keys()])) {
    if (hNeighbours(i, n).some(j => black[j])) continue;
    black[i] = 1; state[i] = BLACK;
    if (!whitesConnected(state, n, false)) { black[i] = 0; state[i] = WHITE; }
  }
  return black;
}

function latinSquare(n) {
  const rows = shuffle([...Array(n).keys()]);
  const cols = shuffle([...Array(n).keys()]);
  const shift = shuffle([...Array(n).keys()]);
  const g = new Uint8Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    g[rows[r] * n + cols[c]] = shift[(r + c) % n] + 1;
  }
  return g;
}

/* A black cell's value is swapped for a duplicate of some white cell in
   the same row or column, so that it is forced to be shaded. */
function buildValues(black, n) {
  const N = n * n;
  const val = latinSquare(n);
  for (let i = 0; i < N; i++) {
    if (!black[i]) continue;
    const r = (i / n) | 0, c = i % n;
    const partners = [];
    for (let k = 0; k < n; k++) {
      const a = r * n + k, b = k * n + c;
      if (a !== i && !black[a]) partners.push(val[a]);
      if (b !== i && !black[b]) partners.push(val[b]);
    }
    if (!partners.length) return null;
    val[i] = partners[Math.floor(Math.random() * partners.length)];
  }
  return val;
}

/* ---------- solver ---------- */

function solveHitori(val, n, limit) {
  const N = n * n;
  const state = new Uint8Array(N);
  const found = [];
  let steps = 0, aborted = false;

  const rowCells = [], colCells = [];
  for (let r = 0; r < n; r++) rowCells.push([...Array(n).keys()].map(c => r * n + c));
  for (let c = 0; c < n; c++) colCells.push([...Array(n).keys()].map(r => r * n + c));
  const lines = [...rowCells, ...colCells];
  const linesOf = Array.from({length: N}, () => []);
  for (const line of lines) for (const i of line) linesOf[i].push(line);

  function propagate() {
    for (let round = 0; round < 200; round++) {
      let changed = false;
      /* a black cell can't touch another black cell */
      for (let i = 0; i < N; i++) {
        if (state[i] !== BLACK) continue;
        for (const j of hNeighbours(i, n)) {
          if (state[j] === BLACK) return false;
          if (state[j] === UNKNOWN) { state[j] = WHITE; changed = true; }
        }
      }
      /* the same digit can appear white at most once per row or column */
      for (const line of lines) {
        const byVal = new Map();
        for (const i of line) {
          if (!byVal.has(val[i])) byVal.set(val[i], []);
          byVal.get(val[i]).push(i);
        }
        for (const group of byVal.values()) {
          if (group.length < 2) continue;
          const whites = group.filter(i => state[i] === WHITE);
          if (whites.length > 1) return false;
          if (whites.length === 1) {
            for (const i of group) {
              if (state[i] === UNKNOWN) { state[i] = BLACK; changed = true; }
            }
          } else {
            const unknown = group.filter(i => state[i] === UNKNOWN);
            if (!unknown.length && !group.some(i => state[i] === WHITE)) {
              /* all black: allowed only if they don't touch each other,
                 which the rule above already checks */
            }
            if (unknown.length === 1 && group.every(i => state[i] !== WHITE)) {
              /* at least one must stay white if the rest are black */
              const blacks = group.filter(i => state[i] === BLACK);
              if (blacks.length === group.length - 1) { state[unknown[0]] = WHITE; changed = true; }
            }
          }
        }
      }
      /* the white cells must stay connected */
      if (!whitesConnected(state, n, true)) return false;
      if (!changed) break;
    }
    return true;
  }

  function search() {
    if (aborted) return true;
    if (++steps > 300000) { aborted = true; return true; }
    const saved = Uint8Array.from(state);
    if (!propagate()) { state.set(saved); return false; }

    let best = -1, bestScore = -1;
    for (let i = 0; i < N; i++) {
      if (state[i] !== UNKNOWN) continue;
      let score = 0;
      for (const j of hNeighbours(i, n)) if (state[j] !== UNKNOWN) score++;
      for (const line of linesOf[i]) for (const j of line) if (j !== i && val[j] === val[i]) score += 2;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best === -1) {
      if (whitesConnected(state, n, false)) {
        found.push(Uint8Array.from(state));
        if (found.length >= limit) { state.set(saved); return true; }
      }
      state.set(saved);
      return false;
    }
    for (const choice of [BLACK, WHITE]) {
      const snapshot = Uint8Array.from(state);
      state[best] = choice;
      if (search()) { state.set(saved); return true; }
      state.set(snapshot);
    }
    state.set(saved);
    return false;
  }

  search();
  found.aborted = aborted;
  return found;
}

const HITORI_CFG = {
  easy:   {n: 6},
  medium: {n: 7},
  hard:   {n: 8}
};

function makeHitori(level) {
  const n = HITORI_CFG[level].n;
  for (let attempt = 0; attempt < 400; attempt++) {
    const black = shadingPattern(n);
    if (!black) continue;
    const val = buildValues(black, n);
    if (!val) continue;
    const sols = solveHitori(val, n, 2);
    if (sols.aborted || sols.length !== 1) continue;
    const shaded = sols[0];
    let count = 0;
    for (let i = 0; i < n * n; i++) if (shaded[i] === BLACK) count++;
    return {n, values: val, shaded, black: count};
  }
  return null;
}

/* ---------- pilvenpiirtäjät ---------- */

const SKY_SIDES = ["top", "bottom", "left", "right"];

/* how many buildings show when the line is read from its first cell on */
function skyVisible(heights) {
  let seen = 0, tallest = 0;
  for (const h of heights) if (h > tallest) { tallest = h; seen++; }
  return seen;
}

/* Every ordering of 1..n, bucketed by the clue pair it satisfies:
   SKY_PERMS[n][front][back], where 0 stands for a hidden clue. Each entry is
   a flat array of digit bits, n per ordering, ready to test against masks.
   That's 120, 720 or 5040 orderings, built once per size. */
const SKY_PERMS = {};
function skyPerms(n) {
  if (SKY_PERMS[n]) return SKY_PERMS[n];
  const lists = Array.from({length: n + 1}, () => Array.from({length: n + 1}, () => []));
  const p = [];
  (function rec(used) {
    if (p.length === n) {
      const f = skyVisible(p), b = skyVisible(p.slice().reverse());
      const bits = p.map(bitOf);
      for (const ff of [f, 0]) for (const bb of [b, 0]) lists[ff][bb].push(...bits);
      return;
    }
    for (let d = 1; d <= n; d++) {
      if (used & bitOf(d)) continue;
      p.push(d); rec(used | bitOf(d)); p.pop();
    }
  })(0);
  return SKY_PERMS[n] = lists.map(row => row.map(l => Uint16Array.from(l)));
}

/* Rows read left to right and columns top to bottom; the first clue of a
   line is the one at its start, the second the one at its end. */
function skyLines(n, clues) {
  const lines = [];
  for (let r = 0; r < n; r++) {
    lines.push({cells: Array.from({length: n}, (_, c) => r * n + c), front: clues.left[r], back: clues.right[r]});
  }
  for (let c = 0; c < n; c++) {
    lines.push({cells: Array.from({length: n}, (_, r) => r * n + c), front: clues.top[c], back: clues.bottom[c]});
  }
  return lines;
}

/* Line by line: keep the orderings that match the line's clues and fit every
   cell's candidates, and a cell keeps only the heights some survivor puts
   there. Lines without clues are left to the plain row and column logic.
   Filtering is idempotent, so a line whose masks are just as this filter
   left them last time is skipped; with seven-wide lines that is most of the
   work saved. */
function makeSkyscraperPropagator(spec, clues) {
  const {n, FULL} = spec;
  const perms = skyPerms(n);
  const lines = skyLines(n, clues)
    .filter(l => l.front || l.back)
    .map(l => ({cells: l.cells, list: perms[l.front || 0][l.back || 0], last: new Uint16Array(n)}));
  const masks = new Uint16Array(n), allow = new Uint16Array(n);
  return (cand, v, elim) => {
    let ch = false;
    for (const line of lines) {
      const {cells, list, last} = line;
      let same = true;
      for (let k = 0; k < n; k++) {
        const i = cells[k];
        masks[k] = v[i] ? bitOf(v[i]) : cand[i];
        if (masks[k] !== last[k]) same = false;
      }
      if (same) continue;
      allow.fill(0);
      for (let s = 0; s < list.length; s += n) {
        let k = 0;
        while (k < n && (masks[k] & list[s + k])) k++;
        if (k < n) continue;
        for (k = 0; k < n; k++) allow[k] |= list[s + k];
      }
      for (let k = 0; k < n; k++) {
        const i = cells[k];
        if (elim(i, FULL & ~allow[k])) ch = true;
        last[k] = v[i] ? bitOf(v[i]) : cand[i];
      }
    }
    return ch;
  };
}

/* independent check: plain backtracking from countSolutions, with the clue
   rules as its only extra knowledge. Never touches the logic solver.
   Read from a clue c, the building t cells in can be at most n - c + 1 + t
   tall, and a full line must show exactly c. On a partial line the count is
   bracketed: at least the buildings showing along the filled run from the
   clue, plus the tallest one if it is not in that run yet; at most one for
   every cell that could still beat each filled cell in front of it. */
function countSkyscraperSolutions(spec, puzzle, clues) {
  const {n} = spec;
  const lines = skyLines(n, clues);
  const linesOf = Array.from({length: spec.N}, () => []);
  for (const l of lines) for (const i of l.cells) linesOf[i].push(l);
  const sideOk = (v, cells, clue, fromEnd) => {
    let seen = 0, tallest = 0, run = 0, most = 0, ahead = 0;
    for (let t = 0; t < n; t++) {
      const h = v[cells[fromEnd ? n - 1 - t : t]];
      if (!h) { if (ahead < n) most++; continue; }
      if (h > n - clue + 1 + t) return false;
      if (h > ahead) { ahead = h; most++; }
      if (run === t) {
        run++;
        if (h > tallest) { tallest = h; seen++; }
      }
    }
    if (run === n) return seen === clue;
    const least = seen + (tallest < n ? 1 : 0);
    return least <= clue && Math.min(most, seen + n - tallest) >= clue;
  };
  const ok = (v, i) => {
    for (const {cells, front, back} of linesOf[i]) {
      if (front && !sideOk(v, cells, front, false)) return false;
      if (back && !sideOk(v, cells, back, true)) return false;
    }
    return true;
  };
  return countSolutions(spec, puzzle, 2, ok);
}

function skyClues(sol, n) {
  const clues = {top: [], bottom: [], left: [], right: []};
  for (let k = 0; k < n; k++) {
    const row = [], col = [];
    for (let t = 0; t < n; t++) { row.push(sol[k * n + t]); col.push(sol[t * n + k]); }
    clues.left.push(skyVisible(row));
    clues.right.push(skyVisible(row.reverse()));
    clues.top.push(skyVisible(col));
    clues.bottom.push(skyVisible(col.reverse()));
  }
  return clues;
}

/* target counts what is left on the page, clues and givens together; hard
   strips as far as the logic allows. cluesOnly waits for a solution whose
   full set of clues settles the grid with no givens at all -- at 6 × 6 only
   about one in fifteen does, but each test takes a fraction of a millisecond. */
const SKYSCRAPER_CFG = {
  easy:   {n: 5, tier: 1, target: 16, attempts: 10},
  medium: {n: 6, tier: 1, target: 14, attempts: 10},
  hard:   {n: 6, tier: 3, target: 0, attempts: 400, cluesOnly: true}
};

/* Start from every clue and every given, then remove them one at a time,
   keeping a removal only while the logic still finishes the grid. Givens go
   first, in random order, then clues: a given is worth more than a clue, so
   a single shuffled list ends up keeping givens and dropping clues, and what
   is left reads as a Latin square with a few edge numbers. */
function makeSkyscrapers(level) {
  const cfg = SKYSCRAPER_CFG[level];
  const spec = buildSpec("latin" + cfg.n);
  const {n, N} = spec;
  for (let attempt = 0; attempt < cfg.attempts; attempt++) {
    const sol = generateSolution(spec);
    if (!sol) continue;
    const clues = skyClues(sol, n);
    const empty = new Uint8Array(N);
    if (cfg.cluesOnly && !logicSolveUpTo(spec, empty, cfg.tier, makeSkyscraperPropagator(spec, clues))) continue;
    const puzzle = cfg.cluesOnly ? empty : Uint8Array.from(sol);
    const givens = [], edge = [];
    for (let i = 0; i < N; i++) if (puzzle[i]) givens.push(["given", i]);
    for (const side of SKY_SIDES) for (let k = 0; k < n; k++) edge.push([side, k]);
    let left = givens.length + edge.length;
    for (const [what, k] of shuffle(givens).concat(shuffle(edge))) {
      if (left <= cfg.target) break;
      const owner = what === "given" ? puzzle : clues[what];
      const saved = owner[k];
      owner[k] = what === "given" ? 0 : null;
      if (!logicSolveUpTo(spec, puzzle, cfg.tier, makeSkyscraperPropagator(spec, clues))) {
        owner[k] = saved;
        continue;
      }
      left--;
    }
    const check = countSkyscraperSolutions(spec, puzzle, clues);
    if (check.aborted || check.count !== 1) continue;
    return {spec, solution: sol, puzzle, clues, left};
  }
  return null;
}

/* ---------- nonogrammi ---------- */

const NG_UNKNOWN = 0, NG_EMPTY = 1, NG_FILL = 2;

/* The only place that decides what the picture is. Everything downstream just
   takes a filled/empty bitmap, so a library of drawn pictures can replace or
   wrap this without touching the clues, the solver or the renderer.
   Blobs are grown by random accretion rather than filling cells independently,
   so the result reads as connected shapes instead of static. */
function nonogramPattern(n, cfg) {
  const N = n * n;
  const fill = new Uint8Array(N);
  const half = cfg.symmetric ? Math.ceil(n / 2) : n;
  const target = Math.round(n * half * cfg.density);
  const frontier = [];
  let placed = 0;

  const seed = () => {
    const i = Math.floor(Math.random() * n) * n + Math.floor(Math.random() * half);
    if (fill[i]) return;
    fill[i] = 1; placed++; frontier.push(i);
  };
  for (let b = 0; b < cfg.blobs; b++) seed();

  for (let guard = 0; placed < target && guard < N * 40; guard++) {
    if (!frontier.length) { seed(); continue; }
    const k = Math.floor(Math.random() * frontier.length);
    const opts = neighbours(frontier[k], n).filter(j => !fill[j] && j % n < half);
    if (!opts.length) { frontier.splice(k, 1); continue; }
    const j = opts[Math.floor(Math.random() * opts.length)];
    fill[j] = 1; placed++; frontier.push(j);
  }

  if (cfg.symmetric) {
    for (let r = 0; r < n; r++) for (let c = 0; c < half; c++) {
      if (fill[r * n + c]) fill[r * n + (n - 1 - c)] = 1;
    }
  }
  return fill;
}

/* Run lengths per row and per column. An empty line yields [], printed as 0. */
function nonogramClues(fill, n) {
  const runs = get => {
    const out = [];
    let run = 0;
    for (let k = 0; k < n; k++) {
      if (get(k)) run++;
      else if (run) { out.push(run); run = 0; }
    }
    if (run) out.push(run);
    return out;
  };
  const rows = [], cols = [];
  for (let r = 0; r < n; r++) rows.push(runs(c => fill[r * n + c]));
  for (let c = 0; c < n; c++) cols.push(runs(r => fill[r * n + c]));
  return {rows, cols};
}

/* Deduces everything a single line allows, given what is already known.
   feasible[i][j] says the cells from i on can still hold the clues from j on,
   so a forward walk over the reachable states can mark, for every cell,
   whether any valid arrangement fills it and whether any leaves it blank. A
   cell that allows only one of the two is forced. Runs in O(line * clues) --
   no arrangement is ever enumerated. Mutates `cells`; false means the line
   cannot be satisfied at all. */
function solveLine(cells, clues) {
  const L = cells.length, m = clues.length;

  /* prefix counts keep the "does this run fit here" test O(1) */
  const blanks = new Int16Array(L + 1);
  for (let i = 0; i < L; i++) blanks[i + 1] = blanks[i] + (cells[i] === NG_EMPTY ? 1 : 0);
  const restBlank = new Uint8Array(L + 2);
  restBlank[L] = 1;
  for (let i = L - 1; i >= 0; i--) restBlank[i] = cells[i] === NG_FILL ? 0 : restBlank[i + 1];

  const feasible = [];
  for (let i = 0; i <= L; i++) feasible.push(new Uint8Array(m + 1));
  for (let i = 0; i <= L; i++) feasible[i][m] = restBlank[i];

  const placeable = (i, len) => i + len <= L && blanks[i + len] - blanks[i] === 0;

  for (let j = m - 1; j >= 0; j--) {
    for (let i = L; i >= 0; i--) {
      let ok = i < L && cells[i] !== NG_FILL && feasible[i + 1][j];
      if (!ok && placeable(i, clues[j])) {
        const after = i + clues[j];
        ok = after === L
          ? !!feasible[L][j + 1]
          : cells[after] !== NG_FILL && !!feasible[after + 1][j + 1];
      }
      feasible[i][j] = ok ? 1 : 0;
    }
  }
  if (!feasible[0][0]) return false;

  const canFill = new Uint8Array(L), canBlank = new Uint8Array(L);
  const reach = [];
  for (let i = 0; i <= L; i++) reach.push(new Uint8Array(m + 1));
  reach[0][0] = 1;
  for (let i = 0; i <= L; i++) {
    for (let j = 0; j <= m; j++) {
      if (!reach[i][j]) continue;
      /* leave this cell blank */
      if (i < L && cells[i] !== NG_FILL && feasible[i + 1][j]) {
        canBlank[i] = 1; reach[i + 1][j] = 1;
      }
      if (j === m) continue;
      /* or start clue j here */
      if (!placeable(i, clues[j])) continue;
      const after = i + clues[j];
      const rest = after === L
        ? !!feasible[L][j + 1]
        : cells[after] !== NG_FILL && !!feasible[after + 1][j + 1];
      if (!rest) continue;
      for (let k = i; k < after; k++) canFill[k] = 1;
      if (after === L) { reach[L][j + 1] = 1; }
      else { canBlank[after] = 1; reach[after + 1][j + 1] = 1; }
    }
  }

  for (let k = 0; k < L; k++) {
    if (cells[k] !== NG_UNKNOWN) continue;
    if (canFill[k] && !canBlank[k]) cells[k] = NG_FILL;
    else if (!canFill[k] && canBlank[k]) cells[k] = NG_EMPTY;
    else if (!canFill[k] && !canBlank[k]) return false;
  }
  return true;
}

/* Applies solveLine to every row and column until nothing more follows,
   the same shape as the Kakuro propagation loop. */
function nonogramSolve(rowClues, colClues, n) {
  const grid = new Uint8Array(n * n);
  const line = new Uint8Array(n);
  let rounds = 0;

  for (;;) {
    let changed = false;
    if (++rounds > 200) return null;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) line[c] = grid[r * n + c];
      if (!solveLine(line, rowClues[r])) return null;
      for (let c = 0; c < n; c++) {
        if (grid[r * n + c] !== line[c]) { grid[r * n + c] = line[c]; changed = true; }
      }
    }
    for (let c = 0; c < n; c++) {
      for (let r = 0; r < n; r++) line[r] = grid[r * n + c];
      if (!solveLine(line, colClues[c])) return null;
      for (let r = 0; r < n; r++) {
        if (grid[r * n + c] !== line[r]) { grid[r * n + c] = line[r]; changed = true; }
      }
    }
    if (!changed) break;
  }

  let unknown = 0;
  for (let i = 0; i < n * n; i++) if (grid[i] === NG_UNKNOWN) unknown++;
  return {grid, rounds, unknown};
}

/* rounds is a cheap stand-in for how much back-and-forth a solver needs, and
   is the only difficulty lever besides size. Several small blobs beat a few
   large ones: they leave far fewer blank rows and columns.
   Sizes are multiples of five so the every-five guide lines always group the
   grid evenly -- the same reason published nonograms use those sizes. */
const NONOGRAM_CFG = {
  easy:   {n: 10, density: 0.55, blobs: 7,  symmetric: true,  maxFull: 4, maxClues: 4, maxRounds: 4},
  medium: {n: 15, density: 0.55, blobs: 9,  symmetric: false, maxFull: 3, maxClues: 4, minRounds: 3, maxRounds: 8},
  hard:   {n: 20, density: 0.55, blobs: 12, symmetric: false, maxFull: 3, maxClues: 5, minRounds: 4}
};

/* The one gate every nonogram passes, whoever drew the picture.

   A blank line reads as padding rather than picture, and a completely full one
   hands the solver a free row; both are refused for generated puzzles, though
   a picture the user supplied is allowed its blank edges. Capping how many
   numbers a line may carry fixes how wide the clue margins can get, which is
   what keeps a puzzle inside its share of the page. Those are cheap, so they
   are checked before solving.

   The real test is that the line logic finishes unaided. Every deduction it
   makes is forced and the picture is a valid solution, so a complete solve is
   also proof that this solution is the only one. */
function nonogramAccept(fill, n, cfg) {
  const {rows, cols} = nonogramClues(fill, n);

  let blank = 0, full = 0, widest = 0;
  for (const c of rows.concat(cols)) {
    if (!c.length) blank++;
    else if (c.length === 1 && c[0] === n) full++;
    if (c.length > widest) widest = c.length;
  }
  if (blank && !cfg.allowBlank) return null;
  if (full > cfg.maxFull || widest > cfg.maxClues) return null;

  const res = nonogramSolve(rows, cols, n);
  if (!res || res.unknown) return null;
  if (res.rounds < (cfg.minRounds || 0)) return null;
  if (res.rounds > (cfg.maxRounds || 999)) return null;

  /* independent check that the solver landed on the picture it was given */
  for (let i = 0; i < n * n; i++) {
    if ((res.grid[i] === NG_FILL) !== !!fill[i]) return null;
  }
  return {rows, cols, rounds: res.rounds};
}

function makeNonogram(level) {
  const cfg = NONOGRAM_CFG[level];
  const n = cfg.n;
  for (let attempt = 0; attempt < 400; attempt++) {
    const fill = nonogramPattern(n, cfg);
    const ok = nonogramAccept(fill, n, cfg);
    if (ok) return {n, fill, rowClues: ok.rows, colClues: ok.cols};
  }
  return null;
}

/* ---------- nonogrammi omasta kuvasta ---------- */

/* One puzzle per page, so these can be bigger and carry wider clue margins
   than the generated sizes. Blank lines are allowed here: a picture the user
   brought is entitled to its empty edges. */
const NONOGRAM_IMAGE_CFG = {
  20: {n: 20, maxFull: 6, maxClues: 6, allowBlank: true, cell: "7mm",   sol: "6mm"},
  25: {n: 25, maxFull: 7, maxClues: 6, allowBlank: true, cell: "5.8mm", sol: "5mm"},
  30: {n: 30, maxFull: 8, maxClues: 7, allowBlank: true, cell: "4.9mm", sol: "4.2mm"}
};

/* Average the picture down a cell at a time rather than leaning on drawImage
   smoothing, so every browser produces the same grid. The source is centre
   cropped to a square: padding it to shape instead would add empty rows, and
   an empty row carries no picture. Transparency is composited onto white. */
function imageToGray(img, n) {
  /* a first pass into a bounded canvas keeps huge photos cheap to read back */
  const scale = Math.min(1, 512 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d", {willReadFrequently: true});
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;

  const lumAt = (x, y) => {
    const p = (y * w + x) * 4;
    const a = data[p + 3] / 255;
    return (0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2]) * a + 255 * (1 - a);
  };

  /* Find what the picture actually covers, so a logo sitting in a wide white
     margin spends the grid on the subject instead of on the margin. The
     window is still square and still a crop, only re-centred on the subject. */
  const corner = [lumAt(0, 0), lumAt(w - 1, 0), lumAt(0, h - 1), lumAt(w - 1, h - 1)]
    .sort((a, b) => a - b);
  const bg = (corner[1] + corner[2]) / 2;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (Math.abs(lumAt(x, y) - bg) <= 26) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < x0 || y1 < y0) { x0 = 0; y0 = 0; x1 = w - 1; y1 = h - 1; }
  const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.04);
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);

  const side = Math.min(Math.max(x1 - x0 + 1, y1 - y0 + 1), w, h);
  const sx = Math.max(0, Math.min(w - side, Math.round((x0 + x1 + 1 - side) / 2)));
  const sy = Math.max(0, Math.min(h - side, Math.round((y0 + y1 + 1 - side) / 2)));

  const gray = new Float32Array(n * n);
  for (let r = 0; r < n; r++) {
    const ya = sy + Math.floor(r * side / n);
    const yb = Math.max(ya + 1, sy + Math.floor((r + 1) * side / n));
    for (let c = 0; c < n; c++) {
      const xa = sx + Math.floor(c * side / n);
      const xb = Math.max(xa + 1, sx + Math.floor((c + 1) * side / n));
      let sum = 0, count = 0;
      for (let y = ya; y < yb && y < h; y++) {
        for (let x = xa; x < xb && x < w; x++) { sum += lumAt(x, y); count++; }
      }
      gray[r * n + c] = count ? sum / count : bg;
    }
  }
  return gray;
}

/* Otsu: the cut that splits the cells into dark and light with the least
   variance inside each group. A decent starting guess for any picture, which
   the user can then nudge. */
function otsuThreshold(gray) {
  const hist = new Float64Array(256);
  for (const v of gray) hist[Math.max(0, Math.min(255, Math.round(v)))]++;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];

  let sumB = 0, wB = 0, best = 128, bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = gray.length - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
    if (between > bestVar) { bestVar = between; best = t; }
  }
  return best;
}

function grayToBitmap(gray, n, threshold, invert) {
  const fill = new Uint8Array(n * n);
  for (let i = 0; i < gray.length; i++) {
    const dark = gray[i] <= threshold;
    fill[i] = (invert ? !dark : dark) ? 1 : 0;
  }
  return fill;
}

/* A lone cell, or a lone hole, adds a one-long run to two lines at once --
   the shape line logic handles worst, and the detail a reader cannot make out
   anyway. Worth clearing whether or not the puzzle would have solved. */
function denoiseBitmap(fill, n) {
  let changed = 0;
  for (let pass = 0; pass < 4; pass++) {
    const next = Uint8Array.from(fill);
    let acted = false;
    for (let i = 0; i < n * n; i++) {
      if (neighbours(i, n).some(j => fill[j] === fill[i])) continue;
      next[i] = fill[i] ? 0 : 1;
      acted = true; changed++;
    }
    fill.set(next);
    if (!acted) break;
  }
  return changed;
}

/* Bring any over-long line within the clue cap by either dropping its
   shortest run or closing its smallest gap, whichever moves fewer cells.
   Fixing a row can push a column over, so it repeats. */
function capClueRuns(fill, n, maxClues) {
  let changed = 0;
  for (let pass = 0; pass < 16; pass++) {
    let acted = false;
    for (let dir = 0; dir < 2; dir++) {
      for (let k = 0; k < n; k++) {
        const at = t => (dir === 0 ? k * n + t : t * n + k);
        const runs = [];
        let start = -1;
        for (let t = 0; t <= n; t++) {
          const on = t < n && fill[at(t)];
          if (on && start < 0) start = t;
          else if (!on && start >= 0) { runs.push([start, t - 1]); start = -1; }
        }
        if (runs.length <= maxClues) continue;

        let run = 0;
        for (let q = 1; q < runs.length; q++) {
          if (runs[q][1] - runs[q][0] < runs[run][1] - runs[run][0]) run = q;
        }
        let gap = 1, gapLen = Infinity;
        for (let q = 1; q < runs.length; q++) {
          const len = runs[q][0] - runs[q - 1][1] - 1;
          if (len < gapLen) { gapLen = len; gap = q; }
        }
        if (gapLen <= runs[run][1] - runs[run][0] + 1) {
          for (let t = runs[gap - 1][1] + 1; t < runs[gap][0]; t++) { fill[at(t)] = 1; changed++; }
        } else {
          for (let t = runs[run][0]; t <= runs[run][1]; t++) { fill[at(t)] = 0; changed++; }
        }
        acted = true;
      }
    }
    if (!acted) break;
  }
  return changed;
}

/* When the clues still leave the solver stuck, nudge the picture. The cells it
   could not settle are where the ambiguity lives, and a 2x2 block of them is
   the classic swap that leaves both lines' clues unchanged, so break one of
   those first. Each candidate is scored by re-solving, which is why the budget
   is small and the loop yields between steps. */
async function repairBitmap(fill, n, cfg, onStep) {
  let changed = 0;
  for (let step = 0; step < 220; step++) {
    capClueRuns(fill, n, cfg.maxClues);
    if (nonogramAccept(fill, n, cfg)) return {changed, ok: true};

    const {rows, cols} = nonogramClues(fill, n);
    const res = nonogramSolve(rows, cols, n);
    if (!res) return {changed, ok: false};

    const stuck = [];
    for (let i = 0; i < n * n; i++) if (res.grid[i] === NG_UNKNOWN) stuck.push(i);
    if (!stuck.length) return {changed, ok: false};   /* solvable but rejected elsewhere */

    const swaps = stuck.filter(i => {
      const c = i % n;
      return c + 1 < n && i + n + 1 < n * n &&
        res.grid[i + 1] === NG_UNKNOWN && res.grid[i + n] === NG_UNKNOWN &&
        res.grid[i + n + 1] === NG_UNKNOWN;
    });

    let best = null;
    for (const i of shuffle((swaps.length ? swaps : stuck).slice()).slice(0, 5)) {
      fill[i] ^= 1;
      const t = nonogramClues(fill, n);
      const r2 = nonogramSolve(t.rows, t.cols, n);
      fill[i] ^= 1;
      const score = r2 ? r2.unknown : Infinity;
      if (!best || score < best.score) best = {i, score};
    }
    fill[best.i] ^= 1;
    changed++;
    if (onStep && step % 8 === 0) await onStep(changed, stuck.length);
  }
  return {changed, ok: !!nonogramAccept(fill, n, cfg)};
}

/* Average the picture down to half the grid, so every cell becomes a 2x2
   block. Detail finer than the grid is what leaves the solver guessing, and
   redrawing it coarser is a more honest answer than scattering corrections
   over a picture that was never going to fit. */
function coarsenGray(gray, n) {
  const cn = Math.ceil(n / 2);
  const sum = new Float32Array(cn * cn), count = new Float32Array(cn * cn);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const k = (r >> 1) * cn + (c >> 1);
      sum[k] += gray[r * n + c]; count[k]++;
    }
  }
  for (let i = 0; i < sum.length; i++) sum[i] /= count[i];
  return {gray: sum, n: cn};
}

function upscaleBitmap(small, cn, n) {
  const out = new Uint8Array(n * n);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      out[r * n + c] = small[Math.min(cn - 1, r >> 1) * cn + Math.min(cn - 1, c >> 1)];
    }
  }
  return out;
}

async function makeNonogramFromImage(gray, size, threshold, invert, onStep) {
  const cfg = NONOGRAM_IMAGE_CFG[size];
  const n = cfg.n;
  const original = grayToBitmap(gray, n, threshold, invert);

  /* full detail first; if the picture is too busy for the grid to pin down,
     redraw it at half resolution and try again */
  for (const coarse of [false, true]) {
    let fill;
    if (!coarse) fill = Uint8Array.from(original);
    else {
      const c = coarsenGray(gray, n);
      fill = upscaleBitmap(grayToBitmap(c.gray, c.n, threshold, invert), c.n, n);
    }

    denoiseBitmap(fill, n);
    capClueRuns(fill, n, cfg.maxClues);

    let ok = nonogramAccept(fill, n, cfg);
    let flips = 0;
    if (!ok) {
      const rep = await repairBitmap(fill, n, cfg, onStep);
      flips = rep.changed;
      ok = nonogramAccept(fill, n, cfg);
    }
    if (!ok) continue;

    let moved = 0;
    for (let i = 0; i < n * n; i++) if (fill[i] !== original[i]) moved++;
    return {n, fill, original, rowClues: ok.rows, colClues: ok.cols,
            moved, flips, coarse, cell: cfg.cell, sol: cfg.sol};
  }
  return null;
}

/* ---------- sillat ---------- */

/* The puzzle state lives on the edges between islands rather than on cells,
   and one rule (everything joined up) is global, so it has its own
   generator, logic solver and independent counter, like Kakuro and Hitori. */

const HS_EMPTY = 0, HS_ISLAND = 1, HS_BRIDGE_H = 2, HS_BRIDGE_V = 3;

/* Candidate edges come from the island layout alone, never from the
   generated bridges: every pair that sees each other along a row or a column
   with nothing but empty cells between. Islands are numbered in reading
   order and each one looks right and down, so a < b on every edge. */
function hashiEdges(islands, n) {
  const at = new Int16Array(n * n).fill(-1);
  islands.forEach((p, i) => { at[p.r * n + p.c] = i; });
  const edges = [];
  islands.forEach((p, a) => {
    for (const [dr, dc, dir] of [[0, 1, "h"], [1, 0, "v"]]) {
      const cells = [];
      let r = p.r + dr, c = p.c + dc;
      while (r < n && c < n && at[r * n + c] === -1) { cells.push(r * n + c); r += dr; c += dc; }
      if (r < n && c < n) edges.push({a, b: at[r * n + c], dir, cells});
    }
  });
  return edges;
}

/* An "h" edge and a "v" edge cross when they pass over a common cell. */
function hashiCrossings(edges, n) {
  const hAt = Array.from({length: n * n}, () => []);
  edges.forEach((e, k) => { if (e.dir === "h") for (const i of e.cells) hAt[i].push(k); });
  const cross = edges.map(() => []);
  edges.forEach((e, k) => {
    if (e.dir !== "v") return;
    for (const i of e.cells) for (const h of hAt[i]) { cross[k].push(h); cross[h].push(k); }
  });
  return cross;
}

/* ---------- logic solver ---------- */

/* Every edge keeps the fewest (lo) and most (hi) bridges it can still carry.
   Each rule only narrows those ranges, and each is sound, so when all of them
   together settle every edge, the result is the only solution there is. */
function hashiSolve(puz, tier) {
  const {islands, edges} = puz;
  const E = edges.length, I = islands.length;
  const cross = puz.cross || hashiCrossings(edges, puz.n);
  const edgesOf = islands.map(() => []);
  edges.forEach((e, k) => { edgesOf[e.a].push(k); edgesOf[e.b].push(k); });

  const lo = new Uint8Array(E), hi = new Uint8Array(E);
  edges.forEach((e, k) => { hi[k] = Math.min(2, islands[e.a].k, islands[e.b].k); });

  /* Each rule returns -1 on a contradiction, 1 if it narrowed something and
     0 if it found nothing new. */

  /* An island's other edges must leave room for this one, and can't carry
     the rest of its count on their own. A narrowed edge closes every edge
     it would cross. */
  function counting(lo, hi) {
    let changed = 0;
    for (let i = 0; i < I; i++) {
      const own = edgesOf[i], k = islands[i].k;
      let sumLo = 0, sumHi = 0;
      for (const e of own) { sumLo += lo[e]; sumHi += hi[e]; }
      if (sumLo > k || sumHi < k) return -1;
      /* sums go stale as edges narrow below, which only weakens the bounds */
      for (const e of own) {
        const needLo = k - (sumHi - hi[e]), capHi = k - (sumLo - lo[e]);
        if (needLo > lo[e]) { lo[e] = needLo; changed = 1; }
        if (capHi < hi[e]) { hi[e] = capHi; changed = 1; }
        if (lo[e] > hi[e]) return -1;
      }
    }
    for (let e = 0; e < E; e++) {
      if (!lo[e]) continue;
      for (const f of cross[e]) {
        if (lo[f]) return -1;
        if (hi[f]) { hi[f] = 0; changed = 1; }
      }
    }
    return changed;
  }

  /* Islands already joined by sure bridges form components. An edge may not
     close off a component -- leave every island in it satisfied -- unless
     that component is the whole puzzle. */
  function isolation(lo, hi) {
    const comp = Int16Array.from({length: I}, (_, i) => i);
    const find = x => { while (comp[x] !== x) x = comp[x] = comp[comp[x]]; return x; };
    for (let e = 0; e < E; e++) {
      if (lo[e]) comp[find(edges[e].a)] = find(edges[e].b);
    }
    const need = new Int16Array(I), size = new Int16Array(I);
    for (let i = 0; i < I; i++) {
      let left = islands[i].k;
      for (const e of edgesOf[i]) left -= lo[e];
      need[find(i)] += left;
      size[find(i)]++;
    }
    for (let i = 0; i < I; i++) {
      if (comp[i] === i && need[i] === 0 && size[i] < I) return -1;
    }
    let changed = 0;
    for (let e = 0; e < E; e++) {
      if (lo[e] === hi[e]) continue;
      const A = find(edges[e].a), B = find(edges[e].b);
      const total = need[A] + (A === B ? 0 : need[B]);
      const merged = size[A] + (A === B ? 0 : size[B]);
      while (hi[e] > lo[e]) {
        const left = total - 2 * (hi[e] - lo[e]);
        if (left < 0 || (left === 0 && merged < I)) { hi[e]--; changed = 1; }
        else break;
      }
    }
    return changed;
  }

  /* Any edge whose loss would split the graph of still-possible edges must
     carry a bridge. Tarjan's bridge-finding, though here those are called
     cut edges, to keep them apart from the puzzle's bridges. */
  function cutEdges(lo, hi) {
    const disc = new Int16Array(I).fill(-1), low = new Int16Array(I);
    const cut = [];
    let time = 0;
    /* iterative, so a long chain of islands can't overflow the stack */
    const stack = [[0, -1, 0]];
    disc[0] = low[0] = time++;
    while (stack.length) {
      const top = stack[stack.length - 1];
      const [v, viaEdge] = top;
      const own = edgesOf[v];
      if (top[2] < own.length) {
        const e = own[top[2]++];
        if (!hi[e] || e === viaEdge) continue;
        const w = edges[e].a === v ? edges[e].b : edges[e].a;
        if (disc[w] === -1) {
          disc[w] = low[w] = time++;
          stack.push([w, e, 0]);
        } else if (disc[w] < low[v]) low[v] = disc[w];
      } else {
        stack.pop();
        if (viaEdge === -1) continue;
        const u = edges[viaEdge].a === v ? edges[viaEdge].b : edges[viaEdge].a;
        if (low[v] < low[u]) low[u] = low[v];
        if (low[v] > disc[u]) cut.push(viaEdge);
      }
    }
    if (time < I) return -1;
    let changed = 0;
    for (const e of cut) if (!lo[e]) { lo[e] = 1; changed = 1; }
    return changed;
  }

  function fixpoint(lo, hi, top, used) {
    for (;;) {
      let r = counting(lo, hi);
      if (r < 0) return false;
      if (r) { used[0] = Math.max(used[0], 1); continue; }
      if (top < 2) return true;
      r = isolation(lo, hi);
      if (r < 0) return false;
      if (r) { used[0] = Math.max(used[0], 2); continue; }
      if (top < 3) return true;
      r = cutEdges(lo, hi);
      if (r < 0) return false;
      if (r) { used[0] = 3; continue; }
      r = lookahead(lo, hi);
      if (r < 0) return false;
      if (r) { used[0] = 3; continue; }
      return true;
    }
  }

  /* Try each end of an undecided edge's range on a copy and run the cheaper
     tiers; a value that leads to a contradiction is ruled out. One level
     deep only. */
  function lookahead(lo, hi) {
    for (let e = 0; e < E; e++) {
      if (lo[e] === hi[e]) continue;
      for (const x of [lo[e], hi[e]]) {
        const l2 = Uint8Array.from(lo), h2 = Uint8Array.from(hi);
        l2[e] = h2[e] = x;
        if (fixpoint(l2, h2, 2, [0])) continue;
        if (x === lo[e]) lo[e]++; else hi[e]--;
        return 1;
      }
    }
    return 0;
  }

  const used = [0];
  const ok = fixpoint(lo, hi, tier, used);
  let solved = ok && lo.every((v, e) => v === hi[e]);
  if (solved) solved = hashiFinalCheck(puz, lo, cross);
  return {lo, hi, solved, tierUsed: used[0]};
}

/* Every island's count met, no two used edges crossing, and the islands
   joined into one piece -- a BFS, as in whitesConnected. */
function hashiFinalCheck(puz, val, cross) {
  const {islands, edges} = puz;
  const sum = new Int16Array(islands.length);
  const adj = islands.map(() => []);
  for (let e = 0; e < edges.length; e++) {
    if (!val[e]) continue;
    for (const f of cross[e]) if (val[f]) return false;
    sum[edges[e].a] += val[e]; sum[edges[e].b] += val[e];
    adj[edges[e].a].push(edges[e].b); adj[edges[e].b].push(edges[e].a);
  }
  if (islands.some((p, i) => sum[i] !== p.k)) return false;
  const seen = new Uint8Array(islands.length);
  const q = [0];
  seen[0] = 1;
  while (q.length) {
    const i = q.pop();
    for (const j of adj[i]) if (!seen[j]) { seen[j] = 1; q.push(j); }
  }
  return seen.every(Boolean);
}

/* ---------- independent check ---------- */

/* Plain backtracking over the edges in their fixed order, each taking 0, 1
   or 2 bridges. It prunes only on the islands' counts and on the crossing
   table, and checks connectivity with its own union-find once every edge is
   set; none of the logic solver's rules are used. An aborted count has not
   seen the whole tree, so callers must treat it as a failure. */
function countHashiSolutions(puz, limit, maxSteps = 2000000) {
  const {islands, edges} = puz;
  const E = edges.length, I = islands.length;
  const cross = puz.cross || hashiCrossings(edges, puz.n);
  /* the edge after which an island has nothing left to be assigned */
  const lastEdge = new Int16Array(I).fill(-1);
  edges.forEach((e, k) => { lastEdge[e.a] = k; lastEdge[e.b] = k; });
  const val = new Uint8Array(E), got = new Int16Array(I);
  const found = [];
  let steps = 0, aborted = false;

  function joined() {
    const parent = Int16Array.from({length: I}, (_, i) => i);
    const root = x => { while (parent[x] !== x) x = parent[x]; return x; };
    let parts = I;
    for (let e = 0; e < E; e++) {
      if (!val[e]) continue;
      const a = root(edges[e].a), b = root(edges[e].b);
      if (a !== b) { parent[a] = b; parts--; }
    }
    return parts === 1;
  }

  function go(e) {
    if (++steps > maxSteps) { aborted = true; return true; }
    if (e === E) {
      for (let i = 0; i < I; i++) if (got[i] !== islands[i].k) return false;
      if (!joined()) return false;
      found.push(Uint8Array.from(val));
      return found.length >= limit;
    }
    const {a, b} = edges[e];
    for (let v = 0; v <= 2; v++) {
      if (got[a] + v > islands[a].k || got[b] + v > islands[b].k) break;
      if (v && cross[e].some(f => f < e && val[f])) break;
      got[a] += v; got[b] += v; val[e] = v;
      const closes = (lastEdge[a] !== e || got[a] === islands[a].k) &&
                     (lastEdge[b] !== e || got[b] === islands[b].k);
      if (closes && go(e + 1)) return true;
      got[a] -= v; got[b] -= v; val[e] = 0;
    }
    return false;
  }

  go(0);
  return {count: found.length, solutions: found, aborted};
}

/* ---------- generator ---------- */

/* More double bridges pin the counts down and make for an easier puzzle;
   longer bridges and more cross links (cycles) make it harder. Each level
   must actually need its own rules: needsTier rejects a puzzle that the
   lower tiers already solve, so medium always takes the isolation rule and
   hard always takes connectivity or lookahead. */
const HASHI_CFG = {
  easy:   {n: 7,  minIslands: 10, maxIslands: 13, maxLen: 4, pDouble: 0.45, pExtra: 0.10, tier: 1},
  medium: {n: 9,  minIslands: 17, maxIslands: 23, maxLen: 5, pDouble: 0.35, pExtra: 0.15, tier: 2, needsTier: 2},
  hard:   {n: 11, minIslands: 25, maxIslands: 32, maxLen: 6, pDouble: 0.30, pExtra: 0.20, tier: 3,
           needsTier: 3}
};

/* Grows a connected layout outward from one island. The bridges laid while
   growing are themselves a solution, so the puzzle always has one. */
function hashiLayout(cfg) {
  const n = cfg.n;
  const occ = new Uint8Array(n * n);
  const rand = m => Math.floor(Math.random() * m);
  const isl = [], bridges = [];
  const weight = () => Math.random() < cfg.pDouble ? 2 : 1;
  const touchesIsland = (r, c) => [[0, 1], [1, 0], [0, -1], [-1, 0]].some(([dr, dc]) => {
    const y = r + dr, x = c + dc;
    return y >= 0 && y < n && x >= 0 && x < n && occ[y * n + x] === HS_ISLAND;
  });

  const r0 = 1 + rand(n - 2), c0 = 1 + rand(n - 2);
  occ[r0 * n + c0] = HS_ISLAND;
  isl.push({r: r0, c: c0});

  const target = cfg.minIslands + rand(cfg.maxIslands - cfg.minIslands + 1);
  for (let tries = 0; tries < 2000 && isl.length < target; tries++) {
    const a = rand(isl.length);
    const [dr, dc] = [[0, 1], [1, 0], [0, -1], [-1, 0]][rand(4)];
    const L = 2 + rand(cfg.maxLen - 1);
    const r = isl[a].r + dr * L, c = isl[a].c + dc * L;
    if (r < 0 || r >= n || c < 0 || c >= n || occ[r * n + c] !== HS_EMPTY) continue;
    if (touchesIsland(r, c)) continue;
    let clear = true;
    for (let s = 1; s < L && clear; s++) clear = occ[(isl[a].r + dr * s) * n + isl[a].c + dc * s] === HS_EMPTY;
    if (!clear) continue;
    for (let s = 1; s < L; s++) occ[(isl[a].r + dr * s) * n + isl[a].c + dc * s] = dr ? HS_BRIDGE_V : HS_BRIDGE_H;
    occ[r * n + c] = HS_ISLAND;
    isl.push({r, c});
    bridges.push({a, b: isl.length - 1, w: weight()});
  }
  if (isl.length < cfg.minIslands) return null;

  /* Cross links close cycles, which is where alternative solutions come
     from, so they stay rare. Scanning to the first occupied cell finds
     exactly the islands seen across empty cells. */
  const index = new Map(isl.map((p, i) => [p.r * n + p.c, i]));
  const linked = new Set(bridges.map(({a, b}) => Math.min(a, b) + "," + Math.max(a, b)));
  for (const a of shuffle([...isl.keys()])) {
    for (const [dr, dc] of shuffle([[0, 1], [1, 0], [0, -1], [-1, 0]])) {
      let r = isl[a].r + dr, c = isl[a].c + dc;
      const path = [];
      while (r >= 0 && r < n && c >= 0 && c < n && occ[r * n + c] === HS_EMPTY) {
        path.push(r * n + c); r += dr; c += dc;
      }
      if (r < 0 || r >= n || c < 0 || c >= n || occ[r * n + c] !== HS_ISLAND) continue;
      const b = index.get(r * n + c);
      const key = Math.min(a, b) + "," + Math.max(a, b);
      if (linked.has(key) || Math.random() >= cfg.pExtra) continue;
      linked.add(key);
      for (const i of path) occ[i] = dr ? HS_BRIDGE_V : HS_BRIDGE_H;
      bridges.push({a, b, w: weight()});
    }
  }

  /* renumber in reading order, which is the order the counter walks */
  const order = [...isl.keys()].sort((p, q) => (isl[p].r * n + isl[p].c) - (isl[q].r * n + isl[q].c));
  const renum = new Int16Array(isl.length);
  order.forEach((old, i) => { renum[old] = i; });
  const islands = order.map(old => ({r: isl[old].r, c: isl[old].c, k: 0}));
  const laid = bridges.map(({a, b, w}) => ({a: renum[a], b: renum[b], w}));
  for (const {a, b, w} of laid) { islands[a].k += w; islands[b].k += w; }
  return {islands, laid};
}

function makeHashi(level) {
  const cfg = HASHI_CFG[level];
  const n = cfg.n;
  for (let attempt = 0; attempt < 400; attempt++) {
    const layout = hashiLayout(cfg);
    if (!layout) continue;
    const {islands, laid} = layout;
    const edges = hashiEdges(islands, n);
    const solution = new Uint8Array(edges.length);
    const edgeOf = new Map(edges.map((e, k) => [e.a + "," + e.b, k]));
    for (const {a, b, w} of laid) solution[edgeOf.get(Math.min(a, b) + "," + Math.max(a, b))] = w;
    const puz = {kind: "hashi", n, islands, edges, solution};
    puz.cross = hashiCrossings(edges, n);

    const res = hashiSolve(puz, cfg.tier);
    if (!res.solved || res.tierUsed < (cfg.needsTier || 0)) continue;
    if (res.lo.some((v, e) => v !== solution[e])) continue;
    const check = countHashiSolutions(puz, 2);
    if (check.aborted || check.count !== 1) continue;
    puz.tierUsed = res.tierUsed;
    return puz;
  }
  return null;
}

/* ============================================================
   Puzzle creation
   ============================================================ */

/* Which generator family builds each type. script.js keeps the same value in
   TYPES[type].family for the renderers. */
const TYPE_FAMILY = {
  sudoku9: "sudoku", sudoku6: "sudoku", diagonal: "sudoku", jigsaw: "sudoku",
  kropki: "kropki", killer: "killer", futoshiki: "futoshiki", kakuro: "kakuro",
  nonogram: "nonogram", skyscrapers: "skyscrapers", hitori: "hitori", hashi: "hashi"
};

function buildOne(type, level, symmetric) {
  const fam = TYPE_FAMILY[type];
  if (fam === "sudoku") {
    const r = makePuzzle(type, level, symmetric);
    return r ? {kind: fam, spec: r.spec, puz: r.puz, solution: r.solution} : null;
  }
  if (fam === "kropki") {
    const r = makeKropki(level);
    return r ? {kind: fam, spec: r.spec, puz: r.puz, solution: r.solution, dots: r.dots} : null;
  }
  if (fam === "killer") {
    const r = makeKiller(level);
    return r ? {kind: fam, spec: r.spec, puz: r.puz, solution: r.solution, cages: r.cages, cageOf: r.cageOf} : null;
  }
  if (fam === "skyscrapers") {
    const r = makeSkyscrapers(level);
    return r ? {kind: fam, spec: r.spec, puzzle: r.puzzle, solution: r.solution, clues: r.clues} : null;
  }
  if (fam === "futoshiki") {
    const r = makeFutoshiki(level);
    return r ? {kind: fam, spec: r.spec, puzzle: r.puzzle, solution: r.solution, cons: r.cons} : null;
  }
  if (fam === "kakuro") {
    const r = makeKakuro(level);
    return r ? {kind: fam, size: r.size, black: r.black, runs: r.runs, solution: r.solution} : null;
  }
  if (fam === "hashi") {
    const r = makeHashi(level);
    return r ? {kind: fam, n: r.n, islands: r.islands, edges: r.edges, solution: r.solution} : null;
  }
  if (fam === "nonogram") {
    const r = makeNonogram(level);
    return r ? {kind: fam, n: r.n, fill: r.fill, rowClues: r.rowClues, colClues: r.colClues} : null;
  }
  const r = makeHitori(level);
  return r ? {kind: fam, n: r.n, values: r.values, shaded: r.shaded} : null;
}
