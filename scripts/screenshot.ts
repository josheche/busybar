// Grab both screens as PNGs (upscaled so they are legible on a laptop).
// Run with: npm run screenshot [-- outdir]
// GET /screen?display=N returns base64 text (Content-Type lies: image/bmp) of the
// device-native framebuffer: BGR888 for the front (72*16*3 bytes) and Gray4 for the
// back (160*80/2 bytes, two pixels per byte, LOW nibble = earlier pixel, which is the
// opposite of the .anim Gray4 packing). Verified on fw 1.2.4 by reading text back.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import sharp from 'sharp'

const ADDR = process.env.BUSYBAR_ADDR ?? '10.0.4.20'
const SCREENS = [
  { display: 0, name: 'front', width: 72, height: 16, scale: 10, channels: 3 },
  { display: 1, name: 'back', width: 160, height: 80, scale: 4, channels: 1 }
] as const

// Returns RGB (3 bytes/px) for the front, 8-bit gray (1 byte/px) for the back.
export async function grabScreen(display: 0 | 1): Promise<Buffer> {
  const res = await fetch(`http://${ADDR}/api/screen?display=${display}`)
  if (!res.ok) throw new Error(`screen ${display}: HTTP ${res.status}`)
  const raw = Buffer.from(await res.text(), 'base64')
  if (display === 0) {
    const rgb = Buffer.alloc(raw.length)
    for (let i = 0; i < raw.length; i += 3) {
      rgb[i] = raw[i + 2]
      rgb[i + 1] = raw[i + 1]
      rgb[i + 2] = raw[i]
    }
    return rgb
  }
  const gray = Buffer.alloc(raw.length * 2)
  for (let i = 0; i < raw.length; i++) {
    gray[i * 2] = ((raw[i] & 0x0f) << 4) | (raw[i] & 0x0f)
    gray[i * 2 + 1] = (raw[i] & 0xf0) | (raw[i] >> 4)
  }
  return gray
}

export async function screenshot(outDir: string) {
  mkdirSync(outDir, { recursive: true })
  const out: string[] = []
  for (const s of SCREENS) {
    const rgb = await grabScreen(s.display)
    if (rgb.length !== s.width * s.height * s.channels) {
      throw new Error(`${s.name}: expected ${s.width * s.height * s.channels} bytes, got ${rgb.length}`)
    }
    const file = join(outDir, `${s.name}.png`)
    await sharp(rgb, { raw: { width: s.width, height: s.height, channels: s.channels } })
      .resize(s.width * s.scale, s.height * s.scale, { kernel: 'nearest' })
      .png()
      .toFile(file)
    out.push(file)
  }
  return out
}

if (process.argv[1]?.endsWith('screenshot.ts')) {
  const dir = process.argv[2] ?? '/tmp/busybar-shots'
  const files = await screenshot(dir)
  console.info(files.join('\n'))
}
