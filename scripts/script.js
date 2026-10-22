"use strict";

/* Types, renderers and the print UI. The puzzle logic lives in generators.js. */

/* ============================================================
   Type-specific data
   ============================================================ */

/* The type picker's sections (docs/ui-uudistus.md §7). A type appears in
   the picker, and in the hidden <select id="type"> behind it, once it has
   a cat, a short tile label and an icon. */
const CATEGORIES = [
  {id: "sudoku",  label: "Sudokut"},
  {id: "numbers", label: "Numerot ja vertailut"},
  {id: "shading", label: "Ruutujen värittäminen"},
  {id: "connect", label: "Yhdistäminen"}
];

/* 36 × 36, stroked in the text colour with the accent in --blue, so both
   themes work. The accent is set in style attributes: an SVG presentation
   attribute cannot take var(). */
const typeIcon = body => `<svg width="34" height="34" viewBox="0 0 36 36" fill="none" stroke="currentColor" ` +
  `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICON_FRAME = '<rect x="3" y="3" width="30" height="30" rx="5" stroke-width="2.4"/>';
const ICON_GRID = '<path d="M13 3v30M23 3v30M3 13h30M3 23h30" stroke-width="1.6" stroke-linecap="butt"/>';
const iconText = (x, y, t, accent, size = 7, anchor = "middle") =>
  `<text x="${x}" y="${y}" font-size="${size}" font-family="IBM Plex Mono, monospace" font-weight="600" stroke="none" ` +
  `text-anchor="${anchor}" style="fill:${accent ? "var(--blue)" : "currentColor"}">${t}</text>`;
const TYPE_ICONS = {
  sudoku9: typeIcon(ICON_FRAME + ICON_GRID + iconText(8, 11.5, 5, true) + iconText(28, 31.5, 3, false)),
  sudoku6: typeIcon(ICON_FRAME + '<path d="M18 3v30M3 13h30M3 23h30" stroke-width="1.6" stroke-linecap="butt"/>' +
    iconText(10.5, 10.5, 6, true)),
  diagonal: typeIcon('<path d="M5 5L31 31M31 5L5 31" stroke-width="5" stroke-opacity="0.22" style="stroke:var(--blue)"/>' +
    ICON_FRAME + ICON_GRID),
  jigsaw: typeIcon(ICON_FRAME + '<path d="M3 15h8v-6h8V3M19 33V21h-6v-6M33 13h-8v14h-6" stroke-width="2" stroke-linecap="butt"/>'),
  kropki: typeIcon(ICON_FRAME + ICON_GRID + '<circle cx="13" cy="8" r="3" fill="currentColor" stroke="none"/>' +
    '<circle cx="18" cy="23" r="3" stroke-width="1.6" style="fill:var(--surface)"/>' +
    '<circle cx="23" cy="28" r="3" fill="currentColor" stroke="none"/>'),
  killer: typeIcon(ICON_FRAME + '<path d="M6 6h17v9h-8v15H6zM19 19h11v11H19z" stroke-width="1.6" stroke-dasharray="2.4 2" ' +
    'stroke-linecap="butt" stroke-linejoin="miter" style="stroke:var(--blue)"/>' + iconText(7.5, 12, 17, true, 6.5, "start")),
  futoshiki: typeIcon('<rect x="3" y="3" width="12" height="12" rx="3" stroke-width="2"/><rect x="21" y="3" width="12" height="12" rx="3" stroke-width="2"/>' +
    '<rect x="3" y="21" width="12" height="12" rx="3" stroke-width="2"/><rect x="21" y="21" width="12" height="12" rx="3" stroke-width="2"/>' +
    '<path d="M19.5 7l-3 2 3 2M7 16.5l2 3 2-3" stroke-width="2" style="stroke:var(--blue)"/>'),
  skyscrapers: typeIcon('<path d="M3 33h30" stroke-width="2.2"/><rect x="6" y="20" width="6" height="13" rx="1.2" stroke-width="2"/>' +
    '<rect x="15" y="8" width="6" height="25" rx="1.2" stroke-width="2" fill-opacity="0.18" style="fill:var(--blue);stroke:var(--blue)"/>' +
    '<rect x="24" y="14" width="6" height="19" rx="1.2" stroke-width="2"/>' + iconText(18, 5.5, 3, true, 6.5)),
  kakuro: typeIcon(ICON_FRAME + ICON_GRID + '<path d="M3 8a5 5 0 0 1 5-5h5v10H3zM23 3h5a5 5 0 0 1 5 5v5H23zM3 23h10v10H8a5 5 0 0 1-5-5z" ' +
    'fill="currentColor" stroke="none"/><path d="M13 3h10v10H13z" fill="currentColor" fill-opacity="0.85" stroke="none"/>' +
    '<path d="M13 3l10 10" stroke-width="1.2" style="stroke:var(--surface)"/>'),
  hitori: typeIcon('<path d="M13 3h10v10H13zM3 13h10v10H3zM23 23h10v5a5 5 0 0 1-5 5h-5z" fill="currentColor" stroke="none"/>' +
    ICON_FRAME + ICON_GRID + '<circle cx="28" cy="8" r="3.4" stroke-width="1.6" style="stroke:var(--blue)"/>'),
  nonogram: typeIcon('<path d="M13 12h20v7H13zM19 19h7v7h-7zM13 26h7v7h-7z" fill="currentColor" stroke="none" opacity="0.85"/>' +
    '<rect x="12" y="12" width="21" height="21" rx="3" stroke-width="2"/>' +
    '<path d="M4 15.5h5M4 22.5h3M4 29.5h3M16 3v5M22.5 3v5M29.5 3v5" stroke-width="2" style="stroke:var(--blue)"/>'),
  hashi: typeIcon('<path d="M13 6.5h11M13 10.5h11M13 29h11" stroke-width="1.8"/><path d="M8.5 13v11" stroke-width="1.8" style="stroke:var(--blue)"/>' +
    '<circle cx="8.5" cy="8.5" r="5" stroke-width="2"/><circle cx="28.5" cy="8.5" r="5" stroke-width="2"/>' +
    '<circle cx="8.5" cy="28.5" r="5" stroke-width="2"/><circle cx="28.5" cy="28.5" r="5" stroke-width="2"/>')
};

const TYPES = {
  sudoku9:{name: "Sudoku 9 × 9", family: "sudoku", symmetry: true,
    cat: "sudoku", short: "Sudoku 9 × 9", icon: TYPE_ICONS.sudoku9,
    rules: "Täytä ruudukko luvuilla 1–9 niin, että jokaisella rivillä, sarakkeessa ja 3 × 3 -lohkossa on kukin luku täsmälleen kerran.",
    cell: {1: "18mm", 2: "11.6mm", 4: "8.8mm", sol: "7.2mm"}},
  sudoku6: {name: "Sudoku 6 × 6", family: "sudoku", symmetry: true,
    cat: "sudoku", short: "Sudoku 6 × 6", icon: TYPE_ICONS.sudoku6,
    rules: "Täytä ruudukko luvuilla 1–6 niin, että jokaisella rivillä, sarakkeessa ja 3 × 2 -lohkossa on kukin luku täsmälleen kerran.",
    cell: {1: "24mm", 2: "16mm", 4: "12mm", sol: "9mm"}},
  diagonal: {name: "Diagonaalisudoku", family: "sudoku", symmetry: true,
    cat: "sudoku", short: "Diagonaali\u00ADsudoku", icon: TYPE_ICONS.diagonal,
    rules: "Kuten tavallinen sudoku, mutta myös kummallakin lävistäjällä on oltava kaikki luvut 1–9. Lävistäjät on merkitty harmaalla.",
    cell: {1: "18mm", 2: "11.6mm", 4: "8.8mm", sol: "7.2mm"}},
  jigsaw: {name: "Palapelisudoku", family: "sudoku", symmetry: true,
    cat: "sudoku", short: "Palapeli\u00ADsudoku", icon: TYPE_ICONS.jigsaw,
    rules: "Kuten tavallinen sudoku, mutta lohkot ovat epäsäännöllisen muotoisia. Jokaisessa lohkossa on luvut 1–9 kerran.",
    cell: {1: "18mm", 2: "11.6mm", 4: "8.8mm", sol: "7.2mm"}},
  kropki: {name: "Kropki-sudoku", family: "kropki", symmetry: false,
    cat: "sudoku", short: "Kropki-sudoku", icon: TYPE_ICONS.kropki,
    rules: "Täytä ruudukko luvuilla 1–9 niin, että jokaisella rivillä, sarakkeessa ja 3 × 3 -lohkossa on kukin luku täsmälleen kerran. Musta pallo vierekkäisten ruutujen välissä tarkoittaa, että toinen luvuista on kaksinkertainen toiseen nähden. Valkoinen pallo tarkoittaa, että luvut ovat peräkkäisiä. Jos ruutujen välissä ei ole palloa, kumpikaan ehto ei täyty – myös pallon puuttuminen on siis vihje. Luvut 1 ja 2 täyttävät molemmat ehdot, ja niiden välissä on musta-valkoinen yhdistelmäpallo.",
    cell: {1: "18mm", 2: "11.6mm", 4: "8.8mm", sol: "7.2mm"}},
  killer: {name: "Killer-sudoku", family: "killer", symmetry: false,
    cat: "sudoku", short: "Killer-sudoku", icon: TYPE_ICONS.killer,
    rules: "Täytä ruudukko luvuilla 1–9 niin, että jokaisella rivillä, sarakkeessa ja 3 × 3 -lohkossa on kukin luku täsmälleen kerran. Katkoviivalla rajatun alueen lukujen summa on alueen kulmaan merkitty luku, eikä sama luku saa toistua alueen sisällä.",
    cell: {1: "18mm", 2: "11.6mm", 4: "8.8mm", sol: "7.2mm"}},
  futoshiki: {name: "Futoshiki", family: "futoshiki", symmetry: false,
    cat: "numbers", short: "Futoshiki", icon: TYPE_ICONS.futoshiki,
    rules: "Täytä ruudukko luvuilla 1–n niin, että kullakin rivillä ja sarakkeessa on kukin luku kerran. Ruutujen väliset merkit kertovat, kumpi luku on suurempi.",
    cell: {1: "20mm", 2: "12mm", 4: "9mm", sol: "8mm"}},
  skyscrapers: {name: "Pilvenpiirtäjät", family: "skyscrapers", symmetry: false,
    cat: "numbers", short: "Pilven\u00ADpiirtäjät", icon: TYPE_ICONS.skyscrapers,
    rules: "Täytä ruudukko niin, että jokaisella rivillä ja sarakkeessa on kukin luku 1:stä ruudukon kokoon asti täsmälleen kerran. Luvut ovat pilvenpiirtäjien korkeuksia. Reunan luku kertoo, montako pilvenpiirtäjää näkyy, kun riviä tai saraketta katsotaan siitä suunnasta: korkeampi rakennus peittää kaikki matalammat takanaan.",
    cell: {1: "19mm", 2: "12.5mm", 4: "9.5mm", sol: "8mm"},
    /* the clue strips make the footprint n + 2 cells a side, and n grows
       from 5 to 6, so each level gets its own sizes */
    cellByLevel: {
      easy:   {1: "22mm", 2: "14mm",   4: "10.5mm", sol: "9mm"},
      medium: {1: "19mm", 2: "12.5mm", 4: "9.5mm",  sol: "8mm"},
      hard:   {1: "19mm", 2: "12.5mm", 4: "9.5mm",  sol: "8mm"}
    }},
  kakuro: {name: "Kakuro", family: "kakuro", symmetry: false,
    cat: "numbers", short: "Kakuro", icon: TYPE_ICONS.kakuro,
    rules: "Täytä valkoiset ruudut luvuilla 1–9. Jokaisen vaaka- ja pystyjonon summa on merkitty mustaan ruutuun, eikä sama luku saa toistua samassa jonossa.",
    cell: {1: "16mm", 2: "10mm", 4: "8mm", sol: "6.5mm"}},
  hitori: {name: "Hitori", family: "hitori", symmetry: false,
    cat: "shading", short: "Hitori", icon: TYPE_ICONS.hitori,
    rules: "Väritä ruutuja niin, ettei millään rivillä tai sarakkeessa ole samaa lukua kahdesti värittämättömissä ruuduissa. Värjätyt ruudut eivät saa koskettaa toisiaan sivuistaan, ja värjäämättömien on muodostettava yhtenäinen alue.",
    cell: {1: "20mm", 2: "13mm", 4: "10mm", sol: "8mm"}},
  nonogram: {name: "Nonogrammi", family: "nonogram", symmetry: false,
    cat: "shading", short: "Nonogrammi", icon: TYPE_ICONS.nonogram,
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
  hashi: {name: "Sillat", family: "hashi", symmetry: false,
    cat: "connect", short: "Sillat", icon: TYPE_ICONS.hashi,
    rules: "Yhdistä saaret silloilla. Sillat kulkevat suoraan vaaka- tai pystysuunnassa, eivätkä ne saa mennä ristiin eivätkä kulkea saaren yli. Kahden saaren välillä voi olla yksi tai kaksi siltaa. Saaren luku kertoo, montako siltaa siihen liittyy. Lopuksi kaikkien saarten on oltava yhteydessä toisiinsa siltoja pitkin.",
    cell: {1: "15mm", 2: "9mm", 4: "7.5mm", sol: "6mm"},
    /* the grid grows from 7 to 11 across the levels, so each level gets its
       own sizes */
    cellByLevel: {
      easy:   {1: "22mm", 2: "14mm", 4: "11mm",  sol: "9mm"},
      medium: {1: "18mm", 2: "11mm", 4: "9mm",   sol: "7.5mm"},
      hard:   {1: "15mm", 2: "9mm",  4: "7.5mm", sol: "6mm"}
    }}
};

const LEVEL_LABEL = {easy: "helppo", medium: "keskitaso", hard: "vaikea"};

/* Where Ratkaise ruudulla is hosted (GitHub Pages). Every printed puzzle
   gets a small QR code that opens it on screen at PLAY_BASE_URL + "#" + its
   code. Set it to "" to print without the codes. */
const PLAY_BASE_URL = "https://p1p3tt1.github.io/pulmapaja/";

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

/* Cage outlines run a little inside the cells, so they never sit on the grid
   lines. Each cell draws the sides it shares with no cage mate. A side next
   to a cage mate runs to the cell edge to meet the mate's own side, and at an
   inner corner it runs on by the inset to meet the outline coming round the
   corner. Pieces on one line are then joined, so the dashes run on along a
   straight stretch instead of restarting at every cell. */
function killerCagePath(cageOf, n, inset) {
  const runs = {h: new Map(), v: new Map()};
  const add = (dir, at, a, b) => {
    const key = at.toFixed(3);
    if (!runs[dir].has(key)) runs[dir].set(key, []);
    runs[dir].get(key).push([a, b]);
  };
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const k = cageOf[y * n + x];
      const same = (dr, dc) => {
        const r = y + dr, c = x + dc;
        return r >= 0 && r < n && c >= 0 && c < n && cageOf[r * n + c] === k;
      };
      const i = inset;
      for (const dr of [-1, 1]) {
        if (same(dr, 0)) continue;
        add("h", dr < 0 ? y + i : y + 1 - i,
          same(0, -1) ? (same(dr, -1) ? x - i : x) : x + i,
          same(0, 1) ? (same(dr, 1) ? x + 1 + i : x + 1) : x + 1 - i);
      }
      for (const dc of [-1, 1]) {
        if (same(0, dc)) continue;
        add("v", dc < 0 ? x + i : x + 1 - i,
          same(-1, 0) ? (same(-1, dc) ? y - i : y) : y + i,
          same(1, 0) ? (same(1, dc) ? y + 1 + i : y + 1) : y + 1 - i);
      }
    }
  }
  const d = [];
  const f = z => +z.toFixed(3);
  for (const dir of ["h", "v"]) {
    for (const [key, segs] of runs[dir]) {
      segs.sort((p, q) => p[0] - q[0]);
      let [a, b] = segs[0];
      const flush = () => d.push(dir === "h" ? `M${f(a)} ${key}H${f(b)}` : `M${key} ${f(a)}V${f(b)}`);
      for (const [c, e] of segs.slice(1)) {
        if (c <= b + 1e-6) { b = Math.max(b, e); continue; }
        flush();
        [a, b] = [c, e];
      }
      flush();
    }
  }
  return d.join("");
}

function renderKiller(item, isSolution) {
  const g = renderSudoku(item, isSolution);
  g.classList.add("killer");
  const n = item.spec.n;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "kcages");
  svg.setAttribute("viewBox", `0 0 ${n} ${n}`);
  svg.setAttribute("preserveAspectRatio", "none");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", killerCagePath(item.cageOf, n, 0.08));
  svg.appendChild(path);
  g.appendChild(svg);

  /* the sum sits in the cage's first cell in reading order, which is always
     an outer top-left corner of the outline; its white backing breaks the
     dashes around it */
  for (const {cells, sum} of item.cages) {
    const s = document.createElement("span");
    s.className = "ksum";
    s.textContent = String(sum);
    g.children[cells[0]].appendChild(s);
  }
  return g;
}

function renderFutoshiki(item, isSolution) {
  const n = item.spec.n;
  const values = isSolution ? item.solution : item.puzzle;
  const g = document.createElement("div");
  g.className = "fgrid";
  g.style.gridTemplateColumns = `repeat(${n - 1}, var(--cell) var(--gap)) var(--cell)`;
  g.setAttribute("role", "img");

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
    return play;
  }

  const wrap = document.createElement("div");
  wrap.className = "ngram";
  wrap.setAttribute("role", "img");

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

/* Laid out like the nonogram: the play grid in the middle, a strip of clue
   cells on each side, and empty corners. The solution keeps the clues, so the
   answer can be checked against them. */
function renderSkyscrapers(item, isSolution) {
  const n = item.spec.n;
  const values = isSolution ? item.solution : item.puzzle;
  const play = document.createElement("div");
  play.className = "grid" + (isSolution ? " solution" : "");
  play.style.gridTemplateColumns = `repeat(${n}, var(--cell))`;
  for (let i = 0; i < n * n; i++) play.appendChild(cellEl(values[i] ? String(values[i]) : ""));
  play.appendChild(gridLines(n, () => false));

  const strip = (dir, nums) => {
    const d = document.createElement("div");
    d.className = "sky-strip " + dir;
    for (const v of nums) {
      const c = document.createElement("div");
      c.className = "clue";
      if (v) c.textContent = String(v);
      d.appendChild(c);
    }
    return d;
  };
  const corner = () => document.createElement("div");

  const wrap = document.createElement("div");
  wrap.className = "sky";
  wrap.setAttribute("role", "img");
  const {top, bottom, left, right} = item.clues;
  wrap.append(corner(), strip("h", top), corner(),
              strip("v", left), play, strip("v", right),
              corner(), strip("h", bottom), corner());
  return wrap;
}

/* One SVG in cell units: faint guide dots at every cell centre so the
   bridges can be drawn straight, and the islands on top. The solution draws
   the bridges first, so the white circles cover their ends, and keeps the
   numbers so the answer can be checked against them. */
function renderHashi(item, isSolution) {
  const n = item.n;
  const svgEl = t => document.createElementNS("http://www.w3.org/2000/svg", t);
  const svg = svgEl("svg");
  svg.setAttribute("class", "hashi");
  svg.setAttribute("viewBox", `0 0 ${n} ${n}`);
  svg.style.width = svg.style.height = `calc(var(--cell) * ${n})`;
  svg.setAttribute("role", "img");

  const dots = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    dots.push(`M${c + 0.46} ${r + 0.5}a0.04 0.04 0 1 0 0.08 0a0.04 0.04 0 1 0 -0.08 0`);
  }
  const guide = svgEl("path");
  guide.setAttribute("class", "hdots");
  guide.setAttribute("d", dots.join(""));
  svg.appendChild(guide);

  if (isSolution) {
    const d = [];
    item.edges.forEach((e, k) => {
      const w = item.solution[k];
      if (!w) return;
      const p = item.islands[e.a], q = item.islands[e.b];
      for (const off of w === 2 ? [-0.11, 0.11] : [0]) {
        const dx = e.dir === "v" ? off : 0, dy = e.dir === "h" ? off : 0;
        d.push(`M${p.c + 0.5 + dx} ${p.r + 0.5 + dy}L${q.c + 0.5 + dx} ${q.r + 0.5 + dy}`);
      }
    });
    const bridges = svgEl("path");
    bridges.setAttribute("class", "hbridges");
    bridges.setAttribute("d", d.join(""));
    svg.appendChild(bridges);
  }

  for (const {r, c, k} of item.islands) {
    const circle = svgEl("circle");
    circle.setAttribute("class", "hisland");
    circle.setAttribute("cx", c + 0.5); circle.setAttribute("cy", r + 0.5); circle.setAttribute("r", 0.38);
    const text = svgEl("text");
    text.setAttribute("x", c + 0.5); text.setAttribute("y", r + 0.5);
    text.textContent = String(k);
    svg.append(circle, text);
  }
  return svg;
}

const RENDER = {sudoku: renderSudoku, kropki: renderKropki, killer: renderKiller, futoshiki: renderFutoshiki,
  kakuro: renderKakuro, hitori: renderHitori, nonogram: renderNonogram, skyscrapers: renderSkyscrapers,
  hashi: renderHashi};
/* ============================================================
   User interface
   ============================================================ */

const el = id => document.getElementById(id);

/* Inline icons for buttons built in script: 24 × 24, stroked in the text
   colour. Icons in the markup are written out there. */
const svgIcon = (body, w = 2) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
  `stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICON = {
  chevron: svgIcon('<path d="M9 6l6 6-6 6"/>', 2.4),
  trash: svgIcon('<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V4h6v3"/>'),
  copy: svgIcon('<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  tick: svgIcon('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 2.8)
};
/* mode is "print" (sheets to print) or "play" (one puzzle solved on screen,
   see play.js) */
const state = {mode: "print", type: "sudoku9", source: "random", level: "easy", layout: 2, count: 4};

/* Below 700 px the play view fills the screen and every overlay is a bottom
   sheet (docs/ui-uudistus.md §5); from 700 px up the top bar carries the
   brand and Käyttötapa, and the play view gets a side column (§8). */
const wideScreen = matchMedia("(min-width: 700px)");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

/* One set of controls (§1). The fields that make a puzzle are moved, never
   cloned, so their ids and listeners stay: in play mode into Uusi tehtävä,
   in print mode back to the rail, each after a comment that marks its home.
   Käyttötapa sits in the top bar on wide screens; on a phone it is in the
   rail in print mode and in Uusi tehtävä in play mode. */
const MOVABLE = ["field-mode", "field-type", "src-wrap", "img-wrap", "field-level", "sym-wrap", "generate", "status"].map(el);
const HOME = new Map(MOVABLE.map(n => {
  const mark = document.createComment(" home of #" + n.id + " ");
  n.before(mark);
  return [n, mark];
}));

function placeControls() {
  const play = state.mode === "play", sheet = el("ov-new-body"), foot = sheet.querySelector(".ov-foot");
  for (const n of MOVABLE) {
    if (n.id === "field-mode" && wideScreen.matches) el("slot-mode").appendChild(n);
    else if (play) sheet.insertBefore(n, foot);
    else HOME.get(n).after(n);
  }
}

/* ============================================================
   Overlays (§3, §5.4, §8.3): modal <dialog>s, so Esc, the focus trap and
   the backdrop come from the browser. A click on the backdrop closes one,
   and focus goes back to the button that opened it.
   ============================================================ */

const Overlay = (() => {
  const openers = new Map(), watchers = [];
  const all = () => [...document.querySelectorAll("dialog.overlay")];
  const changed = () => { for (const fn of watchers) fn(); };

  /* On wide screens a popover hangs 8 px under its button, right-aligned
     to it. Positioned here rather than with CSS anchors, which not every
     browser has. */
  function place(dlg) {
    dlg.style.top = dlg.style.left = "";
    const b = openers.get(dlg);
    if (!dlg.classList.contains("pop") || !wideScreen.matches || !b || !b.isConnected) return;
    const r = b.getBoundingClientRect(), w = dlg.offsetWidth;
    dlg.style.top = Math.round(r.bottom + 8) + "px";
    dlg.style.left = Math.round(Math.max(8, Math.min(r.right - w, innerWidth - w - 8))) + "px";
  }

  /* stacked: opened from another overlay, which stays open under it */
  function open(dlg, opener, stacked) {
    if (dlg.open) return;
    openers.set(dlg, opener || document.activeElement);
    dlg.classList.toggle("stacked", !!stacked);
    dlg.showModal();
    place(dlg);
    if (opener && opener.hasAttribute("aria-expanded")) opener.setAttribute("aria-expanded", "true");
    changed();
  }
  const close = dlg => { if (dlg && dlg.open) dlg.close(); };

  for (const dlg of all()) {
    dlg.addEventListener("close", () => {
      const b = openers.get(dlg), a = document.activeElement;
      openers.delete(dlg);
      if (b && b.hasAttribute("aria-expanded")) b.setAttribute("aria-expanded", "false");
      /* unless whatever closed it moved focus on purpose (to the board) */
      if (b && b.isConnected && (!a || a === document.body || dlg.contains(a))) b.focus({preventScroll: true});
      changed();
    });
    dlg.addEventListener("click", e => {
      if (e.target.closest("[data-close]")) { close(dlg); return; }
      if (e.target !== dlg) return;
      const r = dlg.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close(dlg);
    });
  }
  addEventListener("resize", () => { for (const d of all()) if (d.open) place(d); });

  return {
    open, close,
    closeAll: () => all().reverse().forEach(close),
    anyOpen: () => all().some(d => d.open),
    onChange: fn => watchers.push(fn)
  };
})();

function bindSegment(id, key, cast, onChange) {
  el(id).addEventListener("click", e => {
    const btn = e.target.closest("button");
    if (!btn) return;
    [...e.currentTarget.children].forEach(b => b.setAttribute("aria-pressed", String(b === btn)));
    state[key] = cast(btn.dataset.value);
    if (onChange) onChange();
  });
}
bindSegment("seg-level", "level", v => v);
bindSegment("seg-layout", "layout", v => parseInt(v, 10));
bindSegment("seg-source", "source", v => v, syncMode);
bindSegment("seg-mode", "mode", v => v, () => {
  syncMode();
  if (window.Play) window.Play.modeChanged();
});

/* Own picture. `gray` is the cropped image averaged down to the chosen grid;
   the threshold is in luminance, so it survives a change of grid size. */
const picture = {img: null, gray: null, size: 25, threshold: 128, invert: false};

/* Only the nonogram is built from a picture, so any other type falls back to
   the random source. Choosing the mode is separate from having chosen a file. */
function pictureMode() {
  return state.type === "nonogram" && state.source === "picture";
}

/* Shows the fields that belong to the current source and hides the rest, so
   nothing is left on screen that cannot affect the result. */
function syncMode() {
  const nonogram = state.type === "nonogram";
  if (!nonogram) state.source = "random";
  const pic = pictureMode();
  const play = state.mode === "play";
  el("src-wrap").hidden = !nonogram;
  el("img-wrap").hidden = !pic;
  el("field-level").hidden = pic;
  /* play mode solves one puzzle on screen, so everything about sheets goes */
  for (const id of ["field-count", "field-layout"]) el(id).hidden = pic || play;
  for (const id of ["field-title", "sol-wrap", "print", "pdf-hint"]) el(id).hidden = play;
  el("preview").hidden = play;
  el("rail").hidden = play;
  el("play").hidden = !play;
  document.body.classList.toggle("playing", play);
  el("generate-label").textContent = play ? "Luo tehtävä" : "Luo tehtävät";
  placeControls();
  el("seg-source").querySelectorAll("button").forEach(b =>
    b.setAttribute("aria-pressed", String(b.dataset.value === state.source)));
  el("seg-mode").querySelectorAll("button").forEach(b =>
    b.setAttribute("aria-pressed", String(b.dataset.value === state.mode)));
}

function drawPicturePreview() {
  el("img-result").textContent = "";
  const cv = el("img-preview");
  const n = picture.size;
  cv.width = cv.height = n;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, n, n);
  if (!picture.gray) return;
  /* denoise runs on every picture, so preview what will actually be built */
  const fill = grayToBitmap(picture.gray, n, picture.threshold, picture.invert);
  denoiseBitmap(fill, n);
  ctx.fillStyle = "#2A2A2A";
  for (let i = 0; i < n * n; i++) if (fill[i]) ctx.fillRect(i % n, (i / n) | 0, 1, 1);
}

/* The live preview is only the thresholded picture; repair may move cells and
   a busy picture is redrawn coarser, so replace it with what really printed. */
function showPictureResult(built) {
  const cv = el("img-preview");
  cv.width = cv.height = built.n;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, built.n, built.n);
  ctx.fillStyle = "#2A2A2A";
  for (let i = 0; i < built.n * built.n; i++) {
    if (built.fill[i]) ctx.fillRect(i % built.n, (i / built.n) | 0, 1, 1);
  }
  el("img-result").textContent = "Näin tehtävä tulostuu. " + (built.moved
    ? `Kuvaa muutettiin ${built.moved} ruudun verran` +
      (built.coarse ? " ja se yksinkertaistettiin." : ".")
    : "Kuva sopi sellaisenaan.");
}

function refreshPicture(reGray) {
  if (picture.img && reGray) picture.gray = imageToGray(picture.img, picture.size);
  el("img-panel").hidden = !picture.img;
  drawPicturePreview();
}

el("img-file").addEventListener("change", e => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      picture.img = img;
      picture.gray = imageToGray(img, picture.size);
      picture.threshold = otsuThreshold(picture.gray);
      el("img-threshold").value = String(picture.threshold);
      refreshPicture(false);
      statusEl.textContent = "Kuva ladattu. Säädä raja-arvoa ja luo tehtävä.";
    };
    img.onerror = () => { statusEl.textContent = "Kuvaa ei voitu lukea."; };
    /* a data: URL rather than a blob: one, so the canvas is readable even when
       the page is opened straight from disk */
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
});

el("img-threshold").addEventListener("input", e => {
  picture.threshold = parseInt(e.target.value, 10);
  drawPicturePreview();
});
el("img-invert").addEventListener("change", e => {
  picture.invert = e.target.checked;
  drawPicturePreview();
});
el("seg-imgsize").addEventListener("click", e => {
  const btn = e.target.closest("button");
  if (!btn) return;
  [...e.currentTarget.children].forEach(b => b.setAttribute("aria-pressed", String(b === btn)));
  picture.size = parseInt(btn.dataset.value, 10);
  refreshPicture(true);
});
el("img-clear").addEventListener("click", () => {
  picture.img = null; picture.gray = null;
  el("img-file").value = "";
  refreshPicture(false);
  statusEl.textContent = "";
});

function syncType() {
  state.type = el("type").value;
  const t = TYPES[state.type];
  el("type-row-icon").innerHTML = t.icon;
  el("type-row-name").textContent = t.name;
  el("rules").textContent = t.rules;
  el("title").placeholder = t.name;
  el("opt-symmetry").disabled = !t.symmetry;
  el("sym-wrap").classList.toggle("off", !t.symmetry);
  syncSwitch();
  syncMode();
  refreshPicture(false);
  if (window.Play) window.Play.typeChanged();
}
/* the hidden select gets one option per type, grouped as the picker is */
for (const cat of CATEGORIES) {
  const group = document.createElement("optgroup");
  group.label = cat.label;
  for (const [id, t] of Object.entries(TYPES)) if (t.cat === cat.id) group.appendChild(new Option(t.name, id));
  if (group.children.length) el("type").appendChild(group);
}
el("type").value = state.type;
el("type").addEventListener("change", syncType);

/* the symmetry switch of Uusi tehtävä drives the rail's checkbox, which
   stays the source of truth */
const symBox = el("opt-symmetry"), symSwitch = el("sym-switch");
function syncSwitch() {
  symSwitch.setAttribute("aria-checked", String(symBox.checked));
  symSwitch.disabled = symBox.disabled;
}
symSwitch.addEventListener("click", () => {
  if (symBox.disabled) return;
  symBox.checked = !symBox.checked;
  symBox.dispatchEvent(new Event("change", {bubbles: true}));
});
symBox.addEventListener("change", syncSwitch);
wideScreen.addEventListener("change", () => {
  placeControls();
  if (window.Play) window.Play.layoutChanged();
});

syncType();

/* ============================================================
   Type picker (§7): the recently used types, then a section of tiles per
   category. Choosing one sets the hidden select and fires its change
   event, so syncType runs as for any other change. Opened from Uusi
   tehtävä it sits on top of it, and closing it goes back there.
   ============================================================ */

const Picker = (() => {
  const dlg = el("ov-types"), sel = el("type"), recentList = el("types-recent-list");
  const tiles = [];
  for (const cat of CATEGORIES) {
    const ids = Object.keys(TYPES).filter(id => TYPES[id].cat === cat.id);
    if (!ids.length) continue;
    const sec = document.createElement("section");
    sec.className = "tsec";
    const h = document.createElement("h3");
    h.className = "label";
    h.id = "h-cat-" + cat.id;
    h.textContent = cat.label;
    const grid = document.createElement("div");
    grid.className = "tiles";
    grid.setAttribute("role", "group");
    grid.setAttribute("aria-labelledby", h.id);
    for (const id of ids) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tile";
      b.dataset.type = id;
      b.innerHTML = `<span class="ti" aria-hidden="true">${TYPES[id].icon}</span><span class="tn"></span>`;
      b.lastChild.textContent = TYPES[id].short;
      grid.appendChild(b);
      tiles.push(b);
    }
    sec.append(h, grid);
    el("types-body").appendChild(sec);
  }

  function render() {
    for (const b of tiles) b.setAttribute("aria-pressed", String(b.dataset.type === state.type));
    const recent = PlayStore.recent().filter(id => TYPES[id]);
    el("types-recent").hidden = !recent.length;
    recentList.replaceChildren(...recent.map(id => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "rpill";
      b.dataset.type = id;
      const on = id === state.type;
      b.setAttribute("aria-pressed", String(on));
      b.innerHTML = on ? ICON.tick : "";
      b.append(TYPES[id].name);
      return b;
    }));
  }

  /* from Uusi tehtävä: a back button, and closing returns there */
  function open(opener, fromSheet) {
    render();
    el("types-back").hidden = !fromSheet;
    el("types-close").hidden = !!fromSheet;
    Overlay.open(dlg, opener, fromSheet);
  }

  dlg.addEventListener("click", e => {
    const b = e.target.closest("[data-type]");
    if (!b) return;
    if (sel.value !== b.dataset.type) {
      sel.value = b.dataset.type;
      sel.dispatchEvent(new Event("change", {bubbles: true}));
    }
    Overlay.close(dlg);
  });

  el("type-row").addEventListener("click", e => open(e.currentTarget, el("ov-new").open));
  return {open};
})();

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

function buildSheet(title, level, layout, items, pageNo, pageTotal, isSolution, type, cellSize) {
  const t = TYPES[type];
  const sheet = document.createElement("section");
  sheet.className = "sheet";

  const head = document.createElement("header");
  head.className = "sheet-head";
  head.innerHTML = '<h2></h2><span class="tag"></span>';
  head.querySelector("h2").textContent = title;
  /* a puzzle built from a picture has no difficulty level, so it passes
     its grid size here instead */
  head.querySelector(".tag").textContent = LEVEL_LABEL[level] || level;
  sheet.appendChild(head);

  const body = document.createElement("div");
  body.className = "sheet-body";
  const cols = layout >= 4 ? 2 : 1;
  body.dataset.cols = String(cols);
  body.dataset.rows = String(layout / cols);
  /* A type whose grid size changes a lot between levels can give its own
     table per level; everything else keeps one table for all of them. An
     explicit size wins over both, for a grid the tables do not cover -- a
     puzzle built from the user's own picture. */
  const table = (t.cellByLevel && t.cellByLevel[level]) || t.cell;
  const size = cellSize || (isSolution ? table.sol : table[layout]);
  body.style.setProperty("--cell", size);
  body.style.setProperty("--gap", `calc(${size} * 0.42)`);

  for (const item of items) {
    const art = document.createElement("article");
    art.className = "puzzle";
    const h = document.createElement("h3");
    h.textContent = (isSolution ? "Ratkaisu " : "Nro ") + item.number;
    art.appendChild(h);
    /* each renderer draws a role="img"; its name is given here, where the
       type and the number are known (docs/saavutettavuus.md §7, P10) */
    const grid = RENDER[item.data.kind](item.data, isSolution);
    grid.setAttribute("aria-label", `${t.name}, ${isSolution ? "ratkaisu" : "tehtävä"} ${item.number}`);
    art.appendChild(grid);
    if (PLAY_BASE_URL && !isSolution) {
      art.classList.add("has-qr");
      art.appendChild(puzzleQr(type, level, item.data));
    }
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

/* A QR code linking to the puzzle in Ratkaise ruudulla, drawn as one SVG
   path so it prints sharp at any size. Error correction L keeps the
   modules as large as the 14 mm allows; the code holds the puzzle only,
   never progress. A picture nonogram passes its grid size as the level. */
function puzzleQr(type, level, data) {
  const url = PLAY_BASE_URL + "#" + encodeCode(type, LEVEL_LABEL[level] ? level : "none", data, null).code;
  const qr = qrcode(0, "L");
  qr.addData(url, "Byte");
  qr.make();
  const n = qr.getModuleCount(), q = 2, d = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d.push(`M${c + q} ${r + q}h1v1h-1z`);
  const a = document.createElement("a");
  a.className = "qr";
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener";
  a.setAttribute("aria-label", "Ratkaise ruudulla");
  a.innerHTML = `<svg viewBox="0 0 ${n + 2 * q} ${n + 2 * q}" shape-rendering="crispEdges" aria-hidden="true">` +
    `<rect width="100%" height="100%" fill="#fff"/><path d="${d.join("")}" fill="#000"/></svg>`;
  return a;
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
  if (state.mode === "play") { window.Play.create(); return; }
  const fromPicture = pictureMode();
  if (fromPicture && !picture.img) {
    statusEl.textContent = "Valitse ensin kuva.";
    return;
  }
  if (!fromPicture) clampCount();
  const {type, level} = state;
  const layout = fromPicture ? 1 : state.layout;
  const count = fromPicture ? 1 : state.count;
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
  let note = "";
  let cellSize = null, solCellSize = null;
  let sheetTag = level;

  if (fromPicture) {
    statusEl.textContent = "Luodaan tehtävää kuvasta…";
    await idle();
    const built = await makeNonogramFromImage(
      picture.gray, picture.size, picture.threshold, picture.invert,
      async changed => {
        statusEl.textContent = `Sovitetaan kuvaa… ${changed} ruutua muutettu`;
        await idle();
      });
    if (built) {
      items.push({number: 1, data: {kind: "nonogram", n: built.n, fill: built.fill,
                                    rowClues: built.rowClues, colClues: built.colClues}});
      cellSize = built.cell;
      solCellSize = built.sol;
      sheetTag = `${built.n} × ${built.n}`;
      showPictureResult(built);
      note = built.moved
        ? ` Kuvaa muutettiin ${built.moved} ruudun verran${built.coarse ? " ja yksinkertaistettiin" : ""}.`
        : " Kuva sopi sellaisenaan.";
    } else {
      failed++;
    }
  } else {
    for (let n = 1; n <= count; n++) {
      statusEl.textContent = `Luodaan tehtäviä… ${n}/${count}`;
      await idle();
      const data = buildOne(type, level, symmetric);
      if (!data) { failed++; continue; }
      items.push({number: items.length + 1, data});
    }
  }

  if (!items.length) {
    statusEl.textContent = fromPicture
      ? "Kuvasta ei saatu ratkeavaa tehtävää. Kokeile toista raja-arvoa, kokoa tai kuvaa."
      : "Tehtävien luonti ei onnistunut. Yritä uudelleen.";
    generateBtn.disabled = false;
    return;
  }

  PlayStore.touchRecent(type);
  const pages = chunk(items, layout);
  /* one picture makes one solution, so give it the page rather than
     stranding it in the six-up grid */
  const solLayout = fromPicture ? 1 : 6;
  const solPages = withSolutions ? chunk(items, solLayout) : [];
  const total = pages.length + solPages.length;

  const frag = document.createDocumentFragment();
  let page = 0;
  pages.forEach(group => {
    page++;
    frag.appendChild(buildSheet(title, sheetTag, layout, group, page, total, false, type, cellSize));
  });
  solPages.forEach(group => {
    page++;
    frag.appendChild(buildSheet(title + " – ratkaisut", sheetTag, solLayout, group, page, total,
                                true, type, solCellSize));
  });
  previewEl.appendChild(frag);

  statusEl.textContent = `${items.length} tehtävää, ${total} sivua.` +
    (failed ? ` ${failed} ei syntynyt.` : "") + note;
  generateBtn.disabled = false;
  printBtn.disabled = false;
  /* on a phone the rail stands above the sheets, so go to the first one */
  const behavior = reducedMotion.matches ? "auto" : "smooth";
  if (wideScreen.matches) window.scrollTo({top: 0, behavior});
  else previewEl.querySelector(".sheet").scrollIntoView({block: "start", behavior});
}

generateBtn.addEventListener("click", () => { generate(); });
printBtn.addEventListener("click", () => window.print());