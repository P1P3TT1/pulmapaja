# Ratkaise ruudulla – on-screen solving for Pulmapaja

Spec for adding on-screen solving to Pulmapaja. A generated puzzle can be solved in the browser, progress saves automatically, and the whole puzzle (optionally with progress) packs into a short code that works as a link.

The reference implementation for sudoku 9 × 9 is `docs/reference/ratkaisutila-preview.html`. It was reviewed and approved. Match its behaviour, codec and UI copy. Where this spec and the reference differ, this spec wins.

---

## 1. Ground rules

- **Vanilla JS, no build step, no frameworks.** The app must keep working when `index.html` is opened from disk (`file://`).
- **Classic scripts only.** Chrome blocks ES modules on `file://`. Use `<script src defer>` in a fixed order and share globals, as the app does today.
- **Generators stay untouched**, apart from the two refactors in §8. Play mode consumes what `buildOne` already returns.
- **UI copy is Finnish.** Use the en dash (–), never the em dash. Reuse the strings in §6 verbatim.
- **Style:** use the existing tokens and components in `styles/styles.css` (`.seg`, `.btn`, `.field`, `.note`, the mono labels, the desk grid background). Play mode adds a dark theme via `prefers-color-scheme`. The reference preview has the token values.
- **Print output must not change.** Every phase ends with the print flow behaving exactly as before.

## 2. Architecture

```
scripts/
  generators.js   pure: every make*/solve*/count* function, image processing, configs   (phase 0, split out of script.js)
  codec.js        bit packing, base64url, scramble, checksum, per-type codecs            (phase 1)
  play.js         play mode: board, controllers, undo, timer, share/open/saved UI        (phase 2+)
  store.js        localStorage wrapper                                                   (phase 2)
  script.js       TYPES, renderers, print UI (what remains after the split)
tests/
  run.js          Node test runner (node:vm, no dependencies)
tools/
  build-preview.mjs  builds the single-file artifact preview (§10)
```

Load order in `index.html`: `generators.js`, `codec.js`, `script.js`, `store.js`, `play.js`.

`generators.js` and `codec.js` must not touch the DOM at load time. `imageToGray` may use `document` inside its body because it is only called from the UI. This lets `tests/run.js` load both files into a `vm` context.

## 3. Code format

A code is base64url (`A–Z a–z 0–9 - _`, no padding) of:

```
byte 0     format version, currently 1
byte 1     flags: type (bits 0–3) | level (bits 4–5) | hasProgress (bit 6) | reserved 0 (bit 7)
bytes 2…   body, bit-packed MSB-first, byte-aligned at the end with zero bits, then scrambled
last byte  checksum over [byte0, byte1, …plain body]
```

The code goes after `#` in a URL with no escaping. All characters are in the set that survives as a plain fragment everywhere, including artifact links.

### 3.1 Primitives

Copy these unchanged from the reference preview: `BitWriter`, `BitReader`, `toB64`, `fromB64`, `scramble`, `checksum`. Codes made by the preview must keep decoding.

- **Scramble:** xorshift32 keystream seeded with `0x2F6B3A1D ^ (byte0 << 8) ^ byte1`, XORed over the body bytes. It is not encryption, only enough to keep solutions unreadable at a glance.
- **Checksum:** `h = 0x3C; for b: h = (((h << 3) | (h >>> 5)) & 255) ^ b`.

### 3.2 Type IDs and levels

| id | type | id | type |
|---|---|---|---|
| 1 | sudoku9 | 7 | futoshiki |
| 2 | sudoku6 | 8 | skyscrapers |
| 3 | diagonal | 9 | kakuro |
| 4 | jigsaw | 10 | hitori |
| 5 | kropki | 11 | hashi |
| 6 | killer | 12 | nonogram |

Level: 0 easy, 1 medium, 2 hard, 3 none (nonogram from a picture).

### 3.3 Versioning

- Never change an existing type's layout without bumping byte 0.
- Keep decoders for every older version forever. A code someone saved must keep opening.
- Adding a type id needs no version bump.

## 4. Payloads per type

The rule: **store what the clues are derived from, never the clues.** Decoding rebuilds the puzzle with the app's own derivation functions, so a code cannot contradict itself.

Digits are always 4 bits, whatever the grid size. Sizes are stored where a type has more than one. Cells are in reading order (`i = r * n + c`).

| Type | Puzzle payload, in order | Rebuild with |
|---|---|---|
| sudoku9, diagonal | solution 81×4 · givens mask 81×1 | `buildSpec(kind)` |
| sudoku6 | solution 36×4 · givens 36×1 | `buildSpec("sudoku6")` |
| jigsaw | region id per cell 81×4 · solution 81×4 · givens 81×1 | `buildSpec("jigsaw", regionMap)` (§8) |
| kropki | solution 81×4 · givens 81×1 | dots: every pair in `allAdjacentPairs(9)` with `kropkiDotType(sol[a], sol[b])` |
| killer | solution 81×4 · givens 81×1 · cage joins 81×2 (bit 1 "same cage as right neighbour", bit 0 "same cage as cell below") | cages = connected components over the joins, sorted by first cell; sum from solution; `cageOf` from that order (matches `killerCages` output) |
| futoshiki | n−5 as 1 bit · solution n²×4 · givens n²×1 · shown-sign mask, one bit per pair in `allAdjacentPairs(n)` order | each shown pair `[x, y, dir]` → `sol[x] < sol[y] ? {a:x, b:y, dir, lo:x} : {a:y, b:x, dir, lo:x}` |
| skyscrapers | n−3 as 3 bits · solution n²×4 · givens n²×1 · clue-shown mask 4n bits (top, bottom, left, right; k = 0…n−1) | `skyClues(sol, n)`, then `null` where not shown; `buildSpec("latin" + n)` |
| kakuro | size−4 as 4 bits · black mask size²×1 · digit per white cell ×4 | `buildRuns(black, size)`, sums from the digits |
| hitori | n−4 as 3 bits · value per cell n²×4 · shaded mask n²×1 | `shaded[i] = mask ? BLACK : WHITE` |
| hashi | n as 4 bits · island mask n²×1 · weight per edge ×2 | islands in reading order; `edges = hashiEdges(islands, n)`; weights in edge order; `k` = sum of weights per island |
| nonogram | n as 6 bits · fill bitmap n²×1 | `nonogramClues(fill, n)` |

Picture nonograms use the same payload with level 3. The picture itself is never stored.

### 4.1 Progress payload (when bit 6 is set)

Appended after the puzzle payload.

| Controller | Types | Per cell / item |
|---|---|---|
| digits | sudoku family, kropki, killer, futoshiki, skyscrapers, kakuro | For every editable cell (not a given, not a kakuro black cell): value 4 bits. Then for every editable cell still empty: 1 bit "has notes", plus d bits of notes if set (d = the type's digit range). |
| shading | hitori | 2 bits per cell: 0 empty, 1 shaded, 2 circled |
| shading | nonogram | 2 bits per cell: 0 unknown, 1 filled, 2 X |
| bridges | hashi | 2 bits per edge: 0, 1 or 2 bridges |

The timer is not in the code. It lives only in local storage.

### 4.2 Decoding

Check in this order, and throw a Finnish message the UI shows as is:

| Check | Message |
|---|---|
| empty input | Liitä ensin koodi. |
| characters outside base64url (after taking the part after the last `#` and stripping whitespace) | Koodissa on merkkejä, jotka eivät kuulu siihen. Tarkista, että kopioit koko koodin. |
| fewer than 4 bytes, or the reader runs out | Koodi on liian lyhyt. Siitä puuttuu osa. |
| unknown version | Koodi on tehty uudemmalla versiolla ({v}). Päivitä sovellus. |
| unknown type id | Koodi on pulmatyyppiä, jota tämä versio ei tunne. |
| checksum mismatch | Koodi on vaurioitunut tai siitä puuttuu merkkejä. Kopioi se uudelleen. |
| solution breaks the type's rules (unit check for digit types; clue consistency for the rest) | Koodin ratkaisu ei ole kelvollinen. |

Return the same item shape `buildOne` returns for that type, plus `{type, level, progress}`. Existing renderers can then draw a decoded puzzle unchanged.

## 5. Storage

`store.js` wraps `localStorage`. Every call sits in try/catch, and the app works fully without storage.

- Key per puzzle: `pulmapaja.play.<puzzle-only code>` → `{progress: <code with progress>, type, level, elapsed, done, filled, total, updated}`
- Index: `pulmapaja.play.index` → array of puzzle codes, most recent first, capped at 20. Delete the records that fall off.
- Last opened: `pulmapaja.play.last`

**Save** after every move, every 5 s of timer, and on `visibilitychange` to hidden.

**Opening a puzzle-only code** resumes the stored record if there is one ("Jatketaan siitä, mihin jäit tässä selaimessa."). Otherwise it starts fresh ("Tehtävä avattu koodista.").

**Opening a code with progress** takes the code's state as newer. Keep the stored `elapsed` if present ("Tehtävä ja edistyminen avattu koodista.").

## 6. Play mode UI

### 6.1 Entry

- **New field at the top of the rail:** label "Käyttötapa", segmented control "Tulosta | Ratkaise ruudulla", stored as `state.mode`.
- **Hidden in play mode:** tehtävien määrä, tehtäviä sivulla, otsikko, "Liitä ratkaisut loppuun", the Tulosta button, the PDF hint. Follow the existing `syncMode()` pattern.
- **Still visible:** type, level, source / own picture, symmetry.
- **Generate button** reads "Luo tehtävä" in play mode. It builds one puzzle with `buildOne`, or `makeNonogramFromImage` for the picture source.
- **Main area** shows the play view instead of sheets. On wide screens the board panel sits left and an info column right; on narrow screens they stack. The reference preview shows the look.
- **The rules paragraph** (`#rules`) stays visible in play mode. Players need it.

### 6.2 Board panel

- **Header:** type name, level tag (or "n × n" for picture nonograms), timer `m:ss` (or `h:mm:ss`).
- **Board:** draw with the existing renderer, so dots, cages, sums, edge clues and inequality signs look as on paper. Set `--cell` in px with `clamp(…)` to fit the viewport. Make cells interactive.
- **Controller area** (§6.3) and a tool row: "Muistiinpanot" (digit types only), "Pyyhi", "Kumoa", "Tarkista".
- **Status line** (`role="status"`).
- **Keyboard help line**, per controller.
- **Completion:** when solved, show a green banner "Ratkaistu ajassa {aika}. Hienoa!", stop the timer and lock input.

### 6.3 Controllers

**Digits.** Used by the sudoku family, kropki, killer, futoshiki, skyscrapers and kakuro.

- Select a cell by tap or click; move with arrow keys. Only editable cells take input; kakuro black cells and givens never do.
- Number pad 1…d with the remaining count under each digit; a digit with none left is dimmed.
- Keys: `1`–`d` enter (on `e.code`, so Shift works), Shift + digit toggles a note, `N` toggles notes mode, Backspace / Delete / `0` erase, Ctrl/Cmd + Z undo.
- Entering the digit already in the cell clears it. Entering a digit clears the cell's notes and removes that digit from the notes of every peer.
- Highlighting: the selected cell, its peers lightly, and every cell with the same digit.
- A digit turns red automatically when the same digit appears twice in a unit: row, column, region, diagonal, killer cage or kakuro run. Inequalities, sums, dots and skyscraper views are not flagged automatically.

**Shading.** Used by hitori and nonogram.

- Hitori: a tap cycles empty → shaded → circled → empty.
- Nonogram: a mode toggle "Väritä | Rasti". Drag paints along a single row or column, and the drag takes its action from its first cell (fill, X or clear). Keyboard: arrows, Space fills, `X` crosses, Delete clears.
- Nonogram clue numbers can be tapped to strike them through as done. This is local UI only and not stored.

**Bridges.** Used by hashi.

- Drag from one island to a neighbouring island (or tap two islands) to cycle that edge 0 → 1 → 2 → 0.
- Refuse a bridge that would cross an existing one, with the status message "Silta ei voi ylittää toista siltaa."
- An island whose bridge count matches its number turns muted.

### 6.4 Tarkista

**Never highlight cells.** Report only the count.

- Errors: "{n} merkintä on väärin." / "{n} merkintää on väärin."
- No errors, digit types: "Kaikki merkinnät ovat oikein. {m} ruutua jäljellä."
- No errors, shading and bridge types: "Kaikki merkinnät ovat oikein."

What counts as an error:

- Digits: a filled cell that differs from the solution.
- Hitori: a cell shaded but white in the solution, or circled but shaded in the solution.
- Nonogram: a cell filled but empty in the solution, or X'd but filled in the solution.
- Hashi: an edge with more bridges than the solution has.

**Solved when** the digits equal the solution, the hitori shading equals the solution (circles ignored), the nonogram fills equal the bitmap (X ignored), or the bridge weights equal the solution.

### 6.5 Info column

Labels, notes and buttons come from the reference preview:

- **Jaa ja jatka:**
  - "Tehtävä": the puzzle-only code, with the note "Ystävä saa saman tehtävän tyhjänä."
  - "Tehtävä ja edistyminen": the code with progress, with the note "Jatka toisella laitteella siitä, mihin jäit. Koodi päivittyy jokaisen siirron jälkeen."
  - Each code has a character count and a "Kopioi" button. Use `navigator.clipboard`; if it rejects, select the text and show "Valittu – kopioi itse".
- **Avaa koodilla:** a textarea that accepts a bare code or a whole link, an "Avaa tehtävä" button, and an inline error from §4.2.
- **Tallennetut tässä selaimessa:** type name and level, a progress bar, `filled/total · aika · milloin`, "Avaa" and "Poista". The current puzzle shows "auki", and solved ones show "ratkaistu".
- **Mitä koodissa on** is a reviewer aid in the reference. Keep it out of the production UI, but keep the function that computes the segment sizes and expose it on `window.PulmapajaCodec` for debugging.

### 6.6 Hash routing

- **On load:** if `location.hash` holds a code (base64url, at least 20 characters), switch to play mode and open it. If decoding fails, stay in print mode and show the §4.2 message in the status line.
- **While playing:** keep the puzzle-only code in the hash with `history.replaceState`, so bookmarking or reloading resumes. Wrap it in try/catch.
- **Leaving play mode** clears the hash.

### 6.7 Accessibility

- The board container is focusable with a visible focus ring.
- Each cell has an `aria-label` such as "Rivi 3, sarake 5: tyhjä, muistiinpanot 2, 7". Arrow moves announce through a visually hidden live region.
- Pad and tool buttons have labels, and the notes toggle uses `aria-pressed`.
- Respect `prefers-reduced-motion`.

## 7. Phases

Each phase is one PR. Each ends with `node tests/run.js` green, print output unchanged, and a preview (§10) where marked.

**Phase 0 – Split generators out of `script.js`**
- Move every pure function and config into `scripts/generators.js`. Behaviour stays identical.
- Add `tests/run.js` with a smoke test that generates one puzzle of every type and level at least once.
- No preview.

**Phase 1 – Codec for all twelve types**
- `scripts/codec.js` per §3–4.
- Tests for every type and level:
  - generate → encode puzzle-only → decode → the item matches field by field, with derived clues equal to the generator's;
  - add random progress → encode → decode → progress matches;
  - flipping any one character is rejected;
  - truncation is rejected;
  - the reference preview's sample codes still decode (fixtures in `tests/fixtures/preview-codes.json`, generated by running the reference page's `encode`).
- Print the code length per type and level in the test output.
- No preview.

**Phase 2 – Play mode with sudoku 9 × 9**
- Mode switch, board, digit controller, undo, timer, Tarkista, completion, storage, share/open/saved, hash routing.
- Functionally equal to the reference preview.
- **Preview.**

**Phase 3 – Other digit types**
- sudoku6, diagonal, jigsaw, kropki, killer, futoshiki, skyscrapers, kakuro.
- **Preview** that opens on a killer puzzle.

**Phase 4 – Shading controller**
- Hitori and nonogram, including picture nonograms.
- **Preview** that opens on a medium nonogram.

**Phase 5 – Bridge controller**
- Hashi.
- **Preview** that opens on an easy hashi.

**Phase 6 – Print ↔ screen bridge**
- When the constant `PLAY_BASE_URL` in `script.js` is non-empty, each printed puzzle gets a small QR code (≈ 14 mm, bottom right of the puzzle) linking to `PLAY_BASE_URL + "#" + puzzleCode`.
- Vendor a QR library into `scripts/vendor/` so it works offline. No CDN at runtime.
- Default `PLAY_BASE_URL` is empty, so print output is unchanged until Pietari sets it.
- **Preview** with a test URL set.

**Hosting** is Pietari's decision and outside these phases. GitHub Pages serves the repo as is. Add an empty `.nojekyll` in phase 2 so Pages works the day it is switched on.

## 8. Required changes to existing code

1. **`buildSpec(kind, regionMap)`**: when `kind === "jigsaw"` and `regionMap` is given, use it instead of calling `jigsawRegions()`. `jigsawSpec()` keeps calling it without the argument.
2. **Renderers in play mode** take the same item; play mode passes progress values in place of `item.puz` / `item.puzzle` and decorates cells afterwards. If a renderer needs a small hook to make that clean (for example, returning the cell elements in reading order), add it. Never fork a renderer.
3. **`syncType()` / `syncMode()`** learn about `state.mode`.
4. **`generate()`** branches to play mode before any sheet building.

## 9. Testing

`tests/run.js` uses only Node built-ins:

- Create a `vm` context with `console` and `Math`.
- Run `generators.js` and then `codec.js` in it.
- Run the cases and print one line per case, ending with a summary. Exit code 1 on any failure.

Seed nothing: generators use `Math.random`. For flaky-looking failures, loop each case 20 times.

## 10. Artifact previews

Pietari reviews each UI phase as a published artifact before merging. The reviewer opens the preview link on desktop and phone.

### 10.1 Build

`node tools/build-preview.mjs --open <type>:<level>` writes `previews/pulmapaja-preview.html` (`previews/` is gitignored). It:

1. Reads `index.html`. Inlines `styles/styles.css` into one `<style>`. Inlines every local `<script src>` in load order into one `<script>` at the end of the markup.
2. Drops `<!DOCTYPE>`, `<html>`, `<head>` and `<body>` wrappers; the artifact host adds its own skeleton. Keeps `<title>Pulmapaja</title>`, the Google Fonts links and all markup.
3. Injects, before the app script: `window.PULMAPAJA_PREVIEW = {mode: "play", open: "<type>:<level>"}`. On load, the app then starts in play mode with a fresh puzzle of that type and level, so the first frame shows the phase's work. A `#code` in the URL still wins.
4. Injects a CSS rule hiding `#print` and the PDF hint. The artifact viewer cannot open the print dialog.

### 10.2 Publish

- Load the `artifact-design` skill before the first publish and follow its page contract. The build output already meets the main points: one file, fonts from Google Fonts only, nothing else external.
- Publish `previews/pulmapaja-preview.html` with the Artifact tool. Reuse the same file path every phase so the link stays the same and each phase becomes a new version. Icon `puzzle`. Description: "Pulmapaja – vaihe {n}: {mitä uutta}".
- In the PR description and the final message, say which phase the preview shows and what to try (for example: "Avaa Killer, kirjoita muutama numero, kopioi edistymiskoodi ja avaa se uudessa välilehdessä").
- **If the Artifact tool is not available in your session**, still run the build. Say that `previews/pulmapaja-preview.html` is ready to open locally, and do not claim it was published.

### 10.3 What works in the artifact frame

- **Works:** `localStorage` (per viewer, try/catch is already required), clipboard writes from a click, and opening `…/artifact/<id>#<code>`, since base64url is a plain fragment.
- **Does not work:** printing. Keep the print button hidden there.

## 11. Out of scope

- Accounts, server sync, leaderboards.
- Hiding the solution from a determined user. The scramble is cosmetic.
- Hints beyond Tarkista.
- Mixed puzzle sets in play mode. It is one puzzle at a time.
