// Capture the Claude Code widget for the blog, with INVENTED sessions.
// Run: npx tsx scripts/claude-blog-shots.ts [outdir]   (default docs/blog/pr-queue/assets/claude)
//
// The live widget shows real project names and prompts, so it is never captured. This draws
// the widget's own scene (src/widgets/claude/scene.ts) for made-up sessions, under a separate
// app name and at a priority above the live widget, which is refused the screen meanwhile.
// It quits the PR Queue app first (a JS app outranks this) and relaunches it at the end.
//
// The first scene recreates the bug this all started with: firmware 1.3.1 reads .anim v1
// ("bicycle1") and draws a v0 file as a magenta broken-asset box.
import { copyFileSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { bar } from '../src/lib/bar.js'
import { ANIM_BACK, ANIM_FRONT } from '../src/widgets/claude/config.js'
import { buildScene, type Element } from '../src/widgets/claude/scene.js'
import { buildClawdAnim } from '../src/widgets/claude/sprite.js'
import type { Phase, Session } from '../src/widgets/claude/state.js'
import { screenshot } from './screenshot.js'

const BASE = 'http://10.0.4.20/api'
const APP = 'claude_demo'
const PR_QUEUE = 'app.josh.pr_queue'
/** Above the live widget (20), below a JS app (50). */
const PRIORITY = 40
const OUT = process.argv[2] ?? join(import.meta.dirname, '..', 'docs', 'blog', 'pr-queue', 'assets', 'claude')
const TMP = mkdtempSync(join(tmpdir(), 'claude-shots-'))
const V0 = { front: 'clawd_v0.anim', back: 'clawd2x_v0.anim' }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const now = Date.now()

function session(project: string, phase: Phase, activity: string, detail = ''): Session {
  return { id: project, project, phase, activity, detail, model: 'demo', updatedAt: now, phaseSince: now }
}

// Invented projects and prompts. Never put a real session here.
const lanternWorking = [
  session('lantern', 'working', 'editing', 'add tag filters to the search page'),
  session('tidepool', 'thinking', 'thinking', 'why do uploads time out on slow links'),
  session('atlas', 'idle', 'waiting')
]
const SCENES: Array<{ name: string; sessions: Session[]; v0?: boolean }> = [
  { name: 'broken-after-update', sessions: lanternWorking, v0: true },
  { name: 'working', sessions: lanternWorking },
  { name: 'needs-you', sessions: [session('tidepool', 'needs_you', 'ok bash?'), session('lantern', 'working', 'reading', 'add tag filters to the search page')] },
  { name: 'done', sessions: [session('lantern', 'done', 'done', 'Tag filters are in, with tests. Two files changed.'), session('tidepool', 'thinking', 'thinking')] },
  { name: 'thinking', sessions: [session('lantern', 'thinking', 'thinking', 'rewrite the setup guide for new contributors')] }
]

async function post(path: string): Promise<number> {
  return (await fetch(`${BASE}${path}`, { method: 'POST' })).status
}

async function draw(elements: Element[]): Promise<void> {
  const res = await fetch(`${BASE}/display/draw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ application_name: APP, priority: PRIORITY, elements })
  })
  // A refused draw would leave the live widget on screen: stop before anything is captured.
  if (!res.ok) throw new Error(`draw refused (${res.status}): ${(await res.text()).slice(0, 120)}`)
}

const clear = () => fetch(`${BASE}/display/draw?application_name=${APP}`, { method: 'DELETE' })

async function upload(file: string, data: Uint8Array) {
  await bar.AssetsUpload({ application_name: APP, file, data: new Blob([data]) })
}

/** The same bytes with the old signature: what the widget was still writing after the update. */
function asV0(data: Uint8Array): Uint8Array {
  const copy = Uint8Array.from(data)
  copy.set(new TextEncoder().encode('bicycle0'), 0)
  return copy
}

mkdirSync(OUT, { recursive: true })
await post('/apps/quit')
await sleep(800)
try {
  const front = buildClawdAnim(1, 'rgb888')
  const back = buildClawdAnim(2, 'gray4')
  await upload(ANIM_FRONT, front)
  await upload(ANIM_BACK, back)
  await upload(V0.front, asV0(front))
  await upload(V0.back, asV0(back))

  let n = 0
  for (const { name, sessions, v0 } of SCENES) {
    const scene = buildScene(sessions, now)
    if (!scene) throw new Error(`${name}: nothing to draw`)
    const sprites = v0 ? scene.sprites.map((s) => ({ ...s, path: s.display === 'front' ? V0.front : V0.back })) : scene.sprites
    await clear()
    await draw([...sprites, ...scene.elements])
    await sleep(1500)
    const label = `${String(n++).padStart(2, '0')}-${name}`
    const dir = join(TMP, label)
    await screenshot(dir)
    copyFileSync(join(dir, 'front.png'), join(OUT, `${label}-front.png`))
    copyFileSync(join(dir, 'back.png'), join(OUT, `${label}-back.png`))
    console.info(`  ${label}`)
  }
} finally {
  await clear().catch(() => {})
  await bar.AssetsDelete({ application_name: APP }).catch(() => {})
  const status = await post(`/apps/launch?app_id=${PR_QUEUE}`)
  console.info(`PR Queue relaunched: HTTP ${status}`)
}
