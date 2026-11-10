// PR Queue relay: syncs with GitHub on the Mac and serves the finished lists to the bar
// over the USB cable, so no GitHub credential is ever stored on the bar.
//
// Why: the bar keeps app settings as a plain file that its password-free USB API can read
// (`/api/storage/read` is not local-only), so a token there is readable by anything on the
// Mac, anyone who plugs into the bar, and possibly BUSY's cloud API.
//
// Exposure of this server: it listens only on the Mac's end of the USB link (10.0.4.21,
// not Wi-Fi) and answers only the bar (10.0.4.20) and the Mac itself, and only requests
// addressed to it by that IP (the Host check stops a web page in the Mac's browser from
// reading the lists through DNS rebinding). It serves PR summaries read-only; nothing it
// accepts can change anything on GitHub.
//
//   GET  /v1/feed      the last lists (Feed in apps/pr-queue/src/feed.ts)
//   POST /v1/refresh   sync now (at most every MIN_GAP_MS), then the lists
//   POST /v1/open      {"id": "<PR id>"}: open that PR's page in the Mac's browser. Bar only.
//                      The page address comes from the relay's own last sync, or from
//                      GitHub by that id; nothing in the request is ever opened or run.
//
// It also draws a short banner on the bar when a review request arrives (nudge.ts).
import { execFile } from 'node:child_process'
import { createServer, type ServerResponse } from 'node:http'

import { FEED_VERSION, type Feed } from '../../../apps/pr-queue/src/feed.js'
import { ascii } from '../../../apps/pr-queue/src/text.js'
import { fetchLists, pageOf } from './github.js'
import { nudge } from './nudge.js'

const HOST = process.env.PR_RELAY_HOST ?? '10.0.4.21'
const PORT = Number(process.env.PR_RELAY_PORT ?? 8787)
const BAR = process.env.PR_RELAY_BAR ?? '10.0.4.20'
const ALLOWED = new Set([BAR, HOST])
const HOSTS = new Set([HOST, `${HOST}:${PORT}`])
/** Optional owner filter, e.g. PR_QUEUE_ORGS="my-org other-org". Empty: every repo gh can see. */
const ORGS = (process.env.PR_QUEUE_ORGS ?? '').split(/[\s,]+/).filter((o) => /^[A-Za-z0-9-]+$/.test(o))
/** Only PRs touched in this many days; PR_QUEUE_DAYS=0 turns the window off. */
const DAYS = ((n) => (Number.isFinite(n) && n >= 0 ? n : 30))(Number(process.env.PR_QUEUE_DAYS ?? 30))
/** PR_QUEUE_NUDGE=0: no banner on the bar when a review request arrives. */
const NUDGE = process.env.PR_QUEUE_NUDGE !== '0'
const OPEN_CMD = process.env.PR_RELAY_OPEN_CMD ?? '/usr/bin/open'
const OPEN_GAP_MS = 2_000
const REFRESH_MS = 3 * 60_000
const MIN_GAP_MS = 20_000
/**
 * A sync takes ~6 s (two lists, 100 PRs counted each). The bar's fetch timeout is not
 * documented, so a refresh answers within this and says `syncing`; the app asks again.
 */
const REFRESH_WAIT_MS = 3_000
const REBIND_MS = 30_000

let feed: Feed = { version: FEED_VERSION, generatedAt: 0, lists: null, error: 'first sync pending' }
let inFlight: Promise<void> | null = null
let lastRun = 0
/** Review-request ids in the previous good sync; null before the first. */
let lastReviewIds: Set<string> | null = null
/** PR id -> its page, for the PRs in the current feed. */
let pages = new Map<string, string>()
let lastOpen = 0

function refresh(): Promise<void> {
  if (inFlight) return inFlight
  lastRun = Date.now()
  inFlight = (async () => {
    try {
      const { lists, reviewIds, urls } = await fetchLists(ORGS, DAYS)
      // New: in this sync and not the one before. With the DAYS window that includes an old
      // request whose PR just saw activity again, which is also worth a look.
      const before = lastReviewIds
      const fresh = before ? reviewIds.filter((id) => !before.has(id)) : []
      lastReviewIds = new Set(reviewIds)
      pages = urls
      feed = { version: FEED_VERSION, generatedAt: Date.now(), lists, error: '', newReviews: fresh.length }
      console.info(`synced: ${lists.review.total} review${fresh.length ? ` (${fresh.length} new)` : ''}, ${lists.mine.total} mine`)
      if (fresh.length > 0 && NUDGE) {
        void nudge(BAR, lists.review.prs.filter((p) => fresh.includes(p.id)), fresh.length).then((result) => console.info(`nudge: ${result}`))
      }
    } catch (err) {
      const message = ascii(err instanceof Error ? err.message : String(err)).slice(0, 60)
      feed = { ...feed, error: message }
      console.error(`sync failed: ${message}`)
    }
  })().finally(() => {
    inFlight = null
  })
  return inFlight
}

function send(res: ServerResponse, status: number, body?: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(body === undefined ? undefined : JSON.stringify(body))
}

const server = createServer((req, res) => {
  const peer = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '')
  if (!ALLOWED.has(peer) || !HOSTS.has(req.headers.host ?? '')) return send(res, 403, { error: 'forbidden' })
  const path = (req.url ?? '/').split('?')[0]
  if (req.method === 'GET' && path === '/v1/feed') return send(res, 200, { ...feed, syncing: inFlight !== null })
  if (req.method === 'POST' && path === '/v1/refresh') {
    const run = Date.now() - lastRun >= MIN_GAP_MS ? refresh() : (inFlight ?? Promise.resolve())
    const cap = new Promise<void>((resolve) => setTimeout(resolve, REFRESH_WAIT_MS))
    void Promise.race([run, cap]).then(() => send(res, 200, { ...feed, syncing: inFlight !== null }))
    return
  }
  if (req.method === 'POST' && path === '/v1/open') {
    // Only the bar may ask. The Mac itself is refused: a page in its browser must not be
    // able to make the relay open tabs.
    if (peer !== BAR) return send(res, 403, { error: 'forbidden' })
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8')
      if (body.length > 1024) req.destroy()
    })
    req.on('end', () => {
      let id: unknown
      try {
        id = (JSON.parse(body) as { id?: unknown }).id
      } catch {
        return send(res, 400, { error: 'bad request' })
      }
      if (typeof id !== 'string') return send(res, 400, { error: 'bad request' })
      // The gap also bounds how often a request can make the relay ask GitHub.
      if (Date.now() - lastOpen < OPEN_GAP_MS) return send(res, 429, { error: 'too fast' })
      lastOpen = Date.now()
      const known = pages.get(id)
      void (known ? Promise.resolve(known) : pageOf(id).catch(() => null)).then((page) => {
        if (!page) return send(res, 404, { error: 'unknown pull request' })
        execFile(OPEN_CMD, [page], (err) => {
          if (err) console.error(`open failed: ${err.message.split('\n')[0]}`)
        })
        console.info(`opened a pull request on the Mac${known ? '' : ' (address asked of GitHub)'}`)
        send(res, 200, { ok: true })
      })
    })
    return
  }
  send(res, 404, { error: 'not found' })
})

// The USB address only exists while the bar is plugged in: retry until it does.
let bindWarned = false
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code !== 'EADDRNOTAVAIL' && err.code !== 'EADDRINUSE') throw err
  if (!bindWarned) console.error(`cannot listen on ${HOST}:${PORT} (${err.code}); is the bar plugged in? retrying every ${REBIND_MS / 1000}s`)
  bindWarned = true
  setTimeout(() => server.listen(PORT, HOST), REBIND_MS)
})
server.on('listening', () => {
  bindWarned = false
  console.info(`pr-queue relay listening on http://${HOST}:${PORT}${ORGS.length ? ` (orgs: ${ORGS.join(', ')})` : ''}${DAYS ? `, PRs touched in the last ${DAYS} days` : ''}`)
})

server.listen(PORT, HOST)
void refresh()
setInterval(() => void refresh(), REFRESH_MS)
process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))
