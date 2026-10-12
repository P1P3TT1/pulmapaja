"""Draws the app icons in icons/ from the brand mark (the 3 x 3 grid in the
rail heading). Needs Pillow: pip install pillow

    python3 tools/build-icons.py

"any" icons have rounded corners; maskable and Apple touch icons are full
bleed, since the platform crops them, and keep the mark inside the safe zone."""

from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "icons"
PAPER = (0xFC, 0xFC, 0xFA)   # --paper
BLUE = (0x1E, 0x5F, 0xA8)    # --blue
SOFT = (0xDE, 0xE8, 0xF5)    # --blue-soft
ON = {1, 3, 5, 7}            # the cells marked .on in index.html


def icon(name, size, frac, rounded, ss=4):
    """frac: share of the side the mark spans (cell 6 + gap 1 units, 20 in all)"""
    s = size * ss
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if rounded:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.18), fill=PAPER)
    else:
        d.rectangle([0, 0, s, s], fill=PAPER)
    unit = s * frac / 20
    x0 = (s - 20 * unit) / 2
    for i in range(9):
        r, c = divmod(i, 3)
        x, y = x0 + c * 7 * unit, x0 + r * 7 * unit
        d.rectangle([round(x), round(y), round(x + 6 * unit) - 1, round(y + 6 * unit) - 1],
                    fill=BLUE if i in ON else SOFT)
    im.resize((size, size), Image.LANCZOS).save(OUT / name)


OUT.mkdir(exist_ok=True)
icon("icon-512.png", 512, 0.56, True)
icon("icon-192.png", 192, 0.56, True)
icon("icon-maskable-512.png", 512, 0.46, False)
icon("icon-maskable-192.png", 192, 0.46, False)
icon("apple-touch-icon.png", 180, 0.52, False)
icon("favicon-32.png", 32, 0.84, True)
print("icons written to", OUT)
