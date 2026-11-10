// Wires hooks/claude-code-hook.sh into ~/.claude/settings.json for every event the
// busybar claude widget reads, backing the file up first. Idempotent: existing entries
// for the same script are kept. `--uninstall` removes them again.
// Run with: npm run claude:hooks [-- --uninstall]
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HOOK = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'claude-code-hook.sh')
const SETTINGS = process.env.CLAUDE_SETTINGS ?? join(homedir(), '.claude', 'settings.json')
const BACKUPS = join(dirname(SETTINGS), 'backups')

// SessionEnd stays synchronous: all SessionEnd hooks share a 1.5s budget and an async
// one may be torn down before its rm lands. Everything else is fire-and-forget so no
// turn ever waits on the bar.
const EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'Notification',
  'Stop',
  'StopFailure',
  'PreCompact',
  'PostCompact',
  'PostModelSwitch',
  'SessionEnd'
]

type Handler = { type: string; command?: string; async?: boolean; [k: string]: unknown }
type Entry = { matcher?: string; hooks: Handler[] }
type Settings = { hooks?: Record<string, Entry[]>; [k: string]: unknown }

const uninstall = process.argv.includes('--uninstall')
const settings = JSON.parse(readFileSync(SETTINGS, 'utf8')) as Settings
settings.hooks ??= {}

mkdirSync(BACKUPS, { recursive: true })
const backup = join(BACKUPS, `settings.json.busybar-${new Date().toISOString().replace(/[:.]/g, '-')}.bak`)
copyFileSync(SETTINGS, backup)

const isOurs = (h: Handler) => h.type === 'command' && h.command === HOOK
let added = 0
let kept = 0
let removed = 0

for (const event of EVENTS) {
  const entries = settings.hooks[event] ?? []
  const mine = entries.filter((e) => e.hooks.some(isOurs))
  if (uninstall) {
    const rest = entries
      .map((e) => ({ ...e, hooks: e.hooks.filter((h) => !isOurs(h)) }))
      .filter((e) => e.hooks.length > 0)
    removed += mine.length
    if (rest.length) settings.hooks[event] = rest
    else delete settings.hooks[event]
    continue
  }
  if (mine.length) {
    kept++
    continue
  }
  entries.push({ hooks: [{ type: 'command', command: HOOK, async: event !== 'SessionEnd' }] })
  settings.hooks[event] = entries
  added++
}
if (Object.keys(settings.hooks).length === 0) delete settings.hooks

writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n')
console.info(`backup: ${backup}`)
console.info(uninstall ? `removed ${removed} hook entr${removed === 1 ? 'y' : 'ies'}` : `hooks: ${added} added, ${kept} already present (${EVENTS.length} events)`)
console.info(`hook script: ${HOOK}${existsSync(HOOK) ? '' : '  (MISSING)'}`)
