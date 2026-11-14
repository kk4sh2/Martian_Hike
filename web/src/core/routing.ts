import type { XY } from './geo';
import { Terrain } from './terrain';

export interface RouteProfile {
  id: string;
  label: string;
  /** Cells steeper than this along the step are impassable. */
  maxSlopeDeg: number;
  /** Extra cost multiplier per degree of slope above `penaltyFromDeg`. */
  slopePenaltyPerDeg: number;
  penaltyFromDeg: number;
}

export const PROFILES: RouteProfile[] = [
  { id: 'direct', label: 'Direct (time-optimal, slopes up to 25°)', maxSlopeDeg: 25, slopePenaltyPerDeg: 0, penaltyFromDeg: 90 },
  { id: 'gentle', label: 'Gentle (avoids slopes over 12°)', maxSlopeDeg: 12, slopePenaltyPerDeg: 0.15, penaltyFromDeg: 5 },
];

/** Suited walking speed (m/s) on a signed grade, Tobler-shaped, normalised so flat ground = v0. */
export function walkSpeed(grade: number, v0_kmh: number): number {
  const v = Math.exp(-3.5 * Math.abs(grade + 0.05)) / Math.exp(-3.5 * 0.05);
  return (v0_kmh / 3.6) * v;
}

class Heap {
  private a: number[] = []; private p: number[] = [];
  push(i: number, pr: number) {
    this.a.push(i); this.p.push(pr);
    let k = this.a.length - 1;
    while (k > 0) {
      const q = (k - 1) >> 1;
      if (this.p[q] <= this.p[k]) break;
      [this.a[q], this.a[k]] = [this.a[k], this.a[q]]; [this.p[q], this.p[k]] = [this.p[k], this.p[q]]; k = q;
    }
  }
  pop(): number {
    const top = this.a[0]; const la = this.a.pop()!; const lp = this.p.pop()!;
    if (this.a.length) {
      this.a[0] = la; this.p[0] = lp; let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1; let m = k;
        if (l < this.a.length && this.p[l] < this.p[m]) m = l;
        if (r < this.a.length && this.p[r] < this.p[m]) m = r;
        if (m === k) break;
        [this.a[m], this.a[k]] = [this.a[k], this.a[m]]; [this.p[m], this.p[k]] = [this.p[k], this.p[m]]; k = m;
      }
    }
    return top;
  }
  get size() { return this.a.length; }
}

const NB: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

export interface LegResult { ok: boolean; path: XY[]; reason?: string }

/** A* over the 2 m DTM grid minimising walking time. No-data cells are never entered. */
export function routeLeg(t: Terrain, a: XY, b: XY, prof: RouteProfile, v0_kmh = 2.0): LegResult {
  const [ca, ra] = t.cell(...a), [cb, rb] = t.cell(...b);
  if (!t.inside(ca, ra) || !Number.isFinite(t.zAt(ca, ra))) return { ok: false, path: [], reason: 'start outside terrain coverage' };
  if (!t.inside(cb, rb) || !Number.isFinite(t.zAt(cb, rb))) return { ok: false, path: [], reason: 'end outside terrain coverage' };
  const N = t.w * t.h, g = new Float64Array(N).fill(Infinity), from = new Int32Array(N).fill(-1);
  const s = ra * t.w + ca, goal = rb * t.w + cb;
  const vmax = walkSpeed(-0.05, v0_kmh);
  const hfun = (i: number) => Math.hypot((i % t.w) - cb, Math.floor(i / t.w) - rb) * t.res / vmax;
  g[s] = 0; const open = new Heap(); open.push(s, hfun(s));
  const closed = new Uint8Array(N);
  while (open.size) {
    const i = open.pop();
    if (closed[i]) continue; closed[i] = 1;
    if (i === goal) break;
    const c = i % t.w, r = (i / t.w) | 0, z = t.z[i];
    for (const [dc, dr, k] of NB) {
      const c2 = c + dc, r2 = r + dr;
      if (!t.inside(c2, r2)) continue;
      const j = r2 * t.w + c2; if (closed[j]) continue;
      const z2 = t.z[j]; if (!Number.isFinite(z2)) continue;
      const run = k * t.res, grade = (z2 - z) / run, sl = Math.atan(Math.abs(grade)) * 180 / Math.PI;
      if (sl > prof.maxSlopeDeg) continue;
      let cost = Math.hypot(run, z2 - z) / walkSpeed(grade, v0_kmh);
      if (sl > prof.penaltyFromDeg) cost *= 1 + prof.slopePenaltyPerDeg * (sl - prof.penaltyFromDeg);
      const ng = g[i] + cost;
      if (ng < g[j]) { g[j] = ng; from[j] = i; open.push(j, ng + hfun(j)); }
    }
  }
  if (!Number.isFinite(g[goal])) return { ok: false, path: [], reason: `no path within the ${prof.maxSlopeDeg}° slope limit inside terrain coverage` };
  const cells: number[] = [];
  for (let i = goal; i !== -1; i = from[i]) cells.push(i);
  cells.reverse();
  const path: XY[] = [a, ...cells.slice(1, -1).map((i) => t.center(i % t.w, (i / t.w) | 0)), b];
  return { ok: true, path: simplify(path, 1.0) };
}

/** Douglas-Peucker in metres. */
export function simplify(p: XY[], tol: number): XY[] {
  if (p.length < 3) return p;
  const keep = new Uint8Array(p.length); keep[0] = keep[p.length - 1] = 1;
  const st: [number, number][] = [[0, p.length - 1]];
  while (st.length) {
    const [i, j] = st.pop()!; let md = 0, mk = -1;
    const [x1, y1] = p[i], [x2, y2] = p[j], L = Math.hypot(x2 - x1, y2 - y1) || 1e-9;
    for (let k = i + 1; k < j; k++) {
      const d = Math.abs((x2 - x1) * (y1 - p[k][1]) - (x1 - p[k][0]) * (y2 - y1)) / L;
      if (d > md) { md = d; mk = k; }
    }
    if (md > tol && mk > 0) { keep[mk] = 1; st.push([i, mk], [mk, j]); }
  }
  return p.filter((_, k) => keep[k]);
}
