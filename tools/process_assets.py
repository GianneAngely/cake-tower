"""Turn the Flow 2K renders on green into trimmed transparent sprites.

python3 tools/process_assets.py
  reads  art/flow/a4/tier-*.jpg, stand.jpg, bg-*.jpg
  writes art/sprites/tier-*.png, stand.png, bg-*.jpg
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "art/flow/a4"
OUT = ROOT / "art/sprites"
TIER_W = 800             # every tier is scaled to this width
STAND_W = int(TIER_W * 1.15)


def key_green(path):
    rgb = np.asarray(Image.open(path).convert("RGB")).astype(np.int16)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    greenness = g - np.maximum(r, b)

    # background = strong green connected to the image border
    # .copy(): an image built on a numpy buffer is read-only, and floodfill would edit a throwaway copy
    strong = Image.fromarray(((greenness > 35) * 255).astype(np.uint8)).copy()
    h, w = greenness.shape
    for seed in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        if strong.getpixel(seed) == 255:
            ImageDraw.floodfill(strong, seed, 128)
    # plus key-colored pockets enclosed by line art (e.g. inside a bow loop); darker greens like leaves stay
    bg = (np.array(strong) == 128) | ((g > 160) & (greenness > 90))

    # soft edge: a thin band around the background gets alpha from its greenness
    band = np.asarray(Image.fromarray((bg * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(7))) > 0
    band &= ~bg
    alpha = np.ones((h, w), np.float32)
    alpha[bg] = 0
    alpha[band] = np.clip(1 - (greenness[band] - 8) / 50.0, 0, 1)

    # despill the edge band so no green fringe is left
    out = rgb.copy()
    cap = np.maximum(r, b) + 4
    out[..., 1] = np.where(band | bg, np.minimum(g, cap), g)

    rgba = np.dstack([out.clip(0, 255).astype(np.uint8), (alpha * 255).astype(np.uint8)])
    img = Image.fromarray(rgba, "RGBA")
    return img.crop(img.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox())


def fit_width(img, width):
    return img.resize((width, round(img.height * width / img.width)), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for src in sorted(SRC.glob("tier-*.jpg")):
        sprite = fit_width(key_green(src), TIER_W)
        sprite.save(OUT / f"{src.stem}.png")
        print(f"{src.stem}.png {sprite.size}")
    stand = fit_width(key_green(SRC / "stand.jpg"), STAND_W)
    stand.save(OUT / "stand.png")
    print("stand.png", stand.size)
    for name in ["bg-portrait", "bg-landscape"]:
        Image.open(SRC / f"{name}.jpg").convert("RGB").save(OUT / f"{name}.jpg", quality=88)
        print(f"{name}.jpg copied")
    for src in sorted((ROOT / "art/flow/sky").glob("*.jpg")):   # sky decor: longest side 700 px (star 300)
        sprite = key_green(src)
        side = 300 if src.stem == "star" else 700
        k = side / max(sprite.size)
        sprite = sprite.resize((round(sprite.width * k), round(sprite.height * k)), Image.LANCZOS)
        sprite.save(OUT / f"sky-{src.stem}.png")
        print(f"sky-{src.stem}.png {sprite.size}")


def wall_strip():
    """A plain piece of the landscape shop wall (stripes + counter, no furniture) that tiles seamlessly,
    plus two copies whose alpha fades into the picture, used to hide the picture's cut edges."""
    src = np.asarray(Image.open(OUT / "bg-landscape.jpg").convert("RGB")).astype(np.float32)
    H, W, _ = src.shape
    row = src[int(H * 0.45), int(W * 0.27):int(W * 0.63), 0] - src[int(H * 0.45), int(W * 0.27):int(W * 0.63), 2]
    row -= row.mean()
    ac = np.correlate(row, row, "full")[len(row) - 1:]
    period = int(np.argmax(ac[80:400]) + 80)
    x0, w, n = int(W * 0.44), period * 3, 40
    # tile with a seamless wrap: the first n columns blend from the columns just past the tile's end
    tile = src[:, x0:x0 + w].copy()
    ramp = np.linspace(0, 1, n)[None, :, None]
    tile[:, :n] = (1 - ramp) * src[:, x0 + w:x0 + w + n] + ramp * src[:, x0:x0 + n]
    # the bunting only hangs over the middle of the shop: paint plain wallpaper over it (stripes are vertical)
    top = int(H * 0.17)
    tile[:top] = tile[int(H * 0.20):int(H * 0.20) + top]
    rgb = tile.clip(0, 255).astype(np.uint8)
    Image.fromarray(rgb).save(OUT / "wall-strip.png")
    for side in ("l", "r"):   # opaque outside the picture, fading to clear over the half that overlaps it
        a = np.ones(w, np.float32)
        half = np.linspace(1, 0, w - w // 2) ** 1.5
        if side == "l": a[w // 2:] = half
        else: a[:w - w // 2] = half[::-1]
        alpha = np.repeat((a * 255).astype(np.uint8)[None, :], H, axis=0)
        Image.fromarray(np.dstack([rgb, alpha]), "RGBA").save(OUT / f"wall-seam-{side}.png")
    print(f"wall-strip.png {w}x{H} (stripe period {period}px, from x={x0})")


def widest_row(alpha, lo, hi):
    """Row in [lo, hi) where the silhouette is widest: the center line of an ellipse rim."""
    cols = [(np.nonzero(alpha[y] > 128)[0]) for y in range(lo, hi)]
    widths = [c[-1] - c[0] if len(c) else 0 for c in cols]
    return lo + int(np.argmax(widths))


def anchors():
    """Stacking anchors as fractions of sprite height: top rim center and bottom rim center."""
    out = {}
    for path in sorted(OUT.glob("tier-*.png")):
        a = np.asarray(Image.open(path))[..., 3]
        h = a.shape[0]
        # windows skip the side decorations (bows, cherries, drips) that stick out mid-tier
        out[path.stem] = {"top": widest_row(a, 0, int(h * 0.30)) / h, "bottom": widest_row(a, int(h * 0.62), h) / h}
    a = np.asarray(Image.open(OUT / "stand.png"))[..., 3]
    out["stand"] = {"top": widest_row(a, 0, int(a.shape[0] * 0.6)) / a.shape[0]}
    return out


if __name__ == "__main__":
    import json
    main()
    wall_strip()
    (OUT / "anchors.json").write_text(json.dumps(anchors(), indent=1))
    print((OUT / "anchors.json").read_text())
