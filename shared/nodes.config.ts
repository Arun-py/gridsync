/**
 * GridSync node catalogue.
 *
 * Nodes are DATA, not code. The simulator instantiates the first N entries and
 * the frontend discovers whatever the API reports. Adding a fifth node is an
 * edit to this array — no component changes, no route changes.
 *
 * The first four entries mirror the physical prototype (SIGMA / BETA / AC / DC).
 * Entries 5-10 are expansion nodes used to demonstrate scalability.
 *
 * Electrical ranges follow the 12 V nominal architecture carried over from the
 * original GridSync prototype (10.5-14.5 V operating band).
 *
 * SIZING — why these numbers and not others
 * The array and the loads are sized so the microgrid actually BALANCES over a
 * day, because a system that can never charge its battery is not a useful
 * demonstration: SOC would fall to zero on the first evening and stay there.
 *
 *   Average load   ~230 W x 0.30 duty            ~=  1.7 kWh/day
 *   PV yield       400 W x ~5.5 peak-sun-hours   ~=  2.2 kWh/day
 *   Storage        12 V x 200 Ah                 ~=  2.4 kWh  (one night of autonomy)
 *
 * That leaves a modest daytime surplus to charge storage and enough capacity to
 * carry the evening peak — which is what makes charge/discharge transitions,
 * SOC trends and deficit alerts all observable in a short demonstration.
 */

import type { NodeConfig } from './types';

export const NOMINAL_BUS_VOLTAGE = 12;

export const NODE_CATALOGUE: NodeConfig[] = [
  {
    id: 'sigma',
    name: 'SIGMA Solar Node',
    shortName: 'SIGMA',
    type: 'SOLAR',
    category: 'Generation',
    description: 'Photovoltaic array with environmental monitoring (irradiance and cell temperature).',
    sensors: ['voltage', 'current', 'power', 'temperature', 'lux'],
    ratedPower: 400,
    voltageRange: [0, 24],
    currentRange: [0, 26],
    criticality: 'CRITICAL',
    nominalVoltage: 18,
  },
  {
    id: 'beta',
    name: 'BETA Battery Node',
    shortName: 'BETA',
    type: 'BATTERY',
    category: 'Storage',
    description: '12 V lead-acid storage bank with bidirectional current and pack temperature monitoring.',
    sensors: ['voltage', 'current', 'power', 'temperature', 'soc'],
    ratedPower: 1200,
    voltageRange: [10.0, 15.0],
    currentRange: [-100, 100],
    criticality: 'CRITICAL',
    nominalVoltage: 12,
    capacityAh: 200,
  },
  {
    id: 'ac_load',
    name: 'AC Load Node',
    shortName: 'AC LOAD',
    type: 'AC_LOAD',
    category: 'Consumption',
    description: 'Inverter-fed AC distribution branch serving household and workshop loads.',
    sensors: ['voltage', 'current', 'power'],
    ratedPower: 150,
    voltageRange: [180, 260],
    currentRange: [0, 2],
    criticality: 'CRITICAL',
    nominalVoltage: 230,
  },
  {
    id: 'dc_load',
    name: 'DC Load Node',
    shortName: 'DC LOAD',
    type: 'DC_LOAD',
    category: 'Consumption',
    description: 'Direct 12 V DC branch serving lighting, pumps and communication equipment.',
    sensors: ['voltage', 'current', 'power'],
    ratedPower: 80,
    voltageRange: [10.0, 14.5],
    currentRange: [0, 10],
    criticality: 'NON_CRITICAL',
    nominalVoltage: 12,
  },

  // --- Expansion nodes: prove the architecture scales past four ---
  {
    id: 'sigma_2',
    name: 'SIGMA-2 Solar Node',
    shortName: 'SIGMA-2',
    type: 'SOLAR',
    category: 'Generation',
    description: 'Secondary photovoltaic string on the east-facing roof section.',
    sensors: ['voltage', 'current', 'power', 'temperature', 'lux'],
    ratedPower: 300,
    voltageRange: [0, 24],
    currentRange: [0, 20],
    criticality: 'NON_CRITICAL',
    nominalVoltage: 18,
  },
  {
    id: 'dc_load_2',
    name: 'DC Load Node 2',
    shortName: 'DC LOAD-2',
    type: 'DC_LOAD',
    category: 'Consumption',
    description: 'Non-critical 12 V DC branch serving auxiliary and comfort loads.',
    sensors: ['voltage', 'current', 'power'],
    ratedPower: 70,
    voltageRange: [10.0, 14.5],
    currentRange: [0, 9],
    criticality: 'NON_CRITICAL',
    nominalVoltage: 12,
  },
  {
    id: 'beta_2',
    name: 'BETA-2 Battery Node',
    shortName: 'BETA-2',
    type: 'BATTERY',
    category: 'Storage',
    description: 'Auxiliary 12 V storage bank providing additional autonomy.',
    sensors: ['voltage', 'current', 'power', 'temperature', 'soc'],
    ratedPower: 600,
    voltageRange: [10.0, 15.0],
    currentRange: [-50, 50],
    criticality: 'NON_CRITICAL',
    nominalVoltage: 12,
    capacityAh: 100,
  },
  {
    id: 'ac_load_2',
    name: 'AC Load Node 2',
    shortName: 'AC LOAD-2',
    type: 'AC_LOAD',
    category: 'Consumption',
    description: 'Secondary AC branch serving the community facility.',
    sensors: ['voltage', 'current', 'power'],
    ratedPower: 120,
    voltageRange: [180, 260],
    currentRange: [0, 2],
    criticality: 'NON_CRITICAL',
    nominalVoltage: 230,
  },
  {
    id: 'sigma_3',
    name: 'SIGMA-3 Solar Node',
    shortName: 'SIGMA-3',
    type: 'SOLAR',
    category: 'Generation',
    description: 'Ground-mounted photovoltaic string with independent tilt.',
    sensors: ['voltage', 'current', 'power', 'temperature', 'lux'],
    ratedPower: 450,
    voltageRange: [0, 24],
    currentRange: [0, 28],
    criticality: 'NON_CRITICAL',
    nominalVoltage: 18,
  },
  {
    id: 'dc_load_3',
    name: 'DC Load Node 3',
    shortName: 'DC LOAD-3',
    type: 'DC_LOAD',
    category: 'Consumption',
    description: 'Critical 12 V DC branch serving the medical refrigeration unit.',
    sensors: ['voltage', 'current', 'power'],
    ratedPower: 60,
    voltageRange: [10.0, 14.5],
    currentRange: [0, 8],
    criticality: 'CRITICAL',
    nominalVoltage: 12,
  },
];

export const MIN_NODE_COUNT = 4;
export const MAX_NODE_COUNT = NODE_CATALOGUE.length;

/** Resolve the active node set for a given count, clamped to the catalogue. */
export function resolveNodes(count: number): NodeConfig[] {
  const n = Math.max(MIN_NODE_COUNT, Math.min(MAX_NODE_COUNT, Math.floor(count) || MIN_NODE_COUNT));
  return NODE_CATALOGUE.slice(0, n);
}

export function getNodeConfig(nodeId: string): NodeConfig | undefined {
  return NODE_CATALOGUE.find((n) => n.id === nodeId);
}

/** Accent colour token per subsystem. Keeps charts and diagrams consistent. */
export const NODE_ACCENT: Record<NodeConfig['type'], string> = {
  SOLAR: '#f5a524',
  BATTERY: '#22c55e',
  AC_LOAD: '#38bdf8',
  DC_LOAD: '#a78bfa',
};
