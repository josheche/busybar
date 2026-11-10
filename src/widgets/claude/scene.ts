// Turns the set of live sessions into draw elements for both screens.
//
// Front 72x16 (RGB LED): Clawd at the left, then the focused session's project name
// (small font, rows 2-6), its activity (tiny font, rows 9-12), and one 2x2 dot per
// session along the bottom, colored by phase. Back 160x80 (gray OLED, right 12px is
// the system status column): inverse-video header, one row per session with the
// focused one inverted, a 2x Clawd, and a scrolling detail line (prompt or last reply).
import { toAscii } from '../../lib/bar.js'
import { ASSISTANT } from '../../lib/priorities.js'
import { ANIM_BACK, ANIM_FRONT, DONE_FRESH_MS, ELEMENT_TIMEOUT_S, IDLE_YIELD_MS } from './config.js'
import { SPRITE_H, SPRITE_W, type SpriteSection } from './sprite.js'
import { URGENCY, type Phase, type Session } from './state.js'

export type Element = Record<string, unknown> & { id: string; display: 'front' | 'back' }

export type Scene = {
  key: string // changes whenever something visible changes
  section: SpriteSection
  priority: number
  led?: string
  sprites: Element[] // restart their loop when re-sent, so they are sent sparingly
  elements: Element[] // cheap to re-send
}

const COLOR: Record<Phase, string> = {
  idle: '#6B7280FF',
  thinking: '#7FB3FFFF',
  working: '#7FB3FFFF',
  needs_you: '#F5A623FF',
  done: '#34D399FF',
  error: '#FF5555FF'
}
const WHITE = '#FFFFFFFF'
const BLACK = '#000000FF'
const DIM = '#A0A0A0FF'
const LED_ATTENTION = '#F5A623FF'

const FRONT_TEXT_X = SPRITE_W + 3
const FRONT_TEXT_W = 72 - FRONT_TEXT_X
const BACK_W = 146 // left of the status column
const BACK_ROWS = 4
const SPRITE_TIMEOUT_S = ELEMENT_TIMEOUT_S * 2

const SECTION: Record<Phase, SpriteSection> = {
  idle: 'idle',
  thinking: 'thinking',
  working: 'working',
  needs_you: 'needs_you',
  done: 'done',
  error: 'needs_you'
}

const scroll = { scroll_rate: 1200, scroll_start_delay: 1500, scroll_repeat_delay: 2500 }

function rank(s: Session, now: number): number {
  // A finished turn outranks running work only while it is fresh.
  if (s.phase === 'done' && now - s.phaseSince > DONE_FRESH_MS) return URGENCY.thinking - 0.5
  return URGENCY[s.phase]
}

export function orderSessions(sessions: Iterable<Session>, now: number): Session[] {
  return [...sessions].sort((a, b) => rank(b, now) - rank(a, now) || b.updatedAt - a.updatedAt)
}

function isActive(s: Session, now: number): boolean {
  return s.phase !== 'idle' ? now - s.updatedAt < IDLE_YIELD_MS : false
}

function detailFor(s: Session): string {
  switch (s.phase) {
    case 'needs_you':
      return `waiting for your approval: ${s.activity.replace(/^ok |\?$/g, '')}`
    case 'done':
      return s.detail ? `said: ${s.detail}` : 'finished, waiting for you'
    case 'error':
      return `turn failed: ${s.activity}`
    case 'idle':
      return s.activity === 'waiting' ? 'finished a while ago, waiting for you' : 'ready for a prompt'
    default:
      return s.detail ? `on: ${s.detail}` : s.activity
  }
}

// Null means nothing worth showing: the widget yields the screen to the bar.
export function buildScene(all: Iterable<Session>, now = Date.now()): Scene | null {
  const sessions = orderSessions(all, now)
  if (!sessions.some((s) => isActive(s, now))) return null

  const focus = sessions[0]
  const others = sessions.length - 1
  const attention = sessions.some((s) => s.phase === 'needs_you')
  const section = SECTION[focus.phase]

  const sprites: Element[] = [
    { id: 'clawd', type: 'animation', display: 'front', x: 1, y: 2, path: ANIM_FRONT, section, loop: true, opacity: 100, timeout: SPRITE_TIMEOUT_S },
    { id: 'clawd2x', type: 'animation', display: 'back', x: BACK_W - SPRITE_W * 2 - 2, y: 78 - SPRITE_H * 2 - 12, path: ANIM_BACK, section, loop: true, opacity: 100, timeout: SPRITE_TIMEOUT_S }
  ]

  const elements: Element[] = [
    {
      id: 'project',
      type: 'text',
      display: 'front',
      x: FRONT_TEXT_X,
      y: 0,
      align: 'top_left',
      font: 'small',
      color: WHITE,
      width: FRONT_TEXT_W,
      text: toAscii(others > 0 ? `${focus.project} +${others}` : focus.project),
      ...scroll,
      timeout: ELEMENT_TIMEOUT_S
    },
    {
      id: 'activity',
      type: 'text',
      display: 'front',
      x: FRONT_TEXT_X,
      y: 8,
      align: 'top_left',
      font: 'tiny',
      color: COLOR[focus.phase],
      width: FRONT_TEXT_W,
      text: toAscii(focus.activity),
      ...scroll,
      timeout: ELEMENT_TIMEOUT_S
    },
    ...sessions.slice(0, 10).map((s, i) => ({
      id: `dot${i}`,
      type: 'rectangle',
      display: 'front' as const,
      x: FRONT_TEXT_X + i * 3,
      y: 14,
      width: 2,
      height: 2,
      fill: 'solid',
      fill_colors: [COLOR[s.phase]],
      border_width: 0,
      timeout: ELEMENT_TIMEOUT_S
    })),
    // back: header
    { id: 'hdr_bg', type: 'rectangle', display: 'back', x: 0, y: 0, width: BACK_W, height: 9, fill: 'solid', fill_colors: [WHITE], border_width: 0, timeout: ELEMENT_TIMEOUT_S },
    { id: 'hdr', type: 'text', display: 'back', x: 3, y: 1, align: 'top_left', font: 'small', color: BLACK, text: 'CLAUDE CODE', timeout: ELEMENT_TIMEOUT_S },
    { id: 'hdr_n', type: 'text', display: 'back', x: BACK_W - 3, y: 1, align: 'top_right', font: 'small', color: BLACK, text: `${sessions.length} session${sessions.length === 1 ? '' : 's'}`, timeout: ELEMENT_TIMEOUT_S },
    // back: one row per session, the focused one in inverse video
    ...sessions.slice(0, BACK_ROWS).flatMap((s, i) => {
      const y = 12 + i * 11
      const focused = i === 0
      const fg = focused ? BLACK : WHITE
      const row: Element[] = []
      if (focused) row.push({ id: `row${i}_bg`, type: 'rectangle', display: 'back', x: 0, y, width: 112, height: 10, radius: 2, fill: 'solid', fill_colors: [WHITE], border_width: 0, timeout: ELEMENT_TIMEOUT_S })
      row.push(
        { id: `row${i}_p`, type: 'text', display: 'back', x: 3, y: y + 1, align: 'top_left', font: 'small', color: fg, width: 64, text: toAscii(s.project), timeout: ELEMENT_TIMEOUT_S },
        { id: `row${i}_a`, type: 'text', display: 'back', x: 109, y: y + 2, align: 'top_right', font: 'tiny', color: fg, text: toAscii(s.activity), timeout: ELEMENT_TIMEOUT_S }
      )
      return row
    }),
    // back: detail line for the focused session
    { id: 'detail', type: 'text', display: 'back', x: 3, y: 68, align: 'top_left', font: 'tiny', color: DIM, width: BACK_W - 6, text: toAscii(detailFor(focus)), ...scroll, timeout: ELEMENT_TIMEOUT_S }
  ]

  const key = JSON.stringify({ section, elements: elements.map(({ timeout: _t, ...e }) => e) })
  // One fixed priority: the device only accepts a draw at >= the running app's priority,
  // and after drawing at a higher rung our own canvas becomes the running app, so a
  // later lower-priority draw from the same name is refused. Attention goes to the LED.
  return {
    key,
    section,
    priority: ASSISTANT,
    led: attention ? LED_ATTENTION : undefined,
    sprites,
    elements
  }
}
