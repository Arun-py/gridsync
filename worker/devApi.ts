/**
 * Local API router — development only.
 *
 * WHY THIS EXISTS
 * In production Vercel turns every file under `api/` into a serverless function.
 * Locally there is no Vercel runtime, so without this the documented two-command
 * setup (`npm run dev` + `npm run worker`) would serve a frontend whose every
 * API call 404s. Requiring `vercel dev` instead would mean installing and
 * authenticating the Vercel CLI just to run the project.
 *
 * So the worker mounts the SAME handler modules Vercel deploys, resolved by the
 * same file-path convention. There is no second implementation of any route:
 * `api/auth/login.ts` serves both environments, so local behaviour and deployed
 * behaviour cannot drift.
 *
 * This module is imported only by the worker and never ships to Vercel.
 */

import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { errorFields, logger } from '../server/logger';

const log = logger('dev-api');

// fileURLToPath, not manual URL parsing: on Windows a file URL is
// `file:///C:/…` and hand-stripping the leading slash is exactly the kind of
// platform bug that silently disables the whole router.
const API_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../api');

interface RouteEntry {
  /** Path segments, where a segment like `[id]` is a parameter. */
  segments: string[];
  filePath: string;
}

let routeTable: RouteEntry[] | null = null;

/** Walk `api/` once and build the route table. */
async function buildRoutes(dir = API_ROOT, prefix: string[] = []): Promise<RouteEntry[]> {
  const out: RouteEntry[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    // `_lib` holds shared helpers, not routes — Vercel treats a leading
    // underscore the same way.
    if (entry.name.startsWith('_')) continue;

    const full = join(dir, entry.name);

    if (entry.isDirectory()) {
      out.push(...(await buildRoutes(full, [...prefix, entry.name])));
      continue;
    }

    if (!entry.name.endsWith('.ts')) continue;

    const base = entry.name.replace(/\.ts$/, '');
    // `index.ts` maps to the directory itself.
    const segments = base === 'index' ? prefix : [...prefix, base];
    out.push({ segments, filePath: full });
  }

  return out;
}

/**
 * Match a request path against the table.
 *
 * Static segments beat parameters, matching Vercel's own precedence, so
 * `/api/alerts/index` is never shadowed by `/api/alerts/[id]`.
 */
function matchRoute(
  table: RouteEntry[],
  pathSegments: string[],
): { entry: RouteEntry; params: Record<string, string> } | null {
  let best: { entry: RouteEntry; params: Record<string, string>; staticCount: number } | null = null;

  for (const entry of table) {
    if (entry.segments.length !== pathSegments.length) continue;

    const params: Record<string, string> = {};
    let ok = true;
    let staticCount = 0;

    for (let i = 0; i < entry.segments.length; i++) {
      const routeSeg = entry.segments[i];
      const pathSeg = pathSegments[i];

      const param = /^\[(.+)\]$/.exec(routeSeg);
      if (param) {
        params[param[1]] = decodeURIComponent(pathSeg);
      } else if (routeSeg === pathSeg) {
        staticCount++;
      } else {
        ok = false;
        break;
      }
    }

    if (ok && (!best || staticCount > best.staticCount)) {
      best = { entry, params, staticCount };
    }
  }

  return best ? { entry: best.entry, params: best.params } : null;
}

/** Read and JSON-parse a request body, with a size cap. */
async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1024 * 1024) throw new Error('Request body too large');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Adapt Node's ServerResponse to the subset of the Vercel response API that the
 * handlers use: `status()`, `json()`, `send()`, `setHeader()`, `writableEnded`.
 */
function adaptResponse(res: ServerResponse) {
  let statusCode = 200;

  const adapted = res as ServerResponse & {
    status(code: number): typeof adapted;
    json(body: unknown): void;
    send(body: unknown): void;
  };

  adapted.status = (code: number) => {
    statusCode = code;
    return adapted;
  };

  adapted.json = (body: unknown) => {
    if (res.writableEnded) return;
    const payload = JSON.stringify(body ?? null);
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(payload),
    });
    res.end(payload);
  };

  adapted.send = (body: unknown) => {
    if (res.writableEnded) return;
    if (typeof body === 'string') {
      res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(body);
    } else {
      adapted.json(body);
    }
  };

  return adapted;
}

export interface DevApiResult {
  handled: boolean;
}

/**
 * Try to serve `/api/...` from the Vercel handler modules.
 * Returns `{ handled: false }` when no route matches, so the worker's own
 * endpoints (the SSE stream, its local controls) still take effect.
 */
export async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<DevApiResult> {
  if (!existsSync(API_ROOT)) return { handled: false };

  if (!routeTable) {
    routeTable = await buildRoutes();
    log.info('Local API routes mounted', {
      count: routeTable.length,
      routes: routeTable.map((r) => `/api/${r.segments.join('/')}`).sort(),
    });
  }

  const segments = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const match = matchRoute(routeTable, segments);
  if (!match) return { handled: false };

  try {
    const mod = (await import(pathToFileURL(match.entry.filePath).href)) as {
      default?: (req: unknown, res: unknown) => Promise<void> | void;
    };
    const handler = mod.default;
    if (typeof handler !== 'function') return { handled: false };

    // Build the request shape the handlers expect.
    const query: Record<string, string> = { ...match.params };
    url.searchParams.forEach((value, key) => {
      if (!(key in query)) query[key] = value;
    });

    const body =
      req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS'
        ? {}
        : await readBody(req);

    const adaptedReq = Object.assign(req, { query, body, cookies: {} });
    const adaptedRes = adaptResponse(res);

    await handler(adaptedReq, adaptedRes);

    if (!res.writableEnded) res.end();
    return { handled: true };
  } catch (err) {
    log.error('Local API handler failed', {
      path: url.pathname,
      ...errorFields(err),
    });
    if (!res.writableEnded) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Handler failed in local development.', code: 'DEV_HANDLER_ERROR' }));
    }
    return { handled: true };
  }
}
