# Deployment

GridSync deploys as **two independent components** that share one database.

| Component | Platform | Why there |
|---|---|---|
| React SPA + `api/**` | Vercel | Static assets and short-lived request handlers |
| Simulator / worker | Render, Railway, Fly.io, VPS, Raspberry Pi, or a laptop | Needs a process that stays alive |
| Database | MongoDB Atlas | Shared by both |

**A Vercel serverless function must not be used as a permanently running simulator.** It is
invoked, runs, and is frozen — it cannot hold a 1 Hz timer, cannot keep per-node rolling
history between ticks, and cannot hold an MQTT subscription open.

---

## 1. MongoDB Atlas

1. Create a cluster (the free M0 tier is sufficient for a demonstration).
2. **Database Access** → create a user with `readWrite` on the `gridsync` database.
3. **Network Access** → add IP addresses:
   - your own IP, for local development
   - **`0.0.0.0/0`** — required for Vercel, whose serverless functions have dynamic
     egress IPs

   > Without this, connections fail during the TLS handshake with
   > `tlsv1 alert internal error` **before** authentication is attempted. The credentials
   > are not the problem when you see that error.
   >
   > `0.0.0.0/0` means security rests entirely on the credentials. Use a strong password,
   > rotate it if it is ever exposed, and restrict the user to the one database.

4. Copy the connection string into `MONGODB_URI`.

Then, locally:

```bash
npm run indexes
```
```bash
npm run seed
```

---

## 2. Vercel — web app and API

### Via the dashboard

1. Import the GitHub repository.
2. Framework preset: **Vite** (auto-detected). The included `vercel.json` sets the build
   command, output directory and function runtime.
3. Add environment variables under **Settings → Environment Variables**:

   | Variable | Value |
   |---|---|
   | `MONGODB_URI` | your Atlas string |
   | `MONGODB_DB_NAME` | `gridsync` |
   | `AUTH_SECRET` | a fresh 48-byte random string |
   | `AUTH_TOKEN_TTL` | `12h` |
   | `INGEST_TOKEN` | a fresh random string (must match the worker) |
   | `GOOGLE_CLIENT_ID` | optional |
   | `GOOGLE_CLIENT_SECRET` | optional |
   | `VITE_GOOGLE_CLIENT_ID` | same as `GOOGLE_CLIENT_ID` |
   | `GOOGLE_REDIRECT_URI` | `https://<your-app>.vercel.app/auth/google/callback` |
   | `ADMIN_EMAILS` | comma-separated |
   | `VITE_STREAM_URL` | `https://<worker-host>/api/stream` (optional) |

   Generate secrets with:

   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```

4. Deploy.

### Via the CLI

```bash
npx vercel --prod
```

### What Vercel serves

- `dist/` — the built React SPA
- `api/**/*.ts` — one serverless function per file, Node runtime, 512 MB, 30 s max

`VITE_*` variables are **compiled into the browser bundle** and are publicly readable.
Never put a secret in one. `VITE_GOOGLE_CLIENT_ID` is a public identifier by design; the
client *secret* stays server-side.

---

## 3. Worker — the persistent simulator

### Render (recommended)

A `render.yaml` is included. In the Render dashboard: **New → Blueprint**, point at the
repository, then set the environment variables Render marks as required:

| Variable | Value |
|---|---|
| `MONGODB_URI` | same Atlas string |
| `AUTH_SECRET` | same as Vercel |
| `INGEST_TOKEN` | same as Vercel |
| `GRIDSYNC_SOURCE` | `simulation` |
| `SIMULATION_INTERVAL_MS` | `1000` |
| `SIMULATION_SPEED` | `60` |
| `SIMULATION_NODE_COUNT` | `4` |

> **Render's free tier sleeps after inactivity.** A sleeping worker stops producing
> telemetry, nodes correctly age to STALE and then OFFLINE, and the dashboard shows the
> degraded state honestly. For a continuous demo use a paid instance or run the worker
> locally.

### Any VPS or Raspberry Pi

```bash
git clone https://github.com/Arun-py/gridsync.git && cd gridsync
```
```bash
npm ci && cp .env.example .env
```

Edit `.env`, then run it under a process manager:

```bash
npx pm2 start "npm run worker" --name gridsync-worker
```

Or as a systemd unit — `/etc/systemd/system/gridsync-worker.service`:

```ini
[Unit]
Description=GridSync telemetry worker
After=network-online.target

[Service]
Type=simple
User=gridsync
WorkingDirectory=/opt/gridsync
ExecStart=/usr/bin/npm run worker
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now gridsync-worker
```

### Locally, for a demo

```bash
npm run worker
```

This is a perfectly legitimate deployment for a presentation: the worker writes to the same
Atlas cluster the deployed site reads from, so the live site shows your local simulator's
telemetry.

---

## 4. Connecting the live stream (optional)

Without `VITE_STREAM_URL` the browser polls `GET /api/telemetry/latest` every 2 s. That
always works and needs no extra configuration.

To get lower latency, expose the worker's SSE endpoint over HTTPS and set:

```
VITE_STREAM_URL=https://<worker-host>/api/stream
```

The frontend automatically falls back to polling if the stream is unreachable or stops
delivering, so a misconfigured URL degrades gracefully rather than freezing the dashboard.

---

## 5. Post-deployment checklist

- [ ] `GET /api/health` returns `{"status":"healthy"}`
- [ ] Sign-in works with a seeded account
- [ ] Overview shows changing values
- [ ] `npm run healthcheck` passes locally against the same cluster
- [ ] Demo Control changes the scenario and the dashboard reacts within ~2 s
- [ ] Alert Center populates
- [ ] AI page shows the model version and its synthetic-data warning
- [ ] Bill Calculator produces an estimate and exports a watermarked PDF
- [ ] A Viewer account cannot acknowledge an alert (403, not merely a hidden button)
- [ ] No `.env` file is present in the repository

---

## 6. Rotating a compromised credential

If a database password is ever committed or exposed:

1. **Atlas → Database Access → Edit user → Edit Password → Autogenerate.**
2. Update `MONGODB_URI` in Vercel, in the worker host, and in your local `.env`.
3. Redeploy both components.
4. Consider whether the history needs purging — a password in a public commit is
   compromised even after it is changed in a later commit.

---

## 7. Migrating to real hardware

1. Deploy the worker onto the Raspberry Pi 5 at the site.
2. Run an MQTT broker there (Mosquitto is sufficient).
3. Set on the Pi:

   ```
   GRIDSYNC_SOURCE=mqtt
   MQTT_URL=mqtt://localhost:1883
   ```

4. Flash the ESP32 nodes to publish to `gridsync/<nodeId>` with the payload documented in
   `worker/sources/mqtt.ts`.
5. Restart the worker.

Nothing else changes. Vercel, the API, the rule engine, the ML layer and every page consume
`TelemetryFrame` and cannot tell simulated frames from real ones — which is exactly the
property the architecture was built for.

If the Pi can reach HTTPS but you would rather not expose a broker, devices can
`POST /api/ingest` with the `INGEST_TOKEN` bearer instead.
