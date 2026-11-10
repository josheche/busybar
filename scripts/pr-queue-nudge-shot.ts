// Draw the review-request banner (src/widgets/pr-queue-relay/nudge.ts) with an INVENTED pull
// request, through the same function the relay calls, and capture it for the blog.
// Run: npx tsx scripts/pr-queue-nudge-shot.ts [outdir]   (default docs/blog/pr-queue/assets/app)
//
// It first calls the nudge with PR Queue open, to show the bar refuses it there (the app
// announces requests itself), then quits the app, draws, captures, and relaunches the app.
// The banner outranks the Claude widget, so the widget is not on screen in the capture.
import { copyFileSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Pr } from '../apps/pr-queue/src/feed.js'
import { nudge } from '../src/widgets/pr-queue-relay/nudge.js'
import { screenshot } from './screenshot.js'

const BAR = '10.0.4.20'
const BASE = `http://${BAR}/api`
const OUT = process.argv[2] ?? join(import.meta.dirname, '..', 'docs', 'blog', 'pr-queue', 'assets', 'app')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const post = async (path: string) => (await fetch(`${BASE}${path}`, { method: 'POST' })).status

// Invented. Never a real pull request.
const demo: Pr = {
  id: 'demo-nudge', repo: 'lantern', number: 147, title: 'feat(search): remember the last filter', author: 'maya',
  createdMs: Date.now() - 20 * 60_000, updated: 'demo', additions: 88, deletions: 12, draft: false, conflict: false,
  ci: 'run', passed: 4, failed: 0, running: 2, failing: '', review: 'required'
}

console.info(`with PR Queue open: ${await nudge(BAR, [demo], 1)}`)
await post('/apps/quit')
await sleep(800)
try {
  const result = await nudge(BAR, [demo], 1)
  console.info(`with PR Queue closed: ${result}`)
  if (result !== 'shown') throw new Error('the banner was not drawn; nothing captured')
  await sleep(1500)
  const dir = mkdtempSync(join(tmpdir(), 'nudge-shot-'))
  await screenshot(dir)
  mkdirSync(OUT, { recursive: true })
  copyFileSync(join(dir, 'front.png'), join(OUT, '15-review-request-banner-front.png'))
  copyFileSync(join(dir, 'back.png'), join(OUT, '15-review-request-banner-back.png'))
  console.info('  15-review-request-banner')
} finally {
  await fetch(`${BASE}/display/draw?application_name=pr_queue_nudge`, { method: 'DELETE' }).catch(() => {})
  console.info(`PR Queue relaunched: HTTP ${await post('/apps/launch?app_id=app.josh.pr_queue')}`)
}
