// State in, display elements out. A pure function: main.ts owns the state, screen.ts sends
// only what changed. Coordinates come from the scope mockups, which were drawn on the bar
// and read back from its framebuffer (docs/blog/pr-queue/assets/scope in ~/busybar).
import { isReady, type Pr, type PrList, type Summary } from "./feed.ts";
import { CI_RUN_ANIM, LED, xpm, type IconKind } from "./icons.ts";
import { age, fit, wrap } from "./text.ts";

/**
 * `layer` names elements stacked on each other (text over a rectangle). screen.ts re-sends a
 * layer whole when any member changes, because fw 1.3.1 hides an updated text element under
 * a rectangle that was not re-sent with it. It is stripped before the draw.
 */
export type El = { id: string; type: string; display: "front" | "back"; layer?: string; [key: string]: unknown };
export type ListKey = "review" | "mine";
export type Problem = { title: string; hint: string };

export type ViewState = {
  demo: boolean;
  /** Already filtered for snoozes. Null until the first sync answers. */
  lists: Record<ListKey, PrList> | null;
  list: ListKey;
  /** -1 is the glance; 0..n-1 is a PR in focus. */
  cursor: number;
  detail: boolean;
  problem: Problem | null;
  /** Replaces the front's second line for a moment ("snoozed", "synced"). */
  toast: string;
  /** One line under a short list on the back: demo hint or stale data. */
  footer: string;
  /** Age of the data ("12m") when it is older than it should be, else "". */
  stale: string;
  /** PRs of the current list hidden by a snooze. */
  snoozed: number;
  now: number;
};

const W = "#FFFFFFFF";
const DIM = "#FFFFFF80";
const GRAY = "#8C8C8CFF";
const AMBER = "#D29922FF";
const BLACK = "#000000FF";
/** x >= 148 on the back is the firmware's status column. */
const BACK_W = 148;
const ROWS = 4;
/** Detail title, normal font: 24 chars per line measured on the bar. */
const TITLE_CHARS = 24;
/** List rows, 132 px: small averages ~4 px a glyph, tiny ~3.7. */
const ROW_TITLE_CHARS = 31;
const ROW_META_CHARS = 35;

type Display = "front" | "back";

const text = (id: string, t: string, font: string, color: string, x: number, y: number, display: Display, extra: Record<string, unknown> = {}): El => ({
  id, type: "text", display, text: t, font, color, x, y, ...extra,
});
const rect = (id: string, x: number, y: number, width: number, height: number, display: Display, fill = W, radius = 0): El => ({
  id, type: "rectangle", display, x, y, width, height, radius, fill: "solid", fill_colors: [fill], border_width: 0,
});
const icon = (id: string, kind: IconKind, color: string, x: number, y: number, display: Display): El => ({
  id, type: "xpmbitmap", display, x, y, data: xpm(kind, color),
});
/** The focused PR's CI icon on the front; a running build gets the app's own spinner. */
const ciIcon = (pr: Pr, x: number, y: number): El =>
  pr.ci === "run" ? { id: "ci", type: "animation", display: "front", x, y, path: CI_RUN_ANIM, loop: true } : icon("ci", pr.ci, LED[pr.ci], x, y, "front");

const LIST_TITLE: Record<ListKey, string> = { review: "REVIEW QUEUE", mine: "MY PULL REQUESTS" };
const EMPTY: Record<ListKey, string> = { review: "Nothing waiting on you", mine: "No open pull requests" };

// ---- front (72 x 16 LED)

function rail(i: number, n: number): El[] {
  const h = Math.max(2, Math.floor(16 / n));
  const y = n > 1 ? Math.round((i * (16 - h)) / (n - 1)) : 0;
  return [rect("rail", 71, 0, 1, 16, "front", "#FFFFFF33"), rect("thumb", 71, y, 1, h, "front")];
}

/** The relay counts the whole list; demo data (and an older relay) only has the PRs sent. */
function summaryOf(list: PrList): Summary {
  if (list.summary) return list.summary;
  const sum: Summary = { counted: list.prs.length, pass: 0, fail: 0, run: 0, none: 0, ready: 0, oldestMs: 0 };
  for (const p of list.prs) {
    sum[p.ci]++;
    if (isReady(p)) sum.ready++;
    if (p.createdMs > 0 && (sum.oldestMs === 0 || p.createdMs < sum.oldestMs)) sum.oldestMs = p.createdMs;
  }
  return sum;
}

/**
 * Big count on the left, two short lines beside it, a red flag at the right when CI fails.
 * The second line gives way to a toast, then to a stale-data warning: old numbers must not
 * pass for current ones.
 */
function frontGlance(n: number, label: string, second: [text: string, color: string], failing: boolean, s: ViewState): El[] {
  const labelX = 2 + String(n).length * 8 + 4;
  const [line, color] = s.toast ? [s.toast, DIM] : s.stale ? [`data ${s.stale} old`, AMBER] : second;
  return [
    text("count", String(n), "extra_large", W, 2, 8, "front", { align: "mid_left" }),
    text("l1", label, "small", W, labelX, 4, "front", { align: "mid_left", width: 62 - labelX }),
    text("l2", line, "small", color, labelX, 11, "front", { align: "mid_left", width: 72 - labelX }),
    ...(failing ? [icon("flag", "fail", LED.fail, 63, 1, "front")] : []),
  ];
}

function frontReviewGlance(list: PrList, s: ViewState): El[] {
  const n = list.total;
  const sum = summaryOf(list);
  // An empty list is only "inbox zero" when nothing is hiding behind a snooze.
  const second = n > 0 ? `oldest ${age(s.now - (sum.oldestMs || s.now))}` : s.snoozed > 0 ? `${s.snoozed} snoozed` : "inbox zero";
  return frontGlance(n, n === 0 && s.snoozed === 0 ? "all clear" : "to review", [second, DIM], sum.fail > 0, s);
}

/** CI across all of my open PRs, worst first: about 12 glyphs fit beside a two-digit count. */
function ciTally(sum: Summary): string {
  if (sum.fail && sum.run) return `${sum.fail} fail ${sum.run} run`;
  if (sum.fail) return `${sum.fail} failing`;
  if (sum.run) return `${sum.run} running`;
  if (!sum.pass) return "no checks";
  return sum.pass === sum.counted ? "all passing" : `${sum.pass} passing`;
}

/**
 * What I can act on first: PRs with nothing left but the merge button, in green. A failing
 * build still shows, as the red flag. With nothing ready, the line is the CI tally.
 */
function frontMineGlance(list: PrList, s: ViewState): El[] {
  const n = list.total;
  const sum = summaryOf(list);
  const none: [string, string] = [s.snoozed > 0 ? `${s.snoozed} snoozed` : "nothing open", DIM];
  const second: [string, string] = n === 0 ? none : sum.ready > 0 ? [`${sum.ready} ready`, `${LED.pass}FF`] : [ciTally(sum), DIM];
  return frontGlance(n, n === 0 && s.snoozed === 0 ? "none open" : "mine", second, sum.fail > 0, s);
}

function reason(pr: Pr): [string, string] {
  if (pr.ci === "fail") return [`CI failing: ${pr.failing || "checks"}`, `${LED.fail}FF`];
  if (pr.ci === "run") return ["CI running", `${LED.run}FF`];
  if (pr.ci === "pass") return ["CI passed", `${LED.pass}FF`];
  return ["no checks", GRAY];
}

function frontItem(pr: Pr, i: number, n: number, s: ViewState): El[] {
  const [why, whyColor] = reason(pr);
  const second = s.toast
    ? text("l2", s.toast, "small", DIM, 1, 11, "front", { align: "mid_left", width: 68 })
    : s.detail
      ? text("l2", why, "small", whyColor, 1, 11, "front", { align: "mid_left", width: 68 })
      : text("l2", pr.title, "small", DIM, 1, 11, "front", { align: "mid_left", width: 68, scroll_rate: 900, scroll_start_delay: 1500, scroll_repeat_delay: 2500 });
  return [
    ciIcon(pr, 1, 1),
    text("l1", `#${pr.number} ${pr.repo}`, "small", W, 10, 4, "front", { align: "mid_left", width: 59 }),
    ...rail(i, n),
    second,
  ];
}

function frontSync(): El[] {
  return [
    { id: "spin", type: "animation", display: "front", x: 2, y: 4, stock_path: "shared/animations/spinner_front_8x8.anim", loop: true },
    text("l1", "syncing PRs", "small", W, 14, 4, "front", { align: "mid_left" }),
    text("l2", "via your Mac", "small", DIM, 14, 11, "front", { align: "mid_left" }),
  ];
}

function frontProblem(p: Problem): El[] {
  return [
    icon("ci", "fail", LED.run, 1, 1, "front"),
    text("l1", p.title, "small", W, 10, 4, "front", { align: "mid_left", width: 61 }),
    text("l2", p.hint, "small", DIM, 1, 11, "front", { align: "mid_left", width: 70 }),
  ];
}

// ---- back (160 x 80 OLED, 148 usable)

function header(left: string, right: string): El[] {
  return [
    { ...rect("hdr", 0, 0, BACK_W, 11, "back"), layer: "hdr" },
    text("hdr_l", left, "small", BLACK, 3, 0, "back", { width: 104, layer: "hdr" }),
    text("hdr_r", right || " ", "small", BLACK, 145, 0, "back", { align: "top_right", layer: "hdr" }),
  ];
}

function rowMeta(pr: Pr, key: ListKey, now: number): string {
  const where = `${pr.repo} #${pr.number}`;
  if (key === "review") return `${where}  ${pr.author}  ${age(now - pr.createdMs)}`;
  if (pr.draft) return `${where}  draft`;
  if (pr.ci === "fail") return `${where}  ${pr.failing || "CI"} failed`;
  if (pr.ci === "run") return `${where}  running`;
  if (pr.conflict) return `${where}  conflicts`;
  if (isReady(pr)) return `${where}  ready to merge`;
  if (pr.review === "changes") return `${where}  changes asked`;
  if (pr.review === "required") return `${where}  needs review`;
  if (pr.review === "approved") return `${where}  approved`;
  return `${where}  ${pr.ci === "pass" ? "checks passed" : "no checks"}`;
}

function backList(key: ListKey, list: PrList, s: ViewState): El[] {
  const n = list.prs.length;
  // On the glance: stale data first, then anything hidden, then how much of the list the bar holds.
  const glance = s.stale ? `${s.stale} old` : s.demo ? "DEMO" : s.snoozed > 0 ? `${s.snoozed} snoozed` : list.total > n ? `top ${n} of ${list.total}` : String(list.total);
  const right = s.cursor >= 0 ? `${s.cursor + 1} of ${n}` : glance;
  const els = header(LIST_TITLE[key], right);
  const foot = s.footer ? [text("foot", s.footer, "tiny", GRAY, 3, 71, "back", { width: 144 })] : [];
  if (n === 0) return [...els, text("empty", s.snoozed > 0 ? `${s.snoozed} snoozed` : EMPTY[key], "small", W, 74, 34, "back", { align: "top_mid" }), ...foot];

  // On the glance a footer (demo, stale data, how to bring snoozed PRs back) takes the fourth
  // row: with a full list it used to be invisible, and it says things worth a row.
  const fits = s.cursor < 0 && s.footer ? ROWS - 1 : ROWS;
  const start = s.cursor < 0 ? 0 : Math.max(0, Math.min(s.cursor - (ROWS - 1), n - ROWS));
  const rows = list.prs.slice(start, start + fits);
  rows.forEach((pr, r) => {
    const y = 13 + r * 16;
    const sel = start + r === s.cursor;
    const layer = `row${r}`;
    if (sel) els.push({ ...rect("sel", 0, y - 1, BACK_W, 15, "back", W, 2), layer });
    els.push(
      { ...icon(`ic${r}`, pr.ci, sel ? "#000000" : "#FFFFFF", 3, y + 2, "back"), layer },
      text(`t${r}`, fit(pr.title, ROW_TITLE_CHARS), "small", sel ? BLACK : W, 13, y - 1, "back", { width: 132, layer }),
      text(`m${r}`, fit(rowMeta(pr, key, s.now), ROW_META_CHARS), "tiny", sel ? BLACK : GRAY, 13, y + 7, "back", { width: 132, layer }),
    );
  });
  if (rows.length < ROWS) els.push(...foot);
  return els;
}

function ciLine(pr: Pr): string {
  if (pr.ci === "fail") return `${pr.passed} passed, ${pr.failed} failed: ${pr.failing || "?"}`;
  if (pr.ci === "run") return `${pr.running} running, ${pr.passed} passed`;
  if (pr.ci === "pass") return `${pr.passed} passed`;
  return "no checks";
}

function reviewLine(pr: Pr, key: ListKey): [IconKind, string] {
  if (key === "review") return ["eye", "your review requested"];
  if (pr.conflict) return ["fail", "has merge conflicts"];
  if (isReady(pr)) return ["pass", "approved, ready to merge"];
  if (pr.review === "approved") return ["pass", "approved"];
  if (pr.review === "changes") return ["fail", "changes requested"];
  if (pr.review === "required") return ["eye", "review required"];
  return ["none", "no review required"];
}

function backDetail(pr: Pr, key: ListKey, i: number, n: number, s: ViewState): El[] {
  const [t1, t2] = wrap(pr.title, TITLE_CHARS, 2);
  const [rvIcon, rvText] = reviewLine(pr, key);
  return [
    ...header(`${pr.repo} #${pr.number}`, `${i + 1} of ${n}`),
    text("d_t1", t1 ?? pr.title, "normal", W, 3, 14, "back", { width: 142 }),
    ...(t2 ? [text("d_t2", t2, "normal", W, 3, 24, "back", { width: 142 })] : []),
    text("d_meta", `${pr.author}   opened ${age(s.now - pr.createdMs)} ago   +${pr.additions} -${pr.deletions}${pr.draft ? "   draft" : ""}`, "tiny", GRAY, 3, 36, "back", { width: 144 }),
    icon("d_ci", pr.ci, "#FFFFFF", 3, 46, "back"),
    text("d_ci_t", ciLine(pr), "small", W, 13, 45, "back", { width: 134 }),
    icon("d_rv", rvIcon, "#FFFFFF", 3, 58, "back"),
    text("d_rv_t", rvText, "small", W, 13, 57, "back", { width: 134 }),
    text("d_hint", "OK open on Mac   HOLD START snooze", "tiny", GRAY, 3, 71, "back"),
  ];
}

function backSync(key: ListKey): El[] {
  return [
    ...header(LIST_TITLE[key], ""),
    { id: "spin_b", type: "animation", display: "back", x: 66, y: 26, stock_path: "shared/animations/spinner_back_16x16.anim", loop: true },
    text("s1", "Getting PRs from your Mac", "small", W, 74, 50, "back", { align: "top_mid" }),
    text("s2", "first sync", "tiny", GRAY, 74, 62, "back", { align: "top_mid" }),
  ];
}

function backProblem(key: ListKey, p: Problem): El[] {
  return [
    ...header(LIST_TITLE[key], ""),
    // No `width` here: with one, fw 1.3.1 left-aligns the text inside the box and it stops being centred.
    text("s1", fit(p.title, 30), "small", W, 74, 30, "back", { align: "top_mid" }),
    text("s2", fit(p.hint, 36), "tiny", GRAY, 74, 44, "back", { align: "top_mid" }),
  ];
}

// ---- both

export function view(s: ViewState): El[] {
  if (!s.lists) {
    if (s.problem) return [...frontProblem(s.problem), ...backProblem(s.list, s.problem)];
    return [...frontSync(), ...backSync(s.list)];
  }
  const list = s.lists[s.list];
  const n = list.prs.length;
  if (s.cursor >= 0 && s.cursor < n) {
    const pr = list.prs[s.cursor];
    const back = s.detail ? backDetail(pr, s.list, s.cursor, n, s) : backList(s.list, list, s);
    return [...frontItem(pr, s.cursor, n, s), ...back];
  }
  const front = s.list === "review" ? frontReviewGlance(list, s) : frontMineGlance(list, s);
  return [...front, ...backList(s.list, list, s)];
}
