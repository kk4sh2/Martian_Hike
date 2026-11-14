import type { AreaId, XY } from './core/geo';
import { Terrain, type TerrainMeta } from './core/terrain';
import { geomToPolys, type Rings } from './core/intersect';
import type { MedaBundle } from './core/weather';
import type { PlanStop } from './core/metrics';

const BASE = (import.meta as any).env?.BASE_URL ?? '/';
export const url = (p: string) => `${BASE}data/${p}`;

async function j<T>(p: string): Promise<T> {
  const r = await fetch(url(p));
  if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
  return r.json();
}

export interface Region {
  id: string; classification: 'Verified' | 'Requires Review' | 'Uncertain'; explanation: string; area_m2: number;
  centroid_lonlat: XY; displacement: any; source_pixels: any; geometry_local_m: any; polys: Rings[];
  [k: string]: any;
}
export interface ChangeEvidence {
  observations: Record<'before' | 'after', any>; crop: any; registration: any; false_positive_check: any; nasa_reference: any;
  previews: Record<string, string>; parameters: any; summary: any; regions: Region[]; masks: any; ripple_wavelength_m: any;
  pipeline_version: string; generated: string; precomputed: boolean; interval_days: number; crs_check?: any;
  coveragePolys: Rings[]; cropBounds: [number, number, number, number];
}
export interface Photo { product_id: string; stop: string; camera: string; sol: number; date_utc: string; lmst: string; credit: string;
  source_page: string; record_url: string; local_file: string; selection_note: string; mission_record: any; camera_position: any;
  target_position: null; target_position_note: string; heading: any; caption: string }
export interface Waypoint { rmc: string; sol: number; x: number; y: number; lon: number; lat: number; elev_geoid_m: number; yaw_deg: number; final: string }

export interface Bundles {
  terrainMeta: TerrainMeta & Record<string, any>; terrain: Terrain; waypoints: Waypoint[]; traverse: any; geology: any;
  photos: Photo[]; meda: MedaBundle; dust: any; nili: ChangeEvidence; manifest: any;
}

function bounds(rings: Rings[]): [number, number, number, number] {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const p of rings) for (const [x, y] of p[0]) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); }
  return [a, b, c, d];
}

export async function loadAll(): Promise<Bundles> {
  const [tm, elev, wp, trv, geo, ph, meda, dust, nili, manifest] = await Promise.all([
    j<any>('jezero/terrain.json'), fetch(url('jezero/elevation_2m.u16')).then((r) => r.arrayBuffer()),
    j<any>('jezero/rover_waypoints.json'), j<any>('jezero/rover_traverse_local.geojson'), j<any>('jezero/geology_local.geojson'),
    j<any>('jezero/photos.json'), j<MedaBundle>('jezero/meda.json'), j<any>('dust_context.json'), j<any>('nili/change_evidence.json'),
    j<any>('source_manifest.json').catch(() => null),
  ]);
  nili.regions.forEach((r: Region) => { r.polys = geomToPolys(r.geometry_local_m); });
  nili.coveragePolys = geomToPolys(nili.crop.valid_footprint_local_m);
  nili.cropBounds = bounds(geomToPolys(nili.crop.footprint_local_m));
  return { terrainMeta: tm, terrain: new Terrain(tm, elev), waypoints: wp.stops, traverse: trv, geology: geo, photos: ph.photos,
    meda, dust, nili, manifest };
}

/** Route options. Jezero options are computed on the DTM; Nili options are authored hypothetical walks. */
export interface RouteOption { id: string; label: string; area: AreaId; kind: 'computed' | 'authored'; profile?: string; stops?: PlanStop[]; legs?: XY[][]; simulated: boolean; note: string }

const H: XY = [120, -200], N: XY = [30, 170], S: XY = [205, -232], E: XY = [420, -190];
export const NILI_OPTIONS: RouteOption[] = [
  { id: 'crossing', label: 'A. Direct to north contact (crosses the dune)', area: 'nili', kind: 'authored', simulated: true,
    stops: [{ id: 'habitat', label: 'Habitat', xy: H, required: false }, { id: 'north_contact', label: 'North bedrock/dune contact', xy: N, required: true }, { id: 'habitat', label: 'Habitat (return)', xy: H, required: false }],
    legs: [[H, N], [N, H]], note: 'Hypothetical walk authored for the demonstration through a genuine candidate region.' },
  { id: 'south', label: 'B. South bedrock survey (stays on bedrock)', area: 'nili', kind: 'authored', simulated: true,
    stops: [{ id: 'habitat', label: 'Habitat', xy: H, required: false }, { id: 'south_outcrop', label: 'South bedrock outcrop', xy: S, required: true }, { id: 'habitat', label: 'Habitat (return)', xy: H, required: false }],
    legs: [[H, [170, -225], S], [S, H]], note: 'Hypothetical walk that stays on bright bedrock inside the analysed crop.' },
  { id: 'east', label: 'C. East traverse (leaves analysed coverage)', area: 'nili', kind: 'authored', simulated: true,
    stops: [{ id: 'habitat', label: 'Habitat', xy: H, required: false }, { id: 'east_point', label: 'East point outside the crop', xy: E, required: true }, { id: 'habitat', label: 'Habitat (return)', xy: H, required: false }],
    legs: [[H, [300, -195], E], [E, H]], note: 'Hypothetical walk that mostly leaves the 512 m analysis crop.' },
];
export const JEZERO_OPTIONS: RouteOption[] = [
  { id: 'direct', label: 'Direct (time-optimal, slopes ≤ 25°)', area: 'jezero', kind: 'computed', profile: 'direct', simulated: false, note: 'Computed on the USGS HiRISE DTM.' },
  { id: 'gentle', label: 'Gentle (avoids slopes > 12°)', area: 'jezero', kind: 'computed', profile: 'gentle', simulated: false, note: 'Computed on the USGS HiRISE DTM.' },
];
