"""Draws the app icons: a gold italic «Г» stamped on green cloth, framed like a book cover.
Needs Pillow and a TTF of Cormorant Italic 600 (path in FONT)."""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONT = sys.argv[1] if len(sys.argv) > 1 else str(ROOT / 'private/scratch/cormorant-italic-600.ttf')
GREEN, GOLD, GOLD_HI = (15, 43, 36), (216, 178, 90), (244, 223, 160)


def icon(size, pad=0.0):
    """pad: extra safe margin as a fraction of the size (maskable icons get cropped to a circle)."""
    s = size * 4  # draw large, then downscale for smooth edges
    img = Image.new('RGB', (s, s), GREEN)
    d = ImageDraw.Draw(img)
    # cloth weave
    for y in range(0, s, 12):
        d.line([(0, y), (s, y)], fill=(19, 49, 41), width=3)
    inset = int(s * (0.085 + pad))
    d.rounded_rectangle([inset, inset, s - inset, s - inset], radius=int(s * 0.06), outline=GOLD, width=max(4, s // 110))
    inner = inset + int(s * 0.03)
    d.rounded_rectangle([inner, inner, s - inner, s - inner], radius=int(s * 0.045), outline=(150, 124, 62), width=max(2, s // 260))
    font = ImageFont.truetype(FONT, int(s * (0.62 - pad * 1.5)))
    box = d.textbbox((0, 0), 'Г', font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    x, y = (s - w) / 2 - box[0] + s * 0.012, (s - h) / 2 - box[1] - s * 0.01
    d.text((x, y), 'Г', font=font, fill=GOLD)
    rule = int(s * 0.16)
    for yy in (inner + int(s * 0.075), s - inner - int(s * 0.075)):
        d.line([(s / 2 - rule / 2, yy), (s / 2 + rule / 2, yy)], fill=GOLD_HI, width=max(3, s // 200))
    return img.resize((size, size), Image.LANCZOS)


out = ROOT / 'icons'
out.mkdir(exist_ok=True)
icon(192).save(out / 'icon-192.png')
icon(512).save(out / 'icon-512.png')
icon(512, pad=0.1).save(out / 'maskable-512.png')
icon(180).save(out / 'apple-touch-icon.png')
icon(64).save(out / 'favicon-64.png')
print('icons written to', out)
