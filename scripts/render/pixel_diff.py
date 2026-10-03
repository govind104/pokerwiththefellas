"""Compare two folders of PNG canvas renders, pixel by pixel (Plan B spec §4 item 1).

Usage: python scripts/render/pixel_diff.py <a_dir> <b_dir> [--threshold 24]
For every PNG name present in both folders, prints the share of pixels whose largest
RGB channel difference is above the threshold, then the maximum. Needs Pillow.
"""
import argparse
import pathlib
import sys

from PIL import Image, ImageChops


def changed_fraction(a_path, b_path, threshold):
    a = Image.open(a_path).convert("RGB")
    b = Image.open(b_path).convert("RGB")
    if a.size != b.size:
        return 1.0
    r, g, bl = ImageChops.difference(a, b).split()
    largest = ImageChops.lighter(ImageChops.lighter(r, g), bl)
    hist = largest.histogram()
    return sum(hist[threshold + 1:]) / (a.size[0] * a.size[1])


def main(argv):
    p = argparse.ArgumentParser()
    p.add_argument("a_dir")
    p.add_argument("b_dir")
    p.add_argument("--threshold", type=int, default=24)
    args = p.parse_args(argv)
    a_dir, b_dir = pathlib.Path(args.a_dir), pathlib.Path(args.b_dir)
    names = sorted(n.name for n in a_dir.glob("*.png") if (b_dir / n.name).exists())
    if not names:
        print("no common PNGs")
        return 1
    worst = 0.0
    for name in names:
        f = changed_fraction(a_dir / name, b_dir / name, args.threshold)
        worst = max(worst, f)
        print(f"{name} {f * 100:.4f}%")
    print(f"max {worst * 100:.4f}%")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
