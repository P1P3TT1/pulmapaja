"use strict";

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
  if (kind === "futoshiki"){ n = 5; }
  if (kind === "futoshiki6"){ n = 6; }

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






/* independent solution counting, does not use the logic solver */
function countSolutions(spec, puzzle, limit, extraOk) {
  const {N, n, peers} = spec;
  const v = Uint8Array.from(puzzle);
  let count = 0, steps = 0;
  function go() {
    if (++steps > 2000000) return true;
    let best = -1, bestMask = 0, bestN = n + 1;
    for (let i = 0; i < N; i++) {
      if (v[i]) continue;
      let used = 0;
      for (const p of peers[i]) if (v[p]) used |= bitOf(v[p]);
      const mask = ((1 << n) - 1) & ~used;
      const c = popcount(mask);
      if (c === 0) return false;
      if (c < bestN) { bestN = c; best = i; bestMask = mask; if (c === 1) break; }
    }
    if (best === -1) { count++; return count >= limit; }
    for (let d = 1; d <= n; d++) {
      if (!(bestMask & bitOf(d))) continue;
      v[best] = d;
      if ((!extraOk || extraOk(v, best, d)) && go()) return true;
      v[best] = 0;
    }
    return false;
  }
  go();
  return count;
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
   to guard the propagator above against silently under-constraining */
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

  let count = 0, steps = 0;
  function go() {
    if (++steps > 2000000) return true;
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
    if (countKropkiSolutions(spec, dots, new Uint8Array(spec.N), 2) !== 1) continue;

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

function makeNonogram(level) {
  const cfg = NONOGRAM_CFG[level];
  const n = cfg.n;
  for (let attempt = 0; attempt < 400; attempt++) {
    const fill = nonogramPattern(n, cfg);
    const {rows, cols} = nonogramClues(fill, n);

    /* A blank line reads as padding rather than picture, and a completely
       full one hands the solver a free row. Capping how many numbers a line
       may carry also fixes how wide the clue margins can get, which is what
       keeps a puzzle inside its share of the page. Checked before solving,
       since it is much the cheaper test. */
    let blank = 0, full = 0, widest = 0;
    for (const c of rows.concat(cols)) {
      if (!c.length) blank++;
      else if (c.length === 1 && c[0] === n) full++;
      if (c.length > widest) widest = c.length;
    }
    if (blank || full > cfg.maxFull || widest > cfg.maxClues) continue;

    const res = nonogramSolve(rows, cols, n);

    /* Accepted only when the line logic finishes on its own. Every deduction
       it makes is forced, and the pattern is a valid solution, so a complete
       solve is also proof that the solution is the only one. */
    if (!res || res.unknown) continue;
    if (res.rounds < (cfg.minRounds || 0)) continue;
    if (res.rounds > (cfg.maxRounds || 999)) continue;

    /* independent check that the solver landed on the pattern it was given */
    let same = true;
    for (let i = 0; i < n * n; i++) {
      if ((res.grid[i] === NG_FILL) !== !!fill[i]) { same = false; break; }
    }
    if (!same) continue;

    return {n, fill, rowClues: rows, colClues: cols};
  }
  return null;
}

/* ============================================================
   Type-specific data
   ============================================================ */

const TYPES = {
  sudoku9: {name: "Sudoku 9 × 9", family: "sudoku", symmetry: true,
    rules: "Täytä ruudukko luvuilla 1–9 niin, että jokaisella rivillä, sarakkeessa ja 3 × 3 -lohkossa on kukin luku täsmälleen kerran.",
    cell: {1: "18mm", 2: "11.6mm", 4: "8.8mm", sol: "7.2mm"}},
  sudoku6: {name: "Sudoku 6 × 6", family: "sudoku", symmetry: true,
    rules: "Täytä ruudukko luvuilla 1–6 niin, että jokaisella rivillä, sarakkeessa ja 3 × 2 -lohkossa on kukin luku täsmälleen kerran.",
    cell: {1: "24mm", 2: "16mm", 4: "12mm", sol: "9mm"}},
  diagonal: {name: "Diagonaalisudoku", family: "sudoku", symmetry: true,
    rules: "Kuten tavallinen sudoku, mutta myös kummallakin lävistäjällä on oltava kaikki luvut 1–9. Lävistäjät on merkitty harmaalla.",
    cell: {1: "18mm", 2: "11.6mm", 4: "8.8mm", sol: "7.2mm"}},
  jigsaw: {name: "Palapelisudoku", family: "sudoku", symmetry: true,
    rules: "Kuten tavallinen sudoku, mutta lohkot ovat epäsäännöllisen muotoisia. Jokaisessa lohkossa on luvut 1–9 kerran.",
    cell: {1: "18mm", 2: "11.6mm", 4: "8.8mm", sol: "7.2mm"}},
  kropki: {name: "Kropki-sudoku", family: "kropki", symmetry: false,
    rules: "Täytä ruudukko luvuilla 1–9 niin, että jokaisella rivillä, sarakkeessa ja 3 × 3 -lohkossa on kukin luku täsmälleen kerran. Musta pallo vierekkäisten ruutujen välissä tarkoittaa, että toinen luvuista on kaksinkertainen toiseen nähden. Valkoinen pallo tarkoittaa, että luvut ovat peräkkäisiä. Jos ruutujen välissä ei ole palloa, kumpikaan ehto ei täyty – myös pallon puuttuminen on siis vihje. Luvut 1 ja 2 täyttävät molemmat ehdot, ja niiden välissä on musta-valkoinen yhdistelmäpallo.",
    cell: {1: "18mm", 2: "11.6mm", 4: "8.8mm", sol: "7.2mm"}},
  futoshiki: {name: "Futoshiki", family: "futoshiki", symmetry: false,
    rules: "Täytä ruudukko luvuilla 1–n niin, että kullakin rivillä ja sarakkeessa on kukin luku kerran. Ruutujen väliset merkit kertovat, kumpi luku on suurempi.",
    cell: {1: "20mm", 2: "12mm", 4: "9mm", sol: "8mm"}},
  kakuro: {name: "Kakuro", family: "kakuro", symmetry: false,
    rules: "Täytä valkoiset ruudut luvuilla 1–9. Jokaisen vaaka- ja pystyjonon summa on merkitty mustaan ruutuun, eikä sama luku saa toistua samassa jonossa.",
    cell: {1: "16mm", 2: "10mm", 4: "8mm", sol: "6.5mm"}},
  nonogram: {name: "Nonogrammi", family: "nonogram", symmetry: false,
    rules: "Väritä ruutuja niin, että kunkin rivin ja sarakkeen värjätyt jaksot vastaavat sen reunaan merkittyjä lukuja. Luvut kertovat järjestyksessä, montako ruutua kussakin yhtenäisessä jaksossa on, ja jaksojen välissä on ainakin yksi värjäämätön ruutu. Nolla tarkoittaa, ettei rivillä ole yhtään värjättyä ruutua. Valmis ruudukko muodostaa kuvion.",
    cell: {1: "9mm", 2: "6mm", 4: "4.5mm", sol: "4mm"},
    /* the grid doubles from 10 to 20 across the levels, far more than any
       other type, so each level gets its own sizes rather than squeezing
       the small ones to fit the large one */
    cellByLevel: {
      easy:   {1: "12.9mm", 2: "8.6mm", 4: "6.4mm", sol: "7mm"},
      medium: {1: "9.7mm",  2: "6.2mm", 4: "4.3mm", sol: "4.8mm"},
      hard:   {1: "7.3mm",  2: "4.8mm", 4: "3.4mm", sol: "3.6mm"}
    }},
  hitori: {name: "Hitori", family: "hitori", symmetry: false,
    rules: "Väritä ruutuja niin, ettei millään rivillä tai sarakkeessa ole samaa lukua kahdesti värittämättömissä ruuduissa. Värjätyt ruudut eivät saa koskettaa toisiaan sivuistaan, ja värjäämättömien on muodostettava yhtenäinen alue.",
    cell: {1: "20mm", 2: "13mm", 4: "10mm", sol: "8mm"}}
};

const LEVEL_LABEL = {easy: "helppo", medium: "keskitaso", hard: "vaikea"};

/* ============================================================
   Rendering
   ============================================================ */

function cellEl(text, cls) {
  const d = document.createElement("div");
  d.className = "cell" + (cls ? " " + cls : "");
  if (text) d.textContent = text;
  return d;
}

function renderSudoku(item, isSolution) {
  const spec = item.spec, n = spec.n;
  const values = isSolution ? item.solution : item.puz;
  const g = document.createElement("div");
  g.className = "grid" + (isSolution ? " solution" : "");
  g.style.gridTemplateColumns = `repeat(${n}, var(--cell))`;
  g.setAttribute("role", "img");
  g.setAttribute("aria-label", isSolution ? "Ratkaisu" : "Tehtäväruudukko");

  const regionOf = new Int8Array(n * n).fill(-1);
  for (const u of spec.units) {
    if (u.kind !== "region") continue;
    const id = Math.max(...[...regionOf]) + 1;
    for (const i of u.cells) regionOf[i] = id;
  }
  const diag = new Uint8Array(n * n);
  if (spec.diagonals) for (let k = 0; k < n; k++) { diag[k * n + k] = 1; diag[k * n + (n - 1 - k)] = 1; }

  for (let i = 0; i < n * n; i++) {
    const el = cellEl(values[i] ? String(values[i]) : "");
    if (diag[i]) el.style.background = "#EDEDED";
    g.appendChild(el);
  }
  g.appendChild(gridLines(n, (a, b) => regionOf[a] !== regionOf[b]));
  return g;
}

/* Grid lines are drawn as two overlaid paths instead of as cell borders. A
   border sits inside its own cell, so a thin and a thick one along the same
   grid line end up aligned to the cell edge rather than to each other -- in a
   jigsaw, where one line changes weight partway along, that shows up as a
   sideways step. Strokes straddle the line they are on, so both weights share
   a centre line, and one path per weight keeps each run a single shape. */
function gridLines(n, isDivider) {
  const thin = [], thick = [];
  const add = (heavy, x1, y1, x2, y2) =>
    (heavy ? thick : thin).push(`M${x1} ${y1}L${x2} ${y2}`);

  for (let c = 0; c < n - 1; c++) {
    for (let r = 0; r < n; ) {
      const heavy = isDivider(r * n + c, r * n + c + 1);
      let e = r;
      while (e + 1 < n && isDivider((e + 1) * n + c, (e + 1) * n + c + 1) === heavy) e++;
      add(heavy, c + 1, r, c + 1, e + 1);
      r = e + 1;
    }
  }
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n; ) {
      const heavy = isDivider(r * n + c, (r + 1) * n + c);
      let e = c;
      while (e + 1 < n && isDivider(r * n + e + 1, (r + 1) * n + e + 1) === heavy) e++;
      add(heavy, c, r + 1, e + 1, r + 1);
      c = e + 1;
    }
  }

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "glines");
  svg.setAttribute("viewBox", `0 0 ${n} ${n}`);
  svg.setAttribute("preserveAspectRatio", "none");
  for (const [cls, d] of [["thin", thin.join("")], ["thick", thick.join("")]]) {
    if (!d) continue;
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("class", cls);
    p.setAttribute("d", d);
    svg.appendChild(p);
  }
  return svg;
}

function kropkiDotMark(cx, cy, type) {
  const R = 0.13;
  const svgEl = t => document.createElementNS("http://www.w3.org/2000/svg", t);
  const disc = cls => {
    const c = svgEl("circle");
    c.setAttribute("cx", cx); c.setAttribute("cy", cy); c.setAttribute("r", R);
    c.setAttribute("class", "kdot " + cls);
    return c;
  };
  if (type !== "both") return disc(type);

  /* Half black, half white. The black half is filled without a stroke, so
     the flat side stays a clean edge instead of a stroked chord, and the
     outline is drawn last to keep the ring unbroken around both halves. */
  const grp = svgEl("g");
  const half = svgEl("path");
  half.setAttribute("d", `M ${cx} ${cy - R} A ${R} ${R} 0 0 1 ${cx} ${cy + R} Z`);
  half.setAttribute("class", "kdot half");
  grp.appendChild(disc("white"));
  grp.appendChild(half);
  grp.appendChild(disc("ring"));
  return grp;
}

function renderKropki(item, isSolution) {
  const g = renderSudoku(item, isSolution);
  g.setAttribute("aria-label", isSolution ? "Ratkaisu" : "Kropki-sudoku-tehtävä");
  const n = item.spec.n;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "kdots");
  svg.setAttribute("viewBox", `0 0 ${n} ${n}`);
  svg.setAttribute("preserveAspectRatio", "none");
  for (const {a, b, type} of item.dots) {
    if (type === "none") continue;
    const r = (a / n) | 0, c = a % n, horiz = b === a + 1;
    const cx = horiz ? c + 1 : c + 0.5;
    const cy = horiz ? r + 0.5 : r + 1;
    svg.appendChild(kropkiDotMark(cx, cy, type));
  }
  g.appendChild(svg);
  return g;
}

function renderFutoshiki(item, isSolution) {
  const n = item.spec.n;
  const values = isSolution ? item.solution : item.puzzle;
  const g = document.createElement("div");
  g.className = "fgrid";
  g.style.gridTemplateColumns = `repeat(${n - 1}, var(--cell) var(--gap)) var(--cell)`;
  g.setAttribute("role", "img");
  g.setAttribute("aria-label", isSolution ? "Ratkaisu" : "Futoshiki-tehtävä");

  const h = new Map(), v = new Map();
  for (const con of item.cons) {
    const key = con.lo;
    if (con.dir === "h") h.set(key, con.a === con.lo ? "<" : ">");
    else v.set(key, con.a === con.lo ? "\u2227" : "\u2228");
  }

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const i = r * n + c;
      g.appendChild(cellEl(values[i] ? String(values[i]) : ""));
      if (c < n - 1) {
        const d = document.createElement("div");
        d.className = "gap h";
        d.textContent = h.get(i) || "";
        g.appendChild(d);
      }
    }
    if (r < n - 1) {
      for (let c = 0; c < n; c++) {
        const i = r * n + c;
        const d = document.createElement("div");
        d.className = "gap v";
        d.textContent = v.get(i) || "";
        g.appendChild(d);
        if (c < n - 1) {
          const x = document.createElement("div");
          x.className = "gap x";
          g.appendChild(x);
        }
      }
    }
  }
  return g;
}

function renderKakuro(item, isSolution) {
  const size = item.size;
  const g = document.createElement("div");
  g.className = "kgrid";
  g.style.gridTemplateColumns = `repeat(${size}, var(--cell))`;
  g.setAttribute("role", "img");
  g.setAttribute("aria-label", isSolution ? "Ratkaisu" : "Kakuro-tehtävä");

  const acrossAt = new Map(), downAt = new Map();
  for (const run of item.runs) {
    if (run.dir === "h") acrossAt.set(run.clue, run.sum);
    else downAt.set(run.clue, run.sum);
  }

  for (let i = 0; i < size * size; i++) {
    const r = (i / size) | 0, c = i % size;
    const cls = [];
    if (c === size - 1) cls.push("edge-r");
    if (r === size - 1) cls.push("edge-b");
    if (item.black[i]) {
      cls.push("black");
      const el = cellEl("", cls.join(" "));
      const a = acrossAt.get(i), d = downAt.get(i);
      if (a || d) {
        const line = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        line.setAttribute("class", "diag");
        line.setAttribute("viewBox", "0 0 100 100");
        line.setAttribute("preserveAspectRatio", "none");
        line.innerHTML = '<line x1="0" y1="0" x2="100" y2="100" stroke="#000" stroke-width="2.5"/>';
        el.appendChild(line);
      }
      if (a) { const s = document.createElement("span"); s.className = "across"; s.textContent = a; el.appendChild(s); }
      if (d) { const s = document.createElement("span"); s.className = "down"; s.textContent = d; el.appendChild(s); }
      g.appendChild(el);
    } else {
      g.appendChild(cellEl(isSolution ? String(item.solution[i]) : "", cls.join(" ")));
    }
  }
  return g;
}

function renderHitori(item, isSolution) {
  const n = item.n;
  const g = document.createElement("div");
  g.className = "hgrid";
  g.style.gridTemplateColumns = `repeat(${n}, var(--cell))`;
  g.setAttribute("role", "img");
  g.setAttribute("aria-label", isSolution ? "Ratkaisu" : "Hitori-tehtävä");
  for (let i = 0; i < n * n; i++) {
    const r = (i / n) | 0, c = i % n;
    const cls = [];
    if (c === n - 1) cls.push("edge-r");
    if (r === n - 1) cls.push("edge-b");
    if (isSolution && item.shaded[i] === BLACK) cls.push("shaded");
    g.appendChild(cellEl(String(item.values[i]), cls.join(" ")));
  }
  return g;
}

function nonogramClueCell(nums) {
  const d = document.createElement("div");
  d.className = "clue";
  for (const v of (nums.length ? nums : [0])) {
    const s = document.createElement("span");
    s.textContent = String(v);
    d.appendChild(s);
  }
  return d;
}

function renderNonogram(item, isSolution) {
  const n = item.n;
  const play = document.createElement("div");
  play.className = "grid" + (isSolution ? " solution" : "");
  play.style.gridTemplateColumns = `repeat(${n}, var(--cell))`;
  for (let i = 0; i < n * n; i++) {
    play.appendChild(cellEl("", isSolution && item.fill[i] ? "filled" : ""));
  }
  /* heavier rule every five cells, so long runs stay countable by eye */
  play.appendChild(gridLines(n, (a, b) => b === a + 1
    ? (a % n + 1) % 5 === 0
    : (((a / n) | 0) + 1) % 5 === 0));

  /* the solution is the picture itself -- the clues add nothing there, and
     leaving them off keeps the solution sheets compact */
  if (isSolution) {
    play.setAttribute("role", "img");
    play.setAttribute("aria-label", "Ratkaisu");
    return play;
  }

  const wrap = document.createElement("div");
  wrap.className = "ngram";
  wrap.setAttribute("role", "img");
  wrap.setAttribute("aria-label", "Nonogrammi-tehtävä");

  const corner = document.createElement("div");
  const cols = document.createElement("div");
  cols.className = "ngram-cols";
  cols.style.gridTemplateColumns = `repeat(${n}, var(--cell))`;
  for (const nums of item.colClues) cols.appendChild(nonogramClueCell(nums));
  const rows = document.createElement("div");
  rows.className = "ngram-rows";
  rows.style.gridTemplateRows = `repeat(${n}, var(--cell))`;
  for (const nums of item.rowClues) rows.appendChild(nonogramClueCell(nums));

  wrap.append(corner, cols, rows, play);
  return wrap;
}

const RENDER = {sudoku: renderSudoku, kropki: renderKropki, futoshiki: renderFutoshiki, kakuro: renderKakuro, hitori: renderHitori, nonogram: renderNonogram};

/* ============================================================
   Puzzle creation
   ============================================================ */

function buildOne(type, level, symmetric) {
  const fam = TYPES[type].family;
  if (fam === "sudoku") {
    const r = makePuzzle(type, level, symmetric);
    return r ? {kind: fam, spec: r.spec, puz: r.puz, solution: r.solution} : null;
  }
  if (fam === "kropki") {
    const r = makeKropki(level);
    return r ? {kind: fam, spec: r.spec, puz: r.puz, solution: r.solution, dots: r.dots} : null;
  }
  if (fam === "futoshiki") {
    const r = makeFutoshiki(level);
    return r ? {kind: fam, spec: r.spec, puzzle: r.puzzle, solution: r.solution, cons: r.cons} : null;
  }
  if (fam === "kakuro") {
    const r = makeKakuro(level);
    return r ? {kind: fam, size: r.size, black: r.black, runs: r.runs, solution: r.solution} : null;
  }
  if (fam === "nonogram") {
    const r = makeNonogram(level);
    return r ? {kind: fam, n: r.n, fill: r.fill, rowClues: r.rowClues, colClues: r.colClues} : null;
  }
  const r = makeHitori(level);
  return r ? {kind: fam, n: r.n, values: r.values, shaded: r.shaded} : null;
}

/* ============================================================
   User interface
   ============================================================ */

const el = id => document.getElementById(id);
const state = {type: "sudoku9", level: "easy", layout: 2, count: 4};

function bindSegment(id, key, cast) {
  el(id).addEventListener("click", e => {
    const btn = e.target.closest("button");
    if (!btn) return;
    [...e.currentTarget.children].forEach(b => b.setAttribute("aria-pressed", String(b === btn)));
    state[key] = cast(btn.dataset.value);
  });
}
bindSegment("seg-level", "level", v => v);
bindSegment("seg-layout", "layout", v => parseInt(v, 10));

function syncType() {
  state.type = el("type").value;
  const t = TYPES[state.type];
  el("rules").textContent = t.rules;
  el("title").placeholder = t.name;
  const wrap = el("sym-wrap");
  el("opt-symmetry").disabled = !t.symmetry;
  wrap.classList.toggle("off", !t.symmetry);
}
el("type").addEventListener("change", syncType);
syncType();

const countInput = el("count");
function clampCount() {
  let n = parseInt(countInput.value, 10);
  if (!Number.isFinite(n)) n = 1;
  n = Math.min(24, Math.max(1, n));
  countInput.value = n;
  state.count = n;
}
countInput.addEventListener("change", clampCount);
el("plus").addEventListener("click", () => { countInput.value = (parseInt(countInput.value, 10) || 0) + 1; clampCount(); });
el("minus").addEventListener("click", () => { countInput.value = (parseInt(countInput.value, 10) || 2) - 1; clampCount(); });

function buildSheet(title, level, layout, items, pageNo, pageTotal, isSolution, type) {
  const t = TYPES[type];
  const sheet = document.createElement("section");
  sheet.className = "sheet";

  const head = document.createElement("header");
  head.className = "sheet-head";
  head.innerHTML = '<h2></h2><span class="tag"></span>';
  head.querySelector("h2").textContent = title;
  head.querySelector(".tag").textContent = LEVEL_LABEL[level];
  sheet.appendChild(head);

  const body = document.createElement("div");
  body.className = "sheet-body";
  const cols = layout >= 4 ? 2 : 1;
  body.dataset.cols = String(cols);
  body.dataset.rows = String(layout / cols);
  /* A type whose grid size changes a lot between levels can give its own
     table per level; everything else keeps one table for all of them. */
  const table = (t.cellByLevel && t.cellByLevel[level]) || t.cell;
  const size = isSolution ? table.sol : table[layout];
  body.style.setProperty("--cell", size);
  body.style.setProperty("--gap", `calc(${size} * 0.42)`);

  for (const item of items) {
    const art = document.createElement("article");
    art.className = "puzzle";
    const h = document.createElement("h3");
    h.textContent = (isSolution ? "Ratkaisu " : "Nro ") + item.number;
    art.appendChild(h);
    art.appendChild(RENDER[item.data.kind](item.data, isSolution));
    body.appendChild(art);
  }
  sheet.appendChild(body);

  const foot = document.createElement("div");
  foot.className = "sheet-foot";
  foot.innerHTML = "<span></span><span></span>";
  foot.children[0].textContent = "Pulmapaja";
  foot.children[1].textContent = pageNo + "/" + pageTotal;
  sheet.appendChild(foot);
  return sheet;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const statusEl = el("status");
const previewEl = el("preview");
const generateBtn = el("generate");
const printBtn = el("print");
const idle = () => new Promise(r => setTimeout(r, 0));

async function generate() {
  clampCount();
  const {type, level, layout, count} = state;
  const t = TYPES[type];
  const symmetric = t.symmetry && el("opt-symmetry").checked;
  const withSolutions = el("opt-solutions").checked;
  const title = el("title").value.trim() || t.name;

  generateBtn.disabled = true;
  printBtn.disabled = true;
  previewEl.innerHTML = "";
  statusEl.textContent = "Luodaan tehtäviä…";
  await idle();

  const items = [];
  let failed = 0;
  for (let n = 1; n <= count; n++) {
    statusEl.textContent = `Luodaan tehtäviä… ${n}/${count}`;
    await idle();
    const data = buildOne(type, level, symmetric);
    if (!data) { failed++; continue; }
    items.push({number: items.length + 1, data});
  }

  if (!items.length) {
    statusEl.textContent = "Tehtävien luonti ei onnistunut. Yritä uudelleen.";
    generateBtn.disabled = false;
    return;
  }

  const pages = chunk(items, layout);
  const solPages = withSolutions ? chunk(items, 6) : [];
  const total = pages.length + solPages.length;

  const frag = document.createDocumentFragment();
  let page = 0;
  pages.forEach(group => {
    page++;
    frag.appendChild(buildSheet(title, level, layout, group, page, total, false, type));
  });
  solPages.forEach(group => {
    page++;
    frag.appendChild(buildSheet(title + " – ratkaisut", level, 6, group, page, total, true, type));
  });
  previewEl.appendChild(frag);

  statusEl.textContent = `${items.length} tehtävää, ${total} sivua.` + (failed ? ` ${failed} ei syntynyt.` : "");
  generateBtn.disabled = false;
  printBtn.disabled = false;
  window.scrollTo({top: 0, behavior: "smooth"});
}

generateBtn.addEventListener("click", () => { generate(); });
printBtn.addEventListener("click", () => window.print());