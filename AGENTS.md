# busybar

Widgets and integrations for Josh's BUSY Bar (busy.app, by Flipper Devices).
External clients driving the device over its open HTTP API. BUSY's own docs call this
a "widget": a program on another computer that draws through the HTTP API
(docs.busy.app/bar/dev/widget-with-ai). On-device JS apps (fw 1.3.1+, JerryScript,
`npm create @busy-app/app`, docs.busy.app/bar/dev/js-apps and
developer.busy.app/javascript-applications.html) do not fit what lives here: one app
runs at a time, only in the foreground (Back or the mode selector quits it), no
WebSockets, and it may call only a short allowlist of localhost endpoints (draw,
audio, brightness, busy, status, own settings read; no storage, assets or any inbound
data channel). Mirroring Mac state stays a widget. Clock and Weather are JS apps since
1.3.1 (github.com/busy-app/clock-app, weather-app) if one is ever wanted for data that
lives on the internet.

## Device facts (can't be discovered from code)

- **Front display:** 72x16 RGB LED matrix. **Back display:** 160x80 monochrome OLED, 16 gray levels.
- **USB transport:** device enumerates as USB virtual LAN at `http://10.0.4.20/api` — fixed IP, **no auth**. This is the default dev transport.
- **Wi-Fi LAN:** disabled by default; enable in local web UI (`http://10.0.4.20` → Network). Auth = `X-Api-Token: <password>` header.
- **Internet:** `https://api.busy.app/busybar`, `Authorization: Bearer <token>`, tokens minted at cloud.busy.app (scope `busybar`).
- **Text is bitmap ASCII only** — the API rejects non-printable-ASCII. Always sanitize (see `toAscii` in `src/lib/bar.ts`).
- **Priority model:** draw accepted when `priority >=` running app. Built-in apps = 10, **active BUSY/CUSTOM focus session = 90**. Our ladder is in `src/lib/priorities.ts` — ambient widgets must stay below 90 so focus sessions win.
- **Verified on hardware (fw 0.10.2, 2026-08-10): the spec's "session = 90" is wrong in practice.** Any BUSY timer state other than `NOT_STARTED` — including the pre-start "ready" screen of a selected profile — rejects ALL external draws at every priority (1–100, the API max), on BOTH displays. Priority gating is global, not per-display: the back OLED cannot be used during a focus session. Consequence: widgets simply yield during focus (self-clearing timeouts handle this); even NEEDS_HUMAN=95 alerts cannot break through, and a rejected draw's `led_notification_color` does not blink either. To free the screen programmatically: `PUT /busy/snapshot` with `{"type":"NOT_STARTED"}`.
- **Snapshot semantics:** `GET /busy/snapshot` returns the stored snapshot + `snapshot_timestamp_ms`; `time_left_ms` does NOT tick — compute remaining as `time_left_ms - (now - snapshot_timestamp_ms)`.
- **Device firmware 1.3.1 (API 27.14.0, commit `8edd2da4`, built 2026-10-26; verified 2026-11-09).** Auto-update is ON (`/api/status` → `system.auto_update_enabled`), so the firmware moves under us; re-verify hardware notes after any update. `GET /api/update/changelog?version=` answered "Changelog not available" for 1.3.x; release notes live at github.com/busy-app/busybar-firmware/releases.
- **`.anim` files on this device are format v1 (`bicycle1`); 1.2.4 was v0 (`bicycle0`).** A file with the other signature uploads fine and then renders as a magenta "broken asset" box (this is what broke Clawd on the 1.2.4 → 1.3.1 auto-update). `src/lib/anim.ts` is a port of the reference encoder at the device's commit (`assets/frontend/util/seq2anim.ts`). The widget reads a stock file's signature at startup (`readDeviceAnimSignature` in `src/lib/bar.ts`) and, on a mismatch, logs it and draws a still Clawd through `xpmbitmap` instead. When that log line appears: `gh api repos/busy-app/busybar-firmware/commits/<firmware.commit_hash from /api/status>`, port that commit's `seq2anim.ts`, restart the agent, burst-screenshot to confirm frames change.
- **Re-sending an `animation` element restarts its loop.** Send sprites only on state change plus a slow liveness cadence; text and rectangles can be re-sent freely. Draws are additive per element `id`: a draw that omits an element leaves it on screen until its timeout.
- **`xpmbitmap` element** (API 27.x): inline pixel art as XPM2 text, up to 32 colors, no upload. Good for static sprites; use `.anim` for loops.
- **`GET /screen?display=N`** returns base64 text (Content-Type lies: image/bmp). Front = BGR888 (72*16*3 bytes). Back = Gray4, two pixels per byte (160*80/2 bytes), low nibble = earlier pixel (the `.anim` Gray4 packing is the opposite: high nibble first). `npm run screenshot` decodes both to PNG; use it to verify every layout change instead of guessing.
- **Back OLED chrome:** the right ~12px (x >= 148) is the firmware's status column (volume/wifi/battery). Usable canvas is 0..147. When nothing is drawn on the back, it mirrors the front inside a frame.
- **Font metrics (top_left anchor, glyph rows below the anchor):** tiny 4px tall / ~4px per char (rows y+1..y+4), small 5px / 4px (y+2..y+6), normal and condensed 7px / 5px, bold 7px / 6px, large 9px / 6px, extra_large 10px / 8px.
- **Priority is sticky per app name:** after drawing at 50, a later draw at 20 from the same `application_name` is refused ("Not drawn due to low priority") because your own canvas is now the running app. Pick one rung per widget; use `led_notification_color` for attention.
- **Clearing:** `DELETE /display/draw?application_name=X` (busy-lib `DisplayClear`, which also takes `element_ids`). `POST /display/clear` does not exist.
- **Device sounds** live at `/ext/apps_assets/busy/sounds/*.snd` and `/ext/apps_assets/shared/sounds/*.snd`, downloadable via `GET /storage/read?path=...`. Format is headerless PCM (runs of 0x00/0xFF, buzzer-style square wave); exact sample-rate/encoding not yet confirmed — first decode attempt (u8@44100) sounded like distorted noise. No audio-streaming endpoint exists; `POST /audio/play` only plays on the device speaker.
- Equal priority + different `application_name` overrides the screen. Each widget owns a unique `application_name` and clears only its own elements.
- A draw request **takes the screen** (canvas app) — it does not overlay the built-in timer UI.
- **Self-clearing pattern:** re-send elements every poll tick with `timeout` > ~3 poll intervals. A dead daemon leaves nothing stuck on screen. Prefer this over cleanup code.
- Firmware does all animation (text scrolling, countdown ticking, animation playback) — send state changes, never frames.

## Where to look

Start here before guessing at an API. The firmware auto-updates, so prefer what the device says over what this file remembers.

- **The device's own spec:** `http://10.0.4.20/openapi.yaml` over USB (same file as `https://api.busy.app/busybar/openapi.yaml`). Not vendored: fetch a copy with `curl -o docs/openapi-<api version>.yaml http://10.0.4.20/openapi.yaml` (gitignored) and diff it against the last one after a firmware update. `x-local-only` in the spec means "not through the cloud API"; those endpoints do answer over USB.
- **Interactive Swagger:** `http://10.0.4.20/docs` over USB, or `https://api.busy.app/busybar/docs`.
- **What firmware and API version the bar runs:** `GET http://10.0.4.20/api/status` (`firmware.commit_hash` is the firmware commit to read source at).
- **BUSY's docs:** HTTP API `docs.busy.app/bar/dev/http-api`; widgets `docs.busy.app/bar/dev/widget-with-ai`; JS apps `docs.busy.app/bar/dev/js-apps` and `developer.busy.app/javascript-applications.html`; building apps with an agent `docs.busy.app/bar/dev/js-apps/create-with-ai`.
- **Firmware source (GPL-2.0-or-later):** `github.com/busy-app/busybar-firmware`. Read it at the device's commit: `gh api -H 'Accept: application/vnd.github.raw' 'repos/busy-app/busybar-firmware/contents/<path>?ref=<commit>'`. Useful paths: `documentation/File Formats.dox.md` and `lib/anim_file/` (`.anim`), `assets/frontend/util/seq2anim.ts` (reference encoder), `applications/services/js_runner/` (what a JS app can do: `js_input.c` for buttons, `js_fetch.c` for fetch).
- **TS client:** `@busy-app/busy-lib` 0.21.x. Method names are namespace-prefixed (`DisplayDraw`, `DisplayClear`, `AssetsUpload`, `BusySnapshotGet`, `SystemStatusGet`). `StateStream` is **browser-only** (SharedWorker); for Node, use a plain WebSocket against `/status/ws` (protobuf-encoded, `BSB_State.State`). Its error path does not work inside a JS app (see PR Queue below).
- **Python client:** `busylib` 2.x on PyPI, guides at busy-app.github.io/busylib-py (its "back screen is RGB" claim is wrong for this firmware, see above).
- **The JS app's own guide:** `apps/pr-queue/AGENTS.md` (runtime limits, build and install commands).
- **Seeing the screen:** `npm run screenshot` reads both framebuffers back as PNGs. Verify every layout change that way instead of guessing.

## Structure

- `src/lib/` — shared client (`bar.ts`), priority ladder (`priorities.ts`)
- `src/lib/anim.ts` — `.anim` v1 (`bicycle1`) encoder (RGBA frames in, device file out)
- `src/widgets/<name>/` — one folder per widget, each with its own `application_name`
- `src/widgets/claude/` — Claude Code session status: `sprite.ts` (Clawd sprite sheet, sections = phases), `state.ts` (hook events to session phases), `scene.ts` (elements for both screens), `index.ts` (daemon)
- `hooks/claude-code-hook.sh` — the Claude Code hook; one JSON file per session under `~/.busybar/claude/sessions/`
- `scripts/smoke.ts` — connectivity check + hello-world draw (`npm run smoke`)
- `scripts/screenshot.ts` — both screens to PNG (`npm run screenshot [-- outdir]`)
- `scripts/install-claude-hooks.ts` — adds/removes the hook entries in `~/.claude/settings.json` (backs up first)
- `launchd/` + `scripts/install.sh <widget>` — daemon installation
- `apps/pr-queue/` — the PR Queue JS app (its own `package.json`, Node 24); `src/widgets/pr-queue-relay/` — its Mac side
- `docs/blog/` — gitignored: private notes and blog captures. Never commit it, and never add a real capture to `docs/images/`
- `scripts/pr-queue-blog-shots.sh` — every PR Queue screen as PNGs, demo mode only (see its header before changing it)
- `scripts/claude-blog-shots.ts` — the Claude widget drawn from invented sessions (the live widget is never captured); `scripts/blog-composites.ts` — builds the post's figures from those captures

## Commands

- `npm run smoke` — verify the bar is reachable, draw test text
- `npm run screenshot` — grab both screens to `/tmp/busybar-shots/*.png`
- `npm run claude` — run the Claude Code status widget in foreground
- `npm run claude:hooks` — wire the hook into `~/.claude/settings.json` (`-- --uninstall` to remove)
- `npm run spotify` — run the Spotify now-playing widget in foreground
- `npm run pr-queue-relay` — run the PR Queue relay in foreground (needs the bar plugged in: it binds the USB address)
- `npm run type-check` — tsc
- `./scripts/install.sh claude` — install a widget as a launchd agent (logs: `/tmp/busybar-<widget>.log`); `--remove <widget>` to stop it

## Claude Code widget

Hooks in `~/.claude/settings.json` run `hooks/claude-code-hook.sh` on SessionStart,
UserPromptSubmit, PreToolUse, PostToolUse(Failure), PermissionRequest, Notification,
Stop, StopFailure, Pre/PostCompact, PostModelSwitch and SessionEnd. The script writes
`~/.busybar/claude/sessions/<session_id>.json` (latest event only, ms timestamp,
subagent events skipped) and deletes it on SessionEnd. The daemon watches that
directory, folds events into phases (idle, thinking, working, needs_you, done,
error), picks the most urgent session for the front screen and lists them all on
the back. Everything idle for 10 minutes: it clears and hands the screen back.
Priority 20 (`ASSISTANT`) so it sits above the Spotify widget while work runs.

## PR Queue (JS app + Mac relay)

- `apps/pr-queue/` is an on-device JS app (Node 24 for `busy-cli`; `npm run build`, `npx busy-cli app install|run`). `src/widgets/pr-queue-relay/` is its Mac side (`npm run pr-queue-relay`, `./scripts/install.sh pr-queue-relay`, log `/tmp/busybar-pr-queue-relay.log`).
- **Never store credentials in a JS app's settings.** They live in plain files under `/ext/apps_data/jsrunner/`, which the password-free USB API can list and read. Secrets stay on the Mac; the relay listens only on the USB address 10.0.4.21 and answers only the bar.
- Demo data in `apps/pr-queue/src/demo.ts` is invented and must stay that way (blog screenshots come from demo mode).
- fw 1.3.1 draw quirks the app works around in `apps/pr-queue/src/screen.ts`: busy-lib errors are masked on-device (`Response.clone` missing), animation-replacing-xpmbitmap under one id is a 400, updated text over a rectangle needs the rectangle re-sent, a batch DELETE fails if any id is gone, an empty canvas shows lower-priority widgets.
- `scripts/pr-queue-drive.sh <outdir> up down ok start back ...` drives the app via `/api/input` and captures each step; it refuses to run unless the app is installed. Its captures show whatever is on the bar, real PRs included: keep them out of `docs/blog/`.
- **A lower-priority widget shows through for a few seconds after every app launch** (the app's canvas is empty until its first draw), so a capture taken then is the Claude widget with real session names. `scripts/pr-queue-blog-shots.sh` hangs a black curtain at priority 40 first and waits for the app to draw over it.
- Relay settings are environment variables (set them in the launchd plist): `PR_QUEUE_DAYS` (default 30: only PRs touched that recently, 0 = no window), `PR_QUEUE_ORGS` (owner filter), `PR_QUEUE_NUDGE=0` (no banner), `PR_RELAY_OPEN_CMD` (what `/v1/open` runs; tests point it at a recorder so no browser opens).
- `POST /v1/open {"id"}` opens a PR's page on the Mac: bar only (the Mac itself gets 403), the address comes from the relay's own last sync, or from GitHub by that id when the bar's list is older than the sync (`pageOf`), at most one every 2 s. To test it without a browser, run a second relay on another port with `PR_RELAY_OPEN_CMD` set and point the app's `relay` setting at it.
- `nudge.ts` draws a 20 s banner as app `pr_queue_nudge` at priority 40 when a review request is new. Below the app (50) on purpose: with PR Queue open the bar refuses the draw and its LED blink, and the app announces the request itself. `scripts/pr-queue-nudge-shot.ts` draws it with an invented PR.
- "Ready" (`isReady` in `apps/pr-queue/src/feed.ts`) means approved + CI green + not draft + no conflicts. Do not loosen it to "no review required": that counted every green PR in unprotected repos.
- Snoozes live on the bar (`/ext/apps_data/jsrunner/app.josh.pr_queue.localstorage.json`). Hold START on a PR snoozes it; hold START on the glance brings that list's snoozed PRs back.
- The relay counts each whole list (up to 100 PRs) and which review requests are new since its last sync; the bar gets 8 PRs per list plus those numbers. `GET/PUT /api/apps/settings?app_id=` and `POST /api/apps/launch|quit` work over USB (`x-local-only` in the spec means not through the cloud API).
