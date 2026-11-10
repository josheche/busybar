// SPDX-License-Identifier: GPL-2.0-or-later
// Derived from the BUSY Bar firmware (https://github.com/busy-app/busybar-firmware),
// assets/frontend/util/seq2anim.ts, Copyright 2024-2026 Flipper FZCO, GPL-2.0-or-later.
//
// Encoder for the BUSY Bar `.anim` animation container, format version 1 ("bicycle1").
//
// Port of the firmware reference encoder at the commit the device runs
// (busybar-firmware 8edd2da4 = fw 1.3.1: assets/frontend/util/seq2anim.ts, which the firmware
// keeps byte-identical to scripts/seq2anim.py). fw 1.2.4 used "bicycle0"; a device rejects a
// file with the other signature and draws a magenta "broken asset" box instead. The widget
// checks a stock file's signature against ANIM_SIGNATURE before uploading (see
// readDeviceAnimSignature in src/lib/bar.ts), so the next format bump degrades to a still
// sprite instead of that box.
//
// Layout (all little-endian):
//   header   "bicycle1" flags u8, width u8, height u8, color u8 (0=rgb888 as BGR, 1=gray4),
//            max_mask_bits u16, max_pixel_len u16, fps u8, pad u8, sections_chunk_len u32,
//            frames_chunk_len u32, section_count u32, frame_count u32               (34 bytes)
//   sections start u32, end u32 (frame indices, inclusive), frame_offs u32, name (NUL-terminated)
//   frames   encoding u8 (pixel encoding low nibble, mask encoding high nibble), mask_bits u16,
//            pixel_len u16, mask data, pixel data
// Every display frame is a file frame (v0's duration field is gone). A frame stores only the
// pixels that changed since the previous one, selected by a change mask; each section's first
// frame is a keyframe holding every pixel, so the firmware can start playback there.

export type ColorMode = 'rgb888' | 'gray4'

export type RgbaFrame = { width: number; height: number; data: Uint8ClampedArray }

export type AnimSection = { name: string; start: number; end: number }

export type AnimMeta = {
  fps: number
  colorMode: ColorMode
  sections?: AnimSection[]
}

export const ANIM_SIGNATURE = 'bicycle1'
const HEADER_LENGTH = 34
const SECTION_HEADER_LENGTH = 12
const FRAME_HEADER_LENGTH = 5
const MAX_DIMENSION = 255
const MAX_FPS = 255
const MAX_PIXEL_LENGTH = 0xffff

const MASK_SHORT_RUN_BITS = 3
const MASK_LONG_RUN_BITS = 8
const MASK_LONG_RUN_MARKER = (1 << MASK_SHORT_RUN_BITS) - 1
const MASK_LONG_RUN_MAX = (1 << MASK_LONG_RUN_BITS) - 1
const MASK_RLE_MAX_RATIO = 0.75

const MaskEncoding = { FullyBlack: 0, FullyWhite: 1, RleFirstBlack: 2, RleFirstWhite: 3, Bitmap: 4 } as const
const PixelEncoding = { Raw: 0, Rle: 1, QoiLike: 2 } as const

const RLE_MAX_BLOCKS_PER_BYTE = 127
const RLE_BLOCK_THRESHOLD = 3
const QOI_RUN_LIMIT = 0b11111110

type Chunk = { data: Uint8Array; encoding: number }
type Mask = Chunk & { bits: number }
type Difference = { pixels: Uint8Array; previous: Uint8Array | null; mask: Uint8Array }

const te = new TextEncoder()

export function encodeAnim(frames: readonly RgbaFrame[], meta: AnimMeta): Uint8Array {
  if (frames.length === 0) throw new Error('No frames provided')
  const { width, height } = frames[0]
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new Error(`Frame dimensions ${width}x${height} exceed ${MAX_DIMENSION}px`)
  }
  const fps = Math.round(meta.fps)
  if (!Number.isFinite(fps) || fps < 1 || fps > MAX_FPS) throw new Error(`FPS must be between 1 and ${MAX_FPS}`)

  const sections: AnimSection[] = [{ name: 'default', start: 0, end: frames.length - 1 }, ...(meta.sections ?? [])]
  sections.forEach((s, i) => {
    if (s.start < 0 || s.end >= frames.length || s.start > s.end) {
      throw new Error(`Invalid section '${s.name}': [${s.start}, ${s.end}] out of [0, ${frames.length - 1}]`)
    }
    if (i > 0 && s.name === 'default') throw new Error('Section name "default" is reserved')
  })

  const keyframes = new Set(sections.map((s) => s.start))
  const encodedFrames: Uint8Array[] = []
  let framesChunkLen = 0
  let maxMaskBits = 0
  let maxPixelLen = 0
  let previous: Uint8Array | null = null

  frames.forEach((frame, i) => {
    if (frame.width !== width || frame.height !== height) {
      throw new Error(`Frame ${i} is ${frame.width}x${frame.height}, expected ${width}x${height}`)
    }
    const pixels = reduceColor(frame.data, meta.colorMode)
    const diff = subtractPixels(pixels, keyframes.has(i) ? null : previous)
    const px = encodePixels(diff, meta.colorMode)
    const mask = encodeMask(diff.mask)
    if (px.data.length > MAX_PIXEL_LENGTH) throw new Error(`Frame ${i} is too large to encode`)

    const encoded = new Uint8Array(FRAME_HEADER_LENGTH + mask.data.length + px.data.length)
    const view = new DataView(encoded.buffer)
    view.setUint8(0, px.encoding | (mask.encoding << 4))
    view.setUint16(1, mask.bits, true)
    view.setUint16(3, px.data.length, true)
    encoded.set(mask.data, FRAME_HEADER_LENGTH)
    encoded.set(px.data, FRAME_HEADER_LENGTH + mask.data.length)

    encodedFrames.push(encoded)
    framesChunkLen += encoded.length
    maxMaskBits = Math.max(maxMaskBits, mask.bits)
    maxPixelLen = Math.max(maxPixelLen, px.data.length)
    previous = pixels
  })

  const names = sections.map((s) => te.encode(s.name))
  const sectionsChunkLen = names.reduce((t, n) => t + SECTION_HEADER_LENGTH + n.length + 1, 0)

  const frameOffsets: number[] = []
  let fileLen = HEADER_LENGTH + sectionsChunkLen
  for (const f of encodedFrames) {
    frameOffsets.push(fileLen)
    fileLen += f.length
  }

  const out = new Uint8Array(fileLen)
  const view = new DataView(out.buffer)
  out.set(te.encode(ANIM_SIGNATURE), 0)
  view.setUint8(8, 0) // flags
  view.setUint8(9, width)
  view.setUint8(10, height)
  view.setUint8(11, meta.colorMode === 'rgb888' ? 0 : 1)
  view.setUint16(12, maxMaskBits, true)
  view.setUint16(14, maxPixelLen, true)
  view.setUint8(16, fps)
  view.setUint8(17, 0) // padding
  view.setUint32(18, sectionsChunkLen, true)
  view.setUint32(22, framesChunkLen, true)
  view.setUint32(26, sections.length, true)
  view.setUint32(30, encodedFrames.length, true)

  let ptr = HEADER_LENGTH
  sections.forEach((s, i) => {
    view.setUint32(ptr, s.start, true)
    view.setUint32(ptr + 4, s.end, true)
    view.setUint32(ptr + 8, frameOffsets[s.start], true)
    out.set(names[i], ptr + SECTION_HEADER_LENGTH)
    ptr += SECTION_HEADER_LENGTH + names[i].length
    out[ptr++] = 0
  })
  for (const f of encodedFrames) {
    out.set(f, ptr)
    ptr += f.length
  }
  return out
}

// Alpha is dropped (forced opaque). gray4 keeps the red channel's high nibble on all three
// channels, so change detection compares what the OLED can actually show.
function reduceColor(rgba: Uint8ClampedArray, mode: ColorMode): Uint8Array {
  const out = new Uint8Array(rgba.length)
  for (let i = 0; i < rgba.length; i += 4) {
    if (mode === 'gray4') {
      const v = rgba[i] & 0xf0
      out[i] = v
      out[i + 1] = v
      out[i + 2] = v
    } else {
      out[i] = rgba[i]
      out[i + 1] = rgba[i + 1]
      out[i + 2] = rgba[i + 2]
    }
    out[i + 3] = 0xff
  }
  return out
}

// Keyframes (previous = null) keep every pixel. Otherwise only changed pixels survive, in
// scan order, with their previous values alongside for the QOI-like delta coder.
function subtractPixels(pixels: Uint8Array, previous: Uint8Array | null): Difference {
  const count = pixels.length / 4
  if (!previous) return { pixels, previous: null, mask: new Uint8Array(count).fill(1) }

  const mask = new Uint8Array(count)
  let changed = 0
  for (let p = 0; p < count; p++) {
    const o = p * 4
    if (pixels[o] !== previous[o] || pixels[o + 1] !== previous[o + 1] || pixels[o + 2] !== previous[o + 2] || pixels[o + 3] !== previous[o + 3]) {
      mask[p] = 1
      changed++
    }
  }
  const selected = new Uint8Array(changed * 4)
  const selectedPrevious = new Uint8Array(changed * 4)
  let ptr = 0
  for (let p = 0; p < count; p++) {
    if (!mask[p]) continue
    const o = p * 4
    selected.set(pixels.subarray(o, o + 4), ptr)
    selectedPrevious.set(previous.subarray(o, o + 4), ptr)
    ptr += 4
  }
  return { pixels: selected, previous: selectedPrevious, mask }
}

// rgb888 is stored as BGR; gray4 packs two pixels per byte, earlier pixel in the high nibble.
function packPixels(pixels: Uint8Array, mode: ColorMode): Uint8Array {
  if (mode === 'rgb888') {
    const out = new Uint8Array((pixels.length / 4) * 3)
    let p = 0
    for (let i = 0; i < pixels.length; i += 4) {
      out[p++] = pixels[i + 2]
      out[p++] = pixels[i + 1]
      out[p++] = pixels[i]
    }
    return out
  }
  const out = new Uint8Array(Math.ceil(pixels.length / 8))
  let p = 0
  for (let i = 0; i < pixels.length; i += 8) {
    const left = pixels[i] & 0xf0
    const right = i + 4 < pixels.length ? pixels[i + 4] & 0xf0 : 0
    out[p++] = left | (right >> 4)
  }
  return out
}

// Smallest of raw, RLE and (rgb888 delta frames only) QOI-like wins; ties keep the earlier.
function encodePixels(diff: Difference, mode: ColorMode): Chunk {
  const packed = packPixels(diff.pixels, mode)
  const candidates: Chunk[] = [
    { data: packed, encoding: PixelEncoding.Raw },
    { data: compressRle(packed, mode === 'rgb888' ? 3 : 1), encoding: PixelEncoding.Rle }
  ]
  if (mode === 'rgb888' && diff.previous) candidates.push({ data: compressQoi(diff.pixels), encoding: PixelEncoding.QoiLike })
  return candidates.reduce((best, c) => (c.data.length < best.data.length ? c : best))
}

// MSB-first bit stream.
function bitWriter() {
  const bytes: number[] = []
  let length = 0
  return {
    push(value: number, count: number) {
      for (let bit = count - 1; bit >= 0; bit--) {
        if ((length & 7) === 0) bytes.push(0)
        if ((value >> bit) & 1) bytes[bytes.length - 1] |= 0x80 >> (length & 7)
        length++
      }
    },
    bitLength: () => length,
    toBytes: () => Uint8Array.from(bytes)
  }
}

// Alternating run lengths in 3 bits; 7 escapes to an 8-bit length, and runs of 255+ chain
// through zero-length runs of the other value. Falls back to a plain bitmap when the RLE
// stream would exceed 75% of one bit per pixel.
function encodeMask(mask: Uint8Array): Mask {
  const runs: number[] = []
  let runValue = mask[0]
  let runLength = 0
  for (const v of mask) {
    if (v === runValue) runLength++
    else {
      runs.push(runLength)
      runValue = v
      runLength = 1
    }
  }
  runs.push(runLength)

  const firstIsWhite = mask[0] === 1
  if (runs.length === 1) {
    return { data: new Uint8Array(0), bits: 0, encoding: firstIsWhite ? MaskEncoding.FullyWhite : MaskEncoding.FullyBlack }
  }

  const w = bitWriter()
  for (const run of runs) {
    let length = run
    if (length >= MASK_LONG_RUN_MARKER) {
      while (length >= MASK_LONG_RUN_MAX) {
        w.push(MASK_LONG_RUN_MARKER, MASK_SHORT_RUN_BITS)
        w.push(MASK_LONG_RUN_MAX, MASK_LONG_RUN_BITS)
        length -= MASK_LONG_RUN_MAX
        w.push(0, MASK_SHORT_RUN_BITS)
      }
      w.push(MASK_LONG_RUN_MARKER, MASK_SHORT_RUN_BITS)
      w.push(length, MASK_LONG_RUN_BITS)
    } else {
      w.push(length, MASK_SHORT_RUN_BITS)
    }
  }

  if (w.bitLength() <= mask.length * MASK_RLE_MAX_RATIO) {
    return { data: w.toBytes(), bits: w.bitLength(), encoding: firstIsWhite ? MaskEncoding.RleFirstWhite : MaskEncoding.RleFirstBlack }
  }
  const bitmap = new Uint8Array(Math.ceil(mask.length / 8))
  mask.forEach((v, i) => {
    if (v) bitmap[i >> 3] |= 0x80 >> (i & 7)
  })
  return { data: bitmap, bits: mask.length, encoding: MaskEncoding.Bitmap }
}

// QOI opcodes over RGBA: run (0b11xxxxxx), index (0b00xxxxxx), diff (0b01), luma (0b10),
// RGB (0xFE), RGBA (0xFF). Runs extend in place up to QOI_RUN_LIMIT.
function compressQoi(pixels: Uint8Array): Uint8Array {
  const lut = new Uint32Array(64)
  const out: number[] = []
  let lr = 0
  let lg = 0
  let lb = 0
  let la = 0xff
  let lastWasRun = false

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i]
    const g = pixels[i + 1]
    const b = pixels[i + 2]
    const a = pixels[i + 3]
    const key = ((r << 24) | (g << 16) | (b << 8) | a) >>> 0
    const hash = (r * 3 + g * 5 + b * 7 + a * 11) % 64

    if (r === lr && g === lg && b === lb && a === la) {
      const last = out.length - 1
      if (lastWasRun && out[last] + 1 < QOI_RUN_LIMIT) out[last] += 1
      else out.push(0b11000000)
      lut[hash] = key
      lastWasRun = true
      continue
    }
    lastWasRun = false

    if (lut[hash] === key) {
      out.push(hash)
    } else {
      const dr = r - lr
      const dg = g - lg
      const db = b - lb
      const drDg = dr - dg
      const dbDg = db - dg
      if (a === la && dr >= -2 && dr <= 1 && dg >= -2 && dg <= 1 && db >= -2 && db <= 1) {
        out.push(0b01000000 | ((dr + 2) << 4) | ((dg + 2) << 2) | (db + 2))
      } else if (a === la && dg >= -32 && dg <= 31 && drDg >= -8 && drDg <= 7 && dbDg >= -8 && dbDg <= 7) {
        out.push(0b10000000 | (dg + 32), ((drDg + 8) << 4) | (dbDg + 8))
      } else if (a === la) {
        out.push(0xfe, r, g, b)
      } else {
        out.push(0xff, r, g, b, a)
      }
      lut[hash] = key
    }
    lr = r
    lg = g
    lb = b
    la = a
  }
  return Uint8Array.from(out)
}

// toolbox/rle_encode: opcode < 0x80 = repeat next block N times; 0x80|N = N verbatim blocks.
function compressRle(source: Uint8Array, blockSize: number): Uint8Array {
  const n = source.length
  const out: number[] = []
  let si = 0
  const blockEq = (a: number, b: number) => {
    if (a + blockSize > n || b + blockSize > n) return false
    for (let k = 0; k < blockSize; k++) if (source[a + k] !== source[b + k]) return false
    return true
  }
  while (si < n) {
    let repeat = 0
    for (let i = si; i < n; i += blockSize) {
      if (!blockEq(i, si)) break
      repeat++
    }
    repeat = Math.min(repeat, RLE_MAX_BLOCKS_PER_BYTE)
    if (repeat === 0) break
    if (repeat < RLE_BLOCK_THRESHOLD) {
      let pending = 0
      let verbatim = 0
      for (let i = si; i < n; i += blockSize) {
        if (blockEq(i, i + blockSize)) {
          pending++
          if (pending > RLE_BLOCK_THRESHOLD) break
        } else {
          verbatim += 1 + pending
          pending = 0
        }
      }
      verbatim = Math.min(verbatim + pending, RLE_MAX_BLOCKS_PER_BYTE)
      out.push(0x80 | verbatim)
      for (let k = 0; k < verbatim * blockSize; k++) out.push(source[si + k])
      si += verbatim * blockSize
    } else {
      out.push(repeat)
      for (let k = 0; k < blockSize; k++) out.push(source[si + k])
      si += repeat * blockSize
    }
  }
  return Uint8Array.from(out)
}
