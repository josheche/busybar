// Draw PR-queue app mockups on the real BUSY Bar and save both screens as native-res PNGs.
// Usage: tsx mockups.ts <outdir>
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'

const BASE = 'http://10.0.4.20/api'
const APP = 'pr_mockup'
const out = process.argv[2]
mkdirSync(out, { recursive: true })

type El = Record<string, unknown>
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---- palette
const W = '#FFFFFFFF'
const DIM = '#FFFFFF80'
const GRAY = '#8C8C8CFF'
const BLACK = '#000000FF'
const GREEN = '#3FB950'
const RED = '#F85149'
const AMBER = '#D29922'

// ---- 7x7 icons
const ICONS: Record<string, string[]> = {
  pass: ['......#', '.....##', '#...###', '##.###.', '#####..', '.###...', '..#....'],
  fail: ['.#...#.', '###.###', '.#####.', '..###..', '.#####.', '###.###', '.#...#.'],
  run: ['..###..', '.#...#.', '#.....#', '#..#..#', '#.....#', '.#...#.', '..###..'],
  eye: ['.......', '..###..', '.#...#.', '#..#..#', '.#...#.', '..###..', '.......']
}
const xpm = (rows: string[], color: string) =>
  ['! XPM2', `${rows[0].length} ${rows.length} 2 1`, `# c ${color}`, '. c none', ...rows].join('\n')
const icon = (id: string, kind: keyof typeof ICONS, color: string, x: number, y: number, display: 'front' | 'back'): El => ({
  id, type: 'xpmbitmap', display, x, y, data: xpm(ICONS[kind], color)
})
const text = (id: string, t: string, font: string, color: string, x: number, y: number, display: 'front' | 'back', extra: El = {}): El => ({
  id, type: 'text', display, text: t, font, color, x, y, ...extra
})
const rect = (id: string, x: number, y: number, width: number, height: number, display: 'front' | 'back', fill = W, radius = 0): El => ({
  id, type: 'rectangle', display, x, y, width, height, radius, fill: 'solid', fill_colors: [fill], border_width: 0
})

// ---- back-screen pieces (usable width 148; x >= 148 is the firmware status column)
// 1px position rail on the front's right edge: dim track, bright thumb for item i of n.
const rail = (i: number, n: number): El[] => {
  const h = Math.max(2, Math.floor(16 / n))
  return [rect('rail', 71, 0, 1, 16, 'front', '#FFFFFF33'), rect('thumb', 71, Math.round((i * (16 - h)) / Math.max(1, n - 1)), 1, h, 'front', W)]
}
const header = (left: string, right: string): El[] => [
  rect('hdr', 0, 0, 148, 11, 'back'),
  text('hdr_l', left, 'small', BLACK, 3, 0, 'back'),
  text('hdr_r', right, 'small', BLACK, 145, 0, 'back', { align: 'top_right' })
]
type Row = { kind: keyof typeof ICONS; title: string; meta: string }
const list = (rows: Row[], selected: number): El[] =>
  rows.flatMap((r, i) => {
    const y = 13 + i * 16
    const sel = i === selected
    return [
      ...(sel ? [rect(`sel`, 0, y - 1, 148, 15, 'back', W, 2)] : []),
      icon(`ic${i}`, r.kind, sel ? '#000000' : '#FFFFFF', 3, y + 2, 'back'),
      text(`t${i}`, r.title, 'small', sel ? BLACK : W, 13, y - 1, 'back', { width: 132 }),
      text(`m${i}`, r.meta, 'tiny', sel ? BLACK : GRAY, 13, y + 7, 'back', { width: 132 })
    ]
  })

const REVIEW: Row[] = [
  { kind: 'fail', title: 'feat(search): filter results by tag', meta: 'lantern #142  maya  2d' },
  { kind: 'pass', title: 'fix(cache): expire stale entries', meta: 'lantern #139  theo  5h' },
  { kind: 'run', title: 'chore: bump dependencies', meta: 'tidepool #57  renovate  1h' }
]
const MINE: Row[] = [
  { kind: 'fail', title: 'feat(ui): sticky header on scroll', meta: 'lantern #145  lint failed' },
  { kind: 'pass', title: 'fix: retry uploads after timeout', meta: 'tidepool #58  approved' },
  { kind: 'run', title: 'docs: rewrite the setup guide', meta: 'lantern #146  running' },
  { kind: 'pass', title: 'refactor: split the parser module', meta: 'tidepool #60  ready' }
]

const SCENES: Record<string, { note: string; els: El[] }> = {
  '1-queue': {
    note: 'Glance: review queue summary (front) and the list (back)',
    els: [
      text('count', '3', 'extra_large', W, 2, 8, 'front', { align: 'mid_left' }),
      text('l1', 'to review', 'small', W, 14, 4, 'front', { align: 'mid_left' }),
      text('l2', 'oldest 2d', 'small', DIM, 14, 11, 'front', { align: 'mid_left' }),
      icon('ci', 'fail', RED, 63, 1, 'front'),
      ...header('REVIEW QUEUE', '3'),
      ...list(REVIEW, -1)
    ]
  },
  '2-item': {
    note: 'Wheel turned: one PR in focus (front), its row selected (back)',
    els: [
      icon('ci', 'fail', RED, 1, 1, 'front'),
      text('l1', '#142 lantern', 'small', W, 10, 4, 'front', { align: 'mid_left' }),
      ...rail(0, 3),
      text('l2', 'feat(search): filter results by tag', 'small', DIM, 1, 11, 'front', { align: 'mid_left', width: 68, scroll_rate: 900, scroll_start_delay: 8000 }),
      ...header('REVIEW QUEUE', '1 of 3'),
      ...list(REVIEW, 0)
    ]
  },
  '3-detail': {
    note: 'OK pressed: detail for the focused PR on the back',
    els: [
      icon('ci', 'fail', RED, 1, 1, 'front'),
      text('l1', '#142 lantern', 'small', W, 10, 4, 'front', { align: 'mid_left' }),
      ...rail(0, 3),
      text('l2', 'CI failing: e2e', 'small', RED + 'FF', 1, 11, 'front', { align: 'mid_left' }),
      ...header('lantern #142', '1 of 3'),
      text('d_t1', 'feat(search): filter', 'normal', W, 3, 14, 'back'),
      text('d_t2', 'results by tag', 'normal', W, 3, 24, 'back'),
      text('d_meta', 'maya   opened 2d ago   +214 -37', 'tiny', GRAY, 3, 36, 'back'),
      icon('d_ci', 'fail', '#FFFFFF', 3, 46, 'back'),
      text('d_ci_t', '13 passed, 1 failed: e2e', 'small', W, 13, 45, 'back'),
      icon('d_rv', 'eye', '#FFFFFF', 3, 58, 'back'),
      text('d_rv_t', 'your review requested', 'small', W, 13, 57, 'back'),
      text('d_hint', 'OK close   HOLD START snooze', 'tiny', GRAY, 3, 71, 'back')
    ]
  },
  '4-mine': {
    note: 'START pressed: switch to my PRs and their CI',
    els: [
      icon('c0', 'fail', RED, 1, 1, 'front'),
      icon('c1', 'pass', GREEN, 10, 1, 'front'),
      icon('c2', 'run', AMBER, 19, 1, 'front'),
      icon('c3', 'pass', GREEN, 28, 1, 'front'),
      text('l1', 'mine', 'small', W, 71, 4, 'front', { align: 'mid_right' }),
      text('l2', '2 ok  1 fail  1 run', 'small', DIM, 1, 11, 'front', { align: 'mid_left' }),
      ...header('MY PULL REQUESTS', '4'),
      ...list(MINE, -1)
    ]
  },
  '5-sync': {
    note: 'Loading: stock spinner while GitHub answers',
    els: [
      { id: 'spin', type: 'animation', display: 'front', x: 2, y: 4, stock_path: 'shared/animations/spinner_front_8x8.anim', loop: true },
      text('l1', 'syncing PRs', 'small', W, 14, 4, 'front', { align: 'mid_left' }),
      text('l2', 'github.com', 'small', DIM, 14, 11, 'front', { align: 'mid_left' }),
      ...header('REVIEW QUEUE', ''),
      { id: 'spin_b', type: 'animation', display: 'back', x: 66, y: 26, stock_path: 'shared/animations/spinner_back_16x16.anim', loop: true },
      text('s1', 'Fetching from GitHub', 'small', W, 74, 50, 'back', { align: 'top_mid' }),
      text('s2', 'last sync 4 min ago', 'tiny', GRAY, 74, 62, 'back', { align: 'top_mid' })
    ]
  }
}

// ---- PNG writer (8-bit RGB or gray, no filter)
function png(path: string, w: number, h: number, channels: 1 | 3, px: Uint8Array) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (b: Buffer) => {
    let c = 0xffffffff
    for (const v of b) c = crcTable[(c ^ v) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const t = Buffer.concat([Buffer.from(type), data])
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc(t))
    return Buffer.concat([len, t, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = channels === 3 ? 2 : 0
  const raw = Buffer.alloc((w * channels + 1) * h)
  for (let y = 0; y < h; y++) Buffer.from(px.subarray(y * w * channels, (y + 1) * w * channels)).copy(raw, y * (w * channels + 1) + 1)
  writeFileSync(path, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]))
}

async function grab(scene: string) {
  const front = Buffer.from(await (await fetch(`${BASE}/screen?display=0`)).text(), 'base64')
  const rgb = new Uint8Array(72 * 16 * 3)
  for (let i = 0; i < 72 * 16; i++) {
    rgb[i * 3] = front[i * 3 + 2]
    rgb[i * 3 + 1] = front[i * 3 + 1]
    rgb[i * 3 + 2] = front[i * 3]
  }
  png(join(out, `${scene}-front.png`), 72, 16, 3, rgb)
  const back = Buffer.from(await (await fetch(`${BASE}/screen?display=1`)).text(), 'base64')
  const gray = new Uint8Array(160 * 80)
  for (let i = 0; i < gray.length; i++) gray[i] = ((i & 1 ? back[i >> 1] >> 4 : back[i >> 1]) & 0x0f) * 17
  png(join(out, `${scene}-back.png`), 160, 80, 1, gray)
}

for (const [name, scene] of Object.entries(SCENES)) {
  await fetch(`${BASE}/display/draw?application_name=${APP}`, { method: 'DELETE' })
  const res = await fetch(`${BASE}/display/draw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ application_name: APP, priority: 40, elements: scene.els.map((e) => ({ timeout: 30, ...e })) })
  })
  const body = await res.text()
  if (!res.ok) console.error(`${name}: HTTP ${res.status} ${body}`)
  await sleep(700)
  await grab(name)
  console.info(`${name}: ${res.status} ${scene.note}`)
}
await fetch(`${BASE}/display/draw?application_name=${APP}`, { method: 'DELETE' })
