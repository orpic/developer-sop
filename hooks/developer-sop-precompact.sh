#!/usr/bin/env bash
# PreCompact: tell the summary what the store already holds, so it keeps what the store does not.
"$(cd "$(dirname "$0")/.." && pwd)/bin/developer-sop" precompact 2>/dev/null
exit 0
