"""Turn tools/record.mjs frames into a GIF with one shared palette.

python3 tools/make_gif.py <frames-dir> <out.gif> [fps] [width] [start_s] [end_s]
"""
import json
import sys
from pathlib import Path

from PIL import Image

COLORS = 160
DITHER = Image.Dither.NONE


def main():
    src, out = Path(sys.argv[1]), sys.argv[2]
    fps = float(sys.argv[3]) if len(sys.argv) > 3 else 12
    width = int(sys.argv[4]) if len(sys.argv) > 4 else 320
    stamps = json.loads((src / "frames.json").read_text())
    t0 = stamps[0] + (float(sys.argv[5]) if len(sys.argv) > 5 else 0)
    t1 = stamps[0] + float(sys.argv[6]) if len(sys.argv) > 6 else stamps[-1]
    frames, i, t = [], 0, t0
    while t <= t1:                                   # the latest captured frame at each tick
        while i + 1 < len(stamps) and stamps[i + 1] <= t:
            i += 1
        im = Image.open(src / f"f{i:04d}.jpg").convert("RGB")
        frames.append(im.resize((width, round(im.height * width / im.width)), Image.LANCZOS))
        t += 1 / fps
    # one palette for every frame: per-frame palettes flicker and make Pillow drop frames
    sample = Image.new("RGB", (width, frames[0].height * 6))
    for k, f in enumerate(frames[:: max(1, len(frames) // 6)][:6]):
        sample.paste(f, (0, k * frames[0].height))
    pal = sample.quantize(colors=COLORS, method=Image.Quantize.MEDIANCUT)
    q = [f.quantize(palette=pal, dither=DITHER) for f in frames]
    q[0].save(out, save_all=True, append_images=q[1:], duration=round(1000 / fps), loop=0, optimize=False, disposal=1)
    print(f"{len(q)} frames at {fps} fps, {width}x{frames[0].height}, {Path(out).stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
