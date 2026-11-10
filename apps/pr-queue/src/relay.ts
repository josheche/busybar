// Reads the lists from the Mac relay over the USB cable (about 25 ms a request, measured
// 2026-11-09). The app holds no GitHub credential: the relay does the GitHub side.
import { FEED_VERSION, type Feed } from "./feed.ts";

export type FeedResult = { ok: true; feed: Feed } | { ok: false; message: string };

/** `refresh` asks the relay to sync with GitHub first (hold OK); otherwise it returns what it has. */
export async function getFeed(base: string, refresh: boolean): Promise<FeedResult> {
  let res: Response;
  try {
    res = await fetch(`${base}/v1/${refresh ? "refresh" : "feed"}`, { method: refresh ? "POST" : "GET" });
  } catch {
    return { ok: false, message: "relay offline" };
  }
  if (!res.ok) return { ok: false, message: `relay ${res.status}` };
  try {
    const feed = JSON.parse(await res.text()) as Feed;
    if (feed.version !== FEED_VERSION) return { ok: false, message: "relay too new" };
    return { ok: true, feed };
  } catch {
    return { ok: false, message: "bad relay data" };
  }
}

export type OpenResult = "ok" | "unknown" | "busy" | "offline";

/**
 * Asks the relay to open a PR's page in the Mac's browser. Only the id is sent: the relay
 * looks the address up in its own last sync, so the bar never names a URL.
 */
export async function openOnMac(base: string, id: string): Promise<OpenResult> {
  let res: Response;
  try {
    res = await fetch(`${base}/v1/open`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    await res.text();
  } catch {
    return "offline";
  }
  if (res.ok) return "ok";
  return res.status === 404 ? "unknown" : res.status === 429 ? "busy" : "offline";
}
