import type { XY } from './geo';
import type { PlanMetrics } from './metrics';

/**
 * Survival aids derived from the plan's own consumables model. Everything here is a planning estimate from the
 * simulated suit model (labelled as such in the UI), not a measurement.
 */

export interface Shelter { id: string; label: string; xy: XY }

/** Consumption per metre of route for the limiting consumable, in % of full load. */
export function usePerMetre(m: PlanMetrics) {
  const o2 = (100 - m.o2Remaining_pct) / m.distance_m, batt = (100 - m.batteryRemaining_pct) / m.distance_m;
  return { o2, batt, limiting: o2 >= batt ? 'oxygen' as const : 'battery' as const, worst: Math.max(o2, batt) };
}

/**
 * Turn-back point: the farthest distance along the route from which retracing the same path still returns with the
 * reserve, if consumables are used `factor` times faster than planned. Returns null if the whole route fits.
 */
export function turnBackPoint(m: PlanMetrics, reservePct: number, factor: number, outboundEnd_m: number) {
  const c = usePerMetre(m).worst * factor;
  if (c <= 0) return null;
  const s = (100 - reservePct) / (2 * c);
  return { along_m: s, beyondRoute: s >= outboundEnd_m, factor };
}

/** Time until a consumable reaches the reserve at the planned average rate. */
export function timeToReserve_s(nowPct: number, reservePct: number, m: PlanMetrics, which: 'oxygen' | 'battery') {
  const used = which === 'oxygen' ? 100 - m.o2Remaining_pct : 100 - m.batteryRemaining_pct;
  const ratePerS = used / m.nominalDuration_s;
  return ratePerS > 0 ? Math.max(0, (nowPct - reservePct) / ratePerS) : Infinity;
}

export function nearestShelter(p: XY, shelters: Shelter[]) {
  let best: (Shelter & { dist_m: number }) | null = null;
  for (const s of shelters) { const d = Math.hypot(s.xy[0] - p[0], s.xy[1] - p[1]); if (!best || d < best.dist_m) best = { ...s, dist_m: d }; }
  return best;
}

/** "HH:MM:SS" local mean solar time -> minutes after midnight. */
export const lmstMin = (t: string | null | undefined) => { const m = /(\d+):(\d+)/.exec(t ?? ''); return m ? +m[1] * 60 + +m[2] : null; };
export const fmtLmst = (min: number) => `${String(Math.floor(((min % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String(Math.round(((min % 60) + 60) % 60)).padStart(2, '0')}`;

/** Where a value sits within a series' range: 'below' | 'typical' | 'above' (terciles of the non-missing values). */
export function relativeLevel(values: (number | null)[], v: number) {
  const s = values.filter((x): x is number => x !== null).sort((a, b) => a - b);
  if (!s.length) return null;
  const lo = s[Math.floor(s.length / 3)], hi = s[Math.floor((2 * s.length) / 3)];
  return { level: v < lo ? 'lower than usual' : v > hi ? 'higher than usual' : 'typical', min: s[0], max: s[s.length - 1] };
}
