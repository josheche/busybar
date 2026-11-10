// Claude Code session status on the BUSY Bar: a looping Clawd sprite plus what each
// session is doing. Input is the per-session JSON files that hooks/claude-code-hook.sh
// writes; see scripts/install-claude-hooks.ts for wiring those hooks into Claude Code.
import { mkdirSync, watch } from 'node:fs'

import { ANIM_SIGNATURE } from '../../lib/anim.js'
import { bar, readDeviceAnimSignature } from '../../lib/bar.js'
import { ANIM_BACK, ANIM_FRONT, APP_NAME, RESEND_MS, SESSIONS_DIR, TICK_MS } from './config.js'
import { buildScene, type Element, type Scene } from './scene.js'
import { buildClawdAnim, clawdXpm } from './sprite.js'
import { applyEvent, loadSessions, type Session } from './state.js'

const sessions = new Map<string, Session>()
let lastScene: Scene | null = null
let lastSentAt = 0
let lastSpriteAt = 0
let drawing = false
let lastErrorAt = 0
let spritesUploaded = false
// Set when the firmware plays a different .anim version than src/lib/anim.ts writes.
let stillSprites = false
// A JS app (priority 50) or a BUSY timer owns the screen: draws come back 409 after the bar
// holds each one ~0.7 s. There is no endpoint that names the foreground app, so the refusal
// is the signal. Back off instead of refusing on every hook event, then probe on a widening
// cadence; the first draw that lands is the screen coming back.
const YIELD_STEPS_MS = [5_000, 10_000, 20_000, 30_000]
let yieldStep = 0
let yieldUntil = 0

function yieldScreen(now: number) {
  if (yieldStep === 0) console.info('screen taken by a higher-priority app: backing off')
  yieldUntil = now + YIELD_STEPS_MS[Math.min(yieldStep, YIELD_STEPS_MS.length - 1)]
  yieldStep++
  // The next draw that lands must repaint everything, sprites included.
  lastScene = null
}

function logError(where: string, err: unknown) {
  const now = Date.now()
  if (now - lastErrorAt < 60_000) return
  lastErrorAt = now
  console.error(`${where} failed:`, err instanceof Error ? err.message : err)
}

// The sprite files live on the bar's storage, so this is only needed after a factory
// reset or a sprite change, but a fresh boot can race the USB link coming up: keep
// trying on each tick until both uploads have succeeded once. Firmware auto-updates can
// change the .anim version under us, so check it first and fall back to still sprites.
async function uploadSprites() {
  if (spritesUploaded) return
  const device = await readDeviceAnimSignature()
  if (device !== ANIM_SIGNATURE) {
    console.error(`bar plays ${JSON.stringify(device)} animations, encoder writes ${ANIM_SIGNATURE}: drawing a still Clawd. Port the encoder (see src/lib/anim.ts).`)
    stillSprites = true
    spritesUploaded = true
    return
  }
  for (const [file, data] of [
    [ANIM_FRONT, buildClawdAnim(1, 'rgb888')],
    [ANIM_BACK, buildClawdAnim(2, 'gray4')]
  ] as const) {
    await bar.AssetsUpload({ application_name: APP_NAME, file, data: new Blob([data]) })
    console.info(`uploaded ${file} (${data.length} bytes)`)
  }
  spritesUploaded = true
}

// Same position and id, so the swap is invisible to the rest of the scene.
function asStill(sprite: Element, section: Scene['section']): Element {
  const { path: _path, section: _section, loop: _loop, ...rest } = sprite
  return { ...rest, type: 'xpmbitmap', data: clawdXpm(section, sprite.display === 'back' ? 2 : 1) }
}

async function sync() {
  const events = await loadSessions(SESSIONS_DIR)
  for (const id of [...sessions.keys()]) if (!events.has(id)) sessions.delete(id)
  for (const [id, e] of events) sessions.set(id, applyEvent(sessions.get(id), e))
}

async function render(force = false) {
  const now = Date.now()
  const scene = buildScene(sessions.values(), now)

  if (!scene) {
    if (drawing) {
      drawing = false
      lastScene = null
      await bar.DisplayClear({ application_name: APP_NAME }).catch((err) => logError('clear', err))
      console.info('all quiet: handed the screen back')
    }
    return
  }

  if (now < yieldUntil) return

  const changed = scene.key !== lastScene?.key
  const resendDue = now - lastSentAt >= RESEND_MS
  if (!changed && !resendDue && !force) return

  // Re-sending an animation element restarts its loop, so the sprite only goes out
  // when its section changes or for liveness, on a longer cadence than the text.
  const spriteDue = scene.section !== lastScene?.section || now - lastSpriteAt >= RESEND_MS * 2 || force
  const sprites = stillSprites ? scene.sprites.map((s) => asStill(s, scene.section)) : scene.sprites
  const elements = spriteDue ? [...sprites, ...scene.elements] : scene.elements

  try {
    await bar.DisplayDraw({
      application_name: APP_NAME,
      priority: scene.priority,
      ...(scene.led ? { led_notification_color: scene.led } : {}),
      elements: elements as Parameters<typeof bar.DisplayDraw>[0]['elements']
    })
  } catch (err) {
    if ((err as { status?: number }).status === 409) return yieldScreen(now)
    throw err
  }
  if (yieldStep > 0) {
    console.info(`screen free again after ${yieldStep} refused probe(s): redrawn`)
    yieldStep = 0
  }
  drawing = true
  lastSentAt = now
  if (spriteDue) lastSpriteAt = now
  if (changed) {
    lastScene = scene
    const focus = [...sessions.values()].find((s) => scene.elements.some((e) => e.id === 'project' && String(e.text).startsWith(s.project)))
    console.info(`${scene.section.padEnd(9)} ${focus?.project ?? '?'}: ${focus?.activity ?? '?'}  [${sessions.size} session(s)]`)
  }
}

let pending: NodeJS.Timeout | null = null
function scheduleRefresh() {
  if (pending) return
  pending = setTimeout(() => {
    pending = null
    sync()
      .then(() => render())
      .catch((err) => logError('refresh', err))
  }, 60)
}

async function shutdown() {
  if (drawing) await bar.DisplayClear({ application_name: APP_NAME }).catch(() => {})
  process.exit(0)
}

mkdirSync(SESSIONS_DIR, { recursive: true })
console.info(`busybar claude widget: watching ${SESSIONS_DIR}`)
await uploadSprites().catch((err) => logError('upload', err))
await sync()
await render(true).catch((err) => logError('render', err))
watch(SESSIONS_DIR, scheduleRefresh)
setInterval(() => {
  uploadSprites()
    .catch((err) => logError('upload', err))
    .then(() => sync())
    .then(() => render())
    .catch((err) => logError('tick', err))
}, TICK_MS)
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
