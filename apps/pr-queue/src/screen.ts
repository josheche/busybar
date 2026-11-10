// Sends a view to the bar, changed elements only, one request in flight.
// - Each element is compared by its JSON against what was last sent under its id.
// - Ids that left the view are cleared in one DisplayClear.
// - Static icons are re-sent every ICON_RESEND_MS anyway: on 2026-11-09 one capture in
//   twenty showed an xpmbitmap as the firmware's broken-asset box, and a diff-only screen
//   would keep it there forever.
// - While a request is out, newer views replace the queued one (a fast wheel spin draws
//   only where it lands).
// - An element whose type changes under the same id is cleared first: fw 1.3.1 answers
//   400 "Unspecified request error" to an animation replacing an xpmbitmap id (the
//   reverse is accepted), and rejects the whole draw with it.
// - A DELETE fails whole ("one of element_ids is non-existent") if any id is already gone,
//   so a failed batch clear falls back to clearing ids one by one, skipping the missing.
// - After any failed request the device state is unknown: the same view is retried at once
//   on a wiped slate. Waiting for the next view would leave the app's canvas empty, and an
//   empty canvas lets lower-priority widgets show through.
import { clear, draw } from "./http.ts";
import type { El } from "./view.ts";

const ICON_RESEND_MS = 20_000;

export class Screen {
  /** id -> JSON last sent under it. */
  private shown = new Map<string, string>();
  /** id -> element type last sent under it. */
  private types = new Map<string, string>();
  private dirty = true;
  private queued: { els: El[]; led: string } | null = null;
  private busy = false;
  private lastIcons = 0;
  private readonly app: string;
  private readonly report: (err: unknown) => void;

  constructor(app: string, report: (err: unknown) => void) {
    this.app = app;
    this.report = report;
  }

  show(els: El[], led = ""): void {
    this.queued = { els, led: led || this.queued?.led || "" };
    if (!this.busy) void this.pump();
  }

  private async pump(): Promise<void> {
    this.busy = true;
    let retried = false;
    while (this.queued) {
      const job = this.queued;
      this.queued = null;
      try {
        await this.send(job.els, job.led);
        retried = false;
      } catch (err) {
        this.dirty = true;
        this.report(err);
        // One immediate retry on a clean slate, unless a newer view is already waiting.
        if (!retried && !this.queued) this.queued = job;
        retried = true;
      }
    }
    this.busy = false;
  }

  private async send(els: El[], led: string): Promise<void> {
    if (this.dirty) {
      // Answers 400 when the app has nothing drawn yet; either way the slate is clean.
      await clear({ application_name: this.app }).catch(() => {});
      this.shown.clear();
      this.types.clear();
      this.dirty = false;
    }
    const now = Date.now();
    const icons = now - this.lastIcons >= ICON_RESEND_MS;
    const ids = new Set<string>();
    const changed: El[] = [];
    const stale: string[] = [];
    const dirtyLayers = new Set<string>();
    const isChanged = (el: El) => this.shown.get(el.id) !== JSON.stringify(el) || (icons && el.type === "xpmbitmap");
    for (const el of els) if (el.layer && isChanged(el)) dirtyLayers.add(el.layer);
    for (const el of els) {
      ids.add(el.id);
      if (isChanged(el) || (el.layer !== undefined && dirtyLayers.has(el.layer))) changed.push(el);
      const was = this.types.get(el.id);
      if (was !== undefined && was !== el.type) stale.push(el.id);
    }
    this.shown.forEach((_, id) => {
      if (!ids.has(id)) stale.push(id);
    });

    if (stale.length > 0) {
      try {
        await clear({ application_name: this.app, element_ids: stale });
      } catch {
        for (const id of stale) await clear({ application_name: this.app, element_ids: [id] }).catch(() => {});
      }
      for (const id of stale) {
        this.shown.delete(id);
        this.types.delete(id);
      }
    }
    // A draw needs at least one element; an LED blink rides on the first one.
    if (changed.length === 0 && led && els.length > 0) changed.push(els[0]);
    if (changed.length === 0) return;

    await draw({
      application_name: this.app,
      priority: 50,
      ...(led ? { led_notification_color: led } : {}),
      elements: changed.map(({ layer: _layer, ...el }) => el),
    });
    for (const el of changed) {
      this.shown.set(el.id, JSON.stringify(el));
      this.types.set(el.id, el.type);
    }
    if (icons) this.lastIcons = now;
  }
}
