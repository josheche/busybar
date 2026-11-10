// Clawd, the Claude Code mascot, as a 14x12 pixel sprite sheet encoded into one
// `.anim` file with named sections. The firmware plays and loops sections on its
// own, so the widget only ever sends "which section" (state changes, never frames).
import { encodeAnim, type RgbaFrame } from '../../lib/anim.js'

export const SPRITE_W = 14
export const SPRITE_H = 12
export const SPRITE_FPS = 8

export const CLAUDE_ORANGE = '#DA7756'
const AMBER = '#F5A623'
const PALETTE: Record<string, [number, number, number, number]> = {
  '#': [0xda, 0x77, 0x56, 0xff], // body
  'A': [0xf5, 0xa6, 0x23, 0xff], // attention body
  '.': [0, 0, 0, 0] // transparent / LED off
}

// Each frame is 12 rows of 14 chars. Eyes are LED-off pixels inside the body.
const body = (eyeRows: [string, string], feet: [string, string], tint = '#') =>
  [
    '..##########..',
    '.############.',
    '##############',
    '##############',
    eyeRows[0],
    eyeRows[1],
    '##############',
    '##############',
    '##############',
    '.############.',
    feet[0],
    feet[1]
  ].map((r) => r.replace(/#/g, tint))

const FEET_STAND: [string, string] = ['.##.##..##.##.', '.##.##..##.##.']
const FEET_SQUAT: [string, string] = ['.##.##..##.##.', '..............']

const EYES_OPEN: [string, string] = ['###..####..###', '###..####..###']
const EYES_CLOSED: [string, string] = ['##############', '###..####..###']
const EYES_LEFT: [string, string] = ['##..####..####', '##..####..####']
const EYES_RIGHT: [string, string] = ['####..####..##', '####..####..##']
const EYES_DOWN: [string, string] = ['##############', '###..####..###']
const EYES_WIDE: [string, string] = ['##...###...###', '##...###...###']
const EYES_HAPPY: [string, string] = ['###.######.###', '##.#.####.#.##']

const F = {
  open: body(EYES_OPEN, FEET_STAND),
  closed: body(EYES_CLOSED, FEET_STAND),
  left: body(EYES_LEFT, FEET_STAND),
  right: body(EYES_RIGHT, FEET_STAND),
  down: body(EYES_DOWN, FEET_STAND),
  downSquat: body(EYES_DOWN, FEET_SQUAT),
  wide: body(EYES_WIDE, FEET_STAND, 'A'),
  wideBlink: body(EYES_CLOSED, FEET_STAND, 'A'),
  happy: body(EYES_HAPPY, FEET_STAND),
  happySquat: body(EYES_HAPPY, FEET_SQUAT)
}

const rep = <T>(x: T, n: number): T[] => Array.from({ length: n }, () => x)

// Timeline, in frames at SPRITE_FPS. Section names are what the widget draws.
const TIMELINE: Array<[string, string[][]]> = [
  // calm: glance around, blink
  ['idle', [...rep(F.open, 16), ...rep(F.left, 6), ...rep(F.open, 4), ...rep(F.right, 6), ...rep(F.open, 4), ...rep(F.closed, 2), ...rep(F.open, 2)]],
  // pondering: eyes scan side to side
  ['thinking', [...rep(F.left, 4), ...rep(F.open, 2), ...rep(F.right, 4), ...rep(F.open, 2)]],
  // running a tool: typing bounce, looking down at the keyboard
  ['working', [...rep(F.down, 2), ...rep(F.downSquat, 2)]],
  // blocked on a permission prompt: amber, wide-eyed, slow blink
  ['needs_you', [...rep(F.wide, 10), ...rep(F.wideBlink, 2)]],
  // finished a turn: happy eyes, little hop
  ['done', [...rep(F.happy, 6), ...rep(F.happySquat, 2), ...rep(F.happy, 6), ...rep(F.happySquat, 2)]]
]

export type SpriteSection = 'idle' | 'thinking' | 'working' | 'needs_you' | 'done'

function frameFromRows(rows: string[]): RgbaFrame {
  if (rows.length !== SPRITE_H) throw new Error(`frame has ${rows.length} rows, want ${SPRITE_H}`)
  const data = new Uint8ClampedArray(SPRITE_W * SPRITE_H * 4)
  rows.forEach((row, y) => {
    if (row.length !== SPRITE_W) throw new Error(`row ${y} is ${row.length} wide, want ${SPRITE_W}: ${row}`)
    for (let x = 0; x < SPRITE_W; x++) {
      const px = PALETTE[row[x]]
      if (!px) throw new Error(`unknown palette char '${row[x]}'`)
      data.set(px, (y * SPRITE_W + x) * 4)
    }
  })
  return { width: SPRITE_W, height: SPRITE_H, data }
}

function scaleFrame(frame: RgbaFrame, k: number): RgbaFrame {
  if (k === 1) return frame
  const w = frame.width * k
  const h = frame.height * k
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = ((y / k) | 0) * frame.width + ((x / k) | 0)
      data.set(frame.data.subarray(src * 4, src * 4 + 4), (y * w + x) * 4)
    }
  }
  return { width: w, height: h, data }
}

// The .anim encoder has no alpha: transparent pixels become black, which on the LED
// matrix is simply "off" and on the OLED is the background. `scale` makes a bigger
// Clawd for the back screen; `colorMode: 'gray4'` keeps the red channel's high nibble,
// so orange reads as light gray and the amber attention tint as near-white.
export function buildClawdAnim(scale = 1, colorMode: 'rgb888' | 'gray4' = 'rgb888'): Uint8Array {
  const frames: RgbaFrame[] = []
  const sections: Array<{ name: string; start: number; end: number }> = []
  for (const [name, seq] of TIMELINE) {
    const start = frames.length
    seq.forEach((rows) => frames.push(scaleFrame(frameFromRows(rows), scale)))
    sections.push({ name, start, end: frames.length - 1 })
  }
  return encodeAnim(frames, { fps: SPRITE_FPS, colorMode, sections })
}

// Static fallback for one frame, drawn through the xpmbitmap element (no upload). Used when
// the firmware's .anim version differs from the encoder's, so a format bump shows a still
// Clawd instead of the magenta broken-asset box.
export function clawdXpm(section: SpriteSection = 'idle', scale = 1): string {
  const rows = TIMELINE.find(([n]) => n === section)![1][0]
  const scaled = rows.flatMap((row) => Array<string>(scale).fill([...row].map((c) => c.repeat(scale)).join('')))
  return ['! XPM2', `${SPRITE_W * scale} ${SPRITE_H * scale} 3 1`, `# c ${CLAUDE_ORANGE}`, `A c ${AMBER}`, '. c none', ...scaled].join('\n')
}
