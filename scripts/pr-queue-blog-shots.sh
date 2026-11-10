#!/bin/bash
# Capture every PR Queue screen for the blog, from DEMO MODE ONLY.
# Usage: scripts/pr-queue-blog-shots.sh [outdir]   (default docs/blog/pr-queue/assets/app)
#
# Publishing rule (docs/blog/pr-queue/log.md): blog images never show real PRs. This script
# turns demo mode on through the bar's settings API, refuses to capture a PR screen unless
# the bar confirms it, and restores the settings it found when it exits, however it exits.
# The two screens captured outside demo mode (syncing, relay offline) are taken with the
# relay address pointed at nothing, so the app has no PR data to show.
#
# The Claude widget is the other risk: it draws at a lower priority and shows through whenever
# the app's canvas is empty (for a few seconds after every launch), with real session names.
# So before each launch the script hangs a black "curtain" at a priority between the two, and
# only starts capturing once the app has drawn over it. The first version of this script
# skipped that and saved three captures of the widget into the blog folder.
#
# /api/input sends single presses, so toasts that need a hold (snoozed, synced) are not here.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=${1:-docs/blog/pr-queue/assets/app}
B=http://10.0.4.20/api
APP=app.josh.pr_queue
TMP=$(mktemp -d)

curl -s -m 5 "$B/apps/list" | grep -q "\"$APP\"" || { echo "PR Queue is not installed on the bar." >&2; exit 1; }

SAVED=$(curl -s -m 5 "$B/apps/settings?app_id=$APP")
echo "$SAVED" | jq -e '.values.relay' >/dev/null || { echo "could not read the app's settings" >&2; exit 1; }

CURTAIN=pr_shots
# The front framebuffer as raw BGR bytes; "text" skips x < 14, where spinners animate.
front_lit() { curl -s "$B/screen?display=0" | python3 -I -c 'import sys,base64; sys.exit(0 if any(base64.b64decode(sys.stdin.read())) else 1)'; }
front_text() { curl -s "$B/screen?display=0" | python3 -I -c 'import sys,base64,hashlib; r=base64.b64decode(sys.stdin.read()); print(hashlib.sha1(b"".join(r[y*216+42:(y+1)*216] for y in range(16))).hexdigest()[:12])'; }
nap() { perl -e "select(undef,undef,undef,$1)"; }
curtain() {
  local black='"radius":0,"fill":"solid","fill_colors":["#000000FF"],"border_width":0,"timeout":180'
  curl -s -m 5 -o /dev/null -X POST "$B/display/draw" -H 'Content-Type: application/json' -d "{\"application_name\":\"$CURTAIN\",\"priority\":40,\"elements\":[
    {\"id\":\"f\",\"type\":\"rectangle\",\"display\":\"front\",\"x\":0,\"y\":0,\"width\":72,\"height\":16,$black},
    {\"id\":\"b\",\"type\":\"rectangle\",\"display\":\"back\",\"x\":0,\"y\":0,\"width\":160,\"height\":80,$black}]}"
}
# Quit, curtain down, launch, then wait until the app has drawn and its text has settled.
launch_behind_curtain() {
  curl -s -m 5 -o /dev/null -X POST "$B/apps/quit" || true
  nap 0.6
  local ok=0
  for _ in 1 2 3 4 5 6; do curtain; nap 0.5; if ! front_lit; then ok=1; break; fi; done
  [ "$ok" = 1 ] || { echo "the curtain did not take the screen; nothing captured." >&2; exit 1; }
  [ "$(curl -s -m 5 -o /dev/null -w '%{http_code}' -X POST "$B/apps/launch?app_id=$APP")" = 200 ] || { echo "could not launch the app" >&2; exit 1; }
  ok=0
  for _ in $(seq 1 40); do nap 0.5; if front_lit; then ok=1; break; fi; done
  [ "$ok" = 1 ] || { echo "the app never drew; nothing captured." >&2; exit 1; }
  local last="" same=0 now
  for _ in $(seq 1 30); do
    now=$(front_text)
    if [ "$now" = "$last" ]; then same=$((same + 1)); else same=0; fi
    last=$now
    [ "$same" -ge 3 ] && return 0
    nap 0.4
  done
}

put_settings() { curl -s -m 5 -o /dev/null -w '%{http_code}' -X PUT "$B/apps/settings?app_id=$APP" -H 'Content-Type: application/json' -d "$1"; }
relaunch() {
  curl -s -m 5 -o /dev/null -X POST "$B/apps/quit" || true
  perl -e 'select(undef,undef,undef,0.6)'
  [ "$(curl -s -m 5 -o /dev/null -w '%{http_code}' -X POST "$B/apps/launch?app_id=$APP")" = 200 ] || { echo "could not launch the app" >&2; exit 1; }
}
restore() {
  put_settings "$SAVED" >/dev/null || true
  curl -s -m 5 -o /dev/null -X DELETE "$B/display/draw?application_name=$CURTAIN" || true
  relaunch || true
  rm -rf "$TMP"
  echo "settings restored: $(curl -s -m 5 "$B/apps/settings?app_id=$APP" | jq -c .values)"
}
trap restore EXIT

n=0
shot() { # shot <name>
  n=$((n + 1))
  local name; name=$(printf '%02d-%s' "$n" "$1")
  npm run -s screenshot -- "$TMP/$name" >/dev/null
  cp "$TMP/$name/front.png" "$OUT/$name-front.png"
  cp "$TMP/$name/back.png" "$OUT/$name-back.png"
  echo "  $name"
}
press() { curl -s -o /dev/null -X POST "$B/input?key=$1"; nap 0.9; }
# BACK closes a detail, but with no detail open it quits the app. If a press was lost and
# that happened, the curtain is what is left on screen: stop rather than capture nothing.
close_detail() { press back; front_lit || { echo "the app quit (BACK with no detail open); stopping." >&2; exit 1; }; }

mkdir -p "$OUT"

# ---- demo mode: every PR screen
[ "$(put_settings "$(echo "$SAVED" | jq -c '.values.demo = true')")" = 200 ] || { echo "could not turn demo mode on" >&2; exit 1; }
launch_behind_curtain
[ "$(curl -s -m 5 "$B/apps/settings?app_id=$APP" | jq -r .values.demo)" = true ] || { echo "the bar does not confirm demo mode; nothing captured." >&2; exit 1; }
echo "demo mode confirmed; capturing to $OUT"

# Demo lists (apps/pr-queue/src/demo.ts): review = failing, passing, running; mine = failing,
# approved, draft with CI running, approved. OK opens a detail and BACK closes it (OK inside
# a detail asks the relay to open the PR on the Mac; demo mode only shows a toast).
shot review-glance
press up;    shot review-item-failing
press ok;    shot review-detail-failing
close_detail
press up;    shot review-item-passing
press up;    shot review-item-running
press ok;    shot review-detail-running
close_detail
press start; shot mine-glance
press up;    shot mine-item-failing
press ok;    shot mine-detail-failing
close_detail
press up;    shot mine-item-approved
press ok;    shot mine-detail-approved
close_detail
press up;    shot mine-item-draft-running
press start

# ---- no data at all: the first-sync and relay-offline screens
# 10.0.4.99 is an unused address on the USB link: the connection attempt hangs, then fails.
[ "$(put_settings "$(echo "$SAVED" | jq -c '.values.demo = false | .values.relay = "http://10.0.4.99:8787"')")" = 200 ] || { echo "could not point the relay at nothing" >&2; exit 1; }
t0=$(perl -MTime::HiRes=time -e 'printf "%.3f", time')
launch_behind_curtain
shot syncing
before=$(front_text)
waited=timeout
for _ in $(seq 1 240); do
  if [ "$(front_text)" != "$before" ]; then waited=$(perl -MTime::HiRes=time -e "printf '%.0f', time - $t0"); break; fi
  nap 0.5
done
echo "  relay-offline screen appeared about ${waited}s after launch (includes the app's start-up)"
nap 0.8
shot relay-offline
