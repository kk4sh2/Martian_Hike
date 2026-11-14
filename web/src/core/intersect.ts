import { dist, type XY } from './geo';

/** Polygon in local metres: outer ring first, then holes (GeoJSON order). */
export type Rings = XY[][];

export function geomToPolys(g: { type: string; coordinates: any }): Rings[] {
  if (g.type === 'Polygon') return [g.coordinates as Rings];
  if (g.type === 'MultiPolygon') return g.coordinates as Rings[];
  return [];
}

function inRing(p: XY, ring: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi + 1e-300) + xi) inside = !inside;
  }
  return inside;
}
export function inPoly(p: XY, poly: Rings): boolean {
  if (!inRing(p, poly[0])) return false;
  for (let k = 1; k < poly.length; k++) if (inRing(p, poly[k])) return false;
  return true;
}

function segParams(a: XY, b: XY, poly: Rings): number[] {
  const out: number[] = [];
  const dx = b[0] - a[0], dy = b[1] - a[1];
  for (const ring of poly) {
    for (let i = 0; i < ring.length - 1; i++) {
      const c = ring[i], d = ring[i + 1];
      const ex = d[0] - c[0], ey = d[1] - c[1];
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((c[0] - a[0]) * ey - (c[1] - a[1]) * ex) / den;
      const u = ((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) / den;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) out.push(t);
    }
  }
  return out;
}

export interface Crossing {
  regionId: string; startAlong_m: number; endAlong_m: number; length_m: number; legIndex: number;
  start: XY; end: XY; segment: XY[];
}

/** Exact planar intersection of a polyline with polygons; returns the inside sub-segments with distances along the walk. */
export function intersectPolyline(path: XY[], regions: { id: string; polys: Rings[] }[], legIndex = 0, offset_m = 0): Crossing[] {
  const out: Crossing[] = [];
  for (const reg of regions) {
    for (const poly of reg.polys) {
      let acc = offset_m;
      let cur: Crossing | null = null;
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i], L = dist(a, b);
        const ts = [0, ...segParams(a, b, poly).sort((x, y) => x - y), 1];
        for (let k = 1; k < ts.length; k++) {
          const t0 = ts[k - 1], t1 = ts[k];
          if (t1 - t0 < 1e-9) continue;
          const tm = (t0 + t1) / 2;
          const pm: XY = [a[0] + tm * (b[0] - a[0]), a[1] + tm * (b[1] - a[1])];
          const p0: XY = [a[0] + t0 * (b[0] - a[0]), a[1] + t0 * (b[1] - a[1])];
          const p1: XY = [a[0] + t1 * (b[0] - a[0]), a[1] + t1 * (b[1] - a[1])];
          if (inPoly(pm, poly)) {
            if (!cur) cur = { regionId: reg.id, startAlong_m: acc + t0 * L, endAlong_m: 0, length_m: 0, legIndex, start: p0, end: p1, segment: [p0] };
            cur.segment.push(p1); cur.end = p1; cur.endAlong_m = acc + t1 * L;
          } else if (cur) {
            cur.length_m = cur.endAlong_m - cur.startAlong_m; out.push(cur); cur = null;
          }
        }
        acc += L;
      }
      if (cur) { cur.length_m = cur.endAlong_m - cur.startAlong_m; out.push(cur); }
    }
  }
  return out.sort((x, y) => x.startAlong_m - y.startAlong_m);
}

export type ImpactStatus = 'intersects' | 'clear' | 'outside_coverage' | 'partial_coverage' | 'no_analysis';

export interface ImpactResult {
  status: ImpactStatus; crossings: Crossing[]; coveredLength_m: number; totalLength_m: number; message: string;
}

/**
 * Route impact against change polygons. Coverage matters: "clear" is only claimed for the part of the
 * walk inside the analysed (valid) footprint; anything outside has no evidence either way.
 */
export function routeImpact(legs: XY[][], regions: { id: string; polys: Rings[] }[] | null, coverage: Rings[] | null): ImpactResult {
  const total = legs.reduce((s, l) => s + l.reduce((a, _p, i) => (i ? a + dist(l[i - 1], l[i]) : 0), 0), 0);
  if (!regions || !coverage) {
    return { status: 'no_analysis', crossings: [], coveredLength_m: 0, totalLength_m: total,
      message: 'No repeat-imagery change analysis covers this mission area. Absence of findings here is not evidence of an unchanged surface.' };
  }
  const covCross = legs.flatMap((l, i) => intersectPolyline(l, [{ id: 'coverage', polys: coverage }], i));
  const covered = covCross.reduce((s, c) => s + c.length_m, 0);
  let off = 0; const crossings: Crossing[] = [];
  legs.forEach((l, i) => { crossings.push(...intersectPolyline(l, regions, i, off)); off += l.reduce((a, _p, k) => (k ? a + dist(l[k - 1], l[k]) : 0), 0); });
  const frac = total ? covered / total : 0;
  if (crossings.length) {
    return { status: 'intersects', crossings, coveredLength_m: covered, totalLength_m: total,
      message: `Inspect the highlighted crossing${crossings.length > 1 ? 's' : ''}. Repeat orbital imagery shows a candidate surface difference here.` };
  }
  if (frac < 0.01) return { status: 'outside_coverage', crossings, coveredLength_m: covered, totalLength_m: total,
    message: 'This route lies outside the change-analysis coverage. There is no repeat-imagery evidence either way.' };
  if (frac < 0.99) return { status: 'partial_coverage', crossings, coveredLength_m: covered, totalLength_m: total,
    message: `No candidate differences on the ${Math.round(covered)} m inside coverage; ${Math.round(total - covered)} m of the walk has no repeat-imagery analysis.` };
  return { status: 'clear', crossings, coveredLength_m: covered, totalLength_m: total,
    message: 'The whole route lies inside the change-analysis coverage and crosses no candidate surface difference.' };
}
