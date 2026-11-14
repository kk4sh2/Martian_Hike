import { dist, type XY } from './geo';

/** Bundle written by pipeline/marsdelta_pipeline/meda.py (or a status record when the archive was unreachable). */
export interface MedaBundle {
  status: 'available' | 'unavailable';
  reason?: string;
  instrument?: string;
  products?: { file: string; label: string; url?: string; sha256?: string; quantity: string; units: string; missing_constants: (string | number)[] }[];
  sols?: {
    sol: number; site_drive?: string; station_xy?: XY; station_lonlat?: XY; station_note?: string;
    samples: { lmst: string; utc?: string; pressure_pa?: number | null; air_temp_k?: number | null; wind_ms?: number | null; flags?: string }[];
    gaps: { from_lmst: string; to_lmst: string; minutes: number }[];
  }[];
}

export interface WeatherCard {
  kind: 'historical_observation' | 'unavailable';
  title: string;
  measured: string; instrument: string; where: string; when: string;
  distance_m: number | null; withinCoverage: boolean;
  missing: string; assumption: string; flag: 'ok' | 'far' | 'gap' | 'none';
  values: { label: string; value: string }[];
}

const FAR_M = 1000; // planning assumption: a single-station surface observation is treated as representative within 1 km

export function weatherCard(b: MedaBundle | null, pin: XY, sol: number | null, minuteIndex: number, pinCovered: boolean): WeatherCard {
  if (!b || b.status !== 'available' || !b.sols?.length) {
    return {
      kind: 'unavailable', title: 'No MEDA observation packaged',
      measured: 'Nothing. No surface weather is shown.', instrument: 'Perseverance MEDA (not loaded)', where: '-', when: '-',
      distance_m: null, withinCoverage: pinCovered,
      missing: b?.reason ?? 'The MEDA archive could not be retrieved for this package.',
      assumption: 'MarsDelta never substitutes forecasts or invented readings for missing observations.', flag: 'none', values: [],
    };
  }
  const s = b.sols.find((q) => q.sol === sol) ?? b.sols[0];
  const smp = s.samples[Math.max(0, Math.min(minuteIndex, s.samples.length - 1))];
  const d = s.station_xy ? dist(pin, s.station_xy) : null;
  const inGap = s.gaps.find((g) => smp && g.from_lmst <= smp.lmst && smp.lmst <= g.to_lmst);
  const vals: { label: string; value: string }[] = [];
  const show = (lab: string, v: number | null | undefined, f: (x: number) => string) => vals.push({ label: lab, value: v === null || v === undefined ? 'missing in archive' : f(v) });
  show('Pressure', smp?.pressure_pa, (x) => `${x.toFixed(1)} Pa`);
  show('Air temperature', smp?.air_temp_k, (x) => `${x.toFixed(1)} K (${(x - 273.15).toFixed(1)} °C)`);
  if (b.products?.some((p) => /wind/i.test(p.quantity))) show('Wind speed', smp?.wind_ms, (x) => `${x.toFixed(1)} m/s`);
  const flag: WeatherCard['flag'] = inGap || !smp ? 'gap' : d !== null && d > FAR_M ? 'far' : 'ok';
  return {
    kind: 'historical_observation', title: `Historical observation, sol ${s.sol} (archived, not a forecast)`,
    measured: (b.products ?? []).map((p) => `${p.quantity} [${p.units}]`).join('; '),
    instrument: b.instrument ?? 'MEDA', where: s.station_note ?? 'Rover position for this sol', when: smp ? `Sol ${s.sol}, LMST ${smp.lmst}${smp.utc ? ` (${smp.utc} UTC)` : ''}` : 'no sample',
    distance_m: d, withinCoverage: pinCovered,
    missing: inGap ? `No samples between LMST ${inGap.from_lmst} and ${inGap.to_lmst} (${inGap.minutes} min). Shown as a gap, not filled.` :
      s.gaps.length ? `${s.gaps.length} gap(s) this sol; see timeline.` : 'No gaps in this sol\'s selected interval.',
    assumption: `Flag rule: a single-station observation is treated as representative only within ${FAR_M} m of the station; beyond that it is context only.`,
    flag, values: vals,
  };
}
