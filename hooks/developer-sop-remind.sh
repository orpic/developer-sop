#!/usr/bin/env bash
# PreToolUse on writes: a two-line reminder, never a block.
"$(cd "$(dirname "$0")/.." && pwd)/bin/developer-sop" remind 2>/dev/null
exit 0
