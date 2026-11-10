// GitHub side of PR Queue, run on the Mac so the bar never holds a GitHub credential.
// `gh` reads its own token from the macOS keychain; this module never sees or stores it.
// That one login covers every repo and org the account can see, which a fine-grained
// token cannot (one owner per token). Only the two read-only search queries below are sent.
import { execFile } from 'node:child_process'

import { isReady, type Ci, type Lists, type Pr, type PrList, type Review, type Summary } from '../../../apps/pr-queue/src/feed.js'
import { ascii } from '../../../apps/pr-queue/src/text.js'

const GH = process.env.GH_BIN ?? 'gh'
const PAGE = 8
/** GitHub's search maximum per page; the summary covers this many. */
const COUNT = 100
const GH_TIMEOUT_MS = 30_000

// `top` carries what the bar shows; `all` only what the summary counts.
const QUERY = `query($q: String!) {
top: search(query: $q, type: ISSUE, first: ${PAGE}) { issueCount nodes { ... on PullRequest {
id number title url isDraft mergeable createdAt updatedAt additions deletions reviewDecision
repository { name } author { login }
commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 50) { nodes {
... on CheckRun { name status conclusion } ... on StatusContext { context state } } } } } } } } } }
all: search(query: $q, type: ISSUE, first: ${COUNT}) { nodes { ... on PullRequest {
id createdAt isDraft mergeable reviewDecision commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } } } }`

/**
 * Direct review requests only: a request to a team is not necessarily waiting on you.
 * `days` keeps only PRs touched that recently (0: no limit). A request left open for years
 * is not waiting on anyone, and it buries the ones that are.
 */
export function searchQueries(orgs: string[], days: number): { review: string; mine: string } {
  const scope = orgs.map((o) => `org:${o}`).join(' ')
  const since = days > 0 ? `updated:>=${new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)}` : ''
  const base = `is:pr is:open archived:false ${scope} ${since} sort:updated-desc`.replace(/\s+/g, ' ')
  return { review: `${base} user-review-requested:@me`, mine: `${base} author:@me` }
}

type Node = Record<string, any>

const PASSED = ['SUCCESS', 'NEUTRAL', 'SKIPPED']

function ciOf(state: string | null): Ci {
  return !state ? 'none' : state === 'SUCCESS' ? 'pass' : state === 'PENDING' || state === 'EXPECTED' ? 'run' : 'fail'
}

function reviewOf(decision: string | null): Review {
  return decision === 'APPROVED' ? 'approved' : decision === 'CHANGES_REQUESTED' ? 'changes' : decision === 'REVIEW_REQUIRED' ? 'required' : 'none'
}

function summarize(nodes: Node[]): Summary {
  const sum: Summary = { counted: 0, pass: 0, fail: 0, run: 0, none: 0, ready: 0, oldestMs: 0 }
  for (const n of nodes) {
    if (!n || typeof n.createdAt !== 'string') continue
    sum.counted++
    const ci = ciOf(n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null)
    sum[ci]++
    if (isReady({ draft: n.isDraft === true, ci, conflict: n.mergeable === 'CONFLICTING', review: reviewOf(n.reviewDecision ?? null) })) sum.ready++
    const created = Date.parse(n.createdAt) || 0
    if (created > 0 && (sum.oldestMs === 0 || created < sum.oldestMs)) sum.oldestMs = created
  }
  return sum
}

function toPr(n: Node | null): Pr | null {
  if (!n || typeof n.number !== 'number') return null
  const rollup = n.commits?.nodes?.[0]?.commit?.statusCheckRollup ?? null
  let passed = 0
  let failed = 0
  let running = 0
  let failing = ''
  for (const c of (rollup?.contexts?.nodes ?? []) as Node[]) {
    if (!c) continue
    if (typeof c.context === 'string') {
      if (c.state === 'SUCCESS') passed++
      else if (c.state === 'PENDING' || c.state === 'EXPECTED') running++
      else {
        failed++
        failing ||= c.context
      }
    } else if (typeof c.name === 'string') {
      if (c.status !== 'COMPLETED') running++
      else if (PASSED.includes(c.conclusion)) passed++
      else {
        failed++
        failing ||= c.name
      }
    }
  }
  const ci = ciOf(rollup?.state ?? null)
  const review = reviewOf(n.reviewDecision ?? null)
  return {
    id: String(n.id),
    repo: ascii(n.repository?.name ?? '?'),
    number: n.number,
    title: ascii(n.title ?? ''),
    author: ascii(n.author?.login ?? 'ghost'),
    createdMs: Date.parse(n.createdAt) || 0,
    updated: String(n.updatedAt ?? ''),
    additions: n.additions ?? 0,
    deletions: n.deletions ?? 0,
    draft: n.isDraft === true,
    conflict: n.mergeable === 'CONFLICTING',
    ci,
    passed,
    failed,
    running,
    failing: failing ? ascii(failing) : '',
    review
  }
}

function gh(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(GH, args, { timeout: GH_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim().split('\n')[0]))
      else resolve(stdout)
    })
  })
}

/**
 * `ids` covers the counted PRs (up to 100); `urls` maps the PRs sent to the bar to their
 * pages. Both stay on the Mac.
 */
type Searched = { list: PrList; ids: string[]; urls: Array<[string, string]> }

/** Only a PR page on github.com is ever handed to `open`. */
const PR_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/

async function search(q: string): Promise<Searched> {
  const body = JSON.parse(await gh(['api', 'graphql', '-f', `query=${QUERY}`, '-f', `q=${q}`])) as Node
  if (body.errors?.length) throw new Error(String(body.errors[0].message ?? 'query failed'))
  const top = body.data?.top
  const nodes = (top?.nodes ?? []) as Node[]
  const prs = nodes.map(toPr).filter((p): p is Pr => p !== null)
  const urls = nodes.filter((n) => n && typeof n.id === 'string' && typeof n.url === 'string' && PR_URL.test(n.url)).map((n): [string, string] => [String(n.id), String(n.url)])
  const all = ((body.data?.all?.nodes ?? []) as Node[]).filter((n) => n && typeof n.id === 'string')
  const list = { total: typeof top?.issueCount === 'number' ? top.issueCount : prs.length, prs, summary: summarize(all) }
  return { list, ids: all.map((n) => String(n.id)), urls }
}

const NODE_ID = /^[A-Za-z0-9_=-]{1,100}$/
const PAGE_QUERY = 'query($id: ID!) { node(id: $id) { ... on PullRequest { url } } }'

/**
 * The page of one pull request, asked of GitHub by id. For a PR the bar still shows but the
 * latest sync no longer holds (the bar's list can be a minute older than the relay's).
 * Null unless GitHub answers with a pull request page on github.com.
 */
export async function pageOf(id: string): Promise<string | null> {
  if (!NODE_ID.test(id)) return null
  const body = JSON.parse(await gh(['api', 'graphql', '-f', `query=${PAGE_QUERY}`, '-f', `id=${id}`])) as Node
  const url: unknown = body.data?.node?.url
  return typeof url === 'string' && PR_URL.test(url) ? url : null
}

export type Synced = { lists: Lists; reviewIds: string[]; urls: Map<string, string> }

export async function fetchLists(orgs: string[], days: number): Promise<Synced> {
  const q = searchQueries(orgs, days)
  const [review, mine] = await Promise.all([search(q.review), search(q.mine)])
  return { lists: { review: review.list, mine: mine.list }, reviewIds: review.ids, urls: new Map([...review.urls, ...mine.urls]) }
}
