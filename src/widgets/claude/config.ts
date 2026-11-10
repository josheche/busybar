import { homedir } from 'node:os'
import { join } from 'node:path'

export const APP_NAME = 'claude'
export const ANIM_FRONT = 'clawd.anim'
export const ANIM_BACK = 'clawd2x.anim'

// Where hooks/claude-code-hook.sh drops one JSON file per live Claude Code session.
export const SESSIONS_DIR = process.env.BUSYBAR_CLAUDE_DIR ?? join(homedir(), '.busybar', 'claude', 'sessions')

export const TICK_MS = 1_000
// Liveness by repetition: re-send the scene this often with elements that outlive
// two missed re-sends, so a dead daemon leaves nothing stuck on the screen.
export const RESEND_MS = 10_000
export const ELEMENT_TIMEOUT_S = 25
// A terminal killed without SessionEnd never deletes its file; forget it after this.
export const SESSION_TTL_MS = 6 * 60 * 60 * 1000
// How long a finished turn keeps the headline over sessions that are still working.
export const DONE_FRESH_MS = 90_000
// Everything idle this long: stop drawing and hand the screen back to the bar.
export const IDLE_YIELD_MS = 10 * 60_000
