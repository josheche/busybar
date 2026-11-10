#!/bin/bash
# Drive the PR Queue app from the Mac and capture both screens after every step.
# Usage: scripts/pr-queue-drive.sh <outdir> [key ...]   keys: up down ok start back
# /api/input sends single presses, so holds (sync, snooze) need a hand on the bar.
set -euo pipefail
OUT=${1:?outdir}; shift
B=http://10.0.4.20/api
cd "$(dirname "$0")/.."
# Key presses go to whatever owns the bar. If the app is missing, they would drive the
# firmware's own menus (START can begin a BUSY session), so refuse to run.
if ! curl -s -m 5 "$B/apps/list" | grep -q '"app.josh.pr_queue"'; then
  echo "PR Queue is not installed on the bar; not sending any input." >&2
  exit 1
fi
mkdir -p "$OUT"
step=0
npm run -s screenshot -- "$OUT/$step-start" >/dev/null
for key in "$@"; do
  step=$((step + 1))
  t0=$(perl -MTime::HiRes=time -e 'printf "%.3f", time')
  curl -s -o /dev/null -X POST "$B/input?key=$key"
  # Poll the front framebuffer until it changes (or 3 s): input-to-pixels latency.
  before=$(curl -s "$B/screen?display=0" | shasum | cut -c1-12)
  ms=timeout
  for _ in $(seq 1 60); do
    now=$(curl -s "$B/screen?display=0" | shasum | cut -c1-12)
    if [ "$now" != "$before" ]; then ms=$(perl -MTime::HiRes=time -e "printf '%d', (time - $t0) * 1000"); break; fi
    perl -e 'select(undef,undef,undef,0.05)'
  done
  perl -e 'select(undef,undef,undef,0.4)'
  npm run -s screenshot -- "$OUT/$step-$key" >/dev/null
  echo "$step $key: front changed after ${ms}ms"
done
