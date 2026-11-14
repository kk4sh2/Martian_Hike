import { ENV_SCENARIOS, O2_KG_PER_KJ, type Assumptions, type LegMetrics, type PlanStop } from './metrics';

/** mulberry32: small, fast, fully reproducible PRNG. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = (m: number, s: number) => {
    const u = Math.max(next(), 1e-12), v = next();
    return m + s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const poisson = (lam: number) => {
    // Knuth for small lambda, normal approximation otherwise
    if (lam > 30) return Math.max(0, Math.round(normal(lam, Math.sqrt(lam))));
    const L = Math.exp(-lam); let k = 0, p = 1;
    do { k++; p *= next(); } while (p > L);
    return k - 1;
  };
  return { next, normal, poisson };
}

const clip = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export type FailReason = 'oxygen_reserve' | 'battery_reserve' | 'eva_time_limit';
export const FAIL_LABEL: Record<FailReason, string> = {
  oxygen_reserve: 'Oxygen fell below the configured reserve before return',
  battery_reserve: 'Battery fell below the configured reserve before return',
  eva_time_limit: 'EVA time limit reached before the task and return were complete',
};

export interface MCResult {
  trials: number; seed: number; successes: number; successPct: number;
  failures: Record<FailReason, number>; mainFailure: FailReason | null;
  limitingInSuccesses: { oxygen: number; battery: number; time: number };
  p10Duration_h: number; p50Duration_h: number; p90Duration_h: number;
  medianO2Left_pct: number; medianBattLeft_pct: number; definition: string; factors: string[];
}

export const SUCCESS_DEFINITION =
  'A simulated mission succeeds when the astronaut reaches the required science stop, completes its task, and returns to the habitat ' +
  'with at least the configured reserve of BOTH oxygen and battery, within the EVA time limit.';

/**
 * Seeded Monte Carlo. The random stream depends only on the seed, so two plans evaluated with the same seed see the
 * same draws (common random numbers) and differ only because of their routes.
 */
export function monteCarlo(stops: PlanStop[], legs: LegMetrics[], a: Assumptions, trials = 500, seed = 2026): MCResult {
  const R = rng(seed);
  const env = ENV_SCENARIOS[a.environment];
  const km = legs.reduce((s, l) => s + l.distance_m, 0) / 1000;
  const fails: Record<FailReason, number> = { oxygen_reserve: 0, battery_reserve: 0, eva_time_limit: 0 };
  const lim = { oxygen: 0, battery: 0, time: 0 };
  let ok = 0;
  const durs: number[] = [], o2l: number[] = [], btl: number[] = [];
  const o2Res = a.o2Kg * a.reservePct / 100, bRes = a.batteryWh * a.reservePct / 100, tLim = a.evaLimitH * 3600;
  for (let n = 0; n < trials; n++) {
    const speedF = clip(R.normal(1, 0.08), 0.7, 1.2);       // walking pace variability
    const metF = clip(R.normal(1, 0.12), 0.7, 1.5);         // individual metabolic variability
    const nObs = R.poisson(a.obstaclesPerKm * km);         // obstacle encounters on the route
    let delay = 0;
    for (let k = 0; k < nObs; k++) delay += (a.obstacleDelayMin[0] + R.next() * (a.obstacleDelayMin[1] - a.obstacleDelayMin[0])) * 60;
    const taskF = clip(R.normal(1, 0.15), 0.6, 1.6);
    // Walking time scales with pace; walking energy is distance-driven so only the rest component scales with time.
    let t = 0, kJ = 0;
    for (const l of legs) {
      const tw = l.walkTime_s / speedF;
      const restPart = (a.restW * l.walkTime_s) / 1000;           // kJ included in walkEnergy at nominal time
      kJ += metF * (l.walkEnergy_kJ - restPart + (a.restW * tw) / 1000);
      t += tw;
    }
    // Delays are spent standing (rest metabolic only), never also as slower walking: no double counting.
    t += delay; kJ += metF * (a.restW * delay) / 1000;
    let stopS = 0;
    stops.slice(1, -1).forEach((s) => { stopS += (s.required ? a.requiredTaskMin * taskF : (s.taskMin ?? a.otherStopMin)) * 60; });
    t += stopS; kJ += metF * (a.taskW * stopS) / 1000;
    const metabW = (kJ * 1000) / Math.max(t, 1);
    const batt = ((a.baseW + env.heaterW + a.coolingFrac * metabW) * t) / 3600;
    const o2 = kJ * O2_KG_PER_KJ;
    const o2Left = a.o2Kg - o2, bLeft = a.batteryWh - batt;
    durs.push(t / 3600); o2l.push(100 * o2Left / a.o2Kg); btl.push(100 * bLeft / a.batteryWh);
    const mO = (o2Left - o2Res) / a.o2Kg, mB = (bLeft - bRes) / a.batteryWh, mT = (tLim - t) / tLim;
    if (mO < 0 || mB < 0 || mT < 0) {
      // attribute the failure to the most-exceeded constraint
      const worst = Math.min(mO, mB, mT);
      fails[worst === mO ? 'oxygen_reserve' : worst === mB ? 'battery_reserve' : 'eva_time_limit']++;
    } else {
      ok++;
      const m = Math.min(mO, mB, mT);
      if (m === mO) lim.oxygen++; else if (m === mB) lim.battery++; else lim.time++;
    }
  }
  const q = (arr: number[], p: number) => { const s = [...arr].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  const fe = Object.entries(fails).sort((x, y) => y[1] - x[1]);
  return {
    trials, seed, successes: ok, successPct: (100 * ok) / trials, failures: fails,
    mainFailure: fe[0][1] > 0 ? (fe[0][0] as FailReason) : null, limitingInSuccesses: lim,
    p10Duration_h: q(durs, 0.1), p50Duration_h: q(durs, 0.5), p90Duration_h: q(durs, 0.9),
    medianO2Left_pct: q(o2l, 0.5), medianBattLeft_pct: q(btl, 0.5), definition: SUCCESS_DEFINITION,
    factors: [
      'Distance and climb (derived from the DTM) set walking time and metabolic energy; oxygen use is proportional to metabolic energy.',
      'Carried equipment adds mass, raising walking and climbing energy.',
      'Obstacle encounters (Poisson, per km) add standing delay at resting metabolic rate only.',
      'Science task time varies +/-15%; the task runs at the task metabolic rate.',
      'Battery load = avionics + scenario heater + cooling proportional to metabolic heat, integrated over EVA duration.',
      'Pace (+/-8%) and individual metabolism (+/-12%) vary per trial.',
    ],
  };
}
