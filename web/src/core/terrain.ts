import type { XY } from './geo';

export interface TerrainMeta {
  grid: { res_m: number; width: number; height: number; origin_top_left_local_m: XY };
  corridor_local_m: [number, number, number, number];
  dtm: Record<string, unknown>;
}

/** 2 m elevation grid decoded from the pipeline's uint16 file; NaN = no data. */
export class Terrain {
  readonly res: number; readonly w: number; readonly h: number; readonly x0: number; readonly y0: number;
  readonly z: Float32Array;
  constructor(meta: TerrainMeta, raw: ArrayBuffer) {
    const g = meta.grid;
    this.res = g.res_m; this.w = g.width; this.h = g.height;
    [this.x0, this.y0] = g.origin_top_left_local_m;
    const u = new Uint16Array(raw);
    this.z = new Float32Array(u.length);
    for (let i = 0; i < u.length; i++) this.z[i] = u[i] === 0 ? NaN : u[i] / 10 - 3000;
  }
  cell(x: number, y: number): [number, number] {
    return [Math.floor((x - this.x0) / this.res), Math.floor((this.y0 - y) / this.res)];
  }
  center(c: number, r: number): XY {
    return [this.x0 + (c + 0.5) * this.res, this.y0 - (r + 0.5) * this.res];
  }
  inside(c: number, r: number) { return c >= 0 && r >= 0 && c < this.w && r < this.h; }
  zAt(c: number, r: number): number { return this.inside(c, r) ? this.z[r * this.w + c] : NaN; }
  /** Bilinear elevation at local metres; NaN outside coverage or next to no-data. */
  elev(x: number, y: number): number {
    const fx = (x - this.x0) / this.res - 0.5, fy = (this.y0 - y) / this.res - 0.5;
    const c = Math.floor(fx), r = Math.floor(fy);
    const a = this.zAt(c, r), b = this.zAt(c + 1, r), d = this.zAt(c, r + 1), e = this.zAt(c + 1, r + 1);
    const tx = fx - c, ty = fy - r;
    return (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty;
  }
  covered(x: number, y: number) { return Number.isFinite(this.elev(x, y)); }
  /** Local slope (deg) from central differences at a cell. */
  slopeAt(c: number, r: number): number {
    const zx = (this.zAt(c + 1, r) - this.zAt(c - 1, r)) / (2 * this.res);
    const zy = (this.zAt(c, r + 1) - this.zAt(c, r - 1)) / (2 * this.res);
    return Math.atan(Math.hypot(zx, zy)) * 180 / Math.PI;
  }
}
