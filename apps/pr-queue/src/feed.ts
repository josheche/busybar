// What the Mac relay (src/widgets/pr-queue-relay in ~/busybar) serves and the app reads.
// Shared by both sides so the shapes cannot drift. Strings are already printable ASCII.

export type Ci = "pass" | "fail" | "run" | "none";
export type Review = "approved" | "changes" | "required" | "none";

export type Pr = {
  id: string;
  repo: string;
  number: number;
  title: string;
  author: string;
  createdMs: number;
  /** Changes whenever the PR does: commits, comments, CI. Snooze keys on it. */
  updated: string;
  additions: number;
  deletions: number;
  draft: boolean;
  /** Cannot merge until its conflicts are resolved. */
  conflict: boolean;
  ci: Ci;
  passed: number;
  failed: number;
  running: number;
  /** Name of the first failing check, "" when none. */
  failing: string;
  review: Review;
};

/** CI and age over the whole list, not just the PRs sent. Counted on the Mac from up to 100 PRs. */
export type Summary = {
  /** How many PRs these counts cover: min(total, 100). */
  counted: number;
  pass: number;
  fail: number;
  run: number;
  none: number;
  /** How many have nothing left but the merge button (isReady). Only meaningful for "mine". */
  ready: number;
  /** Oldest created time among the counted PRs, ms since epoch; 0 when empty. */
  oldestMs: number;
};

/** `prs` is the first page (most recently updated); `total` and `summary` cover the whole list. */
export type PrList = { total: number; prs: Pr[]; summary?: Summary };
export type Lists = { review: PrList; mine: PrList };

/**
 * Nothing left but the merge button: approved, CI green, not a draft, no conflicts.
 * A green PR in a repo that requires no review is deliberately not counted. On 2026-11-09 that
 * rule turned 2 approved PRs into "16 ready", a number too big to act on.
 */
export function isReady(pr: Pick<Pr, "draft" | "ci" | "conflict" | "review">): boolean {
  return pr.review === "approved" && pr.ci === "pass" && !pr.draft && !pr.conflict;
}

export const FEED_VERSION = 1;

export type Feed = {
  version: typeof FEED_VERSION;
  /** When the relay last synced with GitHub successfully, ms since epoch; 0 before the first. */
  generatedAt: number;
  /** Last good lists; null until the first sync succeeds. */
  lists: Lists | null;
  /** Why the latest sync failed, "" when it did not. The lists stay the last good ones. */
  error: string;
  /** A GitHub sync is running; these lists are from the one before it. */
  syncing?: boolean;
  /**
   * Review requests in the latest sync that were not in the one before it (0 on the relay's
   * first). Counted on the Mac over the whole list, so a PR that merely moves up is not new,
   * and one that left and was requested again is.
   */
  newReviews?: number;
};
