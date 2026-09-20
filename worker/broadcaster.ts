/**
 * Server-Sent Events broadcaster.
 *
 * WHY SSE RATHER THAN WEBSOCKETS
 * Telemetry flows one way: server to browser. SSE gives that over plain HTTP
 * with automatic client-side reconnection built into EventSource, no upgrade
 * handshake, and no proxy incompatibilities. WebSockets would add a second
 * protocol for no benefit here. Control commands travel over ordinary REST.
 *
 * PAYLOAD DISCIPLINE
 * A frame every second times many clients adds up. Only the current snapshot,
 * the latest frame per node and newly-raised alerts are pushed — never history,
 * which the client fetches once from the API and appends to locally.
 */

import type { ServerResponse } from 'node:http';

import type { Alert, EnrichedFrame, Prediction, SystemHealth, SystemSnapshot } from '../shared/types';
import { logger } from '../server/logger';

const log = logger('sse');

export interface StreamPayload {
  snapshot: SystemSnapshot;
  frames: EnrichedFrame[];
  newAlerts: Alert[];
  predictions: Prediction[];
  health: SystemHealth;
}

interface Client {
  id: string;
  res: ServerResponse;
}

export class Broadcaster {
  private clients = new Map<string, Client>();
  private heartbeat: NodeJS.Timeout | null = null;

  constructor() {
    // Proxies and load balancers close idle connections. A comment line every
    // 20 s keeps the connection warm without producing a client-visible event.
    this.heartbeat = setInterval(() => {
      for (const client of this.clients.values()) {
        try {
          client.res.write(': heartbeat\n\n');
        } catch {
          this.remove(client.id);
        }
      }
    }, 20_000);
  }

  add(res: ServerResponse): string {
    const id = Math.random().toString(36).slice(2, 12);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disables buffering in nginx, which would otherwise hold events back.
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    });
    res.write('retry: 3000\n\n');

    this.clients.set(id, { id, res });
    log.info('Stream client connected', { clientId: id, total: this.clients.size });

    res.on('close', () => this.remove(id));
    return id;
  }

  remove(id: string): void {
    const client = this.clients.get(id);
    if (!client) return;
    this.clients.delete(id);
    try {
      client.res.end();
    } catch {
      /* already gone */
    }
    log.info('Stream client disconnected', { clientId: id, total: this.clients.size });
  }

  broadcast(event: string, data: unknown): void {
    if (this.clients.size === 0) return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients.values()) {
      try {
        client.res.write(payload);
      } catch {
        // A dead socket throws on write; drop it rather than retrying.
        this.remove(client.id);
      }
    }
  }

  get clientCount(): number {
    return this.clients.size;
  }

  close(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const id of [...this.clients.keys()]) this.remove(id);
  }
}
