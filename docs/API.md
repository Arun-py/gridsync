# API reference

Base URL: `/api`. All responses are JSON. Authenticated routes take
`Authorization: Bearer <token>`.

### Error format

```json
{
  "error": "Your role (VIEWER) is not permitted to perform this action.",
  "code": "FORBIDDEN",
  "details": null
}
```

| Code | Status | Meaning |
|---|---|---|
| `UNAUTHENTICATED` | 401 | No token supplied |
| `INVALID_TOKEN` | 401 | Expired or tampered token |
| `FORBIDDEN` | 403 | Role lacks the required permission |
| `VALIDATION_FAILED` | 400 | Body failed schema validation; see `details.issues` |
| `RATE_LIMITED` | 429 | Too many requests; see `Retry-After` |
| `DATABASE_UNAVAILABLE` | 503 | Cluster unreachable |
| `INTERNAL_ERROR` | 500 | Unexpected failure (details are logged, not returned) |

Error messages never contain stack traces, driver internals or connection strings.

---

## Authentication

### `POST /api/auth/login`

```json
{ "email": "operator@gridsync.local", "password": "…" }
```

```json
{
  "token": "eyJhbGciOiJIUzI1NiJ9…",
  "expiresAt": "2026-09-18T07:31:00.000Z",
  "user": {
    "id": "usr_7f3a…",
    "name": "Operator User",
    "email": "operator@gridsync.local",
    "role": "OPERATOR",
    "provider": "password",
    "createdAt": "2026-09-17T18:59:12.401Z",
    "mustChangePassword": true
  },
  "permissions": ["view:dashboard", "view:analytics", "alerts:acknowledge", "…"]
}
```

Rate limited to 10 requests/minute. Unknown email and wrong password return an identical
response, and a dummy bcrypt comparison runs for unknown emails so response timing does not
reveal which addresses are registered.

### `POST /api/auth/signup`

```json
{ "name": "Arun", "email": "arun@example.com", "password": "…" }
```

**`role` is never accepted from the client.** New accounts are VIEWER unless the address is
in a server-side allowlist. Password policy: ≥10 characters with lower, upper and digit.

### `POST /api/auth/google`

```json
{ "credential": "<Google ID token>" }
```

The ID token's signature **and audience** are verified server-side. Role is resolved from
the env allowlists, defaulting to VIEWER, and re-evaluated at every sign-in.

### `GET /api/auth/me`

Returns the current user with the role read from the **database**, not from the token — so
a role change takes effect on the next request.

---

## Nodes

### `GET /api/nodes`

```json
{
  "nodes": [
    {
      "id": "sigma",
      "name": "SIGMA Solar Node",
      "shortName": "SIGMA",
      "type": "SOLAR",
      "category": "Generation",
      "description": "Photovoltaic array with environmental monitoring…",
      "sensors": ["voltage", "current", "power", "temperature", "lux"],
      "ratedPower": 400,
      "voltageRange": [0, 24],
      "currentRange": [0, 26],
      "criticality": "CRITICAL",
      "nominalVoltage": 18
    }
  ],
  "total": 4
}
```

The frontend **discovers** nodes here. Raising `SIMULATION_NODE_COUNT` to 8 renders eight
nodes with no code change.

---

## Telemetry

### `GET /api/telemetry/latest`

The polling fallback used whenever the SSE stream is unavailable.

```json
{
  "snapshot": {
    "timestamp": "2026-09-18T07:15:03.120Z",
    "mode": "SIMULATION",
    "scenario": "NORMAL",
    "generationW": 304.31,
    "consumptionW": 118.44,
    "netPowerW": 185.87,
    "batterySoc": 71.28,
    "batteryPowerW": 168.2,
    "batteryState": "CHARGING",
    "acLoadW": 71.9,
    "dcLoadW": 46.54,
    "systemEfficiency": 0.389,
    "nodesOnline": 4,
    "nodesTotal": 4,
    "activeAlerts": { "info": 1, "warning": 2, "critical": 0 },
    "edgeMode": false
  },
  "frames": [
    {
      "nodeId": "sigma",
      "nodeType": "SOLAR",
      "timestamp": "2026-09-18T07:15:03.004Z",
      "voltage": 17.82,
      "current": 17.077,
      "power": 304.31,
      "temperature": 51.4,
      "lux": 86097,
      "status": "ONLINE",
      "mode": "SIMULATION",
      "source": "SIMULATION",
      "sequenceNumber": 4182,
      "firmwareVersion": "sim-2.0.0",
      "rssi": -53,
      "uptime": 4182,
      "valid": true,
      "efficiency": 0.968,
      "ageMs": 116
    }
  ],
  "mode": "SIMULATION",
  "scenario": "NORMAL",
  "serverTime": "2026-09-18T07:15:03.120Z"
}
```

`status` is derived from the frame's **age**, not from what it claimed when written — a node
that stopped reporting an hour ago is never `ONLINE`. Stale and invalid frames are excluded
from the snapshot totals.

### `GET /api/telemetry/history?nodeId=sigma&range=24H&maxPoints=300`

`range` ∈ `1H` `6H` `24H` `7D` `30D`.

Down-sampling happens in MongoDB. A 30-day window at 1 Hz is ~2.6 M documents; at most
`maxPoints` evenly-spaced samples cross the wire.

```json
{
  "nodeId": "sigma",
  "range": "24H",
  "from": "2026-09-17T07:15:00.000Z",
  "to": "2026-09-18T07:15:00.000Z",
  "points": 300,
  "series": [
    { "timestamp": "2026-09-17T07:20:00.000Z", "voltage": 15.9, "current": 6.1,
      "power": 97.0, "temperature": 34.2, "lux": 26500, "valid": true }
  ]
}
```

Invalid frames are returned **flagged** rather than removed, so a chart can show the gap
instead of interpolating over a sensor fault.

---

## Alerts

### `GET /api/alerts`

Query: `status` `severity` `nodeId` `search` `since` `until` `page` `pageSize`.

```json
{
  "items": [
    {
      "id": "alrt_SOLAR_LOW_YIELD_sigma_1758134103000",
      "ruleId": "SOLAR_LOW_YIELD",
      "nodeId": "sigma",
      "timestamp": "2026-09-18T07:15:03.000Z",
      "severity": "WARNING",
      "source": "RULE",
      "kind": "DETECTED",
      "condition": "Generation below irradiance expectation",
      "actualValue": 19,
      "expectedValue": 75,
      "unit": "%",
      "message": "SIGMA is delivering 59.1 W against a modelled expectation of 313.6 W at 86097 lx.",
      "likelyCause": "Irradiance is adequate but yield is not, which is consistent with panel soiling, partial shading, or a degraded string connection. This is an inference from the power/irradiance relationship, not a confirmed physical inspection.",
      "recommendedAction": "Inspect the panel surface for dust or soiling, check for new shading obstructions, and verify string wiring and connector integrity.",
      "status": "ACTIVE"
    }
  ],
  "total": 12,
  "page": 1,
  "pageSize": 25,
  "hasMore": false,
  "counts": { "info": 1, "warning": 2, "critical": 0, "total": 3 }
}
```

`kind` is `DETECTED` for rule findings and `PREDICTED` for model output. The UI renders
them differently and never conflates them.

Search input is regex-escaped before reaching MongoDB.

### `POST /api/alerts/:id/acknowledge` — requires `alerts:acknowledge`
### `POST /api/alerts/:id/resolve` — requires `alerts:resolve`

A VIEWER calling either directly receives:

```json
{ "error": "Your role (VIEWER) is not permitted to perform this action.", "code": "FORBIDDEN" }
```

---

## Predictions

### `GET /api/predictions?limit=50`

```json
{
  "latest": [
    {
      "id": "pred_sigma_1758134103000",
      "nodeId": "sigma",
      "timestamp": "2026-09-18T07:15:03.000Z",
      "predictedClass": "SOLAR_SHADING",
      "confidence": 0.7742,
      "classProbabilities": { "NORMAL": 0.1103, "SOLAR_SHADING": 0.7742, "SOLAR_SOILING": 0.0904 },
      "contributingFeatures": [
        { "feature": "Temperature", "value": 51.4, "importance": 0.1377 },
        { "feature": "State of charge", "value": 71.28, "importance": 0.1216 }
      ],
      "explanation": "Irradiance is adequate while current and yield are reduced, and the reduction pattern resembles partial shading in the training data.",
      "recommendedAction": "Inspect the array for new shading from vegetation or structures at the current sun angle.",
      "modelVersion": "v6",
      "trainedOnSyntheticData": true
    }
  ],
  "model": {
    "available": true,
    "version": "v6",
    "algorithm": "RandomForestClassifier (scikit-learn)",
    "trainedOnSyntheticData": true,
    "error": null,
    "classes": ["ABNORMAL_CONSUMPTION", "BATTERY_FAULT", "…"]
  },
  "metrics": {
    "available": true,
    "accuracy": 0.8707,
    "macroPrecision": 0.8238,
    "macroRecall": 0.8771,
    "macroF1": 0.8255,
    "trainSize": 92228,
    "validationSize": 27623,
    "testSize": 29617,
    "perClass": {
      "BATTERY_OVERHEAT": { "precision": 1.0, "recall": 1.0, "f1": 1.0, "support": 780 },
      "COMMUNICATION_FAULT": { "precision": 0.248, "recall": 0.459, "f1": 0.322, "support": 824 }
    },
    "insufficientDataNote": null,
    "notes": ["Model trained on SYNTHETIC telemetry generated by GridSync's own physics simulator. …"]
  }
}
```

**Every metric here is read from `ml/models/metrics.json`**, written by the evaluation
pipeline. Nothing is hardcoded. When the pipeline judges a class's held-out support too
small, its metrics are `null` with a `note`, and the UI shows the note instead of a number.

When no model exists, `model.available` is `false` with a reason — no prediction is
invented to fill the gap.

---

## Analytics

### `GET /api/analytics?range=24H` — requires `view:analytics`

Returns time-bucketed aggregates computed in MongoDB, totals, alert and anomaly frequency,
and per-node performance. At most a few hundred buckets regardless of range.

```json
{
  "range": "24H",
  "bucketMs": 900000,
  "buckets": [
    { "timestamp": "2026-09-18T06:00:00.000Z", "generationW": 212.4, "consumptionW": 96.1,
      "acLoadW": 58.3, "dcLoadW": 37.8, "batterySoc": 68.2, "netPowerW": 116.3, "efficiency": 0.452 }
  ],
  "totals": {
    "generatedKwh": 2.187, "consumedKwh": 1.642, "lossesKwh": 0.545,
    "peakDemandW": 214.8, "averageEfficiency": 0.61
  },
  "nodePerformance": [
    { "nodeId": "sigma", "name": "SIGMA", "energyKwh": 2.187, "availability": 1.0 }
  ],
  "dataSource": "SIMULATION"
}
```

---

## System health

### `GET /api/system-health`

```json
{
  "timestamp": "2026-09-18T07:15:03.000Z",
  "components": [
    { "id": "mongodb", "name": "MongoDB Atlas", "status": "ONLINE",
      "detail": "Cluster responded to ping in 412 ms", "latencyMs": 412 },
    { "id": "raspberry_pi", "name": "Raspberry Pi 5 Edge Node", "status": "SIMULATED",
      "detail": "Hardware integration UNDER DEVELOPMENT. No physical edge device is connected." }
  ],
  "edgeMode": false,
  "internetReachable": true,
  "edgeOperational": true,
  "network": { "packetLossPercent": 0, "averageLatencyMs": 118, "duplicatePackets": 0, "staleNodes": [] }
}
```

`internetReachable` and `edgeOperational` are **separate** because they are different
failures: a snapped uplink with a healthy edge means collection continues and the UI shows
`EDGE MODE ACTIVE`; a dead edge means collection has stopped.

Components are `SIMULATED` where the hardware does not exist — never `ONLINE` on the basis
of hope.

---

## Simulation control

### `GET /api/simulation/state`

Returns the worker's state, whether it is responsive, the scenario catalogue and the
configuration limits.

### `POST /api/simulation/control` — requires `simulation:control`

```json
{ "action": "SET_SCENARIO", "scenario": "SOLAR_FAULT" }
```

Actions: `START` `STOP` `RESTART` `SET_SCENARIO` `SET_INTERVAL` `SET_SPEED` `SET_NODE_COUNT`.

```json
{
  "queued": true,
  "action": "SET_SCENARIO",
  "note": "Command queued for the worker. It is normally applied within 2 seconds."
}
```

The API cannot call the worker directly (different hosts, no inbound path), so commands are
written to MongoDB and polled by the worker every 2 s. The response says so rather than
implying the change already took effect.

---

## Ingest — the hardware path

### `POST /api/ingest`

Header: `Authorization: Bearer <INGEST_TOKEN>`

```json
{
  "frames": [
    { "nodeId": "sigma", "nodeType": "SOLAR", "voltage": 17.8, "current": 17.1,
      "power": 304.4, "temperature": 51.2, "lux": 86000, "sequenceNumber": 10432,
      "timestamp": "2026-09-18T07:15:02.000Z", "firmwareVersion": "1.4.2",
      "rssi": -61, "uptime": 86400, "source": "ESP32" }
  ]
}
```

```json
{ "received": 4, "inserted": 4, "duplicates": 0, "invalid": 0, "rejected": [] }
```

- Batched: up to 500 frames per request.
- Tokens are compared in **constant time**.
- **Disabled (503) when `INGEST_TOKEN` is unset** — it fails closed rather than leaving an
  unauthenticated write endpoint open.
- `duplicates > 0` means the unique index rejected a retransmission. That is idempotency
  working, not an error.
- Invalid frames are **stored and flagged**, not dropped — a sensor fault must be visible.

---

## Health

### `GET /api/health` — public

```json
{
  "status": "healthy",
  "timestamp": "2026-09-18T07:15:03.000Z",
  "checks": { "api": "ok", "database": "ok", "mlModel": "loaded" }
}
```

Returns 503 when the database is unreachable. Deliberately reveals nothing beyond
component reachability — no versions, hostnames or configuration.

---

## Realtime stream

### `GET /api/stream` — served by the worker, not Vercel

Server-Sent Events. Events: `telemetry`, `alerts`, `predictions`. A comment heartbeat every
20 s keeps proxies from closing the connection.

```
event: telemetry
data: {"snapshot":{…},"frames":[…],"health":{…}}
```

The browser falls back to polling automatically if the stream is unreachable or stops
delivering for 15 s.
