#!/usr/bin/env bash
# UserPromptSubmit: one line, so a decision in the owner's message is saved before the reply.
"$(cd "$(dirname "$0")/.." && pwd)/bin/developer-sop" prompt 2>/dev/null
exit 0
