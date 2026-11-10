#!/bin/sh
# Claude Code hook: records the latest event of each session as one small JSON file,
# which the busybar claude widget (src/widgets/claude) turns into the display.
# Wired into ~/.claude/settings.json by scripts/install-claude-hooks.ts. Reads the
# hook payload on stdin; the event name comes from its hook_event_name field.
# Must stay fast (SessionEnd hooks share a 1.5s budget) and must always exit 0.
set -u
DIR="${BUSYBAR_CLAUDE_DIR:-$HOME/.busybar/claude/sessions}"

input=$(cat) || exit 0
[ -n "$input" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

sid=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null) || exit 0
[ -n "$sid" ] || exit 0
case "$sid" in *[!A-Za-z0-9_-]*) exit 0 ;; esac

mkdir -p "$DIR" 2>/dev/null || exit 0
file="$DIR/$sid.json"

ev=$(printf '%s' "$input" | jq -r '.hook_event_name // empty' 2>/dev/null) || exit 0
if [ "$ev" = "SessionEnd" ]; then
  rm -f "$file"
  exit 0
fi

# Hooks also fire inside subagents (agent_id set); the main thread is enough for a status light.
# The file holds only the latest event, so the prompt, last reply, model and cwd are carried
# forward from the previous file: a daemon that starts late still knows what each session is on.
tmp="$DIR/.$sid.$$.tmp"
prev='{}'
[ -s "$file" ] && prev=$(cat "$file" 2>/dev/null || printf '{}')
printf '%s' "$input" | jq -c --argjson prev "$prev" '
  if .agent_id then empty else {
    event: .hook_event_name,
    ts: (now * 1000 | floor),
    session_id,
    cwd: (.cwd // $prev.cwd),
    model: (.to_model // .model // $prev.model),
    tool_name, notification_type, source, reason, error, to_model, stop_hook_active, permission_mode,
    background_tasks: ((.background_tasks // []) | length),
    prompt: ((.prompt // "") | gsub("</?pasted_content[^>]*>"; "") | gsub("\\s+"; " ") | ltrimstr(" ") | rtrimstr(" ")
      | if . != "" then .[0:120] else ($prev.prompt // "") end),
    last_assistant_message: (if (.last_assistant_message // "") != "" then .last_assistant_message[0:160] else ($prev.last_assistant_message // "") end)
  } end' > "$tmp" 2>/dev/null
if [ -s "$tmp" ]; then
  mv -f "$tmp" "$file"
else
  rm -f "$tmp"
fi
exit 0
