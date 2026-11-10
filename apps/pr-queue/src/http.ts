// Draw, clear and play without busy-lib. busy-lib 0.21's error path (toFetchError) calls
// Response.clone(), which JerryScript's fetch does not have, so any non-2xx answer surfaced
// as "TypeError: Expected a function" and hid the bar's real status and message.

export class BarError extends Error {
  readonly status: number;
  constructor(path: string, status: number, body: string) {
    super(`${path} ${status}: ${body.slice(0, 160)}`);
    this.status = status;
  }
}

async function call(method: "POST" | "DELETE", path: string, body: unknown): Promise<void> {
  const res = await fetch(`http://${__BUSY_ADDR__}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new BarError(path, res.status, text);
}

export function draw(body: { application_name: string; priority: number; elements: unknown[]; led_notification_color?: string }): Promise<void> {
  return call("POST", "/display/draw", body);
}

/** Plays one of the firmware's own sounds, e.g. "shared/sounds/calendar_event_starts.snd". */
export function play(body: { application_name: string; stock_path: string }): Promise<void> {
  return call("POST", "/audio/play", body);
}

/** Without element_ids, clears every element the app has drawn. */
export function clear(body: { application_name: string; element_ids?: string[] }): Promise<void> {
  return call("DELETE", "/display/draw", body);
}
