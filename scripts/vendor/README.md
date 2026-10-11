# Vendored libraries

Copied here unchanged so the app works offline and from `file://`, with nothing loaded from a CDN at runtime.

| File | Library | Version | Licence | Source |
|---|---|---|---|---|
| `qrcode.js` | QR Code Generator for JavaScript, © 2009 Kazuhiko Arase | 1.4.4 | MIT (header of the file) | npm `qrcode-generator@1.4.4`, tarball integrity `sha512-HM7yY8O2ilqhmULxGMpcHSF1EhJJ9yBj8gvDEuZ6M+KGJ0YY2hKpnXvRD+hZPLrDVck3ExIGhmPtSdcjC+guuw==` |

`qrcode.js` is a classic script that defines the global `qrcode`. It is used only when `PLAY_BASE_URL` in `scripts/script.js` is set (phase 6 of `docs/ratkaise-ruudulla.md`).
