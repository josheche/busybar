// PR Queue: GitHub pull requests waiting on your review, and CI on your own, on the BUSY Bar.
// The GitHub side runs on the Mac (src/widgets/pr-queue-relay in ~/busybar); this app reads
// the finished lists over the USB cable and holds no GitHub credential.
// Controls:
//   wheel        move between PRs (the glance sits above the first one)
//   OK           open the detail for the PR in focus; in the detail, open the PR on the Mac
//   hold OK      sync now
//   START        switch lists: review queue, then mine
//   hold START   snooze the PR in focus until it changes; on the glance, bring back this list's snoozed PRs
//   BACK         close the detail, else quit
import manifest from "./appmeta/manifest.json";
import { loadConfig, type Config } from "./config.ts";
import { demoLists } from "./demo.ts";
import type { Lists, Pr, PrList } from "./feed.ts";
import { play } from "./http.ts";
import { getFeed, openOnMac } from "./relay.ts";
import { Screen } from "./screen.ts";
import { flushSnoozes, isSnoozed, snooze, unsnooze } from "./snooze.ts";
import { age } from "./text.ts";
import { view, type ListKey, type Problem } from "./view.ts";

const APP = manifest.id;
/** The relay syncs with GitHub every 3 minutes; asking it every minute costs ~25 ms over USB. */
const POLL_MS = 60_000;
/** Relay data older than this gets a "last sync" footer. */
const STALE_MS = 7 * 60_000;
/** Re-sends icons (see screen.ts) and walks an idle focus back to the glance. */
const HEARTBEAT_MS = 20_000;
const IDLE_TO_GLANCE_MS = 90_000;
const TOAST_MS = 2_500;
const NEW_REVIEW_LED = "#D29922FF";
const CHIME = "shared/sounds/calendar_event_starts.snd";
/** Retry delays while the relay is unreachable (Mac asleep, cable out). */
const BACKOFF_MS = [15_000, 30_000, 60_000];
/** Ask again this soon when the relay answered while its GitHub sync was still running. */
const FOLLOW_UP_MS = 5_000;

type Timer = ReturnType<typeof setTimeout>;

function report(err: unknown): void {
  const stack = err instanceof Error && err.stack ? ` | ${err.stack}` : "";
  console.error(`${APP}: ${err instanceof Error ? err.message : String(err)}${stack}`);
}

function main(): void {
  const screen = new Screen(APP, report);
  let config: Config | null = null;
  let lists: Lists | null = null;
  let list: ListKey = "review";
  let cursor = -1;
  let detail = false;
  let syncing = false;
  let problem: Problem | null = null;
  let toast = "";
  let syncedAt = 0;
  let failures = 0;
  let lastInputAt = Date.now();
  let stopped = false;
  let pollTimer: Timer | null = null;
  let toastTimer: Timer | null = null;

  const visible = (l: PrList): PrList => {
    const hidden = l.prs.filter(isSnoozed);
    if (hidden.length === 0) return l;
    const prs = l.prs.filter((p) => !isSnoozed(p));
    const summary = l.summary ? { ...l.summary, counted: l.summary.counted - hidden.length } : undefined;
    if (summary) for (const p of hidden) summary[p.ci] = Math.max(0, summary[p.ci] - 1);
    return { total: Math.max(prs.length, l.total - hidden.length), prs, summary };
  };
  const current = (): Pr[] => (lists ? visible(lists[list]).prs : []);
  /** The current list's PRs that a snooze is hiding. */
  const hidden = (): Pr[] => (lists ? lists[list].prs.filter(isSnoozed) : []);

  /** Age of the data when the relay is unreachable, failing, or silent for too long. */
  function stale(now: number): string {
    if (config?.demo || !lists) return "";
    return problem || now - syncedAt > STALE_MS ? age(now - syncedAt) : "";
  }

  function footer(now: number): string {
    if (config?.demo) return "Demo data. Turn it off in Settings.";
    if (!lists) return "";
    if (problem) return `${problem.title}, data ${age(now - syncedAt)} old`;
    if (now - syncedAt > STALE_MS) return `last sync ${age(now - syncedAt)} ago`;
    // On an item a hold snoozes it, so the way back is only offered on the glance.
    if (cursor < 0 && hidden().length > 0) return `${hidden().length} snoozed. HOLD START to bring back.`;
    return "";
  }

  function render(led = ""): void {
    if (stopped) return;
    const now = Date.now();
    screen.show(
      view({
        demo: config?.demo === true,
        lists: lists ? { review: visible(lists.review), mine: visible(lists.mine) } : null,
        list,
        cursor,
        detail,
        // With data on screen, a failed refresh shows as stale data, not as a problem screen.
        problem: lists ? null : problem,
        toast,
        footer: footer(now),
        stale: stale(now),
        snoozed: hidden().length,
        now,
      }),
      led,
    );
  }

  function flash(message: string): void {
    toast = message;
    render();
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastTimer = null;
      toast = "";
      render();
    }, TOAST_MS);
  }

  function clampCursor(): void {
    const n = current().length;
    if (cursor >= n) cursor = n - 1;
    if (cursor < 0) detail = false;
  }

  function schedule(ms: number): void {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
    if (stopped) return;
    pollTimer = setTimeout(() => {
      pollTimer = null;
      void sync().catch(report);
    }, ms);
  }

  async function sync(manual = false): Promise<void> {
    if (stopped || syncing || !config) return;
    if (config.demo) {
      lists = demoLists(Date.now());
      syncedAt = Date.now();
      return manual ? flash("demo data") : render();
    }
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
    syncing = true;
    if (manual) flash("syncing...");
    const result = await getFeed(config.relay, manual);
    syncing = false;
    if (stopped) return;

    if (!result.ok) {
      problem = { title: result.message, hint: "is the Mac awake?" };
      render();
      return schedule(BACKOFF_MS[Math.min(failures++, BACKOFF_MS.length - 1)]);
    }
    failures = 0;
    const feed = result.feed;
    if (!feed.lists) {
      problem = { title: feed.error || "relay starting", hint: "check the relay log" };
      render();
      return schedule(BACKOFF_MS[0]);
    }
    // A failed GitHub sync on the relay keeps its last good lists; say so in the footer.
    problem = feed.error ? { title: "GitHub sync failed", hint: feed.error } : null;
    // The relay says how many review requests are new in its latest sync. Announce each sync
    // once, and not the one this app opened on: the person is already looking at the list.
    const announce = syncedAt !== 0 && feed.generatedAt !== syncedAt && (feed.newReviews ?? 0) > 0;
    const led = announce ? NEW_REVIEW_LED : "";
    if (announce && config.chime) void play({ application_name: APP, stock_path: CHIME }).catch(report);
    lists = feed.lists;
    syncedAt = feed.generatedAt;
    clampCursor();
    render(led);
    if (manual) flash(feed.error ? "sync failed" : feed.syncing ? "still syncing" : "synced");
    schedule(feed.syncing ? FOLLOW_UP_MS : POLL_MS);
  }

  /** OK in the detail: the relay opens this PR's page in the Mac's browser. */
  async function openFocused(): Promise<void> {
    const pr = current()[cursor];
    if (!pr || !config) return;
    if (config.demo) return flash("demo data");
    flash("opening...");
    const result = await openOnMac(config.relay, pr.id);
    if (stopped) return;
    flash(result === "ok" ? "opened on Mac" : result === "busy" ? "one at a time" : result === "unknown" ? "PR not found" : "relay offline");
  }

  const heartbeat = setInterval(() => {
    if (cursor >= 0 && Date.now() - lastInputAt > IDLE_TO_GLANCE_MS) {
      cursor = -1;
      detail = false;
    }
    render();
  }, HEARTBEAT_MS);

  function quit(): void {
    stopped = true;
    clearInterval(heartbeat);
    if (pollTimer) clearTimeout(pollTimer);
    if (toastTimer) clearTimeout(toastTimer);
    flushSnoozes();
    // The listener is the last handle; detaching it from inside its own callback would stop the app mid-call.
    setTimeout(unbind, 0);
  }

  const unbind = listen("input", (e) => {
    if (stopped) return;
    lastInputAt = Date.now();

    if (e.key === "encoder") {
      const next = Math.max(-1, Math.min(current().length - 1, cursor + e.delta));
      if (next === cursor) return;
      cursor = next;
      if (cursor < 0) detail = false;
      return render();
    }
    if (e.key === "back") {
      if (e.action !== "short") return;
      if (detail) {
        detail = false;
        return render();
      }
      return quit();
    }
    if (e.key === "ok") {
      if (e.action === "long") return void sync(true).catch(report);
      if (e.action !== "short") return;
      if (cursor < 0) {
        if (current().length === 0) return;
        cursor = 0;
        detail = true;
        return render();
      }
      if (!detail) {
        detail = true;
        return render();
      }
      return void openFocused().catch(report);
    }
    if (e.key === "start") {
      if (e.action === "short") {
        list = list === "review" ? "mine" : "review";
        cursor = -1;
        detail = false;
        return render();
      }
      if (e.action === "long") {
        const pr = current()[cursor];
        if (!pr) {
          // On the glance nothing is in focus: the hold brings back what this list has snoozed.
          const back = unsnooze(hidden());
          return flash(back > 0 ? `${back} back` : "turn to a PR");
        }
        snooze(pr);
        clampCursor();
        flash("snoozed");
      }
    }
  });

  render();
  void loadConfig(APP)
    .then((c) => {
      config = c;
      return sync();
    })
    .catch(report);
}

main();
