import { app, activePlan, crewFor, resetCrew } from '../app';
import { state, log, emit, onChange } from '../state';
import { $, esc, fmtM } from './dom';
import { url } from '../data';
import { bearing, dist, pointAlong, type XY } from '../core/geo';
import { walkSpeed } from '../core/routing';
import { fixState, moveSuit, step, relative, fmtT } from '../core/crew';
import { openEvidence } from './evidence';
import { crewScenario } from './planner';

let timer: number | undefined;
let running = false;
let compress = 30;
let viewTablet = 'TAB-1';
let selected = 'SUIT-B2';
const imgCache: Record<string, HTMLImageElement> = {};
function im(src: string) { if (!imgCache[src]) { const i = new Image(); i.src = src; i.onload = () => draw(); imgCache[src] = i; } return imgCache[src]; }

interface Track { pts: XY[]; cum: number[]; total: number; stopsAt: { s: number; label: string; required: boolean }[] }
function track(): Track | null {
  const p = activePlan(); if (!p || !p.ok) return null;
  const pts: XY[] = []; const stopsAt: Track['stopsAt'] = [];
  p.legs.forEach((leg, i) => { leg.forEach((q, k) => { if (k || !pts.length) pts.push(q); }); stopsAt.push({ s: 0, label: p.stops[i + 1].label, required: p.stops[i + 1].required }); });
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  let acc = 0; p.legs.forEach((leg, i) => { for (let k = 1; k < leg.length; k++) acc += dist(leg[k - 1], leg[k]); stopsAt[i].s = acc; });
  return { pts, cum, total: cum[cum.length - 1], stopsAt };
}

export function initTablet() {
  const el = $('#tabletView');
  el.innerHTML = `<div class="navWrap"><canvas class="nav"></canvas><div class="instr" id="tbInstr"></div><div class="evChip" id="tbEv"></div>
      <div class="scenRow" id="tbScenRow" hidden><span>Crew scenarios <span class="tag sim">simulated</span></span><button data-tcs="drop">Leave tablet A behind</button><button data-tcs="cut">Cut B's suit link</button><button data-tcs="restore">Restore B's link</button><button data-tcs="spare">Spare suit on</button></div></div>
    <div class="side" id="tbSide"></div>
    <div class="controls">
      <button id="tbStart" class="primary">▶ Start</button><button id="tbPause">⏸ Pause</button><button id="tbResume">⏵ Resume</button><button id="tbReset">↺ Reset</button>
      <label class="row">Speed <select id="tbSpeed"><option value="10">×10</option><option value="30" selected>×30</option><option value="60">×60</option><option value="120">×120</option></select></label>
      <label class="row">Tablet <select id="tbView"><option value="TAB-1">Astronaut A</option><option value="TAB-2">Astronaut B</option></select></label>
      <button id="tbScen" aria-expanded="false" style="margin-left:auto">Crew scenarios ▴</button>
    </div>`;
  $('#tbScen').onclick = () => { const r = $('#tbScenRow'); r.hidden = !r.hidden; $('#tbScen').setAttribute('aria-expanded', String(!r.hidden)); };
  $('#tbStart').onclick = () => { app.walk[state.area] = 0; running = true; log('event', 'Tablet walk started (simulated).', true); loop(); };
  $('#tbPause').onclick = () => { running = false; clearInterval(timer); timer = undefined; log('event', 'Tablet walk paused.', true); draw(); };
  $('#tbResume').onclick = () => { if (!running) { running = true; log('event', 'Tablet walk resumed.', true); loop(); } };
  $('#tbReset').onclick = () => { running = false; clearInterval(timer); timer = undefined; app.walk[state.area] = 0; resetCrew(state.area); log('event', 'Tablet walk reset.', true); emit('crew'); };
  ($('#tbSpeed') as HTMLSelectElement).onchange = (e) => { compress = +(e.target as HTMLSelectElement).value; };
  ($('#tbView') as HTMLSelectElement).onchange = (e) => { viewTablet = (e.target as HTMLSelectElement).value; draw(); };
  el.querySelectorAll<HTMLButtonElement>('[data-tcs]').forEach((b) => b.onclick = () => crewScenario(state.area, b.dataset.tcs!));
  window.addEventListener('resize', () => draw());
  onChange(() => { if (!$('#tabletView').hidden) draw(); });
}

function loop() {
  clearInterval(timer);
  const dt = 0.2;
  timer = window.setInterval(() => {
    const T = track(); if (!T || !running) return;
    const area = state.area; const crew = crewFor(area); const A = crew.suits[0];
    const s = app.walk[area];
    const here = pointAlong(T.pts, s), ahead = pointAlong(T.pts, Math.min(T.total, s + 2));
    let grade = 0;
    if (area === 'jezero') { const z0 = app.b.terrain.elev(...here), z1 = app.b.terrain.elev(...ahead); const run = dist(here, ahead); if (run > 0 && Number.isFinite(z0) && Number.isFinite(z1)) grade = (z1 - z0) / run; }
    const v = walkSpeed(grade, state.assumptions.v0_kmh);
    const before = T.stopsAt.find((q) => q.s > s);
    app.walk[area] = Math.min(T.total, s + v * dt * compress);
    if (before && app.walk[area] >= before.s) log('event', `Arrived: ${before.label}`, true);
    moveSuit(crew, A.id, pointAlong(T.pts, app.walk[area]));
    step(crew, dt * compress);
    if (app.walk[area] >= T.total) { running = false; clearInterval(timer); timer = undefined; log('event', 'Walk complete: back at habitat (simulated).', true); }
    draw();
  }, dt * 1000);
}

export function draw() {
  const el = $('#tabletView'); if (el.hidden) return;
  const cv = el.querySelector('canvas.nav') as HTMLCanvasElement; const W = cv.clientWidth, H = cv.clientHeight; if (!W) return;
  const dpr = window.devicePixelRatio || 1; cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#07080a'; g.fillRect(0, 0, W, H);
  const area = state.area; const T = track(); const crew = crewFor(area); const plan = activePlan();
  const tab = crew.tablets.find((t) => t.id === viewTablet)!; const owner = crew.suits.find((s) => s.astronaut === tab.owner)!;
  const ownerFix = owner.lastFix;
  if (!T || !plan || !ownerFix) { $('#tbInstr').textContent = 'No active route'; return; }
  const s = app.walk[area];
  const me: XY = ownerFix.xy; // position shown = the owner's SUIT fix received over telemetry
  const hdg = bearing(pointAlong(T.pts, Math.max(0, Math.min(s, T.total - 3))), pointAlong(T.pts, Math.min(T.total, s + 8)));
  const cx = W / 2, cy = H * 0.7, k = Math.min(W, H) / 150; // ~150 m visible
  g.save(); g.translate(cx, cy); g.rotate((-hdg * Math.PI) / 180);
  const P = (p: XY): [number, number] => [(p[0] - me[0]) * k, -(p[1] - me[1]) * k];
  // base imagery
  const bnds = area === 'jezero' ? app.b.terrainMeta.images.bounds_local_m : app.b.nili.cropBounds;
  const img = im(area === 'jezero' ? url('jezero/ortho.jpg') : url(`nili/${app.b.nili.previews.after}`));
  if (img.complete && img.naturalWidth) { const [a, b] = P([bnds[0], bnds[3]]); g.globalAlpha = 0.85; g.drawImage(img, a, b, (bnds[2] - bnds[0]) * k, (bnds[3] - bnds[1]) * k); g.globalAlpha = 1; }
  // change regions (Nili only)
  if (area === 'nili') {
    for (const r of app.b.nili.regions) for (const poly of r.polys) { g.beginPath(); poly[0].forEach((p, i) => { const [a, b] = P(p); i ? g.lineTo(a, b) : g.moveTo(a, b); }); g.closePath();
      g.fillStyle = r.classification === 'Verified' ? '#5fd38d33' : '#ffb54722'; g.fill(); g.strokeStyle = r.classification === 'Verified' ? '#5fd38d' : '#ffb547'; g.lineWidth = 1.5; g.stroke(); }
  }
  // route walked / ahead
  const drawPath = (from: number, to: number, col: string, w: number) => { g.beginPath(); let first = true; for (let d = from; d <= to; d += 2) { const [a, b] = P(pointAlong(T.pts, d)); first ? g.moveTo(a, b) : g.lineTo(a, b); first = false; } g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'; g.stroke(); };
  drawPath(0, s, '#ffffff55', 6); drawPath(s, T.total, '#ff8a3d', 9);
  if (plan.impact.status === 'intersects') for (const c of plan.impact.crossings) { g.beginPath(); c.segment.forEach((p, i) => { const [a, b] = P(p); i ? g.lineTo(a, b) : g.moveTo(a, b); }); g.strokeStyle = '#ff3df0'; g.lineWidth = 12; g.stroke(); }
  T.stopsAt.forEach((st, i) => { const [a, b] = P(pointAlong(T.pts, st.s)); g.fillStyle = st.required ? '#ff8a3d' : '#fff'; g.beginPath(); g.arc(a, b, 9, 0, 7); g.fill(); g.fillStyle = '#000'; g.font = 'bold 11px system-ui'; g.textAlign = 'center'; g.fillText(i === T.stopsAt.length - 1 ? 'H' : String(i + 1), a, b + 4); });
  // crew: suits (live vs last known) and tablets
  for (const su of crew.suits) {
    if (!su.lastFix || su.id === owner.id) continue;
    const fs = fixState(crew, su); const [a, b] = P(su.lastFix.xy);
    g.beginPath(); g.arc(a, b, su.lastFix.sigma2_m * k, 0, 7); g.strokeStyle = fs === 'live' ? '#5fd38d' : '#aaa'; g.setLineDash(fs === 'live' ? [] : [4, 4]); g.lineWidth = 1.5; g.stroke(); g.setLineDash([]);
    g.fillStyle = fs !== 'live' ? '#777' : su.wearer === 'unconfirmed' ? '#ffb547' : '#5fd38d'; g.beginPath(); g.arc(a, b, 10, 0, 7); g.fill();
    g.save(); g.translate(a, b); g.rotate((hdg * Math.PI) / 180); g.fillStyle = '#000'; g.font = 'bold 10px system-ui'; g.textAlign = 'center'; g.fillText(su.id.slice(-2), 0, 4);
    g.fillStyle = '#fff'; g.font = '12px system-ui'; g.fillText(fs === 'live' ? 'LIVE' : `LAST ${fmtT(crew.t - su.lastFix.t)}`, 0, 24); g.restore();
  }
  for (const t of crew.tablets) { if (t.carriedBy) continue; const [a, b] = P(t.pos); g.save(); g.translate(a, b); g.rotate((hdg * Math.PI) / 180); g.strokeStyle = '#c792ff'; g.lineWidth = 2; g.strokeRect(-14, -10, 28, 20); g.fillStyle = '#c792ff'; g.font = 'bold 10px system-ui'; g.textAlign = 'center'; g.fillText(t.id, 0, 4); g.fillText('left here', 0, 22); g.restore(); }
  g.restore();
  // own marker (heading-up chevron) + uncertainty
  const live = fixState(crew, owner) === 'live';
  g.beginPath(); g.arc(cx, cy, ownerFix.sigma2_m * k, 0, 7); g.strokeStyle = live ? '#5fd38d88' : '#aaa'; g.stroke();
  g.fillStyle = live ? '#5ec8ff' : '#888'; g.beginPath(); g.moveTo(cx, cy - 18); g.lineTo(cx + 13, cy + 12); g.lineTo(cx, cy + 5); g.lineTo(cx - 13, cy + 12); g.closePath(); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke();
  // compass
  g.save(); g.translate(W - 46, H - 70); g.rotate((-hdg * Math.PI) / 180); g.fillStyle = '#ff5d5d'; g.beginPath(); g.moveTo(0, -26); g.lineTo(7, 0); g.lineTo(-7, 0); g.fill(); g.fillStyle = '#ccc'; g.beginPath(); g.moveTo(0, 26); g.lineTo(7, 0); g.lineTo(-7, 0); g.fill(); g.fillStyle = '#fff'; g.font = 'bold 12px system-ui'; g.textAlign = 'center'; g.fillText('N', 0, -30); g.restore();
  g.fillStyle = '#c792ff'; g.font = '12px system-ui'; g.textAlign = 'left'; g.fillText(`Simulated position · heading ${hdg.toFixed(0)}° · ${area === 'nili' ? 'imagery from 2007' : 'HiRISE imagery'}`, 12, H - 12);
  // instruction
  const next = T.stopsAt.find((q) => q.s > s + 1);
  const ins = $('#tbInstr');
  let warn = '';
  const nextCross = plan.impact.crossings.find((c) => c.endAlong_m > s);
  if (nextCross && nextCross.startAlong_m - s < 150) warn = nextCross.startAlong_m > s ? `Changed ground in ${fmtM(nextCross.startAlong_m - s)}` : 'Crossing changed ground now';
  const turn = (() => { const h2 = bearing(pointAlong(T.pts, Math.min(T.total, s + 15)), pointAlong(T.pts, Math.min(T.total, s + 40))); const d = ((h2 - hdg + 540) % 360) - 180; return Math.abs(d) < 15 ? 'Continue straight' : `Bear ${d < 0 ? 'left' : 'right'} ${Math.abs(d).toFixed(0)}°`; })();
  ins.className = `instr ${warn ? 'warn' : ''}`;
  ins.innerHTML = s >= T.total ? `✓ Back at habitat <small>Walk complete</small>` : `<span style="font-size:34px">${warn ? '⚠' : turn.startsWith('Bear left') ? '↖' : turn.startsWith('Bear right') ? '↗' : '⬆'}</span><div>${warn ? esc(warn) : turn}<small>${next ? `${fmtM(next.s - s)} to ${esc(next.label.split('(')[0])}` : ''} · ${fmtM(T.total - s)} remaining incl. return</small></div>`;
  $('#tbEv').innerHTML = nextCross ? `<button id="tbEvBtn">🔍 Inspect changed ground ahead</button>` : '';
  const eb = document.getElementById('tbEvBtn'); if (eb) eb.onclick = () => openEvidence(nextCross!.regionId, nextCross);
  side(T, s, crew, owner, tab);
}

function side(T: Track, s: number, crew: ReturnType<typeof crewFor>, owner: any, tab: any) {
  const p = activePlan()!; const m = p.metrics!; const frac = T.total ? s / T.total : 0;
  const o2now = 100 - (100 - m.o2Remaining_pct) * frac, bnow = 100 - (100 - m.batteryRemaining_pct) * frac;
  const el = $('#tbSide');
  const tabMsg = tab.carriedBy ? '' : `<div class="warnbox">${tab.id} is <b>not with its wearer</b>. It was left behind (purple box). The arrow shows ${owner.id}'s suit beacon, ${fmtM(dist(tab.pos, owner.lastFix.xy))} away.</div>`;
  const live = fixState(crew, owner) === 'live';
  el.innerHTML = `${tabMsg}${live ? '' : `<div class="badbox">Own suit fix is not live: last fix ${fmtT(crew.t - owner.lastFix.t)} old.</div>`}
    <div class="res"><div><small>O₂ now</small><span class="big">${o2now.toFixed(0)}%</span></div><div><small>Battery now</small><span class="big">${bnow.toFixed(0)}%</span></div><div><small>To go</small><span class="big">${fmtM(T.total - s)}</span></div></div>
    <div class="note">Back at the habitat with O₂ ${m.o2Remaining_pct.toFixed(0)}% and battery ${m.batteryRemaining_pct.toFixed(0)}% (keep ${state.assumptions.reservePct}%). ${p.mc ? `${p.mc.successPct.toFixed(0)}% of simulated missions made it back.` : ''}</div>
    <canvas class="overview" id="tbOv" width="320" height="266"></canvas>
    <h4 style="margin:10px 0 6px">Crew <span class="tag sim">simulated</span></h4><div class="crewList">${crew.suits.filter((q) => q.id !== owner.id).map((su) => {
      const r = relative(crew, owner, su); const fs = fixState(crew, su);
      const relDeg = r ? (((r.bearing_deg - bearing(pointAlong(T.pts, Math.max(0, s - 3)), pointAlong(T.pts, Math.min(T.total, s + 8))) + 540) % 360) - 180) : 0;
      const where = r ? `${r.range_m.toFixed(0)} m ${dirWord(relDeg)}` : '';
      const wear = su.wearer === 'unconfirmed' ? 'Wearer unconfirmed: shows where the suit is, not that someone is in it' : 'Wearer confirmed';
      return `<button data-sel="${su.id}" class="${su.id === selected ? 'on' : ''}">${su.id} ${fs === 'live' ? '● LIVE' : su.lastFix ? '○ LAST KNOWN' : '— no fix'} · ${esc(su.astronaut.split('(')[0].trim())}<br><small>${where}${fs !== 'live' && su.lastFix ? ` · last contact ${fmtT(r!.age_s)} ago` : ''}${su.lastFix ? ` · ±${su.lastFix.sigma2_m.toFixed(1)} m` : ''}<br>${wear}</small></button>`; }).join('')}</div>
`;
  el.querySelectorAll<HTMLButtonElement>('[data-sel]').forEach((b) => b.onclick = () => { selected = b.dataset.sel!; draw(); });
  // overview (north-up)
  const ov = el.querySelector('#tbOv') as HTMLCanvasElement; const g = ov.getContext('2d')!; g.fillStyle = '#000'; g.fillRect(0, 0, ov.width, ov.height);
  const xs = T.pts.map((q) => q[0]), ys = T.pts.map((q) => q[1]); const x0 = Math.min(...xs) - 30, x1 = Math.max(...xs) + 30, y0 = Math.min(...ys) - 30, y1 = Math.max(...ys) + 30;
  const sc = Math.min(ov.width / (x1 - x0), ov.height / (y1 - y0)); const Q = (q: XY) => [(q[0] - x0) * sc, ov.height - (q[1] - y0) * sc];
  g.strokeStyle = '#ff8a3d'; g.lineWidth = 3; g.beginPath(); T.pts.forEach((q, i) => { const [a, b] = Q(q); i ? g.lineTo(a, b) : g.moveTo(a, b); }); g.stroke();
  if (p.impact.status === 'intersects') p.impact.crossings.forEach((c) => { g.strokeStyle = '#ff3df0'; g.lineWidth = 6; g.beginPath(); c.segment.forEach((q, i) => { const [a, b] = Q(q); i ? g.lineTo(a, b) : g.moveTo(a, b); }); g.stroke(); });
  const [a, b] = Q(owner.lastFix.xy); g.fillStyle = '#5ec8ff'; g.beginPath(); g.arc(a, b, 5, 0, 7); g.fill();
  g.fillStyle = '#aaa'; g.font = '10px system-ui'; g.fillText('overview · north up', 6, 12);
}

function dirWord(d: number) { const a = Math.abs(d); if (a < 22.5) return 'ahead'; if (a > 157.5) return 'behind you'; const side = d < 0 ? 'left' : 'right'; return a < 67.5 ? `ahead-${side}` : a < 112.5 ? `to your ${side}` : `behind-${side}`; }

export function stopTablet() { running = false; clearInterval(timer); timer = undefined; }
export function isRunning() { return running; }
export function setCompress(c: number) { compress = c; }
export function startWalk() { app.walk[state.area] = app.walk[state.area] || 0; running = true; loop(); }
