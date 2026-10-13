# UI-uudistus – modern look and mobile-first play for Pulmapaja

Spec for restyling Pulmapaja and reworking the play-mode layout. It comes from one problem: on a phone, Ratkaise ruudulla stacks the whole settings rail, the board and the share/open/saved column into one long page. You scroll down to the puzzle, you can scroll past it, and you scroll back up to make a new one. A printed QR code opens to the settings, with the board below the fold.

The fix has two halves:

- **A layout where the board is the screen.** A compact top bar, the board sized to the viewport, the pad and tools pinned at the bottom. Everything else opens on demand as an overlay.
- **A modern visual language** across the whole app: rounded surfaces, soft shadows, pill controls. Printed sheets keep their look.

**Visual reference:** the design canvas "Ratkaise ruudulla – mobiili" (claude.ai/artifact/5WuhxD5JJ9mr2wz7XqAm6n), rows labelled **B**. Row A is the superseded first draft. Where the canvas and this spec differ, this spec wins. The canvas is private to Pietari; ask him to share it if you cannot open it, and work from this spec meanwhile.

| Board | Shows |
|---|---|
| B1 | Play view, phone |
| B2 | Uusi tehtävä overlay |
| B3 | Jaa ja jatka overlay |
| B4 | Omat tehtävät overlay |
| B5 | Type picker |
| B6 | Desktop play view with the Jaa popover |

---

## 1. Ground rules

Everything in `docs/ratkaise-ruudulla.md` §1 still holds: vanilla JS, classic scripts, works from `file://`, Finnish UI with the en dash (–), never the em dash.

On top of that:

- **Print output must not change.** Not one pixel of a printed or PDF-saved sheet. The `.sheet` A4 previews keep their square corners, hairlines and paper white in both themes. §9 adds a check for this.
- **Behaviour does not change** unless this spec says so. Controllers, codec, storage, Tarkista and hash routing work as today. This is a layout and style project.
- **One set of controls.** The rail's fields (type, level, source, picture, symmetry, generate) exist once in the DOM. Play mode moves those nodes into the Uusi tehtävä overlay with `appendChild` and moves them back on leaving. Never clone them, so ids and listeners stay intact.
- **The class name `.sheet` is taken** by the A4 pages. Overlays use `.overlay`.
- **No new runtime files** unless unavoidable. If one is added, add it to `SHELL` in `sw.js` and bump `VERSION`.

## 2. Tokens

Add these to `:root` in `styles/styles.css` and use them in every new or restyled rule. Existing tokens keep their names. Where a value changes, the old value was play-only (checked: `--grid-thin`, `--grid-thick` and `--selbg` are used only under `.play-board`).

### 2.1 Shape and depth

| Token | Value | Used for |
|---|---|---|
| `--r-xs` | `6px` | futoshiki cells, small chips |
| `--r-sm` | `12px` | inputs, textareas, play grid outer corner, copy buttons |
| `--r-md` | `16px` | tiles, tool buttons, pad keys (14–16 px) |
| `--r-lg` | `22px` | cards, the board card, popovers |
| `--r-overlay` | `28px` | top corners of bottom sheets |
| `--r-pill` | `999px` | pills, segmented tracks, round icon buttons |
| `--shadow-1` | `0 1px 2px rgba(22,32,43,.06), 0 4px 14px rgba(22,32,43,.06)` | top-bar pills, floating buttons |
| `--shadow-2` | `0 1px 2px rgba(22,32,43,.05), 0 10px 30px rgba(22,32,43,.08)` | board card, side cards |
| `--shadow-3` | `0 2px 6px rgba(22,32,43,.08), 0 18px 48px rgba(22,32,43,.18)` | popovers, dialogs, sheets |
| `--scrim` | `rgba(22,32,43,.36)` | backdrop behind overlays |

### 2.2 Colour

| Token | Light | Dark | Notes |
|---|---|---|---|
| `--bg` | `#EEF1F4` | `#10161C` | app background; replaces the desk grid on screen (§10, decision 1) |
| `--surface` | `#FFFFFF` | `#19212A` | cards, bars, overlays |
| `--surface-2` | `#F6F8FA` | `#1E2730` | tiles, inset rows, secondary action cards |
| `--fill` | `#EEF1F4` | `#232D37` | pad keys, round close buttons |
| `--fill-strong` | `#E2E7EC` | `#2C3742` | segmented tracks on `--bg`, chips |
| `--blue-soft` | `#E3ECF8` | `#22364E` | was `#DEE8F5`; selected tiles, icon badges |
| `--selbg` | `#CFE0F5` | `#36547A` | selected cell, plus a 2 px inset ring in `--blue` |
| `--peer` | `#F2F6FB` | `#222D38` | |
| `--grid-thin` | `#DCE2E7` | `#33404B` | lighter than today |
| `--grid-thick` | `#2A3540` | `#C9D3DA` | |

`--ink`, `--ink-soft`, `--line`, `--hair`, `--blue`, `--green`, `--green-soft`, `--red` keep their values.

**Shadows in the dark theme** barely show. Set `--shadow-1` and `--shadow-2` to `none` there and let `--surface` against `--bg` separate the layers. `--shadow-3` becomes `0 18px 48px rgba(0,0,0,.5)`.

### 2.3 Type

Fonts stay: Space Grotesk for UI, IBM Plex Mono for digits, the clock and codes. Add weight 600 to the Google Fonts link.

The mono uppercase micro-labels (`.field > .label`) become sentence-case labels: 13 px, weight 600, `--ink-soft`. The mono face stays for digits, times, character counts and codes.

## 3. Components

Restyle these once; every screen uses them.

- **Button (`.btn`)**: primary is `--blue` on white text, pill, 50–54 px tall in overlays and 44 px in bars, with a soft blue shadow (`0 6px 18px rgba(30,95,168,.28)`). Ghost is `--fill` with `--ink` text, no border.
- **Segmented control (`.seg`)**: a `--fill` track (`--fill-strong` when it sits on `--bg`), pill, 4 px padding and gap. The pressed button is a white pill with `--shadow-1` and weight 600, and the others are transparent. The semantics stay `aria-pressed` buttons. Today's blue fill for the pressed state goes away.
- **Switch**: replaces `.check` checkboxes in overlays. It is a `<button role="switch" aria-checked>` row on `--surface-2`, 52 px tall with `--r-md`, with the label left and a 46 × 28 track right (`--blue` when on). The checkbox it replaces stays in the DOM, visually hidden, as the source of truth, so `el("opt-symmetry").checked` keeps working. In print mode's rail, plain checkboxes may stay.
- **Round icon button**: 36–48 px, pill, `--surface` with `--shadow-1` on `--bg`, or `--fill` on `--surface`. Each one needs an `aria-label`.
- **Action card**: used in the Jaa overlay. An icon badge (38–44 px, `--r-sm`, tinted) with a title and a one-line note, padded 12–16 px with `--r-lg`. The primary card is `--blue` with white text, and the others are `--surface-2`.
- **List group**: rows inside one `--surface` card with `--r-lg`, separated by 1 px `--fill` lines and at least 48 px tall.
- **Progress ring**: a 40 px SVG with a 4 px stroke, `--fill-strong` track and `--blue` arc (`--green` with a ✓ when solved), and the percentage in the middle. It replaces `.saved .bar`.
- **Inputs and textareas**: `--surface-2` (or `--surface` inside a `--surface-2` box), 1 px `--grid-thin` border, `--r-sm`.
- **Overlay (`<dialog class="overlay">`)**: opened with `showModal()`, which gives Esc to close, a focus trap and `::backdrop` (`--scrim`). Clicking the backdrop closes it. On close, focus returns to the button that opened it. The layout is in §5.4.

## 4. The board

- The board sits in a **board card**: `--surface`, `--r-lg` (26 px on desktop), 10 px padding (14 px on desktop), `--shadow-2`.
- A grid that is one bordered block (`.grid`, `.kgrid`, `.hgrid`, the nonogram play grid) gets `border-radius: var(--r-sm)` and `overflow: hidden`. A 2–2.5 px outer border uses `--grid-thick`, and the box lines use the SVG overlay as today.
- Futoshiki's separate cells each get `--r-xs`. Hashi has no grid border, so it only gets the card.
- **Selected cell**: `--selbg` plus `box-shadow: inset 0 0 0 2px var(--blue)`. Shaded and bridge controllers keep their current selection marks.
- **Sizing is done in JS**, because the space left for the board depends on the controller: hashi has no pad, and a nonogram has a mode toggle. Put a `ResizeObserver` on the stage element (§5.1). On each change:
  1. Measure the board at the current `--cell`.
  2. Set `--cell` to `floor(cell × min(availW / boardW, availH / boardH))`.
  3. Clamp it to 22–54 px (22–56 px on wide screens).

  One pass is enough because every renderer scales linearly with `--cell`. This replaces the `clamp(…100vw…)` formulas on `.play`.

## 5. Play mode, compact (< 700 px wide)

### 5.1 Structure

`body.playing` on a compact screen is a fixed-height column with no page scroll (`height: 100dvh; overflow: hidden`):

```
.topbar     56–64 px   title pill · Jaa · menu
.stage      flex 1     clock row · board card · status line      ← ResizeObserver
.dock       auto       mode toggle (nonogram) · tools · pad
```

The rail is hidden. Its fields live in the Uusi tehtävä overlay (§1).

### 5.2 Top bar (B1)

- **Title pill** (flex 1, 48 px): the type mark, the type name, a level chip (`--green-soft`/`--green`; "n × n" for picture nonograms) and a chevron. Its `aria-label` is "{tyyppi}, {taso}. Vaihda pulmaa tai luo uusi." It opens Uusi tehtävä.
- **Jaa**: a round icon button that opens Jaa ja jatka.
- **Menu**: a round icon button, `aria-label` "Omat tehtävät", that opens Omat tehtävät.

The brand mark moves into the title pill. The lede paragraph does not appear in play mode.

### 5.3 Stage and dock

- **Clock row** above the board card: on the left, the clock as a pill button with a pause glyph (§6), and on the right, a "Säännöt" pill that opens a small overlay with `TYPES[type].rules`. The rules paragraph is no longer inline on compact screens.
- **Status line** under the card: today's `#play-status`, 12.5 px, `--ink-soft`. The done banner replaces it when solved.
- **Dock**: `--surface` with `--r-overlay` top corners and an upward shadow (`0 -6px 24px rgba(22,32,43,.06)`). From top to bottom it holds:
  - the nonogram "Väritä | Rasti" segmented control, when present;
  - the tool row, four equal buttons with a 22 px icon above a 12 px label (Muistiinpanot, Pyyhi, Kumoa, Tarkista);
  - the pad, 9 keys in `--fill` with `--r-md`, about 60 px tall, the digit in mono with the remaining count under it.

  The order matches B1: tools above the pad, so the pad sits nearest the thumb. Bridges show the tool row only. The keyboard help line (`#play-keys`) is hidden on compact screens.
- **Tool icons** are inline SVG in the markup, stroke `currentColor`, 1.9 px. Their shapes are on the canvas.

### 5.4 Overlays on compact screens

They are bottom sheets: full width, anchored to the bottom, `--surface`, `--r-overlay` top corners, `--shadow-3`, a 40 × 5 px grabber, `max-height: calc(100dvh - 28px)`, scrolling inside. The header holds an h2 (21 px, weight 700) and a round close button with `aria-label` "Sulje". Each slides up in about 180 ms, and does not animate under `prefers-reduced-motion`.

**Uusi tehtävä (B2).** From top to bottom:
1. Käyttötapa: "Tulosta | Ratkaise ruudulla". Choosing Tulosta closes the overlay and leaves play mode, as the switch does today.
2. Pulmatyyppi row (§7): the type's icon, the label "Pulmatyyppi", the type name, and "Vaihda ›".
3. The source and picture fields for nonograms, as today, restyled.
4. Vaikeustaso: a segmented control with three options.
5. "Symmetrinen ruudukko" switch, shown only where it applies today.
6. "Luo tehtävä": the primary button, full width.
7. The note "Nykyisen tehtävän edistyminen on tallessa Omissa tehtävissä."

"Luo tehtävä" closes the overlay first, then generates. A generation failure shows its message in the play status line, as today.

**Jaa ja jatka (B3).**
1. **Primary card "Jaa tehtävä"** with the note "Ystävä saa saman tehtävän tyhjänä." It calls `navigator.share({title: "Pulmapaja – {tyyppi}", url})` when that exists, and otherwise copies the URL and shows "Linkki kopioitu." Without `navigator.share` the title reads "Kopioi tehtävän linkki". If the user cancels the share sheet (`AbortError`), nothing happens.
2. **"Jatka toisella laitteella"** with the note "Linkki vie mukanaan edistymisesi." and a chip showing the progress percentage. It does the same as the primary card, with the progress code.
3. **"Näytä QR-koodi"** with the note "Skannaa tehtävä toisella puhelimella." It swaps the sheet's content for a large QR code of the puzzle-only URL, drawn with the vendored `qrcode.js` that phase 6 of the earlier spec added, and a "Takaisin" button.
4. **A pill "Edistyminen tallentuu automaattisesti."** in green, centred.
5. **Disclosure "Näytä koodit" / "Piilota koodit"** inside a `--surface-2` box. When open, it shows today's two code textareas with their character counts, each with a square copy icon button ("Kopioi tehtävän koodi", "Kopioi tehtävän ja edistymisen koodi"). The copy fallback "Valittu – kopioi itse" stays.

**The share URL** is `PLAY_BASE_URL + "#" + code` when `PLAY_BASE_URL` is set, and otherwise `location.href` without its hash, plus the code. A link from `file://` is useless to a friend.

**Omat tehtävät (B4).** The sheet itself is `--bg`, with list groups on it.
1. Label "Tallennetut tässä selaimessa" and a list group. Each row has a progress ring, the type name (15 px, weight 600) with a status chip ("Auki" in blue for the current puzzle, "Ratkaistu" in green), and a meta line "{taso} · {aika tai milloin}". On the right are a round "Avaa" chevron button and a "Poista" icon button, both with `aria-label`. The current puzzle's row has no Avaa. An empty list shows today's empty text.
2. Label "Avaa koodilla" and a card holding the textarea ("Liitä koodi tai koko linkki") and two buttons:
   - "Liitä" (ghost) reads `navigator.clipboard.readText()` into the textarea. Hide it where that is unavailable, and leave the field unchanged if it is refused.
   - "Avaa tehtävä" (primary).

   The inline error stays as today.

Opening a puzzle from either list closes the overlay.

## 6. Pause

- **The clock pill toggles the pause.** Its `aria-label` is "Tauko, käytetty aika {aika}" when running and "Jatka, käytetty aika {aika}" when paused, and the glyph swaps between pause and play. On desktop, the key `P` does the same.
- **While paused**, the board card's content is replaced by a centred panel: the heading "Tauko", the note "Ruudukko on piilossa tauon ajan." and a primary "Jatka" button. The dock is disabled (`inert`). The clock does not tick.
- **Opening any overlay pauses**, and closing it resumes, unless the player had paused already. Keep that as two flags (`P.paused` and `P.pausedByOverlay`) so they don't fight each other.
- **The tick guard** in `setInterval` gains `|| P.paused || P.pausedByOverlay`.
- **The pause is not saved.** A reopened puzzle starts running, as today.
- **A solved puzzle** has nothing to pause. The clock pill is not a button then.

## 7. Type picker and categories (B5)

### 7.1 Data

In `script.js`:

```js
const CATEGORIES = [
  {id: "sudoku",  label: "Sudokut"},
  {id: "numbers", label: "Numerot ja vertailut"},
  {id: "shading", label: "Ruutujen värittäminen"},
  {id: "connect", label: "Yhdistäminen"}
];
```

Every `TYPES` entry gains:
- `cat`: one of the ids above;
- `short`: a tile label. Long names get a soft hyphen: "Diagonaali­sudoku", "Palapeli­sudoku", "Pilven­piirtäjät";
- `icon`: an inline SVG string with `viewBox="0 0 36 36"`, stroke `currentColor` and accent parts in `var(--blue)`, so both themes work. Take the shapes from B5.

| cat | types |
|---|---|
| sudoku | sudoku9, sudoku6, diagonal, jigsaw, kropki, killer |
| numbers | futoshiki, skyscrapers, kakuro |
| shading | hitori, nonogram |
| connect | hashi |

A new type only needs a `cat`, a `short` and an `icon` to appear in the picker.

### 7.2 Recently used

- `PlayStore` gains `recent()` and `touchRecent(type)` under the key `pulmapaja.recent`: type ids, most recent first, at most 4, wrapped in try/catch like the rest.
- Creating or opening a puzzle in either mode calls `touchRecent`.
- **Update the comment block** at the top of `store.js`.

### 7.3 Picker

- **Overlay**: on compact screens a bottom sheet with `top: 28px`, so almost full height. On wide screens a centred dialog, 560 px wide and at most 80 vh tall, scrolling inside.
- **Header**: a round "Takaisin" button when opened from Uusi tehtävä, otherwise "Sulje", and the title "Pulmatyyppi".
- **"Viimeksi käytetyt"**: pills for the recent types. The current type is a blue pill with a ✓. Hide the section when the list is empty.
- **One section per category**: an h3 label and a 3-column grid of tiles (4 columns on wide screens).
  - A tile is a `<button aria-pressed>` on `--surface-2` with `--r-md`. It holds a 52 × 52 `--surface` icon box and the `short` label, 13 px, centred.
  - The current type is pressed: `--blue-soft` background, a 2 px inset ring in `--blue`, blue text in weight 600.
- **Choosing a type** sets `<select id="type">` (kept in the DOM, visually hidden, as the source of truth) and dispatches `change`, so `syncType()` runs as today. The picker then returns to Uusi tehtävä, or closes when opened from the print rail.
- **Search** is out of scope until there are more than about 20 types (§11).

### 7.4 Where the picker is used

- In **play mode**, from the Pulmatyyppi row in Uusi tehtävä.
- In **print mode**, the rail's type `<select>` is replaced visually by the same Pulmatyyppi row, which opens the picker.

## 8. Wide screens (≥ 700 px)

### 8.1 Top bar, both modes (B6)

One bar across the top, max width 1440 px, padded 18 px × 28 px. From left to right:

- the brand mark and "Pulmapaja" (22 px, weight 700);
- the Käyttötapa segmented control on `--fill-strong`;
- in play mode, the title pill and a primary "Uusi tehtävä" pill;
- a flexible gap;
- "Jaa" and "Omat tehtävät" as pills with icon and label (play mode only).

The bar wraps when it runs out of room. Käyttötapa moves out of the rail into the bar on wide screens. On compact screens it lives in Uusi tehtävä (§5.4).

### 8.2 Play layout

- `main` is a centred `flex-wrap` row with a 24 px gap: the board column, and a side column with flex `0 1 300px` and a minimum width of 260 px. When the side column does not fit, it wraps under the board, which covers tablets.
- **Board column**: the clock row with the status text on the right, then the board card.
- **Side column**, from top to bottom:
  - a card with the pad as a 3 × 3 grid of 64 px keys and the tools as a 2 × 2 grid of icon + label buttons;
  - a "Säännöt" card showing the rules inline, with no overlay on wide screens;
  - the keyboard help line (`#play-keys`), its `<kbd>` restyled with `--r-xs` on `--surface`.
- For the nonogram mode toggle and bridges, the side card's contents adapt the same way as the compact dock.

### 8.3 Overlays on wide screens

- **Jaa ja jatka and Omat tehtävät** are popovers: 360 px wide, `--r-lg`, `--shadow-3`, anchored under their button and right-aligned to it, with 8 px of offset. Position them in JS from `getBoundingClientRect()` on open and on resize. Don't rely on CSS anchor positioning. They are still modal `<dialog>`s, but with a transparent backdrop, and a click outside closes them. The open button shows a pressed state (`--ink` background, white text).
- **Uusi tehtävä and the type picker** are centred dialogs, 520–560 px wide, `--r-lg`.
- The content is the same as on compact screens. Only the container changes.

### 8.4 Print mode

- **The top bar**, as in §8.1, without the play-only items.
- **The rail** is a `--surface` card with `--r-lg` and `--shadow-2`, sticky as today. It loses the 4 px blue left border and gets the new component styles.
- **The preview area** shows the sheets on `--bg` with their paper look unchanged.
- **On compact screens** print mode keeps today's stacked rail and sheets, restyled. After "Luo tehtävät", scroll the first sheet into view (`scrollIntoView({block: "start"})`, no smooth scroll under reduced motion).

## 9. Testing

- **`node tests/run.js` stays green.** No generator or codec changes are expected.
- **Print regression:** add `tools/print-snapshot.mjs` (Playwright, Chromium preinstalled at `/opt/pw-browsers`):
  1. Inject a seeded `Math.random` with `addInitScript` (mulberry32, fixed seed).
  2. For every type, at level medium, 2 per page, with solutions, open `index.html`, generate, and screenshot each `.sheet` with `emulateMedia({media: "print"})`.
  3. Write the PNGs to `previews/print/<type>-<n>.png`.
  4. With `--compare <dir>`, report every sheet whose pixels differ.

  Run it on `main` before phase 1 and keep that output as the baseline. Every phase compares against it, and the PR description states the result. Any difference blocks the merge.
- **Manual checks per phase**, on a phone (or at 390 × 844 in devtools) and at 1440 × 900:
  - no page scroll in play mode on the phone;
  - the board fully visible for sudoku 9 × 9, killer, a 25 × 25 nonogram and a hard hashi;
  - overlays: Esc, backdrop click and focus return;
  - keyboard play still works.

## 10. Open decisions

Each has a default, which is what to build unless Pietari says otherwise.

1. **The desk grid background.** Default: drop it on screen and use plain `--bg`. It was part of the old paper-on-desk look, and B was designed without it. Alternative: keep it behind the sheet preview area in print mode only.
2. **Pause** (§6). Default: build it. If dropped, the clock is plain text and overlays still pause it, since they cover the board.
3. **The Yhdistäminen category** with one type. Default: keep it. It is where future link puzzles go.
4. **QR in Jaa ja jatka.** Default: build it, reusing the existing QR code.

## 11. Phases

Each phase is one PR. Each ends with:
- tests green;
- the print snapshot unchanged (§9);
- a preview (`docs/ratkaise-ruudulla.md` §10, same file path, so the link stays the same) where marked.

**Phase 1 – Tokens and components**
- `tools/print-snapshot.mjs` and the baseline first.
- §2 tokens, both themes. §3 components applied to the existing layout: rail, play panel, info column, buttons, segmented controls, pad, tools, saved list with rings. §4 board styling, but not the JS sizing yet.
- The layout and DOM structure do not change. The whole app looks modern on desktop the day this merges.
- **Preview**, play mode, sudoku9:easy.

**Phase 2 – Compact play layout**
- §5 in full: top bar, stage, dock, JS board sizing, the overlay component, the Uusi tehtävä overlay with the rail fields moved in, Jaa ja jatka with share, QR and codes, Omat tehtävät, the Säännöt overlay. §6 pause.
- The type field in Uusi tehtävä is still the old `<select>`, styled.
- **Preview**, play mode, killer:medium. Test on a phone.

**Phase 3 – Type picker**
- §7: `CATEGORIES`, `cat`, `short` and `icon` on every type, recently used, the picker overlay, and the Pulmatyyppi row in both modes.
- **Preview**, play mode, nonogram:medium.

**Phase 4 – Wide screens**
- §8: the shared top bar, the side-column play layout, popovers and centred dialogs, the print-mode rail, scroll-to-sheet on compact print.
- **Preview**, print mode (`--mode print`), sudoku9:easy, plus play mode at desktop width.

**Phase 5 – Dark theme and polish**
- The dark values from §2, checked on every board type including kropki dots and the killer cage lines.
- Reduced motion. Contrast: text at least 4.5:1 against its surface, and the level chips and status chips in both themes.
- **Preview**, play mode, hashi:easy, viewed in dark mode.

## 12. UI copy

New strings, verbatim. The existing strings in `docs/ratkaise-ruudulla.md` §6 stay.

| Where | String |
|---|---|
| Title pill aria-label | {tyyppi}, {taso}. Vaihda pulmaa tai luo uusi |
| Overlay titles | Uusi tehtävä · Jaa ja jatka · Omat tehtävät · Pulmatyyppi · Säännöt |
| Close / back | Sulje · Takaisin |
| Uusi tehtävä | Pulmatyyppi · Vaihda · Luo tehtävä · Nykyisen tehtävän edistyminen on tallessa Omissa tehtävissä. |
| Share, primary | Jaa tehtävä · Kopioi tehtävän linkki · Ystävä saa saman tehtävän tyhjänä. |
| Share, progress | Jatka toisella laitteella · Linkki vie mukanaan edistymisesi. |
| Share, QR | Näytä QR-koodi · Skannaa tehtävä toisella puhelimella. |
| Share, other | Edistyminen tallentuu automaattisesti. · Linkki kopioitu. · Näytä koodit · Piilota koodit · Kopioi tehtävän koodi · Kopioi tehtävän ja edistymisen koodi |
| Omat tehtävät | Tallennetut tässä selaimessa · Auki · Ratkaistu · Avaa · Poista · Avaa koodilla · Liitä · Avaa tehtävä |
| Type picker | Viimeksi käytetyt · Sudokut · Numerot ja vertailut · Ruutujen värittäminen · Yhdistäminen |
| Pause | Tauko · Jatka · Ruudukko on piilossa tauon ajan. · Tauko, käytetty aika {aika} · Jatka, käytetty aika {aika} |
| Menu button aria-label | Omat tehtävät |

## 13. Out of scope

- Search in the type picker. Add it when there are more than about 20 types.
- A setting to hide the clock.
- Changing anything inside printed sheets.
- New puzzle types, controllers or codec changes.
