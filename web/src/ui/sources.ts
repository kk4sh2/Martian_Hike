import { app, activePlan } from '../app';
import { state } from '../state';
import { $, openModal, esc } from './dom';
import { DEFAULT_ASSUMPTIONS, ENV_SCENARIOS, PROVENANCE } from '../core/metrics';
import { SUCCESS_DEFINITION } from '../core/montecarlo';
import { sparkline } from './planner';

/** Everything that is provenance or method detail lives here, out of the astronaut's main view. */
const TABS: [string, string][] = [
  ['overview', 'Overview'], ['datasets', 'Datasets'], ['change', 'Change analysis'], ['model', 'Planning model'],
  ['weather', 'Weather & dust'], ['terrain', 'Terrain'], ['crew', 'Crew tracking'],
];

function tag(k: string) { return `<span class="tag ${k === 'measured' ? 'obs' : k === 'derived' ? 'derived' : k === 'user' ? 'user' : 'assumed'}">${k}</span>`; }

function areaOf(key: string, v: any): 'Jezero Crater' | 'Nili Patera' | 'Other' {
  const t = `${key} ${v.product_id ?? ''} ${v.purpose ?? ''}`.toLowerCase();
  if (/nili|psp_|pia1/.test(t)) return 'Nili Patera';
  if (/jezero|zl\d|m20|jez_|sim3464|mastcam|perseverance|mars2020|meda/.test(t)) return 'Jezero Crater';
  return 'Other';
}

function overview() {
  return `<p>MarsDelta plans astronaut walks at two Mars sites, using real orbital and rover data where it exists.</p>
    <dl class="kv wide"><dt>Jezero Crater</dt><dd>Western delta science walk. Question: what changes in the visible rock layers as the crew approaches the delta deposits? Stops are real Perseverance rover positions; the habitat placement is simulated.</dd>
    <dt>Nili Patera</dt><dd>Dune field imaged by HiRISE on 30 June and 13 October 2007, 105 days apart. MarsDelta compares the two images and warns when a planned walk crosses changed ground. Walks, habitat and crew are simulated.</dd>
    <dt>Labels</dt><dd>${tag('measured')} real measurement · ${tag('derived')} computed from real data · ${tag('assumed')} assumption · ${tag('user')} set by you · <span class="tag sim">simulated</span> made up for the demonstration</dd></dl>
    <p class="note">Data from the two sites is never mixed: Nili change areas never appear on Jezero routes, and Jezero weather is never shown for Nili.</p>
    <p class="note">MarsDelta is a NASA Space Apps prototype. It makes no flight-safety certification and implies no NASA endorsement.</p>`;
}

function datasets() {
  const m = app.b.manifest; const src = Object.entries(m?.sources ?? {}) as [string, any][];
  const groups: Record<string, [string, any][]> = { 'Jezero Crater': [], 'Nili Patera': [], Other: [] };
  for (const [k, v] of src) if (v.url || v.resolved_url) groups[areaOf(k, v)].push([k, v]);
  return `<p class="note">Every file was downloaded and hashed by the data pipeline (v${esc(m?.pipeline_version)}, updated ${esc(m?.updated)}). Nothing is typed in by hand.</p>` +
    Object.entries(groups).filter(([, l]) => l.length).map(([g, l]) => `<h3>${g === 'Other' ? 'Shared / climate' : g}</h3>
    <table class="cmp"><tr><th>Product</th><th>Used for</th><th>Credit</th><th>SHA-256</th></tr>${l.map(([, v]) => `<tr><td><a href="${esc(v.resolved_url ?? v.url)}" target="_blank" rel="noopener">${esc(v.product_id ?? '')}</a></td><td>${esc(v.purpose ?? '')}</td><td><small>${esc(v.credit ?? '')}</small></td><td><small>${esc((v.sha256 ?? '').slice(0, 12))}…</small></td></tr>`).join('')}</table>`).join('') +
    `<h3>Not available</h3><ul class="note"><li>Full-resolution Perseverance MEDA readings (the PDS archive could not be reached when the data was built). NASA's daily MEDA summaries for the latest published sols are used instead.</li><li>A terrain model for the Nili Patera site, so no climb, slope or bypass route there.</li></ul>`;
}

function change() {
  const e = app.b.nili; const reg = e.registration; const fp = e.false_positive_check; const sm = e.summary;
  return `<div class="okbox"><b>NASA's published finding</b> ${tag('measured')}<br>${esc(e.nasa_reference.statement)} <a href="${e.nasa_reference.page}" target="_blank" rel="noopener">PIA15680</a></div>
    <h3>MarsDelta's own analysis ${tag('derived')}</h3>
    <dl class="kv wide"><dt>Images</dt><dd>HiRISE PSP_004339_1890 (2007-06-30) and PSP_005684_1890 (2007-10-13), 105 days apart.</dd>
    <dt>Area</dt><dd>512 × 512 m at 0.25 m per pixel around NASA's frame; ${(e.crop.valid_area_fraction * 100).toFixed(0)}% usable in both images.</dd>
    <dt>Alignment</dt><dd>Aligned on bedrock, which should not move. Coarse offset ${reg.coarse_offset.used.map((v: number) => v.toFixed(0)).join(', ')} m; fine fit from ${reg.n_fit_inliers} bedrock points. Error on points held back for checking: <b>${reg.heldout_rms_m.toFixed(2)} m</b> (${reg.heldout_rms_px.toFixed(2)} px).</dd>
    <dt>False alarms</dt><dd>${(fp.final_mask_fraction_on_bedrock * 100).toFixed(1)}% of stable bedrock was flagged as changed, against ${(fp.final_mask_fraction_on_dune * 100).toFixed(0)}% of dune sand.</dd>
    <dt>Result</dt><dd>${sm.candidate_regions} changed areas: <span class="tag Verified">${sm.by_class.Verified} Verified</span> <span class="tag Requires">${sm.by_class['Requires Review']} Requires Review</span> <span class="tag Uncertain">${sm.by_class.Uncertain} Uncertain</span></dd>
    <dt>Classes</dt><dd><b>Verified</b>: on dune sand inside NASA's frame, where NASA documented ripple motion. <b>Requires Review</b>: on dune sand elsewhere. <b>Uncertain</b>: mostly on bedrock or at the image edge, more likely lighting or alignment.</dd>
    <dt>Movement</dt><dd>${e.regions.some((r) => r.displacement.status === 'measured') ? 'Measured for some areas.' : `Displacement unresolved for every area: the ripples changed too much, and candidate offsets are close to the ${e.ripple_wavelength_m?.wavelength_m ?? '?'} m ripple spacing, so a one-ripple jump cannot be ruled out. No number is shown rather than a guess.`}</dd>
    <dt>Pipeline</dt><dd>v${esc(e.pipeline_version)}, run ${esc(e.generated.slice(0, 10))}. Precomputed; the browser does not re-run it.</dd></dl>
    <p class="note">A brighter dune face is not proof of motion, and changed ripples are not automatically a hazard. Crossing a changed area never lowers the success estimate on its own.</p>`;
}

function model() {
  const a = state.assumptions; const factors = activePlan(state.area)?.mc?.factors ?? [];
  const label: Record<string, string> = { v0_kmh: 'Flat walking speed (km/h)', bodyKg: 'Body mass (kg)', suitKg: 'Suit mass (kg)', equipmentKg: 'Equipment (kg)', restW: 'Resting metabolic (W)',
    walkJPerKgM: 'Walking cost (J/kg/m)', climbEfficiency: 'Climb efficiency', taskW: 'Task metabolic (W)', o2Kg: 'Oxygen (kg)', batteryWh: 'Battery (Wh)', reservePct: 'Reserve (%)',
    baseW: 'Suit base load (W)', coolingFrac: 'Cooling fraction', obstaclesPerKm: 'Obstacles per km', obstacleDelayMin: 'Delay per obstacle (min)', requiredTaskMin: 'Science task (min)',
    otherStopMin: 'Other stops (min)', evaLimitH: 'EVA limit (h)', environment: 'Conditions' };
  return `<h3>What counts as success</h3><p>${esc(SUCCESS_DEFINITION)}</p>
    <h3>How the estimate is made</h3><ul>${factors.map((f) => `<li>${esc(f)}</li>`).join('')}
    <li>Routes are computed on a 2 m terrain grid; cells without terrain data are never entered.</li>
    <li>Same seed and plan give the same result. Both routes use the same random draws, so differences come from the routes.</li>
    <li>It is not a validated probability of human survival.</li></ul>
    <h3>Inputs</h3><table class="cmp"><tr><th>Input</th><th>Now</th><th>Default</th><th>Source</th></tr>${Object.keys(label).map((k) => `<tr><td>${label[k]}</td><td>${esc((a as any)[k])}</td><td>${esc((DEFAULT_ASSUMPTIONS as any)[k])}</td><td>${tag((PROVENANCE as any)[k])}</td></tr>`).join('')}
    <tr><td>Mars gravity</td><td colspan="2">3.711 m/s²</td><td>${tag('measured')}</td></tr><tr><td>O₂ per metabolic energy</td><td colspan="2">0.0711 g/kJ</td><td>${tag('derived')}</td></tr></table>
    <h3>Conditions</h3><ul>${Object.values(ENV_SCENARIOS).map((v) => `<li><b>${esc(v.label)}</b>: ${esc(v.note)}</li>`).join('')}</ul>`;
}

function weather() {
  const meda = app.b.meda;
  const dustBlock = (k: 'jezero' | 'nili', name: string) => { const d = app.b.dust.areas[k]; const dv = d.series.filter((s: any) => s.cdod610 !== null);
    return `<h3>${name}: regional dust</h3><p class="note">${esc(d.quantity)} (${esc(d.units)}), LMD/Montabone gridded maps, cell ${d.cell.lat_min}-${d.cell.lat_max}° N × ${d.cell.lon_min}-${d.cell.lon_max}° E. Window: ${esc(d.window_reason)}. ${dv.length} of ${d.series.length} steps have data${dv.length ? `; range ${Math.min(...dv.map((s: any) => s.cdod610)).toFixed(2)}-${Math.max(...dv.map((s: any) => s.cdod610)).toFixed(2)}` : ''}.</p>${sparkline(d.series)}<p class="note">${esc(d.caveat)}</p>`; };
  const md = app.b.medaDaily;
  return `<h3>Jezero surface weather (MEDA)</h3>
    <p>${md ? `Daily summaries for sols ${md.sols[0].sol}–${md.sols[md.sols.length - 1].sol}, as published by NASA (${esc(md.source)}), captured ${esc(md.retrieved.slice(0, 10))}. Low and high air temperature, pressure, sunrise and sunset. Values NASA left blank are shown as gaps. The station position for each sol is the rover's localization on or before that sol.` : 'No daily summaries packaged.'}</p>
    <p>Full-resolution MEDA readings: ${meda.status === 'available' ? `${meda.sols?.length ?? 0} sol(s) packaged.` : `not available. ${esc((meda as any).reason ?? '')}`}</p>
    <p class="note">The published summaries cover the latest sols only, not the sols of the planned walk, and the station can be kilometres from the landing pin. They describe conditions at the rover, not a forecast.</p>
    <h3>Nili Patera surface weather</h3><p>None. There is no station near this site, and Jezero readings are never shown for it.</p>
    ${dustBlock('jezero', 'Jezero')}${dustBlock('nili', 'Nili Patera')}`;
}

function terrain() {
  const t = app.b.terrainMeta as any;
  return `<h3>Jezero terrain</h3><p>${esc(String(t.dtm?.quality_note ?? ''))}</p>
    <p class="note">Elevation and slope are resampled to a 2 m grid; slopes use a 10 m baseline. Map coordinates are metres east/north of 18.4525° N, 77.4050° E on the Mars 2000 sphere.</p>
    <h3>Nili Patera terrain</h3><p>No terrain model is packaged for this site. Climb and slope are unknown, walking times assume flat ground, and no bypass route can be computed.</p>`;
}

function crew() {
  return `<p>All crew positions, suits, tablets and radio links are <span class="tag sim">simulated</span>.</p>
    <ul><li>Each suit has a beacon that measures its distance to three fixed radio anchors (habitat mast, rover, relay mast). No GPS and no browser location are used.</li>
    <li>Position is found by trilateration. The ± value is the 95% (2σ) uncertainty.</li>
    <li>Tablets are separate devices. A tablet left behind stays where it was dropped; the astronaut is shown at their suit beacon.</li>
    <li><b>Live</b> means a fresh fix. <b>Last known</b> means the link is down; the last fix is frozen and its age is shown.</li>
    <li>A spare suit that transmits shows where the suit is, but a beacon cannot confirm anyone is wearing it.</li></ul>`;
}

const RENDER: Record<string, () => string> = { overview, datasets, change, model, weather, terrain, crew };

export function openSources(tab = 'overview') {
  const body = openModal(`<h2>Sources &amp; details</h2><div class="srcTabs" role="tablist">${TABS.map(([k, l]) => `<button role="tab" data-st="${k}" aria-selected="${k === tab}">${l}</button>`).join('')}</div><div id="srcBody" class="srcBody"></div>`);
  const show = (k: string) => { $('#srcBody', body).innerHTML = RENDER[k](); body.querySelectorAll<HTMLButtonElement>('[data-st]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.st === k))); };
  body.querySelectorAll<HTMLButtonElement>('[data-st]').forEach((b) => b.onclick = () => show(b.dataset.st!));
  show(tab);
}
