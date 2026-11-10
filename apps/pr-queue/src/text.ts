// Text helpers. The bar's fonts are bitmap ASCII and the draw API rejects a text element
// holding anything outside 0x20-0x7E, so every string from GitHub goes through ascii().

const SUBSTITUTES: Record<number, string> = {
  0x2018: "'", 0x2019: "'", 0x201c: '"', 0x201d: '"',
  0x2013: "-", 0x2014: "-", 0x2026: "...", 0x09: " ", 0x0a: " ", 0x0d: " ",
};

/** Printable ASCII only; emoji and accents are dropped, smart quotes and dashes mapped. */
export function ascii(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0x20 && c <= 0x7e) out += s[i];
    else if (SUBSTITUTES[c] !== undefined) out += SUBSTITUTES[c];
  }
  out = out.replace(/\s+/g, " ").trim();
  return out.length > 0 ? out : "?";
}

/**
 * Cuts at a word boundary and adds "..." so a clipped line never ends mid-glyph. `width`
 * on the element still clips as a safety net; glyphs are 2-6 px wide, so `chars` is an
 * average fit, not a guarantee.
 */
export function fit(s: string, chars: number): string {
  if (s.length <= chars) return s;
  const cut = s.slice(0, chars - 3);
  const space = cut.lastIndexOf(" ");
  return `${(space > chars / 2 ? cut.slice(0, space) : cut).replace(/[\s,.:;-]+$/, "")}...`;
}

/** 45s -> "1m", 5h -> "5h", 3 days -> "3d", 200 days -> "6mo", 1509 days -> "4y". */
export function age(ms: number): string {
  const m = Math.max(1, Math.floor(ms / 60_000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 100) return `${d}d`;
  if (d < 730) return `${Math.floor(d / 30)}mo`;
  return `${Math.floor(d / 365)}y`;
}

/** Word-wraps into at most `lines` lines of `width` chars; the last line ends in "..." if cut. */
export function wrap(text: string, width: number, lines: number): string[] {
  const out: string[] = [];
  let line = "";
  const words = text.split(" ");
  for (let i = 0; i < words.length; i++) {
    const word = words[i].length > width ? `${words[i].slice(0, width - 1)}-` : words[i];
    const next = line ? `${line} ${word}` : word;
    if (next.length <= width) {
      line = next;
      continue;
    }
    out.push(line);
    line = word;
    if (out.length === lines) break;
  }
  if (out.length < lines && line) out.push(line);
  const used = out.join(" ").length;
  if (used < text.length && out.length > 0) {
    const last = out[out.length - 1];
    out[out.length - 1] = last.length + 3 <= width ? `${last}...` : `${last.slice(0, width - 3)}...`;
  }
  return out.slice(0, lines);
}
