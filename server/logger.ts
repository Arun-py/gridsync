/**
 * Structured logging.
 *
 * One line of JSON per event so logs stay greppable in Render/Vercel and can be
 * shipped to a log aggregator later without reformatting.
 *
 * SECRET SAFETY: `redact()` strips anything that looks like a credential before
 * it reaches the output. Never log a raw request body or a full env object —
 * use the structured fields.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const MIN_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

/** Keys whose values must never be written to a log, at any depth. */
const SENSITIVE_KEYS = [
  'password',
  'passwordhash',
  'token',
  'authorization',
  'secret',
  'clientsecret',
  'mongodburi',
  'mongo_uri',
  'authsecret',
  'ingesttoken',
  'cookie',
  'apikey',
  'privatekey',
];

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth-limit]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    // Catch a connection string pasted into a message field.
    return value.replace(/(mongodb(?:\+srv)?:\/\/)[^@\s]+@/gi, '$1[redacted]@');
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.includes(k.toLowerCase().replace(/[-_]/g, ''))) {
      out[k] = '[redacted]';
    } else {
      out[k] = redact(v, depth + 1);
    }
  }
  return out;
}

function emit(level: LogLevel, component: string, message: string, fields?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[MIN_LEVEL]) return;

  const entry = {
    ts: new Date().toISOString(),
    level,
    component,
    message,
    ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
  };

  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

/** A logger bound to one component, e.g. `logger('simulator')`. */
export function logger(component: string): Logger {
  return {
    debug: (m, f) => emit('debug', component, m, f),
    info: (m, f) => emit('info', component, m, f),
    warn: (m, f) => emit('warn', component, m, f),
    error: (m, f) => emit('error', component, m, f),
  };
}

/** Normalise an unknown thrown value into loggable fields, without leaking internals. */
export function errorFields(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { errorName: err.name, errorMessage: err.message };
  }
  return { errorMessage: String(err) };
}
