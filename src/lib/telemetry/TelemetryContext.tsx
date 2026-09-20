/**
 * Live telemetry context.
 *
 * WHY THIS IS NOT IN REDUX
 * Frames arrive up to once per second. Dispatching that into Redux would run
 * every connected selector and re-render large parts of the tree 60+ times a
 * minute. Live telemetry therefore lives here, behind a subscription, while
 * Redux keeps the low-frequency state (auth, UI preferences).
 *
 * Nothing in this file invents data. Every value shown originates from the
 * backend pipeline.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type { EnrichedFrame, NodeConfig, SystemHealth, SystemSnapshot } from '@shared/types';
import { telemetryApi } from '../api';
import {
  createTelemetryProvider,
  type ConnectionStatus,
  type TelemetryProvider,
} from './provider';

interface TelemetryContextValue {
  snapshot: SystemSnapshot | null;
  frames: EnrichedFrame[];
  health: SystemHealth | null;
  nodes: NodeConfig[];
  status: ConnectionStatus;
  statusDetail: string | null;
  transport: 'sse' | 'poll' | null;
  /** ms since the last update actually arrived. Drives the staleness warning. */
  lastUpdateAgeMs: number;
  frameFor: (nodeId: string) => EnrichedFrame | undefined;
  nodeFor: (nodeId: string) => NodeConfig | undefined;
  refresh: () => void;
  /** True once the first payload has arrived (or definitively failed). */
  ready: boolean;
}

const TelemetryContext = createContext<TelemetryContextValue | null>(null);

export function TelemetryProviderComponent({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<SystemSnapshot | null>(null);
  const [frames, setFrames] = useState<EnrichedFrame[]>([]);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [nodes, setNodes] = useState<NodeConfig[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [statusDetail, setStatusDetail] = useState<string | null>(null);
  const [transport, setTransport] = useState<'sse' | 'poll' | null>(null);
  const [ready, setReady] = useState(false);
  const [lastUpdateAt, setLastUpdateAt] = useState(0);
  const [now, setNow] = useState(Date.now());

  const providerRef = useRef<TelemetryProvider | null>(null);

  // --- node catalogue: fetched once; the UI renders whatever it receives ---
  useEffect(() => {
    let cancelled = false;
    telemetryApi
      .nodes()
      .then((data) => {
        if (!cancelled) setNodes(data.nodes);
      })
      .catch(() => {
        // Non-fatal: frames carry nodeId/nodeType, so the dashboard still works
        // with reduced labelling until this succeeds.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // --- live stream ---
  useEffect(() => {
    const provider = createTelemetryProvider();
    providerRef.current = provider;

    const offUpdate = provider.onUpdate((update) => {
      if (update.snapshot) setSnapshot(update.snapshot);
      if (update.frames) setFrames(update.frames);
      if (update.health) setHealth(update.health);
      setTransport(update.transport);
      setLastUpdateAt(update.receivedAt);
      setReady(true);
    });

    const offStatus = provider.onStatus((s, detail) => {
      setStatus(s);
      setStatusDetail(detail ?? null);
      // A definitive failure still counts as "ready" — the UI must render its
      // degraded state rather than spinning forever.
      if (s === 'offline') setReady(true);
    });

    provider.start();

    return () => {
      offUpdate();
      offStatus();
      provider.stop();
      providerRef.current = null;
    };
  }, []);

  // --- ticking clock so staleness is visible without a new frame ---
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const frameFor = useCallback(
    (nodeId: string) => frames.find((f) => f.nodeId === nodeId),
    [frames],
  );

  const nodeFor = useCallback((nodeId: string) => nodes.find((n) => n.id === nodeId), [nodes]);

  const refresh = useCallback(() => providerRef.current?.refresh(), []);

  const value = useMemo<TelemetryContextValue>(
    () => ({
      snapshot,
      frames,
      health,
      nodes,
      status,
      statusDetail,
      transport,
      lastUpdateAgeMs: lastUpdateAt ? now - lastUpdateAt : 0,
      frameFor,
      nodeFor,
      refresh,
      ready,
    }),
    [
      snapshot,
      frames,
      health,
      nodes,
      status,
      statusDetail,
      transport,
      lastUpdateAt,
      now,
      frameFor,
      nodeFor,
      refresh,
      ready,
    ],
  );

  return <TelemetryContext.Provider value={value}>{children}</TelemetryContext.Provider>;
}

export function useTelemetry(): TelemetryContextValue {
  const ctx = useContext(TelemetryContext);
  if (!ctx) {
    throw new Error('useTelemetry must be used inside <TelemetryProviderComponent>.');
  }
  return ctx;
}

/** Convenience hook for a single node's live frame and its configuration. */
export function useNode(nodeId: string): {
  node: NodeConfig | undefined;
  frame: EnrichedFrame | undefined;
  stale: boolean;
} {
  const { frameFor, nodeFor } = useTelemetry();
  const frame = frameFor(nodeId);
  return {
    node: nodeFor(nodeId),
    frame,
    stale: frame ? frame.status === 'STALE' || frame.status === 'OFFLINE' : true,
  };
}
