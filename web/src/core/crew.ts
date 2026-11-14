/**
 * SIMULATED suit-integrated crew tracking. A software model of proposed hardware, not a built tracker.
 *
 * Assumed local positioning network (documented in docs/CREW_TRACKING.md):
 *  - Three fixed reference anchors with surveyed local coordinates (habitat mast, pressurised rover, relay mast).
 *  - Each suit carries the transmitter/ranging radio (two-way ranging, UWB-class), powered by the suit battery.
 *  - Range noise: sigma = 0.3 m + 0.2% of range. Fix = least-squares trilateration; uncertainty from the
 *    covariance of the solution (2-sigma radius).
 *  - The tablet is only a display/receiver. Dropping it or turning it off never changes a suit's beacon.
 *  - No Earth GPS and no browser geolocation are used anywhere.
 */
import { bearing, dist, type XY } from './geo';
import { rng } from './montecarlo';

export interface Anchor { id: string; label: string; xy: XY }
export type Comms = 'live' | 'lost';
export type Wearer = 'confirmed' | 'unconfirmed';

export interface Fix { xy: XY; t: number; sigma2_m: number; anchorsUsed: number }
export interface Suit {
  id: string; astronaut: string; truePos: XY; comms: Comms; wearer: Wearer; distress: boolean;
  lastFix: Fix | null; occupiedTruth: boolean; // simulation truth, never shown as fact to the crew
}
export interface Tablet { id: string; owner: string; carriedBy: string | null; pos: XY; on: boolean }

export interface CrewState { t: number; anchors: Anchor[]; suits: Suit[]; tablets: Tablet[]; log: string[]; seed: number }

export function solveFix(anchors: Anchor[], ranges: number[], sigmas: number[], guess: XY): { xy: XY; sigma2: number } {
  // Gauss-Newton least squares on ranges
  let [x, y] = guess;
  let cov = [[1e6, 0], [0, 1e6]];
  for (let it = 0; it < 12; it++) {
    let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
    anchors.forEach((an, i) => {
      const dx = x - an.xy[0], dy = y - an.xy[1], r = Math.hypot(dx, dy) || 1e-6;
      const jx = dx / r, jy = dy / r, w = 1 / (sigmas[i] ** 2), res = ranges[i] - r;
      a11 += w * jx * jx; a12 += w * jx * jy; a22 += w * jy * jy; b1 += w * jx * res; b2 += w * jy * res;
    });
    const det = a11 * a22 - a12 * a12;
    if (Math.abs(det) < 1e-12) break;
    const dxs = (a22 * b1 - a12 * b2) / det, dys = (-a12 * b1 + a11 * b2) / det;
    x += dxs; y += dys;
    cov = [[a22 / det, -a12 / det], [-a12 / det, a11 / det]];
    if (Math.hypot(dxs, dys) < 1e-4) break;
  }
  // 2-sigma radius of the larger principal axis
  const tr = cov[0][0] + cov[1][1], dt = cov[0][0] * cov[1][1] - cov[0][1] ** 2;
  const lmax = tr / 2 + Math.sqrt(Math.max(tr * tr / 4 - dt, 0));
  return { xy: [x, y], sigma2: 2 * Math.sqrt(lmax) };
}

export function newCrew(anchors: Anchor[], start: XY, seed = 7): CrewState {
  const suits: Suit[] = [
    { id: 'SUIT-A1', astronaut: 'Astronaut A (EV1)', truePos: [start[0] + 3, start[1]], comms: 'live', wearer: 'confirmed', distress: false, lastFix: null, occupiedTruth: true },
    { id: 'SUIT-B2', astronaut: 'Astronaut B (EV2)', truePos: [start[0] - 3, start[1] - 2], comms: 'live', wearer: 'confirmed', distress: false, lastFix: null, occupiedTruth: true },
    { id: 'SUIT-S3', astronaut: 'Spare suit (unassigned)', truePos: [start[0], start[1] + 4], comms: 'lost', wearer: 'unconfirmed', distress: false, lastFix: null, occupiedTruth: false },
  ];
  const tablets: Tablet[] = [
    { id: 'TAB-1', owner: 'Astronaut A (EV1)', carriedBy: 'SUIT-A1', pos: suits[0].truePos, on: true },
    { id: 'TAB-2', owner: 'Astronaut B (EV2)', carriedBy: 'SUIT-B2', pos: suits[1].truePos, on: true },
  ];
  const st: CrewState = { t: 0, anchors, suits, tablets, log: [], seed };
  updateFixes(st);
  return st;
}

/** Ranging + trilateration for every suit whose link is up. Lost links keep their last fix untouched. */
export function updateFixes(st: CrewState) {
  const R = rng(st.seed * 100003 + Math.round(st.t * 10));
  for (const s of st.suits) {
    if (s.comms !== 'live') continue;
    const sig = st.anchors.map((a) => 0.3 + 0.002 * dist(a.xy, s.truePos));
    const ranges = st.anchors.map((a, i) => dist(a.xy, s.truePos) + R.normal(0, sig[i]));
    const sol = solveFix(st.anchors, ranges, sig, s.lastFix?.xy ?? [s.truePos[0] + 5, s.truePos[1] + 5]);
    s.lastFix = { xy: sol.xy, t: st.t, sigma2_m: sol.sigma2, anchorsUsed: st.anchors.length };
  }
  for (const tb of st.tablets) {
    if (tb.carriedBy) { const s = st.suits.find((q) => q.id === tb.carriedBy)!; tb.pos = [...s.truePos] as XY; }
  }
}

export function moveSuit(st: CrewState, suitId: string, to: XY) {
  const s = st.suits.find((q) => q.id === suitId)!; s.truePos = to;
}
export function step(st: CrewState, dt_s: number) { st.t += dt_s; updateFixes(st); }

export function dropTablet(st: CrewState, tabletId: string) {
  const tb = st.tablets.find((q) => q.id === tabletId)!;
  if (tb.carriedBy) { st.log.push(`T+${fmtT(st.t)} ${tb.id} left behind by ${tb.carriedBy}. Suit beacon unaffected.`); tb.carriedBy = null; }
}
export function pickUpTablet(st: CrewState, tabletId: string, suitId: string) {
  const tb = st.tablets.find((q) => q.id === tabletId)!;
  tb.carriedBy = suitId; st.log.push(`T+${fmtT(st.t)} ${tb.id} picked up by ${suitId}.`); updateFixes(st);
}
export function setComms(st: CrewState, suitId: string, c: Comms) {
  const s = st.suits.find((q) => q.id === suitId)!;
  s.comms = c; st.log.push(`T+${fmtT(st.t)} ${suitId} link ${c === 'live' ? 'restored' : 'lost'}.`);
  if (c === 'live') updateFixes(st);
}
/** Spare/empty suit powered on: beacon transmits but there is no biomedical telemetry. */
export function powerSpareSuit(st: CrewState, suitId: string) {
  const s = st.suits.find((q) => q.id === suitId)!;
  s.comms = 'live'; s.wearer = 'unconfirmed'; st.log.push(`T+${fmtT(st.t)} ${suitId} beacon transmitting with no wearer biomedical signal.`);
  updateFixes(st);
}

export type FixState = 'live' | 'stale' | 'none';
export function fixState(st: CrewState, s: Suit, staleAfter_s = 10): FixState {
  if (!s.lastFix) return 'none';
  return s.comms === 'live' && st.t - s.lastFix.t <= staleAfter_s ? 'live' : 'stale';
}

export interface Relative { range_m: number; bearing_deg: number; combinedSigma2_m: number; age_s: number; state: FixState }
export function relative(st: CrewState, from: Suit, to: Suit): Relative | null {
  if (!from.lastFix || !to.lastFix) return null;
  return {
    range_m: dist(from.lastFix.xy, to.lastFix.xy), bearing_deg: bearing(from.lastFix.xy, to.lastFix.xy),
    combinedSigma2_m: Math.hypot(from.lastFix.sigma2_m, to.lastFix.sigma2_m), age_s: st.t - to.lastFix.t, state: fixState(st, to),
  };
}

export function wearerText(s: Suit): string {
  if (s.wearer === 'confirmed') return 'Wearer signals present (simulated heart-rate and donning sensors).';
  return 'Wearer unconfirmed: the beacon reports where the SUIT is. A beacon alone cannot establish who, if anyone, is inside.';
}

export const fmtT = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
