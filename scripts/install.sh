#!/bin/zsh
# Install a widget as a launchd agent (survives reboots, restarts on crash).
# Usage: ./scripts/install.sh <widget>        e.g. claude, spotify
#        ./scripts/install.sh --remove <widget>
set -euo pipefail

remove=0
if [[ "${1:-}" == "--remove" ]]; then remove=1; shift; fi
widget="${1:-}"
if [[ -z "$widget" ]]; then
  echo "usage: $0 [--remove] <widget>" >&2
  ls "$(dirname "$0")/../launchd" | sed 's/app\.busybar\.\(.*\)\.plist/  \1/' >&2
  exit 2
fi

label="app.busybar.$widget"
src="$(cd "$(dirname "$0")/.." && pwd)/launchd/$label.plist"
dst="$HOME/Library/LaunchAgents/$label.plist"
[[ -f "$src" ]] || { echo "no such widget: $widget ($src)" >&2; exit 2; }

launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
# bootout returns before the service is gone; a bootstrap in that window fails with EIO.
for _ in {1..50}; do
  launchctl print "gui/$(id -u)/$label" >/dev/null 2>&1 || break
  sleep 0.1
done
if (( remove )); then
  rm -f "$dst"
  echo "removed $label"
  exit 0
fi
# launchd shells do not load nvm, so bake in the node bin dir that is current now.
# Re-run this after switching node versions.
node_bin="$(dirname "$(command -v node)")"
sed "s#__NODE_BIN__#$node_bin#" "$src" > "$dst"
launchctl bootstrap "gui/$(id -u)" "$dst"
echo "installed and started $label"
echo "logs: tail -f /tmp/busybar-$widget.log"
