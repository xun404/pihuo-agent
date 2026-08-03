#!/usr/bin/env python3
"""
Normalize the SwarmDesk Dock / app icon:

macOS applies its own squircle mask. Source art that is a pre-rounded plate on an
opaque white canvas therefore shows a white halo/border in the Dock.

This script:
  1. Reads build/icon.png (or --src)
  2. Converts near-white corner fill to transparent
  3. Converts gray fringe (AA against white) to black + alpha
  4. Writes RGBA PNGs to build/ + apps/desktop/public/
  5. Rebuilds build/icon.icns via `sips` + `iconutil` (macOS only)

Usage:
  python3 scripts/generate-app-icons.py
  python3 scripts/generate-app-icons.py --src path/to/source.png
"""
from __future__ import annotations

import argparse
import struct
import subprocess
import sys
import tempfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read_png(path: Path):
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit(f"not a PNG: {path}")
    pos = 8
    width = height = None
    color_type = None
    idat = b""
    while pos < len(data):
        length = struct.unpack(">I", data[pos : pos + 4])[0]
        ctype = data[pos + 4 : pos + 8]
        chunk = data[pos + 8 : pos + 8 + length]
        pos += 12 + length
        if ctype == b"IHDR":
            width, height, _bit_depth, color_type = struct.unpack(">IIBB", chunk[:10])
        elif ctype == b"IDAT":
            idat += chunk
        elif ctype == b"IEND":
            break
    if width is None or color_type is None:
        raise SystemExit(f"invalid PNG header: {path}")
    raw = zlib.decompress(idat)
    if color_type == 2:
        bpp = 3
    elif color_type == 6:
        bpp = 4
    else:
        raise SystemExit(f"unsupported color_type {color_type} in {path}")
    stride = width * bpp
    rows: list[bytearray] = []
    i = 0
    prev = bytearray(stride)
    for _y in range(height):
        filt = raw[i]
        i += 1
        row = bytearray(raw[i : i + stride])
        i += stride
        if filt == 1:
            for x in range(bpp, stride):
                row[x] = (row[x] + row[x - bpp]) & 255
        elif filt == 2:
            for x in range(stride):
                row[x] = (row[x] + prev[x]) & 255
        elif filt == 3:
            for x in range(stride):
                a = row[x - bpp] if x >= bpp else 0
                row[x] = (row[x] + ((a + prev[x]) // 2)) & 255
        elif filt == 4:

            def paeth(a: int, b: int, c: int) -> int:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                if pa <= pb and pa <= pc:
                    return a
                if pb <= pc:
                    return b
                return c

            for x in range(stride):
                a = row[x - bpp] if x >= bpp else 0
                b = prev[x]
                c = prev[x - bpp] if x >= bpp else 0
                row[x] = (row[x] + paeth(a, b, c)) & 255
        elif filt != 0:
            raise SystemExit(f"unsupported PNG filter {filt}")
        rows.append(row)
        prev = row

    def get(x: int, y: int) -> tuple[int, int, int, int]:
        r = rows[y]
        o = x * bpp
        if bpp == 3:
            return (r[o], r[o + 1], r[o + 2], 255)
        return (r[o], r[o + 1], r[o + 2], r[o + 3])

    return width, height, get


def write_png_rgba(path: Path, w: int, h: int, pixels: list[tuple[int, int, int, int]]) -> None:
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        base = y * w
        for x in range(w):
            r, g, b, a = pixels[base + x]
            raw.extend((r, g, b, a))
    compressed = zlib.compress(bytes(raw), 9)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", compressed) + chunk(b"IEND", b"")
    )


def to_dock_rgba(r: int, g: int, b: int, a: int) -> tuple[int, int, int, int]:
    """White canvas / gray corner AA → transparent or black+alpha.

    Idempotent: already-transparent pixels (a≈0) are preserved.
    """
    if a < 8:
        return (0, 0, 0, 0)
    if r >= 245 and g >= 245 and b >= 245:
        return (0, 0, 0, 0)
    # Grayscale fringe (rounded plate anti-aliased against white)
    if abs(r - g) <= 12 and abs(g - b) <= 12 and abs(r - b) <= 12:
        lum = (r + g + b) // 3
        if lum <= 40:
            return (r, g, b, 255)
        alpha = 255 - lum
        if alpha < 4:
            return (0, 0, 0, 0)
        return (0, 0, 0, alpha)
    return (r, g, b, a if a else 255)


def normalize_icon(src: Path, destinations: list[Path]) -> None:
    w, h, get = read_png(src)
    pixels = [to_dock_rgba(*get(x, y)) for y in range(h) for x in range(w)]
    # Write via a temp file first if src is also a destination
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        tmp_path = Path(tmp.name)
    write_png_rgba(tmp_path, w, h, pixels)
    for dest in destinations:
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(tmp_path.read_bytes())
        print(f"wrote {dest.relative_to(ROOT)} ({w}x{h} RGBA)")
    # corner sanity
    _, _, g2 = read_png(destinations[0])
    print(f"  corner alpha={g2(0, 0)[3]} top-mid={g2(w // 2, 0)}")
    tmp_path.unlink(missing_ok=True)


def build_icns(png: Path, icns: Path) -> None:
    if sys.platform != "darwin":
        print("skip icns (not macOS)")
        return
    with tempfile.TemporaryDirectory(prefix="swarmdesk-iconset-") as tmp:
        iconset = Path(tmp) / "AppIcon.iconset"
        iconset.mkdir()
        sizes = [
            (16, "icon_16x16.png"),
            (32, "icon_16x16@2x.png"),
            (32, "icon_32x32.png"),
            (64, "icon_32x32@2x.png"),
            (128, "icon_128x128.png"),
            (256, "icon_128x128@2x.png"),
            (256, "icon_256x256.png"),
            (512, "icon_256x256@2x.png"),
            (512, "icon_512x512.png"),
            (1024, "icon_512x512@2x.png"),
        ]
        for px, name in sizes:
            out = iconset / name
            subprocess.check_call(
                ["sips", "-z", str(px), str(px), str(png), "--out", str(out)],
                stdout=subprocess.DEVNULL,
            )
        subprocess.check_call(["iconutil", "-c", "icns", str(iconset), "-o", str(icns)])
        print(f"wrote {icns.relative_to(ROOT)}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--src",
        type=Path,
        default=ROOT / "build" / "icon.png",
        help="Source PNG (default: build/icon.png)",
    )
    args = parser.parse_args()
    src = args.src.resolve()
    if not src.exists():
        raise SystemExit(f"missing source icon: {src}")

    build_png = ROOT / "build" / "icon.png"
    public_png = ROOT / "apps" / "desktop" / "public" / "icon.png"
    # Prefer processing a copy of src so re-running is idempotent on already-fixed art.
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        work = Path(tmp.name)
    work.write_bytes(src.read_bytes())
    try:
        normalize_icon(work, [build_png, public_png])
        build_icns(build_png, ROOT / "build" / "icon.icns")
    finally:
        work.unlink(missing_ok=True)
    print("done — rebuild the mac app (npm run package:mac) and clear Dock icon cache if needed:")
    print("  killall Dock  # optional; forces Dock to reload icons")


if __name__ == "__main__":
    main()
