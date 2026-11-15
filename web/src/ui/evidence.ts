import type { XY } from '../core/geo';
import { fmtLonLat, toLonLat } from '../core/geo';
import { app } from '../app';
import { url, type Region } from '../data';
import type { Crossing } from '../core/intersect';
import { state, log, emit } from '../state';
import { openModal, closeModal, esc } from './dom';
import { findBypass } from './bypass';

const imgs: Record<string, HTMLImageElement> = {};
function img(name: string): Promise<HTMLImageElement> {
  if (imgs[name]?.complete) return Promise.resolve(imgs[name]);
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url(`nili/${name}`); imgs[name] = i; });
}

const CLS_TEXT: Record<string, string> = {
  Verified: 'NASA has documented ripple movement at this spot, and MarsDelta found the change independently.',
  'Requires Review': 'The ground looks different between the two images. A scientist should check what it means.',
  Uncertain: 'Probably lighting or image alignment rather than real change.',
};

export async function openEvidence(regionId: string, crossing?: Crossing) {
  const e = app.b.nili;
  const r = e.regions.find((q) => q.id === regionId)!;
  const [l, b, rr, t] = e.cropBounds;
  const center: XY = crossing ? [(crossing.start[0] + crossing.end[0]) / 2, (crossing.start[1] + crossing.end[1]) / 2] : regionCenter(r);
  const ob = e.observations;
  const disp = r.displacement;
  const dispHtml = disp.status === 'measured'
    ? `<div class="okbox">Displacement ${disp.magnitude_m} ± ${disp.uncertainty_m} m toward ${disp.direction_toward_azimuth_deg}° over ${e.interval_days} days.</div>`
    : `<div class="warnbox"><b>Displacement unresolved.</b> ${esc(disp.reason || '')}. ${disp.windows_tried} tracking windows tried, ${disp.windows_accepted} passed all checks
       (rejections: ${Object.entries(disp.rejections).filter(([, v]) => (v as number) > 0).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`).join(', ') || 'none'}).
       ${disp.diagnostic_unfiltered_offsets ? `<br><small>Diagnostic only: unfiltered best-match offsets have median ${disp.diagnostic_unfiltered_offsets.median_offset_m} m with weak peaks (median NCC ${disp.diagnostic_unfiltered_offsets.median_peak_ncc} vs runner-up ${disp.diagnostic_unfiltered_offsets.median_second_peak_ncc}) against a ${e.ripple_wavelength_m?.wavelength_m} m ripple wavelength. That is not a measurement.</small>` : ''}</div>`;
  const reg = e.registration;
  const ack = state.areas.nili.acknowledged.includes(r.id);
  const crossTxt = crossing ? `<div class="warnbox"><b>Your route crosses this area for ${crossing.length_m.toFixed(0)} m</b>, from ${crossing.startAlong_m.toFixed(0)} m to ${crossing.endAlong_m.toFixed(0)} m after leaving the habitat.</div>` : '';
  const d = (k: 'before' | 'after') => ob[k].label.START_TIME?.slice(0, 10);
  const body = `
    <h2 class="evTitle">Changed ground · Area ${r.id.slice(-3)} <span class="tag ${r.classification.split(' ')[0]}">${r.classification}</span></h2>
    <p class="evLead">${CLS_TEXT[r.classification]}</p>
    ${crossTxt}
    <div class="evGrid">
      <div>
        <div class="row" role="group" aria-label="Comparison mode">
          <button data-mode="blink" class="on">Blink</button><button data-mode="swipe">Swipe</button><button data-mode="side">Side by side</button>
        </div>
        <div id="evStage"></div>
        <div class="row"><button id="evZoomIn">＋ Zoom</button><button id="evZoomOut">－ Zoom</button><button id="evOutline" class="on">Outline on</button><button id="evDiff">Texture difference</button>
          <span class="note" id="evNow"></span></div>
        <div class="note">Before ${d('before')} · after ${d('after')} (${e.interval_days} days apart). HiRISE orbital images, north up. ${esc(ob.after.credit)}.</div>
      </div>
      <div>
        <h4 style="margin-top:0">What do you want to do?</h4>
        <div class="row evActions">
          <button id="evAck" ${ack ? 'disabled' : ''} class="primary">${ack ? 'Acknowledged' : 'Acknowledge and continue'}</button>
          <button id="evBypass">Find a way around</button>
          <button id="evReview">Ask for review</button>
        </div>
        <div id="evDecision"></div>
        <dl class="kv">
          <dt>Why</dt><dd>${esc(r.explanation)}</dd>
          <dt>Size</dt><dd>${r.area_m2.toLocaleString()} m²</dd>
          <dt>Movement</dt><dd>${disp.status === 'measured' ? `${disp.magnitude_m} ± ${disp.uncertainty_m} m over ${e.interval_days} days` : 'Could not be measured reliably'}</dd>
        </dl>
        <details class="evMore"><summary>NASA's finding at this site</summary>
          <div class="note" style="color:var(--text)">${esc(e.nasa_reference.statement)}</div>
          <img src="${url('nili/PIA15680.gif')}" alt="NASA PIA15680 blink animation" style="width:100%;border-radius:8px">
          <div class="note">NASA PIA15680 (${esc(e.nasa_reference.credit)}). Kept separate from MarsDelta's own classes. <a href="${e.nasa_reference.page}" target="_blank" rel="noopener">Photojournal page</a></div>
        </details>
        <details class="evMore"><summary>Technical details</summary>
          <dl class="kv">
            <dt>Region ID</dt><dd><code>${r.id}</code></dd>
            <dt>Centre</dt><dd>${r.centroid_lonlat[1].toFixed(5)}° N, ${r.centroid_lonlat[0].toFixed(5)}° E</dd>
            ${crossing ? `<dt>Crossing</dt><dd>leg ${crossing.legIndex + 1}; entry ${fmtLonLat('nili', ...crossing.start)} → exit ${fmtLonLat('nili', ...crossing.end)}</dd>` : ''}
            <dt>Texture</dt><dd>mean local correlation ${r.mean_local_ncc} (threshold ${e.parameters.change_ncc_threshold}); dune fraction ${(r.dune_fraction * 100).toFixed(0)}%</dd>
            <dt>Alignment</dt><dd>held-out bedrock residual ${reg.heldout_rms_px.toFixed(2)} px = ${reg.heldout_rms_m.toFixed(2)} m RMS (${reg.n_heldout} held-out of ${reg.n_controls_total} controls); before fine registration ${reg.pre_fine_heldout_rms_px.toFixed(1)} px</dd>
            <dt>Images</dt><dd>${ob.before.id} (incidence ${(+ob.before.label.INCIDENCE_ANGLE.split(' ')[0]).toFixed(1)}°), ${ob.after.id} (incidence ${(+ob.after.label.INCIDENCE_ANGLE.split(' ')[0]).toFixed(1)}°); RED map-projected, 0.25 m/px</dd>
            <dt>Source pixels</dt><dd><small>${r.source_pixels.after_product} rows/cols ${r.source_pixels.after_window_rowcol.join(', ')}<br>${r.source_pixels.before_product} ≈ ${r.source_pixels.before_window_rowcol_approx.join(', ')}</small></dd>
          </dl>
          ${dispHtml}
          <label class="row"><input type="checkbox" id="evRaw"> Show the before image without fine bedrock alignment</label>
          <div class="note">${(['before', 'after'] as const).map((k) => `<a href="${ob[k].page}" target="_blank" rel="noopener">${ob[k].id}</a> (<a href="${ob[k].jp2_url}">RED JP2</a>, <a href="${ob[k].label_url}">label</a>, sha256 ${ob[k].sha256.slice(0, 12)}…)`).join('<br>')}
            <br>Pipeline v${e.pipeline_version}, ${e.precomputed ? 'precomputed (not re-run in the browser), ' : ''}generated ${e.generated}.</div>
        </details>
      </div>
    </div>`;
  const root = openModal(body);
  const viewer = new Viewer(root.querySelector('#evStage')!, { l, b, r: rr, t }, center, r, crossing);
  await viewer.load();
  root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((btn) => btn.onclick = () => {
    root.querySelectorAll('[data-mode]').forEach((q) => q.classList.remove('on')); btn.classList.add('on'); viewer.setMode(btn.dataset.mode as any);
  });
  (root.querySelector('#evRaw') as HTMLInputElement).onchange = (ev) => viewer.setRaw((ev.target as HTMLInputElement).checked);
  root.querySelector<HTMLButtonElement>('#evZoomIn')!.onclick = () => viewer.zoom(0.7);
  root.querySelector<HTMLButtonElement>('#evZoomOut')!.onclick = () => viewer.zoom(1 / 0.7);
  root.querySelector<HTMLButtonElement>('#evOutline')!.onclick = (ev) => { (ev.target as HTMLElement).classList.toggle('on'); viewer.outline = !viewer.outline; viewer.draw(); };
  root.querySelector<HTMLButtonElement>('#evDiff')!.onclick = (ev) => { (ev.target as HTMLElement).classList.toggle('on'); viewer.diff = !viewer.diff; viewer.draw(); };
  const dec = root.querySelector('#evDecision')!;
  root.querySelector<HTMLButtonElement>('#evAck')!.onclick = (ev) => {
    if (!state.areas.nili.acknowledged.includes(r.id)) state.areas.nili.acknowledged.push(r.id);
    log('decision', `Acknowledged crossing of ${r.id} (${r.classification})${crossing ? ` at ${crossing.startAlong_m.toFixed(0)}-${crossing.endAlong_m.toFixed(0)} m` : ''}. Finding retained in log; success estimate unchanged by the intersection itself.`, false, 'nili');
    (ev.target as HTMLButtonElement).disabled = true; (ev.target as HTMLButtonElement).textContent = 'Acknowledged';
    dec.innerHTML = `<div class="okbox">Logged. The crossing stays marked on the map and in the mission log.</div>`;
  };
  root.querySelector<HTMLButtonElement>('#evReview')!.onclick = () => {
    if (!state.areas.nili.reviewRequested.includes(r.id)) state.areas.nili.reviewRequested.push(r.id);
    log('decision', `Manual review requested for ${r.id}. Missing evidence: terrain model for the crop; reliable ripple displacement; any in-situ observation.`, false, 'nili');
    dec.innerHTML = `<div class="warnbox">Review requested and logged. Still unknown here: slope and footing (no terrain model), how far the ripples moved, and what the ground is like up close.</div>`;
  };
  root.querySelector<HTMLButtonElement>('#evBypass')!.onclick = () => {
    const res = findBypass();
    log('decision', `Bypass search: ${res.summary}`, false, 'nili');
    dec.innerHTML = `<div class="${res.offered ? 'okbox' : 'warnbox'}">${esc(res.summary)}</div>`;
    emit('bypass');
  };
}

function regionCenter(r: Region): XY {
  const ring = r.polys[0][0]; let x = 0, y = 0; ring.forEach((p) => { x += p[0]; y += p[1]; }); return [x / ring.length, y / ring.length];
}

type Mode = 'blink' | 'swipe' | 'side';
class Viewer {
  mode: Mode = 'blink'; raw = false; outline = true; diff = false; showAfter = false; swipe = 0.5; half = 45; c: XY;
  timer: number | undefined; canvases: HTMLCanvasElement[] = []; I: Record<string, HTMLImageElement> = {};
  constructor(private el: HTMLElement, private B: { l: number; b: number; r: number; t: number }, c: XY, private region: Region, private crossing?: Crossing) { this.c = c; }
  async load() {
    const p = app.b.nili.previews;
    [this.I.before, this.I.raw, this.I.after, this.I.diff] = await Promise.all([img(p.before_aligned), img(p.before_coarse_only), img(p.after), img(p.texture_difference)]);
    this.setMode('blink');
  }
  setRaw(v: boolean) { this.raw = v; this.draw(); }
  zoom(f: number) { this.half = Math.min(250, Math.max(8, this.half * f)); this.draw(); }
  setMode(m: Mode) {
    this.mode = m; clearInterval(this.timer); this.el.innerHTML = '';
    const mk = (lbl: string) => { const v = document.createElement('div'); v.className = 'viewer'; v.innerHTML = `<canvas width="900" height="900"></canvas><span class="lbl">${lbl}</span><span class="scale"></span>`; return v; };
    if (m === 'side') { const w = document.createElement('div'); w.className = 'pair'; w.append(mk('Before (2007-06-30)'), mk('After (2007-10-13)')); this.el.append(w); }
    else this.el.append(mk(m === 'blink' ? '' : 'Swipe: before ◀ ▶ after'));
    this.canvases = [...this.el.querySelectorAll('canvas')];
    if (m === 'blink') this.timer = window.setInterval(() => { if (!document.body.contains(this.el)) { clearInterval(this.timer); return; } this.showAfter = !this.showAfter; this.draw(); }, 900);
    this.canvases.forEach((cv) => this.bindPan(cv));
    this.draw();
  }
  bindPan(cv: HTMLCanvasElement) {
    let drag: { x: number; y: number; c: XY } | null = null;
    cv.addEventListener('pointerdown', (e) => {
      if (this.mode === 'swipe') { this.swipeAt(cv, e); }
      drag = { x: e.clientX, y: e.clientY, c: [...this.c] as XY }; cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (this.mode === 'swipe' && !e.shiftKey) { this.swipeAt(cv, e); return; }
      const s = (2 * this.half) / cv.clientWidth;
      this.c = [drag.c[0] - (e.clientX - drag.x) * s, drag.c[1] + (e.clientY - drag.y) * s]; this.draw();
    });
    cv.addEventListener('pointerup', () => { drag = null; });
    cv.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom(e.deltaY > 0 ? 1.15 : 0.87); }, { passive: false });
  }
  swipeAt(cv: HTMLCanvasElement, e: PointerEvent) { const r = cv.getBoundingClientRect(); this.swipe = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); this.draw(); }
  src(name: 'before' | 'after') { if (this.diff) return this.I.diff; return name === 'before' ? (this.raw ? this.I.raw : this.I.before) : this.I.after; }
  draw() {
    const { l, b, r, t } = this.B; const W = this.I.after.naturalWidth, H = this.I.after.naturalHeight;
    const px = (X: number) => ((X - l) / (r - l)) * W, py = (Y: number) => ((t - Y) / (t - b)) * H;
    const sx = px(this.c[0] - this.half), sy = py(this.c[1] + this.half), sw = px(this.c[0] + this.half) - sx, sh = py(this.c[1] - this.half) - sy;
    const paint = (cv: HTMLCanvasElement, which: 'before' | 'after', clip?: [number, number]) => {
      const g = cv.getContext('2d')!; g.imageSmoothingEnabled = this.half > 30;
      if (!clip) { g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height); }
      g.save();
      if (clip) { g.beginPath(); g.rect(clip[0], 0, clip[1] - clip[0], cv.height); g.clip(); }
      g.drawImage(this.src(which), sx, sy, sw, sh, 0, 0, cv.width, cv.height); g.restore();
    };
    const overlay = (cv: HTMLCanvasElement) => {
      const g = cv.getContext('2d')!; const k = cv.width / (2 * this.half);
      const tx = (p: XY) => [(p[0] - (this.c[0] - this.half)) * k, ((this.c[1] + this.half) - p[1]) * k];
      if (this.outline) {
        g.lineWidth = 2; g.strokeStyle = this.region.classification === 'Verified' ? '#5fd38d' : this.region.classification === 'Uncertain' ? '#bbb' : '#ffb547';
        g.setLineDash(this.region.classification === 'Uncertain' ? [6, 4] : []);
        for (const poly of this.region.polys) for (const ring of poly) { g.beginPath(); ring.forEach((p, i) => { const [a, c] = tx(p); i ? g.lineTo(a, c) : g.moveTo(a, c); }); g.stroke(); }
        g.setLineDash([]);
        if (this.crossing) { g.strokeStyle = '#ff3df0'; g.lineWidth = 5; g.beginPath(); this.crossing.segment.forEach((p, i) => { const [a, c] = tx(p); i ? g.lineTo(a, c) : g.moveTo(a, c); }); g.stroke(); }
      }
      const sc = cv.parentElement!.querySelector('.scale'); if (sc) sc.textContent = `${(2 * this.half).toFixed(0)} m across · north up`;
    };
    if (this.mode === 'side') { paint(this.canvases[0], 'before'); paint(this.canvases[1], 'after'); this.canvases.forEach(overlay); }
    else if (this.mode === 'blink') {
      const cv = this.canvases[0]; paint(cv, this.showAfter ? 'after' : 'before'); overlay(cv);
      const lb = cv.parentElement!.querySelector('.lbl')!; lb.textContent = this.diff ? 'Texture difference (1 − local correlation)' : this.showAfter ? 'AFTER · 2007-10-13 · PSP_005684_1890' : `BEFORE · 2007-06-30 · PSP_004339_1890${this.raw ? ' (no fine registration)' : ''}`;
    } else {
      const cv = this.canvases[0]; const x = this.swipe * cv.width; paint(cv, 'after'); paint(cv, 'before', [0, x]); overlay(cv);
      const g = cv.getContext('2d')!; g.fillStyle = '#ff8a3d'; g.fillRect(x - 2, 0, 4, cv.height);
    }
    const now = document.getElementById('evNow'); if (now) { const [lon, lat] = toLonLat('nili', ...this.c); now.textContent = `View centre ${lat.toFixed(5)}° N, ${lon.toFixed(5)}° E`; }
  }
}

export { closeModal };
