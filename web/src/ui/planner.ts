import L from 'leaflet';
import { app, evaluateArea, activePlan, crewFor, resetCrew } from '../app';
import { state, emit, log } from '../state';
import { createMap, ll, xy, boundsOf } from './map';
import { $, card, esc, fmtM, fmtH } from './dom';
import { url } from '../data';
import { optionsFor, type EvaluatedPlan } from '../plan';
import { explainDifference, ENV_SCENARIOS, type Assumptions } from '../core/metrics';
import { FAIL_LABEL } from '../core/montecarlo';
import { weatherCard } from '../core/weather';
import { dist, fmtLonLat, type AreaId, type XY } from '../core/geo';
import { openEvidence } from './evidence';
import { dropTablet, pickUpTablet, setComms, powerSpareSuit, moveSuit, step, fixState, relative, wearerText, fmtT } from '../core/crew';
import { routeLeg, PROFILES } from '../core/routing';
import { openPhoto } from './photo';
import { openSources } from './sources';
import { survivalHtml, medaDailyHtml, turnBack, survivalSettings, dustAdvisory } from './survivalui';

let map: L.Map;
const groups: Record<string, L.LayerGroup> = {};
const visible: Record<string, boolean> = {};
let currentArea: AreaId | null = null;
let selectedCrew = 'SUIT-B2';

const CLS_COLOR: Record<string, string> = { Verified: '#5fd38d', 'Requires Review': '#ffb547', Uncertain: '#aab0ba' };

export function initPlanner() {
  map = createMap($('#map'), $('#coords'), () => state.area);
}

function group(id: string, label: string, kind: 'obs' | 'derived' | 'sim' | 'ctx', swatch: string, on = true) {
  const g = L.layerGroup();
  groups[id] = g;
  if (visible[id] === undefined) visible[id] = on;
  if (visible[id]) g.addTo(map);
  legendItems.push({ id, label, kind, swatch });
  return g;
}
let legendItems: { id: string; label: string; kind: string; swatch: string }[] = [];

export function renderPlanner(why = '') {
  const area = state.area;
  const areaChanged = currentArea !== area;
  if (areaChanged || why === 'reset' || why === 'route' || why === 'stops' || why === 'assumptions' || why === 'bypass' || why === 'demo') evaluateArea(area);
  if (areaChanged) { currentArea = area; buildLayers(area, true); }
  else buildLayers(area, false);
  renderPanel(area);
  renderDecision(area);
}

function clearGroups() { Object.values(groups).forEach((g) => g.remove()); for (const k in groups) delete groups[k]; legendItems = []; }

function buildLayers(area: AreaId, fit: boolean) {
  clearGroups();
  const b = app.b;
  if (area === 'jezero') {
    const tb = b.terrainMeta.images.bounds_local_m as [number, number, number, number];
    const bb = boundsOf(tb);
    group('ortho', 'Orbital image (HiRISE)', 'obs', '#777').addLayer(L.imageOverlay(url('jezero/ortho.jpg'), bb, { attribution: 'USGS Astrogeology / NASA / JPL-Caltech / UArizona HiRISE' }));
    group('hill', 'Shaded relief', 'derived', '#556', false).addLayer(L.imageOverlay(url('jezero/hillshade.jpg'), bb, { opacity: 0.55 }));
    group('slope', 'Slope (yellow 5° → purple >25°)', 'derived', 'linear-gradient(90deg,#fadc3c,#ff961e,#f03228,#c828dc)', false).addLayer(L.imageOverlay(url('jezero/slope_overlay.png'), bb));
    const geo = group('geo', 'Geologic units', 'ctx', 'repeating-linear-gradient(45deg,#7a5,#7a5 3px,transparent 3px,transparent 6px)', false);
    geo.addLayer(L.geoJSON(b.geology as any, {
      coordsToLatLng: (c: any) => L.latLng(c[1], c[0]), style: () => ({ color: '#9c6', weight: 1.5, fillOpacity: 0.08, dashArray: '4 3' }),
      onEachFeature: (f: any, lyr) => lyr.bindTooltip(`${esc(f.properties.UnitName ?? f.properties.Unit ?? f.properties.unit ?? 'Unit')} <small>(1:75,000; ±100-200 m)</small>`, { sticky: true }),
    }));
    const cov = group('cov', 'Edge of terrain data', 'obs', 'transparent;border:2px solid #5ec8ff');
    cov.addLayer(L.rectangle(bb, { color: '#5ec8ff', weight: 2, fill: false, dashArray: '8 6', interactive: false }));
    const trv = group('trv', 'Perseverance rover path', 'obs', '#fff', false);
    trv.addLayer(L.geoJSON(b.traverse, { coordsToLatLng: (c: any) => L.latLng(c[1], c[0]), style: { color: '#fff', weight: 1.5, opacity: 0.6 } }));
    const wpg = group('wp', 'Rover stops', 'obs', '#5ec8ff', false);
    for (const w of b.waypoints.filter((q) => q.final === 'y')) wpg.addLayer(L.circleMarker(ll([w.x, w.y]), { radius: 4, color: '#5ec8ff', weight: 1.5, fillOpacity: 0.4 })
      .bindTooltip(`Sol ${w.sol} · RMC ${w.rmc}<br>${w.lat.toFixed(5)}° N, ${w.lon.toFixed(5)}° E · ${w.elev_geoid_m.toFixed(1)} m`));
    const ph = group('photos', 'Ground photos (tap)', 'obs', '#5ec8ff');
    for (const p of b.photos) {
      const c: XY = [p.camera_position.x, p.camera_position.y];
      if (p.heading.azimuth_deg !== null) {
        const half = p.heading.hfov_deg / 2, R = 120, pts = [ll(c)];
        for (let a = -half; a <= half + 0.01; a += half / 4) { const az = (p.heading.azimuth_deg + a) * Math.PI / 180; pts.push(ll([c[0] + R * Math.sin(az), c[1] + R * Math.cos(az)])); }
        ph.addLayer(L.polygon(pts, { color: '#5ec8ff', weight: 1, fillOpacity: 0.12, interactive: false }));
      }
      const m = L.marker(ll(c), { icon: L.divIcon({ className: '', html: '<div class="camIcon" style="width:26px;height:26px">📷</div>', iconSize: [26, 26] }) })
        .bindTooltip(`${p.camera} · sol ${p.sol}<br>${esc(p.selection_note)}`).on('click', () => openPhoto(p.product_id));
      ph.addLayer(m);
    }
    const pin = group('pin', 'Landing pin (drag)', 'sim', '#fff');
    const pm = L.marker(ll(state.areas.jezero.landingPin), { draggable: true, title: 'Landing briefing pin', icon: L.divIcon({ className: '', html: '<div style="font-size:28px;line-height:28px">📍</div>', iconSize: [28, 28], iconAnchor: [14, 28] }) });
    pm.on('dragend', () => { state.areas.jezero.landingPin = xy(pm.getLatLng()); log('event', `Briefing pin moved to ${fmtLonLat('jezero', ...state.areas.jezero.landingPin)}`); });
    pin.addLayer(pm);
    if (b.meda.status === 'available') {
      const st = group('meda', 'Weather station', 'obs', '#5ec8ff');
      for (const s of b.meda.sols ?? []) if (s.station_xy) st.addLayer(L.circleMarker(ll(s.station_xy), { radius: 8, color: '#5ec8ff', weight: 3, fill: false }).bindTooltip(`MEDA sol ${s.sol}`));
    }
    if (fit) map.fitBounds(bb, { padding: [10, 10] });
  } else {
    const e = b.nili;
    const received = state.areas.nili.observationReceived;
    const bb = boundsOf(e.cropBounds);
    const before = group('nBefore', 'Before image (30 Jun 2007)', 'obs', '#666', false);
    before.addLayer(L.imageOverlay(url(`nili/${e.previews.before_aligned}`), bb));
    if (!received) { visible.nBefore = true; }
    const after = group('nAfter', 'After image (13 Oct 2007)', 'obs', '#888');
    after.addLayer(L.imageOverlay(url(`nili/${e.previews.after}`), bb, { attribution: 'NASA/JPL-Caltech/University of Arizona (HiRISE)' }));
    group('nMask', 'Change mask (pixels)', 'derived', '#ffaa00', false).addLayer(L.imageOverlay(url(`nili/${e.previews.mask_overlay}`), bb, { opacity: 0.8 }));
    const cov = group('cov', 'Edge of change analysis', 'obs', 'transparent;border:2px solid #5ec8ff');
    cov.addLayer(L.rectangle(bb, { color: '#5ec8ff', weight: 2, fill: false, dashArray: '8 6', interactive: false }));
    const nasa = group('nasa', 'NASA reference area', 'obs', 'transparent;border:2px dotted #5ec8ff');
    nasa.addLayer(L.geoJSON(e.nasa_reference.footprint_local_m, { coordsToLatLng: (c: any) => L.latLng(c[1], c[0]), style: { color: '#5ec8ff', weight: 2, dashArray: '2 5', fill: false } })
      .bindTooltip('NASA PIA15680 frame located in both HiRISE products. NASA documented ripple movement here (site-level finding).'));
    const regs = group('regions', 'Changed ground (tap)', 'derived', '#ffb547');
    for (const r of received ? e.regions : []) {
      const col = CLS_COLOR[r.classification];
      const lyr = L.geoJSON(r.geometry_local_m, { coordsToLatLng: (c: any) => L.latLng(c[1], c[0]),
        style: { color: col, weight: r.classification === 'Verified' ? 2.5 : 1.5, dashArray: r.classification === 'Uncertain' ? '4 4' : r.classification === 'Requires Review' ? '10 4' : undefined, fillOpacity: 0.18, fillColor: col } });
      lyr.bindTooltip(`${r.id}<br><b>${r.classification}</b> · ${r.area_m2.toLocaleString()} m²`, { sticky: true });
      lyr.on('click', () => openEvidence(r.id));
      regs.addLayer(lyr);
    }
    if (fit) map.fitBounds(bb.pad(0.25), { padding: [10, 10] });
  }
  // routes (both areas)
  const plans = optionsFor(area).map((o) => app.plans[`${area}:${o.id}`]).filter(Boolean) as EvaluatedPlan[];
  const rg = group('routes', 'Walking routes', area === 'nili' ? 'sim' : 'derived', '#ff8a3d');
  for (const p of plans) {
    const active = p.option.id === state.areas[area].routeOption;
    p.legs.forEach((leg, i) => {
      const line = L.polyline(leg.map(ll), { color: active ? '#ff8a3d' : '#d8d8d8', weight: active ? 5 : 3, opacity: active ? 0.95 : 0.6, dashArray: area === 'nili' ? '12 6' : (i === p.legs.length - 1 ? '6 6' : undefined) });
      line.bindTooltip(`${esc(p.option.label)} · leg ${i + 1}${i === p.legs.length - 1 ? ' (return)' : ''}`, { sticky: true });
      line.on('click', () => { state.areas[area].routeOption = p.option.id; emit('route'); });
      rg.addLayer(line);
    });
  }
  // stops
  const sg = group('stops', 'Habitat and stops', 'sim', '#fff');
  const act = activePlan(area);
  const stops = act?.stops ?? state.areas[area].stops;
  stops.slice(0, -1).forEach((s, i) => {
    const html = i === 0 ? '<div class="habIcon" style="width:30px;height:30px">H</div>' : `<div class="stopIcon ${s.required ? 'req' : ''}" style="width:28px;height:28px">${i}</div>`;
    sg.addLayer(L.marker(ll(s.xy), { icon: L.divIcon({ className: '', html, iconSize: [30, 30] }) }).bindTooltip(`${esc(s.label)}${s.required ? ' <b>(required)</b>' : ''}`));
  });
  const tb = turnBack(area);
  if (tb && tb.xy) group('turn', 'Turn-back point (↩)', 'sim', '#ffc94d').addLayer(L.marker(ll(tb.xy), { icon: L.divIcon({ className: '', html: '<div class="turnIcon">↩</div>', iconSize: [28, 28] }) }).bindTooltip(`Turn back here if consumables run ${tb.factor}× faster than planned`));
  // crossings (Nili)
  if (act && act.impact.status === 'intersects') {
    const cg = group('cross', 'Crossings to inspect (tap)', 'derived', '#ff3df0');
    for (const c of act.impact.crossings) {
      const line = L.polyline(c.segment.map(ll), { color: '#ff3df0', weight: 10, opacity: 0.9 });
      line.bindTooltip(`Tap to inspect: ${c.regionId}<br>${c.startAlong_m.toFixed(0)}-${c.endAlong_m.toFixed(0)} m along the walk`, { sticky: true });
      line.on('click', () => openEvidence(c.regionId, c));
      cg.addLayer(line);
    }
  }
  // crew
  const crew = crewFor(area);
  const cg = group('crew', 'Crew and tablets', 'sim', '#5fd38d');
  crew.anchors.forEach((a) => cg.addLayer(L.circleMarker(ll(a.xy), { radius: 6, color: '#c792ff', weight: 2, dashArray: '2 3', fillOpacity: 0.2 }).bindTooltip(`${a.label} · ranging anchor`)));
  for (const s of crew.suits) {
    if (!s.lastFix) continue;
    const fs = fixState(crew, s);
    cg.addLayer(L.circle(ll(s.lastFix.xy), { radius: s.lastFix.sigma2_m, color: fs === 'live' ? '#5fd38d' : '#999', weight: 1, dashArray: fs === 'live' ? undefined : '3 3', fillOpacity: 0.08 }));
    const cls = fs !== 'live' ? 'stale' : s.wearer === 'unconfirmed' ? 'unconf' : 'live';
    cg.addLayer(L.marker(ll(s.lastFix.xy), { icon: L.divIcon({ className: '', html: `<div class="crewIcon ${cls}" style="width:26px;height:26px">${s.id.slice(-2)}</div>`, iconSize: [26, 26] }) })
      .bindTooltip(`${s.id} · ${esc(s.astronaut)}<br>${fs === 'live' ? 'LIVE suit fix' : `LAST KNOWN fix, ${fmtT(crew.t - s.lastFix.t)} old`} ±${s.lastFix.sigma2_m.toFixed(1)} m (2σ)<br>${esc(wearerText(s))}<br><i>simulated</i>`));
  }
  for (const t of crew.tablets) cg.addLayer(L.marker(ll(t.pos), { icon: L.divIcon({ className: '', html: `<div class="tabIcon" style="width:24px;height:18px">TAB</div>`, iconSize: [24, 18] }) })
    .bindTooltip(`${t.id} (${esc(t.owner)})<br>${t.carriedBy ? `carried by ${t.carriedBy}` : '<b>left behind here</b>; its owner\'s position comes from the suit beacon'}<br><i>simulated</i>`));
  renderLegend();
}

let legendOpen = false;
function renderLegend() {
  const el = $('#legend');
  el.classList.toggle('open', legendOpen);
  el.innerHTML = `<button class="legendToggle" id="legendToggle" aria-expanded="${legendOpen}">Map layers ${legendOpen ? '▾' : '▸'}</button>` + (legendOpen ? legendItems.map((i) =>
    `<label><input type="checkbox" data-l="${i.id}" ${visible[i.id] ? 'checked' : ''}><span class="sw" style="background:${i.swatch}"></span><span>${esc(i.label)}${i.kind === 'sim' ? ' <span class="tag sim">sim</span>' : ''}</span></label>`).join('') : '');
  $('#legendToggle').onclick = () => { legendOpen = !legendOpen; renderLegend(); };
  el.querySelectorAll<HTMLInputElement>('input[data-l]').forEach((cb) => cb.onchange = () => {
    visible[cb.dataset.l!] = cb.checked; if (cb.checked) groups[cb.dataset.l!].addTo(map); else groups[cb.dataset.l!].remove();
  });
}

/** Map banner: only shown when something needs the crew's attention. */
function renderDecision(area: AreaId) {
  const el = $('#decision'); const p = activePlan(area);
  if (!p) { el.innerHTML = ''; return; }
  if (area === 'nili' && p.impact.status === 'intersects') {
    const c = p.impact.crossings[0]; const allAck = p.impact.crossings.every((q) => state.areas.nili.acknowledged.includes(q.regionId));
    const n = p.impact.crossings.length;
    el.innerHTML = `<div class="inner ${allAck ? 'calm' : ''}"><span style="font-size:26px">${allAck ? '✓' : '⚠'}</span><div><b>${allAck ? 'Crossing acknowledged' : 'Changed ground on your route'}</b>
      <span class="sub">${n} crossing${n > 1 ? 's' : ''} · first at ${c.startAlong_m.toFixed(0)} m from the habitat</span></div>
      <button class="primary" id="decOpen">Inspect</button></div>`;
    $('#decOpen').onclick = () => { map.fitBounds(L.latLngBounds(c.segment.map(ll)).pad(2)); openEvidence(c.regionId, c); };
  } else if (!p.ok) {
    el.innerHTML = `<div class="inner"><span style="font-size:22px">⛔</span><div><b>${esc(p.option.label)}</b><span class="sub">${esc(p.failReason)}</span></div></div>`;
  } else el.innerHTML = '';
}

function renderPanel(area: AreaId) {
  const el = $('#panel'); const scroll = el.scrollTop;
  const collapsed = new Set([...el.querySelectorAll('.card.collapsed')].map((c) => c.id));
  const expanded = new Set([...el.querySelectorAll('.card:not(.collapsed)')].map((c) => c.id));
  const openDet = new Set([...el.querySelectorAll('.card details[open]')].map((d) => d.closest('.card')!.id + '|' + (d as HTMLElement).dataset.k));
  const plans = optionsFor(area).map((o) => app.plans[`${area}:${o.id}`]).filter(Boolean) as EvaluatedPlan[];
  const sim = '<span class="tag sim">simulated</span>';
  const html: string[] = [];
  html.push(card('cRoutes', 'Route', area === 'nili' ? sim : '', routesHtml(area, plans)));
  if (area === 'nili') html.push(card('cChange', 'Ground change alerts', '', changeHtml(plans)));
  html.push(card('cMC', 'Can we make it back?', '', mcHtml(plans)));
  html.push(card('cSurv', 'Survival check', '<span class="tag sim">model</span>', survivalHtml(area)));
  if (area === 'jezero') {
    html.push(card('cBrief', 'Landing site', '', briefingHtml()));
    html.push(card('cWx', 'Weather', '', weatherHtml('jezero')));
    html.push(card('cPhotos', 'Ground photos at the stops', '', photosHtml(), true));
  } else {
    html.push(card('cWx', 'Weather', '', weatherHtml('nili'), true));
  }
  html.push(card('cCrew', 'Crew', sim, crewHtml(area)));
  html.push(card('cLog', 'Mission log', '', logHtml(area), true));
  el.innerHTML = html.join('');
  el.querySelectorAll('.card').forEach((c) => {
    if (collapsed.has(c.id)) c.classList.add('collapsed'); else if (expanded.has(c.id)) c.classList.remove('collapsed');
    c.querySelectorAll<HTMLElement>('details').forEach((d) => { if (openDet.has(c.id + '|' + d.dataset.k)) d.setAttribute('open', ''); });
  });
  el.querySelectorAll<HTMLElement>('.card > h3').forEach((h) => h.onclick = () => h.parentElement!.classList.toggle('collapsed'));
  el.scrollTop = scroll;
  bindPanel(area);
}

const short = (label: string) => esc(label.split('(')[0].replace(/^[A-Z]\.\s*/, '').trim());

function routesHtml(area: AreaId, plans: EvaluatedPlan[]) {
  const act = state.areas[area].routeOption;
  const rows = (lab: string, f: (p: EvaluatedPlan) => string) => `<tr><th>${lab}</th>${plans.map((p) => `<td class="${p.option.id === act ? 'act' : ''}">${p.ok ? f(p) : '—'}</td>`).join('')}</tr>`;
  let h = `<div class="row">${plans.map((p) => `<button data-route="${p.option.id}" class="${p.option.id === act ? 'on' : ''}">${esc(p.option.label)}</button>`).join('')}</div>`;
  h += `<table class="cmp"><tr><th></th>${plans.map((p) => `<th class="${p.option.id === act ? 'act' : ''}">${short(p.option.label)}</th>`).join('')}</tr>`;
  h += rows('Total distance', (p) => fmtM(p.metrics!.distance_m) + (p.metrics!.includesReturn ? ' <small>incl. return</small>' : ''));
  h += rows('Walking time', (p) => fmtH(p.metrics!.nominalDuration_s));
  if (area === 'jezero') {
    h += rows('Climb', (p) => p.metrics!.gain_m === null ? '—' : `${p.metrics!.gain_m.toFixed(0)} m`);
    h += rows('Steepest', (p) => p.metrics!.maxSlopeDeg === null ? '—' : `${p.metrics!.maxSlopeDeg.toFixed(0)}° <small>leg ${p.metrics!.maxSlopeLeg! + 1}</small>`);
  }
  h += rows('O₂ / battery at return', (p) => `${p.metrics!.o2Remaining_pct.toFixed(0)}% / ${p.metrics!.batteryRemaining_pct.toFixed(0)}%`);
  h += rows('Changed ground', (p) => p.impact.status === 'no_analysis' ? '<small>no change analysis here</small>' : p.impact.status === 'intersects' ? `<b style="color:#ff3df0">${p.impact.crossings.length} crossings</b>` : p.impact.status === 'clear' ? 'none' : esc(p.impact.status.replace('_', ' ')));
  h += `</table>`;
  plans.filter((p) => !p.ok).forEach((p) => { h += `<div class="badbox">${esc(p.option.label)}: ${esc(p.failReason)}</div>`; });
  if (area === 'jezero' && plans.length === 2 && plans.every((p) => p.ok)) {
    const ex = explainDifference(plans[0].metrics!, plans[1].metrics!);
    if (ex) h += `<div class="note">Why they differ: leg ${ex.leg + 1} (${esc(ex.from.split('(')[0])} → ${esc(ex.to.split('(')[0])}). The gentle route takes ${ex.dTime_s >= 0 ? '+' : ''}${(ex.dTime_s / 60).toFixed(1)} min and ${ex.dDist_m >= 0 ? '+' : ''}${ex.dDist_m.toFixed(0)} m there, and its steepest slope is ${ex.maxSlopeB?.toFixed(0)}° instead of ${ex.maxSlopeA?.toFixed(0)}°.</div>`;
  }
  if (area === 'nili') h += `<div class="note">No terrain model here, so climb and slope are unknown and times assume flat ground.</div>`;
  return h;
}

function mcHtml(plans: EvaluatedPlan[]) {
  const a = state.assumptions;
  let h = `<div class="mcRow">${plans.map((p) => `<div class="mcCell"><small>${short(p.option.label)}</small>${p.mc
    ? `<b class="big ${p.mc.successPct >= 90 ? 'good' : p.mc.successPct >= 60 ? 'mid' : 'low'}">${p.mc.successPct.toFixed(1)}%</b><small>${p.mc.successPct.toFixed(1)}% of ${p.mc.trials} simulated missions returned with reserve</small>
       <small>${p.mc.mainFailure ? `Main risk: ${esc(FAIL_LABEL[p.mc.mainFailure])} (${p.mc.failures[p.mc.mainFailure]})` : 'No failures in the simulated missions'}</small>`
    : '<b class="big">—</b>'}</div>`).join('')}</div>`;
  const num = (k: keyof Assumptions, label: string, step = 1) => `<label class="row inp"><span>${label}</span><input type="number" step="${step}" data-a="${k}" value="${(a as any)[k]}"></label>`;
  h += `<details data-k="in"><summary>Change supplies and conditions</summary>
    ${num('o2Kg', 'Oxygen (kg)', 0.05)}${num('batteryWh', 'Battery (Wh)', 10)}${num('reservePct', 'Reserve to keep (%)')}${num('evaLimitH', 'EVA time limit (h)', 0.5)}
    ${num('equipmentKg', 'Carried equipment (kg)')}${num('requiredTaskMin', 'Science task (min)')}${num('obstaclesPerKm', 'Obstacles per km', 0.5)}
    <label class="row inp"><span>Conditions</span><select data-a="environment">${Object.entries(ENV_SCENARIOS).map(([k, v]) => `<option value="${k}" ${a.environment === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
    <details data-k="adv"><summary>Model settings</summary>
      ${num('v0_kmh', 'Flat walking speed (km/h)', 0.1)}${num('restW', 'Resting metabolic (W)')}${num('taskW', 'Task metabolic (W)')}${num('baseW', 'Suit base load (W)')}
      <label class="row inp"><span>Trials / seed</span><span><input type="number" data-s="trials" value="${state.trials}" style="width:70px"> <input type="number" data-s="seed" value="${state.seed}" style="width:80px"></span></label>
    </details>
    <button id="mcReset">Restore defaults</button></details>
    <div class="note">An estimate from a simulation, not a guarantee. <a href="#" data-src="model">How it works</a></div>`;
  return h;
}

function briefingHtml() {
  const t = app.b.terrain; const pin = state.areas.jezero.landingPin; const R = 100;
  let n = 0, cov = 0, zmin = Infinity, zmax = -Infinity; const sl: number[] = [];
  const [c0, r0] = t.cell(...pin); const k = Math.ceil(R / t.res);
  for (let r = r0 - k; r <= r0 + k; r++) for (let c = c0 - k; c <= c0 + k; c++) {
    const p = t.center(c, r); if (dist(p, pin) > R) continue; n++;
    const z = t.zAt(c, r); if (!Number.isFinite(z)) continue; cov++; zmin = Math.min(zmin, z); zmax = Math.max(zmax, z);
    const s = t.slopeAt(c, r); if (Number.isFinite(s)) sl.push(s);
  }
  sl.sort((a, b) => a - b); const q = (p: number) => sl.length ? sl[Math.min(sl.length - 1, Math.floor(p * sl.length))] : NaN;
  const steep = sl.length ? 100 * sl.filter((s) => s > 15).length / sl.length : 0;
  return `<div class="note">Pin: ${fmtLonLat('jezero', ...pin)} (drag 📍 on the map). Within ${R} m of the pin:</div>
    <dl class="kv"><dt>Typical slope</dt><dd>${sl.length ? `${q(0.5).toFixed(0)}° (max ${sl[sl.length - 1].toFixed(0)}°)` : '—'}</dd>
    <dt>Steeper than 15°</dt><dd>${sl.length ? `<span style="color:${steep > 10 ? 'var(--warn)' : 'inherit'}">${steep.toFixed(0)}% of the ground</span>` : '—'}</dd>
    <dt>Height range</dt><dd>${cov ? `${(zmax - zmin).toFixed(0)} m` : '—'}</dd>
    ${cov < n ? `<dt>Data</dt><dd><b style="color:var(--warn)">${n ? (100 * cov / n).toFixed(0) : 0}% covered: pin is near the edge of the terrain data</b></dd>` : ''}</dl>`;
}

function weatherHtml(area: AreaId) {
  const dust = dustAdvisory(area);
  const dustLine = dust ? `<div class="note"><b>Dust:</b> ${esc(dust.text)} <a href="#" data-src="weather">Dust history</a></div>` : '';
  if (area === 'nili') return `<div class="warnbox">No surface weather is shown for Nili Patera. There is no weather station near this site.</div>${dustLine}`;
  const daily = medaDailyHtml(state.areas.jezero.landingPin);
  if (daily) return daily + dustLine;
  const meda = app.b.meda; const a = state.areas.jezero;
  const cardv = weatherCard(meda, a.landingPin, null, a.weatherMinute, app.b.terrain.covered(...a.landingPin));
  return `<div class="warnbox"><b>${esc(cardv.title)}</b><br>No weather readings are loaded for this site, so none are shown.</div>${dustLine}`;
}

export function sparkline(series: any[]) {
  const W = 400, H = 60; const v = series.map((s) => s.cdod610); const mx = Math.max(0.1, ...v.filter((x) => x !== null));
  let d = '', pen = false;
  v.forEach((x, i) => { const X = (i / Math.max(1, v.length - 1)) * W; if (x === null) { pen = false; return; } const Y = H - (x / mx) * (H - 4); d += `${pen ? 'L' : 'M'}${X.toFixed(1)},${Y.toFixed(1)}`; pen = true; });
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:60px;background:#111;border-radius:6px"><path d="${d}" fill="none" stroke="#ffc94d" stroke-width="1.5"/><text x="4" y="12" fill="#999" font-size="10">CDOD max ${mx.toFixed(2)} · gaps = breaks</text></svg>`;
}

function photosHtml() {
  const stopName = (id: string) => (state.areas.jezero.stops.find((s) => s.id === id)?.label ?? id).split('(')[0].trim();
  return app.b.photos.map((p) => `<div class="photoCard" style="margin-bottom:10px"><img loading="lazy" src="${url('jezero/' + p.local_file)}" alt="${esc(p.camera)} photo" data-photo="${p.product_id}">
    <div class="note"><b>${esc(stopName(p.stop))}</b> · ${esc(p.camera)} · sol ${p.sol}. Tap for details.</div></div>`).join('');
}

function changeHtml(plans: EvaluatedPlan[]) {
  const e = app.b.nili; const sm = e.summary;
  const act = plans.find((p) => p.option.id === state.areas.nili.routeOption);
  let h = '';
  if (act) h += `<h4 class="sub">Route impact · ${short(act.option.label)}</h4><div class="${act.impact.status === 'intersects' ? 'warnbox' : act.impact.status === 'clear' ? 'okbox' : 'simbox'}">${esc(act.impact.message)}
    ${act.impact.crossings.map((c) => `<div class="row"><button data-cross="${c.regionId}|${c.startAlong_m}">Inspect crossing at ${c.startAlong_m.toFixed(0)}-${c.endAlong_m.toFixed(0)} m</button></div>`).join('')}
    <small>Covered by analysis: ${fmtM(act.impact.coveredLength_m)} of ${fmtM(act.impact.totalLength_m)}.</small></div>`;
  if (state.areas.nili.observationReceived) h += `<div class="note">${sm.candidate_regions} areas changed between the June and October 2007 images:
    <span class="tag Verified">${sm.by_class.Verified} verified</span> <span class="tag Requires">${sm.by_class['Requires Review']} need review</span> <span class="tag Uncertain">${sm.by_class.Uncertain} uncertain</span>.
    Tap an area on the map for the before/after images.</div>
    <details data-k="all"><summary>All changed areas</summary><table class="cmp">${e.regions.map((r) => `<tr><td><a href="#" data-region="${r.id}">Area ${r.id.slice(-3)}</a></td><td><span class="tag ${r.classification.split(' ')[0]}">${r.classification}</span></td><td>${r.area_m2.toLocaleString()} m²</td></tr>`).join('')}</table></details>
    <div class="note"><a href="#" data-src="change">How the changes were found</a></div>`;
  return h;
}

function crewHtml(area: AreaId) {
  const crew = crewFor(area); const A = crew.suits[0]; const sel = crew.suits.find((s) => s.id === selectedCrew) ?? crew.suits[1];
  const rel = relative(crew, A, sel);
  let walk = '';
  if (rel && area === 'jezero' && A.lastFix && sel.lastFix) {
    const r = routeLeg(app.b.terrain, A.lastFix.xy, sel.lastFix.xy, PROFILES[0], state.assumptions.v0_kmh);
    walk = r.ok ? `${fmtM(r.path.reduce((s, p, i) => (i ? s + dist(r.path[i - 1], p) : 0), 0))} on foot` : `no checked walking route`;
  } else if (rel) walk = 'not checked (no terrain data)';
  return `<div class="crewList">${crew.suits.map((s) => { const fs = fixState(crew, s); return `<button data-crew="${s.id}" class="${s.id === sel.id ? 'on' : ''}">${s.id} · ${esc(s.astronaut)}<br><small>${s.lastFix ? (fs === 'live' ? `● Live ±${s.lastFix.sigma2_m.toFixed(1)} m` : `○ Last known ${fmtT(crew.t - s.lastFix.t)} ago`) : 'no fix yet'}${s.wearer === 'unconfirmed' ? ' · wearer unconfirmed' : ''}${s.distress ? ' · DISTRESS' : ''}</small></button>`; }).join('')}</div>
    ${rel ? `<dl class="kv"><dt>${A.id} → ${sel.id}</dt><dd>${rel.range_m.toFixed(0)} m, bearing ${rel.bearing_deg.toFixed(0)}°</dd><dt>Walking</dt><dd>${walk}</dd><dt>Last contact</dt><dd>${fmtT(rel.age_s)} ago${rel.state === 'live' ? '' : ' · <b>not live</b>'}</dd><dt>Wearer</dt><dd>${esc(wearerText(sel))}</dd></dl>` : ''}
    <details data-k="sc"><summary>Demo scenarios</summary><div class="row"><button data-cs="drop">Leave tablet behind</button><button data-cs="cut">Cut B's suit link</button><button data-cs="restore">Restore link</button><button data-cs="spare">Spare suit transmits</button><button data-cs="reset">Reset crew</button></div></details>`;
}

function logHtml(area: AreaId) {
  const l = state.log.filter((x) => x.area === area).slice(-30).reverse();
  return l.length ? `<table class="cmp">${l.map((x) => `<tr><td><small>${x.t}</small></td><td><small>${x.kind}${x.simulated ? ' · sim' : ''}</small></td><td>${esc(x.text)}</td></tr>`).join('')}</table>` : '<div class="note">No entries yet.</div>';
}

function bindPanel(area: AreaId) {
  const el = $('#panel');
  el.querySelectorAll<HTMLButtonElement>('[data-route]').forEach((b) => b.onclick = () => { state.areas[area].routeOption = b.dataset.route!; log('decision', `Active route set to ${b.textContent}`); emit('route'); });
  el.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-a]').forEach((i) => i.onchange = () => {
    const k = i.dataset.a as keyof Assumptions; (state.assumptions as any)[k] = k === 'environment' ? i.value : +i.value; emit('assumptions');
  });
  el.querySelectorAll<HTMLInputElement>('[data-s]').forEach((i) => i.onchange = () => { (state as any)[i.dataset.s!] = Math.max(1, Math.round(+i.value)); emit('assumptions'); });
  const mr = el.querySelector<HTMLButtonElement>('#mcReset'); if (mr) mr.onclick = async () => { const { DEFAULT_ASSUMPTIONS } = await import('../core/metrics'); state.assumptions = { ...DEFAULT_ASSUMPTIONS }; state.trials = 500; state.seed = 2026; emit('assumptions'); };
  const svS = el.querySelector<HTMLInputElement>('#svStart'); if (svS) svS.onchange = () => { survivalSettings.startLmst = svS.value || '09:00'; renderPlanner('survival'); };
  const svF = el.querySelector<HTMLInputElement>('#svFactor'); if (svF) svF.onchange = () => { survivalSettings.factor = Math.max(1, +svF.value || 1.5); renderPlanner('survival'); };
  const ws = el.querySelector<HTMLSelectElement>('#wxSol'); if (ws) ws.onchange = () => { state.areas.jezero.weatherSol = +ws.value; state.areas.jezero.weatherMinute = 0; emit('weather'); };
  const wm = el.querySelector<HTMLInputElement>('#wxMin'); if (wm) wm.oninput = () => { state.areas.jezero.weatherMinute = +wm.value; renderPanel('jezero'); };
  el.querySelectorAll<HTMLElement>('[data-src]').forEach((a) => a.onclick = (e) => { e.preventDefault(); openSources(a.dataset.src!); });
  el.querySelectorAll<HTMLElement>('[data-photo]').forEach((i) => i.onclick = () => openPhoto(i.dataset.photo!));
  el.querySelectorAll<HTMLElement>('[data-region]').forEach((a) => a.onclick = (e) => { e.preventDefault(); openEvidence(a.dataset.region!); });
  el.querySelectorAll<HTMLButtonElement>('[data-cross]').forEach((b) => b.onclick = () => {
    const [id, s] = b.dataset.cross!.split('|'); const c = activePlan('nili')!.impact.crossings.find((q) => q.regionId === id && Math.abs(q.startAlong_m - +s) < 0.01)!;
    map.fitBounds(L.latLngBounds(c.segment.map(ll)).pad(2)); openEvidence(id, c);
  });
  el.querySelectorAll<HTMLButtonElement>('[data-crew]').forEach((b) => b.onclick = () => { selectedCrew = b.dataset.crew!; renderPlanner('crew'); });
  el.querySelectorAll<HTMLButtonElement>('[data-cs]').forEach((b) => b.onclick = () => crewScenario(area, b.dataset.cs!));
}

export function crewScenario(area: AreaId, what: string) {
  const crew = crewFor(area); const A = crew.suits[0], B = crew.suits[1];
  if (what === 'drop') {
    dropTablet(crew, 'TAB-1');
    const p = A.truePos; moveSuit(crew, A.id, [p[0] - 60, p[1] + 45]); step(crew, 60);
    log('crew', 'Scenario 1: Astronaut A left TAB-1 and walked ~75 m. Crew marker follows SUIT-A1; TAB-1 stays where it was left.', true, area);
  } else if (what === 'cut') {
    setComms(crew, B.id, 'lost'); const p = B.truePos; moveSuit(crew, B.id, [p[0] + 40, p[1] - 30]); step(crew, 45);
    log('crew', 'Scenario 2: SUIT-B2 link lost. Last received fix frozen and shown with its age; not presented as live.', true, area);
  } else if (what === 'restore') {
    setComms(crew, B.id, 'live'); step(crew, 5); log('crew', 'SUIT-B2 link restored; live updates resumed.', true, area);
  } else if (what === 'spare') {
    powerSpareSuit(crew, 'SUIT-S3'); step(crew, 5); selectedCrew = 'SUIT-S3';
    log('crew', 'Scenario 3: unassigned SUIT-S3 transmits. Suit location reported; wearer unconfirmed.', true, area);
  } else if (what === 'reset') { resetCrew(area); selectedCrew = 'SUIT-B2'; }
  emit('crew');
}

export function focusCrossing() {
  const p = activePlan('nili'); if (!p || p.impact.status !== 'intersects') return;
  const c = p.impact.crossings[0]; map.fitBounds(L.latLngBounds(c.segment.map(ll)).pad(3));
}
export function plannerMap() { return map; }
