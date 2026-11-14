import type { AreaId, XY } from './core/geo';
import { legMetrics, planMetrics, type Assumptions, type PlanMetrics, type PlanStop } from './core/metrics';
import { monteCarlo, type MCResult } from './core/montecarlo';
import { routeLeg, PROFILES } from './core/routing';
import { routeImpact, type ImpactResult } from './core/intersect';
import { JEZERO_OPTIONS, NILI_OPTIONS, type Bundles, type RouteOption } from './data';
import { state } from './state';

export interface EvaluatedPlan {
  option: RouteOption; stops: PlanStop[]; legs: XY[][]; ok: boolean; failReason?: string;
  metrics: PlanMetrics | null; mc: MCResult | null; impact: ImpactResult;
}

const cache = new Map<string, { legs: XY[][]; ok: boolean; reason?: string }>();

export function optionsFor(area: AreaId) { return area === 'jezero' ? JEZERO_OPTIONS : NILI_OPTIONS; }

export function evaluate(b: Bundles, area: AreaId, opt: RouteOption, stopsIn: PlanStop[], a: Assumptions, trials: number, seed: number): EvaluatedPlan {
  const stops = opt.stops ?? stopsIn;
  let legs: XY[][] = [], ok = true, failReason: string | undefined;
  if (opt.kind === 'computed') {
    const prof = PROFILES.find((p) => p.id === opt.profile)!;
    const key = `${opt.id}|${a.v0_kmh}|${stops.map((s) => s.xy.map((v) => v.toFixed(1)).join(',')).join(';')}`;
    let c = cache.get(key);
    if (!c) {
      c = { legs: [], ok: true };
      for (let i = 1; i < stops.length; i++) {
        const r = routeLeg(b.terrain, stops[i - 1].xy, stops[i].xy, prof, a.v0_kmh);
        if (!r.ok) { c.ok = false; c.reason = `${stops[i - 1].label} → ${stops[i].label}: ${r.reason}`; break; }
        c.legs.push(r.path);
      }
      cache.set(key, c);
    }
    legs = c.legs; ok = c.ok; failReason = c.reason;
  } else {
    legs = opt.legs!;
  }
  const terrain = area === 'jezero' ? b.terrain : null; // no DTM is packaged for the Nili crop
  const lm = ok ? legs.map((p, i) => legMetrics(p, stops[i].label, stops[i + 1].label, a, terrain)) : [];
  const metrics = ok ? planMetrics(stops, lm, a) : null;
  const mc = ok ? monteCarlo(stops, lm, a, trials, seed) : null;
  const impact = area === 'nili' && !state.areas.nili.observationReceived
    ? { status: 'no_analysis' as const, crossings: [], coveredLength_m: 0, totalLength_m: 0,
        message: 'Only the June 30, 2007 observation is on board (simulated timeline). No repeat imagery yet, so no change analysis.' }
    : area === 'nili'
    ? routeImpact(legs, b.nili.regions.map((r) => ({ id: r.id, polys: r.polys })), b.nili.coveragePolys)
    : routeImpact(legs, null, null);
  return { option: opt, stops, legs, ok, failReason, metrics, mc, impact };
}
