#!/usr/bin/env bash
# SessionStart (startup, resume, clear, compact): print the current work item's state into context.
"$(cd "$(dirname "$0")/.." && pwd)/bin/developer-sop" context 2>/dev/null || echo "Development SOPs: store unreachable. Follow the rules in RULES.md anyway."
exit 0
