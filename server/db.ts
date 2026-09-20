/**
 * MongoDB access.
 *
 * SERVERLESS CONNECTION REUSE
 * A Vercel function can be invoked hundreds of times on the same warm instance.
 * Creating a MongoClient per invocation exhausts the Atlas connection limit
 * within minutes. The client promise is therefore cached on `globalThis`, which
 * survives across invocations on a warm instance but is correctly discarded
 * when the instance is recycled.
 *
 * Collection names come from shared/constants.ts so scripts, worker and API
 * cannot drift apart.
 */

import { MongoClient, type Collection, type Db, type Document } from 'mongodb';

import { COLLECTIONS } from '../shared/constants';
import { env } from './env';
import { errorFields, logger } from './logger';

const log = logger('db');

/** Cached across warm serverless invocations. */
declare global {
  // eslint-disable-next-line no-var
  var __gridsyncMongo: { client: MongoClient; promise: Promise<MongoClient> } | undefined;
}

function createClient(): MongoClient {
  return new MongoClient(env.mongoUri, {
    // Keep the pool small: many concurrent serverless instances each holding a
    // large pool is the fastest way to hit the Atlas connection cap.
    maxPoolSize: 10,
    minPoolSize: 0,
    // Fail fast rather than hanging a request for 30 s on an unreachable cluster.
    serverSelectionTimeoutMS: 8000,
    connectTimeoutMS: 8000,
    socketTimeoutMS: 45000,
    retryWrites: true,
    appName: 'gridsync',
  });
}

export async function getClient(): Promise<MongoClient> {
  if (globalThis.__gridsyncMongo) {
    return globalThis.__gridsyncMongo.promise;
  }
  const client = createClient();
  const promise = client.connect().catch((err) => {
    // Drop the cache so the next request retries instead of reusing a rejected
    // promise forever.
    globalThis.__gridsyncMongo = undefined;
    log.error('MongoDB connection failed', errorFields(err));
    throw err;
  });
  globalThis.__gridsyncMongo = { client, promise };
  return promise;
}

export async function getDb(): Promise<Db> {
  const client = await getClient();
  return client.db(env.dbName);
}

export async function collection<T extends Document = Document>(
  name: (typeof COLLECTIONS)[keyof typeof COLLECTIONS],
): Promise<Collection<T>> {
  const db = await getDb();
  return db.collection<T>(name);
}

/** Close the pooled client. For scripts and tests; never call from a request. */
export async function closeClient(): Promise<void> {
  if (globalThis.__gridsyncMongo) {
    await globalThis.__gridsyncMongo.client.close();
    globalThis.__gridsyncMongo = undefined;
  }
}

export interface DbHealth {
  connected: boolean;
  latencyMs: number | null;
  error?: string;
}

/** Ping the cluster. Used by /api/health and the System Health page. */
export async function checkDbHealth(): Promise<DbHealth> {
  const started = Date.now();
  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    return { connected: true, latencyMs: Date.now() - started };
  } catch (err) {
    return {
      connected: false,
      latencyMs: null,
      // Surface a category, never the connection string or credentials.
      error: err instanceof Error ? err.name : 'UnknownError',
    };
  }
}

export { COLLECTIONS };
