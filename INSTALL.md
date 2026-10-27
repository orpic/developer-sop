# Install (for an agent)

Run each step in order. Do the check after it. Stop at the first check that fails and report the output.

1. **Needs.** Docker with Compose v2, Node.js 20 or newer, `curl`, free local ports 27027, 8027 and 8028.
   - Check: `docker compose version && node -v` prints versions, and `lsof -i :8028` prints nothing.
2. **Configure.** Copy `.env.example` to `.env` and ask the user for `OWNER_NAME` (their first name). `REPO_URL` (their project on GitHub, no trailing slash) and `LOCAL_REPO` (its absolute path) are optional; leave them empty if the user has no preference.
   - Check: `.env` exists and has no line the user did not choose.
3. **Run the installer.** `./install.sh`
   - It installs the command's packages, starts the three containers, waits for the page, and adds four hook entries to `~/.claude/settings.json` (backup: `settings.json.before-developer-sop`). Entries already there are left alone.
   - Check: it ends with `page:     http://localhost:8028`, and `curl -s -o /dev/null -w '%{http_code}' http://localhost:8028` prints `200`.
4. **Put the command on the PATH.** `ln -s "$PWD/bin/developer-sop" /usr/local/bin/developer-sop` (this may need `sudo`; if it does, ask the user to run it).
   - Check: `developer-sop list` prints without an error.
5. **Add the rules.** Append the contents of `RULES.md` to the project's `CLAUDE.md` (or `CLAUDE.local.md` to keep it private).
   - Check: the file now contains the heading `# Development SOPs`.
6. **Try it.** `developer-sop put work '{"key":"first","title":"First work item","kind":"chore","status":"active","goal":"try the store","branches":[]}'` then `developer-sop show first`.
   - Check: `show` prints `Current work: first`.
7. **Restart Claude Code** so it reads the hooks. In a new session the start-of-session block shows the work item.

Run `./install.sh` again at any time: it reports `nothing to change: already installed` when everything is in place.

## Upgrading an older store

Only for a store written before the owner became a setting (the stored name was a person's first name):

```bash
node tools/migrate-owner-role.mjs --old <that name>            # dry run
node tools/migrate-owner-role.mjs --old <that name> --apply
docker exec -i developer-sop-mongo mongosh --quiet < init/01-collections.js
```
