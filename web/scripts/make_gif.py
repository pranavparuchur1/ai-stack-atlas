"""Assemble hero frames into docs/assets/hero.gif (run with: uv run --with pillow python web/scripts/make_gif.py <frames> <out>)."""

import sys
from pathlib import Path

from PIL import Image

frames_dir, out = Path(sys.argv[1]), Path(sys.argv[2])
width = int(sys.argv[3]) if len(sys.argv) > 3 else 960
paths = sorted(frames_dir.glob("*.png"))
frames = []
for p in paths:
    im = Image.open(p).convert("RGB")
    im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    frames.append(im.quantize(colors=96, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE))
out.parent.mkdir(parents=True, exist_ok=True)
durations = [110] * len(frames)
durations[-1] = 2200
frames[0].save(out, save_all=True, append_images=frames[1:], duration=durations, loop=0, optimize=True)
print(f"{len(frames)} frames -> {out} ({out.stat().st_size / 1e6:.1f} MB)")
