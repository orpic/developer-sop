# Development SOPs

All work lives in the Development SOPs store (MongoDB at 127.0.0.1:27027, database `developer-sop`), not in loose files in the repo. The page is http://localhost:8028. The owner is the person whose decisions these are; the tool shows their name from `OWNER_NAME` in `.env`.

1. Every piece of work has one `work` document before the first edit. Its `current_state` is the only "where are we". Overwrite it, never start a second state file.
2. A decision is recorded when it is made, with the why and the owner's own words. If it drops or defers scope, cannot be undone, or changes what a teammate gets, it needs the owner's yes, asked as one short question (context, your pick, what breaks either way), never buried in a plan.
3. A deferral names an issue or a work item. "Later" alone is not allowed.
4. When work starts from an issue, spec or plan, every line becomes a `scope_item`. Before a PR, an archive or "done", no scope_item is left open.
5. Follow-ups are issues in your tracker, filed through an approved draft. Only questions, waits, promises and private risks are local `open_items`. Every "I'll do X later" is a promise row.
6. Every measurement is `evidence` with its query. Every script run is recorded on its artifact.
7. Every draft is a `drafts` row, and its status says whether it was posted.
8. Save at the moment, not at the end. Compaction gives no warning, so the store must already hold everything except the step in progress:
   - The owner answers, approves, rejects or changes something: record it before replying. A decision saved from their own words is stamped approved in the same write (`"approved":{"by":"owner","at":"<utc now>","words":"<their words>"}`), so it never shows as waiting on them.
   - A new decision or open item says what it replaces. The command refuses it until it carries `"replaces":"<id>"` (or a list of ids), which closes those rows, or `"replaces":"none"`.
   - When the thing a wait was waiting for happens, close that wait in the same step as recording what happened.
   - You decide, promise, defer, draft or measure something: record it before the next tool call.
   - A step finishes: overwrite `current_state` (done, in flight, next) before starting the next.
   After a compaction the session-start block is the truth. Re-read it and the decisions before building anything, and redo only the step that was in flight.
9. A watch ends with a findings note. A work item ends with a verdict.
10. Every question to the owner carries its context first, in simple terms. Start from where the thing physically is (file path, or table and column) and show a real line of it. Then what it is, and who writes it and who reads it. Then the question. Never ask about a field or table by name alone.
11. Optional: right after a PR is created, review it in a subagent so the review does not fill this chat, and post its findings as inline PR comments. Fix each finding with a new commit. Anything that needs the owner's decision is asked first.
12. Optional: once every fix on a PR is done and every decision made, post all the thread replies at once and resolve each thread that was fixed or decided. Leave a thread unresolved only when the owner has not discussed it yet, so an open thread always means "not talked about".
13. Every work item gets a walkthrough on its page. It explains the work the way a video does: pictures first, words under them.
    - Step 1 is the overview, three or four boxes. Each next step is the same diagram with more added (`:::new`), then a zoom into one part. A question's step shows its part of the diagram with `:::focus` and the rest `:::dim`.
    - Two lines at the top say what the work is (`developer-sop summary <key> "..."`).
    - Labels are a few words. Arrows carry a number and a verb ("1 asks for the report") so the order reads without the points. Detail goes in the points, one idea each.
    - Two series of points: context points C01, C02, ... and questions Q01, Q02, ..., each with its own counter, always two digits. Never number points by step.
    - A question is complete on its own: `title` (a few words), `text` (where things stand today, two or three full sentences), `options` (shown as A, B, C, only when there is a real choice) and `pick`.
    - A point is one explanation read straight through. Each sentence says what happens and why, and names the piece of code where it acts, in code font, as a link to the file and lines in your repository (set `REPO_URL` in `.env`). One name per thing across the whole page.
    - Every linked piece of code has its intent written in `code_intents`: one or two plain sentences, 20 to 45 words, on what it is for, what goes in and what comes out. The page shows it when the link is hovered.
    - A code link points at where the code is defined, never where it is called.
    - Every page also plays as a slide show at `/work/<key>/present`. Arrows carry numbers in the order things happen.
    - Every file, table, column, route or module named in a point says whether it exists today or is new in this work.
    - A point's label never changes and a point is never deleted. One not wanted gets status `dropped`.
    - Update the walkthrough as the work moves: new steps for what was built or found, statuses on the points.
14. Understanding is recorded part by part. When a piece of work has seven parts and the owner understands five, those five are decided and go ahead. Only the two they did not understand stay undecided, each as an open question, never a decision.
15. A new piece of work gets its own work item and its own page. When the talk turns to something that is not part of the current work item, create a `work` row and a walkthrough for it before the first edit.
16. Optional: no plan for reverting a change. Undoing a change means the planning fell short, so plans never carry a back-out section.
17. Every chat keeps a chat state, and stays under 200K tokens. A chat holds things no work item does: what it is for, the threads it moved between, the owner's preferences said in it, what was learned and ruled out, the files that matter, the step in flight. They go in one `chat_states` row per chat, written once the chat's purpose is clear.
    - Its kind fits the chat: `goal` (build or fix one thing), `research` (answer a question), `explore` (think an idea through), `broad` (a horizon across many things), `support` (small asks). The `aim` says it in one line.
    - Update it in place, at the moments of rule 8. A list is written whole, so a thread that is over gets status done or dropped and anything no longer true is removed. It never only grows.
    - Past 200K tokens the prompt hook says so. Bring the chat state up to date first. End the reply with one question card, the last thing in it, with two options: "Clear and reload" (first, the default) and "Compact". For clear and reload, the first step is to start a helper chat that sends this chat a message about 1 second later. Only after it has started, set `reload_pending`, then clear the chat with the app's clear tool, so the owner never types /clear. The helper's message wakes the cleared chat, which posts its reload note from the state the session-start hook prints. As soon as the helper's first message arrives, delete the helper. Without the helper the chat sits idle.
    - Keep big reads out of the chat: a sub-agent reads PDFs, long logs and many files and sends back only the answer.

## Commands

```bash
developer-sop list                                   # active work
developer-sop show <key>                             # the block the session-start hook prints
developer-sop put work '{"key":"x","title":"...","kind":"change","status":"active","goal":"...","branches":[{"name":"feat-x"}]}'
developer-sop put decisions '{"work_key":"x","statement":"...","why":"...","type":"defer","decided_by":"claude","needs_owner":true,"status":"active","deferred_to":{"issue":1}}'
developer-sop state <key> '{"done":"...","in_flight":"...","next":"..."}'
developer-sop set <collection> <key-or-id> '{"approved":{"by":"owner","at":"2026-01-01T10:00:00Z","words":"go"}}'
developer-sop push <collection> <key-or-id> <array-field> '<json>'
developer-sop find <collection> '<filter>' [--limit n]
developer-sop id <collection> '<filter>' [--limit n]
developer-sop fields <collection>                    # required fields, allowed values, required-when rules
developer-sop chat <key> '<json>'                    # write or print a chat state
developer-sop sh | eval '<js>' | backup | restore <file> | up | down

# walkthrough: steps in order, each a Mermaid diagram plus numbered points
developer-sop step <key> <step-id> "$(jq -n --arg t "Title" --arg d "$(cat diagram.mmd)" '{title:$t, diagram:$d}')"
developer-sop point <key> <step-id> '{"text":"..."}'                                  # context, prints C07
developer-sop point <key> <step-id> '{"kind":"question","text":"...","pick":"..."}'   # prints Q14
developer-sop answer <key> Q14 '{"status":"yes|no|changed|undecided|dropped","answer":"their words"}'
developer-sop summary <key> "two lines on what the work is"
```

Before writing a row of a kind you have not written this session, run `developer-sop fields <collection>`: it reads the live schema, so it is never out of date.

Write point text with `jq --arg` or single quotes, never inside double quotes in the shell: a backtick in double quotes runs as a command and silently drops the word.

Pass `--session <id>` (from the session-start block) on writes, as two separate arguments. The store never holds a token, key, password or customer data.
