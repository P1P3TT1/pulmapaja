"use strict";

/* Puzzle codes. A whole puzzle, optionally with the player's progress, packs
   into a short base64url string that works after # in a link.

     byte 0     format version, currently 1
     byte 1     flags: type (bits 0–3) | level (bits 4–5) | hasProgress (bit 6)
     bytes 2…   body, bit-packed MSB-first, zero-padded to a byte, scrambled
     last byte  checksum over [byte 0, byte 1, …plain body]

   The body stores what the clues are derived from, never the clues, and
   decoding rebuilds them with the generators' own functions, so a code can
   never contradict itself. Layouts per type are in docs/ratkaise-ruudulla.md
   §4. Never change a layout without bumping the version, and keep the
   decoders of every older version: a saved code must keep opening.

   Nothing here touches the DOM when the file loads, so tests/run.js can load
   it into a node:vm context next to generators.js. */

const CODE_FORMAT = 1;
const CODE_TYPE_IDS = {sudoku9: 1, sudoku6: 2, diagonal: 3, jigsaw: 4, kropki: 5, killer: 6,
  futoshiki: 7, skyscrapers: 8, kakuro: 9, hitori: 10, hashi: 11, nonogram: 12};
const CODE_ID_TYPES = Object.fromEntries(Object.entries(CODE_TYPE_IDS).map(([t, id]) => [id, t]));
/* "none" is a nonogram built from a picture, which has no difficulty level */
const CODE_LEVELS = ["easy", "medium", "hard", "none"];
/* No code is shorter: the smallest is an easy hashi (7 × 7 grid, at least 10
   islands, so at least 9 edges) at 12 bytes. A link's hash is taken for a
   code from this length on; tests/run.js checks every generated code. */
const CODE_MIN_LENGTH = 16;

const CODE_MSG = {
  empty: "Liitä ensin koodi.",
  chars: "Koodissa on merkkejä, jotka eivät kuulu siihen. Tarkista, että kopioit koko koodin.",
  short: "Koodi on liian lyhyt. Siitä puuttuu osa.",
  version: v => `Koodi on tehty uudemmalla versiolla (${v}). Päivitä sovellus.`,
  type: "Koodi on pulmatyyppiä, jota tämä versio ei tunne.",
  damaged: "Koodi on vaurioitunut tai siitä puuttuu merkkejä. Kopioi se uudelleen.",
  invalid: "Koodin ratkaisu ei ole kelvollinen."
};

/* ============================================================
   Primitives – copied unchanged from docs/reference/ratkaisutila-preview.html,
   so codes made by the reference keep decoding.
   ============================================================ */

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

class BitWriter {
  constructor(){ this.bytes = []; this.acc = 0; this.n = 0; this.bits = 0; }
  write(v, bits){
    this.bits += bits;
    for (let b = bits - 1; b >= 0; b--) {
      this.acc = (this.acc << 1) | ((v >> b) & 1);
      if (++this.n === 8) { this.bytes.push(this.acc); this.acc = 0; this.n = 0; }
    }
  }
  finish(){ if (this.n) { this.bytes.push((this.acc << (8 - this.n)) & 255); this.acc = 0; this.n = 0; } return this.bytes; }
}
class BitReader {
  constructor(bytes){ this.b = bytes; this.p = 0; }
  read(bits){
    let v = 0;
    for (let k = 0; k < bits; k++) {
      const byte = this.b[this.p >> 3];
      if (byte === undefined) throw new Error("short");
      v = (v << 1) | ((byte >> (7 - (this.p & 7))) & 1);
      this.p++;
    }
    return v;
  }
}
function toB64(bytes){
  let s = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    if (b !== undefined) s += B64[(n >> 6) & 63];
    if (c !== undefined) s += B64[n & 63];
  }
  return s;
}
function fromB64(s){
  const out = []; let acc = 0, bits = 0;
  for (const ch of s) {
    const v = B64.indexOf(ch);
    if (v < 0) throw new Error("char");
    acc = ((acc << 6) | v) & 0xFFFF; bits += 6;
    if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 255); }
  }
  return out;
}
/* Not encryption – only keeps the solution from being readable at a glance. */
function scramble(body, header){
  let x = (0x2F6B3A1D ^ (header[0] << 8) ^ header[1]) >>> 0;
  return body.map(b => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return b ^ (x & 255); });
}
function checksum(bytes){
  let h = 0x3C;
  for (const b of bytes) h = ((((h << 3) | (h >>> 5)) & 255) ^ b);
  return h;
}

/* ============================================================
   Per-type layout
   ============================================================ */

/* Which input a type uses on screen, and so how its progress is stored. */
function codeController(type) {
  if (type === "hitori" || type === "nonogram") return "shading";
  if (type === "hashi") return "bridges";
  return "digits";
}

/* The digit range of a digit type: notes take this many bits. */
function codeDigitRange(item) {
  return item.kind === "kakuro" ? 9 : item.spec.n;
}

/* The cells a player can write in: not a given, not a kakuro black cell. */
function codeEditable(item) {
  const out = [];
  if (item.kind === "kakuro") {
    for (let i = 0; i < item.black.length; i++) if (!item.black[i]) out.push(i);
    return out;
  }
  const puz = item.puz || item.puzzle;
  for (let i = 0; i < puz.length; i++) if (!puz[i]) out.push(i);
  return out;
}

/* Empty progress of the right shape for an item. Digit progress keeps every
   cell, givens included, so it can be drawn in place of item.puz. */
function emptyProgress(type, item) {
  const ctl = codeController(type);
  if (ctl === "bridges") return {bridges: new Uint8Array(item.edges.length)};
  if (ctl === "shading") return {marks: new Uint8Array(item.n * item.n)};
  const N = item.kind === "kakuro" ? item.size * item.size : item.spec.N;
  const val = new Uint8Array(N);
  if (item.kind !== "kakuro") {
    const puz = item.puz || item.puzzle;
    for (let i = 0; i < N; i++) val[i] = puz[i];
  }
  return {val, notes: new Uint16Array(N)};
}

const codeRead = (r, bits, max) => {
  const v = r.read(bits);
  if (max !== undefined && v > max) throw new CodeInvalid();
  return v;
};
class CodeInvalid extends Error {}

/* Each writer records the size of every segment it writes, for the
   "Mitä koodissa on" breakdown. */
function writeBody(type, item, progress, w, seg) {
  const mark = name => { seg.push([name, w.bits - seg.reduce((s, x) => s + x[1], 0)]); };
  const cells = (arr, bits, f = v => v) => { for (let i = 0; i < arr.length; i++) w.write(f(arr[i]), bits); };
  const givensOf = (puz) => { for (let i = 0; i < puz.length; i++) w.write(puz[i] ? 1 : 0, 1); };

  switch (type) {
    case "sudoku9": case "sudoku6": case "diagonal": case "kropki":
      cells(item.solution, 4); mark("solution");
      givensOf(item.puz); mark("givens");
      break;
    case "jigsaw":
      cells(item.spec.regionMap, 4); mark("regions");
      cells(item.solution, 4); mark("solution");
      givensOf(item.puz); mark("givens");
      break;
    case "killer": {
      cells(item.solution, 4); mark("solution");
      givensOf(item.puz); mark("givens");
      const k = item.cageOf;
      for (let i = 0; i < 81; i++) {
        const r = (i / 9) | 0, c = i % 9;
        const right = c < 8 && k[i] === k[i + 1], below = r < 8 && k[i] === k[i + 9];
        w.write((right ? 2 : 0) | (below ? 1 : 0), 2);
      }
      mark("cages");
      break;
    }
    case "futoshiki": {
      const n = item.spec.n;
      w.write(n - 5, 1); mark("size");
      cells(item.solution, 4); mark("solution");
      givensOf(item.puzzle); mark("givens");
      const shown = new Set(item.cons.map(c => c.lo + c.dir));
      for (const [x, , dir] of allAdjacentPairs(n)) w.write(shown.has(x + dir) ? 1 : 0, 1);
      mark("signs");
      break;
    }
    case "skyscrapers": {
      const n = item.spec.n;
      w.write(n - 3, 3); mark("size");
      cells(item.solution, 4); mark("solution");
      givensOf(item.puzzle); mark("givens");
      for (const side of SKY_SIDES) for (let k = 0; k < n; k++) w.write(item.clues[side][k] === null ? 0 : 1, 1);
      mark("clues");
      break;
    }
    case "kakuro": {
      const size = item.size;
      w.write(size - 4, 4); mark("size");
      cells(item.black, 1, v => v ? 1 : 0); mark("black");
      for (let i = 0; i < size * size; i++) if (!item.black[i]) w.write(item.solution[i], 4);
      mark("solution");
      break;
    }
    case "hitori":
      w.write(item.n - 4, 3); mark("size");
      cells(item.values, 4); mark("values");
      cells(item.shaded, 1, v => v === BLACK ? 1 : 0); mark("shaded");
      break;
    case "hashi": {
      const n = item.n;
      w.write(n, 4); mark("size");
      const at = new Uint8Array(n * n);
      for (const p of item.islands) at[p.r * n + p.c] = 1;
      cells(at, 1); mark("islands");
      cells(item.solution, 2); mark("solution");
      break;
    }
    case "nonogram":
      w.write(item.n, 6); mark("size");
      cells(item.fill, 1, v => v ? 1 : 0); mark("fill");
      break;
  }

  if (!progress) return;
  const ctl = codeController(type);
  if (ctl === "digits") {
    const ed = codeEditable(item), d = codeDigitRange(item);
    for (const i of ed) w.write(progress.val[i], 4);
    mark("entries");
    for (const i of ed) {
      if (progress.val[i]) continue;
      const has = progress.notes[i] ? 1 : 0;
      w.write(has, 1);
      if (has) w.write(progress.notes[i], d);
    }
    mark("notes");
  } else if (ctl === "shading") {
    cells(progress.marks, 2); mark("marks");
  } else {
    cells(progress.bridges, 2); mark("bridges");
  }
}

/* Every unit of a digit spec holds each digit once. */
function codeUnitsOk(spec, sol) {
  for (const u of spec.units) {
    let m = 0;
    for (const i of u.cells) {
      const d = sol[i];
      if (d < 1 || d > spec.n) return false;
      m |= bitOf(d);
    }
    if (m !== spec.FULL) return false;
  }
  return true;
}

function readCells(r, N, bits, max) {
  const out = new Uint8Array(N);
  for (let i = 0; i < N; i++) out[i] = codeRead(r, bits, max);
  return out;
}
function readGivens(r, sol) {
  const puz = new Uint8Array(sol.length);
  for (let i = 0; i < sol.length; i++) if (r.read(1)) puz[i] = sol[i];
  return puz;
}

/* Reads the puzzle part and rebuilds the item buildOne would have returned.
   Throws CodeInvalid when the content breaks the type's rules. */
function readBody(type, r) {
  switch (type) {
    case "sudoku9": case "sudoku6": case "diagonal": case "kropki": {
      const spec = buildSpec(type === "kropki" ? "sudoku9" : type);
      const solution = readCells(r, spec.N, 4);
      const puz = readGivens(r, solution);
      if (!codeUnitsOk(spec, solution)) throw new CodeInvalid();
      if (type !== "kropki") return {kind: "sudoku", spec, puz, solution};
      const dots = allAdjacentPairs(9).map(([a, b]) => ({a, b, type: kropkiDotType(solution[a], solution[b])}));
      return {kind: "kropki", spec, puz, solution, dots};
    }
    case "jigsaw": {
      const regions = Int8Array.from(readCells(r, 81, 4, 8));
      const solution = readCells(r, 81, 4);
      const puz = readGivens(r, solution);
      const sizes = new Array(9).fill(0);
      for (const k of regions) sizes[k]++;
      if (sizes.some(s => s !== 9)) throw new CodeInvalid();
      const spec = buildSpec("jigsaw", regions);
      if (!codeUnitsOk(spec, solution)) throw new CodeInvalid();
      return {kind: "sudoku", spec, puz, solution};
    }
    case "killer": {
      const spec = buildSpec("sudoku9");
      const solution = readCells(r, 81, 4);
      const puz = readGivens(r, solution);
      const joins = readCells(r, 81, 2);
      if (!codeUnitsOk(spec, solution)) throw new CodeInvalid();
      /* cages are the connected components over the joins */
      const parent = Array.from({length: 81}, (_, i) => i);
      const find = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
      for (let i = 0; i < 81; i++) {
        const c = i % 9, rr = (i / 9) | 0;
        if ((joins[i] & 2) && c === 8) throw new CodeInvalid();
        if ((joins[i] & 1) && rr === 8) throw new CodeInvalid();
        if (joins[i] & 2) parent[find(i)] = find(i + 1);
        if (joins[i] & 1) parent[find(i)] = find(i + 9);
      }
      const groups = new Map();
      for (let i = 0; i < 81; i++) {
        const root = find(i);
        if (!groups.has(root)) groups.set(root, []);
        groups.get(root).push(i);
      }
      /* cells are already in reading order, and so is the map's insertion
         order by first cell – the order killerCages returns */
      const cages = [...groups.values()].map(cells => ({cells, sum: cells.reduce((s, i) => s + solution[i], 0)}));
      const cageOf = new Int16Array(81);
      cages.forEach((cage, k) => {
        let m = 0;
        for (const i of cage.cells) {
          if (m & bitOf(solution[i])) throw new CodeInvalid();
          m |= bitOf(solution[i]);
          cageOf[i] = k;
        }
      });
      return {kind: "killer", spec, puz, solution, cages, cageOf};
    }
    case "futoshiki": {
      const n = 5 + r.read(1);
      const spec = buildSpec(n === 5 ? "futoshiki" : "futoshiki6");
      const solution = readCells(r, spec.N, 4);
      const puzzle = readGivens(r, solution);
      const cons = [];
      for (const [x, y, dir] of allAdjacentPairs(n)) {
        if (!r.read(1)) continue;
        cons.push(solution[x] < solution[y] ? {a: x, b: y, dir, lo: x} : {a: y, b: x, dir, lo: x});
      }
      if (!codeUnitsOk(spec, solution)) throw new CodeInvalid();
      return {kind: "futoshiki", spec, puzzle, solution, cons};
    }
    case "skyscrapers": {
      const n = 3 + r.read(3);
      if (n > 9) throw new CodeInvalid();
      const spec = buildSpec("latin" + n);
      const solution = readCells(r, spec.N, 4);
      const puzzle = readGivens(r, solution);
      const shown = readCells(r, 4 * n, 1);
      if (!codeUnitsOk(spec, solution)) throw new CodeInvalid();
      const clues = skyClues(solution, n);
      SKY_SIDES.forEach((side, s) => { for (let k = 0; k < n; k++) if (!shown[s * n + k]) clues[side][k] = null; });
      return {kind: "skyscrapers", spec, puzzle, solution, clues};
    }
    case "kakuro": {
      const size = 4 + r.read(4);
      const N = size * size;
      const black = readCells(r, N, 1);
      const solution = new Uint8Array(N);
      for (let i = 0; i < N; i++) if (!black[i]) solution[i] = r.read(4);
      const runs = buildRuns(black, size);
      const covered = new Uint8Array(N);
      for (const run of runs) {
        let m = 0, s = 0;
        for (const i of run.cells) {
          const d = solution[i];
          if (d < 1 || d > 9 || (m & bitOf(d))) throw new CodeInvalid();
          m |= bitOf(d); s += d; covered[i] = 1;
        }
        run.sum = s;
      }
      for (let i = 0; i < N; i++) if (!black[i] && !covered[i]) throw new CodeInvalid();
      if (!runs.length) throw new CodeInvalid();
      return {kind: "kakuro", size, black, runs, solution};
    }
    case "hitori": {
      const n = 4 + r.read(3);
      const N = n * n;
      const values = readCells(r, N, 4, n);
      const shaded = new Uint8Array(N);
      for (let i = 0; i < N; i++) shaded[i] = r.read(1) ? BLACK : WHITE;
      if (values.some(v => v < 1)) throw new CodeInvalid();
      for (let i = 0; i < N; i++) {
        if (shaded[i] === BLACK && hNeighbours(i, n).some(j => shaded[j] === BLACK)) throw new CodeInvalid();
      }
      for (let k = 0; k < n; k++) {
        let row = 0, col = 0;
        for (let t = 0; t < n; t++) {
          const a = k * n + t, b = t * n + k;
          if (shaded[a] !== BLACK) { if (row & bitOf(values[a])) throw new CodeInvalid(); row |= bitOf(values[a]); }
          if (shaded[b] !== BLACK) { if (col & bitOf(values[b])) throw new CodeInvalid(); col |= bitOf(values[b]); }
        }
      }
      if (!whitesConnected(shaded, n, false)) throw new CodeInvalid();
      return {kind: "hitori", n, values, shaded};
    }
    case "hashi": {
      const n = r.read(4);
      if (n < 2) throw new CodeInvalid();
      const at = readCells(r, n * n, 1);
      const islands = [];
      for (let i = 0; i < n * n; i++) if (at[i]) islands.push({r: (i / n) | 0, c: i % n, k: 0});
      const edges = hashiEdges(islands, n);
      const solution = readCells(r, edges.length, 2, 2);
      edges.forEach((e, k) => { islands[e.a].k += solution[k]; islands[e.b].k += solution[k]; });
      if (islands.length < 2 || islands.some(p => !p.k)) throw new CodeInvalid();
      const cross = hashiCrossings(edges, n);
      cross.forEach((list, k) => { if (solution[k] && list.some(j => solution[j])) throw new CodeInvalid(); });
      /* everything joined up */
      const seen = new Uint8Array(islands.length), stack = [0];
      seen[0] = 1;
      while (stack.length) {
        const a = stack.pop();
        edges.forEach((e, k) => {
          if (!solution[k] || (e.a !== a && e.b !== a)) return;
          const b = e.a === a ? e.b : e.a;
          if (!seen[b]) { seen[b] = 1; stack.push(b); }
        });
      }
      if (seen.some(s => !s)) throw new CodeInvalid();
      return {kind: "hashi", n, islands, edges, solution};
    }
    case "nonogram": {
      const n = r.read(6);
      if (n < 2) throw new CodeInvalid();
      const fill = readCells(r, n * n, 1);
      const {rows, cols} = nonogramClues(fill, n);
      return {kind: "nonogram", n, fill, rowClues: rows, colClues: cols};
    }
  }
  throw new CodeInvalid();
}

function readProgress(type, item, r) {
  const p = emptyProgress(type, item);
  const ctl = codeController(type);
  if (ctl === "digits") {
    const ed = codeEditable(item), d = codeDigitRange(item);
    for (const i of ed) p.val[i] = codeRead(r, 4, d);
    for (const i of ed) if (!p.val[i] && r.read(1)) p.notes[i] = r.read(d);
  } else if (ctl === "shading") {
    for (let i = 0; i < p.marks.length; i++) p.marks[i] = codeRead(r, 2, 2);
  } else {
    for (let i = 0; i < p.bridges.length; i++) p.bridges[i] = codeRead(r, 2, 2);
  }
  return p;
}

/* ============================================================
   Public API
   ============================================================ */

/* item: what buildOne (or decodeCode) returned. level: "easy", "medium",
   "hard" or "none". progress: null for a puzzle-only code, else the shape
   emptyProgress gives. Returns {code, bytes, seg} where seg lists
   [segment, bits] in order, header and checksum included. */
function encodeCode(type, level, item, progress) {
  const id = CODE_TYPE_IDS[type];
  const lv = CODE_LEVELS.indexOf(level);
  if (!id || lv < 0) throw new Error("unknown type or level");
  const w = new BitWriter(), seg = [];
  writeBody(type, item, progress || null, w, seg);
  const body = w.finish();
  const header = [CODE_FORMAT, id | (lv << 4) | (progress ? 64 : 0)];
  const chk = checksum(header.concat(body));
  return {
    code: toB64(header.concat(scramble(body, header), [chk])),
    bytes: header.length + body.length + 1,
    seg: [["header", 16], ...seg, ["padding", body.length * 8 - w.bits], ["checksum", 8]]
  };
}

/* Accepts a bare code or a whole link. Returns the item buildOne would have
   returned, plus {type, level, progress}; progress is null for a puzzle-only
   code. Throws an Error whose message the UI shows as is. */
function decodeCode(raw) {
  let code = String(raw == null ? "" : raw).trim();
  const hash = code.lastIndexOf("#");
  if (hash >= 0) code = code.slice(hash + 1);
  code = code.replace(/\s+/g, "");
  if (!code) throw new Error(CODE_MSG.empty);
  if (!/^[A-Za-z0-9_-]+$/.test(code)) throw new Error(CODE_MSG.chars);
  const bytes = fromB64(code);
  if (bytes.length < 4) throw new Error(CODE_MSG.short);
  const [ver, flags] = bytes;
  if (ver !== CODE_FORMAT) throw new Error(CODE_MSG.version(ver));
  const type = CODE_ID_TYPES[flags & 15];
  if (!type) throw new Error(CODE_MSG.type);
  const body = scramble(bytes.slice(2, -1), [ver, flags]);
  /* toB64 drops nothing, so a code that does not round-trip carries stray
     bits in its last character, or a dangling one */
  if (checksum([ver, flags].concat(body)) !== bytes[bytes.length - 1] || toB64(bytes) !== code)
    throw new Error(CODE_MSG.damaged);
  const lv = (flags >> 4) & 3, hasProgress = !!(flags & 64);
  if ((flags & 128) || (lv === 3 && type !== "nonogram")) throw new Error(CODE_MSG.damaged);

  const r = new BitReader(body);
  let item;
  try {
    item = readBody(type, r);
    item.progress = hasProgress ? readProgress(type, item, r) : null;
  } catch (e) {
    if (e instanceof CodeInvalid) throw new Error(CODE_MSG.invalid);
    throw new Error(CODE_MSG.short);
  }
  /* what is left must be the zero padding of the last byte, nothing more */
  const rest = body.length * 8 - r.p;
  if (rest >= 8 || (rest && r.read(rest))) throw new Error(CODE_MSG.damaged);
  item.type = type;
  item.level = CODE_LEVELS[lv];
  return item;
}

/* Segment sizes of a code, for debugging ("Mitä koodissa on" in the
   reference). Pass the same arguments as encodeCode. */
function codeSegments(type, level, item, progress) {
  return encodeCode(type, level, item, progress).seg;
}

if (typeof window !== "undefined") {
  window.PulmapajaCodec = {encode: encodeCode, decode: decodeCode, segments: codeSegments,
    emptyProgress, typeIds: CODE_TYPE_IDS, levels: CODE_LEVELS};
}
