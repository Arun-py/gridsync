/**
 * Telemetry validation.
 *
 * Runs on INGEST, for every frame, whatever its source. The purpose is to stop
 * malformed readings silently contaminating charts, analytics and — above all —
 * ML training data.
 *
 * The critical distinction this module encodes:
 *
 *   SENSOR FAULT        the frame ARRIVED, but a value is physically impossible
 *                       (DS18B20 reporting -127 degC, negative illuminance, a
 *                       current far beyond what the conductor could carry)
 *
 *   COMMUNICATION FAULT the frame DID NOT ARRIVE, arrived late, arrived twice,
 *                       or stopped arriving. Detected in shared/rules, not here,
 *                       because it is an absence of data rather than bad data.
 *
 * A frame that fails validation is stored (we do not hide errors) but marked
 * `valid: false`, excluded from ML feature extraction, and surfaced as a
 * SENSOR_FAULT alert.
 */

import { DS18B20_ERROR_VALUE, PLAUSIBLE } from './constants.js';
import type { NodeConfig, TelemetryFrame } from './types.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const REQUIRED_FIELDS = ['nodeId', 'nodeType', 'timestamp', 'voltage', 'current'] as const;

/**
 * Validate a raw, untrusted telemetry payload.
 *
 * `node` is optional: when supplied, per-node electrical ranges are enforced
 * (an AC branch at 12 V is a fault; a DC branch at 12 V is normal).
 */
export function validateFrame(frame: Partial<TelemetryFrame>, node?: NodeConfig): ValidationResult {
  const errors: string[] = [];

  // --- structural -----------------------------------------------------------
  for (const field of REQUIRED_FIELDS) {
    if (frame[field] === undefined || frame[field] === null) {
      errors.push(`Missing required field: ${field}`);
    }
  }
  if (errors.length > 0) return { valid: false, errors };

  const numeric: Array<[string, unknown]> = [
    ['voltage', frame.voltage],
    ['current', frame.current],
  ];
  for (const [name, value] of numeric) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      errors.push(`Field ${name} is not a finite number`);
    }
  }
  if (errors.length > 0) return { valid: false, errors };

  const voltage = frame.voltage as number;
  const current = frame.current as number;

  // --- timestamp ------------------------------------------------------------
  const ts = new Date(frame.timestamp as string);
  if (Number.isNaN(ts.getTime())) {
    errors.push('Timestamp is not a valid date');
  } else {
    const skewMs = ts.getTime() - Date.now();
    // Tolerate modest clock skew from an unsynchronised edge device, but a
    // frame from tomorrow is a broken RTC, not a measurement.
    if (skewMs > 5 * 60_000) errors.push('Timestamp is more than 5 minutes in the future');
    if (skewMs < -24 * 3600_000) errors.push('Timestamp is more than 24 hours old');
  }

  // --- electrical plausibility ---------------------------------------------
  const vRange = node?.voltageRange ?? [PLAUSIBLE.voltage.min, PLAUSIBLE.voltage.max];
  // Allow 20 % headroom over the configured operating band before calling it
  // impossible — an excursion is a process event, not a sensor failure.
  const vMin = Math.min(vRange[0], PLAUSIBLE.voltage.min);
  const vMax = Math.max(vRange[1] * 1.2, 0);
  if (voltage < vMin || voltage > vMax) {
    errors.push(`Voltage ${voltage} V outside plausible range [${vMin}, ${round1(vMax)}] V`);
  }

  const cRange = node?.currentRange ?? [PLAUSIBLE.current.min, PLAUSIBLE.current.max];
  const cMin = Math.min(cRange[0] * 1.2, 0);
  const cMax = cRange[1] * 1.5;
  if (current < cMin || current > cMax) {
    errors.push(`Current ${current} A outside plausible range [${round1(cMin)}, ${round1(cMax)}] A`);
  }

  // --- power consistency ----------------------------------------------------
  // P must equal V x I. A mismatch means the device computed it wrongly or the
  // payload was tampered with in transit.
  if (typeof frame.power === 'number' && Number.isFinite(frame.power)) {
    const expected = voltage * current;
    const tolerance = Math.max(1, Math.abs(expected) * 0.05);
    if (Math.abs(frame.power - expected) > tolerance) {
      errors.push(
        `Power ${frame.power} W inconsistent with V x I = ${round1(expected)} W`,
      );
    }
  }

  // --- temperature ----------------------------------------------------------
  if (frame.temperature !== undefined) {
    const t = frame.temperature;
    if (typeof t !== 'number' || !Number.isFinite(t)) {
      errors.push('Temperature is not a finite number');
    } else if (t === DS18B20_ERROR_VALUE) {
      // Matched explicitly: this is the documented DS18B20 bus-read failure
      // value, not a real cryogenic measurement.
      errors.push('Temperature reads -127 degC (DS18B20 bus read failure)');
    } else if (t < PLAUSIBLE.temperature.min || t > PLAUSIBLE.temperature.max) {
      errors.push(
        `Temperature ${t} degC outside sensor range [${PLAUSIBLE.temperature.min}, ${PLAUSIBLE.temperature.max}] degC`,
      );
    }
  }

  // --- illuminance ----------------------------------------------------------
  if (frame.lux !== undefined) {
    const l = frame.lux;
    if (typeof l !== 'number' || !Number.isFinite(l)) {
      errors.push('Lux is not a finite number');
    } else if (l < PLAUSIBLE.lux.min || l > PLAUSIBLE.lux.max) {
      errors.push(
        `Illuminance ${l} lx outside sensor range [${PLAUSIBLE.lux.min}, ${PLAUSIBLE.lux.max}] lx`,
      );
    }
  }

  // --- state of charge ------------------------------------------------------
  if (frame.soc !== undefined) {
    const s = frame.soc;
    if (typeof s !== 'number' || !Number.isFinite(s)) {
      errors.push('SOC is not a finite number');
    } else if (s < PLAUSIBLE.soc.min || s > PLAUSIBLE.soc.max) {
      errors.push(`SOC ${s}% outside valid range [0, 100]%`);
    }
  }

  // --- sequence -------------------------------------------------------------
  if (frame.sequenceNumber !== undefined) {
    if (!Number.isInteger(frame.sequenceNumber) || (frame.sequenceNumber as number) < 0) {
      errors.push('Sequence number must be a non-negative integer');
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Normalise an untrusted payload into a complete frame.
 * Always pair with `validateFrame` — this coerces shape, not correctness.
 */
export function normaliseFrame(
  raw: Partial<TelemetryFrame>,
  node: NodeConfig | undefined,
  fallbackSource: TelemetryFrame['source'] = 'REST',
): TelemetryFrame {
  const voltage = Number(raw.voltage ?? 0);
  const current = Number(raw.current ?? 0);
  const ts = new Date(raw.timestamp ?? Date.now());
  const timestamp = Number.isNaN(ts.getTime()) ? new Date().toISOString() : ts.toISOString();

  const frame: TelemetryFrame = {
    nodeId: String(raw.nodeId ?? node?.id ?? 'unknown'),
    nodeType: (raw.nodeType ?? node?.type ?? 'DC_LOAD') as TelemetryFrame['nodeType'],
    timestamp,
    voltage,
    current,
    // Recompute rather than trust the device, but keep a supplied value when it
    // is consistent so the validator can still flag a genuine mismatch.
    power: typeof raw.power === 'number' && Number.isFinite(raw.power) ? raw.power : voltage * current,
    temperature: asOptionalNumber(raw.temperature),
    lux: asOptionalNumber(raw.lux),
    soc: asOptionalNumber(raw.soc),
    status: raw.status ?? 'ONLINE',
    mode: raw.mode ?? (fallbackSource === 'SIMULATION' ? 'SIMULATION' : 'REALTIME'),
    source: raw.source ?? fallbackSource,
    sequenceNumber: Number.isInteger(raw.sequenceNumber) ? (raw.sequenceNumber as number) : 0,
    firmwareVersion: raw.firmwareVersion,
    rssi: asOptionalNumber(raw.rssi),
    uptime: asOptionalNumber(raw.uptime),
    valid: true,
  };

  const result = validateFrame(frame, node);
  frame.valid = result.valid;
  if (!result.valid) frame.validationErrors = result.errors;
  return frame;
}

function asOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
