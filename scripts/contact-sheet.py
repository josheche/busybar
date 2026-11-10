#!/usr/bin/env python3
"""Tile `npm run screenshot` captures (one <step>/front.png + back.png per folder) into one PNG.

Usage: python3 -I scripts/contact-sheet.py <rundir> <out.png> [cols]
Pure stdlib: reads the 8-bit PNGs scripts/screenshot.ts writes, halves them (nearest
neighbour), labels nothing, and keeps steps in numeric folder order.
"""
import os
import struct
import sys
import zlib


def read_png(path):
    data = open(path, 'rb').read()
    w, h, depth, ctype = struct.unpack('>IIBB', data[16:26])
    ch = {0: 1, 2: 3, 6: 4}[ctype]
    i, idat = 8, b''
    while i < len(data):
        n = struct.unpack('>I', data[i:i + 4])[0]
        if data[i + 4:i + 8] == b'IDAT':
            idat += data[i + 8:i + 8 + n]
        i += 12 + n
    raw = zlib.decompress(idat)
    stride = w * ch
    rows, prev = [], bytearray(stride)
    for y in range(h):
        f = raw[y * (stride + 1)]
        line = bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        for x in range(stride):
            a = line[x - ch] if x >= ch else 0
            b = prev[x]
            c = prev[x - ch] if x >= ch else 0
            if f == 1: line[x] = (line[x] + a) & 255
            elif f == 2: line[x] = (line[x] + b) & 255
            elif f == 3: line[x] = (line[x] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(bytes(line))
        prev = line
    px = [[tuple(r[x * ch:x * ch + 3]) if ch >= 3 else (r[x],) * 3 for x in range(w)] for r in rows]
    return w, h, px


def write_png(path, w, h, px):
    raw = b''.join(b'\x00' + bytes(c for x in range(w) for c in px[y][x]) for y in range(h))
    chunk = lambda t, b: struct.pack('>I', len(b)) + t + b + struct.pack('>I', zlib.crc32(t + b) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))


def main():
    run, out = sys.argv[1], sys.argv[2]
    cols = int(sys.argv[3]) if len(sys.argv) > 3 else 3
    steps = sorted((d for d in os.listdir(run) if os.path.isdir(os.path.join(run, d))), key=lambda d: int(d.split('-')[0]))
    cells = []
    for s in steps:
        fw, fh, fp = read_png(os.path.join(run, s, 'front.png'))
        bw, bh, bp = read_png(os.path.join(run, s, 'back.png'))
        cells.append((fw // 2, fh // 2, [r[::2] for r in fp[::2]], bw // 2, bh // 2, [r[::2] for r in bp[::2]]))
    gap = 10
    cw = max(max(c[0], c[3]) for c in cells)
    chh = max(c[1] + gap // 2 + c[4] for c in cells)
    rows = (len(cells) + cols - 1) // cols
    W, H = cols * cw + (cols - 1) * gap, rows * chh + (rows - 1) * gap
    sheet = [[(48, 48, 52)] * W for _ in range(H)]
    for n, (fw, fh, fp, bw, bh, bp) in enumerate(cells):
        ox, oy = (n % cols) * (cw + gap), (n // cols) * (chh + gap)
        for y in range(fh):
            sheet[oy + y][ox:ox + fw] = fp[y][:fw]
        for y in range(bh):
            sheet[oy + fh + gap // 2 + y][ox:ox + bw] = bp[y][:bw]
    write_png(out, W, H, sheet)
    print(out, f'{len(cells)} steps')


main()
