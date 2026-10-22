# Saavutettavuus – WCAG 2.1 AA fixes for Pulmapaja

Spec for bringing Pulmapaja to WCAG 2.1 AA. It comes from an audit of `main` at 266a9da (22 Oct 2026): 18 findings, 1 critical, 8 major, 9 minor. The audit is "Pulmapaja – Accessibility Audit" (claude.ai/artifact/9cRAY9hDVJ5o9nno74gJHo, private to Pietari). Finding ids in this spec (P1, R2, …) are the audit's. Where the audit and this spec differ, this spec wins.

The work has three halves of very different size:

- **A screen reader can solve every type.** Today it can solve five of 12: the plain sudokus, hitori and sillat. In the other seven the clues never reach the accessibility tree, and typing a digit is silent.
- **Controls and grid lines reach 3:1**, and the few dimmed texts reach 4.5:1. About ten CSS lines.
- **Small fixes**: a clash cue beyond colour, the `P` shortcut, a phone `h1`, reflow at 320 px, accessible names.

---

## 1. Ground rules

Everything in `docs/ratkaise-ruudulla.md` §1 and `docs/ui-uudistus.md` §1 still holds: vanilla JS, classic scripts, works from `file://`, Finnish UI with the en dash (–), never the em dash.

On top of that:

- **Print output must not change.** Every phase ends with `tools/print-snapshot.mjs --compare` clean, in light and in `--scheme dark`. ARIA attributes on the print renderers are fine; pixels are not.
- **Renderers stay untouched** apart from the `aria-label` text in §7. The play board already rebuilds their output in `buildBoard()`; do the board's accessibility work there.
- **Generators and codec stay untouched.** Every clue the announcements need is already on the decoded item (§4.2).
- **No new runtime files.** The new tool in §8 is a dev tool under `tools/`, not loaded by the page, so `sw.js` does not change.
- **One phase, one PR.** Each PR description lists the finding ids it closes and the axe and print-snapshot results.

## 2. Board semantics (R2, O1)

### 2.1 The board is an application

Today the board is `role="group"` with `tabindex="0"`, and each cell is a `div` with an `aria-label`. Two problems:

1. ARIA does not allow `aria-label` on a generic `div`, so in browse mode a screen reader reads a flat run of digits ("4 8 6 2 7 3…") with no positions.
2. NVDA stays in browse mode on a focused `group`, so its virtual cursor likely eats the arrow keys before `keydown` sees them. Verify this with NVDA before and after (§8.3).

The fix:

- `#play-board` gets `role="application"` and `aria-roledescription="pulmaruudukko"`. Screen readers switch to focus mode on it and pass every key through. Its `aria-label` stays and gains the new keys (§9).
- In `buildBoard()` (and `buildHashi()`), set `aria-hidden="true"` on the rendered grid and stop writing `aria-label` on cells and islands. The live region `#play-sr` becomes the only voice of the board, which is how arrow moves already work.
- On `focus` of the board, when a cell is selected, write its announcement (§3) to `#play-sr`, so returning to the board says where you are.

The audit suggested the ARIA grid pattern instead. It needs `role="row"` wrappers around each row of cells, but the renderers lay cells out as one flat CSS grid shared with print, so wrapping them risks print output. See §10, decision 1.

### 2.2 `P` belongs to the board (O1)

Move the `P` handler from `document` to the board's `keydown`, beside `N`. While paused, the board is hidden and focus is on Jatka, so also handle `P` on `#play-paused`. The clock pill still pauses by click from anywhere.

## 3. Announcements (R1, P2)

### 3.1 After every edit

All announcements go through one helper in play.js:

```js
/* the same text twice in a row is not re-read, so clear first */
function speak(t) { srEl.textContent = ""; requestAnimationFrame(() => { srEl.textContent = t; }); }
```

| After | Speak |
|---|---|
| a digit, a note, a mark (shading) | `cellLabel(sel)` |
| Pyyhi | `cellLabel(sel)` |
| Kumoa | `Kumottu. ` + `cellLabel(sel)` |
| `N` or the Muistiinpanot tool | `Muistiinpanot päällä` / `Muistiinpanot pois` |
| a bridge added or removed (sillat) | `islandLabel(sel)` |

Tarkista, solving and errors keep using `say()` and `#play-status`, which already work.

As built, `speak()` also cancels a pending frame, so of two calls in one frame only the last is spoken. Kumoa returns the selection to the cell the undone step was made on; before, it ended on the last note that step had cleared.

### 3.2 Clashes

- `cellLabel(i)` appends `, ristiriita` when `clashes(i)` is true, so the clash is heard the moment a digit goes in.
- Visually, a clash also gets an underline, so colour is no longer the only cue:

```css
.play-board .cell.clash{text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:.12em}
```

## 4. Clues in announcements (P1)

### 4.1 What is spoken when

An arrow move speaks `cellLabel(to)` followed by `clueText(to, from)`. To keep each move short, a clue that belongs to a whole cage, region, run or line is spoken only when the move enters a different one. Clues between neighbours are spoken on every move, since they change on every move.

Three new keys, handled in the board's `keydown`:

| Key | Speaks |
|---|---|
| `I` | `cellLabel(sel)` + the full clue text for the cell, everything in §4.2's "full" column |
| `R` | the current row, cell by cell: `Rivi 3: 5, tyhjä, 2, …` |
| `S` | the current column, the same way: `Sarake 5: …` |

`R` and `S` read values for digit types, marks for shading types (`väritetty`, `rasti`, `ympyröity`, `tyhjä`), and `vihje` for kakuro black cells. In sillat they do nothing.

### 4.2 Per type

Write `clueText(i, from)` in play.js, with `from = -1` meaning "full" (the `I` key). Data is on `P.item`, as decoded by codec.js:

| Type | Data | On a move | Full (`I`) |
|---|---|---|---|
| sudoku9, sudoku6 | – | nothing | nothing |
| diagonal | `spec.diagonals`; on a diagonal when `r === c` or `r + c === n - 1` | `Lävistäjällä.` when on one | same |
| jigsaw | `spec.regionMap[i]` | `Alue 4.` when the region changes | `Alue 4: ` + its cells as `rivi 1 sarake 1, rivi 1 sarake 2, …` |
| killer | `cages[cageOf[i]]` = `{cells, sum}` | `Häkki 15, 3 ruutua.` when the cage changes | `Häkki 15, 3 ruutua: ` + the cells as above |
| kropki | `dots` = `{a, b, type}` for every adjacent pair; `type` is `white`, `black`, `both` or `none` | `Pallot: oikealla valkoinen, alhaalla musta.` or `Ei palloja.` | same; a missing dot is also a clue, so this is said every time |
| futoshiki | `cons` = `{a, b, dir}`; the value at `a` is smaller than at `b` (check against `renderFutoshiki`, where `con.a === con.lo` draws `<`) | `Pienempi kuin oikea naapuri, suurempi kuin ylempi.` or `Ei merkkejä.` | same |
| skyscrapers | `clues.top/bottom/left/right`, `null` where hidden | `Rivin vihjeet: vasemmalla 3, oikealla ei vihjettä.` when the row changes; `Sarakkeen vihjeet: ylhäällä 2, alhaalla 1.` when the column changes | both |
| kakuro | `runs` = `{dir, clue, cells, sum}`; a white cell is in one `h` and one `v` run | `Vaakasumma 16, 2 ruutua.` / `Pystysumma 7, 3 ruutua.` for each run that changed | both |
| nonogram | `rowClues[r]`, `colClues[c]` (arrays) | `Rivin vihje 2, 1, 4.` when the row changes; `Sarakkeen vihje 3.` when the column changes | both; an empty line's clue is `[]` and is spoken `Rivillä ei väritettäviä.` |
| hitori, hashi | – | nothing | nothing |

Neighbour words: `oikealla`, `vasemmalla`, `ylhäällä`, `alhaalla` for kropki; `oikea naapuri`, `vasen naapuri`, `ylempi`, `alempi` for futoshiki. `both` is `yhdistelmä`, the rules' own term.

The first move onto the board (`from` unset) speaks every line, cage, region and run clue of that cell, as `I` does.

As built: a one-cell killer cage is `1 ruutu`, not `1 ruutua`. In hitori, `R` and `S` keep each cell's digit (`5, 2 väritetty, 3 ympyröity`), since the digits are the puzzle there; the nonogram reads marks only. A move is spoken as the cell label, a full stop and the clues: `Rivi 1, sarake 4: tyhjä. Häkki 18, 3 ruutua.`

## 5. Contrast (P3–P9)

### 5.1 Tokens

Add one token and change four values in `:root` and in both dark blocks (`@media (prefers-color-scheme:dark)` and `:root[data-theme="dark"]`). All ratios are against the surfaces they sit on, checked in both themes.

| Token | Light | Dark | Was | Fixes |
|---|---|---|---|---|
| `--grid-thin` | `#7F8B95` | `#6B7A86` | `#DCE2E7` / `#33404B` | P7 thin grid lines 3.48 / 3.42:1; P6 input, stepper and textarea borders 3.27 / 3.42:1 on `--surface-2` |
| `--edge` (new) | `#7A858F` | `#72818C` | – | P5 selected segment outline, P6 switch off track; a step darker than `--grid-thin`, so it also clears 3:1 on the top bar's `--fill-strong` track (3.02:1 in both themes) |
| `--shade-ink` (new) | `#A9B4BC` | `#4E5B66` | `--ink-soft` | P3 hitori shaded digit 7.8 / 5.7:1 |

`--grid-thin` is also used by the hashi dots, the own-image canvas border, the QR box outline in Jaa ja jatka and the kakuro and hitori cell borders; all darken with it, which is intended. Thick grid lines stay distinct by width and by 10–12:1. If the darker thin lines look too heavy, see §10, decision 2.

### 5.2 Rules

```css
/* P5: the selected segment needs a 3:1 edge against the track */
.seg button[aria-pressed="true"]{box-shadow:var(--shadow-1),inset 0 0 0 1.5px var(--edge)}
/* P6 */
.switch i{background:var(--edge)}
/* P3 */
.play-board .cell.mk-shade{color:var(--shade-ink)}
/* P4: 4.9:1 light, 5.8:1 dark; the button stays active, so it must stay readable */
.pad button.used{opacity:.65}
/* P9: the line-through carries the state, --ink-soft alone is 5.4:1 */
.play-board .ngram .clue span.done{opacity:1}
```

Edit the existing rules rather than appending overrides. P8 (given vs entered digits) is §7.

The dark theme's `--shadow-1` becomes `0 0 #0000` instead of `none`: the P5 rule lists it beside the inset edge, and a list holding `none` is invalid, which would drop the edge in dark.

## 6. Layout (P11, P12)

- **P11**: at 320 px the A4 preview overflows by 27 px. Add `@media screen and (max-width:359px){.sheet{zoom:.36}}` after the 600 px rule. Screen only, so print is untouched.
- **P12**: on a phone in play mode, `body.playing .brand` is `display:none`, so the page has no `h1`. Hide it visually instead, with the same clip pattern as `.sr`, so it stays in the tree.

## 7. Names and minor cues (R3, P8, P10)

- **R3, pad buttons**: label `{n}, jäljellä {k}` instead of `Numero {n}, jäljellä {k}`, so the name starts with exactly the visible digit. In notes mode keep `Muistiinpano {n}`. axe reads the stacked digit and count as one word ("14"), which no name contains, so the count is drawn by CSS from `data-left` on the `small`; the button's text is then the digit alone, and the count is still in the name.
- **R3, Pulmatyyppi row**: remove `aria-label` from `#type-row` and `aria-hidden` from `.tr-go`, so the name is the visible text: "Pulmatyyppi Sudoku 9 × 9 Vaihda".
- **P8**: given digits `font-weight:600` → keep; entered digits 500 → 400, so the two differ by more than colour. The mono font is loaded at 400, 500 and 600, so do not use 700.
- **P10**: print renderers label each grid `{tyyppi}, tehtävä {k}` and each solution `{tyyppi}, ratkaisu {k}` instead of `Tehtäväruudukko` / `Ratkaisu`. Attributes only; the snapshot must stay clean.

## 8. Testing

### 8.1 Existing

- `node tests/run.js` stays green. No generator or codec changes are expected.
- `node tools/print-snapshot.mjs --compare <baseline>` clean, light and `--scheme dark`. Make the baseline on `main` before phase 1.

### 8.2 New: `tools/a11y-check.mjs`

Playwright, loaded the way `print-snapshot.mjs` loads it, plus axe-core 4 (`import("axe-core")`, else the global install; if missing, print `npm i -g axe-core` and exit 1). Seeded `Math.random` as in the snapshot tool. It checks three things and exits 1 on any failure:

1. **axe** with tags `wcag2a, wcag2aa, wcag21a, wcag21aa`, in light and dark, at 1280 × 900 and 375 × 740: print mode empty and generated; play mode for all 12 types; each overlay open (Uusi tehtävä, Jaa ja jatka with codes open, Omat tehtävät, Pulmatyyppi; Säännöt at phone width only, its button is hidden on desktop). Zero violations. The audit's baseline was `aria-prohibited-attr` and `label-content-name-mismatch` on every play state.
2. **Contrast tokens**: parse the `:root` and dark token values from `styles/styles.css` and assert the pairs in the audit's contrast table, including the new ones from §5. This catches a future token change that axe cannot see on an unrendered state.
3. **Announcements**: for each type, focus the board, press a scripted key sequence and assert `#play-sr` contains the expected words: the §4.2 clue words on a move and on `I`, the cell label after a digit, `Kumottu.` after Ctrl+Z, `ristiriita` after a clashing digit (sudoku9), `Muistiinpanot päällä` after `N`.

Also assert that `P` with focus on Tarkista does not pause, and that the 320 px page has no horizontal scroll in either mode.

### 8.3 Manual, by Pietari

After phase 3, on a real screen reader. Claude Code cannot do these; list them in the PR as unchecked boxes.

- [ ] NVDA + Firefox or Chrome on Windows: arrow keys reach the board without pressing Insert+Space; digits, `I`, `R`, `S` and `P` all work; solve one killer and one kakuro by ear.
- [ ] VoiceOver + Safari on macOS: the same.
- [ ] VoiceOver on iPhone: the board is reachable and the dock buttons are named. Touch solving by screen reader is not a goal (§11).

## 9. UI copy

New and changed strings, verbatim.

| Where | String |
|---|---|
| Board role description | pulmaruudukko |
| Board aria-label, digit types | {Sudokuruudukko / Ruudukko}. Liiku nuolinäppäimillä ja kirjoita numero. I kertoo ruudun vihjeet, R ja S lukevat rivin ja sarakkeen. |
| Board aria-label, hitori | Hitoriruudukko. Liiku nuolinäppäimillä, välilyönti vaihtaa ruudun tilaa. R ja S lukevat rivin ja sarakkeen. |
| Board aria-label, nonogram | Nonogrammiruudukko. Liiku nuolinäppäimillä, välilyönti värittää ja X merkitsee rastin. I kertoo vihjeet, R ja S lukevat rivin ja sarakkeen. |
| Key help (`#play-keys`), appended | `<kbd>I</kbd>` kertoo ruudun vihjeet, `<kbd>R</kbd>` ja `<kbd>S</kbd>` lukevat rivin ja sarakkeen. |
| Edits | Kumottu. · Muistiinpanot päällä · Muistiinpanot pois · , ristiriita |
| Row and column | Rivi {r}: … · Sarake {c}: … · vihje |
| Diagonal | Lävistäjällä. |
| Jigsaw | Alue {k}. · Alue {k}: rivi {r} sarake {c}, … |
| Killer | Häkki {summa}, {n} ruutua. · Häkki {summa}, {n} ruutua: rivi {r} sarake {c}, … |
| Kropki | Pallot: {suunta} {valkoinen / musta / yhdistelmä}, … · Ei palloja. |
| Futoshiki | Pienempi kuin {naapuri} · Suurempi kuin {naapuri} · Ei merkkejä. |
| Skyscrapers | Rivin vihjeet: vasemmalla {k}, oikealla {k}. · Sarakkeen vihjeet: ylhäällä {k}, alhaalla {k}. · ei vihjettä |
| Kakuro | Vaakasumma {summa}, {n} ruutua. · Pystysumma {summa}, {n} ruutua. |
| Nonogram | Rivin vihje {luvut}. · Sarakkeen vihje {luvut}. · Rivillä ei väritettäviä. · Sarakkeessa ei väritettäviä. |
| Pad buttons | {n}, jäljellä {k} |
| Print grid labels | {tyyppi}, tehtävä {k} · {tyyppi}, ratkaisu {k} |

## 10. Open decisions

Each has a default, which is what to build unless Pietari says otherwise.

1. **Application or grid** (§2.1). Default: `role="application"` with the live region. It leaves the renderers alone and keeps print safe. The ARIA grid pattern is more standard, but needs row wrappers in every renderer.
2. **Darker thin grid lines** (§5.1). Default: `#7F8B95` / `#6B7A86`, the lightest values that pass 3:1. If they read too heavy, the alternative is 1.5 px thin lines at a lighter value that still passes; never below 3:1.
3. **Striking nonogram clues by keyboard** (O2, minor). Default: not in this project. A keyboard path needs a design of its own; the clues are readable with `I`, `R` and `S`.

## 11. Phases

Each phase is one PR. Each ends with `tests/run.js` green, the print snapshot clean in both schemes, and `tools/a11y-check.mjs` passing for the checks that phase covers.

**Phase 1 – Check tool and contrast**
- Print baseline on `main` first, then `tools/a11y-check.mjs` (§8.2). Run it on `main` and paste its failures into the PR as the starting point.
- §5 tokens and rules, §6 layout, §3.2 underline, §7 P8.
- Closes P3, P4, P5, P6, P7, P8, P9, P11, P12, and the visual half of P2.

**Phase 2 – Board semantics and announcements**
- §2 in full, §3 in full, §7 R3.
- axe reports zero violations from here on.
- Closes R1, R2, R3, O1, P2.

**Phase 3 – Clues**
- §4: `clueText`, the `I`, `R` and `S` keys, the new board labels and key help (§9).
- The announcement checks in §8.2 for every type.
- Closes P1. Ask Pietari for the §8.3 manual checks before merging.

**Phase 4 – Print labels**
- §7 P10. Small; may ride along with phase 3 if that PR is not already large.

## 12. Out of scope

- Touch solving with a screen reader (VoiceOver or TalkBack gestures on the board).
- WCAG 2.2-only criteria. Targets already clear 2.2's 24 px (2.5.8); 2.5.5's 44 px is AAA and not a goal.
- Printed sheets, generators, codec, new puzzle types.
- A keyboard path for striking nonogram clues (§10, decision 3).
