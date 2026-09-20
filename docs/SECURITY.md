# Security

## ⚠️ Credential rotation required

Two MongoDB Atlas credentials were found in the v1 working tree and **must be treated as
compromised**:

| Location | User | Status |
|---|---|---|
| `backend/config.py` (hardcoded) and `backend/.env.example` | `prometheus140925_db_user` | **Committed to source.** If that repository was ever public, this password is burned. |
| `MICROGRID/atlas-credentials.env` | `aruncdmney_db_user` | Present in the project folder. Now gitignored, but rotate it as a precaution. |

### Rotate both

1. **Atlas → Database Access → Edit user → Edit Password → Autogenerate**
2. Update `MONGODB_URI` in: your local `.env`, Vercel environment variables, and the worker host
3. Redeploy both components

Changing a password in a later commit does **not** un-expose it — anyone who cloned the
repository still has the old value from history. Rotation at the provider is the only fix.

### What was done

- Both credentials were removed from all source that will be committed.
- `backend/` and `frontend/` (the v1 implementation) are excluded from the new repository.
- `.gitignore` excludes every `.env` variant, `*credentials*`, key material and `MICROGRID/`.
- `.env.example` contains placeholders only.
- A scan of all committed source for connection strings and the specific known passwords
  returns zero matches.

---

## Design decisions

### Secrets

`server/env.ts` is the only module that reads `process.env`. Required values are validated
at startup so a misconfiguration fails immediately and loudly.

Only `VITE_*` variables reach the browser bundle, and `src/vite-env.d.ts` documents that
everything in that interface is publicly readable. `VITE_GOOGLE_CLIENT_ID` is a public
identifier by design; the client *secret* never leaves the server.

### Authentication

- Passwords hashed with bcrypt at cost 10.
- Tokens are HS256 JWTs signed with `AUTH_SECRET` (rejected if under 32 characters),
  carrying issuer and audience claims that are verified on every request.
- Login is rate limited to 10 requests/minute per client and per route.
- Unknown email and wrong password produce identical responses, and a **dummy bcrypt
  comparison runs for unknown emails** so response timing does not reveal which addresses
  are registered.
- Google ID tokens have both signature **and audience** verified server-side. Skipping the
  audience check would accept a token minted for any other Google application.

### Authorisation

Enforced server-side on every privileged route via a `permission` on the handler wrapper.
The UI hides controls a role cannot use, but that is presentation — a VIEWER POSTing
directly to `/api/alerts/:id/acknowledge` receives 403 and the denial is logged.

**Privilege-escalation fix carried from v1:** the original `/api/signup` accepted `role`
from the request body, so anyone could register as an administrator. The rewritten endpoint
never reads a role from the client. Self-registered accounts are VIEWER; elevation happens
only through a server-side env allowlist or by an existing administrator.

An administrator cannot demote themselves, which would otherwise allow locking every admin
out of the deployment with one mis-click.

### Input validation

Every write route validates its body with a zod schema and returns structured field-level
errors. Telemetry is additionally validated against physical plausibility bounds on ingest.

User-supplied search text is **regex-escaped** before reaching MongoDB — otherwise a stray
`(` is a 500 and a crafted pattern is a CPU denial-of-service.

Numeric query parameters are clamped to explicit ranges; page sizes are capped at 500
server-side regardless of what the client asks for.

### Error handling

Clients receive a stable `code` and a safe message. Stack traces, driver internals and
connection strings are logged server-side and never returned. (The v1 Flask API returned
`str(e)` directly to the client, which leaked internals.)

### Logging

`server/logger.ts` redacts any field whose name resembles a credential, at any nesting
depth, and rewrites MongoDB connection strings to strip the password before they can reach
a log line.

### Ingest endpoint

`POST /api/ingest` accepts a shared bearer token compared in **constant time**, and is
**disabled with 503 when `INGEST_TOKEN` is unset** — it fails closed rather than leaving an
unauthenticated write endpoint open to telemetry injection.

### Transport and headers

`vercel.json` sets `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and a
restrictive `Permissions-Policy`, and marks all `/api/*` responses `no-store`.

### Database

- Connection pool capped at 10 per instance to avoid exhausting the Atlas connection limit
  across many warm serverless instances.
- Unique index on `(nodeId, sequenceNumber, timestamp)` makes ingest idempotent.
- A partial unique index keeps one ACTIVE alert per (rule, node), preventing alert floods.
- TTL indexes bound telemetry, prediction and event growth.

---

## Known limitations

1. **Rate limiting is per warm serverless instance**, not global — instances do not share
   memory. It is real protection against a single client hammering one instance, but not a
   substitute for a shared store. Front it with Upstash Redis or Vercel's own rate limiting
   for strict global limits.

2. **`0.0.0.0/0` is required in the Atlas access list for Vercel**, whose serverless
   functions have dynamic egress IPs. Security then rests entirely on the credentials: use
   a strong password, restrict the user to the one database, and rotate on any exposure.

3. **No refresh-token rotation.** Tokens are valid for their full TTL (default 12 h) and
   cannot be revoked before expiry. Reduce `AUTH_TOKEN_TTL` if that matters.

4. **Seeded accounts are for local demonstration only.** They are flagged
   `mustChangePassword` and the Settings page warns about them, but the flag is not yet
   enforced as a forced password change on sign-in. Do not seed a public deployment.

5. **No audit log UI.** Role changes, alert actions and simulation commands are written to
   `system_events`, but there is no page to review them.

---

## Reporting

For a security issue in this project, contact the repository owner directly rather than
opening a public issue.
