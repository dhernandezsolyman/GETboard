# GETboard — a link-only navigation channel

GETboard is a tiny public web app that lets a **web-reading agent with no
write/API access transmit text purely by choosing which links to follow.**
Each deliberate navigation records one keystroke; a human watches the message
appear on a clean public page.

The whole point is the constraint: the agent can only fetch URLs that already
appear on pages it has read. It never constructs a URL by hand. So every page
carries links to every valid next action, and no state is ever a dead end.

---

## The experiment

An agent that can read web pages and follow links — but cannot POST, call an
API, or type a URL from scratch — still emits *choices*. Which link it follows
is a signal. GETboard turns that signal into text:

1. The agent opens the **WRITE URL** (`/kbd/[wid]`).
2. It reads the keyboard and follows one **key** link, then the single
   **EXECUTE** link on the preview page. That records one symbol.
3. The **ACK page it lands on is the next keyboard**, showing the updated
   buffer and links for the next sequence.
4. It repeats, one symbol per two navigations, then follows **COMMIT**.
5. A human opens the **OUTPUT URL** (`/out/[rid]`) and reads the message.

The agent transmits by navigation alone. No JavaScript is required to read
state or find links.

---

## Architecture and data flow

```
link selection            the only write              read models
─────────────             ──────────────              ───────────
/kbd/[wid]/[seq]   ->  /key/.../[symbol]   ->  /execute/.../[token]
 (keyboard)            (preview + token)        (INSERT operation)
                                                       │
                                                       ▼
                                        operations table (append-only)
                                                       │
                                     replay since last COMMIT  ─────────┐
                                                       │                │
                                                       ▼                ▼
                                          /api/session/[rid]      /out/[rid]
                                             (JSON state)        (human page)
```

- **Every keystroke is one row** in `operations`, keyed by `(session_id,
  sequence)` with a unique constraint.
- **The buffer is never stored.** It is always *derived* by replaying
  operations since the last `COMMIT`. `nextSequence = max(sequence) + 1`.
- **`COMMIT`** consumes a sequence number, snapshots the current buffer into
  `commits`, and resets the working buffer. A `COMMIT` on an empty buffer still
  consumes its sequence but writes no commit record.
- The JSON and output pages simply read that derived state, so they reflect
  writes immediately.

### Why the buffer is replayed, not stored

Replaying makes the sequence the single source of truth. Duplicates and
out-of-order requests (from retries, prefetchers, or a cached page) can never
silently corrupt the text: they either match an existing operation (idempotent)
or land on a used/future sequence (a visible CONFLICT).

---

## Routes

| Route | Purpose |
|---|---|
| `/` | Create a session. Shows the WRITE, STATE, and OUTPUT URLs with copy buttons and a secrecy warning. |
| `/kbd/[wid]` | 302 redirect to `/kbd/[wid]/[currentSeq]`. |
| `/kbd/[wid]/[seq]` | Keyboard for that sequence. Stale seq → STALE + link to the current keyboard. |
| `/key/[wid]/[seq]/[symbol]` (alias `/k/…`) | Preview. **Strictly non-mutating.** Shows the proposed symbol and exactly one EXECUTE link carrying a signed token. |
| `/execute/[wid]/[seq]/[symbol]/[token]` (alias `/x/…`) | The only mutating route. SUCCESS / DUPLICATE / CONFLICT / REJECTED. |
| `/api/session/[rid]` | Read-only JSON state. Ignores any query string (cache-bust friendly). |
| `/out/[rid]` | The public, human-readable output page. |
| `/debug/[wid]?key=ADMIN_KEY` | Diagnostics: request log, operations, commits. 404 without the right key. |

### The URL protocol (what the agent does)

> Follow a key link, then follow the single EXECUTE link. The ACK page shows
> the new BUFFER and the next keyboard. Verify BUFFER after every keystroke.
> On CONFLICT or STALE, use the links provided.

**Two keyboard styles (a context-cost optimization).** The entry keyboard
(`/kbd`) and CONFLICT/STALE recovery keyboards use the strict two-hop path:
each key links to a non-mutating preview, which carries the single EXECUTE
link. **ACK keyboards** (shown after a successful keystroke) instead link
*directly* to the execute route with an inline single-use token, so a
keystroke costs **one fetch instead of two**. This is safe because an ACK page
is only ever reached *through* a one-time execute URL, so prefetchers and link
previewers never land on it; strict SAFE MODE remains on the entry keyboard.
Paths are also shortened (`/k`, `/x`) and tokens are compact (16 chars) to keep
each page small — meaningful because a keyboard repeats ~74 links per page.

Agent-facing pages start with a `<pre>` block of plain `KEY: VALUE` lines
(`STATUS`, `SEQUENCE`, `NEXT_SEQUENCE`, `BUFFER`, `LAST_SYMBOL`, …). The buffer
is shown inside quotes with newlines rendered as `⏎`, so whitespace is visible.

---

## Symbols

Letters `A–Z`, `a–z` (case-sensitive — `A` and `a` are different keys) and
digits `0–9` appear literally in the path. Everything else uses a name, never a
raw character:

```
SPACE BACKSPACE NEWLINE PERIOD COMMA QUESTION EXCLAMATION
COLON SEMICOLON DASH SLASH COMMIT
```

- letters / digits / punctuation append their character
- `SPACE` → `" "`, `NEWLINE` → `"\n"`
- `BACKSPACE` removes the last character (no-op on an empty buffer, but still
  consumes its sequence number)
- `COMMIT` snapshots and resets the buffer (see above)

Unknown symbols get an error page linking back to the current keyboard.

---

## Execute tokens (stateless, single-use by the DB)

Compact 12-byte token, base64url-encoded to **16 characters**:

```
token = base64url( uint32be(exp_seconds) || HMAC-SHA256(SERVER_SECRET, `${wid}|${seq}|${symbol}|${exp_seconds}`)[0..8] )
```

- Minted while rendering a preview page **or** an ACK keyboard — **nothing is
  stored**.
- `exp = now + 10 minutes` (stored as unix seconds).
- The HMAC is truncated to 8 bytes (64 bits): forging one still needs the
  server secret, tokens expire, and the sequence gate + unique constraint mean
  a valid signature can only ever record a single operation.
- On execute we validate the signature, the expiry, and that `wid/seq/symbol`
  match the path.
- **Single use is enforced by the database**, via `unique(session_id,
  sequence)` — not by a token table. `sha256(token)` is stored on the operation
  row for diagnostics only.

An invalid or expired token yields a REJECTED page that links to a fresh
preview (if the sequence is still current) and always to the current keyboard.

---

## Duplicate and conflict handling

Only `seq == nextSequence` is accepted, and the insert runs in a transaction.

- **SUCCESS** → ACK page (which *is* the next keyboard) with `RECORDED: TRUE`,
  the new `BUFFER`, and `NEXT_SEQUENCE`.
- **DUPLICATE** (same seq, same symbol already recorded) → the equivalent ACK
  with `DUPLICATE: TRUE`. State is unchanged. This makes retries safe.
- **CONFLICT** (seq used by a *different* symbol, or seq ≠ nextSequence) →
  a CONFLICT page with `EXPECTED_SEQUENCE`, `RECEIVED_SEQUENCE`, and the current
  keyboard. State is unchanged.
- **Concurrent** executes at the same sequence: the unique constraint lets
  exactly one win; the loser is reported as DUPLICATE or CONFLICT.

Because every agent-facing URL is versioned by sequence, a cached old page
produces STALE/CONFLICT plus recovery links — never silent corruption.

---

## Read ID vs Write ID (security)

Each session has two independent random IDs (≥128 bits, base62, non-enumerable):

- **WRITE ID (`wid`) — secret.** Grants typing. Used only in `/kbd`, `/key`,
  `/execute`.
- **READ ID (`rid`) — shareable.** Used only in `/out` and `/api`. It never
  grants write access and never reveals the `wid`. The JSON and output pages
  contain the `rid` only.

Share the READ/OUTPUT URLs freely. Treat the WRITE URL like a password.

---

## SAFE MODE, and why GET side effects are dangerous

`/execute` performs a write on a plain `GET`. That is deliberate (a link-only
agent has nothing but GETs), but it is also the classic danger: anything that
fetches a link can trigger the effect. GETboard mitigates this with what the
code calls **SAFE MODE**:

- Preview and keyboard pages are **strictly non-mutating**; only `/execute`
  (`/x`) writes, and only with a valid signed token.
- The entry keyboard uses the strict preview→execute two-hop. ACK keyboards
  carry inline execute tokens (one-hop) but are only reachable *through* a
  one-time execute URL, so depth-1 prefetchers/previewers never see them.
- All dynamic routes set `dynamic = 'force-dynamic'` and `revalidate = 0`.
- Every response sends `Cache-Control: no-store, no-cache, must-revalidate,
  max-age=0` and `X-Robots-Tag: noindex, nofollow`.
- `robots.txt` blocks general crawlers (`User-agent: * / Disallow: /`) while
  allowing user-initiated agent fetchers (`Claude-User`, `ChatGPT-User`) that
  only fetch when a human asks — the app's actual use case. Every page also
  carries `<meta name="robots" content="noindex,nofollow">`.
- Every action URL is versioned by sequence, so replaying a stale link is a
  visible CONFLICT.

**Honest limits.** SAFE MODE blocks *depth-1* prefetchers and link previewers:
they would fetch a keyboard or preview page (harmless) but not the two-hop
key → execute path. A crawler that follows links **two levels deep** *could*
fetch an execute URL and record a symbol. Tokens expire in 10 minutes and are
single-use per sequence, which bounds the blast radius, but the real protection
is **secrecy of the write ID.** Do not publish it.

---

## Caching / prefetch / crawler caveats

- Do not use client-side prefetch. This app uses raw `<a href rel="nofollow">`
  anchors, never Next.js `<Link>` (which prefetches).
- Any cached agent-facing page is safe: it is sequence-versioned, so acting on
  it yields STALE/CONFLICT with recovery links.
- The home page (`/`) creates a session on load; general crawlers are
  `Disallow`ed and every response is `no-store`, but treat a freshly loaded `/`
  as "a new session was created."
- `robots.txt` allows the user-initiated fetchers `Claude-User` and
  `ChatGPT-User` by design — without that, those agents refuse to fetch the
  pages the app is built for. Access is not the security boundary; write-ID
  secrecy is.

---

## Local setup

Requirements: Node 18+ and a Postgres database.

```bash
cp .env.example .env       # fill in the three variables below
npm install
npm run db:migrate         # applies db/schema.sql to $DATABASE_URL
npm run dev                # http://localhost:3000
```

Environment variables:

| Var | Meaning |
|---|---|
| `DATABASE_URL` | Postgres connection string (Neon: include `?sslmode=require`). |
| `SERVER_SECRET` | HMAC key for execute tokens. Use `openssl rand -hex 32`. |
| `ADMIN_KEY` | Guards `/debug/[wid]?key=…`. `/debug` 404s if unset or wrong. |

### Tests

```bash
npm test
```

The Vitest suite (`tests/getboard.test.ts`) runs the real business logic
against an in-process Postgres (PGlite). It covers session creation, every
symbol, duplicate/conflict/stale/expired/tampered handling, the strictly
non-mutating preview and keyboard, exactly-once execution, concurrent races,
COMMIT, and the read/write-ID boundary.

---

## Deploy to Vercel

1. Create a Neon Postgres database and run `db/schema.sql` against it (or
   `npm run db:migrate` locally pointed at it).
2. Import the repo into Vercel.
3. Set `DATABASE_URL`, `SERVER_SECRET`, and `ADMIN_KEY` as Environment
   Variables.
4. Deploy. All routes are `force-dynamic`, so no route is statically cached.

---

## Worked example: writing "HELLO WORLD"

Assume a session with write id `W` and read id `R`.

1. Agent opens `/kbd/W` → 302 → `/kbd/W/1`. STATUS: READY, BUFFER: `""`.
2. Follows `KEY: H` → `/key/W/1/H` (preview, BUFFER still `""`, one EXECUTE
   link with a token `t1`).
3. Follows `/execute/W/1/H/t1` → ACK: `RECORDED: TRUE`, `BUFFER: "H"`,
   `NEXT_SEQUENCE: 2`, and the keyboard for sequence 2.
4. `KEY: E` → execute → `BUFFER: "HE"`, next 3.
5. `L`, `L`, `O` → `BUFFER: "HELLO"`, next 6.
6. `KEY: SPACE` → execute → `BUFFER: "HELLO "`, next 7.
7. `W`, `O`, `R`, `L`, `D` → `BUFFER: "HELLO WORLD"`, next 12.
8. `KEY: COMMIT` → execute → the buffer resets to `""` and `"HELLO WORLD"`
   appears under **Committed messages**.

Inspect results at any time:

- JSON: `GET /api/session/R`
  ```json
  {
    "session": "R",
    "buffer": "HELLO WORLD",
    "nextSequence": 12,
    "lastOperation": { "sequence": 11, "symbol": "D", "createdAt": "..." },
    "commits": []
  }
  ```
- Human page: open `/out/R` and watch the live message (a plain refresh always
  works; it also polls the JSON every 2s as progressive enhancement).

If two requests collide, or a cached link is replayed, the agent sees
`DUPLICATE: TRUE` (safe retry) or a `CONFLICT` page with the current keyboard —
and simply continues from the links it is given.

---

## Out of scope for v1

No chunk/word mode. Base64 chunk URLs are unusable by link-only agents (they
would have to build a URL). A future **link-compatible** higher-bandwidth mode
could offer, say, a page of common words or n-gram links so each navigation
carries more than one character — always as pre-rendered links, never
hand-built URLs.

---

## Schema

See [`db/schema.sql`](db/schema.sql): `sessions`, `operations`
(with `unique(session_id, sequence)`), `commits`, and `request_log`.
