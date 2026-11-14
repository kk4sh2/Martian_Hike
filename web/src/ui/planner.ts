import L from 'leaflet';
import { app, evaluateArea, activePlan, crewFor, resetCrew } from '../app';
import { state, emit, log } from '../state';
import { createMap, ll, xy, boundsOf } from './map';
import { $, card, esc, fmtM, fmtH } from './dom';
import { url } from '../data';
import { optionsFor, type EvaluatedPlan } from '../plan';
import { explainDifference, ENV_SCENARIOS, PROVENANCE, type Assumptions } from '../core/metrics';
import { FAIL_LABEL } from '../core/montecarlo';
import { weatherCard } from '../core/weather';
import { dist, fmtLonLat, type AreaId, type XY } from '../core/geo';
import { openEvidence } from './evidence';
import { dropTablet, pickUpTablet, setComms, powerSpareSuit, moveSuit, step, fixState, relative, wearerText, fmtT } from '../core/crew';
import { routeLeg, PROFILES } from '../core/routing';
import { openPhoto } from './photo';

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
    group('ortho', 'HiRISE orthomosaic 25 cm (USGS)', 'obs', '#777').addLayer(L.imageOverlay(url('jezero/ortho.jpg'), bb, { attribution: 'USGS Astrogeology / NASA / JPL-Caltech / UArizona HiRISE' }));
    group('hill', 'Hillshade from HiRISE DTM', 'derived', '#556', false).addLayer(L.imageOverlay(url('jezero/hillshade.jpg'), bb, { opacity: 0.55 }));
    group('slope', 'Slope classes (DTM, 5-10/10-15/15-25/>25°)', 'derived', 'linear-gradient(90deg,#fadc3c,#ff961e,#f03228,#c828dc)', false).addLayer(L.imageOverlay(url('jezero/slope_overlay.png'), bb));
    const geo = group('geo', 'Geologic units (USGS SIM 3464, 1:75k)', 'ctx', 'repeating-linear-gradient(45deg,#7a5,#7a5 3px,transparent 3px,transparent 6px)', false);
    geo.addLayer(L.geoJSON(b.geology as any, {
      coordsToLatLng: (c: any) => L.latLng(c[1], c[0]), style: () => ({ color: '#9c6', weight: 1.5, fillOpacity: 0.08, dashArray: '4 3' }),
      onEachFeature: (f: any, lyr) => lyr.bindTooltip(`${esc(f.properties.UnitName ?? f.properties.Unit ?? f.properties.unit ?? 'Unit')} <small>(1:75,000; ±100-200 m)</small>`, { sticky: true }),
    }));
    const cov = group('cov', 'Terrain + imagery coverage boundary', 'obs', 'transparent;border:2px solid #5ec8ff');
    cov.addLayer(L.rectangle(bb, { color: '#5ec8ff', weight: 2, fill: false, dashArray: '8 6', interactive: false }));
    const trv = group('trv', 'Perseverance traverse (NASA)', 'obs', '#fff', false);
    trv.addLayer(L.geoJSON(b.traverse, { coordsToLatLng: (c: any) => L.latLng(c[1], c[0]), style: { color: '#fff', weight: 1.5, opacity: 0.6 } }));
    const wpg = group('wp', 'Rover localized waypoints (NASA)', 'obs', '#5ec8ff', false);
    for (const w of b.waypoints.filter((q) => q.final === 'y')) wpg.addLayer(L.circleMarker(ll([w.x, w.y]), { radius: 4, color: '#5ec8ff', weight: 1.5, fillOpacity: 0.4 })
      .bindTooltip(`Sol ${w.sol} · RMC ${w.rmc}<br>${w.lat.toFixed(5)}° N, ${w.lon.toFixed(5)}° E · ${w.elev_geoid_m.toFixed(1)} m`));
    const ph = group('photos', 'Ground photos: camera position + view cone', 'obs', '#5ec8ff');
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
    const pin = group('pin', 'Landing/habitat briefing pin (draggable)', 'sim', '#fff');
    const pm = L.marker(ll(state.areas.jezero.landingPin), { draggable: true, title: 'Landing briefing pin', icon: L.divIcon({ className: '', html: '<div style="font-size:28px;line-height:28px">📍</div>', iconSize: [28, 28], iconAnchor: [14, 28] }) });
    pm.on('dragend', () => { state.areas.jezero.landingPin = xy(pm.getLatLng()); log('event', `Briefing pin moved to ${fmtLonLat('jezero', ...state.areas.jezero.landingPin)}`); });
    pin.addLayer(pm);
    if (b.meda.status === 'available') {
      const st = group('meda', 'MEDA station (rover position for sol)', 'obs', '#5ec8ff');
      for (const s of b.meda.sols ?? []) if (s.station_xy) st.addLayer(L.circleMarker(ll(s.station_xy), { radius: 8, color: '#5ec8ff', weight: 3, fill: false }).bindTooltip(`MEDA sol ${s.sol}`));
    }
    if (fit) map.fitBounds(bb, { padding: [10, 10] });
  } else {
    const e = b.nili;
    const received = state.areas.nili.observationReceived;
    const bb = boundsOf(e.cropBounds);
    const before = group('nBefore', 'Before: PSP_004339_1890 (2007-06-30), registered', 'obs', '#666', false);
    before.addLayer(L.imageOverlay(url(`nili/${e.previews.before_aligned}`), bb));
    if (!received) { visible.nBefore = true; }
    const after = group('nAfter', 'After: PSP_005684_1890 (2007-10-13)', 'obs', '#888');
    after.addLayer(L.imageOverlay(url(`nili/${e.previews.after}`), bb, { attribution: 'NASA/JPL-Caltech/University of Arizona (HiRISE)' }));
    group('nMask', 'Change mask (pixel level)', 'derived', '#ffaa00', false).addLayer(L.imageOverlay(url(`nili/${e.previews.mask_overlay}`), bb, { opacity: 0.8 }));
    const cov = group('cov', 'Change-analysis coverage (valid common area)', 'obs', 'transparent;border:2px solid #5ec8ff');
    cov.addLayer(L.rectangle(bb, { color: '#5ec8ff', weight: 2, fill: false, dashArray: '8 6', interactive: false }));
    const nasa = group('nasa', 'NASA PIA15680 frame (documented ripple motion)', 'obs', 'transparent;border:2px dotted #5ec8ff');
    nasa.addLayer(L.geoJSON(e.nasa_reference.footprint_local_m, { coordsToLatLng: (c: any) => L.latLng(c[1], c[0]), style: { color: '#5ec8ff', weight: 2, dashArray: '2 5', fill: false } })
      .bindTooltip('NASA PIA15680 frame located in both HiRISE products. NASA documented ripple movement here (site-level finding).'));
    const regs = group('regions', 'Candidate change regions (class colour + dash)', 'derived', '#ffb547');
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
  const rg = group('routes', area === 'nili' ? 'Hypothetical walks (simulated)' : 'Route options (both include return)', area === 'nili' ? 'sim' : 'derived', '#ff8a3d');
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
  const sg = group('stops', 'Habitat and science stops', 'sim', '#fff');
  const act = activePlan(area);
  const stops = act?.stops ?? state.areas[area].stops;
  stops.slice(0, -1).forEach((s, i) => {
    const html = i === 0 ? '<div class="habIcon" style="width:30px;height:30px">H</div>' : `<div class="stopIcon ${s.required ? 'req' : ''}" style="width:28px;height:28px">${i}</div>`;
    sg.addLayer(L.marker(ll(s.xy), { icon: L.divIcon({ className: '', html, iconSize: [30, 30] }) }).bindTooltip(`${esc(s.label)}${s.required ? ' <b>(required)</b>' : ''}`));
  });
  // crossings (Nili)
  if (act && act.impact.status === 'intersects') {
    const cg = group('cross', 'Route crossings to inspect (tap)', 'derived', '#ff3df0');
    for (const c of act.impact.crossings) {
      const line = L.polyline(c.segment.map(ll), { color: '#ff3df0', weight: 10, opacity: 0.9 });
      line.bindTooltip(`Tap to inspect: ${c.regionId}<br>${c.startAlong_m.toFixed(0)}-${c.endAlong_m.toFixed(0)} m along the walk`, { sticky: true });
      line.on('click', () => openEvidence(c.regionId, c));
      cg.addLayer(line);
    }
  }
  // crew
  const crew = crewFor(area);
  const cg = group('crew', 'Crew suits / tablets (simulated)', 'sim', '#5fd38d');
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

function renderLegend() {
  const el = $('#legend');
  const kindTag: Record<string, string> = { obs: '<span class="tag obs">observed</span>', derived: '<span class="tag derived">derived</span>', sim: '<span class="tag sim">simulated</span>', ctx: '<span class="tag assumed">context</span>' };
  el.innerHTML = `<h4>Layers · ${state.area === 'jezero' ? 'Jezero Crater' : 'Nili Patera'}</h4>` + legendItems.map((i) =>
    `<label><input type="checkbox" data-l="${i.id}" ${visible[i.id] ? 'checked' : ''}><span class="sw" style="background:${i.swatch}"></span><span>${esc(i.label)}<br>${kindTag[i.kind]}</span></label>`).join('');
  el.querySelectorAll<HTMLInputElement>('input[data-l]').forEach((cb) => cb.onchange = () => {
    visible[cb.dataset.l!] = cb.checked; if (cb.checked) groups[cb.dataset.l!].addTo(map); else groups[cb.dataset.l!].remove();
  });
}

function renderDecision(area: AreaId) {
  const el = $('#decision'); const p = activePlan(area);
  if (!p) { el.innerHTML = ''; return; }
  if (area === 'nili' && p.impact.status === 'intersects') {
    const c = p.impact.crossings[0]; const allAck = p.impact.crossings.every((q) => state.areas.nili.acknowledged.includes(q.regionId));
    el.innerHTML = `<div class="inner ${allAck ? 'calm' : ''}"><span style="font-size:26px">${allAck ? '✓' : '⚠'}</span><div><b>${allAck ? 'Crossing acknowledged' : esc(p.impact.message)}</b>
      <span class="sub">${p.impact.crossings.length} crossing(s) of ${new Set(p.impact.crossings.map((q) => q.regionId)).size} region(s) · first at ${c.startAlong_m.toFixed(0)} m · historical HiRISE 2007 pair · route simulated</span></div>
      <button class="primary" id="decOpen">Inspect</button></div>`;
    $('#decOpen').onclick = () => { map.fitBounds(L.latLngBounds(c.segment.map(ll)).pad(2)); openEvidence(c.regionId, c); };
  } else {
    el.innerHTML = `<div class="inner calm"><span style="font-size:22px">${p.ok ? '◎' : '⛔'}</span><div><b>${esc(p.option.label)}</b><span class="sub">${p.ok ? esc(p.impact.message) : esc(p.failReason)}</span></div></div>`;
  }
}

function provTag(k: keyof typeof PROVENANCE) { const v = PROVENANCE[k]; return `<span class="tag ${v === 'measured' ? 'obs' : v === 'derived' ? 'derived' : v === 'user' ? 'user' : 'assumed'}">${v}</span>`; }

function renderPanel(area: AreaId) {
  const el = $('#panel'); const scroll = el.scrollTop;
  const collapsed = new Set([...el.querySelectorAll('.card.collapsed')].map((c) => c.id));
  const plans = optionsFor(area).map((o) => app.plans[`${area}:${o.id}`]).filter(Boolean) as EvaluatedPlan[];
  const html: string[] = [];
  html.push(area === 'jezero'
    ? `<div class="note"><b>Jezero western delta.</b> Science question: <i>What changes in visible rock layers as the crew approaches the delta deposits?</i> Stops are real Perseverance localizations; the habitat placement is simulated.</div>`
    : `<div class="simbox"><b>Nili Patera change investigation.</b> Observations are historical (HiRISE, 2007). Walks, habitat and crew are simulated for the demonstration. No Jezero data is used here.</div>`);
  html.push(card('cRoutes', 'Route options', `<span class="tag ${area === 'nili' ? 'sim' : 'derived'}">${area === 'nili' ? 'simulated walks' : 'computed on DTM'}</span>`, routesHtml(area, plans)));
  html.push(card('cMC', 'Mission-success estimate', '<span class="tag derived">model</span>', mcHtml(area, plans)));
  if (area === 'jezero') {
    html.push(card('cBrief', 'Landing-site & walking briefing', '<span class="tag derived">from DTM</span>', briefingHtml()));
    html.push(card('cWx', 'Weather forensics', '<span class="tag obs">historical only</span>', weatherHtml('jezero')));
    html.push(card('cPhotos', 'Ground photos at stops', '<span class="tag obs">mission records</span>', photosHtml(), true));
  } else {
    html.push(card('cChange', 'MarsDelta change intelligence', '<span class="tag derived">pipeline</span>', changeHtml(plans)));
    html.push(card('cWx', 'Atmospheric context', '<span class="tag assumed">regional</span>', weatherHtml('nili'), true));
  }
  html.push(card('cCrew', 'Crew tracking', '<span class="tag sim">simulated</span>', crewHtml(area)));
  html.push(card('cLog', 'Mission log', '', logHtml(area), true));
  el.innerHTML = html.join('');
  el.querySelectorAll('.card').forEach((c) => { if (collapsed.has(c.id)) c.classList.add('collapsed'); });
  el.querySelectorAll<HTMLElement>('.card > h3').forEach((h) => h.onclick = () => h.parentElement!.classList.toggle('collapsed'));
  el.scrollTop = scroll;
  bindPanel(area);
}

function routesHtml(area: AreaId, plans: EvaluatedPlan[]) {
  const act = state.areas[area].routeOption;
  const rows = (lab: string, f: (p: EvaluatedPlan) => string) => `<tr><th>${lab}</th>${plans.map((p) => `<td>${p.ok ? f(p) : '—'}</td>`).join('')}</tr>`;
  let h = `<div class="row">${plans.map((p) => `<button data-route="${p.option.id}" class="${p.option.id === act ? 'on' : ''}">${esc(p.option.label)}</button>`).join('')}</div>`;
  h += `<table class="cmp"><tr><th></th>${plans.map((p) => `<th>${esc(p.option.label.split('(')[0])}</th>`).join('')}</tr>`;
  h += rows('Total distance', (p) => fmtM(p.metrics!.distance_m) + (p.metrics!.includesReturn ? ' <small>incl. return</small>' : ''));
  h += rows('Elevation gain', (p) => p.metrics!.gain_m === null ? '<small>no DTM</small>' : `${p.metrics!.gain_m.toFixed(0)} m`);
  h += rows('Steepest mapped segment', (p) => p.metrics!.maxSlopeDeg === null ? '<small>no DTM</small>' : `${p.metrics!.maxSlopeDeg.toFixed(1)}° <small>(leg ${p.metrics!.maxSlopeLeg! + 1}, 10 m baseline)</small>`);
  h += rows('Est. duration', (p) => fmtH(p.metrics!.nominalDuration_s));
  h += rows('O₂ / battery left', (p) => `${p.metrics!.o2Remaining_pct.toFixed(0)}% / ${p.metrics!.batteryRemaining_pct.toFixed(0)}%`);
  h += rows('Stops reached', (p) => p.stops.slice(1, -1).map((s) => esc(s.label.split('(')[0])).join(', '));
  h += rows('Change crossings', (p) => p.impact.status === 'no_analysis' ? '<small>no change analysis here</small>' : p.impact.status === 'intersects' ? `<b style="color:#ff3df0">${p.impact.crossings.length}</b>` : esc(p.impact.status.replace('_', ' ')));
  h += `</table>`;
  plans.filter((p) => !p.ok).forEach((p) => { h += `<div class="badbox">${esc(p.option.label)}: ${esc(p.failReason)}</div>`; });
  if (area === 'jezero' && plans.length === 2 && plans.every((p) => p.ok)) {
    const ex = explainDifference(plans[0].metrics!, plans[1].metrics!);
    if (ex) h += `<div class="note">Difference is mostly explained by leg ${ex.leg + 1} (${esc(ex.from.split('(')[0])} → ${esc(ex.to.split('(')[0])}): ${ex.dTime_s >= 0 ? '+' : ''}${(ex.dTime_s / 60).toFixed(1)} min, ${ex.dDist_m >= 0 ? '+' : ''}${ex.dDist_m.toFixed(0)} m for the gentle option; steepest segment ${ex.maxSlopeA?.toFixed(1)}° vs ${ex.maxSlopeB?.toFixed(1)}°.</div>`;
    h += `<div class="note">Routes are A* paths on the 2 m DTM grid in the local metric projection; no-data cells are never entered. Obstacles are not interpreted from imagery in this prototype; obstacle delay enters only the Monte Carlo as a simulated encounter rate.</div>`;
  }
  if (area === 'nili') h += `<div class="note">${esc(plans.find((p) => p.option.id === act)?.option.note ?? '')} No DTM is packaged for the Nili crop, so gain and slope are unknown and walking time assumes flat ground.</div>`;
  return h;
}

function mcHtml(area: AreaId, plans: EvaluatedPlan[]) {
  const a = state.assumptions;
  let h = `<div class="note">${esc(plans[0]?.mc?.definition ?? '')}</div><table class="cmp"><tr><th></th>${plans.map((p) => `<th>${esc(p.option.label.split('(')[0])}</th>`).join('')}</tr>`;
  h += `<tr><th>Result</th>${plans.map((p) => `<td>${p.mc ? `<b>${p.mc.successPct.toFixed(1)}%</b> of ${p.mc.trials} simulated missions met the objective and reserve` : '—'}</td>`).join('')}</tr>`;
  h += `<tr><th>Main failure</th>${plans.map((p) => `<td>${p.mc ? (p.mc.mainFailure ? `${esc(FAIL_LABEL[p.mc.mainFailure])} (${p.mc.failures[p.mc.mainFailure]})` : 'none') : '—'}</td>`).join('')}</tr>`;
  h += `<tr><th>Tightest margin in successes</th>${plans.map((p) => `<td>${p.mc ? Object.entries(p.mc.limitingInSuccesses).sort((x, y) => y[1] - x[1])[0][0] : '—'}</td>`).join('')}</tr>`;
  h += `<tr><th>Duration p10/50/90</th>${plans.map((p) => `<td>${p.mc ? `${p.mc.p10Duration_h.toFixed(1)} / ${p.mc.p50Duration_h.toFixed(1)} / ${p.mc.p90Duration_h.toFixed(1)} h` : '—'}</td>`).join('')}</tr></table>`;
  h += `<div class="note">Same seed and plan ⇒ same result. Both options use the same random draws, so differences come from the routes. Not a validated probability of human survival. Change polygons do not alter this estimate.</div>`;
  const num = (k: keyof Assumptions, label: string, step = 1) => `<label class="row" style="justify-content:space-between"><span>${label} ${provTag(k as any)}</span><input type="number" step="${step}" data-a="${k}" value="${(a as any)[k]}" style="width:90px"></label>`;
  h += `<details><summary>Inputs and assumptions</summary>
    ${num('o2Kg', 'Usable oxygen (kg)', 0.05)}${num('batteryWh', 'Usable battery (Wh)', 10)}${num('reservePct', 'Required reserve (%)')}
    ${num('equipmentKg', 'Carried equipment (kg)')}${num('obstaclesPerKm', 'Obstacle encounters per km', 0.5)}${num('requiredTaskMin', 'Science task (min)')}
    ${num('v0_kmh', 'Flat walking speed (km/h)', 0.1)}${num('restW', 'Resting metabolic (W)')}${num('taskW', 'Task metabolic (W)')}${num('baseW', 'Suit base load (W)')}${num('evaLimitH', 'EVA limit (h)', 0.5)}
    <label class="row" style="justify-content:space-between"><span>Environment scenario ${provTag('environment')}</span><select data-a="environment">${Object.entries(ENV_SCENARIOS).map(([k, v]) => `<option value="${k}" ${a.environment === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
    <div class="note">${esc(ENV_SCENARIOS[a.environment].note)}</div>
    <label class="row" style="justify-content:space-between"><span>Trials / seed</span><span><input type="number" data-s="trials" value="${state.trials}" style="width:70px"> <input type="number" data-s="seed" value="${state.seed}" style="width:80px"></span></label>
    <ul class="note">${(plans[0]?.mc?.factors ?? []).map((f) => `<li>${esc(f)}</li>`).join('')}<li>Mars gravity 3.711 m/s² ${provTag('gMars')}; O₂ per metabolic energy 0.0711 g/kJ ${provTag('o2PerKJ')}; distance & slope ${provTag('distance')}.</li></ul>
    <button id="mcReset">Restore prototype defaults</button></details>`;
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
  const meda = app.b.meda; const st = meda.status === 'available' ? meda.sols?.find((s) => s.station_xy) : null;
  const dust = app.b.dust.areas.jezero;
  const act = activePlan('jezero');
  return `<div class="note">Pin: ${fmtLonLat('jezero', ...pin)} (drag 📍 on the map). Circle radius ${R} m.</div>
    <h4 style="margin:6px 0">Spacecraft planner · surface</h4>
    <dl class="kv"><dt>DTM coverage</dt><dd>${n ? (100 * cov / n).toFixed(0) : 0}% of the circle ${cov < n ? '<b style="color:var(--warn)">(partly outside coverage)</b>' : ''}</dd>
    <dt>Relief</dt><dd>${cov ? `${(zmax - zmin).toFixed(1)} m (${zmin.toFixed(1)} to ${zmax.toFixed(1)} m, areoid)` : '—'}</dd>
    <dt>Slope (2 m grid)</dt><dd>${sl.length ? `median ${q(0.5).toFixed(1)}°, 95th pct ${q(0.95).toFixed(1)}°, max ${sl[sl.length - 1].toFixed(1)}°; ${(100 * sl.filter((s) => s > 15).length / sl.length).toFixed(1)}% > 15°` : '—'}</dd>
    <dt>Surface weather</dt><dd>${st ? `MEDA station ${fmtM(dist(pin, st.station_xy!))} away (sol ${st.sol})` : 'No MEDA observation packaged'}</dd></dl>
    <h4 style="margin:6px 0">Spacecraft planner · atmosphere during descent (separate)</h4>
    <div class="note">Regional column dust optical depth cell ${dust.cell.lat_min}-${dust.cell.lat_max}° N, ${dust.cell.lon_min}-${dust.cell.lon_max}° E (${dust.cell.dlon_deg}°×${dust.cell.dlat_deg}°). ${esc(dust.caveat)}</div>
    <h4 style="margin:6px 0">Astronaut walking briefing</h4>
    ${act?.metrics ? `<div class="note">${esc(act.option.label)}: ${fmtM(act.metrics.distance_m)} with return, ${act.metrics.gain_m?.toFixed(0)} m climb, steepest ${act.metrics.maxSlopeDeg?.toFixed(1)}°, about ${fmtH(act.metrics.nominalDuration_s)}; estimated return with ${act.metrics.o2Remaining_pct.toFixed(0)}% O₂ and ${act.metrics.batteryRemaining_pct.toFixed(0)}% battery (nominal, no delays).</div>` : ''}
    <div class="note">${esc(String((app.b.terrainMeta.dtm as any).quality_note))} No flight-safety certification or NASA endorsement is implied.</div>`;
}

function weatherHtml(area: AreaId) {
  const dust = app.b.dust.areas[area];
  const dv = dust.series.filter((s: any) => s.cdod610 !== null);
  const dustHtml = `<div class="note"><b>Regional climate context</b> <span class="tag assumed">regional, orbital</span> · ${esc(dust.quantity)} (${esc(dust.units)}), LMD/Montabone gridded maps, cell ${dust.cell.lat_min}-${dust.cell.lat_max}° N × ${dust.cell.lon_min}-${dust.cell.lon_max}° E.
    ${dv.length} of ${dust.series.length} time steps have data in the window (${esc(dust.window_reason)}); range ${Math.min(...dv.map((s: any) => s.cdod610)).toFixed(2)}-${Math.max(...dv.map((s: any) => s.cdod610)).toFixed(2)}. Empty steps are left empty. ${esc(dust.caveat)}</div>
    ${sparkline(dust.series)}`;
  if (area === 'nili') return `<div class="warnbox">No surface weather is shown for Nili Patera. Jezero MEDA measurements are never displayed as Nili Patera data.</div>${dustHtml}`;
  const meda = app.b.meda; const a = state.areas.jezero;
  const sols = meda.sols ?? [];
  const sol = a.weatherSol ?? sols[0]?.sol ?? null;
  const cardv = weatherCard(meda, a.landingPin, sol, a.weatherMinute, app.b.terrain.covered(...a.landingPin));
  const S = sols.find((s) => s.sol === sol);
  let tl = '';
  if (S) {
    const n = S.samples.length; const bins = 60; tl = '<div class="timeline">';
    for (let i = 0; i < bins; i++) { const lo = Math.floor(i * n / bins), hi = Math.floor((i + 1) * n / bins); const has = S.samples.slice(lo, Math.max(hi, lo + 1)).some((s) => s.pressure_pa !== null || s.air_temp_k !== null); const cur = a.weatherMinute >= lo && a.weatherMinute < Math.max(hi, lo + 1); tl += `<i class="${has ? 'v' : 'g'} ${cur ? 'cur' : ''}"></i>`; }
    tl += '</div>';
  }
  return `${sols.length ? `<div class="row"><label>Sol <select id="wxSol">${sols.map((s) => `<option ${s.sol === sol ? 'selected' : ''}>${s.sol}</option>`).join('')}</select></label><input id="wxMin" type="range" min="0" max="${(S?.samples.length ?? 1) - 1}" value="${a.weatherMinute}"></div>${tl}` : ''}
    <div class="${cardv.kind === 'unavailable' ? 'warnbox' : cardv.flag === 'ok' ? 'okbox' : 'warnbox'}"><b>${esc(cardv.title)}</b>
    <dl class="kv"><dt>What was measured</dt><dd>${esc(cardv.measured)}</dd><dt>Instrument</dt><dd>${esc(cardv.instrument)}</dd><dt>Where</dt><dd>${esc(cardv.where)}</dd><dt>When</dt><dd>${esc(cardv.when)}</dd>
    <dt>Distance to pin</dt><dd>${cardv.distance_m === null ? '—' : fmtM(cardv.distance_m)}</dd>${cardv.values.map((v) => `<dt>${esc(v.label)}</dt><dd>${esc(v.value)}</dd>`).join('')}
    <dt>What is missing</dt><dd>${esc(cardv.missing)}</dd><dt>Planning assumption</dt><dd>${esc(cardv.assumption)}</dd></dl></div>
    <div class="note">Archived measurement, never a live forecast. Simulated scenarios live only in the success-estimate inputs and are labelled as scenarios.</div>${dustHtml}`;
}

function sparkline(series: any[]) {
  const W = 400, H = 60; const v = series.map((s) => s.cdod610); const mx = Math.max(0.1, ...v.filter((x) => x !== null));
  let d = '', pen = false;
  v.forEach((x, i) => { const X = (i / Math.max(1, v.length - 1)) * W; if (x === null) { pen = false; return; } const Y = H - (x / mx) * (H - 4); d += `${pen ? 'L' : 'M'}${X.toFixed(1)},${Y.toFixed(1)}`; pen = true; });
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:60px;background:#111;border-radius:6px"><path d="${d}" fill="none" stroke="#ffc94d" stroke-width="1.5"/><text x="4" y="12" fill="#999" font-size="10">CDOD max ${mx.toFixed(2)} · gaps = breaks</text></svg>`;
}

function photosHtml() {
  return app.b.photos.map((p) => `<div class="photoCard" style="margin-bottom:10px"><img loading="lazy" src="${url('jezero/' + p.local_file)}" alt="${esc(p.product_id)}" data-photo="${p.product_id}">
    <div class="note"><b>${esc(p.camera)}</b> · sol ${p.sol} · ${esc(p.date_utc)} UTC · stop <i>${esc(p.stop)}</i> (by record RMC ${p.mission_record.rmc}) · ${esc(p.credit)} · <a href="${p.source_page}" target="_blank" rel="noopener">record</a></div></div>`).join('');
}

function changeHtml(plans: EvaluatedPlan[]) {
  const e = app.b.nili; const reg = e.registration; const fp = e.false_positive_check; const sm = e.summary;
  const act = plans.find((p) => p.option.id === state.areas.nili.routeOption);
  let h = `<div class="okbox"><b>NASA site-level finding</b> <span class="tag obs">published</span><br>${esc(e.nasa_reference.statement)} <a href="${e.nasa_reference.page}" target="_blank" rel="noopener">PIA15680</a></div>
    <h4 style="margin:8px 0 4px">MarsDelta polygon-level result <span class="tag derived">precomputed pipeline output</span></h4>
    <dl class="kv"><dt>Crop</dt><dd>512 × 512 m at 0.25 m around NASA's frame; ${(e.crop.valid_area_fraction * 100).toFixed(0)}% valid common area</dd>
    <dt>Registration</dt><dd>coarse offset ${reg.coarse_offset.used.map((v: number) => v.toFixed(0)).join(', ')} m (bedrock patches; NASA frame match agrees to ${Math.hypot(reg.coarse_offset.used[0] - reg.coarse_offset.from_pia15680_match_m[0], reg.coarse_offset.used[1] - reg.coarse_offset.from_pia15680_match_m[1]).toFixed(1)} m). Fine: ${reg.n_fit_inliers} bedrock controls, held-out residual <b>${reg.heldout_rms_px.toFixed(2)} px (${reg.heldout_rms_m.toFixed(2)} m)</b></dd>
    <dt>Bedrock check</dt><dd>${(fp.final_mask_fraction_on_bedrock * 100).toFixed(1)}% of stable bedrock flagged (false-positive rate) vs ${(fp.final_mask_fraction_on_dune * 100).toFixed(0)}% of dune sand</dd>
    <dt>Regions</dt><dd>${sm.candidate_regions}: <span class="tag Verified">${sm.by_class.Verified} Verified</span> <span class="tag Requires">${sm.by_class['Requires Review']} Requires Review</span> <span class="tag Uncertain">${sm.by_class.Uncertain} Uncertain</span></dd>
    <dt>Displacement</dt><dd>${e.regions.some((r) => r.displacement.status === 'measured') ? 'measured for some regions' : 'Displacement unresolved for every region (ripple texture changed too much and offsets are comparable to the ' + (e.ripple_wavelength_m?.wavelength_m ?? '?') + ' m ripple wavelength)'}</dd></dl>`;
  if (act) h += `<h4 style="margin:8px 0 4px">Route impact · ${esc(act.option.label)}</h4><div class="${act.impact.status === 'intersects' ? 'warnbox' : act.impact.status === 'clear' ? 'okbox' : 'simbox'}">${esc(act.impact.message)}
    ${act.impact.crossings.map((c) => `<div class="row"><button data-cross="${c.regionId}|${c.startAlong_m}">Inspect ${c.regionId.slice(-3)} · ${c.startAlong_m.toFixed(0)}-${c.endAlong_m.toFixed(0)} m (${c.length_m.toFixed(1)} m, leg ${c.legIndex + 1})</button></div>`).join('')}
    <small>Covered by analysis: ${fmtM(act.impact.coveredLength_m)} of ${fmtM(act.impact.totalLength_m)}.</small></div>`;
  h += `<details><summary>All regions</summary><table class="cmp">${e.regions.map((r) => `<tr><td><a href="#" data-region="${r.id}">${r.id.slice(-3)}</a></td><td><span class="tag ${r.classification.split(' ')[0]}">${r.classification}</span></td><td>${r.area_m2.toLocaleString()} m²</td></tr>`).join('')}</table></details>
    <div class="note">A brighter dune face is not evidence of motion, and a changed ripple is not automatically a hazard. Crossing a region never silently lowers the success estimate.</div>`;
  return h;
}

function crewHtml(area: AreaId) {
  const crew = crewFor(area); const A = crew.suits[0]; const sel = crew.suits.find((s) => s.id === selectedCrew) ?? crew.suits[1];
  const rel = relative(crew, A, sel);
  let walk = '';
  if (rel && area === 'jezero' && A.lastFix && sel.lastFix) {
    const r = routeLeg(app.b.terrain, A.lastFix.xy, sel.lastFix.xy, PROFILES[0], state.assumptions.v0_kmh);
    walk = r.ok ? `terrain-checked walking route ${fmtM(r.path.reduce((s, p, i) => (i ? s + dist(r.path[i - 1], p) : 0), 0))}` : `no terrain-checked walking route (${esc(r.reason)})`;
  } else if (rel) walk = 'no terrain model here: walking route not checked';
  return `<div class="simbox">Software model of a suit-integrated beacon on a simulated local ranging network (3 anchors). No Earth GPS or browser geolocation. All positions and wearer signals are simulated.</div>
    <div class="crewList">${crew.suits.map((s) => { const fs = fixState(crew, s); return `<button data-crew="${s.id}" class="${s.id === sel.id ? 'on' : ''}">${s.id} · ${esc(s.astronaut)}<br><small>${s.lastFix ? (fs === 'live' ? `LIVE fix ±${s.lastFix.sigma2_m.toFixed(1)} m` : `LAST KNOWN fix · ${fmtT(crew.t - s.lastFix.t)} old`) : 'no fix yet'} · comms ${s.comms} · wearer ${s.wearer}${s.distress ? ' · DISTRESS' : ''}</small></button>`; }).join('')}</div>
    ${rel ? `<dl class="kv"><dt>From ${A.id} to ${sel.id}</dt><dd>${rel.range_m.toFixed(1)} m straight-line, bearing ${rel.bearing_deg.toFixed(0)}° (± ${rel.combinedSigma2_m.toFixed(1)} m)</dd><dt>Walking</dt><dd>${walk}</dd><dt>Last contact</dt><dd>${fmtT(rel.age_s)} ago · ${rel.state === 'live' ? 'live' : '<b>not live</b>'}</dd><dt>Wearer</dt><dd>${esc(wearerText(sel))}</dd></dl>` : ''}
    <div class="row"><button data-cs="drop">1 · Leave tablet, walk away</button><button data-cs="cut">2 · Cut B's suit link</button><button data-cs="restore">Restore link</button><button data-cs="spare">3 · Spare suit transmits</button><button data-cs="reset">Reset crew</button></div>
    <div class="note">${crew.log.slice(-4).map(esc).join('<br>')}</div>`;
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
  const ws = el.querySelector<HTMLSelectElement>('#wxSol'); if (ws) ws.onchange = () => { state.areas.jezero.weatherSol = +ws.value; state.areas.jezero.weatherMinute = 0; emit('weather'); };
  const wm = el.querySelector<HTMLInputElement>('#wxMin'); if (wm) wm.oninput = () => { state.areas.jezero.weatherMinute = +wm.value; renderPanel('jezero'); };
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
