"""Copy art/sprites into assets/ at web-friendly sizes.

python3 tools/web_assets.py
"""
import base64
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "art/sprites"
OUT = ROOT / "assets"


def main():
    OUT.mkdir(exist_ok=True)
    for src in sorted(SRC.glob("tier-*.png")) + sorted(SRC.glob("sky-*.png")) + sorted(SRC.glob("wall-*.png")) + [SRC / "stand.png"]:
        Image.open(src).save(OUT / f"{src.stem}.webp", quality=90, method=6)
    for name, width in [("bg-portrait", 1536), ("bg-landscape", 2752)]:   # full Flow 2K: zooming in stays sharper
        im = Image.open(SRC / f"{name}.jpg")
        im.resize((width, round(im.height * width / im.width)), Image.LANCZOS).save(OUT / f"{name}.jpg", quality=85)
    # the same images as data URLs: a page opened from file:// can then use WebGL and save photos (file:// images taint the canvas)
    data = {f.stem: f"data:image/{'webp' if f.suffix == '.webp' else 'jpeg'};base64," + base64.b64encode(f.read_bytes()).decode()
            for f in sorted(OUT.iterdir()) if f.suffix in (".webp", ".jpg")}
    (OUT / "bundle.js").write_text("window.CAKE_ASSETS = " + json.dumps(data) + ";\n")
    for f in sorted(OUT.iterdir()):
        if f.is_file():
            print(f"{f.name:28} {f.stat().st_size // 1024:5d} KB")


if __name__ == "__main__":
    main()
