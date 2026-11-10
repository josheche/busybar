// Session state derived from Claude Code hook events (see hooks/claude-code-hook.sh).
import { readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { SESSION_TTL_MS } from './config.js'

export type HookEvent = {
  event: string
  ts: number
  session_id: string
  cwd?: string | null
  tool_name?: string | null
  notification_type?: string | null
  model?: string | null
  to_model?: string | null
  source?: string | null
  reason?: string | null
  error?: string | null
  stop_hook_active?: boolean | null
  background_tasks?: number | null
  prompt?: string | null
  last_assistant_message?: string | null
}

export type Phase = 'idle' | 'thinking' | 'working' | 'needs_you' | 'done' | 'error'

export type Session = {
  id: string
  project: string
  phase: Phase
  activity: string
  detail: string
  model: string
  updatedAt: number
  phaseSince: number
}

// Urgency drives which session owns the front screen and the back-screen order.
export const URGENCY: Record<Phase, number> = { needs_you: 5, error: 4, done: 3, working: 2, thinking: 2, idle: 0 }

const TOOL_LABELS: Array<[RegExp, string]> = [
  [/^Bash$/, 'bash'],
  [/^(Edit|Write|MultiEdit|NotebookEdit)$/, 'editing'],
  [/^Read$/, 'reading'],
  [/^(Grep|Glob|LS)$/, 'searching'],
  [/^(Agent|Task)$/, 'agents'],
  [/^(WebFetch|WebSearch)$/, 'browsing'],
  [/^Skill$/, 'skill'],
  [/^Workflow$/, 'workflow'],
  [/^AskUserQuestion$/, 'asking you']
]

export function toolLabel(tool: string | null | undefined): string {
  if (!tool) return 'working'
  const mcp = /^mcp__(?:plugin_[^_]+_)?([^_]+)__/.exec(tool)
  if (mcp) return `mcp ${mcp[1].toLowerCase()}`
  for (const [re, label] of TOOL_LABELS) if (re.test(tool)) return label
  return tool.toLowerCase()
}

function projectName(cwd: string | null | undefined, fallback: string): string {
  if (!cwd) return fallback
  const name = basename(cwd)
  return name || fallback
}

function shortError(error: string | null | undefined): string {
  switch (error) {
    case 'rate_limit':
      return 'rate limited'
    case 'overloaded':
      return 'api overloaded'
    case 'authentication_failed':
    case 'oauth_org_not_allowed':
      return 'auth failed'
    case 'max_output_tokens':
      return 'output cut off'
    default:
      return error ? error.replace(/_/g, ' ') : 'api error'
  }
}

// Fold one hook event into a session, creating it when first seen.
export function applyEvent(prev: Session | undefined, e: HookEvent): Session {
  const base: Session = prev ?? {
    id: e.session_id,
    project: projectName(e.cwd, e.session_id.slice(0, 8)),
    phase: 'idle',
    activity: 'ready',
    detail: '',
    model: '',
    updatedAt: e.ts,
    phaseSince: e.ts
  }
  if (prev && e.ts < prev.updatedAt) return prev // async hooks can land out of order

  const next: Session = { ...base, updatedAt: e.ts }
  if (e.cwd) next.project = projectName(e.cwd, next.project)
  if (e.model) next.model = e.model
  if (e.to_model) next.model = e.to_model

  const set = (phase: Phase, activity: string, detail = next.detail) => {
    if (phase !== next.phase) next.phaseSince = e.ts
    next.phase = phase
    next.activity = activity
    next.detail = detail
  }

  switch (e.event) {
    case 'SessionStart':
      set(e.source === 'compact' ? next.phase : 'idle', e.source === 'compact' ? next.activity : 'ready', '')
      break
    case 'UserPromptSubmit':
      set('thinking', 'thinking', e.prompt ?? '')
      break
    case 'PreToolUse':
      set('working', toolLabel(e.tool_name))
      break
    case 'PostToolUse':
    case 'PostToolUseFailure':
    case 'PostCompact':
      set('thinking', 'thinking')
      break
    case 'PreCompact':
      set('working', 'compacting')
      break
    case 'PermissionRequest':
      set('needs_you', `ok ${toolLabel(e.tool_name)}?`)
      break
    case 'Notification':
      if (e.notification_type === 'permission_prompt' || e.notification_type?.startsWith('elicitation')) {
        if (next.phase !== 'needs_you') set('needs_you', 'needs you')
      } else if (e.notification_type === 'idle_prompt') {
        set('idle', 'waiting')
      }
      break
    case 'Stop':
      if (e.stop_hook_active) set('thinking', 'thinking')
      else if ((e.background_tasks ?? 0) > 0) set('working', 'background')
      else set('done', 'done', e.last_assistant_message ?? '')
      break
    case 'StopFailure':
      set('error', shortError(e.error))
      break
    default:
      break
  }
  return next
}

export async function loadSessions(dir: string, now = Date.now()): Promise<Map<string, HookEvent>> {
  const out = new Map<string, HookEvent>()
  let files: string[]
  try {
    files = await readdir(dir)
  } catch {
    return out
  }
  for (const f of files) {
    if (!f.endsWith('.json') || f.startsWith('.')) continue
    try {
      const e = JSON.parse(await readFile(join(dir, f), 'utf8')) as HookEvent
      if (!e.session_id || !e.ts) continue
      if (now - e.ts > SESSION_TTL_MS) continue
      out.set(e.session_id, e)
    } catch {
      // half-written or foreign file; the next tick reads it again
    }
  }
  return out
}
