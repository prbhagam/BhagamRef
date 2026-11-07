# BhagamRef

A digital match anomaly log for VEX V5 Robotics Competition referees. It works on phones and iPads.

- **Accounts.** Signed-in users create and keep competition sessions.
- **Competition sessions.** A session covers one day of an event pulled from events.vex.com. Each session gets a 6-character join code. Guests join with the code and a name, and need no account.
- **Matches.** The match schedule comes from events.vex.com and refreshes every 30 seconds. For multi-division events you pick the division. You can also add a match by hand if the schedule isn't published yet.
- **Violations.** On any team in a match, tap **+ Minor** or **+ Major**. Pick the rule from the Override v2.1 game manual (code and title, grouped by category, searchable) and add an optional comment.
- **History.** Each team card in a match shows the team's violations for the day: this match, earlier matches, and repeated rules (e.g. `GG14 ×3`). The Teams tab and Log tab show the same data by team and as a timeline.
- **Live sync.** Every participant's screen updates instantly through Server-Sent Events.
- **Offline.** Calls logged without a connection are queued on the device and sent automatically when it reconnects.
- **CSV export** of the whole session.

## Running it

```bash
npm install
npm start            # http://localhost:3000
```

The server reads the events.vex.com API token from `VEX_API_TOKEN` or from `token.txt` in the project root. The token stays on the server. The browser only talks to BhagamRef's own `/api` endpoints, which proxy and cache the VEX API.

| Env var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `VEX_API_TOKEN` | contents of `token.txt` | events.vex.com bearer token |
| `DATA_DIR` | `./data` | Where the SQLite database lives |

## Deploying

- Run it as **one instance** with a **persistent disk** for `DATA_DIR`. Live sync is in-memory, so all refs in a session must hit the same process. Fly.io, Render or Railway with a volume, or any small VPS, work fine.
- Put it behind **HTTPS**. Cookies get the `Secure` flag automatically when the request arrives over HTTPS (it honors `X-Forwarded-Proto`).
- On iPhone/iPad, use Share → **Add to Home Screen** for a full-screen, app-like experience.

## How it's built

- `server.js`: Express 5 + better-sqlite3. It handles accounts (scrypt password hashes, HTTP-only cookie tokens), sessions, participants, violations, and manual matches. It also runs the SSE broadcast and the cached VEX API proxy.
- `public/`: a no-build vanilla JS single-page app (`app.js`, `styles.css`).
- `public/rules.json`: the rule list from the [Override v2.1 game manual](https://manuals.vex.com/v5/override/v2.1/game/), with 101 rules across SG, GG, S, G, SC, R, and T. When VEX publishes a manual update, edit this file. The server validates rule codes against it.

### Permissions

- Anyone in a session can log violations and edit any violation.
- A violation can be deleted by the person who logged it or by the session owner.
- Only the owner can rename, archive, or delete the session.
