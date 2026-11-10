// Compose the blog's images from the demo captures: each bar "view" is the front LED strip
// over the back OLED, and a figure is a row or grid of views on the blog's dark background.
// Run: npx tsx scripts/blog-composites.ts   (reads docs/blog/pr-queue/assets/{app,claude,scope},
// writes docs/blog/pr-queue/assets/post). Inputs are demo-mode captures only; see the
// publishing rules at the top of docs/blog/pr-queue/log.md.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import sharp from 'sharp'

const ASSETS = join(import.meta.dirname, '..', 'docs', 'blog', 'pr-queue', 'assets')
const OUT = join(ASSETS, 'post')
const BG = { r: 24, g: 24, b: 27, alpha: 1 }
const FRONT_W = 720
const FRONT_H = 160
const BACK_W = 640
const BACK_H = 320
const GAP = 16
const PAD = 40

type View = { front: string; back?: string }

/** A capture pair by its basename, e.g. view('app', '01-review-glance'). */
const view = (dir: string, name: string, withBack = true): View => ({
  front: join(ASSETS, dir, `${name}-front.png`),
  ...(withBack ? { back: join(ASSETS, dir, `${name}-back.png`) } : {})
})

async function renderView(v: View): Promise<{ data: Buffer; width: number; height: number }> {
  // The scope mockups were saved at native resolution (72x16); captures are already 10x.
  const front = await sharp(v.front).resize(FRONT_W, FRONT_H, { kernel: 'nearest' }).png().toBuffer()
  const height = v.back ? FRONT_H + GAP + BACK_H : FRONT_H
  const layers: sharp.OverlayOptions[] = [{ input: front, left: 0, top: 0 }]
  if (v.back) layers.push({ input: await sharp(v.back).resize(BACK_W, BACK_H, { kernel: 'nearest' }).png().toBuffer(), left: Math.floor((FRONT_W - BACK_W) / 2), top: FRONT_H + GAP })
  const data = await sharp({ create: { width: FRONT_W, height, channels: 4, background: BG } }).composite(layers).png().toBuffer()
  return { data, width: FRONT_W, height }
}

/** Lays views out in a grid; `size` forces the canvas (for the 1200x630 cover) and scales the grid to fit. */
async function figure(name: string, views: View[], cols: number, size?: { width: number; height: number }) {
  const cells = await Promise.all(views.map(renderView))
  const rows = Math.ceil(cells.length / cols)
  const cellH = Math.max(...cells.map((c) => c.height))
  const width = PAD + cols * (FRONT_W + PAD)
  const height = PAD + rows * (cellH + PAD)
  const grid = await sharp({ create: { width, height, channels: 4, background: BG } })
    .composite(cells.map((c, i) => ({ input: c.data, left: PAD + (i % cols) * (FRONT_W + PAD), top: PAD + Math.floor(i / cols) * (cellH + PAD) })))
    .png()
    .toBuffer()
  const file = join(OUT, `${name}.png`)
  if (!size) {
    await sharp(grid).png({ compressionLevel: 9 }).toFile(file)
  } else {
    const fitted = await sharp(grid).resize(size.width, size.height, { fit: 'contain', background: BG, kernel: 'nearest' }).png().toBuffer()
    await sharp(fitted).png({ compressionLevel: 9 }).toFile(file)
  }
  const meta = await sharp(file).metadata()
  console.info(`${name}.png  ${meta.width}x${meta.height}`)
}

mkdirSync(OUT, { recursive: true })
await figure('busy-bar-cover', [view('claude', '01-working'), view('app', '01-review-glance')], 2, { width: 1200, height: 630 })
await figure('busy-bar-clawd-broken', [view('claude', '00-broken-after-update'), view('claude', '01-working')], 2)
await figure('busy-bar-clawd-states', [view('claude', '02-needs-you'), view('claude', '03-done')], 2)
await figure('busy-bar-pr-queue-review', [view('app', '01-review-glance'), view('app', '02-review-item-failing'), view('app', '03-review-detail-failing')], 3)
await figure('busy-bar-pr-queue-mine', [view('app', '07-mine-glance'), view('app', '11-mine-detail-approved')], 2)
await figure('busy-bar-pr-queue-mine-before-after', [view('scope', '4-mine', false), view('app', '07-mine-glance', false)], 2)
await figure('busy-bar-pr-queue-offline', [view('app', '13-syncing'), view('app', '14-relay-offline')], 2)
await figure('busy-bar-pr-queue-banner', [view('app', '15-review-request-banner')], 1)
