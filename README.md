# Developer SOP

A local store and a set of rules that make a coding agent write down what it decides, what it promised and what is left, so a long chat can be cleared, compacted or handed over without losing the thread.

- **The store.** MongoDB in Docker, with a schema for work items, decisions, scope, open questions, evidence, drafts and chat state.
- **The command.** `developer-sop` reads and writes the store and refuses rows that do not fit the schema.
- **The hooks.** Four Claude Code hooks print the current work item at session start, remind the agent to record decisions, and warn when a chat passes 200K tokens.
- **The page.** `http://localhost:8028` shows every work item as a walkthrough of diagrams and numbered points, and plays it as a slide show.
- **The rules.** `RULES.md` is what the agent follows. Paste it into your project's `CLAUDE.md`.

Setup is in [INSTALL.md](INSTALL.md), written so an agent can do it. Licence: [LICENSE](LICENSE).
