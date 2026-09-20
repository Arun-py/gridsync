/**
 * GET /api/telemetry/history?nodeId=sigma&range=24H
 *
 * Historical series for one node's charts.
 *
 * Down-sampling happens in MongoDB, not the browser. A 30-day window at 1 Hz is
 * ~2.6 million documents; the repository strides that down to at most
 * `maxPoints` evenly-spaced samples before anything crosses the wire.
 */

import { ApiError, handler, intParam } from '../_lib/handler';
import { getNodeConfig } from '../../shared/nodes.config';
import type { TimeRange } from '../../shared/types';
import { rangeToWindow, telemetryRepo } from '../../server/repositories';

const VALID_RANGES: TimeRange[] = ['1H', '6H', '24H', '7D', '30D'];

export default handler({ methods: ['GET'], auth: true }, async ({ query }) => {
  const nodeId = (query.nodeId ?? '').trim();
  if (!nodeId) {
    throw new ApiError(400, 'MISSING_NODE_ID', 'A nodeId query parameter is required.');
  }

  const node = getNodeConfig(nodeId);
  if (!node) {
    throw new ApiError(404, 'UNKNOWN_NODE', `No node is configured with id "${nodeId}".`);
  }

  const range = (query.range ?? '24H').toUpperCase() as TimeRange;
  if (!VALID_RANGES.includes(range)) {
    throw new ApiError(
      400,
      'BAD_RANGE',
      `range must be one of ${VALID_RANGES.join(', ')}.`,
    );
  }

  const maxPoints = intParam(query.maxPoints, 300, 50, 1000);
  const { ms } = rangeToWindow(range);
  const until = new Date();
  const since = new Date(until.getTime() - ms);

  const frames = await telemetryRepo.history(nodeId, since, until, maxPoints);

  return {
    nodeId,
    node,
    range,
    from: since.toISOString(),
    to: until.toISOString(),
    points: frames.length,
    // Invalid frames are returned but flagged, so a chart can show the gap
    // rather than silently interpolating over a sensor fault.
    series: frames.map((f) => ({
      timestamp: f.timestamp,
      voltage: f.voltage,
      current: f.current,
      power: f.power,
      temperature: f.temperature,
      lux: f.lux,
      soc: f.soc,
      valid: f.valid,
    })),
  };
});
