#!/usr/bin/env python3
"""Draw the SampleProxy toolbar icons. No third-party image libraries."""

import math
import struct
import zlib
from pathlib import Path

# Pale tile and track so the mark stays light on a dark Chrome toolbar.
# The coral knob is the same accent, kept small so the icon is not a dark mass.
TILE = (247, 243, 234, 255)
TRACK = (205, 184, 158, 255)
KNOB = (224, 122, 76, 255)


def write_png(path, width, height, rgba):
    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    raw = b"".join(b"\x00" + rgba[y * width * 4 : (y + 1) * width * 4] for y in range(height))
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)


def sd_round_box(px, py, cx, cy, half_w, half_h, radius):
    dx = abs(px - cx) - half_w + radius
    dy = abs(py - cy) - half_h + radius
    return min(max(dx, dy), 0.0) + math.hypot(max(dx, 0.0), max(dy, 0.0)) - radius


def sd_circle(px, py, cx, cy, radius):
    return math.hypot(px - cx, py - cy) - radius


def coverage(distance):
    return max(0.0, min(1.0, 0.5 - distance))


def over(dst, src, alpha):
    if alpha <= 0:
        return dst
    if alpha >= 1:
        return src
    return tuple(round(dst[i] + (src[i] - dst[i]) * alpha) for i in range(4))


def render(size):
    samples = 8
    buf = bytearray(size * size * 4)
    for y in range(size):
        for x in range(size):
            acc = [0.0, 0.0, 0.0, 0.0]
            for sy in range(samples):
                for sx in range(samples):
                    px = x + (sx + 0.5) / samples
                    py = y + (sy + 0.5) / samples
                    color = (0, 0, 0, 0)
                    tile = sd_round_box(px, py, size / 2, size / 2, size * 0.5, size * 0.5, size * 0.22)
                    color = over(color, TILE, coverage(tile))
                    track = sd_round_box(px, py, size * 0.50, size * 0.52, size * 0.30, size * 0.11, size * 0.11)
                    color = over(color, TRACK, coverage(track))
                    knob = sd_circle(px, py, size * 0.66, size * 0.52, size * 0.16)
                    color = over(color, KNOB, coverage(knob))
                    for i in range(4):
                        acc[i] += color[i]
            pixel = bytearray(4)
            scale = samples * samples
            for i in range(4):
                pixel[i] = round(acc[i] / scale)
            start = (y * size + x) * 4
            buf[start : start + 4] = pixel
    return bytes(buf)


def main():
    out = Path(__file__).resolve().parents[1] / "extension" / "icons"
    out.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 48, 128):
        write_png(out / f"icon{size}.png", size, size, render(size))


if __name__ == "__main__":
    main()
