// A review request arrived and PR Queue may not be open: say so on the bar, from the Mac.
//
// A JS app only runs while it is on screen, so the app's own LED blink covers the request
// only when you are already looking at the list. This draws a short banner as a widget.
// Its priority sits below the app's: while PR Queue is open the bar refuses this draw, and
// a refused draw does not blink the LED either, so the app announces the request itself and
// there is never a double alert. During a focus session the bar refuses every draw: no nudge.
// The banner expires on its own and whatever was on screen before draws again.
import type { Pr } from '../../../apps/pr-queue/src/feed.js'
import { fit, wrap } from '../../../apps/pr-queue/src/text.js'

const APP = 'pr_queue_nudge'
const APP_ID = 'app.josh.pr_queue'
/** Above the ambient widgets (15, 20), below the PR Queue app (50). See src/lib/priorities.ts. */
const PRIORITY = 40
const SECONDS = 20
const AMBER = '#D29922'
const W = '#FFFFFFFF'
const DIM = '#FFFFFF80'
const GRAY = '#8C8C8CFF'
const BLACK = '#000000FF'
const CHIME = 'shared/sounds/calendar_event_starts.snd'
const TIMEOUT_MS = 5_000

// The app's 7x7 "eye" (apps/pr-queue/src/icons.ts), as XPM2.
const EYE = ['! XPM2', '7 7 2 1', `# c ${AMBER}`, '. c none', '.......', '..###..', '.#...#.', '#..#..#', '.#...#.', '..###..', '.......'].join('\n')

type El = Record<string, unknown>
const text = (id: string, t: string, font: string, color: string, x: number, y: number, display: 'front' | 'back', extra: El = {}): El => ({
  id, type: 'text', display, text: t, font, color, x, y, timeout: SECONDS, ...extra
})

/**
 * `fresh` holds the new requests the relay has details for (those among the PRs it sends the
 * bar); `count` is how many are new in all, which can be more.
 */
export function nudgeElements(fresh: Pr[], count: number): El[] {
  const one = count === 1 ? fresh[0] : undefined
  const els: El[] = [
    { id: 'eye', type: 'xpmbitmap', display: 'front', x: 1, y: 1, data: EYE, timeout: SECONDS },
    text('l1', count === 1 ? 'review request' : `${count} new requests`, 'small', W, 10, 4, 'front', { align: 'mid_left', width: 61 }),
    text('l2', one ? `#${one.number} ${one.repo}` : 'open PR Queue', 'small', DIM, 1, 11, 'front', { align: 'mid_left', width: 70 }),
    { id: 'hdr', type: 'rectangle', display: 'back', x: 0, y: 0, width: 148, height: 11, radius: 0, fill: 'solid', fill_colors: [W], border_width: 0, timeout: SECONDS },
    text('hdr_l', count === 1 ? 'REVIEW REQUEST' : 'REVIEW REQUESTS', 'small', BLACK, 3, 0, 'back'),
    text('hdr_r', count === 1 ? ' ' : `${count} new`, 'small', BLACK, 145, 0, 'back', { align: 'top_right' })
  ]
  if (one) {
    const [t1, t2] = wrap(one.title, 24, 2)
    els.push(text('t1', t1 ?? one.title, 'normal', W, 3, 14, 'back'))
    if (t2) els.push(text('t2', t2, 'normal', W, 3, 24, 'back'))
    els.push(text('meta', fit(`${one.repo} #${one.number}   ${one.author}`, 36), 'tiny', GRAY, 3, 38, 'back'))
  } else {
    fresh.slice(0, 4).forEach((pr, i) => els.push(text(`r${i}`, fit(`#${pr.number} ${pr.title}`, 34), 'small', W, 3, 14 + i * 11, 'back')))
  }
  els.push(text('hint', 'Open PR Queue to review', 'tiny', GRAY, 3, 71, 'back'))
  return els
}

async function call(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
}

/** Resolves to a short status for the relay's log; never rejects. */
export async function nudge(bar: string, fresh: Pr[], count: number): Promise<string> {
  const base = `http://${bar}/api`
  try {
    const res = await call(`${base}/display/draw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ application_name: APP, priority: PRIORITY, led_notification_color: `${AMBER}FF`, elements: nudgeElements(fresh, count) })
    })
    if (res.status === 409) return 'not shown, the screen is held (PR Queue open, or a focus session)'
    if (!res.ok) return `not shown, the bar answered ${res.status}`
    // The chime follows the app's own setting, read from the bar, so there is one switch for it.
    const settings = (await (await call(`${base}/apps/settings?app_id=${APP_ID}`, {})).json().catch(() => null)) as { values?: { chime?: unknown } } | null
    if (settings?.values?.chime === true) {
      await call(`${base}/audio/play`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ application_name: APP_ID, stock_path: CHIME }) })
    }
    return 'shown'
  } catch (err) {
    return `not shown: ${err instanceof Error ? err.message : String(err)}`
  }
}
