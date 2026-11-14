import { dist, type XY } from './geo';
import { Terrain } from './terrain';
import { walkSpeed } from './routing';

/** Every number used by the resource model, with its provenance class. */
export interface Assumptions {
  v0_kmh: number;            // assumed: suited flat-ground walking speed
  bodyKg: number;            // assumed
  suitKg: number;            // assumed
  equipmentKg: number;       // user-set workload
  restW: number;             // assumed: suited resting metabolic rate
  walkJPerKgM: number;       // assumed: level suited-walking cost
  climbEfficiency: number;   // assumed: muscular efficiency for lifting work
  taskW: number;             // assumed: metabolic rate during science task
  o2Kg: number;              // user-set: usable oxygen at start
  batteryWh: number;         // user-set: usable battery at start
  reservePct: number;        // user-set: required reserve on return (both consumables)
  baseW: number;             // assumed: suit avionics, comms, fans
  coolingFrac: number;       // assumed: cooling power as fraction of metabolic heat
  obstaclesPerKm: number;    // user-set (simulated obstacle encounter rate)
  obstacleDelayMin: [number, number]; // assumed: each encounter costs U(a,b) minutes at rest
  requiredTaskMin: number;   // user-set: science task at the required stop
  otherStopMin: number;      // user-set: time at optional stops
  evaLimitH: number;         // assumed: maximum EVA duration
  environment: EnvScenario;
}

export type EnvScenario = 'nominal' | 'cold' | 'dusty_wind';
export const ENV_SCENARIOS: Record<EnvScenario, { label: string; heaterW: number; speedFactor: number; note: string }> = {
  nominal: { label: 'Nominal (simulated scenario)', heaterW: 0, speedFactor: 1.0, note: 'No extra heater load; no speed penalty.' },
  cold: { label: 'Cold (simulated scenario)', heaterW: 45, speedFactor: 1.0, note: 'Adds 45 W of suit heating. Scenario only, not a forecast.' },
  dusty_wind: { label: 'Dusty, windy (simulated scenario)', heaterW: 15, speedFactor: 0.9, note: '10% slower walking and 15 W extra fan/heater draw. Scenario only.' },
};

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  v0_kmh: 2.0, bodyKg: 80, suitKg: 60, equipmentKg: 10, restW: 120, walkJPerKgM: 2.5, climbEfficiency: 0.25,
  taskW: 250, o2Kg: 1.2, batteryWh: 1100, reservePct: 10, baseW: 70, coolingFrac: 0.08,
  obstaclesPerKm: 2, obstacleDelayMin: [2, 8], requiredTaskMin: 45, otherStopMin: 20, evaLimitH: 8, environment: 'nominal',
};

export const PROVENANCE: Record<keyof Assumptions | 'gMars' | 'o2PerKJ' | 'distance' | 'slope', 'measured' | 'derived' | 'assumed' | 'user'> = {
  v0_kmh: 'assumed', bodyKg: 'assumed', suitKg: 'assumed', equipmentKg: 'user', restW: 'assumed', walkJPerKgM: 'assumed',
  climbEfficiency: 'assumed', taskW: 'assumed', o2Kg: 'user', batteryWh: 'user', reservePct: 'user', baseW: 'assumed',
  coolingFrac: 'assumed', obstaclesPerKm: 'user', obstacleDelayMin: 'assumed', requiredTaskMin: 'user', otherStopMin: 'user',
  evaLimitH: 'assumed', environment: 'user', gMars: 'measured', o2PerKJ: 'derived', distance: 'derived', slope: 'derived',
};

export const G_MARS = 3.711;              // m/s^2
export const O2_KG_PER_KJ = 1.429e-3 / 20.1; // 1 L O2 (1.429 g) releases ~20.1 kJ

export interface SegmentSample { s: number; xy: XY; z: number | null; slopeDeg: number | null }
export interface LegMetrics {
  from: string; to: string; distance_m: number; planar_m: number; gain_m: number | null; loss_m: number | null;
  maxSlopeDeg: number | null; maxSlopeAt_m: number | null; walkTime_s: number; walkEnergy_kJ: number;
  terrainKnown: boolean; samples: SegmentSample[];
}

/** Sample a path every `step` m and compute metrics in the local metric CRS. */
export function legMetrics(path: XY[], from: string, to: string, a: Assumptions, t: Terrain | null, step = 2): LegMetrics {
  const pts: XY[] = [];
  for (let i = 1; i < path.length; i++) {
    const L = dist(path[i - 1], path[i]), n = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k < n; k++) pts.push([path[i - 1][0] + (k / n) * (path[i][0] - path[i - 1][0]), path[i - 1][1] + (k / n) * (path[i][1] - path[i - 1][1])]);
  }
  pts.push(path[path.length - 1]);
  const z = pts.map((p) => (t ? t.elev(p[0], p[1]) : NaN));
  const terrainKnown = !!t && z.every(Number.isFinite);
  const mass = a.bodyKg + a.suitKg + a.equipmentKg;
  const env = ENV_SCENARIOS[a.environment];
  let d3 = 0, planar = 0, gain = 0, loss = 0, time = 0, energy = 0;
  const samples: SegmentSample[] = [];
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) {
      const run = dist(pts[i - 1], pts[i]);
      const dz = terrainKnown ? z[i] - z[i - 1] : 0;
      const grade = run > 0 ? dz / run : 0;
      const L = Math.hypot(run, dz);
      const v = walkSpeed(grade, a.v0_kmh) * env.speedFactor;
      const dt = L / v;
      d3 += L; planar += run; s += run; time += dt;
      if (dz > 0) gain += dz; else loss -= dz;
      // metabolic: rest + level walking + lifting work (uphill only; downhill braking cost is folded into walkJPerKgM)
      energy += (a.restW * dt + a.walkJPerKgM * mass * L + (dz > 0 ? (mass * G_MARS * dz) / a.climbEfficiency : 0)) / 1000;
    }
    samples.push({ s, xy: pts[i], z: terrainKnown ? z[i] : null, slopeDeg: null });
  }
  // steepest mapped segment over a 10 m baseline (DTM effective resolution is ~3 m)
  let maxSl: number | null = null, maxAt: number | null = null;
  if (terrainKnown) {
    const w = Math.max(1, Math.round(10 / step));
    for (let i = w; i < samples.length; i++) {
      const run = samples[i].s - samples[i - w].s;
      if (run <= 0) continue;
      const sl = Math.atan(Math.abs((samples[i].z! - samples[i - w].z!) / run)) * 180 / Math.PI;
      samples[i].slopeDeg = sl;
      if (maxSl === null || sl > maxSl) { maxSl = sl; maxAt = samples[i].s; }
    }
  }
  return {
    from, to, distance_m: d3, planar_m: planar, gain_m: terrainKnown ? gain : null, loss_m: terrainKnown ? loss : null,
    maxSlopeDeg: maxSl, maxSlopeAt_m: maxAt, walkTime_s: time, walkEnergy_kJ: energy, terrainKnown, samples,
  };
}

export interface PlanStop { id: string; label: string; xy: XY; required: boolean; taskMin?: number }
export interface PlanMetrics {
  legs: LegMetrics[]; distance_m: number; gain_m: number | null; maxSlopeDeg: number | null; maxSlopeLeg: number | null;
  walkTime_s: number; stopTime_s: number; nominalDuration_s: number; o2Used_kg: number; batteryUsed_Wh: number;
  o2Remaining_pct: number; batteryRemaining_pct: number; stopsReached: string[]; includesReturn: boolean; terrainKnown: boolean;
}

/** Deterministic nominal estimate (no randomness, no obstacle delays). */
export function planMetrics(stops: PlanStop[], legs: LegMetrics[], a: Assumptions): PlanMetrics {
  const env = ENV_SCENARIOS[a.environment];
  const walk = legs.reduce((s, l) => s + l.walkTime_s, 0);
  const stopS = stops.slice(1, -1).reduce((s, st) => s + (st.required ? a.requiredTaskMin : (st.taskMin ?? a.otherStopMin)) * 60, 0);
  const metab = legs.reduce((s, l) => s + l.walkEnergy_kJ, 0) + (stopS * a.taskW) / 1000;
  const dur = walk + stopS;
  const metabW = (metab * 1000) / Math.max(dur, 1);
  const batt = ((a.baseW + env.heaterW + a.coolingFrac * metabW) * dur) / 3600;
  const o2 = metab * O2_KG_PER_KJ;
  let maxSl: number | null = null, maxLeg: number | null = null;
  legs.forEach((l, i) => { if (l.maxSlopeDeg !== null && (maxSl === null || l.maxSlopeDeg > maxSl)) { maxSl = l.maxSlopeDeg; maxLeg = i; } });
  const known = legs.every((l) => l.terrainKnown);
  return {
    legs, distance_m: legs.reduce((s, l) => s + l.distance_m, 0), gain_m: known ? legs.reduce((s, l) => s + (l.gain_m ?? 0), 0) : null,
    maxSlopeDeg: maxSl, maxSlopeLeg: maxLeg, walkTime_s: walk, stopTime_s: stopS, nominalDuration_s: dur,
    o2Used_kg: o2, batteryUsed_Wh: batt, o2Remaining_pct: 100 * (1 - o2 / a.o2Kg), batteryRemaining_pct: 100 * (1 - batt / a.batteryWh),
    stopsReached: stops.slice(1, -1).map((s) => s.id),
    includesReturn: dist(stops[0].xy, stops[stops.length - 1].xy) < 1, terrainKnown: known,
  };
}

/** Which leg explains most of the difference between two plans with the same stops. */
export function explainDifference(a: PlanMetrics, b: PlanMetrics) {
  let best = -1, bestD = 0;
  a.legs.forEach((l, i) => {
    const d = Math.abs(l.walkTime_s - (b.legs[i]?.walkTime_s ?? l.walkTime_s));
    if (d > bestD) { bestD = d; best = i; }
  });
  if (best < 0) return null;
  const la = a.legs[best], lb = b.legs[best];
  return {
    leg: best, from: la.from, to: la.to, dTime_s: lb.walkTime_s - la.walkTime_s, dDist_m: lb.distance_m - la.distance_m,
    dGain_m: la.gain_m !== null && lb.gain_m !== null ? lb.gain_m - la.gain_m : null,
    maxSlopeA: la.maxSlopeDeg, maxSlopeB: lb.maxSlopeDeg,
  };
}
