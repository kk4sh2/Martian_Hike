import { app, activePlan } from '../app';
import { inPoly } from '../core/intersect';
import { PROFILES } from '../core/routing';
import type { XY } from '../core/geo';

/**
 * Nili bypass search. A detour is only OFFERED when terrain coverage and resource checks support it.
 * No DTM is packaged for the Nili crop, so terrain checks cannot pass; we still report whether a purely
 * geometric detour exists inside the analysed imagery, so the reviewer knows what evidence is missing.
 */
export function findBypass(): { offered: boolean; geometric: boolean; summary: string; path?: XY[] } {
  const e = app.b.nili; const plan = activePlan('nili');
  if (!plan) return { offered: false, geometric: false, summary: 'No active route.' };
  const req = plan.stops.find((s) => s.required)!; const hab = plan.stops[0];
  const [l, b, r, t] = e.cropBounds; const res = 2, buf = 5;
  const W = Math.floor((r - l) / res), H = Math.floor((t - b) / res);
  const free = new Uint8Array(W * H);
  const border = e.parameters.border_m + 2;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const p: XY = [l + (i + 0.5) * res, t - (j + 0.5) * res];
    if (p[0] < l + border || p[0] > r - border || p[1] < b + border || p[1] > t - border) continue;
    if (!e.coveragePolys.some((q) => inPoly(p, q))) continue;
    let blocked = false;
    for (const reg of e.regions) {
      const [x0, y0, x1, y1] = bbox(reg.polys);
      if (p[0] < x0 - buf || p[0] > x1 + buf || p[1] < y0 - buf || p[1] > y1 + buf) continue;
      if (reg.polys.some((q) => inPoly(p, q) || nearRing(p, q[0], buf))) { blocked = true; break; }
    }
    if (!blocked) free[j * W + i] = 1;
  }
  const cell = (p: XY) => [Math.floor((p[0] - l) / res), Math.floor((t - p[1]) / res)];
  const [si, sj] = cell(hab.xy), [gi, gj] = cell(req.xy);
  const start = sj * W + si, goal = gj * W + gi;
  const prev = new Int32Array(W * H).fill(-2); prev[start] = -1; const q = [start];
  let found = false;
  while (q.length) {
    const k = q.shift()!; if (k === goal) { found = true; break; }
    const i = k % W, j = (k / W) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const a = i + di, c = j + dj; if (a < 0 || c < 0 || a >= W || c >= H) continue;
      const n = c * W + a; if (!free[n] || prev[n] !== -2) continue; prev[n] = k; q.push(n);
    }
  }
  const missing = 'No terrain model (DTM) is packaged for this crop, so slope, footing and walking-resource checks for a detour cannot be run.';
  if (!found) return { offered: false, geometric: false,
    summary: `No bypass offered. Inside the analysed 512 m crop every path from the habitat to "${req.label}" crosses or comes within ${buf} m of a candidate region, and leaving the crop means leaving the evidence coverage. ${missing} Manual review is required.` };
  return { offered: false, geometric: true,
    summary: `A geometric detour avoiding all candidate regions exists inside the analysed imagery, but it is not offered as a supported alternative: ${missing} Manual review is required.` };
}
function bbox(polys: XY[][][]) { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const p of polys) for (const [x, y] of p[0]) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); } return [a, b, c, d]; }
function nearRing(p: XY, ring: XY[], d: number) {
  for (let i = 1; i < ring.length; i++) {
    const [x1, y1] = ring[i - 1], [x2, y2] = ring[i]; const dx = x2 - x1, dy = y2 - y1; const L = dx * dx + dy * dy || 1e-9;
    const u = Math.max(0, Math.min(1, ((p[0] - x1) * dx + (p[1] - y1) * dy) / L));
    if (Math.hypot(p[0] - (x1 + u * dx), p[1] - (y1 + u * dy)) < d) return true;
  }
  return false;
}
void PROFILES;
