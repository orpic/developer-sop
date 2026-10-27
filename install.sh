#!/usr/bin/env bash
# One-time setup. Safe to run again: a second run changes nothing and says so.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
SETTINGS="${CLAUDE_SETTINGS:-$HOME/.claude/settings.json}"
changed=0

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing: $1 ($2)"; exit 1; }; }
need docker "install Docker Desktop or Docker Engine"
need node "install Node.js 20 or newer"
docker compose version >/dev/null 2>&1 || { echo "missing: docker compose (Compose v2)"; exit 1; }
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ] || { echo "node 20 or newer is required"; exit 1; }

if [ ! -f "$DIR/.env" ]; then
  cp "$DIR/.env.example" "$DIR/.env"
  echo "created .env from .env.example; edit OWNER_NAME, REPO_URL and LOCAL_REPO there"
  changed=1
fi

if [ ! -d "$DIR/tools/node_modules" ]; then
  (cd "$DIR/tools" && npm install --silent)
  echo "installed the command line's packages"
  changed=1
fi

if ! docker ps --format '{{.Names}}' | grep -qx developer-sop-page; then
  (cd "$DIR" && docker compose up -d --build)
  changed=1
fi

for i in $(seq 1 30); do
  curl -fsS -o /dev/null http://localhost:8028 && break
  [ "$i" = 30 ] && { echo "the page did not answer on http://localhost:8028"; (cd "$DIR" && docker compose logs --tail 20); exit 1; }
  sleep 1
done

result=$(DIR="$DIR" SETTINGS="$SETTINGS" node --input-type=module -e '
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
const { DIR, SETTINGS } = process.env;
const wanted = [
  ["SessionStart", null, "developer-sop-context.sh", 10],
  ["PreToolUse", "Write|Edit|NotebookEdit|Bash", "developer-sop-remind.sh", 10],
  ["UserPromptSubmit", null, "developer-sop-prompt.sh", 10],
  ["PreCompact", null, "developer-sop-precompact.sh", 10],
];
let settings = {};
if (existsSync(SETTINGS)) {
  try { settings = JSON.parse(readFileSync(SETTINGS, "utf8")); }
  catch { console.log("INVALID"); process.exit(0); }
} else {
  mkdirSync(dirname(SETTINGS), { recursive: true });
}
settings.hooks ??= {};
let added = 0;
for (const [event, matcher, file, timeout] of wanted) {
  const command = `${DIR}/hooks/${file}`;
  settings.hooks[event] ??= [];
  const present = settings.hooks[event].some((group) => (group.hooks ?? []).some((h) => h.command === command));
  if (present) continue;
  const group = { hooks: [{ type: "command", command, timeout }] };
  if (matcher) group.matcher = matcher;
  settings.hooks[event].push(group);
  added++;
}
if (added) {
  if (existsSync(SETTINGS)) copyFileSync(SETTINGS, SETTINGS + ".before-developer-sop");
  writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + "\n");
  JSON.parse(readFileSync(SETTINGS, "utf8"));
}
console.log(added ? "ADDED " + added : "PRESENT");
')

case "$result" in
  INVALID) echo "$SETTINGS is not valid JSON; fix it and run this again. Nothing was changed there."; exit 1 ;;
  ADDED*)  echo "added ${result#ADDED } hook entries to $SETTINGS"; [ -f "$SETTINGS.before-developer-sop" ] && echo "backup of the old file: $SETTINGS.before-developer-sop"; changed=1 ;;
esac

[ "$changed" = 0 ] && echo "nothing to change: already installed"
echo
echo "page:     http://localhost:8028"
echo "command:  put bin/developer-sop on your PATH, for example"
echo "          ln -s \"$DIR/bin/developer-sop\" /usr/local/bin/developer-sop"
echo "rules:    add the contents of $DIR/RULES.md to your project's CLAUDE.md"
echo "restart Claude Code so it reads the new hooks"
