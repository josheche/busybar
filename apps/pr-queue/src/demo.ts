// Demo data, shown when "Show demo data" is on. Entirely fictional: made-up repos, people
// and titles, so screenshots of demo mode are safe to publish. Never put real PRs here.
import type { Lists, Pr } from "./feed.ts";

const H = 3_600_000;

function pr(p: Partial<Pr> & Pick<Pr, "id" | "repo" | "number" | "title" | "author" | "ci">, now: number, hoursOld: number): Pr {
  return {
    createdMs: now - hoursOld * H,
    updated: `demo-${p.id}`,
    additions: 40,
    deletions: 8,
    draft: false,
    conflict: false,
    passed: p.ci === "pass" ? 12 : 9,
    failed: p.ci === "fail" ? 1 : 0,
    running: p.ci === "run" ? 3 : 0,
    failing: p.ci === "fail" ? "e2e" : "",
    review: "required",
    ...p,
  };
}

export function demoLists(now: number): Lists {
  return {
    review: {
      total: 3,
      prs: [
        pr({ id: "r1", repo: "lantern", number: 142, title: "feat(search): filter results by tag", author: "maya", ci: "fail", additions: 214, deletions: 37 }, now, 50),
        pr({ id: "r2", repo: "lantern", number: 139, title: "fix(cache): expire stale entries on wake", author: "theo", ci: "pass" }, now, 5),
        pr({ id: "r3", repo: "tidepool", number: 57, title: "chore: bump dependencies", author: "renovate", ci: "run" }, now, 1),
      ],
    },
    mine: {
      total: 4,
      prs: [
        pr({ id: "m1", repo: "lantern", number: 145, title: "feat(ui): sticky header on scroll", author: "you", ci: "fail", failing: "lint", review: "none" }, now, 30),
        pr({ id: "m2", repo: "tidepool", number: 58, title: "fix: retry uploads after timeout", author: "you", ci: "pass", review: "approved" }, now, 3),
        pr({ id: "m3", repo: "lantern", number: 146, title: "docs: rewrite the setup guide", author: "you", ci: "run", draft: true }, now, 72),
        pr({ id: "m4", repo: "tidepool", number: 60, title: "refactor: split the parser module", author: "you", ci: "pass", review: "approved" }, now, 20),
      ],
    },
  };
}
