// Snoozed PRs: id -> the updatedAt it was snoozed at. A PR stays hidden until GitHub bumps
// its updatedAt (new commits, comments, reviews).
// The store is bounded by count, oldest out first. It is not pruned against the lists: the
// bar only gets the first few PRs of each list, so "not in the list" does not mean "gone",
// and a snoozed PR that drops out and comes back unchanged must stay snoozed.
// localStorage rewrites the whole store to flash on every setItem, so writes wait and batch.
import type { Pr } from "./feed.ts";

const KEY = "snooze";
const SAVE_DELAY_MS = 3_000;
const MAX_SNOOZED = 64;

let snoozed: Record<string, string> = load();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function load(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSnoozes, SAVE_DELAY_MS);
}

export function flushSnoozes(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  try {
    localStorage.setItem(KEY, JSON.stringify(snoozed));
  } catch (err) {
    console.error(`pr_queue: snooze save failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function isSnoozed(pr: Pr): boolean {
  return snoozed[pr.id] === pr.updated;
}

export function snooze(pr: Pr): void {
  // Re-insert so the newest snooze is last; string keys keep insertion order.
  delete snoozed[pr.id];
  snoozed[pr.id] = pr.updated;
  const ids = Object.keys(snoozed);
  for (const id of ids.slice(0, Math.max(0, ids.length - MAX_SNOOZED))) delete snoozed[id];
  scheduleSave();
}

/** Brings these PRs back; returns how many of them were snoozed. */
export function unsnooze(prs: Pr[]): number {
  let n = 0;
  for (const pr of prs) {
    if (!isSnoozed(pr)) continue;
    delete snoozed[pr.id];
    n++;
  }
  if (n > 0) scheduleSave();
  return n;
}
