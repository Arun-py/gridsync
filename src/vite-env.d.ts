/// <reference types="vite/client" />

/**
 * Client-side environment contract.
 *
 * Only VITE_-prefixed variables reach the browser bundle. Nothing secret may
 * ever be added here — everything in this interface is publicly readable in the
 * shipped JavaScript. Server secrets live in server/env.ts.
 */
interface ImportMetaEnv {
  /** Base URL for API calls. Defaults to '/api'. */
  readonly VITE_API_URL?: string;
  /** SSE endpoint on the worker. When unset, the app polls instead. */
  readonly VITE_STREAM_URL?: string;
  /** Google OAuth client id. Public by design; the secret stays server-side. */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  /** Local dev proxy target for /api. */
  readonly VITE_DEV_API_TARGET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
