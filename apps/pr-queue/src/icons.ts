// 7x7 status icons, drawn at runtime as XPM2 bitmaps (no upload, up to 32 colors).
// Shapes differ as well as colors, so they still read on the gray back OLED.
import type { Ci } from "./feed.ts";

export type IconKind = Ci | "eye";

const ROWS: Record<IconKind, string[]> = {
  pass: ["......#", ".....##", "#...###", "##.###.", "#####..", ".###...", "..#...."],
  fail: [".#...#.", "###.###", ".#####.", "..###..", ".#####.", "###.###", ".#...#."],
  run: ["..###..", ".#...#.", "#.....#", "#..#..#", "#.....#", ".#...#.", "..###.."],
  none: [".......", ".......", ".......", ".#####.", ".......", ".......", "......."],
  eye: [".......", "..###..", ".#...#.", "#..#..#", ".#...#.", "..###..", "......."],
};

/** LED colors for the front, as #RRGGBB. */
export const LED: Record<IconKind, string> = {
  pass: "#3FB950",
  fail: "#F85149",
  run: "#D29922",
  none: "#6E7681",
  eye: "#FFFFFF",
};

export const ICON_SIZE = 7;

/** The app's own looping version of the "run" icon (scripts/pr-queue-anims.ts in ~/busybar). */
export const CI_RUN_ANIM = "animations/ci_run.anim";

export function xpm(kind: IconKind, color: string): string {
  return ["! XPM2", `${ICON_SIZE} ${ICON_SIZE} 2 1`, `# c ${color}`, ". c none", ...ROWS[kind]].join("\n");
}
