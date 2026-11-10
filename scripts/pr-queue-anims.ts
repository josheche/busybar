// Builds the PR Queue app's packaged animations with the repo's bicycle1 encoder.
// Run: npx tsx scripts/pr-queue-anims.ts   (writes apps/pr-queue/src/animations/*.anim)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { encodeAnim, type RgbaFrame } from '../src/lib/anim.js'

const OUT = join(import.meta.dirname, '..', 'apps', 'pr-queue', 'src', 'animations')

// The 7x7 "CI running" ring from the app's static icon, walked clockwise from 12 o'clock.
const RING: Array<[number, number]> = [
  [3, 0], [4, 0], [5, 1], [6, 2], [6, 3], [6, 4], [5, 5], [4, 6],
  [3, 6], [2, 6], [1, 5], [0, 4], [0, 3], [0, 2], [1, 1], [2, 0]
]
const AMBER: [number, number, number] = [0xd2, 0x99, 0x22]
// No alpha in the format: dimmer pixels are the amber pre-multiplied over the black LED.
const shade = (k: number): [number, number, number, number] => [Math.round(AMBER[0] * k), Math.round(AMBER[1] * k), Math.round(AMBER[2] * k), 255]

function spinnerFrame(head: number): RgbaFrame {
  const data = new Uint8ClampedArray(7 * 7 * 4)
  const put = (x: number, y: number, px: [number, number, number, number]) => data.set(px, (y * 7 + x) * 4)
  RING.forEach(([x, y]) => put(x, y, shade(0.22)))
  ;[1, 0.6, 0.35].forEach((k, i) => {
    const [x, y] = RING[(head - i + RING.length) % RING.length]
    put(x, y, shade(k))
  })
  put(3, 3, shade(1))
  return { width: 7, height: 7, data }
}

mkdirSync(OUT, { recursive: true })
const frames = Array.from({ length: 8 }, (_, i) => spinnerFrame(i * 2))
const file = encodeAnim(frames, { fps: 10, colorMode: 'rgb888' })
writeFileSync(join(OUT, 'ci_run.anim'), file)
console.info(`ci_run.anim: ${frames.length} frames, ${file.length} bytes`)
