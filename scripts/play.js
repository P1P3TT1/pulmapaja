"use strict";

/* Ratkaise ruudulla: one puzzle solved on screen. The board is drawn by the
   print renderer itself, with the player's digits passed in place of the
   givens, and then decorated: selection, highlights, notes, clashes, or the
   shading marks of hitori and the nonogram. The
   whole state packs into a code (codec.js) that saves to this browser after
   every move (store.js), sits in the address bar, and can be copied to
   continue elsewhere. See docs/ratkaise-ruudulla.md §5–6. */

window.Play = (() => {
  /* the types play mode can show so far; the others follow phase by phase */
  const PLAYABLE = new Set(["sudoku9", "sudoku6", "diagonal", "jigsaw", "kropki", "killer",
    "futoshiki", "skyscrapers", "kakuro", "hitori", "nonogram"]);
  const NOT_YET = "Tämän pulmatyypin ratkaiseminen ruudulla ei ole vielä käytössä. Sen voi kuitenkin tulostaa.";
  const CODE_IN_HASH = new RegExp(`^[A-Za-z0-9_-]{${CODE_MIN_LENGTH},}$`);

  const $ = id => document.getElementById(id);
  const playEl = $("play"), boardEl = $("play-board"), padEl = $("play-pad"), modesEl = $("play-modes");
  const statusEl = $("play-status"), srEl = $("play-sr"), openErr = $("open-err");

  /* P: {type, level, item, prog: {val, notes} or {marks}, id, elapsed, done,
         ctl     "digits" or "shading" (codec.js codeController)
         n       cells per row          N      cells in all
         d       digit range            total  cells a player fills, givens included
         given   1 per given            open   1 per cell that takes part (not a kakuro black cell)
         peers   per cell, the cells sharing a unit with it: row, column,
                 region, diagonal, killer cage or kakuro run
         counted every digit appears n times, so the pad can count down
         cells}  – null until a puzzle is open */
  let P = null, sel = -1, notesMode = false, undo = [], busy = false, ticks = 0;
  /* nonogram: what a tap or a drag marks, and the drag in progress */
  let shadeMode = "fill", drag = null;

  const say = t => { statusEl.textContent = t; };
  const fmtTime = s => {
    s = Math.floor(s);
    const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0");
  };
  const levelTag = (level, item) => level === "none" ? `${item.n} × ${item.n}` : (LEVEL_LABEL[level] || "");
  const filledCount = () => {
    const a = P.ctl === "shading" ? P.prog.marks : P.prog.val;
    let f = 0;
    for (let i = 0; i < P.N; i++) if (a[i]) f++;
    return f;
  };
  /* hitori ignores circles and the nonogram crosses: only the shading counts */
  const solved = () => {
    if (P.ctl !== "shading") return P.prog.val.every((v, i) => !P.open[i] || v === P.item.solution[i]);
    const m = P.prog.marks;
    if (P.item.kind === "hitori") return P.item.shaded.every((s, i) => (m[i] === 1) === (s === BLACK));
    return P.item.fill.every((f, i) => (m[i] === 1) === !!f);
  };
  const ago = t => {
    const s = (Date.now() - t) / 1000;
    if (s < 60) return "juuri nyt";
    const m = Math.round(s / 60); if (m < 60) return m + " min sitten";
    const h = Math.round(m / 60); if (h < 24) return h + " t sitten";
    return new Date(t).toLocaleDateString("fi-FI");
  };
  const setHash = code => {
    try { history.replaceState(null, "", code ? "#" + code : location.pathname + location.search); } catch {}
  };

  /* ---------- rail ---------- */

  /* switches the rail to play mode without asking modeChanged to act on it */
  function enterPlayMode() {
    if (state.mode === "play") return;
    state.mode = "play";
    syncMode();
  }

  /* points the rail's type and level at the open puzzle, so "Luo tehtävä"
     makes another of the same kind */
  function setRail(type, level) {
    if (el("type").value !== type) { el("type").value = type; syncType(); }
    if (!LEVEL_LABEL[level]) return;
    state.level = level;
    el("seg-level").querySelectorAll("button").forEach(b =>
      b.setAttribute("aria-pressed", String(b.dataset.value === level)));
  }

  /* ---------- board ---------- */

  function buildBoard() {
    const {item, prog, N} = P;
    /* the renderer draws the player's digits where the givens would be */
    const g = RENDER[item.kind](Object.assign({}, item, {puz: prog.val, puzzle: prog.val}), false);
    g.removeAttribute("role");
    g.removeAttribute("aria-label");
    /* every renderer marks the play cells, and only them, with .cell, in
       reading order; clue strips, gaps and sums use other classes */
    P.cells = [...g.querySelectorAll(".cell")].slice(0, N);
    P.cells.forEach((c, i) => {
      /* the value moves into its own span, so marks the renderer put in the
         cell (a cage sum) stay when the value changes */
      let text = "";
      for (const t of [...c.childNodes]) if (t.nodeType === 3) { text += t.textContent; t.remove(); }
      /* the diagonal shading is inline on paper; as a class it gives way to
         the selection and follows the dark theme */
      if (c.style.background) { c.style.background = ""; c.classList.add("diag"); }
      const v = document.createElement("span");
      v.className = "v";
      v.textContent = text;
      c.appendChild(v);
      c.dataset.i = i;
      c.dataset.base = c.className;
      if (!P.open[i]) c.setAttribute("aria-label", clueLabel(i));
    });
    boardEl.replaceChildren(g);
    const shading = P.ctl === "shading", ngram = item.kind === "nonogram";
    boardEl.setAttribute("aria-label",
      item.kind === "hitori" ? "Hitoriruudukko. Liiku nuolinäppäimillä, välilyönti vaihtaa ruudun tilaa."
      : ngram ? "Nonogrammiruudukko. Liiku nuolinäppäimillä, välilyönti värittää ja X merkitsee rastin."
      : (["sudoku", "kropki", "killer"].includes(item.kind) ? "Sudokuruudukko" : "Ruudukko") +
        ". Liiku nuolinäppäimillä ja kirjoita numero.");
    /* the board's width in cells, which --cell is fitted to: futoshiki adds
       its sign gaps, pilvenpiirtäjät a clue strip on each side, and the
       nonogram its row clues, estimated from their digits */
    let span = item.kind === "futoshiki" ? P.n + (P.n - 1) * 0.42
      : item.kind === "skyscrapers" ? P.n + 2 : P.n;
    if (ngram) {
      let widest = 0;
      for (const nums of item.rowClues) {
        const w = (nums.length ? nums : [0]).reduce((s, x) => s + String(x).length * 0.38 + 0.3, 0.2);
        widest = Math.max(widest, w);
      }
      span = P.n + widest;
    }
    playEl.style.setProperty("--span", span);
    playEl.style.setProperty("--d", P.d || 1);
    playEl.classList.toggle("ctl-shading", shading);
    playEl.classList.toggle("ctl-nonogram", ngram);
    padEl.hidden = shading;
    modesEl.hidden = !ngram;
    $("t-notes").hidden = shading;
    $("play-tools").style.gridTemplateColumns = `repeat(${shading ? 3 : 4},1fr)`;
    shadeMode = "fill";
    if (shading) {
      $("play-keys").innerHTML = ngram
        ? `Vedä rivin tai sarakkeen yli, niin merkitset monta ruutua kerralla. Napauta reunan lukua, niin se yliviivataan. ` +
          `Näppäimistöllä: <kbd>←↑→↓</kbd> liikkuu, <kbd>Välilyönti</kbd> värittää, <kbd>X</kbd> merkitsee rastin, ` +
          `<kbd>Del</kbd> tyhjentää ja <kbd>Ctrl</kbd> + <kbd>Z</kbd> kumoaa.`
        : `Napauta ruutua: tyhjä, väritetty, ympyröity. Näppäimistöllä: <kbd>←↑→↓</kbd> liikkuu, ` +
          `<kbd>Välilyönti</kbd> vaihtaa ruudun tilaa, <kbd>Del</kbd> tyhjentää ja <kbd>Ctrl</kbd> + <kbd>Z</kbd> kumoaa.`;
      return;
    }

    padEl.replaceChildren();
    for (let d = 1; d <= P.d; d++) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.d = d;
      b.innerHTML = `<span>${d}</span><small></small>`;
      padEl.appendChild(b);
    }
    $("play-keys").innerHTML = `Näppäimistöllä: <kbd>←↑→↓</kbd> liikkuu, <kbd>1</kbd>–<kbd>${P.d}</kbd> kirjoittaa, ` +
      `<kbd>Shift</kbd> + numero tekee muistiinpanon, <kbd>N</kbd> vaihtaa muistiinpanotilan, ` +
      `<kbd>Del</kbd> pyyhkii ja <kbd>Ctrl</kbd> + <kbd>Z</kbd> kumoaa.`;
  }

  function clashes(i) {
    const v = P.prog.val[i];
    if (!v) return false;
    for (const j of P.peers[i]) if (P.prog.val[j] === v) return true;
    return false;
  }

  const where = i => `Rivi ${((i / P.n) | 0) + 1}, sarake ${(i % P.n) + 1}: `;

  /* a kakuro black cell, with the sums it carries */
  function clueLabel(i) {
    const sums = [];
    for (const run of P.item.runs || []) {
      if (run.clue === i) sums.push(`${run.dir === "h" ? "vaakasumma" : "pystysumma"} ${run.sum}`);
    }
    return where(i) + "vihjeruutu" + (sums.length ? ", " + sums.join(", ") : "");
  }

  function cellLabel(i) {
    if (P.ctl === "shading") {
      const m = P.prog.marks[i];
      if (P.item.kind === "hitori") return where(i) + P.item.values[i] + (m === 1 ? ", väritetty" : m === 2 ? ", ympyröity" : "");
      return where(i) + (m === 1 ? "väritetty" : m === 2 ? "rasti" : "tyhjä");
    }
    if (!P.open[i]) return clueLabel(i);
    const {val, notes} = P.prog, v = val[i];
    if (v) return where(i) + (P.given[i] ? "annettu " : "") + v;
    if (notes[i]) {
      const list = [];
      for (let d = 1; d <= P.d; d++) if (notes[i] & bitOf(d)) list.push(d);
      return where(i) + "tyhjä, muistiinpanot " + list.join(", ");
    }
    return where(i) + "tyhjä";
  }

  /* one cell of a shading board; also used while a drag paints */
  function renderShadeCell(i, peerSet) {
    const c = P.cells[i], m = P.prog.marks[i], hitori = P.item.kind === "hitori";
    let cls = c.dataset.base;
    if (m === 1) cls += hitori ? " mk-shade" : " mk-fill";
    if (m === 2) cls += hitori ? " mk-circle" : " mk-x";
    if (i === sel) cls += " sel";
    else if (peerSet && peerSet.has(i)) cls += " peer";
    c.className = cls;
    if (!hitori) c.lastChild.textContent = m === 2 ? "×" : "";
    c.setAttribute("aria-label", cellLabel(i));
  }

  function renderHead() {
    $("play-name").textContent = TYPES[P.type].name;
    $("play-tag").textContent = levelTag(P.level, P.item);
    $("play-clock").textContent = fmtTime(P.elapsed);
    const done = $("play-done");
    done.hidden = !P.done;
    if (P.done) done.textContent = `Ratkaistu ajassa ${fmtTime(P.elapsed)}. Hienoa!`;
    playEl.classList.toggle("is-done", P.done);
  }

  function render() {
    if (P.ctl === "shading") {
      const peerSet = sel >= 0 ? new Set(P.peers[sel]) : null;
      for (let i = 0; i < P.N; i++) renderShadeCell(i, peerSet);
      modesEl.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === shadeMode)));
      renderHead();
      return;
    }
    const {val, notes} = P.prog;
    const selVal = sel >= 0 ? val[sel] : 0;
    const peerSet = sel >= 0 ? new Set(P.peers[sel]) : null;
    const cols = Math.ceil(Math.sqrt(P.d));
    P.cells.forEach((c, i) => {
      if (!P.open[i]) return;
      const v = val[i];
      let cls = c.dataset.base;
      if (P.given[i]) cls += " given"; else if (v) cls += " user";
      if (i === sel) cls += " sel";
      else if (selVal && v === selVal) cls += " same";
      else if (peerSet && peerSet.has(i)) cls += " peer";
      if (!P.given[i] && clashes(i)) cls += " clash";
      c.className = cls;
      const span = c.lastChild;
      if (v) span.textContent = v;
      else if (notes[i]) {
        let h = `<span class="notes" style="grid-template-columns:repeat(${cols},1fr)">`;
        for (let d = 1; d <= P.d; d++) {
          const on = notes[i] & bitOf(d);
          h += `<span${on && d === selVal ? ' class="hit"' : ""}>${on ? d : ""}</span>`;
        }
        span.innerHTML = h + "</span>";
      } else span.textContent = "";
      c.setAttribute("aria-label", cellLabel(i));
    });

    const counts = new Array(P.d + 1).fill(0);
    for (let i = 0; i < P.N; i++) counts[val[i]]++;
    padEl.classList.toggle("notes-on", notesMode);
    /* a kakuro uses each digit any number of times, so its pad has nothing
       to count down */
    for (const b of padEl.children) {
      const d = +b.dataset.d, left = P.counted ? P.n - counts[d] : 1;
      b.querySelector("small").textContent = notesMode || !P.counted ? "" : (left > 0 ? left : "");
      b.classList.toggle("used", !notesMode && left <= 0);
      b.classList.toggle("on", notesMode && sel >= 0 && !!(notes[sel] & bitOf(d)));
      b.setAttribute("aria-label", notesMode ? `Muistiinpano ${d}`
        : P.counted ? `Numero ${d}, jäljellä ${Math.max(0, left)}` : `Numero ${d}`);
    }
    $("t-notes").setAttribute("aria-pressed", String(notesMode));
    renderHead();
  }

  /* ---------- codes, storage ---------- */

  function progressCode() { return encodeCode(P.type, P.level, P.item, P.prog).code; }

  function renderCodes() {
    const b = progressCode();
    $("code-a").value = P.id; $("len-a").textContent = P.id.length + " merkkiä";
    $("code-b").value = b; $("len-b").textContent = b.length + " merkkiä";
    if (state.mode === "play") setHash(P.id);
  }

  function save() {
    if (!P) return;
    PlayStore.save(P.id, {progress: progressCode(), type: P.type, level: P.level,
      elapsed: Math.floor(P.elapsed), done: P.done, filled: filledCount(), total: P.N, updated: Date.now()});
  }

  function renderSaved() {
    const ul = $("saved");
    const rows = PlayStore.list().filter(([id, r]) => CODE_IN_HASH.test(id) && TYPES[r.type]);
    ul.replaceChildren();
    if (!rows.length) {
      const li = document.createElement("li");
      li.className = "empty-list";
      li.textContent = "Ei tallennettuja tehtäviä. Ne tallentuvat tähän, kun aloitat.";
      ul.appendChild(li);
      return;
    }
    for (const [id, r] of rows) {
      const cur = P && id === P.id;
      const total = Math.max(1, +r.total || 1), filled = Math.min(total, Math.max(0, +r.filled || 0));
      const li = document.createElement("li");
      const what = document.createElement("span");
      what.className = "what";
      what.textContent = TYPES[r.type].name +
        (LEVEL_LABEL[r.level] ? " · " + LEVEL_LABEL[r.level] : r.level === "none" ? " · oma kuva" : "");
      if (cur || r.done) {
        const em = document.createElement("em");
        em.textContent = cur ? "auki" : "ratkaistu";
        if (cur) em.className = "cur";
        what.appendChild(em);
      }
      const acts = document.createElement("span");
      acts.className = "acts";
      const btn = (text, attr, label) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "btn ghost small"; b.textContent = text;
        b.dataset[attr] = id;
        if (label) b.setAttribute("aria-label", label);
        acts.appendChild(b);
      };
      if (!cur) btn("Avaa", "open", `Avaa ${what.textContent}`);
      btn("Poista", "del", "Poista tallennus");
      const bar = document.createElement("span");
      bar.className = "bar";
      bar.innerHTML = `<i style="width:${Math.round(filled / total * 100)}%"></i>`;
      const meta = document.createElement("span");
      meta.className = "meta";
      meta.textContent = `${filled}/${total} · ${fmtTime(+r.elapsed || 0)} · ${ago(+r.updated || Date.now())}`;
      li.append(what, acts, bar, meta);
      ul.appendChild(li);
    }
  }

  function afterChange() {
    if (!P.done && solved()) {
      P.done = true; sel = -1;
      say("Ratkaistu! Tehtävä on merkitty valmiiksi.");
    }
    render(); renderCodes(); save(); renderSaved();
  }

  /* ---------- opening ---------- */

  /* For each cell, the cells it may not repeat a digit with. The spec's
     units cover rows, columns, regions and diagonals; a killer adds its
     cage, and a kakuro has only its runs. */
  function peersOf(item) {
    /* shading types repeat nothing; their row and column are highlighted to
       keep the place on a large grid */
    if (item.kind === "hitori" || item.kind === "nonogram") {
      const n = item.n;
      return Array.from({length: n * n}, (_, i) => {
        const r = (i / n) | 0, c = i % n, out = [];
        for (let k = 0; k < n; k++) { if (k !== c) out.push(r * n + k); if (k !== r) out.push(k * n + c); }
        return out;
      });
    }
    if (item.kind === "kakuro") {
      const N = item.size * item.size, sets = Array.from({length: N}, () => new Set());
      for (const run of item.runs) for (const i of run.cells) for (const j of run.cells) if (i !== j) sets[i].add(j);
      return sets.map(x => [...x]);
    }
    if (item.kind !== "killer") return item.spec.peers;
    return item.spec.peers.map((list, i) => {
      const x = new Set(list);
      for (const j of item.cages[item.cageOf[i]].cells) if (j !== i) x.add(j);
      return [...x];
    });
  }

  function start(type, level, item, prog, elapsed, msg) {
    const kakuro = item.kind === "kakuro", ctl = codeController(type);
    const n = kakuro ? item.size : item.spec ? item.spec.n : item.n, N = n * n;
    const givens = item.puz || item.puzzle || new Uint8Array(N);
    P = {type, level, item, prog, ctl, elapsed: elapsed || 0, n, N, d: ctl === "digits" ? codeDigitRange(item) : 0,
         peers: peersOf(item), counted: !kakuro,
         given: Uint8Array.from(givens, v => v ? 1 : 0),
         open: kakuro ? Uint8Array.from(item.black, b => b ? 0 : 1) : new Uint8Array(N).fill(1)};
    P.total = P.open.reduce((s, x) => s + x, 0);
    P.id = encodeCode(type, level, item, null).code;
    P.done = solved();
    undo = []; notesMode = false;
    sel = P.done || ctl === "shading" ? -1 : P.prog.val.findIndex((v, i) => !v && P.open[i]);
    playEl.classList.remove("no-puzzle");
    setRail(type, level);
    buildBoard();
    render(); renderCodes(); save(); renderSaved();
    say(msg || "");
  }

  /* A puzzle-only code resumes what this browser has stored for it; a code
     with progress is taken as the newer state but keeps the stored time.
     onError gets the §4.2 message; false means nothing was opened. */
  function openCode(raw, onError) {
    let item;
    try { item = decodeCode(raw); } catch (e) { onError(e.message); return false; }
    if (!PLAYABLE.has(item.type)) { onError(NOT_YET); return false; }
    const {type, level} = item;
    const id = encodeCode(type, level, item, null).code;
    const rec = PlayStore.record(id);
    let prog = item.progress, elapsed = 0, msg;
    if (prog) {
      elapsed = rec ? +rec.elapsed || 0 : 0;
      msg = "Tehtävä ja edistyminen avattu koodista.";
    } else if (rec) {
      try { prog = decodeCode(rec.progress).progress; } catch {}
      elapsed = +rec.elapsed || 0;
      msg = "Jatketaan siitä, mihin jäit tässä selaimessa.";
    } else {
      msg = "Tehtävä avattu koodista.";
    }
    enterPlayMode();
    start(type, level, item, prog || emptyProgress(type, item), elapsed, msg);
    return true;
  }

  /* A nonogram from the player's own picture, built as the print flow builds
     it. The finished picture is not shown in the rail here: it would give
     the solution away. */
  async function createFromPicture() {
    if (!picture.img) { say("Valitse ensin kuva."); return; }
    busy = true;
    el("generate").disabled = true;
    el("status").textContent = "";
    say("Luodaan tehtävää kuvasta…");
    let built = null;
    try {
      await idle();
      built = await makeNonogramFromImage(picture.gray, picture.size, picture.threshold, picture.invert,
        async changed => { say(`Sovitetaan kuvaa… ${changed} ruutua muutettu`); await idle(); });
    } finally { busy = false; el("generate").disabled = false; }
    if (!built) { say("Kuvasta ei saatu ratkeavaa tehtävää. Kokeile toista raja-arvoa, kokoa tai kuvaa."); return; }
    const item = decodeCode(encodeCode("nonogram", "none",
      {kind: "nonogram", n: built.n, fill: built.fill, rowClues: built.rowClues, colClues: built.colClues}, null).code);
    const note = built.moved
      ? `Kuvaa muutettiin ${built.moved} ruudun verran${built.coarse ? " ja yksinkertaistettiin" : ""}.`
      : "Kuva sopi sellaisenaan.";
    start("nonogram", "none", item, emptyProgress("nonogram", item), 0, "Tehtävä luotu kuvasta. " + note);
    boardEl.focus({preventScroll: true});
  }

  function create() {
    if (busy) return;
    const type = state.type, level = state.level;
    if (!PLAYABLE.has(type)) { say(NOT_YET); return; }
    if (pictureMode()) { createFromPicture(); return; }
    busy = true;
    el("generate").disabled = true;
    say(level === "hard" ? "Luodaan vaikeaa tehtävää…" : "Luodaan tehtävää…");
    setTimeout(() => {
      const symmetric = TYPES[type].symmetry && el("opt-symmetry").checked;
      let item = null;
      try {
        const built = buildOne(type, level, symmetric);
        /* a new puzzle goes through its code once, so it is exactly what
           opening that code later gives (a kakuro drops digits left under
           cells that were blackened while it was built) */
        if (built) item = decodeCode(encodeCode(type, level, built, null).code);
      } finally { busy = false; el("generate").disabled = false; }
      if (!item) { say("Tehtävän luonti ei onnistunut. Yritä uudelleen."); return; }
      let msg = `Uusi ${LEVEL_LABEL[level]} tehtävä`;
      const givens = item.puz || item.puzzle;
      if (givens) {
        let g = 0;
        for (const v of givens) if (v) g++;
        msg += g === 0 ? ", ei annettuja numeroita" : g === 1 ? ", 1 annettu numero" : `, ${g} annettua numeroa`;
      }
      start(type, level, item, emptyProgress(type, item), 0, msg + ".");
      boardEl.focus({preventScroll: true});
    }, 30);
  }

  /* ---------- input ---------- */

  const snap = i => P.ctl === "shading" ? {i, mark: P.prog.marks[i]} : {i, val: P.prog.val[i], notes: P.prog.notes[i]};
  const restore = s => {
    if ("mark" in s) P.prog.marks[s.i] = s.mark;
    else { P.prog.val[s.i] = s.val; P.prog.notes[s.i] = s.notes; }
  };
  const editable = i => P && !P.done && i >= 0 && P.open[i] && !P.given[i];

  function enter(d, asNote) {
    if (!editable(sel)) return;
    const {val, notes} = P.prog;
    if (asNote) {
      if (val[sel]) return;
      undo.push([snap(sel)]);
      notes[sel] ^= bitOf(d);
    } else {
      const changes = [snap(sel)];
      if (val[sel] === d) val[sel] = 0;
      else {
        val[sel] = d; notes[sel] = 0;
        /* a placed digit clears itself from the notes it rules out */
        for (const j of P.peers[sel]) if (notes[j] & bitOf(d)) { changes.push(snap(j)); notes[j] &= ~bitOf(d); }
      }
      undo.push(changes);
    }
    say("");
    afterChange();
  }

  /* shading: sets one cell's mark as one undo step */
  function mark(i, m) {
    if (!editable(i) || P.prog.marks[i] === m) return;
    undo.push([snap(i)]);
    P.prog.marks[i] = m;
    say("");
    afterChange();
  }

  function erase() {
    if (P && P.ctl === "shading") { mark(sel, 0); return; }
    if (!editable(sel) || (!P.prog.val[sel] && !P.prog.notes[sel])) return;
    undo.push([snap(sel)]);
    P.prog.val[sel] = 0; P.prog.notes[sel] = 0;
    afterChange();
  }

  function undoStep() {
    if (!P || P.done) return;
    if (!undo.length) { say("Ei kumottavaa."); return; }
    for (const s of undo.pop()) { restore(s); sel = s.i; }
    say("");
    afterChange();
  }

  /* reports only how many are wrong – finding them is part of the puzzle */
  function check() {
    if (!P || P.done) return;
    if (P.ctl === "shading") {
      /* hitori: shaded but white, or circled but shaded; nonogram: filled
         but empty, or crossed but filled */
      const m = P.prog.marks, it = P.item;
      const black = i => it.kind === "hitori" ? it.shaded[i] === BLACK : !!it.fill[i];
      let bad = 0;
      for (let i = 0; i < P.N; i++) if ((m[i] === 1 && !black(i)) || (m[i] === 2 && black(i))) bad++;
      say(bad ? `${bad} ${bad === 1 ? "merkintä on" : "merkintää on"} väärin.` : "Kaikki merkinnät ovat oikein.");
      return;
    }
    const {val} = P.prog, sol = P.item.solution;
    let bad = 0;
    for (let i = 0; i < P.N; i++) if (!P.given[i] && val[i] && val[i] !== sol[i]) bad++;
    say(bad ? `${bad} ${bad === 1 ? "merkintä on" : "merkintää on"} väärin.`
            : `Kaikki merkinnät ovat oikein. ${P.total - filledCount()} ruutua jäljellä.`);
  }

  function select(i) {
    sel = i;
    render();
  }

  function toggleNotes() {
    if (!P) return;
    notesMode = !notesMode;
    render();
  }

  /* the cell under a point, clamped to the grid; a drag keeps going when the
     pointer leaves the board */
  function cellAt(x, y) {
    const a = P.cells[0].getBoundingClientRect(), b = P.cells[P.N - 1].getBoundingClientRect();
    const w = (b.right - a.left) / P.n, h = (b.bottom - a.top) / P.n;
    const clamp = v => Math.max(0, Math.min(P.n - 1, Math.floor(v)));
    return [clamp((y - a.top) / h), clamp((x - a.left) / w)];
  }

  /* A nonogram drag paints along one row or column, locked after the first
     step. It takes its action from the first cell: the mode's mark, or
     clearing when that cell already carries it, and it changes only cells
     in the same state as the first one. One drag is one undo step. */
  function dragTo(x, y) {
    let [r, c] = cellAt(x, y);
    if (!drag.axis && (r !== drag.r || c !== drag.c)) drag.axis = Math.abs(c - drag.c) >= Math.abs(r - drag.r) ? "row" : "col";
    if (drag.axis === "row") r = drag.r; else if (drag.axis === "col") c = drag.c;
    const n = P.n, m = P.prog.marks;
    const [r0, r1] = [Math.min(r, drag.r), Math.max(r, drag.r)], [c0, c1] = [Math.min(c, drag.c), Math.max(c, drag.c)];
    for (let y2 = r0; y2 <= r1; y2++) for (let x2 = c0; x2 <= c1; x2++) {
      const i = y2 * n + x2;
      if (m[i] !== drag.from || m[i] === drag.to) continue;
      drag.changes.push(snap(i));
      m[i] = drag.to;
      renderShadeCell(i, null);
    }
  }

  function endDrag() {
    if (!drag) return;
    const changes = drag.changes;
    drag = null;
    if (changes.length) { undo.push(changes); say(""); afterChange(); }
  }

  function shadePointerDown(e, i) {
    sel = i;
    boardEl.focus({preventScroll: true});
    e.preventDefault();
    if (P.item.kind === "hitori") { mark(i, (P.prog.marks[i] + 1) % 3); return; }
    const want = shadeMode === "fill" ? 1 : 2, from = P.prog.marks[i];
    drag = {r: (i / P.n) | 0, c: i % P.n, axis: null, from, to: from === want ? 0 : want, changes: []};
    try { boardEl.setPointerCapture(e.pointerId); } catch {}
    dragTo(e.clientX, e.clientY);
  }

  boardEl.addEventListener("pointermove", e => { if (drag) dragTo(e.clientX, e.clientY); });
  boardEl.addEventListener("pointerup", endDrag);
  boardEl.addEventListener("pointercancel", endDrag);
  boardEl.addEventListener("lostpointercapture", endDrag);

  /* nonogram clue numbers strike through when tapped, as a reminder only:
     not stored, not in the code */
  boardEl.addEventListener("click", e => {
    const n = e.target.closest(".clue span");
    if (n && P && P.item.kind === "nonogram") n.classList.toggle("done");
  });

  modesEl.addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b || !P) return;
    shadeMode = b.dataset.mode;
    render();
  });

  boardEl.addEventListener("pointerdown", e => {
    const c = e.target.closest(".cell[data-i]");
    if (!c || !P || P.done || !P.open[+c.dataset.i]) return;
    if (P.ctl === "shading") { shadePointerDown(e, +c.dataset.i); return; }
    select(+c.dataset.i);
    if (P.prog.val[sel] || P.prog.notes[sel]) srEl.textContent = cellLabel(sel);
    boardEl.focus({preventScroll: true});
    e.preventDefault();
  });

  boardEl.addEventListener("keydown", e => {
    if (!P) return;
    const k = e.key;
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === "z") { undoStep(); e.preventDefault(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k.startsWith("Arrow")) {
      if (P.done) return;
      /* steps over kakuro black cells; at the edge it stays put */
      const step = {ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1]}[k];
      if (!step) return;
      const n = P.n, [dr, dc] = step;
      let r = ((sel < 0 ? 0 : sel) / n) | 0, c = (sel < 0 ? 0 : sel) % n;
      if (sel < 0) { const first = P.open.indexOf(1); r = (first / n) | 0; c = first % n; }
      else for (let y = r + dr, x = c + dc; y >= 0 && y < n && x >= 0 && x < n; y += dr, x += dc) {
        if (P.open[y * n + x]) { r = y; c = x; break; }
      }
      select(r * n + c);
      srEl.textContent = cellLabel(sel);
      e.preventDefault();
      return;
    }
    if (P.ctl === "shading") {
      const at = sel < 0 ? -1 : sel, m = at >= 0 ? P.prog.marks[at] : 0;
      let to = null;
      if (k === " " || k === "Enter") to = P.item.kind === "hitori" ? (m + 1) % 3 : (m === 1 ? 0 : 1);
      else if ((k === "x" || k === "X") && P.item.kind === "nonogram") to = m === 2 ? 0 : 2;
      else if (k === "Backspace" || k === "Delete") to = 0;
      if (to !== null) { if (at >= 0) mark(at, to); e.preventDefault(); }
      return;
    }
    /* e.code, so Shift + digit still reads as the digit on every layout */
    const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
    if (m && +m[1] <= P.d) { enter(+m[1], notesMode !== e.shiftKey); e.preventDefault(); return; }
    if (k === "Backspace" || k === "Delete" || k === "0") { erase(); e.preventDefault(); return; }
    if (k === "n" || k === "N") { toggleNotes(); e.preventDefault(); }
  });

  /* a mouse click on the pad or a tool leaves the keyboard on the board;
     Tab and Enter still reach the buttons */
  for (const host of [padEl, modesEl, $("play-tools")]) {
    host.addEventListener("mousedown", e => { if (P && e.target.closest("button")) e.preventDefault(); });
  }

  padEl.addEventListener("click", e => {
    const b = e.target.closest("button");
    if (b) enter(+b.dataset.d, notesMode);
  });
  $("t-notes").addEventListener("click", toggleNotes);
  $("t-erase").addEventListener("click", erase);
  $("t-undo").addEventListener("click", undoStep);
  $("t-check").addEventListener("click", check);

  /* ---------- info column ---------- */

  $("open-btn").addEventListener("click", () => {
    const input = $("open-in");
    if (openCode(input.value, m => { openErr.textContent = m; })) { input.value = ""; openErr.textContent = ""; }
  });
  $("open-in").addEventListener("input", () => { openErr.textContent = ""; });

  playEl.addEventListener("click", e => {
    const cp = e.target.closest("[data-copy]");
    if (cp) {
      const ta = $(cp.dataset.copy);
      const reset = ms => setTimeout(() => { cp.textContent = "Kopioi"; }, ms);
      const done = () => { cp.textContent = "Kopioitu"; reset(1600); };
      const fallback = () => { ta.focus(); ta.select(); cp.textContent = "Valittu – kopioi itse"; reset(2400); };
      try { navigator.clipboard.writeText(ta.value).then(done, fallback); } catch { fallback(); }
      return;
    }
    const op = e.target.closest("[data-open]");
    if (op) {
      if (openCode(op.dataset.open, say)) boardEl.focus({preventScroll: true});
      return;
    }
    const del = e.target.closest("[data-del]");
    if (del) {
      const id = del.dataset.del;
      PlayStore.remove(id);
      renderSaved();
      say(P && id === P.id ? "Tallennus poistettu. Se tallentuu uudelleen seuraavasta siirrosta." : "Tallennus poistettu.");
    }
  });

  /* ---------- clock ---------- */

  /* runs only while a puzzle is on screen, unsolved and visible */
  setInterval(() => {
    if (state.mode !== "play" || !P || P.done || document.hidden) return;
    P.elapsed += 1;
    $("play-clock").textContent = fmtTime(P.elapsed);
    if (++ticks % 5 === 0) save();
  }, 1000);
  document.addEventListener("visibilitychange", () => { if (document.hidden) save(); });

  /* ---------- mode ---------- */

  function showEmpty() {
    playEl.classList.add("no-puzzle");
  }

  /* called by the rail after the Käyttötapa switch */
  function modeChanged() {
    el("status").textContent = "";
    if (state.mode !== "play") { save(); setHash(""); return; }
    if (P) { setHash(P.id); renderSaved(); return; }
    /* the last puzzle of this browser first, then a new one */
    const last = PlayStore.last();
    if (typeof last === "string" && CODE_IN_HASH.test(last) && PlayStore.record(last) &&
        openCode(last, () => {})) {
      say("Jatketaan siitä, mihin jäit.");
      return;
    }
    renderSaved();
    if (pictureMode() && !picture.img) { showEmpty(); say("Valitse ensin kuva."); }
    else if (PLAYABLE.has(state.type)) create();
    else { showEmpty(); say(NOT_YET); }
  }

  function typeChanged() {
    if (state.mode !== "play") return;
    say(PLAYABLE.has(state.type) ? "" : NOT_YET);
  }

  /* a code pasted into the address bar of an open tab */
  window.addEventListener("hashchange", () => {
    let h = "";
    try { h = location.hash.slice(1); } catch {}
    if (!CODE_IN_HASH.test(h) || (P && h === P.id && state.mode === "play")) return;
    openCode(h, m => { (state.mode === "play" ? say : t => { el("status").textContent = t; })(m); });
  });

  /* ---------- boot ---------- */

  /* a code in the link wins; then a preview build's starting point; else
     the app opens in print mode as before */
  (function boot() {
    showEmpty();
    renderSaved();
    let h = "";
    try { h = location.hash.slice(1); } catch {}
    if (h && CODE_IN_HASH.test(h)) {
      if (openCode(h, m => { el("status").textContent = m; })) return;
      setHash("");
    }
    const pv = window.PULMAPAJA_PREVIEW;
    if (pv && pv.mode === "play") {
      const [type, level] = String(pv.open || "").split(":");
      if (TYPES[type]) setRail(type, LEVEL_LABEL[level] ? level : "easy");
      enterPlayMode();
      if (PLAYABLE.has(state.type)) create();
      else say(NOT_YET);
    }
  })();

  return {create, modeChanged, typeChanged};
})();
