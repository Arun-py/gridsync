/**
 * TelemetryProvider — the frontend's data-source abstraction.
 *
 * THIS IS WHY SWITCHING TO REAL HARDWARE DOES NOT TOUCH THE UI.
 *
 * Pages subscribe to a `TelemetryProvider`. They never know, and never ask,
 * whether frames originated in the simulator, an ESP32 over MQTT, or a REST
 * poll. They receive `SystemSnapshot` + `EnrichedFrame[]` and render it.
 *
 * Two implementations ship:
 *
 *   StreamingProvider   subscribes to the worker's SSE endpoint. Lowest latency,
 *                       used whenever a stream URL is reachable.
 *
 *   PollingProvider     polls GET /api/telemetry/latest. The universal fallback:
 *                       works through any proxy, on Vercel with no worker URL,
 *                       and anywhere EventSource is blocked.
 *
 * `createTelemetryProvider` picks the best available and, critically, the
 * streaming provider DEGRADES TO POLLING automatically if the stream drops —
 * so the dashboard keeps updating rather than quietly freezing on stale values.
 */

import type { EnrichedFrame, SystemHealth, SystemSnapshot } from '@shared/types';
import { telemetryApi } from '../api';

export type ConnectionStatus = 'connecting' | 'live' | 'polling' | 'degraded' | 'offline';

export interface TelemetryUpdate {
  snapshot: SystemSnapshot | null;
  frames: EnrichedFrame[];
  health: SystemHealth | null;
  /** How this update arrived. Surfaced in the UI so the user knows. */
  transport: 'sse' | 'poll';
  receivedAt: number;
}

export interface TelemetryProvider {
  readonly kind: 'streaming' | 'polling';
  start(): void;
  stop(): void;
  onUpdate(fn: (update: TelemetryUpdate) => void): () => void;
  onStatus(fn: (status: ConnectionStatus, detail?: string) => void): () => void;
  /** Force an immediate refresh (used after a scenario change). */
  refresh(): void;
  getStatus(): ConnectionStatus;
}

type UpdateHandler = (update: TelemetryUpdate) => void;
type StatusHandler = (status: ConnectionStatus, detail?: string) => void;

abstract class BaseProvider implements TelemetryProvider {
  abstract readonly kind: 'streaming' | 'polling';

  protected updateHandlers = new Set<UpdateHandler>();
  protected statusHandlers = new Set<StatusHandler>();
  protected status: ConnectionStatus = 'connecting';

  onUpdate(fn: UpdateHandler): () => void {
    this.updateHandlers.add(fn);
    return () => this.updateHandlers.delete(fn);
  }

  onStatus(fn: StatusHandler): () => void {
    this.statusHandlers.add(fn);
    // Emit current status immediately so a late subscriber is not left blank.
    fn(this.status);
    return () => this.statusHandlers.delete(fn);
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  protected emit(update: TelemetryUpdate): void {
    for (const fn of this.updateHandlers) fn(update);
  }

  protected setStatus(status: ConnectionStatus, detail?: string): void {
    if (this.status === status) return;
    this.status = status;
    for (const fn of this.statusHandlers) fn(status, detail);
  }

  abstract start(): void;
  abstract stop(): void;
  abstract refresh(): void;
}

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

export class PollingProvider extends BaseProvider {
  readonly kind = 'polling' as const;

  private timer: number | null = null;
  private inFlight = false;
  private consecutiveFailures = 0;
  private stopped = true;

  constructor(private intervalMs = 2000) {
    super();
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.setStatus('connecting');
    void this.poll();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  refresh(): void {
    void this.poll();
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.poll(), delayMs);
  }

  private async poll(): Promise<void> {
    if (this.stopped) return;
    // Never stack requests: a slow response must not cause a pile-up.
    if (this.inFlight) return this.schedule(this.intervalMs);

    this.inFlight = true;
    try {
      const data = await telemetryApi.latest();
      this.consecutiveFailures = 0;
      this.setStatus('polling');
      this.emit({
        snapshot: data.snapshot,
        frames: data.frames,
        health: null,
        transport: 'poll',
        receivedAt: Date.now(),
      });
      this.schedule(this.intervalMs);
    } catch {
      this.consecutiveFailures += 1;
      this.setStatus(
        this.consecutiveFailures > 3 ? 'offline' : 'degraded',
        'Cannot reach the telemetry API',
      );
      // Exponential backoff, capped: do not hammer a server that is struggling.
      const backoff = Math.min(30_000, this.intervalMs * 2 ** Math.min(this.consecutiveFailures, 4));
      this.schedule(backoff);
    } finally {
      this.inFlight = false;
    }
  }
}

// ---------------------------------------------------------------------------
// Streaming (SSE) with automatic fallback
// ---------------------------------------------------------------------------

export class StreamingProvider extends BaseProvider {
  readonly kind = 'streaming' as const;

  private source: EventSource | null = null;
  private fallback: PollingProvider | null = null;
  private fallbackUnsubscribe: (() => void) | null = null;
  private stopped = true;
  private failures = 0;
  private watchdog: number | null = null;
  private lastMessageAt = 0;

  constructor(
    private streamUrl: string,
    private fallbackIntervalMs = 2000,
  ) {
    super();
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.teardownStream();
    this.stopFallback();
    if (this.watchdog !== null) {
      window.clearInterval(this.watchdog);
      this.watchdog = null;
    }
  }

  refresh(): void {
    this.fallback?.refresh();
  }

  private connect(): void {
    if (this.stopped) return;
    this.setStatus('connecting');

    try {
      this.source = new EventSource(this.streamUrl);
    } catch {
      // EventSource unavailable or URL invalid — go straight to polling.
      return this.startFallback('Live stream unavailable');
    }

    this.source.addEventListener('open', () => {
      this.failures = 0;
      this.lastMessageAt = Date.now();
      // The stream is healthy; stop the fallback poller so we are not fetching
      // the same data twice.
      this.stopFallback();
      this.setStatus('live');
    });

    this.source.addEventListener('telemetry', (event) => {
      this.lastMessageAt = Date.now();
      try {
        const data = JSON.parse((event as MessageEvent).data) as {
          snapshot: SystemSnapshot;
          frames: EnrichedFrame[];
          health: SystemHealth | null;
        };
        this.setStatus('live');
        this.emit({
          snapshot: data.snapshot,
          frames: data.frames,
          health: data.health ?? null,
          transport: 'sse',
          receivedAt: Date.now(),
        });
      } catch {
        /* a malformed frame is skipped rather than killing the stream */
      }
    });

    this.source.addEventListener('error', () => {
      this.failures += 1;
      this.teardownStream();

      if (this.stopped) return;

      // EventSource retries on its own, but after repeated failures the stream
      // is genuinely unreachable (no worker, blocked by a proxy). Switch to
      // polling permanently rather than leaving the dashboard frozen.
      if (this.failures >= 2) {
        this.startFallback('Live stream unreachable — using periodic refresh');
      } else {
        window.setTimeout(() => this.connect(), 2000);
      }
    });

    // A stream can stay "open" while silently delivering nothing. If no message
    // arrives for 15 s, treat it as dead and fall back.
    if (this.watchdog === null) {
      this.watchdog = window.setInterval(() => {
        if (this.stopped || !this.source) return;
        if (this.lastMessageAt && Date.now() - this.lastMessageAt > 15_000) {
          this.teardownStream();
          this.startFallback('Live stream stopped responding — using periodic refresh');
        }
      }, 5000);
    }
  }

  private teardownStream(): void {
    if (this.source) {
      this.source.close();
      this.source = null;
    }
  }

  private startFallback(reason: string): void {
    if (this.fallback) return;
    this.fallback = new PollingProvider(this.fallbackIntervalMs);
    // Re-emit the poller's updates and status through this provider, so
    // subscribers never need to know a handover happened.
    this.fallbackUnsubscribe = this.fallback.onUpdate((u) => this.emit(u));
    this.fallback.onStatus((s) => {
      if (s === 'polling') this.setStatus('polling', reason);
      else if (s === 'offline' || s === 'degraded') this.setStatus(s, reason);
    });
    this.fallback.start();
    this.setStatus('polling', reason);
  }

  private stopFallback(): void {
    if (!this.fallback) return;
    this.fallbackUnsubscribe?.();
    this.fallbackUnsubscribe = null;
    this.fallback.stop();
    this.fallback = null;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Choose a provider.
 *
 * A stream URL is used when configured (VITE_STREAM_URL, or the local worker
 * during development). Otherwise polling — which always works.
 */
export function createTelemetryProvider(): TelemetryProvider {
  const configured = import.meta.env.VITE_STREAM_URL as string | undefined;

  // During local development the worker serves the stream on its own port and
  // Vite proxies /api to it, so the relative path works.
  const devStream = import.meta.env.DEV ? '/api/stream' : undefined;
  const streamUrl = configured || devStream;

  if (streamUrl && typeof EventSource !== 'undefined') {
    return new StreamingProvider(streamUrl);
  }
  return new PollingProvider(2000);
}

/** Human-readable label for the connection indicator. */
export function statusLabel(status: ConnectionStatus): string {
  switch (status) {
    case 'live':
      return 'Live stream';
    case 'polling':
      return 'Periodic refresh';
    case 'connecting':
      return 'Connecting';
    case 'degraded':
      return 'Degraded';
    case 'offline':
      return 'Offline';
  }
}
