import './styles.css';
import { loadAll } from './data';
import { app } from './app';
import { state, onChange, emit } from './state';
import { initPlanner, renderPlanner, plannerMap } from './ui/planner';
import { initTablet, draw as drawTablet } from './ui/tablet';
import { startDemo } from './ui/demo';
import { $, openModal, esc } from './ui/dom';
import type { AreaId } from './core/geo';

let view: 'planner' | 'tablet' = 'planner';
export function setView(v: 'planner' | 'tablet') {
  view = v; $('#plannerView').hidden = v !== 'planner'; $('#tabletView').hidden = v !== 'tablet';
  $('#plannerView').style.display = v === 'planner' ? 'flex' : 'none'; $('#tabletView').style.display = v === 'tablet' ? 'grid' : 'none';
  document.querySelectorAll<HTMLButtonElement>('#viewSel button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === v)));
  if (v === 'planner') setTimeout(() => plannerMap().invalidateSize(), 50); else setTimeout(drawTablet, 30);
}

function syncArea() { document.querySelectorAll<HTMLButtonElement>('#areaSel button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.area === state.area))); }

async function boot() {
  $('#panel').innerHTML = '<div class="note">Loading evidence bundles…</div>';
  try { app.b = await loadAll(); } catch (e) { $('#panel').innerHTML = `<div class="badbox">Could not load data bundles: ${esc(e)}</div>`; return; }
  initPlanner(); initTablet();
  onChange((_s, why) => { syncArea(); renderPlanner(why); if (view === 'tablet') drawTablet(); });
  document.querySelectorAll<HTMLButtonElement>('#areaSel button').forEach((b) => b.onclick = () => { state.area = b.dataset.area as AreaId; emit('area'); });
  document.querySelectorAll<HTMLButtonElement>('#viewSel button').forEach((b) => b.onclick = () => setView(b.dataset.view as any));
  $('#demoBtn').onclick = () => openModal(`<h2>Guided demonstrations</h2><p>Both walkthroughs are driven by the real application state and can be restarted at any time.</p>
     <div class="row"><button class="primary" id="dN">B · Nili Patera change investigation (7 steps)</button><button id="dJ">A · Jezero science walk (7 steps)</button></div>`);
  document.addEventListener('click', (e) => { const t = e.target as HTMLElement; if (t.id === 'dN' || t.id === 'dJ') { $('#modal').hidden = true; startDemo(t.id === 'dN' ? 'nili' : 'jezero'); } });
  $('#sourcesBtn').onclick = sources;
  syncArea(); setView('planner'); renderPlanner('area');
  netState();
}

function sources() {
  const m = app.b.manifest; const src = m?.sources ?? {};
  openModal(`<h2>Data sources and provenance</h2><p class="note">From <code>data/source_manifest.json</code> (pipeline v${esc(m?.pipeline_version)}, updated ${esc(m?.updated)}). Every file below was downloaded and hashed by the pipeline; nothing is hard-coded.</p>
    <table class="cmp"><tr><th>Key</th><th>Product</th><th>Credit</th><th>Resolved URL</th><th>SHA-256</th></tr>${Object.entries(src).map(([k, v]: any) => `<tr><td><small>${esc(k)}</small></td><td><small>${esc(v.product_id ?? '')}<br>${esc(v.purpose ?? '')}</small></td><td><small>${esc(v.credit ?? '')}</small></td><td><small style="word-break:break-all">${esc(v.resolved_url ?? v.url ?? '')}</small></td><td><small>${esc((v.sha256 ?? '').slice(0, 16))}</small></td></tr>`).join('')}</table>
    <p class="note">MarsDelta is a NASA Space Apps prototype. It makes no flight-safety certification and implies no NASA endorsement.</p>`);
}

function netState() {
  const el = $('#netState');
  const upd = () => { el.textContent = navigator.onLine ? (navigator.serviceWorker?.controller ? 'online · cached for offline' : 'online') : 'OFFLINE · cached data'; };
  window.addEventListener('online', upd); window.addEventListener('offline', upd);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').then(() => navigator.serviceWorker.ready).then(upd).catch(() => upd());
    navigator.serviceWorker.addEventListener('controllerchange', upd);
  }
  upd();
}

boot();
