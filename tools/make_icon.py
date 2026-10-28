"""Generate the Deercast app icons (run once; output committed in static/)."""
from pathlib import Path

from PIL import Image, ImageDraw

S = 1024
OUT = Path(__file__).resolve().parents[1] / "static"


def draw() -> Image.Image:
    im = Image.new("RGB", (S, S), "#1f2b22")  # full-bleed: iOS rounds the corners itself
    d = ImageDraw.Draw(im)
    d.ellipse([90, 90, S - 90, S - 90], outline="#e07b24", width=26)  # orange ring
    cx = S // 2
    antler = "#efe2c4"
    w = 30
    for sgn in (1, -1):  # antlers: main beam + tines
        x = lambda v: cx + sgn * v  # noqa: E731
        d.line([(x(70), 470), (x(150), 380), (x(230), 330), (x(290), 260), (x(300), 190)], fill=antler, width=w,
               joint="curve")
        d.line([(x(150), 380), (x(140), 270)], fill=antler, width=w - 4)
        d.line([(x(230), 330), (x(235), 215)], fill=antler, width=w - 4)
        d.line([(x(290), 260), (x(360), 225)], fill=antler, width=w - 6)
        for p in [(x(70), 470), (x(140), 270), (x(235), 215), (x(300), 190), (x(360), 225)]:
            d.ellipse([p[0] - w / 2, p[1] - w / 2, p[0] + w / 2, p[1] + w / 2], fill=antler)
    # ears
    d.ellipse([cx - 285, 470, cx - 140, 560], fill="#9c6f45")
    d.ellipse([cx + 140, 470, cx + 285, 560], fill="#9c6f45")
    d.ellipse([cx - 255, 488, cx - 165, 540], fill="#d9b48f")
    d.ellipse([cx + 165, 488, cx + 255, 540], fill="#d9b48f")
    # head (tapered): skull + muzzle
    d.ellipse([cx - 150, 430, cx + 150, 700], fill="#a87a4f")
    d.polygon([(cx - 140, 600), (cx + 140, 600), (cx + 78, 840), (cx - 78, 840)], fill="#a87a4f")
    d.ellipse([cx - 80, 770, cx + 80, 880], fill="#a87a4f")
    d.ellipse([cx - 60, 700, cx + 60, 860], fill="#c9a07a")  # lighter muzzle
    d.ellipse([cx - 52, 815, cx + 52, 875], fill="#2a2018")  # nose
    for sgn in (1, -1):  # eyes
        ex = cx + sgn * 82
        d.ellipse([ex - 22, 585, ex + 22, 625], fill="#1a1410")
    return im


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    big = draw()
    big.resize((180, 180), Image.LANCZOS).save(OUT / "apple-touch-icon.png")
    big.resize((512, 512), Image.LANCZOS).save(OUT / "icon-512.png")
    big.resize((64, 64), Image.LANCZOS).save(OUT / "favicon.png")
    print("wrote", sorted(p.name for p in OUT.iterdir()))
