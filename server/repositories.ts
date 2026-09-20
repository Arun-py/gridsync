/**
 * Data access.
 *
 * All Mongo queries live here so the API routes stay thin and every query is
 * reviewable in one place. Two rules are enforced throughout:
 *
 *   1. ALWAYS bound the result set. Telemetry grows by nodeCount rows per
 *      second; an unbounded find() would eventually ship megabytes to a phone.
 *   2. ALWAYS query a time window backed by an index (see scripts/ensure-indexes.ts).
 */

import type { Filter } from 'mongodb';

import { COLLECTIONS } from '../shared/constants';
import type {
  Alert,
  AlertStatus,
  AnalyticsBucket,
  Prediction,
  Severity,
  TelemetryFrame,
  TimeRange,
  UsageRecord,
  User,
} from '../shared/types';
import { collection } from './db';
import { errorFields, logger } from './logger';

const log = logger('repo');

/** Hard ceiling on rows returned to a client, whatever it asks for. */
const MAX_PAGE_SIZE = 500;

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

export const telemetryRepo = {
  /**
   * Bulk-insert frames, tolerating duplicates.
   *
   * The unique (nodeId, sequenceNumber) index makes ingest idempotent: a
   * retransmitted frame is rejected by the index rather than stored twice.
   * `ordered: false` lets the rest of the batch succeed around it.
   */
  async insertMany(frames: TelemetryFrame[]): Promise<number> {
    if (frames.length === 0) return 0;
    const col = await collection<TelemetryFrame>(COLLECTIONS.telemetry);
    try {
      const result = await col.insertMany(
        frames.map((f) => ({ ...f, timestamp: new Date(f.timestamp) as unknown as string })),
        { ordered: false },
      );
      return result.insertedCount;
    } catch (err) {
      // Duplicate-key errors are expected and benign; anything else is not.
      const e = err as { code?: number; result?: { nInserted?: number } };
      if (e.code === 11000) return e.result?.nInserted ?? 0;
      throw err;
    }
  },

  /** Most recent frame per node. Backed by nodeId_1_timestamp_-1. */
  async latestPerNode(nodeIds: string[]): Promise<TelemetryFrame[]> {
    const col = await collection<TelemetryFrame>(COLLECTIONS.telemetry);
    const results = await Promise.all(
      nodeIds.map((nodeId) =>
        col.find({ nodeId } as Filter<TelemetryFrame>).sort({ timestamp: -1 }).limit(1).toArray(),
      ),
    );
    return results.flat().map(normaliseTimestamps);
  },

  /**
   * History for one node over a window.
   *
   * `maxPoints` down-samples server-side by striding: a 30-day window at 1 Hz
   * is 2.6 M documents, and no chart needs more than a few hundred points.
   */
  async history(
    nodeId: string,
    since: Date,
    until: Date,
    maxPoints = 300,
  ): Promise<TelemetryFrame[]> {
    const col = await collection<TelemetryFrame>(COLLECTIONS.telemetry);
    const filter = { nodeId, timestamp: { $gte: since, $lte: until } } as unknown as Filter<TelemetryFrame>;

    const total = await col.countDocuments(filter, { limit: 100_000 });
    if (total === 0) return [];

    const stride = Math.max(1, Math.ceil(total / maxPoints));

    // $sample would be random and produce a jagged chart; a modulo stride on a
    // monotonic counter keeps points evenly spaced in time.
    const docs = await col
      .aggregate<TelemetryFrame>([
        { $match: filter },
        { $sort: { timestamp: 1 } },
        { $group: { _id: null, docs: { $push: '$$ROOT' } } },
        {
          $project: {
            docs: {
              $filter: {
                input: { $range: [0, { $size: '$docs' }] },
                cond: { $eq: [{ $mod: ['$$this', stride] }, 0] },
              },
            },
            all: '$docs',
          },
        },
        { $project: { docs: { $map: { input: '$docs', in: { $arrayElemAt: ['$all', '$$this'] } } } } },
        { $unwind: '$docs' },
        { $replaceRoot: { newRoot: '$docs' } },
        { $limit: maxPoints },
      ])
      .toArray();

    return docs.map(normaliseTimestamps);
  },

  /** All frames in a window across all nodes, for analytics aggregation. */
  async window(since: Date, until: Date, limit = 20_000): Promise<TelemetryFrame[]> {
    const col = await collection<TelemetryFrame>(COLLECTIONS.telemetry);
    const docs = await col
      .find({ timestamp: { $gte: since, $lte: until } } as unknown as Filter<TelemetryFrame>)
      .sort({ timestamp: 1 })
      .limit(limit)
      .toArray();
    return docs.map(normaliseTimestamps);
  },

  /**
   * Time-bucketed aggregation for the analytics page.
   *
   * Aggregating in Mongo rather than in the browser is the difference between
   * transferring a few kilobytes and a few megabytes.
   */
  async aggregate(since: Date, until: Date, bucketMs: number): Promise<AnalyticsBucket[]> {
    const col = await collection<TelemetryFrame>(COLLECTIONS.telemetry);

    const docs = await col
      .aggregate<{
        _id: number;
        generationW: number;
        acLoadW: number;
        dcLoadW: number;
        batterySoc: number | null;
      }>([
        {
          $match: {
            timestamp: { $gte: since, $lte: until },
            valid: { $ne: false },
          },
        },
        {
          $group: {
            // Floor each document's epoch millis to its bucket.
            _id: {
              $subtract: [
                { $toLong: '$timestamp' },
                { $mod: [{ $toLong: '$timestamp' }, bucketMs] },
              ],
            },
            generationW: {
              $avg: { $cond: [{ $eq: ['$nodeType', 'SOLAR'] }, '$power', null] },
            },
            acLoadW: {
              $avg: { $cond: [{ $eq: ['$nodeType', 'AC_LOAD'] }, '$power', null] },
            },
            dcLoadW: {
              $avg: { $cond: [{ $eq: ['$nodeType', 'DC_LOAD'] }, '$power', null] },
            },
            batterySoc: {
              $avg: { $cond: [{ $eq: ['$nodeType', 'BATTERY'] }, '$soc', null] },
            },
          },
        },
        { $sort: { _id: 1 } },
        { $limit: 1000 },
      ])
      .toArray();

    return docs.map((d) => {
      const generationW = round2(d.generationW ?? 0);
      const acLoadW = round2(d.acLoadW ?? 0);
      const dcLoadW = round2(d.dcLoadW ?? 0);
      const consumptionW = round2(acLoadW + dcLoadW);
      return {
        timestamp: new Date(d._id).toISOString(),
        generationW,
        consumptionW,
        acLoadW,
        dcLoadW,
        batterySoc: d.batterySoc === null ? null : round2(d.batterySoc),
        netPowerW: round2(generationW - consumptionW),
        efficiency: generationW > 0 ? round3(Math.min(1, consumptionW / generationW)) : null,
      };
    });
  },

  async countSince(since: Date): Promise<number> {
    const col = await collection<TelemetryFrame>(COLLECTIONS.telemetry);
    return col.countDocuments({ timestamp: { $gte: since } } as unknown as Filter<TelemetryFrame>);
  },
};

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export const alertRepo = {
  /**
   * Insert alerts, suppressing repeats of a condition that is already ACTIVE.
   *
   * The partial unique index on (ruleId, nodeId) where status = ACTIVE does the
   * enforcing; duplicate-key errors here mean "already raised", not a failure.
   */
  async insertMany(alerts: Alert[]): Promise<number> {
    if (alerts.length === 0) return 0;
    const col = await collection<Alert>(COLLECTIONS.alerts);
    let inserted = 0;
    for (const alert of alerts) {
      try {
        await col.insertOne({ ...alert, timestamp: new Date(alert.timestamp) as unknown as string });
        inserted++;
      } catch (err) {
        const e = err as { code?: number };
        if (e.code !== 11000) {
          log.warn('Alert insert failed', { ruleId: alert.ruleId, ...errorFields(err) });
        }
      }
    }
    return inserted;
  },

  async list(options: {
    status?: AlertStatus | 'all';
    severity?: Severity;
    nodeId?: string;
    since?: Date;
    until?: Date;
    search?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{ items: Alert[]; total: number }> {
    const col = await collection<Alert>(COLLECTIONS.alerts);
    const filter: Record<string, unknown> = {};

    if (options.status && options.status !== 'all') filter.status = options.status;
    if (options.severity) filter.severity = options.severity;
    if (options.nodeId) filter.nodeId = options.nodeId;
    if (options.since || options.until) {
      const range: Record<string, Date> = {};
      if (options.since) range.$gte = options.since;
      if (options.until) range.$lte = options.until;
      filter.timestamp = range;
    }
    if (options.search) {
      // Escape the user's input before it reaches a regex, or a stray "(" is a
      // 500 and a crafted pattern is a CPU denial-of-service.
      const safe = options.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { message: { $regex: safe, $options: 'i' } },
        { condition: { $regex: safe, $options: 'i' } },
        { likelyCause: { $regex: safe, $options: 'i' } },
      ];
    }

    const pageSize = Math.min(options.pageSize ?? 50, MAX_PAGE_SIZE);
    const page = Math.max(1, options.page ?? 1);

    const [items, total] = await Promise.all([
      col
        .find(filter as Filter<Alert>)
        .sort({ timestamp: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .toArray(),
      col.countDocuments(filter as Filter<Alert>),
    ]);

    return { items: items.map(normaliseTimestamps), total };
  },

  async counts(): Promise<{ info: number; warning: number; critical: number; total: number }> {
    const col = await collection<Alert>(COLLECTIONS.alerts);
    const rows = await col
      .aggregate<{ _id: Severity; count: number }>([
        { $match: { status: 'ACTIVE' } },
        { $group: { _id: '$severity', count: { $sum: 1 } } },
      ])
      .toArray();

    const out = { info: 0, warning: 0, critical: 0, total: 0 };
    for (const r of rows) {
      if (r._id === 'INFO') out.info = r.count;
      else if (r._id === 'WARNING') out.warning = r.count;
      else if (r._id === 'CRITICAL') out.critical = r.count;
    }
    out.total = out.info + out.warning + out.critical;
    return out;
  },

  async setStatus(
    alertId: string,
    status: AlertStatus,
    userEmail: string,
  ): Promise<Alert | null> {
    const col = await collection<Alert>(COLLECTIONS.alerts);
    const now = new Date().toISOString();
    const update: Record<string, unknown> = { status };
    if (status === 'ACKNOWLEDGED') {
      update.acknowledgedBy = userEmail;
      update.acknowledgedAt = now;
    } else if (status === 'RESOLVED') {
      update.resolvedBy = userEmail;
      update.resolvedAt = now;
    }

    const result = await col.findOneAndUpdate(
      { id: alertId } as Filter<Alert>,
      { $set: update },
      { returnDocument: 'after' },
    );
    return result ? normaliseTimestamps(result) : null;
  },

  /** Alert counts per bucket, for the analytics page. */
  async frequency(since: Date, until: Date, bucketMs: number) {
    const col = await collection<Alert>(COLLECTIONS.alerts);
    return col
      .aggregate<{ _id: number; info: number; warning: number; critical: number }>([
        { $match: { timestamp: { $gte: since, $lte: until } } },
        {
          $group: {
            _id: {
              $subtract: [{ $toLong: '$timestamp' }, { $mod: [{ $toLong: '$timestamp' }, bucketMs] }],
            },
            info: { $sum: { $cond: [{ $eq: ['$severity', 'INFO'] }, 1, 0] } },
            warning: { $sum: { $cond: [{ $eq: ['$severity', 'WARNING'] }, 1, 0] } },
            critical: { $sum: { $cond: [{ $eq: ['$severity', 'CRITICAL'] }, 1, 0] } },
          },
        },
        { $sort: { _id: 1 } },
        { $limit: 500 },
      ])
      .toArray();
  },
};

// ---------------------------------------------------------------------------
// Predictions
// ---------------------------------------------------------------------------

export const predictionRepo = {
  async insertMany(predictions: Prediction[]): Promise<number> {
    if (predictions.length === 0) return 0;
    const col = await collection<Prediction>(COLLECTIONS.predictions);
    const result = await col.insertMany(
      predictions.map((p) => ({ ...p, timestamp: new Date(p.timestamp) as unknown as string })),
      { ordered: false },
    );
    return result.insertedCount;
  },

  async latestPerNode(nodeIds: string[]): Promise<Prediction[]> {
    const col = await collection<Prediction>(COLLECTIONS.predictions);
    const results = await Promise.all(
      nodeIds.map((nodeId) =>
        col.find({ nodeId } as Filter<Prediction>).sort({ timestamp: -1 }).limit(1).toArray(),
      ),
    );
    return results.flat().map(normaliseTimestamps);
  },

  async recent(limit = 50): Promise<Prediction[]> {
    const col = await collection<Prediction>(COLLECTIONS.predictions);
    const docs = await col
      .find({})
      .sort({ timestamp: -1 })
      .limit(Math.min(limit, MAX_PAGE_SIZE))
      .toArray();
    return docs.map(normaliseTimestamps);
  },

  /** Non-NORMAL predictions per bucket, for the anomaly-frequency chart. */
  async anomalyFrequency(since: Date, until: Date, bucketMs: number) {
    const col = await collection<Prediction>(COLLECTIONS.predictions);
    return col
      .aggregate<{ _id: number; count: number }>([
        {
          $match: {
            timestamp: { $gte: since, $lte: until },
            predictedClass: { $ne: 'NORMAL' },
          },
        },
        {
          $group: {
            _id: {
              $subtract: [{ $toLong: '$timestamp' }, { $mod: [{ $toLong: '$timestamp' }, bucketMs] }],
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
        { $limit: 500 },
      ])
      .toArray();
  },
};

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export interface UserDocument extends User {
  passwordHash?: string;
}

export const userRepo = {
  async findByEmail(email: string): Promise<UserDocument | null> {
    const col = await collection<UserDocument>(COLLECTIONS.users);
    return col.findOne({ email: email.toLowerCase().trim() } as Filter<UserDocument>);
  },

  async findById(id: string): Promise<UserDocument | null> {
    const col = await collection<UserDocument>(COLLECTIONS.users);
    return col.findOne({ id } as Filter<UserDocument>);
  },

  async create(user: UserDocument): Promise<UserDocument> {
    const col = await collection<UserDocument>(COLLECTIONS.users);
    await col.insertOne({ ...user, email: user.email.toLowerCase().trim() });
    return user;
  },

  async upsertByEmail(user: UserDocument): Promise<UserDocument> {
    const col = await collection<UserDocument>(COLLECTIONS.users);
    const email = user.email.toLowerCase().trim();
    await col.updateOne(
      { email } as Filter<UserDocument>,
      { $set: { ...user, email }, $setOnInsert: { createdAt: new Date().toISOString() } },
      { upsert: true },
    );
    const found = await col.findOne({ email } as Filter<UserDocument>);
    return found ?? user;
  },

  async list(): Promise<User[]> {
    const col = await collection<UserDocument>(COLLECTIONS.users);
    const docs = await col.find({}, { projection: { passwordHash: 0 } }).limit(200).toArray();
    return docs.map(stripSecrets);
  },

  async updateRole(id: string, role: User['role']): Promise<void> {
    const col = await collection<UserDocument>(COLLECTIONS.users);
    await col.updateOne({ id } as Filter<UserDocument>, { $set: { role } });
  },
};

/** Remove anything that must never reach a client. */
export function stripSecrets(user: UserDocument): User {
  const { passwordHash: _passwordHash, ...safe } = user as UserDocument & Record<string, unknown>;
  delete (safe as Record<string, unknown>)._id;
  return safe as User;
}

// ---------------------------------------------------------------------------
// Usage records
// ---------------------------------------------------------------------------

export const usageRepo = {
  async create(record: UsageRecord): Promise<UsageRecord> {
    const col = await collection<UsageRecord>(COLLECTIONS.usageRecords);
    await col.insertOne({ ...record, createdAt: new Date(record.createdAt) as unknown as string });
    return record;
  },

  async listForUser(userId: string, limit = 25): Promise<UsageRecord[]> {
    const col = await collection<UsageRecord>(COLLECTIONS.usageRecords);
    const docs = await col
      .find({ userId } as Filter<UsageRecord>)
      .sort({ createdAt: -1 })
      .limit(Math.min(limit, MAX_PAGE_SIZE))
      .toArray();
    return docs.map(normaliseTimestamps);
  },
};

// ---------------------------------------------------------------------------
// Simulation state (control plane shared between the API and the worker)
// ---------------------------------------------------------------------------

export const simulationRepo = {
  async get<T>(): Promise<T | null> {
    const col = await collection(COLLECTIONS.simulationState);
    const doc = await col.findOne({ _id: 'current' as never });
    return doc ? ((doc as Record<string, unknown>).state as T) : null;
  },

  async set(state: unknown): Promise<void> {
    const col = await collection(COLLECTIONS.simulationState);
    await col.updateOne(
      { _id: 'current' as never },
      { $set: { state, updatedAt: new Date() } },
      { upsert: true },
    );
  },

  /**
   * Control commands the API writes and the worker polls.
   *
   * The API cannot call the worker directly (different hosts, and on Vercel
   * there is no persistent connection), so the database is the control plane.
   */
  async pushCommand(command: { type: string; payload?: unknown }): Promise<void> {
    const col = await collection(COLLECTIONS.simulationState);
    await col.updateOne(
      { _id: 'command' as never },
      { $set: { command, issuedAt: new Date(), consumed: false } },
      { upsert: true },
    );
  },

  async takeCommand(): Promise<{ type: string; payload?: unknown } | null> {
    const col = await collection(COLLECTIONS.simulationState);
    const doc = await col.findOneAndUpdate(
      { _id: 'command' as never, consumed: false },
      { $set: { consumed: true, consumedAt: new Date() } },
      { returnDocument: 'after' },
    );
    if (!doc) return null;
    return ((doc as Record<string, unknown>).command as { type: string; payload?: unknown }) ?? null;
  },
};

// ---------------------------------------------------------------------------
// System events
// ---------------------------------------------------------------------------

export const eventRepo = {
  async record(type: string, message: string, fields: Record<string, unknown> = {}): Promise<void> {
    try {
      const col = await collection(COLLECTIONS.systemEvents);
      await col.insertOne({ type, message, ...fields, timestamp: new Date() } as never);
    } catch (err) {
      // Never let audit logging break the request it is describing.
      log.warn('Failed to record system event', { type, ...errorFields(err) });
    }
  },

  async recent(limit = 100) {
    const col = await collection(COLLECTIONS.systemEvents);
    return col.find({}).sort({ timestamp: -1 }).limit(Math.min(limit, MAX_PAGE_SIZE)).toArray();
  },
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Mongo returns Date objects; the API contract is ISO strings. */
function normaliseTimestamps<T>(doc: T): T {
  const out = { ...(doc as Record<string, unknown>) };
  delete out._id;
  for (const key of ['timestamp', 'createdAt', 'acknowledgedAt', 'resolvedAt', 'periodStart', 'periodEnd']) {
    const v = out[key];
    if (v instanceof Date) out[key] = v.toISOString();
  }
  return out as T;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Window length and bucket size for each supported range. */
export function rangeToWindow(range: TimeRange): { ms: number; bucketMs: number } {
  switch (range) {
    case '1H':
      return { ms: 3600_000, bucketMs: 60_000 };
    case '6H':
      return { ms: 6 * 3600_000, bucketMs: 5 * 60_000 };
    case '24H':
      return { ms: 24 * 3600_000, bucketMs: 15 * 60_000 };
    case '7D':
      return { ms: 7 * 24 * 3600_000, bucketMs: 3600_000 };
    case '30D':
      return { ms: 30 * 24 * 3600_000, bucketMs: 6 * 3600_000 };
    default:
      return { ms: 24 * 3600_000, bucketMs: 15 * 60_000 };
  }
}
