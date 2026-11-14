// Local analytical coordinates. Must match pipeline/marsdelta_pipeline/common.py exactly.
// x = R cos(lat0) (lon - lon0), y = R (lat - lat0)   [radians, metres, Mars 2000 sphere]
export const MARS_R = 3396190;
export type AreaId = 'jezero' | 'nili';
export const AREA_CENTERS: Record<AreaId, { lat0: number; lon0: number }> = {
  jezero: { lat0: 18.4525, lon0: 77.405 },
  nili: { lat0: 8.78, lon0: 67.324 },
};
export type XY = [number, number];
const D = Math.PI / 180;
export function toLocal(area: AreaId, lon: number, lat: number): XY {
  const c = AREA_CENTERS[area];
  return [MARS_R * Math.cos(c.lat0 * D) * (lon - c.lon0) * D, MARS_R * (lat - c.lat0) * D];
}
export function toLonLat(area: AreaId, x: number, y: number): XY {
  const c = AREA_CENTERS[area];
  return [c.lon0 + x / (MARS_R * Math.cos(c.lat0 * D)) / D, c.lat0 + y / MARS_R / D];
}
export const dist = (a: XY, b: XY) => Math.hypot(b[0] - a[0], b[1] - a[1]);
/** Bearing clockwise from local north (degrees). */
export function bearing(a: XY, b: XY): number {
  return (Math.atan2(b[0] - a[0], b[1] - a[1]) / D + 360) % 360;
}
export function polylineLength(p: XY[]): number {
  let s = 0;
  for (let i = 1; i < p.length; i++) s += dist(p[i - 1], p[i]);
  return s;
}
export function pointAlong(p: XY[], s: number): XY {
  let acc = 0;
  for (let i = 1; i < p.length; i++) {
    const d = dist(p[i - 1], p[i]);
    if (acc + d >= s) {
      const t = d ? (s - acc) / d : 0;
      return [p[i - 1][0] + t * (p[i][0] - p[i - 1][0]), p[i - 1][1] + t * (p[i][1] - p[i - 1][1])];
    }
    acc += d;
  }
  return p[p.length - 1];
}
export function fmtLonLat(area: AreaId, x: number, y: number): string {
  const [lon, lat] = toLonLat(area, x, y);
  return `${lat.toFixed(5)}° N, ${lon.toFixed(5)}° E`;
}
