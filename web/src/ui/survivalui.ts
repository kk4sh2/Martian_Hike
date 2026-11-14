import { app, activePlan, ANCHORS } from '../app';
import { state } from '../state';
import type { AreaId, XY } from '../core/geo';
import { pointAlong } from '../core/geo';
import { esc, fmtM, fmtH } from './dom';
import { turnBackPoint, nearestShelter, lmstMin, fmtLmst, relativeLevel, usePerMetre } from '../core/survival';

export interface MedaDailySol {
  sol: number; earth_date: string; ls_deg: number | null; season: string | null;
  min_air_temp_c: number | null; max_air_temp_c: number | null; pressure_pa: number | null;
  sunrise_lmst: string | null; sunset_lmst: string | null;
  station: { sol_of_fix: number; rmc: string; lon: number; lat: number; x: number; y: number } | null;
}
export interface MedaDaily { source: string; retrieved: string; instrument: string; note: string; sols: MedaDailySol[] }

/** Survival settings (simulated planning inputs). */
export const survivalSettings = { startLmst: '09:00', factor: 1.5 };

export function shelters(area: AreaId) {
  return ANCHORS[area].filter((a) => a.id === 'HAB' || a.id === 'ROV').map((a) => ({ id: a.id, label: a.id === 'HAB' ? 'Habitat' : 'Pressurised rover', xy: a.xy as XY }));
}

/** Route as one polyline plus where the outbound part ends (the farthest required stop). */
export function routeLine(area: AreaId) {
  const p = activePlan(area); if (!p || !p.ok) return null;
  const pts: XY[] = []; p.legs.forEach((leg) => leg.forEach((q, k) => { if (k || !pts.length) pts.push(q); }));
  let acc = 0; const legEnd: number[] = [];
  p.legs.forEach((leg) => { for (let k = 1; k < leg.length; k++) acc += Math.hypot(leg[k][0] - leg[k - 1][0], leg[k][1] - leg[k - 1][1]); legEnd.push(acc); });
  const outboundEnd = legEnd.length > 1 ? legEnd[legEnd.length - 2] : acc;
  return { plan: p, pts, total: acc, outboundEnd };
}

export function turnBack(area: AreaId) {
  const r = routeLine(area); if (!r || !r.plan.metrics) return null;
  const tb = turnBackPoint(r.plan.metrics, state.assumptions.reservePct, survivalSettings.factor, r.outboundEnd);
  if (!tb) return null;
  return { ...tb, xy: tb.beyondRoute ? null : pointAlong(r.pts, tb.along_m), limiting: usePerMetre(r.plan.metrics).limiting };
}

export function latestMeda(): MedaDailySol | null {
  const d = app.b.medaDaily; if (!d) return null;
  return [...d.sols].reverse().find((s) => s.sunset_lmst) ?? d.sols[d.sols.length - 1] ?? null;
}

export function daylight(area: AreaId) {
  const p = activePlan(area); const s = latestMeda();
  const start = lmstMin(survivalSettings.startLmst); const sunset = area === 'jezero' ? lmstMin(s?.sunset_lmst) : null;
  if (start === null || !p?.metrics) return null;
  const back = start + p.metrics.nominalDuration_s / 60;
  return { start, back, sunset, marginMin: sunset === null ? null : sunset - back, sol: area === 'jezero' ? s?.sol : undefined };
}

export function dustAdvisory(area: AreaId) {
  const d = app.b.dust.areas[area]; const series = d.series as { utc: string | null; cdod610: number | null; ls: number }[];
  const vals = series.map((q) => q.cdod610);
  if (area === 'jezero') {
    const dates = app.b.photos.map((p) => p.date_utc.slice(0, 10)).sort();
    const sub = series.filter((q) => q.utc && q.utc.slice(0, 10) >= dates[0] && q.utc.slice(0, 10) <= dates[dates.length - 1] && q.cdod610 !== null).map((q) => q.cdod610!) ;
    if (!sub.length) return null;
    const mean = sub.reduce((a, b) => a + b, 0) / sub.length; const rel = relativeLevel(vals, mean)!;
    return { text: `Regional dust when the rover visited these stops (${dates[0]} to ${dates[dates.length - 1]}) was ${rel.level} for that campaign: average ${mean.toFixed(2)}, campaign range ${rel.min.toFixed(2)}–${rel.max.toFixed(2)}.`, level: rel.level };
  }
  const nn = vals.filter((v): v is number => v !== null); if (!nn.length) return null;
  const peak = series.reduce((a, b) => ((b.cdod610 ?? -1) > (a.cdod610 ?? -1) ? b : a));
  return { text: `Regional dust between the two images ranged ${Math.min(...nn).toFixed(2)}–${Math.max(...nn).toFixed(2)}, peaking around Ls ${peak.ls.toFixed(0)}°.`, level: 'context' };
}

/** Planner card: survival summary for the active route. */
export function survivalHtml(area: AreaId) {
  const r = routeLine(area); if (!r || !r.plan.metrics) return '<div class="note">No active route.</div>';
  const m = r.plan.metrics; const tb = turnBack(area); const dl = daylight(area); const dust = dustAdvisory(area);
  const far = pointAlong(r.pts, r.outboundEnd); const sh = nearestShelter(far, shelters(area));
  const minMargin = Math.min(m.o2Remaining_pct, m.batteryRemaining_pct) - state.assumptions.reservePct;
  const okCls = (ok: boolean | null) => ok === null ? '' : ok ? 'sOk' : 'sBad';
  const rows: string[] = [];
  rows.push(`<div class="sRow ${okCls(minMargin >= 0)}"><span class="sIco">🫁</span><div><b>${minMargin >= 0 ? `${minMargin.toFixed(0)}% spare above the reserve` : `${(-minMargin).toFixed(0)}% short of the reserve`}</b><small>Back with O₂ ${m.o2Remaining_pct.toFixed(0)}% and battery ${m.batteryRemaining_pct.toFixed(0)}% (keep ${state.assumptions.reservePct}%)</small></div></div>`);
  if (tb) rows.push(`<div class="sRow ${okCls(tb.beyondRoute)}"><span class="sIco">↩</span><div><b>${tb.beyondRoute ? 'No turn-back point on this route' : `Turn back by ${fmtM(tb.along_m)}`}</b><small>${tb.beyondRoute ? `Even at ${tb.factor}× the planned ${tb.limiting} use you could retrace the whole outbound walk.` : `If ${tb.limiting} runs out ${tb.factor}× faster than planned, turn around here to get home with the reserve. Marked ↩ on the map.`}</small></div></div>`);
  if (sh) rows.push(`<div class="sRow"><span class="sIco">🏠</span><div><b>${fmtM(sh.dist_m)} to shelter at the farthest point</b><small>Nearest: ${esc(sh.label)} (simulated placement), straight line</small></div></div>`);
  if (dl) rows.push(`<div class="sRow ${okCls(dl.marginMin === null ? null : dl.marginMin >= 60)}"><span class="sIco">☀</span><div><b>${dl.marginMin === null ? `Back by about ${fmtLmst(dl.back)} local time` : dl.marginMin >= 0 ? `Back ${fmtH(dl.marginMin * 60)} before sunset` : `Returns ${fmtH(-dl.marginMin * 60)} after sunset`}</b><small>Leaving ${survivalSettings.startLmst} (simulated)${dl.sunset !== null ? `; sunset ${fmtLmst(dl.sunset)} from the latest MEDA summary (sol ${dl.sol})` : '; no sunset data for this site'}</small></div></div>`);
  if (dust) rows.push(`<div class="sRow"><span class="sIco">🌫</span><div><b>Dust: ${esc(dust.level)}</b><small>${esc(dust.text)} Not a forecast.</small></div></div>`);
  return `<div class="sList">${rows.join('')}</div>
    <details data-k="sv"><summary>Survival settings</summary>
      <label class="row inp"><span>Leave habitat at (local time)</span><input type="time" id="svStart" value="${survivalSettings.startLmst}"></label>
      <label class="row inp"><span>Worst-case use (× plan)</span><input type="number" id="svFactor" step="0.1" min="1" value="${survivalSettings.factor}"></label>
    </details>
    <div class="note">Estimates from the simulated suit model. On the tablet: live countdowns and an emergency return.</div>`;
}

/** Planner weather card body for Jezero (MEDA daily summaries). */
export function medaDailyHtml(pin: XY) {
  const d = app.b.medaDaily; if (!d || !d.sols.length) return null;
  const sel = state.areas.jezero.weatherSol && d.sols.find((s) => s.sol === state.areas.jezero.weatherSol) ? d.sols.find((s) => s.sol === state.areas.jezero.weatherSol)! : latestMeda()!;
  const v = (x: number | null, unit: string) => x === null ? '<span class="gap">not reported</span>' : `${x.toFixed(1)} ${unit}`;
  const distKm = sel.station ? Math.hypot(sel.station.x - pin[0], sel.station.y - pin[1]) / 1000 : null;
  return `<div class="row"><label>Sol <select id="wxSol">${d.sols.map((s) => `<option value="${s.sol}" ${s.sol === sel.sol ? 'selected' : ''}>${s.sol} · ${s.earth_date}</option>`).join('')}</select></label></div>
    <div class="wxGrid">
      <div><small>Low</small><b>${v(sel.min_air_temp_c, '°C')}</b></div><div><small>High</small><b>${v(sel.max_air_temp_c, '°C')}</b></div>
      <div><small>Pressure</small><b>${v(sel.pressure_pa, 'Pa')}</b></div><div><small>Sunrise / sunset</small><b>${sel.sunrise_lmst?.slice(0, 5) ?? '—'} / ${sel.sunset_lmst?.slice(0, 5) ?? '—'}</b></div>
    </div>
    <dl class="kv"><dt>Measured</dt><dd>Sol ${sel.sol} (${sel.earth_date}), ${esc(sel.season ?? '')}, by Perseverance's MEDA weather station</dd>
      <dt>Distance to pin</dt><dd>${distKm === null ? '—' : `${distKm.toFixed(1)} km`}: the rover was ${distKm !== null && distKm > 1 ? 'away from' : 'near'} your landing pin, so conditions at the pin may differ</dd></dl>
    <table class="cmp wxTable"><tr><th>Sol</th><th>Low</th><th>High</th><th>Pressure</th></tr>${d.sols.map((s) => `<tr class="${s.sol === sel.sol ? 'act' : ''}"><td>${s.sol}</td><td>${s.min_air_temp_c ?? '<span class="gap">gap</span>'}</td><td>${s.max_air_temp_c ?? '<span class="gap">gap</span>'}</td><td>${s.pressure_pa ?? '<span class="gap">gap</span>'}</td></tr>`).join('')}</table>
    <div class="note">NASA's published MEDA daily summaries, captured ${d.retrieved.slice(0, 10)}. These are the latest sols NASA publishes (from 2024), not the sols of the planned walk. Gaps are days NASA did not report. Past measurements, not a forecast.</div>`;
}
