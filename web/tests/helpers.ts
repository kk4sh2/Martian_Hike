import { readFileSync } from 'node:fs';
import { Terrain } from '../src/core/terrain';
import { geomToPolys } from '../src/core/intersect';
const D = new URL('../public/data/', import.meta.url);
export const json = (p: string) => JSON.parse(readFileSync(new URL(p, D), 'utf8'));
export function terrain() {
  const m = json('jezero/terrain.json');
  const b = readFileSync(new URL('jezero/elevation_2m.u16', D));
  return new Terrain(m, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}
export function nili() {
  const e = json('nili/change_evidence.json');
  e.regions.forEach((r: any) => { r.polys = geomToPolys(r.geometry_local_m); });
  e.coveragePolys = geomToPolys(e.crop.valid_footprint_local_m);
  return e;
}
