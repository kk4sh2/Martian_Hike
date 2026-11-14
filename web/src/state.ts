import type { AreaId, XY } from './core/geo';
import { DEFAULT_ASSUMPTIONS, type Assumptions, type PlanStop } from './core/metrics';

/** Shared mission state consumed by the planner, the evidence viewer, the tablet and the guided demo. */
export interface LogEntry { t: string; area: AreaId; kind: 'decision' | 'event' | 'finding' | 'crew' | 'system'; text: string; simulated?: boolean }

export interface AreaState {
  stops: PlanStop[];               // first & last = habitat (return leg)
  routeOption: string;             // active route id
  customRoutes: Record<string, XY[][]>; // authored routes (Nili) per option id
  landingPin: XY;
  weatherSol: number | null;
  weatherMinute: number;
  acknowledged: string[];          // region ids acknowledged by the planner
  reviewRequested: string[];
  observationReceived: boolean;    // Nili: has the Oct 2007 observation "arrived" in the simulated timeline
}

export interface MissionState {
  area: AreaId;
  assumptions: Assumptions;
  seed: number; trials: number;
  areas: Record<AreaId, AreaState>;
  log: LogEntry[];
}

type Listener = (s: MissionState, why: string) => void;
const listeners: Listener[] = [];
const KEY = 'marsdelta.mission.v1';

export const JEZERO_STOPS: PlanStop[] = [
  { id: 'habitat', label: 'Habitat (simulated placement on crater floor)', xy: [230, 20], required: false },
  { id: 'scarp_base', label: 'Delta-front base (rover RMC 23_2872, sol 420)', xy: [-204.49, -158.56], required: false, taskMin: 20 },
  { id: 'delta_layers', label: 'Layered delta outcrop (rover RMC 26_630, sol 461)', xy: [64.35, 367.02], required: true },
  { id: 'habitat', label: 'Habitat (return)', xy: [230, 20], required: false },
];
export const NILI_STOPS: PlanStop[] = [
  { id: 'habitat', label: 'Simulated habitat on bedrock (hypothetical)', xy: [120, -200], required: false },
  { id: 'north_contact', label: 'Bedrock/dune contact north of the dune (hypothetical stop)', xy: [30, 170], required: true },
  { id: 'habitat', label: 'Habitat (return)', xy: [120, -200], required: false },
];

function fresh(): MissionState {
  return {
    area: 'jezero', assumptions: { ...DEFAULT_ASSUMPTIONS }, seed: 2026, trials: 500,
    areas: {
      jezero: { stops: JEZERO_STOPS.map((s) => ({ ...s })), routeOption: 'direct', customRoutes: {}, landingPin: [120, -40],
        weatherSol: null, weatherMinute: 0, acknowledged: [], reviewRequested: [], observationReceived: false },
      nili: { stops: NILI_STOPS.map((s) => ({ ...s })), routeOption: 'crossing', customRoutes: {}, landingPin: [120, -200],
        weatherSol: null, weatherMinute: 0, acknowledged: [], reviewRequested: [], observationReceived: true },
    },
    log: [],
  };
}

function load(): MissionState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const s = JSON.parse(raw); if (s?.areas?.jezero && s?.areas?.nili) return { ...fresh(), ...s, assumptions: { ...DEFAULT_ASSUMPTIONS, ...s.assumptions } }; }
  } catch { /* storage unavailable */ }
  return fresh();
}

export const state: MissionState = load();

export function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ } }
export function onChange(f: Listener) { listeners.push(f); }
export function emit(why: string) { save(); listeners.forEach((f) => f(state, why)); }
export function log(kind: LogEntry['kind'], text: string, simulated = false, area: AreaId = state.area) {
  state.log.push({ t: new Date().toISOString().slice(11, 19), area, kind, text, simulated });
  emit('log');
}
export function resetArea(area: AreaId) {
  const f = fresh();
  state.areas[area] = f.areas[area];
  state.log = state.log.filter((l) => l.area !== area);
  emit('reset');
}
export function resetAll() { Object.assign(state, fresh()); emit('reset'); }
