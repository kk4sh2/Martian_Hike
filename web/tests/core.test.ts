import { describe, it, expect } from 'vitest';
import { terrain, nili, json } from './helpers';
import { routeLeg, PROFILES } from '../src/core/routing';
import { legMetrics, planMetrics, DEFAULT_ASSUMPTIONS, explainDifference } from '../src/core/metrics';
import { monteCarlo } from '../src/core/montecarlo';
import { routeImpact } from '../src/core/intersect';
import { JEZERO_STOPS } from '../src/state';
import { NILI_OPTIONS } from '../src/data';
import { toLocal, toLonLat } from '../src/core/geo';

const T = terrain();
function plan(profile: string, a = DEFAULT_ASSUMPTIONS) {
  const prof = PROFILES.find((p) => p.id === profile)!;
  const legs: [number, number][][] = [];
  for (let i = 1; i < JEZERO_STOPS.length; i++) {
    const r = routeLeg(T, JEZERO_STOPS[i - 1].xy, JEZERO_STOPS[i].xy, prof, a.v0_kmh);
    expect(r.ok, r.reason).toBe(true);
    legs.push(r.path);
  }
  const lm = legs.map((p, i) => legMetrics(p, JEZERO_STOPS[i].label, JEZERO_STOPS[i + 1].label, a, T));
  return { legs, lm, pm: planMetrics(JEZERO_STOPS, lm, a) };
}

describe('coordinates', () => {
  it('local projection round-trips and matches pipeline', () => {
    const w = json('jezero/rover_waypoints.json').stops[0];
    const [x, y] = toLocal('jezero', w.lon, w.lat);
    expect(Math.abs(x - w.x)).toBeLessThan(0.01); expect(Math.abs(y - w.y)).toBeLessThan(0.01);
    const [lon, lat] = toLonLat('jezero', x, y); expect(Math.abs(lon - w.lon)).toBeLessThan(1e-9); expect(Math.abs(lat - w.lat)).toBeLessThan(1e-9);
  });
});

describe('Jezero routes', () => {
  const d = plan('direct'), g = plan('gentle');
  it('both options include the return leg to the same habitat', () => {
    for (const p of [d, g]) { expect(p.pm.includesReturn).toBe(true); expect(p.legs.length).toBe(3); expect(p.pm.stopsReached).toContain('delta_layers'); }
  });
  it('gentle route respects its slope limit better than direct', () => {
    console.log('direct', Math.round(d.pm.distance_m), 'm gain', d.pm.gain_m?.toFixed(1), 'max slope', d.pm.maxSlopeDeg?.toFixed(1), 'h', (d.pm.nominalDuration_s / 3600).toFixed(2));
    console.log('gentle', Math.round(g.pm.distance_m), 'm gain', g.pm.gain_m?.toFixed(1), 'max slope', g.pm.maxSlopeDeg?.toFixed(1), 'h', (g.pm.nominalDuration_s / 3600).toFixed(2));
    expect(g.pm.maxSlopeDeg!).toBeLessThanOrEqual(d.pm.maxSlopeDeg! + 1e-9);
    expect(g.pm.distance_m).toBeGreaterThanOrEqual(d.pm.distance_m - 1);
    const ex = explainDifference(d.pm, g.pm); console.log('difference explained by', ex);
    expect(ex).not.toBeNull();
  });
  it('Monte Carlo is reproducible and responds to inputs', () => {
    const a = monteCarlo(JEZERO_STOPS, d.lm, DEFAULT_ASSUMPTIONS, 500, 42);
    const b = monteCarlo(JEZERO_STOPS, d.lm, DEFAULT_ASSUMPTIONS, 500, 42);
    expect(a.successPct).toBe(b.successPct);
    const low = { ...DEFAULT_ASSUMPTIONS, o2Kg: 0.16 };
    const lo = plan('direct', low);
    const c = monteCarlo(JEZERO_STOPS, lo.lm, low, 500, 42);
    console.log('nominal', a.successPct, 'low O2', c.successPct, c.mainFailure);
    expect(c.successPct).toBeLessThan(a.successPct);
    expect(c.mainFailure).toBe('oxygen_reserve');
    const dense = { ...DEFAULT_ASSUMPTIONS, obstaclesPerKm: 40, evaLimitH: 3 };
    const e = monteCarlo(JEZERO_STOPS, d.lm, dense, 500, 42);
    console.log('dense obstacles + 3h limit', e.successPct, e.mainFailure);
    expect(e.mainFailure).toBe('eva_time_limit');
    const cold = { ...DEFAULT_ASSUMPTIONS, environment: 'cold' as const, batteryWh: 290 };
    const f = monteCarlo(JEZERO_STOPS, d.lm, cold, 500, 42);
    console.log('cold + small battery', f.successPct, f.mainFailure);
    expect(f.mainFailure).toBe('battery_reserve');
  });
});

describe('Nili route impact', () => {
  const e = nili();
  const regs = e.regions.map((r: any) => ({ id: r.id, polys: r.polys }));
  const get = (id: string) => NILI_OPTIONS.find((o) => o.id === id)!;
  it('intersecting route returns subsegments with region ids and distances', () => {
    const r = routeImpact(get('crossing').legs!, regs, e.coveragePolys);
    console.log(r.status, r.crossings.map((c) => [c.regionId, c.startAlong_m.toFixed(1), c.endAlong_m.toFixed(1)]));
    expect(r.status).toBe('intersects');
    expect(r.crossings.length).toBeGreaterThanOrEqual(2); // outbound + return
    expect(r.crossings.every((c) => c.length_m > 1)).toBe(true);
  });
  it('bedrock route is clear inside coverage', () => {
    const r = routeImpact(get('south').legs!, regs, e.coveragePolys); console.log(r.status, r.message);
    expect(r.status).toBe('clear');
  });
  it('route leaving coverage is not reported as clear', () => {
    const r = routeImpact(get('east').legs!, regs, e.coveragePolys); console.log(r.status, r.message);
    expect(['partial_coverage', 'outside_coverage']).toContain(r.status);
  });
  it('Jezero never receives Nili change polygons', () => {
    const r = routeImpact([[[0, 0], [100, 100]]], null, null);
    expect(r.status).toBe('no_analysis');
  });
});
